# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-024.md

# Part 024 — Performance Engineering II: Query Optimization Patterns

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **024 / 034**  
> Fokus: pola optimasi query ClickHouse secara sistematis: reduce scan, align predicate dengan sorting key, optimize aggregation, join, sort, projection, pre-aggregation, dan guardrail untuk Java analytics API.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 023 kita membahas cara membaca bukti performa:

- `EXPLAIN`;
- `EXPLAIN indexes = 1`;
- `EXPLAIN PIPELINE`;
- `system.query_log`;
- `system.query_thread_log`;
- `system.parts`;
- `system.parts_columns`;
- `system.merges`;
- `system.mutations`;
- distributed health tables.

Part ini melanjutkan dari diagnosis ke aksi.

Performance optimization di ClickHouse harus dimulai dari pertanyaan:

```text
Apa yang bisa dibuat tidak perlu dibaca, tidak perlu dihitung, tidak perlu di-join, tidak perlu di-sort, tidak perlu dikirim, atau tidak perlu dilakukan saat query time?
```

ClickHouse sangat cepat ketika query shape cocok dengan physical layout.

Namun query yang tampak sederhana bisa sangat mahal jika:

- filter tidak memanfaatkan sorting key;
- query membaca banyak kolom besar;
- aggregation cardinality meledak;
- join dilakukan sebelum data direduksi;
- sort dilakukan pada raw rows besar;
- `FINAL` dipakai sembarangan;
- query distributed mengirim partial result sangat besar;
- API memberi pengguna kebebasan group-by/filter tanpa guardrail.

Part ini adalah katalog pola optimasi yang bisa dipakai setelah kamu tahu bottleneck-nya.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. mengoptimasi query dengan mengurangi rows, bytes, columns, intermediate state, dan result size;
2. menulis predicate yang lebih mudah dipakai oleh partition pruning dan primary key pruning;
3. memahami kapan `PREWHERE` membantu;
4. memanfaatkan sorting key dan prefix effect;
5. mengoptimasi aggregation high-cardinality;
6. memilih exact vs approximate aggregate secara sadar;
7. mengoptimasi join dengan denormalization, dictionary, pre-aggregation, dan right-side reduction;
8. mengoptimasi sort/top-N/pagination/export;
9. memilih antara raw query, projection, materialized view, rollup, dan serving table;
10. menghindari anti-pattern seperti `SELECT *`, unbounded group-by, arbitrary joins, dan uncontrolled `FINAL`;
11. membangun safe query design untuk Java analytics API;
12. membuat workflow sebelum/after benchmark yang benar.

---

## 2. Mental Model Utama: Query Optimization adalah Menghapus Kerja

Query cepat bukan karena engine “lebih pintar” saja. Query cepat karena lebih sedikit kerja.

ClickHouse optimization biasanya jatuh ke lima kategori:

```text
1. Read less data.
2. Decode/decompress less data.
3. Build smaller intermediate states.
4. Move repeated computation to ingestion/precompute time.
5. Return less data to client.
```

Contoh:

```sql
SELECT *
FROM events
WHERE formatDateTime(event_time, '%Y-%m') = '2026-06'
  AND JSONExtractString(payload, 'country') = 'ID';
```

Masalah:

- `SELECT *` membaca semua kolom;
- `formatDateTime` bisa merusak pruning;
- JSON extraction runtime mahal;
- `country` tidak promoted column;
- filter tidak align dengan sorting key;
- result mungkin besar.

Optimized direction:

```sql
SELECT
    toDate(event_time) AS day,
    event_name,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= toDateTime('2026-06-01 00:00:00')
  AND event_time <  toDateTime('2026-07-01 00:00:00')
  AND country = 'ID'
GROUP BY
    day,
    event_name;
```

Lebih baik lagi untuk dashboard sering:

```text
precomputed daily_event_counts table
```

Query optimization bukan hanya rewrite SQL. Kadang jawaban paling benar adalah desain table baru.

---

## 3. Optimization Workflow

Gunakan urutan ini.

### Step 1: Confirm Query Purpose

Pertanyaan:

- Apakah query untuk dashboard, drilldown, export, report, alert, atau ad-hoc?
- SLA berapa?
- Data freshness berapa?
- Result harus exact atau approximate boleh?
- Apakah query sering?

### Step 2: Measure Baseline

Catat:

- duration;
- read_rows;
- read_bytes;
- result_rows;
- memory_usage;
- selected parts/granules;
- distributed shards;
- ProfileEvents penting;
- cold/warm cache jika relevan.

### Step 3: Reduce Data Access

- tambah/benarkan time filter;
- pakai tenant/filter wajib;
- hindari function wrapping pada key;
- pilih kolom spesifik;
- align predicate dengan sorting key;
- gunakan partition pruning;
- pakai projection/skipping index jika benar-benar cocok.

### Step 4: Reduce Intermediate Work

- pre-aggregate sebelum join;
- kurangi group-by cardinality;
- gunakan approximate aggregate;
- hindari sorting raw rows;
- batasi dimensions;
- gunakan rollup.

### Step 5: Reduce Query-Time Repetition

- materialized view;
- serving table;
- projections;
- dictionaries;
- precomputed snapshots.

### Step 6: Reduce Output

- aggregate server-side;
- limit result rows;
- async export;
- avoid raw event synchronous response;
- return only columns needed.

### Step 7: Validate Correctness

Optimasi yang mengubah semantics bukan optimasi. Pastikan metric tetap benar.

---

## 4. Pattern 1 — Avoid `SELECT *`

### 4.1 Problem

`SELECT *` adalah anti-pattern besar di columnar DB.

```sql
SELECT *
FROM logs
WHERE service = 'payment-api'
  AND timestamp >= now() - INTERVAL 1 HOUR
LIMIT 1000;
```

Columnar storage kuat karena bisa membaca hanya kolom yang diperlukan. `SELECT *` membuang keuntungan itu.

### 4.2 Why It Hurts

Membaca semua kolom:

- raw JSON;
- message;
- stack trace;
- payload;
- attributes Map;
- arrays;
- nullable metadata;
- cold columns.

Even with `LIMIT`, engine may still need to evaluate filters and read selected columns for result.

### 4.3 Better

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

### 4.4 API Design

Do not expose API that defaults to all columns.

Better:

```text
summary endpoint:
  selected small columns

detail endpoint:
  fetch by id/time window, includes payload

export endpoint:
  async, explicit column list
```

### 4.5 Checklist

- [ ] Does query select only needed columns?
- [ ] Are large payload/message columns excluded?
- [ ] Are detail columns fetched only after user drills down?
- [ ] Does API whitelist selectable columns?

---

## 5. Pattern 2 — Use Time Range Predicates That Enable Pruning

### 5.1 Bad Predicate

```sql
WHERE formatDateTime(event_time, '%Y-%m') = '2026-06'
```

or:

```sql
WHERE toString(toYYYYMM(event_time)) = '202606'
```

These can make pruning harder.

### 5.2 Good Predicate

```sql
WHERE event_time >= toDateTime('2026-06-01 00:00:00')
  AND event_time <  toDateTime('2026-07-01 00:00:00')
```

### 5.3 If Partitioned by Month

```sql
PARTITION BY toYYYYMM(event_time)
```

This predicate can prune partitions more naturally.

### 5.4 Timezone Discipline

If business date uses local timezone, compute boundaries explicitly.

Example for Jakarta business day:

```sql
WHERE event_time >= toDateTime('2026-06-01 00:00:00', 'Asia/Jakarta')
  AND event_time <  toDateTime('2026-06-02 00:00:00', 'Asia/Jakarta')
```

Avoid unclear conversions in dashboards.

### 5.5 API Rule

Always require bounded time range for raw/high-volume tables.

```text
max range:
  raw events interactive: 7-30 days
  rollups: 1-2 years
  export: async
```

---

## 6. Pattern 3 — Align Filters with Sorting Key Prefix

### 6.1 Sorting Key Example

```sql
ORDER BY (tenant_id, event_type, event_time, case_id)
```

### 6.2 Good Query

```sql
WHERE tenant_id = 10
  AND event_type = 'CASE_OPENED'
  AND event_time >= ...
```

This uses prefix effectively.

### 6.3 Weaker Query

```sql
WHERE case_id = '...'
```

Because `case_id` is late in sorting key, data skipping may be weak unless other prefix filters are provided.

### 6.4 Better for Case Drilldown

Include tenant and time if possible:

```sql
WHERE tenant_id = 10
  AND event_time >= toDateTime('2026-01-01')
  AND event_time <  toDateTime('2026-07-01')
  AND case_id = '...'
```

Or create a separate table/projection sorted by:

```sql
ORDER BY (tenant_id, case_id, event_time)
```

if case drilldown is frequent.

### 6.5 Rule

Design query API around physical access paths.

Expose “fast filters” clearly:

```text
tenant_id required
time range required
event_type recommended
case_id drilldown uses special table/projection
```

---

## 7. Pattern 4 — Avoid Function Wrapping on Key Columns

### 7.1 Bad

```sql
WHERE toDate(event_time) = today()
```

May still be optimized in some cases, but safer and clearer:

```sql
WHERE event_time >= today()
  AND event_time < today() + 1
```

### 7.2 Bad

```sql
WHERE lower(country) = 'id'
```

Better normalize data at ingestion:

```sql
country = 'ID'
```

### 7.3 Bad

```sql
WHERE JSONExtractString(payload, 'event_type') = 'CASE_OPENED'
```

Better promote hot field:

```sql
event_type = 'CASE_OPENED'
```

### 7.4 Bad

```sql
WHERE substring(route, 1, 4) = '/api'
```

Better materialized column:

```sql
route_group LowCardinality(String) MATERIALIZED ...
```

or ingestion-time classification.

### 7.5 Principle

If a function is used frequently in filters/grouping, consider:

- materialized column;
- normalized ingestion field;
- dictionary mapping;
- projection;
- rollup table.

---

## 8. Pattern 5 — Use `PREWHERE` Intentionally

### 8.1 What Is PREWHERE?

`PREWHERE` allows ClickHouse to read filter columns first and then read remaining columns only for rows that pass early filtering.

ClickHouse may automatically move suitable conditions to `PREWHERE`, but explicit `PREWHERE` can help in some cases.

### 8.2 Example

```sql
SELECT
    timestamp,
    message,
    stack_trace
FROM logs
PREWHERE service = 'payment-api'
    AND timestamp >= now() - INTERVAL 1 HOUR
WHERE level = 'ERROR';
```

Idea:

```text
read small selective columns first
then read large message/stack_trace only for matching rows
```

### 8.3 Good Use Cases

- table has large columns;
- filter column is small/selective;
- result needs large columns only after filter;
- logs/traces/payload-heavy tables.

### 8.4 Caution

Do not cargo-cult `PREWHERE`.

Measure:

```sql
EXPLAIN PIPELINE
EXPLAIN indexes = 1
system.query_log read_bytes
```

### 8.5 API Design

For log search/detail endpoints, ensure query first filters by:

- service;
- time;
- level;
- trace_id/request_id;
- tenant.

Then fetch payload/message.

---

## 9. Pattern 6 — Promote Hot JSON Fields

### 9.1 Problem

Runtime JSON extraction is expensive:

```sql
SELECT
    JSONExtractString(payload, 'country') AS country,
    count()
FROM events
GROUP BY country;
```

Problems:

- reads full JSON payload;
- parses JSON at query time;
- no good compression per field;
- cannot use sort key/index effectively;
- high CPU.

### 9.2 Better

Promote field:

```sql
CREATE TABLE events
(
    event_time DateTime64(3),
    tenant_id UInt64,
    event_name LowCardinality(String),
    country LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_name, event_time);
```

Query:

```sql
SELECT
    country,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY country;
```

### 9.3 Materialized Column

```sql
country LowCardinality(String)
    MATERIALIZED JSONExtractString(payload, 'country')
```

Useful when raw payload arrives but hot field must be columnar.

### 9.4 Rule

Promote fields used in:

- filters;
- group by;
- joins;
- sorting;
- dashboards;
- access control;
- retention;
- tenant isolation.

Leave long-tail rarely-used attributes in JSON/Map if needed.

---

## 10. Pattern 7 — Reduce Group-By Cardinality

### 10.1 Problem

```sql
SELECT
    user_id,
    session_id,
    trace_id,
    count()
FROM events
WHERE event_time >= now() - INTERVAL 30 DAY
GROUP BY
    user_id,
    session_id,
    trace_id;
```

This creates huge aggregation state.

### 10.2 Ask Metric Question

Do you need exact breakdown by all these dimensions interactively?

Often no.

### 10.3 Fix Options

#### Reduce dimensions

```sql
GROUP BY user_id
```

or:

```sql
GROUP BY toDate(event_time), event_name
```

#### Pre-aggregate

```text
daily_user_activity
```

#### Use Top-N

```sql
ORDER BY count() DESC
LIMIT 100
```

But remember aggregation still processes all groups unless using special strategy/precompute.

#### Approximate

Use approximate distinct/topK if acceptable.

#### Async export

If user needs full high-cardinality data, make it an export job.

### 10.4 API Guardrail

Classify dimensions by cardinality:

```text
low: country, severity, status
medium: route, product_category
high: user_id, session_id, trace_id, request_id
```

Disallow many high-cardinality dimensions in synchronous query.

---

## 11. Pattern 8 — Aggregate Before Join

### 11.1 Bad

```sql
SELECT
    u.country,
    count()
FROM events e
LEFT JOIN users_current u ON e.user_id = u.user_id
WHERE e.event_time >= now() - INTERVAL 30 DAY
GROUP BY u.country;
```

Joins all event rows.

### 11.2 Better

If semantics allow:

```sql
WITH event_counts AS
(
    SELECT
        user_id,
        count() AS c
    FROM events
    WHERE event_time >= now() - INTERVAL 30 DAY
    GROUP BY user_id
)
SELECT
    u.country,
    sum(c)
FROM event_counts e
LEFT JOIN users_current u ON e.user_id = u.user_id
GROUP BY u.country;
```

Rows before join reduced from event-level to user-level.

### 11.3 Caveat

This is correct for event count by user's current country.

It may be wrong if:

- country should be country at event time;
- user can have multiple countries;
- metric is distinct by event dimension;
- join is many-to-many.

### 11.4 Better Still

If country is hot and event-time semantics matter:

```text
denormalize country into events
```

---

## 12. Pattern 9 — Reduce Right Side of Join

### 12.1 Bad

```sql
SELECT ...
FROM events e
LEFT JOIN users u ON e.user_id = u.user_id;
```

where `users` has many columns and duplicate versions.

### 12.2 Better

```sql
SELECT ...
FROM events e
LEFT JOIN
(
    SELECT
        user_id,
        argMax(country, version) AS country,
        argMax(plan, version) AS plan
    FROM users
    GROUP BY user_id
) u
ON e.user_id = u.user_id;
```

### 12.3 Better as Current Snapshot

```sql
CREATE TABLE users_current
(
    user_id UInt64,
    country LowCardinality(String),
    plan LowCardinality(String),
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY user_id;
```

### 12.4 Better as Dictionary

If lookup-like:

```sql
dictGet('user_dict', 'country', user_id)
```

### 12.5 Rule

Right side should be:

- minimal columns;
- filtered;
- unique by join key if possible;
- small enough;
- current/historical semantics explicit.

---

## 13. Pattern 10 — Prefer Denormalization for Hot Dimensions

### 13.1 Runtime Join

```sql
events JOIN user_dim
```

for every dashboard can be wasteful.

### 13.2 Denormalized Event Table

```sql
CREATE TABLE product_events
(
    tenant_id UInt64,
    event_time DateTime64(3),
    event_name LowCardinality(String),
    user_id UInt64,
    country LowCardinality(String),
    plan LowCardinality(String),
    device_type LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_name, event_time, user_id);
```

### 13.3 Good For

- country;
- plan at event time;
- device type;
- jurisdiction;
- severity at event time;
- service;
- environment;
- route group;
- event category.

### 13.4 Not Good For

- high-volume mutable PII;
- rarely used labels;
- display names;
- rapidly changing fields where current-state semantics needed;
- many-to-many dimensions unless modeled explicitly.

### 13.5 Principle

If dimension is frequently filtered/grouped and event-time correctness matters, denormalize.

---

## 14. Pattern 11 — Use Approximate Aggregates When Product Allows

### 14.1 Exact Distinct

```sql
uniqExact(user_id)
```

Can be very memory-heavy for large cardinality.

### 14.2 Approximate Distinct

```sql
uniq(user_id)
```

or other approximate distinct functions depending requirement.

### 14.3 Product Question

Is dashboard allowed to show:

```text
~1.2M users
```

instead of exact?

For many product/observability dashboards, approximate is fine.

For billing/regulatory official reports, exact may be required.

### 14.4 Quantiles

Exact quantile can be expensive.

Approximate quantile is often acceptable for latency dashboards:

```sql
quantile(0.95)(latency_ms)
```

For audit/billing use cases, define correctness requirement carefully.

### 14.5 Rule

Optimization must be product-aware.

Do not replace exact with approximate without explicit business acceptance.

---

## 15. Pattern 12 — Use Rollups for Repeated Dashboards

### 15.1 Raw Dashboard Query

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    event_name,
    count()
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 30 DAY
GROUP BY hour, event_name;
```

If frequent, raw scan repeats same work.

### 15.2 Rollup Table

```sql
CREATE TABLE hourly_event_counts
(
    tenant_id UInt64,
    hour DateTime,
    event_name LowCardinality(String),
    count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, hour, event_name);
```

### 15.3 Query

```sql
SELECT
    hour,
    event_name,
    sum(count) AS count
FROM hourly_event_counts
WHERE tenant_id = 10
  AND hour >= now() - INTERVAL 30 DAY
GROUP BY hour, event_name;
```

### 15.4 Benefits

- fewer rows;
- fewer bytes;
- smaller aggregation;
- predictable latency;
- lower cost;
- easier concurrency.

### 15.5 Risks

- freshness lag;
- late events;
- rebuild complexity;
- metric semantics;
- materialized view write amplification.

### 15.6 Rule

If dashboard query is frequent and raw scan is large, create serving table.

---

## 16. Pattern 13 — Use AggregatingMergeTree for Non-Additive Rollups

### 16.1 DAU Problem

Daily active users:

```sql
uniq(user_id)
```

cannot always be rolled up by summing daily unique counts.

If user active on multiple days:

```text
daily unique sum != weekly unique
```

### 16.2 Aggregate State

```sql
CREATE TABLE daily_active_users
(
    tenant_id UInt64,
    day Date,
    country LowCardinality(String),
    users AggregateFunction(uniq, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, country);
```

Insert:

```sql
SELECT
    tenant_id,
    toDate(event_time) AS day,
    country,
    uniqState(user_id) AS users
FROM events
GROUP BY
    tenant_id,
    day,
    country;
```

Query:

```sql
SELECT
    country,
    uniqMerge(users) AS users
FROM daily_active_users
WHERE tenant_id = 10
  AND day >= today() - 30
GROUP BY country;
```

### 16.3 Rule

Use aggregate states when metric must be merged correctly across time/dimensions.

---

## 17. Pattern 14 — Use Projections for Alternate Access Path

### 17.1 Problem

Main table optimized for dashboard:

```sql
ORDER BY (tenant_id, event_name, event_time, user_id)
```

But frequent query by `case_id`:

```sql
WHERE tenant_id = 10
  AND case_id = '...'
```

### 17.2 Projection

Projection can store alternate physical layout.

Concept:

```sql
ALTER TABLE case_events
ADD PROJECTION by_case
(
    SELECT *
    ORDER BY (tenant_id, case_id, event_time)
);
```

Then materialize projection depending existing data.

### 17.3 When It Helps

- query shape frequent;
- alternate sorting key useful;
- same base table;
- not too many projections;
- storage overhead acceptable.

### 17.4 When MV Is Better

Use materialized view if:

- transformation changes shape;
- target table needs different TTL;
- different columns;
- different aggregation;
- independent serving lifecycle.

### 17.5 Rule

Projection is physical optimization. MV is semantic/serving model.

---

## 18. Pattern 15 — Use Skipping Indexes Selectively

### 18.1 Good Candidate

Column:

- used in selective filter;
- not in primary key;
- values are clustered/correlated within granules;
- index type matches predicate.

Example trace ID lookup in logs:

```sql
INDEX idx_trace_id trace_id TYPE bloom_filter GRANULARITY 4
```

### 18.2 Bad Candidate

Column:

- random values spread everywhere;
- low selectivity;
- high update/mutation table;
- predicate not common;
- index too expensive.

### 18.3 Verify

```sql
EXPLAIN indexes = 1
SELECT ...
```

Do not assume index is used.

### 18.4 Rule

Skipping index does not replace correct sorting key.

---

## 19. Pattern 16 — Avoid `FINAL` in Large Interactive Queries

### 19.1 Problem

```sql
SELECT *
FROM case_current_state FINAL
WHERE tenant_id = 10;
```

On large table, expensive.

### 19.2 Alternative

Use `argMax`:

```sql
SELECT
    case_id,
    argMax(status, version) AS status,
    argMax(assignee_user_id, version) AS assignee_user_id
FROM case_current_state
WHERE tenant_id = 10
GROUP BY case_id;
```

Or maintain current compact serving table.

### 19.3 When FINAL Is Okay

- small table;
- highly selective key lookup;
- admin/debug;
- batch job;
- benchmarked.

### 19.4 API Rule

Do not let query builder add `FINAL` automatically without dataset-specific policy.

---

## 20. Pattern 17 — Optimize Top-N

### 20.1 Expensive Query

```sql
SELECT
    user_id,
    count() AS events
FROM events
WHERE tenant_id = 10
  AND event_time >= now() - INTERVAL 180 DAY
GROUP BY user_id
ORDER BY events DESC
LIMIT 100;
```

This still groups all users.

### 20.2 Options

- pre-aggregate daily user counts;
- maintain top-N table;
- restrict time;
- approximate heavy hitters;
- async job;
- sample if acceptable;
- use rollup by relevant grain.

### 20.3 Top-N Serving Table

```sql
CREATE TABLE daily_top_users
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

Still may require aggregation across users, but raw event scan reduced.

For fixed dashboard, precompute top-N per tenant/day/segment.

### 20.4 Rule

`LIMIT 100` after `GROUP BY` does not mean query only processes 100 groups.

---

## 21. Pattern 18 — Optimize Pagination

### 21.1 Offset Pagination Problem

```sql
ORDER BY event_time DESC
LIMIT 100 OFFSET 1000000;
```

Can be expensive because engine still processes preceding rows.

### 21.2 Keyset Pagination

Use cursor:

```sql
WHERE tenant_id = 10
  AND event_time < toDateTime64('2026-06-21 10:00:00', 3)
ORDER BY event_time DESC
LIMIT 100;
```

Better if sorting key supports it.

### 21.3 Compound Cursor

If timestamp not unique:

```sql
WHERE
    tenant_id = 10
    AND (
        event_time < cursor_event_time
        OR (event_time = cursor_event_time AND event_id < cursor_event_id)
    )
ORDER BY event_time DESC, event_id DESC
LIMIT 100;
```

### 21.4 For Analytics

Often better than pagination:

- aggregate;
- top-N;
- drilldown;
- async export.

Raw pagination over huge result sets is often product smell.

---

## 22. Pattern 19 — Use Async Export for Large Results

### 22.1 Bad API

```http
GET /events/export?from=2021-01-01&to=2026-01-01
```

returns CSV synchronously.

Problems:

- long query;
- huge result;
- memory/network;
- client timeout;
- retry duplicates work;
- frontend unstable.

### 22.2 Better

```text
POST /exports
→ create job
→ run ClickHouse query async
→ write result to object storage
→ notify user
→ download link
```

### 22.3 Query Design

Use:

```sql
SELECT ...
FROM events
WHERE tenant_id = 10
  AND event_time >= ...
  AND event_time < ...
INTO OUTFILE / object storage pattern
```

depending environment/tooling.

### 22.4 API Guardrail

If estimated result rows > threshold:

```text
switch to async export
```

---

## 23. Pattern 20 — Separate Hot and Cold Columns

### 23.1 Problem

Table has many wide columns:

- payload;
- raw_json;
- stack_trace;
- comments;
- evidence_text;
- metadata map.

Most dashboard queries only need:

- time;
- tenant;
- event type;
- status;
- severity;
- count.

### 23.2 Option A: Column Selection

Always select only needed columns.

### 23.3 Option B: Split Table

Hot table:

```sql
case_events_hot
(
    tenant_id,
    case_id,
    event_time,
    event_type,
    jurisdiction,
    severity
)
```

Cold/detail table:

```sql
case_events_detail
(
    tenant_id,
    event_id,
    raw_payload,
    evidence_text,
    metadata
)
```

Join/fetch detail only on drilldown by event_id.

### 23.4 Trade-Off

Pros:

- dashboard scans smaller table;
- better compression;
- lower memory/network.

Cons:

- extra ingestion complexity;
- drilldown requires lookup;
- consistency across tables.

### 23.5 Rule

If cold columns dominate storage and are rarely used, split or isolate them.

---

## 24. Pattern 21 — Use Materialized Columns for Frequent Expressions

### 24.1 Problem

Query repeatedly computes:

```sql
toStartOfHour(event_time)
JSONExtractString(payload, 'route_group')
multiIf(status_code >= 500, '5xx', ...)
```

### 24.2 Materialized Column

```sql
event_hour DateTime MATERIALIZED toStartOfHour(event_time)
```

```sql
status_class LowCardinality(String)
MATERIALIZED multiIf(
    status_code >= 500, '5xx',
    status_code >= 400, '4xx',
    status_code >= 300, '3xx',
    status_code >= 200, '2xx',
    'other'
)
```

### 24.3 Benefits

- computed once at insert;
- query simpler;
- can be part of sorting key/projection;
- improves consistency.

### 24.4 Risks

- schema evolution;
- insert cost;
- expression bug requires backfill;
- materialized column stores additional data.

### 24.5 Rule

Materialize expression if it is:

- frequent;
- stable;
- used in filters/group by;
- expensive at query time.

---

## 25. Pattern 22 — Control Distributed Fan-In

### 25.1 Problem

Distributed query:

```sql
SELECT
    user_id,
    count()
FROM events
GROUP BY user_id;
```

Each shard returns many partial groups. Coordinator merges huge state.

### 25.2 Fix Options

- pre-aggregate per shard;
- reduce group cardinality;
- add tenant/time filters;
- use rollup table;
- run as async export;
- use approximate/topK;
- isolate compute group;
- tune distributed aggregation settings only after model fixes.

### 25.3 Measure

Use:

```sql
system.query_thread_log
```

across cluster to find slowest shard and data transfer.

### 25.4 API Rule

Do not allow global high-cardinality group-by across long range in synchronous endpoint.

---

## 26. Pattern 23 — Optimize Distinct Count

### 26.1 Exact

```sql
uniqExact(user_id)
```

Use when exactness required.

### 26.2 Approximate

```sql
uniq(user_id)
```

or other functions depending requirement.

### 26.3 Rollup State

```sql
uniqState(user_id)
```

stored in `AggregatingMergeTree`.

### 26.4 Important Semantics

Do not sum unique counts across buckets unless buckets are disjoint and that is the intended metric.

### 26.5 Example

Wrong for monthly users:

```sql
sum(daily_unique_users)
```

if users can appear multiple days.

Right:

```sql
uniqMerge(users_state)
```

if states are stored.

---

## 27. Pattern 24 — Optimize Percentiles

### 27.1 Raw Percentile

```sql
quantile(0.95)(latency_ms)
```

over raw logs every dashboard refresh can be expensive.

### 27.2 Rollup State

```sql
quantileState(0.95)(latency_ms)
```

in `AggregatingMergeTree`.

Query:

```sql
quantileMerge(0.95)(latency_state)
```

### 27.3 Exact vs Approx

Exact percentiles are expensive. Observability usually accepts approximate.

Billing/legal/regulatory may not.

### 27.4 Avoid Average-Only Latency

Average hides tail latency.

For service dashboards, use:

- p50;
- p95;
- p99;
- error rate;
- count.

---

## 28. Pattern 25 — Use Sampling Carefully

ClickHouse supports sampling if table designed with sampling expression.

### 28.1 Use Case

- exploratory analytics;
- approximate trends;
- high-volume product analytics;
- quick estimates.

### 28.2 Not For

- billing;
- compliance;
- official reports;
- small datasets;
- high skew without careful design.

### 28.3 Rule

Sampling must be part of table design and product semantics.

Do not randomly add sample logic and call it correct.

---

## 29. Pattern 26 — Minimize Nullable and Dynamic Types in Hot Paths

### 29.1 Problem

`Nullable` adds extra null map and can hurt performance/compression.

Dynamic/semi-structured fields can require runtime interpretation.

### 29.2 Better

Use defaults where business-correct:

```sql
country LowCardinality(String) DEFAULT 'UNKNOWN'
```

instead of:

```sql
country Nullable(String)
```

when unknown is meaningful and simpler.

### 29.3 Caution

Do not replace null with fake value if null has distinct semantics.

### 29.4 Hot Path Rule

For high-volume filter/group-by columns:

- avoid unnecessary Nullable;
- use proper type;
- use LowCardinality when appropriate;
- normalize values at ingestion.

---

## 30. Pattern 27 — Optimize Insert-Time vs Query-Time Trade-Off

### 30.1 Query-Time Computation

Pros:

- flexible;
- simpler ingestion;
- no precompute storage.

Cons:

- repeated work;
- dashboard slow;
- CPU expensive;
- inconsistent expressions.

### 30.2 Insert-Time Computation

Pros:

- fast query;
- consistent derived fields;
- can sort/index/rollup;
- lower query CPU.

Cons:

- ingestion overhead;
- schema migration;
- backfill required on logic changes;
- storage overhead.

### 30.3 Decision

Move computation to ingestion if:

- expression stable;
- used frequently;
- query latency matters;
- computation expensive;
- backfill manageable.

Keep query-time if:

- rare ad-hoc;
- logic changes often;
- low data volume;
- product experimentation.

---

## 31. Pattern 28 — Use Separate Tables for Different Query Shapes

### 31.1 Problem

One table cannot be perfectly sorted for all query shapes.

Example query shapes:

1. dashboard by tenant/event/time;
2. drilldown by case_id;
3. lookup by trace_id;
4. export by ingest_batch_id;
5. current state by entity_id.

### 31.2 Options

- one raw table;
- projections;
- materialized views;
- duplicate serving table;
- dictionary;
- external search index.

### 31.3 Example

```text
case_events_raw:
  ORDER BY (tenant_id, event_type, event_time, case_id)

case_events_by_case:
  ORDER BY (tenant_id, case_id, event_time)

case_current_state:
  ORDER BY (tenant_id, case_id)

daily_case_rollup:
  ORDER BY (tenant_id, day, jurisdiction, severity)
```

### 31.4 Rule

A new table is justified when:

- query is frequent;
- SLA matters;
- physical access path differs;
- storage/write amplification acceptable;
- lifecycle/backfill understood.

---

## 32. Pattern 29 — Avoid Overusing Settings as First Fix

ClickHouse has many settings:

- memory limits;
- max threads;
- max bytes before external group by;
- join algorithm;
- distributed settings;
- max execution time;
- result limits.

Settings are useful.

But they cannot fix a fundamentally bad query shape.

### 32.1 Bad Order

```text
query slow
→ increase max_memory_usage
→ cluster OOM later
```

### 32.2 Better Order

```text
query slow
→ inspect read/memory
→ reduce scan/cardinality/join
→ use rollup
→ set safe memory/time limits
```

### 32.3 Settings As Guardrails

Use settings to protect cluster:

- max execution time;
- max result rows;
- max memory usage;
- readonly profiles for BI;
- query complexity limits.

Not as substitute for modeling.

---

## 33. Pattern 30 — Optimize for Query Family, Not Individual Query

### 33.1 Query Family

Examples:

```text
case backlog dashboard
case lifecycle trend
case drilldown
officer workload report
product event trend
API latency percentile dashboard
raw log search
export job
```

### 33.2 Why It Matters

A one-off query may be optimized by rewrite.

A frequent query family deserves:

- serving table;
- materialized view;
- projection;
- API guardrails;
- dedicated endpoint;
- cached response;
- SLA monitoring.

### 33.3 Metadata Model

Java query layer can maintain:

```json
{
  "queryFamily": "case_lifecycle_trend",
  "sourceTable": "daily_case_rollup",
  "requiredFilters": ["tenant_id", "date_range"],
  "allowedDimensions": ["jurisdiction", "severity", "case_type"],
  "maxRangeDays": 730,
  "approxAllowed": false,
  "executionMode": "sync"
}
```

### 33.4 Rule

Optimize products, not isolated SQL strings.

---

## 34. End-to-End Example: Case Lifecycle Dashboard

### 34.1 Initial Query

```sql
SELECT
    toDate(event_time) AS day,
    jurisdiction,
    severity_at_event,
    countDistinct(case_id) AS opened_cases
FROM case_events
WHERE tenant_id = 10
  AND event_type = 'CASE_OPENED'
  AND event_time >= now() - INTERVAL 365 DAY
GROUP BY
    day,
    jurisdiction,
    severity_at_event
ORDER BY day;
```

### 34.2 Diagnosis

Possible metrics:

```text
read_rows: 3B
read_bytes: 120GB
result_rows: 2,000
duration: 18s
memory: 4GB
```

### 34.3 Query-Level Fixes

- ensure time predicate is range;
- ensure tenant/event_type align with sorting key;
- select only needed columns;
- use approximate distinct only if accepted;
- ensure event_type LowCardinality/promoted.

### 34.4 Physical Design Fix

Sorting key:

```sql
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id)
```

if this query family is primary.

### 34.5 Serving Table

For frequent dashboard:

```sql
CREATE TABLE daily_case_opened_rollup
(
    tenant_id UInt64,
    day Date,
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    cases AggregateFunction(uniq, UUID)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, jurisdiction, severity);
```

Query:

```sql
SELECT
    day,
    jurisdiction,
    severity,
    uniqMerge(cases) AS opened_cases
FROM daily_case_opened_rollup
WHERE tenant_id = 10
  AND day >= today() - 365
GROUP BY
    day,
    jurisdiction,
    severity
ORDER BY day;
```

### 34.6 API Guardrail

Endpoint uses rollup by default. Raw scan only for admin/debug/offline.

---

## 35. End-to-End Example: Observability Latency Dashboard

### 35.1 Raw Query

```sql
SELECT
    toStartOfMinute(timestamp) AS minute,
    route,
    quantile(0.95)(latency_ms) AS p95,
    count() AS requests
FROM logs
WHERE service = 'payment-api'
  AND environment = 'prod'
  AND timestamp >= now() - INTERVAL 6 HOUR
GROUP BY
    minute,
    route
ORDER BY minute;
```

### 35.2 Optimizations

- sorting key includes `(service, environment, timestamp)`;
- route is LowCardinality;
- no `SELECT *`;
- time range bounded;
- route cardinality controlled;
- use rollup for frequent dashboards.

### 35.3 Rollup

```sql
CREATE TABLE api_latency_1m
(
    service LowCardinality(String),
    environment LowCardinality(String),
    minute DateTime,
    route LowCardinality(String),
    requests SimpleAggregateFunction(sum, UInt64),
    p95_state AggregateFunction(quantile(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (service, environment, minute, route);
```

### 35.4 Query

```sql
SELECT
    minute,
    route,
    sum(requests) AS requests,
    quantileMerge(0.95)(p95_state) AS p95
FROM api_latency_1m
WHERE service = 'payment-api'
  AND environment = 'prod'
  AND minute >= now() - INTERVAL 6 HOUR
GROUP BY
    minute,
    route
ORDER BY minute;
```

---

## 36. Benchmarking Before/After

### 36.1 Capture Baseline

```text
query duration
read_rows
read_bytes
result_rows
memory
selected parts/granules
cold/warm cache
concurrency
```

### 36.2 Run Candidate

Change one major variable at a time if possible:

- predicate rewrite;
- column selection;
- rollup;
- projection;
- skipping index;
- query guardrail.

### 36.3 Validate Correctness

Compare result:

```sql
raw query
EXCEPT/compare
optimized query
```

or aggregate totals/checksums.

### 36.4 Test Concurrency

A query that is fast alone may fail under dashboard concurrency.

Test:

- 1 user;
- 10 concurrent;
- 100 concurrent if relevant;
- mixed workload.

### 36.5 Test Data Growth

Ask:

```text
Will this still work at 10x data?
```

---

## 37. Optimization Decision Matrix

| Symptom | Likely Fix |
|---|---|
| high read_bytes | select fewer columns, promote filters, sort key, projection |
| high read_rows | better predicate, sort key, partition pruning, rollup |
| high memory group by | reduce dimensions, approximate, pre-aggregate, rollup |
| high memory join | reduce right side, dictionary, denormalize, pre-join |
| slow sort | sort after aggregation, projection, top-N table |
| huge result | async export, limit, aggregate, pagination |
| stale dashboard | MV/rollup freshness, replica lag, watermark |
| repeated raw scan | materialized view/serving table |
| point lookup slow | alternate table/projection/skipping index |
| high-cardinality global query | async/offline, topK, rollup, guardrail |
| too many parts | batch inserts, reduce partitions, ingestion fix |
| expensive JSON filter | promote/materialize field |
| `FINAL` slow | argMax/current table/avoid FINAL |
| distributed coordinator OOM | reduce fan-in, pre-aggregate, shard-aware design |

---

## 38. Production Checklist

### Query

- [ ] No `SELECT *` on high-volume table.
- [ ] Time range bounded.
- [ ] Tenant/account/service filter present when applicable.
- [ ] Predicates do not unnecessarily wrap key columns.
- [ ] Filters align with sorting key where possible.
- [ ] Result rows bounded.
- [ ] Group-by dimensions cardinality reviewed.
- [ ] Join right side reduced.
- [ ] `FINAL` policy explicit.
- [ ] `EXPLAIN indexes = 1` checked for key queries.

### Table

- [ ] Sorting key matches main query family.
- [ ] Partition key supports lifecycle.
- [ ] Hot JSON fields promoted.
- [ ] Large cold columns isolated or excluded.
- [ ] Rollups exist for repeated dashboards.
- [ ] Aggregate states used for non-additive rollups.
- [ ] Projections/skipping indexes measured before adoption.

### API

- [ ] Query family metadata exists.
- [ ] Required filters enforced.
- [ ] Max time range enforced.
- [ ] High-cardinality group-by guarded.
- [ ] Export is async.
- [ ] Query ID propagated.
- [ ] Timeout/memory limits set.
- [ ] Approximate metrics labeled/approved.

### Validation

- [ ] Before/after metrics captured.
- [ ] Correctness checked.
- [ ] Concurrent test run.
- [ ] Cold/warm cache behavior known.
- [ ] Regression monitoring added.

---

## 39. Exercises

### Exercise 1: Rewrite Bad Predicate

Bad:

```sql
WHERE formatDateTime(event_time, '%Y-%m-%d') = '2026-06-21'
```

Rewrite it.

Expected:

```sql
WHERE event_time >= toDateTime('2026-06-21 00:00:00')
  AND event_time <  toDateTime('2026-06-22 00:00:00')
```

### Exercise 2: Optimize JSON Filter

Query filters by:

```sql
JSONExtractString(payload, 'country') = 'ID'
```

and runs every dashboard refresh.

What should you do?

Expected:

- promote `country` column;
- LowCardinality;
- maybe materialized column;
- include in sort/projection if access path important.

### Exercise 3: High Cardinality Dashboard

Query groups by `user_id, session_id` over 90 days.

What are options?

Expected:

- disallow synchronous;
- reduce dimensions;
- pre-aggregate;
- top-N;
- async export;
- query family guardrails.

### Exercise 4: Join Optimization

Query joins events to user dimension for country.

What options?

Expected:

- denormalize country if hot/event-time;
- dictionary if current lookup;
- reduce right side;
- current snapshot;
- pre-aggregate before join if semantics allow.

### Exercise 5: Slow `FINAL`

Current state dashboard uses:

```sql
FROM case_current_state FINAL
```

over millions of cases.

What alternatives?

Expected:

- `argMax` by version;
- compact serving table;
- smaller filtered query;
- background compaction strategy;
- avoid automatic FINAL.

---

## 40. Summary

Query optimization in ClickHouse is primarily about removing work.

Core principles:

1. Read fewer columns.
2. Read fewer rows.
3. Align predicates with partition and sorting key.
4. Avoid runtime functions on hot filter fields.
5. Promote hot JSON/dynamic fields.
6. Reduce group-by cardinality.
7. Aggregate before join when semantics allow.
8. Denormalize hot dimensions.
9. Use dictionaries for lookup-like enrichment.
10. Use rollups/materialized views for repeated dashboards.
11. Use `AggregatingMergeTree` for mergeable non-additive metrics.
12. Avoid uncontrolled `FINAL`.
13. Treat large exports as async jobs.
14. Build query API guardrails.
15. Validate with before/after metrics.

Practical sentence:

> The fastest ClickHouse query is the one that does not read, parse, join, aggregate, sort, or return data it does not need.

---

## 41. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang kamu pakai:

1. ClickHouse Docs — Query optimization.
2. ClickHouse Docs — EXPLAIN.
3. ClickHouse Docs — Primary indexes.
4. ClickHouse Docs — Choosing a primary key.
5. ClickHouse Docs — PREWHERE.
6. ClickHouse Docs — Data skipping indexes.
7. ClickHouse Docs — Projections.
8. ClickHouse Docs — Materialized views.
9. ClickHouse Docs — AggregatingMergeTree.
10. ClickHouse Docs — Aggregate function combinators.
11. ClickHouse Docs — JOIN optimization.
12. ClickHouse Docs — Dictionaries.
13. ClickHouse Docs — ReplacingMergeTree and FINAL.
14. ClickHouse Docs — system.query_log.
15. ClickHouse Docs — Performance best practices.

---

## 42. Status Seri

Part ini adalah:

```text
Part 024 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 025 — Performance Engineering III: CPU, Memory, Disk, Network, and Concurrency
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Performance Engineering I: Reading EXPLAIN, Query Logs, and System Tables</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-025.md">Part 025 — Performance Engineering III: CPU, Memory, Disk, Network, and Concurrency ➡️</a>
</div>

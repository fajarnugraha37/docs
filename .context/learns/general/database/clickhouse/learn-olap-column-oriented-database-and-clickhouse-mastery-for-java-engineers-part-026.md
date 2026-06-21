# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-026.md

# Part 026 — Data Modeling Patterns: Events, Metrics, Logs, Traces, Audits, and Case Lifecycles

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **026 / 034**  
> Fokus: menerapkan seluruh fondasi ClickHouse ke pola data nyata: event analytics, metrics, logs, traces, audit trails, CDC, snapshots, aggregates, dan case lifecycle analytics.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 025, kita sudah punya bekal besar:

- OLAP mental model.
- Columnar storage.
- MergeTree internals.
- Sorting key.
- Partitioning.
- Compression.
- Ingestion architecture.
- Query execution.
- Aggregation.
- Materialized views.
- Projections.
- Joins/dictionaries/denormalization.
- Table engines.
- Updates/deletes/deduplication.
- Distributed ClickHouse.
- Cloud-native ClickHouse.
- Performance engineering.

Sekarang kita masuk ke pertanyaan paling praktis:

> “Kalau saya punya data nyata, bentuk tabel ClickHouse-nya sebaiknya seperti apa?”

Data modeling di ClickHouse bukan sekadar memilih kolom.

Data modeling berarti memilih:

```text
grain
event time
identity
dimensions
measures
sort key
partition key
engine
retention
dedup strategy
late-event strategy
query family
serving table
backfill story
correctness semantics
```

Part ini mengubah konsep menjadi pattern.

Kita akan membahas:

- event fact table;
- metric/time-series table;
- logs table;
- traces/spans table;
- audit event table;
- CDC raw and current snapshot;
- lifecycle state table;
- periodic snapshot table;
- aggregate/rollup table;
- top-N table;
- search/drilldown table;
- regulatory case lifecycle model;
- Java domain/event design implications.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. memilih grain yang benar untuk table analytics;
2. membedakan event, fact, state, snapshot, metric, log, trace, audit, and report snapshot;
3. mendesain table ClickHouse untuk event analytics;
4. mendesain table untuk metrics/time-series;
5. mendesain table untuk logs and observability;
6. mendesain table untuk distributed traces/spans;
7. mendesain immutable audit trails;
8. mendesain CDC raw table and current snapshot table;
9. mendesain lifecycle analytics untuk domain seperti case/regulatory workflows;
10. memilih sorting key/partition key berdasarkan query family;
11. menentukan kapan perlu denormalization, dictionary, MV, projection, and serving table;
12. menghindari anti-pattern seperti OLTP schema mirroring, JSON-only analytics, all-string columns, and current-state confusion.

---

## 2. Mental Model Utama: Model Data Dari Query, Bukan Dari ERD OLTP

Di OLTP, kita sering mulai dari entity relationship:

```text
users
orders
order_items
products
payments
shipments
```

Lalu normalized schema.

Di OLAP, kita mulai dari pertanyaan:

```text
Apa yang ingin dihitung?
Pada grain apa?
Dengan dimensi apa?
Dalam rentang waktu apa?
Seberapa fresh?
Seberapa benar secara historis?
Berapa latency yang dibutuhkan?
```

Contoh:

```text
Berapa jumlah case yang dibuka per hari, by jurisdiction and severity?
```

Data model yang baik mungkin bukan:

```text
cases JOIN case_status_history JOIN jurisdictions JOIN severity_table
```

Tetapi:

```text
case_lifecycle_events
  one row per lifecycle event
  severity_at_event denormalized
  jurisdiction denormalized
  event_type = CASE_OPENED
  event_time
```

Dengan rollup:

```text
daily_case_opened_rollup
```

OLAP model tidak harus “beautiful normalized”. Ia harus:

- benar untuk metric;
- cepat untuk query family;
- efisien secara storage;
- dapat di-backfill;
- dapat dijelaskan;
- dapat dioperasikan.

---

## 3. The First Question: What Is the Grain?

Grain adalah “satu row mewakili apa?”

Jika grain tidak jelas, semua metric akan kabur.

### 3.1 Common Grains

| Pattern | One row represents |
|---|---|
| Event table | one event occurrence |
| Fact table | one business fact/transaction |
| Metric table | one measurement at timestamp |
| Log table | one log line/event |
| Span table | one trace span |
| Audit table | one auditable action/change |
| Current snapshot | latest state of one entity |
| Periodic snapshot | state of entity at a period boundary |
| Rollup table | aggregated value/state for bucket+dimensions |
| Report snapshot | immutable generated report result |

### 3.2 Grain Examples

Event grain:

```text
one row = one user click event
```

Metric grain:

```text
one row = one metric sample for service+pod+timestamp
```

Audit grain:

```text
one row = one user/system action that changed or accessed something
```

Case lifecycle grain:

```text
one row = one lifecycle transition or domain event for a case
```

Snapshot grain:

```text
one row = latest state of one case
```

Rollup grain:

```text
one row = aggregate for tenant+day+jurisdiction+severity
```

### 3.3 Grain Checklist

Before creating table:

- [ ] What does one row mean?
- [ ] Can two rows represent same business event?
- [ ] What is the natural identity?
- [ ] What timestamp belongs to row?
- [ ] Is row immutable?
- [ ] Can row be corrected?
- [ ] Is this raw or derived?
- [ ] What query family uses this table?

---

## 4. Pattern 1 — Immutable Event Table

### 4.1 Use Case

Use for:

- product events;
- lifecycle events;
- domain events;
- clickstream;
- transaction events;
- case events;
- workflow events;
- audit-like facts.

### 4.2 Semantics

One row = one event that happened.

Events should be append-only.

If event is wrong, prefer:

- correction event;
- replacement version;
- tombstone;
- rebuild from source.

### 4.3 Generic Schema

```sql
CREATE TABLE domain_events
(
    tenant_id UInt64,
    event_id UUID,
    entity_id UUID,
    entity_type LowCardinality(String),

    event_time DateTime64(3),
    ingest_time DateTime64(3),
    event_type LowCardinality(String),

    actor_id UInt64,
    source_system LowCardinality(String),
    schema_version UInt16,

    -- hot dimensions
    country LowCardinality(String),
    channel LowCardinality(String),
    product LowCardinality(String),

    -- measures
    amount Decimal(18, 2),
    duration_ms UInt32,

    -- long-tail
    attributes Map(String, String),
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, entity_id, event_id);
```

### 4.4 Design Notes

- `tenant_id` first if multi-tenant and most queries tenant-scoped.
- `event_type` early if event-specific analytics common.
- `event_time` early enough for range scan.
- `event_id` for dedup/reconciliation.
- `attributes/raw_payload` should not be queried frequently.
- Promote hot attributes into physical columns.

### 4.5 Query Example

```sql
SELECT
    toDate(event_time) AS day,
    event_type,
    count()
FROM domain_events
WHERE tenant_id = 10
  AND event_time >= today() - 30
GROUP BY
    day,
    event_type
ORDER BY day;
```

### 4.6 Common Anti-Patterns

- no `event_id`;
- no `ingest_time`;
- all data in JSON;
- all columns String;
- no tenant/time filter;
- event_time and business_time confused;
- update old event for every correction.

---

## 5. Pattern 2 — Product Analytics Event Table

### 5.1 Use Case

Track user behavior:

- page view;
- button click;
- signup;
- purchase;
- feature usage;
- session start/end;
- conversion funnel.

### 5.2 Schema

```sql
CREATE TABLE product_events
(
    tenant_id UInt64,
    event_id UUID,
    event_time DateTime64(3),
    ingest_time DateTime64(3),

    user_id UInt64,
    anonymous_id String,
    session_id UUID,

    event_name LowCardinality(String),

    -- hot dimensions
    country LowCardinality(String),
    region LowCardinality(String),
    device_type LowCardinality(String),
    os LowCardinality(String),
    browser LowCardinality(String),
    app_version LowCardinality(String),
    plan LowCardinality(String),
    acquisition_channel LowCardinality(String),

    -- optional measures
    revenue Decimal(18, 2) DEFAULT 0,
    duration_ms UInt32 DEFAULT 0,

    -- flexible attributes
    properties Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_name, event_time, user_id);
```

### 5.3 Why This Sort Key?

Common queries:

```text
tenant + event_name + time range
tenant + time range + group by country/device/plan
funnel per event_name sequence
```

Sorting by `(tenant_id, event_name, event_time, user_id)` makes event-specific scans good.

If user journey drilldown is frequent, consider:

```text
projection/table by (tenant_id, user_id, event_time)
```

### 5.4 Query Families

#### Event Trend

```sql
SELECT
    toDate(event_time) AS day,
    event_name,
    count()
FROM product_events
WHERE tenant_id = 10
  AND event_time >= today() - 30
GROUP BY
    day,
    event_name;
```

#### DAU

```sql
SELECT
    toDate(event_time) AS day,
    uniq(user_id) AS dau
FROM product_events
WHERE tenant_id = 10
  AND event_time >= today() - 30
GROUP BY day;
```

#### Funnel

```text
requires sequence logic by user/session/event_time
```

Often expensive; consider specialized serving tables.

### 5.5 Rollup

For common dashboards:

```sql
CREATE TABLE daily_product_event_rollup
(
    tenant_id UInt64,
    day Date,
    event_name LowCardinality(String),
    country LowCardinality(String),
    device_type LowCardinality(String),
    events SimpleAggregateFunction(sum, UInt64),
    users AggregateFunction(uniq, UInt64),
    revenue SimpleAggregateFunction(sum, Decimal(18, 2))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, event_name, country, device_type);
```

### 5.6 Java Producer Advice

Event ID must be stable:

```text
not UUID.randomUUID() on retry
```

Use:

```text
source event id
or deterministic hash of source fields
```

---

## 6. Pattern 3 — Metrics / Time-Series Table

### 6.1 Use Case

Metrics:

- CPU usage;
- memory usage;
- request count;
- error count;
- latency;
- queue depth;
- business KPI samples;
- sensor readings.

### 6.2 Metrics Are Not Logs

Metrics are usually:

```text
name + labels + timestamp + value
```

High cardinality labels can destroy performance/storage.

### 6.3 Wide vs Narrow Metrics

#### Narrow Format

```text
timestamp, metric_name, labels, value
```

Flexible but may be expensive.

#### Wide Format

```text
timestamp, service, route, request_count, error_count, latency_sum
```

Less flexible but faster for known metrics.

### 6.4 Narrow Schema

```sql
CREATE TABLE metrics
(
    timestamp DateTime64(3),
    metric_name LowCardinality(String),

    service LowCardinality(String),
    environment LowCardinality(String),
    region LowCardinality(String),
    host String,

    labels Map(String, String),

    value Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (metric_name, service, environment, timestamp);
```

### 6.5 Better for Controlled Service Metrics

```sql
CREATE TABLE api_metrics_raw
(
    timestamp DateTime64(3),
    service LowCardinality(String),
    environment LowCardinality(String),
    route LowCardinality(String),
    status_code UInt16,

    request_count UInt64,
    error_count UInt64,
    latency_sum_ms UInt64,
    latency_count UInt64,
    latency_min_ms UInt32,
    latency_max_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, environment, route, timestamp);
```

### 6.6 Rollup

```sql
CREATE TABLE api_metrics_1m
(
    service LowCardinality(String),
    environment LowCardinality(String),
    minute DateTime,
    route LowCardinality(String),

    request_count SimpleAggregateFunction(sum, UInt64),
    error_count SimpleAggregateFunction(sum, UInt64),
    latency_sum_ms SimpleAggregateFunction(sum, UInt64),
    latency_count SimpleAggregateFunction(sum, UInt64),
    p95_latency AggregateFunction(quantile(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (service, environment, minute, route);
```

### 6.7 Cardinality Warning

Labels like:

- `user_id`;
- `request_id`;
- `trace_id`;
- `session_id`;
- full URL with IDs;
- pod UID;
- container ID;

can explode metric cardinality.

Keep high-cardinality identifiers in logs/traces, not metrics labels unless explicitly intended.

---

## 7. Pattern 4 — Logs Table

### 7.1 Use Case

Logs:

- application logs;
- audit-ish text records;
- errors;
- access logs;
- security logs;
- system logs.

### 7.2 Schema

```sql
CREATE TABLE logs
(
    timestamp DateTime64(3),
    ingest_time DateTime64(3),

    tenant_id UInt64,
    service LowCardinality(String),
    environment LowCardinality(String),
    region LowCardinality(String),
    host String,

    level LowCardinality(String),
    logger LowCardinality(String),
    thread String,

    trace_id UUID,
    span_id String,
    request_id String,
    user_id UInt64,

    route LowCardinality(String),
    status_code UInt16,
    latency_ms UInt32,

    message String,
    attributes Map(String, String),
    raw_log String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, environment, timestamp, level);
```

### 7.3 Why This Sort Key?

Common observability queries:

```text
service + environment + time range
service + level + time range
error rate over time
recent errors for service
```

### 7.4 For Trace Lookup

If lookup by `trace_id` frequent, options:

- bloom filter skip index on trace_id;
- projection sorted by trace_id;
- separate trace/log lookup table;
- external search system.

### 7.5 Avoid

- `ORDER BY timestamp` only if service-scoped queries common;
- all logs in JSON only;
- unbounded message regex search;
- using logs table as full-text search engine without strategy;
- `SELECT *` in dashboard.

### 7.6 Retention

Logs often need tiered retention:

```text
raw logs: 7-30 days
parsed error logs: 90 days
metrics rollups: 1-2 years
incident reports: longer
```

Do not retain expensive raw logs forever if not required.

---

## 8. Pattern 5 — Distributed Traces / Spans Table

### 8.1 Use Case

Tracing data:

- one trace has many spans;
- spans have parent-child relationship;
- useful for latency breakdown;
- high-cardinality trace IDs.

### 8.2 Span Schema

```sql
CREATE TABLE spans
(
    trace_id UUID,
    span_id String,
    parent_span_id String,

    start_time DateTime64(6),
    end_time DateTime64(6),
    duration_us UInt64,

    service LowCardinality(String),
    operation LowCardinality(String),
    environment LowCardinality(String),

    status_code LowCardinality(String),
    error UInt8,

    tenant_id UInt64,
    user_id UInt64,

    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (service, environment, start_time, trace_id);
```

### 8.3 Query Families

#### Service Latency

```sql
SELECT
    toStartOfMinute(start_time) AS minute,
    operation,
    quantile(0.95)(duration_us) AS p95
FROM spans
WHERE service = 'payment-api'
  AND environment = 'prod'
  AND start_time >= now() - INTERVAL 1 HOUR
GROUP BY
    minute,
    operation;
```

#### Trace Drilldown

```sql
SELECT *
FROM spans
WHERE trace_id = '...'
ORDER BY start_time;
```

This may need alternate access path:

```text
projection/table ORDER BY (trace_id, start_time)
```

### 8.4 Specialized Trace Table

```sql
CREATE TABLE spans_by_trace
AS spans
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (trace_id, start_time, span_id);
```

Can be filled by MV if trace drilldown is critical.

### 8.5 Rollup

For dashboards:

```text
service_operation_latency_1m
```

with quantile states.

### 8.6 Caution

Trace data volume can be enormous. Sampling strategy may be needed.

---

## 9. Pattern 6 — Immutable Audit Trail

### 9.1 Use Case

Audit events:

- who changed what;
- who accessed what;
- administrative actions;
- regulatory actions;
- security events;
- approval/rejection events;
- data export/download events.

### 9.2 Audit Requirements

Audit tables usually need:

- immutability;
- actor;
- action;
- subject;
- timestamp;
- before/after or diff;
- request context;
- source system;
- reason;
- correlation id;
- retention;
- tamper-evidence if required.

### 9.3 Schema

```sql
CREATE TABLE audit_events
(
    tenant_id UInt64,
    audit_id UUID,

    event_time DateTime64(3),
    ingest_time DateTime64(3),

    actor_type LowCardinality(String),
    actor_id String,
    actor_role LowCardinality(String),

    action LowCardinality(String),

    subject_type LowCardinality(String),
    subject_id String,

    outcome LowCardinality(String),
    reason String,

    source_system LowCardinality(String),
    request_id String,
    ip_address IPv6,
    user_agent String,

    before_state String,
    after_state String,
    diff String,

    schema_version UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, action, event_time, subject_type, subject_id);
```

### 9.4 Query Families

- actions by actor;
- actions on subject;
- changes over period;
- failed/suspicious actions;
- export history;
- compliance evidence.

### 9.5 Alternate Access

If subject drilldown frequent:

```text
projection/table ORDER BY (tenant_id, subject_type, subject_id, event_time)
```

If actor investigation frequent:

```text
projection/table ORDER BY (tenant_id, actor_id, event_time)
```

### 9.6 Audit Anti-Patterns

- updating/deleting audit rows casually;
- no stable audit_id;
- missing request/correlation id;
- storing only final state;
- no before/after/diff when needed;
- keeping PII without retention/deletion policy;
- relying on current dimension for historical actor role.

---

## 10. Pattern 7 — CDC Raw Change Log

### 10.1 Use Case

ClickHouse receives database changes from OLTP:

- insert/update/delete from PostgreSQL/MySQL;
- Debezium events;
- binlog/WAL changes;
- application outbox.

### 10.2 Raw CDC Table

```sql
CREATE TABLE user_cdc_raw
(
    source_system LowCardinality(String),
    source_table LowCardinality(String),

    op LowCardinality(String),
    primary_key String,

    commit_time DateTime64(3),
    source_lsn String,
    source_tx_id String,
    source_sequence UInt64,

    before_payload String,
    after_payload String,

    ingest_time DateTime64(3),
    ingest_batch_id String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(commit_time)
ORDER BY (source_table, commit_time, primary_key, source_sequence);
```

### 10.3 Why Keep Raw CDC?

- replay;
- debugging;
- schema evolution;
- lineage;
- correction;
- rebuilding snapshots;
- audit trail.

### 10.4 Not Ideal for Direct Dashboard

Raw CDC is verbose and operation-oriented.

Build derived:

- current snapshot table;
- event table;
- aggregate table.

---

## 11. Pattern 8 — Current Snapshot Table

### 11.1 Use Case

Current state:

- current user profile;
- current case status;
- latest merchant risk bucket;
- latest product metadata;
- latest account state;
- current assignment.

### 11.2 Schema

```sql
CREATE TABLE case_current_state
(
    tenant_id UInt64,
    case_id UUID,

    status LowCardinality(String),
    current_severity LowCardinality(String),
    current_assignee_user_id UInt64,
    jurisdiction LowCardinality(String),

    opened_at DateTime64(3),
    updated_at DateTime64(3),

    deleted UInt8,
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

### 11.3 Query

```sql
SELECT
    status,
    current_severity,
    count()
FROM
(
    SELECT
        case_id,
        argMax(status, version) AS status,
        argMax(current_severity, version) AS current_severity,
        argMax(deleted, version) AS deleted
    FROM case_current_state
    WHERE tenant_id = 10
    GROUP BY case_id
)
WHERE deleted = 0
GROUP BY
    status,
    current_severity;
```

### 11.4 `FINAL` Caution

Avoid using `FINAL` blindly on large current-state tables.

### 11.5 Snapshot vs Event

Current state answers:

```text
what is true now?
```

Event table answers:

```text
what happened when?
```

Do not mix them.

---

## 12. Pattern 9 — Periodic Snapshot Table

### 12.1 Use Case

Periodic snapshots capture state at intervals:

- daily account balance;
- daily case backlog;
- end-of-month inventory;
- weekly subscription state;
- monthly regulatory position.

### 12.2 Schema

```sql
CREATE TABLE daily_case_backlog_snapshot
(
    tenant_id UInt64,
    snapshot_date Date,

    case_id UUID,
    status LowCardinality(String),
    severity LowCardinality(String),
    jurisdiction LowCardinality(String),
    assignee_user_id UInt64,

    age_days UInt32,
    sla_bucket LowCardinality(String),

    generated_at DateTime64(3),
    snapshot_version UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (tenant_id, snapshot_date, status, jurisdiction, case_id);
```

### 12.3 Why Snapshot?

Some metrics are hard to reconstruct cheaply from events every time.

Example:

```text
Backlog as of each day
Cases open at end of month
Inventory position
```

### 12.4 Query

```sql
SELECT
    snapshot_date,
    status,
    severity,
    count() AS cases
FROM daily_case_backlog_snapshot
WHERE tenant_id = 10
  AND snapshot_date >= today() - 30
GROUP BY
    snapshot_date,
    status,
    severity;
```

### 12.5 Versioning

For official snapshots, include:

- snapshot_version;
- generated_at;
- source_watermark;
- checksum;
- amendment_reason.

---

## 13. Pattern 10 — Rollup / Aggregate Table

### 13.1 Use Case

Repeated dashboards:

- daily counts;
- hourly latency;
- DAU/WAU;
- revenue by day;
- case opened/closed by jurisdiction.

### 13.2 Additive Rollup

```sql
CREATE TABLE daily_case_counts
(
    tenant_id UInt64,
    day Date,
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    opened_count UInt64,
    closed_count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, jurisdiction, severity);
```

Query:

```sql
SELECT
    day,
    jurisdiction,
    severity,
    sum(opened_count) AS opened,
    sum(closed_count) AS closed
FROM daily_case_counts
WHERE tenant_id = 10
GROUP BY
    day,
    jurisdiction,
    severity;
```

### 13.3 Aggregate State Rollup

```sql
CREATE TABLE daily_case_sla
(
    tenant_id UInt64,
    day Date,
    jurisdiction LowCardinality(String),

    cases AggregateFunction(uniq, UUID),
    assignment_latency_p95 AggregateFunction(quantile(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, jurisdiction);
```

### 13.4 Rule

- additive metrics → `SummingMergeTree` or `SimpleAggregateFunction`;
- distinct/percentile/topK → `AggregatingMergeTree`;
- always query with correct finalization.

---

## 14. Pattern 11 — Top-N Serving Table

### 14.1 Use Case

Dashboards often need:

- top routes by error;
- top users by activity;
- top merchants by revenue;
- top cases by SLA risk;
- top services by latency.

Top-N over raw data can be expensive.

### 14.2 Schema

```sql
CREATE TABLE daily_top_routes
(
    service LowCardinality(String),
    environment LowCardinality(String),
    day Date,
    route LowCardinality(String),
    request_count UInt64,
    error_count UInt64,
    p95_latency_ms UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (service, environment, day, error_count, route);
```

### 14.3 Generation

A scheduled job or MV pipeline can populate top candidates.

### 14.4 Query

```sql
SELECT
    route,
    sum(error_count) AS errors,
    sum(request_count) AS requests
FROM daily_top_routes
WHERE service = 'payment-api'
  AND environment = 'prod'
  AND day >= today() - 7
GROUP BY route
ORDER BY errors DESC
LIMIT 20;
```

### 14.5 Caution

Top-N is not always composable. Top 100 per day may miss top 100 over month if an item is rank 101 every day. Design candidate size accordingly.

---

## 15. Pattern 12 — Search / Drilldown Table

### 15.1 Use Case

Access path differs from dashboard.

Examples:

- lookup by `trace_id`;
- lookup by `event_id`;
- case drilldown by `case_id`;
- audit subject history;
- ingestion batch debugging.

### 15.2 Separate Table

```sql
CREATE TABLE case_events_by_case
(
    tenant_id UInt64,
    case_id UUID,
    event_time DateTime64(3),
    event_id UUID,
    event_type LowCardinality(String),
    actor_user_id UInt64,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, case_id, event_time, event_id);
```

### 15.3 Populate

Options:

- duplicate insert;
- materialized view from raw;
- projection in same table.

### 15.4 When Justified

- drilldown is frequent;
- latency matters;
- raw table sort key not suitable;
- storage overhead acceptable;
- lifecycle/backfill understood.

---

## 16. Pattern 13 — Report Snapshot Table

### 16.1 Use Case

Official reports:

- regulatory monthly report;
- financial close;
- compliance export;
- signed analytics result;
- board/business reporting.

### 16.2 Schema

```sql
CREATE TABLE official_case_report_snapshots
(
    tenant_id UInt64,
    report_period String,
    report_version UInt32,

    generated_at DateTime64(3),
    source_watermark DateTime64(3),

    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    opened_cases UInt64,
    closed_cases UInt64,
    backlog_cases UInt64,

    checksum String,
    amendment_reason String
)
ENGINE = MergeTree
ORDER BY (tenant_id, report_period, report_version, jurisdiction, severity);
```

### 16.3 Why Not Live Query?

Official reports must be:

- reproducible;
- versioned;
- auditable;
- amendable;
- independent from future late corrections unless new version created.

### 16.4 Report Metadata

Add separate metadata table:

```sql
CREATE TABLE report_runs
(
    tenant_id UInt64,
    report_name LowCardinality(String),
    report_period String,
    report_version UInt32,
    generated_at DateTime64(3),
    generated_by String,
    source_watermark DateTime64(3),
    status LowCardinality(String),
    checksum String,
    notes String
)
ENGINE = MergeTree
ORDER BY (tenant_id, report_name, report_period, report_version);
```

---

## 17. End-to-End Domain Model: Regulatory Case Lifecycle

This is the most comprehensive pattern because it combines:

- events;
- current state;
- audit;
- snapshots;
- rollups;
- reports;
- corrections;
- long retention.

### 17.1 Domain

A case can be:

- opened;
- classified;
- assigned;
- reviewed;
- escalated;
- decided;
- appealed;
- closed;
- reopened;
- withdrawn;
- corrected.

### 17.2 Raw Lifecycle Events

```sql
CREATE TABLE case_lifecycle_events
(
    tenant_id UInt64,
    event_id UUID,
    case_id UUID,

    event_time DateTime64(3),
    ingest_time DateTime64(3),

    event_type LowCardinality(String),

    -- event-time dimensions
    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),
    severity_at_event LowCardinality(String),
    program LowCardinality(String),

    -- actor
    actor_user_id UInt64,
    actor_role LowCardinality(String),
    actor_region LowCardinality(String),

    -- state transition
    from_status LowCardinality(String),
    to_status LowCardinality(String),

    -- measures
    duration_since_previous_ms UInt64,
    sla_deadline_at Nullable(DateTime64(3)),

    -- correction lineage
    correction_of_event_id Nullable(UUID),
    correction_reason String,

    -- ingestion
    source_system LowCardinality(String),
    schema_version UInt16,
    ingest_batch_id String,

    attributes Map(String, String),
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id);
```

### 17.3 Why Denormalize Severity/Jurisdiction?

Historical report asks:

```text
How many cases were opened by severity at the time of opening?
```

If you join current severity, old reports change incorrectly.

So store:

```text
severity_at_event
jurisdiction at event time
actor_role at event time
```

### 17.4 Current Case State

```sql
CREATE TABLE case_current_state
(
    tenant_id UInt64,
    case_id UUID,

    status LowCardinality(String),
    current_severity LowCardinality(String),
    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),
    program LowCardinality(String),

    assignee_user_id UInt64,
    opened_at DateTime64(3),
    updated_at DateTime64(3),

    deleted UInt8,
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, case_id);
```

### 17.5 Daily Opened/Closed Rollup

```sql
CREATE TABLE daily_case_lifecycle_rollup
(
    tenant_id UInt64,
    day Date,
    jurisdiction LowCardinality(String),
    severity LowCardinality(String),
    case_type LowCardinality(String),

    opened_count UInt64,
    closed_count UInt64,
    escalated_count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, jurisdiction, severity, case_type);
```

### 17.6 SLA Metrics

```sql
CREATE TABLE daily_case_sla_rollup
(
    tenant_id UInt64,
    day Date,
    jurisdiction LowCardinality(String),
    case_type LowCardinality(String),

    cases AggregateFunction(uniq, UUID),
    time_to_assignment_p50 AggregateFunction(quantile(0.50), UInt64),
    time_to_assignment_p95 AggregateFunction(quantile(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, jurisdiction, case_type);
```

### 17.7 Backlog Snapshot

```sql
CREATE TABLE daily_case_backlog_snapshot
(
    tenant_id UInt64,
    snapshot_date Date,
    case_id UUID,

    status LowCardinality(String),
    severity LowCardinality(String),
    jurisdiction LowCardinality(String),
    assignee_user_id UInt64,

    age_days UInt32,
    sla_bucket LowCardinality(String),

    generated_at DateTime64(3),
    snapshot_version UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (tenant_id, snapshot_date, status, jurisdiction, case_id);
```

### 17.8 Audit Events

Separate from lifecycle events if needed:

```text
audit_events:
  who accessed/changed/exported/approved what
```

Lifecycle event means domain transition.  
Audit event means accountability record.

### 17.9 Official Report

```text
official_case_report_snapshots
```

Versioned, reproducible, with source watermark/checksum.

---

## 18. Event Time vs Ingestion Time vs Effective Time

### 18.1 Event Time

When thing happened in business world.

```text
case opened at 2026-06-01 10:00
```

### 18.2 Ingestion Time

When ClickHouse received it.

```text
ingested at 2026-06-01 10:05
```

### 18.3 Effective Time

When value/state became valid.

```text
severity HIGH effective from 2026-05-31
```

### 18.4 Why It Matters

Late event:

```text
event_time = May
ingest_time = June
```

Report by event time vs ingestion time differs.

### 18.5 Schema Advice

Keep both:

```sql
event_time DateTime64(3),
ingest_time DateTime64(3)
```

For SCD/as-of:

```sql
valid_from DateTime64(3),
valid_to Nullable(DateTime64(3))
```

### 18.6 Partitioning

Usually partition raw facts by `event_time`.

But ingestion audit/debug table may partition by `ingest_time`.

Choose based on lifecycle.

---

## 19. Identity and Deduplication Design

### 19.1 Event ID

Every event table should have stable `event_id`.

Bad:

```java
UUID.randomUUID()
```

on every retry.

Good:

```text
source_event_id
or deterministic hash(tenant, source, source_id, sequence)
```

### 19.2 Business Key

Some facts have natural business key:

```text
order_id
payment_id
case_id + event_sequence
source_table + primary_key + source_lsn
```

### 19.3 Batch ID

For ingestion:

```text
topic-partition-offset range
file path + checksum
backfill job id
```

### 19.4 Dedup Table

If needed:

```sql
CREATE TABLE events_dedup
(
    tenant_id UInt64,
    event_id UUID,
    event_time DateTime64(3),
    event_type LowCardinality(String),
    version UInt64,
    deleted UInt8
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_id);
```

### 19.5 Reconciliation Query

```sql
SELECT
    tenant_id,
    event_id,
    count()
FROM events
GROUP BY
    tenant_id,
    event_id
HAVING count() > 1
LIMIT 100;
```

---

## 20. Dimension Strategy

### 20.1 Hot Dimensions

Put directly in fact/event table:

- tenant;
- event_type;
- country;
- jurisdiction;
- severity;
- status;
- service;
- environment;
- route group;
- device type;
- plan.

### 20.2 Cold Lookup Dimensions

Use dictionary or join:

- display name;
- full user name;
- product label;
- agency name;
- account manager;
- rarely used metadata.

### 20.3 Historical Dimensions

Store at event time or use SCD/as-of model:

- severity at event;
- plan at event;
- jurisdiction at event;
- actor role at event.

### 20.4 Current Dimensions

Use current snapshot table/dictionary:

- current user plan;
- current case status;
- current assignee.

### 20.5 Many-to-Many Dimensions

Examples:

- tags;
- groups;
- campaigns;
- permissions.

Options:

- explode into bridge event table;
- precompute rollup by tag;
- store array and `ARRAY JOIN` carefully;
- define attribution rule.

---

## 21. Sorting Key Strategy by Pattern

### 21.1 Event Analytics

```sql
ORDER BY (tenant_id, event_name, event_time, user_id)
```

Good for event trend.

### 21.2 Case Lifecycle

```sql
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id)
```

Good for reports by event type/time.

Alternate:

```sql
ORDER BY (tenant_id, case_id, event_time)
```

for drilldown.

### 21.3 Logs

```sql
ORDER BY (service, environment, timestamp, level)
```

Good for service/time logs.

### 21.4 Metrics

```sql
ORDER BY (metric_name, service, environment, timestamp)
```

or for service metrics:

```sql
ORDER BY (service, environment, route, timestamp)
```

### 21.5 Current State

```sql
ORDER BY (tenant_id, entity_id)
```

because identity matters.

### 21.6 Rollup

```sql
ORDER BY (tenant_id, bucket_time, major_dimensions...)
```

### 21.7 Audit

```sql
ORDER BY (tenant_id, action, event_time, subject_type, subject_id)
```

or alternate by subject/actor if drilldown primary.

---

## 22. Partitioning Strategy by Pattern

### 22.1 Raw Events

```sql
PARTITION BY toYYYYMM(event_time)
```

Common.

### 22.2 High-Volume Logs

Monthly or daily depending volume.

```sql
PARTITION BY toYYYYMM(timestamp)
```

or daily if very large and retention operations need day-level drop.

### 22.3 Metrics

```sql
PARTITION BY toYYYYMM(timestamp)
```

or shorter if high-volume and lifecycle needs.

### 22.4 Current State

Often no time partition or partition by tenant/group if needed carefully.

```sql
ORDER BY (tenant_id, entity_id)
```

Avoid over-partitioning.

### 22.5 Snapshots/Rollups

Partition by snapshot/bucket month:

```sql
PARTITION BY toYYYYMM(day)
```

### 22.6 Rule

Partition by lifecycle boundary, not arbitrary query dimension.

---

## 23. Retention Strategy by Pattern

| Table | Typical Retention |
|---|---|
| raw product events | 90 days - years |
| logs raw | 7-90 days |
| metrics raw | days/weeks |
| metrics rollups | months/years |
| traces raw | days/weeks |
| audit events | years |
| CDC raw | depends replay/audit needs |
| current snapshot | latest + versions as needed |
| daily snapshots | months/years |
| official reports | long-term/legal |
| rollups | longer than raw |

Use TTL, partition drop, and storage tiering based on value.

---

## 24. Backfill Strategy by Pattern

### 24.1 Raw Events

Backfill by partition:

```text
load June 2026
validate
then next partition
```

### 24.2 Rollups

Usually rebuild from raw:

```text
drop affected rollup partition
recompute
insert
validate
```

### 24.3 Current State

Rebuild from event/CDC history:

```text
derive latest per entity
load shadow table
swap
```

### 24.4 Snapshots

Regenerate snapshot version rather than overwrite official result.

### 24.5 Logs/Traces

Often best-effort; backfill depends retention and cost.

### 24.6 Audit

Backfill must preserve lineage and avoid altering event_time semantics.

---

## 25. Java Domain Design Implications

### 25.1 Event Envelope

Your Java systems should emit events with:

```json
{
  "tenantId": 10,
  "eventId": "stable-id",
  "entityType": "CASE",
  "entityId": "case-id",
  "eventType": "CASE_ASSIGNED",
  "eventTime": "2026-06-21T10:00:00Z",
  "sourceSystem": "case-service",
  "sourceSequence": 123456,
  "schemaVersion": 4,
  "actorId": 999,
  "correlationId": "request-id"
}
```

### 25.2 Do Not Emit Ambiguous Events

Bad:

```json
{
  "type": "UPDATED",
  "payload": {...}
}
```

Better:

```json
{
  "eventType": "CASE_SEVERITY_CHANGED",
  "oldSeverity": "LOW",
  "newSeverity": "HIGH"
}
```

### 25.3 Schema Versioning

Events evolve. Include:

- schema version;
- default values;
- backward compatibility;
- parser strategy;
- DLQ.

### 25.4 Domain Event vs Audit Event

A domain event:

```text
CASE_ASSIGNED
```

An audit event:

```text
USER_X_ASSIGNED_CASE_Y_FROM_IP_Z
```

Sometimes one action produces both.

### 25.5 Outbox Pattern

For reliable event publishing from OLTP:

```text
transaction writes domain change + outbox row
connector publishes outbox
ClickHouse ingests event
```

This reduces dual-write inconsistency.

---

## 26. Modeling Decision Matrix

| Requirement | Pattern |
|---|---|
| what happened over time | immutable event table |
| current status/count now | current snapshot table |
| state as of every day | periodic snapshot |
| repeated dashboard | rollup/serving table |
| official reproducible result | report snapshot |
| raw DB change replay | CDC raw table |
| logs search by service/time | logs table |
| trace drilldown | spans table + trace access path |
| exact auditability | audit events |
| top-N dashboard | top-N serving table |
| entity drilldown different sort | projection or separate table |
| high-cardinality ad-hoc export | async export/offline |
| hot JSON field filter | promoted/materialized column |
| cold label lookup | dictionary |
| event-time dimension | denormalize at event time |
| current dimension | current snapshot/dictionary |

---

## 27. Common Anti-Patterns

### 27.1 Mirroring OLTP Schema

Creating `users`, `orders`, `order_items`, `cases`, `statuses`, `jurisdictions` and joining everything at query time.

Better: model facts/events for analytics.

### 27.2 JSON-Only Analytics

Putting all data in one `payload String` and extracting at query time.

Better: promote hot fields.

### 27.3 All String Columns

Loses compression/type efficiency.

Better: use `UInt`, `DateTime64`, `LowCardinality`, `Decimal`, `UUID`, `Enum` when appropriate.

### 27.4 Current-State Confusion

Using current dimension for historical report.

Better: store event-time dimension.

### 27.5 No Event ID

Dedup/reconciliation becomes guesswork.

### 27.6 No Ingest Time

Late-event/debugging becomes painful.

### 27.7 One Table for Everything

A single table cannot serve all query shapes well.

Use projections/MVs/serving tables.

### 27.8 Over-Normalization

Runtime joins kill dashboard performance.

### 27.9 Over-Denormalization of PII

Deletion/governance becomes hard.

### 27.10 Rollup Without Metric Semantics

Summing daily distinct counts and calling it monthly unique users.

---

## 28. Production Checklist

### Grain

- [ ] One row meaning is explicit.
- [ ] Business identity is explicit.
- [ ] Time semantics are explicit.
- [ ] Raw vs derived is explicit.
- [ ] Correction/deletion semantics are explicit.

### Schema

- [ ] Data types are chosen intentionally.
- [ ] Hot fields are physical columns.
- [ ] Long-tail fields are contained.
- [ ] Nullable is used only when meaningful.
- [ ] LowCardinality used where appropriate.
- [ ] PII minimized.

### Physical Design

- [ ] Sorting key matches main query family.
- [ ] Partition key matches lifecycle.
- [ ] Engine matches semantics.
- [ ] Retention policy defined.
- [ ] Distributed sharding key considered.
- [ ] Projection/serving table considered for alternate access.

### Correctness

- [ ] Event-time vs ingestion-time clarified.
- [ ] Historical vs current dimension clarified.
- [ ] Dedup strategy defined.
- [ ] Late event strategy defined.
- [ ] Backfill strategy defined.
- [ ] Report snapshot/versioning defined if official.

### Operations

- [ ] Part count risk considered.
- [ ] Rollup rebuild process exists.
- [ ] Reconciliation queries exist.
- [ ] Query guardrails exist.
- [ ] Ownership documented.
- [ ] Schema evolution process exists.

### Java Integration

- [ ] Stable event ID.
- [ ] Schema version.
- [ ] Source sequence/offset.
- [ ] Batch ID.
- [ ] Correlation ID.
- [ ] Domain-specific event types.
- [ ] Outbox/CDC reliability pattern.
- [ ] Retry idempotency.

---

## 29. Exercises

### Exercise 1: Choose Grain

Requirement:

```text
Report number of cases opened, assigned, closed per day by jurisdiction.
```

Question:

- What should one row in raw table represent?

Expected:

```text
one lifecycle event per case
```

not one current case row.

### Exercise 2: Current vs Historical Severity

Requirement:

```text
Historical report must show severity when case was opened.
Current dashboard must show current severity.
```

Expected model:

```text
case_lifecycle_events.severity_at_event
case_current_state.current_severity
```

### Exercise 3: Logs vs Metrics

Requirement:

```text
Show p95 latency per route per minute and also debug individual errors.
```

Expected:

```text
logs/spans raw for debugging
api_latency_1m rollup for dashboard
```

### Exercise 4: Audit Access

Requirement:

```text
Find all actions by actor and all actions on a subject.
```

Expected:

```text
audit_events sorted for main query + projection/separate table for alternate actor/subject drilldown
```

### Exercise 5: Product DAU

Requirement:

```text
DAU by country and monthly active users.
```

Expected:

```text
raw product_events
AggregatingMergeTree rollup with uniqState, not sum of daily uniques for month
```

---

## 30. Summary

Data modeling in ClickHouse starts with grain, query family, and correctness semantics.

Core ideas:

1. Model from analytics questions, not OLTP ERD.
2. Define one-row meaning first.
3. Separate events, current state, snapshots, rollups, and reports.
4. Store event-time dimensions for historical correctness.
5. Use current snapshots for current dashboards.
6. Use rollups for repeated dashboards.
7. Use aggregate states for non-additive metrics.
8. Promote hot fields from JSON.
9. Use separate access paths for drilldown/search.
10. Keep PII/governance in mind from the beginning.
11. Java event producers must emit stable, versioned, domain-specific events.
12. Official reports should be snapshot/versioned.

Practical sentence:

> A good ClickHouse model is not the most normalized model; it is the model whose physical shape, time semantics, and metric semantics match the questions the business repeatedly asks.

---

## 31. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi ClickHouse sesuai versi yang kamu pakai:

1. ClickHouse Docs — Choosing a primary key.
2. ClickHouse Docs — MergeTree table engine.
3. ClickHouse Docs — Data types.
4. ClickHouse Docs — LowCardinality.
5. ClickHouse Docs — JSON and semi-structured data.
6. ClickHouse Docs — Materialized views.
7. ClickHouse Docs — AggregatingMergeTree.
8. ClickHouse Docs — SummingMergeTree.
9. ClickHouse Docs — ReplacingMergeTree.
10. ClickHouse Docs — Dictionaries.
11. ClickHouse Docs — Projections.
12. ClickHouse Docs — Data skipping indexes.
13. ClickHouse Docs — Time-series data.
14. ClickHouse Docs — Observability/log analytics examples.
15. ClickHouse Docs — Backfilling data.

---

## 32. Status Seri

Part ini adalah:

```text
Part 026 / 034
```

Seri belum selesai.

Part berikutnya:

```text
Part 027 — Java Integration I: JDBC, HTTP, Native Clients, Types, Batching, and Query APIs
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Performance Engineering III: CPU, Memory, Disk, Network, and Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-027.md">Part 027 — Java Integration I: JDBC, HTTP, Native Clients, Types, Batching, and Query APIs ➡️</a>
</div>

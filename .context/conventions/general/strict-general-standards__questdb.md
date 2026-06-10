# strict-general-standards\_\_questdb.md

> Mandatory standards for LLM/code agents designing, implementing, reviewing, or modifying systems that use **QuestDB**.

---

## 0. Purpose

This document defines strict standards for using QuestDB safely and correctly in production systems.

QuestDB is a high-performance time-series database. It is excellent for append-heavy time-series/event/market-data/telemetry workloads, but it must not be treated as a generic OLTP database, relational source of truth, queue, cache, search engine, or workflow engine.

These rules are written for LLM/code agents. When generating code, SQL, infrastructure, migrations, client integrations, or documentation, the agent **MUST** follow this file unless a human explicitly overrides it with a documented reason.

---

## 1. Non-Negotiable Rules

### 1.1 QuestDB must be chosen deliberately

An LLM/code agent **MUST NOT** introduce QuestDB unless the workload is primarily one or more of:

- high-ingestion time-series data;
- event/tick/trade/order-book/metric/IoT/telemetry streams;
- append-heavy analytical data;
- low-latency queries over recent or historical time ranges;
- time-bucketed aggregations;
- downsampled analytical views;
- temporal joins or time-window analysis;
- operational/event observability where time is the dominant access dimension.

An LLM/code agent **MUST NOT** use QuestDB as:

- the primary transactional database for business invariants;
- the authoritative store for mutable workflows;
- a replacement for PostgreSQL/MySQL OLTP;
- a general document store;
- a job queue;
- a cache;
- a lock manager;
- a source of truth for authorization decisions;
- a place to enforce cross-entity referential integrity.

### 1.2 Every table must declare its time model

Every production QuestDB table **MUST** define:

- event time column;
- whether that column is the designated timestamp;
- timestamp precision requirement;
- partitioning strategy;
- retention/TTL strategy;
- ingestion ordering expectation;
- allowed late-arrival/out-of-order behavior;
- deduplication policy if data can be resent;
- whether table is WAL-enabled.

The LLM/code agent **MUST NOT** create anonymous “just store rows” tables.

### 1.3 Designated timestamp is mandatory for real time-series tables

For any true time-series table, the LLM/code agent **MUST** use a designated timestamp:

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    symbol SYMBOL,
    side SYMBOL,
    price DOUBLE,
    quantity DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

The designated timestamp is not just a column. It drives QuestDB time-series behavior, partition pruning, and time-series SQL features.

### 1.4 Partitioning must be explicit

A table with high-volume time-series data **MUST** be partitioned by time.

Allowed partition units:

- `HOUR`
- `DAY`
- `WEEK`
- `MONTH`
- `YEAR`

The LLM/code agent **MUST** choose the partition unit based on:

- ingest rate;
- query window;
- retention/drop granularity;
- expected partition count;
- compaction/storage behavior;
- late data arrival pattern;
- backup/restore/rebuild strategy.

Partitioning cannot be casually changed after table creation. If the partitioning strategy is wrong, the standard migration path is usually create-new-table + backfill + cutover.

### 1.5 WAL must be the default for production ingestion

For production ingestion, the LLM/code agent **SHOULD** create WAL tables by default unless a documented reason exists not to.

WAL is required when using QuestDB deduplication.

The LLM/code agent **MUST** explicitly document when a table bypasses WAL and what reliability/concurrency tradeoff is accepted.

### 1.6 QuestDB must not own transactional correctness

If a business workflow requires:

- unique business constraints;
- multi-row invariants;
- cross-table constraints;
- transactional state transition;
- authorization-critical state;
- approval lifecycle state;
- financial posting correctness;

then the authoritative write path **MUST** be implemented in an OLTP database or a transactional service. QuestDB may receive a denormalized analytical/time-series projection.

---

## 2. Required Agent Behavior Before Using QuestDB

Before generating QuestDB schema, queries, or integration code, the LLM/code agent **MUST** answer:

```md
QuestDB Fit Assessment:

- Workload type:
- Why time-series/append-heavy storage is needed:
- Why OLTP/search/cache/message broker is not the better primary store:
- Expected ingest rate:
- Expected query patterns:
- Time column:
- Timestamp precision:
- Partitioning:
- Retention:
- Deduplication:
- Late/out-of-order data:
- Operational risk:
```

If this assessment cannot be answered, the agent **MUST NOT** proceed with QuestDB-specific design.

---

## 3. Table Design Standards

### 3.1 Table names

Table names **MUST** be:

- plural or domain-stream oriented;
- lowercase snake_case;
- specific to one fact/event stream;
- not named after vague transport concepts.

Good:

```sql
market_ticks
trade_executions
sensor_readings
service_latency_samples
http_request_events
```

Bad:

```sql
data
logs
events
messages
records
questdb_table
```

### 3.2 One table must represent one grain

Every table **MUST** define its grain.

Examples:

```md
Table: trade_executions
Grain: one row per executed trade event reported by venue.
```

```md
Table: sensor_readings
Grain: one row per device measurement at source event timestamp.
```

The agent **MUST NOT** mix grains in one table, such as combining raw events, hourly summaries, and latest-state snapshots into the same table.

### 3.3 Use designated event time, not ingestion time, by default

For domain/event analytics, the designated timestamp **SHOULD** be source event time.

Use ingestion/server time only when:

- source event time does not exist;
- ingestion time is the actual measurement dimension;
- the use case is arrival monitoring;
- the difference between event time and ingest time is separately recorded.

Recommended:

```sql
CREATE TABLE sensor_readings (
    event_ts TIMESTAMP,
    ingested_at TIMESTAMP,
    device_id SYMBOL,
    temperature DOUBLE,
    humidity DOUBLE
) TIMESTAMP(event_ts)
PARTITION BY DAY
WAL;
```

The LLM/code agent **SHOULD** store both:

- `event_ts` for event time;
- `ingested_at` for ingestion time.

### 3.4 Do not rely on implicit ordering

Queries **MUST** specify `ORDER BY` when order matters.

The agent **MUST NOT** assume insertion order is stable, especially for rows with identical timestamps, out-of-order ingestion, parallel ingestion, or WAL application.

Bad:

```sql
SELECT *
FROM trades
WHERE symbol = 'EURUSD'
LIMIT 100;
```

Good:

```sql
SELECT *
FROM trades
WHERE symbol = 'EURUSD'
  AND ts >= dateadd('h', -1, now())
ORDER BY ts DESC
LIMIT 100;
```

### 3.5 Always filter by time for large tables

Large-table queries **MUST** include a bounded time predicate on the designated timestamp unless explicitly performing controlled full-history analytics.

Bad:

```sql
SELECT symbol, avg(price)
FROM trades
GROUP BY symbol;
```

Good:

```sql
SELECT symbol, avg(price)
FROM trades
WHERE ts >= dateadd('d', -7, now())
GROUP BY symbol;
```

For dashboard queries, absence of a time predicate is a production defect unless the table is known to be small.

---

## 4. Column Type Standards

### 4.1 Use `SYMBOL` for repeated categorical values

Use `SYMBOL` for repeated categorical dimensions such as:

- instrument symbol;
- exchange;
- venue;
- sensor ID;
- region;
- service name;
- status;
- event type;
- host group.

Example:

```sql
CREATE TABLE service_latency_samples (
    ts TIMESTAMP,
    service_name SYMBOL,
    endpoint SYMBOL,
    method SYMBOL,
    status_code SHORT,
    duration_ms DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

### 4.2 Do not use cached `SYMBOL` blindly for extreme cardinality

Symbol columns are dictionary encoded and cached by default. For very high-cardinality dimensions, the LLM/code agent **MUST** consider `NOCACHE`.

Example:

```sql
CREATE TABLE client_events (
    ts TIMESTAMP,
    client_id SYMBOL NOCACHE,
    event_type SYMBOL,
    amount DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

High-cardinality user IDs, request IDs, transaction IDs, session IDs, and trace IDs **MUST NOT** be blindly modeled as cached symbols without memory impact analysis.

### 4.3 Do not store numeric values as strings

The agent **MUST NOT** store measurable quantities as `STRING`/`VARCHAR`.

Bad:

```sql
price STRING
latency STRING
temperature STRING
```

Good:

```sql
price DOUBLE
latency_ms LONG
temperature DOUBLE
```

### 4.4 Use exact types for money or exact arithmetic when required

When financial correctness depends on exact arithmetic, the agent **MUST NOT** casually use `DOUBLE`.

Acceptable alternatives depend on QuestDB version and supported SQL/data type features:

- scaled integer minor units;
- fixed-point decimal if supported in target QuestDB version;
- authoritative calculations in OLTP/source system, with QuestDB storing analytical projections.

Example:

```sql
notional_minor LONG
currency SYMBOL
```

### 4.5 Use arrays only with explicit version and client compatibility

If using array types or ILP protocol features introduced in newer QuestDB versions, the agent **MUST** document:

- minimum QuestDB server version;
- client library version;
- protocol version;
- fallback strategy.

---

## 5. Partitioning Standards

### 5.1 Partition unit selection

Use this default heuristic:

| Workload                                          | Suggested partition |
| ------------------------------------------------- | ------------------- |
| ultra-high ingest, short retention, very hot data | `HOUR`              |
| common telemetry/events/trades                    | `DAY`               |
| medium-volume daily analytics                     | `DAY` or `WEEK`     |
| long-retention low-volume metrics                 | `MONTH`             |
| archival low-volume data                          | `MONTH` or `YEAR`   |

The agent **MUST NOT** default to `YEAR` for high-ingestion workloads.

The agent **MUST NOT** default to `HOUR` if it will create excessive partitions and operational overhead.

### 5.2 Partition must align with retention

If retention is 30 days, `DAY` partitioning is usually safer than `MONTH` because partition-level retention/drop is easier and more precise.

Bad:

```sql
PARTITION BY MONTH
-- but requirement says keep exactly 7 days
```

Good:

```sql
PARTITION BY DAY TTL 30 DAYS
```

### 5.3 Do not over-partition by non-time dimensions

QuestDB partitions by time. The agent **MUST NOT** invent table-per-tenant/table-per-symbol/table-per-device designs unless there is a documented retention, isolation, or operational reason.

Bad default:

```md
one table per device
one table per customer
one table per metric
```

Better default:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    tenant_id SYMBOL,
    device_id SYMBOL,
    metric_name SYMBOL,
    value DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

Exception: separate tables may be justified when data shape, retention, access control, or lifecycle is materially different.

---

## 6. WAL Standards

### 6.1 WAL must be explicit in DDL

Production DDL **SHOULD** include `WAL` explicitly.

Good:

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    symbol SYMBOL,
    price DOUBLE,
    size DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

The LLM/code agent **MUST NOT** rely on implicit defaults without documenting QuestDB version.

### 6.2 WAL configuration must be workload-aware

For high-throughput ingestion, the agent **MUST** consider:

- WAL apply worker count;
- maximum uncommitted rows;
- O3 max lag;
- WAL purge interval;
- WAL disk growth;
- ingestion visibility latency;
- commit batch shape.

The agent **MUST NOT** tune WAL settings blindly. Every non-default setting requires a reason.

Example documentation:

```md
WAL tuning:

- maxUncommittedRows increased because ingestion batches average 100k rows.
- o3MaxLag configured because late events commonly arrive within 30s.
- visibility latency accepted by dashboard SLA: <= 10s.
```

### 6.3 WAL disk growth must be monitored

Any production QuestDB deployment **MUST** monitor WAL disk usage and apply lag.

The agent **MUST** add operational guidance for:

- WAL apply backlog;
- disk pressure;
- ingestion error logs;
- failed table apply jobs;
- table suspended state if applicable;
- retention/drop partition effects.

---

## 7. Deduplication Standards

### 7.1 Deduplication requires WAL and designated timestamp in keys

If data can be retried or resent, deduplication **MUST** be considered.

Deduplication **REQUIRES**:

- WAL table;
- designated timestamp included in `UPSERT KEYS`;
- well-defined uniqueness key.

Example:

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    venue SYMBOL,
    trade_id SYMBOL,
    symbol SYMBOL,
    price DOUBLE,
    quantity DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL
DEDUP UPSERT KEYS(ts, venue, trade_id);
```

### 7.2 Deduplication must be a domain decision

The agent **MUST NOT** enable deduplication with arbitrary keys.

Bad:

```sql
DEDUP UPSERT KEYS(ts)
```

This can collapse unrelated events with the same timestamp.

Good:

```sql
DEDUP UPSERT KEYS(ts, source_id, event_id)
```

### 7.3 Deduplication is not retroactive cleanup

The agent **MUST NOT** claim enabling deduplication removes historical duplicates already stored.

If historical duplicates exist, the migration plan **MUST** include:

- create new deduplicated table;
- backfill with deterministic ordering;
- verify counts;
- cut over readers/writers;
- archive/drop old table.

### 7.4 Server-assigned timestamp may break dedup semantics

If the ingestion client uses server-side timestamp assignment, the agent **MUST** verify whether deduplication can work. Deduplication usually requires stable event timestamp values from the source.

---

## 8. Ingestion Standards

### 8.1 Prefer ILP/HTTP for application ingestion unless reason says otherwise

For application ingestion, ILP/HTTP **SHOULD** be the default because it is reliable and easier to debug.

ILP/TCP may be used for performance/legacy reasons, but the agent **MUST** document:

- transport;
- batching behavior;
- flush threshold;
- retry timeout;
- connection reuse;
- error handling;
- authentication/TLS;
- protocol version.

### 8.2 Batch ingestion is mandatory for high throughput

The LLM/code agent **MUST NOT** generate row-by-row ingestion loops for production high-volume workloads.

Bad:

```java
for (Reading reading : readings) {
    sender.row("sensor_readings", ...);
    sender.flush();
}
```

Good:

```java
try (Sender sender = Sender.fromConfig(
        "http::addr=questdb:9000;auto_flush_rows=5000;retry_timeout=10000;")) {
    for (Reading reading : readings) {
        sender.table("sensor_readings")
              .symbol("device_id", reading.deviceId())
              .doubleColumn("temperature", reading.temperature())
              .at(reading.eventTimestampMicros(), ChronoUnit.MICROS);
    }
    sender.flush();
}
```

### 8.3 Ingestion errors must be observable

The agent **MUST** implement:

- client-side error handling;
- retry with bounded backoff;
- circuit breaker or fail-fast behavior if QuestDB is unavailable;
- dropped-row accounting;
- ingestion-lag metrics;
- bad-row logging without sensitive data;
- dead-letter path if ingestion source cannot drop data.

### 8.4 Do not auto-create production tables accidentally

Auto table creation via ingestion can be useful in dev, but production ingestion **SHOULD** use pre-created schema.

The agent **MUST NOT** rely on accidental schema inference for production because it can produce wrong types, wrong partitioning, missing deduplication, or wrong timestamp.

### 8.5 Ingestion must preserve source identity

Every event stream **SHOULD** include enough source metadata to debug ingestion:

- `source_system`;
- `source_instance`;
- `event_id`;
- `ingested_at`;
- `schema_version`;
- `pipeline_id` if applicable.

This is especially important when QuestDB stores denormalized projections from Kafka, CDC, or edge devices.

---

## 9. Query Design Standards

### 9.1 Use time predicates

Every production query over large QuestDB tables **MUST** include a time window on the designated timestamp unless explicitly approved.

Good:

```sql
SELECT symbol, avg(price)
FROM trades
WHERE ts IN today()
GROUP BY symbol;
```

Good:

```sql
SELECT *
FROM sensor_readings
WHERE ts BETWEEN timestamp_sequence_start AND timestamp_sequence_end
  AND device_id = 'sensor-123';
```

### 9.2 Use `SAMPLE BY` for time-bucketed analytics

For time-bucketed queries, use `SAMPLE BY` rather than application-side bucketing.

Example:

```sql
SELECT
    ts,
    symbol,
    first(price) AS open,
    max(price) AS high,
    min(price) AS low,
    last(price) AS close,
    sum(quantity) AS volume
FROM trades
WHERE ts >= dateadd('d', -1, now())
SAMPLE BY 1m
ALIGN TO CALENDAR;
```

### 9.3 Use `LATEST BY` for latest-per-key lookups

For latest state per dimension, prefer QuestDB time-series SQL patterns such as `LATEST BY`, but ensure the table has a designated timestamp and query semantics are correct.

Example:

```sql
SELECT *
FROM sensor_readings
LATEST BY device_id;
```

If query scope should be limited:

```sql
SELECT *
FROM sensor_readings
WHERE ts >= dateadd('h', -1, now())
LATEST BY device_id;
```

### 9.4 Do not use unbounded dashboards

Dashboard queries **MUST** be bounded by:

- time range;
- dimension filter;
- row limit;
- pre-aggregation/materialized view;
- query timeout at API/client layer.

Bad:

```sql
SELECT *
FROM http_request_events
ORDER BY ts DESC;
```

Good:

```sql
SELECT *
FROM http_request_events
WHERE ts >= dateadd('m', -15, now())
ORDER BY ts DESC
LIMIT 500;
```

### 9.5 Explain expensive queries

Any query expected to run over large tables **SHOULD** be validated with `EXPLAIN`.

The agent **MUST** include an optimization note for:

- joins;
- large aggregations;
- full scans;
- latest-per-key queries;
- queries without symbol/time filters;
- dashboard queries.

---

## 10. Indexing Standards

### 10.1 Index only when query pattern justifies it

Indexes are not free. The agent **MUST NOT** add indexes reflexively.

Indexes **MAY** be appropriate for symbol columns frequently used in filters, joins, or distinct operations.

Example:

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    symbol SYMBOL INDEX,
    exchange SYMBOL,
    price DOUBLE,
    quantity DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;
```

### 10.2 Do not index high-cardinality fields blindly

The agent **MUST NOT** index:

- request ID;
- trace ID;
- user ID;
- event ID;
- transaction ID;

unless the lookup pattern and memory/storage cost are justified.

### 10.3 Posting/covering indexes require explicit version guard

If using newer posting or covering index features, the agent **MUST** state:

- QuestDB minimum version;
- why bitmap index is not enough;
- expected query benefit;
- fallback if target environment is older.

---

## 11. Materialized View Standards

### 11.1 Use materialized views for repeated heavy aggregations

Materialized views **SHOULD** be used for:

- dashboard aggregates;
- OHLC/candlestick rollups;
- fixed time-bucket summaries;
- expensive repeated `SAMPLE BY` queries;
- high-concurrency analytical reads.

Example:

```sql
CREATE MATERIALIZED VIEW trades_ohlc_1m AS
SELECT
    ts,
    symbol,
    first(price) AS open,
    max(price) AS high,
    min(price) AS low,
    last(price) AS close,
    sum(quantity) AS volume
FROM trades
SAMPLE BY 1m;
```

### 11.2 Materialized views must not hide unclear semantics

Before creating a materialized view, the agent **MUST** define:

- base table;
- grain of the view;
- bucket size;
- time alignment;
- allowed staleness;
- retention;
- rebuild plan;
- storage impact;
- downstream owners.

### 11.3 Do not use materialized views for arbitrary enrichment

Materialized views are not a generic ETL replacement. The agent **MUST NOT** create materialized views for complex domain enrichment unless QuestDB supports the required query shape and the semantics are tested.

---

## 12. Retention and Lifecycle Standards

### 12.1 Retention must be explicit

Every production table **MUST** define retention:

```md
Retention:

- Raw data: 30 days
- Aggregated 1m data: 1 year
- Aggregated 1h data: 7 years
```

If no deletion is allowed due to compliance, state that explicitly.

### 12.2 Prefer TTL/partition-level lifecycle for time-series data

Where supported, use TTL or partition-level lifecycle management.

Example:

```sql
CREATE TABLE sensor_readings (
    ts TIMESTAMP,
    device_id SYMBOL,
    temperature DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
TTL 90 DAYS
WAL;
```

If TTL is not used, the agent **MUST** provide manual partition drop procedure and safety checks.

### 12.3 Retention must align with partitioning

Bad:

```sql
PARTITION BY MONTH TTL 7 DAYS
```

This is usually misaligned and can retain or drop data at an unexpected granularity.

Good:

```sql
PARTITION BY DAY TTL 7 DAYS
```

### 12.4 Deletion/mutation must be avoided for hot data

QuestDB should be modeled as append-heavy. The agent **MUST NOT** design frequent arbitrary updates/deletes into hot paths.

For corrections, prefer:

- deduplication with stable keys;
- correction events;
- rebuild derived tables;
- create-new-table-and-cutover strategy.

---

## 13. Out-of-Order and Late Data Standards

### 13.1 Late-arrival policy is mandatory

The agent **MUST** define late-arrival behavior:

```md
Late data policy:

- Expected lateness: <= 5 minutes
- Max tolerated lateness: 24 hours
- Query correctness impact: dashboards may update retroactively
- Deduplication: enabled on ts + source + event_id
- Alert if late rate > 1%
```

### 13.2 Do not assume append-order equals event-order

Events may arrive late from:

- edge devices;
- Kafka replay;
- CDC repair;
- network partitions;
- batch import;
- clock skew;
- retry pipelines.

The agent **MUST** model this explicitly.

### 13.3 Store ingestion timestamp separately

For delayed data troubleshooting, store both:

```sql
event_ts TIMESTAMP,
ingested_at TIMESTAMP
```

The agent **SHOULD** measure `ingested_at - event_ts` as ingestion lag.

---

## 14. Schema Evolution Standards

### 14.1 Schema changes must be migration-controlled

The agent **MUST NOT** rely on ad-hoc production schema mutation.

Every change requires:

- migration file;
- backward compatibility analysis;
- ingestion client compatibility;
- query compatibility;
- rollback/cutover plan;
- validation query;
- storage impact estimate.

### 14.2 Additive changes are preferred

Safe-ish changes:

- add nullable column;
- add new symbol/dimension;
- add materialized view;
- add index after testing.

Risky changes:

- change designated timestamp;
- change partitioning;
- change type of existing column;
- split table grain;
- rewrite historical rows;
- change deduplication keys.

### 14.3 Partitioning and designated timestamp changes require rebuild

If partitioning or designated timestamp must change, the agent **MUST** propose:

1. create new table;
2. backfill from old table/source;
3. validate row counts and time windows;
4. dual-write or pause writes if needed;
5. cut over readers;
6. decommission old table.

---

## 15. Application Integration Standards

### 15.1 QuestDB access must be isolated behind a repository/query service

Application code **MUST NOT** scatter raw SQL everywhere.

Use a dedicated adapter:

```text
application
  -> analytics repository
  -> QuestDB client
```

The adapter owns:

- SQL templates;
- query timeouts;
- result mapping;
- retry policy;
- metric labels;
- error translation;
- version-specific SQL.

### 15.2 Read APIs must enforce safety limits

Every API reading from QuestDB **MUST** enforce:

- maximum time range;
- maximum row limit;
- allowed dimensions;
- query timeout;
- authorization filter;
- pagination/cursor if needed;
- rate limit for expensive queries.

### 15.3 User-provided SQL is forbidden by default

The agent **MUST NOT** expose arbitrary SQL execution to users.

If internal analytics requires ad-hoc SQL:

- restrict to trusted users;
- use separate credentials;
- enforce read-only;
- audit query text;
- set timeout/limit;
- prevent access to sensitive tables.

---

## 16. Security Standards

### 16.1 Do not expose QuestDB directly to the public internet

QuestDB **MUST** be network-restricted.

Allowed access patterns:

- private subnet;
- VPN/bastion;
- service-to-service private network;
- internal API service;
- managed platform private endpoint if available.

### 16.2 Credentials must not be hardcoded

Connection strings, tokens, passwords, and TLS keys **MUST** come from secret management.

Bad:

```yaml
QUESTDB_PASSWORD: admin
```

Good:

```yaml
QUESTDB_PASSWORD:
  valueFrom:
    secretKeyRef:
      name: questdb-credentials
      key: password
```

### 16.3 TLS and authentication must match deployment risk

For production:

- enable TLS where network risk requires it;
- use strong authentication;
- avoid shared admin credentials;
- rotate secrets;
- separate read/write users;
- use least privilege if Enterprise RBAC is available.

### 16.4 QuestDB does not replace application authorization

The application/API layer **MUST** enforce tenant/user authorization before querying QuestDB.

For multi-tenant data, every query **MUST** include a tenant/domain filter unless table-level isolation exists.

Bad:

```sql
SELECT *
FROM tenant_events
WHERE ts >= dateadd('h', -1, now());
```

Good:

```sql
SELECT *
FROM tenant_events
WHERE tenant_id = :tenant_id
  AND ts >= dateadd('h', -1, now());
```

---

## 17. Operational Standards

### 17.1 Required monitoring

Production QuestDB deployments **MUST** monitor:

- process CPU;
- memory;
- disk usage;
- disk I/O;
- table size;
- partition count;
- WAL apply lag;
- WAL disk growth;
- ingestion throughput;
- rejected/invalid ILP rows;
- query latency;
- slow queries;
- connection count;
- backup success/failure;
- retention execution;
- materialized view freshness;
- replication/HA status if used.

### 17.2 Required alerts

Alerts **MUST** exist for:

- disk near full;
- WAL backlog growing;
- ingestion failure rate;
- query latency SLO breach;
- rejected rows;
- table suspended/failed apply state if applicable;
- retention not running;
- backup failure;
- memory pressure;
- service unavailable.

### 17.3 Backups and rebuilds

The agent **MUST** define whether data is:

- reconstructable from Kafka/source files/object storage;
- non-reconstructable and requires backup;
- partially reconstructable with accepted data loss.

If QuestDB is a projection, rebuilding from source may be preferred. If QuestDB holds unique data, backup and restore must be tested.

### 17.4 Capacity planning is mandatory

Before production, the agent **MUST** estimate:

- rows per second;
- bytes per row;
- daily storage;
- retention storage;
- partition count;
- symbol cardinality;
- query concurrency;
- dashboard refresh rate;
- WAL volume;
- CPU/memory/disk headroom.

---

## 18. High Availability and Disaster Recovery Standards

### 18.1 State the availability model

The agent **MUST** document:

```md
Availability model:

- Single-node acceptable? yes/no
- RPO:
- RTO:
- Backup strategy:
- Rebuild source:
- Replication/Enterprise feature usage:
- Failure mode during QuestDB outage:
```

### 18.2 Do not pretend single-node equals HA

If deployment is single-node, the agent **MUST** state:

- what happens during node loss;
- whether ingestion buffers upstream;
- whether data can be replayed;
- whether reads are unavailable;
- operational recovery steps.

### 18.3 Ingestion pipeline must tolerate QuestDB outage

For production event pipelines, source systems **SHOULD** buffer/replay through Kafka, durable queue, object storage, or WAL-capable source rather than dropping data silently.

---

## 19. Performance Standards

### 19.1 Optimize around query shape, not generic indexing

QuestDB performance depends heavily on:

- designated timestamp;
- partition pruning;
- columnar access;
- symbol filtering;
- time-windowed queries;
- batching;
- materialized views;
- avoiding huge unbounded scans.

The agent **MUST** optimize based on query patterns, not generic RDBMS instincts.

### 19.2 Avoid wide unbounded scans

Bad:

```sql
SELECT *
FROM events
WHERE event_type = 'ERROR';
```

Good:

```sql
SELECT ts, service_name, error_code, message
FROM events
WHERE ts >= dateadd('h', -6, now())
  AND event_type = 'ERROR'
LIMIT 1000;
```

### 19.3 Avoid unnecessary high-cardinality dimensions

High-cardinality dimensions can harm memory/query performance when modeled incorrectly.

The agent **MUST** classify each dimension:

```md
Dimension: device_id
Cardinality: 500k
Used for filtering: yes
Used for grouping: occasionally
Recommended type: SYMBOL NOCACHE or VARCHAR depending query/memory test
Index: no until benchmark proves need
```

### 19.4 Benchmark ingestion and queries with realistic data

The agent **MUST NOT** claim QuestDB performance based on toy datasets.

Production readiness requires:

- realistic row size;
- realistic cardinality;
- realistic late data;
- realistic query windows;
- realistic dashboard concurrency;
- retention/TTL behavior;
- bulk backfill behavior.

---

## 20. Common Design Patterns

### 20.1 Raw event table + aggregated materialized views

Use this when raw data is needed but dashboards must be fast.

```sql
CREATE TABLE trades (
    ts TIMESTAMP,
    symbol SYMBOL,
    venue SYMBOL,
    price DOUBLE,
    quantity DOUBLE
) TIMESTAMP(ts)
PARTITION BY DAY
WAL;

CREATE MATERIALIZED VIEW trades_ohlc_1m AS
SELECT
    ts,
    symbol,
    first(price) AS open,
    max(price) AS high,
    min(price) AS low,
    last(price) AS close,
    sum(quantity) AS volume
FROM trades
SAMPLE BY 1m;
```

### 20.2 OLTP source + QuestDB analytical projection

Use this when transactional correctness lives elsewhere.

```text
PostgreSQL/MySQL source of truth
  -> outbox/CDC/event stream
  -> ingestion service
  -> QuestDB projection
  -> dashboard/API analytical reads
```

Rules:

- OLTP owns invariant.
- QuestDB owns analytical/time-series read model.
- Projection is rebuildable.
- Deduplication/idempotency is explicit.
- Version/lag is observable.

### 20.3 Kafka/stream source + QuestDB sink

Use this when data is replayable.

```text
Kafka topic
  -> sink/ingestion service
  -> QuestDB table
```

Rules:

- Kafka offset checkpointing is safe.
- QuestDB writes are idempotent or replay-safe.
- Dedup keys are stable.
- QuestDB outage does not lose Kafka data.
- Replay/backfill process is documented.

### 20.4 Latest state query from event stream

Use `LATEST BY` for latest state, but do not confuse latest analytical view with transactional source of truth.

Example:

```sql
SELECT *
FROM sensor_readings
WHERE ts >= dateadd('d', -1, now())
LATEST BY device_id;
```

If latest state is used for business decisions, verify freshness and authorization.

---

## 21. Anti-Patterns

### 21.1 QuestDB as OLTP source of truth

Bad:

```text
Order lifecycle stored only in QuestDB.
Approval state changed by appending rows and reading latest row.
No transactional constraints.
```

Why bad:

- weak enforcement for workflow invariants;
- difficult authorization and correction;
- eventual query semantics;
- no proper relational constraints.

### 21.2 No designated timestamp

Bad:

```sql
CREATE TABLE logs (
    service STRING,
    message STRING,
    ts TIMESTAMP
);
```

Why bad:

- loses time-series optimization;
- disables important time-series semantics;
- encourages full scans.

### 21.3 No partitioning

Bad:

```sql
CREATE TABLE events (
    ts TIMESTAMP,
    event_type SYMBOL,
    payload STRING
) TIMESTAMP(ts);
```

Why bad:

- poor retention/drop strategy;
- less predictable operations;
- high-volume table becomes harder to manage.

### 21.4 One table per metric/device by default

Bad:

```text
cpu_usage_service_a
cpu_usage_service_b
cpu_usage_service_c
```

Why bad:

- table explosion;
- operational overhead;
- bad query ergonomics;
- harder lifecycle management.

### 21.5 Blind `SYMBOL` for unique IDs

Bad:

```sql
request_id SYMBOL
trace_id SYMBOL
session_id SYMBOL
```

Why bad:

- potentially huge symbol dictionaries;
- memory pressure;
- little query benefit if not grouped/filtered repeatedly.

### 21.6 Deep dashboard scan

Bad:

```sql
SELECT *
FROM events
ORDER BY ts DESC;
```

Why bad:

- no time bound;
- unbounded cost;
- dashboard can degrade cluster.

### 21.7 Application-side time bucketing

Bad:

```text
Fetch millions of rows into API service, then group by minute in Java/Node.
```

Why bad:

- unnecessary data transfer;
- memory pressure;
- worse latency;
- database cannot optimize.

### 21.8 Dedup with timestamp-only key

Bad:

```sql
DEDUP UPSERT KEYS(ts)
```

Why bad:

- different events can share timestamp;
- data loss/corruption risk.

### 21.9 Hidden retention policy

Bad:

```md
"Keep data for now; decide later."
```

Why bad:

- disk growth;
- unclear compliance;
- emergency delete later.

### 21.10 No rebuild story

Bad:

```md
QuestDB projection populated from stream, but no replay/backfill plan.
```

Why bad:

- schema changes become risky;
- corrupted projections cannot be fixed safely.

---

## 22. Mandatory Review Checklist

Before approving QuestDB changes, verify:

```md
QuestDB Review Checklist:

- [ ] QuestDB is appropriate for the workload.
- [ ] QuestDB is not used as OLTP source of truth.
- [ ] Table grain is documented.
- [ ] Designated timestamp is declared.
- [ ] Timestamp precision is documented.
- [ ] Partitioning strategy is explicit.
- [ ] WAL decision is explicit.
- [ ] Retention/TTL/drop policy is explicit.
- [ ] Deduplication policy is explicit if retries/replays exist.
- [ ] Dedup keys include designated timestamp.
- [ ] Late/out-of-order data behavior is documented.
- [ ] Ingestion method is documented.
- [ ] Batching and retry behavior are implemented.
- [ ] Invalid row handling is observable.
- [ ] Query time windows are enforced.
- [ ] API queries have max range and row limits.
- [ ] High-cardinality symbol use is justified.
- [ ] Indexes are justified by query patterns.
- [ ] Materialized views have grain/staleness/rebuild plan.
- [ ] Security/network exposure is controlled.
- [ ] Credentials are managed as secrets.
- [ ] Tenant/user authorization is enforced outside QuestDB.
- [ ] Monitoring and alerts are defined.
- [ ] Backup or rebuild strategy is defined.
- [ ] Migration/cutover plan exists for risky schema changes.
```

---

## 23. Acceptance Criteria

A QuestDB implementation is acceptable only if:

1. It has a documented fit assessment.
2. It defines table grain and time model.
3. It uses designated timestamp for time-series data.
4. It uses explicit partitioning.
5. It defines WAL/dedup/retention policies.
6. It handles ingestion batching, retry, and observability.
7. It has bounded query patterns.
8. It avoids using QuestDB as transactional source of truth.
9. It has clear rebuild/backup strategy.
10. It has security and operational controls.

---

## 24. LLM Enforcement Prompt Snippet

Use this snippet in agent instructions:

```md
When generating QuestDB-related code, SQL, schema, ingestion clients, infrastructure, or documentation:

1. First classify whether QuestDB is appropriate.
2. Never use QuestDB as the authoritative OLTP source of truth for business invariants.
3. Every time-series table must define grain, designated timestamp, partitioning, WAL decision, retention, and deduplication policy.
4. Prefer WAL tables for production ingestion.
5. If deduplication is needed, require WAL and include the designated timestamp in UPSERT KEYS.
6. Prefer ILP/HTTP for application ingestion unless a reason exists otherwise.
7. Batch writes; never flush per row in production.
8. Bound every large query by time range and row limit.
9. Use SYMBOL only for repeated categorical dimensions; avoid blindly using cached SYMBOL for high-cardinality IDs.
10. Use materialized views for repeated heavy aggregations.
11. Never expose arbitrary SQL or QuestDB directly to public users.
12. Add monitoring for WAL lag, disk, ingestion errors, query latency, and retention.
13. Reject designs without a backup/rebuild story.
```

---

## 25. Minimal Production Table Template

```sql
CREATE TABLE <table_name> (
    event_ts TIMESTAMP,
    ingested_at TIMESTAMP,
    source_system SYMBOL,
    event_id SYMBOL,
    <dimension_1> SYMBOL,
    <dimension_2> SYMBOL,
    <metric_1> DOUBLE,
    <metric_2> LONG,
    schema_version SHORT
) TIMESTAMP(event_ts)
PARTITION BY DAY
TTL 90 DAYS
WAL
DEDUP UPSERT KEYS(event_ts, source_system, event_id);
```

Adapt:

- partition unit;
- TTL;
- dedup keys;
- symbol caching;
- indexes;
- metric types;
- timestamp precision;

based on actual workload.

---

## 26. Minimal Safe Query Template

```sql
SELECT
    event_ts,
    <dimension>,
    <metric>
FROM <table_name>
WHERE event_ts >= :from_ts
  AND event_ts < :to_ts
  AND <authorized_dimension> = :authorized_value
ORDER BY event_ts DESC
LIMIT :limit;
```

Rules:

- `:from_ts` and `:to_ts` are required.
- `:limit` must have a server-side maximum.
- tenant/user authorization filter is required where applicable.
- no user-provided raw SQL.

---

## 27. Source References

This standard is based on the following primary references:

- QuestDB documentation: `CREATE TABLE`, designated timestamp, partitioning, WAL, TTL, deduplication, and table metadata.
- QuestDB documentation: InfluxDB Line Protocol ingestion over HTTP/TCP and client behavior.
- QuestDB documentation: `SYMBOL`, symbol cache, indexes, `EXPLAIN`, and materialized views.
- QuestDB documentation: data retention, partition management, and operational configuration.
- QuestDB release notes for version-sensitive behavior such as protocol v2, arrays, symbol auto-scaling, and recent index/materialized view enhancements.

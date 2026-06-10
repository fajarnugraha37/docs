# Strict General Standards: ClickHouse

> Mandatory conventions for LLMs/code agents when designing, implementing, reviewing, or modifying ClickHouse-backed systems.

---

## 1. Purpose

This document defines strict standards for using ClickHouse as a high-performance analytical database.

The goal is to prevent LLMs/code agents from treating ClickHouse like a generic SQL database, OLTP database, queue, cache, or search engine. Every ClickHouse implementation must make query shape, ingestion model, data layout, retention, and operational behavior explicit.

---

## 2. Non-Negotiable Principles

### 2.1 ClickHouse is OLAP-first

ClickHouse must be used for:

- analytical queries over large volumes of data;
- append-heavy event, metric, log, audit, telemetry, fact, or reporting data;
- denormalized read models;
- time-series analytics;
- aggregation-heavy workloads;
- real-time dashboards where query latency matters;
- columnar scans and selective reads.

ClickHouse must not be used as the default store for:

- transactional business invariants;
- highly normalized OLTP write models;
- row-by-row updates;
- high-frequency deletes;
- relational constraint enforcement;
- workflow state mutation requiring strict transaction semantics;
- primary user/session/auth storage;
- distributed lock coordination.

If business correctness depends on transactional constraints, use an OLTP database as the source of truth and replicate/derive ClickHouse tables for analytics.

### 2.2 Design for queries before writing DDL

The LLM must not create a ClickHouse table before documenting:

- primary query patterns;
- common filters;
- common grouping keys;
- common sorting needs;
- expected time range filters;
- expected cardinality of key columns;
- ingestion rate;
- retention period;
- freshness requirement;
- acceptable duplicate behavior;
- expected update/delete behavior;
- expected data volume per day/month.

DDL without a query model is rejected.

### 2.3 Physical layout is part of the contract

In ClickHouse, table engine, partition key, `ORDER BY`, primary key, sampling key, TTL, codecs, and materialized views are not implementation details. They define correctness, performance, cost, and operability.

The LLM must treat these choices as architecture decisions.

### 2.4 Append-first by default

ClickHouse implementations must prefer:

- append-only ingestion;
- immutable facts;
- versioned rows;
- replacement/collapsing semantics where justified;
- batch inserts;
- background merge-aware design.

The LLM must not design ClickHouse around frequent row-level mutation unless it provides a strong justification and operational mitigation.

---

## 3. Required Design Questions

Before implementing ClickHouse, the LLM must answer:

```md
## ClickHouse Design Gate

1. What analytical questions will this table answer?
2. What is the source of truth?
3. Is the table raw, clean, curated, aggregate, or serving-layer data?
4. What is the expected insert rate?
5. What is the expected query concurrency?
6. What is the expected row count per day/month?
7. What columns appear in WHERE clauses most often?
8. What columns appear in GROUP BY clauses most often?
9. What time range is commonly queried?
10. What is the retention period?
11. What duplicate behavior is acceptable?
12. What update/delete behavior is required?
13. What freshness SLA is required?
14. What is the partition key and why?
15. What is the ORDER BY key and why?
16. What is the table engine and why?
17. What is the distributed/sharding model, if any?
18. What monitoring proves the design is healthy?
```

If these answers are missing, the LLM must stop and produce the design first.

---

## 4. Engine Selection Standards

### 4.1 Default engine

Use `MergeTree` family tables for most production analytical workloads.

Allowed default:

```sql
ENGINE = MergeTree
PARTITION BY ...
ORDER BY (...)
```

### 4.2 Replicated tables

Use `ReplicatedMergeTree` family when:

- high availability is required;
- data must survive node loss;
- the table is part of a cluster;
- distributed queries target replicas;
- production reliability matters.

The LLM must not use non-replicated tables for production clustered deployments unless the data is disposable or externally recoverable.

### 4.3 ReplacingMergeTree

Use `ReplacingMergeTree` only when:

- duplicate versions of the same logical row may arrive;
- eventual deduplication is acceptable;
- queries either tolerate duplicates or explicitly use a safe deduplication strategy;
- the `ORDER BY` key identifies the logical row;
- a version column exists when latest-version semantics matter.

Mandatory warning:

```md
ReplacingMergeTree deduplication happens during background merges and is not immediate. Query correctness must not silently depend on instant deduplication.
```

### 4.4 SummingMergeTree / AggregatingMergeTree

Use aggregate engines only when:

- the aggregate semantics are mathematically valid;
- duplicate ingestion behavior is understood;
- aggregate state columns are correctly typed;
- late-arriving data behavior is documented;
- downstream queries are tested.

Do not use aggregate engines as a shortcut to avoid proper materialized view design.

### 4.5 Collapsing engines

Use `CollapsingMergeTree` or `VersionedCollapsingMergeTree` only when:

- sign/version semantics are explicitly modeled;
- producers can emit consistent positive/negative rows;
- out-of-order arrival behavior is understood;
- queries are tested before and after merges.

These engines are forbidden for simple CRUD replacement unless the LLM proves why simpler versioned append or `ReplacingMergeTree` is insufficient.

### 4.6 Distributed engine

Use `Distributed` tables only as a routing/query layer over local shard tables.

Mandatory rules:

- Define local tables first.
- Define distributed tables separately.
- Do not store data directly only in `Distributed` without understanding insert forwarding semantics.
- Document sharding key.
- Ensure sharding key matches query and ingestion behavior.
- Avoid random sharding if queries usually filter by tenant/account/customer/time.

---

## 5. Database and Table Ownership

Every ClickHouse table must have:

```md
Owner: <service/team>
Purpose: <analytics/reporting/serving purpose>
Source of truth: <upstream DB/topic/file/API>
Data freshness SLA: <e.g. 5 seconds, 5 minutes, 1 hour>
Retention: <duration>
Rebuild strategy: <from source / replay / backup>
Primary queries: <query list>
```

Tables without ownership or rebuild strategy are rejected.

---

## 6. Layering Standards

Prefer explicit analytical layers:

```text
raw_*        = minimally transformed ingested data
clean_*      = typed, normalized, quality-checked records
curated_*    = business-oriented denormalized facts/dimensions
agg_*        = pre-aggregated serving tables
serving_*    = stable API/dashboard-facing tables
```

Rules:

- Raw tables should preserve source fields and ingestion metadata.
- Clean tables should enforce types and parse timestamps.
- Curated tables should encode business semantics.
- Aggregate tables should document grain and aggregation logic.
- Serving tables should be stable for external consumers.

The LLM must not mix raw ingestion, transformation, and serving semantics into a single unclear table unless the dataset is small and explicitly temporary.

---

## 7. Schema Design Standards

### 7.1 Use explicit types

Do not use loosely typed strings for known structured data.

Prefer:

- `Date` / `Date32` for dates;
- `DateTime64` for timestamps requiring precision;
- `LowCardinality(String)` for repeated low-cardinality strings;
- `Enum` only for stable, controlled values;
- `UInt*` / `Int*` with deliberate range choices;
- `Decimal` for money-like exact values;
- `UUID` for UUID values;
- `IPv4` / `IPv6` for IP addresses;
- `Array`, `Map`, `Tuple`, `Nested` only when query patterns justify them.

Avoid:

- stringly typed timestamps;
- stringly typed numbers;
- unnecessary `Nullable`;
- arbitrary JSON blobs as the main query model;
- `Float` for money;
- very wide tables without query justification.

### 7.2 Nullable columns

`Nullable` must be justified.

Prefer domain defaults when correct:

- empty string for optional display text only when semantically safe;
- `0` only when zero is semantically distinct and valid;
- sentinel values only if documented;
- separate `has_*` boolean if needed.

Do not use `Nullable` reflexively. It adds storage/query overhead and complicates predicates.

### 7.3 Time columns

Every event/fact table should distinguish:

```text
event_time       = when the business/event actually happened
ingested_at      = when ClickHouse received the row
source_updated_at = when the upstream record changed, if applicable
processed_at     = when pipeline transformation occurred, if applicable
```

Do not use only `created_at` without defining whose time it represents.

### 7.4 Monetary values

Use `Decimal` for exact monetary values.

Rejected:

```sql
amount Float64
```

Preferred:

```sql
amount Decimal(18, 2)
currency FixedString(3)
```

### 7.5 IDs and dimensions

Rules:

- Use stable IDs for joins and grouping.
- Keep high-cardinality identifiers out of early `ORDER BY` positions unless query filters justify it.
- Use `LowCardinality` for repeated textual dimensions with limited cardinality.
- Do not use `LowCardinality` blindly for near-unique values.

---

## 8. Partition Key Standards

### 8.1 Partitioning purpose

Partitioning is primarily for:

- data management;
- retention/TTL;
- partition pruning;
- efficient drop of old data;
- operational maintenance.

Partitioning is not the same as indexing.

### 8.2 Required partition rule

For time-series/fact/event tables, default to partitioning by event date/month based on retention and volume.

Examples:

```sql
PARTITION BY toYYYYMM(event_date)
```

or:

```sql
PARTITION BY toYYYYMMDD(event_date)
```

Choose granularity based on:

- daily volume;
- retention period;
- TTL/drop strategy;
- query time range;
- number of partitions created;
- merge overhead.

### 8.3 Avoid over-partitioning

Forbidden unless justified:

```sql
PARTITION BY user_id
PARTITION BY request_id
PARTITION BY event_timestamp
PARTITION BY (tenant_id, toStartOfMinute(event_time))
```

Over-partitioning creates too many parts/partitions and damages merge performance.

### 8.4 Tenant partitioning

Do not partition by tenant by default.

Tenant in partition key is allowed only when:

- tenant count is small and stable;
- retention/deletion is tenant-specific;
- operational isolation requires it;
- partition explosion is impossible or mitigated.

Usually prefer tenant in `ORDER BY`, not `PARTITION BY`.

---

## 9. ORDER BY and Primary Index Standards

### 9.1 ORDER BY is the most important design decision

In MergeTree, `ORDER BY` defines physical sorting and sparse primary index behavior.

The LLM must choose `ORDER BY` from actual query predicates, not from entity identity conventions.

### 9.2 Key ordering rule

Choose `ORDER BY` columns using this priority:

1. columns frequently used in filters;
2. low-to-medium cardinality dimensions first;
3. time column near the end for time-range locality;
4. high-cardinality unique ID only when needed for deduplication or point lookup;
5. avoid columns that are rarely filtered.

Example for tenant time-series analytics:

```sql
ORDER BY (tenant_id, event_type, event_date, event_time, event_id)
```

Example for global event analytics:

```sql
ORDER BY (event_date, event_type, event_time)
```

### 9.3 Do not copy OLTP primary key design

Rejected:

```sql
ORDER BY id
```

unless point lookup by `id` is the dominant query.

In ClickHouse, the `ORDER BY` key is not a relational primary key. It is a data skipping and physical layout tool.

### 9.4 ORDER BY and deduplication

For `ReplacingMergeTree`, the `ORDER BY` key determines rows considered duplicates.

If latest record per logical ID is required:

```sql
ENGINE = ReplacingMergeTree(version)
ORDER BY (tenant_id, logical_entity_id)
```

Do not append random/event timestamp columns to `ORDER BY` if they prevent duplicate rows from collapsing.

### 9.5 Primary key clause

When using a separate `PRIMARY KEY`, ensure it is a prefix of `ORDER BY` and intentionally chosen.

Do not specify a separate `PRIMARY KEY` unless there is a clear reason.

---

## 10. Ingestion Standards

### 10.1 Batch inserts are mandatory by default

ClickHouse performs best with batched inserts.

The LLM must avoid row-by-row inserts.

Rejected:

```text
Insert one row per HTTP request into ClickHouse.
```

Preferred:

```text
Buffer records and insert in batches by size/time threshold.
```

Recommended design dimensions:

```md
Batch size: <rows/bytes>
Flush interval: <duration>
Retry policy: <bounded retry with idempotency>
Deduplication: <strategy>
Backpressure: <behavior>
Failure sink: <DLQ/object storage/replay topic>
```

### 10.2 Pre-sort large batches when useful

If ingestion can pre-sort by `ORDER BY` key cheaply, do it for large batch loads.

This can reduce server-side sorting overhead.

### 10.3 Use async inserts carefully

Async inserts are allowed when:

- freshness SLA tolerates buffering;
- client retry behavior is understood;
- deduplication strategy exists;
- monitoring tracks failures and delays;
- the application understands acknowledgement semantics.

Do not enable async insert as a hidden fix for poor batching without explaining trade-offs.

### 10.4 Ingestion metadata

Every ingestion pipeline should include metadata columns when useful:

```sql
ingested_at DateTime64(3) DEFAULT now64(3),
source_system LowCardinality(String),
source_partition String,
source_offset UInt64,
source_event_id String,
pipeline_version String
```

For Kafka ingestion, keep topic/partition/offset when replay/debug matters.

### 10.5 Idempotency and deduplication

The LLM must define duplicate behavior:

- duplicates impossible by source guarantee;
- duplicates acceptable for approximate analytics;
- duplicates removed by `ReplacingMergeTree` eventually;
- duplicates removed in materialized clean layer;
- duplicates removed by upstream idempotency;
- duplicates handled by aggregate model.

Never claim exactly-once ingestion without defining the complete end-to-end boundary.

---

## 11. Kafka / CDC Ingestion Standards

When ingesting from Kafka or Debezium:

- document topic ownership;
- preserve event key;
- preserve source offset metadata if needed;
- define delete/tombstone behavior;
- define update semantics;
- define schema evolution rules;
- define replay strategy;
- define deduplication model;
- define late/out-of-order event handling.

CDC raw data should usually land in raw tables first, then transform into curated analytics tables.

Do not expose raw Debezium envelopes directly to business dashboards unless explicitly intended.

---

## 12. Materialized View Standards

### 12.1 Use materialized views for transformation and pre-aggregation

Use materialized views when:

- converting raw ingestion into clean/curated tables;
- precomputing aggregates;
- maintaining serving tables;
- changing physical order/model for query performance;
- deriving dimension/fact models.

### 12.2 Always create explicit target tables

Preferred:

```sql
CREATE TABLE agg_daily_events (...)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, event_type);

CREATE MATERIALIZED VIEW mv_raw_to_agg_daily_events
TO agg_daily_events
AS
SELECT ...
FROM raw_events
GROUP BY ...;
```

Avoid hidden implicit target tables unless for quick experiments.

### 12.3 Materialized views process inserted blocks

The LLM must account for the fact that materialized views react to inserted data. Existing data requires backfill.

Mandatory backfill plan:

```md
Backfill source: <table/query/file/topic>
Backfill method: INSERT INTO target SELECT ...
Duplicate handling: <strategy>
Cutover plan: <alias/view/application switch>
Validation: <row counts/checksums/metric comparison>
```

### 12.4 Late-arriving data

If materialized view aggregates by time bucket, define late event behavior:

- accepted and aggregated into old bucket;
- rejected after watermark;
- corrected by periodic rebuild;
- handled by versioned aggregate table;
- handled by compensating events.

---

## 13. Projection Standards

Use projections only when:

- a table needs alternative physical ordering;
- the query optimizer can benefit automatically;
- storage/write overhead is acceptable;
- limitations around TTL, joins, filters, lightweight updates/deletes are acceptable;
- performance is measured before/after.

Do not add projections blindly.

Decision rule:

```md
First: design correct ORDER BY.
Second: optimize query and filters.
Third: consider materialized view if transformed/filtered/joined/aggregated serving model is needed.
Fourth: consider projection for alternate ordering or pre-aggregation on the same table.
```

---

## 14. Data Skipping Index Standards

Data skipping indexes are optional optimization tools, not a replacement for good `ORDER BY`.

Allowed when:

- query pattern is stable;
- indexed column has clustering/correlation with physical order;
- selectivity is useful;
- benchmark proves fewer rows/marks read;
- index maintenance cost is acceptable.

Rejected:

```sql
Add skip indexes to every commonly filtered column.
```

The LLM must include `EXPLAIN`/query-log evidence or a benchmark plan for new skip indexes.

---

## 15. Query Design Standards

### 15.1 Always filter by partition/time when possible

For large fact tables, queries must include bounded time filters unless the use case explicitly requires all-history scan.

Rejected:

```sql
SELECT count(*) FROM events WHERE tenant_id = 't1';
```

Preferred:

```sql
SELECT count(*)
FROM events
WHERE tenant_id = 't1'
  AND event_date >= today() - 7;
```

### 15.2 Select only required columns

Because ClickHouse is columnar, selecting fewer columns matters.

Rejected:

```sql
SELECT * FROM large_events WHERE ...
```

Preferred:

```sql
SELECT event_date, event_type, count()
FROM large_events
WHERE ...
GROUP BY event_date, event_type;
```

### 15.3 Use PREWHERE-aware predicates

Let ClickHouse optimize predicates, but design queries so selective predicates can reduce read volume early.

Do not hide indexed/filter columns behind unnecessary functions when it prevents pruning.

Rejected:

```sql
WHERE formatDateTime(event_time, '%Y-%m-%d') = '2026-06-10'
```

Preferred:

```sql
WHERE event_time >= toDateTime('2026-06-10 00:00:00')
  AND event_time <  toDateTime('2026-06-11 00:00:00')
```

### 15.4 Avoid unbounded ORDER BY

Rejected on large data:

```sql
SELECT ... FROM events ORDER BY event_time DESC
```

Preferred:

```sql
SELECT ...
FROM events
WHERE event_date >= today() - 1
ORDER BY event_time DESC
LIMIT 1000;
```

### 15.5 JOINs must be justified

ClickHouse can perform joins, but the LLM must justify:

- table sizes;
- join key cardinality;
- join algorithm/settings if relevant;
- memory impact;
- whether denormalization or dictionary is better;
- whether the join belongs in ingestion/transformation instead of serving query.

Do not port OLTP-style normalized query graphs directly into ClickHouse.

### 15.6 Aggregation correctness

Every aggregate query must define:

- grain;
- grouping columns;
- time bucket;
- duplicate behavior;
- null/default behavior;
- approximate vs exact aggregates.

Use approximate aggregate functions only when approximation is acceptable and documented.

---

## 16. Pagination Standards

ClickHouse is not designed for OLTP-style offset pagination over huge result sets.

Avoid:

```sql
LIMIT 100 OFFSET 1000000
```

Prefer:

- bounded analytical queries;
- time-window pagination;
- keyset-style pagination where applicable;
- export job for large result sets;
- materialized serving table for UI browsing.

UI APIs must not expose arbitrary unbounded ClickHouse scans.

---

## 17. Mutation and Delete Standards

### 17.1 Avoid frequent mutations

Avoid designs requiring frequent:

- `ALTER TABLE ... UPDATE`;
- `ALTER TABLE ... DELETE`;
- row-by-row correction;
- OLTP-like state replacement.

Prefer:

- append new versions;
- derive latest state in serving table;
- use `ReplacingMergeTree` if eventual latest state is acceptable;
- rebuild partitions/tables for large corrections;
- model corrections as compensating facts.

### 17.2 Lightweight deletes

Use lightweight deletes only when:

- supported by the deployment/version;
- query semantics are understood;
- data is not immediately physically removed;
- compliance requirements are still satisfied;
- performance impact is measured.

For hard deletion/retention, prefer TTL/drop partition strategies.

### 17.3 Partition replacement

For bulk correction, prefer partition-level replacement/rebuild patterns when safe.

The LLM must include validation and rollback plan.

---

## 18. TTL and Retention Standards

Every large ClickHouse table must define retention strategy.

Example:

```sql
TTL event_time + INTERVAL 180 DAY DELETE
```

Rules:

- Align partition key with TTL time field when possible.
- Prefer dropping old partitions over row-level deletion.
- Define legal/compliance retention separately from performance retention.
- Document whether TTL is delete, move, recompress, or rollup.
- Monitor TTL merge lag.

Do not assume TTL executes immediately. TTL is merge-driven.

---

## 19. Compression and Codec Standards

Use codecs deliberately for large tables.

Guidelines:

- Use default codecs unless measurement suggests otherwise.
- Consider `Delta`/`DoubleDelta` for monotonic timestamps or counters.
- Consider `ZSTD` for high compression where CPU cost is acceptable.
- Do not overfit codecs without benchmark.
- Do not obscure schema readability with premature codec tuning.

Any non-default codec must have a reason.

---

## 20. Distributed and Cluster Standards

### 20.1 Sharding key

A sharding key must be documented.

Good sharding key properties:

- distributes writes evenly;
- aligns with common query filters;
- avoids cross-shard fanout when possible;
- avoids hot shards;
- preserves tenant isolation where needed.

Bad default:

```sql
rand()
```

unless fanout query cost is acceptable and documented.

### 20.2 Replication

For production clusters:

- use replicated local tables;
- define replica count;
- define failure tolerance;
- define backup/restore process;
- monitor replication queue;
- monitor part count and merge backlog.

### 20.3 Distributed query safety

The LLM must consider:

- memory use across shards;
- network fanout;
- distributed aggregation cost;
- local vs global `GROUP BY` behavior;
- `distributed_product_mode` risk;
- correctness of joins across shards.

---

## 21. Security Standards

### 21.1 Access control

Use least privilege users/roles.

Separate accounts for:

- ingestion writer;
- transformation job;
- dashboard reader;
- analyst;
- admin;
- backup/export process.

Do not use admin credentials in applications.

### 21.2 Network security

Production ClickHouse must not be publicly exposed unless explicitly designed with proper controls.

Required:

- private networking or restricted ingress;
- TLS where credentials/data cross networks;
- firewall/security group allowlists;
- separate admin interface exposure;
- audited access paths.

### 21.3 Secrets

Secrets must be stored in a secret manager or orchestrator secret store.

Forbidden:

- credentials in DDL files committed to Git;
- credentials in Docker images;
- credentials in application logs;
- shared credentials across services.

### 21.4 Row/column-level security

If ClickHouse serves multi-tenant or sensitive analytics:

- define tenant isolation at query layer and database role layer if supported;
- do not rely only on frontend filtering;
- avoid exposing raw PII columns to broad readers;
- provide masked/hashed/aggregated tables for broad analytics.

---

## 22. Privacy and Compliance Standards

For personal, regulated, or sensitive data:

- classify columns;
- minimize raw PII ingestion;
- hash/tokenize identifiers where possible;
- define retention per sensitivity level;
- define deletion/anonymization process;
- prevent unrestricted export;
- log access to sensitive datasets;
- ensure backups follow retention/compliance rules.

ClickHouse analytics tables must not become an ungoverned PII lake.

---

## 23. Observability Standards

Every production ClickHouse deployment must monitor:

- query latency;
- query errors;
- read rows/bytes per query;
- memory usage;
- CPU usage;
- disk usage;
- parts count;
- active merges;
- merge backlog;
- replication lag/queue;
- insert throughput;
- failed inserts;
- mutation backlog;
- TTL lag;
- slow queries;
- distributed query failures;
- user/query source attribution.

Applications querying ClickHouse must log:

```text
query_name
query_id
request_id / trace_id
principal / service
elapsed_ms
read_rows
read_bytes
result_rows
exception_code
```

Do not log raw sensitive query results.

---

## 24. Query Safety Controls

Applications must use query limits and guardrails:

- max execution time where appropriate;
- max result size;
- bounded date ranges;
- dashboard-level required filters;
- safe query templates;
- parameterized queries;
- read-only users for dashboards;
- separate heavy analyst workload from user-facing APIs.

Do not expose free-form SQL to end users unless a controlled analytics environment is explicitly designed.

---

## 25. Backup, Restore, and Rebuild Standards

Every production ClickHouse dataset must have one of:

1. backup/restore process;
2. rebuild-from-source process;
3. replay-from-log process;
4. explicit disposable-data declaration.

Required documentation:

```md
Backup method:
Restore RTO:
Restore RPO:
Rebuild source:
Rebuild duration estimate:
Validation method:
Sensitive data handling:
```

If ClickHouse is a derived analytics store, rebuild from OLTP/Kafka/object storage may be acceptable, but must be tested.

---

## 26. Migration Standards

Schema migration must be safe for large tables.

Rules:

- Avoid blocking heavy table mutations during peak traffic.
- Prefer additive changes first.
- Backfill separately from DDL where possible.
- Use new table + materialized view + backfill + cutover for major remodels.
- Validate row counts and aggregates.
- Keep rollback/cutover plan.
- Do not execute massive mutation blindly.

Migration plan template:

```md
## ClickHouse Migration Plan

Change:
Reason:
Tables affected:
Estimated rows/bytes:
DDL:
Backfill:
Validation:
Rollback:
Operational risk:
Expected merge/mutation impact:
```

---

## 27. Application Integration Standards

### 27.1 API boundary

Applications should not expose ClickHouse details directly unless they are analytics tools.

Preferred:

```text
API request -> validated query params -> named query/template -> ClickHouse -> DTO/result
```

Rejected:

```text
API request -> arbitrary SQL string -> ClickHouse
```

### 27.2 Query naming

Every application query must have a stable logical name:

```text
analytics.case_status_daily_v1
analytics.user_activity_top_events_v1
```

Use query names in logs, dashboards, and performance review.

### 27.3 Timeouts

All ClickHouse clients must configure:

- connection timeout;
- query timeout;
- socket/read timeout;
- retry policy;
- max concurrent queries;
- cancellation behavior if request is cancelled.

Do not rely on default infinite/unknown timeouts.

### 27.4 Retry behavior

Retries are allowed only for known safe operations.

For inserts, retry requires idempotency/deduplication strategy.

For queries, retry must be bounded and must not amplify cluster overload.

---

## 28. Testing Standards

Required tests:

- DDL syntax test;
- representative query test;
- query result correctness test;
- duplicate ingestion test;
- late-arriving data test;
- backfill test;
- retention/TTL test where applicable;
- schema evolution test;
- materialized view test;
- dashboard/API query boundary test;
- large-volume explain/benchmark test for critical queries.

For every critical analytical query, provide:

```md
Query name:
Expected row volume:
Expected time range:
Expected latency:
Expected read rows/bytes:
Index/order key dependency:
Fallback plan if slow:
```

---

## 29. Anti-Patterns

### 29.1 ClickHouse as OLTP source of truth

Bad:

```text
Store case workflow state only in ClickHouse and update rows as users act.
```

Why bad:

- wrong workload model;
- weak relational constraints;
- mutation-heavy;
- poor transactional fit.

Use OLTP database for workflow state, then replicate facts/events to ClickHouse.

### 29.2 ORDER BY random UUID

Bad:

```sql
ORDER BY event_id
```

Why bad:

- destroys locality;
- weak data skipping for analytical filters;
- not aligned with time/dimension queries.

### 29.3 Partition by high-cardinality field

Bad:

```sql
PARTITION BY user_id
```

Why bad:

- partition explosion;
- too many parts;
- poor merge behavior.

### 29.4 Row-by-row ingestion

Bad:

```text
Every API request sends one INSERT row to ClickHouse.
```

Why bad:

- too many parts;
- high overhead;
- merge pressure;
- poor throughput.

### 29.5 SELECT star in production analytics API

Bad:

```sql
SELECT * FROM events WHERE event_date >= today() - 7
```

Why bad:

- unnecessary column reads;
- unstable API shape;
- higher memory/network cost.

### 29.6 Materialized view without backfill plan

Bad:

```text
Create materialized view and assume historical rows are automatically processed.
```

Why bad:

- materialized view processes new inserted blocks;
- historical data must be backfilled deliberately.

### 29.7 Treating ReplacingMergeTree as immediate uniqueness

Bad:

```text
Use ReplacingMergeTree and assume duplicate rows vanish immediately.
```

Why bad:

- deduplication is merge-dependent;
- queries may see duplicates.

### 29.8 Skip indexes everywhere

Bad:

```text
Add bloom/minmax/set indexes to all filter columns.
```

Why bad:

- write overhead;
- storage overhead;
- often useless without physical correlation;
- hides poor `ORDER BY` design.

### 29.9 Dashboard without required filters

Bad:

```text
Dashboard can query all tenants, all time, all dimensions by default.
```

Why bad:

- unbounded query cost;
- poor user experience;
- cluster risk.

### 29.10 Using FINAL everywhere

Bad:

```sql
SELECT ... FROM replacing_table FINAL WHERE ...
```

Why bad:

- expensive;
- may prevent optimizations;
- hides poor deduplication/read-model design.

Use `FINAL` only when correctness requires it and cost is measured.

---

## 30. Review Checklist

Before approving ClickHouse changes, verify:

```md
[ ] Use case is OLAP/analytics appropriate.
[ ] Source of truth is identified.
[ ] Table owner is documented.
[ ] Query patterns are documented.
[ ] Engine choice is justified.
[ ] Partition key is justified.
[ ] ORDER BY key is justified using query filters.
[ ] Retention/TTL is defined.
[ ] Insert strategy is batched.
[ ] Deduplication/idempotency behavior is defined.
[ ] Materialized views have explicit target tables.
[ ] Backfill plan exists where needed.
[ ] Query time ranges are bounded where needed.
[ ] SELECT \* is avoided in production queries.
[ ] Mutation/delete behavior is acceptable.
[ ] Distributed/sharding model is documented if used.
[ ] Security roles are least privilege.
[ ] Sensitive data handling is defined.
[ ] Observability metrics/logs are defined.
[ ] Backup/rebuild strategy exists.
[ ] Performance validation plan exists.
```

---

## 31. Acceptance Criteria

A ClickHouse implementation is acceptable only if:

1. It has a documented analytical purpose.
2. It does not replace OLTP state where transactional invariants are required.
3. Its `ENGINE`, `PARTITION BY`, and `ORDER BY` choices are justified.
4. Its ingestion path is batched and failure-aware.
5. Its duplicate/update/delete semantics are explicit.
6. Its retention policy is explicit.
7. Its main queries are bounded and tested.
8. Its materialized views/projections are justified and backfilled safely.
9. Its security model is least privilege.
10. Its operational metrics can detect slow queries, merge pressure, part explosion, failed inserts, and storage risk.

---

## 32. LLM Enforcement Snippet

Use this snippet in agent instructions:

```md
When generating ClickHouse-related code, SQL, schema, ingestion pipelines, dashboards, or infrastructure:

1. Treat ClickHouse as an OLAP/columnar analytics database, not a generic OLTP database.
2. Do not create tables before documenting query patterns, source of truth, ingestion rate, retention, and freshness SLA.
3. Always justify ENGINE, PARTITION BY, ORDER BY, and TTL.
4. Prefer append-only and batched ingestion.
5. Never design row-by-row inserts, frequent mutations, or high-cardinality partitioning unless explicitly justified.
6. Do not use ORDER BY id/uuid by default.
7. Do not use ReplacingMergeTree as immediate uniqueness.
8. Use materialized views/projections only with clear query/performance/backfill reasoning.
9. Require bounded queries for APIs/dashboards.
10. Include observability, backup/rebuild, and security controls in every production design.
```

---

## 33. Minimal Production Table Template

```sql
CREATE TABLE analytics.events_local
(
    tenant_id LowCardinality(String),
    event_date Date DEFAULT toDate(event_time),
    event_time DateTime64(3),
    event_type LowCardinality(String),
    actor_id String,
    resource_type LowCardinality(String),
    resource_id String,
    event_id UUID,
    properties String,
    source_system LowCardinality(String),
    source_partition String,
    source_offset UInt64,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/analytics/events_local', '{replica}')
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_type, event_date, event_time, event_id)
TTL event_time + INTERVAL 180 DAY DELETE;
```

This is a template, not a universal default. The LLM must modify it based on actual query patterns and operational requirements.

---

## 34. Minimal Query Template

```sql
SELECT
    event_date,
    event_type,
    count() AS total
FROM analytics.events
WHERE tenant_id = {tenant_id:String}
  AND event_date >= {from_date:Date}
  AND event_date < {to_date:Date}
GROUP BY
    event_date,
    event_type
ORDER BY
    event_date ASC,
    event_type ASC
LIMIT 10000;
```

Required properties:

- parameterized;
- tenant-bounded where applicable;
- time-bounded;
- explicit columns;
- explicit limit;
- aligned with `ORDER BY` where possible.

---

## 35. Source References

These standards are based on the official ClickHouse documentation and widely accepted ClickHouse operational guidance, especially:

- ClickHouse MergeTree engine documentation
- ClickHouse sparse primary index guide
- ClickHouse insert strategy guide
- ClickHouse TTL guide
- ClickHouse materialized views and projections documentation
- ClickHouse data skipping indexes documentation
- ClickHouse distributed table and cluster documentation
- ClickHouse security/access-control documentation

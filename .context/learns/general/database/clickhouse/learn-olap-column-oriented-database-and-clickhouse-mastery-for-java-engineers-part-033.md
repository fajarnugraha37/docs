# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-033.md

# Part 033 — Advanced Production Architectures and Case Studies: Multi-Tenant Analytics, Observability, Regulatory Reporting, and Cost Engineering

> Seri: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **033 / 034**  
> Fokus: menyatukan seluruh konsep menjadi arsitektur produksi nyata: multi-tenant SaaS analytics, observability platform, regulatory/case reporting, cost engineering, workload isolation, scale strategy, and architectural trade-off decision making.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas hampir seluruh fondasi ClickHouse:

- OLAP mental model;
- columnar storage;
- MergeTree internals;
- sorting key;
- partitioning;
- ingestion;
- query execution;
- aggregation;
- materialized views;
- projections;
- joins;
- table engines;
- mutable analytics;
- distributed architecture;
- cloud-native architecture;
- performance engineering;
- data modeling patterns;
- Java integration;
- production ingestion pipelines;
- operations;
- security/governance;
- backup/restore/DR.

Part ini adalah tahap “arsitektur produksi”.

Pertanyaan yang akan kita jawab bukan lagi:

```text
Apa itu MergeTree?
```

atau:

```text
Bagaimana menulis query cepat?
```

Tetapi:

```text
Bagaimana saya mendesain sistem analytics untuk SaaS multi-tenant?
Bagaimana memisahkan workload dashboard, export, BI, dan backfill?
Bagaimana membangun observability platform dengan ClickHouse?
Bagaimana membuat regulatory report yang reproducible?
Bagaimana mengontrol biaya?
Kapan perlu shard, replica, projection, materialized view, rollup, atau cluster terpisah?
Kapan ClickHouse bukan solusi terbaik?
```

Part ini berisi case studies dan decision frameworks.

Part 034 berikutnya akan menjadi capstone: final synthesis, roadmap mastery, interview/system design checklist, and top-1% operating principles.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. mendesain arsitektur ClickHouse untuk SaaS multi-tenant analytics;
2. membedakan tenant isolation strategies: shared table, tenant-first sort key, tenant shard, dedicated cluster;
3. memahami observability architecture: metrics, logs, traces, rollups, retention, high-cardinality control;
4. membangun regulatory/case reporting architecture yang auditable and reproducible;
5. merancang workload isolation untuk dashboard, BI, export, ingestion, and backfill;
6. membuat cost model dan cost control strategy;
7. memilih serving tables/materialized views/projections untuk use case nyata;
8. menentukan scale-up vs scale-out vs redesign;
9. merancang migration path dari prototype ke production;
10. membuat decision record untuk arsitektur ClickHouse;
11. mengenali kapan ClickHouse tidak cocok;
12. menyusun advanced production checklist.

---

## 2. Mental Model Utama: Architecture Is About Trade-Offs, Not Best Practices

Tidak ada satu arsitektur ClickHouse terbaik untuk semua.

Arsitektur berbeda jika prioritasnya:

```text
low latency dashboard
cheap long retention
ad-hoc analyst flexibility
regulatory correctness
PII minimization
high ingestion throughput
multi-tenant isolation
low operational burden
fast backfill
low cloud cost
```

Contoh:

- Observability platform mungkin menerima approximate metrics dan sampling.
- Regulatory reporting mungkin mengutamakan exactness, audit, and snapshots.
- Product analytics mungkin butuh flexible dimensions but with cost guardrails.
- SaaS multi-tenant analytics mungkin perlu tenant isolation and noisy-neighbor control.
- Security analytics mungkin butuh long retention and strict access control.

Arsitektur produksi yang baik bukan yang paling kompleks, tetapi yang trade-off-nya jelas dan sesuai tujuan.

---

## 3. Architecture Decision Dimensions

Gunakan dimensi ini untuk setiap desain.

### 3.1 Workload

- dashboard;
- drilldown;
- ad-hoc;
- export;
- report;
- ingestion;
- backfill;
- ML/feature extraction;
- alerting.

### 3.2 Data Shape

- event stream;
- metrics;
- logs;
- traces;
- CDC;
- current state;
- snapshots;
- rollups;
- reports.

### 3.3 Freshness

- real-time/seconds;
- minutes;
- hourly;
- daily;
- official period close.

### 3.4 Correctness

- exact;
- approximate acceptable;
- eventually correct;
- report-versioned;
- legally auditable.

### 3.5 Tenant Isolation

- shared everything;
- shared table with tenant key;
- tenant shard;
- tenant database;
- tenant cluster;
- hybrid.

### 3.6 Cost

- storage cost;
- compute cost;
- object requests;
- network egress;
- backfill cost;
- query concurrency;
- operational cost.

### 3.7 Operations

- self-managed vs managed;
- team expertise;
- backup/restore;
- upgrade;
- alerting;
- incident response.

### 3.8 Governance

- PII;
- deletion;
- retention;
- access control;
- export audit;
- compliance.

---

## 4. Case Study A — SaaS Multi-Tenant Product Analytics

### 4.1 Problem

A SaaS company wants each tenant to see analytics:

- event trends;
- DAU/MAU;
- feature usage;
- conversion funnels;
- user journey;
- export events;
- dashboard latency under 2 seconds;
- data freshness under 5 minutes;
- thousands of tenants;
- a few very large tenants.

### 4.2 Core Tables

```text
product_events_raw
product_events_refined
daily_product_event_rollup
daily_active_users
user_journey_by_user
export_jobs
ingestion_watermarks
```

### 4.3 Raw Event Table

```sql
CREATE TABLE product_events_raw
(
    tenant_id UInt64,
    event_id UUID,
    event_time DateTime64(3),
    ingest_time DateTime64(3),

    user_id UInt64,
    anonymous_id String,
    session_id UUID,

    event_name LowCardinality(String),

    country LowCardinality(String),
    device_type LowCardinality(String),
    browser LowCardinality(String),
    os LowCardinality(String),
    app_version LowCardinality(String),
    plan LowCardinality(String),

    revenue Decimal(18, 2) DEFAULT 0,

    source LowCardinality(String),
    schema_version UInt16,
    properties Map(String, String),
    raw_payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_name, event_time, user_id);
```

### 4.4 Why Tenant First?

Most SaaS analytics queries are tenant-scoped:

```sql
WHERE tenant_id = ?
```

Tenant-first sorting gives:

- data skipping;
- tenant isolation at query level;
- better compression within tenant;
- easier tenant-specific query limits.

### 4.5 Big Tenant Problem

If one tenant is 50% of all data:

```text
tenant_id-first sort helps query pruning but does not solve shard skew
```

Options:

1. dedicated shard/cluster for large tenant;
2. composite sharding key `(tenant_id, user_id)`;
3. tenant tiering;
4. separate product tier;
5. custom query limits.

### 4.6 Rollups

Event count rollup:

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

### 4.7 DAU/MAU Semantics

Use aggregate states:

```text
daily_active_users.users = uniqState(user_id)
monthly active = uniqMerge over days
```

Do not sum daily unique users for monthly active users.

### 4.8 Funnel Analytics

Funnel queries are often expensive because they need sequence per user/session.

Options:

- compute funnels on raw for short time range;
- precompute common funnels;
- build sessionized table;
- use specialized materialized view/job;
- route arbitrary funnels to async job.

### 4.9 User Journey Drilldown

Raw table sorted by event_name is not ideal for user timeline.

Use projection/table:

```sql
CREATE TABLE product_events_by_user
(
    tenant_id UInt64,
    user_id UInt64,
    event_time DateTime64(3),
    event_id UUID,
    event_name LowCardinality(String),
    session_id UUID,
    properties Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, user_id, event_time, event_id);
```

### 4.10 Query API Strategy

Dashboard endpoints:

- use rollups;
- sync;
- strict dimensions.

Drilldown endpoints:

- require user_id/session_id/time range;
- use user-sorted table.

Export endpoints:

- async;
- field whitelist;
- max range per tenant tier.

### 4.11 Multi-Tenant Guardrails

- tenant_id mandatory;
- tenant-scoped cache keys;
- quotas per tenant;
- large tenant workload isolation;
- export audit per tenant;
- row policy if needed.

### 4.12 Architecture Lesson

For SaaS analytics, tenant is not just a business field. It is:

```text
security boundary
query pruning dimension
cost attribution key
quota dimension
sharding decision input
cache key component
```

---

## 5. Case Study B — Observability Platform

### 5.1 Problem

Build internal observability platform:

- logs;
- metrics;
- traces;
- service dashboards;
- error search;
- p95/p99 latency;
- trace drilldown;
- 7-30 days raw retention;
- 1 year rollup retention;
- high ingestion volume;
- acceptable sampling for traces;
- strict cost control.

### 5.2 Data Families

```text
logs_raw
spans_raw
metrics_raw
api_latency_1m
log_error_rollup
spans_by_trace
service_health_daily
```

### 5.3 Logs Table

```sql
CREATE TABLE logs_raw
(
    timestamp DateTime64(3),
    ingest_time DateTime64(3),

    service LowCardinality(String),
    environment LowCardinality(String),
    region LowCardinality(String),
    host String,

    level LowCardinality(String),
    trace_id UUID,
    span_id String,
    request_id String,

    route LowCardinality(String),
    status_code UInt16,
    latency_ms UInt32,

    message String,
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service, environment, timestamp, level);
```

Daily partition may make sense for very high-volume logs and short retention.

### 5.4 Metrics Table

Metrics should control cardinality.

Bad labels:

```text
request_id
user_id
trace_id
session_id
full URL with IDs
```

Good labels:

```text
service
environment
route_group
status_class
region
```

### 5.5 Latency Rollup

```sql
CREATE TABLE api_latency_1m
(
    service LowCardinality(String),
    environment LowCardinality(String),
    minute DateTime,
    route LowCardinality(String),

    requests SimpleAggregateFunction(sum, UInt64),
    errors SimpleAggregateFunction(sum, UInt64),
    p50_state AggregateFunction(quantile(0.50), UInt32),
    p95_state AggregateFunction(quantile(0.95), UInt32),
    p99_state AggregateFunction(quantile(0.99), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (service, environment, minute, route);
```

### 5.6 Trace Table

```sql
CREATE TABLE spans_raw
(
    trace_id UUID,
    span_id String,
    parent_span_id String,

    start_time DateTime64(6),
    duration_us UInt64,

    service LowCardinality(String),
    operation LowCardinality(String),
    environment LowCardinality(String),

    error UInt8,
    status_code LowCardinality(String),
    attributes Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(start_time)
ORDER BY (service, environment, start_time, trace_id);
```

Trace drilldown access path:

```text
spans_by_trace ORDER BY (trace_id, start_time)
```

### 5.7 Retention

```text
logs_raw: 7-30 days
spans_raw: 3-14 days
metrics_raw: short
api_latency_1m: 1 year
daily service health: 2 years
incident snapshots: long
```

### 5.8 Query Strategy

Dashboards:

- use rollups.

Log search:

- require service + environment + time range;
- limit raw search;
- no unbounded regex.

Trace lookup:

- by trace_id using dedicated access path.

Exports:

- async;
- often discouraged for huge logs.

### 5.9 Cost Controls

- sampling traces;
- drop noisy debug logs;
- TTL raw data;
- rollup metrics;
- cardinality control;
- payload size limits;
- compression and storage tiering.

### 5.10 Architecture Lesson

Observability data is high-volume and high-cardinality. ClickHouse works well if you control cardinality, retention, and query access paths.

---

## 6. Case Study C — Regulatory / Case Lifecycle Analytics

### 6.1 Problem

A regulatory/case management system needs:

- current backlog dashboard;
- lifecycle trend;
- SLA monitoring;
- official monthly reports;
- audit trail;
- case drilldown;
- long retention;
- reproducible reports;
- corrections/amendments;
- strict access control.

### 6.2 Core Tables

```text
case_lifecycle_events
case_events_by_case
case_current_state
daily_case_lifecycle_rollup
daily_case_sla_rollup
daily_case_backlog_snapshot
official_case_report_snapshots
audit_events
report_runs
export_audit
ingestion_watermarks
reconciliation_results
```

### 6.3 Lifecycle Events

One row per domain event:

```text
CASE_OPENED
CASE_CLASSIFIED
CASE_ASSIGNED
CASE_ESCALATED
CASE_DECIDED
CASE_CLOSED
CASE_REOPENED
CASE_CORRECTED
```

Sort key:

```sql
ORDER BY (tenant_id, event_type, event_time, jurisdiction, case_id)
```

for reports by event type/time.

Drilldown table:

```sql
ORDER BY (tenant_id, case_id, event_time)
```

### 6.4 Current State

Use current state table for:

- current backlog;
- current assignee;
- current severity;
- current status.

Do not derive current dashboard from raw history every time.

### 6.5 Backlog Snapshot

Periodic snapshot answers:

```text
How many cases were open at end of each day/month?
```

Not the same as:

```text
cases opened that day - closed that day
```

### 6.6 Official Reports

Reports should be snapshot/versioned:

```text
report_period
report_version
source_watermark
generated_at
checksum
amendment_reason
```

Do not rely on live query as official artifact.

### 6.7 Corrections

Correction strategy:

- append correction event;
- rebuild affected rollup window;
- create amended report version;
- preserve audit trail.

### 6.8 Access Control

Different roles:

```text
case worker:
  authorized case drilldown

manager:
  jurisdiction dashboard

report officer:
  official reports

admin:
  audited break-glass
```

### 6.9 Architecture Lesson

Regulatory analytics is less about “fast dashboard” and more about:

```text
time semantics
auditability
reproducibility
controlled correction
and versioned truth
```

---

## 7. Case Study D — Financial / Revenue Analytics

### 7.1 Problem

Revenue analytics needs:

- exact monetary amounts;
- daily revenue;
- refunds;
- chargebacks;
- multi-currency;
- reconciliation with payment provider;
- official finance reports;
- audit;
- PII minimization.

### 7.2 Design Principles

- use `Decimal`, not Float;
- store currency;
- store event identity;
- use correction/refund events;
- reconcile with source ledger;
- avoid mutable update of historical transaction;
- snapshot official reports.

### 7.3 Fact Table

```sql
CREATE TABLE payment_events
(
    tenant_id UInt64,
    event_id UUID,
    payment_id String,

    event_time DateTime64(3),
    ingest_time DateTime64(3),

    event_type LowCardinality(String), -- AUTHORIZED, CAPTURED, REFUNDED, CHARGEBACK
    currency FixedString(3),
    amount Decimal(18, 2),

    customer_id UInt64,
    country LowCardinality(String),
    payment_method LowCardinality(String),

    source_system LowCardinality(String),
    source_sequence UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, payment_id);
```

### 7.4 Revenue Rollup

```sql
CREATE TABLE daily_revenue_rollup
(
    tenant_id UInt64,
    day Date,
    currency FixedString(3),
    country LowCardinality(String),

    captured_amount SimpleAggregateFunction(sum, Decimal(18, 2)),
    refunded_amount SimpleAggregateFunction(sum, Decimal(18, 2)),
    chargeback_amount SimpleAggregateFunction(sum, Decimal(18, 2))
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, currency, country);
```

### 7.5 FX Conversion

Be careful.

Options:

- store original currency;
- store conversion rate version;
- compute converted amount at report generation;
- snapshot FX rates;
- never silently recompute old official reports with new rates.

### 7.6 Architecture Lesson

For finance, exactness and reconciliation beat approximate speed.

---

## 8. Case Study E — Security Analytics

### 8.1 Problem

Security team wants:

- login anomaly;
- admin action monitoring;
- suspicious exports;
- access audit;
- long retention;
- search by actor/IP/resource;
- alerts.

### 8.2 Tables

```text
security_events
audit_events
login_events
export_audit
admin_action_log
security_rollups
```

### 8.3 Security Event Schema

```sql
CREATE TABLE security_events
(
    event_time DateTime64(3),
    ingest_time DateTime64(3),

    event_id UUID,
    tenant_id UInt64,

    actor_id String,
    actor_type LowCardinality(String),
    ip_address IPv6,
    user_agent String,

    action LowCardinality(String),
    resource_type LowCardinality(String),
    resource_id String,
    outcome LowCardinality(String),

    risk_score UInt16,
    reason String,
    raw_context String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, action, event_time, actor_id);
```

### 8.4 Access Paths

Actor investigation:

```text
ORDER BY (tenant_id, actor_id, event_time)
```

Resource investigation:

```text
ORDER BY (tenant_id, resource_type, resource_id, event_time)
```

Use projections/separate tables if frequent.

### 8.5 Architecture Lesson

Security analytics often needs alternate access paths and strict audit of who can query security data.

---

## 9. Multi-Tenant Isolation Strategies

### 9.1 Shared Table, Tenant Column

```text
all tenants in same table
tenant_id column mandatory
```

Pros:

- simple;
- efficient for many small tenants;
- easier rollups;
- lower operational cost.

Cons:

- noisy neighbor risk;
- tenant data mixed physically;
- large tenant skew;
- security relies on filters/policies.

### 9.2 Shared Cluster, Tenant-Specific Database/Table

Pros:

- clearer isolation;
- easier tenant export/delete;
- per-tenant retention.

Cons:

- many tables/databases;
- operational overhead;
- schema migration complexity;
- less efficient for many tenants.

### 9.3 Tenant-Based Sharding

```text
tenant_id determines shard
```

Pros:

- tenant data locality;
- shard pruning if query routed;
- per-tenant capacity.

Cons:

- skew if tenant sizes vary;
- moving tenant between shards harder.

### 9.4 Composite Sharding

```text
hash(tenant_id, user_id)
```

Pros:

- spreads large tenants.

Cons:

- tenant query fans out across shards;
- harder tenant isolation.

### 9.5 Dedicated Cluster for Large Tenant

Pros:

- strong isolation;
- custom SLA;
- predictable cost attribution.

Cons:

- higher cost;
- more ops.

### 9.6 Hybrid Model

Common SaaS pattern:

```text
small tenants → shared cluster/table
large tenants → dedicated shard/cluster
regulated tenants → isolated environment
```

### 9.7 Decision Matrix

| Requirement | Strategy |
|---|---|
| many small tenants | shared table |
| few huge tenants | dedicated shard/cluster |
| strict compliance | isolated cluster/database |
| low ops cost | shared table |
| tenant-specific retention | separate table/database or policy |
| high noisy-neighbor risk | workload isolation/dedicated compute |
| tenant export/delete frequent | tenant-local design helps |

---

## 10. Workload Isolation Patterns

### 10.1 By User/Profile

Different ClickHouse users:

```text
dashboard_user
export_user
bi_user
ingestion_user
report_user
```

Good baseline.

### 10.2 By Table

Dashboards read rollups. Exports read raw. Reports read snapshots.

### 10.3 By Compute Group/Cluster

For cloud/large deployments:

```text
dashboard compute
export compute
backfill compute
BI compute
```

### 10.4 By Schedule

Run heavy jobs off-peak.

### 10.5 By Queue

Export/backfill/report jobs go through queue with concurrency limits.

### 10.6 By API Guardrail

Reject/reroute expensive queries before DB.

### 10.7 Combined Approach

Production usually needs multiple isolation layers.

---

## 11. Cost Engineering

### 11.1 Cost Drivers

- raw data volume;
- retention duration;
- replicas;
- object storage;
- materialized views;
- projections;
- rollups;
- query scan bytes;
- query concurrency;
- backfills;
- exports;
- network egress;
- idle compute;
- BI/ad-hoc usage.

### 11.2 Cost Observability

Track by:

- tenant;
- query family;
- user;
- table;
- workload class;
- source pipeline;
- export job.

### 11.3 Query Cost Proxy

Use:

```text
read_bytes
read_rows
memory_usage
query_duration
result_bytes
```

from query log.

### 11.4 Storage Cost Proxy

Use:

```sql
SELECT
    database,
    table,
    formatReadableSize(sum(bytes_on_disk)) AS bytes,
    sum(rows) AS rows
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC;
```

### 11.5 Reducing Storage Cost

- TTL raw data;
- better compression;
- LowCardinality;
- avoid raw payload bloat;
- rollup and drop raw if policy allows;
- cold object storage;
- remove unused projections/MVs;
- reduce duplicate serving tables;
- clean staging/temp tables.

### 11.6 Reducing Compute Cost

- use rollups;
- cache dashboards;
- restrict dimensions;
- avoid raw scans;
- async exports;
- schedule backfills;
- query family guardrails;
- workload isolation;
- tune sorting key.

### 11.7 Cost per Tenant

In SaaS, allocate cost by:

```text
ingested rows/bytes
stored bytes
query read_bytes
export result_bytes
dashboard QPS
```

This supports pricing/tiering.

---

## 12. Materialized View vs Projection vs Separate Table

### 12.1 Projection

Use when:

- same base table;
- alternate sort/aggregation;
- transparent optimizer use desired;
- lifecycle same as base.

### 12.2 Materialized View

Use when:

- insert-time transformation;
- target table has different shape;
- rollup;
- serving model;
- different retention/access/security.

### 12.3 Separate Table via Batch Job

Use when:

- complex transformation;
- backfill/rebuild required;
- late events/corrections complex;
- official reports;
- heavy computation should be scheduled.

### 12.4 Decision

| Need | Best Candidate |
|---|---|
| alternate physical order | projection |
| common dashboard rollup | MV + target table |
| official report | batch job + snapshot |
| complex late correction | scheduled rebuild |
| security boundary | separate serving table/view |
| drilldown by alternate key | projection or separate table |
| current state | ReplacingMergeTree/current table |

---

## 13. Scale-Up vs Scale-Out vs Separate Cluster

### 13.1 Scale-Up

Choose when:

- query coordinator memory/CPU bottleneck;
- single-node simplicity;
- moderate data;
- hardware can grow.

### 13.2 Scale-Out

Choose when:

- data volume exceeds node;
- scan workload parallelizable;
- ingestion throughput high;
- HA needed.

### 13.3 Separate Cluster

Choose when:

- workloads conflict severely;
- tenants require isolation;
- compliance boundary;
- BI/export backfills harm dashboards;
- different retention/security.

### 13.4 Redesign First

If query scans 100x more data than needed, redesign before scaling.

### 13.5 Rule

Scaling amplifies good design and bad design. Know which one you have.

---

## 14. ClickHouse vs Alternatives

ClickHouse is strong for:

- fast analytical scans;
- high ingestion append workloads;
- time-series/log/event analytics;
- pre-aggregated dashboards;
- columnar compression;
- SQL analytics;
- real-time-ish OLAP.

ClickHouse is not ideal for:

- primary OLTP transactions;
- high-frequency row updates;
- small point writes/updates;
- full-text search without strategy;
- graph traversal;
- strict serializable transactions;
- arbitrary user-facing query language without guardrails;
- massive mutable dimensional model requiring complex transactional consistency.

Complementary systems:

| Need | Often Better |
|---|---|
| OLTP | PostgreSQL/MySQL |
| search | Elasticsearch/OpenSearch/Lucene |
| graph | graph DB |
| cache | Redis |
| queue/stream | Kafka/Pulsar |
| data lake raw archive | object storage + Parquet/Iceberg |
| ML feature offline store | lake/warehouse + serving layer |
| transactional ledger | OLTP/event store |

Top-tier architecture uses ClickHouse where it fits.

---

## 15. Evolution Path: Prototype to Mature Platform

### Stage 1: Prototype

```text
single node
one raw table
manual queries
basic dashboard
```

Risks:

- no backup;
- no limits;
- no schema discipline.

### Stage 2: Production MVP

```text
replica or managed cloud
query API
batch ingestion
basic rollups
monitoring
backup
```

### Stage 3: Scaled Production

```text
distributed cluster/cloud scale
serving tables
query families
workload users/profiles
DLQ/reconciliation
alerts/runbooks
async export
```

### Stage 4: Governed Platform

```text
tenant cost attribution
security/governance metadata
self-service curated datasets
DR tested
report snapshots
data contracts
schema registry
```

### Stage 5: Advanced Optimization

```text
projections
specialized tables
compute groups
hot/cold storage
tenant isolation tiers
cost-aware routing
automated capacity planning
```

---

## 16. Architecture Decision Record Template

Use ADRs for major decisions.

```text
Title:
  Use ClickHouse for multi-tenant product analytics

Context:
  volume, latency, freshness, retention, tenant model

Decision:
  shared table with tenant_id first sort key
  rollups for dashboards
  async exports
  dedicated cluster for enterprise tenants later

Options Considered:
  PostgreSQL read replicas
  Elasticsearch
  BigQuery/Snowflake
  ClickHouse self-managed
  ClickHouse Cloud

Rationale:
  high ingestion, low-latency dashboards, SQL, compression

Trade-offs:
  need ingestion idempotency
  no OLTP updates
  query guardrails required
  operational ownership

Risks:
  tenant skew
  PII in raw payload
  BI misuse

Mitigations:
  tenant quotas
  field whitelist
  rollups
  export audit
  row policies

Validation:
  benchmark dataset
  p95 latency
  cost estimate
  restore test

Review Date:
  after 6 months or 10x growth
```

---

## 17. Advanced Production Checklist

### Architecture

- [ ] Workload classes defined.
- [ ] Query families defined.
- [ ] Data model per workload.
- [ ] Tenant strategy explicit.
- [ ] Freshness/correctness semantics explicit.
- [ ] Raw/refined/serving layers defined.
- [ ] Async export/report paths defined.

### Performance

- [ ] Sorting keys match query families.
- [ ] Rollups for repeated dashboards.
- [ ] Drilldown access paths exist.
- [ ] High-cardinality queries guarded.
- [ ] Distributed fan-in controlled.
- [ ] Performance tested at 10x data.

### Ingestion

- [ ] Stable event IDs.
- [ ] Batch IDs and source offsets.
- [ ] DLQ/replay.
- [ ] Watermarks.
- [ ] Reconciliation.
- [ ] Backfill manifests.

### Operations

- [ ] Monitoring/alerts.
- [ ] Runbooks.
- [ ] Backup/restore tested.
- [ ] Upgrade playbook.
- [ ] Capacity review.
- [ ] Workload isolation.

### Security/Governance

- [ ] Least privilege users.
- [ ] Tenant isolation.
- [ ] PII classification.
- [ ] Export audit.
- [ ] Retention/deletion.
- [ ] Query logs protected.

### Cost

- [ ] Cost per table/workload/tenant.
- [ ] TTL/cold storage.
- [ ] Query read_bytes tracked.
- [ ] Export quotas.
- [ ] BI limits.
- [ ] Unused data/tables reviewed.

---

## 18. Exercises

### Exercise 1: SaaS Tenant Skew

One tenant becomes 60% of data and slows shared dashboards.

What options?

Expected:

```text
dedicated shard/cluster, tenant isolation tier, composite sharding, per-tenant quotas, rollups, separate compute.
```

### Exercise 2: Observability Cost Explosion

Logs grow 5x and storage bill spikes.

What do you check?

Expected:

```text
retention, raw payload size, debug logs, label cardinality, compression, TTL, rollups, unused columns, object storage tier.
```

### Exercise 3: Regulatory Report Changed After Correction

Official report for May changed after late correction.

What should happen?

Expected:

```text
new report version/amendment, source watermark/checksum, audit trail, not silent overwrite.
```

### Exercise 4: BI User Needs Raw Data

BI wants direct raw table access.

What is safer?

Expected:

```text
curated view/serving table, BI profile/quota, field masking, export approval, query limits.
```

### Exercise 5: Migration to New Sort Key

Current sort key does not support case drilldown.

What migration path?

Expected:

```text
create new table/projection, backfill, validate, dual-write or MV, cutover query family, monitor, retire old.
```

---

## 19. Summary

Advanced ClickHouse architecture is the art of aligning physical design, workload, correctness, security, cost, and operations.

Core principles:

1. There is no universal best architecture.
2. Tenant is a security, performance, cost, and operational dimension.
3. Observability requires cardinality and retention control.
4. Regulatory analytics requires reproducibility and auditability.
5. Rollups and serving tables are product infrastructure, not optional optimization.
6. Workload isolation prevents dashboards, exports, BI, and backfills from harming each other.
7. Cost engineering must use query logs and storage metrics.
8. Projections, materialized views, and separate tables solve different problems.
9. Scaling without redesign can amplify waste.
10. ClickHouse should be paired with complementary systems where appropriate.
11. Architecture decisions should be documented with trade-offs and review dates.
12. Production maturity grows in stages.

Practical sentence:

> A mature ClickHouse platform is not just fast; it is predictable, explainable, governable, recoverable, and cost-aware.

---

## 20. Referensi Belajar Lanjutan

Gunakan dokumentasi resmi sesuai versi dan deployment:

1. ClickHouse Docs — Choosing a primary key.
2. ClickHouse Docs — Materialized views.
3. ClickHouse Docs — Projections.
4. ClickHouse Docs — Distributed table engine.
5. ClickHouse Docs — ReplicatedMergeTree.
6. ClickHouse Docs — AggregatingMergeTree.
7. ClickHouse Docs — SummingMergeTree.
8. ClickHouse Docs — ReplacingMergeTree.
9. ClickHouse Docs — Time-series and observability examples.
10. ClickHouse Docs — Query optimization.
11. ClickHouse Docs — system.query_log.
12. ClickHouse Docs — Backups and restore.
13. ClickHouse Docs — Access control.
14. ClickHouse Docs — Quotas and settings profiles.
15. ClickHouse Docs — Cloud architecture and compute separation if using ClickHouse Cloud.
16. Internal SRE/data platform standards for DR, cost attribution, and incident management.

---

## 21. Status Seri

Part ini adalah:

```text
Part 033 / 034
```

Seri belum selesai.

Part berikutnya adalah bagian terakhir:

```text
Part 034 — Capstone: ClickHouse Mastery Roadmap, System Design Review, Interview Playbook, and Top-1% Operating Principles
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Operations III: Backup, Restore, Disaster Recovery, Migration, and Upgrade Playbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-034.md">Part 034 — Capstone: ClickHouse Mastery Roadmap, System Design Review, Interview Playbook, and Top-1% Operating Principles ➡️</a>
</div>

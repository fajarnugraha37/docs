# learn-sql-mastery-for-java-engineers-part-031.md

# Part 31 — Analytical SQL, OLAP, Warehousing, and Reporting Systems

> Seri: SQL Mastery for Java Engineers  
> Bagian: 031 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-030.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-032.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas observability, operations, backup, restore, dan disaster recovery.

Sekarang kita membahas dunia **analytical SQL** dan **reporting systems**.

Sampai bagian ini, mayoritas pembahasan berfokus pada OLTP:

```text
Online Transaction Processing
```

Contoh OLTP:

- create case
- update status
- assign officer
- insert evidence
- close case
- process approval
- publish outbox
- validate command

OLTP memprioritaskan:

- correctness per transaction
- low latency
- concurrency
- small reads/writes
- strict invariants
- indexes for point/range lookups

Namun business juga butuh pertanyaan analitis:

```text
Berapa case dibuka per bulan?
Berapa SLA breach per jurisdiction?
Officer mana yang workload-nya naik?
Berapa median time-to-close?
Apa trend evidence volume?
Berapa backlog per status dan priority?
Berapa correction/amendment setelah report submitted?
Apa cohort case type tertentu?
```

Pertanyaan ini sering membutuhkan:

- scan data besar
- aggregation
- grouping
- window functions
- historical snapshots
- joins ke dimensions
- metric definitions
- time bucketing
- late-arriving correction
- report reproducibility

Jika semua analytics dijalankan langsung di OLTP primary, sistem bisa lambat atau unstable.

Bagian ini membahas:

- OLTP vs OLAP
- analytical query patterns
- fact and dimension modelling
- star schema
- data warehouse/mart
- metrics correctness
- reporting snapshots
- time dimension
- slowly changing dimensions
- pre-aggregation
- cube/rollup/grouping sets
- window analytics
- BI consumption
- moving heavy reads away from OLTP
- Java backend role in analytics architecture

Kalimat inti:

> OLTP menyimpan dan mengubah fakta dengan benar; OLAP menyusun fakta historis agar bisa dijawab sebagai metrik, trend, dan keputusan.

---

## 1. OLTP vs OLAP

### 1.1 OLTP

OLTP workload:

```text
many small transactions
short transactions
point lookups
bounded queries
frequent writes
strict constraints
high concurrency
```

Schema style:

```text
normalized
foreign keys
constraints
current state + history
```

Example:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE tenant_id = ?
  AND id = ?
  AND status = 'UNDER_REVIEW';
```

### 1.2 OLAP

OLAP workload:

```text
large scans
aggregations
historical analysis
group by dimensions
trend analysis
reporting
read-heavy
batch/interactive analytics
```

Schema style often:

```text
fact tables
dimension tables
denormalized/star schema
partitioned by time
columnar storage in warehouses
```

Example:

```sql
SELECT
    month,
    jurisdiction,
    COUNT(*) AS opened_cases,
    AVG(days_to_close) AS avg_days_to_close
FROM fact_case_lifecycle
GROUP BY month, jurisdiction;
```

OLTP and OLAP have different optimization goals.

---

## 2. Why Not Run All Reports on OLTP?

Running analytics on OLTP primary can cause:

- heavy scans
- CPU/IO contention
- lock/transaction pressure
- cache eviction
- temp file spills
- slow user-facing requests
- replica lag if on replica
- index bloat if adding reporting indexes
- complex queries competing with writes
- operational incidents

Some small reports are fine on OLTP.

But large recurring analytics should move to:

- read replica
- materialized view
- reporting schema
- data mart
- warehouse
- lakehouse
- precomputed read model
- snapshot table

Rule:

> If report workload competes with transactional workload, separate it physically or temporally.

---

## 3. Analytical SQL Mindset

Analytical SQL asks:

```text
What is the grain?
What is the metric?
What is the dimension?
What time semantics?
What filter population?
What denominator?
What snapshot?
What data freshness?
What correction policy?
```

Example metric:

```text
SLA breach rate
```

Ambiguous until defined:

```text
breached cases / all closed cases?
breached cases / all cases due in period?
breach by opened month or due month?
include cancelled cases?
use current corrected data or as-submitted data?
use calendar days or business days?
tenant timezone?
```

Metrics are domain definitions, not just SQL expressions.

---

## 4. Grain in Analytics

Grain = one row represents what?

Examples:

```text
one row per case
one row per case status transition
one row per case per day
one row per evidence item
one row per SLA obligation
one row per officer assignment interval
one row per report snapshot line
```

If grain is unclear, metrics are wrong.

Fact table must declare grain.

Bad:

```text
case_report table has some rows per case and some rows per evidence
```

Good:

```text
fact_case_lifecycle: one row per case lifecycle
fact_case_status_transition: one row per status transition
fact_case_daily_snapshot: one row per case per day
```

---

## 5. Fact Tables

Fact table stores measurable events or states.

Examples:

```text
fact_case_opened
fact_case_closed
fact_case_lifecycle
fact_evidence_received
fact_sla_obligation
fact_case_daily_snapshot
fact_status_transition
```

Fact columns:

- foreign keys to dimensions
- timestamps/dates
- numeric measures
- counts/durations
- status flags
- source identifiers

Example:

```sql
CREATE TABLE fact_case_lifecycle (
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    opened_date DATE NOT NULL,
    closed_date DATE,
    jurisdiction_key INTEGER NOT NULL,
    case_type_key INTEGER NOT NULL,
    priority_key INTEGER NOT NULL,
    opened_count INTEGER NOT NULL DEFAULT 1,
    closed_count INTEGER NOT NULL DEFAULT 0,
    days_to_close NUMERIC(10,2),
    sla_breached BOOLEAN,

    PRIMARY KEY (tenant_id, case_id)
);
```

This fact has grain:

```text
one row per case
```

---

## 6. Dimension Tables

Dimension table stores descriptive attributes used for grouping/filtering.

Examples:

```text
dim_date
dim_tenant
dim_jurisdiction
dim_case_type
dim_priority
dim_status
dim_officer
dim_source_system
```

Example:

```sql
CREATE TABLE dim_priority (
    priority_key INTEGER PRIMARY KEY,
    priority_code TEXT NOT NULL UNIQUE,
    priority_label TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);
```

Facts reference dimensions:

```text
priority_key
case_type_key
jurisdiction_key
```

Dimensions make analytics stable and business-friendly.

---

## 7. Star Schema

Star schema:

```text
fact table at center
dimension tables around it
```

Example:

```text
fact_case_lifecycle
  -> dim_date opened_date
  -> dim_date closed_date
  -> dim_jurisdiction
  -> dim_case_type
  -> dim_priority
  -> dim_tenant
```

Benefits:

- simpler BI queries
- predictable joins
- clear grain
- optimized for aggregation
- dimensions reused
- semantic clarity

Trade-off:

- denormalization
- ETL required
- freshness lag
- source-of-truth separate from OLTP

Star schema is not “less normalized because lazy”; it is optimized for analysis.

---

## 8. Date Dimension

Date dimension is useful for reporting.

```sql
CREATE TABLE dim_date (
    date_key INTEGER PRIMARY KEY,
    date_value DATE NOT NULL UNIQUE,
    year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,
    month INTEGER NOT NULL,
    month_name TEXT NOT NULL,
    week_of_year INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    is_weekend BOOLEAN NOT NULL,
    fiscal_year INTEGER,
    fiscal_period INTEGER
);
```

Why?

- consistent month/week/fiscal grouping
- avoids repeated date logic
- supports business calendars
- BI-friendly
- holiday/weekend flags

For regulatory/business reporting, date semantics matter.

---

## 9. Time Zones in Analytics

Analytics often groups by local business date.

Event timestamp:

```text
occurred_at TIMESTAMPTZ
```

Report date:

```text
occurred_local_date DATE
timezone TEXT
```

If tenant timezone matters:

```sql
opened_local_date
tenant_timezone
```

Do not group global timestamps by UTC day if business reports use local days.

Example:

```text
Case opened at 2026-06-01 00:30 Jakarta
UTC date may be 2026-05-31
business date is 2026-06-01
```

Store/report local date intentionally.

---

## 10. Slowly Changing Dimensions

Dimensions change over time.

Example officer:

```text
Officer A moved department from Enforcement to Review on July 1.
```

Question:

```text
Report June cases by officer department at time of case?
or current officer department?
```

Two semantics:

### 10.1 Current Dimension

Use latest officer department.

Good for current organization view.

### 10.2 Historical Dimension

Use department as it was when fact occurred.

Need slowly changing dimension type 2.

---

## 11. SCD Type 2

Dimension stores versions.

```sql
CREATE TABLE dim_officer (
    officer_key BIGSERIAL PRIMARY KEY,
    officer_id UUID NOT NULL,
    officer_name TEXT NOT NULL,
    department TEXT NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    is_current BOOLEAN NOT NULL,

    UNIQUE (officer_id, valid_from)
);
```

Fact stores `officer_key`, not just `officer_id`.

This preserves historical grouping.

If department changes later, old facts still point to old officer dimension version.

---

## 12. Fact Snapshot vs Event Fact

### 12.1 Event Fact

One row per event.

Example:

```text
one row per case status transition
```

Good for:

- event counts
- transition analysis
- sequences
- time-to-next event
- audit-like analytics

### 12.2 Snapshot Fact

State captured at interval.

Example:

```text
one row per case per day
```

Good for:

- backlog over time
- open cases at end of day
- aging buckets
- workload snapshots

Use correct fact type.

---

## 13. Daily Snapshot Fact

Backlog metric needs snapshot.

```sql
CREATE TABLE fact_case_daily_snapshot (
    snapshot_date DATE NOT NULL,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    status_key INTEGER NOT NULL,
    priority_key INTEGER NOT NULL,
    officer_key INTEGER,
    age_days INTEGER NOT NULL,
    is_overdue BOOLEAN NOT NULL,

    PRIMARY KEY (snapshot_date, tenant_id, case_id)
);
```

Query backlog by day:

```sql
SELECT
    snapshot_date,
    status_key,
    COUNT(*) AS case_count
FROM fact_case_daily_snapshot
GROUP BY snapshot_date, status_key;
```

This avoids complex historical reconstruction every report.

---

## 14. Current Corrected vs As-Submitted Analytics

From temporal part:

Analytics may use:

```text
current corrected data
as-known-at data
as-submitted snapshots
```

Example:

```text
June SLA breach rate
```

If correction arrives in July for June case, should June metric change?

Depends on report purpose.

Design metrics with semantic labels:

```text
june_breach_rate_current_corrected
june_breach_rate_as_submitted
```

Do not mix silently.

---

## 15. Metric Definition

Every important metric should have definition.

Example:

```text
Metric: SLA breach rate
Numerator: cases whose active SLA completed after due_at or still open after due_at
Denominator: cases with SLA due date in reporting period
Excluded: cancelled cases before due date
Time zone: tenant business timezone
Data source: fact_sla_obligation
Freshness: updated hourly
Correction policy: current corrected
```

Without metric definition, SQL can be “correct” but business-wrong.

---

## 16. Numerator and Denominator

Many reporting bugs are denominator bugs.

Example:

```sql
COUNT(breached_cases) / COUNT(all_cases)
```

But all cases which population?

- opened in period?
- due in period?
- closed in period?
- assigned to officer during period?
- active at end of period?
- excluding cancelled?
- excluding test tenants?

Always define population.

---

## 17. Aggregation Pitfall: Join Multiplication

Case table:

```text
cases: one row per case
evidences: many rows per case
notes: many rows per case
```

Bad:

```sql
SELECT COUNT(c.id)
FROM cases c
JOIN evidences e ON e.case_id = c.id
JOIN notes n ON n.case_id = c.id;
```

Counts case × evidence × note combinations.

Fix:

- pre-aggregate children
- count distinct if appropriate
- separate facts
- use read model
- avoid joining multiple one-to-many facts directly

Analytics requires grain discipline.

---

## 18. Pre-Aggregation

Instead of aggregating raw facts every time:

```sql
CREATE TABLE agg_case_daily_counts (
    tenant_id UUID NOT NULL,
    report_date DATE NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    case_count BIGINT NOT NULL,

    PRIMARY KEY (tenant_id, report_date, status, priority)
);
```

Benefits:

- fast dashboards
- stable query cost
- lower OLTP/warehouse load

Costs:

- freshness
- rebuild
- correction handling
- dimensional changes
- storage

Pre-aggregation is controlled redundancy.

---

## 19. Rollup, Cube, and Grouping Sets

SQL can compute multiple aggregation levels.

Example:

```sql
SELECT
    jurisdiction,
    priority,
    COUNT(*) AS case_count
FROM fact_case_lifecycle
GROUP BY ROLLUP (jurisdiction, priority);
```

Grouping sets:

```sql
SELECT
    jurisdiction,
    priority,
    status,
    COUNT(*) AS case_count
FROM fact_case_lifecycle
GROUP BY GROUPING SETS (
    (jurisdiction, priority, status),
    (jurisdiction, priority),
    (jurisdiction),
    ()
);
```

Useful for reporting totals and subtotals.

Caveat:

- syntax support varies
- result needs grouping indicators
- BI tools may handle this

---

## 20. Window Functions for Analytics

Examples:

### 20.1 Running Total

```sql
SELECT
    report_date,
    daily_opened,
    SUM(daily_opened) OVER (
        ORDER BY report_date
    ) AS cumulative_opened
FROM daily_case_counts;
```

### 20.2 Moving Average

```sql
AVG(daily_closed) OVER (
    ORDER BY report_date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
) AS seven_day_avg_closed
```

### 20.3 Rank

```sql
RANK() OVER (
    PARTITION BY tenant_id
    ORDER BY overdue_count DESC
) AS officer_overdue_rank
```

Window functions are essential for professional analytics.

---

## 21. Cohort Analysis

Cohort groups entities by starting period.

Example:

```text
cases opened in January
track closure percentage after 7/14/30 days
```

SQL concept:

```sql
SELECT
    opened_month,
    days_bucket,
    COUNT(*) FILTER (WHERE closed_within_bucket) AS closed_count,
    COUNT(*) AS cohort_size
FROM fact_case_lifecycle
GROUP BY opened_month, days_bucket;
```

Cohort analysis requires stable opened date and lifecycle facts.

---

## 22. Funnel Analysis

Workflow funnel:

```text
OPENED -> ASSIGNED -> UNDER_REVIEW -> DECISION_ISSUED -> CLOSED
```

Analyze drop-off:

```sql
SELECT
    COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
    COUNT(*) FILTER (WHERE assigned_at IS NOT NULL) AS assigned,
    COUNT(*) FILTER (WHERE decision_at IS NOT NULL) AS decision_issued,
    COUNT(*) FILTER (WHERE closed_at IS NOT NULL) AS closed
FROM fact_case_funnel
WHERE opened_date BETWEEN :from AND :to;
```

Need decide:

- max time window
- repeated transitions
- reopened cases
- cancelled cases
- correction policy

---

## 23. Percentiles

Average can hide tail.

Use percentiles for durations.

Example concept:

```sql
percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_close) AS median_days,
percentile_cont(0.9) WITHIN GROUP (ORDER BY days_to_close) AS p90_days
```

Vendor support varies.

Approximate percentile may be used in warehouses for large data.

Use p50/p90/p95 for SLA/workflow analytics.

---

## 24. Approximate Analytics

For huge data:

- approximate count distinct
- approximate percentile
- sketches
- sampling
- pre-aggregation

Examples:

```text
HyperLogLog
t-digest
reservoir sampling
```

Approximation is acceptable only if:

- error bounds understood
- metric labeled
- business accepts
- not used for legal/regulatory exactness

Regulatory reports usually need exact/reproducible numbers.

---

## 25. OLAP Storage

Warehouses often use columnar storage.

Columnar benefits:

- scan only needed columns
- compression
- vectorized execution
- fast aggregation
- good for analytical workloads

OLTP row storage benefits:

- fast row-level writes
- point lookups
- transactions

Do not expect OLTP row-store to behave like columnar warehouse for huge analytics.

---

## 26. Warehouse / Data Mart

Data warehouse centralizes analytical data.

Data mart is subject-specific subset.

Example marts:

```text
case_operations_mart
sla_reporting_mart
officer_workload_mart
financial_reconciliation_mart
```

Warehouse pipeline:

```text
OLTP sources -> ingestion -> staging/raw -> transformation -> facts/dimensions -> marts -> BI
```

Java services may produce source data/events; data platform transforms for analytics.

---

## 27. ELT with SQL Transformations

Modern analytics often uses ELT:

1. extract/load raw data
2. transform in warehouse with SQL
3. build marts
4. test metrics

Benefits:

- raw data preserved
- transformations versioned
- SQL powerful for set processing
- easier rebuild
- lineage

Tools vary, but principle is stable.

---

## 28. Data Lineage

Lineage answers:

```text
Where did this metric come from?
Which source tables?
Which transformations?
Which version?
When refreshed?
Which filters?
```

For trusted reports, lineage matters.

Store/report metadata:

```text
source system
source extraction time
transformation version
job run id
snapshot time
row counts
quality checks
```

Without lineage, analytics loses trust.

---

## 29. Data Quality Tests for Analytics

Tests:

- not null keys
- unique grain
- accepted values
- referential integrity to dimensions
- freshness
- row count thresholds
- metric sanity ranges
- no duplicate facts
- totals match source
- late arriving data handling

Example:

```sql
SELECT tenant_id, case_id, COUNT(*)
FROM fact_case_lifecycle
GROUP BY tenant_id, case_id
HAVING COUNT(*) > 1;
```

This tests grain.

---

## 30. Late Arriving Facts

Late event arrives after analytics period closed.

Options:

- update current corrected mart
- create adjustment row
- mark late arrival
- restate prior period
- include in next period
- produce amended report

Policy depends domain.

Store:

```text
occurred_at
received_at
loaded_at
reported_period
correction_period
```

Temporal semantics are central to analytics.

---

## 31. Metric Versioning

Metric definition can change.

Example:

```text
Old breach rate excluded cancelled cases.
New breach rate includes some cancelled cases.
```

If report consumers compare history, changing definition silently is dangerous.

Options:

- version metric
- restate history
- annotate change date
- maintain old and new metrics in parallel
- snapshot published reports

Metric definitions are contracts.

---

## 32. BI Tool Consumption

BI tools often query views/tables directly.

Design BI layer:

- stable column names
- business-friendly names
- documented grain
- dimensions/facts separated
- no ambiguous joins
- security filters
- row-level access if needed
- refresh metadata
- certified datasets

BI users should not need to understand OLTP internals.

---

## 33. Semantic Layer

Semantic layer defines:

- metrics
- dimensions
- joins
- filters
- access rules
- friendly names
- descriptions
- default time grains

Benefits:

- consistent metrics across dashboards
- fewer ad hoc wrong calculations
- governance
- easier discovery

Without semantic layer, each analyst may redefine “active case” differently.

---

## 34. Analytical Queries in Java Services

Sometimes Java API provides reporting endpoints.

Guidelines:

- use DTO projections
- use bounded filters
- use async jobs for heavy reports
- query reporting schema/replica/warehouse
- enforce authorization
- avoid unbounded exports
- cache/precompute if needed
- show freshness
- instrument query
- avoid OLTP primary heavy scans

Java service should not become accidental BI engine on primary DB.

---

## 35. Dashboard Design

Dashboard queries are dangerous because they run repeatedly.

Bad dashboard:

```text
Every 5 seconds:
  SELECT COUNT(*) FROM cases GROUP BY status
  SELECT COUNT(*) FROM cases WHERE ...
  SELECT AVG(...) FROM huge joins
```

Better:

- pre-aggregate
- materialized view
- cache
- async refresh
- push updates
- query replica/warehouse
- rate limit
- show freshness timestamp

Dashboard freshness rarely needs per-second OLTP accuracy.

---

## 36. Report Snapshotting

For official reports:

```sql
CREATE TABLE report_snapshots (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    report_type TEXT NOT NULL,
    report_period TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    metric_version TEXT NOT NULL,
    data JSONB NOT NULL,
    generated_by UUID NOT NULL
);
```

This preserves:

- exact output
- metric version
- generated time
- actor
- period

Do not rely on live query for submitted regulatory report.

---

## 37. Analytical Security

Analytics data can leak sensitive information.

Controls:

- row-level access by tenant/region
- column masking
- aggregation thresholds
- suppress small counts
- PII removal/tokenization
- export audit
- warehouse grants
- dashboard access review
- data classification
- lineage/security tags

Aggregates can still reveal information if group size small.

Example:

```text
1 case in rare category reveals person/event.
```

Use suppression rules where needed.

---

## 38. Data Freshness

Every report/dashboard should know freshness.

Examples:

```text
updated every 5 minutes
last warehouse load at 09:00
data complete through yesterday
replica lag currently 30s
snapshot generated on 2026-06-01
```

Freshness table:

```sql
CREATE TABLE data_product_freshness (
    data_product TEXT PRIMARY KEY,
    last_successful_refresh_at TIMESTAMPTZ NOT NULL,
    source_max_event_at TIMESTAMPTZ,
    status TEXT NOT NULL
);
```

Show freshness to users/admins.

---

## 39. OLTP-to-OLAP Pipeline Patterns

Patterns:

### 39.1 Nightly Batch

Simple, acceptable for daily reports.

### 39.2 Incremental by Updated At

Easy but can miss deletes/child changes if poorly designed.

### 39.3 CDC

Captures changes from DB log.

### 39.4 Outbox/Events

Domain semantic events.

### 39.5 Snapshot Extract

Periodic full/partition extract.

Each has trade-offs.

---

## 40. Updated-At Incremental Pitfalls

Query:

```sql
SELECT *
FROM cases
WHERE updated_at > :last_sync
ORDER BY updated_at, id;
```

Pitfalls:

- clock precision
- same timestamp ties
- updates to child tables not reflected
- deletes missed
- transaction commit order
- backdated changes
- timezone
- trigger missing
- no immutable event record

Use `(updated_at, id)` cursor and handle deletes explicitly if using this pattern.

---

## 41. CDC vs Domain Events

CDC:

```text
row changed
```

Domain event:

```text
case closed
```

CDC good for replication/warehouse raw ingestion.

Domain events good for business analytics and integrations.

Both can coexist.

For analytics, CDC may require transformation to infer business meaning.

Outbox events preserve semantics but may not include all raw column changes.

---

## 42. Analytical SQL Examples

### 42.1 Monthly Opened Cases

```sql
SELECT
    date_trunc('month', opened_at) AS month,
    COUNT(*) AS opened_cases
FROM cases
GROUP BY date_trunc('month', opened_at)
ORDER BY month;
```

For production reporting, prefer local date/month dimension if timezone matters.

### 42.2 SLA Breach Rate

```sql
SELECT
    due_month,
    COUNT(*) FILTER (WHERE breached) AS breached_count,
    COUNT(*) AS due_count,
    COUNT(*) FILTER (WHERE breached)::numeric / NULLIF(COUNT(*), 0) AS breach_rate
FROM fact_sla_obligation
GROUP BY due_month;
```

### 42.3 Officer Workload

```sql
SELECT
    officer_key,
    snapshot_date,
    COUNT(*) AS open_case_count
FROM fact_case_daily_snapshot
WHERE status_key IN (...)
GROUP BY officer_key, snapshot_date;
```

---

## 43. Avoid Analytical `SELECT *`

Analytics should select only needed columns.

Columnar systems reward column selection.

OLTP systems also benefit from less IO/network.

Bad:

```sql
SELECT *
FROM fact_case_lifecycle;
```

Good:

```sql
SELECT opened_date, jurisdiction_key, closed_count
FROM fact_case_lifecycle;
```

Data minimization matters for security too.

---

## 44. Analytical Indexing

OLTP indexes optimize point lookups.

Analytics often benefits from:

- partitioning by date
- columnar storage
- sort keys/clustering
- bitmap indexes in some DBs
- covering indexes for common aggregates
- materialized aggregates
- BRIN for append-only time data
- star schema join keys

Do not add dozens of reporting indexes to hot OLTP tables if warehouse/read model is better.

---

## 45. Query Cost Governance

Analytics users can accidentally run huge queries.

Controls:

- warehouse separate from OLTP
- query timeout
- resource groups/queues
- cost limits
- row limits
- approved datasets
- materialized aggregates
- dashboard caching
- access review
- query monitoring

BI freedom needs guardrails.

---

## 46. Java Backend Role

As Java engineer, your role:

- produce correct source data
- model temporal facts
- emit domain events/outbox
- avoid corrupting analytics semantics
- expose safe reporting APIs
- avoid heavy OLTP primary reports
- collaborate on metric definitions
- ensure data classification/security
- provide reconciliation hooks
- design read models where needed
- understand warehouse consumers

Analytics quality starts in OLTP source design.

---

## 47. Anti-Patterns

```text
[ ] dashboard live-counts huge OLTP tables every few seconds
[ ] report metric has no definition
[ ] fact table grain undocumented
[ ] join multiple one-to-many facts and count parent rows
[ ] use UTC day where business local day required
[ ] overwrite dimensions without preserving history when needed
[ ] regulatory report not snapshotted
[ ] BI queries raw OLTP tables directly with SELECT *
[ ] no freshness indicator
[ ] late arriving events ignored
[ ] metric definition changes silently
[ ] warehouse contains PII without access controls
[ ] read replica used for analytics causing lag and conflicts
[ ] Java API provides unbounded synchronous report export
```

---

## 48. Analytical Design Checklist

```text
[ ] Is this OLTP or OLAP workload?
[ ] What is fact grain?
[ ] What are dimensions?
[ ] What are metric definitions?
[ ] What is numerator/denominator?
[ ] What time zone/date semantics?
[ ] Current corrected or as-submitted?
[ ] How are late events handled?
[ ] Is snapshot required?
[ ] Is dimension history needed?
[ ] What is freshness?
[ ] Is source data reconciled?
[ ] Is security/access defined?
[ ] Is workload separated from OLTP primary?
[ ] Are dashboards pre-aggregated/cached?
[ ] Are reports versioned?
[ ] Are data quality tests defined?
```

---

## 49. Practical Exercises

### Exercise 1 — Define Metric

Define SLA breach rate completely: numerator, denominator, period, exclusions, timezone, freshness, correction policy.

### Exercise 2 — Identify Grain

For `fact_case_daily_snapshot`, state grain and write query for backlog by status per day.

### Exercise 3 — Fix Join Multiplication

Given cases joined to evidences and notes, explain wrong count and rewrite using pre-aggregation.

### Exercise 4 — SCD Type 2

Design officer dimension preserving department history.

### Exercise 5 — Dashboard Strategy

A dashboard shows open cases by status every 10 seconds. Propose materialized/pre-aggregated design with freshness.

---

## 50. Koneksi ke Part Berikutnya

Part ini membahas analytical SQL, OLAP, warehousing, and reporting systems.

Part berikutnya, `part-032`, akan membahas vendor-specific comparison:

- PostgreSQL
- MySQL
- SQL Server
- Oracle
- dialect differences
- indexing differences
- transaction behavior
- JSON/full-text/window support
- migration/ops differences
- how Java engineers choose and adapt

Setelah memahami SQL secara konseptual dan operasional, kita akan melihat perbedaan nyata antar database engine.

---

## 51. Ringkasan Bagian Ini

Hal penting dari part 031:

1. OLTP dan OLAP punya tujuan dan workload berbeda.
2. Heavy analytics di OLTP primary bisa merusak workload transaksi.
3. Analytical SQL membutuhkan grain, metric, dimension, and time semantics yang jelas.
4. Fact table menyimpan measurable events/states; dimension table menyimpan descriptive grouping attributes.
5. Star schema memudahkan aggregation and BI.
6. Date/timezone semantics sangat penting untuk reporting.
7. Slowly changing dimensions menjaga historical grouping.
8. Snapshot facts berguna untuk backlog/state over time.
9. Current corrected, as-known-at, and as-submitted reports berbeda.
10. Metric definitions harus eksplisit.
11. Join multiplication adalah sumber bug analytics besar.
12. Pre-aggregation/materialized views mempercepat dashboards.
13. Window functions, percentiles, cohorts, funnels adalah analytical patterns penting.
14. Warehouses/data marts memisahkan analytics dari OLTP.
15. Lineage and data quality tests membangun trust.
16. Late arriving data and correction policy harus didesain.
17. BI/semantic layer mencegah definisi metrik liar.
18. Analytics juga butuh security, masking, and access control.
19. Freshness harus terlihat.
20. Java backend source design menentukan kualitas analytics downstream.

Kalimat inti:

> Reporting yang benar bukan query GROUP BY semata; ia adalah kontrak semantik tentang grain, waktu, populasi, definisi metrik, freshness, dan sumber kebenaran.

---

## 52. Referensi

1. PostgreSQL Documentation — Aggregate Functions.  
   https://www.postgresql.org/docs/current/functions-aggregate.html

2. PostgreSQL Documentation — Window Functions.  
   https://www.postgresql.org/docs/current/tutorial-window.html

3. PostgreSQL Documentation — GROUPING SETS, CUBE, ROLLUP.  
   https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-GROUPING-SETS

4. Kimball Group — Dimensional Modeling Techniques.  
   https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/

5. Ralph Kimball and Margy Ross — The Data Warehouse Toolkit.

6. Martin Fowler — Event Sourcing.  
   https://martinfowler.com/eaaDev/EventSourcing.html

7. Martin Fowler — CQRS.  
   https://martinfowler.com/bliki/CQRS.html

8. Google SRE Book — Data Integrity.  
   https://sre.google/sre-book/data-integrity/

---

## 53. Status Seri

Seri belum selesai.

Bagian selesai:

- `learn-sql-mastery-for-java-engineers-part-000.md`
- `learn-sql-mastery-for-java-engineers-part-001.md`
- `learn-sql-mastery-for-java-engineers-part-002.md`
- `learn-sql-mastery-for-java-engineers-part-003.md`
- `learn-sql-mastery-for-java-engineers-part-004.md`
- `learn-sql-mastery-for-java-engineers-part-005.md`
- `learn-sql-mastery-for-java-engineers-part-006.md`
- `learn-sql-mastery-for-java-engineers-part-007.md`
- `learn-sql-mastery-for-java-engineers-part-008.md`
- `learn-sql-mastery-for-java-engineers-part-009.md`
- `learn-sql-mastery-for-java-engineers-part-010.md`
- `learn-sql-mastery-for-java-engineers-part-011.md`
- `learn-sql-mastery-for-java-engineers-part-012.md`
- `learn-sql-mastery-for-java-engineers-part-013.md`
- `learn-sql-mastery-for-java-engineers-part-014.md`
- `learn-sql-mastery-for-java-engineers-part-015.md`
- `learn-sql-mastery-for-java-engineers-part-016.md`
- `learn-sql-mastery-for-java-engineers-part-017.md`
- `learn-sql-mastery-for-java-engineers-part-018.md`
- `learn-sql-mastery-for-java-engineers-part-019.md`
- `learn-sql-mastery-for-java-engineers-part-020.md`
- `learn-sql-mastery-for-java-engineers-part-021.md`
- `learn-sql-mastery-for-java-engineers-part-022.md`
- `learn-sql-mastery-for-java-engineers-part-023.md`
- `learn-sql-mastery-for-java-engineers-part-024.md`
- `learn-sql-mastery-for-java-engineers-part-025.md`
- `learn-sql-mastery-for-java-engineers-part-026.md`
- `learn-sql-mastery-for-java-engineers-part-027.md`
- `learn-sql-mastery-for-java-engineers-part-028.md`
- `learn-sql-mastery-for-java-engineers-part-029.md`
- `learn-sql-mastery-for-java-engineers-part-030.md`
- `learn-sql-mastery-for-java-engineers-part-031.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-032.md` — Vendor-Specific Deep Comparison: PostgreSQL, MySQL, SQL Server, Oracle

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-030.md">⬅️ Part 30 — Observability, Operations, Backup, Restore, and Disaster Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-032.md">Part 32 — Vendor-Specific Deep Comparison: PostgreSQL, MySQL, SQL Server, Oracle ➡️</a>
</div>

# learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-014.md

# Part 014 — Materialized Views I: Incremental Transformation Mental Model

> Series: **OLAP, Column-Oriented Database, and ClickHouse Mastery for Java Engineers**  
> Part: **014 / 034**  
> Focus: **ClickHouse materialized views as insert-time transformation pipelines**  
> Prerequisites: Part 000–013, especially MergeTree internals, schema design, ingestion, query execution, and aggregation states.

---

## 0. Why This Part Matters

Materialized views are one of the most powerful features in ClickHouse, but also one of the most misunderstood.

Many engineers hear the term **materialized view** and import a mental model from PostgreSQL, Oracle, SQL Server, or generic relational databases:

> “A materialized view is a stored result of a query that I refresh periodically.”

In ClickHouse, that is only partially true, and for the most common high-performance use case it is the wrong starting model.

The most important ClickHouse materialized view model is:

> A materialized view is an **insert-time transformation pipeline**.  
> When data is inserted into a source table, ClickHouse runs a query over the inserted block and writes the transformed result into a target table.

That one sentence changes how you design everything:

- the source table,
- the target table,
- the target engine,
- the aggregation state columns,
- the backfill process,
- the failure model,
- the correctness model,
- the operational monitoring,
- the Java ingestion behavior,
- and the query serving layer.

If you treat a ClickHouse materialized view as a normal logical view, you will build fragile analytics systems. If you treat it as a deterministic insert-time dataflow, you can build extremely fast serving tables for dashboards, APIs, rollups, counters, time buckets, compliance reporting, and operational analytics.

This part is about building that mental model deeply.

---

## 1. What You Should Be Able To Do After This Part

After finishing this part, you should be able to:

1. Explain why ClickHouse materialized views are closer to **insert triggers** than ordinary SQL views.
2. Design a source table and target table pair correctly.
3. Decide whether a target table should use `MergeTree`, `SummingMergeTree`, `AggregatingMergeTree`, or another engine.
4. Understand when to store final values vs aggregate states.
5. Use `AggregateFunction` and `SimpleAggregateFunction` deliberately.
6. Reason about `sumState`, `uniqState`, `avgState`, `quantileState`, and corresponding `...Merge` functions.
7. Avoid common materialized view correctness traps.
8. Backfill historical data safely.
9. Understand why `POPULATE` is usually risky for production workflows.
10. Monitor materialized view behavior through source/target tables and system tables.
11. Explain the write amplification introduced by materialized views.
12. Build a reliable Java ingestion architecture around materialized views.

---

## 2. The Core Mental Model

### 2.1 Not a Query Shortcut, but a Data Movement Contract

A normal SQL view is a saved query:

```sql
CREATE VIEW v AS
SELECT ... FROM table;
```

When you query `v`, the database runs the underlying query.

A ClickHouse incremental materialized view is different:

```sql
CREATE MATERIALIZED VIEW mv TO target_table AS
SELECT ... FROM source_table;
```

When new rows are inserted into `source_table`, ClickHouse applies the `SELECT` to the inserted block and inserts the result into `target_table`.

The result is not dynamically computed from the whole source table every time.

The view is not simply “a stored SELECT”. It is a pipeline:

```text
INSERT into source table
        │
        ▼
Inserted block
        │
        ▼
Materialized view SELECT runs on that inserted block
        │
        ▼
Transformed rows / aggregate states
        │
        ▼
Inserted into target table
```

The target table is a real table.

It has:

- its own engine,
- its own `ORDER BY`,
- its own partitioning,
- its own parts,
- its own merges,
- its own TTL,
- its own storage cost,
- its own query performance characteristics.

That means materialized view design is not only SQL design. It is physical data architecture.

---

### 2.2 Source Table vs Target Table

A materialized view usually connects two table roles:

| Role | Meaning |
|---|---|
| Source table | Table that receives raw or intermediate inserted data |
| Materialized view | Transformation triggered by inserts into source |
| Target table | Real table that stores transformed result |

Example:

```text
raw_case_events
      │
      ├── mv_case_events_hourly
      ▼
case_events_hourly
```

The source table might be raw event-level data.

The target table might be hourly aggregate data.

The materialized view itself should be understood as an edge in a dataflow graph:

```text
source ── transformation ──> target
```

This is very different from thinking:

```text
view = virtual table
```

---

### 2.3 A Materialized View Processes Inserted Blocks

The materialized view query does not magically rescan all historical rows of the source table for every insert.

It processes the block being inserted.

This has major implications:

1. If old data already exists before the materialized view is created, the new materialized view will not automatically process it unless you backfill.
2. If you insert duplicate source events, the target table receives duplicate contributions unless your model handles deduplication.
3. If you correct historical data, the target does not automatically reverse previous aggregate contributions unless you model corrections explicitly.
4. If the view query contains joins, only inserts into the left/source table trigger the view. Updates/inserts into joined dimension tables do not retroactively update previous target rows.
5. The view is part of the write path, so expensive transformations increase insert cost.

This is the first big invariant:

> A ClickHouse incremental materialized view transforms **newly inserted blocks**, not the abstract current truth of all source tables.

---

## 3. Why Materialized Views Exist in OLAP

ClickHouse is already fast at scanning large columnar datasets. So why materialize anything?

Because some queries are still expensive:

- high-cardinality `GROUP BY`,
- exact distinct counts,
- percentile calculations,
- rollups over billions of events,
- repeatedly computed dashboard metrics,
- multi-tenant reporting summaries,
- funnel/cohort pre-processing,
- log/metric downsampling,
- serving APIs with strict latency budget.

Materialized views shift work:

```text
query-time cost ──shifted to──> insert-time cost
```

This is the primary trade-off.

Without materialized view:

```text
Every dashboard query scans raw events and aggregates again.
```

With materialized view:

```text
Every insert contributes to a pre-aggregated table.
Dashboard queries scan much smaller serving table.
```

This is not free. You pay through:

- extra writes,
- extra storage,
- more background merges,
- more ingestion CPU,
- more operational complexity,
- more correctness responsibilities.

But when designed properly, the payoff can be enormous.

---

## 4. Basic Example: Raw Events to Hourly Counts

Assume a raw table:

```sql
CREATE TABLE raw_case_events
(
    tenant_id LowCardinality(String),
    case_id UUID,
    event_id UUID,
    event_type LowCardinality(String),
    actor_role LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    ingest_time DateTime64(3, 'UTC'),
    source_system LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_type, event_time, case_id);
```

Now we want hourly counts by tenant and event type.

Target table:

```sql
CREATE TABLE case_events_hourly
(
    tenant_id LowCardinality(String),
    event_type LowCardinality(String),
    hour DateTime('UTC'),
    events_count UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, event_type, hour);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_case_events_hourly
TO case_events_hourly
AS
SELECT
    tenant_id,
    event_type,
    toStartOfHour(event_time) AS hour,
    count() AS events_count
FROM raw_case_events
GROUP BY
    tenant_id,
    event_type,
    hour;
```

When you insert raw events, the materialized view writes aggregated rows into `case_events_hourly`.

If a block contains:

```text
tenant=A, event_type=CASE_OPENED, hour=10:00, 500 events
```

Then the target table receives something like:

```text
tenant=A, event_type=CASE_OPENED, hour=10:00, events_count=500
```

If another block later contributes 300 more events for the same key, the target may temporarily contain another row:

```text
tenant=A, event_type=CASE_OPENED, hour=10:00, events_count=300
```

`SummingMergeTree` can merge them in the background. But until merge happens, queries should still be written defensively:

```sql
SELECT
    tenant_id,
    event_type,
    hour,
    sum(events_count) AS events
FROM case_events_hourly
WHERE tenant_id = 'A'
  AND hour >= now() - INTERVAL 24 HOUR
GROUP BY
    tenant_id,
    event_type,
    hour
ORDER BY hour;
```

Do not assume background merges have already collapsed all rows.

This is a critical rule:

> Specialized MergeTree engines reduce rows during background merges, but query correctness should not depend on merges having already happened.

---

## 5. Materialized View Syntax Patterns

### 5.1 Recommended Pattern: Explicit Target Table with `TO`

The most production-friendly pattern is:

```sql
CREATE TABLE target_table (...)
ENGINE = ...
ORDER BY ...;

CREATE MATERIALIZED VIEW mv_name
TO target_table
AS
SELECT ...
FROM source_table;
```

Why this is preferred:

1. You control the target table engine explicitly.
2. You control target `ORDER BY` and partitioning.
3. You can inspect and manage the target table directly.
4. You can backfill into the target table manually.
5. You can drop/recreate the view without necessarily dropping the target table.
6. The topology is clearer for operations.

This is the style we will use throughout this series.

---

### 5.2 Less Preferred Pattern: Materialized View with Internal Storage

ClickHouse can also create a materialized view with its own storage implicitly:

```sql
CREATE MATERIALIZED VIEW mv_name
ENGINE = MergeTree
ORDER BY (...)
AS
SELECT ... FROM source_table;
```

This can work, but it tends to be less explicit in production architectures.

For learning and small local cases, it is okay.

For serious systems, prefer:

```sql
CREATE TABLE target (...);
CREATE MATERIALIZED VIEW mv TO target AS SELECT ...;
```

The explicit target pattern makes the dataflow obvious.

---

### 5.3 `POPULATE`: Why It Is Usually Risky

You may see examples like:

```sql
CREATE MATERIALIZED VIEW mv_name
TO target_table
POPULATE
AS
SELECT ... FROM source_table;
```

The idea is to populate the materialized view with existing data.

The problem is operational safety.

In production, data may continue arriving while the view is being created. Depending on timing, you can miss rows or double-count if you do not coordinate ingestion and backfill carefully.

A safer production pattern is:

1. Create target table.
2. Create materialized view for new incoming data from a chosen cutover point.
3. Backfill historical data manually with an `INSERT INTO target SELECT ... FROM source WHERE ...` over bounded windows.
4. Reconcile counts.
5. Switch queries to target table only after validation.

This is more work, but it gives control.

---

## 6. Target Engine Selection

The target table engine determines how inserted rows are stored and merged.

Materialized views do not magically make target data correct. The target engine and query pattern must match the transformation.

### 6.1 Engine Decision Overview

| Target Pattern | Common Target Engine | Example |
|---|---|---|
| Transformed event rows | `MergeTree` | Cleaned/enriched events |
| Additive counters | `SummingMergeTree` | hourly counts, sums |
| Complex aggregate states | `AggregatingMergeTree` | distinct users, avg, quantiles |
| Latest row by version | `ReplacingMergeTree` | current state snapshots |
| Collapsing positive/negative rows | `CollapsingMergeTree` / `VersionedCollapsingMergeTree` | correction modeling |

This part focuses mainly on `MergeTree`, `SummingMergeTree`, and `AggregatingMergeTree`.

---

### 6.2 Target as `MergeTree`

Use plain `MergeTree` when the materialized view produces rows that should be stored as-is.

Example: refined/cleaned events.

```sql
CREATE TABLE refined_case_events
(
    tenant_id LowCardinality(String),
    case_id UUID,
    event_id UUID,
    normalized_event_type LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    is_external_actor UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, normalized_event_type, event_time, case_id);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_refined_case_events
TO refined_case_events
AS
SELECT
    tenant_id,
    case_id,
    event_id,
    multiIf(
        event_type IN ('OPEN', 'CASE_OPENED'), 'CASE_OPENED',
        event_type IN ('CLOSE', 'CASE_CLOSED'), 'CASE_CLOSED',
        event_type
    ) AS normalized_event_type,
    event_time,
    actor_role IN ('external_user', 'regulated_entity') AS is_external_actor
FROM raw_case_events;
```

This is a transformation, not an aggregation.

Use cases:

- parsing raw fields,
- normalizing enum values,
- extracting hot JSON fields,
- adding derived columns,
- projecting subset of columns,
- converting semi-structured ingestion into typed analytical rows.

---

### 6.3 Target as `SummingMergeTree`

Use `SummingMergeTree` when rows with the same sorting key should be summed across numeric columns.

Example:

```sql
CREATE TABLE api_requests_5m
(
    tenant_id LowCardinality(String),
    endpoint LowCardinality(String),
    status_class LowCardinality(String),
    bucket DateTime('UTC'),
    requests UInt64,
    errors UInt64,
    total_latency_ms UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY (tenant_id, endpoint, status_class, bucket);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_api_requests_5m
TO api_requests_5m
AS
SELECT
    tenant_id,
    endpoint,
    concat(toString(intDiv(status_code, 100)), 'xx') AS status_class,
    toStartOfFiveMinutes(event_time) AS bucket,
    count() AS requests,
    countIf(status_code >= 500) AS errors,
    sum(latency_ms) AS total_latency_ms
FROM raw_api_requests
GROUP BY
    tenant_id,
    endpoint,
    status_class,
    bucket;
```

Query:

```sql
SELECT
    bucket,
    endpoint,
    sum(requests) AS requests,
    sum(errors) AS errors,
    sum(total_latency_ms) / sum(requests) AS avg_latency_ms
FROM api_requests_5m
WHERE tenant_id = 'tenant-a'
  AND bucket >= now() - INTERVAL 1 DAY
GROUP BY bucket, endpoint
ORDER BY bucket, requests DESC;
```

Important:

`SummingMergeTree` does not mean you can omit `GROUP BY` forever. Until parts merge, multiple rows with the same logical key can exist. Correct query should aggregate again.

---

### 6.4 Target as `AggregatingMergeTree`

Use `AggregatingMergeTree` when you need to store **aggregate states**, not just final additive values.

Why?

Some metrics cannot be safely summed from final values:

- average,
- exact distinct count,
- approximate distinct count,
- quantiles,
- top-K,
- bitmap aggregations,
- histograms,
- complex custom aggregate states.

Example: hourly unique actors and latency quantiles.

Target table:

```sql
CREATE TABLE case_events_hourly_states
(
    tenant_id LowCardinality(String),
    event_type LowCardinality(String),
    hour DateTime('UTC'),
    events_count SimpleAggregateFunction(sum, UInt64),
    unique_cases AggregateFunction(uniq, UUID),
    unique_actors AggregateFunction(uniq, String),
    p95_duration_state AggregateFunction(quantileTDigest(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, event_type, hour);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_case_events_hourly_states
TO case_events_hourly_states
AS
SELECT
    tenant_id,
    event_type,
    toStartOfHour(event_time) AS hour,
    count() AS events_count,
    uniqState(case_id) AS unique_cases,
    uniqState(actor_id) AS unique_actors,
    quantileTDigestState(0.95)(duration_ms) AS p95_duration_state
FROM raw_case_events
GROUP BY
    tenant_id,
    event_type,
    hour;
```

Query:

```sql
SELECT
    tenant_id,
    event_type,
    hour,
    sum(events_count) AS events,
    uniqMerge(unique_cases) AS cases,
    uniqMerge(unique_actors) AS actors,
    quantileTDigestMerge(0.95)(p95_duration_state) AS p95_duration_ms
FROM case_events_hourly_states
WHERE tenant_id = 'tenant-a'
  AND hour >= now() - INTERVAL 7 DAY
GROUP BY
    tenant_id,
    event_type,
    hour
ORDER BY hour;
```

The key idea:

```text
Insert-time: store states with ...State
Query-time: finalize/merge states with ...Merge
```

This unlocks incremental aggregation for metrics that cannot be represented as simple sums.

---

## 7. Aggregate States: The Most Important Advanced Concept

### 7.1 Final Values vs Intermediate States

Suppose you want average latency.

A bad rollup might store:

```text
bucket=10:00, avg_latency=120
bucket=10:00, avg_latency=300
```

Can you compute the true average by averaging these averages?

Usually no.

The true average requires:

```text
sum(latency) / count(requests)
```

or an internal aggregate state containing equivalent information.

Similarly, quantiles cannot be averaged. Distinct counts cannot be summed across overlapping sets.

That is why ClickHouse has aggregate states.

An aggregate state is an internal serialized representation of partially computed aggregation.

Conceptually:

```text
avgState(latency)
  ≈ stores partial sum + partial count

uniqState(user_id)
  ≈ stores sketch/set-like state for distinct count

quantileTDigestState(latency)
  ≈ stores digest representation for quantile estimation
```

Then later:

```text
avgMerge(state)
uniqMerge(state)
quantileTDigestMerge(state)
```

combine and finalize states.

---

### 7.2 `AggregateFunction` Type

A column of type `AggregateFunction` stores the intermediate state of an aggregate function.

Example:

```sql
unique_users AggregateFunction(uniq, UUID)
```

This means:

- inserted values must be `uniqState(user_id)`, not a normal integer count,
- queried values should be finalized with `uniqMerge(unique_users)`,
- the column is not human-readable like a normal value,
- it is designed for incremental merging.

This is not a normal scalar column.

It is a persisted aggregate state.

---

### 7.3 `SimpleAggregateFunction` Type

`SimpleAggregateFunction` is useful when the aggregate can be represented directly as its final scalar value and merged simply.

Example:

```sql
events_count SimpleAggregateFunction(sum, UInt64)
```

For count/sum-like values, storing a scalar that can be summed is enough.

You will often see target tables that combine both:

```sql
events_count SimpleAggregateFunction(sum, UInt64),
unique_users AggregateFunction(uniq, UUID),
p95_latency AggregateFunction(quantileTDigest(0.95), UInt64)
```

This is reasonable:

- simple additive metrics use `SimpleAggregateFunction`,
- complex metrics use `AggregateFunction`.

---

### 7.4 The `State` / `Merge` Pair

Common pattern:

| Insert-time function | Stored type | Query-time function |
|---|---|---|
| `sumState(x)` | `AggregateFunction(sum, T)` | `sumMerge(state)` |
| `avgState(x)` | `AggregateFunction(avg, T)` | `avgMerge(state)` |
| `uniqState(x)` | `AggregateFunction(uniq, T)` | `uniqMerge(state)` |
| `uniqExactState(x)` | `AggregateFunction(uniqExact, T)` | `uniqExactMerge(state)` |
| `quantileTDigestState(0.95)(x)` | `AggregateFunction(quantileTDigest(0.95), T)` | `quantileTDigestMerge(0.95)(state)` |

The mental model:

```text
raw rows
  └─ aggregateState at insert time
        └─ stored in AggregatingMergeTree
              └─ merged/finalized at query time
```

---

## 8. Materialized Views and Correctness

Materialized views are powerful because they are incremental. They are dangerous for the same reason.

### 8.1 Duplicate Source Inserts

If the same source event is inserted twice, the materialized view processes it twice.

If the target table is a count table, the count increases twice.

ClickHouse materialized views do not inherently know your business idempotency rules.

Correctness must come from one or more of:

1. upstream event idempotency,
2. source table deduplication strategy,
3. `ReplacingMergeTree` modeling,
4. correction events,
5. deterministic batch replay windows,
6. reconciliation jobs,
7. target table rebuilds.

Do not assume:

```text
materialized view = exactly-once business aggregation
```

Better invariant:

```text
materialized view = deterministic transformation of what was successfully inserted into source
```

If the source has duplicates, the target reflects duplicates.

---

### 8.2 Late Arriving Events

Suppose an event from yesterday arrives today.

If the materialized view groups by `event_time`, it will write to yesterday's bucket.

This is usually good.

But it means:

- old partitions may receive new parts,
- dashboards for previous periods may change,
- TTL might already have moved/deleted relevant data,
- downstream exports may need correction logic,
- regulatory reports may require versioning or restatement.

You need a policy:

| Question | Design Impact |
|---|---|
| Are late events allowed? | Target must accept old buckets |
| How late? | Retention/backfill window |
| Can published reports change? | Need report versioning |
| Are corrections audited? | Need correction event model |
| Is ingestion time also needed? | Store both event time and ingest time |

---

### 8.3 Updates and Deletes

Materialized views do not automatically reverse previous contributions when a source row is mutated.

This is a common trap.

Example:

1. Insert event with `amount = 100`.
2. Materialized view adds `100` to aggregate target.
3. Later update source event to `amount = 200`.
4. The target does not automatically subtract `100` and add `200` in the intuitive business sense.

ClickHouse mutations rewrite table data, but materialized views are triggered by inserts, not by arbitrary historical reinterpretation.

For analytics systems, prefer append-based correction models:

```text
original event: amount +100
correction event: amount -100
corrected event: amount +200
```

or:

```text
versioned latest-state table + periodic rebuild of aggregates
```

Mutable analytics requires explicit modeling.

---

### 8.4 Joins in Materialized Views

A materialized view can contain joins, but you must understand the trigger model.

Example:

```sql
CREATE MATERIALIZED VIEW mv_enriched_events
TO enriched_events
AS
SELECT
    e.event_id,
    e.tenant_id,
    e.user_id,
    u.region,
    e.event_time
FROM raw_events e
LEFT JOIN user_dimension u ON e.user_id = u.user_id;
```

The view is triggered by inserts into `raw_events`.

If `user_dimension` changes later, old rows in `enriched_events` are not automatically recomputed.

Therefore, joins in materialized views are safe mostly when:

1. dimension data is stable,
2. dimension changes do not need retroactive correction,
3. dimension table is small enough for efficient lookup,
4. you accept enrichment as “as known at ingestion time”,
5. or you have a rebuild strategy.

For regulatory systems, this distinction matters a lot:

```text
Was the report based on current dimension value?
Or dimension value at event time?
Or dimension value at ingestion time?
Or dimension value at report generation time?
```

Those are different truths.

---

## 9. Backfill Strategy

### 9.1 Why Backfill Is Required

If you create a materialized view after source data already exists, the view will process future inserts only.

Historical data must be loaded into the target table separately.

---

### 9.2 Safe Backfill Pattern

Assume:

```text
source: raw_case_events
target: case_events_hourly_states
view:   mv_case_events_hourly_states
```

Recommended pattern:

#### Step 1 — Create target table

```sql
CREATE TABLE case_events_hourly_states (...)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, event_type, hour);
```

#### Step 2 — Create materialized view for new data

```sql
CREATE MATERIALIZED VIEW mv_case_events_hourly_states
TO case_events_hourly_states
AS
SELECT ...
FROM raw_case_events
GROUP BY ...;
```

#### Step 3 — Backfill historical windows manually

```sql
INSERT INTO case_events_hourly_states
SELECT
    tenant_id,
    event_type,
    toStartOfHour(event_time) AS hour,
    count() AS events_count,
    uniqState(case_id) AS unique_cases,
    uniqState(actor_id) AS unique_actors,
    quantileTDigestState(0.95)(duration_ms) AS p95_duration_state
FROM raw_case_events
WHERE event_time >= '2026-01-01 00:00:00'
  AND event_time <  '2026-02-01 00:00:00'
GROUP BY
    tenant_id,
    event_type,
    hour;
```

Repeat by partition/window.

#### Step 4 — Reconcile

Compare raw and aggregate counts:

```sql
SELECT count()
FROM raw_case_events
WHERE event_time >= '2026-01-01'
  AND event_time < '2026-02-01';
```

```sql
SELECT sum(events_count)
FROM case_events_hourly_states
WHERE hour >= '2026-01-01'
  AND hour < '2026-02-01';
```

#### Step 5 — Switch read path

Only after validation should serving queries move to the target table.

---

### 9.3 Avoiding Double Count During Backfill

The tricky part is choosing the cutover boundary.

Bad approach:

```text
Create MV while data is being inserted.
Backfill entire source table without a boundary.
```

This can double-count rows inserted after the view was created.

Safer approaches:

#### Approach A — Pause ingestion briefly

1. Pause source inserts.
2. Record max event/ingestion boundary.
3. Create view.
4. Backfill data before boundary.
5. Resume ingestion.

This is simple but may not be acceptable for high-availability pipelines.

#### Approach B — Use deterministic ingestion-time cutover

1. Choose `cutover_ingest_time`.
2. Create materialized view that handles new inserts after cutover.
3. Backfill only data before cutover.
4. Validate.

Example:

```sql
INSERT INTO case_events_hourly_states
SELECT ...
FROM raw_case_events
WHERE ingest_time < '2026-06-01 00:00:00'
GROUP BY ...;
```

But the materialized view itself will process whatever is inserted after creation. If data with old `ingest_time` can still arrive later, you need stronger coordination.

#### Approach C — Backfill into separate target, then swap

1. Create `case_events_hourly_states_v2`.
2. Backfill fully into v2.
3. Create MV to v2 for new data at controlled boundary.
4. Validate v2.
5. Switch queries to v2.
6. Retire old target later.

This is often the safest for important serving tables.

---

## 10. Materialized Views in Dataflow Layers

A common ClickHouse pattern is not one source and one target, but layered tables.

```text
raw events
   │
   ├── normalize/extract
   ▼
refined events
   │
   ├── aggregate hourly
   ▼
hourly aggregate states
   │
   ├── aggregate daily
   ▼
daily serving table
```

This is powerful but introduces dependency complexity.

Each edge is an insert-time transformation.

You must know:

- which table triggers which view,
- whether each layer stores raw rows or states,
- whether backfill should go through upstream source or target directly,
- whether downstream materialized views should be enabled during backfill,
- how to avoid duplicating downstream contributions.

A simple rule:

> For production backfill, explicitly choose whether you are replaying the pipeline or loading target tables directly. Do not accidentally do both.

---

## 11. Example: Regulatory Case Lifecycle Analytics

Assume a regulatory platform tracks case lifecycle events:

```text
CASE_CREATED
CASE_ASSIGNED
EVIDENCE_REQUESTED
EVIDENCE_RECEIVED
ESCALATED
ENFORCEMENT_ACTION_RECOMMENDED
DECISION_APPROVED
CASE_CLOSED
```

Raw table:

```sql
CREATE TABLE raw_case_lifecycle_events
(
    tenant_id LowCardinality(String),
    jurisdiction LowCardinality(String),
    case_id UUID,
    event_id UUID,
    event_type LowCardinality(String),
    actor_id String,
    actor_role LowCardinality(String),
    severity LowCardinality(String),
    event_time DateTime64(3, 'UTC'),
    ingest_time DateTime64(3, 'UTC'),
    duration_since_previous_ms Nullable(UInt64),
    source_system LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, jurisdiction, event_type, event_time, case_id);
```

Use case: dashboard needs hourly event volume, unique cases touched, unique actors, and p95 transition duration.

Target:

```sql
CREATE TABLE case_lifecycle_hourly_states
(
    tenant_id LowCardinality(String),
    jurisdiction LowCardinality(String),
    event_type LowCardinality(String),
    severity LowCardinality(String),
    hour DateTime('UTC'),

    events_count SimpleAggregateFunction(sum, UInt64),
    unique_cases AggregateFunction(uniq, UUID),
    unique_actors AggregateFunction(uniq, String),
    p95_transition_ms AggregateFunction(quantileTDigest(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, jurisdiction, event_type, severity, hour);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_case_lifecycle_hourly_states
TO case_lifecycle_hourly_states
AS
SELECT
    tenant_id,
    jurisdiction,
    event_type,
    severity,
    toStartOfHour(event_time) AS hour,

    count() AS events_count,
    uniqState(case_id) AS unique_cases,
    uniqState(actor_id) AS unique_actors,
    quantileTDigestState(0.95)(assumeNotNull(duration_since_previous_ms)) AS p95_transition_ms
FROM raw_case_lifecycle_events
WHERE duration_since_previous_ms IS NOT NULL
GROUP BY
    tenant_id,
    jurisdiction,
    event_type,
    severity,
    hour;
```

There is a subtle problem here.

The `WHERE duration_since_previous_ms IS NOT NULL` removes rows where duration is null. That means `events_count` and `unique_cases` only count events with duration.

If we want all events counted but duration quantile only for rows with duration, we need a different design.

Better:

```sql
CREATE TABLE case_lifecycle_hourly_states
(
    tenant_id LowCardinality(String),
    jurisdiction LowCardinality(String),
    event_type LowCardinality(String),
    severity LowCardinality(String),
    hour DateTime('UTC'),

    events_count SimpleAggregateFunction(sum, UInt64),
    duration_sample_count SimpleAggregateFunction(sum, UInt64),
    unique_cases AggregateFunction(uniq, UUID),
    unique_actors AggregateFunction(uniq, String),
    p95_transition_ms AggregateFunction(quantileTDigestIf(0.95), UInt64, UInt8)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, jurisdiction, event_type, severity, hour);
```

Materialized view:

```sql
CREATE MATERIALIZED VIEW mv_case_lifecycle_hourly_states
TO case_lifecycle_hourly_states
AS
SELECT
    tenant_id,
    jurisdiction,
    event_type,
    severity,
    toStartOfHour(event_time) AS hour,

    count() AS events_count,
    countIf(duration_since_previous_ms IS NOT NULL) AS duration_sample_count,
    uniqState(case_id) AS unique_cases,
    uniqState(actor_id) AS unique_actors,
    quantileTDigestIfState(0.95)(
        ifNull(duration_since_previous_ms, 0),
        duration_since_previous_ms IS NOT NULL
    ) AS p95_transition_ms
FROM raw_case_lifecycle_events
GROUP BY
    tenant_id,
    jurisdiction,
    event_type,
    severity,
    hour;
```

Query:

```sql
SELECT
    hour,
    event_type,
    sum(events_count) AS events,
    sum(duration_sample_count) AS duration_samples,
    uniqMerge(unique_cases) AS cases_touched,
    uniqMerge(unique_actors) AS actors,
    quantileTDigestIfMerge(0.95)(p95_transition_ms) AS p95_transition_ms
FROM case_lifecycle_hourly_states
WHERE tenant_id = 'regulator-a'
  AND jurisdiction = 'ID'
  AND hour >= now() - INTERVAL 30 DAY
GROUP BY hour, event_type
ORDER BY hour, event_type;
```

The lesson:

> A materialized view query is a data contract. Any filter in it permanently changes what reaches the target.

Be careful with `WHERE` clauses in materialized views.

---

## 12. Example: Raw Logs to Searchable Reduced Table

Materialized views are not only for rollups.

They can also extract typed columns from raw JSON logs.

Raw table:

```sql
CREATE TABLE raw_logs
(
    ingest_time DateTime64(3, 'UTC'),
    raw String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ingest_time)
ORDER BY ingest_time;
```

Target:

```sql
CREATE TABLE app_logs
(
    timestamp DateTime64(3, 'UTC'),
    service LowCardinality(String),
    environment LowCardinality(String),
    level LowCardinality(String),
    trace_id String,
    message String,
    latency_ms Nullable(UInt64)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, environment, level, timestamp);
```

View:

```sql
CREATE MATERIALIZED VIEW mv_app_logs
TO app_logs
AS
SELECT
    parseDateTime64BestEffort(JSONExtractString(raw, 'timestamp'), 3, 'UTC') AS timestamp,
    JSONExtractString(raw, 'service') AS service,
    JSONExtractString(raw, 'environment') AS environment,
    JSONExtractString(raw, 'level') AS level,
    JSONExtractString(raw, 'trace_id') AS trace_id,
    JSONExtractString(raw, 'message') AS message,
    JSONExtract(raw, 'latency_ms', 'Nullable(UInt64)') AS latency_ms
FROM raw_logs;
```

This is useful when:

- ingestion source gives JSON,
- hot fields should be promoted to typed columns,
- the raw payload should be retained separately,
- query-time JSON parsing would be too expensive.

But it shifts parsing cost to insert time.

If parsing fails, inserts can fail unless the transformation is defensive.

For production, consider:

- validating JSON upstream,
- using tolerant extraction patterns,
- storing parse error rows separately,
- monitoring failed inserts,
- having a replay path from raw logs.

---

## 13. Write Amplification

Every materialized view attached to a source table adds work to inserts.

If one source table has three materialized views:

```text
raw_events
  ├── mv_refined_events
  ├── mv_hourly_counts
  └── mv_daily_actor_states
```

Then inserting into `raw_events` may cause writes into three target tables.

This creates:

- more CPU at insert time,
- more memory during transformation,
- more disk writes,
- more parts,
- more background merges,
- more failure surfaces.

Materialized views are not free indexes.

A good question before adding a materialized view:

> Is this query expensive enough and frequent enough to justify paying for it during ingestion?

If not, keep querying raw data.

---

## 14. Materialized View Failure Modes

### 14.1 Target Table Wrong Engine

Symptom:

- counts look duplicated,
- averages are wrong,
- distinct counts are inaccurate,
- query requires `FINAL` unexpectedly,
- aggregation table grows too much.

Cause:

- using `MergeTree` when `SummingMergeTree` or `AggregatingMergeTree` was needed,
- storing final averages instead of states,
- expecting merges to complete before query.

Prevention:

- design target table from query semantics,
- use states for non-additive metrics,
- always query defensively with aggregation.

---

### 14.2 Backfill Double Counting

Symptom:

- target counts exceed raw counts,
- discrepancy starts around materialized view creation time,
- historical partitions have unexpected duplicates.

Cause:

- materialized view processed new inserts while manual backfill also inserted the same range.

Prevention:

- define cutover boundary,
- backfill bounded windows,
- reconcile per partition,
- use separate target table for rebuilds.

---

### 14.3 `WHERE` Clause Accidentally Drops Business-Relevant Rows

Symptom:

- dashboard numbers are lower than raw source,
- some metric dimensions disappear,
- “unknown” or “null” category missing.

Cause:

- filtering in MV query removed rows permanently from target.

Prevention:

- distinguish row eligibility from metric eligibility,
- use `countIf` / aggregate `If` combinators instead of filtering rows when only one metric needs filtering.

---

### 14.4 Joins Produce Stale Enrichment

Symptom:

- dimension values differ from current dimension table,
- reports show old region/status/category,
- re-running SELECT manually gives different result from MV target.

Cause:

- joined dimension changed after source insert.

Prevention:

- define whether enrichment is at event time, ingestion time, or query time,
- use dictionaries carefully,
- rebuild target if retroactive dimension changes matter.

---

### 14.5 Materialized View Slows Inserts

Symptom:

- insert latency increases,
- ingestion backlog grows,
- Kafka consumer lag increases,
- ClickHouse CPU spikes on insert path.

Cause:

- expensive MV transformations,
- too many views attached to source,
- high-cardinality group by during insert,
- joins in MV,
- small inserts causing many small target parts.

Prevention:

- batch inserts,
- benchmark insert path with all MVs enabled,
- use staged raw/refined/aggregate design,
- avoid unnecessary views,
- monitor target part counts.

---

### 14.6 Target Table Has Bad Sorting Key

Symptom:

- target table exists but serving queries are still slow,
- query scans many granules,
- aggregate table does not help as much as expected.

Cause:

- target `ORDER BY` was copied from source table,
- target key does not match serving query pattern,
- bucket/dimension order is wrong.

Prevention:

- design target key for target queries, not source ingestion,
- benchmark with `EXPLAIN indexes = 1`,
- inspect `system.query_log`.

---

## 15. Java Engineering Perspective

From a Java/backend perspective, materialized views change where complexity lives.

Without MVs:

```text
Java API sends heavy aggregate queries to raw table.
```

With MVs:

```text
Java ingestion writes raw data.
ClickHouse builds serving tables.
Java API queries serving tables cheaply.
```

### 15.1 Ingestion Service Responsibilities

A Java ingestion service should:

1. batch source events,
2. avoid row-by-row inserts,
3. attach idempotency metadata,
4. store `event_id`, `ingest_time`, and `source_batch_id`,
5. handle retries safely,
6. expose lag/backpressure metrics,
7. route poison events to DLQ,
8. support replay/backfill,
9. know whether it is writing raw table or target table directly,
10. coordinate schema changes with MV target schema.

Materialized views do not remove ingestion engineering responsibilities. They make them more important.

---

### 15.2 Serving API Responsibilities

A Java analytics API querying target tables should:

1. understand whether target contains final values or aggregate states,
2. use correct `...Merge` functions,
3. aggregate again even on pre-aggregated tables where background merges may be incomplete,
4. apply tenant filters early,
5. avoid exposing arbitrary group-by dimensions without cost controls,
6. enforce time range limits,
7. surface freshness metadata,
8. support fallback to raw table for debugging if appropriate,
9. avoid `FINAL` unless explicitly justified,
10. have golden-query tests comparing raw vs target for selected windows.

---

### 15.3 Contract Tests for Materialized Views

For serious analytics systems, create test cases that validate MV behavior.

Example test scenarios:

1. Insert one event and verify target count.
2. Insert duplicate event and verify expected duplicate/idempotent behavior.
3. Insert late event and verify old bucket changes.
4. Insert multiple blocks with same group key and verify query uses `sum` / `Merge` correctly.
5. Insert rows with null optional metric and verify count vs metric sample count.
6. Backfill a historical window and compare raw vs target.
7. Change dimension table and verify enrichment semantics.
8. Drop/recreate MV in staging and verify no target data is lost unexpectedly.

This is how you make materialized view behavior explicit instead of mystical.

---

## 16. Observability and Debugging

### 16.1 Inspect Target Growth

```sql
SELECT
    database,
    table,
    partition,
    count() AS parts,
    sum(rows) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS bytes
FROM system.parts
WHERE active
  AND database = currentDatabase()
  AND table IN ('raw_case_events', 'case_events_hourly_states')
GROUP BY database, table, partition
ORDER BY table, partition;
```

Questions:

- Is target receiving rows?
- Are there too many parts?
- Are old partitions receiving late data?
- Is target storage growing as expected?

---

### 16.2 Check Insert Queries

```sql
SELECT
    event_time,
    query_kind,
    query_duration_ms,
    read_rows,
    written_rows,
    written_bytes,
    exception_code,
    exception
FROM system.query_log
WHERE event_time >= now() - INTERVAL 1 HOUR
  AND query_kind = 'Insert'
ORDER BY event_time DESC
LIMIT 50;
```

Questions:

- Did inserts fail?
- Did insert duration increase after MV creation?
- Are written rows much larger than source rows due to target writes?

---

### 16.3 Reconcile Raw vs Target

For additive count target:

```sql
SELECT
    toStartOfHour(event_time) AS hour,
    count() AS raw_count
FROM raw_case_events
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY hour
ORDER BY hour;
```

```sql
SELECT
    hour,
    sum(events_count) AS target_count
FROM case_events_hourly
WHERE hour >= now() - INTERVAL 1 DAY
GROUP BY hour
ORDER BY hour;
```

For aggregate states, compare finalized results:

```sql
SELECT
    hour,
    uniq(case_id) AS raw_unique_cases
FROM raw_case_events
WHERE event_time >= now() - INTERVAL 1 DAY
GROUP BY hour
ORDER BY hour;
```

```sql
SELECT
    hour,
    uniqMerge(unique_cases) AS target_unique_cases
FROM case_events_hourly_states
WHERE hour >= now() - INTERVAL 1 DAY
GROUP BY hour
ORDER BY hour;
```

Do not rely on eyeballing dashboards. Build reconciliation queries.

---

## 17. Design Framework

Before creating a materialized view, answer these questions.

### 17.1 Workload Questions

1. Which query is too slow or too expensive?
2. How often is it executed?
3. What latency target must it meet?
4. What freshness is required?
5. Which dimensions are used for filtering/grouping?
6. What is the expected result cardinality?
7. Can the result be pre-aggregated safely?

### 17.2 Metric Semantics Questions

1. Is the metric additive?
2. Is it semi-additive?
3. Is it non-additive?
4. Does it require distinct count?
5. Does it require quantiles?
6. Does it require latest value?
7. Does it need correction/reversal semantics?

### 17.3 Source Data Questions

1. Is source append-only?
2. Can source contain duplicates?
3. Can events arrive late?
4. Can source rows be updated/deleted?
5. Is event time different from ingestion time?
6. Is there a stable event id?
7. Is there a source batch id?

### 17.4 Target Table Questions

1. What is the target grain?
2. What is the target engine?
3. What is the target `ORDER BY`?
4. What is the target `PARTITION BY`?
5. Will target store final values or states?
6. How will target be queried correctly before merges finish?
7. How will target be backfilled?
8. How will target be rebuilt?

### 17.5 Operational Questions

1. How much write amplification is acceptable?
2. How will insert latency change?
3. How many MVs are attached to the source?
4. How will failures be detected?
5. How will raw vs target be reconciled?
6. How will schema changes be rolled out?
7. How will late/corrected data be handled?
8. Who owns the target table contract?

---

## 18. Common Anti-Patterns

### Anti-Pattern 1 — Using Materialized View as a Magic Cache

Bad thought:

```text
The query is slow, so create a materialized view.
```

Better thought:

```text
The query is frequent, expensive, stable in shape, and can be incrementally maintained with clear correctness semantics.
```

---

### Anti-Pattern 2 — Storing Final Average

Bad:

```sql
avg(latency_ms) AS avg_latency
```

Then later:

```sql
avg(avg_latency)
```

This is often wrong.

Better:

```sql
sum(latency_ms) AS total_latency,
count() AS requests
```

or:

```sql
avgState(latency_ms) AS avg_latency_state
```

Then query with:

```sql
avgMerge(avg_latency_state)
```

---

### Anti-Pattern 3 — Exact Distinct Everywhere

`uniqExactState` may be correct but expensive.

Ask:

- Is exact distinct legally/business required?
- Is approximate distinct acceptable?
- What error tolerance is allowed?
- What is the cardinality?
- What is the memory budget?

Exactness is a cost decision, not a virtue by default.

---

### Anti-Pattern 4 — Overusing Joins in Materialized Views

If enrichment changes frequently, joining inside MV can create stale target data.

Prefer:

- pre-enrich upstream,
- store dimension version at event time,
- join at query time for small dimensions,
- rebuild aggregates when dimensions change,
- use dictionaries only with clear semantics.

---

### Anti-Pattern 5 — Creating Too Many MVs on a Hot Source Table

Each MV increases insert work.

Five materialized views on a high-throughput raw table can become the ingestion bottleneck.

Measure insert latency and target part counts after every new view.

---

### Anti-Pattern 6 — No Rebuild Strategy

If a target table is wrong, can you rebuild it?

You need:

- raw data retention,
- deterministic transformation SQL,
- bounded backfill windows,
- validation queries,
- versioned target naming if needed,
- read-path switching mechanism.

A materialized view without rebuild strategy is operational debt.

---

## 19. Production Checklist

Before shipping a materialized view to production:

```text
[ ] Source table grain is documented.
[ ] Target table grain is documented.
[ ] Target engine is justified.
[ ] Target ORDER BY matches serving query pattern.
[ ] Target PARTITION BY matches retention/backfill needs.
[ ] Additive vs non-additive metrics are classified.
[ ] Aggregate states are used where needed.
[ ] Queries aggregate target rows defensively.
[ ] Duplicate source behavior is defined.
[ ] Late event behavior is defined.
[ ] Update/delete behavior is defined.
[ ] Backfill procedure is documented.
[ ] Cutover boundary is defined.
[ ] Raw-vs-target reconciliation queries exist.
[ ] Insert latency impact is measured.
[ ] Target part counts are monitored.
[ ] Schema evolution plan exists.
[ ] Rebuild strategy exists.
[ ] Java ingestion retry/idempotency behavior is compatible.
[ ] Java serving queries use correct Merge/finalization functions.
```

---

## 20. Exercises

### Exercise 1 — Count Rollup

Given a raw table `raw_page_views`:

```text
tenant_id, user_id, session_id, page, referrer, event_time
```

Design:

1. hourly target table,
2. materialized view,
3. query for last 7 days by page.

Decide whether to use `SummingMergeTree` or `AggregatingMergeTree`.

---

### Exercise 2 — Unique Users

Extend Exercise 1 to include unique users per page per hour.

Questions:

1. Can you use `SummingMergeTree` only?
2. What column type is needed?
3. What insert-time function is needed?
4. What query-time function is needed?

---

### Exercise 3 — Average vs Percentile

For API latency analytics, design a target table supporting:

- request count,
- error count,
- average latency,
- p95 latency,
- p99 latency.

Avoid storing final averages incorrectly.

---

### Exercise 4 — Late Events

Assume events can arrive up to 14 days late.

Design:

1. partitioning strategy,
2. TTL strategy,
3. dashboard freshness policy,
4. reconciliation query.

---

### Exercise 5 — Regulatory Report Correction

A case event was incorrectly classified as `LOW` severity and later corrected to `HIGH`.

How should the analytics model handle this?

Options:

1. mutate raw row,
2. emit correction event,
3. rebuild target partition,
4. maintain versioned snapshot table,
5. produce report restatement.

Analyze trade-offs.

---

## 21. Summary

The most important lesson:

> In ClickHouse, an incremental materialized view is an **insert-time transformation pipeline** from a source table into a real target table.

It is not merely a query shortcut.

Materialized views are used to shift cost from query time to insert time. They are excellent for:

- rollups,
- pre-aggregation,
- refined tables,
- serving tables,
- dashboard acceleration,
- expensive aggregate states,
- typed extraction from raw payloads,
- multi-stage analytics pipelines.

But they require disciplined design:

- target engine must match metric semantics,
- aggregate states must be used for non-additive metrics,
- backfill must be controlled,
- duplicates and late events must be modeled,
- joins must be treated carefully,
- queries must not assume background merges are complete,
- write amplification must be measured,
- rebuild strategy must exist.

If you master materialized views, ClickHouse stops being just a fast query engine and becomes a powerful real-time analytical dataflow system.

---

## 22. What Comes Next

Part 015 continues this topic:

```text
Part 015 — Materialized Views II: Rollups, Pre-Aggregation, and Serving Tables
```

Part 014 focused on the mechanics and correctness of materialized views.

Part 015 will focus on designing real production serving layers:

- hourly/daily/monthly rollups,
- multi-resolution aggregates,
- raw/refined/aggregate architecture,
- dashboard acceleration,
- query routing between raw and aggregate tables,
- late event correction strategy,
- rebuilds and versioned serving tables,
- practical regulatory reporting patterns.

---

## 23. References

Use these references for deeper verification and continued reading:

1. ClickHouse Documentation — Materialized Views  
   `https://clickhouse.com/docs/materialized-views`

2. ClickHouse Documentation — Incremental Materialized Views  
   `https://clickhouse.com/docs/materialized-view/incremental-materialized-view`

3. ClickHouse Documentation — Refreshable Materialized Views  
   `https://clickhouse.com/docs/materialized-view/refreshable-materialized-view`

4. ClickHouse Documentation — AggregatingMergeTree  
   `https://clickhouse.com/docs/engines/table-engines/mergetree-family/aggregatingmergetree`

5. ClickHouse Documentation — AggregateFunction Type  
   `https://clickhouse.com/docs/sql-reference/data-types/aggregatefunction`

6. ClickHouse Blog — Using Materialized Views in ClickHouse  
   `https://clickhouse.com/blog/using-materialized-views-in-clickhouse`

7. ClickHouse Documentation — MergeTree Engine  
   `https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Aggregation Deep Dive: GROUP BY, States, Approximation, and Memory</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-olap-column-oriented-database-and-clickhouse-mastery-for-java-engineers-part-015.md">Part 015 — Materialized Views II: Rollups, Pre-Aggregation, and Serving Tables ➡️</a>
</div>

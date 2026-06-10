# strict-general-standards\_\_scylladb.md

> Mandatory standards for LLM/code-agent implementation when designing, generating, reviewing, or modifying systems that use **ScyllaDB**.

---

## 1. Purpose

This document defines strict engineering standards for using **ScyllaDB** in application, platform, and data-system development.

These rules exist to prevent LLM/code agents from treating ScyllaDB like:

- a relational OLTP database,
- a generic key-value cache,
- a full-text search engine,
- a queue/broker,
- an analytics warehouse,
- or a magical horizontally scalable database where schema design does not matter.

ScyllaDB must be used only when the workload matches its strengths: **high-throughput, low-latency, distributed, wide-column access patterns with known query shapes**.

---

## 2. Canonical Technology Description

ScyllaDB is a **distributed wide-column NoSQL database** compatible with Apache Cassandra APIs and concepts.

It is optimized for:

- high write throughput,
- predictable low latency,
- horizontal scalability,
- partitioned data access,
- denormalized query-first data models,
- time-series/event/user-activity style workloads,
- large-scale operational datasets where access patterns are known in advance.

ScyllaDB is not a generic SQL database. It supports CQL, but CQL is not relational SQL.

---

## 3. Non-Negotiable Design Principle

> **In ScyllaDB, data modeling starts from queries, not entities.**

The LLM must never design ScyllaDB tables by translating normalized relational entities into CQL tables.

For every ScyllaDB table, the LLM must first identify:

1. the exact query it serves,
2. the required lookup key,
3. the required ordering inside a partition,
4. expected cardinality per partition,
5. read/write frequency,
6. retention/TTL behavior,
7. consistency requirement,
8. operational risk: hot partitions, tombstones, fan-out reads, repair cost.

If those are unknown, the LLM must not invent a ScyllaDB schema as if it were a relational schema.

---

## 4. ScyllaDB Use-Case Fit

### 4.1 Allowed Use Cases

Use ScyllaDB when the system needs one or more of the following:

- high-volume write ingestion,
- large-scale user/session/activity state,
- time-series/event records with known lookup patterns,
- IoT/sensor/telemetry operational storage,
- recommendation/user-feature serving,
- low-latency key-partition reads,
- large distributed lookup tables,
- append-heavy workloads,
- denormalized read-optimized storage,
- multi-region or replicated high-availability operational data.

### 4.2 Conditional Use Cases

Use ScyllaDB with caution for:

- counters,
- uniqueness constraints,
- idempotency store,
- distributed locks,
- workflow state,
- financial balances,
- authorization policy storage,
- audit storage,
- CDC-driven projections,
- event history.

These are allowed only when consistency, idempotency, replay, ordering, TTL, and failure semantics are explicitly designed.

### 4.3 Forbidden Default Use Cases

Do not use ScyllaDB as the default choice for:

- strongly relational transactional systems,
- complex ad-hoc querying,
- joins,
- reporting/OLAP aggregations,
- full-text search,
- graph traversal,
- global uniqueness across arbitrary fields,
- cross-partition transactions,
- arbitrary filtering,
- small systems that do not need distributed scale.

---

## 5. Mandatory Boundary Rules

### 5.1 ScyllaDB Must Not Be Treated as Relational SQL

The LLM must not generate:

```sql
SELECT * FROM table WHERE non_key_column = ?;
```

unless that access pattern is supported by an explicit index/materialized-view decision and its operational cost is justified.

### 5.2 Query-First Schema Is Mandatory

Every table must map to one primary query family.

Bad:

```sql
CREATE TABLE orders (
  order_id uuid PRIMARY KEY,
  customer_id uuid,
  status text,
  created_at timestamp
);
```

Then later trying to query by customer, status, and date.

Better:

```sql
CREATE TABLE orders_by_customer_day (
  customer_id uuid,
  order_day date,
  created_at timestamp,
  order_id uuid,
  status text,
  total_amount decimal,
  PRIMARY KEY ((customer_id, order_day), created_at, order_id)
) WITH CLUSTERING ORDER BY (created_at DESC, order_id ASC);
```

This table explicitly serves:

```sql
SELECT *
FROM orders_by_customer_day
WHERE customer_id = ?
  AND order_day = ?
LIMIT ?;
```

### 5.3 One Table May Duplicate Data Intentionally

Denormalization is normal in ScyllaDB.

If the same business fact must support multiple query patterns, the LLM may create multiple tables, but it must also define:

- write fan-out behavior,
- idempotency key,
- partial-write failure behavior,
- repair/reconciliation job,
- consistency expectation between duplicated views,
- owner of each projection table.

---

## 6. Table Design Standard

Every ScyllaDB table must have a documented table contract.

### 6.1 Required Table Contract

For each table, document:

```md
## Table: <table_name>

Purpose:

- <business/query purpose>

Served queries:

- <query 1>
- <query 2 if same partition/query family>

Primary key:

- Partition key: <columns>
- Clustering key: <columns>

Partition model:

- Expected partitions per tenant/user/device/etc:
- Expected rows per partition:
- Expected partition size:
- Hot partition risk:

Ordering:

- Clustering order:
- Pagination strategy:

Write model:

- Insert/update/delete frequency:
- Idempotency behavior:
- TTL/retention:

Consistency:

- Write CL:
- Read CL:
- LWT usage, if any:

Operational concerns:

- Compaction strategy:
- Tombstone risk:
- Repair/backup:
- Monitoring metrics:
```

The LLM must not create a ScyllaDB table without this reasoning when producing architecture/design documentation.

---

## 7. Primary Key Standard

### 7.1 Partition Key

The partition key determines data distribution and the minimum lookup scope.

A partition key must:

- match the dominant lookup pattern,
- distribute load across the cluster,
- avoid hot partitions,
- avoid unbounded partition growth,
- support equality lookup,
- include tenant/domain sharding key when multi-tenant isolation matters.

Bad:

```sql
PRIMARY KEY ((tenant_id), created_at)
```

if one tenant can produce massive traffic and all writes concentrate on a few partitions.

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, shard_id), created_at, event_id)
```

where `bucket_day` and `shard_id` are deliberately selected to bound partition size and distribute load.

### 7.2 Compound Partition Key

Use compound partition keys when a single column causes hot spots or partitions are too large.

Examples:

```sql
PRIMARY KEY ((account_id, month_bucket), event_time, event_id)
```

```sql
PRIMARY KEY ((tenant_id, user_id), updated_at, item_id)
```

```sql
PRIMARY KEY ((device_id, day_bucket), recorded_at, reading_id)
```

### 7.3 Clustering Key

The clustering key determines row order inside a partition.

Use clustering keys for:

- time ordering,
- deterministic pagination,
- range queries inside a partition,
- stable ordering among equal timestamps,
- domain-specific sort order.

Bad:

```sql
PRIMARY KEY ((customer_id), random_uuid)
```

when the query needs latest records first.

Better:

```sql
PRIMARY KEY ((customer_id), created_at, order_id)
WITH CLUSTERING ORDER BY (created_at DESC, order_id ASC);
```

### 7.4 Primary Key Must Be Query-Compatible

A query must specify the full partition key unless explicitly justified by an allowed index/materialized-view strategy.

The LLM must not generate `ALLOW FILTERING` as a solution for production queries.

---

## 8. Partition Size and Hot Partition Guardrails

### 8.1 Avoid Unbounded Partitions

A partition must not grow indefinitely.

Risky patterns:

```sql
PRIMARY KEY ((user_id), created_at)
```

for long-lived, high-volume users.

```sql
PRIMARY KEY ((tenant_id), event_time)
```

for large tenants.

```sql
PRIMARY KEY ((status), created_at)
```

for low-cardinality statuses like `PENDING`, `ACTIVE`, `FAILED`.

### 8.2 Bucket Large Time-Series Workloads

Use time buckets for time-series and append-heavy workloads.

Example:

```sql
CREATE TABLE telemetry_by_device_day (
  device_id text,
  day date,
  ts timestamp,
  reading_id timeuuid,
  temperature double,
  humidity double,
  PRIMARY KEY ((device_id, day), ts, reading_id)
) WITH CLUSTERING ORDER BY (ts DESC, reading_id DESC);
```

### 8.3 Add Shard Buckets for Hot Producers

If a single entity produces too much traffic for one partition, use a write shard.

Example:

```sql
CREATE TABLE events_by_tenant_day_shard (
  tenant_id uuid,
  day date,
  shard smallint,
  event_time timestamp,
  event_id uuid,
  event_type text,
  payload text,
  PRIMARY KEY ((tenant_id, day, shard), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

The read path must then explicitly fan out across shards and merge results.

The LLM must document this cost.

---

## 9. Query Standard

### 9.1 Allowed Query Shape

Preferred query shape:

```sql
SELECT columns
FROM table
WHERE partition_key_column_1 = ?
  AND partition_key_column_2 = ?
  AND clustering_column >= ?
  AND clustering_column < ?
LIMIT ?;
```

### 9.2 Forbidden Query Patterns

The LLM must not generate production code using:

```sql
ALLOW FILTERING
```

unless the document labels it as non-production/admin-only/debug-only and explains the bounded dataset.

The LLM must not generate:

- full table scans,
- cross-partition range scans,
- arbitrary `WHERE` on non-key columns,
- relational joins,
- unbounded reads,
- unbounded `IN` lists,
- pagination by reading all rows then slicing in memory.

### 9.3 `IN` Query Guardrail

`IN` may create fan-out queries.

Allowed only when:

- list size is strictly bounded,
- latency impact is acceptable,
- timeout behavior is defined,
- result ordering is deterministic or not required.

Bad:

```sql
SELECT * FROM sessions WHERE user_id IN ?;
```

where the list can contain thousands of users.

### 9.4 Projection Queries

Always select only required columns.

Bad:

```sql
SELECT * FROM user_activity_by_day WHERE user_id = ? AND day = ?;
```

Better:

```sql
SELECT activity_time, activity_type, summary
FROM user_activity_by_day
WHERE user_id = ? AND day = ?
LIMIT ?;
```

---

## 10. Data Modeling Patterns

### 10.1 Lookup by ID

```sql
CREATE TABLE user_profile_by_id (
  user_id uuid PRIMARY KEY,
  display_name text,
  email text,
  status text,
  updated_at timestamp
);
```

Allowed for single-key lookups.

### 10.2 Lookup by Parent and Time

```sql
CREATE TABLE tickets_by_customer_month (
  customer_id uuid,
  month text,
  created_at timestamp,
  ticket_id uuid,
  status text,
  subject text,
  PRIMARY KEY ((customer_id, month), created_at, ticket_id)
) WITH CLUSTERING ORDER BY (created_at DESC, ticket_id ASC);
```

### 10.3 Lookup by State Queue

Use caution with low-cardinality states.

Bad:

```sql
PRIMARY KEY ((status), created_at)
```

Better:

```sql
PRIMARY KEY ((status, bucket_day, shard), created_at, task_id)
```

### 10.4 Idempotency Store

```sql
CREATE TABLE idempotency_by_key (
  scope text,
  idempotency_key text,
  request_hash text,
  response_payload text,
  status text,
  created_at timestamp,
  expires_at timestamp,
  PRIMARY KEY ((scope, idempotency_key))
) WITH default_time_to_live = 86400;
```

Rules:

- use LWT only when duplicate suppression requires atomic insert-if-not-exists,
- keep TTL explicit,
- store request hash to detect key reuse with different payload,
- do not store large response payload unless justified.

### 10.5 Time-Series Table

```sql
CREATE TABLE readings_by_device_day (
  device_id text,
  day date,
  recorded_at timestamp,
  reading_id timeuuid,
  value double,
  unit text,
  PRIMARY KEY ((device_id, day), recorded_at, reading_id)
) WITH CLUSTERING ORDER BY (recorded_at DESC, reading_id DESC);
```

Rules:

- bucket by time,
- include deterministic tie-breaker,
- bound partition size,
- define TTL/retention,
- avoid deletes when TTL can model lifecycle.

### 10.6 Multi-Tenant Table

For multi-tenant systems, include tenant context in the partitioning/access model unless there is a deliberate global table.

```sql
CREATE TABLE cases_by_tenant_actor_day (
  tenant_id uuid,
  actor_id uuid,
  day date,
  action_time timestamp,
  case_id uuid,
  action text,
  PRIMARY KEY ((tenant_id, actor_id, day), action_time, case_id)
);
```

---

## 11. Denormalization and Duplication Standard

### 11.1 Duplication Is Allowed but Must Be Owned

When the same entity is written to multiple query tables, the LLM must define the write strategy:

```md
Write path:

1. Validate command.
2. Generate deterministic event/operation ID.
3. Write canonical row.
4. Write projection row(s) idempotently.
5. Emit reconciliation event or outbox record if required.
```

### 11.2 Partial Failure Must Be Designed

If multiple tables are written, the LLM must state what happens when:

- canonical write succeeds but projection write fails,
- projection write succeeds but canonical write fails,
- retry writes the same projection again,
- a later correction must update all copies,
- delete/TTL behavior differs between tables.

### 11.3 Avoid Accidental Source-of-Truth Ambiguity

There must be one authoritative owner for each business fact.

Projection tables are read models unless explicitly designed otherwise.

---

## 12. Consistency Standard

### 12.1 Consistency Level Must Be Explicit

The LLM must not rely on driver defaults for critical behavior.

For each use case, define:

- write consistency level,
- read consistency level,
- serial consistency level if LWT is used,
- multi-DC behavior,
- stale read tolerance,
- read-after-write expectation.

### 12.2 Common Consistency Guidance

Typical starting points:

- `LOCAL_QUORUM` for production reads/writes in a local DC when stronger local consistency is needed,
- `LOCAL_ONE` only for explicitly latency-biased/stale-tolerant reads,
- `QUORUM` only when global/multi-DC behavior is understood,
- `SERIAL`/`LOCAL_SERIAL` only for LWT serial phase.

The selected level must match business correctness.

### 12.3 Read-After-Write Must Be Explicit

If an API writes then immediately reads, the LLM must design for read-after-write:

- same partition,
- compatible consistency levels,
- retry behavior,
- idempotent command response,
- avoid unnecessary read-after-write when command response can be constructed from write result.

---

## 13. Lightweight Transactions Standard

### 13.1 LWT Is Not a General Transaction Mechanism

LWT is allowed for:

- insert-if-not-exists,
- compare-and-set on a single partition/row condition,
- idempotency key claim,
- uniqueness guard under bounded scale,
- state transition guard when scope is a single partition.

LWT is not allowed as a substitute for:

- multi-row relational transactions,
- cross-partition workflows,
- distributed locks across arbitrary resources,
- high-throughput counters,
- global uniqueness over hot low-cardinality values.

### 13.2 Required LWT Justification

Every LWT use must document:

```md
LWT justification:

- Business invariant:
- Partition involved:
- Condition:
- Expected contention:
- Fallback if condition fails:
- Latency impact accepted:
```

### 13.3 Example: Idempotency Claim

```sql
INSERT INTO idempotency_by_key (
  scope,
  idempotency_key,
  request_hash,
  status,
  created_at
)
VALUES (?, ?, ?, 'PROCESSING', ?)
IF NOT EXISTS;
```

The application must handle both outcomes:

- applied = true: process request,
- applied = false: inspect existing row and return/retry according to status.

---

## 14. TTL and Tombstone Standard

### 14.1 TTL Must Be a Design Decision

TTL is allowed for:

- cache-like operational data,
- ephemeral sessions,
- idempotency keys,
- deduplication windows,
- time-series retention,
- short-lived workflow markers.

TTL must not be applied casually to correctness-critical state.

### 14.2 Tombstone Risk Must Be Considered

The LLM must consider tombstones when generating:

- frequent deletes,
- TTL-heavy tables,
- wide partitions,
- range queries over expired data,
- repeated updates to collection columns,
- low-cardinality partition keys.

### 14.3 Prefer Time-Bucketed Retention

For high-volume time-series, prefer table/partition design that bounds retention impact.

Example:

```sql
CREATE TABLE events_by_tenant_day (
  tenant_id uuid,
  day date,
  event_time timestamp,
  event_id uuid,
  payload text,
  PRIMARY KEY ((tenant_id, day), event_time, event_id)
) WITH default_time_to_live = 2592000;
```

### 14.4 Delete Guardrail

The LLM must not generate mass delete operations across large partitions unless it defines:

- expected tombstone volume,
- compaction behavior,
- read impact,
- repair/backup implication,
- safer alternative.

---

## 15. Compaction Strategy Standard

The LLM must not ignore compaction strategy for high-volume tables.

### 15.1 General Guidance

- Use default/table-appropriate compaction unless workload justifies change.
- Use time-window-oriented compaction for time-series/TTL-heavy data where appropriate.
- Avoid mixing drastically different TTL patterns in one table.
- Avoid very large unbounded partitions that make compaction expensive.

### 15.2 Required Compaction Reasoning

For each heavy table:

```md
Compaction reasoning:

- Workload: append/update/delete/TTL-heavy
- Data age access pattern:
- Partition growth:
- Tombstone risk:
- Selected strategy:
- Why not default:
```

---

## 16. Secondary Index and Materialized View Standard

### 16.1 Secondary Indexes Are Not Default

The LLM must not use secondary indexes to rescue poor schema design.

Secondary indexes are allowed only when:

- cardinality is appropriate,
- query frequency is understood,
- latency impact is acceptable,
- operational ownership is clear,
- base-table update impact is acceptable.

### 16.2 Materialized Views Are Not Free

Materialized views are effectively maintained alternative query tables.

Use only when:

- update overhead is acceptable,
- eventual consistency is acceptable,
- failure/rebuild behavior is understood,
- view schema matches a real query pattern.

### 16.3 Prefer Explicit Denormalized Tables for Critical Access

For critical production read paths, prefer explicit table-per-query modeling controlled by the application/event pipeline rather than implicit indexes/views, unless there is a strong reason.

---

## 17. Collections, UDT, and Large Value Guardrails

### 17.1 Collections Must Stay Small

Do not use collections for unbounded child lists.

Bad:

```sql
tags set<text>
comments list<text>
```

when tags/comments can grow unbounded.

Better:

```sql
CREATE TABLE comments_by_post (
  post_id uuid,
  created_at timestamp,
  comment_id uuid,
  author_id uuid,
  body text,
  PRIMARY KEY ((post_id), created_at, comment_id)
);
```

### 17.2 Large Payloads Must Be Justified

Do not store large blobs/documents by default.

If object payload is large, consider object storage and keep only metadata/reference in ScyllaDB.

### 17.3 UDT Must Not Hide Queryable Fields

User-defined types are allowed only for small, bounded, non-queryable embedded structures.

---

## 18. Counter Standard

Counters require special care.

The LLM must not use counters for correctness-critical balances, financial amounts, or inventory where exact transactional invariants are required.

Allowed use cases:

- approximate operational counters,
- metrics-like aggregates,
- engagement counters with reconciliation,
- idempotency-aware event count if duplicate handling is explicit.

Required design:

```md
Counter design:

- Counter purpose:
- Duplicate event behavior:
- Reconciliation source:
- Reset/rebuild strategy:
- Consistency level:
```

---

## 19. CDC Standard

ScyllaDB CDC may be used for:

- audit pipelines,
- projection updates,
- downstream analytics,
- cache invalidation,
- event-driven integration when raw row-change semantics are acceptable.

CDC must not be confused with domain events.

Raw CDC event:

- says a row changed,
- reflects storage schema,
- may expose internal fields,
- may not represent business intent.

Domain event:

- says business fact happened,
- uses domain vocabulary,
- is owned by domain/service contract,
- is safe for external consumers.

If CDC is used to produce integration events, the LLM must define transformation, filtering, redaction, schema ownership, and replay behavior.

---

## 20. Driver and Application Access Standard

### 20.1 Use Prepared Statements

Application code must use prepared statements for repeated queries.

Bad:

```java
session.execute("SELECT * FROM users WHERE user_id = " + userId);
```

Better:

```java
PreparedStatement stmt = session.prepare(
    "SELECT display_name, status FROM user_profile_by_id WHERE user_id = ?"
);
BoundStatement bound = stmt.bind(userId);
session.execute(bound);
```

### 20.2 Do Not Create Sessions per Request

The LLM must not create a new ScyllaDB driver session per HTTP request/message.

Use application-scoped session/cluster client lifecycle.

### 20.3 Configure Timeouts Explicitly

Define:

- connection timeout,
- request timeout,
- retry policy,
- speculative execution policy,
- load balancing policy,
- consistency level,
- metrics.

### 20.4 Retry Must Be Idempotency-Aware

Retries are allowed only when the operation is idempotent or duplicate effects are safe.

For non-idempotent writes, the LLM must define an idempotency key or avoid automatic retry.

---

## 21. Write Path Standard

### 21.1 Writes Must Be Idempotent Where Possible

Use deterministic keys to make writes repeatable.

Example:

```sql
INSERT INTO events_by_user_day (
  user_id,
  day,
  event_time,
  event_id,
  event_type
) VALUES (?, ?, ?, ?, ?);
```

where `event_id` is stable across retries.

### 21.2 Avoid Read-Before-Write When Not Required

Do not read existing data before every write unless correctness requires it.

Prefer direct idempotent upsert when acceptable.

### 21.3 State Transitions Must Be Guarded

For state machines, use LWT only when the transition is single-row/single-partition and contention is acceptable.

Example:

```sql
UPDATE workflow_by_id
SET state = ?, updated_at = ?
WHERE workflow_id = ?
IF state = ?;
```

The application must handle failed condition as a domain conflict, not as a generic database error.

---

## 22. Read Path Standard

### 22.1 Reads Must Be Bounded

Every list query must have:

- partition key,
- limit,
- pagination/cursor strategy,
- ordering guarantee,
- maximum page size.

### 22.2 Pagination

Use driver paging or clustering-key cursor patterns.

Cursor must encode enough information to resume deterministically:

```json
{
  "partition": {
    "customer_id": "...",
    "month": "2026-06"
  },
  "last_created_at": "2026-06-10T10:30:00Z",
  "last_ticket_id": "..."
}
```

### 22.3 Avoid Client-Side Filtering

The LLM must not read a large partition then filter in application memory unless the data size is strictly bounded and documented.

---

## 23. Multi-Data-Center and Replication Standard

### 23.1 Replication Strategy Must Be Explicit

Production keyspaces must define replication intentionally.

Example:

```sql
CREATE KEYSPACE app_ks
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'dc1': 3,
  'dc2': 3
};
```

The LLM must not use single-node/simple replication for production multi-node systems.

### 23.2 Multi-DC Read/Write Semantics

For multi-DC deployments, document:

- local vs global consistency,
- write routing,
- failover behavior,
- read staleness expectation,
- conflict behavior,
- repair strategy.

---

## 24. Security Standard

### 24.1 Authentication and Authorization

ScyllaDB access must use authenticated users/roles.

The LLM must not generate application code using admin/superuser credentials.

Rules:

- one app role per service/application boundary,
- least privilege per keyspace/table,
- separate migration/admin role from runtime role,
- rotate credentials through secret manager,
- do not log credentials or connection strings.

### 24.2 Network Security

ScyllaDB must not be exposed publicly by default.

Require:

- private network path,
- security group/firewall restriction,
- TLS where required,
- separate admin/monitoring access,
- controlled maintenance access.

### 24.3 Data Classification

Before storing sensitive data, define:

- PII classification,
- encryption requirement,
- masking/logging rules,
- retention/TTL,
- deletion obligations,
- backup exposure.

---

## 25. Observability Standard

Every ScyllaDB-backed application must emit telemetry for:

- query latency by operation/table,
- timeout count,
- retry count,
- unavailable/overloaded errors,
- consistency failures,
- LWT contention/failure rate,
- read/write throughput,
- page size and result count,
- tombstone warnings where exposed,
- hot partition signals,
- connection pool state.

Cluster-level monitoring must cover:

- node up/down,
- disk usage,
- compaction backlog,
- read/write latency,
- cache hit rates,
- dropped messages/errors,
- repair status,
- tombstone pressure,
- large partition warnings,
- coordinator/node imbalance.

---

## 26. Migration and Schema Change Standard

### 26.1 Schema Changes Must Be Backward-Compatible

ScyllaDB schema changes must be compatible with rolling deployments.

Preferred sequence:

1. add nullable/new column,
2. deploy writers that populate new column,
3. backfill if needed,
4. deploy readers that use new column,
5. stop writing old column,
6. remove old column only after retention/rebuild window.

### 26.2 Avoid Risky Online Changes Without Plan

The LLM must not casually generate schema changes affecting:

- primary key,
- partition key,
- clustering key,
- compaction strategy,
- TTL strategy,
- high-volume materialized views/indexes.

Most primary-key changes require a new table and migration/rebuild.

### 26.3 New Query Usually Means New Table

If the application needs a new query pattern, the default answer is often a new table/projection, not a new ad-hoc query.

---

## 27. Backup, Repair, and Recovery Standard

The LLM must define operational recovery when ScyllaDB stores production data.

Required:

- backup method,
- restore test plan,
- RPO/RTO,
- repair strategy,
- node replacement strategy,
- disaster recovery scenario,
- schema backup,
- credential recovery,
- CDC/replay recovery if used.

Do not claim high availability without defining repair and restore behavior.

---

## 28. Testing Standard

### 28.1 Schema Tests

Test that each query uses the intended partition/clustering key.

### 28.2 Repository Tests

Repository tests must verify:

- insert/upsert behavior,
- duplicate write behavior,
- pagination correctness,
- TTL expiry assumptions where feasible,
- conditional write success/failure,
- consistency-related conflict handling,
- serialization/deserialization.

### 28.3 Load Tests

For production-grade ScyllaDB features, test:

- realistic partition cardinality,
- realistic hot-key distribution,
- read/write ratio,
- page size,
- retries/timeouts,
- tombstone behavior,
- compaction pressure,
- node failure behavior if applicable.

---

## 29. Anti-Patterns

The LLM must reject or flag these patterns.

### 29.1 Relational Modeling Anti-Pattern

Creating one table per entity and expecting arbitrary joins/filtering.

### 29.2 `ALLOW FILTERING` Anti-Pattern

Using `ALLOW FILTERING` to make a query work in production.

### 29.3 Hot Partition Anti-Pattern

Partitioning by low-cardinality or high-concentration keys:

- `status`,
- `country`,
- `tenant_id` alone for giant tenants,
- `day` alone for all users,
- `type` alone.

### 29.4 Unbounded Partition Anti-Pattern

Storing all lifetime records of an active entity in one partition.

### 29.5 Index Rescue Anti-Pattern

Adding secondary indexes after schema design fails.

### 29.6 LWT Everywhere Anti-Pattern

Using LWT as a general transaction system.

### 29.7 Large Collection Anti-Pattern

Using collection columns as child tables.

### 29.8 Delete-Heavy Anti-Pattern

Frequent mass deletes causing tombstone pressure.

### 29.9 Unbounded Read Anti-Pattern

Running list APIs without `LIMIT` and pagination.

### 29.10 Cross-Table Consistency Fantasy

Writing multiple denormalized tables and assuming atomic consistency without outbox/retry/reconciliation.

### 29.11 ScyllaDB as Queue Anti-Pattern

Using ScyllaDB as a general-purpose message broker with polling, locks, and deletes.

### 29.12 ScyllaDB as Search Engine Anti-Pattern

Using ScyllaDB for arbitrary text search or analytics instead of Elasticsearch/OpenSearch/ClickHouse/etc.

---

## 30. LLM Decision Algorithm

Before generating ScyllaDB code/schema, the LLM must run this decision process:

```md
1. Is ScyllaDB the right storage engine?
   - If relational joins/transactions/ad-hoc analytics are needed, reject or propose alternative.

2. What exact query pattern is required?
   - Identify partition key equality fields.
   - Identify clustering range/order fields.

3. Can partition size remain bounded?
   - If no, add time bucket or shard bucket.

4. Is the access pattern hot?
   - If yes, redesign partition key or add write sharding.

5. Is consistency requirement explicit?
   - Pick read/write CL and LWT only if justified.

6. Are deletes/TTL likely to create tombstones?
   - Define TTL/compaction/retention strategy.

7. Does the data need alternate query patterns?
   - Use explicit denormalized table/projection and define consistency.

8. Can the app retry safely?
   - Define idempotency and deterministic keys.

9. Is observability sufficient?
   - Add metrics/logs/traces around query operation names.

10. Is operational recovery defined?

- Backup, repair, restore, migration, schema evolution.
```

---

## 31. Required Code Review Checklist

A ScyllaDB implementation is not acceptable unless the reviewer can answer “yes” to all applicable items:

- [ ] Is ScyllaDB justified for this workload?
- [ ] Is every table query-first, not entity-first?
- [ ] Is each partition key documented?
- [ ] Is expected partition size bounded?
- [ ] Are hot partition risks addressed?
- [ ] Are clustering keys aligned with ordering/range queries?
- [ ] Are all list queries bounded with `LIMIT`/pagination?
- [ ] Is `ALLOW FILTERING` absent from production code?
- [ ] Are secondary indexes/materialized views justified?
- [ ] Are TTL and tombstone risks considered?
- [ ] Is compaction strategy considered for high-volume tables?
- [ ] Are consistency levels explicit?
- [ ] Is LWT usage justified and scoped?
- [ ] Are write retries idempotent?
- [ ] Are multi-table writes reconciled?
- [ ] Are prepared statements used?
- [ ] Is session/client lifecycle application-scoped?
- [ ] Are timeout/retry policies explicit?
- [ ] Are credentials least-privilege?
- [ ] Is telemetry implemented?
- [ ] Is backup/repair/restore covered for production?

---

## 32. Acceptance Criteria

A ScyllaDB design or implementation may be accepted only if:

1. ScyllaDB is justified by workload shape.
2. Tables are designed from query patterns.
3. Partition keys distribute load and bound partition size.
4. Clustering keys support deterministic ordering/ranges.
5. Queries avoid arbitrary filtering and full scans.
6. Consistency levels are deliberate.
7. LWT is limited and justified.
8. TTL/delete/tombstone behavior is understood.
9. Secondary indexes/materialized views are not used as a shortcut.
10. Application code uses prepared statements and bounded reads.
11. Retry behavior is idempotency-safe.
12. Multi-table denormalization has reconciliation strategy.
13. Security, telemetry, backup, repair, and migration are addressed.

---

## 33. Enforcement Snippet for LLM/Code Agent

Use this snippet in agent instructions:

```md
When implementing ScyllaDB:

- Do not model tables from entities; model from queries.
- Do not generate production `ALLOW FILTERING`.
- Do not create unbounded or hot partitions.
- Do not use secondary indexes/materialized views to hide poor table design.
- Do not use LWT as a general transaction mechanism.
- Do not use ScyllaDB as a relational database, queue, search engine, or OLAP warehouse.
- Every table must document partition key, clustering key, served query, partition size, consistency, TTL, compaction, and operational risks.
- Every read must be bounded and partition-key compatible.
- Every write retry must be idempotency-safe.
- Every production design must include observability, backup, repair, security, and migration behavior.
```

---

## 34. References

- ScyllaDB Docs — User Guide / distributed wide-column database overview.
- ScyllaDB Docs — Data Modeling Best Practices.
- ScyllaDB Docs — Data Definition / partition and clustering key behavior.
- ScyllaDB Docs — Consistency.
- ScyllaDB Docs — Lightweight Transactions.
- ScyllaDB Docs — TTL and Compaction.
- ScyllaDB Docs — Secondary Indexes and Materialized Views.
- ScyllaDB Docs — Cassandra Compatibility.

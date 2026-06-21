# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-017.md

# Part 017 — Secondary Indexes, Local Secondary Indexes, dan Materialized Views

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `017`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: memahami alternate access path di ScyllaDB: global secondary indexes, local secondary indexes, materialized views, application-maintained indexes, cost model, write amplification, read path, consistency, backup/restore, dan kapan harus memilih explicit duplicate table dibanding index/MV.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membangun pondasi:

```text
Part 012: multi-access-pattern design
Part 013: consistency levels
Part 014: LWT/CAS
Part 015: tombstones/TTL/delete
Part 016: compaction strategies
```

Sekarang kita membahas fitur yang terlihat seperti jawaban cepat untuk banyak query:

```text
secondary index
local secondary index
materialized view
```

Engineer dari SQL sering berpikir:

```text
Butuh query by status?
CREATE INDEX status_idx ON cases(status);
Selesai.
```

Di ScyllaDB, cara berpikir itu berbahaya.

Index/MV memang menyediakan alternate access path, tetapi:

- bukan SQL B-tree index biasa,
- punya storage sendiri,
- punya write amplification,
- punya read path tambahan,
- bisa menjadi hot partition,
- bisa menciptakan tombstone/compaction cost,
- punya restore/backfill/build lifecycle,
- punya batasan schema dan topology,
- tidak menggantikan query-first data modeling.

Kalimat utama:

```text
Indexes and materialized views are physical data structures, not magic query optimizer features.
```

---

## 1. Masalah yang Ingin Diselesaikan

Base table:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    assignee_id uuid,
    due_at timestamp,
    title text,
    version bigint,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Query yang mudah:

```sql
SELECT *
FROM case_current_by_id
WHERE tenant_id = ?
  AND case_id = ?;
```

Query yang tidak mudah:

```sql
SELECT *
FROM case_current_by_id
WHERE tenant_id = ?
  AND status = 'OPEN';
```

Karena `status` bukan partition key.

Pilihan:

1. explicit derived table:

```text
open_cases_by_tenant_status_day_bucket
```

2. secondary index,
3. local secondary index,
4. materialized view,
5. external search/OLAP,
6. change API/query requirement.

Part ini membahas kapan masing-masing masuk akal.

---

## 2. ScyllaDB Index/MV Landscape

ScyllaDB documentation describes features for non-partition-key access:

```text
Global Secondary Indexes
Local Secondary Indexes
Materialized Views
```

Important current fact:

```text
ScyllaDB secondary indexes are built on top of materialized views.
```

Docs state that with global indexing, a materialized view is created for each index; the indexed column becomes the partition key and the base table primary key becomes clustering keys.

So when you create an index, you are often implicitly creating a derived storage structure.

---

## 3. Materialized View Mental Model

A materialized view is effectively another table maintained from a base table.

ScyllaDB docs describe a materialized view as a set of rows corresponding to rows present in the underlying base table. A materialized view cannot be updated directly; updates must happen to the base table.

Base table:

```sql
case_current_by_id
PRIMARY KEY ((tenant_id, case_id))
```

View could be:

```sql
CREATE MATERIALIZED VIEW cases_by_assignee AS
    SELECT tenant_id, assignee_id, case_id, due_at, title, status
    FROM case_current_by_id
    WHERE tenant_id IS NOT NULL
      AND assignee_id IS NOT NULL
      AND case_id IS NOT NULL
    PRIMARY KEY ((tenant_id, assignee_id), due_at, case_id);
```

Conceptually:

```text
base row write
  -> view row update
```

This is server-maintained denormalization.

---

## 4. Secondary Index Mental Model

Secondary index lets you query by a non-primary-key column.

Example:

```sql
CREATE INDEX case_status_idx
ON case_current_by_id (status);
```

Query:

```sql
SELECT *
FROM case_current_by_id
WHERE status = 'OPEN';
```

But in ScyllaDB, global secondary index is implemented using underlying materialized view structure.

Docs say:

```text
with global indexing, a materialized view is created for each index
indexed column is partition key
base table primary key columns are clustering keys
```

Therefore index query is not “free metadata lookup”. It is another distributed table query plus base table lookup path.

---

## 5. Global Secondary Index

Global secondary index means index entries are distributed by indexed column value.

Example base table:

```sql
PRIMARY KEY ((tenant_id, case_id))
```

Index on:

```text
status
```

Index table/view partition key roughly:

```text
status
```

This creates risk:

```text
status = OPEN
```

becomes low-cardinality hot/large partition.

### 5.1 Global Index Read Path

Simplified:

```text
1. query index structure by indexed value
2. get base table primary keys
3. fetch base rows
4. return result
```

So read can involve:

- index read,
- base table reads,
- network fanout,
- consistency implications,
- extra latency.

### 5.2 Global Index Write Path

Base write causes:

- base table write,
- index/view update,
- compaction for index storage,
- tombstone/update if indexed value changes.

This is write amplification.

---

## 6. Local Secondary Index

Local secondary index is different.

ScyllaDB docs describe local secondary indexes as using an indexing subquery to fetch matching base keys from the underlying materialized view, then the coordinator uses resulting base key set to request base table rows located in the same node as the index.

Important distinction:

```text
Global index:
  index partitioning can differ from base table.

Local index:
  index is colocated/local with base table partition/node path.
```

### 6.1 When Local Index Helps

Local secondary index is useful when query includes base partition key and filters within that partition by another column.

Example:

```text
Find events inside one case partition by event_type.
```

If partition is bounded:

```sql
WHERE case_id = ?
  AND event_type = ?
```

Local index may help avoid scanning entire partition.

### 6.2 When Local Index Does Not Help

If query does not include base partition key:

```sql
WHERE event_type = 'APPROVED'
```

Local index does not magically create global lookup.

You still need global access path.

---

## 7. Index vs Explicit Table

Explicit table:

```sql
CREATE TABLE open_cases_by_assignee_day_bucket (
    tenant_id uuid,
    assignee_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    title text,
    priority int,
    source_version bigint,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
);
```

Benefits:

- full control over partition key,
- bucket strategy,
- clustering order,
- payload shape,
- source_version,
- projection metadata,
- stale validation,
- reconciliation,
- custom consistency,
- explicit Java repository.

Index/MV benefits:

- less application code,
- automatic maintenance from base table,
- simpler for some lookups,
- useful for low/medium scale bounded queries.

Trade-off:

```text
explicit table = more application responsibility
index/MV = more database-managed responsibility with less control
```

---

## 8. SQL Index vs ScyllaDB Index

SQL B-tree index often supports:

- range scans,
- optimizer plans,
- joins,
- covering indexes,
- composite indexes,
- transactionally consistent updates,
- arbitrary predicate planning.

ScyllaDB index is different:

- distributed index structure,
- no general SQL optimizer,
- still must avoid low-cardinality hot index partitions,
- still must bound result size,
- still has base table lookup cost,
- still has compaction/tombstone cost,
- still needs query-first thinking.

Do not bring SQL index intuition blindly.

---

## 9. Low Cardinality Index Problem

Bad:

```sql
CREATE INDEX ON case_current_by_id (status);
```

If values:

```text
OPEN
CLOSED
PENDING
REJECTED
```

Then:

```text
status='OPEN'
```

can map to huge/hot index partition.

Query:

```sql
WHERE status='OPEN'
```

may return millions rows.

Index cannot make low-cardinality huge-result query cheap.

Better:

```text
explicit table with tenant/day/bucket
```

```sql
PRIMARY KEY ((tenant_id, status, bucket_day, bucket_id), updated_at, case_id)
```

or use search/OLAP/aggregate depending requirement.

---

## 10. High Cardinality Index Problem

High-cardinality index may be useful if query is selective.

Example:

```text
external_reference
email
tracking_id
```

But ask:

```text
Is it unique?
Is it lookup by exact value?
Does it need tenant scope?
Would explicit mapping table be better?
```

Example explicit mapping:

```sql
CREATE TABLE case_id_by_external_ref (
    tenant_id uuid,
    external_ref text,
    case_id uuid,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, external_ref))
);
```

This is often clearer than index on `external_ref`.

Benefits:

- tenant-scoped partition,
- exact payload,
- uniqueness can use LWT,
- known authority,
- easier idempotency.

---

## 11. Medium Cardinality Index

Index may fit if:

- predicate is selective enough,
- result set bounded,
- query low/medium QPS,
- indexed value not hot,
- table not write-heavy,
- staleness/maintenance behavior acceptable,
- no complex custom bucketing needed.

Example:

```text
lookup by rare error_code in bounded admin table
```

But production API with high QPS still should usually prefer explicit table.

---

## 12. Covering Query Problem

If index returns base keys and then fetches base rows, cost includes base reads.

If query needs only indexed column and primary key, maybe index structure suffices in some cases, but do not assume SQL-style covering index behavior.

Explicit table lets you store exactly display fields.

Example:

```text
open_cases_by_assignee_day_bucket
```

can contain:

```text
case_id, due_at, priority, title
```

so list page does not fetch base row for every candidate.

---

## 13. Materialized View as Server-Maintained Derived Table

MV is closer to explicit derived table than SQL index.

Base table:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    assignee_id uuid,
    due_at timestamp,
    title text,
    status text,
    PRIMARY KEY ((tenant_id, case_id))
);
```

MV:

```sql
CREATE MATERIALIZED VIEW cases_by_assignee AS
    SELECT tenant_id, case_id, assignee_id, due_at, title, status
    FROM case_current_by_id
    WHERE tenant_id IS NOT NULL
      AND assignee_id IS NOT NULL
      AND case_id IS NOT NULL
      AND due_at IS NOT NULL
    PRIMARY KEY ((tenant_id, assignee_id), due_at, case_id);
```

This gives alternate primary key.

But compared to explicit table:

- less control over projection workflow,
- no custom source_version field unless in base,
- no custom stale-row validation semantics,
- update behavior tied to base table update,
- backfill/build lifecycle managed by DB,
- operational constraints.

---

## 14. Materialized View Requirements

MV requires primary key columns in view to be non-null and selected.

CQL MV definitions require `WHERE column IS NOT NULL` for primary key components.

The view primary key must include base table primary key columns to maintain row identity.

Design constraints mean not every desired query can become MV cleanly.

---

## 15. MV Write Amplification

Updating base table can update MV.

If view key column changes:

```text
old view row deleted
new view row inserted
```

Example:

```text
case assignee changes A -> B
```

View by assignee:

```text
delete row under A
insert row under B
```

This creates tombstones in view.

If assignee changes often, MV becomes tombstone-heavy.

Same issue as manual derived table, but managed internally.

---

## 16. MV and Compaction

Materialized view has storage and compaction lifecycle.

Docs state default compaction strategy is used unless explicitly set and the compaction strategy for a view can be changed.

Implication:

```text
base table compaction strategy does not remove need to consider view workload
```

If view is time-series/TTL-like or update-heavy, compaction matters.

---

## 17. MV and Backup/Restore

ScyllaDB restore docs recommend not restoring MV and secondary index SSTables directly; instead, drop MV/SI, restore base table, and recreate/rebuild MV/SI to ensure correct data state.

This shows MV/SI are derivative storage structures.

Application design implication:

```text
base table is authority
MV/SI can be rebuilt
restore plan must account for rebuild time and capacity
```

---

## 18. MV and Tablets/Topology

ScyllaDB tablets docs warn that if a tablets-enabled keyspace contains a materialized view or secondary index, it must remain RF-rack-valid throughout its lifetime; failing this invariant may cause data inconsistencies, performance problems, or other issues.

Takeaway:

```text
MV/SI can impose topology constraints.
```

This is not something application teams should ignore.

Index/MV usage affects operations.

---

## 19. Local Index vs Materialized View with Same Partition Key

ScyllaDB glossary notes colocated tables include local indexes and materialized views that have the same partition key as their base table.

This matters because colocated structures can avoid some cross-node behavior.

If query is within same base partition:

```text
local index or same-partition MV may be suitable
```

If query is global by non-partition key:

```text
global index/MV has different distribution and cost
```

---

## 20. Query Examples

### 20.1 Bad Global Status Query

```sql
CREATE INDEX ON case_current_by_id (status);

SELECT *
FROM case_current_by_id
WHERE status = 'OPEN';
```

Problems:

- low-cardinality index value,
- huge result set,
- no tenant/day bound,
- index hot partition.

Better explicit table:

```sql
CREATE TABLE open_cases_by_tenant_day_bucket (
    tenant_id uuid,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id uuid,
    title text,
    PRIMARY KEY ((tenant_id, bucket_day, bucket_id), updated_at, case_id)
);
```

### 20.2 Potentially Good Exact Lookup

```text
Find case by external_ref within tenant.
```

Explicit mapping:

```sql
CREATE TABLE case_id_by_external_ref (
    tenant_id uuid,
    external_ref text,
    case_id uuid,
    PRIMARY KEY ((tenant_id, external_ref))
);
```

This often beats index because uniqueness/idempotency can be controlled.

### 20.3 Local Filter Within Partition

```text
Find event_type='APPROVED' within one case/month partition.
```

If partition bounded, local secondary index may help.

But if case/month partition is small, scanning may be cheaper than index overhead.

Measure.

---

## 21. Index Selectivity

Index is only useful if it narrows enough.

Questions:

```text
How many rows per indexed value?
How hot is indexed value?
Is query result bounded by LIMIT/range?
How often is indexed column updated?
Is indexed column low-cardinality?
Is indexed value tenant-scoped?
```

A query returning 1 row is different from query returning 10 million rows.

Index helps find candidates; it does not make returning huge result cheap.

---

## 22. Index and Tenant Scope

If index is on `status` only:

```text
all tenants' OPEN rows mix under same indexed value
```

Bad for multi-tenant systems.

Prefer access path that includes tenant:

```text
tenant_id + status + day + bucket
```

Can MV/index support compound key? Sometimes, but explicit table offers more control.

Tenant scope is also authorization boundary.

Do not let index query bypass tenant filtering.

---

## 23. Index and Sorting

Indexes do not give arbitrary SQL ORDER BY.

If UI needs:

```text
open cases by assignee ordered by due_at
```

Design clustering order:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

A secondary index on `assignee_id` alone will not necessarily give correct/order-efficient due_at pagination.

Materialized view or explicit table with clustering order fits better.

---

## 24. Index and Pagination

Index query pagination can be tricky because:

- index result set may be large,
- base row fetches add cost,
- stale/deleted candidates may exist,
- ordering may not match UI,
- page stability under updates can be weak.

Explicit table cursor based on primary key is usually clearer.

---

## 25. Index and Tombstones

Index/MV storage can have tombstones too.

If indexed column changes:

```text
old index entry deleted
new index entry inserted
```

If base row TTL expires:

```text
index/view row expires/deletes
```

If base table has high delete/update churn:

```text
index/MV churns too
```

Part 015 lessons apply to index/MV.

---

## 26. Index and Write Amplification

For each base write:

```text
base table mutation
+ index/MV mutation(s)
+ compaction later
+ repair/backup lifecycle
```

Multiple indexes multiply write cost.

ScyllaDB limits docs mention materialized views and secondary indexes per table in low tens; practical production designs should use far fewer unless strongly justified.

Question:

```text
How many alternate structures will each write update?
```

If answer is many, reconsider data model.

---

## 27. Index and Read Amplification

Index read can require:

```text
index lookup
fetch base row(s)
merge/filter
return result
```

If many candidates:

```text
read amplification high
```

Explicit denormalized table can avoid base fetch by storing display columns.

---

## 28. Index and Consistency

Base and index/view maintenance is managed by database, but application must understand read-after-write semantics, failure behavior, and view build state.

If an index/MV is still building or lagging due to operational issue, query results may surprise.

For critical invariants, do not rely on index/MV unless semantics are thoroughly tested.

Use source table/LWT/explicit workflow for correctness.

---

## 29. Index and LWT

LWT on base table plus index/MV update can be expensive.

If LWT condition applied, base mutation triggers derived storage update.

If not applied, no mutation.

But hot LWT + indexes is a performance danger.

Keep LWT tables simple where possible.

---

## 30. Index and TTL

If base table rows expire via TTL, index/MV entries must also expire/delete.

TTL-heavy indexed table creates extra tombstone/compaction workload.

For ephemeral data:

```text
prefer query-first TTL table
```

rather than many indexes on TTL-heavy base.

---

## 31. Index and Collections

Secondary indexes on collection values can exist in Cassandra-like systems, but they are advanced and can be costly.

Before indexing collections, ask:

```text
Is collection bounded?
Is value selective?
Is query high-QPS?
Would child table be better?
```

Often better:

```text
tags_by_case
cases_by_tag_bucket
```

as explicit model.

---

## 32. Index and JSON/Payload Fields

Do not store JSON blob and expect ScyllaDB secondary indexes to provide document search.

If you need:

- search by arbitrary field,
- text search,
- nested filters,
- relevance,
- many optional filters,

use search engine or document database/search projection.

ScyllaDB table can store source/current metadata and IDs.

---

## 33. MV vs Explicit Table: Decision Matrix

| Requirement | MV | Explicit Table |
|---|---|---|
| Simple alternate key from one base table | possible | possible |
| Custom bucketing | limited | excellent |
| Source version metadata | only if base has it | excellent |
| Multiple source tables | poor | excellent |
| Custom projection logic | poor | excellent |
| Reconciliation logic | DB-managed/limited | explicit |
| Operational simplicity | maybe simpler app | more app code |
| Performance predictability | depends | high if designed |
| Restore/backfill control | DB-managed rebuild | app-controlled |
| High-churn derived view | risky | risky but controllable |
| Business-specific stale semantics | limited | excellent |

---

## 34. When to Use Secondary Index

Candidate use:

- low/medium QPS,
- selective exact lookup,
- result set small,
- indexed value not low-cardinality hot,
- write rate moderate,
- operational team accepts index storage,
- not enforcing critical invariant,
- query not worth explicit table complexity.

Examples:

```text
admin lookup by rare external id
debug table query
small bounded reference table
moderate-selectivity internal tool
```

But explicit mapping table may still be better for exact lookups.

---

## 35. When to Use Local Secondary Index

Candidate use:

- query includes base partition key,
- need filter/sort within bounded partition,
- partition size is moderate,
- index column selective inside partition,
- avoiding global index hotness,
- result bounded.

Example:

```text
within one case/month partition, find event by event_type
```

But if partition small:

```text
scan partition may be simpler
```

If partition huge:

```text
maybe data model needs different table
```

---

## 36. When to Use Materialized View

Candidate use:

- alternate primary key from one base table,
- base table updates should automatically maintain view,
- query shape fits MV restrictions,
- view result bounded/selective,
- no complex custom projection,
- team accepts MV operational lifecycle,
- restore/rebuild plan exists.

Avoid MV if:

- custom bucketing needed,
- many source tables,
- high-churn primary key changes,
- strict domain workflow needs source_version/reconciliation,
- view is critical and operational semantics not well understood.

---

## 37. When to Use Explicit Derived Table

Use explicit table when:

- high-QPS production query,
- custom partition/bucket design,
- tenant authorization boundary,
- source_version needed,
- stale validation needed,
- derived table can be rebuilt,
- write fanout managed by app,
- query has business semantics,
- API cursor/fanout must be explicit.

This is the default top-tier design for important serving paths.

---

## 38. When to Use External Search/OLAP

Use external search when:

- full text,
- arbitrary filters,
- relevance ranking,
- substring/prefix/fuzzy search,
- many optional dimensions.

Use OLAP when:

- aggregations,
- scans,
- reporting,
- long time range analytics,
- group by,
- dashboards over large data.

Do not build dozens of ScyllaDB indexes to imitate search/OLAP.

---

## 39. Index Build and Backfill

Creating index/MV on existing large table requires building derived structure.

Operational considerations:

- reads/writes during build,
- resource usage,
- backfill time,
- consistency,
- monitoring build progress,
- failure/retry,
- disk/compaction impact.

For very large tables, creating index/MV casually can be dangerous.

Explicit derived table backfill can be throttled and controlled by application/SRE.

---

## 40. Dropping Index/MV

Dropping index/MV removes derived structure.

DDL docs note dropping a table removes associated secondary indexes; restore docs recommend dropping/recreating MV/SI around restore in some workflows.

Plan:

- stop reads,
- remove app dependency,
- drop index/view,
- monitor cleanup,
- update schema docs.

Do not drop if application still queries it.

---

## 41. Backup/Restore Strategy

Because MV/SI are derived, restore strategy often focuses on base table and rebuilds derived structures.

ScyllaDB restore docs recommend not restoring MV/SI SSTables directly and instead restoring base tables then recreating MV/SI.

Implications:

```text
RTO includes rebuild time
capacity needed for rebuild
queries depending on view/index may be unavailable/stale during rebuild
```

Document this.

---

## 42. Schema Limits

ScyllaDB limits docs list materialized views and secondary indexes per table as “low tens”.

This is a limit signal, not a recommendation to create tens of indexes.

Operationally, keep index/MV count low.

Each one is storage and maintenance.

---

## 43. Testing Index/MV

Test:

```text
1. base insert appears in index/view
2. base update changing indexed/view key removes old entry
3. base delete removes index/view entry
4. TTL expiry removes index/view entry
5. query result size under realistic data
6. low-cardinality value behavior
7. build/rebuild time
8. restore process
9. compaction/tombstone behavior
10. multi-DC/topology behavior
```

Use realistic skew, not uniform data.

---

## 44. Observability

Monitor:

```text
index/MV read latency
base table write latency after adding index/MV
view/index storage size
compaction backlog for index/MV
tombstone warnings
index/MV build status
query result counts
hot indexed values
timeouts/unavailable errors
restore/rebuild duration
```

Application metrics:

```text
index query QPS
rows returned
base fetch fanout
fallback usage
stale/missing result reports
```

---

## 45. Java Repository Design

Do not hide index usage inside generic search.

Bad:

```java
List<Case> findByField(String field, Object value);
```

Good:

```java
Optional<CaseId> findCaseIdByExternalReference(
    TenantId tenantId,
    ExternalReference ref
);

List<OpenCaseRow> findOpenCasesByAssigneeDayBucket(
    TenantId tenantId,
    AssigneeId assigneeId,
    LocalDate day,
    int bucketId,
    int limit
);
```

If using index:

```java
List<CaseCurrent> findByRareExternalDebugCodeUsingIndex(...);
```

Make it explicit in name or repository docs if it has special performance/operational constraints.

---

## 46. API Design

Avoid APIs that imply arbitrary indexed search:

```http
GET /cases?status=OPEN&assignee=A&priority=HIGH&text=fraud&from=2020&sort=dueAt
```

This is search/OLAP, not simple ScyllaDB index query.

Use separate endpoints:

```text
GET /assignees/{id}/open-cases?day=...
GET /cases/{id}
GET /cases/search?q=...
GET /reports/cases/status-count
```

Different backing systems.

---

## 47. Anti-Pattern: Index for Every UI Filter

Product wants filter panel:

```text
status
assignee
priority
team
region
due date
text
tag
```

Bad response:

```text
CREATE INDEX for each column
```

This creates:

- many index structures,
- write amplification,
- query planner limitations,
- unpredictable combinations,
- hot low-cardinality indexes,
- poor p99.

Better:

- identify top access paths,
- explicit tables for high-QPS paths,
- search engine for flexible filters,
- OLAP for reporting,
- product constraints.

---

## 48. Anti-Pattern: Index on Boolean/Status

Bad:

```sql
CREATE INDEX ON users (is_active);
CREATE INDEX ON cases (status);
```

Boolean/status values have low cardinality.

Index partitions huge/hot.

Use explicit bucketed table or avoid query.

---

## 49. Anti-Pattern: MV for Complex Projection

Bad use of MV:

```text
maintain open cases by assignee with custom stale semantics,
source_version,
bucket_id,
old-key cleanup,
authorization scope,
cross-table enrichment,
notification side effects
```

MV is not business workflow engine.

Use explicit projection.

---

## 50. Anti-Pattern: MV/Index on High-Churn Column

If indexed/view primary key column changes frequently:

```text
status
assignee
priority
read/unread
due_at
```

Every change deletes old entry and inserts new.

High churn creates tombstones and compaction pressure.

Sometimes still necessary, but design buckets/reconciliation and monitor.

---

## 51. Anti-Pattern: Restore Without Rebuild Plan

Relying on MV/SI but not planning restore/rebuild time is risky.

If disaster restore requires rebuilding indexes/views over terabytes, RTO may be much longer than expected.

Include MV/SI rebuild in DR tests.

---

## 52. Decision Framework

For every new query:

```text
1. Is query high-QPS production path?
2. Is result bounded?
3. Is predicate selective?
4. Is indexed value low-cardinality?
5. Is tenant scope included?
6. Is sorting/pagination required?
7. Is write/update churn high?
8. Does table use TTL/delete?
9. Is explicit table more controllable?
10. Would search/OLAP fit better?
11. What is rebuild/restore story?
12. What metrics will prove it is healthy?
```

If many answers are risky, do not use index/MV.

---

## 53. Practical Choice Examples

### Example A: Lookup by Email

Requirement:

```text
find user_id by normalized email per tenant
unique
```

Best:

```text
explicit mapping table + LWT IF NOT EXISTS
```

Not generic secondary index.

### Example B: Find Cases by OPEN Status

Requirement:

```text
list open cases for tenant/day sorted by due_at
```

Best:

```text
explicit bucketed derived table
```

Not status index.

### Example C: Admin Debug by Rare Trace ID

Requirement:

```text
low-QPS exact lookup, trace_id rare
```

Index may be acceptable.

Explicit mapping also possible.

### Example D: Full-Text Case Search

Best:

```text
search engine projection
```

Not ScyllaDB secondary indexes.

### Example E: Filter Events by Type Within One Case Bucket

Local secondary index may be considered if partition bounded and scan cost high.

---

## 54. Design Review Checklist

Before adding index/MV:

```text
[ ] What exact query will use it?
[ ] What is result cardinality?
[ ] Is indexed value low-cardinality?
[ ] Is tenant scope included?
[ ] Is query high-QPS?
[ ] Is sorting required?
[ ] Is pagination stable?
[ ] How often does indexed/view key change?
[ ] Does base table use TTL/delete?
[ ] What is write amplification?
[ ] What is read path?
[ ] What is compaction/tombstone risk?
[ ] What is build/backfill cost?
[ ] What is restore/rebuild plan?
[ ] Is explicit derived table better?
[ ] Is search/OLAP better?
[ ] What metrics/alerts are defined?
```

---

## 55. Common Misconceptions

### Misconception 1: “Secondary index in ScyllaDB is like SQL index.”

No. It is distributed and built on MV-like structures.

### Misconception 2: “Index fixes bad partition key.”

No. It creates another access path with its own partitioning risks.

### Misconception 3: “Index on status is fine because status is queried often.”

Often the opposite: frequent low-cardinality query can be huge/hot.

### Misconception 4: “Materialized view is free denormalization.”

No. It has write, storage, compaction, restore, and topology costs.

### Misconception 5: “MV can replace projection logic.”

Only for simple one-base-table alternate key. Not complex business projection.

### Misconception 6: “Adding index later is harmless.”

Building index on large table can be operationally heavy.

### Misconception 7: “Higher CL fixes index stale/projection issues.”

CL does not fix bad access path or build/rebuild/lag semantics.

### Misconception 8: “Many indexes per table are normal.”

Limits may allow low tens, but production design should keep them minimal and justified.

---

## 56. Mental Model Compression

Remember:

```text
Secondary index = database-managed alternate lookup structure.
Materialized view = database-managed derived table.
Local secondary index = index useful within base partition/locality.
Explicit table = application-managed derived access path.
Search/OLAP = separate system for flexible queries/scans.
```

And:

```text
Indexes and MVs reduce application code, not physics.
They still store data, write data, compact data, and fail operationally.
```

---

## 57. Summary

Indexes and materialized views are powerful but must be used deliberately.

Key lessons:

1. ScyllaDB secondary indexes are built on top of materialized views.
2. Global secondary indexes create distributed alternate structures.
3. Indexed column may become partition key of index structure.
4. Low-cardinality indexes can create huge/hot index partitions.
5. Local secondary indexes are useful for within-partition/local queries.
6. Materialized views are server-maintained derived tables.
7. MVs cannot be updated directly; update base table.
8. Index/MV writes add write amplification.
9. Index/MV storage has compaction/tombstone lifecycle.
10. Indexed/view key changes create delete+insert behavior.
11. Backup/restore plans should rebuild MV/SI from base table.
12. Tablets-enabled keyspaces with MV/SI have topology constraints.
13. Explicit derived tables give more control for critical access paths.
14. Search/OLAP are better for arbitrary filters/text/analytics.
15. Adding index/MV to large production table requires operational planning.
16. Java repositories should make access path explicit.

---

## 58. Review Questions

1. Kenapa secondary index ScyllaDB tidak sama dengan SQL index?
2. Bagaimana global secondary index diimplementasikan di ScyllaDB?
3. Apa risiko index pada kolom status?
4. Apa beda global dan local secondary index?
5. Kapan local secondary index cocok?
6. Apa itu materialized view?
7. Kenapa MV tidak bisa di-update langsung?
8. Apa write amplification dari index/MV?
9. Apa yang terjadi jika indexed column berubah?
10. Bagaimana TTL/delete memengaruhi index/MV?
11. Kenapa explicit derived table sering lebih baik untuk high-QPS path?
12. Kapan secondary index bisa diterima?
13. Kapan search engine lebih tepat?
14. Apa restore consideration untuk MV/SI?
15. Apa topology caveat untuk tablets + MV/SI?
16. Apa observability penting untuk index/MV?
17. Kenapa index build pada large table berisiko?
18. Mengapa many indexes per table buruk?
19. Bagaimana Java repository harus mengekspresikan index usage?
20. Apa checklist sebelum menambahkan index?

---

## 59. Practical Exercise

Untuk domain regulatory case management, evaluasi query berikut:

```text
1. find case by tenant_id + case_id
2. find case by external_ref
3. list open cases by status
4. list open cases by assignee sorted by due_at
5. find events by event_type within one case/month
6. search cases by party name/text
7. dashboard count by status/team
8. admin debug lookup by rare trace_id
9. list unread notifications
10. find all cases updated in last 24h
```

Untuk tiap query, pilih:

```text
base table primary key
secondary index
local secondary index
materialized view
explicit derived table
external search
OLAP/aggregate
```

Lalu jelaskan:

```text
why
result cardinality
hot key risk
write amplification
tombstone risk
pagination strategy
restore/rebuild plan
Java repository method
```

---

## 60. Preview Part 018

Part berikutnya membahas:

```text
Counters, Atomicity Boundaries, Static Columns, Collections, dan UDT
```

Kita akan memperdalam fitur CQL yang sering terlihat sederhana tetapi punya cost model khusus:

- counter semantics,
- retry ambiguity,
- sharded counters,
- static columns,
- collections,
- frozen vs non-frozen,
- UDT versioning,
- atomicity boundary,
- Java mapping pitfalls.

Part 017 membahas alternate access paths.

Part 018 membahas fitur data model yang sering menjadi sumber bug/cost tersembunyi.

---

# End of Part 017


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Compaction Strategies: STCS, LCS, TWCS, ICS, dan Amplification Trade-offs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-018.md">Part 018 — Counters, Atomicity Boundaries, Static Columns, Collections, dan UDT ➡️</a>
</div>

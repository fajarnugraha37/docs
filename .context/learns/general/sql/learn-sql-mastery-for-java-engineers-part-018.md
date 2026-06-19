# learn-sql-mastery-for-java-engineers-part-018.md

# Part 18 — Performance Engineering: From Slow Query to Root Cause

> Seri: SQL Mastery for Java Engineers  
> Bagian: 018 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-017.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-019.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas query optimizer dan execution plans.

Bagian ini membahas **performance engineering**: proses sistematis untuk mengubah gejala “query lambat” menjadi root cause yang jelas dan fix yang defensible.

Banyak engineer melakukan tuning seperti ini:

```text
Query lambat -> tambah index -> deploy -> berharap membaik.
```

Kadang berhasil. Sering hanya memindahkan masalah.

Performance engineering yang matang bertanya:

```text
Lambat untuk siapa?
Query apa?
Parameter apa?
Data sebanyak apa?
Plan apa?
Rows estimate vs actual?
CPU atau IO?
Lock atau query?
Database atau connection pool?
N+1 atau single slow query?
Index missing atau query shape salah?
Pagination atau sort?
Statistics atau data skew?
Read model diperlukan?
```

Bagian ini membahas:

- cara investigasi slow query
- symptom vs root cause
- database vs application bottleneck
- slow query logs
- query fingerprinting
- EXPLAIN workflow
- index tuning
- query rewrite
- pagination optimization
- join explosion
- N+1
- ORM pitfalls
- statistics and bloat
- locking vs execution slowness
- connection pool saturation
- caching vs fixing
- read model/materialized view
- performance incident playbook
- checklist untuk production review

Kalimat inti:

> Performance tuning bukan menebak index; performance engineering adalah proses observasi, hipotesis, verifikasi, dan perubahan minimal yang menjelaskan penyebab lambat.

---

## 1. Performance: Apa yang Sebenarnya Lambat?

“Database lambat” terlalu umum.

Kemungkinan:

```text
Query execution lambat
Query menunggu lock
Connection pool habis
Network lambat
Result set terlalu besar
Application mapping lambat
ORM melakukan N+1
Transaction terlalu lama
Disk IO saturated
CPU database saturated
Memory pressure
Sort/hash spill
Replication lag
Read replica stale/overloaded
Autovacuum/maintenance conflict
Plan berubah
Index bloat
Stats stale
```

Langkah pertama:

```text
Pisahkan waktu tunggu dari waktu kerja.
```

Contoh latency request 5 detik:

```text
connection pool wait: 2.5s
SQL execution: 200ms
JSON serialization: 1.8s
network: 500ms
```

Maka query bukan root cause utama.

---

## 2. Latency Breakdown untuk Java Backend

Untuk endpoint Java:

```text
HTTP receive
auth
service logic
connection acquisition
SQL execution
result fetching
row mapping
business transformation
serialization
HTTP response
```

Instrumentasi harus bisa membedakan:

- time waiting for DB connection
- time executing SQL
- time fetching rows
- time mapping ORM entities
- number of SQL statements
- rows returned
- transaction duration
- lock wait
- retries
- payload size

Tanpa breakdown, tuning buta.

---

## 3. Slow Query vs Many Queries

Dua pola umum:

### 3.1 Single Slow Query

```text
1 query takes 4 seconds
```

Investigasi:

- execution plan
- index
- join
- sort
- IO
- lock
- stats

### 3.2 Many Fast Queries

```text
500 queries × 8ms = 4 seconds
```

Biasanya N+1 atau loop query.

Investigasi:

- SQL count per request
- ORM lazy loading
- repository call in loop
- batch fetching
- join/projection query
- data loader pattern

Keduanya terlihat sebagai endpoint lambat, tetapi fix berbeda.

---

## 4. Establish Baseline

Sebelum tuning, catat baseline:

```text
Query text/fingerprint
Parameters
Average latency
p95/p99 latency
Rows returned
Rows scanned if available
Execution count per minute
CPU/IO usage
Plan
Index usage
Lock wait time
Temp file usage
Connection pool metrics
```

Tanpa baseline, kamu tidak tahu improvement nyata atau hanya kebetulan cache hangat.

---

## 5. Query Fingerprinting

Query dengan parameter berbeda seharusnya dikelompokkan.

Raw:

```sql
SELECT * FROM cases WHERE id = 'A';
SELECT * FROM cases WHERE id = 'B';
```

Fingerprint:

```sql
SELECT * FROM cases WHERE id = ?;
```

Database/tools dapat mengelompokkan berdasarkan normalized query.

Manfaat:

- menemukan query paling sering
- menemukan total time terbesar
- menemukan p95 terburuk
- melihat query count
- membedakan slow single query vs high-frequency query

Optimasi query yang jarang 5 detik mungkin kalah penting dari query 50ms yang jalan 1 juta kali.

---

## 6. Total Time vs Mean Time

Query A:

```text
mean 5s
executed 10 times/day
total 50s/day
```

Query B:

```text
mean 80ms
executed 2,000,000 times/day
total 44 hours/day cumulative
```

Query B mungkin lebih penting untuk kapasitas.

Performance prioritization:

- user impact
- total database load
- p95/p99
- business critical path
- incident risk
- frequency
- blast radius

---

## 7. Capture Exact SQL and Parameters

Execution plan depends on parameters.

Query:

```sql
WHERE tenant_id = ?
  AND status = ?
```

Parameter:

```text
tenant_id = huge tenant
status = OPEN
```

can have very different plan from:

```text
tenant_id = small tenant
status = ESCALATED
```

For Java/ORM, capture:

- actual SQL after ORM generation
- bind parameter values/types
- transaction isolation
- fetch size
- limit/offset
- current database
- user/role
- replica vs primary

Do not tune imagined SQL.

---

## 8. Use Production-Like Data

Dev database with 1,000 rows hides real problems.

Performance depends on:

- data volume
- data distribution
- skew
- indexes
- statistics
- bloat
- concurrent load
- cache state
- tenant size
- historical rows
- deleted rows
- row width

A query can be perfect on dev and catastrophic on production.

For serious tuning, use:

- anonymized production snapshot
- generated realistic volume
- worst-case tenant
- realistic history size
- realistic distribution

---

## 9. Investigation Workflow

When query is slow:

1. Confirm exact symptom.
2. Identify query/queries.
3. Capture SQL and parameters.
4. Check if waiting for lock or running.
5. Run `EXPLAIN ANALYZE` safely.
6. Compare estimated vs actual rows.
7. Inspect scan types.
8. Inspect join order and join algorithms.
9. Inspect sort/hash/temp spill.
10. Inspect loops.
11. Inspect rows removed by filter.
12. Inspect buffers/IO.
13. Check indexes and stats.
14. Check application query count.
15. Form root cause hypothesis.
16. Test minimal fix.
17. Compare baseline.
18. Deploy safely.
19. Monitor after deploy.

This process beats guessing.

---

## 10. Root Cause Categories

Slow SQL usually falls into one or more categories:

```text
missing index
wrong index
query not sargable
bad join order
join explosion
wrong aggregation strategy
sort too large
pagination offset
N+1 queries
over-fetching
stale statistics
data skew
parameter plan issue
lock wait
transaction too long
table/index bloat
insufficient memory
read replica lag/load
schema/model mismatch
```

Each category has different fix.

---

## 11. Missing Index

Symptom:

```text
Seq Scan on huge table
Filter highly selective
Rows Removed by Filter huge
```

Example query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number;
```

If no index, database scans.

Fix:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_number
ON cases (tenant_id, case_number_normalized);
```

But before adding:

- ensure business invariant
- check duplicates
- build safely
- consider concurrent/online build
- verify plan
- monitor write overhead

---

## 12. Wrong Index

Index exists:

```sql
CREATE INDEX idx_cases_status
ON cases (status);
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50;
```

Plan still sorts many rows.

Better index:

```sql
CREATE INDEX idx_cases_tenant_status_opened
ON cases (tenant_id, status, opened_at DESC, id DESC);
```

Reason:

- tenant filter
- status filter
- order support
- limit early

Wrong index is common when indexes are designed column-by-column, not query-by-query.

---

## 13. Non-Sargable Predicate

Bad:

```sql
WHERE DATE(opened_at) = :date
```

Index on `opened_at` cannot be used effectively.

Good:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

Bad:

```sql
WHERE lower(email) = lower(:email)
```

unless expression index.

Better:

```sql
WHERE email_normalized = :normalized_email
```

Performance fix may be query rewrite, not index.

---

## 14. Type Mismatch from Java

Bad SQL:

```sql
WHERE id::text = ?
```

or driver binds UUID as string and DB casts column.

This can block index.

Correct:

- bind UUID as UUID
- use correct JDBC type
- avoid casting column
- cast parameter if needed, not column

Good:

```sql
WHERE id = ?::uuid
```

or driver-native UUID binding.

As Java engineer, parameter types are performance concern.

---

## 15. Over-Fetching

Bad:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN';
```

for list API needing:

```text
id, case_number, priority, opened_at
```

Costs:

- more IO
- more memory
- less index-only scan
- more network
- slower ORM mapping
- serialization overhead
- accidental sensitive data exposure

Fix:

```sql
SELECT
    id,
    case_number,
    priority,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Use DTO projection.

---

## 16. Result Set Too Large

Endpoint returns 100k rows.

Even if query is “fast” in database, app slows due to:

- network transfer
- row mapping
- JSON serialization
- memory pressure
- GC
- browser/client rendering

Fix:

- pagination
- keyset pagination
- streaming export
- asynchronous report generation
- file export
- aggregation instead of raw rows
- limit fields
- compression if appropriate

Not all performance problems are index problems.

---

## 17. OFFSET Pagination Problem

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
ORDER BY opened_at DESC, id DESC
LIMIT 50 OFFSET 100000;
```

Database must skip many rows.

Even with index, it traverses offset rows.

Fix keyset:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND (
      opened_at < :last_opened_at
      OR (
          opened_at = :last_opened_at
          AND id < :last_id
      )
  )
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_opened_id
ON cases (tenant_id, opened_at DESC, id DESC);
```

---

## 18. Keyset Pagination with Composite Cursor

For query:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY priority_rank ASC, opened_at DESC, id DESC
LIMIT 50;
```

Cursor condition for next page:

```sql
AND (
    priority_rank > :last_priority_rank
    OR (
        priority_rank = :last_priority_rank
        AND opened_at < :last_opened_at
    )
    OR (
        priority_rank = :last_priority_rank
        AND opened_at = :last_opened_at
        AND id < :last_id
    )
)
```

Index:

```sql
CREATE INDEX idx_cases_queue_cursor
ON cases (tenant_id, status, priority_rank ASC, opened_at DESC, id DESC);
```

Cursor must include all order-by columns to be stable.

---

## 19. Join Explosion

Bad:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count,
    COUNT(a.id) AS assignment_count
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
LEFT JOIN case_assignments a ON a.case_id = c.id
GROUP BY c.id;
```

If case has:

```text
100 evidence
20 assignments
```

joined rows:

```text
2000
```

Fix with pre-aggregation:

```sql
WITH evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
),
assignment_counts AS (
    SELECT case_id, COUNT(*) AS assignment_count
    FROM case_assignments
    GROUP BY case_id
)
SELECT
    c.id,
    COALESCE(ec.evidence_count, 0) AS evidence_count,
    COALESCE(ac.assignment_count, 0) AS assignment_count
FROM cases c
LEFT JOIN evidence_counts ec ON ec.case_id = c.id
LEFT JOIN assignment_counts ac ON ac.case_id = c.id;
```

Performance and correctness improve.

---

## 20. Parent Page First Pattern

For list endpoint, page parent first.

Bad:

```sql
SELECT
    c.id,
    e.id AS evidence_id
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
WHERE c.status = 'OPEN'
ORDER BY c.opened_at DESC
LIMIT 50;
```

`LIMIT` applies to joined rows, not parent cases.

Better:

```sql
WITH page_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'OPEN'
    ORDER BY opened_at DESC, id DESC
    LIMIT 50
)
SELECT
    pc.*,
    e.id AS evidence_id
FROM page_cases pc
LEFT JOIN case_evidences e
  ON e.case_id = pc.id;
```

Or aggregate child counts separately.

This avoids both performance and pagination bugs.

---

## 21. N+1 Queries

Java/ORM classic:

```java
List<Case> cases = caseRepository.findOpenCases();
for (Case c : cases) {
    c.getEvidences().size(); // lazy load per case
}
```

SQL pattern:

```text
1 query for cases
N queries for evidences
```

Symptoms:

- many similar queries
- endpoint latency grows with row count
- DB query count high
- each query individually fast
- connection pool pressure

Fix options:

- projection query with join/aggregation
- batch fetch
- entity graph carefully
- `WHERE case_id IN (...)`
- data loader
- read model
- avoid lazy loading in serialization

---

## 22. N+1 vs Join Explosion Trade-Off

Fixing N+1 with giant fetch join can cause row explosion.

Bad replacement:

```sql
SELECT *
FROM cases c
LEFT JOIN evidences e ON e.case_id = c.id
LEFT JOIN assignments a ON a.case_id = c.id
LEFT JOIN notes n ON n.case_id = c.id;
```

This multiplies children.

Better:

- fetch parent page
- fetch child collections separately by parent IDs
- use aggregation summaries
- use DTO projection
- use read model
- use batch size

Not every N+1 should become one mega-join.

---

## 23. ORM Entity Loading vs DTO Projection

Entity loading:

```java
List<Case> cases = entityManager
    .createQuery("select c from Case c ...")
```

Can load many columns and relationships.

DTO projection:

```sql
SELECT
    c.id,
    c.case_number,
    c.status,
    c.opened_at,
    o.full_name AS officer_name
FROM ...
```

For read/list APIs, DTO projection often wins:

- fewer columns
- no dirty tracking
- less memory
- less lazy loading
- SQL shape explicit
- easier index-only scans

Use entities for transactional aggregate modification, not every read.

---

## 24. Sorting Too Much

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
ORDER BY updated_at DESC
LIMIT 50;
```

If no index:

```text
filter tenant rows
sort all tenant rows
take 50
```

Index:

```sql
CREATE INDEX idx_cases_tenant_updated
ON cases (tenant_id, updated_at DESC, id DESC);
```

But beware:

- `updated_at` changes often
- index write overhead
- update hot column
- if query critical, worth it
- if rarely used admin page, maybe not

Performance is trade-off.

---

## 25. Aggregation Too Much

Dashboard query:

```sql
SELECT
    status,
    COUNT(*)
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status;
```

If tenant has 50 million cases and dashboard loads every second, live aggregation may be too expensive.

Options:

- summary table
- materialized view
- cached metrics
- event-driven counters
- approximate counts
- partitioned aggregation
- OLAP warehouse

Correctness questions:

- real-time or eventual?
- how stale allowed?
- can counters drift?
- rebuild strategy?
- reconciliation?
- transactionally updated?

---

## 26. Materialized View / Summary Table

Summary table:

```sql
CREATE TABLE case_status_counts (
    tenant_id UUID NOT NULL,
    status TEXT NOT NULL,
    case_count BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, status)
);
```

Update strategies:

- synchronous transaction
- asynchronous event projection
- scheduled refresh
- incremental batch
- materialized view refresh

Trade-offs:

- read fast
- writes more complex
- stale data possible
- rebuild needed
- consistency strategy required

Never add summary table without ownership and rebuild plan.

---

## 27. Caching: Last Resort or Complement?

Cache can help if:

- query result reused often
- data changes less frequently
- staleness acceptable
- invalidation manageable
- DB is bottleneck
- read pattern high volume

Cache can hurt if:

- invalidation complex
- stale data unacceptable
- hides bad query
- adds consistency bugs
- cache stampede
- memory cost
- operational complexity

Before caching, ask:

```text
Can query be fixed?
Can result be smaller?
Can index/read model solve?
Is staleness acceptable?
How invalidate?
```

---

## 28. Lock Wait vs Slow Execution

Query can be slow because it waits for lock.

Symptoms:

- execution time high but CPU/IO low
- blocked sessions
- lock wait events
- query fast when run alone
- long transaction elsewhere
- update/delete waiting

Example:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = :id;
```

It may wait because another transaction holds row lock.

Fix:

- shorten transactions
- avoid external calls inside transaction
- proper indexing for update/delete predicates
- lock timeout
- retry strategy
- consistent lock order
- diagnose blocking session
- reduce batch size

Execution plan is not enough for lock waits.

---

## 29. Long Transactions

Long transactions cause:

- locks held longer
- vacuum cleanup blocked
- bloat
- replication lag
- deadlocks more likely
- connection pool occupied
- stale snapshots
- operational pain

Bad pattern:

```text
begin transaction
select for update
call external API
do business logic
update
commit
```

Fix:

- do external calls before/after transaction
- keep transaction small
- lock late
- write fast
- use outbox for side effects
- avoid user think time in transaction

---

## 30. Deadlocks

Deadlock occurs when transactions wait on each other in cycle.

Example:

Transaction A:

```text
lock case 1
lock case 2
```

Transaction B:

```text
lock case 2
lock case 1
```

Fix:

- consistent lock ordering
- smaller transactions
- proper indexes to avoid locking many rows
- retry deadlock victim
- avoid interactive transactions
- reduce overlapping updates

Deadlock is often retryable, but frequent deadlock means design issue.

---

## 31. Statistics Problems

If plan estimates wrong rows, update stats.

PostgreSQL:

```sql
ANALYZE cases;
```

But root cause may be:

- stale stats
- low statistics target
- correlated columns
- skew
- expression predicate
- JSON values
- temporary table stats missing
- parameterized generic plan

Solutions:

- analyze
- increase statistics target
- extended statistics
- expression statistics if supported
- better query/index
- avoid hiding important values in JSON

---

## 32. Table and Index Bloat

Bloat means table/index contains dead/unused space.

Causes:

- heavy updates/deletes
- long transactions blocking cleanup
- insufficient vacuum/maintenance
- hot mutable indexed columns
- churn in partial indexes
- failed/old migrations

Symptoms:

- table larger than expected
- index scans read many pages
- cache inefficiency
- slow vacuum
- slower backups
- degraded performance

Fix vendor-specific:

- vacuum/analyze
- reindex
- rebuild table
- partitioning
- reduce update churn
- tune autovacuum
- avoid unnecessary indexes

---

## 33. Write Amplification from Indexes

Adding index can improve read but slow writes.

For write-heavy table:

```text
outbox_events
audit_events
case_activity_events
```

Each extra index affects:

- insert latency
- WAL/redo volume
- replication
- storage
- cache
- maintenance

Audit table with 8 indexes may become bottleneck.

Index based on query priority and retention/partitioning strategy.

---

## 34. Hot Rows and Counters

Counter table:

```sql
UPDATE case_status_counts
SET count = count + 1
WHERE tenant_id = :tenant_id
  AND status = 'OPEN';
```

If many writes hit same row, hot row contention.

Alternatives:

- sharded counters
- event log + async aggregation
- periodic refresh
- materialized view
- approximate count
- partition by tenant/status/time
- avoid real-time exact counter if not needed

Performance design includes contention, not only query speed.

---

## 35. Read Replica Issues

Moving reads to replica can help, but:

- replica may lag
- long reports can overload replica
- queries still need indexes
- read-after-write consistency issues
- failover changes performance
- replica hardware may differ
- bad query on replica still bad

Use replica intentionally:

- analytics/reporting
- non-critical read
- async workflows
- dashboards tolerant of lag

Critical read-after-write may need primary or consistency token.

---

## 36. Connection Pool Saturation

Endpoint slow because DB pool exhausted.

Causes:

- slow queries
- long transactions
- too many concurrent requests
- leaks
- pool too small or too large
- DB max connections exceeded
- blocking calls inside transaction
- chatty N+1

Metrics:

- active connections
- idle connections
- pending acquisition
- acquisition latency
- max lifetime
- timeout count

Fix is not always “increase pool”.

A too-large pool can overload DB.

---

## 37. Batch Jobs and Production Load

Batch jobs can degrade OLTP.

Examples:

- backfill updates millions rows
- report scans huge table
- index build
- delete old data
- import job
- reconciliation query

Mitigations:

- batch size
- throttling
- off-peak schedule
- read replica
- partitioning
- online index build
- lock timeout
- statement timeout
- progress checkpoints
- idempotent resume
- monitoring

Batch SQL must be production-safe.

---

## 38. Performance-Safe Migration

Adding index/constraint/backfill can hurt production.

Checklist:

```text
[ ] table size known?
[ ] lock behavior known?
[ ] online/concurrent option?
[ ] transaction duration acceptable?
[ ] disk space enough?
[ ] replication impact?
[ ] rollback/fix-forward?
[ ] backfill batched?
[ ] monitoring?
[ ] statement timeout?
[ ] tested on production-like data?
```

Migration performance is part of SQL mastery.

---

## 39. Slow Query Fix Patterns

### 39.1 Add/Adjust Index

When query shape is right and index missing/wrong.

### 39.2 Rewrite Predicate

Make sargable.

### 39.3 Rewrite Join

Use `EXISTS`, pre-aggregation, parent page first.

### 39.4 Reduce Columns/Rows

Projection, pagination, filters.

### 39.5 Update Statistics

When estimates wrong.

### 39.6 Split Query

Avoid mega-join; fetch parent then children.

### 39.7 Read Model

For complex repeated projection.

### 39.8 Summary Table

For repeated expensive aggregation.

### 39.9 Partitioning

For huge time/tenant data and maintenance.

### 39.10 Cache

When staleness acceptable and invalidation solved.

---

## 40. Case Study: Slow Open Case Queue

Symptom:

```text
GET /cases/open p95 = 4s
```

SQL:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50;
```

Plan:

```text
Seq Scan on cases
Filter tenant/status
Sort 800k rows
Limit 50
```

Root causes:

- no composite index
- `SELECT *`
- sort huge result

Fix:

```sql
SELECT
    id,
    case_number,
    priority,
    opened_at
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_open_queue
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number, priority);
```

Expected result:

- index-only/range scan
- no huge sort
- limit early
- less IO/network

---

## 41. Case Study: Slow Search with Optional Filters

SQL:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND (:status IS NULL OR status = :status)
  AND (:priority IS NULL OR priority = :priority)
  AND (:opened_from IS NULL OR opened_at >= :opened_from)
ORDER BY opened_at DESC
LIMIT 50;
```

Symptoms:

- inconsistent latency
- generic plan
- poor index usage

Fix approach:

- generate SQL with only active predicates
- specialize common queries
- use composite indexes for common paths
- use read/search model for complex admin search
- cap result size
- avoid `SELECT *`

Example dynamic query when status/priority present:

```sql
WHERE tenant_id = :tenant_id
  AND status = :status
  AND priority = :priority
ORDER BY opened_at DESC
LIMIT 50
```

Index:

```sql
(tenant_id, status, priority, opened_at DESC, id DESC)
```

---

## 42. Case Study: N+1 Evidence Counts

Endpoint:

```text
List 50 cases with evidence count
```

Bad Java:

```java
for (Case c : cases) {
    int count = evidenceRepository.countByCaseId(c.id());
}
```

Queries:

```text
1 + 50
```

Fix SQL:

```sql
WITH page_cases AS (
    SELECT
        id,
        case_number,
        opened_at
    FROM cases
    WHERE tenant_id = :tenant_id
      AND status = 'OPEN'
    ORDER BY opened_at DESC, id DESC
    LIMIT 50
),
evidence_counts AS (
    SELECT
        e.case_id,
        COUNT(*) AS evidence_count
    FROM case_evidences e
    JOIN page_cases pc
      ON pc.id = e.case_id
    GROUP BY e.case_id
)
SELECT
    pc.id,
    pc.case_number,
    COALESCE(ec.evidence_count, 0) AS evidence_count
FROM page_cases pc
LEFT JOIN evidence_counts ec
  ON ec.case_id = pc.id;
```

Indexes:

```sql
cases(tenant_id, status, opened_at DESC, id DESC)
case_evidences(case_id)
```

---

## 43. Case Study: Dashboard Counts Too Slow

Dashboard:

```sql
SELECT
    status,
    COUNT(*)
FROM cases
WHERE tenant_id = :tenant_id
GROUP BY status;
```

If tenant has huge data and dashboard refreshes often, index may not solve enough.

Options:

1. accept live aggregation if infrequent
2. summary table per tenant/status
3. materialized view refreshed periodically
4. event-driven counters
5. OLAP pipeline
6. cache with TTL

Need define freshness:

```text
real-time?
within 5 seconds?
within 5 minutes?
daily?
```

Without freshness requirement, engineers overbuild or underbuild.

---

## 44. Case Study: Report Query Blocks OLTP

Monthly report scans cases/evidence/notes during business hours.

Symptoms:

- DB CPU/IO high
- OLTP latency spikes
- replica lag
- temp files huge

Fixes:

- run on read replica
- schedule off-peak
- create reporting tables
- partition by date
- pre-aggregate
- add indexes for report filters
- export to warehouse
- resource governance
- statement timeout
- pagination/streaming

Reports are workloads. Treat them as first-class.

---

## 45. Case Study: Lock Wait During Bulk Update

Bulk update:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE risk_score >= 80;
```

Problems:

- locks many rows
- long transaction
- replication lag
- blocks user updates

Safer batch:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE id IN (
    SELECT id
    FROM cases
    WHERE risk_score >= 80
      AND priority <> 'HIGH'
    ORDER BY id
    LIMIT 1000
);
```

Loop with sleep/throttle.

Add monitoring:

- affected rows per batch
- duration
- lock waits
- replication lag
- errors
- remaining rows

---

## 46. Performance Incident Playbook

During incident:

1. Identify impact:
   - endpoints
   - tenants
   - error rate
   - latency
2. Check DB health:
   - CPU
   - IO
   - connections
   - locks
   - replication
   - temp files
3. Identify top queries:
   - currently running
   - slow logs
   - query stats
4. Check blocking sessions.
5. Kill/cancel only with understanding.
6. Apply mitigation:
   - disable feature
   - reduce traffic
   - add timeout
   - cancel report
   - throttle job
   - route read to replica
   - emergency index only if safe
7. Capture evidence:
   - SQL
   - plan
   - parameters
   - metrics
8. Post-incident root cause.
9. Add durable fix.
10. Add monitoring/regression test.

Do not perform risky schema changes under panic unless necessary and understood.

---

## 47. Emergency Mitigations

Possible mitigations:

- cancel runaway query
- pause batch job
- disable expensive endpoint
- reduce page size
- add temporary feature flag
- increase statement timeout
- route report to replica
- scale read replicas
- temporarily add cache
- add emergency index concurrently, if safe
- increase DB resources, if bottleneck is capacity

But durable fix still needed.

---

## 48. Performance Review for New Feature

Before shipping new SQL-heavy feature:

```text
[ ] Expected QPS?
[ ] Expected data volume now and in 1 year?
[ ] Worst-case tenant?
[ ] Query count per request?
[ ] Any N+1?
[ ] Pagination strategy?
[ ] Indexes?
[ ] Execution plans on realistic data?
[ ] Rows returned?
[ ] DTO projection?
[ ] Transaction duration?
[ ] Lock behavior?
[ ] Batch/report workload?
[ ] Freshness requirement?
[ ] Need read model?
[ ] Observability added?
```

Performance is design-time responsibility, not only incident response.

---

## 49. SQL Performance Anti-Patterns

```text
SELECT * everywhere
OFFSET deep pagination
optional filter OR template
function on indexed column
string-cast UUID/date/numeric
N+1 lazy loading
giant fetch join with multiple collections
COUNT(*) for every list request
DISTINCT to hide join bug
live dashboard aggregation over huge OLTP table
unbounded exports through API
batch update millions rows in one transaction
soft delete without partial indexes
JSON core fields with no real columns
no slow query logging
no query count metrics
no realistic performance tests
```

Recognize these early.

---

## 50. When to Stop Tuning SQL

Sometimes SQL tuning reaches diminishing returns.

Consider architecture change if:

- query inherently scans too much data
- report is analytical not OLTP
- search needs relevance/fuzzy/facets
- dashboard needs high-frequency aggregates
- cross-service data joined ad hoc
- endpoint requires many derived values
- data volume outgrows single-table design
- operational workload conflicts with reporting

Possible changes:

- read model
- materialized view
- summary table
- cache
- search engine
- OLAP warehouse
- partitioning
- event-driven projection
- service API redesign

Senior judgement is knowing when not to keep micro-tuning.

---

## 51. Minimal Fix Principle

Prefer smallest fix that addresses root cause.

Examples:

- bad predicate -> rewrite predicate
- missing composite index -> add one index
- N+1 -> batch fetch/projection
- join explosion -> pre-aggregate
- deep offset -> keyset pagination
- stale stats -> analyze/update stats
- report workload -> move to replica/read model

Avoid:

- adding 5 indexes “just in case”
- caching before understanding
- rewriting whole system during incident
- denormalizing without rebuild plan
- adding hints without stats/query fix

---

## 52. Performance Documentation

For critical query, document:

```text
Query purpose
Expected cardinality
Indexes supporting it
Pagination strategy
Known worst-case
Freshness requirement
Plan assumptions
Fallback/timeout
Owner
```

Example:

```text
Open case queue:
- tenant-scoped
- status OPEN only
- ordered by opened_at desc, id desc
- uses idx_cases_open_queue
- keyset pagination after first page
- p95 target < 100ms at 1M open cases/tenant
```

This prevents future accidental regressions.

---

## 53. Practical Exercises

### Exercise 1 — Diagnose Slow Queue

Given plan:

```text
Seq Scan cases
Rows Removed by Filter: 5,000,000
Sort Method: external merge Disk: 1GB
Limit 50
```

Query:

```sql
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50
```

Fix:

```sql
CREATE INDEX idx_cases_queue
ON cases (tenant_id, status, opened_at DESC, id DESC);
```

Also project only needed columns.

### Exercise 2 — Detect N+1

Log:

```text
SELECT * FROM cases WHERE status = ?
SELECT * FROM case_evidences WHERE case_id = ?
SELECT * FROM case_evidences WHERE case_id = ?
...
```

Fix:

- fetch evidences for page IDs in one query
- aggregate counts
- DTO projection
- batch fetch

### Exercise 3 — Rewrite Non-Sargable

Bad:

```sql
WHERE DATE(created_at) = :date
```

Good:

```sql
WHERE created_at >= :start
  AND created_at < :end
```

### Exercise 4 — Replace OFFSET

Bad:

```sql
LIMIT 50 OFFSET 500000
```

Good:

```sql
WHERE (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 50
```

Syntax for row comparison may vary; equivalent boolean logic is portable.

### Exercise 5 — Choose Read Model

If endpoint needs:

```text
case fields + officer name + evidence count + latest activity + SLA status + approval status
```

and runs frequently, consider read model instead of repeated live joins/aggregates.

---

## 54. Performance Engineering Checklist

```text
[ ] Is the issue single slow query or many queries?
[ ] Do we have exact SQL and parameters?
[ ] Do we know query count per request?
[ ] Is time spent waiting for connection?
[ ] Is time spent waiting on lock?
[ ] Is result set too large?
[ ] Does EXPLAIN ANALYZE show estimate mismatch?
[ ] Are indexes used as expected?
[ ] Are conditions in Index Cond or Filter?
[ ] Is there sort/hash spill?
[ ] Are joins multiplying rows?
[ ] Is pagination efficient?
[ ] Is ORM over-fetching?
[ ] Are stats fresh?
[ ] Is data skew causing plan issue?
[ ] Is this OLTP or reporting workload?
[ ] Is read model/cache/warehouse more appropriate?
[ ] Is fix measured against baseline?
[ ] Is production deployment safe?
```

---

## 55. Koneksi ke Part Berikutnya

Bagian ini menyelesaikan blok performance dasar:

- indexing
- advanced indexing
- optimizer/plans
- performance engineering

Part berikutnya, `part-019`, akan masuk ke transaksi:

- ACID
- isolation levels
- anomalies
- lost update
- dirty/non-repeatable/phantom reads
- write skew
- real consistency
- Java `@Transactional`
- retry semantics

Performance membuat sistem cepat. Transactions membuat sistem benar saat concurrent.

---

## 56. Ringkasan Bagian Ini

Hal penting dari part 018:

1. Performance engineering dimulai dari observability, bukan tebakan.
2. Pisahkan slow query, many queries, lock wait, pool wait, and app-side overhead.
3. Exact SQL dan parameters wajib untuk diagnosis.
4. Query fingerprint membantu prioritas berdasarkan total impact.
5. Production-like data penting karena volume/skew menentukan plan.
6. Root cause umum: missing/wrong index, non-sargable predicate, join explosion, N+1, offset pagination, stale stats, locks, bloat.
7. `SELECT *` dan over-fetching bisa menjadi bottleneck besar.
8. Keyset pagination mengatasi deep offset.
9. Parent page first pattern mencegah join pagination bug.
10. N+1 tidak selalu harus diganti mega-join; gunakan projection/batch/read model.
11. Live aggregation besar mungkin perlu summary/materialized view.
12. Cache bukan pengganti pemahaman root cause.
13. Lock wait berbeda dari slow execution.
14. Long transactions memperburuk locks, bloat, dan pool saturation.
15. Statistics dan bloat adalah faktor performance production.
16. Batch job harus dirancang agar tidak merusak OLTP.
17. Migration schema juga punya performance risk.
18. Incident playbook membantu mitigasi tanpa panik.
19. Performance review harus dilakukan sebelum fitur ship.
20. Kadang solusi terbaik adalah architecture change, bukan index tambahan.

Kalimat inti:

> Query cepat bukan hasil keberuntungan; ia hasil dari model data yang benar, query yang sargable, index yang sesuai workload, plan yang sehat, dan observability yang membuat root cause terlihat.

---

## 57. Referensi

1. PostgreSQL Documentation — Using EXPLAIN.  
   https://www.postgresql.org/docs/current/using-explain.html

2. PostgreSQL Documentation — Planner Statistics.  
   https://www.postgresql.org/docs/current/planner-stats.html

3. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

4. PostgreSQL Documentation — Monitoring Database Activity.  
   https://www.postgresql.org/docs/current/monitoring.html

5. PostgreSQL Documentation — Routine Vacuuming.  
   https://www.postgresql.org/docs/current/routine-vacuuming.html

6. MySQL 8.4 Reference Manual — Optimization.  
   https://dev.mysql.com/doc/refman/8.4/en/optimization.html

7. MySQL 8.4 Reference Manual — Optimizing Queries with EXPLAIN.  
   https://dev.mysql.com/doc/refman/8.4/en/using-explain.html

8. SQL Server Documentation — Query Processing Architecture Guide.  
   https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide

9. SQL Server Documentation — Monitor and Tune for Performance.  
   https://learn.microsoft.com/en-us/sql/relational-databases/performance/monitor-and-tune-for-performance

10. Oracle Database SQL Tuning Guide.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/tgsql/

11. HikariCP Documentation — Pool Sizing.  
    https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing

---

## 58. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-019.md` — Transactions: ACID, Isolation, Anomalies, and Real Consistency

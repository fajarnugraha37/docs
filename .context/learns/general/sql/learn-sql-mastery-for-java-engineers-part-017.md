# learn-sql-mastery-for-java-engineers-part-017.md

# Part 17 — Query Optimizer and Execution Plans

> Seri: SQL Mastery for Java Engineers  
> Bagian: 017 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-016.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-018.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas index fundamentals dan advanced indexing.

Sekarang kita membahas komponen yang memutuskan apakah index itu dipakai atau tidak: **query optimizer**.

Banyak engineer berpikir:

```text
Saya sudah membuat index, harusnya query cepat.
```

Lalu bingung ketika database tetap melakukan sequential scan.

Atau:

```text
Query ini cuma join dua table, harusnya cepat.
```

Tapi ternyata join order salah, cardinality estimate meleset, sort spill ke disk, atau nested loop membaca jutaan row.

Untuk menjadi top-tier SQL engineer, kamu harus bisa membaca execution plan.

Execution plan menjawab:

```text
Bagaimana database benar-benar mengeksekusi query?
```

Bagian ini membahas:

- logical SQL vs physical execution
- parser, rewriter, planner, executor
- cost-based optimizer
- cardinality estimation
- statistics
- sequential scan, index scan, bitmap scan
- nested loop, hash join, merge join
- sort, aggregate, window execution
- estimated rows vs actual rows
- why indexes are ignored
- plan instability
- parameterized query issues
- `EXPLAIN`
- how to read execution plans professionally
- practical debugging workflow

Kalimat inti:

> SQL menyatakan apa yang kamu mau; execution plan menunjukkan bagaimana database mencoba mendapatkannya.

---

## 1. SQL adalah Declarative, Plan adalah Physical

Query:

```sql
SELECT
    c.id,
    c.case_number,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.tenant_id = :tenant_id
  AND c.status = 'OPEN'
GROUP BY c.id, c.case_number
ORDER BY c.opened_at DESC
LIMIT 50;
```

Secara logical, kamu menyatakan:

```text
Ambil open cases tenant ini, join evidence, count evidence, sort, limit.
```

Database harus memilih physical strategy:

- scan table cases atau index?
- filter tenant/status dulu atau join dulu?
- nested loop atau hash join?
- aggregate hash atau sort?
- sort sebelum limit atau pakai index order?
- baca evidence dengan index per case atau scan semua evidence?
- berapa row diperkirakan?
- apakah memory cukup?

Execution plan adalah keputusan fisik itu.

---

## 2. Lifecycle Query secara Sederhana

Ketika SQL dikirim ke database:

1. parse SQL
2. validate names/types
3. rewrite query
4. plan/optimize
5. execute
6. return rows
7. commit/rollback if transaction boundary

### 2.1 Parse

Database memeriksa syntax.

### 2.2 Bind/Analyze

Database memeriksa:

- table ada?
- column ada?
- function ada?
- type compatible?
- permission?

### 2.3 Rewrite

Database dapat mengubah query logical:

- expand view
- apply rules
- simplify predicates
- transform subqueries
- predicate pushdown
- flatten CTE if allowed
- transform `EXISTS` to semi join

### 2.4 Optimize/Plan

Database mencari plan dengan cost terendah berdasarkan statistics.

### 2.5 Execute

Executor menjalankan plan.

---

## 3. Cost-Based Optimizer

Modern database biasanya memakai cost-based optimizer.

Artinya:

```text
Optimizer mengevaluasi beberapa plan candidate dan memilih yang estimated cost-nya paling rendah.
```

Cost bukan waktu nyata. Cost adalah angka internal.

Cost mempertimbangkan:

- estimated rows
- IO cost
- CPU cost
- random vs sequential reads
- sort cost
- join cost
- memory
- parallelism
- indexes
- statistics
- table size

Optimizer tidak “tahu” real world secara sempurna. Ia menebak berdasarkan statistics.

Jika tebakannya salah, plan bisa salah.

---

## 4. Cardinality Estimation

Cardinality estimation adalah estimasi jumlah row pada tiap tahap.

Contoh:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
```

Optimizer perlu memperkirakan:

```text
Berapa row cases cocok?
```

Jika estimate:

```text
50 rows
```

mungkin pilih nested loop.

Jika actual:

```text
5,000,000 rows
```

nested loop bisa bencana.

Banyak performance issue berasal dari cardinality estimate yang salah.

---

## 5. Statistics

Database menyimpan statistics untuk membantu optimizer.

Statistics bisa mencakup:

- jumlah row
- jumlah page/block
- null fraction
- number of distinct values
- most common values
- histograms
- correlation
- extended statistics
- index statistics

Example skew:

```text
status:
OPEN        85%
CLOSED      14%
ESCALATED    1%
```

Jika optimizer tahu `ESCALATED` langka, index mungkin dipakai.

Jika statistics stale dan optimizer mengira semua status rata, plan bisa buruk.

---

## 6. Estimated Rows vs Actual Rows

Execution plan biasanya menampilkan estimated rows.

With analyze/execution, dapat actual rows.

PostgreSQL:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
```

Kamu akan melihat kira-kira:

```text
Index Scan ... (cost=... rows=100 ...)
(actual time=... rows=100000 ...)
```

Jika estimated rows 100 tetapi actual rows 100000, optimizer salah besar.

Red flag:

```text
estimated rows jauh berbeda dari actual rows
```

Ini sering menjelaskan plan buruk.

---

## 7. EXPLAIN vs EXPLAIN ANALYZE

### 7.1 EXPLAIN

```sql
EXPLAIN
SELECT ...
```

Menampilkan rencana tanpa menjalankan query.

Aman untuk SELECT besar karena tidak execute, tetapi hanya estimate.

### 7.2 EXPLAIN ANALYZE

```sql
EXPLAIN ANALYZE
SELECT ...
```

Menjalankan query dan menampilkan actual timing/rows.

Lebih akurat, tetapi query benar-benar berjalan.

Untuk DML:

```sql
EXPLAIN ANALYZE UPDATE ...
```

dapat benar-benar mengubah data jika tidak dibungkus rollback.

Safe pattern:

```sql
BEGIN;
EXPLAIN ANALYZE
UPDATE ...
ROLLBACK;
```

Tetap hati-hati dengan locks/side effects/triggers.

### 7.3 BUFFERS

PostgreSQL:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

Menunjukkan buffer hits/reads/writes.

Sangat berguna untuk membedakan CPU vs IO/cache behavior.

---

## 8. Logical Order vs Physical Order

SQL logical order:

```text
FROM
WHERE
GROUP BY
HAVING
SELECT
ORDER BY
LIMIT
```

Physical plan bisa berbeda.

Database boleh:

- push filter sebelum join
- reorder inner joins
- use index to produce order
- aggregate before join if semantically valid
- transform subquery to join
- use hash table
- parallelize scan
- stop early with limit
- skip reading columns until needed

Jangan mengasumsikan database mengeksekusi SQL line-by-line.

---

## 9. Sequential Scan

Sequential scan membaca table secara luas.

PostgreSQL plan might show:

```text
Seq Scan on cases
```

Sequential scan tidak selalu buruk.

Good when:

- table small
- most rows needed
- index not selective
- query analytical
- data fully cached
- sequential IO cheaper
- parallel seq scan available

Bad when:

- huge table
- predicate should be selective
- query latency sensitive
- index expected but not used
- function/cast prevents index
- stats wrong

---

## 10. Index Scan

Index scan reads index entries and fetches table rows.

Plan:

```text
Index Scan using idx_cases_tenant_status on cases
```

Good when:

- predicate selective
- index order useful
- limited result
- few heap/table fetches
- query uses keyset pagination

Can be bad when:

- many rows matched
- random table fetches huge
- table access dominates
- index not covering
- correlation poor

---

## 11. Index Only Scan

Index-only scan can answer from index without fetching table rows, if visibility rules allow.

Plan:

```text
Index Only Scan using idx_cases_queue_cover on cases
```

Good when:

- index contains all selected columns
- visibility map/engine allows
- table fetch avoided
- hot list query

Caveats:

- may still fetch heap in some DBs
- covering index bigger
- write overhead
- not always chosen

---

## 12. Bitmap Index Scan

PostgreSQL often uses bitmap scan when many rows match but index still helps.

Plan:

```text
Bitmap Index Scan
Bitmap Heap Scan
```

Mental model:

1. scan index(es) to build bitmap of matching row locations
2. read table blocks more efficiently
3. apply recheck/filter if needed

Useful when:

- predicate matches many rows but not most
- multiple indexes combined
- table block locality helps
- random index scan would be too expensive

Example:

```sql
WHERE status = 'ESCALATED'
  AND priority = 'CRITICAL'
```

Database may bitmap combine indexes.

---

## 13. Why Optimizer Ignores Your Index

Common reasons:

### 13.1 Predicate Not Selective

```sql
WHERE status = 'OPEN'
```

if 85% rows open.

### 13.2 Function on Column

```sql
WHERE lower(email) = lower(:email)
```

without expression index.

### 13.3 Type Cast

```sql
WHERE id::text = :id
```

or parameter type mismatch.

### 13.4 Wrong Column Order

Index:

```sql
(opened_at, tenant_id)
```

Query:

```sql
WHERE tenant_id = ?
```

### 13.5 Query Needs Most Rows

Index is more expensive than scan.

### 13.6 Stats Stale/Wrong

Planner estimates wrong row counts.

### 13.7 Partial Index Predicate Not Implied

Query parameter/prepared plan cannot use partial index.

### 13.8 ORDER BY Not Matching

Index helps filter but not sort.

### 13.9 Too Many Table Fetches

Index scan would fetch many scattered rows.

### 13.10 Generic Plan

Prepared statement generic plan not optimized for specific value.

---

## 14. Join Algorithms

Database has several physical join algorithms.

Common:

```text
Nested Loop Join
Hash Join
Merge Join
```

The optimizer chooses based on estimated cost.

---

## 15. Nested Loop Join

Mental model:

```text
for each row in outer:
    find matching rows in inner
```

Good when:

- outer small
- inner lookup indexed
- result small
- join condition selective
- LIMIT stops early

Example:

```sql
SELECT *
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.id = :case_id;
```

Outer: 1 case  
Inner: index lookup evidences by case_id

Nested loop is excellent.

Bad when:

- outer large
- inner lookup expensive
- no index on inner
- cardinality underestimated

A bad nested loop can execute millions of inner lookups.

---

## 16. Hash Join

Mental model:

1. build hash table from smaller input on join key
2. scan larger input and probe hash table

Good when:

- equality join
- large inputs
- no useful index
- enough memory
- join returns many rows

Example:

```sql
SELECT *
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.status = 'OPEN';
```

If many open cases and many evidence rows, hash join may be better than nested loop.

Risk:

- hash table too large
- spills to disk
- memory pressure
- wrong build side due to bad estimates

---

## 17. Merge Join

Mental model:

1. both inputs sorted by join key
2. advance through both sorted streams

Good when:

- inputs already sorted by index
- large ordered datasets
- equality/range-compatible joins
- avoids hash memory
- useful with ORDER BY

Requires sorted inputs. Sorting can be expensive if not already ordered.

---

## 18. Join Order

For inner joins, optimizer can reorder joins.

Query:

```sql
FROM cases c
JOIN case_evidences e ON e.case_id = c.id
JOIN officers o ON o.id = c.assigned_officer_id
```

Database may choose:

- start from cases
- start from evidences
- start from officers
- join filtered table first

Join order matters massively.

If one table has highly selective predicate, good plan often starts there.

Outer joins restrict reordering because they preserve unmatched rows.

---

## 19. Semi Join and Anti Join Plans

Query:

```sql
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
)
```

Optimizer may plan as semi join.

Semi join:

```text
return left row if at least one match exists
```

No row multiplication.

Anti join:

```sql
WHERE NOT EXISTS (...)
```

Plan may show anti join.

Understanding this helps see why `EXISTS` can be better than `JOIN DISTINCT`.

---

## 20. Sort Node

Plan may include sort:

```text
Sort
  Sort Key: opened_at DESC
```

Sort can be expensive.

Sort cost depends on:

- number of rows
- row width
- memory
- disk spill
- collation
- parallelism

Index can avoid sort if order matches.

Top-N sort can be cheaper than full sort if LIMIT.

But if query sorts millions of rows just to return 50, index/order design may be wrong.

---

## 21. Aggregate Nodes

Aggregation strategies:

```text
Hash Aggregate
Group Aggregate / Sort Aggregate
```

### 21.1 Hash Aggregate

Build hash table by group key.

Good when:

- groups fit memory
- unsorted input
- many rows

Risk:

- memory spill
- bad estimates

### 21.2 Sort/Group Aggregate

Sort by group key, then aggregate sequentially.

Good when:

- input already sorted
- index provides order
- memory constraints
- grouping key order useful

Example:

```sql
GROUP BY tenant_id, status
```

Index:

```sql
(tenant_id, status)
```

may help group aggregate.

---

## 22. Window Function Plans

Window functions often require:

- sort by partition/order
- window aggregation node
- memory
- sometimes multiple sorts for different windows

Query:

```sql
ROW_NUMBER() OVER (
    PARTITION BY case_id
    ORDER BY transitioned_at DESC
)
```

May require sorting by:

```text
case_id, transitioned_at DESC
```

Index:

```sql
(case_id, transitioned_at DESC)
```

can help, depending plan.

Window functions over huge datasets can be expensive.

---

## 23. LIMIT and Early Termination

`LIMIT` can allow early stop if plan produces rows in desired order.

Good:

```sql
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50
```

with index:

```sql
(tenant_id, status, opened_at DESC)
```

Database reads 50 rows and stops.

Bad:

```sql
ORDER BY complex_expression
LIMIT 50
```

without supporting index. Database may compute/sort many rows first.

---

## 24. Row Width Matters

Selecting fewer columns can improve plan.

Bad:

```sql
SELECT *
FROM cases
WHERE ...
```

Wide rows mean:

- more IO
- more memory
- slower sort/hash
- less cache efficiency
- index-only scan less likely
- network overhead

Projection matters.

For list endpoints, select only needed columns.

---

## 25. Filter Pushdown

Optimizer tries to apply filters as early as possible.

Example:

```sql
SELECT *
FROM (
    SELECT *
    FROM cases
) c
WHERE status = 'OPEN';
```

Optimizer may push filter into subquery.

But pushdown can be blocked by:

- materialized CTE
- volatile functions
- outer join semantics
- security barrier views
- set operations
- aggregation/window boundaries
- vendor limitations

If filter is not pushed down, intermediate result may be huge.

---

## 26. Predicate Reordering and Short-Circuit Myth

In Java:

```java
if (cheapCheck() && expensiveCheck()) { ... }
```

order matters.

In SQL:

```sql
WHERE cheap_predicate
  AND expensive_function(column)
```

Do not rely on left-to-right short-circuit.

Optimizer can reorder predicates.

If function must only run for certain rows, structure query carefully, but even then optimizer semantics vary.

Avoid unsafe functions on invalid input. Use proper guards, constraints, or safe expressions.

---

## 27. CTE and Optimization

CTE can be:

- inlined
- materialized
- optimization fence
- reused
- optimized separately

Behavior varies by database/version.

PostgreSQL modern may inline non-recursive CTE unless `MATERIALIZED`.

Example:

```sql
WITH open_cases AS (
    SELECT *
    FROM cases
    WHERE status = 'OPEN'
)
SELECT *
FROM open_cases
WHERE tenant_id = :tenant_id;
```

If materialized, database may first compute all open cases, then filter tenant.

If inlined, it can filter both status and tenant together.

For performance-critical CTE, inspect plan.

---

## 28. Views and Plans

Views are saved query definitions.

Optimizer often expands view into query.

But views can hide complexity:

- nested views
- aggregation inside view
- security barrier
- function calls
- joins not needed by outer query
- predicate pushdown limitations

Do not assume view is free abstraction.

Read execution plan of query using view.

---

## 29. Parameterized Queries and Plan Caching

Java apps use prepared statements.

Plan behavior varies:

- custom plan per execution
- generic cached plan
- parameter sniffing
- bind peeking
- adaptive cursor sharing
- recompile thresholds

Problem:

```sql
WHERE status = ?
```

For `ESCALATED`, index good.  
For `OPEN`, scan good.

One generic plan may be mediocre.

Symptoms:

- query fast for some parameters, slow for others
- first execution affects later plan
- production skew not reproduced in dev
- occasional latency spikes

Solutions:

- specialized queries for hot cases
- better composite/partial indexes
- updated statistics
- extended stats
- hints/recompile/vendor-specific controls
- avoid over-generic optional filter query

---

## 30. Optional Filter Query Plans

Naive search:

```sql
WHERE tenant_id = :tenant_id
  AND (:status IS NULL OR status = :status)
  AND (:priority IS NULL OR priority = :priority)
  AND (:officer_id IS NULL OR assigned_officer_id = :officer_id)
```

This can be hard to optimize.

Problems:

- OR predicates
- parameter-dependent selectivity
- generic plan
- multiple possible index paths
- poor cardinality estimation

Better for high-value search:

- build dynamic SQL with only active predicates
- use query builder safely
- create specialized query paths
- use search/read model
- accept scan for low-volume admin search

---

## 31. Plan Instability

Plan can change due to:

- data growth
- statistics update
- new index
- dropped index
- parameter values
- database upgrade
- configuration changes
- vacuum/analyze
- memory settings
- table bloat
- partition count
- changed distribution
- prepared statement behavior

A query can be fast for months then slow after data distribution changes.

This is why observability and plan analysis matter.

---

## 32. Reading EXPLAIN: First Pass

When reading plan, first identify:

```text
1. top-level operation
2. join order
3. scan types
4. estimated vs actual rows
5. expensive nodes
6. sort/hash spills
7. loops count
8. filters applied late
9. index conditions vs filters
10. buffers/IO
```

Do not start by obsessing over cost numbers alone.

Start with shape.

---

## 33. Index Cond vs Filter

PostgreSQL plans distinguish:

```text
Index Cond
Filter
```

Example:

```text
Index Scan using idx_cases_tenant on cases
  Index Cond: (tenant_id = ...)
  Filter: (status = 'OPEN')
```

Meaning:

- index used for tenant_id
- status checked after fetching rows

If many tenant rows and status selective, index may be insufficient.

Better index:

```sql
(tenant_id, status)
```

If status appears in `Index Cond`, index is doing more filtering.

This distinction is crucial.

---

## 34. Rows Removed by Filter

Plan may show:

```text
Rows Removed by Filter: 1000000
```

This means plan read many rows then discarded them.

Possible causes:

- index not selective enough
- predicate not in index cond
- wrong index
- missing composite index
- function/cast prevented condition
- filter applied after join/CTE

High rows removed is not always bad, but often a clue.

---

## 35. Loops Count

Nested loop plans show loops.

Example:

```text
Nested Loop
  -> Index Scan on cases (actual rows=10000 loops=1)
  -> Index Scan on evidences (actual rows=5 loops=10000)
```

Inner scan executes 10,000 times.

If inner lookup cheap, fine.

If inner lookup returns many rows or no index, bad.

Always multiply:

```text
inner actual rows per loop × loops
```

Loops explain many hidden costs.

---

## 36. Buffers: Cache vs Disk

PostgreSQL `BUFFERS` shows:

```text
shared hit
shared read
temp read/write
```

- hit: already in memory
- read: read from disk/page cache
- temp: sort/hash spilled to temp disk

High temp read/write:

- sort spill
- hash spill
- insufficient work memory
- too many rows
- poor plan

High shared read:

- IO heavy
- cold cache
- large scan

Buffers often more reliable than timing alone in noisy environments.

---

## 37. Timing Caveats

`EXPLAIN ANALYZE` timing can vary because:

- cache warm/cold
- concurrent load
- IO variability
- JIT compilation
- network not included fully
- result rendering
- locks
- background tasks
- parameter value
- plan cache

Run multiple times carefully.

Use production-like data.

Do not optimize based on one local tiny dataset.

---

## 38. Common Bad Plan Patterns

### 38.1 Sequential Scan on Huge Table for Selective Query

Likely missing/unused index or bad stats.

### 38.2 Nested Loop with Huge Outer Rows

Cardinality underestimated or wrong join strategy.

### 38.3 Sort Huge Rows then LIMIT

Need index order or reduce rows first.

### 38.4 Hash Join Spilling

Hash input too large or memory insufficient.

### 38.5 Aggregate Spilling

Too many groups/memory too small.

### 38.6 Filter Applied After Join Explosion

Predicate should be pushed earlier or query decomposed.

### 38.7 CTE Materialized Too Early

Large intermediate result.

### 38.8 Bitmap Heap Scan with Many Rechecks

Index helps partially but predicate/index maybe not ideal.

### 38.9 Index Scan Fetching Most Table

Index not selective; scan may be better.

### 38.10 Plan Estimated 1 Row, Actual Millions

Stats/correlation problem.

---

## 39. Example: Open Case Queue Plan Thinking

Query:

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

Good index:

```sql
CREATE INDEX idx_cases_queue
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number, priority);
```

Expected good plan:

```text
Index Only Scan using idx_cases_queue
  Index Cond: tenant_id = ? AND status = 'OPEN'
Limit
```

Bad plan:

```text
Seq Scan on cases
  Filter: tenant_id = ? AND status = 'OPEN'
Sort
Limit
```

Why bad?

- reads all cases
- filters
- sorts many rows
- returns 50

Fix:

- create matching composite index
- update stats
- ensure query predicate matches index
- avoid function/cast
- verify plan with realistic tenant distribution

---

## 40. Example: Evidence Count per Case

Query:

```sql
SELECT
    c.id,
    COUNT(e.id) AS evidence_count
FROM cases c
LEFT JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.tenant_id = :tenant_id
  AND c.status = 'OPEN'
GROUP BY c.id;
```

If open cases are many and evidences large, plan choices:

- nested loop from open cases into evidences index
- hash join between open cases and evidences
- aggregate evidences first then join

Better query for list page:

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

This reduces join/aggregate to 50 cases.

Plan thinking:

- page first by index
- join evidence for only page cases
- group small set

---

## 41. Example: Optional Filter Anti-Pattern

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND (:status IS NULL OR status = :status)
ORDER BY opened_at DESC
LIMIT 50;
```

If `:status` usually non-null, dynamic SQL better:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND status = :status
ORDER BY opened_at DESC
LIMIT 50;
```

Index:

```sql
(tenant_id, status, opened_at DESC)
```

If status null, different query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
ORDER BY opened_at DESC
LIMIT 50;
```

Index:

```sql
(tenant_id, opened_at DESC)
```

Two query shapes, two possible indexes.

---

## 42. Extended Statistics

Columns can be correlated.

Example:

```text
tenant_id and jurisdiction_code
status and closed_at
country and city
case_type and SLA rule
```

Optimizer may assume independence:

```text
selectivity(A AND B) = selectivity(A) × selectivity(B)
```

If not true, estimate wrong.

Some databases support extended/multicolumn statistics.

PostgreSQL:

```sql
CREATE STATISTICS stats_cases_tenant_status
ON tenant_id, status
FROM cases;
```

Then analyze.

Use when estimates are poor due to correlation.

---

## 43. Hints: Use Carefully

Some databases support optimizer hints.

Examples:

- force index
- join method
- join order
- recompile
- parallelism

Hints can solve immediate issue but create long-term fragility.

Prefer:

1. correct query
2. correct indexes
3. fresh stats
4. better schema
5. query rewrite
6. database configuration
7. hints only if necessary and documented

Hints can become wrong as data changes.

---

## 44. Query Rewrite Before Index

Sometimes query shape is the problem.

Bad:

```sql
SELECT DISTINCT c.*
FROM cases c
JOIN case_evidences e ON e.case_id = c.id
WHERE e.evidence_type = 'DOCUMENT';
```

Better:

```sql
SELECT c.*
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
      AND e.evidence_type = 'DOCUMENT'
);
```

This changes plan possibilities and grain.

Index:

```sql
ON case_evidences (case_id, evidence_type)
```

or:

```sql
ON case_evidences (evidence_type, case_id)
```

depending access pattern.

Do not add index to compensate for wrong semantics.

---

## 45. Plan Analysis Workflow

When query is slow:

1. capture exact SQL and parameters
2. identify expected row count
3. run explain analyze safely
4. compare estimated vs actual rows
5. inspect scan types
6. inspect join order/algorithms
7. inspect sorts/hash/aggregates
8. inspect loops
9. inspect buffers/temp IO
10. check indexes
11. check stats freshness
12. check data skew
13. rewrite query if semantics/grain wrong
14. add/adjust index if justified
15. test with realistic data
16. deploy and monitor

Never start with random index creation.

---

## 46. Plan Analysis Checklist

```text
[ ] What is query purpose and expected output grain?
[ ] What parameters were used?
[ ] Is data volume realistic?
[ ] Which table is scanned first?
[ ] Are filters applied early?
[ ] Are expected indexes used?
[ ] Are conditions in Index Cond or Filter?
[ ] Are estimated rows close to actual rows?
[ ] Is join order sensible?
[ ] Is join algorithm appropriate?
[ ] Are there large sorts?
[ ] Are there hash/sort spills?
[ ] Are loops unexpectedly high?
[ ] Are many rows removed by filter?
[ ] Is LIMIT helping early?
[ ] Are selected columns too wide?
[ ] Is CTE/view blocking optimization?
[ ] Are statistics stale/missing?
```

---

## 47. Mini Case Study: Why Index Not Used

Index:

```sql
CREATE INDEX idx_cases_opened_at
ON cases (opened_at);
```

Query:

```sql
SELECT *
FROM cases
WHERE DATE(opened_at) = DATE '2026-01-01';
```

Plan:

```text
Seq Scan
Filter: date(opened_at) = ...
```

Reason:

- function on column
- B-tree on raw opened_at cannot seek date(opened_at)

Fix query:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

Now index can support range.

---

## 48. Mini Case Study: Join Explosion Plan

Query:

```sql
SELECT
    c.id,
    COUNT(e.id),
    COUNT(a.id)
FROM cases c
LEFT JOIN case_evidences e ON e.case_id = c.id
LEFT JOIN case_assignments a ON a.case_id = c.id
GROUP BY c.id;
```

If one case has 100 evidences and 20 assignments, joined rows 2000.

Plan may show huge row counts after joins.

Fix:

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
    COALESCE(ec.evidence_count, 0),
    COALESCE(ac.assignment_count, 0)
FROM cases c
LEFT JOIN evidence_counts ec ON ec.case_id = c.id
LEFT JOIN assignment_counts ac ON ac.case_id = c.id;
```

Plan improves because child tables are reduced before joining to parent.

---

## 49. Mini Case Study: Bad Nested Loop

Plan shape:

```text
Nested Loop
  -> Seq Scan on cases (actual rows=500000)
  -> Index Scan on case_evidences (loops=500000)
```

Even if inner index scan is fast, 500k loops may be expensive.

Possible fixes:

- reduce outer rows with better filter/index
- join order change
- hash join may be better
- pre-aggregate child
- update stats
- rewrite EXISTS
- add composite index
- avoid selecting too many parent rows

Do not judge nested loop by name only. Judge row counts and loops.

---

## 50. Mini Case Study: Sort Spill

Plan:

```text
Sort
  Sort Method: external merge Disk: 2048MB
```

Meaning sort spilled to disk.

Causes:

- too many rows sorted
- row width large
- memory too low
- missing index order
- order by after huge join
- limit not applied early

Fix options:

- index supporting ORDER BY
- filter earlier
- paginate parent first
- reduce selected columns
- increase work memory for session/query, carefully
- materialized pre-sorted projection
- change query/report strategy

---

## 51. Java Application Considerations

Java backend performance issues often hide SQL plan issues.

Watch for:

- ORM generated SQL different from expected
- `SELECT *` via entity loading
- fetch join collection causing row explosion
- pagination applied to joined rows
- parameter types wrong
- optional filter OR pattern
- query plan differs for prepared statements
- N+1 replaced by giant bad join
- transaction holds locks while query slow
- connection pool saturation due to slow queries
- timeout masks database root cause

Log actual SQL and bind parameters for slow queries.

---

## 52. Observability for Plans

In production, collect:

- slow query logs
- query fingerprints
- execution time percentiles
- rows returned
- rows scanned if available
- buffer/IO metrics
- lock wait time
- temp file usage
- plan hash if available
- index usage stats
- table/index bloat
- statistics freshness
- connection pool wait time

Query performance is system behavior, not isolated SQL text.

---

## 53. Plan Regression Testing

For critical queries:

- keep representative data volume in staging
- capture baseline plan
- test migration/index changes
- test DB version upgrades
- test changed statistics
- test parameter skew
- test worst-case tenant
- test cold/warm cache if possible

Do not rely only on unit tests with 10 rows.

---

## 54. Common Myths

### Myth 1 — Index Always Makes Query Faster

False. Index can be ignored or slower.

### Myth 2 — Sequential Scan Means Bad

False. Sometimes optimal.

### Myth 3 — Cost Equals Milliseconds

False. Cost is optimizer internal unit.

### Myth 4 — WHERE Order Controls Execution

False. Optimizer can reorder.

### Myth 5 — CTE Always Improves Performance

False. It may help readability but hurt or help plan.

### Myth 6 — JOIN Order in SQL Text Always Matters

For inner joins, optimizer may reorder.

### Myth 7 — Smaller Result Means Faster Query

Not always. Query may scan/sort huge data to return few rows.

### Myth 8 — Query Fast in Dev Means Fast in Prod

Dev data distribution is usually unrealistic.

---

## 55. Practical Exercises

### Exercise 1 — Predict Plan

Query:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Table:

```text
10 million rows, 9 million OPEN
```

Index:

```sql
CREATE INDEX idx_cases_status ON cases(status);
```

Question:

```text
Will database use index?
```

Answer:

Maybe not. Sequential scan may be cheaper because predicate is low-selectivity.

### Exercise 2 — Fix Date Predicate

Bad:

```sql
WHERE DATE(opened_at) = :date
```

Better:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

### Exercise 3 — Read Plan Red Flag

Plan:

```text
Index Scan using idx_cases_tenant
  Index Cond: tenant_id = ?
  Filter: status = 'OPEN'
  Rows Removed by Filter: 900000
```

Likely fix:

```sql
CREATE INDEX idx_cases_tenant_status
ON cases (tenant_id, status);
```

or more complete:

```sql
ON cases (tenant_id, status, opened_at DESC)
```

depending query.

### Exercise 4 — Nested Loop Loops

Plan:

```text
Nested Loop
  outer actual rows=200000
  inner loops=200000
```

Question:

```text
What do you inspect?
```

Answer:

- inner index exists?
- actual rows per loop?
- outer estimate vs actual?
- join selectivity?
- can outer be reduced?
- hash join better?
- stats stale?

### Exercise 5 — Sort Spill

Plan shows temp disk sort.

Possible fixes:

- add index for order
- filter earlier
- reduce row width
- parent page first
- increase memory carefully
- precompute/read model

---

## 56. Koneksi ke Part Berikutnya

Part ini membahas query optimizer dan execution plans.

Part berikutnya, `part-018`, akan membahas performance engineering end-to-end:

- slow query investigation
- root cause workflow
- index tuning
- query rewrite
- statistics fixes
- pagination optimization
- N+1 vs join explosion
- database and application observability
- performance incident playbook
- how to move from symptom to fix

Execution plan adalah diagnostic lens; performance engineering adalah proses sistematis menggunakan lens itu.

---

## 57. Ringkasan Bagian Ini

Hal penting dari part 017:

1. SQL declarative; execution plan physical.
2. Optimizer memilih plan berdasarkan estimated cost.
3. Cost bergantung pada statistics dan cardinality estimates.
4. Estimated rows vs actual rows adalah signal utama.
5. Sequential scan tidak selalu buruk.
6. Index scan tidak selalu baik.
7. Index only scan butuh index covering dan visibility support.
8. Bitmap scan berguna untuk many-row indexed access.
9. Optimizer bisa ignore index karena selectivity, casts, wrong order, stale stats, or query shape.
10. Nested loop baik untuk small outer + indexed inner, buruk jika outer besar.
11. Hash join baik untuk large equality joins, tetapi bisa spill.
12. Merge join baik untuk sorted inputs.
13. Sort, aggregate, and window nodes can dominate cost.
14. LIMIT hanya membantu jika plan bisa produce rows early.
15. Row width matters.
16. CTE/views can help or block optimization depending database.
17. Parameterized query plans can behave differently under skew.
18. Plan instability is normal as data changes.
19. Reading plans requires checking scan types, join order, estimates vs actuals, loops, filters, and buffers.
20. Plan analysis must use realistic data and actual parameters.

Kalimat inti:

> Execution plan adalah cerita database tentang bagaimana ia memahami query-mu; performance tuning dimulai ketika kamu membandingkan cerita itu dengan realitas data.

---

## 58. Referensi

1. PostgreSQL Documentation — Using EXPLAIN.  
   https://www.postgresql.org/docs/current/using-explain.html

2. PostgreSQL Documentation — Planner Statistics.  
   https://www.postgresql.org/docs/current/planner-stats.html

3. PostgreSQL Documentation — Explicit JOIN Syntax and Planner.  
   https://www.postgresql.org/docs/current/explicit-joins.html

4. PostgreSQL Documentation — Runtime Configuration: Query Planning.  
   https://www.postgresql.org/docs/current/runtime-config-query.html

5. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

6. MySQL 8.4 Reference Manual — EXPLAIN Output Format.  
   https://dev.mysql.com/doc/refman/8.4/en/explain-output.html

7. MySQL 8.4 Reference Manual — Optimizing Queries with EXPLAIN.  
   https://dev.mysql.com/doc/refman/8.4/en/using-explain.html

8. SQL Server Documentation — Display and Analyze Execution Plans.  
   https://learn.microsoft.com/en-us/sql/relational-databases/performance/display-and-save-execution-plans

9. SQL Server Documentation — Query Processing Architecture Guide.  
   https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide

10. Oracle Database SQL Tuning Guide — Execution Plans.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/tgsql/

---

## 59. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-018.md` — Performance Engineering: From Slow Query to Root Cause


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-016.md">⬅️ Part 16 — Advanced Indexing: Partial, Functional, Full-Text, JSON, Spatial, and Specialized Indexes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-018.md">Part 18 — Performance Engineering: From Slow Query to Root Cause ➡️</a>
</div>

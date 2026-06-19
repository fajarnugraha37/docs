# learn-sql-mastery-for-java-engineers-part-015.md

# Part 15 — Index Fundamentals: B-Trees, Selectivity, Cardinality, and Access Paths

> Seri: SQL Mastery for Java Engineers  
> Bagian: 015 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-014.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-016.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas modelling tingkat lanjut: state machine, workflow, SLA, audit, dan regulatory case data.

Sekarang kita masuk ke blok performance engineering.

Topik pertama: **index fundamentals**.

Index sering dipahami terlalu dangkal:

```text
Tambahkan index supaya query cepat.
```

Pemahaman seperti itu berbahaya.

Index bukan magic speed button.

Index adalah struktur data tambahan yang membantu database menemukan row, mengurutkan row, mengecek uniqueness, dan mengurangi jumlah data yang perlu dibaca.

Tetapi index juga:

- memperlambat write
- memakai storage
- perlu maintenance
- bisa tidak dipakai optimizer
- bisa memperburuk query jika salah
- bisa membuat migration lambat
- bisa menambah lock/IO
- bisa membuat planner salah jika statistics buruk
- tidak selalu membantu low-selectivity predicate
- harus didesain berdasarkan workload, bukan feeling

Bagian ini bertujuan membangun mental model:

- apa itu access path
- table scan vs index scan
- B-tree index
- selectivity
- cardinality
- composite index
- left-prefix principle
- equality/range/order interaction
- covering/index-only scan
- clustered vs non-clustered intuition
- write overhead
- common index mistakes
- cara berpikir dari query ke index

Kalimat inti:

> Index yang baik bukan “ada di kolom yang difilter”; index yang baik selaras dengan predicate, ordering, cardinality, dan workload query nyata.

---

## 1. Access Path: Cara Database Menemukan Data

Ketika menjalankan query:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50;
```

Database harus menjawab:

```text
Bagaimana cara menemukan row yang cocok?
```

Pilihan access path:

- scan seluruh table
- scan index
- seek ke range dalam index
- bitmap index scan
- use multiple indexes and combine
- use partition pruning
- use materialized view/read model
- use sequential scan because cheaper

Index adalah salah satu access path.

Optimizer memilih access path berdasarkan:

- query predicate
- available indexes
- table size
- statistics
- estimated selectivity
- ordering
- limit
- cost model
- memory
- correlation
- visibility
- parallelism
- vendor-specific behavior

---

## 2. Table Scan

Table scan berarti database membaca table secara luas.

Contoh:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Jika tidak ada index, database mungkin membaca semua row dan mengecek predicate satu per satu.

Table scan tidak selalu buruk.

Table scan bisa baik jika:

- table kecil
- predicate sangat tidak selective
- query butuh sebagian besar row
- index lookup akan random IO terlalu banyak
- data sudah cached
- analytical query
- sequential read lebih murah

Misalnya 90% cases status `OPEN`, index pada `status` saja mungkin tidak membantu.

Jika hampir semua row lolos, membaca index lalu table row satu per satu bisa lebih mahal daripada scan table.

---

## 3. Index Scan / Index Seek

Index membantu menemukan row berdasarkan key order.

Contoh index:

```sql
CREATE INDEX idx_cases_tenant_status
ON cases (tenant_id, status);
```

Query:

```sql
SELECT
    id,
    case_number
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN';
```

Database dapat mencari bagian index dengan:

```text
tenant_id = X
status = OPEN
```

lalu menemukan row references.

### 3.1 Seek vs Scan Terminology

Vendor berbeda:

- PostgreSQL sering bicara index scan, index only scan, bitmap index scan.
- SQL Server membedakan seek vs scan.
- MySQL bicara ref/range/index access.

Konsep penting:

```text
Seek/range lookup: langsung ke bagian index yang relevan.
Scan index: membaca banyak/seluruh index.
```

Index ada bukan berarti database melakukan efficient seek.

---

## 4. B-Tree Mental Model

B-tree adalah index default paling umum untuk relational database.

B-tree menyimpan key dalam urutan sorted.

Bayangkan index:

```sql
CREATE INDEX idx_cases_opened_at
ON cases (opened_at);
```

Index menyimpan:

```text
opened_at -> pointer/reference to row
```

Dalam urutan:

```text
2026-01-01 -> row A
2026-01-02 -> row B
2026-01-03 -> row C
...
```

B-tree bagus untuk:

- equality
- range
- ordering
- prefix matching tertentu
- min/max
- uniqueness
- merge join support

Contoh:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

B-tree bisa mencari start lalu scan sampai end.

---

## 5. B-Tree untuk Equality

Index:

```sql
CREATE INDEX idx_cases_case_number
ON cases (case_number_normalized);
```

Query:

```sql
SELECT *
FROM cases
WHERE case_number_normalized = :case_number;
```

B-tree dapat melakukan lookup ke key yang sama.

Jika unique:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_number
ON cases (tenant_id, case_number_normalized);
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number
```

Expected:

```text
0 or 1 row
```

Optimizer tahu uniqueness dan bisa estimate lebih baik.

---

## 6. B-Tree untuk Range

Index:

```sql
CREATE INDEX idx_cases_opened_at
ON cases (opened_at);
```

Query:

```sql
SELECT *
FROM cases
WHERE opened_at >= :start
  AND opened_at < :end;
```

B-tree bisa:

1. seek ke first key >= start
2. scan forward sampai key >= end
3. stop

Ini jauh lebih baik daripada membaca seluruh table jika range selective.

Range queries:

```sql
>
>=
<
<=
BETWEEN
```

Biasanya cocok dengan B-tree.

---

## 7. B-Tree untuk ORDER BY

Index:

```sql
CREATE INDEX idx_cases_opened_at_desc
ON cases (opened_at DESC);
```

Query:

```sql
SELECT *
FROM cases
ORDER BY opened_at DESC
LIMIT 50;
```

Database bisa membaca index order dan berhenti setelah 50 row.

Tanpa index, database mungkin harus:

1. read many/all rows
2. sort
3. take top 50

Index yang cocok dengan ordering sangat powerful untuk top-N query.

---

## 8. Index dan LIMIT

Query:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index ideal:

```sql
CREATE INDEX idx_cases_tenant_status_opened_id
ON cases (tenant_id, status, opened_at DESC, id DESC);
```

Database dapat:

1. seek to `(tenant_id, 'OPEN')`
2. read in `opened_at DESC, id DESC` order
3. stop after 50 rows

This is much better than:

- find all open cases
- sort all open cases
- take 50

Pattern:

```text
equality filters -> ordering columns -> tie-breaker
```

---

## 9. Selectivity

Selectivity adalah persentase row yang lolos predicate.

Predicate highly selective:

```sql
WHERE id = :id
```

Mungkin 1 dari 10 juta.

Predicate low selective:

```sql
WHERE status = 'OPEN'
```

Jika 80% row open.

### 9.1 Why Selectivity Matters

Index sangat berguna jika query membaca sebagian kecil data.

Jika predicate memilih hampir semua row, table scan bisa lebih murah.

Example table:

```text
10,000,000 cases
8,000,000 OPEN
2,000,000 CLOSED
```

Index:

```sql
CREATE INDEX idx_cases_status
ON cases (status);
```

Query:

```sql
WHERE status = 'OPEN'
```

Index mungkin tidak banyak membantu.

Query:

```sql
WHERE status = 'ESCALATED'
```

Jika hanya 10,000 rows, index bisa sangat membantu.

---

## 10. Cardinality

Cardinality adalah jumlah distinct values.

High cardinality:

```text
id
email
case_number
external_event_id
```

Low cardinality:

```text
status
boolean flag
priority
country, sometimes
```

High-cardinality columns often make good index candidates for equality lookup.

Low-cardinality columns alone often less useful, but can be useful in composite indexes.

Example:

```sql
CREATE INDEX idx_cases_status
ON cases (status);
```

Maybe weak.

Better:

```sql
CREATE INDEX idx_cases_tenant_status_opened
ON cases (tenant_id, status, opened_at DESC);
```

because combined selectivity and ordering matter.

---

## 11. Composite Index

Composite index has multiple columns.

```sql
CREATE INDEX idx_cases_tenant_status_opened
ON cases (tenant_id, status, opened_at DESC);
```

The index is sorted by:

```text
tenant_id
then status
then opened_at DESC
```

It is like a phone book sorted by:

```text
country, city, last_name
```

You can efficiently find:

```text
country = X
country = X and city = Y
country = X and city = Y and last_name range
```

But not necessarily:

```text
city = Y
```

without country.

---

## 12. Left-Prefix Principle

For B-tree composite index:

```sql
ON cases (tenant_id, status, opened_at DESC)
```

Useful for:

```sql
WHERE tenant_id = :tenant_id
```

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
```

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC
```

Less useful for:

```sql
WHERE status = 'OPEN'
```

because `tenant_id` leading column missing.

This is left-prefix principle.

Some databases have skip scan or other optimizations, but do not rely on them as baseline.

---

## 13. Equality Before Range

Composite index:

```sql
CREATE INDEX idx_cases_tenant_status_opened
ON cases (tenant_id, status, opened_at);
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
  AND opened_at >= :start
  AND opened_at < :end
```

Great pattern:

```text
tenant_id equality
status equality
opened_at range
```

B-tree can narrow to tenant/status then scan opened_at range.

### 13.1 Range Stops Further Ordered Use

Index:

```sql
ON cases (tenant_id, opened_at, status)
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND opened_at >= :start
  AND opened_at < :end
  AND status = 'OPEN'
```

After range on `opened_at`, using `status` as index seek condition may be limited depending DB.

Heuristic:

```text
Put equality columns first, then range/order columns.
```

Not universal, but strong default.

---

## 14. Composite Index for Filtering + Sorting

Query:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_status_opened_id
ON cases (tenant_id, status, opened_at DESC, id DESC);
```

Why:

- tenant_id equality
- status equality
- opened_at/id ordering
- limit can stop early

If index only:

```sql
ON cases (tenant_id, status)
```

Database still may need sort.

If index only:

```sql
ON cases (opened_at DESC)
```

Database may scan recent cases across all tenants/status and filter, which may be bad.

---

## 15. Covering Index and Index-Only Scan

A covering index includes all columns needed by query.

Query:

```sql
SELECT
    id,
    case_number,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_open_queue_covering
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number);
```

`INCLUDE` syntax is vendor-specific, supported by PostgreSQL/SQL Server style features.

If database can answer query from index alone, it may use index-only scan.

Benefits:

- fewer table reads
- smaller IO
- faster top-N/list query

Caveats:

- visibility checks may still require heap access in some databases
- index becomes larger
- write overhead increases
- not portable syntax
- too many included columns bloats index

---

## 16. Index Key Columns vs Included Columns

Composite key columns define sorted order.

Included columns are stored only for covering, not sorting/searching.

Example:

```sql
CREATE INDEX idx_cases_tenant_status_opened_id
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number, priority);
```

Key columns:

```text
tenant_id, status, opened_at, id
```

Included columns:

```text
case_number, priority
```

Can help query return list item without table lookup.

But included columns do not help `WHERE priority = ...` as search key in same way.

Vendor details vary.

---

## 17. Clustered vs Non-Clustered Intuition

Some databases physically organize table by clustered index.

SQL Server clustered index determines physical row order.

InnoDB primary key is clustered.

PostgreSQL heap table is not clustered by index by default, though `CLUSTER` command exists but not continuously maintained.

Why this matters:

- primary key choice affects storage/locality in clustered engines
- random UUID primary key can fragment clustered index in some engines
- secondary indexes may store primary key reference
- range scans may be affected by physical locality
- write amplification differs

As Java engineer, know vendor behavior before assuming index cost.

---

## 18. Primary Key Index

Primary key automatically creates/enforces unique access path in most databases.

```sql
id UUID PRIMARY KEY
```

Query:

```sql
WHERE id = :id
```

usually uses primary key index.

Composite primary key:

```sql
PRIMARY KEY (tenant_id, id)
```

Query should include both:

```sql
WHERE tenant_id = :tenant_id
  AND id = :id
```

This also encodes tenant boundary.

---

## 19. Foreign Key Indexes

Foreign key does not always create index on child column automatically.

Child table:

```sql
case_evidences(case_id REFERENCES cases(id))
```

Common query:

```sql
SELECT *
FROM case_evidences
WHERE case_id = :case_id;
```

Index:

```sql
CREATE INDEX idx_case_evidences_case_id
ON case_evidences (case_id);
```

Why child FK index matters:

- join performance
- delete/update parent checks
- cascade performance
- lock contention reduction
- child lookup

For every FK, ask:

```text
Will we query children by parent?
Will parent deletes/updates happen?
Is FK validation expensive?
```

Often child FK index is needed.

---

## 20. Unique Index for Business Key

Business key:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Supports query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number;
```

It also enforces invariant.

This is ideal: one structure supports correctness and lookup.

---

## 21. Partial Index Preview

Partial index indexes subset of rows.

PostgreSQL-style:

```sql
CREATE INDEX idx_cases_open_queue
ON cases (tenant_id, opened_at DESC, id DESC)
WHERE status = 'OPEN';
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Partial index can be smaller and faster if `OPEN` is common query subset.

This is advanced indexing and will be deeper in part 016.

For now, understand:

```text
Sometimes the best index is not over all rows.
```

---

## 22. Expression Index Preview

Expression index indexes computed value.

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

Supports:

```sql
WHERE lower(email) = lower(:email)
```

But expression indexes are vendor-specific and require query expression to match sufficiently.

Alternative:

```sql
email_normalized TEXT NOT NULL UNIQUE
```

Expression indexes are powerful but can hide domain logic in database expression.

Part 016 covers deeper.

---

## 23. Index and Sargability

From part 005:

Sargable predicate can use index effectively.

Good:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

Bad:

```sql
WHERE DATE(opened_at) = :date
```

Good:

```sql
WHERE case_number_normalized = :normalized
```

Bad unless expression index:

```sql
WHERE lower(case_number) = lower(:input)
```

Index design and predicate design are inseparable.

---

## 24. LIKE and Index

B-tree may help prefix search:

```sql
WHERE case_number LIKE 'CASE-2026-%'
```

because prefix preserves ordering.

B-tree usually cannot help leading wildcard:

```sql
WHERE case_number LIKE '%2026%'
```

Alternatives:

- full-text index
- trigram index
- search engine
- normalized token table
- prefix table
- specialized index

Do not expect normal B-tree to solve contains search.

---

## 25. Index for ORDER BY vs WHERE

Sometimes index helps ordering more than filtering.

Query:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
ORDER BY opened_at DESC
LIMIT 50;
```

If many rows are open, index on `status` alone may not help much.

Index:

```sql
ON cases (status, opened_at DESC)
```

can help because it gives open cases already sorted.

If query has tenant:

```sql
ON cases (tenant_id, status, opened_at DESC, id DESC)
```

better.

---

## 26. Index for GROUP BY

Index can help grouping if data is ordered by group columns.

Query:

```sql
SELECT
    tenant_id,
    status,
    COUNT(*)
FROM cases
GROUP BY tenant_id, status;
```

Index:

```sql
ON cases (tenant_id, status)
```

may help, depending optimizer and table size.

But analytical aggregation over huge data may still scan large portions.

For repeated dashboards, summary tables/materialized views might be better.

---

## 27. Index for JOIN

Join:

```sql
SELECT *
FROM cases c
JOIN case_evidences e
  ON e.case_id = c.id
WHERE c.id = :case_id;
```

Important indexes:

```sql
cases(id) -- primary key
case_evidences(case_id)
```

For join from parent to child, child FK index is often key.

Join with tenant:

```sql
ON e.tenant_id = c.tenant_id
AND e.case_id = c.id
```

Index:

```sql
ON case_evidences (tenant_id, case_id)
```

Composite FK and composite index align.

---

## 28. Index for EXISTS

Query:

```sql
SELECT *
FROM cases c
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
);
```

Index:

```sql
CREATE INDEX idx_case_evidences_case_id
ON case_evidences (case_id);
```

This allows quick existence check.

For condition:

```sql
WHERE e.case_id = c.id
  AND e.evidence_type = 'DOCUMENT'
```

Index options:

```sql
ON case_evidences (case_id, evidence_type)
```

or:

```sql
ON case_evidences (evidence_type, case_id)
```

Which is better depends query pattern/selectivity.

If correlated by case_id, `(case_id, evidence_type)` often good.

If query starts from evidence_type globally, `(evidence_type, case_id)` may be good.

---

## 29. Index Column Order: Practical Heuristic

For composite B-tree index, rough heuristic:

```text
1. columns constrained by equality and always present
2. columns used by range
3. columns used by ORDER BY
4. tie-breaker/id
5. included columns for covering
```

But more precise:

- equality columns can be in any order for exact lookup, but selectivity and prefix reuse matter
- range column often limits use of later columns for seek
- order by must match index ordering after equality prefix
- query workload determines best order
- write overhead matters

Example query:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND opened_at >= ?
  AND opened_at < ?
ORDER BY opened_at DESC, id DESC
```

Index:

```sql
(tenant_id, status, opened_at DESC, id DESC)
```

---

## 30. Low-Cardinality Columns

Should you index boolean?

```sql
WHERE active = TRUE
```

If 99% active, index on `active` alone is usually poor.

If 1% active, maybe useful.

If combined:

```sql
WHERE tenant_id = :tenant_id
  AND active = TRUE
ORDER BY created_at DESC
LIMIT 50
```

Index:

```sql
ON users (tenant_id, active, created_at DESC)
```

may help.

Or partial index:

```sql
ON users (tenant_id, created_at DESC)
WHERE active = TRUE
```

if active subset is common and meaningful.

---

## 31. Too Many Indexes

Every index has cost.

On INSERT:

```text
insert row into table
insert key into every index
```

On UPDATE:

```text
if indexed column changes, update index entries
```

On DELETE:

```text
remove/mark index entries
```

Costs:

- slower writes
- more WAL/redo
- more storage
- more cache pressure
- slower bulk load
- more vacuum/maintenance
- more migration time
- more optimizer choices to evaluate

Index only what workload justifies.

---

## 32. Redundant Indexes

Example:

```sql
CREATE INDEX idx_cases_tenant
ON cases (tenant_id);

CREATE INDEX idx_cases_tenant_status
ON cases (tenant_id, status);
```

The second index can often support queries filtering only tenant_id because tenant_id is leading column.

So first may be redundant.

But not always:

- smaller index may be faster
- different covering columns
- unique vs non-unique
- different ordering
- different partial predicate
- write/read trade-off

Review index overlap periodically.

---

## 33. Unused Indexes

Production systems accumulate unused indexes.

Reasons:

- old query removed
- query pattern changed
- optimizer never chooses it
- redundant with better index
- created “just in case”
- migration artifact

Unused indexes still cost writes.

Use database stats/tools to detect unused indexes, but be careful:

- stats reset after restart
- rare monthly jobs may need index
- reporting jobs may run infrequently
- index may support constraint
- index may support FK enforcement indirectly

Do not drop blindly.

---

## 34. Index and Statistics

Optimizer needs statistics to estimate row counts.

Stats include:

- row count
- distinct values
- null fraction
- histograms
- most common values
- correlation
- extended stats depending vendor

If stats stale, planner may choose bad index/table scan.

Example:

```sql
WHERE status = 'ESCALATED'
```

If database thinks 50% rows escalated but actually 0.1%, plan may be wrong.

Maintenance:

- ANALYZE / auto analyze
- update statistics
- monitor skew
- extended statistics for correlated columns
- avoid hiding values behind functions/casts

Part 017 will go deeper into optimizer/plans.

---

## 35. Data Skew

Column `status`:

```text
OPEN: 80%
CLOSED: 19%
ESCALATED: 1%
```

Index usefulness depends on value.

Query:

```sql
WHERE status = 'OPEN'
```

may table scan.

Query:

```sql
WHERE status = 'ESCALATED'
```

may index scan.

Same query shape, different parameter value, different ideal plan.

This matters for prepared statements and parameter sniffing in some databases.

---

## 36. Parameterized Queries and Plans

Java apps use prepared statements.

Prepared statements can use:

- generic plan
- custom plan per parameter
- cached plan
- parameter sniffed plan

Vendor-specific behavior.

Problem:

```sql
WHERE status = ?
```

If first execution uses `ESCALATED`, plan may choose index.

If later execution uses `OPEN`, same plan may be bad in some engines.

Or generic plan may be mediocre for all values.

Solutions depend vendor:

- better composite indexes
- query split by common cases
- extended statistics
- recompile hints/vendor features
- avoid over-generic query
- partial indexes
- separate endpoint/query for rare status

Know that parameter values can influence plans.

---

## 37. Index and ORDER Direction

Index:

```sql
ON cases (opened_at DESC, id DESC)
```

Query:

```sql
ORDER BY opened_at DESC, id DESC
```

matches naturally.

Many databases can scan B-tree backward, so ascending index may also support descending order.

But mixed directions can matter:

```sql
ORDER BY opened_at DESC, id ASC
```

Index direction support varies by vendor.

For critical ordered query, test actual plan.

---

## 38. Index and NULLs

Indexes include or handle NULLs depending vendor.

Query:

```sql
WHERE closed_at IS NULL
```

Index on `closed_at` may or may not be useful depending null fraction and vendor.

If “active rows” are `ended_at IS NULL`, partial index can be excellent:

```sql
CREATE INDEX idx_assignments_active
ON case_assignments (case_id)
WHERE ended_at IS NULL;
```

Again, advanced indexes in part 016.

---

## 39. Index and Data Type

Index works on type semantics.

Bad:

```sql
WHERE id::text = :id_text
```

May prevent index on UUID id.

Good:

```sql
WHERE id = :id_uuid
```

Java should bind correct type.

Also avoid storing numeric/date as text because index order becomes lexical.

```text
'100' < '20'
```

as text.

Correct data type is performance feature.

---

## 40. Index and Collation

Text index behavior depends on collation/operator class.

Case-insensitive search:

```sql
WHERE lower(name) = lower(:name)
```

needs expression index or normalized column.

Prefix search with LIKE can depend on collation.

International text sorting/searching is not trivial.

For identifiers, prefer normalized canonical columns.

For natural-language search, use full-text/search engine where appropriate.

---

## 41. Index Design from Query

Given query:

```sql
SELECT
    id,
    case_number,
    priority,
    opened_at
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
  AND priority IN ('HIGH', 'CRITICAL')
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Candidate index:

```sql
CREATE INDEX idx_cases_queue
ON cases (tenant_id, status, priority, opened_at DESC, id DESC);
```

But is this ideal?

Questions:

```text
Is priority highly selective?
Is priority filter always present?
Do we also query all priorities?
Does IN over two values preserve ordering?
Would (tenant_id, status, opened_at DESC, id DESC) be better?
Would partial index WHERE status='OPEN' be better?
How many tenants?
How many open cases per tenant?
```

Index design is workload-specific.

---

## 42. Multiple Query Patterns

If one endpoint supports many optional filters:

```text
tenant
status
priority
assigned_officer
opened date range
keyword
```

One index cannot optimize all combinations.

Options:

- choose indexes for most common/high-value queries
- split endpoints/use cases
- dynamic SQL
- search/read model
- full-text index
- composite indexes for key paths
- partial indexes for hot subsets
- accept scan for rare admin query
- add observability and slow query analysis

Do not create every possible index combination.

---

## 43. Index for Multi-Tenant Workloads

Shared-schema multi-tenant:

```sql
tenant_id UUID NOT NULL
```

Most queries include:

```sql
WHERE tenant_id = :tenant_id
```

Common indexes should often start with `tenant_id`.

Example:

```sql
ON cases (tenant_id, status, opened_at DESC)
```

Business unique:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

FK child lookup:

```sql
ON case_evidences (tenant_id, case_id)
```

If some operational queries are cross-tenant, they may need different indexes.

Do not blindly put tenant_id first for every analytical/global query, but for tenant-scoped OLTP, it is often right.

---

## 44. Index and Pagination

Offset pagination:

```sql
ORDER BY opened_at DESC, id DESC
LIMIT 50 OFFSET 100000;
```

Even with index, database may traverse 100,050 entries to return 50.

Keyset pagination:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
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
ON cases (tenant_id, status, opened_at DESC, id DESC)
```

supports this well.

Index design and pagination design go together.

---

## 45. Index and Write Hotspots

Some indexes create hotspots.

Examples:

- monotonically increasing timestamp in B-tree
- sequential primary key in clustered index
- same tenant/status hot queue
- boolean active partial index with heavy churn
- update frequently indexed column

Hotspots can cause:

- page contention
- lock contention
- write amplification
- bloat
- cache pressure

Mitigations:

- batching
- partitioning
- fillfactor/vendor tuning
- different key strategy
- avoiding unnecessary indexes on hot columns
- separating append-only events from mutable state
- queue design changes

This is advanced but important.

---

## 46. Index and Mutable Columns

Indexing frequently updated columns has cost.

Example:

```sql
status
priority
assigned_officer_id
updated_at
```

If status changes frequently, every status index update costs.

Still, if status query is critical, index is justified.

Trade-off:

```text
read benefit vs write cost
```

Measure.

---

## 47. Index and Small Tables

Index may be unnecessary on very small tables.

Example:

```sql
case_statuses
priorities
jurisdictions
```

If table has 5–100 rows, table scan is trivial.

Primary key index still exists for constraints.

Do not over-index small reference tables unless needed for constraints or joins at scale.

---

## 48. Common Index Mistakes

### Mistake 1 — Index Every Foreign Key Without Thinking

Often good, but still consider workload. Most child FK lookups need it; not all do.

### Mistake 2 — Single-Column Indexes Everywhere

```sql
idx_status
idx_tenant
idx_opened_at
```

But query needs composite:

```sql
tenant_id + status + opened_at
```

### Mistake 3 — Wrong Column Order

```sql
ON cases (opened_at, tenant_id, status)
```

for query:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY opened_at
```

Often less useful than:

```sql
(tenant_id, status, opened_at)
```

### Mistake 4 — Index Low-Cardinality Column Alone

```sql
ON cases(status)
```

may be weak.

### Mistake 5 — Function on Column

```sql
WHERE lower(email) = lower(:email)
```

without expression index/normalized column.

### Mistake 6 — Forget ORDER BY/LIMIT

Index supports filter but not sort, causing expensive sort.

### Mistake 7 — Create Redundant Indexes

Index overlap increases write cost.

### Mistake 8 — Ignore Write Overhead

Read gets faster, writes get slower.

### Mistake 9 — Assume Index Will Be Used

Optimizer may choose not to use it.

### Mistake 10 — Not Checking Execution Plan

Index design without plan inspection is guessing.

---

## 49. Mini Case Study: Case Lookup by Number

Query:

```sql
SELECT
    id,
    case_number,
    status
FROM cases
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number_normalized;
```

Invariant:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Index:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_number
ON cases (tenant_id, case_number_normalized);
```

Expected result:

```text
0 or 1 row
```

This index serves:

- correctness
- lookup performance
- optimizer cardinality estimate

---

## 50. Mini Case Study: Open Case Queue

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

Index:

```sql
CREATE INDEX idx_cases_open_queue
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number, priority);
```

Benefits:

- filter by tenant/status
- ordered scan by opened_at/id
- limit early
- possible covering

Trade-offs:

- larger index because included columns
- update cost if status/opened_at/id impossible but priority maybe included
- write overhead for each insert
- if many different queue sorts, need more design

---

## 51. Mini Case Study: Evidence per Case

Query:

```sql
SELECT
    id,
    evidence_type,
    received_at
FROM case_evidences
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
ORDER BY received_at DESC, id DESC;
```

Index:

```sql
CREATE INDEX idx_case_evidences_case_received
ON case_evidences (tenant_id, case_id, received_at DESC, id DESC);
```

Supports:

- child lookup by case
- ordered evidence timeline
- pagination per case

If query often filters evidence_type:

```sql
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND evidence_type = :type
ORDER BY received_at DESC
```

Candidate:

```sql
ON case_evidences (tenant_id, case_id, evidence_type, received_at DESC, id DESC)
```

But only add if workload justifies.

---

## 52. Mini Case Study: Active Primary Assignment

Query:

```sql
SELECT
    case_id,
    officer_id
FROM case_assignments
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

This supports:

- invariant: one active primary
- lookup: current primary assignment

This is ideal index/constraint synergy.

If need list all active assignments by officer:

```sql
SELECT *
FROM case_assignments
WHERE tenant_id = :tenant_id
  AND officer_id = :officer_id
  AND ended_at IS NULL;
```

Need different index:

```sql
CREATE INDEX idx_case_assignments_active_by_officer
ON case_assignments (tenant_id, officer_id)
WHERE ended_at IS NULL;
```

Different query, different index.

---

## 53. Mini Case Study: SLA Due Queue

Query:

```sql
SELECT
    id,
    case_id,
    due_at
FROM case_slas
WHERE tenant_id = :tenant_id
  AND status = 'ACTIVE'
  AND due_at < :now
ORDER BY due_at ASC, id ASC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_case_slas_due_queue
ON case_slas (tenant_id, status, due_at ASC, id ASC);
```

Pattern:

```text
tenant equality
status equality
due_at range + order
id tie-breaker
```

If only active rows queried often:

```sql
CREATE INDEX idx_case_slas_active_due_queue
ON case_slas (tenant_id, due_at ASC, id ASC)
WHERE status = 'ACTIVE';
```

Advanced partial index.

---

## 54. Practical Index Design Workflow

For a query:

1. Write query correctly first.
2. Identify expected output grain.
3. Identify filters:
   - equality
   - range
   - optional
   - tenant/security
4. Identify ordering.
5. Identify limit/pagination.
6. Identify join keys.
7. Estimate selectivity.
8. Check existing indexes.
9. Propose minimal index.
10. Run `EXPLAIN`.
11. Test with realistic data volume/skew.
12. Measure read improvement and write cost.
13. Add migration safely.
14. Monitor usage.

Do not start from “which columns should have indexes?”

Start from workload.

---

## 55. EXPLAIN Preview

You must eventually read execution plans.

Example PostgreSQL:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
```

This can show:

- index scan
- sequential scan
- estimated rows
- actual rows
- sort
- hash join
- nested loop
- buffer hits/reads
- timing

Part 017 and 018 will cover plans deeply.

For now, know:

> If you did not inspect the plan, you do not know whether the index helped.

---

## 56. Index Review Checklist

```text
[ ] What query/workload justifies this index?
[ ] What predicate does it support?
[ ] What ORDER BY does it support?
[ ] Does it support LIMIT/top-N?
[ ] Is column order correct?
[ ] Are equality columns before range/order columns?
[ ] Is tenant_id needed as leading column?
[ ] Is this index redundant with existing index?
[ ] Is selectivity good enough?
[ ] Does it cover query columns?
[ ] Are included columns worth index bloat?
[ ] How often are indexed columns updated?
[ ] What is write overhead?
[ ] Is this for constraint, lookup, sort, join, or coverage?
[ ] Has EXPLAIN confirmed usage?
[ ] Has it been tested with realistic data?
```

---

## 57. Index Design Checklist by Query Pattern

### 57.1 Lookup by Business Key

```sql
WHERE tenant_id = ?
  AND case_number_normalized = ?
```

Index:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

### 57.2 Queue/List Query

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY opened_at DESC, id DESC
LIMIT ?
```

Index:

```sql
(tenant_id, status, opened_at DESC, id DESC)
```

### 57.3 Child Timeline

```sql
WHERE tenant_id = ?
  AND case_id = ?
ORDER BY received_at DESC, id DESC
```

Index:

```sql
(tenant_id, case_id, received_at DESC, id DESC)
```

### 57.4 Existence Check

```sql
WHERE EXISTS (
  SELECT 1 FROM child WHERE child.parent_id = parent.id
)
```

Index:

```sql
child(parent_id)
```

### 57.5 Active Rows

```sql
WHERE ended_at IS NULL
```

Consider partial index:

```sql
WHERE ended_at IS NULL
```

### 57.6 Date Range Report

```sql
WHERE opened_at >= ?
  AND opened_at < ?
```

Index:

```sql
(opened_at)
```

or composite with tenant:

```sql
(tenant_id, opened_at)
```

depending scope.

---

## 58. Practical Exercises

### Exercise 1 — Design Index for Case Search

Query:

```sql
SELECT *
FROM cases
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :case_number;
```

Answer:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_number
ON cases (tenant_id, case_number_normalized);
```

### Exercise 2 — Design Index for Queue

Query:

```sql
SELECT id, case_number
FROM cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Answer:

```sql
CREATE INDEX idx_cases_tenant_status_opened_id
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number);
```

If vendor lacks `INCLUDE`, omit or add as key only if justified.

### Exercise 3 — Identify Bad Index

Index:

```sql
CREATE INDEX idx_cases_opened_status_tenant
ON cases (opened_at, status, tenant_id);
```

Query:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY opened_at DESC
```

Problem:

- range/order column first
- tenant/status equality not leading
- less useful for tenant-scoped queue

Better:

```sql
(tenant_id, status, opened_at DESC)
```

### Exercise 4 — Avoid Function on Column

Bad query:

```sql
WHERE DATE(opened_at) = DATE '2026-01-01'
```

Better:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

Index:

```sql
ON cases (opened_at)
```

### Exercise 5 — Detect Redundant Index

Indexes:

```sql
idx_cases_tenant ON cases (tenant_id)
idx_cases_tenant_status ON cases (tenant_id, status)
```

Question:

```text
Is idx_cases_tenant redundant?
```

Answer:

Maybe. `(tenant_id, status)` can support tenant-only prefix queries, but smaller tenant-only index may still be useful. Check workload and usage stats.

---

## 59. Koneksi ke Part Berikutnya

Bagian ini membahas index fundamentals dengan fokus B-tree dan access paths.

Part berikutnya, `part-016`, akan membahas advanced indexing:

- partial indexes
- functional/expression indexes
- full-text indexes
- JSON indexes
- spatial indexes
- BRIN
- GIN/GiST concepts
- filtered indexes
- covering strategies
- specialized indexes
- when to use search engine instead of SQL B-tree

Sekarang kita punya fondasi untuk memahami index khusus dengan lebih benar.

---

## 60. Ringkasan Bagian Ini

Hal penting dari part 015:

1. Index adalah access path, bukan magic speed button.
2. Optimizer memilih antara table scan, index scan, bitmap scan, dan access path lain.
3. Table scan tidak selalu buruk.
4. B-tree cocok untuk equality, range, ordering, and uniqueness.
5. Selectivity menentukan seberapa berguna index.
6. Cardinality tinggi sering lebih baik untuk equality lookup.
7. Low-cardinality column alone often weak, but useful in composite/partial indexes.
8. Composite index order matters.
9. Left-prefix principle penting untuk B-tree.
10. Equality columns biasanya ditempatkan sebelum range/order columns.
11. Index dapat membantu `ORDER BY ... LIMIT` secara sangat signifikan.
12. Covering/index-only scan bisa mengurangi table access.
13. Foreign key child columns sering butuh index.
14. Unique index bisa menjadi correctness dan performance tool sekaligus.
15. Index design harus mengikuti workload nyata.
16. Too many indexes slow down writes.
17. Redundant/unused indexes tetap punya cost.
18. Statistics dan data skew memengaruhi planner.
19. Parameterized query plans dapat dipengaruhi distribusi data.
20. Index design harus divalidasi dengan execution plan.

Kalimat inti:

> Index terbaik adalah struktur yang menjawab query nyata dengan membaca data sesedikit mungkin, dalam urutan yang dibutuhkan, tanpa membebani write path lebih dari manfaat read-nya.

---

## 61. Referensi

1. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

2. PostgreSQL Documentation — B-Tree Indexes.  
   https://www.postgresql.org/docs/current/btree.html

3. PostgreSQL Documentation — Multicolumn Indexes.  
   https://www.postgresql.org/docs/current/indexes-multicolumn.html

4. PostgreSQL Documentation — Index-Only Scans and Covering Indexes.  
   https://www.postgresql.org/docs/current/indexes-index-only-scans.html

5. PostgreSQL Documentation — Statistics Used by the Planner.  
   https://www.postgresql.org/docs/current/planner-stats.html

6. MySQL 8.4 Reference Manual — Optimization and Indexes.  
   https://dev.mysql.com/doc/refman/8.4/en/optimization-indexes.html

7. MySQL 8.4 Reference Manual — Multiple-Column Indexes.  
   https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html

8. SQL Server Documentation — Index Architecture and Design Guide.  
   https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-index-design-guide

9. Oracle Database Concepts — Indexes and Index-Organized Tables.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/cncpt/indexes-and-index-organized-tables.html

---

## 62. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-016.md` — Advanced Indexing: Partial, Functional, Full-Text, JSON, Spatial, and Specialized Indexes

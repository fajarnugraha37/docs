# learn-sql-mastery-for-java-engineers-part-016.md

# Part 16 — Advanced Indexing: Partial, Functional, Full-Text, JSON, Spatial, and Specialized Indexes

> Seri: SQL Mastery for Java Engineers  
> Bagian: 016 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-015.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-017.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas fundamental index:

- access path
- B-tree
- selectivity
- cardinality
- composite index
- left-prefix principle
- filtering + ordering
- covering index
- write overhead

Bagian ini membahas **advanced indexing**.

Advanced indexing bukan berarti “gunakan index yang lebih fancy”.

Advanced indexing berarti memilih struktur index yang sesuai dengan bentuk data dan query.

Query tidak semuanya berbentuk:

```sql
WHERE col = ?
ORDER BY created_at
```

Ada query seperti:

```sql
WHERE status = 'OPEN' AND ended_at IS NULL
```

```sql
WHERE lower(email) = lower(:email)
```

```sql
WHERE payload ->> 'eventType' = 'CASE_ESCALATED'
```

```sql
WHERE to_tsvector('english', body) @@ plainto_tsquery('english', :query)
```

```sql
WHERE location within radius
```

```sql
WHERE created_at between huge time ranges on append-only table
```

```sql
WHERE tags contains 'urgent'
```

B-tree biasa tidak selalu cocok.

Bagian ini bertujuan membuat kamu memahami:

- partial/filtered indexes
- expression/function indexes
- covering strategy lanjutan
- unique partial indexes
- full-text indexes
- trigram/substring search
- JSON indexing
- array indexing
- spatial/geospatial indexes
- BRIN untuk table besar append-only
- GIN/GiST/SP-GiST intuition
- vendor-specific capabilities
- trade-off index khusus
- kapan database index cukup
- kapan perlu search engine/read model

Kalimat inti:

> Advanced index yang baik selalu dimulai dari pertanyaan: bentuk predicate dan access pattern apa yang sebenarnya ingin dipercepat?

---

## 1. Index Khusus Selalu Vendor-Specific

SQL standard tidak mendefinisikan semua jenis index secara detail.

B-tree umum ada di semua database, tetapi fitur berikut sangat vendor-specific:

- partial index
- filtered index
- expression index
- function-based index
- included columns
- GIN
- GiST
- BRIN
- trigram
- full-text
- JSON path index
- spatial index
- invisible index
- online/concurrent index creation

Sebagai Java engineer, jangan hanya menulis “add index” di migration tanpa memahami target database.

Dalam seri ini, contoh banyak memakai PostgreSQL karena fiturnya ekspresif, tapi konsepnya tetap bisa dipetakan ke MySQL, SQL Server, Oracle, dan lainnya.

---

## 2. Partial / Filtered Index

Partial index mengindeks hanya subset row.

PostgreSQL:

```sql
CREATE INDEX idx_cases_open_queue
ON cases (tenant_id, opened_at DESC, id DESC)
WHERE status = 'OPEN';
```

SQL Server memiliki filtered index dengan konsep mirip.

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

Index hanya berisi row `status = 'OPEN'`.

Manfaat:

- index lebih kecil
- lebih sedikit write overhead untuk row di luar subset
- lebih cepat untuk hot subset
- bisa enforce conditional uniqueness
- statistics lebih fokus pada subset

---

## 3. Kapan Partial Index Cocok

Partial index cocok jika:

- query sering mengakses subset tertentu
- subset jauh lebih kecil dari table
- predicate subset stabil
- predicate selalu muncul di query
- subset punya business meaning
- row di luar subset tidak butuh index itu
- ingin conditional uniqueness

Contoh subset:

```text
active rows
open cases
unpublished outbox events
unprocessed jobs
deleted_at IS NULL
ended_at IS NULL
status = 'PENDING'
published_at IS NULL
```

---

## 4. Partial Index untuk Active Rows

Table assignment:

```sql
case_assignments(
    case_id,
    officer_id,
    assignment_role,
    assigned_at,
    ended_at
)
```

Query current active assignments:

```sql
SELECT *
FROM case_assignments
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND ended_at IS NULL;
```

Partial index:

```sql
CREATE INDEX idx_case_assignments_active_by_case
ON case_assignments (tenant_id, case_id)
WHERE ended_at IS NULL;
```

Jika sebagian besar assignment historis sudah ended, index ini jauh lebih kecil daripada full index.

---

## 5. Partial Unique Index untuk Business Invariant

Requirement:

> Satu case hanya boleh punya satu active primary assignment.

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Ini menjaga invariant:

```text
For each tenant-case, at most one active PRIMARY assignment.
```

Ini bukan hanya performance index. Ini correctness constraint.

Application check saja race-prone.

---

## 6. Partial Index Query Predicate Harus Match

Partial index:

```sql
CREATE INDEX idx_cases_open_queue
ON cases (tenant_id, opened_at DESC)
WHERE status = 'OPEN';
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
```

bisa memakai index.

Query:

```sql
WHERE tenant_id = :tenant_id
  AND status IN ('OPEN', 'UNDER_REVIEW')
```

mungkin tidak bisa memakai partial index tersebut untuk seluruh predicate.

Query:

```sql
WHERE tenant_id = :tenant_id
  AND status <> 'CLOSED'
```

walau secara domain mungkin mencakup `OPEN`, tidak berarti optimizer bisa membuktikan cocok.

Rule:

> Partial index efektif jika query predicate secara jelas mengimplikasikan predicate index.

---

## 7. Partial Index dan Parameter

Partial index:

```sql
WHERE status = 'OPEN'
```

Query parameterized:

```sql
WHERE status = :status
```

Jika prepared statement generic, optimizer mungkin tidak tahu parameter selalu `OPEN`.

Dalam beberapa database, partial index mungkin tidak dipakai untuk generic parameterized plan.

Solusi:

- query khusus untuk open queue dengan literal/status tetap
- dynamic SQL yang tetap bind parameter lain
- partial index untuk predicate yang literal di query
- cek execution plan dengan prepared statements realistic
- gunakan vendor-specific plan controls jika perlu

Ini penting untuk Java apps.

---

## 8. Partial Index untuk Outbox

Outbox table:

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    publish_attempts INTEGER NOT NULL DEFAULT 0
);
```

Publisher query:

```sql
SELECT *
FROM outbox_events
WHERE published_at IS NULL
ORDER BY created_at ASC, id ASC
LIMIT 100;
```

Partial index:

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at ASC, id ASC)
WHERE published_at IS NULL;
```

This is ideal:

- published rows no longer in index
- publisher scans only pending events
- index small if backlog small
- supports ordering

---

## 9. Partial Index untuk Soft Delete

Soft delete:

```sql
deleted_at TIMESTAMPTZ
```

Common query:

```sql
WHERE deleted_at IS NULL
```

Partial index:

```sql
CREATE INDEX idx_case_notes_active_by_case
ON case_notes (tenant_id, case_id, created_at DESC)
WHERE deleted_at IS NULL;
```

Partial unique:

```sql
CREATE UNIQUE INDEX uq_active_case_number
ON cases (tenant_id, case_number_normalized)
WHERE deleted_at IS NULL;
```

This supports:

- active row lookup
- active uniqueness
- smaller indexes if many deleted/historical rows

---

## 10. Expression / Functional Index

Expression index indexes result of expression.

PostgreSQL:

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

Query:

```sql
SELECT *
FROM users
WHERE lower(email) = lower(:email);
```

This can use expression index.

Oracle has function-based indexes. SQL Server can use computed columns with indexes. MySQL supports functional indexes in modern versions with syntax/details.

---

## 11. Expression Index vs Normalized Column

Case-insensitive lookup:

Option A: expression index

```sql
CREATE UNIQUE INDEX uq_users_lower_email
ON users (lower(email));
```

Option B: normalized column

```sql
email TEXT NOT NULL,
email_normalized TEXT NOT NULL UNIQUE
```

Query:

```sql
WHERE email_normalized = :email_normalized
```

### 11.1 Expression Index Pros

- no extra column
- centralizes expression
- no app dual-write
- good for simple transformations

### 11.2 Expression Index Cons

- vendor-specific
- query expression must match
- expression hidden in index definition
- harder to expose semantics
- complex expression can be costly on write
- collation/locale pitfalls

### 11.3 Normalized Column Pros

- portable
- explicit domain field
- easy to query
- easy to inspect
- can be constrained
- Java can model normalization

### 11.4 Normalized Column Cons

- redundancy
- app/DB must keep in sync
- migration/backfill needed
- possible drift if not generated/constrained

For business identifiers, normalized column is often clearer.

---

## 12. Generated Columns + Index

Generated column stores computed value.

Vendor-specific syntax differs.

Concept:

```sql
email_normalized TEXT GENERATED ALWAYS AS (lower(email)) STORED
```

Then:

```sql
CREATE UNIQUE INDEX uq_users_email_normalized
ON users (email_normalized);
```

Benefits:

- normalized value explicit
- database maintains it
- indexable
- app cannot forget

Trade-offs:

- vendor-specific
- expression limitations
- migration complexity
- storage if stored generated column

---

## 13. Expression Index for Date Buckets

Bad query:

```sql
WHERE date_trunc('day', opened_at) = DATE '2026-01-01'
```

Better for filtering:

```sql
WHERE opened_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
  AND opened_at <  TIMESTAMPTZ '2026-01-02 00:00:00+00'
```

Expression index on date bucket:

```sql
CREATE INDEX idx_cases_opened_day
ON cases ((opened_at::date));
```

Could support reporting, but beware timezone.

If business date depends on timezone:

```sql
opened_at AT TIME ZONE 'Asia/Jakarta'
```

Expression index may be possible, but be careful with time zone rules and immutability requirements.

Often better:

- store business date explicitly
- use calendar dimension
- filter by instant range
- group by local bucket for reporting

---

## 14. Covering Index Strategy

Covering index avoids table lookup when index contains needed columns.

PostgreSQL/SQL Server style:

```sql
CREATE INDEX idx_cases_queue_cover
ON cases (tenant_id, status, opened_at DESC, id DESC)
INCLUDE (case_number, priority);
```

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

If database can do index-only scan, this can be fast.

### 14.1 Covering Trade-Off

Covering index gets larger.

Large indexes:

- slower writes
- more storage
- more cache pressure
- more maintenance
- longer backup/restore
- more bloat risk

Use covering for high-value hot queries, not every query.

---

## 15. Full-Text Search

B-tree is not enough for natural-language search.

Bad:

```sql
WHERE note_text LIKE '%fraud suspicious transaction%'
```

Problems:

- leading wildcard
- no tokenization
- no stemming
- no ranking
- poor language handling
- slow on large text
- bad relevance

Full-text search indexes tokens and supports text query semantics.

PostgreSQL example:

```sql
CREATE INDEX idx_case_notes_fts
ON case_notes
USING GIN (to_tsvector('english', note_text));
```

Query:

```sql
SELECT
    id,
    note_text
FROM case_notes
WHERE to_tsvector('english', note_text)
      @@ plainto_tsquery('english', :query);
```

---

## 16. Full-Text Concepts

Full-text search involves:

```text
tokenization
normalization
stemming
stop words
lexemes
ranking
language configuration
phrase search
boolean operators
```

Example text:

```text
"Investigating suspicious transactions"
```

Tokens/lexemes may become:

```text
investig
suspici
transact
```

Query:

```text
"suspicious transaction"
```

can match stemmed terms.

This is different from `LIKE`.

---

## 17. Full-Text Search in Product Design

Use database full-text when:

- search is moderate complexity
- data already in DB
- transactional freshness matters
- simple relevance enough
- operations wants fewer systems
- volume manageable

Use search engine when:

- complex relevance/ranking
- fuzzy matching
- typo tolerance
- autocomplete
- highlighting
- faceting
- multi-language
- massive scale
- search analytics
- independent search scaling
- cross-entity search

Examples:

- PostgreSQL FTS may be enough for internal case note search.
- Elasticsearch/OpenSearch may be better for public search or complex discovery.

---

## 18. Trigram / Substring Search

Search for substring:

```sql
WHERE case_number ILIKE '%2026-ABC%'
```

Full-text may not help because identifiers are not natural language.

PostgreSQL `pg_trgm` extension can index trigram similarity/LIKE patterns.

Concept:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cases_case_number_trgm
ON cases
USING GIN (case_number gin_trgm_ops);
```

Query:

```sql
WHERE case_number ILIKE '%ABC%'
```

This can use trigram index.

Use cases:

- substring identifier search
- fuzzy name matching
- partial code search
- typo-ish search

Trade-offs:

- index can be large
- write overhead
- vendor-specific
- ranking semantics limited compared to search engine

---

## 19. JSON Indexing

JSON is useful for flexible data, but querying JSON needs index strategy.

PostgreSQL JSONB:

```sql
payload JSONB NOT NULL
```

Query:

```sql
WHERE payload ->> 'eventType' = 'CASE_ESCALATED'
```

Options:

### 19.1 Expression B-tree Index

```sql
CREATE INDEX idx_events_payload_event_type
ON integration_events ((payload ->> 'eventType'));
```

Supports equality on one JSON key.

### 19.2 GIN Index on JSONB

```sql
CREATE INDEX idx_events_payload_gin
ON integration_events
USING GIN (payload);
```

Supports containment queries:

```sql
WHERE payload @> '{"eventType": "CASE_ESCALATED"}'
```

### 19.3 JSON Path Indexing

Vendor-specific options exist.

---

## 20. JSON Index Design Rule

If JSON key is important enough to:

- query frequently
- join on
- group by
- constrain
- index
- expose in API
- use in business logic

then ask:

```text
Should this be a real column?
```

Example:

```sql
payload ->> 'eventType'
```

If every query filters event type:

```sql
event_type TEXT NOT NULL,
payload JSONB NOT NULL
```

Then:

```sql
CREATE INDEX idx_events_event_type_created
ON integration_events (event_type, created_at DESC);
```

JSON should not hide core facts.

---

## 21. Array Indexing

Some databases support array columns.

PostgreSQL example:

```sql
tags TEXT[] NOT NULL
```

Query:

```sql
WHERE tags @> ARRAY['urgent']
```

GIN index:

```sql
CREATE INDEX idx_cases_tags_gin
ON cases
USING GIN (tags);
```

Caveat:

Arrays can be okay for simple tags, but relationship table may be better if tags need:

- FK to tag table
- metadata
- created_by
- created_at
- uniqueness per tag
- authorization
- reporting
- lifecycle

Relational alternative:

```sql
case_tags(case_id, tag_code)
```

with index:

```sql
ON case_tags (tag_code, case_id)
```

---

## 22. Spatial / Geospatial Indexes

Spatial queries:

```text
find cases near location
find offices within region
find incidents inside polygon
```

Naive latitude/longitude columns:

```sql
latitude NUMERIC
longitude NUMERIC
```

B-tree indexes on lat/lon can help bounding box but not rich spatial operations.

Spatial index types:

- GiST
- SP-GiST
- R-tree-like
- database-specific spatial index

PostGIS example:

```sql
CREATE INDEX idx_incidents_location_gist
ON incidents
USING GIST (location);
```

Query:

```sql
WHERE ST_DWithin(location, :point, :radius_meters)
```

Spatial indexing is specialized. Use database spatial extension or GIS engine.

---

## 23. BRIN Index

BRIN stands for Block Range Index in PostgreSQL.

BRIN stores summary per block range, not every row.

Useful for very large tables where physical order correlates with column value.

Example append-only events table:

```sql
case_activity_events(
    id,
    occurred_at,
    ...
)
```

Rows inserted roughly in occurred_at order.

BRIN:

```sql
CREATE INDEX idx_activity_events_occurred_brin
ON case_activity_events
USING BRIN (occurred_at);
```

Benefits:

- tiny index
- cheap to maintain
- good for large append-only time-range scans

Trade-offs:

- less precise than B-tree
- may scan extra blocks
- relies on physical correlation
- not ideal for highly selective point lookup

Use BRIN for huge time-series/log-like tables.

---

## 24. GIN, GiST, SP-GiST: Intuition

PostgreSQL index access methods:

### 24.1 GIN

Good for composite/containment style data:

- full-text
- JSONB containment
- arrays
- trigram

Think:

```text
inverted index: value/token -> rows containing it
```

### 24.2 GiST

Generalized search tree.

Good for:

- geometric/spatial
- ranges
- nearest-neighbor
- exclusion constraints

Think:

```text
tree for complex comparison/overlap/distance
```

### 24.3 SP-GiST

Space-partitioned GiST.

Good for some partitioned search spaces:

- certain spatial data
- prefix/radix-like structures
- specialized cases

You do not need to master internals immediately, but you must know index type matches operator.

---

## 25. Operator Classes

Advanced indexes often depend on operator class.

Example PostgreSQL trigram:

```sql
USING GIN (case_number gin_trgm_ops)
```

B-tree text pattern ops:

```sql
CREATE INDEX idx_cases_case_number_pattern
ON cases (case_number text_pattern_ops);
```

Operator class tells database which operators the index supports.

Important idea:

> An index does not support every possible operation on a column. It supports specific operators according to index type/operator class.

This is why an index may exist but not be usable for your predicate.

---

## 26. Full-Text + Structured Filter

Search usually combines text and filters.

Query:

```sql
SELECT
    id,
    note_text
FROM case_notes
WHERE tenant_id = :tenant_id
  AND deleted_at IS NULL
  AND to_tsvector('english', note_text)
      @@ plainto_tsquery('english', :query)
ORDER BY created_at DESC
LIMIT 50;
```

Index options:

- GIN on tsvector
- B-tree/partial index for tenant/deleted/order
- generated/stored tsvector with GIN
- separate search document table
- search engine

Potential indexes:

```sql
CREATE INDEX idx_case_notes_fts_active
ON case_notes
USING GIN (to_tsvector('english', note_text))
WHERE deleted_at IS NULL;
```

But tenant filtering/order may still require work.

Full-text query design often needs measurement.

---

## 27. Composite Strategy with Specialized Indexes

Can one index support everything?

Usually not.

For query:

```sql
WHERE tenant_id = ?
  AND deleted_at IS NULL
  AND text matches query
ORDER BY created_at DESC
LIMIT 50
```

You may need:

1. FTS index for text match
2. partial B-tree for active notes timeline
3. query planner chooses best path
4. maybe search read model

If result of text match is selective, FTS index wins.

If text query broad, ordering/tenant filtering matter.

This is where EXPLAIN is mandatory.

---

## 28. Unique Expression Index

Case-insensitive unique email:

```sql
CREATE UNIQUE INDEX uq_users_lower_email
ON users (lower(email));
```

This prevents:

```text
A@Example.com
a@example.com
```

from coexisting.

But beware:

- locale/collation
- Unicode normalization
- trim whitespace
- plus addressing if domain-specific
- Gmail-specific rules not universal
- expression immutability/vendor requirements

For serious identity fields, define normalization policy explicitly.

---

## 29. Partial Unique for Soft-Deleted Business Key

```sql
CREATE UNIQUE INDEX uq_cases_active_case_number
ON cases (tenant_id, case_number_normalized)
WHERE deleted_at IS NULL;
```

Allows:

```text
same case number if old row is soft-deleted
```

But ask:

```text
Should reusing case number after delete be legal?
Will audit confusion occur?
Do external references still point to old case?
Can deleted case be restored?
What happens if restore conflicts?
```

Index can enforce policy, but policy must be right.

---

## 30. Indexing Computed Sort Keys

Sometimes sorting uses computed priority.

Example:

```sql
ORDER BY
    CASE priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW' THEN 4
    END,
    opened_at DESC
```

Options:

- reference table with priority rank
- generated column priority_rank
- expression index
- read model

Better design:

```sql
case_priorities(
    code,
    sort_rank
)
```

or store:

```sql
priority_rank INTEGER NOT NULL
```

with constraint/foreign key strategy.

Expression index may help but can hide business ordering logic.

---

## 31. Advanced Indexes and Constraints

Some advanced indexes are constraints.

Examples:

- unique partial index for conditional uniqueness
- exclusion constraint for no overlapping ranges
- unique expression index for normalized uniqueness

These are not only performance.

They enforce domain truth.

Design review must ask:

```text
Is this index required for correctness?
If dropped, can invalid data enter?
```

If yes, treat it as invariant, not optional performance object.

---

## 32. Online / Concurrent Index Creation

Large table index creation can be disruptive.

PostgreSQL:

```sql
CREATE INDEX CONCURRENTLY idx_name ON table (...);
```

SQL Server/Oracle/MySQL have their own online index options/limitations.

Consider:

- locks
- write blocking
- long-running transactions
- disk usage
- replication lag
- failure cleanup
- migration tool transaction behavior
- rollback strategy

In PostgreSQL, `CREATE INDEX CONCURRENTLY` cannot run inside normal transaction block.

Migration tools may need special configuration.

---

## 33. Dropping Indexes Safely

Dropping index can break performance or constraints.

Before dropping:

```text
Is it enforcing uniqueness?
Is it backing a constraint?
Is it used by rare jobs?
Are usage stats reliable?
Are there overlapping indexes?
Can we test in staging with production-like data?
Can we monitor after drop?
Is rollback quick?
```

PostgreSQL:

```sql
DROP INDEX CONCURRENTLY idx_name;
```

if supported/appropriate.

Never drop constraint-backed index casually.

---

## 34. Invisible / Hypothetical Indexes

Some databases support invisible indexes or hypothetical indexes.

Use cases:

- test optimizer behavior without affecting app
- hide index from optimizer before dropping
- estimate benefit
- experiment safely

Examples:

- MySQL invisible indexes
- Oracle invisible indexes
- PostgreSQL extensions like hypopg for hypothetical indexes

Advanced operational topic, but useful in mature teams.

---

## 35. Index Maintenance

Indexes need maintenance.

Problems:

- bloat
- fragmentation
- stale statistics
- poor clustering/correlation
- unused indexes
- invalid indexes after failed concurrent build
- long build times
- replication impact

Maintenance tools depend vendor:

- VACUUM/ANALYZE
- REINDEX
- index rebuild/reorganize
- update statistics
- fillfactor
- concurrent rebuild
- partition rotation

Indexing is not one-time design.

---

## 36. Partitioning and Indexes

Partitioned tables complicate indexes.

Examples:

```text
case_activity_events partitioned by month
audit_events partitioned by occurred_at
```

Indexes may be:

- local per partition
- global if vendor supports
- created on parent and inherited
- require maintenance per partition

Query must include partition key for pruning:

```sql
WHERE occurred_at >= :start
  AND occurred_at < :end
```

Index on partition key plus local filters often works well.

Partitioning is in part 029, but indexing decisions must be partition-aware.

---

## 37. When Not to Use Advanced Index

Avoid advanced index if:

- query is rare and table small
- normal B-tree is enough
- predicate is unstable
- feature is too vendor-specific for portability requirement
- write overhead too high
- index would be huge
- query should be served by read model/search engine
- data should be normalized instead of indexed in JSON
- expression hides business logic
- team cannot operate/maintain feature

Advanced index should solve real workload/invariant.

---

## 38. When to Use Search Engine Instead

Use dedicated search engine when requirements include:

- fuzzy search
- typo tolerance
- language-specific relevance
- custom ranking
- highlighting
- autocomplete
- faceted navigation
- cross-entity indexing
- large-scale text search
- search analytics
- relevance tuning by product team
- synonyms/stemming control
- near-real-time ingestion acceptable

Database full-text is often enough for internal/admin search. Search engine is often better for product-grade search.

---

## 39. When to Use Read Model Instead

Use read model when query combines:

- many joins
- aggregates
- text search
- authorization
- computed status
- SLA state
- latest events
- counts
- sorting by derived priority
- pagination

Example:

```sql
case_work_queue_read_model(
    tenant_id,
    case_id,
    case_number,
    status,
    priority_rank,
    primary_officer_name,
    evidence_count,
    sla_due_at,
    last_activity_at
)
```

Then index read model directly:

```sql
CREATE INDEX idx_case_work_queue
ON case_work_queue_read_model (
    tenant_id,
    status,
    priority_rank,
    sla_due_at,
    case_id
);
```

Sometimes the best “index” is a projection with its own schema.

---

## 40. Advanced Index Design Workflow

For advanced index:

1. Identify exact query/operator.
2. Identify result cardinality.
3. Identify data distribution.
4. Check if B-tree can solve it.
5. Check if data should be normalized instead.
6. Choose specialized index type.
7. Confirm operator class supports predicate.
8. Consider partial predicate.
9. Consider covering columns.
10. Estimate write/storage cost.
11. Build safely in staging.
12. Run realistic `EXPLAIN ANALYZE`.
13. Test parameterized query behavior.
14. Deploy with safe migration.
15. Monitor usage and performance.

---

## 41. Mini Case Study: Active Assignment

Requirement:

> Fast lookup current primary assignment and enforce at most one.

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Query:

```sql
SELECT
    officer_id
FROM case_assignments
WHERE tenant_id = :tenant_id
  AND case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

This index is both:

- constraint
- access path

It is smaller than full index on all assignments.

---

## 42. Mini Case Study: Outbox Publisher

Requirement:

> Fetch oldest unpublished events.

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at ASC, id ASC)
WHERE published_at IS NULL;
```

Query:

```sql
SELECT *
FROM outbox_events
WHERE published_at IS NULL
ORDER BY created_at ASC, id ASC
LIMIT 100;
```

If publisher marks rows as published:

```sql
UPDATE outbox_events
SET published_at = now()
WHERE id = :id;
```

Rows leave partial index after update.

Trade-off:

- update touches partial index
- excellent for small pending backlog
- if backlog huge, still may need partitioning/archiving

---

## 43. Mini Case Study: Case-Insensitive Case Number

Option normalized column:

```sql
case_number TEXT NOT NULL,
case_number_normalized TEXT NOT NULL,
UNIQUE (tenant_id, case_number_normalized)
```

Query:

```sql
WHERE tenant_id = :tenant_id
  AND case_number_normalized = :normalized
```

Option expression unique index:

```sql
CREATE UNIQUE INDEX uq_cases_lower_case_number
ON cases (tenant_id, lower(case_number));
```

Recommendation:

For business identifiers, normalized column is often clearer because normalization is part of domain.

---

## 44. Mini Case Study: JSON Event Payload

Table:

```sql
integration_events(
    id,
    source_system,
    event_type,
    received_at,
    payload JSONB
)
```

If `event_type` is queried often, make it column.

Index:

```sql
CREATE INDEX idx_integration_events_type_received
ON integration_events (source_system, event_type, received_at DESC);
```

Do not rely on:

```sql
payload ->> 'eventType'
```

for core routing if it is central to system.

Use JSON index for occasional flexible payload queries:

```sql
CREATE INDEX idx_integration_events_payload_gin
ON integration_events
USING GIN (payload);
```

---

## 45. Mini Case Study: Case Notes Search

Requirement:

> Search notes by text within tenant, active notes only.

PostgreSQL-style:

```sql
CREATE INDEX idx_case_notes_active_fts
ON case_notes
USING GIN (to_tsvector('english', note_text))
WHERE deleted_at IS NULL;
```

Query:

```sql
SELECT
    id,
    case_id,
    note_text,
    created_at
FROM case_notes
WHERE tenant_id = :tenant_id
  AND deleted_at IS NULL
  AND to_tsvector('english', note_text)
      @@ plainto_tsquery('english', :query)
ORDER BY created_at DESC
LIMIT 50;
```

May also need:

```sql
CREATE INDEX idx_case_notes_active_tenant_created
ON case_notes (tenant_id, created_at DESC)
WHERE deleted_at IS NULL;
```

Measure which plan is used.

If product needs relevance/highlighting/fuzzy, use search engine.

---

## 46. Mini Case Study: Audit Events at Scale

Audit table:

```sql
audit_events(
    id,
    tenant_id,
    entity_type,
    entity_id,
    actor_id,
    action,
    occurred_at,
    metadata
)
```

Queries:

1. audit trail for entity
2. actions by actor
3. time range export
4. metadata search

Indexes:

```sql
CREATE INDEX idx_audit_entity_time
ON audit_events (tenant_id, entity_type, entity_id, occurred_at DESC, id DESC);
```

```sql
CREATE INDEX idx_audit_actor_time
ON audit_events (tenant_id, actor_id, occurred_at DESC, id DESC);
```

For large append-only time range:

```sql
CREATE INDEX idx_audit_occurred_brin
ON audit_events
USING BRIN (occurred_at);
```

For metadata occasional search:

```sql
CREATE INDEX idx_audit_metadata_gin
ON audit_events
USING GIN (metadata);
```

But each index adds write overhead. Audit tables are write-heavy. Choose carefully.

---

## 47. Mini Case Study: Geospatial Office Lookup

Requirement:

> Find nearest office within radius.

Use spatial type/index, not two independent B-tree indexes.

PostGIS-style:

```sql
CREATE INDEX idx_offices_location_gist
ON offices
USING GIST (location);
```

Query:

```sql
SELECT *
FROM offices
WHERE ST_DWithin(location, :point, :radius_meters)
ORDER BY ST_Distance(location, :point)
LIMIT 10;
```

This is specialized. A relational B-tree index on latitude/longitude is not enough for robust geospatial search.

---

## 48. Common Advanced Index Mistakes

### Mistake 1 — JSON Indexing Core Facts

If you always filter `payload.eventType`, make `event_type` a column.

### Mistake 2 — Partial Index Predicate Not Matching Query

Index exists but planner cannot use it.

### Mistake 3 — Expression Index But Query Expression Differs

```sql
lower(email)
```

index may not support:

```sql
upper(email)
```

### Mistake 4 — Using Full-Text for Identifier Search

Case numbers often need trigram/prefix/normalized search, not FTS.

### Mistake 5 — Using Trigram for Everything

Trigram indexes can be huge and costly.

### Mistake 6 — Covering Index with Too Many Columns

Index becomes almost a duplicate table.

### Mistake 7 — Ignoring Write Cost

Advanced indexes can be expensive on inserts/updates.

### Mistake 8 — Vendor Lock-In Without Decision

Vendor-specific is fine if intentional, not accidental.

### Mistake 9 — No Plan Verification

Specialized index may not be used.

### Mistake 10 — Search Engine Needed But Avoided

Database index cannot solve all product search requirements.

---

## 49. Advanced Index Review Checklist

```text
[ ] What exact query/operator is this index for?
[ ] Is B-tree insufficient?
[ ] Is the data model correct, or are we indexing around bad modelling?
[ ] Is the predicate stable enough for partial index?
[ ] Will parameterized queries use the partial index?
[ ] Does expression index match query expression?
[ ] Is normalized/generated column better?
[ ] Is this index enforcing invariant?
[ ] How large will the index be?
[ ] What is write overhead?
[ ] Is vendor-specific feature acceptable?
[ ] Is migration online/concurrent-safe?
[ ] Has EXPLAIN confirmed usage?
[ ] Is a read model/search engine better?
[ ] How will we monitor usage/bloat?
```

---

## 50. Decision Guide

Use partial/filtered index when:

```text
hot query targets stable subset of rows
```

Use partial unique index when:

```text
conditional uniqueness is a business invariant
```

Use expression/function index when:

```text
query frequently filters by deterministic expression
```

Use normalized/generated column when:

```text
expression represents domain concept or portability matters
```

Use full-text index when:

```text
natural-language text search needed inside DB
```

Use trigram when:

```text
substring/fuzzy-ish identifier/name matching needed
```

Use JSON GIN when:

```text
flexible JSON containment queries are needed
```

Use real columns when:

```text
JSON key is core business fact
```

Use spatial index when:

```text
distance/contains/intersects geospatial queries needed
```

Use BRIN when:

```text
huge append-only table has physically correlated range column
```

Use search engine when:

```text
product-grade search relevance and scale exceed DB FTS
```

Use read model when:

```text
query is a complex operational projection better served denormalized
```

---

## 51. Practical Exercises

### Exercise 1 — Outbox Index

Query:

```sql
SELECT *
FROM outbox_events
WHERE published_at IS NULL
ORDER BY created_at, id
LIMIT 100;
```

Answer:

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at, id)
WHERE published_at IS NULL;
```

### Exercise 2 — Active Assignment Uniqueness

Requirement:

```text
one active primary assignment per case
```

Answer:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### Exercise 3 — Case-Insensitive Email

Option normalized:

```sql
email_normalized TEXT NOT NULL UNIQUE
```

Option expression:

```sql
CREATE UNIQUE INDEX uq_users_lower_email
ON users (lower(email));
```

Discuss trade-offs.

### Exercise 4 — JSON Key

Query:

```sql
WHERE payload ->> 'eventType' = 'CASE_CLOSED'
```

If frequent, redesign:

```sql
event_type TEXT NOT NULL
```

and index:

```sql
CREATE INDEX idx_events_type_created
ON events (event_type, created_at DESC);
```

### Exercise 5 — Search Notes

If requirement is natural-language search:

```sql
USING GIN (to_tsvector('english', note_text))
```

If requirement is substring identifier search:

```sql
USING GIN (identifier gin_trgm_ops)
```

Different problem, different index.

---

## 52. Koneksi ke Part Berikutnya

Bagian ini membahas advanced indexing.

Part berikutnya, `part-017`, akan membahas query optimizer dan execution plans:

- logical vs physical execution
- planner estimates
- cardinality estimation
- join algorithms
- scan types
- sort/hash aggregate
- EXPLAIN
- why optimizer ignores your index
- plan instability
- reading plans like a senior engineer

Index hanya berguna jika optimizer memilihnya dan access path-nya memang lebih murah. Karena itu bagian berikutnya sangat penting.

---

## 53. Ringkasan Bagian Ini

Hal penting dari part 016:

1. Advanced index harus dipilih berdasarkan predicate/operator nyata.
2. Partial index mengindeks subset row dan cocok untuk hot subset.
3. Partial unique index bisa menegakkan conditional business invariant.
4. Partial index hanya berguna jika query predicate match/implikatif.
5. Parameterized queries dapat memengaruhi penggunaan partial index.
6. Expression index mengindeks computed expression.
7. Normalized/generated column sering lebih jelas untuk domain identifiers.
8. Covering index mempercepat read tetapi menambah bloat/write cost.
9. Full-text index berbeda dari `LIKE`.
10. Trigram cocok untuk substring/fuzzy-ish identifier search.
11. JSON index berguna, tetapi core facts sebaiknya column.
12. Array indexes cocok untuk simple containment, tapi relationship table sering lebih benar.
13. Spatial queries membutuhkan spatial index.
14. BRIN cocok untuk huge append-only correlated range data.
15. GIN/GiST/SP-GiST adalah index families untuk operator khusus.
16. Operator class menentukan operator yang didukung index.
17. Advanced index sering vendor-specific dan harus intentional.
18. Search engine/read model kadang lebih tepat daripada memaksa DB index.
19. Index creation/drop pada large table perlu strategi operasional.
20. EXPLAIN tetap wajib untuk membuktikan manfaat index.

Kalimat inti:

> Advanced indexing adalah seni mencocokkan struktur data fisik dengan operator query dan invariant domain, sambil sadar bahwa setiap index punya biaya write, storage, dan operasi.

---

## 54. Referensi

1. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

2. PostgreSQL Documentation — Partial Indexes.  
   https://www.postgresql.org/docs/current/indexes-partial.html

3. PostgreSQL Documentation — Indexes on Expressions.  
   https://www.postgresql.org/docs/current/indexes-expressional.html

4. PostgreSQL Documentation — Index-Only Scans and Covering Indexes.  
   https://www.postgresql.org/docs/current/indexes-index-only-scans.html

5. PostgreSQL Documentation — Full Text Search.  
   https://www.postgresql.org/docs/current/textsearch.html

6. PostgreSQL Documentation — GIN Indexes.  
   https://www.postgresql.org/docs/current/gin.html

7. PostgreSQL Documentation — GiST Indexes.  
   https://www.postgresql.org/docs/current/gist.html

8. PostgreSQL Documentation — BRIN Indexes.  
   https://www.postgresql.org/docs/current/brin.html

9. PostgreSQL Documentation — JSON Types and Indexing.  
   https://www.postgresql.org/docs/current/datatype-json.html

10. PostgreSQL Documentation — pg_trgm.  
    https://www.postgresql.org/docs/current/pgtrgm.html

11. MySQL 8.4 Reference Manual — Optimization and Indexes.  
    https://dev.mysql.com/doc/refman/8.4/en/optimization-indexes.html

12. SQL Server Documentation — Index Design Guide.  
    https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-index-design-guide

13. Oracle Database Concepts — Indexes.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/cncpt/indexes-and-index-organized-tables.html

---

## 55. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-017.md` — Query Optimizer and Execution Plans

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-015.md">⬅️ Part 15 — Index Fundamentals: B-Trees, Selectivity, Cardinality, and Access Paths</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-017.md">Part 17 — Query Optimizer and Execution Plans ➡️</a>
</div>

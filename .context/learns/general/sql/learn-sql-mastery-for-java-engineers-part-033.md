# learn-sql-mastery-for-java-engineers-part-033.md

# Part 33 — SQL Design Patterns and Anti-Patterns

> Seri: SQL Mastery for Java Engineers  
> Bagian: 033 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-032.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-034.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membandingkan PostgreSQL, MySQL, SQL Server, dan Oracle.

Sekarang kita menyusun katalog praktis:

```text
SQL design patterns and anti-patterns
```

Bagian ini bukan mengulang syntax. Ini adalah cara berpikir senior saat mendesain schema, query, transaction, Java data access, migration, dan operasi database.

Kamu akan melihat pola yang berulang di sistem production:

- current state + history
- append-only audit
- outbox/inbox
- idempotency key
- staging import
- read model
- partial unique invariant
- effective-dated records
- keyset pagination
- guarded update
- tenant-scoped constraints
- queue claim with SKIP LOCKED
- expand-contract migration
- reconciliation
- constraint-name error mapping

Dan anti-pattern yang sering menyebabkan incident:

- SELECT *
- entity-as-API
- N+1
- EAV abuse
- comma-separated IDs
- missing tenant FK
- soft delete without partial uniqueness
- unbounded export
- giant transaction
- dynamic SQL concatenation
- deep OFFSET
- app-only invariant
- magic status string with no transition model
- migration drop in same deploy
- trigger doing external call
- report query on OLTP primary

Kalimat inti:

> SQL mastery adalah kemampuan mengenali pola yang menjaga correctness dan menghindari anti-pattern yang membuat data, performance, security, atau operations rusak secara perlahan.

---

## 1. Cara Membaca Pattern

Setiap pattern sebaiknya dipahami dengan format:

```text
Problem
Forces/trade-offs
Pattern
SQL shape
Java implication
Operational implication
When not to use
```

Pola bukan resep buta.

Pola yang bagus di satu konteks bisa menjadi anti-pattern di konteks lain.

Contoh:

```text
Read model bagus untuk list API kompleks.
Read model buruk jika dianggap source of truth tanpa rebuild/reconciliation.
```

---

# A. Schema and Modelling Patterns

---

## 2. Pattern: Explicit Grain

### Problem

Table/view/fact sering tidak jelas “satu row mewakili apa”.

### Pattern

Setiap table penting harus punya grain statement.

Example:

```text
cases: one row per case.
case_evidences: one row per evidence item.
case_status_transitions: one row per status transition.
case_daily_snapshot: one row per case per day.
```

### SQL Implication

Design constraints around grain.

```sql
CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL
);
```

### Anti-Pattern

Table bernama:

```text
case_details
case_data
case_info
```

berisi campuran current state, history, notes, and evidence count tanpa grain jelas.

---

## 3. Pattern: Current State + Append-Only History

### Problem

Aplikasi butuh query current state cepat dan audit perubahan.

### Pattern

Simpan current state di table utama dan history/event di table append-only.

```sql
cases(
    id,
    tenant_id,
    status,
    current_primary_officer_id,
    updated_at
)

case_status_transitions(
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
```

Transaction:

```text
lock current row
validate transition
update current state
insert history row
commit
```

### Benefits

- current query fast
- history preserved
- audit readable
- state machine explainable

### Anti-Pattern

Overwrite `cases.status` with no transition history.

---

## 4. Pattern: Effective-Dated Records

### Problem

Need know which fact was valid at time X.

Example:

```text
officer assignment
price/rule version
SLA policy
organizational membership
```

### Pattern

Use half-open interval:

```sql
valid_from TIMESTAMPTZ NOT NULL,
valid_to TIMESTAMPTZ,
CHECK (valid_to IS NULL OR valid_to > valid_from)
```

As-of query:

```sql
WHERE valid_from <= :as_of
  AND (valid_to IS NULL OR valid_to > :as_of)
```

### Anti-Pattern

Only current row and `updated_at`, losing historical validity.

---

## 5. Pattern: Reference Table Instead of Magic Strings

### Problem

Status/type codes scattered as strings.

### Pattern

Use reference table when values need metadata, lifecycle, ordering, or effective dates.

```sql
CREATE TABLE case_statuses (
    status_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_terminal BOOLEAN NOT NULL
);
```

### Benefits

- metadata
- FK validation
- display ordering
- status lifecycle
- admin/reporting clarity

### Anti-Pattern

Hardcoded strings everywhere with no database constraint.

---

## 6. Pattern: Allowed Transition Table

### Problem

State machine rules should be explicit and queryable.

### Pattern

```sql
CREATE TABLE allowed_case_status_transitions (
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    requires_reason BOOLEAN NOT NULL,
    PRIMARY KEY (from_status, to_status)
);
```

Use app or procedure to validate.

### Benefits

- state machine visible
- transitions auditable
- supports configuration
- prevents invalid changes

### Anti-Pattern

Any code can update status to any value.

---

## 7. Pattern: Tenant-Scoped Everything

### Problem

Shared-schema multi-tenancy risks cross-tenant leakage.

### Pattern

Every tenant-scoped table includes `tenant_id`.

Composite FK:

```sql
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
```

Unique constraints tenant-scoped:

```sql
UNIQUE (tenant_id, case_number_normalized)
```

Indexes start with tenant_id for OLTP queries.

### Anti-Pattern

Child table has `tenant_id` but FK only references global `case_id`.

---

## 8. Pattern: Sensitive Column Separation

### Problem

Common queries accidentally load sensitive data.

### Pattern

Split sensitive data.

```sql
parties(
    tenant_id,
    id,
    display_name,
    party_type
)

party_sensitive_data(
    tenant_id,
    party_id,
    national_id,
    date_of_birth,
    encrypted_payload
)
```

### Benefits

- least privilege
- smaller accidental exposure
- easier masking/redaction
- separate audit/encryption

### Anti-Pattern

Every entity table contains PII and every `SELECT *` loads it.

---

## 9. Pattern: Generated Normalized Key

### Problem

Business uniqueness requires normalization.

Example:

```text
email case-insensitive
case number ignores spaces/case
```

### Pattern

Use generated column or expression index.

```sql
case_number_normalized TEXT GENERATED ALWAYS AS (
    upper(regexp_replace(trim(case_number), '\s+', '', 'g'))
) STORED;

UNIQUE (tenant_id, case_number_normalized)
```

### Benefits

- all writers consistent
- uniqueness enforced by DB
- queryable/indexable

### Anti-Pattern

Normalize only in Java and hope no other writer forgets.

---

## 10. Pattern: Partial Unique Invariant

### Problem

Need uniqueness only for active rows.

Example:

```text
one active primary assignment per case
```

### Pattern

```sql
CREATE UNIQUE INDEX uq_active_primary_assignment
ON case_assignments (tenant_id, case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### Benefits

- concurrency-safe
- simple invariant
- protects all writers

### Anti-Pattern

SELECT first then INSERT without constraint, causing race condition.

---

## 11. Pattern: Append-Only Event/Audit Table

### Problem

Need trace of what happened.

### Pattern

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,
    actor_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL
);
```

Protect from update/delete.

### Anti-Pattern

Audit log table writable/deletable by runtime app with no controls.

---

## 12. Pattern: Snapshot for Official Report

### Problem

Report must be reproducible.

### Pattern

Store exact report output/rows at generation time.

```sql
CREATE TABLE report_snapshots (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    report_type TEXT NOT NULL,
    report_period TEXT NOT NULL,
    metric_version TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL
);
```

### Anti-Pattern

Regenerate official report from live tables and get different numbers.

---

## 13. Anti-Pattern: EAV Abuse

Entity-Attribute-Value:

```sql
entity_attributes(
    entity_id,
    attribute_name,
    attribute_value
)
```

Sometimes useful for truly dynamic metadata.

But often abused to avoid schema design.

Problems:

- no strong types
- no constraints
- hard indexes
- hard queries
- poor performance
- invalid data
- business logic everywhere
- impossible reporting

Prefer real columns/tables for core facts.

Use JSON/EAV only for peripheral flexible data with governance.

---

## 14. Anti-Pattern: Comma-Separated IDs

Bad:

```sql
cases.assigned_officer_ids = 'u1,u2,u3'
```

Problems:

- no FK
- hard query
- no index
- update anomalies
- invalid IDs
- duplicate IDs
- bad joins

Good:

```sql
case_assignments(case_id, officer_id, role, assigned_at)
```

Relationship deserves table.

---

## 15. Anti-Pattern: Everything JSON

JSON is useful, but not for core facts.

Bad:

```sql
cases(id, payload JSONB)
```

where status, tenant_id, opened_at, officer_id live only inside JSON.

Problems:

- weak constraints
- hard foreign keys
- indexing complexity
- hidden semantics
- migrations hard
- queries fragile
- app-only validation

Use columns for frequently queried, constrained, joined, or business-critical fields.

---

# B. Query Patterns

---

## 16. Pattern: Sargable Predicate

### Problem

Query cannot use index because column wrapped in function.

Bad:

```sql
WHERE date(opened_at) = :date
```

Good:

```sql
WHERE opened_at >= :start
  AND opened_at < :end
```

### Benefit

- index/range scan possible
- partition pruning possible
- optimizer estimates better

### Anti-Pattern

Applying functions/casts/arithmetic to indexed column in WHERE.

---

## 17. Pattern: Keyset Pagination

### Problem

Deep OFFSET pagination gets slower.

Bad:

```sql
ORDER BY opened_at DESC
LIMIT 50 OFFSET 100000;
```

Good:

```sql
WHERE (opened_at, id) < (:last_opened_at, :last_id)
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

### Benefits

- stable performance
- avoids skipped-row scan
- deterministic with tie-breaker

### Anti-Pattern

Deep offset for large interactive lists.

---

## 18. Pattern: Pre-Aggregate Before Join

### Problem

Join many one-to-many tables causes row multiplication.

### Pattern

Aggregate child first.

```sql
WITH evidence_counts AS (
    SELECT case_id, COUNT(*) AS evidence_count
    FROM case_evidences
    GROUP BY case_id
)
SELECT c.id, COALESCE(e.evidence_count, 0)
FROM cases c
LEFT JOIN evidence_counts e ON e.case_id = c.id;
```

### Anti-Pattern

Join cases × evidences × notes then `COUNT(*)`.

---

## 19. Pattern: EXISTS for Existence

### Problem

Need know whether related row exists.

Prefer:

```sql
WHERE EXISTS (
    SELECT 1
    FROM case_evidences e
    WHERE e.case_id = c.id
)
```

instead of join + distinct.

### Benefits

- avoids multiplication
- can stop at first match
- clearer semantics

### Anti-Pattern

Use JOIN when the relationship is only existence filter.

---

## 20. Pattern: NOT EXISTS for Anti-Join

Use:

```sql
WHERE NOT EXISTS (
    SELECT 1
    FROM case_assignments a
    WHERE a.case_id = c.id
      AND a.ended_at IS NULL
)
```

Avoid `NOT IN` when subquery may contain NULL.

### Anti-Pattern

```sql
WHERE id NOT IN (SELECT case_id FROM ...)
```

with nullable subquery result.

---

## 21. Pattern: Window Function for Latest Row

Latest transition per case:

```sql
WITH ranked AS (
    SELECT
        t.*,
        ROW_NUMBER() OVER (
            PARTITION BY case_id
            ORDER BY transitioned_at DESC, id DESC
        ) AS rn
    FROM case_status_transitions t
)
SELECT *
FROM ranked
WHERE rn = 1;
```

### Anti-Pattern

Correlated subquery without index or non-deterministic max timestamp join.

---

## 22. Pattern: Deterministic ORDER BY

Always include tie-breaker for pagination.

```sql
ORDER BY opened_at DESC, id DESC
```

### Anti-Pattern

```sql
ORDER BY opened_at DESC
```

when many rows can share timestamp.

---

## 23. Pattern: Bounded Query

Every user-facing list query should have:

- filter
- order
- limit
- deterministic order

```sql
SELECT id, case_number
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY opened_at DESC, id DESC
LIMIT 100;
```

### Anti-Pattern

Unbounded `SELECT` from API endpoint.

---

## 24. Pattern: Query by Parent Page First

Problem: need page of parents and children.

Pattern:

1. page parent IDs
2. fetch children for those IDs

Avoid paginating joined parent-child result directly.

### Anti-Pattern

Fetch join collection with pageable and hope ORM handles it efficiently.

---

## 25. Anti-Pattern: SELECT *

Problems:

- extra IO/network
- accidental sensitive exposure
- API changes when column added
- prevents covering/index-only scan
- ORM over-fetching
- harder review

Use explicit columns.

---

## 26. Anti-Pattern: DISTINCT as Bug Fix

`DISTINCT` often hides row multiplication.

Bad:

```sql
SELECT DISTINCT c.*
FROM cases c
JOIN evidences e ...
JOIN notes n ...
```

Ask:

```text
Why duplicates exist?
What is row grain?
Should child be pre-aggregated?
Should EXISTS be used?
```

Use DISTINCT intentionally, not as band-aid.

---

# C. Transaction and Concurrency Patterns

---

## 27. Pattern: Guarded Update

### Problem

Need state transition safe under concurrency.

Pattern:

```sql
UPDATE cases
SET status = 'CLOSED',
    closed_at = now()
WHERE tenant_id = :tenant_id
  AND id = :case_id
  AND status IN ('UNDER_REVIEW', 'PENDING_DECISION');
```

Java checks affected rows.

### Benefits

- atomic
- no race between read and write
- affected rows are domain signal

### Anti-Pattern

Read status in one statement, decide in app, update unconditionally later.

---

## 28. Pattern: Optimistic Locking

Table:

```sql
version BIGINT NOT NULL
```

Update:

```sql
UPDATE cases
SET status = :status,
    version = version + 1
WHERE id = :id
  AND version = :expected_version;
```

If 0 rows, conflict.

### Use When

- conflicts uncommon
- user can retry/reload
- aggregate-level update

### Anti-Pattern

Last-write-wins accidental overwrite.

---

## 29. Pattern: Pessimistic Lock for Critical Section

```sql
SELECT *
FROM cases
WHERE id = :id
FOR UPDATE;
```

Use when:

- high contention
- must read current state and perform multiple writes
- command must serialize per row

Keep transaction short.

### Anti-Pattern

Lock row then call external API before commit.

---

## 30. Pattern: Idempotency Key

For commands that may be retried.

```sql
CREATE TABLE processed_commands (
    tenant_id UUID NOT NULL,
    command_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, command_id)
);
```

### Benefits

- safe retry
- handles ambiguous timeout
- prevents duplicate external command effects

### Anti-Pattern

Retry POST command and create duplicate records/payments/events.

---

## 31. Pattern: Outbox

Inside transaction:

```text
update business state
insert outbox event
commit
```

Publisher sends later.

### Benefits

- atomic DB state + event record
- retryable publishing
- avoids distributed transaction

### Anti-Pattern

Publish Kafka/email/HTTP inside DB transaction before commit.

---

## 32. Pattern: Inbox

For consuming external events idempotently.

```sql
CREATE TABLE inbox_events (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,

    PRIMARY KEY (tenant_id, source_system, source_event_id)
);
```

### Anti-Pattern

Process same event twice and double-apply.

---

## 33. Pattern: Queue Claim with Skip Locked

Claim jobs concurrently.

```sql
WITH claimed AS (
    SELECT id
    FROM jobs
    WHERE status = 'READY'
    ORDER BY created_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET status = 'PROCESSING'
FROM claimed c
WHERE j.id = c.id
RETURNING j.*;
```

Dialect-specific.

### Anti-Pattern

Multiple workers select same jobs then race.

---

## 34. Pattern: Short Transaction

Transaction should include only database atomic work.

Good:

```text
validate input outside
begin
read/lock
write state
write history/outbox
commit
external work after commit
```

### Anti-Pattern

Transaction includes remote API call, file upload, user wait, or huge processing.

---

## 35. Anti-Pattern: Giant Transaction

Examples:

- import 10M rows in one transaction
- update all historical rows in one statement during peak
- stream export under one transaction for hours

Problems:

- locks
- MVCC bloat
- rollback huge
- replication lag
- connection held
- operational risk

Use batching/resumability.

---

## 36. Anti-Pattern: Retry Everything

Retry only safe transient failures.

Retryable:

- deadlock victim
- serialization failure
- transient connection failure, carefully

Not retryable:

- unique violation
- FK violation
- invalid state
- permission denied
- syntax error

Retry whole transaction with idempotency.

---

# D. Index Patterns

---

## 37. Pattern: Composite Index by Query Shape

Query:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY priority_rank, opened_at, id
LIMIT 50
```

Index:

```sql
CREATE INDEX idx_cases_queue
ON cases (tenant_id, status, priority_rank, opened_at, id);
```

### Principle

Equality predicates first, then range/order columns.

### Anti-Pattern

Single-column indexes on every column and hope optimizer combines well.

---

## 38. Pattern: Partial Index for Hot Subset

Outbox:

```sql
CREATE INDEX idx_outbox_unpublished
ON outbox_events (created_at, id)
WHERE published_at IS NULL;
```

### Benefits

- small index
- fast poll
- lower write overhead than full index
- matches query

### Anti-Pattern

Full index on huge mostly-published outbox table for publisher query.

---

## 39. Pattern: Covering Index

If query frequently reads few columns:

```sql
SELECT id, case_number
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY opened_at DESC
LIMIT 50;
```

Use covering/include features if available.

```sql
CREATE INDEX ...
ON cases (tenant_id, status, opened_at DESC, id)
INCLUDE (case_number);
```

Vendor-specific.

### Anti-Pattern

Huge covering indexes for every query causing write amplification.

---

## 40. Pattern: Index Foreign Keys

Foreign key child columns often need index.

```sql
CREATE INDEX idx_case_notes_case
ON case_notes (tenant_id, case_id);
```

Benefits:

- join performance
- delete/update parent checks
- lock footprint reduction

### Anti-Pattern

FK exists but child lookup/deletion scans whole table.

---

## 41. Anti-Pattern: Index Everything

Every index costs:

- insert/update/delete overhead
- storage
- cache
- maintenance
- planner complexity
- migration time

Index based on query workload and constraints.

Remove unused/redundant indexes carefully.

---

## 42. Anti-Pattern: Function in WHERE Without Expression Index

Bad:

```sql
WHERE lower(email) = lower(:email)
```

If no expression/generated index, scan.

Good:

- normalized column
- expression index
- case-insensitive type/collation if appropriate

---

# E. Java Data Access Patterns

---

## 43. Pattern: DTO Projection for Reads

Use DTOs for read endpoints.

```java
record CaseQueueItem(UUID id, String caseNumber, String status) {}
```

SQL selects only needed columns.

### Benefits

- no lazy loading
- no entity serialization
- less memory
- stable API
- better security

### Anti-Pattern

Return JPA entity directly from controller.

---

## 44. Pattern: Entity for Aggregate Command

Use entity/ORM when modifying aggregate with lifecycle.

```java
@Transactional
void changePriority(CaseId id, Priority p) {
    CaseEntity c = repository.getForUpdateOrVersion(id);
    c.changePriority(p);
}
```

### Anti-Pattern

Use ORM entity graph for every reporting/list query.

---

## 45. Pattern: Constraint Name to Domain Error

Database:

```sql
CONSTRAINT uq_users_email_normalized UNIQUE (tenant_id, email_normalized)
```

Java:

```text
uq_users_email_normalized -> EmailAlreadyExistsException
```

### Benefits

- DB enforces invariant
- app returns friendly error
- concurrency-safe

### Anti-Pattern

Pre-check uniqueness in app and no DB constraint.

---

## 46. Pattern: Query Name Instrumentation

Add stable query names in metrics/logs/comments.

```sql
/* query=CaseRepository.findOpenQueue */
SELECT ...
```

### Anti-Pattern

All DB calls appear as anonymous SQL in production.

---

## 47. Anti-Pattern: N+1

Loop triggering query per parent.

Fix:

- DTO query
- fetch plan
- batch fetch
- second query by IDs
- read model

Measure query count per request.

---

## 48. Anti-Pattern: Open Session in View for APIs

OSIV hides lazy loading problems until production.

Prefer:

- explicit transaction in service
- DTO mapping inside transaction
- controlled fetch plan
- no entity serialization

---

## 49. Anti-Pattern: Wrong Type Binding

Bad:

```java
ps.setString(1, uuid.toString());
```

then SQL casts column.

Good:

```java
ps.setObject(1, uuid);
```

with correct driver/dialect.

Wrong binding can kill index usage or break timezone/numeric correctness.

---

# F. Migration Patterns

---

## 50. Pattern: Expand-Contract

Steps:

```text
add new schema
deploy compatible app
backfill
validate
switch reads/writes
remove old schema later
```

### Anti-Pattern

Drop/rename column in same deploy that changes app.

---

## 51. Pattern: Batched Backfill

Use small batches with progress and throttling.

```sql
UPDATE ...
WHERE id > :last_id
ORDER BY id
LIMIT :batch_size
```

Vendor syntax differs; concept remains.

### Anti-Pattern

One giant update on hot production table.

---

## 52. Pattern: Add Constraint Not Valid, Validate Later

Where supported:

```sql
ALTER TABLE child
ADD CONSTRAINT fk_child_parent
FOREIGN KEY (...)
REFERENCES parent (...)
NOT VALID;

ALTER TABLE child VALIDATE CONSTRAINT fk_child_parent;
```

### Anti-Pattern

Add FK to huge dirty table without preflight/validation strategy.

---

## 53. Pattern: Online Index Creation

Use concurrent/online index features for hot large tables.

### Anti-Pattern

Blocking `CREATE INDEX` during peak traffic.

---

## 54. Anti-Pattern: Editing Applied Migration

Once applied in shared/prod environment, create new migration.

Editing history causes checksum drift and environment inconsistency.

---

# G. Security Patterns

---

## 55. Pattern: Least Privilege Runtime Role

Runtime app role:

- no DDL
- no superuser
- no schema owner
- limited DML
- no broad audit delete
- no unrestricted sensitive table access

### Anti-Pattern

App connects as admin.

---

## 56. Pattern: Parameter Binding + Identifier Allowlist

Values:

```java
WHERE email = ?
```

Identifiers:

```java
sortBy -> allowlist map
```

### Anti-Pattern

Raw string concatenation for ORDER BY, table name, filter fragment.

---

## 57. Pattern: RLS as Defense-in-Depth

Use RLS for tenant boundary where appropriate, plus explicit app tenant predicates.

### Anti-Pattern

RLS with session tenant context leaking through connection pool.

---

## 58. Pattern: Export Audit

Every sensitive export should record:

- who
- what filters
- when
- row count
- file hash
- expiration
- download access

### Anti-Pattern

Unbounded CSV export endpoint with no audit.

---

# H. Operations Patterns

---

## 59. Pattern: Query Observability

Track:

- query duration
- rows
- errors
- pool wait
- transaction duration
- query name
- SQLState

### Anti-Pattern

Only HTTP latency metrics, no DB breakdown.

---

## 60. Pattern: Restore Drill

Regularly restore backup to isolated environment and run smoke checks.

### Anti-Pattern

Backup success emails with no tested restore.

---

## 61. Pattern: Partition for Retention

Audit/history tables partitioned by time.

Drop/archive partitions instead of deleting millions of rows.

### Anti-Pattern

Monthly `DELETE FROM audit_events WHERE occurred_at < ...` on huge table causing bloat/lag.

---

## 62. Pattern: Reconciliation Job

For derived/read/external data, run checks.

```sql
SELECT ...
HAVING read_model_count <> source_count;
```

### Anti-Pattern

Trust read model forever without drift detection.

---

## 63. Pattern: Runbook for Risky DB Work

Include:

- purpose
- lock behavior
- expected duration
- preflight
- monitoring
- rollback/fix-forward
- owner

### Anti-Pattern

Run production migration manually with no plan.

---

# I. Reporting and Analytics Patterns

---

## 64. Pattern: Fact Grain and Metric Definition

Before SQL report, define:

- fact grain
- numerator
- denominator
- period
- timezone
- exclusions
- correction policy
- freshness

### Anti-Pattern

Dashboard metric named “active cases” with no definition.

---

## 65. Pattern: Snapshot Official Reports

Official reports stored as snapshots with metric version.

### Anti-Pattern

Regenerate legal report from changing live data.

---

## 66. Pattern: Move Heavy Analytics Off OLTP Primary

Use:

- replica
- materialized view
- read model
- warehouse
- async report job
- pre-aggregation

### Anti-Pattern

BI tool connects to OLTP primary and runs arbitrary joins.

---

# J. Pattern Selection Heuristics

---

## 67. Constraint vs Application Validation

Use both, but different purpose.

Application validation:

- UX
- friendly messages
- early feedback
- workflow context

Database constraint:

- correctness
- concurrency safety
- all writers
- final authority

Heuristic:

```text
If data must never violate it, enforce in database.
```

---

## 68. Trigger vs Explicit Application Write

Use trigger when:

- technical audit must cover all writers
- derived field can be set near row
- invariant impossible declaratively
- all DML paths must be affected

Use explicit app write when:

- business event needs command context
- workflow semantics matter
- external integration involved
- event payload versioning important

Avoid trigger for hidden business workflow.

---

## 69. View vs Materialized View vs Read Model

Use view when:

- reusable query/security abstraction
- no need to store result
- current source data desired

Use materialized view when:

- expensive query result can be stale until refresh
- refresh semantics acceptable

Use read model when:

- API-specific denormalized shape
- event/job-maintained projection
- rebuild/reconciliation available

---

## 70. ORM vs SQL-First

Use ORM for:

- aggregate writes
- simple CRUD
- lifecycle/dirty checking
- optimistic locking

Use SQL-first for:

- complex reads
- reporting
- bulk operations
- advanced SQL
- performance-critical queries
- vendor features

Hybrid is normal.

---

## 71. Normalize vs Denormalize

Normalize for:

- source of truth
- write correctness
- avoiding anomalies
- constraints

Denormalize for:

- read models
- reporting
- performance
- snapshots

But denormalized data needs:

- source clarity
- update strategy
- rebuild
- reconciliation
- freshness semantics

---

# K. Code Review Smells

---

## 72. SQL Code Review Questions

```text
What is row grain?
Is tenant filter present?
Is query bounded?
Is ORDER BY deterministic?
Can indexes support predicates/order?
Any function/cast on indexed column?
Any join multiplication?
Is SELECT * used?
Are NULL semantics correct?
Is transaction boundary correct?
Are affected rows checked?
Is error mapping meaningful?
Is this read from primary or replica?
Does this query expose sensitive data?
```

---

## 73. Schema Review Questions

```text
What invariant does this table enforce?
What is primary key?
What are business unique keys?
Are FKs tenant-scoped?
Are NULLs meaningful?
Are CHECK constraints needed?
Does status need transition history?
Does time need valid/recorded distinction?
What indexes support expected queries?
What retention applies?
Is PII classified?
```

---

## 74. Migration Review Questions

```text
Is it backward compatible?
Can app rollback?
Will it lock/rewrite large table?
Is backfill batched?
Are constraints validated safely?
Are indexes online/concurrent?
Are grants/RLS included?
Are preflight/validation queries defined?
Is there a runbook?
```

---

## 75. Production Smells

```text
same query repeated thousands times per request
many idle in transaction sessions
pool pending high but DB CPU low
replica lag after report job
audit table huge with no partition
read model drift unknown
backup never restored
migration takes longer every release
dashboard query is top DB cost
app user owns schema
deadlocks after new batch job
```

Smells are early warnings.

---

## 76. Master Checklist

When designing any DB-backed feature:

```text
[ ] Model facts with explicit grain.
[ ] Enforce critical invariants in DB.
[ ] Use correct temporal semantics.
[ ] Design indexes from query shapes.
[ ] Keep transactions short.
[ ] Make commands idempotent where retried.
[ ] Use outbox for external side effects.
[ ] Use DTO/read models for complex reads.
[ ] Avoid unbounded queries/exports.
[ ] Plan migrations with expand-contract.
[ ] Include security/tenant isolation.
[ ] Add observability/query names.
[ ] Test with real database.
[ ] Document ownership and operational behavior.
```

---

## 77. Practical Exercises

### Exercise 1 — Identify Anti-Patterns

Given:

```sql
SELECT DISTINCT *
FROM cases c
JOIN notes n ON n.case_id = c.id
JOIN evidences e ON e.case_id = c.id
WHERE lower(c.case_number) = lower(:caseNumber);
```

Find anti-patterns and rewrite.

Expected issues:

- SELECT *
- DISTINCT band-aid
- join multiplication
- function predicate
- missing tenant filter
- unclear grain

### Exercise 2 — Design Pattern Choice

Requirement:

```text
After closing case, publish CaseClosed event to Kafka exactly once eventually.
```

Pick pattern: outbox + idempotent publisher.

### Exercise 3 — Migration Pattern

Requirement:

```text
Rename column opened_at to received_at with zero downtime.
```

Use expand-contract.

### Exercise 4 — Multi-Tenant Invariant

Requirement:

```text
case_notes must reference case in same tenant.
```

Use composite FK.

### Exercise 5 — Reporting Pattern

Requirement:

```text
Official monthly report must not change after submission.
```

Use report snapshot + metric version.

---

## 78. Koneksi ke Part Berikutnya

Part ini membahas SQL design patterns and anti-patterns.

Part berikutnya, `part-034`, adalah capstone:

```text
Designing and Operating a Regulatory Case Management Database
```

Di capstone, kita akan menggabungkan semua materi:

- relational modelling
- constraints
- indexes
- transactions
- state machines
- audit
- temporal truth
- security
- Java access
- migrations
- read models
- operations
- reporting
- scaling

Bagian berikutnya adalah bagian terakhir seri SQL Mastery ini.

---

## 79. Ringkasan Bagian Ini

Hal penting dari part 033:

1. Pattern harus dipahami sebagai trade-off, bukan template.
2. Explicit grain adalah fondasi schema/query/reporting.
3. Current state + append-only history adalah pattern inti untuk workflow systems.
4. Effective-dated records memakai interval `[from, to)`.
5. Tenant-scoped constraints mencegah cross-tenant bugs.
6. Generated normalized keys and partial unique indexes enforce business invariants.
7. Sargability, keyset pagination, EXISTS, and pre-aggregation are key query patterns.
8. Guarded update, optimistic locking, idempotency, outbox, and inbox are core concurrency/integration patterns.
9. Composite indexes should follow query shape.
10. DTO projection and SQL-first reads prevent many ORM issues.
11. Expand-contract and batched backfill are migration essentials.
12. Least privilege, parameter binding, RLS discipline, and export audit are security patterns.
13. Query observability, restore drills, partition retention, and reconciliation are operational patterns.
14. Fact grain and metric definitions are analytics patterns.
15. Anti-patterns often hide as convenience: SELECT *, DISTINCT, EAV, JSON-everything, giant transactions, and app-only invariants.
16. Code review should ask about grain, tenant, bounds, indexes, NULLs, transactions, and security.
17. Production smells reveal design flaws early.
18. Hybrid ORM + SQL-first architecture is often healthiest.
19. Denormalization is fine only with source, rebuild, reconciliation, and freshness.
20. Senior database design is mostly about making correctness explicit and failure modes contained.

Kalimat inti:

> Pola SQL yang baik membuat kebenaran terlihat dan bisa ditegakkan; anti-pattern SQL membuat kebenaran tersembunyi sampai suatu hari muncul sebagai data corruption, latency spike, security breach, atau failed migration.

---

## 80. Referensi

1. Martin Fowler — Patterns of Enterprise Application Architecture.  
   https://martinfowler.com/books/eaa.html

2. Martin Fowler — Evolutionary Database Design.  
   https://martinfowler.com/articles/evodb.html

3. PostgreSQL Documentation — Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html

4. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

5. PostgreSQL Documentation — Explicit Locking.  
   https://www.postgresql.org/docs/current/explicit-locking.html

6. OWASP — SQL Injection Prevention Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

7. Kimball Group — Dimensional Modeling Techniques.  
   https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/

8. Vlad Mihalcea — High-Performance Java Persistence.  
   https://vladmihalcea.com/books/high-performance-java-persistence/

9. Martin Kleppmann — Designing Data-Intensive Applications.  
   https://dataintensive.net/

---

## 81. Status Seri

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
- `learn-sql-mastery-for-java-engineers-part-032.md`
- `learn-sql-mastery-for-java-engineers-part-033.md`

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-034.md` — Capstone: Designing and Operating a Regulatory Case Management Database


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-032.md">⬅️ Part 32 — Vendor-Specific Deep Comparison: PostgreSQL, MySQL, SQL Server, Oracle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-034.md">Part 34 — Capstone: Designing and Operating a Regulatory Case Management Database ➡️</a>
</div>

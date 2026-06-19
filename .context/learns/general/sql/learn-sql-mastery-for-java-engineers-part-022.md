# learn-sql-mastery-for-java-engineers-part-022.md

# Part 22 — Views, Materialized Views, and Read Models

> Seri: SQL Mastery for Java Engineers  
> Bagian: 022 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-021.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-023.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas database-side logic:

- stored functions
- stored procedures
- triggers
- generated columns
- audit triggers
- database-side business logic boundaries

Bagian ini membahas **read-side abstraction**:

```text
views
materialized views
read models
projections
reporting tables
```

Dalam sistem production, schema write model yang normalized dan benar sering tidak sama dengan bentuk data yang paling enak dibaca oleh API, dashboard, report, atau search page.

Contoh write model:

```text
cases
case_assignments
officers
case_evidences
case_slas
approval_requests
workflow_tasks
case_status_transitions
```

Contoh kebutuhan read:

```text
Tampilkan daftar case open dengan:
- case number
- status
- priority
- primary officer name
- evidence count
- SLA due date
- latest activity
- approval status
- overdue flag
```

Jika setiap endpoint menulis join/aggregate sendiri, sistem akan punya:

- query duplikat
- bug berbeda antar endpoint
- performance tidak stabil
- join explosion
- logic tersebar
- sulit maintain
- sulit optimize

Views, materialized views, dan read models membantu membuat layer baca yang lebih stabil.

Namun mereka juga punya trade-off:

- hidden complexity
- stale data
- refresh cost
- locking
- rebuild strategy
- migration coupling
- source of truth ambiguity
- ORM confusion
- security implications

Bagian ini membahas kapan memakai masing-masing.

Kalimat inti:

> Write model dirancang untuk kebenaran perubahan data; read model dirancang untuk menjawab pertanyaan dengan cepat, konsisten, dan sesuai kebutuhan konsumen.

---

## 1. Write Model vs Read Model

### 1.1 Write Model

Write model adalah schema utama yang menjaga fakta dan invariant.

Contoh:

```sql
cases
case_assignments
case_evidences
case_status_transitions
approval_requests
case_slas
```

Karakteristik:

- normalized
- constraint-heavy
- source of truth
- optimized for correct writes
- supports transactions
- represents domain facts
- avoids dangerous redundancy

### 1.2 Read Model

Read model adalah representasi data yang disusun untuk kebutuhan baca tertentu.

Contoh:

```sql
case_work_queue_read_model
case_dashboard_summary
case_search_documents
case_report_daily_counts
```

Karakteristik:

- often denormalized
- optimized for queries
- may be derived
- may be eventually consistent
- can be rebuilt
- source is write model/events
- consumer-focused

---

## 2. Mengapa Read Abstraction Dibutuhkan

Read abstraction membantu ketika query:

- dipakai banyak tempat
- kompleks
- rawan bug
- membutuhkan security filtering
- membutuhkan aggregation
- membutuhkan join banyak table
- butuh performance stabil
- butuh bentuk data khusus UI/report
- butuh compatibility layer
- butuh menyembunyikan schema internal
- butuh reuse di SQL/reporting tools

Tapi abstraction juga bisa menyembunyikan cost.

Jangan membuat view untuk setiap query kecil. Gunakan jika ada nilai desain.

---

## 3. View: Saved Query

View adalah query yang diberi nama.

```sql
CREATE VIEW active_cases AS
SELECT
    id,
    tenant_id,
    case_number,
    status,
    opened_at
FROM cases
WHERE deleted_at IS NULL;
```

Query:

```sql
SELECT *
FROM active_cases
WHERE tenant_id = :tenant_id
  AND status = 'OPEN';
```

View tidak menyimpan data secara fisik. Ia seperti macro/query abstraction yang biasanya diexpand oleh optimizer.

---

## 4. View Bukan Cache

Kesalahan umum:

```text
Buat view supaya query cepat.
```

View biasa tidak otomatis membuat query cepat.

View:

- menyimpan definisi query
- tidak menyimpan hasil
- tidak otomatis punya index sendiri
- tidak mengurangi work jika query tetap kompleks
- bisa membuat query lebih mudah dibaca
- bisa membantu security/compatibility

Untuk menyimpan hasil fisik, gunakan materialized view atau table/projection.

---

## 5. Kapan View Berguna

View berguna untuk:

### 5.1 Reusable Query Logic

```sql
CREATE VIEW current_primary_assignments AS
SELECT
    tenant_id,
    case_id,
    officer_id,
    assigned_at
FROM case_assignments
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

### 5.2 Security Boundary

Expose subset columns/rows:

```sql
CREATE VIEW public_case_summaries AS
SELECT
    id,
    tenant_id,
    case_number,
    status
FROM cases
WHERE confidential = false;
```

### 5.3 Compatibility Layer

During migration:

```sql
CREATE VIEW legacy_cases AS
SELECT
    id,
    case_number AS number,
    status
FROM cases;
```

### 5.4 Reporting Convenience

Analysts can query named abstraction.

### 5.5 Encapsulating Derived Fields

```sql
CREATE VIEW case_sla_status AS
SELECT
    id,
    due_at,
    CASE
        WHEN completed_at IS NOT NULL THEN 'COMPLETED'
        WHEN due_at < now() THEN 'OVERDUE'
        ELSE 'ACTIVE'
    END AS computed_status
FROM case_slas;
```

Be careful with volatile functions like `now()`.

---

## 6. View as API

Treat important views like APIs.

They have:

- name
- columns
- types
- semantics
- consumers
- compatibility expectations
- performance expectations
- security expectations

Changing a view can break:

- Java code
- BI reports
- ETL jobs
- dashboards
- data exports
- other services

Avoid casually changing or dropping columns.

Version if needed:

```sql
case_work_queue_v1
case_work_queue_v2
```

or use expand-contract migration.

---

## 7. View and Predicate Pushdown

Optimizer often expands view and pushes outer predicates into base query.

View:

```sql
CREATE VIEW open_cases AS
SELECT *
FROM cases
WHERE status = 'OPEN';
```

Query:

```sql
SELECT *
FROM open_cases
WHERE tenant_id = :tenant_id;
```

Optimizer can transform to:

```sql
SELECT *
FROM cases
WHERE status = 'OPEN'
  AND tenant_id = :tenant_id;
```

Then index:

```sql
(tenant_id, status)
```

can be used.

But pushdown can be limited by:

- aggregation
- DISTINCT
- window functions
- set operations
- security barrier views
- volatile functions
- materialized CTE-like behavior in some DBs
- outer join semantics
- vendor limitations

Always inspect plan for important view queries.

---

## 8. View Hiding Complexity

Bad pattern:

```sql
CREATE VIEW case_everything AS
SELECT ...
FROM cases c
LEFT JOIN case_assignments a ...
LEFT JOIN case_evidences e ...
LEFT JOIN case_notes n ...
LEFT JOIN approval_requests ar ...
LEFT JOIN case_slas s ...
```

Then:

```sql
SELECT *
FROM case_everything
WHERE case_id = :id;
```

Problems:

- join explosion
- duplicate rows
- unclear grain
- hidden performance cost
- hard to optimize
- downstream `DISTINCT` to hide bugs
- consumers misunderstand row meaning

Every view must have clear grain.

If view row grain is not obvious, view is dangerous.

---

## 9. View Grain

Example good view:

```sql
CREATE VIEW current_primary_assignments AS
SELECT
    tenant_id,
    case_id,
    officer_id,
    assigned_at
FROM case_assignments
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

Grain:

```text
one row per case with active primary assignment
```

If constraint ensures one active primary, view has predictable grain.

Bad view:

```sql
case_details_view
```

with joins to many one-to-many tables.

Grain becomes:

```text
one row per combination of case × evidence × note × assignment
```

Often unintended.

---

## 10. Updatable Views

Some simple views are updatable.

Example:

```sql
CREATE VIEW active_case_notes AS
SELECT *
FROM case_notes
WHERE deleted_at IS NULL;
```

Some databases allow:

```sql
UPDATE active_case_notes
SET note_text = '...'
WHERE id = :id;
```

But updatable view rules vary.

Risks:

- hidden write path
- constraints with check option needed
- trigger interaction
- ORM confusion
- security expectations

Use `WITH CHECK OPTION` if updates through view must remain visible in view.

Concept:

```sql
CREATE VIEW open_cases AS
SELECT *
FROM cases
WHERE status = 'OPEN'
WITH CHECK OPTION;
```

Prevents updating row through view so it no longer satisfies `status = 'OPEN'`, depending vendor support.

---

## 11. Security Views

View can restrict columns.

Base table:

```sql
cases(
    id,
    tenant_id,
    case_number,
    status,
    confidential_notes,
    internal_risk_score
)
```

View:

```sql
CREATE VIEW external_case_view AS
SELECT
    id,
    tenant_id,
    case_number,
    status
FROM cases;
```

Grant access to view, not table.

Benefits:

- hide sensitive columns
- stable external interface
- reduce accidental data exposure

Caveats:

- permissions must be correct
- owner/security semantics vendor-specific
- predicate pushdown/performance
- view definitions must be audited
- row-level security may be better for row restrictions

---

## 12. Security Barrier Views

Some databases support security barrier views to prevent predicate/function side-channel leakage.

Use when view enforces security and user-supplied functions/predicates could leak data.

Trade-off:

- may restrict optimizer pushdown
- performance cost
- vendor-specific

Security and performance trade-offs must be explicit.

---

## 13. Materialized View

Materialized view stores query result physically.

Example:

```sql
CREATE MATERIALIZED VIEW case_status_counts AS
SELECT
    tenant_id,
    status,
    COUNT(*) AS case_count
FROM cases
GROUP BY tenant_id, status;
```

Query:

```sql
SELECT *
FROM case_status_counts
WHERE tenant_id = :tenant_id;
```

Unlike normal view, result exists as stored data.

Benefits:

- faster reads
- expensive aggregation precomputed
- can add indexes
- useful for dashboards/reports

Costs:

- stale until refreshed
- refresh cost
- storage
- locking/availability concerns
- maintenance
- dependency on base tables

---

## 14. Materialized View Freshness

Materialized view is not automatically current unless database supports incremental automatic maintenance, which many do not by default.

Freshness options:

```text
manual refresh
scheduled refresh
refresh on demand
refresh concurrently
incremental refresh
trigger-maintained summary table
event-driven projection
```

Need define:

```text
How stale can it be?
seconds?
minutes?
hours?
daily?
```

Without freshness requirement, design is incomplete.

---

## 15. Refresh Strategies

### 15.1 Full Refresh

Recompute all data.

```sql
REFRESH MATERIALIZED VIEW case_status_counts;
```

Pros:

- simple
- correct from source
- easy to reason

Cons:

- expensive
- may lock reads/writes depending vendor/options
- not scalable for huge data
- may cause IO spike

### 15.2 Concurrent Refresh

PostgreSQL:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY case_status_counts;
```

Requires unique index and has limitations.

Pros:

- allows reads during refresh

Cons:

- slower
- more resource usage
- still operationally important

### 15.3 Incremental Refresh

Only update changed portions.

May need custom logic or vendor support.

### 15.4 Event-Driven Projection

Update read model as events happen.

Pros:

- near real-time
- incremental
- scalable

Cons:

- more moving parts
- eventual consistency
- rebuild/replay needed
- idempotency needed

---

## 16. Indexing Materialized Views

Materialized views can often be indexed.

```sql
CREATE UNIQUE INDEX uq_case_status_counts
ON case_status_counts (tenant_id, status);
```

For dashboard query:

```sql
WHERE tenant_id = :tenant_id
```

Index:

```sql
CREATE INDEX idx_case_status_counts_tenant
ON case_status_counts (tenant_id);
```

Remember:

- indexes on materialized view increase refresh cost
- concurrent refresh may require unique index
- index strategy depends on consumers

---

## 17. Materialized View vs Summary Table

Materialized view:

```text
database object defined by query
```

Summary table:

```text
normal table maintained by app/job/trigger/projection
```

### 17.1 Materialized View Pros

- definition close to query
- refresh from source
- simple for full recompute
- DB-managed object

### 17.2 Materialized View Cons

- refresh may be heavy
- limited incremental support
- vendor behavior differs
- hard to customize per-row updates

### 17.3 Summary Table Pros

- flexible maintenance
- incremental update
- custom logic
- can store metadata
- easier event-driven projection

### 17.4 Summary Table Cons

- more code
- drift risk
- rebuild needed
- consistency complexity

Choose based on freshness, volume, and maintenance model.

---

## 18. Read Model as Projection

A read model is often a normal table.

Example:

```sql
CREATE TABLE case_work_queue_read_model (
    tenant_id UUID NOT NULL,
    case_id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    priority_rank INTEGER NOT NULL,
    primary_officer_id UUID,
    primary_officer_name TEXT,
    evidence_count INTEGER NOT NULL,
    approval_status TEXT,
    sla_due_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

Query:

```sql
SELECT *
FROM case_work_queue_read_model
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY priority_rank ASC, sla_due_at ASC, case_id ASC
LIMIT 50;
```

Index:

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

This is much simpler than joining 8 tables every request.

---

## 19. Read Model Source of Truth

Read model should usually not be source of truth.

Source of truth:

```text
cases
case_assignments
case_evidences
approval_requests
case_slas
```

Read model derives from them.

Rules:

```text
Do not update read model as primary command state.
Do not let read model drift without rebuild ability.
Do not store facts only in read model unless intentionally source of truth.
```

Read model is cache/projection with schema.

Treat it as rebuildable if possible.

---

## 20. Rebuildability

A good read model can be rebuilt.

Rebuild methods:

### 20.1 Full SQL Rebuild

```sql
TRUNCATE case_work_queue_read_model;

INSERT INTO case_work_queue_read_model (...)
SELECT ...
FROM source_tables ...;
```

### 20.2 Partition/Tenant Rebuild

```sql
DELETE FROM read_model WHERE tenant_id = :tenant_id;

INSERT ...
WHERE tenant_id = :tenant_id;
```

### 20.3 Event Replay

Replay domain events/outbox/inbox.

### 20.4 Hybrid

Full rebuild for correctness; incremental updates for normal operation.

If read model cannot be rebuilt, it is secretly source of truth.

---

## 21. Incremental Projection

Event-driven update:

```text
CASE_OPENED -> insert read model row
CASE_ASSIGNED -> update officer fields
EVIDENCE_RECEIVED -> increment evidence_count
SLA_UPDATED -> update sla_due_at
CASE_CLOSED -> update status
```

Pros:

- efficient
- near real-time
- query fast

Cons:

- event ordering
- duplicate events
- missed events
- projection bugs
- replay complexity
- schema evolution
- consistency lag
- backfill required

Need idempotency.

Projection handler must tolerate duplicate events.

---

## 22. Projection Idempotency

Projection event table:

```sql
CREATE TABLE projection_processed_events (
    projection_name TEXT NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (projection_name, event_id)
);
```

Handler:

```sql
BEGIN;

INSERT INTO projection_processed_events (...)
VALUES (...)
ON CONFLICT DO NOTHING;

-- if inserted, apply projection update

COMMIT;
```

This prevents duplicate event application.

For counters, duplicate event without idempotency causes wrong counts.

---

## 23. Projection Drift

Read model can drift from source due to:

- missed event
- duplicate event
- handler bug
- manual source update
- migration bug
- partial failure
- out-of-order event
- old projection code
- schema evolution

Mitigations:

- rebuild process
- reconciliation job
- checksums/count comparisons
- versioned events
- idempotent handlers
- monitoring lag
- dead-letter queue
- projection repair tooling

Read model operational maturity matters.

---

## 24. Freshness Semantics

For every read model/materialized view, document freshness.

Examples:

```text
strongly consistent in same transaction
eventually consistent, normally < 5s
refreshed every 15 minutes
daily snapshot at 00:00 UTC
manual refresh after import
```

API should not pretend stale data is real-time.

If user closes case and immediately sees old status in read model, UX must handle:

- read from source after write
- wait for projection
- optimistic UI
- consistency token
- route user-specific read to primary/source
- show refresh indicator

---

## 25. Strongly Consistent Read Model

You can update read model in same transaction as source.

```sql
BEGIN;

UPDATE cases SET status = 'CLOSED' WHERE id = :case_id;

UPDATE case_work_queue_read_model
SET status = 'CLOSED'
WHERE case_id = :case_id;

INSERT INTO outbox_events ...;

COMMIT;
```

Pros:

- no lag
- simple read-your-writes

Cons:

- write transaction heavier
- read model bugs can break writes
- more lock contention
- denormalized updates across many projections costly
- harder to scale

Use when strong consistency needed and projection small.

---

## 26. Eventually Consistent Read Model

Source transaction writes event/outbox.

Projection updates later.

Pros:

- write transaction simpler
- scalable
- decoupled
- can retry projection
- can use separate store

Cons:

- stale reads
- duplicate/out-of-order handling
- user experience complexity
- monitoring needed
- rebuild needed

Use for dashboards/search/reporting/queues where slight lag acceptable.

---

## 27. Read-Your-Writes

Read-your-writes means user sees their own write immediately.

Problem:

```text
POST /cases/{id}/close -> commits source
GET /case-work-queue -> reads lagging read model still OPEN
```

Solutions:

- return updated resource from write command
- read source for immediate detail page
- wait until projection catches up with event version
- use consistency token
- update read model synchronously for critical fields
- design UI acknowledging eventual update

Do not ignore this; users perceive it as bug.

---

## 28. View vs Materialized View vs Read Model

| Option | Stores Data | Freshness | Best For |
|---|---:|---|---|
| View | No | Always source-current | Reusable logic/security/compatibility |
| Materialized View | Yes | Refresh-based | Expensive aggregations/reports |
| Read Model Table | Yes | Sync or async | API-specific denormalized reads |
| Summary Table | Yes | Sync/async/job | Counts/metrics/dashboards |
| Search Index | Yes | Async usually | Full-text/relevance/fuzzy search |

Choose by:

- correctness
- freshness
- performance
- complexity
- rebuildability
- operational ownership

---

## 29. Views and Java ORM

Mapping ORM entity to view can be tricky.

Read-only view mapping:

```java
@Entity
@Immutable
@Table(name = "case_work_queue_view")
class CaseWorkQueueItem { ... }
```

Risks:

- ORM expects primary key
- view may not be updatable
- no constraints on view
- lazy relationships awkward
- hidden performance
- migration changes break mapping
- dirty checking should be disabled

For views/read models, DTO queries or read-only entities are usually better than full aggregate entities.

---

## 30. Read Model and API DTO

Read model often maps directly to DTO.

Example DTO:

```java
record CaseWorkQueueItem(
    UUID caseId,
    String caseNumber,
    String status,
    String priority,
    String primaryOfficerName,
    int evidenceCount,
    Instant slaDueAt,
    Instant lastActivityAt
) {}
```

SQL:

```sql
SELECT
    case_id,
    case_number,
    status,
    priority,
    primary_officer_name,
    evidence_count,
    sla_due_at,
    last_activity_at
FROM case_work_queue_read_model
WHERE tenant_id = :tenant_id
  AND status = 'OPEN'
ORDER BY priority_rank, sla_due_at, case_id
LIMIT :limit;
```

This keeps read path explicit and stable.

---

## 31. Avoid Updating Through Read Model

Bad:

```sql
UPDATE case_work_queue_read_model
SET status = 'CLOSED'
WHERE case_id = :case_id;
```

as business command.

Should update source:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = :case_id;
```

Then read model updates from source/event.

Otherwise source and projection diverge.

Only update read model directly if it is intentionally source of truth, which should be rare and explicit.

---

## 32. Denormalization in Read Model

Read model can store:

```text
primary_officer_name
evidence_count
latest_activity_at
computed_sla_status
priority_rank
```

These are redundant.

That's okay if:

- source of truth clear
- update strategy defined
- rebuild available
- freshness documented
- drift monitored

Denormalization is not bad when controlled.

Uncontrolled denormalization is bad.

---

## 33. Read Model Indexing

Read model should be indexed for consumer queries.

Example:

```sql
CREATE INDEX idx_case_work_queue_open
ON case_work_queue_read_model (
    tenant_id,
    status,
    priority_rank,
    sla_due_at,
    case_id
);
```

If search by officer:

```sql
CREATE INDEX idx_case_work_queue_officer
ON case_work_queue_read_model (
    tenant_id,
    primary_officer_id,
    status,
    sla_due_at,
    case_id
);
```

Do not copy all indexes from source. Index read model according to read API.

---

## 34. Materialized View for Dashboard

Dashboard counts:

```sql
CREATE MATERIALIZED VIEW mv_case_dashboard_counts AS
SELECT
    tenant_id,
    status,
    priority,
    COUNT(*) AS case_count
FROM cases
GROUP BY tenant_id, status, priority;
```

Index:

```sql
CREATE UNIQUE INDEX uq_mv_case_dashboard_counts
ON mv_case_dashboard_counts (tenant_id, status, priority);
```

Refresh:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_case_dashboard_counts;
```

Freshness:

```text
refreshed every 5 minutes
```

API response should know data may be up to 5 minutes old.

---

## 35. Security with Read Models

Read model may duplicate sensitive data.

If base table has RLS/security, read model must not bypass it accidentally.

Questions:

```text
Does read model include confidential fields?
Is tenant_id included and indexed?
Are grants restricted?
Does projection copy rows user should not see?
Are deletions/redactions propagated?
Are retention policies applied?
```

Read models are data stores. They require security review.

---

## 36. Redaction and Read Models

If PII is redacted in source:

```sql
UPDATE parties
SET legal_name = NULL,
    legal_name_redacted = TRUE
WHERE id = :party_id;
```

Read models containing `party_name` must update too.

Options:

- synchronous update
- projection event
- rebuild
- periodic reconciliation
- store references instead of sensitive snapshots unless needed

If read model keeps old PII after redaction, compliance issue.

---

## 37. Deletion and Read Models

Source soft delete:

```sql
UPDATE cases SET deleted_at = now() WHERE id = :id;
```

Read model must:

- remove row
- mark deleted
- hide in queries
- preserve for audit if needed

Decide semantics.

Hard delete source requires deleting/cleaning derived copies.

Read model retention must align with source retention.

---

## 38. Versioned Read Models

For evolving projections, use versioning.

Example:

```sql
case_work_queue_read_model_v1
case_work_queue_read_model_v2
```

Deploy:

1. create v2 table
2. backfill v2
3. dual update v1/v2 or replay events
4. switch app reads to v2
5. monitor
6. drop v1 later

This avoids risky in-place changes for critical projections.

---

## 39. Reconciliation Queries

Example: evidence count drift.

Read model:

```sql
evidence_count
```

Source:

```sql
case_evidences
```

Check:

```sql
SELECT
    rm.case_id,
    rm.evidence_count AS read_model_count,
    COUNT(e.id) AS source_count
FROM case_work_queue_read_model rm
LEFT JOIN case_evidences e
  ON e.case_id = rm.case_id
GROUP BY rm.case_id, rm.evidence_count
HAVING rm.evidence_count <> COUNT(e.id);
```

For large tables, run per tenant/partition/batch.

Reconciliation is essential for derived data trust.

---

## 40. Read Model Build Query

Full rebuild example:

```sql
INSERT INTO case_work_queue_read_model (
    tenant_id,
    case_id,
    case_number,
    status,
    priority,
    priority_rank,
    primary_officer_id,
    primary_officer_name,
    evidence_count,
    approval_status,
    sla_due_at,
    last_activity_at,
    updated_at
)
SELECT
    c.tenant_id,
    c.id,
    c.case_number,
    c.status,
    c.priority,
    CASE c.priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW' THEN 4
    END AS priority_rank,
    a.officer_id,
    o.full_name,
    COALESCE(e.evidence_count, 0),
    ar.status,
    s.due_at,
    GREATEST(
        c.opened_at,
        COALESCE(a.assigned_at, c.opened_at),
        COALESCE(e.latest_evidence_at, c.opened_at),
        COALESCE(s.updated_at, c.opened_at)
    ) AS last_activity_at,
    now()
FROM cases c
LEFT JOIN current_primary_assignments a
  ON a.tenant_id = c.tenant_id
 AND a.case_id = c.id
LEFT JOIN officers o
  ON o.tenant_id = a.tenant_id
 AND o.id = a.officer_id
LEFT JOIN (
    SELECT
        tenant_id,
        case_id,
        COUNT(*) AS evidence_count,
        MAX(received_at) AS latest_evidence_at
    FROM case_evidences
    GROUP BY tenant_id, case_id
) e
  ON e.tenant_id = c.tenant_id
 AND e.case_id = c.id
LEFT JOIN approval_requests ar
  ON ar.tenant_id = c.tenant_id
 AND ar.case_id = c.id
 AND ar.status = 'PENDING'
LEFT JOIN case_slas s
  ON s.tenant_id = c.tenant_id
 AND s.case_id = c.id
 AND s.status = 'ACTIVE'
WHERE c.deleted_at IS NULL;
```

This is complex. Putting it in one named rebuild script/projection is better than scattering it across endpoints.

---

## 41. Read Model Build Pitfalls

Pitfalls:

- join explosion from multiple one-to-many joins
- multiple pending approvals per case
- multiple active SLAs per case
- duplicate rows
- `GREATEST` with null behavior
- priority mapping hardcoded
- missing tenant join
- source table soft delete not filtered
- confidential data copied unintentionally
- build query too slow
- no indexes during build vs after build decision

Build query must be reviewed like production code.

---

## 42. Incremental Read Model Update Example

Evidence received event:

```sql
UPDATE case_work_queue_read_model
SET
    evidence_count = evidence_count + 1,
    last_activity_at = GREATEST(last_activity_at, :received_at),
    updated_at = now()
WHERE tenant_id = :tenant_id
  AND case_id = :case_id;
```

If event duplicate, count becomes wrong.

Idempotent approach:

- store event id processed
- or derive count from source
- or use evidence table insert with unique key then update only if inserted

Better transaction:

```sql
BEGIN;

INSERT INTO projection_processed_events (...)
VALUES (...)
ON CONFLICT DO NOTHING;

-- only if inserted:
UPDATE read_model ...

COMMIT;
```

---

## 43. Read Model from Transactional Source

If updating read model synchronously:

```sql
BEGIN;

INSERT INTO case_evidences (...);

UPDATE case_work_queue_read_model
SET evidence_count = evidence_count + 1
WHERE case_id = :case_id;

COMMIT;
```

This is consistent but couples write path to read model.

If read model update fails, evidence insert rolls back.

Is that desired?

Sometimes yes for critical queue.

Sometimes no; use outbox/projection instead.

---

## 44. Materialized View vs Query Optimizer

Materialized view can help if database can query it directly.

Some databases support query rewrite using materialized views automatically; many require querying materialized view explicitly.

Do not assume optimizer automatically replaces base query with materialized view.

Application/report should query MV by name unless feature configured.

---

## 45. Views and Migration Compatibility

During schema migration:

Old table:

```sql
cases(case_number)
```

New columns:

```sql
case_number_original
case_number_normalized
```

Compatibility view:

```sql
CREATE VIEW legacy_cases AS
SELECT
    id,
    case_number_original AS case_number,
    status
FROM cases;
```

This can support old consumers during transition.

But compatibility views should have retirement plan.

Otherwise legacy abstraction becomes permanent hidden debt.

---

## 46. Views for Multi-Tenancy

View:

```sql
CREATE VIEW tenant_cases AS
SELECT *
FROM cases
WHERE tenant_id = current_setting('app.tenant_id')::uuid;
```

Pros:

- reduces repeated tenant filter
- security-ish boundary if grants correct

Cons:

- connection pool context must be set/reset
- app bugs if context missing
- performance/pushdown
- security guarantee depends on permissions
- RLS may be stronger

Use carefully.

---

## 47. BI and Reporting Consumers

Views are often consumed by BI tools.

Design reporting views with:

- stable column names
- business-friendly names
- documented grain
- no hidden row multiplication
- security controls
- performance tested
- versioning
- date dimensions
- explicit timezone semantics
- no `SELECT *` from base

BI users will treat views as data contract.

---

## 48. Read Models and CQRS

CQRS = Command Query Responsibility Segregation.

Basic idea:

```text
write model and read model can be separate
```

You do not need full event sourcing to use CQRS-style read models.

In normal SQL system:

- commands update normalized OLTP tables
- queries read denormalized projection tables

CQRS is useful when read/write needs differ substantially.

But do not overcomplicate simple CRUD.

---

## 49. Read Model Without Event Sourcing

You can build read model from current tables.

Options:

- SQL refresh job
- triggers
- same-transaction updates
- CDC
- outbox events
- scheduled rebuild
- incremental changed_at scan

Event sourcing is not required.

Choose simplest reliable source.

---

## 50. Changed-At Scan Projection

Projection job scans changed rows:

```sql
SELECT *
FROM cases
WHERE updated_at > :last_seen_updated_at
ORDER BY updated_at, id
LIMIT 1000;
```

Caveats:

- clock precision
- multiple rows same timestamp
- updates to child tables also affect projection
- missed changes if timestamp not updated
- deletes
- ordering by `(updated_at, id)` cursor
- late arriving events
- transaction commit order vs updated_at

Outbox/CDC often more reliable for complex projections.

---

## 51. CDC-Based Projection

Change Data Capture reads database log and streams changes.

Pros:

- captures all changes
- low app coupling
- good for integrations/projections
- can feed search/warehouse

Cons:

- infrastructure complexity
- schema evolution handling
- event semantics are row-level, not domain-level
- ordering/transaction boundaries
- deletes/redaction
- replay management

CDC is powerful but not magic. Row changes are not always business events.

---

## 52. Read Model Ownership

Every read model needs owner.

Questions:

```text
Who owns schema?
Who owns build logic?
Who monitors lag/drift?
Who handles rebuild?
Who handles redaction/deletion?
Who handles versioning?
Who can change columns?
Who consumes it?
```

Without ownership, read models become untrusted data swamps.

---

## 53. Operational Metrics

Monitor:

- materialized view refresh duration
- refresh failures
- projection lag
- read model row count
- dead-letter projection events
- drift reconciliation failures
- read query latency
- index bloat
- storage growth
- stale data age
- rebuild duration
- last successful refresh time

Expose freshness:

```sql
CREATE TABLE projection_status (
    projection_name TEXT PRIMARY KEY,
    last_successful_refresh_at TIMESTAMPTZ,
    last_processed_event_at TIMESTAMPTZ,
    last_error TEXT
);
```

---

## 54. Case Study: Work Queue View First

Start with view:

```sql
CREATE VIEW case_work_queue_view AS
SELECT
    c.tenant_id,
    c.id AS case_id,
    c.case_number,
    c.status,
    c.priority,
    a.officer_id AS primary_officer_id,
    o.full_name AS primary_officer_name,
    s.due_at AS sla_due_at
FROM cases c
LEFT JOIN current_primary_assignments a
  ON a.tenant_id = c.tenant_id
 AND a.case_id = c.id
LEFT JOIN officers o
  ON o.tenant_id = a.tenant_id
 AND o.id = a.officer_id
LEFT JOIN case_slas s
  ON s.tenant_id = c.tenant_id
 AND s.case_id = c.id
 AND s.status = 'ACTIVE'
WHERE c.deleted_at IS NULL;
```

Use for early product stage.

If query becomes slow or logic grows, move to read model table.

This is evolutionary design.

---

## 55. Case Study: Work Queue Read Model Later

Table:

```sql
CREATE TABLE case_work_queue_read_model (
    tenant_id UUID NOT NULL,
    case_id UUID PRIMARY KEY,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    priority_rank INTEGER NOT NULL,
    primary_officer_id UUID,
    primary_officer_name TEXT,
    sla_due_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

Index:

```sql
CREATE INDEX idx_case_work_queue_open
ON case_work_queue_read_model (
    tenant_id,
    status,
    priority_rank,
    sla_due_at,
    case_id
);
```

Projection updated by events/outbox.

Now API query is simple and stable.

---

## 56. Case Study: Regulatory Report Snapshot

Requirement:

```text
Monthly report must be reproducible exactly as submitted.
```

Do not rely only on current view.

Create snapshot table:

```sql
CREATE TABLE monthly_case_report_snapshots (
    report_month DATE NOT NULL,
    tenant_id UUID NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    generated_by UUID NOT NULL,
    row_data JSONB NOT NULL,

    PRIMARY KEY (report_month, tenant_id)
);
```

Or normalized report rows.

Why?

- source data may change later
- rules may change
- corrections may happen
- audit requires submitted version

Materialized view refreshed now is not historical proof unless snapshot preserved.

---

## 57. Case Study: Search Read Model

Search document table:

```sql
CREATE TABLE case_search_documents (
    tenant_id UUID NOT NULL,
    case_id UUID PRIMARY KEY,
    search_text TEXT NOT NULL,
    case_number TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

Database FTS index:

```sql
CREATE INDEX idx_case_search_fts
ON case_search_documents
USING GIN (to_tsvector('english', search_text));
```

Or external search engine.

Read model collects text from:

- case number
- notes
- evidence metadata
- parties
- officer name

This avoids complex live search joins.

---

## 58. Anti-Patterns

```text
[ ] View named details/everything with unclear grain
[ ] View assumed to improve performance automatically
[ ] Materialized view with no refresh ownership
[ ] Read model treated as source of truth accidentally
[ ] Projection not idempotent
[ ] No rebuild strategy
[ ] No freshness semantics
[ ] No drift reconciliation
[ ] Sensitive data copied without security review
[ ] Redaction not propagated
[ ] BI view with row multiplication
[ ] ORM entity writes through view accidentally
[ ] View hides SELECT * from many tables
[ ] Materialized view refreshed during peak without testing locks
[ ] Dashboard live-aggregates huge OLTP table every second
```

---

## 59. Design Checklist

```text
[ ] What is this object: view, materialized view, read model, summary table?
[ ] What is the grain?
[ ] Who consumes it?
[ ] Is it source of truth or derived?
[ ] What source tables/events build it?
[ ] How fresh must it be?
[ ] How is it refreshed/updated?
[ ] Can it be rebuilt?
[ ] Is projection idempotent?
[ ] How is drift detected?
[ ] What indexes support read queries?
[ ] What security rules apply?
[ ] How are deletes/redactions propagated?
[ ] How is schema versioned?
[ ] What is operational owner?
[ ] Has execution plan been tested?
```

---

## 60. Practical Exercises

### Exercise 1 — View Grain

Given view joining cases to evidences and notes, identify row grain and explain join explosion risk.

### Exercise 2 — Materialized View Freshness

Dashboard refresh every 5 minutes. Document freshness and design refresh strategy.

### Exercise 3 — Read Model Rebuild

Write pseudo-steps:

```text
truncate read model
insert select from source
recreate/refresh indexes if needed
update projection_status
```

### Exercise 4 — Idempotent Projection

Design `projection_processed_events` table and explain why duplicate event matters.

### Exercise 5 — Redaction

If `party_name` is copied into read model, describe how redaction propagates.

---

## 61. Koneksi ke Part Berikutnya

Part ini membahas views, materialized views, and read models.

Part berikutnya, `part-023`, akan membahas temporal data, auditability, and historical truth:

- valid time vs transaction time
- event time vs recorded time
- audit trails
- temporal tables
- effective-dated records
- corrections/amendments
- historical reporting
- bitemporal thinking

Read models menjawab pertanyaan cepat. Temporal modelling menjawab pertanyaan historis dengan benar.

---

## 62. Ringkasan Bagian Ini

Hal penting dari part 022:

1. Write model dioptimalkan untuk correctness; read model dioptimalkan untuk query.
2. View adalah saved query, bukan cache.
3. View berguna untuk reuse, security, compatibility, and reporting abstraction.
4. View harus punya grain jelas.
5. View dapat menyembunyikan join explosion dan cost.
6. Predicate pushdown penting tetapi tidak selalu terjadi.
7. Materialized view menyimpan hasil fisik dan butuh refresh strategy.
8. Materialized view freshness harus didefinisikan.
9. Summary table memberi maintenance lebih fleksibel daripada materialized view.
10. Read model adalah denormalized projection untuk kebutuhan baca.
11. Read model biasanya bukan source of truth.
12. Read model harus rebuildable atau dianggap source of truth.
13. Projection incremental harus idempotent.
14. Projection drift harus dideteksi dan diperbaiki.
15. Read-your-writes perlu desain khusus jika projection eventual.
16. Security/redaction/deletion harus dipropagasi ke read model.
17. Read model schema perlu versioning dan ownership.
18. BI/reporting views adalah data contracts.
19. CQRS-style read models bisa digunakan tanpa full event sourcing.
20. Operational metrics seperti lag, refresh duration, and drift sangat penting.

Kalimat inti:

> View menyederhanakan cara membaca, materialized view mempercepat dengan menyimpan hasil, dan read model mengubah bentuk data untuk konsumen; ketiganya hanya sehat jika grain, freshness, source of truth, dan rebuild strategy jelas.

---

## 63. Referensi

1. PostgreSQL Documentation — Views.  
   https://www.postgresql.org/docs/current/sql-createview.html

2. PostgreSQL Documentation — Materialized Views.  
   https://www.postgresql.org/docs/current/rules-materializedviews.html

3. PostgreSQL Documentation — REFRESH MATERIALIZED VIEW.  
   https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html

4. PostgreSQL Documentation — Row Security Policies.  
   https://www.postgresql.org/docs/current/ddl-rowsecurity.html

5. PostgreSQL Documentation — Indexes.  
   https://www.postgresql.org/docs/current/indexes.html

6. MySQL 8.4 Reference Manual — CREATE VIEW.  
   https://dev.mysql.com/doc/refman/8.4/en/create-view.html

7. SQL Server Documentation — Views.  
   https://learn.microsoft.com/en-us/sql/relational-databases/views/views

8. SQL Server Documentation — Indexed Views.  
   https://learn.microsoft.com/en-us/sql/relational-databases/views/create-indexed-views

9. Oracle Database Documentation — Views and Materialized Views.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/CREATE-VIEW.html  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/CREATE-MATERIALIZED-VIEW.html

10. Martin Fowler — CQRS.  
    https://martinfowler.com/bliki/CQRS.html

---

## 64. Status Seri

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-023.md` — Temporal Data, Auditability, and Historical Truth

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-021.md">⬅️ Part 21 — Stored Procedures, Functions, Triggers, and Database-Side Logic</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-023.md">Part 23 — Temporal Data, Auditability, and Historical Truth ➡️</a>
</div>

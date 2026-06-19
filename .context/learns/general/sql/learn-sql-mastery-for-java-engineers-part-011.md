# learn-sql-mastery-for-java-engineers-part-011.md

# Part 11 — Data Modification: INSERT, UPDATE, DELETE, UPSERT, MERGE

> Seri: SQL Mastery for Java Engineers  
> Bagian: 011 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-010.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-012.md`

---

## 0. Tujuan Bagian Ini

Sepuluh bagian sebelumnya membangun fondasi read/query power:

- relational thinking
- tipe data dan `NULL`
- `SELECT`
- filtering
- joins
- aggregation
- subquery/CTE
- set operations
- window functions

Sekarang kita masuk ke sisi lain SQL yang sama pentingnya: **mengubah data**.

Data modification bukan sekadar:

```sql
INSERT INTO ...
UPDATE ...
DELETE ...
```

Di production system, write query adalah tempat correctness diuji secara nyata.

Ketika kamu mengubah data, kamu menyentuh:

- business invariant
- transaction boundary
- concurrency
- locking
- idempotency
- auditability
- retry semantics
- affected rows
- constraint violation
- replication
- trigger
- index maintenance
- event/outbox
- Java exception mapping
- partial failure
- operational safety

Contoh sederhana:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id;
```

Terlihat mudah. Tapi senior engineer akan bertanya:

```text
Apakah case boleh dieskalasi dari semua status?
Apakah transition history ditulis atomically?
Apakah affected row dicek?
Apakah ada concurrent update?
Apakah user authorized?
Apakah update idempotent?
Apakah audit event dibuat?
Apakah status valid secara constraint?
Apakah retry aman?
Apakah ada outbox event?
Apakah update ini bisa mass update karena WHERE salah?
```

Bagian ini bertujuan membangun mental model write path SQL yang aman, bukan hanya tahu syntax.

---

## 1. Big Picture: DML Mengubah Fakta

DML utama:

```sql
INSERT
UPDATE
DELETE
MERGE
```

Vendor-specific/related:

```sql
UPSERT
ON CONFLICT
ON DUPLICATE KEY UPDATE
RETURNING
OUTPUT
INSERT ... SELECT
UPDATE ... FROM
DELETE ... USING
TRUNCATE
```

Secara relasional:

- `INSERT` menambah fakta.
- `UPDATE` mengganti fakta lama dengan fakta baru.
- `DELETE` menghapus fakta.
- `UPSERT/MERGE` memilih insert atau update berdasarkan match.

Secara engineering:

- setiap write harus konsisten dengan domain
- setiap write harus aman terhadap concurrency
- setiap write harus observable
- setiap write harus punya failure semantics
- setiap write harus dipikirkan dalam transaksi

---

## 2. Contoh Schema

Kita pakai domain regulatory/case-management.

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    case_number TEXT NOT NULL,
    case_number_normalized TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT uq_cases_tenant_case_number
    UNIQUE (tenant_id, case_number_normalized),

    CONSTRAINT ck_cases_status_valid
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')),

    CONSTRAINT ck_cases_priority_valid
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),

    CONSTRAINT ck_cases_time_order
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE case_status_transitions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL,
    transitioned_by UUID NOT NULL,
    reason TEXT
);

CREATE TABLE case_notes (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,

    CHECK (length(trim(note_text)) > 0)
);

CREATE TABLE case_external_refs (
    tenant_id UUID NOT NULL,
    source_system TEXT NOT NULL,
    source_case_id TEXT NOT NULL,
    case_id UUID NOT NULL REFERENCES cases(id),
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant_id, source_system, source_case_id)
);
```

---

## 3. INSERT: Menambah Fakta Baru

Basic insert:

```sql
INSERT INTO cases (
    id,
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized,
    status,
    priority,
    opened_at
)
VALUES (
    :id,
    :tenant_id,
    :jurisdiction_code,
    :case_number,
    :case_number_normalized,
    'OPEN',
    'NORMAL',
    :opened_at
);
```

Statement ini menambah fakta:

```text
A new case exists with this identity, tenant, number, status, priority, and opened_at.
```

### 3.1 Apa yang Terjadi Saat INSERT

Database dapat melakukan:

- type validation
- not null check
- check constraint validation
- primary key uniqueness check
- unique constraint validation
- foreign key validation
- default value evaluation
- generated column computation
- trigger execution
- index insertion
- WAL/redo logging
- lock acquisition
- transaction visibility setup
- replication stream generation

Jadi `INSERT` bukan hanya “append row”.

---

## 4. INSERT dan Column List

Selalu tulis column list.

Buruk:

```sql
INSERT INTO cases
VALUES (:id, :tenant_id, :jurisdiction_code, :case_number, ...);
```

Lebih baik:

```sql
INSERT INTO cases (
    id,
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized,
    status,
    priority,
    opened_at
)
VALUES (
    :id,
    :tenant_id,
    :jurisdiction_code,
    :case_number,
    :case_number_normalized,
    :status,
    :priority,
    :opened_at
);
```

Kenapa?

- schema evolution lebih aman
- column order tidak menjadi hidden dependency
- review lebih mudah
- migration menambah column tidak merusak insert lama jika ada default/nullability
- intent jelas
- cocok dengan generated/default columns

---

## 5. DEFAULT Values

Schema:

```sql
status TEXT NOT NULL DEFAULT 'OPEN',
priority TEXT NOT NULL DEFAULT 'NORMAL',
opened_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Insert:

```sql
INSERT INTO cases (
    id,
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized
)
VALUES (
    :id,
    :tenant_id,
    :jurisdiction_code,
    :case_number,
    :case_number_normalized
);
```

Defaults berguna untuk:

- reduce boilerplate
- centralize safe defaults
- improve migration compatibility
- avoid nulls

Namun jangan menyembunyikan domain decision penting.

Jika `opened_at` harus berasal dari external event time, jangan default `now()` secara sembarangan.

---

## 6. INSERT ... RETURNING / OUTPUT

Beberapa vendor mendukung mengembalikan row setelah insert.

PostgreSQL:

```sql
INSERT INTO cases (
    id,
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized,
    status,
    priority,
    opened_at
)
VALUES (
    gen_random_uuid(),
    :tenant_id,
    :jurisdiction_code,
    :case_number,
    :case_number_normalized,
    'OPEN',
    'NORMAL',
    now()
)
RETURNING
    id,
    status,
    opened_at;
```

SQL Server punya `OUTPUT`.

Manfaat:

- ambil generated ID
- ambil default/generated values
- atomic write + read
- menghindari query tambahan
- memastikan value yang dibaca sama dengan yang ditulis

Dalam Java, ini berguna untuk create command response.

---

## 7. INSERT ... SELECT

`INSERT ... SELECT` membuat rows baru dari hasil query.

Contoh snapshot:

```sql
INSERT INTO case_daily_snapshots (
    snapshot_date,
    tenant_id,
    case_id,
    status,
    priority
)
SELECT
    CURRENT_DATE,
    tenant_id,
    id,
    status,
    priority
FROM cases
WHERE tenant_id = :tenant_id;
```

Risiko:

- duplicate snapshot jika job rerun
- banyak row sekaligus
- lock/index overhead
- replication lag
- transaction log besar
- partial failure jika tidak transactional
- query source berubah jika isolation tidak dipahami

### 7.1 Idempotent Snapshot

Gunakan unique key:

```sql
CREATE TABLE case_daily_snapshots (
    snapshot_date DATE NOT NULL,
    tenant_id UUID NOT NULL,
    case_id UUID NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,

    PRIMARY KEY (snapshot_date, tenant_id, case_id)
);
```

PostgreSQL-style:

```sql
INSERT INTO case_daily_snapshots (
    snapshot_date,
    tenant_id,
    case_id,
    status,
    priority
)
SELECT
    :snapshot_date,
    tenant_id,
    id,
    status,
    priority
FROM cases
WHERE tenant_id = :tenant_id
ON CONFLICT (snapshot_date, tenant_id, case_id)
DO UPDATE
SET
    status = EXCLUDED.status,
    priority = EXCLUDED.priority;
```

Now rerun is safe according to chosen semantics.

---

## 8. Batch INSERT

Java often inserts many rows.

Options:

- JDBC batch
- multi-values insert
- copy/bulk load
- staging table then merge
- ORM batching
- database-specific bulk API

Multi-values:

```sql
INSERT INTO case_notes (
    id,
    tenant_id,
    case_id,
    note_text,
    created_at,
    created_by
)
VALUES
    (:id1, :tenant1, :case1, :text1, :created1, :user1),
    (:id2, :tenant2, :case2, :text2, :created2, :user2);
```

For large imports, prefer staging table:

```text
load raw data -> validate -> transform -> insert/merge into target
```

Staging helps:

- validation
- reconciliation
- error reporting
- idempotency
- partial acceptance
- auditability
- retry

---

## 9. UPDATE: Mengubah Fakta

Basic update:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE id = :case_id;
```

This changes fact:

```text
case priority is now HIGH
```

### 9.1 Always Think: Which Rows?

Before writing update, ask:

```text
How many rows should this update affect?
0?
1?
many?
```

For command update by primary key:

```text
expected affected rows: 1
```

For idempotent no-op:

```text
0 or 1 may be acceptable
```

For batch maintenance:

```text
many expected, but count must be estimated and monitored
```

---

## 10. Conditional UPDATE as Concurrency Guard

Bad:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id;
```

Better:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';
```

This is a compare-and-set style update.

Affected rows:

```text
1 -> success
0 -> case not found or not currently UNDER_REVIEW
```

This avoids blindly overwriting state changed by another transaction.

### 10.1 Java Handling

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET status = ?
    WHERE id = ?
      AND status = ?
""", "ESCALATED", caseId, "UNDER_REVIEW");

if (updated == 0) {
    throw new CaseStateConflictException(caseId);
}
if (updated > 1) {
    throw new IllegalStateException("Primary key invariant violated");
}
```

Affected row count is a correctness signal.

---

## 11. UPDATE ... RETURNING

PostgreSQL:

```sql
UPDATE cases
SET
    status = 'ESCALATED',
    version = version + 1
WHERE id = :case_id
  AND status = 'UNDER_REVIEW'
RETURNING
    id,
    status,
    version;
```

Benefits:

- atomic update + return
- know exactly what was updated
- avoid second select
- return version for optimistic locking
- produce outbox payload in same transaction

SQL Server `OUTPUT` can serve similar purpose.

---

## 12. Optimistic Locking with Version Column

Schema:

```sql
version BIGINT NOT NULL DEFAULT 0
```

Update:

```sql
UPDATE cases
SET
    priority = :new_priority,
    version = version + 1
WHERE id = :case_id
  AND version = :expected_version;
```

Affected rows:

```text
1 -> success
0 -> stale update / not found
```

This is common in Java/JPA.

Caveat:

- version protects row-level lost update
- does not automatically protect cross-row invariants
- requires clients to pass expected version
- retry may need reload/merge
- not replacement for unique constraints

---

## 13. UPDATE with Multiple Columns

```sql
UPDATE cases
SET
    priority = :priority,
    status = :status,
    closed_at = :closed_at,
    version = version + 1
WHERE id = :case_id
  AND version = :expected_version;
```

Danger:

If application sends stale/null fields, it can overwrite data unintentionally.

Patterns:

- patch only changed fields
- use optimistic locking
- use command-specific update statements
- avoid generic “save entire entity” for critical workflows
- validate transitions

For business commands, explicit update is often better:

```sql
UPDATE cases
SET
    status = 'CLOSED',
    closed_at = :closed_at,
    version = version + 1
WHERE id = :case_id
  AND status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED');
```

---

## 14. UPDATE with JOIN / FROM

PostgreSQL-style:

```sql
UPDATE cases c
SET priority = 'CRITICAL'
FROM case_risk_scores r
WHERE r.case_id = c.id
  AND r.score >= 90
  AND c.tenant_id = :tenant_id;
```

MySQL-style:

```sql
UPDATE cases c
JOIN case_risk_scores r
  ON r.case_id = c.id
SET c.priority = 'CRITICAL'
WHERE r.score >= 90
  AND c.tenant_id = :tenant_id;
```

Vendor syntax differs.

### 14.1 Dangers

- join can match multiple rows per target
- update value may be non-deterministic if multiple source rows
- mass update risk
- missing tenant predicate
- locking many rows
- replication lag
- trigger/index overhead

If source can duplicate target, pre-aggregate/deduplicate source first.

```sql
WITH latest_scores AS (
    SELECT
        case_id,
        MAX(score) AS max_score
    FROM case_risk_scores
    GROUP BY case_id
)
UPDATE cases c
SET priority = 'CRITICAL'
FROM latest_scores s
WHERE s.case_id = c.id
  AND s.max_score >= 90;
```

---

## 15. Safe State Transition Pattern

Requirement:

> Escalate case from UNDER_REVIEW to ESCALATED and write transition history atomically.

Bad:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id;

INSERT INTO case_status_transitions (...)
VALUES (...);
```

If first succeeds and second fails, state/history inconsistent.

### 15.1 Transactional Pattern

```sql
BEGIN;

UPDATE cases
SET
    status = 'ESCALATED',
    version = version + 1
WHERE id = :case_id
  AND tenant_id = :tenant_id
  AND status = 'UNDER_REVIEW';

-- application checks affected rows = 1

INSERT INTO case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
VALUES (
    :transition_id,
    :tenant_id,
    :case_id,
    'UNDER_REVIEW',
    'ESCALATED',
    :transitioned_at,
    :user_id,
    :reason
);

COMMIT;
```

Need application ensure insert only happens if update succeeded.

### 15.2 CTE Pattern

PostgreSQL-style:

```sql
WITH updated_case AS (
    UPDATE cases
    SET
        status = 'ESCALATED',
        version = version + 1
    WHERE id = :case_id
      AND tenant_id = :tenant_id
      AND status = 'UNDER_REVIEW'
    RETURNING id, tenant_id
)
INSERT INTO case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
SELECT
    :transition_id,
    tenant_id,
    id,
    'UNDER_REVIEW',
    'ESCALATED',
    :transitioned_at,
    :user_id,
    :reason
FROM updated_case;
```

Then check inserted row count.

If inserted rows = 0, transition did not happen.

This pattern connects state update and history insert.

---

## 16. DELETE: Menghapus Fakta

Basic delete:

```sql
DELETE FROM case_notes
WHERE id = :note_id;
```

Hard delete physically removes row.

Before hard delete, ask:

```text
Is this allowed by domain?
What about audit?
What about legal retention?
What about foreign keys?
What about backups?
What about reporting?
What about restore?
```

In regulatory/case-management systems, hard delete is often restricted.

---

## 17. Soft Delete

Soft delete uses marker:

```sql
UPDATE case_notes
SET
    deleted_at = now(),
    deleted_by = :user_id
WHERE id = :note_id
  AND deleted_at IS NULL;
```

Advantages:

- recoverable
- audit-friendly
- preserves references
- avoids FK cascade surprises
- can support legal hold

Disadvantages:

- every query must filter `deleted_at IS NULL`
- unique constraints become more complex
- table grows
- privacy deletion not satisfied
- indexes need partial strategies
- business semantics can get messy

### 17.1 Soft Delete Query

```sql
SELECT
    id,
    note_text,
    created_at
FROM case_notes
WHERE case_id = :case_id
  AND deleted_at IS NULL
ORDER BY created_at DESC;
```

### 17.2 Partial Unique with Soft Delete

PostgreSQL-style:

```sql
CREATE UNIQUE INDEX uq_active_case_note_external_ref
ON case_notes (tenant_id, external_note_id)
WHERE deleted_at IS NULL;
```

If you soft-delete, uniqueness rules must be explicit.

---

## 18. DELETE with WHERE Safety

Never run delete without confidence in predicate.

Danger:

```sql
DELETE FROM case_notes;
```

Safe manual pattern:

```sql
BEGIN;

SELECT COUNT(*)
FROM case_notes
WHERE created_at < :retention_cutoff
  AND deleted_at IS NOT NULL;

DELETE FROM case_notes
WHERE created_at < :retention_cutoff
  AND deleted_at IS NOT NULL;

-- check affected rows

COMMIT;
```

For large deletes, batch.

```sql
DELETE FROM case_notes
WHERE id IN (
    SELECT id
    FROM case_notes
    WHERE created_at < :retention_cutoff
      AND deleted_at IS NOT NULL
    ORDER BY created_at
    LIMIT 1000
);
```

Repeat in controlled job.

---

## 19. Cascading Deletes

Foreign key can define:

```sql
ON DELETE CASCADE
ON DELETE RESTRICT
ON DELETE SET NULL
```

### 19.1 ON DELETE CASCADE

Deleting parent deletes children.

Powerful but dangerous.

```sql
FOREIGN KEY (case_id)
REFERENCES cases(id)
ON DELETE CASCADE
```

If someone deletes a case, all evidence/notes/transitions may be deleted.

In audit-heavy systems, this may be unacceptable.

### 19.2 ON DELETE RESTRICT

Prevents deleting parent while children exist.

Often safer for core business records.

### 19.3 ON DELETE SET NULL

Sets child FK to NULL.

Can create orphan-like rows unless domain supports optional parent.

Principle:

> Cascade behavior is business policy, not technical convenience.

---

## 20. TRUNCATE

`TRUNCATE` removes all rows quickly.

```sql
TRUNCATE TABLE staging_cases;
```

Good for staging/temp tables.

Dangerous for business tables.

Considerations:

- stronger locks
- trigger behavior differs
- identity reset options
- FK restrictions
- transaction behavior differs by vendor
- no row-level audit
- huge irreversible blast radius if wrong table

Use only when table purpose allows it.

---

## 21. UPSERT

UPSERT means:

```text
insert if absent, update if present
```

Use cases:

- idempotent imports
- external references
- cache table
- summary table
- last-seen timestamps
- reference data sync
- idempotent command handling

PostgreSQL:

```sql
INSERT INTO case_external_refs (
    tenant_id,
    source_system,
    source_case_id,
    case_id,
    first_seen_at,
    last_seen_at
)
VALUES (
    :tenant_id,
    :source_system,
    :source_case_id,
    :case_id,
    :seen_at,
    :seen_at
)
ON CONFLICT (tenant_id, source_system, source_case_id)
DO UPDATE
SET last_seen_at = EXCLUDED.last_seen_at;
```

Conflict target must match unique constraint/index.

---

## 22. UPSERT and Idempotency

Suppose external system retries same event.

Without idempotency key:

```sql
INSERT INTO cases (...)
```

can duplicate.

With external reference:

```sql
PRIMARY KEY (tenant_id, source_system, source_case_id)
```

The database becomes arbiter.

### 22.1 Idempotent Command Table

```sql
CREATE TABLE processed_commands (
    tenant_id UUID NOT NULL,
    command_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL,
    result_case_id UUID,

    PRIMARY KEY (tenant_id, command_id)
);
```

Process command:

```sql
INSERT INTO processed_commands (
    tenant_id,
    command_id,
    processed_at
)
VALUES (
    :tenant_id,
    :command_id,
    now()
)
ON CONFLICT (tenant_id, command_id)
DO NOTHING;
```

If inserted row count = 1, process command.

If 0, already processed.

Need transaction design around it.

---

## 23. UPSERT Pitfalls

### 23.1 Updating Too Much

```sql
ON CONFLICT (...) DO UPDATE
SET
    case_id = EXCLUDED.case_id,
    first_seen_at = EXCLUDED.first_seen_at,
    last_seen_at = EXCLUDED.last_seen_at;
```

This overwrites `first_seen_at`, maybe wrong.

Better:

```sql
SET last_seen_at = GREATEST(case_external_refs.last_seen_at, EXCLUDED.last_seen_at)
```

### 23.2 Conflict Does Not Mean Same Meaning

Conflict on email may mean same user or data collision.

Before upsert, define identity semantics.

### 23.3 Upsert Race Behavior

UPSERT handles insert/update race on unique key, but update logic must still be correct.

### 23.4 Upsert with Stale Data

If external event older than existing state, should it update?

Use condition:

```sql
ON CONFLICT (...) DO UPDATE
SET
    last_seen_at = EXCLUDED.last_seen_at
WHERE case_external_refs.last_seen_at < EXCLUDED.last_seen_at;
```

---

## 24. MERGE

`MERGE` is standard-ish and vendor-supported with differences.

Generic form:

```sql
MERGE INTO target_table target
USING source_table source
ON target.key = source.key
WHEN MATCHED THEN
    UPDATE SET ...
WHEN NOT MATCHED THEN
    INSERT (...) VALUES (...);
```

Example:

```sql
MERGE INTO case_external_refs target
USING staging_case_external_refs source
ON (
    target.tenant_id = source.tenant_id
    AND target.source_system = source.source_system
    AND target.source_case_id = source.source_case_id
)
WHEN MATCHED THEN
    UPDATE SET last_seen_at = source.seen_at
WHEN NOT MATCHED THEN
    INSERT (
        tenant_id,
        source_system,
        source_case_id,
        case_id,
        first_seen_at,
        last_seen_at
    )
    VALUES (
        source.tenant_id,
        source.source_system,
        source.source_case_id,
        source.case_id,
        source.seen_at,
        source.seen_at
    );
```

### 24.1 MERGE Pitfalls

- source duplicates can cause errors or unexpected behavior
- concurrency semantics differ by vendor
- trigger behavior differs
- matched conditions can be complex
- not always safer than explicit insert/update
- hard to reason about with multiple `WHEN` clauses
- can accidentally update many rows if `ON` predicate incomplete

Before `MERGE`, validate source uniqueness:

```sql
SELECT
    tenant_id,
    source_system,
    source_case_id,
    COUNT(*)
FROM staging_case_external_refs
GROUP BY tenant_id, source_system, source_case_id
HAVING COUNT(*) > 1;
```

---

## 25. Affected Rows as Domain Signal

Every DML returns affected row count.

For command writes, affected rows are part of correctness.

### 25.1 Insert

```text
1 -> inserted
0 -> do nothing/upsert no-op maybe
error -> constraint violation etc.
```

### 25.2 Update by ID

```text
1 -> success
0 -> not found/stale state/not authorized
>1 -> severe invariant issue
```

### 25.3 Delete by ID

```text
1 -> deleted
0 -> already deleted/not found/not authorized
```

### 25.4 Batch Update

```text
N -> compare with expected count
```

Java must not ignore affected rows for critical commands.

---

## 26. Constraint Violations as Business Signals

Database errors are not just technical.

Examples:

- unique violation -> duplicate business key/idempotency conflict
- foreign key violation -> referenced entity missing
- check violation -> invalid domain value
- not-null violation -> missing required field
- exclusion constraint violation -> overlapping time range
- serialization failure -> concurrency retry needed
- deadlock -> retry possibly needed
- lock timeout -> operational contention

Map to domain/application errors.

Example:

```text
uq_cases_tenant_case_number violated
-> Case number already exists in tenant
```

Name constraints clearly.

```sql
CONSTRAINT uq_cases_tenant_case_number
UNIQUE (tenant_id, case_number_normalized)
```

Good names make exception mapping easier.

---

## 27. Transaction Boundary for Multi-Statement Writes

If operation needs multiple writes, use transaction.

Example close case:

1. update `cases`
2. insert transition
3. insert audit event
4. insert outbox event

All should commit or rollback together.

```sql
BEGIN;

UPDATE cases ...;

INSERT INTO case_status_transitions ...;

INSERT INTO audit_events ...;

INSERT INTO outbox_events ...;

COMMIT;
```

In Spring:

```java
@Transactional
public void closeCase(CloseCaseCommand command) {
    caseRepository.close(...);
    transitionRepository.insert(...);
    auditRepository.insert(...);
    outboxRepository.insert(...);
}
```

Caveats:

- self-invocation may bypass proxy
- checked exceptions rollback rules need config
- async calls outside transaction
- multiple data sources need special handling
- external side effects should not happen inside DB transaction unless carefully designed

---

## 28. Outbox Pattern Preview

Do not do this inside transaction:

```text
1. update database
2. send Kafka message
3. commit database
```

If message send succeeds but DB commit fails, inconsistency.

If DB commit succeeds but message send fails, inconsistency.

Outbox pattern:

```sql
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);
```

In same DB transaction:

```sql
UPDATE cases ...;

INSERT INTO outbox_events (...);
```

Separate publisher reads unpublished outbox rows and sends messages.

This will be deeper in architecture/transaction sections, but DML write path should be outbox-aware.

---

## 29. Safe Bulk UPDATE

Bulk updates are dangerous.

Example:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE risk_score >= 80;
```

Before running:

```sql
SELECT COUNT(*)
FROM cases
WHERE risk_score >= 80;
```

Batch if large:

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

Repeat until 0.

Benefits:

- smaller transactions
- less lock duration
- less replication lag
- easier monitoring
- can pause
- less rollback pain

Need careful ordering and idempotent predicate.

---

## 30. Safe Bulk INSERT from Staging

Flow:

1. load staging
2. validate staging
3. reject/mark invalid rows
4. dedupe source
5. insert valid rows
6. reconcile counts
7. mark batch complete

Example:

```sql
INSERT INTO cases (
    id,
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized,
    status,
    priority,
    opened_at
)
SELECT
    gen_random_uuid(),
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized,
    'OPEN',
    'NORMAL',
    opened_at
FROM staging_cases s
WHERE batch_id = :batch_id
  AND validation_status = 'VALID'
ON CONFLICT (tenant_id, case_number_normalized)
DO NOTHING;
```

Then compare:

```sql
SELECT COUNT(*)
FROM staging_cases
WHERE batch_id = :batch_id
  AND validation_status = 'VALID';
```

with inserted/known existing counts.

---

## 31. Idempotent Writes

A write is idempotent if repeating it has the same final effect.

Examples:

Idempotent:

```sql
UPDATE cases
SET priority = 'HIGH'
WHERE id = :id
  AND priority <> 'HIGH';
```

Final priority is HIGH.

Not idempotent:

```sql
UPDATE counters
SET value = value + 1
WHERE id = :id;
```

Repeating increments again.

Idempotency is crucial for:

- retries
- message processing
- imports
- API commands
- distributed systems
- timeout ambiguity
- job restarts

### 31.1 Idempotent Event Processing

```sql
INSERT INTO processed_events (
    event_id,
    processed_at
)
VALUES (
    :event_id,
    now()
)
ON CONFLICT (event_id)
DO NOTHING;
```

Only process if insert succeeds.

---

## 32. Retry Semantics

Some errors are retryable:

- serialization failure
- deadlock
- lock timeout, sometimes
- transient connection failure, with ambiguity
- failover

Some errors are not retryable without change:

- check constraint violation
- not null violation
- invalid type
- permission denied
- duplicate key for non-idempotent command

Retrying non-idempotent write can duplicate effects.

Design retries with:

- idempotency key
- unique constraints
- transaction retry boundary
- exponential backoff
- max attempts
- observability
- domain-safe command semantics

---

## 33. Write Skew and Cross-Row Invariants Preview

Some invariants span multiple rows.

Example:

> At most one active primary assignment per case.

Bad approach:

```sql
SELECT COUNT(*)
FROM case_assignments
WHERE case_id = :case_id
  AND assignment_role = 'PRIMARY'
  AND ended_at IS NULL;

-- if count = 0
INSERT ...
```

Concurrent transactions can both see 0 and insert.

Better database invariant:

```sql
CREATE UNIQUE INDEX uq_case_assignments_one_active_primary
ON case_assignments (case_id)
WHERE assignment_role = 'PRIMARY'
  AND ended_at IS NULL;
```

DML should rely on constraints for cross-request concurrency safety.

---

## 34. INSERT vs UPDATE for Events

For audit/event/history, prefer append-only insert.

Bad audit:

```sql
UPDATE case_status_history
SET to_status = 'ESCALATED'
WHERE case_id = :case_id;
```

Better:

```sql
INSERT INTO case_status_transitions (
    id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by
)
VALUES (...);
```

Append-only events provide:

- historical truth
- auditability
- temporal analysis
- easier reconciliation
- less overwrite risk

But append-only table can grow large and needs retention/index strategy.

---

## 35. UPDATE Current State + INSERT History

Common pattern:

```text
current state table + history table
```

Example:

```sql
cases.current_status
case_status_transitions history
```

Close case:

```sql
BEGIN;

UPDATE cases
SET
    status = 'CLOSED',
    closed_at = :closed_at,
    version = version + 1
WHERE id = :case_id
  AND tenant_id = :tenant_id
  AND status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED');

INSERT INTO case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
VALUES (
    :transition_id,
    :tenant_id,
    :case_id,
    :from_status,
    'CLOSED',
    :closed_at,
    :user_id,
    :reason
);

COMMIT;
```

Issue:

`:from_status` must match actual previous status.

Safer with `RETURNING`:

```sql
WITH updated_case AS (
    UPDATE cases
    SET
        status = 'CLOSED',
        closed_at = :closed_at,
        version = version + 1
    WHERE id = :case_id
      AND tenant_id = :tenant_id
      AND status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
    RETURNING id, tenant_id, status AS new_status
)
SELECT * FROM updated_case;
```

But to capture old status, vendor-specific techniques may be needed.

Alternative: select row `FOR UPDATE`, then update/insert.

```sql
BEGIN;

SELECT status
FROM cases
WHERE id = :case_id
  AND tenant_id = :tenant_id
FOR UPDATE;

-- app validates and stores old status

UPDATE cases ...

INSERT transition with old status

COMMIT;
```

Part 019–020 will deepen locking/isolation.

---

## 36. SELECT FOR UPDATE Preview

When update logic requires reading current state first:

```sql
BEGIN;

SELECT
    id,
    status,
    version
FROM cases
WHERE id = :case_id
FOR UPDATE;

-- application decides

UPDATE cases
SET ...
WHERE id = :case_id;

COMMIT;
```

`FOR UPDATE` locks selected row until transaction ends.

Use when:

- logic cannot be expressed as conditional update
- multiple fields decide transition
- need old value for history
- must serialize updates to row

Avoid holding locks while doing slow external calls.

Never:

```text
BEGIN
SELECT FOR UPDATE
call external API
UPDATE
COMMIT
```

This holds DB lock during network call.

---

## 37. Java/JDBC Write Patterns

### 37.1 Prepared Statement

```java
int updated = jdbcTemplate.update("""
    UPDATE cases
    SET priority = ?
    WHERE id = ?
""", priority.name(), caseId);
```

### 37.2 Named Parameters

```java
int updated = namedParameterJdbcTemplate.update("""
    UPDATE cases
    SET priority = :priority
    WHERE id = :caseId
""", params);
```

### 37.3 Check Row Count

```java
if (updated != 1) {
    throw new CaseNotFoundException(caseId);
}
```

But distinguish:

- not found
- stale state
- unauthorized
- already applied
- conflict

Sometimes separate query or returning result helps.

---

## 38. ORM Write Pitfalls

JPA/Hibernate can generate DML for you.

Pitfalls:

- dirty checking updates too many columns
- lost update if no version column
- flush timing surprises
- batch updates bypass persistence context
- bulk JPQL update bypasses entity lifecycle callbacks
- database defaults not reflected unless refreshed
- constraint violation appears at flush/commit time
- N+1 writes
- cascade delete surprises
- orphan removal deletes unexpectedly
- optimistic lock exception handling incomplete

For critical state transitions, explicit SQL or carefully designed repository methods can be safer.

---

## 39. Bulk DML and Persistence Context

JPQL bulk update:

```java
@Modifying
@Query("""
    update Case c
    set c.priority = :priority
    where c.riskScore >= :threshold
""")
int updatePriority(...);
```

Bulk DML often bypasses loaded entity state.

If same entities are in persistence context, Java objects may become stale.

Need:

- clear persistence context
- refresh
- avoid mixing bulk update with loaded entities
- use transaction boundaries carefully

This is ORM-specific but important for Java engineers.

---

## 40. Write Query Review Checklist

```text
[ ] What business fact changes?
[ ] Expected affected rows?
[ ] Is WHERE selective and safe?
[ ] Is tenant/authorization included?
[ ] Is transition guarded by current state?
[ ] Are affected rows checked?
[ ] Are constraints relied on for concurrency safety?
[ ] Is operation idempotent or protected by idempotency key?
[ ] Is transaction boundary correct?
[ ] Are history/audit/outbox rows written atomically?
[ ] Are external side effects outside transaction handled?
[ ] Are retry semantics defined?
[ ] Are constraint violations mapped to domain errors?
[ ] Could this write create duplicate/orphan/invalid state?
[ ] Is bulk write batched?
[ ] Are indexes impacted?
[ ] Could this cause lock contention or replication lag?
```

---

## 41. INSERT Checklist

```text
[ ] Column list explicit?
[ ] Required fields NOT NULL?
[ ] Business unique constraints present?
[ ] Foreign keys present?
[ ] Defaults intentional?
[ ] Generated IDs strategy clear?
[ ] Idempotency key needed?
[ ] Duplicate handling defined?
[ ] RETURNING/OUTPUT useful?
[ ] Batch size controlled?
[ ] Staging needed for import?
```

---

## 42. UPDATE Checklist

```text
[ ] WHERE includes primary key or intended filter?
[ ] Current state guard needed?
[ ] Version guard needed?
[ ] Affected rows checked?
[ ] Old value needed for history?
[ ] Update can be expressed atomically?
[ ] Update joins source with unique target?
[ ] Multiple source matches impossible?
[ ] Update avoids overwriting stale fields?
[ ] Bulk update batched?
```

---

## 43. DELETE Checklist

```text
[ ] Hard delete allowed?
[ ] Soft delete better?
[ ] Retention/legal hold considered?
[ ] FK cascade behavior understood?
[ ] WHERE validated with SELECT count?
[ ] Large delete batched?
[ ] Audit required?
[ ] Restore strategy?
[ ] Unique constraints with soft delete adjusted?
```

---

## 44. UPSERT/MERGE Checklist

```text
[ ] What is the conflict/match key?
[ ] Is unique constraint present?
[ ] Insert semantics clear?
[ ] Update semantics clear?
[ ] Should first_seen_at be preserved?
[ ] Should stale incoming data be ignored?
[ ] Is source deduplicated?
[ ] Is update idempotent?
[ ] Are affected rows interpreted correctly?
[ ] Is vendor-specific behavior understood?
```

---

## 45. Mini Case Study: Create Case Idempotently from External System

Requirement:

> Import case from external source. Retrying same source case must not create duplicate.

Approach:

1. Insert case if external ref absent.
2. Store external ref unique key.
3. Handle conflict.

Simplified PostgreSQL-style transaction:

```sql
BEGIN;

INSERT INTO cases (
    id,
    tenant_id,
    jurisdiction_code,
    case_number,
    case_number_normalized,
    status,
    priority,
    opened_at
)
VALUES (
    :case_id,
    :tenant_id,
    :jurisdiction_code,
    :case_number,
    :case_number_normalized,
    'OPEN',
    'NORMAL',
    :opened_at
)
ON CONFLICT (tenant_id, case_number_normalized)
DO NOTHING;

INSERT INTO case_external_refs (
    tenant_id,
    source_system,
    source_case_id,
    case_id,
    first_seen_at,
    last_seen_at
)
VALUES (
    :tenant_id,
    :source_system,
    :source_case_id,
    :case_id,
    :seen_at,
    :seen_at
)
ON CONFLICT (tenant_id, source_system, source_case_id)
DO UPDATE
SET last_seen_at = EXCLUDED.last_seen_at;

COMMIT;
```

Nuance:

- If case insert conflicts on case_number but external ref points to different case_id, need resolve.
- Safer flow often checks external ref first.
- Unique constraints are central.
- Domain identity must be defined clearly.

---

## 46. Mini Case Study: Close Case Safely

Requirement:

> Close case only if currently open/under review/escalated. Write history and outbox event.

```sql
BEGIN;

SELECT
    id,
    status
FROM cases
WHERE id = :case_id
  AND tenant_id = :tenant_id
FOR UPDATE;

-- application validates status and stores old_status

UPDATE cases
SET
    status = 'CLOSED',
    closed_at = :closed_at,
    version = version + 1
WHERE id = :case_id
  AND tenant_id = :tenant_id;

INSERT INTO case_status_transitions (
    id,
    tenant_id,
    case_id,
    from_status,
    to_status,
    transitioned_at,
    transitioned_by,
    reason
)
VALUES (
    :transition_id,
    :tenant_id,
    :case_id,
    :old_status,
    'CLOSED',
    :closed_at,
    :user_id,
    :reason
);

INSERT INTO outbox_events (
    id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    created_at
)
VALUES (
    :outbox_id,
    'CASE',
    :case_id,
    'CASE_CLOSED',
    :payload_json,
    now()
);

COMMIT;
```

Important:

- no external call while lock held
- transaction small
- old status captured under lock
- outbox in same transaction
- application handles not found/invalid state

---

## 47. Mini Case Study: Soft Delete Note

Requirement:

> User can delete their own note if case not closed.

```sql
UPDATE case_notes n
SET
    deleted_at = now(),
    deleted_by = :user_id
WHERE n.id = :note_id
  AND n.tenant_id = :tenant_id
  AND n.created_by = :user_id
  AND n.deleted_at IS NULL
  AND EXISTS (
      SELECT 1
      FROM cases c
      WHERE c.id = n.case_id
        AND c.tenant_id = n.tenant_id
        AND c.status <> 'CLOSED'
  );
```

Affected rows:

```text
1 -> deleted
0 -> not found, not owner, already deleted, or case closed
```

If user-facing error needs distinguish reasons, query/read separately or return more detail with vendor-specific constructs.

---

## 48. Mini Case Study: Recalculate Priority in Batches

Requirement:

> Set priority CRITICAL for cases with risk_score >= 90, without massive transaction.

Batch update:

```sql
UPDATE cases
SET priority = 'CRITICAL'
WHERE id IN (
    SELECT id
    FROM cases
    WHERE risk_score >= 90
      AND priority <> 'CRITICAL'
    ORDER BY id
    LIMIT 1000
);
```

Run repeatedly until affected rows = 0.

Monitor:

- batch count
- duration
- lock waits
- replication lag
- error count
- rows remaining

Idempotent because rows already critical are skipped.

---

## 49. Practical Exercises

### Exercise 1 — Safe State Update

Bad:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id;
```

Better:

```sql
UPDATE cases
SET status = 'ESCALATED'
WHERE id = :case_id
  AND status = 'UNDER_REVIEW';
```

Then check affected rows.

### Exercise 2 — Idempotent External Ref

```sql
INSERT INTO case_external_refs (
    tenant_id,
    source_system,
    source_case_id,
    case_id,
    first_seen_at,
    last_seen_at
)
VALUES (...)
ON CONFLICT (tenant_id, source_system, source_case_id)
DO UPDATE
SET last_seen_at = EXCLUDED.last_seen_at;
```

### Exercise 3 — Soft Delete

```sql
UPDATE case_notes
SET
    deleted_at = now(),
    deleted_by = :user_id
WHERE id = :note_id
  AND deleted_at IS NULL;
```

### Exercise 4 — Batch Delete

```sql
DELETE FROM case_notes
WHERE id IN (
    SELECT id
    FROM case_notes
    WHERE deleted_at < :purge_before
    ORDER BY deleted_at
    LIMIT 1000
);
```

---

## 50. Koneksi ke Part Berikutnya

Part ini membahas bagaimana mengubah data secara aman.

Part berikutnya, `part-012`, akan membahas **constraints as business invariants**:

- `NOT NULL`
- `CHECK`
- `UNIQUE`
- `PRIMARY KEY`
- `FOREIGN KEY`
- exclusion constraints
- partial unique indexes
- constraint naming
- constraint violation handling
- invariant placement between Java and database

Ini sangat terkait dengan DML karena write query hanya aman jika database menjaga invariant yang benar.

---

## 51. Ringkasan Bagian Ini

Hal penting dari part 011:

1. DML mengubah fakta, bukan hanya row.
2. `INSERT` harus memakai column list eksplisit.
3. Defaults harus intentional.
4. `RETURNING`/`OUTPUT` berguna untuk atomic write-read.
5. `INSERT ... SELECT` perlu idempotency dan reconciliation.
6. `UPDATE` harus selalu dipikirkan dari expected affected rows.
7. Conditional update adalah concurrency guard.
8. Affected row count adalah domain signal.
9. Version column mendukung optimistic locking.
10. Update with join harus memastikan source tidak duplicate.
11. State transition harus guarded dan atomic dengan history.
12. Hard delete harus dipertanyakan dalam domain audit/regulatory.
13. Soft delete punya biaya query, index, uniqueness, dan retention.
14. Cascade delete adalah business policy.
15. UPSERT membutuhkan unique constraint yang tepat.
16. MERGE powerful tetapi vendor-specific dan rawan jika source duplicate.
17. Constraint violation harus dimap ke domain error.
18. Multi-statement write perlu transaction boundary.
19. Outbox pattern menjaga DB write dan event publication consistency.
20. Bulk writes harus dibatch dan observable.
21. Idempotency adalah requirement utama untuk retry-safe systems.
22. ORM write abstraction tidak menghapus kebutuhan memahami SQL DML.

Kalimat inti:

> Write SQL yang baik bukan hanya berhasil mengubah row; ia menjaga invariant domain, aman terhadap concurrency, idempotent terhadap retry, dan meninggalkan audit trail yang dapat dipercaya.

---

## 52. Referensi

1. PostgreSQL Documentation — INSERT.  
   https://www.postgresql.org/docs/current/sql-insert.html

2. PostgreSQL Documentation — UPDATE.  
   https://www.postgresql.org/docs/current/sql-update.html

3. PostgreSQL Documentation — DELETE.  
   https://www.postgresql.org/docs/current/sql-delete.html

4. PostgreSQL Documentation — MERGE.  
   https://www.postgresql.org/docs/current/sql-merge.html

5. PostgreSQL Documentation — Explicit Locking.  
   https://www.postgresql.org/docs/current/explicit-locking.html

6. PostgreSQL Documentation — Constraints.  
   https://www.postgresql.org/docs/current/ddl-constraints.html

7. MySQL 8.4 Reference Manual — INSERT Statement.  
   https://dev.mysql.com/doc/refman/8.4/en/insert.html

8. MySQL 8.4 Reference Manual — UPDATE Statement.  
   https://dev.mysql.com/doc/refman/8.4/en/update.html

9. SQL Server Documentation — INSERT, UPDATE, DELETE, MERGE.  
   https://learn.microsoft.com/en-us/sql/t-sql/statements/statements

10. Oracle Database SQL Language Reference — INSERT, UPDATE, DELETE, MERGE.  
    https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/

11. Spring Framework Documentation — Transaction Management.  
    https://docs.spring.io/spring-framework/reference/data-access/transaction.html

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-012.md` — Constraints as Business Invariants


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-010.md">⬅️ Part 10 — Window Functions: Professional-Grade SQL Analytics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-012.md">Part 12 — Constraints as Business Invariants ➡️</a>
</div>

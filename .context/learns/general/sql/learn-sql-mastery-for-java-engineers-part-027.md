# learn-sql-mastery-for-java-engineers-part-027.md

# Part 27 — Migrations and Database Change Management

> Seri: SQL Mastery for Java Engineers  
> Bagian: 027 dari 034  
> Status seri: **belum selesai**  
> Bagian sebelumnya: `learn-sql-mastery-for-java-engineers-part-026.md`  
> Bagian berikutnya: `learn-sql-mastery-for-java-engineers-part-028.md`

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas ORM and query builders: Hibernate/JPA, jOOQ, MyBatis, DTO projection, N+1, fetch join, persistence context, dan SQL-first trade-offs.

Sekarang kita membahas sesuatu yang sangat menentukan kualitas engineer senior: **database change management**.

Banyak engineer bisa menulis schema awal:

```sql
CREATE TABLE users (...);
```

Tetapi sistem production tidak hidup di schema awal.

Schema berubah terus:

- tambah column
- ubah constraint
- tambah index
- rename column
- split table
- merge table
- backfill data
- normalize denormalized data
- denormalize read model
- ubah enum/status
- tambah RLS policy
- tambah trigger/function
- ubah foreign key
- partition table
- migrate large table
- retire old field

Kesalahan migration bisa menyebabkan:

- downtime
- table lock
- data loss
- failed deploy
- broken rolling deployment
- inconsistent app versions
- replication lag
- runaway backfill
- deadlocks
- broken rollback
- performance regression
- security exposure
- unrecoverable partial state

Bagian ini membahas:

- migration mindset
- Flyway
- Liquibase
- versioned migrations
- repeatable migrations
- idempotency
- expand-contract
- backward/forward compatibility
- zero-downtime migration
- backfill strategies
- online index creation
- constraint validation
- safe rename/drop
- enum/status changes
- data migration
- rollback vs fix-forward
- migration testing
- deployment coordination
- operational checklist

Kalimat inti:

> Database migration bukan file SQL yang dijalankan saat deploy; ia adalah perubahan production state yang harus kompatibel, terukur, bisa dipantau, dan aman terhadap traffic lama maupun baru.

---

## 1. Schema Is Production State

Application code bisa redeploy cepat.

Database schema dan data adalah long-lived production state.

Jika deploy app gagal, kamu bisa rollback binary.

Jika migration:

```sql
DROP COLUMN old_column;
```

berhasil lalu app rollback membutuhkan column itu, rollback app gagal.

Database changes sering tidak reversible secara instan.

Karena itu schema migration harus dirancang seperti operasi production.

---

## 2. Mengapa `hibernate.hbm2ddl.auto=update` Berbahaya

Hibernate bisa auto-update schema.

Ini berbahaya untuk production karena:

- perubahan tidak direview sebagai SQL
- constraint/index advanced tidak lengkap
- rename bisa dianggap drop+add
- data migration tidak jelas
- lock behavior tidak dipahami
- grants/RLS/triggers/functions tidak tertangani
- ordering deploy tidak terkontrol
- rollback tidak jelas
- schema drift antar environment

Gunakan ORM schema validation, bukan production schema mutation.

Production schema harus dikelola via migration tool seperti Flyway/Liquibase atau equivalent.

---

## 3. Migration Tool: Tujuan

Migration tool menyediakan:

- versioned migration history
- deterministic ordering
- repeatable deployment
- checksum validation
- audit trail
- environment consistency
- automated apply
- failure detection
- baseline support
- repair controls

Tool populer Java:

```text
Flyway
Liquibase
```

Keduanya baik. Pilihan tergantung team, workflow, dan kebutuhan.

---

## 4. Flyway Mental Model

Flyway menggunakan migration version.

File convention:

```text
V001__create_cases.sql
V002__add_case_status.sql
V003__create_case_assignments.sql
R__refresh_reporting_views.sql
```

Flyway mencatat applied migrations di schema history table.

Jika file yang sudah applied berubah, checksum mismatch.

Ini mencegah:

```text
mengubah history diam-diam
```

Rule praktis:

> Migration yang sudah masuk shared/prod environment jangan diedit. Buat migration baru.

---

## 5. Liquibase Mental Model

Liquibase menggunakan changelog dan changeset.

Format bisa:

- XML
- YAML
- JSON
- SQL

Concept:

```text
changeset id + author
```

Liquibase mencatat executed changesets.

Kelebihan:

- rollback metadata support
- database-agnostic changes
- contexts/labels
- preconditions
- rich change model

Trade-off:

- format lebih verbose
- abstraction sometimes leaky
- generated SQL perlu direview

Banyak team tetap menulis formatted SQL dengan Liquibase untuk control.

---

## 6. Versioned Migration Rules

Rules:

```text
1. Migration immutable setelah applied.
2. Satu migration satu tujuan jelas.
3. Nama migration menjelaskan maksud.
4. Hindari huge migration tanpa checkpoint.
5. Test migration from previous prod state.
6. Include grants/indexes/constraints as needed.
7. Avoid environment-specific manual steps.
8. Make migration observable for big changes.
```

Bad:

```text
V123__misc_changes.sql
```

Good:

```text
V123__add_case_closed_reason_column.sql
V124__backfill_case_closed_reason.sql
V125__set_case_closed_reason_not_null.sql
```

---

## 7. Repeatable Migration

Repeatable migration cocok untuk objects yang didefinisikan ulang:

- views
- functions
- procedures
- grants sometimes
- comments

Flyway repeatable:

```text
R__case_work_queue_view.sql
```

Caveat:

- run when checksum changes
- dependency order matters
- compatibility with app versions matters
- function signature changes need care

For critical database APIs, versioning may still be better than blindly replacing.

---

## 8. Idempotent vs Versioned

Migration tool already tracks version, so migration SQL tidak selalu harus idempotent.

Example versioned:

```sql
ALTER TABLE cases ADD COLUMN closed_reason TEXT;
```

If run twice, fails. That's okay because tool runs once.

But for operational scripts/backfills, idempotency is valuable:

```sql
UPDATE cases
SET closed_reason = 'UNKNOWN'
WHERE status = 'CLOSED'
  AND closed_reason IS NULL;
```

Understand difference:

```text
migration uniqueness handled by tool
operation safety handled by SQL design
```

---

## 9. Expand-Contract Pattern

Zero-downtime migration sering memakai expand-contract.

### 9.1 Expand

Tambahkan schema baru tanpa merusak app lama.

```sql
ALTER TABLE cases ADD COLUMN closed_reason TEXT;
```

App lama masih jalan.

### 9.2 Dual Write / Backward Compatible App

Deploy app yang menulis old + new atau bisa membaca both.

### 9.3 Backfill

Isi data lama.

```sql
UPDATE cases
SET closed_reason = 'UNKNOWN'
WHERE status = 'CLOSED'
  AND closed_reason IS NULL;
```

### 9.4 Enforce

Tambah constraint setelah data benar.

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_closed_reason_required
CHECK (status <> 'CLOSED' OR closed_reason IS NOT NULL);
```

### 9.5 Contract

Setelah semua app tidak butuh old field, drop old column.

Expand-contract menghindari app lama dan baru bertabrakan.

---

## 10. Backward and Forward Compatibility

Rolling deployment berarti app v1 dan v2 bisa berjalan bersamaan.

Database harus kompatibel dengan:

```text
old app reading/writing
new app reading/writing
```

Backward compatible DB change:

- add nullable column
- add table unused by old app
- add index
- add constraint NOT VALID maybe
- add view/function without changing old contract

Breaking DB change:

- drop column used by old app
- rename column directly
- make nullable column NOT NULL before app writes it
- change type incompatible
- change enum removing old value
- change function signature used by old app
- tighten RLS before app context ready

Avoid breaking changes in same deploy as app change unless downtime accepted.

---

## 11. Safe Add Column

Usually safe:

```sql
ALTER TABLE cases ADD COLUMN closed_reason TEXT;
```

But in some DB/version, adding column with non-null default may rewrite table or lock longer.

Risky:

```sql
ALTER TABLE cases
ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

For huge tables, safer pattern:

1. add nullable column without expensive default
2. deploy app writing it
3. backfill in batches
4. add default for future rows
5. add NOT NULL after validation

Example:

```sql
ALTER TABLE cases ADD COLUMN closed_reason TEXT;
```

Later:

```sql
ALTER TABLE cases ALTER COLUMN closed_reason SET DEFAULT 'UNKNOWN';
```

Then enforce after backfill.

---

## 12. Safe NOT NULL

Bad on huge dirty table:

```sql
ALTER TABLE cases ALTER COLUMN closed_reason SET NOT NULL;
```

If nulls exist, fails. It may scan/lock.

Safer:

1. add column nullable
2. backfill
3. add check constraint not valid if supported

PostgreSQL-style:

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_closed_reason_not_null
CHECK (closed_reason IS NOT NULL) NOT VALID;
```

Validate separately:

```sql
ALTER TABLE cases
VALIDATE CONSTRAINT ck_cases_closed_reason_not_null;
```

Then optionally set NOT NULL if safe/needed.

Vendor behavior differs.

---

## 13. Safe Add Constraint

Adding constraint can scan table and lock writes.

Strategies:

- pre-clean data
- add NOT VALID / NOVALIDATE if supported
- validate later
- use online validation features
- do during low traffic
- set lock timeout
- monitor progress
- split migration

Example FK in PostgreSQL:

```sql
ALTER TABLE case_notes
ADD CONSTRAINT fk_case_notes_cases
FOREIGN KEY (tenant_id, case_id)
REFERENCES cases (tenant_id, id)
NOT VALID;
```

Then:

```sql
ALTER TABLE case_notes VALIDATE CONSTRAINT fk_case_notes_cases;
```

This reduces blocking compared to immediate full validation.

---

## 14. Safe Add Index

Adding index on huge table can be disruptive.

PostgreSQL:

```sql
CREATE INDEX CONCURRENTLY idx_cases_tenant_status
ON cases (tenant_id, status);
```

Caveats:

- cannot run inside transaction block
- takes longer
- may fail leaving invalid index
- more IO/CPU
- still affects production load
- migration tool config needed

MySQL/SQL Server/Oracle have their own online index options.

Never assume `CREATE INDEX` is harmless on large table.

---

## 15. Online Index Build and Migration Tools

Flyway often wraps each migration in transaction for PostgreSQL.

But `CREATE INDEX CONCURRENTLY` cannot be inside transaction.

Need migration config or marker.

Flyway supports disabling transaction per migration in some ways depending version/config.

Pattern:

```text
V123__create_index_concurrently.sql
```

with executeInTransaction=false configuration.

If tool cannot support, run as controlled operational migration.

Document it.

---

## 16. Dropping Index

Dropping index can also affect production.

Before drop:

- confirm unused via DB stats
- check query plans
- check constraints depend on it
- check unique indexes
- check foreign key support indirectly
- monitor after drop
- consider invisible index if DB supports
- drop during low traffic

PostgreSQL:

```sql
DROP INDEX CONCURRENTLY idx_old;
```

Again, transaction caveat.

---

## 17. Renaming Column Safely

Direct rename:

```sql
ALTER TABLE cases RENAME COLUMN case_number TO reference_number;
```

Breaks old app.

Safe pattern:

1. add new column

```sql
ALTER TABLE cases ADD COLUMN reference_number TEXT;
```

2. app writes both
3. backfill new from old
4. app reads new, fallback old
5. stop using old
6. drop old later

Alternative:

- compatibility view
- generated column
- trigger dual write temporarily

Direct rename is only safe with coordinated downtime or guaranteed no old consumers.

---

## 18. Changing Column Type

Type changes can rewrite table and break app.

Example:

```sql
ALTER TABLE cases ALTER COLUMN priority TYPE INTEGER;
```

Safer:

1. add new column `priority_rank`
2. dual write
3. backfill
4. update reads
5. enforce constraints
6. drop old column later

For simple widening:

```text
VARCHAR(100) -> VARCHAR(200)
```

may be safer depending DB.

For semantic type change, use expand-contract.

---

## 19. Changing Enum/Status

Database enum types are convenient but harder to evolve in some DBs.

Options:

- DB enum
- text + CHECK constraint
- reference table
- lookup table with effective dates

Adding value may be easy.

Removing/renaming value is hard because old rows/app versions may still use it.

Safe status change:

1. add new status as allowed
2. deploy app that can read old+new
3. migrate rows
4. stop writing old
5. enforce no old
6. remove old later if worth it

For workflow-heavy systems, reference table + allowed transitions table is more flexible.

---

## 20. Dropping Column Safely

Drop is destructive.

Before drop:

- app no longer reads/writes
- no reports/BI use it
- no views/functions/triggers use it
- no read models depend on it
- no external exports
- backups exist but restore not normal rollback
- monitoring confirms no access if possible

Safe pattern:

1. stop app usage
2. deploy
3. wait one or more release cycles
4. drop column

Some teams first rename to `deprecated_...` or revoke access, but rename can break if still used.

---

## 21. Data Backfill

Backfill fills new column/table from existing data.

Example:

```sql
UPDATE cases
SET case_number_normalized = normalize_case_number(case_number)
WHERE case_number_normalized IS NULL;
```

On huge table, do not run one giant update.

Problems:

- long transaction
- row locks
- WAL/redo spike
- replication lag
- bloat
- deadlocks
- autovacuum pressure
- connection held
- rollback huge
- production latency spike

Use batched backfill.

---

## 22. Batched Backfill

Pattern:

```sql
UPDATE cases
SET case_number_normalized = normalize_case_number(case_number)
WHERE id IN (
    SELECT id
    FROM cases
    WHERE case_number_normalized IS NULL
    ORDER BY id
    LIMIT 1000
);
```

Repeat until 0.

Better with range cursor for huge tables:

```sql
UPDATE cases
SET case_number_normalized = normalize_case_number(case_number)
WHERE id > :last_id
  AND id <= :next_id
  AND case_number_normalized IS NULL;
```

Operational controls:

- batch size
- sleep between batches
- statement timeout
- lock timeout
- progress metrics
- pause/resume
- idempotency
- replication lag monitoring

---

## 23. Backfill Application vs SQL Script

Backfill can run as:

- SQL migration
- separate job
- admin command
- one-off worker
- data pipeline
- stored procedure

For small tables, migration is fine.

For large production tables, prefer controlled job with:

- progress tracking
- resumability
- throttling
- observability
- failure handling
- safe deploy independent from schema migration

Do not block app deployment on hours-long backfill if avoidable.

---

## 24. Progress Table for Backfill

Example:

```sql
CREATE TABLE migration_job_progress (
    job_name TEXT PRIMARY KEY,
    last_processed_id UUID,
    processed_count BIGINT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
```

For numeric IDs/timestamps, cursor easier.

For UUID random IDs, use:

- created_at + id
- primary key batching via temp table
- database-specific paging
- chunk by hash/mod
- chunk by tenant
- chunk by partition

Progress matters for production safety.

---

## 25. Dual Write

During migration, app may write old and new columns/tables.

Example:

```java
case.setCaseNumber(input);
case.setCaseNumberNormalized(normalize(input));
```

Or database generated column handles new field.

Dual write risks:

- old/new divergence
- partial update bugs
- multiple services not updated
- bulk jobs bypass
- triggers may help
- need consistency checks

Keep dual-write period short and monitored.

---

## 26. Read Fallback

During migration:

```java
String normalized = row.get("case_number_normalized");
if (normalized == null) {
    normalized = normalize(row.get("case_number"));
}
```

This lets app tolerate not-yet-backfilled rows.

After backfill and constraint, remove fallback.

Do not leave fallback forever unless intentionally supported.

---

## 27. Shadow Table Migration

Splitting table.

Old:

```sql
parties(id, display_name, national_id, date_of_birth)
```

New:

```sql
parties(id, display_name)
party_sensitive_data(party_id, national_id, date_of_birth)
```

Safe steps:

1. create new table
2. app dual writes old+new
3. backfill new table from old
4. validate counts/checksums
5. app reads new with fallback old
6. app reads new only
7. stop writing old sensitive columns
8. drop old columns later

This can take multiple deploys.

---

## 28. Validation Queries

After backfill, validate.

Count:

```sql
SELECT COUNT(*)
FROM cases
WHERE case_number_normalized IS NULL;
```

Checksum/sample:

```sql
SELECT id
FROM cases
WHERE case_number_normalized <> normalize_case_number(case_number)
LIMIT 100;
```

Referential validation:

```sql
SELECT COUNT(*)
FROM case_notes n
LEFT JOIN cases c
  ON c.tenant_id = n.tenant_id
 AND c.id = n.case_id
WHERE c.id IS NULL;
```

Do not assume backfill worked because job completed.

---

## 29. Data Migration and Business Semantics

Data migration is not just technical transformation.

Example:

```text
old status CLOSED_WITHOUT_DECISION
new statuses CLOSED_ADMINISTRATIVE, CLOSED_INVALID, CLOSED_DUPLICATE
```

Need mapping rules.

Questions:

```text
Is mapping deterministic?
Do we need manual review?
What if old data invalid?
Do we preserve old value?
Do reports change?
Do audit/history need correction?
Do external integrations depend on old status?
```

Data migrations can be domain projects.

---

## 30. Rollback vs Fix-Forward

Application rollback is common.

Database rollback is harder.

Types:

### 30.1 Reversible Migration

```sql
ADD COLUMN
```

Can ignore if rollback app.

### 30.2 Destructive Migration

```sql
DROP COLUMN
DELETE DATA
```

Hard to rollback.

### 30.3 Data Transformation

Can be hard/impossible to reverse if information lost.

Production DB strategy often:

```text
fix-forward
```

Design migrations so app rollback remains possible during rollout.

Do not do destructive contract step until safe.

---

## 31. Down Migrations

Some tools support down/rollback migration.

Useful for dev/test.

But in production:

- rollback DDL may be unsafe
- data loss not reversible
- app versions mixed
- long rollback can worsen incident
- restore from backup is heavy
- forward fix often safer

Write rollback notes, but design forward-compatible migrations.

For destructive changes, require explicit approval.

---

## 32. Failed Migration

If migration fails halfway:

- transaction may rollback all, if transactional DDL
- some DDL auto-commits depending DB
- concurrent index may leave invalid object
- partial data update may commit if not wrapped
- migration tool history may mark failed

Runbook:

1. stop deploy if needed
2. inspect schema/data state
3. inspect migration history table
4. decide repair/fix-forward
5. avoid rerunning blindly
6. restore only if necessary
7. document incident

Test failure modes in staging.

---

## 33. Transactional DDL

Some databases support transactional DDL strongly; some auto-commit DDL.

PostgreSQL supports many transactional DDL operations, but not all operations like `CREATE INDEX CONCURRENTLY`.

MySQL behavior varies by engine/operation.

SQL Server/Oracle have their own semantics.

Never assume migration transaction behavior is portable.

Know your database.

---

## 34. Lock-Aware Migrations

Before running migration, ask:

```text
Will this take ACCESS EXCLUSIVE/table lock?
Will it block reads?
Will it block writes?
Will it wait behind long transaction?
Will it scan whole table?
Will it rewrite table?
Will it generate huge WAL/redo?
Will it replicate slowly?
```

For critical tables, test lock behavior on staging with realistic load.

Use:

- lock timeout
- statement timeout
- online options
- concurrent options
- low traffic windows
- preflight checks

---

## 35. Preflight Checks

Before migration:

```sql
SELECT COUNT(*) FROM cases WHERE closed_reason IS NULL;
```

Check table size, blockers, old data shape, duplicate values.

Examples:

Before unique constraint:

```sql
SELECT tenant_id, case_number_normalized, COUNT(*)
FROM cases
GROUP BY tenant_id, case_number_normalized
HAVING COUNT(*) > 1;
```

Before NOT NULL:

```sql
SELECT COUNT(*)
FROM cases
WHERE new_column IS NULL;
```

Before FK:

```sql
SELECT COUNT(*)
FROM child c
LEFT JOIN parent p ON ...
WHERE p.id IS NULL;
```

Preflight should fail migration early if assumptions wrong.

---

## 36. Duplicate Cleanup Before Unique Constraint

Need unique:

```sql
UNIQUE (tenant_id, email_normalized)
```

But duplicates exist.

Options:

- manual review
- deterministic winner
- merge records
- mark duplicates inactive
- add partial unique for active rows
- temporary report for business
- migration with exception table

Example duplicate report:

```sql
CREATE TABLE duplicate_email_candidates AS
SELECT tenant_id, email_normalized, array_agg(id) AS user_ids
FROM users
GROUP BY tenant_id, email_normalized
HAVING COUNT(*) > 1;
```

Do not blindly delete duplicates.

---

## 37. Large Table Migration

For huge tables:

- avoid table rewrite
- avoid giant transactions
- avoid blocking DDL
- avoid full table locks
- use expand-contract
- backfill in batches
- use online index
- validate constraints separately
- monitor replication lag
- consider partition-by-partition
- consider shadow table migration
- rehearse

Large table migration should have runbook.

---

## 38. Shadow Table / Online Copy

For very hard changes:

1. create new table with desired schema
2. copy data in chunks
3. dual write old and new
4. validate
5. switch reads
6. freeze/catch up
7. rename/swap, or keep new name
8. retire old

Tools/patterns exist for online schema change, especially in MySQL ecosystems.

This is complex but sometimes necessary.

---

## 39. Feature Flags and Migrations

Feature flags help coordinate.

Example:

1. deploy DB expand
2. deploy app with code path off
3. backfill
4. enable write to new field
5. monitor
6. enable reads from new field
7. contract later

Feature flag should not leave two permanent code paths forever.

Plan cleanup.

---

## 40. Multi-Service Coordination

If multiple services access same database/schema:

- identify consumers
- check queries/reports
- coordinate version compatibility
- publish schema change notice
- provide compatibility views
- avoid direct breaking changes
- migrate consumers gradually

Better architecture: one service owns database; others use API/events.

But reality often includes shared reporting/BI/direct readers. Account for them.

---

## 41. Migrations and Replication

Migrations can affect replicas:

- WAL/redo volume
- replication lag
- long-running transactions
- DDL replay locks
- index build load
- read replica query cancellation
- storage growth

Before big migration:

- monitor lag
- throttle backfill
- ensure replica disk
- consider running reads on primary during critical phases
- schedule low traffic
- alert on lag

Migration safety includes replicas.

---

## 42. Migrations and Backups

Before destructive/high-risk migration:

- ensure recent backup
- know restore time objective
- test restore process
- snapshot if applicable
- understand point-in-time recovery
- verify backup includes required schemas
- secure backup

But do not use “we have backup” as excuse for reckless migration.

Restore can take hours and cause data loss after backup point if PITR not ready.

---

## 43. Security Changes in Migrations

Schema migration may affect security.

Examples:

- new table missing grants/RLS
- read model exposing PII
- function SECURITY DEFINER unsafe
- audit trigger dropped accidentally
- support view includes sensitive column
- app runtime role granted too much
- RLS policy changed without test

Security checklist for migration:

```text
[ ] grants correct?
[ ] owner correct?
[ ] RLS enabled if needed?
[ ] views expose only intended columns?
[ ] sensitive fields classified?
[ ] audit implications?
[ ] runtime user tested?
```

---

## 44. Migration Tests

Test:

- migration from previous version to new
- app old with new DB
- app new with old-ish expanded DB if applicable
- rollback app after migration
- backfill idempotency
- constraints with dirty data
- runtime grants
- RLS policies
- performance on realistic data
- generated SQL still valid
- views/functions compile

Use CI with real DB.

For critical migrations, rehearse on production snapshot.

---

## 45. Contract Tests for Schema

If multiple apps/consumers depend on DB:

- verify required columns/views exist
- verify types
- verify grants
- verify functions signatures
- verify expected constraints
- verify read model contract

Database is an API. Test its contract.

---

## 46. Migration Observability

During migration/backfill, monitor:

- migration start/end
- current step
- rows processed
- rows remaining
- batch duration
- errors
- lock waits
- deadlocks
- statement timeouts
- replication lag
- DB CPU/IO
- table/index bloat
- app latency
- connection pool
- disk usage

A migration without observability is a blind operation.

---

## 47. Migration Runbook

For non-trivial migration, write runbook:

```text
Purpose
Risk level
Affected tables
Expected duration
Lock behavior
Preflight checks
Deployment order
Backfill command
Monitoring dashboards
Pause/resume
Rollback/fix-forward plan
Validation queries
Owner
Communication plan
```

Senior engineers write runbooks for risky DB changes.

---

## 48. Example: Add Normalized Case Number

Goal:

```text
enforce unique case number per tenant ignoring spaces/case
```

Step 1: expand

```sql
ALTER TABLE cases
ADD COLUMN case_number_normalized TEXT;
```

Step 2: app writes new field for new/updated cases.

Step 3: backfill:

```sql
UPDATE cases
SET case_number_normalized = normalize_case_number(case_number)
WHERE case_number_normalized IS NULL
LIMIT ... -- vendor-specific pattern needed
```

Step 4: validate duplicates:

```sql
SELECT tenant_id, case_number_normalized, COUNT(*)
FROM cases
GROUP BY tenant_id, case_number_normalized
HAVING COUNT(*) > 1;
```

Step 5: create unique index concurrently:

```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_cases_tenant_case_number_norm
ON cases (tenant_id, case_number_normalized);
```

Step 6: enforce not null after all rows filled.

Step 7: remove old app fallback.

---

## 49. Example: Add NOT NULL Column with Default

Goal:

```text
cases.priority must be required
```

Safe steps:

1. Add nullable column.

```sql
ALTER TABLE cases ADD COLUMN priority TEXT;
```

2. App writes priority for new rows.

3. Backfill old rows.

```sql
UPDATE cases
SET priority = 'NORMAL'
WHERE priority IS NULL;
```

batched.

4. Add check/constraint:

```sql
ALTER TABLE cases
ADD CONSTRAINT ck_cases_priority_not_null
CHECK (priority IS NOT NULL) NOT VALID;
```

5. Validate.

```sql
ALTER TABLE cases VALIDATE CONSTRAINT ck_cases_priority_not_null;
```

6. Optionally set NOT NULL if safe.

7. Add allowed values check/reference FK.

---

## 50. Example: Split Sensitive Data

Old:

```sql
parties(id, tenant_id, display_name, national_id, date_of_birth)
```

New:

```sql
party_sensitive_data(tenant_id, party_id, national_id, date_of_birth)
```

Steps:

1. Create new table with strict grants.
2. App dual writes.
3. Backfill new table.
4. Validate row count and values.
5. App reads new table.
6. Remove old reads.
7. Drop old sensitive columns after retention/compatibility window.
8. Confirm read models/logs/exports no longer use old fields.

Security migration must include downstream copies.

---

## 51. Example: Replace Status Value

Old:

```text
IN_PROGRESS
```

New:

```text
UNDER_REVIEW
PENDING_DECISION
```

Steps:

1. Allow new statuses in constraints/reference data.
2. App can read old and new.
3. New app writes new statuses.
4. Backfill old rows using business mapping.
5. Validate no old statuses.
6. Update reports/read models.
7. Remove old status from allowed transitions.
8. Contract later.

Do not rename enum directly and hope.

---

## 52. Example: Add Foreign Key to Existing Dirty Data

Goal:

```text
case_notes.case_id references cases
```

Steps:

1. Find orphan notes.

```sql
SELECT n.*
FROM case_notes n
LEFT JOIN cases c
  ON c.tenant_id = n.tenant_id
 AND c.id = n.case_id
WHERE c.id IS NULL;
```

2. Decide cleanup:

- delete
- reassign
- archive
- create missing parent
- manual review

3. Add supporting index:

```sql
CREATE INDEX CONCURRENTLY idx_case_notes_tenant_case
ON case_notes (tenant_id, case_id);
```

4. Add FK NOT VALID.

5. Validate constraint.

This avoids surprise failure and long locks.

---

## 53. Migration Anti-Patterns

```text
[ ] edit old migration already applied in shared env
[ ] run giant update in deploy transaction
[ ] add NOT NULL column with default on huge table without checking DB behavior
[ ] create index normally on hot huge table
[ ] drop column in same deploy that removes app usage
[ ] direct rename during rolling deploy
[ ] backfill with no progress/resume
[ ] no preflight validation
[ ] no replication lag monitoring
[ ] app runtime user owns schema
[ ] migration grants broad access accidentally
[ ] rely on down migration for destructive data change
[ ] test only on empty database
[ ] ignore BI/report consumers
[ ] no runbook for risky migration
```

---

## 54. Migration Design Checklist

```text
[ ] Is change backward compatible?
[ ] Is change forward compatible?
[ ] Does app rollback still work?
[ ] Is this expand, migrate, or contract step?
[ ] Does it lock/rewrite/scan huge table?
[ ] Is online/concurrent option needed?
[ ] Is backfill batched and resumable?
[ ] Are constraints validated safely?
[ ] Are indexes created safely?
[ ] Are grants/RLS/security updated?
[ ] Are read models/search indexes affected?
[ ] Are reports/BI consumers affected?
[ ] Are preflight queries defined?
[ ] Are validation queries defined?
[ ] Is rollback/fix-forward plan clear?
[ ] Is migration tested on realistic data?
[ ] Is monitoring in place?
```

---

## 55. Practical Exercises

### Exercise 1 — Safe Rename

Rename `case_number` to `reference_number` without downtime.

Answer should use add new column, dual write, backfill, read switch, contract.

### Exercise 2 — Add Unique Constraint

Add unique `(tenant_id, email_normalized)` to dirty `users` table.

Answer should include duplicate detection, cleanup, concurrent unique index, validation.

### Exercise 3 — Backfill Strategy

Design batched backfill for 100M rows with progress table and replication lag monitoring.

### Exercise 4 — App Rollback

Explain why dropping old column in same release as app change breaks rollback.

### Exercise 5 — Security Migration

New table contains PII. List required grants/RLS/masking/audit considerations.

---

## 56. Koneksi ke Part Berikutnya

Part ini membahas migrations and database change management.

Part berikutnya, `part-028`, akan membahas bulk data, ETL, import/export, and data reconciliation:

- staging tables
- bulk load
- validation
- deduplication
- reconciliation
- import idempotency
- data quality
- batch processing
- export safety
- large data movement

Migration mengubah schema/data shape. Bulk/ETL menggerakkan data dalam volume besar secara aman.

---

## 57. Ringkasan Bagian Ini

Hal penting dari part 027:

1. Database schema adalah production state, bukan sekadar code.
2. Production schema mutation harus memakai migration tool seperti Flyway/Liquibase.
3. Migration yang sudah applied tidak boleh diedit sembarangan.
4. ORM auto-DDL tidak cocok untuk production change management.
5. Expand-contract adalah pattern utama zero-downtime schema evolution.
6. Rolling deploy membutuhkan backward/forward compatibility.
7. Add column biasanya aman, tetapi NOT NULL/default/type changes bisa mahal.
8. Constraint dan index pada huge table harus dibuat/validated dengan online-safe strategy.
9. Direct rename/drop/type change sering breaking.
10. Backfill besar harus batched, resumable, observable, and throttleable.
11. Dual write/read fallback membantu transisi tetapi harus dibersihkan.
12. Data migration harus mempertimbangkan business semantics.
13. Database rollback sulit; fix-forward sering lebih aman.
14. Lock behavior, table rewrite, replication lag, and bloat harus dipahami.
15. Preflight and validation queries adalah bagian migration.
16. Security grants/RLS/read models harus ikut migration review.
17. Migration harus diuji dari state production-like, bukan hanya empty DB.
18. Risky migration perlu runbook.
19. Destructive contract step harus ditunda sampai aman.
20. Schema adalah API untuk app, reports, jobs, and integrations.

Kalimat inti:

> Migration yang baik tidak hanya berhasil di laptop; ia aman untuk production traffic, kompatibel dengan rolling deploy, memiliki observability, dan menjaga data tetap benar walaupun perubahan dilakukan bertahap.

---

## 58. Referensi

1. Flyway Documentation.  
   https://documentation.red-gate.com/fd

2. Liquibase Documentation.  
   https://docs.liquibase.com/

3. PostgreSQL Documentation — ALTER TABLE.  
   https://www.postgresql.org/docs/current/sql-altertable.html

4. PostgreSQL Documentation — CREATE INDEX.  
   https://www.postgresql.org/docs/current/sql-createindex.html

5. PostgreSQL Documentation — Explicit Locking.  
   https://www.postgresql.org/docs/current/explicit-locking.html

6. MySQL Documentation — Online DDL.  
   https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl.html

7. SQL Server Documentation — Online Index Operations.  
   https://learn.microsoft.com/en-us/sql/relational-databases/indexes/perform-index-operations-online

8. Oracle Documentation — Online DDL and Redefinition concepts.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/admin/managing-tables.html

9. Martin Fowler — Evolutionary Database Design.  
   https://martinfowler.com/articles/evodb.html

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

Bagian berikutnya:

- `learn-sql-mastery-for-java-engineers-part-028.md` — Bulk Data, ETL, Import/Export, and Data Reconciliation


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-sql-mastery-for-java-engineers-part-026.md">⬅️ Part 26 — ORM and Query Builders: Hibernate, JPA, jOOQ, MyBatis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-sql-mastery-for-java-engineers-part-028.md">Part 28 — Bulk Data, ETL, Import/Export, and Data Reconciliation ➡️</a>
</div>

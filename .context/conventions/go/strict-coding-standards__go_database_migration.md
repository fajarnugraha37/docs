# Strict Coding Standards — Go Database Migration

Status: Mandatory  
Scope: Database schema migrations authored, reviewed, executed, embedded, tested, or orchestrated from Go projects.  
Audience: LLM code agents, developers, reviewers, release engineers, SREs, and database maintainers.  
Baseline: Go 1.24+; applies to SQL migrations for PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, Oracle, and other relational databases unless project-specific standards override with stricter rules.

---

## 1. Purpose

Database migrations are production changes, not ordinary code changes. A bad migration can block deployment, corrupt data, lock critical tables, break old application versions during rolling deploy, or create irreversible compliance issues.

An LLM MUST NOT generate migrations as naive `CREATE TABLE` or `ALTER TABLE` scripts without considering:

- current production data,
- application version compatibility,
- lock duration,
- rollback strategy,
- constraint validation,
- backfill safety,
- idempotency,
- migration ordering,
- observability,
- failure recovery,
- and deployment topology.

This standard makes migration work reviewable, repeatable, and operationally safe.

---

## 2. Source authority

Primary references:

- Target database vendor documentation.
- Go database/sql behavior for execution, transaction, and context cancellation.
- Migration tool documentation used by the project, such as golang-migrate, goose, Atlas, Flyway, Liquibase, or internal tooling.
- Project deployment strategy.
- Project data retention, audit, privacy, and regulatory policies.

If this standard conflicts with target database behavior, vendor behavior wins, and this standard must be adapted explicitly.

---

## 3. Non-negotiable rules

The agent MUST:

1. Treat every migration as a production operation with failure modes.
2. Use monotonically ordered migration files with immutable history after merge.
3. Never modify an already-applied migration except in pre-production before it is shared.
4. Use forward-only migrations by default; rollback scripts are required only when safe and meaningful.
5. Prefer expand/contract migrations for rolling deployments.
6. Avoid long blocking locks on hot tables.
7. Avoid unbounded data backfills in schema migration transactions.
8. Make destructive changes multi-step and explicitly approved.
9. Make nullable/default/constraint changes compatible with existing data.
10. Test migrations against realistic schema and representative data volume.
11. Ensure application code and migration order are compatible.
12. Never store secrets in migrations.
13. Never generate fake migration state manually unless recovering under documented runbook.
14. Never hide dirty/failed migration state.
15. Always document risk, lock behavior, and rollback/recovery strategy for non-trivial migrations.

---

## 4. Migration categories

Every migration MUST be classified as one of:

1. **Pure schema additive**: create table, add nullable column, add non-enforced index where safe.
2. **Schema restrictive**: add NOT NULL, unique, foreign key, check constraint.
3. **Schema destructive**: drop column/table/index/type/constraint.
4. **Data backfill**: update existing rows.
5. **Data correction**: repair bad data.
6. **Reference data change**: seed/update static lookup values.
7. **Operational object change**: view, function, trigger, materialized view, partition, job, extension.
8. **Security/permission change**: role, grants, RLS/policy.
9. **Performance migration**: index, partition, denormalization, computed/generated column.
10. **State-machine migration**: add/change statuses, transitions, workflow data, case lifecycle semantics.

The migration file header MUST include category for non-trivial changes.

---

## 5. File naming and immutability

### 5.1 Naming

Use project-approved naming format.

Common acceptable examples:

```text
20260610123000_create_case_tables.up.sql
20260610123000_create_case_tables.down.sql
000123_add_case_version_column.up.sql
000123_add_case_version_column.down.sql
```

Rules:

- Timestamp or sequence must be monotonic.
- Name must describe intent, not implementation only.
- Avoid vague names like `fix_schema.sql`, `update.sql`, `misc.sql`.
- Include `.up.sql` and `.down.sql` only if the tool uses paired migrations.

### 5.2 Immutability after application

Once a migration is applied in any shared environment, it MUST NOT be edited. Create a new migration to fix it.

Forbidden:

```text
# FORBIDDEN after migration reached DEV/UAT/PROD:
edit 20260601101010_create_users.up.sql
```

Preferred:

```text
20260602113000_fix_users_email_constraint.up.sql
```

---

## 6. Migration header standard

Every non-trivial migration MUST start with a comment block.

```sql
-- Migration: 20260610123000_add_case_version
-- Category: schema additive + optimistic locking support
-- Risk: low/medium/high
-- Target DB: PostgreSQL 16
-- Expected lock: short ACCESS EXCLUSIVE for ADD COLUMN; verify on target DB/version
-- App compatibility: new app writes version; old app ignores nullable/defaulted column
-- Rollout: expand phase
-- Rollback: forward fix; no destructive rollback required
-- Verification: column exists, default/backfill complete, repository tests pass
```

For DBs that do not support SQL comments in migration runner output, include equivalent metadata in a companion `.md` or migration manifest.

---

## 7. Expand/contract deployment standard

For services using rolling deployments, schema changes MUST usually follow expand/contract.

### 7.1 Expand phase

Make DB schema accept both old and new app versions.

Examples:

- Add nullable column.
- Add table not yet used by old app.
- Add index concurrently/online where supported.
- Add non-enforced or not-yet-validated constraint where supported.
- Add new enum/status only when old app tolerates it.
- Write dual data if needed.

### 7.2 Migrate/backfill phase

Move existing data safely.

Examples:

- Backfill new column in batches.
- Verify row counts.
- Compare old and new representations.
- Monitor lock/timeouts.

### 7.3 Switch phase

Deploy application code that reads/writes new schema.

### 7.4 Contract phase

Remove old schema only after old application versions are impossible to run and data has been verified.

Examples:

- Drop old column.
- Drop old table.
- Enforce NOT NULL.
- Enforce unique/foreign key/check constraint.
- Remove compatibility triggers.

---

## 8. Compatibility rules

### 8.1 Rolling deploy compatibility

Before migration is accepted, answer:

1. Can old app run after migration?
2. Can new app run before migration?
3. Can old and new app run concurrently?
4. Can the migration be applied while traffic is live?
5. What happens if deployment rolls back after migration?

If any answer is “no”, the migration requires explicit deployment coordination.

### 8.2 Backward compatibility

Additive changes should not break old app code.

Safe examples:

```sql
ALTER TABLE cases ADD COLUMN version BIGINT;
```

Risky examples:

```sql
ALTER TABLE cases ADD COLUMN version BIGINT NOT NULL;
```

Safer sequence:

```sql
ALTER TABLE cases ADD COLUMN version BIGINT;
-- batch backfill outside blocking transaction
-- verify no nulls
ALTER TABLE cases ALTER COLUMN version SET DEFAULT 1;
ALTER TABLE cases ALTER COLUMN version SET NOT NULL;
```

Actual syntax and lock behavior must be verified per database.

---

## 9. Transaction rules

### 9.1 Migration transaction policy must be explicit

Some migrations should run in a transaction; others cannot or should not.

Use transaction when:

- DDL is transactional in target DB.
- Migration is small and lock-safe.
- Atomicity is more important than online behavior.

Avoid single giant transaction when:

- Backfilling millions of rows.
- Creating indexes online/concurrently requiring no transaction.
- Altering large hot tables.
- Running DB commands disallowed inside transactions.

### 9.2 Do not assume all DBs support transactional DDL

The agent MUST check target database semantics before recommending rollback or atomic migration.

### 9.3 Dirty migration state

If using a tool that tracks dirty/failed state, a failed migration MUST stop further migrations until manual recovery is performed.

Rules:

- Do not automatically force version in application code.
- Do not mark dirty migration clean without verifying actual database state.
- Recovery must be a runbook step with human approval.
- Record the recovery decision.

---

## 10. Lock and availability rules

### 10.1 Lock analysis is required

Every migration touching an existing table MUST document expected lock behavior.

Include:

- table name,
- approximate row count,
- operation type,
- expected lock level,
- expected duration,
- whether reads/writes are blocked,
- mitigation.

### 10.2 Hot table changes require special care

For hot tables, prefer:

- online/concurrent index creation where supported,
- nullable add first,
- backfill in batches,
- constraint validation after data cleanup,
- short lock windows,
- maintenance window if unavoidable.

### 10.3 Avoid long-running `ALTER TABLE` surprises

The agent MUST NOT assume adding a column/default/index is cheap across all databases. It must mention target DB/version dependency when relevant.

---

## 11. Backfill rules

### 11.1 Backfill must be bounded

Forbidden:

```sql
UPDATE cases SET version = 1 WHERE version IS NULL;
```

This may be acceptable only on small tables with proven row count and lock behavior.

Preferred for large tables:

- batch by primary key range,
- limit batch size,
- commit per batch,
- sleep/yield between batches if needed,
- track progress,
- support resume,
- verify completion.

Pseudo-pattern:

```sql
UPDATE cases
SET version = 1
WHERE id >= $1
  AND id < $2
  AND version IS NULL;
```

### 11.2 Backfill code ownership

Large backfills SHOULD be implemented as:

- one-off Go command,
- controlled job,
- migration runner with batching support,
- or DB-native job procedure approved by DBA/SRE.

Do not hide large business backfills inside a single schema migration file.

### 11.3 Backfill must be idempotent

Backfill statements MUST be safe to rerun.

Preferred:

```sql
UPDATE cases
SET normalized_email = lower(email)
WHERE normalized_email IS NULL
  AND email IS NOT NULL;
```

Forbidden:

```sql
UPDATE accounts SET balance = balance + 100;
```

Unless intentionally a one-time correction with strict guard and audit approval.

---

## 12. Constraint rules

### 12.1 NOT NULL

Safe sequence for existing table:

1. Add nullable column.
2. Update code to write the column.
3. Backfill existing rows.
4. Verify no nulls.
5. Add/enforce NOT NULL.

### 12.2 Unique constraint

Before adding unique constraint:

- detect duplicates,
- decide merge/delete/repair strategy,
- verify clean data,
- add unique index/constraint using online/concurrent option where supported.

### 12.3 Foreign key

Before adding FK:

- verify all existing references are valid,
- understand lock behavior,
- decide cascade/restrict behavior explicitly,
- avoid surprise cascade deletes.

### 12.4 Check constraint

Before adding check constraint:

- verify existing data,
- consider not-valid/validate sequence where supported,
- make application validation consistent.

---

## 13. Index migration rules

### 13.1 Index intent must be documented

Every new index MUST document:

- query/use case it supports,
- expected cardinality/selectivity,
- columns and order,
- uniqueness,
- partial predicate if any,
- impact on writes,
- removal candidate if replacing old index.

### 13.2 No speculative indexes

Forbidden:

```sql
CREATE INDEX idx_users_email_name_status_created_at ON users(email, name, status, created_at);
```

without query evidence.

### 13.3 Online/concurrent index creation

On production-size tables, use database-supported online/concurrent index creation when required. Verify syntax and transactional restrictions for the target DB.

### 13.4 Index removal

Dropping an index is a contract change. It requires:

- evidence no production query depends on it,
- slow query/plan review,
- rollback or recreate plan,
- maintenance consideration if large.

---

## 14. Destructive change rules

Destructive migrations include:

- drop table,
- drop column,
- truncate data,
- delete data,
- change column type with possible loss,
- rename without compatibility view/alias,
- shrinking column size,
- changing enum/status semantics,
- dropping index required by runtime constraints.

Required before destructive migration:

1. Human approval.
2. Data retention/privacy/legal check.
3. Backup/restore or forward-fix plan.
4. Verification that old app code no longer uses object.
5. Contract phase marker.
6. Observability/alerting during rollout.

Forbidden:

```sql
ALTER TABLE cases DROP COLUMN old_status;
```

unless preceded by expand/switch verification and approved contract phase.

---

## 15. Rename rules

Renames are often breaking changes.

Preferred approach for rolling deploy:

1. Add new column/table.
2. Dual-write or backfill.
3. Read from new with fallback if needed.
4. Deploy all services.
5. Stop old writes.
6. Drop old column/table later.

Avoid direct:

```sql
ALTER TABLE cases RENAME COLUMN status TO lifecycle_status;
```

unless deployment is coordinated and no old app can run.

---

## 16. Type-change rules

Column type changes require:

- data compatibility analysis,
- range/precision check,
- casting plan,
- index/constraint impact,
- application scanner/mapping impact,
- rollback/forward-fix strategy.

Examples requiring special review:

- `INT` to `BIGINT`.
- `VARCHAR` length reduction.
- `TEXT` to enum/type.
- `FLOAT` to decimal/numeric.
- timestamp without timezone to timestamp with timezone.
- JSON text to JSON/JSONB.

---

## 17. Seed/reference data rules

Reference data migrations MUST be idempotent.

Preferred:

```sql
INSERT INTO case_status (code, label)
VALUES ('UNDER_REVIEW', 'Under Review')
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label;
```

If target DB lacks `ON CONFLICT`, use equivalent safe upsert pattern.

Rules:

- Do not delete reference data still used by historical rows.
- Version business semantics when labels/statuses affect workflow.
- Keep display labels separate from durable codes where possible.

---

## 18. State-machine migration rules

Changing workflow/status data is high risk.

Required:

- list old states,
- list new states,
- mapping old → new,
- invalid/legacy state handling,
- transition rules update,
- authorization/policy update,
- reporting/read model update,
- audit impact,
- regulatory deadline impact,
- tests for historical cases.

Forbidden:

```sql
UPDATE enforcement_case SET status = 'CLOSED' WHERE status = 'DONE';
```

without mapping and audit reasoning.

---

## 19. Multi-service database rules

If multiple services access the same database/table:

- migration owner must be explicit,
- compatibility across all services must be checked,
- schema contract must be versioned,
- consumers must be notified,
- incompatible changes require phased rollout.

LLM MUST NOT assume a table is owned by the current service merely because migration file is local.

---

## 20. Go migration runner rules

If writing migration execution code in Go:

### 20.1 Context

Use context with operational timeout.

```go
ctx, cancel := context.WithTimeout(parent, cfg.MigrationTimeout)
defer cancel()
```

### 20.2 Single runner

Ensure only one migration runner can apply migrations to a database at a time.

Acceptable:

- migration tool built-in locking,
- DB advisory lock,
- deployment orchestration lock,
- manual DBA execution.

### 20.3 Logging

Log:

- migration version,
- direction,
- start/end time,
- duration,
- success/failure,
- dirty state,
- safe error class.

Do not log secrets/DSN password.

### 20.4 No auto-migrate in every app instance by default

Production services MUST NOT all run migrations automatically on startup unless explicitly designed with safe locking and failure behavior.

Preferred:

- dedicated migration job,
- CI/CD release step,
- one-shot Kubernetes Job,
- controlled DBA pipeline.

### 20.5 Embedded migrations

Embedding migrations with `embed.FS` is allowed only when:

- files are immutable,
- runner checks versions,
- ordering is deterministic,
- tests run embedded migrations from zero state,
- deployment pipeline still controls execution.

---

## 21. Tool-specific behavior

### 21.1 golang-migrate-style tools

If using a tool with dirty version semantics:

- failed migration leaves database dirty,
- future migrations must be blocked,
- manual fix + force must be documented,
- force version must match actual database state,
- do not add code that auto-forces in production.

### 21.2 ORM auto-migration

Automatic ORM migration is forbidden in production unless project explicitly approves it.

Reasons:

- hidden destructive changes,
- unpredictable ordering,
- weak reviewability,
- poor lock planning,
- environment drift.

Allowed only for local development or tests, if clearly separated.

### 21.3 Declarative schema tools

Declarative migration tools are acceptable only when generated plans are reviewed like hand-written migrations.

The agent MUST include generated SQL/plan in review output when possible.

---

## 22. Environment rules

Migration behavior must be validated across:

- local dev,
- CI ephemeral DB,
- integration test DB,
- staging/UAT clone,
- production.

Rules:

- Do not rely solely on SQLite tests for PostgreSQL/MySQL production semantics.
- Do not use production credentials in tests.
- Do not run destructive test migrations against shared DBs.
- Use fixtures or anonymized clones for volume-sensitive migrations.

---

## 23. Observability rules

Migration pipeline MUST expose:

- current schema version,
- dirty/failed state,
- last successful migration,
- migration duration,
- failures by version,
- lock timeout/deadlock errors,
- row count processed for backfills,
- manual recovery events.

For regulated systems, migration application must be auditable:

- who/what applied it,
- when,
- artifact version/commit,
- approval/change request ID,
- target environment,
- success/failure.

---

## 24. Testing standard

### 24.1 Zero-state test

Migrations MUST be runnable from empty database to latest.

### 24.2 Existing-state test

Migrations MUST be tested from a realistic previous schema version.

### 24.3 Up/down test

If down migrations exist, test up/down/up cycle where safe.

Do not create fake down migrations that pretend data loss is reversible.

### 24.4 Compatibility test

For rolling deploys:

- old app + new schema,
- new app + old schema if possible,
- new app + new schema.

### 24.5 Data migration test

Backfill/correction tests MUST cover:

- zero rows,
- one row,
- many rows,
- already migrated rows,
- null values,
- malformed legacy data,
- duplicate/conflicting data,
- resume after partial failure.

### 24.6 Performance test

For large tables, test:

- row count scale,
- lock duration,
- execution time,
- transaction log/WAL/binlog volume,
- replication lag,
- CPU/I/O impact,
- index build time.

---

## 25. Rollback and recovery rules

### 25.1 Rollback is not always `down.sql`

Rollback strategies may include:

- restore from backup,
- forward fix migration,
- feature flag rollback,
- compatibility view,
- stop writing new column,
- re-run backfill,
- manual data repair.

The agent MUST NOT invent a destructive down migration just for symmetry.

### 25.2 Down migration policy

A down migration is acceptable if:

- it is safe,
- it does not silently lose important data,
- it is tested,
- it documents what is not reversible.

Forbidden:

```sql
-- down.sql
DROP TABLE customer_order;
```

unless the data is disposable and explicitly documented.

### 25.3 Failed migration recovery

Recovery runbook must include:

1. Stop migration pipeline.
2. Inspect migration version table.
3. Inspect actual schema/data state.
4. Decide repair vs restore vs forward fix.
5. Apply repair under approval.
6. Mark version only after state is verified.
7. Resume pipeline.
8. Record incident/change note.

---

## 26. Security and compliance rules

Migration scripts MUST NOT contain:

- secrets,
- passwords,
- API keys,
- private keys,
- production PII test data,
- hardcoded user credentials,
- insecure grants to public/everyone,
- privilege escalation without approval.

Permission changes require review:

```sql
GRANT SELECT ON cases TO reporting_role;
```

Must answer:

- why is access needed?
- what data classification is exposed?
- is row/column restriction required?
- is audit required?

---

## 27. Review checklist

Before accepting a migration, the agent MUST verify:

1. Migration name is descriptive and ordered.
2. Migration is immutable relative to applied environments.
3. Category and risk are documented.
4. Target DB/version is explicit for non-trivial syntax.
5. Rolling deploy compatibility is assessed.
6. Lock behavior is documented.
7. Existing data compatibility is checked.
8. Constraints are added safely.
9. Indexes have query evidence.
10. Backfill is bounded/resumable/idempotent.
11. Destructive changes are approved and phased.
12. Transaction behavior is correct for target DB/tool.
13. Down/rollback strategy is honest.
14. Tests run from zero and previous schema state.
15. Migration runner handles dirty state safely.
16. Observability and audit are sufficient.
17. No secrets or sensitive test data are embedded.
18. Application code and data mapper changes are aligned.
19. Repository queries have matching indexes/constraints.
20. Compliance/data-retention implications are addressed.

---

## 28. Rejection triggers

Reject migration work if it contains:

- editing an already-applied migration.
- direct destructive drop without phased contract plan.
- unbounded update on large table.
- adding NOT NULL column to populated table without default/backfill plan.
- adding unique constraint without duplicate check.
- adding FK without orphan check.
- index creation on hot large table without lock strategy.
- raw production data/PII/secrets in migration.
- fake rollback that loses data silently.
- auto-forcing dirty migration state.
- ORM auto-migration in production without explicit project approval.
- no compatibility plan for rolling deploy.
- no test evidence for data migration.

---

## 29. Example: safe additive migration

```sql
-- Migration: 20260610123000_add_case_version
-- Category: schema additive
-- Risk: low
-- Target DB: PostgreSQL 16
-- Expected lock: short metadata lock; verify on target DB/version
-- App compatibility: old app ignores column; new app writes version
-- Rollout: expand
-- Rollback: forward fix; column remains unused if app rollback occurs
-- Verification: column exists; repository optimistic-lock tests pass

ALTER TABLE enforcement_case
ADD COLUMN version BIGINT;
```

Follow-up backfill:

```sql
-- Migration: 20260610124500_backfill_case_version
-- Category: data backfill
-- Risk: medium on large table
-- Target DB: PostgreSQL 16
-- Expected lock: row-level updates; batch externally if table is large
-- Rollout: migrate
-- Verification: no rows where version IS NULL

UPDATE enforcement_case
SET version = 1
WHERE version IS NULL;
```

Only acceptable for small tables or controlled maintenance. For large tables, use a batched Go job.

Contract migration:

```sql
-- Migration: 20260611100000_enforce_case_version_not_null
-- Category: schema restrictive
-- Risk: medium
-- Target DB: PostgreSQL 16
-- Prerequisite: SELECT COUNT(*) FROM enforcement_case WHERE version IS NULL = 0
-- Rollout: contract

ALTER TABLE enforcement_case
ALTER COLUMN version SET DEFAULT 1;

ALTER TABLE enforcement_case
ALTER COLUMN version SET NOT NULL;
```

---

## 30. Example: Go migration job skeleton

```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log/slog"
    "time"
)

type BackfillConfig struct {
    BatchSize int64
    Timeout   time.Duration
}

func BackfillCaseVersion(parent context.Context, db *sql.DB, cfg BackfillConfig, logger *slog.Logger) error {
    if db == nil {
        return errors.New("nil db")
    }
    if cfg.BatchSize <= 0 {
        return errors.New("invalid batch size")
    }

    ctx, cancel := context.WithTimeout(parent, cfg.Timeout)
    defer cancel()

    var startID int64
    for {
        endID := startID + cfg.BatchSize
        res, err := db.ExecContext(ctx, `
            UPDATE enforcement_case
            SET version = 1
            WHERE id >= $1
              AND id < $2
              AND version IS NULL
        `, startID, endID)
        if err != nil {
            return fmt.Errorf("backfill case version range [%d,%d): %w", startID, endID, err)
        }

        affected, err := res.RowsAffected()
        if err != nil {
            return fmt.Errorf("read affected rows for range [%d,%d): %w", startID, endID, err)
        }

        logger.InfoContext(ctx, "case version backfill batch completed",
            "start_id", startID,
            "end_id", endID,
            "affected_rows", affected,
        )

        // Project-specific termination should query max ID or remaining rows.
        if affected == 0 {
            var remaining int64
            err := db.QueryRowContext(ctx, `
                SELECT COUNT(*)
                FROM enforcement_case
                WHERE id >= $1
                  AND version IS NULL
            `, endID).Scan(&remaining)
            if err != nil {
                return fmt.Errorf("check remaining case version rows: %w", err)
            }
            if remaining == 0 {
                return nil
            }
        }

        startID = endID
    }
}
```

---

## 31. Final rule

A migration is complete only when the schema change, application compatibility, data safety, rollback/recovery story, operational visibility, and test evidence are all clear. If any of those are missing, the LLM must stop and surface the risk instead of generating a deceptively simple SQL file.

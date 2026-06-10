# Strict Coding Standards — Java Flyway

> **File:** `strict-coding-standards__java_flyaway.md`  
> **Scope:** Java applications using **Flyway by Redgate** for database schema migration.  
> **Applies to:** Java 11/17/21/25 applications, Spring Boot, Jakarta EE, Quarkus, Micronaut, CLI migration jobs, Kubernetes jobs, CI/CD pipelines.  
> **Companion standards:** `strict-coding-standards__jdbc.md`, `strict-coding-standards__java_postgresql.md`, `strict-coding-standards__java_hikari_cp.md`, `strict-coding-standards__gradle.md`, `strict-coding-standards__maven.md`, `strict-coding-standards__java_testing.md`.

---

## 1. Purpose

Flyway migration code is production data-change code.

An LLM must treat every Flyway change as a **state transition of a persistent database**, not as disposable setup code.

The goal of this standard is to prevent:

- accidental destructive DDL,
- checksum drift,
- unsafe repeatable migrations,
- environment-specific migration behavior,
- application startup failures caused by uncontrolled migration,
- hidden dependency on ORM auto-DDL,
- missing rollback/roll-forward strategy,
- non-idempotent repair/baseline operations,
- migration race conditions in clustered deployment,
- data corruption during backfill/refactor migrations.

---

## 2. Non-Negotiable Rules

### 2.1 Flyway is the schema authority

If Flyway is enabled for a database, the LLM **MUST NOT** generate competing schema management paths.

Forbidden:

- Hibernate `ddl-auto=update` in production.
- EclipseLink automatic schema generation in production.
- manual startup DDL in application services.
- ad hoc SQL executed outside migration scripts for required schema changes.
- mutable bootstrap SQL that bypasses Flyway history.

Allowed only for local/dev test fixtures:

- `clean` + `migrate` in disposable databases.
- Testcontainers init scripts.
- in-memory schema creation for unit tests.

Production schema state must be explainable from:

1. migration scripts,
2. Flyway schema history table,
3. deployment metadata.

---

### 2.2 Do not edit applied versioned migrations

Once a versioned migration has been applied to any shared environment, the LLM **MUST NOT** modify it.

Instead:

- create a new versioned migration,
- roll forward with corrective SQL,
- document why the correction is needed.

Forbidden:

```text
Edit V2025_01_10_001__create_user_table.sql after UAT/PROD execution.
```

Required:

```text
V2025_01_12_001__add_missing_user_status_constraint.sql
```

Rationale: Flyway tracks checksums. Editing applied migrations creates checksum mismatch and undermines reproducibility.

---

### 2.3 Migration must be deterministic

A migration must produce the same logical schema/data result when applied to the same prior database state.

Forbidden:

- calling external HTTP APIs from Java migration,
- using wall-clock time for durable business data without explicit reason,
- random IDs for reference data when stable IDs are required,
- environment-dependent DDL,
- dependency on current application code behavior,
- dependency on unordered `SELECT` results when order matters.

Restricted:

- Java-based migrations.
- callbacks.
- placeholders.
- repeatable migrations for data.

---

### 2.4 Migration must be reviewable as database code

Every non-trivial migration must be understandable by a database reviewer.

A migration is non-trivial if it includes:

- table rewrite,
- large backfill,
- index creation on large table,
- column type change,
- constraint validation,
- lock-prone operation,
- data deletion,
- data transformation,
- stored procedure/function/view replacement,
- partition changes,
- tenant-wide operation,
- security/permission change.

Non-trivial migrations must include comments explaining:

- intended state transition,
- expected affected rows,
- lock/concurrency risk,
- rollback or roll-forward plan,
- validation query.

---

## 3. Version and Dependency Policy

### 3.1 Version must be pinned

The LLM **MUST NOT** use floating Flyway versions.

Forbidden:

```gradle
implementation("org.flywaydb:flyway-core:+")
```

Forbidden:

```xml
<version>LATEST</version>
```

Required:

- pin explicit version, or
- use approved platform BOM such as Spring Boot dependency management, with version visible in dependency report.

---

### 3.2 Database-specific modules must be explicit

Modern Flyway distributions may require database-specific support artifacts depending on database and version.

The LLM must verify the required module for the target database.

For PostgreSQL-style projects, dependency selection must be explicit and reviewed.

Example Gradle pattern:

```kotlin
dependencies {
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
}
```

If platform BOM manages versions, do not repeat versions manually unless required by the project policy.

---

### 3.3 One migration tool per database

A production database schema must not be concurrently controlled by both Flyway and Liquibase unless a formal migration-tool transition is underway.

Forbidden by default:

- Flyway and Liquibase both auto-running against the same schema.
- Flyway plus ORM auto-DDL.
- Flyway plus hand-written deployment script outside schema history.

Allowed only with explicit architecture decision record:

- tool migration from Liquibase to Flyway,
- schema split where different schemas are owned by different tools,
- vendor-managed schema separate from application schema.

---

## 4. Migration File Naming

### 4.1 Naming must be stable and sortable

Default naming convention:

```text
VYYYY_MM_DD_NNN__description.sql
R__description.sql
BYYYY_MM_DD_NNN__description.sql
```

Examples:

```text
V2026_06_10_001__create_case_assignment_table.sql
V2026_06_10_002__add_case_assignment_indexes.sql
R__case_status_summary_view.sql
B2026_06_10_001__baseline_existing_schema.sql
```

Rules:

- versioned migration starts with `V`.
- repeatable migration starts with `R`.
- baseline migration starts with `B` only if baseline migrations are intentionally used.
- separator between version and description must be `__`.
- description must be lowercase snake case.
- no spaces.
- no vague descriptions like `fix`, `update`, `changes`, `misc`.

---

### 4.2 One migration, one purpose

A versioned migration should represent one logical database change.

Avoid mixing unrelated changes:

```text
BAD:
V2026_06_10_001__update_schema.sql
- create invoice table
- alter customer status
- update seed permissions
- create audit view
```

Better:

```text
V2026_06_10_001__create_invoice_table.sql
V2026_06_10_002__add_customer_status_reason.sql
V2026_06_10_003__seed_invoice_permissions.sql
R__audit_invoice_view.sql
```

---

## 5. Directory Structure

Recommended project structure:

```text
src/main/resources/db/migration/
  V2026_06_10_001__create_case_table.sql
  V2026_06_10_002__add_case_status_index.sql
  R__case_summary_view.sql

src/test/resources/db/migration/
  V9999_01_01_001__test_only_schema_extension.sql
```

Multi-database structure:

```text
src/main/resources/db/migration/common/
src/main/resources/db/migration/postgresql/
src/main/resources/db/migration/oracle/
```

Rules:

- default production migrations live under a stable path.
- test-only migrations must never be packaged into production artifact unless intentionally scoped.
- database-specific migrations must not be hidden under generic names.
- generated migration output must not overwrite human-authored migration scripts.

---

## 6. SQL Migration Standards

### 6.1 Prefer plain SQL migrations

Default: use SQL migrations.

Java-based migrations are restricted because they:

- depend on compiled application code,
- can hide database state changes in imperative logic,
- are harder for DBAs to review,
- may behave differently across library/JDK versions.

Use Java migration only when SQL is insufficient, such as:

- complex data transformation requiring streaming,
- vendor API interaction within database driver boundary,
- migration requiring controlled batching beyond SQL capability.

Even then, Java migration must have:

- bounded memory,
- deterministic behavior,
- explicit transaction policy,
- tests on realistic data,
- no external network calls.

---

### 6.2 SQL must be explicit

Forbidden:

```sql
SELECT * FROM users;
```

Required:

```sql
SELECT id, status, created_at
FROM users;
```

Forbidden in migration scripts unless explicitly justified:

```sql
DROP TABLE some_table;
TRUNCATE TABLE some_table;
DELETE FROM some_table;
UPDATE some_table SET ...;
ALTER TABLE huge_table ALTER COLUMN ... TYPE ...;
```

Destructive or wide changes require:

- affected-row estimate,
- backup/restore consideration,
- validation query,
- approval note.

---

### 6.3 Use transactional DDL consciously

The LLM must not assume all databases handle DDL transactions the same way.

Rules:

- State target database.
- Know whether DDL participates in transactions.
- Avoid mixing lock-heavy DDL and large DML in one migration without review.
- For PostgreSQL, still evaluate locks even if DDL is transactional.
- For Oracle/MySQL-like systems, be aware of implicit commits or non-transactional DDL behavior depending on operation.

---

### 6.4 DDL and DML separation

Prefer separating schema changes and data backfills.

Recommended pattern:

1. add nullable column,
2. deploy application compatible with old/new shape,
3. backfill in bounded batches,
4. add constraint/default,
5. remove old column later.

Avoid one-shot high-risk migration:

```sql
ALTER TABLE orders ADD COLUMN normalized_ref text NOT NULL;
UPDATE orders SET normalized_ref = expensive_function(raw_ref);
```

Better:

```sql
ALTER TABLE orders ADD COLUMN normalized_ref text;
```

Then controlled backfill and later constraint migration.

---

## 7. Repeatable Migration Rules

### 7.1 Repeatable migrations are for replaceable objects

Allowed repeatable migrations:

- views,
- functions,
- stored procedures,
- packages,
- stable reference data reload with deterministic content,
- permissions grants that are intentionally re-applied.

Forbidden by default:

- mutable business data transformations,
- one-time backfills,
- audit data changes,
- destructive DDL,
- sequence resets,
- changes depending on current data volume.

---

### 7.2 Repeatable migration must be idempotent

Repeatable migration must safely re-run whenever its checksum changes.

Required patterns:

```sql
CREATE OR REPLACE VIEW case_summary AS
SELECT ...;
```

or:

```sql
DROP VIEW IF EXISTS case_summary;
CREATE VIEW case_summary AS
SELECT ...;
```

Use destructive drop/recreate only if dependencies and privileges are understood.

---

### 7.3 Repeatable reference data must be deterministic

If repeatable migration manages reference data:

- use stable natural keys or IDs,
- use upsert/merge pattern,
- do not delete unrecognized rows unless explicitly intended,
- do not depend on current timestamp as business value,
- document ownership of reference table.

---

## 8. Baseline Rules

### 8.1 Baseline is a one-time trust operation

Baseline must not be casually generated.

Required baseline note:

```text
Baseline reason:
- existing production schema introduced before Flyway adoption
- schema snapshot date
- database/schema name
- source of truth used to generate baseline
- validation method
```

Forbidden:

- baselining a broken database to bypass failed migrations.
- using baseline as normal deployment repair.
- using baseline to hide migration divergence.

---

### 8.2 Baseline version must be deliberate

If using `baselineOnMigrate`, the LLM must not enable it by default.

Restricted:

```properties
flyway.baseline-on-migrate=true
```

Allowed only when:

- onboarding an existing schema,
- environment is explicitly identified,
- baseline version is documented,
- operator understands consequence.

---

## 9. `repair`, `clean`, and Dangerous Commands

### 9.1 `clean` is forbidden in shared environments

Forbidden in production, UAT, staging, shared dev:

```bash
flyway clean
```

Allowed only for:

- disposable local dev DB,
- disposable CI DB,
- Testcontainers DB.

CI must protect against accidental clean on real database.

---

### 9.2 `repair` requires incident note

Flyway `repair` can modify schema history metadata.

The LLM must never suggest `repair` as the first response to a checksum error.

Required before repair:

- identify the migration mismatch,
- determine whether script was edited after apply,
- compare environment history,
- decide whether new corrective migration is safer,
- document operator action.

Repair may be valid for:

- removing failed migration entry after incomplete migration cleanup,
- aligning metadata after intentional manual correction with approval,
- repairing checksum only when script edit is approved and safe.

---

## 10. Transaction and Locking Standards

### 10.1 Migration lock risk must be reviewed

Migrations must consider database locks.

High-risk operations include:

- adding `NOT NULL` column with default on large table,
- type conversion of large column,
- creating index without concurrent option where supported,
- adding foreign key validation on huge tables,
- table rewrite,
- large update/delete,
- altering primary key,
- repartitioning.

Migration comment must include lock strategy when applicable.

---

### 10.2 Use database-specific online migration features

Examples:

PostgreSQL:

- `CREATE INDEX CONCURRENTLY` for large tables when appropriate.
- `NOT VALID` then `VALIDATE CONSTRAINT` for constraints when appropriate.
- batch updates using stable key ranges.

But the LLM must not blindly apply these. Some operations cannot run inside transaction blocks.

Flyway transaction behavior must be adjusted only when necessary and documented.

---

## 11. Data Backfill Standards

### 11.1 Backfill must be bounded

Forbidden:

```sql
UPDATE huge_table SET processed = true;
```

Required for large tables:

- estimate row count,
- batch by primary key/time range,
- avoid long locks,
- validate progress,
- rerunnable or resumable behavior,
- monitor duration and row locks.

---

### 11.2 Backfill must preserve application compatibility

For zero/low downtime deployment, use expand-contract:

1. expand schema,
2. deploy compatible app,
3. backfill,
4. enforce constraints,
5. contract old schema.

The LLM must not generate migration that requires all app instances to switch atomically unless deployment platform guarantees it.

---

## 12. Spring Boot Integration Rules

### 12.1 Auto-run migration must be intentional

Spring Boot auto-running Flyway at startup can be acceptable for simple apps but is restricted for large/regulated systems.

For production services, one of these must be chosen explicitly:

- app startup migration,
- CI/CD migration step before deploy,
- Kubernetes migration Job,
- DBA-operated migration.

The LLM must not silently enable startup migration in clustered services.

Risk: multiple pods starting while migration is executing, long startup failure, DB lock contention, rollout stuck.

---

### 12.2 Migration and application user may differ

Preferred production model:

- migration user: DDL privileges,
- application user: least privilege DML runtime privileges.

The LLM must not assume application runtime user can or should run DDL.

---

## 13. Configuration Standards

### 13.1 Required config fields

A production Flyway setup must explicitly define:

- locations,
- schemas/default schema,
- migration table name if non-default,
- baseline policy,
- clean disabled policy,
- placeholders policy,
- target database,
- connection source,
- migration execution owner.

Example Spring properties:

```properties
spring.flyway.enabled=true
spring.flyway.locations=classpath:db/migration/postgresql
spring.flyway.clean-disabled=true
spring.flyway.validate-on-migrate=true
spring.flyway.baseline-on-migrate=false
```

---

### 13.2 Placeholders are restricted

Placeholders can make migration behavior environment-dependent.

Allowed:

- schema name controlled by deployment config,
- tablespace name controlled by DBA policy,
- role name for grants.

Forbidden:

- placeholders that change business logic,
- placeholders that change DDL shape across environments,
- placeholders for secrets,
- placeholders for arbitrary SQL fragments.

---

## 14. Security Standards

### 14.1 Migration scripts must not contain secrets

Forbidden:

```sql
INSERT INTO api_credentials(secret) VALUES ('real-secret');
```

Allowed:

- create secret reference key,
- create placeholder row without secret value,
- create encrypted key reference managed externally.

---

### 14.2 Least privilege

Migration accounts must be scoped.

Rules:

- never use superuser/root unless explicitly required and approved,
- application runtime account must not inherit migration privileges,
- grants/revokes must be explicit,
- ownership changes must be reviewed.

---

## 15. Testing Standards

### 15.1 Migration tests are mandatory for non-trivial changes

Test levels:

1. apply all migrations to empty database,
2. apply from realistic baseline snapshot,
3. verify schema constraints/indexes,
4. verify data backfill,
5. verify application compatibility,
6. verify rollback/roll-forward plan where applicable.

Recommended with Testcontainers:

- use real target database version,
- run `migrate`,
- assert schema and data invariants,
- run selected repository/integration tests.

---

### 15.2 Validate migration history in CI

CI must run:

```bash
flyway validate
flyway migrate
```

against disposable database.

For multi-module projects, migration validation must run for every module owning migrations.

---

## 16. Observability and Operations

Migration execution must be observable.

Record:

- Flyway version,
- application artifact version,
- database target,
- migration versions applied,
- start/end time,
- success/failure,
- migration actor,
- deployment ID.

Logs must not include database passwords or secret placeholders.

---

## 17. LLM Forbidden Patterns

The LLM must not generate:

```sql
-- vague destructive migration
DROP TABLE old_table;
```

without justification.

The LLM must not suggest:

```bash
flyway repair
```

before diagnosing checksum mismatch.

The LLM must not enable:

```properties
spring.jpa.hibernate.ddl-auto=update
```

alongside Flyway for production.

The LLM must not generate:

```properties
spring.flyway.clean-disabled=false
```

for shared/prod environments.

The LLM must not edit historical versioned migration to fix production schema.

---

## 18. Review Checklist

Before approving a Flyway change, verify:

- [ ] migration filename follows project convention.
- [ ] migration has one clear purpose.
- [ ] applied versioned migrations were not edited.
- [ ] destructive operations are justified.
- [ ] large-table operations have lock/backfill plan.
- [ ] data migrations are deterministic.
- [ ] repeatable migrations are idempotent.
- [ ] baseline usage is documented.
- [ ] `clean` is disabled outside disposable environments.
- [ ] `repair` is not used to hide drift.
- [ ] migration tool does not conflict with ORM auto-DDL.
- [ ] CI runs validate + migrate on real target DB engine.
- [ ] migration user and runtime app user privileges are separated where required.
- [ ] rollback or roll-forward plan exists.
- [ ] observability/logging exists.

---

## 19. Prompt Contract for LLM Code Agent

When implementing Flyway migrations, the LLM must follow this protocol:

```text
Before generating a Flyway migration:
1. Identify target database engine and version.
2. Identify whether the migration is schema-only, data-only, or mixed.
3. Check whether an existing migration has already been applied; never edit applied migrations.
4. Choose versioned vs repeatable vs baseline migration intentionally.
5. State lock/data-loss/backfill risk.
6. Generate deterministic SQL.
7. Include validation queries for non-trivial changes.
8. Update tests/CI if migration behavior changes.
9. Do not enable clean/repair/baselineOnMigrate without explicit approval.
10. Do not enable ORM auto-DDL as a substitute for migration.
```

---

## 20. References

- Redgate Flyway Documentation — Migrations: https://documentation.red-gate.com/fd/migrations-271585107.html
- Redgate Flyway Documentation — Repeatable Migrations: https://documentation.red-gate.com/fd/repeatable-migrations-273973335.html
- Redgate Flyway Documentation — Baseline Migrations: https://documentation.red-gate.com/fd/tutorial-baseline-migrations-277579339.html
- Redgate Flyway Documentation — Java API: https://documentation.red-gate.com/fd/api-java-277579358.html
- Flyway GitHub: https://github.com/flyway/flyway

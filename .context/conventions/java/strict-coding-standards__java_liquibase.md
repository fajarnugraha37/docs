# Strict Coding Standards — Java Liquibase

> **File:** `strict-coding-standards__java_liquibase.md`  
> **Scope:** Java applications using **Liquibase** for database schema and data change management.  
> **Applies to:** Java 11/17/21/25 applications, Spring Boot, Jakarta EE, Quarkus, Micronaut, CI/CD migration jobs, regulated systems.  
> **Companion standards:** `strict-coding-standards__jdbc.md`, `strict-coding-standards__java_postgresql.md`, `strict-coding-standards__java_hikari_cp.md`, `strict-coding-standards__gradle.md`, `strict-coding-standards__maven.md`, `strict-coding-standards__java_testing.md`.

---

## 1. Purpose

Liquibase changesets are production database state-transition artifacts.

The LLM must treat Liquibase changelogs as:

- auditable database change history,
- deployment contract,
- schema governance evidence,
- rollback/roll-forward documentation,
- cross-environment consistency mechanism.

This standard prevents:

- checksum drift,
- unsafe changeset edits,
- accidental destructive changes,
- misuse of preconditions,
- unreliable rollback assumptions,
- environment-dependent changelogs,
- misuse of contexts/labels,
- mixing Liquibase with ORM auto-DDL,
- database changes hidden in application startup code.

---

## 2. Non-Negotiable Rules

### 2.1 Liquibase is the schema authority

If Liquibase manages a schema, the LLM **MUST NOT** generate competing schema-management mechanisms.

Forbidden in production:

- Hibernate `ddl-auto=update`.
- EclipseLink schema generation.
- manual DDL executed by service startup.
- ad hoc migration SQL outside Liquibase history.
- Flyway concurrently managing same schema without formal migration plan.

The database state must be explainable from:

1. changelog files,
2. `DATABASECHANGELOG`,
3. deployment metadata,
4. approved manual operations, if any.

---

### 2.2 Applied changesets are immutable by default

Once a changeset has been applied to a shared environment, the LLM **MUST NOT** modify it.

Instead:

- add a new corrective changeset,
- use explicit roll-forward migration,
- document the correction.

Forbidden:

```xml
<!-- Editing an already deployed changeset to change a column type -->
<changeSet id="2026-06-10-001" author="app">
    ... modified after deployment ...
</changeSet>
```

Required:

```xml
<changeSet id="2026-06-12-001-fix-column-type" author="app">
    ... corrective change ...
</changeSet>
```

Reason: Liquibase stores checksums and detects changes to already-run changesets.

---

### 2.3 Changelog must be deterministic

A changelog must not behave differently across environments unless controlled by explicit, reviewed `context`, `label`, or property policy.

Forbidden:

- changing schema shape via arbitrary environment property,
- using random data for reference rows,
- using current timestamp for stable reference data,
- executing external HTTP calls in custom change,
- hidden application-code dependency,
- manual edits to `DATABASECHANGELOG`.

Restricted:

- `runAlways`.
- `runOnChange`.
- custom changes.
- preconditions with `MARK_RAN`.
- formatted SQL includes.

---

## 3. Version and Dependency Policy

### 3.1 Pin Liquibase version

The LLM must not use floating Liquibase versions.

Forbidden:

```gradle
implementation("org.liquibase:liquibase-core:+")
```

Forbidden:

```xml
<version>LATEST</version>
```

Required:

- pin explicit version, or
- use approved platform BOM/dependency management,
- document Liquibase CLI/plugin version used by CI.

---

### 3.2 Runtime and CLI versions must not silently diverge

If Liquibase runs from:

- application startup,
- Maven plugin,
- Gradle plugin,
- CLI container,
- CI/CD job,

then the versions and changelog resolution must be documented.

The LLM must not assume a plugin and runtime library use identical Liquibase versions.

---

### 3.3 One migration tool per schema

Liquibase and Flyway must not both mutate the same schema in normal operation.

Allowed only with explicit transition plan:

- historical Flyway table retained read-only,
- Liquibase starts from a baseline/tag,
- ownership boundary is documented.

---

## 4. Changelog Structure

### 4.1 Recommended directory layout

```text
src/main/resources/db/changelog/
  db.changelog-master.yaml
  changes/
    2026/
      06/
        2026-06-10-001-create-case-table.yaml
        2026-06-10-002-add-case-status-index.yaml
  sql/
    2026/
      06/
        2026-06-10-003-backfill-case-status.sql
```

Alternative XML structure:

```text
src/main/resources/db/changelog/
  db.changelog-master.xml
  changes/2026/06/2026-06-10-001-create-case-table.xml
```

Rules:

- master changelog includes smaller files.
- files are grouped chronologically or by bounded domain.
- one file must not become an unbounded dumping ground.
- test changelogs must not be packaged into production accidentally.

---

### 4.2 Changelog format policy

Allowed formats:

- XML,
- YAML,
- JSON,
- formatted SQL,
- raw SQL included intentionally.

Project must choose one primary format unless there is a reason to mix.

Recommended:

- XML/YAML for structured portable changes and preconditions.
- formatted SQL for database-specific precise SQL.
- raw SQL only through reviewed include path.

The LLM must not mix formats in the same change without explaining why.

---

## 5. Changeset Identity Rules

### 5.1 `id` must be globally stable in its file path

A changeset is identified by:

- `id`,
- `author`,
- changelog file path.

Rules:

- ID must be stable.
- Author must be stable and team-meaningful.
- Moving changelog files after deployment is restricted because file path participates in identity.
- IDs must not be reused.

Recommended ID format:

```text
YYYY-MM-DD-NNN-short-description
```

Example:

```yaml
- changeSet:
    id: 2026-06-10-001-create-case-table
    author: case-platform
```

---

### 5.2 One changeset, one purpose

A changeset should represent one logical change.

Bad:

```yaml
id: 2026-06-10-001-update-everything
changes:
  - createTable: ...
  - addColumn: ... unrelated table ...
  - sql: delete old records
  - createIndex: ... unrelated index ...
```

Better:

```yaml
2026-06-10-001-create-case-table
2026-06-10-002-add-case-status-column
2026-06-10-003-backfill-case-status
2026-06-10-004-add-case-status-not-null
```

---

## 6. Checksum Rules

### 6.1 Checksum mismatch is an incident, not a nuisance

When checksum mismatch occurs, the LLM must not recommend bypass first.

Investigation order:

1. Identify changed file and changeset.
2. Check whether changeset was applied anywhere shared.
3. Determine if edit was accidental.
4. Prefer new corrective changeset.
5. Use `validCheckSum` only with explicit justification.
6. Never manually edit `DATABASECHANGELOG` without operator approval.

---

### 6.2 `runOnChange` is restricted

Allowed for:

- views,
- stored functions/procedures,
- repeatable grants,
- deterministic reference data owned fully by changelog.

Forbidden by default for:

- destructive DDL,
- one-time data backfill,
- audit data mutation,
- business transaction data.

---

### 6.3 `runAlways` is highly restricted

`runAlways` must be used only when repeated execution is intended and safe.

Allowed examples:

- update deployment metadata table with current deployed version, if designed.
- refresh non-critical derived metadata.

Forbidden:

- incrementing counters,
- inserting duplicate rows,
- deleting rows,
- changing business state.

---

## 7. Preconditions

### 7.1 Preconditions must protect correctness, not hide failure

Preconditions are allowed for:

- checking table/column/index existence,
- checking DBMS type,
- checking expected data shape before transformation,
- protecting destructive changes,
- preventing accidental execution in wrong schema.

Forbidden:

- using preconditions to silently ignore real drift.
- broad `onFail: MARK_RAN` without explanation.
- using preconditions as substitute for deterministic migration design.

---

### 7.2 `MARK_RAN` is restricted

`MARK_RAN` changes history without applying the change.

Allowed only when:

- desired state already exists,
- validation query proves it,
- reason is documented.

Example acceptable use:

```yaml
preConditions:
  - onFail: MARK_RAN
  - columnExists:
      tableName: case_record
      columnName: external_ref
```

But this must be reviewed for drift risk.

---

## 8. Rollback Standards

### 8.1 Rollback must not be assumed

Liquibase supports rollback mechanisms, but not every production change is safely reversible.

Every non-trivial changeset must classify rollback strategy:

- automatic rollback available,
- explicit rollback SQL provided,
- rollback impossible; roll-forward required,
- backup/restore required,
- application-level compensation required.

---

### 8.2 Destructive changes require explicit rollback note

For changes like:

- drop column,
- drop table,
- delete data,
- truncate table,
- shrink datatype,
- irreversible transformation,

Required:

- precondition,
- backup/retention note,
- explicit rollback limitation,
- roll-forward strategy.

Example:

```yaml
rollback:
  - sql: |
      -- Rollback cannot restore dropped data.
      -- Restore from backup or run corrective migration from archive.
      SELECT 1;
```

Do not write fake rollback that does not restore data semantics.

---

## 9. SQL and Change Type Standards

### 9.1 Structured changes vs raw SQL

Use structured changes when they improve clarity and portability:

```yaml
- createTable:
    tableName: case_record
```

Use raw SQL when:

- database-specific feature is required,
- online index/constraint feature is needed,
- optimized backfill is required,
- structured change is ambiguous or less safe.

The LLM must not force portability at the expense of correctness.

---

### 9.2 Raw SQL must be reviewed like production code

Raw SQL changesets must include:

- target database assumption,
- locking consideration,
- affected row expectation for DML,
- validation query for non-trivial change.

Formatted SQL file must include proper Liquibase formatted SQL header when using formatted SQL mode.

---

### 9.3 Avoid mixing schema and data changes

Prefer separate changesets:

1. schema expansion,
2. data backfill,
3. constraint enforcement,
4. cleanup/contract.

This improves rollback and deployment safety.

---

## 10. Contexts and Labels

### 10.1 Contexts/labels must not create schema drift

Allowed:

- dev-only seed data,
- test-only fixtures,
- optional module migration,
- tenant-specific controlled migration,
- feature-gated rollout where policy exists.

Forbidden:

- production schema differs from staging without explicit reason.
- core tables only exist in some environments by accidental context.
- constraints/indexes differ by environment to hide performance problem.

---

### 10.2 Dev/test data must be isolated

Dev/test seed data must use context/label and must never run in production by default.

Example:

```yaml
context: dev,test
```

Production execution must specify allowed context/label policy explicitly.

---

## 11. Data Backfill Standards

### 11.1 Large DML must be bounded

Forbidden:

```yaml
- sql: UPDATE huge_table SET normalized = true;
```

Required for large tables:

- estimate row count,
- batch by primary key/range,
- avoid long locks,
- make rerunnable when possible,
- record progress strategy,
- test on realistic data volume.

---

### 11.2 Data changes must be idempotent or clearly one-time

For reference data:

- prefer stable keys,
- use upsert/merge if supported,
- avoid duplicate rows on re-run,
- avoid current timestamp unless it is deployment metadata.

For transactional data:

- avoid mutation unless absolutely required,
- write validation query,
- avoid irreversible transformation without backup.

---

## 12. Java Integration Rules

### 12.1 Application startup migration is restricted

Liquibase may run at Spring Boot startup, but production systems must choose migration execution model explicitly:

- app startup migration,
- CI/CD pre-deploy migration,
- Kubernetes Job,
- manual DBA-controlled migration.

LLM must not silently enable startup migration in horizontally scaled services.

Risks:

- pod startup blocked by long migration,
- rollout failure,
- lock contention,
- migration user privileges in runtime app,
- unclear failure ownership.

---

### 12.2 Migration user should differ from runtime user

Preferred:

- Liquibase user has DDL privileges.
- Application runtime user has least-privilege DML.

The LLM must not grant DDL to runtime app user just to make startup migrations work.

---

## 13. Maven and Gradle Rules

### 13.1 Build plugin execution must be explicit

Maven/Gradle Liquibase tasks must not accidentally run against production from developer machines.

Required safeguards:

- environment-specific URL from secure config,
- no production password in build files,
- profile/task names clearly distinguish local vs prod,
- CI has approval gates,
- dry-run/updateSQL available for review where applicable.

---

### 13.2 Generated changelogs are restricted

Liquibase can generate changelogs, but generated output must be reviewed and normalized before commit.

Forbidden:

- committing generated changelog blindly,
- generating noisy diff from non-canonical schema,
- using generated changelog as proof of intended domain model.

Required:

- human review,
- naming cleanup,
- constraint/index review,
- rollback strategy.

---

## 14. Security Standards

### 14.1 Changelog must not contain secrets

Forbidden:

```yaml
- insert:
    tableName: api_credentials
    columns:
      - column:
          name: secret
          value: real-secret
```

Allowed:

- secret reference name,
- key alias,
- role creation without password where managed externally,
- placeholder only if value comes from secure secret manager and is not persisted as plaintext.

---

### 14.2 SQL injection risk still exists

Liquibase changelogs are usually trusted code, but generated SQL, properties, and dynamic SQL can still become injection vectors if user-controlled values enter changelog execution.

Rules:

- no user input in changelog property substitution,
- no arbitrary SQL property fragments,
- migration parameters must be allow-listed,
- secrets must not be logged.

---

## 15. Testing Standards

### 15.1 Migration test matrix

For non-trivial changelog changes, test:

- apply from empty database,
- apply from previous released schema,
- apply with realistic data shape,
- validate constraints/indexes,
- validate rollback or roll-forward path,
- validate application compatibility after migration.

Use Testcontainers or real ephemeral database matching production engine/version.

---

### 15.2 CI commands

CI should run:

```bash
liquibase validate
liquibase update
```

For review, generate SQL preview when appropriate:

```bash
liquibase updateSQL
```

If rollback is claimed:

```bash
liquibase rollback-count --count=N
```

or equivalent tag-based rollback test in disposable DB.

---

## 16. Observability and Audit

Migration execution must record:

- Liquibase version,
- application artifact version,
- changelog path,
- changesets executed,
- database/schema target,
- execution actor,
- start/end time,
- deployment ID,
- failure reason.

Logs must not print database password, secrets, tokens, or sensitive data values.

---

## 17. LLM Forbidden Patterns

The LLM must not generate:

```yaml
runAlways: true
```

without explicit reason.

The LLM must not use:

```yaml
onFail: MARK_RAN
```

as a generic fix for migration failure.

The LLM must not edit applied changesets to fix checksum mismatch.

The LLM must not suggest manual `DATABASECHANGELOG` edits unless this is an operator-approved incident process.

The LLM must not enable ORM auto-DDL beside Liquibase.

The LLM must not put secrets in changelogs.

---

## 18. Review Checklist

Before approving Liquibase changes:

- [ ] changeset ID/author/path are stable.
- [ ] changeset has one clear purpose.
- [ ] applied changesets were not modified.
- [ ] checksum-impacting edits are understood.
- [ ] preconditions are protective, not failure-hiding.
- [ ] `runOnChange`/`runAlways` are justified.
- [ ] rollback/roll-forward strategy is explicit.
- [ ] destructive changes have backup/validation note.
- [ ] contexts/labels do not create accidental drift.
- [ ] migration user privilege is appropriate.
- [ ] build/plugin execution cannot accidentally target production.
- [ ] tests run against real target database.
- [ ] updateSQL/diff output reviewed for non-trivial migration.
- [ ] no secrets are committed.
- [ ] no ORM auto-DDL conflict exists.

---

## 19. Prompt Contract for LLM Code Agent

When implementing Liquibase changes, the LLM must follow this protocol:

```text
Before generating a Liquibase changelog:
1. Identify target DB engine/version.
2. Identify execution model: app startup, CI/CD job, CLI, or manual DBA process.
3. Decide if change is schema, reference data, transactional data, or mixed.
4. Generate stable changeset id/author/path.
5. Never edit an applied changeset; create a corrective changeset instead.
6. Choose structured change vs raw SQL intentionally.
7. Add preconditions only when they protect correctness.
8. Avoid MARK_RAN/runAlways/runOnChange unless explicitly justified.
9. Document rollback or roll-forward strategy.
10. Add validation query/test for non-trivial migration.
11. Do not include secrets.
12. Do not enable ORM auto-DDL as fallback.
```

---

## 20. References

- Liquibase Documentation: https://docs.liquibase.com/
- Liquibase GitHub: https://github.com/liquibase/liquibase
- Liquibase Changeset Checksum Guide: https://www.liquibase.com/blog/what-affects-changeset-checksums
- Liquibase Rollback Count: https://docs.liquibase.com/secure/reference-guide-5-1-1/init-update-and-rollback-commands/rollback-count
- Liquibase Gradle Plugin Docs: https://contribute.liquibase.com/extensions-integrations/directory/integration-docs/gradle/
- Liquibase Spring Boot Integration: https://contribute.liquibase.com/extensions-integrations/directory/integration-docs/springboot/

# Part 24 — Migration and Schema Evolution: Flyway, Liquibase, Backward Compatibility

> Series: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `24-migration-schema-evolution-flyway-liquibase-backward-compatibility.md`  
> Scope: Java 8–25, MyBatis 3.x, MyBatis-Spring, Spring Boot, Flyway, Liquibase, relational database production systems

---

## 0. Why This Part Exists

A MyBatis mapper is not only Java code.

A MyBatis mapper is a **compiled assumption about database shape**:

```text
Mapper method
  assumes table exists
  assumes columns exist
  assumes aliases match Java properties
  assumes data type conversion works
  assumes constraints behave a certain way
  assumes indexes make the query safe at production volume
  assumes transaction/concurrency semantics remain valid
```

When schema changes, mapper correctness can break even when Java still compiles.

This is one of the biggest differences between simple MyBatis usage and production-grade MyBatis engineering.

In JPA/Hibernate, some schema drift may surface through entity metadata, generated SQL, startup validation, or migration mismatch. In MyBatis, SQL is explicit. That gives control, but it also means **you own the compatibility contract** between:

```text
Application version
Database schema version
Migration history
Mapper XML/annotation SQL
Result mapping
TypeHandler behavior
Production deployment order
Rollback strategy
```

This part is about designing schema evolution so MyBatis systems can survive real enterprise deployment constraints:

- rolling deployment,
- blue/green deployment,
- multiple pods using different application versions temporarily,
- old jobs still running,
- async workers retrying old payloads,
- reporting queries reading old/new shape,
- production rollback,
- partial migration failure,
- multi-tenant or multi-agency rollout,
- zero-downtime expectations.

The goal is not merely to “run Flyway” or “use Liquibase”.

The goal is to understand **database change as an application compatibility problem**.

---

## 1. Mental Model: Mapper Depends on Schema Contract

A MyBatis statement has hidden assumptions.

Example:

```xml
<select id="findCaseSummaryById" resultMap="CaseSummaryResultMap">
  SELECT
      c.case_id,
      c.case_no,
      c.status_code,
      c.assigned_officer_id,
      o.display_name AS assigned_officer_name
  FROM enforcement_case c
  LEFT JOIN officer o ON o.officer_id = c.assigned_officer_id
  WHERE c.case_id = #{caseId}
</select>
```

This mapper assumes:

1. `enforcement_case` exists.
2. `case_id`, `case_no`, `status_code`, `assigned_officer_id` exist.
3. `officer` exists.
4. `officer_id`, `display_name` exist.
5. `assigned_officer_id` is join-compatible with `officer.officer_id`.
6. `status_code` maps to the Java status representation.
7. result aliases match the `resultMap`.
8. query is still performant with current indexes.
9. authorization/tenant filters are still valid.
10. soft-delete semantics have not changed.

A database migration can break any of these without breaking Java compilation.

Therefore:

```text
Schema migration is not only DDL.
Schema migration is a compatibility event for every mapper that touches the changed object.
```

---

## 2. Schema Change Categories

Not all schema changes have the same risk.

### 2.1 Additive Changes

Examples:

```sql
ALTER TABLE enforcement_case ADD priority_code VARCHAR(30);
ALTER TABLE enforcement_case ADD sla_due_at TIMESTAMP;
CREATE INDEX idx_case_status_created ON enforcement_case(status_code, created_at);
```

Usually safest if:

- new column is nullable, or
- has safe default, or
- old code does not need to write it, or
- old code is compatible with default behavior.

Additive changes are the basis of zero-downtime evolution.

### 2.2 Behavioral Changes

Examples:

```sql
ALTER TABLE enforcement_case ADD CONSTRAINT chk_case_status CHECK (...);
ALTER TABLE enforcement_case MODIFY status_code NOT NULL;
ALTER TABLE enforcement_case ADD UNIQUE (external_reference_no);
```

These can break old application versions even if table/column names still exist.

Example:

```text
Old code inserts status_code = NULL temporarily.
New migration makes status_code NOT NULL.
Old code fails during rolling deployment.
```

### 2.3 Destructive Changes

Examples:

```sql
ALTER TABLE enforcement_case DROP COLUMN legacy_status;
DROP TABLE case_assignment_history_old;
ALTER TABLE enforcement_case RENAME COLUMN case_no TO reference_no;
```

These are dangerous because old mapper SQL may immediately fail.

Destructive changes should almost never happen in the same deployment that introduces new application code.

### 2.4 Semantic Changes

Examples:

```text
status_code = 'CLOSED' used to mean final closure.
Now 'CLOSED' means administratively closed, while 'COMPLETED' means final closure.
```

This is the hardest category because SQL may still run correctly while business meaning becomes wrong.

For MyBatis, semantic changes require:

- mapper review,
- service rule review,
- report review,
- audit review,
- TypeHandler review,
- data migration review,
- compatibility test.

---

## 3. Migration Tooling: Flyway vs Liquibase Mental Model

Both Flyway and Liquibase solve a similar governance problem:

```text
How do we apply database changes in a controlled, versioned, repeatable, auditable way?
```

But they encourage different working styles.

### 3.1 Flyway Mental Model

Flyway is migration-script-oriented.

Typical files:

```text
V001__create_enforcement_case.sql
V002__add_priority_code_to_case.sql
V003__backfill_case_priority.sql
R__case_search_view.sql
```

Core ideas:

- versioned migrations run in order,
- each versioned migration runs once,
- repeatable migrations rerun when checksum changes,
- migrations are often SQL-first,
- teams usually review exact SQL.

This maps naturally to MyBatis teams because MyBatis engineers already think in SQL.

Use Flyway when:

- you want explicit SQL scripts,
- DBAs review SQL directly,
- vendor-specific SQL is acceptable,
- migrations are part of application deploy pipeline,
- your team prefers simple linear migration history.

### 3.2 Liquibase Mental Model

Liquibase is changeset-oriented.

Typical changelog examples:

```xml
<changeSet id="2026-06-17-001" author="team">
  <addColumn tableName="enforcement_case">
    <column name="priority_code" type="varchar(30)"/>
  </addColumn>
</changeSet>
```

It can use XML/YAML/JSON/formatted SQL.

Core ideas:

- database changes are represented as changesets,
- changesets are tracked in `DATABASECHANGELOG`,
- rollback metadata can be declared,
- cross-database abstraction is possible but not always sufficient,
- governance/compliance features can be stronger in some environments.

Use Liquibase when:

- you need formal changeset metadata,
- rollback scripts are a strong organizational requirement,
- database portability is desired,
- compliance evidence matters,
- DB change governance is centralised.

### 3.3 Practical Recommendation for MyBatis

For MyBatis-heavy systems:

```text
Flyway is often simpler if the system is SQL-first and vendor-specific.
Liquibase is often stronger if the organization needs structured database governance and rollback metadata.
```

But the tool is secondary.

The real discipline is:

```text
Every mapper-affecting migration must define:
  old app compatibility
  new app compatibility
  rollback behavior
  data backfill behavior
  performance impact
  test coverage
  operational monitoring
```

---

## 4. The Expand–Migrate–Contract Pattern

This is the most important schema evolution pattern.

It prevents old and new application versions from breaking during deployment.

```text
1. Expand
   Add new schema elements without removing old ones.

2. Migrate
   Move data and application behavior gradually.

3. Contract
   Remove old schema elements only after all application versions stop using them.
```

### 4.1 Example: Rename Column Safely

Bad migration:

```sql
ALTER TABLE enforcement_case RENAME COLUMN case_no TO reference_no;
```

Why bad?

Old mapper:

```xml
SELECT case_no FROM enforcement_case WHERE case_id = #{caseId}
```

will fail immediately.

Safe migration:

#### Deployment A — Expand

```sql
ALTER TABLE enforcement_case ADD reference_no VARCHAR(50);
```

Backfill:

```sql
UPDATE enforcement_case
SET reference_no = case_no
WHERE reference_no IS NULL;
```

Optional sync trigger or dual-write strategy depending on DB and architecture.

#### Deployment B — Dual Read / Dual Write

New application writes both:

```xml
<update id="updateCaseReference">
  UPDATE enforcement_case
  SET
      case_no = #{referenceNo},
      reference_no = #{referenceNo},
      updated_at = #{updatedAt}
  WHERE case_id = #{caseId}
</update>
```

Reads prefer new column with fallback:

```sql
COALESCE(reference_no, case_no) AS reference_no
```

#### Deployment C — New Read Only

All code reads `reference_no`.

Old code no longer deployed.

#### Deployment D — Contract

```sql
ALTER TABLE enforcement_case DROP COLUMN case_no;
```

Only do this after confirming:

- no old pods,
- no old jobs,
- no old reports,
- no old mapper references,
- no rollback to old app expected.

---

## 5. Backward Compatibility and Forward Compatibility

There are two directions.

### 5.1 Backward-Compatible Schema

New schema works with old application.

Example:

```sql
ALTER TABLE enforcement_case ADD priority_code VARCHAR(30) NULL;
```

Old app does not know the column exists. Insert still works.

### 5.2 Forward-Compatible Application

Old application version can tolerate future-ish data.

Example:

Old Java enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

New database value:

```text
ESCALATED
```

Old app may fail if enum TypeHandler throws on unknown code.

Forward-compatible mapper/domain design might use:

```java
public final class CaseStatusCode {
    private final String value;

    public boolean isKnown() { ... }
}
```

or a controlled `UNKNOWN` status for read-only compatibility.

This is not always correct for write paths, but can be useful for reporting/listing paths.

### 5.3 Compatibility Matrix

For every migration, ask:

| Scenario | Must work? | Example |
|---|---:|---|
| Old app + old schema | Yes | current production |
| New app + new schema | Yes | target state |
| Old app + new schema | Usually yes | rolling deploy / rollback |
| New app + old schema | Sometimes | app starts before migration / misordered deploy |

In many enterprise systems, the most important scenario is:

```text
Old app + new schema must continue working.
```

Because database migration often runs before or during application deployment.

---

## 6. MyBatis-Specific Schema Evolution Risks

### 6.1 Column Alias Drift

Mapper:

```xml
<resultMap id="CaseSummaryResultMap" type="CaseSummaryRow">
  <id property="caseId" column="case_id"/>
  <result property="caseNo" column="case_no"/>
</resultMap>
```

SQL changes:

```sql
SELECT reference_no FROM enforcement_case
```

But resultMap expects `case_no`.

Result:

```text
caseNo is null or mapping fails depending configuration.
```

Safe transition:

```sql
SELECT reference_no AS case_no
FROM enforcement_case
```

or update resultMap and DTO intentionally.

### 6.2 `SELECT *` Breakage

`SELECT *` is dangerous during schema evolution.

Why?

- New columns may collide with joined table columns.
- Auto mapping may bind unexpected column labels.
- Large new columns may hurt performance.
- Sensitive new columns may leak into generic maps.
- Column order assumptions may break poorly written code.

Production MyBatis mapper should prefer explicit projection:

```sql
SELECT
    c.case_id,
    c.case_no,
    c.status_code,
    c.created_at
FROM enforcement_case c
```

### 6.3 ResultMap Reuse Breaks Multiple Queries

A shared resultMap seems convenient:

```xml
<resultMap id="CaseFullResultMap" type="CaseFullRow">...</resultMap>
```

But if a migration changes one field, every statement using the resultMap can break.

Better:

```text
CaseDetailResultMap
CaseListingResultMap
CaseExportResultMap
CaseAuditResultMap
```

Reuse only stable, intentional fragments.

### 6.4 Dynamic SQL References Removed Columns

Example:

```xml
<if test="criteria.legacyStatus != null">
  AND c.legacy_status = #{criteria.legacyStatus}
</if>
```

Even if most tests pass, the branch fails only when `legacyStatus` is used.

Dynamic SQL branch coverage is mandatory for migration safety.

### 6.5 TypeHandler Drift

If column type changes:

```text
VARCHAR status_code -> NUMBER status_id
VARCHAR json_payload -> CLOB json_payload
VARCHAR flag -> CHAR(1)
```

Then TypeHandler behavior may break.

Migration review must include:

- Java type,
- JDBC type,
- nullable behavior,
- enum/value object handling,
- result mapping,
- parameter binding.

---

## 7. Migration Design for Common Changes

### 7.1 Add Nullable Column

Migration:

```sql
ALTER TABLE enforcement_case ADD priority_code VARCHAR(30);
```

Mapper change:

```sql
SELECT
    c.case_id,
    c.case_no,
    c.priority_code
FROM enforcement_case c
```

ResultMap:

```xml
<result property="priorityCode" column="priority_code"/>
```

Compatibility:

- Old app + new schema: safe.
- New app + old schema: unsafe unless migration runs first.

Production rule:

```text
Migration must run before application version that reads new column.
```

### 7.2 Add NOT NULL Column

Bad:

```sql
ALTER TABLE enforcement_case ADD priority_code VARCHAR(30) NOT NULL;
```

This may fail if table has data, or old inserts do not provide value.

Safer:

```sql
ALTER TABLE enforcement_case ADD priority_code VARCHAR(30);
```

Backfill:

```sql
UPDATE enforcement_case
SET priority_code = 'NORMAL'
WHERE priority_code IS NULL;
```

Deploy app writing `priority_code`.

After old app gone:

```sql
ALTER TABLE enforcement_case MODIFY priority_code NOT NULL;
```

For PostgreSQL:

```sql
ALTER TABLE enforcement_case ALTER COLUMN priority_code SET NOT NULL;
```

### 7.3 Add Column With Default

Be careful.

```sql
ALTER TABLE enforcement_case
ADD priority_code VARCHAR(30) DEFAULT 'NORMAL' NOT NULL;
```

This can be acceptable in some databases and versions, but may rewrite table or lock heavily depending vendor/version.

For large tables, prefer phased approach:

```text
add nullable column
backfill in chunks
set default
set not null
```

### 7.4 Rename Column

Use expand-migrate-contract.

Do not rename directly unless:

- full downtime is allowed,
- all application code is deployed atomically,
- no rollback required,
- no external/reporting dependency.

### 7.5 Split Column

Example:

```text
applicant_name -> applicant_first_name + applicant_last_name
```

Expand:

```sql
ALTER TABLE application ADD applicant_first_name VARCHAR(100);
ALTER TABLE application ADD applicant_last_name VARCHAR(100);
```

Migrate:

```text
Backfill from old field using controlled parsing rules.
```

Application:

- old read uses `applicant_name`,
- new read uses first/last,
- transitional read may assemble display name.

Contract:

- drop old column only after dependency scan.

### 7.6 Merge Columns

Example:

```text
phone_country_code + phone_number -> phone_e164
```

Same pattern:

```text
add phone_e164
backfill
write both
read new
drop old
```

### 7.7 Split Table

Example:

```text
enforcement_case
  contains huge case details, assignment, SLA, metadata
```

Target:

```text
enforcement_case
case_assignment
case_sla
case_metadata
```

Safe approach:

1. Create new tables.
2. Backfill.
3. Write old and new or use triggers.
4. Update read mappers gradually.
5. Verify row count and checksum.
6. Remove old columns only later.

Mapper implications:

- listing mapper should avoid joining all new tables blindly,
- detail mapper may use separate fetch or joined projection,
- transaction update must maintain consistency across tables.

### 7.8 Change Enum/Code Values

Example:

```text
PENDING_REVIEW -> UNDER_REVIEW
```

Danger:

- TypeHandler may reject new value.
- Old app may not know new value.
- Reports may group incorrectly.
- Dynamic SQL filters may still send old code.

Safe approach:

1. Add new code as accepted value.
2. Make application read both old and new if needed.
3. Deploy writer that writes new code.
4. Backfill old values.
5. Remove old code support later.

Mapper compatibility:

```sql
WHERE status_code IN ('PENDING_REVIEW', 'UNDER_REVIEW')
```

for transitional reads, if business meaning is equivalent.

### 7.9 Change Data Type

Example:

```text
VARCHAR amount -> NUMBER amount
```

Direct type change is risky.

Safer:

```text
amount_text      old column
amount_number    new column
```

Migration:

1. Add new numeric column.
2. Backfill valid values.
3. Quarantine invalid rows.
4. Deploy app writing both.
5. Read numeric.
6. Remove text later.

### 7.10 Add Index

Adding index seems safe but can still affect production:

- may lock table,
- consumes storage,
- slows writes,
- may change optimizer plan,
- may fail due to resource constraints.

Migration plan should include:

- online index capability,
- execution time estimate,
- rollback/drop strategy,
- plan validation,
- post-deploy monitoring.

---

## 8. Mapper Versioning Strategies

### 8.1 Single Mapper, Transitional SQL

Example:

```sql
SELECT
    c.case_id,
    COALESCE(c.reference_no, c.case_no) AS case_no
FROM enforcement_case c
```

Pros:

- simple application wiring,
- supports old and new schema state if both columns exist.

Cons:

- transitional logic may remain forever,
- SQL becomes noisy,
- performance may suffer if functions prevent index usage.

Use when transition is short and controlled.

### 8.2 Separate Old and New Mapper Methods

```java
CaseRow findCaseUsingLegacyShape(Long caseId);
CaseRow findCaseUsingNewShape(Long caseId);
```

Pros:

- explicit migration boundary,
- easier testing,
- can feature-flag.

Cons:

- duplicated logic,
- cleanup required.

Use for risky migrations.

### 8.3 View as Compatibility Layer

Database view:

```sql
CREATE OR REPLACE VIEW case_summary_v AS
SELECT
    case_id,
    COALESCE(reference_no, case_no) AS case_no,
    status_code,
    created_at
FROM enforcement_case;
```

Mapper:

```sql
SELECT case_id, case_no, status_code, created_at
FROM case_summary_v
WHERE case_id = #{caseId}
```

Pros:

- stable mapper contract,
- DB encapsulates transition,
- useful for reporting/read-only projections.

Cons:

- view performance must be validated,
- write mappers still need real table,
- hidden complexity moves to DB.

### 8.4 Feature-Flagged Mapper Behavior

Service chooses mapper path:

```java
if (schemaFeatureFlags.useNewCaseReference()) {
    return caseMapper.findByReferenceNoNew(referenceNo);
}
return caseMapper.findByReferenceNoLegacy(referenceNo);
```

This is useful when DB migration and app behavior must be decoupled.

But do not overuse it. Feature flags around persistence need strict cleanup.

---

## 9. Data Backfill Strategy

Schema migration often has two parts:

```text
DDL: change structure
DML: transform existing data
```

For small tables, simple DML may be fine.

For large tables, avoid huge transactions:

```sql
UPDATE enforcement_case
SET priority_code = 'NORMAL'
WHERE priority_code IS NULL;
```

This can cause:

- long lock duration,
- huge undo/redo/WAL,
- replication lag,
- transaction log pressure,
- blocking writes,
- timeout,
- storage growth.

### 9.1 Chunked Backfill

Pseudo pattern:

```sql
UPDATE enforcement_case
SET priority_code = 'NORMAL'
WHERE case_id IN (
    SELECT case_id
    FROM enforcement_case
    WHERE priority_code IS NULL
    ORDER BY case_id
    FETCH FIRST 1000 ROWS ONLY
);
```

Run repeatedly until zero rows remain.

Vendor syntax differs.

### 9.2 Application-Driven Backfill Worker

Use a worker that claims rows:

```sql
SELECT case_id
FROM enforcement_case
WHERE priority_code IS NULL
ORDER BY case_id
FOR UPDATE SKIP LOCKED
```

Then update in controlled chunks.

Good for:

- large tables,
- online backfill,
- progress monitoring,
- retryable migration,
- multi-worker backfill.

### 9.3 Backfill Table

For complex migration:

```text
case_id | old_value | new_value | migration_status | error_message
```

This allows:

- audit,
- retry,
- manual correction,
- rollback reference,
- reconciliation.

### 9.4 Validation Queries

Every backfill should define validation.

Examples:

```sql
SELECT COUNT(*)
FROM enforcement_case
WHERE priority_code IS NULL;
```

```sql
SELECT priority_code, COUNT(*)
FROM enforcement_case
GROUP BY priority_code;
```

```sql
SELECT COUNT(*)
FROM enforcement_case c
WHERE NOT EXISTS (
    SELECT 1
    FROM case_sla s
    WHERE s.case_id = c.case_id
);
```

Validation query belongs in the migration plan, not as an afterthought.

---

## 10. Rollback Strategy

Rollback is often misunderstood.

There are two different things:

```text
Application rollback
  Deploy previous application version.

Database rollback
  Revert schema/data migration.
```

They are not equivalent.

### 10.1 Prefer Roll-Forward for Many Data Migrations

For destructive data changes, rolling back database state may be impossible or risky.

Example:

```text
Split applicant_name into first/last using imperfect parsing.
```

You cannot always reconstruct original data perfectly.

In such cases, prefer:

```text
roll forward with corrective migration
```

### 10.2 Backward-Compatible Migration Enables App Rollback

If migration is backward-compatible, old app can still run.

That is usually more important than database rollback.

Example:

```text
Add nullable column.
Old app ignores it.
If new app fails, roll back app only.
```

### 10.3 Rollback SQL Must Be Tested

If using Liquibase rollback or Flyway undo-style approach, test rollback in CI/staging.

Rollback script risks:

- drops data that new app created,
- violates constraints,
- takes long locks,
- assumes no writes occurred,
- cannot reverse semantic transformation.

### 10.4 Rollback Decision Table

| Migration Type | DB rollback realistic? | Preferred response |
|---|---:|---|
| Add nullable column | Usually yes | app rollback enough |
| Add index | Yes | drop index if harmful |
| Add NOT NULL after backfill | Maybe | relax constraint if needed |
| Rename column directly | Risky | avoid direct rename |
| Data transformation | Often no | roll forward corrective |
| Drop column/table | Dangerous | delay contract phase |

---

## 11. MyBatis Mapper Compatibility Checklist per Migration

For each migration, list impacted mappers:

```text
Table/column changed:
  enforcement_case.priority_code

Impacted mappers:
  CaseCommandMapper.insertCase
  CaseCommandMapper.updateCasePriority
  CaseQueryMapper.findCaseSummary
  CaseSearchMapper.searchCases
  CaseExportMapper.exportCases
  CaseAuditMapper.findCaseAuditRows
```

Then check:

### 11.1 SQL Text

- Does mapper reference old column?
- Does dynamic SQL branch reference old column?
- Does `<sql>` fragment reference old column?
- Does `ORDER BY` whitelist include old/new column?
- Does count query match listing query?

### 11.2 Result Mapping

- Does resultMap expect old column alias?
- Is new column nullable?
- Is Java property wrapper type, not primitive?
- Does `TypeHandler` support old/new values?
- Does auto mapping hide missing alias?

### 11.3 Parameter Binding

- Does insert provide required new column?
- Does update preserve absent-vs-null semantics?
- Does dynamic SQL omit new column unexpectedly?
- Does default value live in DB or app?

### 11.4 Transaction/Concurrency

- Does new constraint change retry behavior?
- Does new unique constraint replace application-level duplicate check?
- Does migration introduce locking risk?
- Does backfill conflict with live writes?

### 11.5 Performance

- Does new predicate need index?
- Does new join create one-to-many explosion?
- Does new column increase row size?
- Does new LOB accidentally enter listing query?
- Does `COALESCE`/function break index usage?

### 11.6 Security

- Does new column contain PII?
- Does export mapper include it accidentally?
- Does audit mapper log it?
- Does row-level authorization still apply?
- Does tenant filter include new table?

---

## 12. Migration Testing Strategy

### 12.1 Test Migration From Empty Schema

Ensures all migrations can create current schema from scratch.

Useful for:

- local dev,
- CI,
- ephemeral environments,
- disaster recovery rehearsal.

### 12.2 Test Migration From Production-Like Baseline

More important.

```text
Start from schema version N with representative data.
Run migrations to N+1.
Run mapper integration tests.
```

This catches:

- backfill failures,
- constraint violations,
- data type conversion errors,
- invalid existing data,
- performance issues.

### 12.3 Mapper Tests After Migration

For each changed schema object, test:

- insert,
- update,
- search/listing,
- detail read,
- export/report,
- delete/soft delete,
- audit/history,
- tenant/authorization scope,
- dynamic SQL branches,
- pagination/count.

### 12.4 Compatibility Tests

Ideally test:

```text
Old app mapper tests against new schema.
New app mapper tests against new schema.
```

For high-risk systems, also test:

```text
New app startup against old schema
```

at least to ensure failure is clear if deployment order is wrong.

### 12.5 Testcontainers Strategy

Use real database engine when vendor behavior matters:

- Oracle sequence/identity/LOB/empty-string behavior,
- PostgreSQL JSONB/locking/upsert,
- MySQL boolean/date/auto-increment behavior,
- SQL Server identity/output/lock hint behavior.

Do not trust H2 for migration compatibility unless the target DB is actually H2.

---

## 13. Deployment Ordering Patterns

### 13.1 Migration Before App

Common pattern:

```text
Run DB migration
Deploy application
```

Requires:

```text
new schema must be compatible with old app
```

### 13.2 App Before Migration

Less common for schema-dependent changes.

Requires:

```text
new app must tolerate old schema
```

This is hard if mapper reads new columns at startup or during request.

### 13.3 Blue/Green Deployment

During cutover:

```text
blue app version and green app version may exist near the same DB
```

Therefore schema must support both versions.

### 13.4 Rolling Deployment

During rollout:

```text
pod A uses old mapper
pod B uses new mapper
both hit same database
```

Therefore destructive migration must be delayed.

### 13.5 Multi-Region / Multi-Agency Rollout

If agencies/tenants migrate at different times, schema may be global but behavior is tenant-specific.

Use:

- feature flags,
- agency migration status table,
- compatibility views,
- phased mapper behavior.

---

## 14. Zero-Downtime Migration Pattern Library

### 14.1 Add Column Used by New Feature

```text
Deploy 1:
  DB: add nullable column
  App: still old

Deploy 2:
  App: write/read new column

Deploy 3:
  DB: backfill remaining nulls

Deploy 4:
  DB: add NOT NULL constraint
```

### 14.2 Replace Column

```text
Deploy 1:
  DB: add new column

Deploy 2:
  App: dual-write old + new, read old

Deploy 3:
  Backfill old -> new

Deploy 4:
  App: read new, fallback old

Deploy 5:
  App: read new only

Deploy 6:
  DB: drop old column
```

### 14.3 Split Table

```text
Deploy 1:
  DB: create new tables

Deploy 2:
  App: dual-write old table and new tables

Deploy 3:
  Backfill historical rows

Deploy 4:
  App: read from new tables

Deploy 5:
  Stop old writes

Deploy 6:
  Remove old columns after retention window
```

### 14.4 Add Unique Constraint

Do not simply add it.

Steps:

1. Detect duplicates.
2. Resolve duplicates.
3. Add supporting unique index/constraint.
4. Change mapper insert to handle duplicate conflict.
5. Add idempotency semantics.
6. Add tests for duplicate insert.

### 14.5 Add Foreign Key

Steps:

1. Detect orphan rows.
2. Fix or quarantine orphans.
3. Add index on referencing column if needed.
4. Add FK constraint in safe mode if vendor supports validation options.
5. Monitor write failures.
6. Update mapper tests.

---

## 15. Mapper and Migration Documentation Template

Each migration should have a small design note.

```markdown
# Migration: Add Case Priority

## Goal
Add priority code to enforcement cases for SLA prioritization.

## Schema Changes
- Add `enforcement_case.priority_code VARCHAR(30)` nullable.
- Backfill existing cases to `NORMAL`.
- Later enforce NOT NULL after all writers are updated.

## Impacted Mappers
- CaseCommandMapper.insertCase
- CaseCommandMapper.updateCasePriority
- CaseSearchMapper.searchCases
- CaseQueryMapper.findCaseSummary
- CaseExportMapper.exportCases

## Compatibility
- Old app + new schema: compatible because column nullable.
- New app + old schema: not compatible; migration must run before app deploy.

## Backfill
Chunk update by `case_id`, 5,000 rows per transaction.

## Rollback
Application rollback is safe. DB rollback optional before new writes depend on column.
Do not drop column if new app may have written priority values.

## Testing
- Mapper insert default behavior.
- Search by priority.
- Export includes priority only if authorized.
- Count query equals listing filter.

## Monitoring
- Count null priority rows.
- Insert/update failures.
- Slow query for priority filter.
```

This looks bureaucratic, but in large MyBatis systems it prevents accidental production breakage.

---

## 16. Example: Production-Grade Migration Walkthrough

### Requirement

Add case priority to enforcement workflow:

```text
LOW, NORMAL, HIGH, URGENT
```

Priority affects:

- listing sort,
- SLA query,
- assignment queue,
- reporting export,
- audit trail,
- notification escalation.

### 16.1 Migration 1 — Expand

Flyway-style SQL:

```sql
ALTER TABLE enforcement_case
ADD priority_code VARCHAR(30);

CREATE INDEX idx_case_priority_status_created
ON enforcement_case(priority_code, status_code, created_at);
```

### 16.2 App Version 1 — Read/Write With Fallback

Insert mapper:

```xml
<insert id="insertCase" parameterType="CreateCaseCommand">
  INSERT INTO enforcement_case (
      case_id,
      case_no,
      status_code,
      priority_code,
      created_at,
      created_by
  ) VALUES (
      #{caseId},
      #{caseNo},
      #{statusCode},
      COALESCE(#{priorityCode}, 'NORMAL'),
      #{createdAt},
      #{createdBy}
  )
</insert>
```

Search mapper:

```xml
<select id="searchCases" resultMap="CaseListingResultMap">
  SELECT
      c.case_id,
      c.case_no,
      c.status_code,
      COALESCE(c.priority_code, 'NORMAL') AS priority_code,
      c.created_at
  FROM enforcement_case c
  <where>
    <if test="criteria.priorityCode != null">
      AND COALESCE(c.priority_code, 'NORMAL') = #{criteria.priorityCode}
    </if>
  </where>
  ORDER BY c.created_at DESC, c.case_id DESC
</select>
```

Caution:

```text
COALESCE in WHERE may reduce index usability.
```

Better after backfill:

```sql
AND c.priority_code = #{criteria.priorityCode}
```

### 16.3 Backfill

Chunked:

```sql
UPDATE enforcement_case
SET priority_code = 'NORMAL'
WHERE priority_code IS NULL
  AND case_id BETWEEN ? AND ?;
```

Validation:

```sql
SELECT COUNT(*)
FROM enforcement_case
WHERE priority_code IS NULL;
```

### 16.4 App Version 2 — Remove Fallback From Predicate

```xml
<if test="criteria.priorityCode != null">
  AND c.priority_code = #{criteria.priorityCode}
</if>
```

Projection may still use fallback briefly:

```sql
COALESCE(c.priority_code, 'NORMAL') AS priority_code
```

### 16.5 Migration 2 — Contract Constraint

```sql
ALTER TABLE enforcement_case
MODIFY priority_code NOT NULL;
```

Vendor syntax differs.

### 16.6 Migration 3 — Optional Lookup/Constraint

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT chk_case_priority
CHECK (priority_code IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
```

Or reference code table:

```sql
ALTER TABLE enforcement_case
ADD CONSTRAINT fk_case_priority
FOREIGN KEY (priority_code)
REFERENCES case_priority(priority_code);
```

### 16.7 Mapper Tests

Test:

- insert without priority -> NORMAL,
- insert with HIGH,
- search priority HIGH,
- search no priority filter,
- resultMap maps priority,
- export mapper does/does not include priority based on spec,
- count query matches listing query,
- old data backfilled,
- invalid priority rejected.

---

## 17. Anti-Patterns

### 17.1 One-Shot Destructive Migration

```text
Rename/drop columns and deploy new app at same time.
```

This is fragile unless you have full downtime and no rollback requirement.

### 17.2 Migration Without Mapper Inventory

Changing schema without listing impacted mappers is gambling.

### 17.3 `SELECT *` Everywhere

Makes schema evolution unpredictable.

### 17.4 Backfill in One Huge Transaction

Works in dev. Fails in production.

### 17.5 Rollback Script That Destroys New Data

Example:

```sql
DROP COLUMN priority_code;
```

after new app has written meaningful priority values.

### 17.6 Auto Mapping Without Unknown Column Checks

Auto mapping can hide result drift.

For critical systems, configure stricter behavior in tests where practical.

### 17.7 Changing Enum Code Without Compatibility Plan

Old app may fail reading new code.

### 17.8 Adding Constraint Before Cleaning Data

Migration fails or production writes start failing.

### 17.9 Assuming Migration Tool Solves Deployment Compatibility

Flyway/Liquibase apply migrations.

They do not automatically guarantee mapper compatibility.

---

## 18. Production Troubleshooting

### Symptom: App fails after migration with invalid column

Likely causes:

- old mapper still references dropped/renamed column,
- dynamic SQL branch missed in testing,
- shared SQL fragment references old column,
- view was changed without mapper alignment.

Response:

1. identify statement id from logs,
2. inspect mapper XML,
3. check migration history,
4. confirm app version,
5. restore compatibility if possible,
6. avoid emergency destructive rollback unless understood.

### Symptom: New app fails at startup

Likely causes:

- XML mapper references unavailable column only at runtime? Usually not startup.
- mapper XML parse error,
- missing resultMap/type alias/type handler,
- migration not executed,
- wrong datasource/schema.

Response:

- check migration table,
- check application datasource,
- run readiness check that validates expected schema version.

### Symptom: Insert fails after NOT NULL migration

Likely causes:

- old app still deployed,
- async job uses old mapper,
- test missed alternative insert path,
- DB default missing.

Response:

- temporarily relax constraint or add default if safe,
- deploy patched writer,
- identify all insert paths.

### Symptom: Query suddenly slow after migration

Likely causes:

- new predicate without index,
- function around indexed column,
- statistics stale,
- new join cardinality explosion,
- index changed optimizer plan,
- larger row projection.

Response:

- compare execution plans,
- inspect `BoundSql`,
- check row counts/stats,
- test with real bind values,
- add/rework index if needed.

### Symptom: Data inconsistent after backfill

Likely causes:

- live writes not dual-written,
- backfill race,
- chunk boundary bug,
- transformation logic incomplete,
- retry duplicated updates.

Response:

- stop or pause affected writer if necessary,
- run reconciliation query,
- use audit/backfill table,
- roll forward corrective migration.

---

## 19. Java 8 to Java 25 Considerations

### Java 8

Use:

- POJO command/criteria objects,
- explicit constructors or builders,
- simple migration test infrastructure,
- conservative TypeHandler design.

Avoid depending on records or newer language features.

### Java 11

Still mostly Java 8 style, but stronger runtime and tooling.

### Java 17+

Good baseline for Spring Boot 3.

Can use:

- records for immutable query rows,
- sealed interfaces for migration state/result modeling,
- modern switch for code mapping,
- stronger test infrastructure.

### Java 21+

Virtual threads do not remove DB constraints.

Even if request concurrency increases, database migration/backfill still needs:

- connection pool sizing,
- lock control,
- chunking,
- backpressure.

### Java 25

Treat as modern runtime target, but migration compatibility remains mostly database/application architecture, not language feature.

The strongest improvements usually come from:

- better tests,
- clearer DTO contracts,
- stricter mapper governance,
- observability,
- deployment discipline.

---

## 20. Review Checklist

Before approving a mapper-affecting migration:

```text
Schema
  [ ] Is the migration additive first?
  [ ] Are destructive changes delayed?
  [ ] Are constraints introduced after data cleanup?
  [ ] Is index creation safe for table size/vendor?

Compatibility
  [ ] Does old app work with new schema?
  [ ] Is rollback to old app safe?
  [ ] Is new app protected from missing migration?
  [ ] Are rolling/blue-green deployments considered?

Mapper
  [ ] Impacted mapper list exists.
  [ ] Dynamic SQL branches tested.
  [ ] ResultMap aliases updated intentionally.
  [ ] No accidental SELECT * dependency.
  [ ] TypeHandler impact reviewed.

Data
  [ ] Backfill plan exists.
  [ ] Backfill chunk size defined.
  [ ] Validation queries exist.
  [ ] Reconciliation strategy exists.

Transaction/Concurrency
  [ ] Live write race considered.
  [ ] Dual-write or trigger strategy defined if needed.
  [ ] Lock duration understood.
  [ ] Retry/idempotency behavior defined.

Performance
  [ ] Query plan reviewed for changed critical mappers.
  [ ] Count/listing query both reviewed.
  [ ] New indexes justified.
  [ ] Large table operations tested.

Security
  [ ] New sensitive columns are not leaked.
  [ ] Tenant/agency filters include new tables.
  [ ] Export/report mappers reviewed.
  [ ] Audit/logging behavior reviewed.

Operations
  [ ] Migration order defined.
  [ ] Rollback/roll-forward plan defined.
  [ ] Monitoring queries/metrics defined.
  [ ] Production runbook exists.
```

---

## 21. Key Takeaways

MyBatis gives explicit SQL control.

That means schema evolution must be explicit too.

The top-tier mental model is:

```text
Every schema change is a compatibility event.
Every mapper is an executable schema assumption.
Every migration must be reviewed against old app, new app, rollback, data, performance, and security.
```

Use migration tools, but do not outsource thinking to them.

Flyway and Liquibase can track and apply database changes. They do not automatically ensure mapper compatibility, transaction safety, tenant isolation, query performance, or rollback correctness.

For production MyBatis systems, the safest default is:

```text
Expand first.
Migrate data safely.
Deploy compatible application behavior.
Only contract after old code is gone.
```

This discipline is what allows SQL-first systems to scale beyond simple CRUD and survive real enterprise delivery.

---

## 22. What Comes Next

Part 25 will cover:

```text
Security Engineering:
SQL Injection, Tenant Isolation, Row-Level Access
```

That part builds on this one because schema evolution often creates new security risks:

- new sensitive columns,
- new tenant-scoped tables,
- new joins without authorization filters,
- new export/report fields,
- dynamic SQL changes,
- backfill scripts that bypass application policy.


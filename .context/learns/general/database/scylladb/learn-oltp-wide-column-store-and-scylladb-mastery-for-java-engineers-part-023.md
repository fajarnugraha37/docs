# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-023.md

# Part 023 — Schema Evolution: DDL Safety, Rolling Deploy, Compatibility, Dual-Write, Backfill, dan Migration Playbooks

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `023`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: evolusi schema ScyllaDB/CQL secara aman: DDL discipline, schema agreement, rolling deploy, additive/non-additive changes, new tables, dual-write, backfill, source_version/projection_version, prepared statement compatibility, rollback, dan migration playbooks.

---

## 0. Posisi Part Ini dalam Seri

Part 022 membahas high-volume write pipeline dan backfill.

Part ini membahas problem yang pasti muncul setelah sistem berjalan:

```text
schema harus berubah
query baru muncul
table lama perlu diganti
kolom baru ditambahkan
primary key ternyata salah
derived view perlu versi baru
retention berubah
payload berubah
Java DTO berubah
```

Dalam relational database, schema migration sering berarti:

```text
ALTER TABLE
deploy app
done
```

Dalam ScyllaDB/wide-column production system, schema evolution lebih dekat ke distributed migration workflow:

```text
DDL
schema agreement
rolling application compatibility
dual-read/dual-write
backfill
validation
cutover
rollback
cleanup
```

Schema bukan hanya struktur data. Schema adalah kontrak antara:

- CQL table,
- Java repository,
- prepared statements,
- routing key,
- primary key shape,
- consistency profile,
- TTL/compaction,
- backfill job,
- operational dashboards,
- backup/restore,
- downstream projections.

---

## 1. Why Schema Evolution Is Harder in Wide-Column Stores

ScyllaDB table biasanya dibangun untuk satu access pattern.

Primary key adalah physical query plan.

Jika access pattern berubah, sering tidak cukup menambah index.

Contoh:

```text
old query:
read case by id

new query:
list open cases by assignee ordered by due_at
```

Ini butuh table baru:

```text
open_cases_by_assignee_day_bucket
```

Bukan hanya:

```sql
ALTER TABLE case_current_by_id ADD INDEX ...
```

Schema evolution di ScyllaDB sering berarti:

```text
new physical access path
```

yang butuh:

- dual-write,
- backfill,
- validation,
- cutover,
- cleanup.

---

## 2. Schema Change Categories

### 2.1 Additive Column Change

```sql
ALTER TABLE case_current_by_id
ADD risk_score int;
```

Biasanya paling aman.

### 2.2 Additive Table Change

```sql
CREATE TABLE cases_by_external_ref (...);
```

Aman secara DDL, tetapi butuh write path/backfill.

### 2.3 Column Rename

Tidak sesederhana rename biasa dalam distributed rolling deploy.

Biasanya:

```text
add new column
dual-write
backfill
switch reads
remove old later
```

### 2.4 Column Type Change

Sering butuh kolom baru/table baru.

### 2.5 Primary Key Change

Tidak bisa “ALTER primary key” secara praktis.

Butuh table baru.

### 2.6 TTL/Compaction Change

Operationally sensitive.

Butuh testing/ops plan.

### 2.7 Drop Column/Table

Destructive.

Harus paling akhir setelah compatibility window.

---

## 3. Schema Agreement

Dalam cluster distributed, DDL harus tersebar ke semua node.

Schema agreement berarti node cluster sudah sepakat pada versi schema.

Jika aplikasi deploy terlalu cepat setelah DDL tanpa memastikan schema agreement:

- prepared statement bisa gagal,
- node tertentu belum tahu kolom/table,
- query invalid di sebagian node,
- rolling deploy intermittent error.

Practical rule:

```text
DDL migration must wait for schema agreement before app relies on new schema.
```

Migration tooling harus:

```text
execute DDL
wait/verify schema agreement
then continue
```

---

## 4. DDL Is Production Traffic

DDL bukan operasi tanpa efek.

DDL bisa:

- mengubah metadata cluster,
- memicu schema agreement,
- memengaruhi prepared statements,
- memulai build index/MV,
- memengaruhi compaction/storage jika alter table options,
- mengubah behavior TTL/compaction.

Jangan menjalankan DDL manual tanpa:

- review,
- migration file,
- rollout plan,
- rollback plan,
- environment testing,
- observability.

---

## 5. Migration Discipline

Gunakan migration system seperti:

```text
schema version table
ordered migration files
one-way migration scripts
DDL review
CI validation
staging run
production runbook
```

Contoh schema version table:

```sql
CREATE TABLE schema_migration_by_id (
    migration_id text PRIMARY KEY,
    description text,
    applied_at timestamp,
    applied_by text,
    checksum text,
    status text
);
```

Jangan bergantung pada “ingat pernah ALTER”.

---

## 6. Rolling Deploy Compatibility

Production Java service biasanya rolling deploy:

```text
v1 instances masih jalan
v2 instances mulai naik
traffic bercampur
```

Maka schema harus compatible dengan:

```text
old app + new schema
new app + old-ish schema during rollout? ideally avoided
old and new app writing together
rollback from v2 to v1
```

Safe migration harus mempertimbangkan minimal tiga fase:

```text
expand
migrate
contract
```

Ini dikenal sebagai expand/contract pattern.

---

## 7. Expand/Contract Pattern

### 7.1 Expand

Tambahkan schema baru tanpa merusak app lama.

Examples:

```sql
ALTER TABLE ADD new_column
CREATE TABLE new_derived_table
```

Old app tetap jalan.

### 7.2 Migrate

Deploy app yang menulis/membaca schema baru secara compatible.

Mungkin:

- dual-write,
- backfill,
- shadow read,
- validation,
- feature flag.

### 7.3 Contract

Setelah semua aman:

- stop old reads,
- stop old writes,
- drop old column/table,
- remove old code.

Contract sering dilakukan jauh belakangan.

---

## 8. Add Column Safely

Scenario:

```text
add risk_score to case_current_by_id
```

DDL:

```sql
ALTER TABLE case_current_by_id
ADD risk_score int;
```

App v1:

```text
does not know risk_score
continues working
```

App v2:

```text
writes risk_score if available
reads null as unknown
```

Rules:

- new column nullable by default,
- reader tolerates null,
- writer does not require old rows to have value,
- backfill if needed,
- do not immediately make business invariant depend on full backfill.

---

## 9. Add Column Java Handling

Bad:

```java
int riskScore = row.getInt("risk_score");
```

If column is null, primitive handling may fail or default misleading.

Good:

```java
Integer riskScore = row.isNull("risk_score")
    ? null
    : row.getInt("risk_score");
```

Domain:

```java
OptionalInt? maybe
RiskScore.UNKNOWN
```

Be explicit.

New column rollout means old rows exist.

---

## 10. Add Column Write Rollout

Phases:

```text
1. DDL add column.
2. Deploy code that can read null.
3. Start writing new column.
4. Backfill old rows if needed.
5. Enable feature that depends on column completeness.
```

Do not enable feature at step 2 if old rows null.

---

## 11. Rename Column Safely

CQL rename may exist in some contexts, but production-safe pattern is explicit.

Old:

```text
priority
```

New:

```text
severity
```

Migration:

```text
1. ADD severity.
2. Deploy app writes both priority and severity.
3. Backfill severity from priority.
4. Switch reads to severity with fallback priority.
5. Stop writing priority.
6. After long compatibility window, drop priority.
```

Java read during transition:

```java
Severity severity;
if (!row.isNull("severity")) {
    severity = mapSeverity(row.getString("severity"));
} else {
    severity = mapOldPriority(row.getInt("priority"));
}
```

---

## 12. Change Column Type Safely

Old:

```sql
risk_score int
```

New:

```sql
risk_score_v2 double
```

Steps:

```text
1. ADD risk_score_v2 double.
2. App writes both.
3. Backfill v2 from v1.
4. Read v2 fallback v1.
5. Switch business logic.
6. Drop v1 later.
```

Never assume in-place type change is safe for rolling apps.

---

## 13. Drop Column Safely

Drop is destructive.

Before dropping:

```text
[ ] no app version reads column
[ ] no app version writes column
[ ] backfill/cutover complete
[ ] dashboards/ETL/search not using it
[ ] backups/restore expectations clear
[ ] rollback no longer needs it
```

Safer:

```text
stop using column
wait one or more release cycles
then drop
```

---

## 14. New Table for New Access Pattern

Requirement:

```text
list cases by external_ref
```

New table:

```sql
CREATE TABLE case_id_by_external_ref (
    tenant_id uuid,
    external_ref text,
    case_id uuid,
    source_version bigint,
    created_at timestamp,
    PRIMARY KEY ((tenant_id, external_ref))
);
```

Migration:

```text
1. CREATE TABLE.
2. Deploy code writing new table on create/update.
3. Backfill existing cases.
4. Validate.
5. Enable reads.
6. Monitor.
```

This is common ScyllaDB evolution.

---

## 15. Primary Key Change Requires New Table

Old:

```sql
PRIMARY KEY ((tenant_id, assignee_id), due_at, case_id)
```

Need bucket:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

You cannot cheaply alter primary key.

Create v2 table.

```sql
CREATE TABLE open_cases_by_assignee_day_bucket_v2 (...);
```

Then dual-write/backfill/cutover.

---

## 16. Table Versioning

Use table suffix:

```text
open_cases_by_assignee_v1
open_cases_by_assignee_day_bucket_v2
```

Pros:

- explicit semantic change,
- safe cutover,
- rollback possible,
- old/new compare.

Cons:

- more tables,
- migration complexity,
- cleanup needed.

Do not name v2 unless you plan to retire v1.

---

## 17. Dual-Write Pattern

During migration:

```text
command handler writes old table and new table
```

Example:

```text
open_cases_by_assignee_v1
open_cases_by_assignee_day_bucket_v2
```

Dual-write must be:

- idempotent,
- observable,
- ordered if needed,
- failure-handled,
- eventually reconciled.

If v2 write fails but v1 succeeds:

```text
old read path still okay
v2 needs repair before cutover
```

---

## 18. Dual-Write Partial Failure

Scenario:

```text
old write succeeds
new write times out
```

If new table is derived/rebuildable:

```text
record metric
retry async
reconciliation/backfill repairs
do not fail critical command maybe
```

If new table is source-of-truth:

```text
much stricter; maybe fail/unknown command
```

Use authority matrix.

---

## 19. Dual-Read / Shadow Read

Before switching, compare old and new.

Serve old result:

```text
result = readV1()
```

Shadow:

```text
newResult = readV2()
compare async
emit mismatch metric
```

Shadow read catches:

- missing rows,
- wrong bucket,
- stale source_version,
- sorting differences,
- pagination differences.

Do not shadow read at 100% if expensive; sample/canary.

---

## 20. Cutover

Cutover options:

- global feature flag,
- per-tenant flag,
- per-region flag,
- percentage rollout,
- internal users first,
- read fallback to old on miss.

For critical systems, prefer:

```text
tenant-by-tenant or cohort rollout
```

Cutover is not complete until:

- p99 acceptable,
- mismatch low/zero,
- error rate acceptable,
- fallback not frequently used.

---

## 21. Rollback

Rollback should be planned before cutover.

If v2 read path fails:

```text
turn flag back to v1
```

Works only if v1 still receives writes.

Therefore keep dual-write until after rollback window.

If you stop v1 writes too early, rollback returns stale data.

---

## 22. Contract Phase

After confidence:

```text
1. stop v1 reads
2. keep v1 writes for rollback window
3. stop v1 writes
4. archive/drop v1 table later
5. remove v1 code
6. remove v1 metrics/dashboards
```

Contract phase should be deliberate.

Old tables left forever create cost/confusion.

---

## 23. Backfill During Schema Evolution

Backfill populates new column/table for old data.

Key requirements:

- deterministic mapping,
- idempotent writes,
- checkpoint,
- throttle,
- validation,
- handling live writes,
- DLQ,
- operational dashboard.

Part 022 covered this deeply.

Schema evolution almost always uses that machinery.

---

## 24. Backfill Race with Rolling Deploy

Timeline:

```text
T1: v2 dual-writes new table
T2: backfill scans old source row version 5
T3: live command writes version 6 to new table
T4: backfill writes version 5 to new table
```

Potential stale overwrite.

Mitigations:

- source_version in new row,
- LWT only-if-version-lower if feasible,
- replay recent changes,
- backfill older first then shadow validate,
- projection from event log,
- reader validates source_version.

---

## 25. Version-Aware Derived Rows

New derived table row:

```sql
source_version bigint,
projection_version int,
projected_at timestamp
```

Reader can detect stale row:

```text
if row.source_version < current.version:
  treat candidate as stale
```

Backfill/projection can repair.

---

## 26. Projection Version

Projection version identifies transformation logic.

Example:

```text
projection_version = 2
```

Useful when:

- derived row payload changes,
- bucket logic changes,
- sort key changes,
- stale v1 rows coexist.

Reader:

```text
if projection_version < required:
  fallback or ignore
```

Backfill can upgrade.

---

## 27. Schema Version in Payload

If storing JSON/blob payload:

```json
{
  "schemaVersion": 3,
  "fields": ...
}
```

Application decoder must support old versions.

Do not assume all rows rewritten immediately.

For event logs, old event versions may live forever.

Use versioned deserializers.

---

## 28. Prepared Statement Compatibility

Prepared statements are tied to CQL and schema metadata.

If migration changes selected columns or table exists:

- prepare can fail,
- existing prepared statement can become invalid,
- driver may reprepare,
- rolling app may see errors.

Safe pattern:

```text
add new schema first
deploy code that can use it
remove old schema last
```

Do not drop column/table while old instances still prepared to use it.

---

## 29. Query Compatibility

Changing query shape means changing repository method and table.

Old:

```sql
SELECT ... WHERE tenant_id=? AND assignee_id=?
```

New:

```sql
SELECT ... WHERE tenant_id=? AND assignee_id=? AND bucket_day=? AND bucket_id=?
```

This is not a transparent migration.

API/service must change:

- bucket planning,
- fanout,
- cursor,
- limits,
- metrics,
- tests.

Schema evolution often changes Java logic, not just CQL.

---

## 30. Cursor Compatibility

If public API cursor encodes old table key:

```json
{
  "lastDueAt": "...",
  "lastCaseId": "..."
}
```

New v2 cursor may need:

```json
{
  "bucketDay": "...",
  "bucketId": 3,
  "lastDueAt": "...",
  "lastCaseId": "..."
}
```

During migration:

- accept old cursor until expired,
- version cursor,
- include `cursorVersion`,
- reject incompatible cursor gracefully.

Example:

```json
{
  "v": 2,
  "bucketDay": "2026-06-21",
  "bucketId": 3,
  "lastDueAt": "...",
  "lastCaseId": "..."
}
```

---

## 31. TTL Change

Changing TTL semantics is risky.

Old:

```text
notifications TTL 30 days
```

New:

```text
TTL 90 days
```

Questions:

```text
Does old expired data need restore?
Does table default TTL change affect existing rows?
Will mixed TTL values hurt compaction?
Do legal retention rules change?
Do clients query older range?
```

If retention changes significantly, consider new table.

---

## 32. Compaction Strategy Change

Changing compaction strategy may be needed, but it is operational.

Example:

```text
STCS -> TWCS for TTL time-series
```

Questions:

```text
What happens to existing SSTables?
Will compaction backlog spike?
Is disk headroom enough?
Is TTL/window aligned?
Do late writes exist?
```

Coordinate with DB/SRE.

Schema migration should not casually alter compaction on huge table without test.

---

## 33. gc_grace_seconds Change

From part 015:

```text
gc_grace_seconds is delete correctness window
```

Changing it requires:

- repair schedule awareness,
- delete/TTL workload analysis,
- zombie risk evaluation,
- backup/restore plan.

Do not include gc_grace changes in application migration without ops review.

---

## 34. Index/MV Schema Evolution

Adding index/MV to existing table can trigger build.

Risk:

- resource load,
- disk usage,
- compaction,
- rebuild time,
- topology constraints,
- restore plan.

Often explicit table + controlled backfill is safer for critical query.

If using MV/index, include build status and rollback plan.

---

## 35. UDT Evolution

UDT changes affect Java mapping.

Rules:

- add fields carefully,
- old rows may not have value,
- old app may not know new field,
- serialized DTO version matters,
- nested UDT/collections magnify risk.

For core business fields, explicit columns may evolve easier.

---

## 36. Enum Evolution

Java enum stored as text:

```text
UNDER_REVIEW
APPROVED
REJECTED
```

New value:

```text
ESCALATED
```

Old app reading new enum may throw.

Safe pattern:

- deploy readers that tolerate unknown enum first,
- then start writing new enum,
- use `UNKNOWN`/raw string fallback,
- avoid Java `Enum.valueOf` without guard.

Example:

```java
CaseStatus parseStatus(String value) {
    try {
        return CaseStatus.valueOf(value);
    } catch (IllegalArgumentException ex) {
        return CaseStatus.UNKNOWN;
    }
}
```

But business logic must handle UNKNOWN safely.

---

## 37. Removing Enum Value

Harder than adding.

Need:

- stop writing old value,
- migrate rows,
- update derived tables/search,
- ensure old readers gone,
- validate no old values,
- then remove from code.

---

## 38. Column Default Myth

ScyllaDB/CQL does not behave like SQL with rich defaults for old rows.

Adding a column does not materialize value for old rows.

Application must treat missing/null as expected.

If default needed:

- compute on read,
- backfill,
- write default for new rows,
- use derived projection.

---

## 39. Materialized Payload Compatibility

If row has payload:

```text
payload text/json/blob
```

and schema changes:

```text
v1 payload
v2 payload
```

Backfill may not rewrite all old payloads.

Reader must support:

- v1,
- v2,
- unknown version,
- partial fields,
- validation failure.

Event logs especially require indefinite backward compatibility.

---

## 40. Backward and Forward Compatibility

### Backward Compatible

New app reads old data.

Example:

```text
new app handles missing risk_score
```

### Forward Compatible

Old app can survive new data.

Example:

```text
old app sees unknown enum and does not crash
```

Rolling deploy needs both depending order.

For ScyllaDB schema/data, backward compatibility is usually mandatory; forward compatibility is needed when old app may read new writes during rollout/rollback.

---

## 41. Feature Flags

Feature flags help separate:

```text
code deployment
schema activation
data migration
read cutover
```

Flags:

```text
write_new_table_enabled
read_new_table_enabled
shadow_read_enabled
fallback_to_old_enabled
backfill_enabled
```

Flags should be safe and observable.

---

## 42. Compatibility Windows

Keep old and new compatible for a defined window.

Example:

```text
two app releases
one week
one full backfill validation cycle
```

Do not drop old schema immediately after cutover.

Production rollback sometimes needs old path.

---

## 43. Migration Playbook: Add New Derived Table

Use case:

```text
cases by external ref
```

Steps:

```text
1. CREATE TABLE case_id_by_external_ref.
2. Wait for schema agreement.
3. Deploy v2 app dual-writing mapping for new/updated cases.
4. Backfill existing cases.
5. Validate counts/samples.
6. Shadow read new table for sampled requests.
7. Enable read_new_table flag.
8. Monitor.
9. Keep dual-write and fallback.
10. After window, remove fallback/old logic if any.
```

---

## 44. Migration Playbook: Change Primary Key

Use case:

```text
open_cases_by_assignee_v1 -> v2 with day/hash bucket
```

Steps:

```text
1. CREATE v2 table.
2. Implement v2 repository with bucket planner.
3. Deploy dual-write on all state changes.
4. Backfill v2 from source current/events.
5. Reconcile stale/missing rows.
6. Shadow read compare v1 vs v2.
7. Version API cursor.
8. Cutover per tenant.
9. Monitor p99/mismatch.
10. Rollback if needed.
11. Stop v1 reads/writes later.
12. Drop v1 after retention window.
```

---

## 45. Migration Playbook: Rename/Replace Column

Use case:

```text
priority -> severity
```

Steps:

```text
1. ADD severity.
2. Deploy reader that uses severity fallback priority.
3. Deploy writer that writes both.
4. Backfill severity.
5. Enable business logic using severity.
6. Stop writing priority.
7. Validate no priority-only rows needed.
8. Drop priority later.
```

---

## 46. Migration Playbook: Payload Version Upgrade

Use case:

```text
event payload v1 -> v2
```

Steps:

```text
1. Deploy reader supporting v1 and v2.
2. Deploy writer emitting v2.
3. Optional: lazy migrate on read or batch backfill.
4. Keep v1 decoder indefinitely if event log immutable.
5. Monitor decode errors.
6. Never rewrite audit history unless compliance allows.
```

---

## 47. Migration Playbook: TTL Retention Change

Use case:

```text
notification retention 30d -> 90d
```

Steps:

```text
1. Decide if old expired data must be recovered.
2. Evaluate compaction/TTL impact.
3. Consider new table if mixed TTL problematic.
4. Update table default TTL or write TTL for new rows.
5. Update API max range.
6. Backfill only if source still exists.
7. Monitor tombstones/disk/compaction.
```

---

## 48. Migration Playbook: Drop Table

Steps:

```text
1. Verify no reads.
2. Verify no writes.
3. Verify no backfill/projection depends on it.
4. Verify rollback no longer needs it.
5. Archive/export if needed.
6. Remove code references.
7. Drop table in maintenance window if large/critical.
8. Monitor metadata/disk cleanup.
```

Dropping table is easier than deleting rows one by one, but still needs operational plan.

---

## 49. Schema Drift

Schema drift occurs when environments differ:

```text
dev has column
staging lacks table
prod has old compaction option
one region migration failed
```

Mitigate:

- migration checksums,
- CI schema validation,
- startup schema verification,
- environment drift reports,
- no manual hotfix DDL without recording migration.

---

## 50. Startup Schema Verification

At service startup, verify required schema version.

Example:

```text
service requires migration >= 2026_06_21_001
```

If not met:

- fail readiness,
- do not serve traffic,
- alert.

But be careful during rolling deploy; ensure migrations happen before app requiring them.

---

## 51. Repository Schema Contract Tests

Tests should verify:

- table exists,
- required columns exist,
- prepared statements prepare,
- primary key query valid,
- result mapping handles null/new fields,
- old/new payload decode,
- cursor versions parse,
- LWT result shape.

Use integration tests.

---

## 52. CQL Registry and Schema Docs

For each table document:

```text
table purpose
authority type
primary key
access patterns
Java repository
consistency profiles
TTL
compaction
gc_grace
derived/source relationship
migration history
rebuild procedure
```

Schema evolution without docs becomes archaeology.

---

## 53. Observability During Migration

Metrics:

```text
dual_write_old_success
dual_write_new_success
dual_write_new_failure
backfill_progress
backfill_lag
shadow_read_mismatch
fallback_to_old_count
new_read_error
source_version_stale_count
projection_version_distribution
decode_error_by_payload_version
```

Logs should include:

- migration name,
- tenant/cohort,
- source_version,
- target table,
- redacted key hash.

---

## 54. Alerting During Migration

Alert on:

```text
dual-write failure spike
backfill stuck
shadow mismatch above threshold
fallback rate high
new read p99 high
decode errors
schema agreement failure
migration failed in one region
disk/compaction spike
```

Migration is production event.

---

## 55. Rollback Categories

### 55.1 Code Rollback

Deploy old app.

Requires old schema still exists and new data does not crash old app.

### 55.2 Read Flag Rollback

Switch reads back to old table.

Requires old table still written.

### 55.3 Write Flag Rollback

Stop writing new table.

Requires no downstream depends exclusively on new table.

### 55.4 Data Rollback

Hardest. Avoid needing it by additive migrations and flags.

---

## 56. Destructive Migration Safety

Destructive changes:

- drop column,
- drop table,
- reduce TTL,
- change meaning of enum,
- delete rows,
- lower gc_grace,
- alter compaction drastically.

Require:

```text
explicit approval
backup/restore plan
compatibility proof
rollback analysis
blast radius limit
```

---

## 57. Multi-Region Migration

If cluster/application is multi-region:

Questions:

```text
Does DDL run once globally or per cluster?
Are apps deployed per region?
Can one region read schema before another?
Is local DC config affected?
Does dual-write replicate cross-region?
Can cutover be region-by-region?
```

Rollout should consider region order and rollback.

---

## 58. Backup/Restore Compatibility

Schema changes affect backup/restore.

Questions:

```text
Can old backup restore into new schema?
Are dropped columns needed for restore?
Do MV/index need rebuild?
Is table v1 still needed for rollback?
Does restored data violate new enum decoder?
```

DR tests should include current schema migration state.

---

## 59. Security/Compliance Schema Changes

Adding new column may add PII.

Before adding:

```text
data classification
encryption needs
access control
masking/logging
retention
privacy deletion workflow
backup retention
external projection impact
```

Schema migration is also data governance event.

---

## 60. Common Anti-Patterns

### 60.1 Drop Column Immediately After Code Change

Breaks rolling deploy/rollback.

### 60.2 Change Primary Key in Place

Not possible as simple ALTER; needs new table.

### 60.3 New Table Without Backfill Plan

Works only for new data, old data missing.

### 60.4 Backfill Without Live Dual-Write

Race creates missing updates.

### 60.5 No Shadow Read

Cutover blindly.

### 60.6 No Source Version

Cannot detect stale derived row.

### 60.7 Generic Mapper Assumes New Column Non-Null

Crashes on old rows.

### 60.8 Old App Crashes on New Enum

Forward compatibility failure.

### 60.9 Permanent Migration Flags

Operational debt.

### 60.10 Manual DDL Not Recorded

Schema drift.

---

## 61. Schema Evolution Checklist

Before migration:

```text
[ ] What access pattern changes?
[ ] Additive or destructive?
[ ] New table required?
[ ] Rolling deploy compatibility?
[ ] Old app with new schema okay?
[ ] New app with old data okay?
[ ] Rollback path?
[ ] DDL migration file?
[ ] Schema agreement wait?
[ ] Prepared statements affected?
[ ] Backfill needed?
[ ] Dual-write needed?
[ ] Source_version/projection_version needed?
[ ] Cursor/API compatibility?
[ ] Validation/shadow read?
[ ] Feature flags?
[ ] Metrics/alerts?
[ ] Cleanup plan?
[ ] Security/retention impact?
```

---

## 62. Mental Model Compression

Remember:

```text
ScyllaDB schema is a physical query contract.
Changing access pattern usually means new table.
New table means dual-write/backfill/cutover.
Safe migration means expand -> migrate -> contract.
```

And:

```text
Never remove old schema until old code, old data, old cursors, and rollback need are gone.
```

---

## 63. Summary

Schema evolution is a distributed systems workflow.

Key lessons:

1. Primary key is physical query plan; changing it needs new table.
2. Additive column changes are easiest but old rows have null.
3. Rolling deploy requires old/new app compatibility.
4. Use expand/migrate/contract.
5. DDL must wait for schema agreement.
6. Prepared statements and repositories are schema contracts.
7. Column rename/type change should use new column and phased migration.
8. New access pattern usually requires new table.
9. Dual-write partial failure must be handled by authority semantics.
10. Backfill races with live writes; use source_version/replay/validation.
11. Shadow read before cutover.
12. Cutover should be feature-flagged and often tenant-by-tenant.
13. Rollback requires old path still maintained.
14. TTL/compaction/gc_grace changes require ops review.
15. Enum/payload evolution needs backward/forward compatibility.
16. Cursor versions matter.
17. Migration needs metrics, alerts, and cleanup.
18. Manual untracked DDL creates schema drift.

---

## 64. Review Questions

1. Mengapa primary key change butuh table baru?
2. Apa itu schema agreement?
3. Apa itu expand/migrate/contract?
4. Bagaimana menambah kolom dengan aman?
5. Kenapa new column harus nullable/tolerated?
6. Bagaimana rename column secara aman?
7. Kenapa drop column harus paling akhir?
8. Apa risiko dual-write?
9. Bagaimana backfill race dengan live write?
10. Apa fungsi source_version?
11. Apa fungsi projection_version?
12. Kenapa prepared statement terdampak schema migration?
13. Bagaimana cursor compatibility dijaga?
14. Mengapa TTL change berisiko?
15. Kenapa enum baru bisa crash old app?
16. Apa itu shadow read?
17. Kapan cutover tenant-by-tenant berguna?
18. Apa rollback categories?
19. Apa anti-pattern schema migration terbesar?
20. Apa isi schema evolution checklist?

---

## 65. Practical Exercise

Desain migration:

```text
open_cases_by_assignee_v1
```

ke:

```text
open_cases_by_assignee_day_bucket_v2
```

Requirement:

```text
- existing production traffic continues
- old API cursor still accepted for 24h
- v2 adds bucket_day and bucket_id
- live writes continue
- rollback possible
- mega tenant exists
```

Tulis:

```text
1. DDL v2
2. repository v2
3. cursor v2 format
4. app version compatibility plan
5. feature flags
6. dual-write logic
7. backfill job
8. source_version strategy
9. validation/shadow read
10. tenant-by-tenant cutover
11. rollback
12. cleanup
13. metrics
14. alerts
15. runbook
```

---

## 66. Preview Part 024

Part berikutnya membahas:

```text
Multi-Tenant ScyllaDB Design:
tenant isolation,
partition key design,
noisy neighbor,
per-tenant quotas,
hot tenants,
shared vs dedicated clusters,
security boundaries,
backfill fairness,
and operational controls.
```

Part 023 membahas evolusi schema.

Part 024 akan membahas desain multi-tenant yang tahan skew dan noisy neighbor.

---

# End of Part 023

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Batching, Bulk Loading, Backfill, dan High-Volume Write Pipelines</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-024.md">Part 024 — Multi-Tenant ScyllaDB Design: Tenant Isolation, Noisy Neighbor, Hot Tenants, Quotas, dan Operational Controls ➡️</a>
</div>

# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-027.md

# Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 027 dari 035  
> Fokus: schema evolution, versioned documents, backward/forward compatibility, expand-contract migration, lazy migration, online backfill, index migration, collection split/merge, embedded/reference migration, rollback, observability, dan Java migration runbook  
> Target pembaca: Java software engineer / tech lead yang mengelola MongoDB production system yang terus berubah tanpa downtime dan tanpa merusak data lama

---

## 0. Posisi Part Ini Dalam Seri

Part 026 membahas search. Sekarang kita membahas hal yang akan terjadi di semua sistem nyata:

```text
schema berubah
field berubah
query berubah
index berubah
collection berubah
data lama tetap ada
aplikasi lama dan baru bisa berjalan bersamaan
```

MongoDB sering disebut flexible schema atau schema-less. Itu benar dalam arti collection tidak memaksa semua document punya struktur identik. Tetapi untuk aplikasi production, terutama Java application, realitasnya:

```text
schema tetap ada
hanya saja sebagian schema hidup di aplikasi, query, index, validator, migration, dan operational convention
```

Kesalahan umum:

```text
Karena MongoDB flexible, migration tidak perlu dipikirkan.
```

Ini salah.

Flexible schema membuat perubahan kecil lebih mudah, tetapi juga membuat inconsistency lebih mudah tidak terlihat.

Kalimat inti:

> Flexible schema reduces friction, not responsibility.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan kenapa MongoDB tetap membutuhkan schema governance.
2. Mendesain document versioning.
3. Membuat Java reader yang backward-compatible.
4. Membuat writer yang forward-compatible selama rollout.
5. Menerapkan expand-contract migration.
6. Mendesain lazy migration dan online backfill.
7. Menghindari dual-write trap.
8. Mengganti nama field tanpa downtime.
9. Memecah collection atau menggabungkan collection dengan aman.
10. Memindahkan embedded data menjadi referenced collection.
11. Memindahkan referenced data menjadi embedded summary.
12. Melakukan index migration dengan aman.
13. Mendesain rollback strategy.
14. Mengobservasi migration progress dan data quality.
15. Membuat runbook migration production.

---

## 2. Flexible Schema Bukan No Schema

Walau MongoDB tidak memaksa relational schema seperti SQL table, aplikasi tetap punya ekspektasi:

```java
record CaseDocument(
    String tenantId,
    String caseId,
    String status,
    Instant createdAt,
    Instant updatedAt
) {}
```

Query juga punya ekspektasi:

```javascript
{ tenantId: "t1", status: "OPEN" }
```

Index punya ekspektasi:

```javascript
{ tenantId: 1, status: 1, dueAt: 1 }
```

API punya ekspektasi:

```json
{
  "caseNumber": "...",
  "status": "OPEN"
}
```

Jika document lama tidak punya field `status`, aplikasi bisa error.

Jika field berubah tipe dari string ke object, query bisa salah.

Jika index mengasumsikan field ada, performance bisa berubah.

Jadi schema MongoDB hidup di banyak tempat:

```text
Java model
repository query
aggregation pipeline
index definition
validation rule
API contract
search projection
migration script
tests
dashboards
runbooks
```

---

## 3. Types of Schema Change

Perubahan umum:

```text
add field
remove field
rename field
change field type
split field
merge fields
move embedded -> referenced
move referenced -> embedded
change enum values
change array structure
change identifier format
add schema version
change index
change shard key-related field
change retention field
change authorization field
change search projection
```

Setiap perubahan punya risiko berbeda.

Adding optional field biasanya mudah.

Changing field type sering sulit.

Removing field tanpa compatibility bisa memecahkan aplikasi lama.

Changing authorization field bisa security-sensitive.

Changing shard key field bisa sangat berat.

---

## 4. Compatibility Matrix

Saat deploy rolling, ada beberapa kombinasi:

```text
old app reads old data
old app reads new data
new app reads old data
new app reads new data
old app writes old data
new app writes new data
```

Zero-downtime migration harus aman dalam semua kombinasi yang bisa terjadi selama rollout.

Contoh:

```text
old app writes field: assigneeId
new app reads field: ownerUserId
```

Jika new app tidak fallback ke `assigneeId`, data dari old app hilang secara logical.

Compatibility bukan teori. Ini real production risk.

---

## 5. Backward and Forward Compatibility

### 5.1 Backward-compatible reader

New code can read old documents.

Example:

```java
String owner = doc.ownerUserId();
if (owner == null) {
    owner = doc.assigneeId(); // fallback
}
```

### 5.2 Forward-compatible reader

Old code can tolerate new documents.

Example:

- unknown fields ignored,
- enum unknown handled safely,
- field additions do not break deserialization.

### 5.3 Backward-compatible writer

New code writes fields old code can still tolerate.

### 5.4 Forward-compatible writer

Old code writes data new code can still understand.

In rolling deployment, you usually need a compatibility window.

---

## 6. Schema Version Field

Add schema version to documents.

```javascript
{
  _id: "case-1",
  tenantId: "tenant-a",
  schemaVersion: 3,
  status: "OPEN",
  ...
}
```

Uses:

- reader branching,
- migration progress,
- backfill targeting,
- debugging,
- audit,
- compatibility tests.

Do not overuse version branching forever. Version should help migration converge.

Example Java:

```java
int version = doc.getInteger("schemaVersion", 1);

switch (version) {
  case 1 -> readV1(doc);
  case 2 -> readV2(doc);
  case 3 -> readV3(doc);
  default -> readLatestWithTolerance(doc);
}
```

Better for many systems:

```text
small localized adapters
not giant switch everywhere
```

---

## 7. Reader Adapter Pattern

Separate persistence document from domain.

```java
final class CaseDocumentReader {
    CasePersistenceModel read(Document doc) {
        int schemaVersion = doc.getInteger("schemaVersion", 1);

        String assigneeId =
            doc.getString("ownerUserId") != null
                ? doc.getString("ownerUserId")
                : doc.getString("assigneeId");

        return new CasePersistenceModel(...);
    }
}
```

Benefits:

- compatibility logic centralized,
- tests easy,
- domain model clean,
- migration phased.

Avoid scattering fallback logic across services.

---

## 8. Writer Strategy

Writers control future shape.

During migration, you may need:

### 8.1 Write old field only

Before migration.

```javascript
{ assigneeId: "u1" }
```

### 8.2 Dual-write old and new field

During compatibility window.

```javascript
{
  assigneeId: "u1",
  ownerUserId: "u1"
}
```

### 8.3 Write new field only

After old readers gone and data backfilled.

```javascript
{ ownerUserId: "u1" }
```

Dual-write should be temporary.

Permanent dual-write creates consistency risk.

---

## 9. Expand-Contract Migration

This is the core zero-downtime pattern.

### Phase 1: Expand

Add new field/index/collection while old still works.

```text
code can read old and new
writer may write both
new index built
new collection created
```

### Phase 2: Backfill

Populate new structure for old data.

```text
batch migration
lazy migration
change stream/outbox projection
```

### Phase 3: Cutover

Switch reads to new structure.

```text
feature flag
canary tenant
monitor
```

### Phase 4: Contract

Remove old field/index/code after safety window.

```text
stop writing old field
drop old index
remove fallback code
delete old field if needed
```

Never do expand and contract in one risky deploy.

---

## 10. Example: Rename `assigneeId` to `ownerUserId`

### Problem

Old document:

```javascript
{
  tenantId: "t1",
  caseId: "C-1",
  assigneeId: "u1"
}
```

New desired:

```javascript
{
  tenantId: "t1",
  caseId: "C-1",
  ownerUserId: "u1"
}
```

### Bad Migration

Deploy code that only reads `ownerUserId`, then batch update later.

New code fails on old data.

### Good Migration

#### Deploy A: Expand reader/writer

Reader:

```text
owner = ownerUserId if exists else assigneeId
```

Writer:

```text
write both assigneeId and ownerUserId
```

#### Backfill

```javascript
db.cases.updateMany(
  {
    ownerUserId: { $exists: false },
    assigneeId: { $exists: true }
  },
  [
    {
      $set: {
        ownerUserId: "$assigneeId",
        schemaVersion: 2
      }
    }
  ]
)
```

Use controlled batches in production.

#### Build new index

```javascript
db.cases.createIndex({
  tenantId: 1,
  ownerUserId: 1,
  status: 1,
  dueAt: 1
})
```

#### Deploy B: Read new field primarily

Still fallback.

#### Deploy C: Stop writing old field

After old app gone.

#### Contract

Remove `assigneeId` after safety window, drop old index.

---

## 11. Lazy Migration

Lazy migration updates document when it is read/written.

Example:

```java
CaseDocument doc = repository.find(...);

if (doc.schemaVersion() < CURRENT_VERSION) {
    CaseDocument migrated = migrate(doc);
    repository.compareAndSetUpdate(doc.id(), doc.version(), migrated);
}
```

Pros:

- no big migration job,
- spreads cost over normal traffic,
- simple for cold data.

Cons:

- cold data remains old,
- first read can be slower,
- write conflict handling needed,
- harder to know completion,
- not enough if query/index requires new field for all docs.

Use lazy migration when:

```text
old shape is still readable
new field not required for hot query immediately
eventual convergence acceptable
```

---

## 12. Online Backfill

Backfill updates existing documents in controlled batches.

Pattern:

```text
find batch of old documents
update idempotently
record checkpoint
rate limit
monitor
repeat
```

Migration state:

```javascript
{
  _id: "migration:case-ownerUserId-v2:tenant-a",
  migrationId: "case-ownerUserId-v2",
  tenantId: "tenant-a",
  status: "RUNNING",
  lastSeenId: ObjectId("..."),
  processed: 120000,
  modified: 119000,
  failed: 3,
  startedAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Backfill query:

```javascript
db.cases.find({
  tenantId: "tenant-a",
  _id: { $gt: lastSeenId },
  ownerUserId: { $exists: false },
  assigneeId: { $exists: true }
}).sort({ _id: 1 }).limit(500)
```

Update idempotently:

```javascript
db.cases.updateOne(
  {
    _id: id,
    ownerUserId: { $exists: false }
  },
  {
    $set: {
      ownerUserId: assigneeId,
      schemaVersion: 2
    }
  }
)
```

---

## 13. Idempotent Migration

Migration must be safe to run twice.

Bad:

```javascript
{ $inc: { retryCount: 1 } }
```

unless intentional.

Good:

```javascript
{ $set: { ownerUserId: oldAssigneeId } }
```

with condition:

```javascript
{ ownerUserId: { $exists: false } }
```

Idempotent migration allows:

- retry after crash,
- pause/resume,
- partial failure,
- duplicate worker prevention,
- safe rollback.

---

## 14. Batching

Do not run unbounded `updateMany` on huge production collection casually.

Use batches:

```text
batch size 100-1000 initially
measure
adjust
rate limit
monitor replication lag
pause if needed
```

Batch size depends on:

- document size,
- index count,
- write concern,
- replication lag,
- workload peak,
- cluster capacity,
- migration complexity.

Migration should be pauseable.

---

## 15. Tenant-Scoped Migration

In multi-tenant systems, migrate per tenant.

Benefits:

- blast radius smaller,
- progress visible,
- large tenant handled separately,
- rollback easier,
- tenant maintenance windows possible,
- noisy neighbor reduced.

Migration state per tenant:

```text
tenant-a completed
tenant-b running
tenant-c pending
```

Do not let one huge tenant block all smaller tenants indefinitely.

---

## 16. Migration Feature Flags

Use flags for cutover.

Example:

```text
case.ownerUserId.readMode:
  fallback
  new_primary
  new_only

case.ownerUserId.writeMode:
  old_only
  dual_write
  new_only
```

Flags allow:

- canary,
- rollback,
- tenant-by-tenant rollout,
- emergency switch.

But flags add complexity. Remove after migration complete.

---

## 17. Shadow Field Pattern

Add new computed/normalized field without removing old.

Example:

```javascript
{
  partyName: "John Doe",
  partyNameNormalized: "john doe"
}
```

Migration:

1. add writer for normalized field,
2. backfill existing docs,
3. add index,
4. switch queries to normalized field,
5. keep original for display.

Shadow fields are common for search/query normalization.

---

## 18. Changing Field Type

Example old:

```javascript
{
  riskScore: "87"
}
```

New:

```javascript
{
  riskScore: 87
}
```

Risk:

- mixed types in collection,
- query comparison behaves differently,
- index ordering mixed,
- Java mapping errors.

Safer:

```javascript
{
  riskScore: "87",
  riskScoreValue: 87
}
```

Then migrate/cutover.

After safe window, remove old.

Avoid changing type in-place for hot fields unless carefully controlled.

---

## 19. Enum Evolution

Old enum:

```text
OPEN
CLOSED
```

New enum:

```text
OPEN
UNDER_REVIEW
ESCALATED
CLOSED
```

Java danger:

```java
CaseStatus.valueOf(raw)
```

throws on unknown.

Use tolerant parsing:

```java
CaseStatus parse(String raw) {
    try {
        return CaseStatus.valueOf(raw);
    } catch (Exception e) {
        return CaseStatus.UNKNOWN;
    }
}
```

But for command logic, `UNKNOWN` should fail safely.

Reader may tolerate; writer/transition should enforce known valid states.

---

## 20. Removing Field

Removing field is contract phase.

Before removal:

1. no code reads it,
2. no index depends on it,
3. no aggregation uses it,
4. no search projection uses it,
5. no export/report uses it,
6. no downstream consumer uses it,
7. no rollback needs it,
8. no old app running.

Then remove:

```javascript
db.cases.updateMany(
  { oldField: { $exists: true } },
  { $unset: { oldField: "" } }
)
```

Often you do not need to physically remove immediately. Leaving old field may be acceptable if not sensitive/costly.

But if field contains PII or wrong data, removal/anonymization may be necessary.

---

## 21. Index Migration

Index changes are schema changes.

Example old query:

```javascript
{ tenantId, assigneeId, status }
```

new query:

```javascript
{ tenantId, ownerUserId, status }
```

Need:

1. build new index,
2. deploy reader/query using new field,
3. observe usage,
4. drop old index after old query gone.

Do not drop old index before old app stopped using it.

Index migration checklist:

```text
new query shape known
new index built
build impact monitored
query explain verified
app deployed
old index usage checked
old index dropped only after safety window
```

---

## 22. Hidden Index / Index Testing

MongoDB supports hiding indexes in certain versions, which can help test behavior without dropping.

Concept:

```text
hide index
observe query planner/performance
unhide if issue
drop later
```

Use with caution and platform support.

For production, coordinate index experiments with observability.

---

## 23. Unique Index Migration

Adding unique index is dangerous if duplicates exist.

Steps:

1. scan for duplicates,
2. resolve duplicates,
3. add unique index,
4. enforce at application,
5. monitor duplicate key errors.

Example:

```javascript
db.cases.aggregate([
  {
    $group: {
      _id: { tenantId: "$tenantId", caseNumber: "$caseNumber" },
      count: { $sum: 1 },
      ids: { $push: "$_id" }
    }
  },
  { $match: { count: { $gt: 1 } } }
])
```

Do not attempt unique index build blindly on dirty data.

---

## 24. Partial Index Migration

If adding partial index:

```javascript
db.cases.createIndex(
  { tenantId: 1, assigneeId: 1, dueAt: 1 },
  {
    partialFilterExpression: {
      status: { $in: ["OPEN", "UNDER_REVIEW"] }
    }
  }
)
```

Ensure queries include matching predicate.

Otherwise planner may not use it.

Migration must include query update/test.

---

## 25. Collection Split: Embedded to Referenced

Old:

```javascript
{
  caseId: "case-1",
  notes: [
    { noteId: "n1", text: "...", createdAt: ... },
    { noteId: "n2", text: "...", createdAt: ... }
  ]
}
```

New:

```text
cases
case_notes
```

Migration pattern:

### Phase 1: Expand

Create `case_notes` collection and index:

```javascript
db.case_notes.createIndex({ tenantId: 1, caseId: 1, createdAt: -1 })
```

App reads:

```text
notes from new collection if exists, else embedded
```

Writer:

```text
write new notes to both embedded and case_notes
```

or preferably:

```text
write new notes to case_notes, keep read fallback
```

depending compatibility.

### Phase 2: Backfill

For each case, insert notes into `case_notes` with deterministic IDs.

```javascript
_id: "tenant-a:case-1:n1"
```

### Phase 3: Cutover

Read notes from `case_notes`.

### Phase 4: Contract

Stop writing embedded notes.

Remove embedded notes after safety window or keep recent preview only.

---

## 26. Deterministic IDs For Backfill

When extracting embedded items, use deterministic `_id`.

```text
tenantId + caseId + noteId
```

If noteId missing, generate stable ID from:

```text
caseId + array index + createdAt + hash text
```

Be careful: array index can change if array mutated.

Better to add IDs before migration if possible.

Deterministic IDs allow idempotent insert/upsert.

---

## 27. Collection Merge: Referenced to Embedded Summary

Old:

```text
cases
case_parties
```

New case stores summary:

```javascript
{
  caseId: "case-1",
  partySummary: [
    { partyId: "p1", displayName: "Jane D.", role: "SUBJECT" }
  ]
}
```

This is not necessarily replacing `case_parties`; it may be a summary for list/detail performance.

Migration:

1. add `partySummary`,
2. writer updates party collection and summary,
3. backfill summary,
4. read summary,
5. keep source collection for full party records.

Be careful: embedded summary can become stale. Need update/reconciliation.

---

## 28. Moving Referenced to Embedded Fully

Only do this if:

```text
child is bounded
child owned by parent
child not independently queried
child lifecycle same as parent
```

Migration:

1. reader can handle both,
2. writer writes embedded,
3. backfill parent from child collection,
4. cutover reads,
5. stop writing child,
6. archive/drop child after safety.

Risk:

- parent document size growth,
- stale duplicate data,
- lost independent query capability.

---

## 29. Splitting Hot and Cold Data

Old:

```javascript
cases includes auditTrail, notes, documents
```

New:

```text
cases
case_audit_events
case_notes
case_documents
```

This is often performance-driven migration.

Strategy:

- define bounded main case document,
- extract unbounded arrays,
- create preview fields if needed,
- backfill child collections,
- update APIs to load tabs separately,
- remove old arrays after validation.

Important:

```text
Do not break audit/legal history.
```

---

## 30. Search Projection Migration

Search schema changes require:

- new projection fields,
- new search index mappings/analyzers,
- backfill/reindex,
- dual index if needed,
- cutover query,
- remove old index.

Example:

```text
case_search_documents_v1
case_search_documents_v2
```

Process:

1. build v2 from source,
2. update projector to dual-write v1/v2 or write v2,
3. compare result quality,
4. switch search API to v2,
5. keep v1 rollback window,
6. delete v1 later.

Search migration is not just MongoDB document migration; it includes relevance testing.

---

## 31. Authorization Field Migration

Security-sensitive.

Example old:

```javascript
{ teamId: "team-1" }
```

New:

```javascript
{
  access: {
    owningTeamId: "team-1",
    sensitivity: "CONFIDENTIAL",
    allowedRoleCodes: [...]
  }
}
```

Migration risk:

- unauthorized access,
- over-restriction blocking users,
- search projection stale,
- facets leak,
- support tools bypass new model.

Safe approach:

1. write new access field,
2. read/authorize using stricter combination if needed,
3. backfill,
4. compare old vs new authorization decisions,
5. shadow evaluate,
6. cut over,
7. monitor denies/allows,
8. audit.

Shadow evaluation:

```text
old policy says allow
new policy says deny
record discrepancy
```

Do not cut over blindly.

---

## 32. Retention Field Migration

Retention changes are compliance-sensitive.

Example adding:

```javascript
retention: {
  policyId,
  retainUntil,
  deleteAfter,
  legalHold
}
```

Migration must:

- compute dates correctly,
- respect tenant policy,
- handle missing closedAt,
- handle legal hold,
- validate samples,
- dry run,
- get approval if needed,
- avoid accidental TTL deletion.

Never attach TTL before legal-hold-safe values are verified.

---

## 33. Shard Key Related Migration

Changing shard key is major.

If field participates in shard key:

- must exist,
- must be stable,
- affects routing,
- may require resharding,
- affects uniqueness/transactions.

Do not modify shard-key-related field casually.

Plan with DB/platform team.

Application-level field rename involving shard key is much harder than normal rename.

---

## 34. Rollback Strategy

Rollback must be designed before migration.

Types:

### 34.1 Code rollback

Can old code read documents written by new code?

### 34.2 Data rollback

Can migrated data be reversed?

### 34.3 Feature flag rollback

Can reads switch back to old field/index/projection?

### 34.4 Operational rollback

Can migration pause/resume/undo batch?

Expand-contract makes rollback easier because old structure remains during transition.

Contract phase is where rollback becomes hard.

---

## 35. Rollback Example: Rename Field

During expand:

```text
old field still present
new field added
reader fallback exists
```

Rollback easy:

```text
switch app to old field
ignore new field
```

After contract:

```text
old field removed
old index dropped
old code removed
```

Rollback hard.

Therefore contract only after:

- confidence,
- backups,
- safety window,
- metrics,
- no old version running,
- rollback no longer expected.

---

## 36. Migration Observability

Migration metrics:

```text
documents scanned
documents matched
documents modified
documents skipped
documents failed
batch duration
write latency
replication lag
CPU/disk impact
lock/contention indicators
error rate
remaining estimate
per-tenant progress
```

Application metrics:

```text
reader fallback count
old field read count
new field read count
dual-write mismatch count
unknown schema version count
deserialization error count
query latency
```

These metrics tell when contract is safe.

---

## 37. Fallback Count Metric

During migration:

```java
if (ownerUserId == null && assigneeId != null) {
    metrics.increment("case.ownerUserId.fallback");
}
```

When fallback count reaches zero for enough time, old field likely no longer needed.

But consider cold data. Zero in traffic does not mean all documents migrated.

Use both:

```text
traffic fallback metrics
database backfill completeness query
```

---

## 38. Data Quality Validation

Before cutover:

```text
count documents missing new field
count documents with mismatch old/new
sample compare values
validate type
validate enum
validate index usage
validate application reads
```

Example:

```javascript
db.cases.countDocuments({
  assigneeId: { $exists: true },
  ownerUserId: { $exists: false }
})
```

Mismatch:

```javascript
db.cases.countDocuments({
  $expr: { $ne: ["$assigneeId", "$ownerUserId"] }
})
```

---

## 39. Migration Audit

For regulated data, migration itself may need audit.

Migration record:

```javascript
{
  _id: "migration:case-ownerUserId-v2",
  migrationId: "case-ownerUserId-v2",
  description: "Rename assigneeId to ownerUserId",
  approvedBy: "change-advisory-board",
  startedAt: ISODate(...),
  completedAt: ISODate(...),
  versionFrom: 1,
  versionTo: 2,
  affectedCollections: ["cases"],
  status: "COMPLETED",
  result: {
    scanned: 12000000,
    modified: 11998000,
    failed: 0
  }
}
```

Migration should be explainable after the fact.

---

## 40. Validation Rules

MongoDB supports schema validation rules.

Use carefully.

Validation can prevent bad writes but can break older app versions if introduced too strictly.

Migration approach:

1. observe current data quality,
2. add validation in warning/moderate mode if supported/appropriate,
3. fix violations,
4. tighten validation,
5. monitor write failures.

Do not add strict validation that old deployed app cannot satisfy.

Validation is part of expand-contract.

---

## 41. Java Mapping Compatibility

Potential issues:

- missing field,
- unknown enum,
- type mismatch,
- null where primitive expected,
- renamed field,
- nested object structure changed,
- date type changed,
- decimal type changed.

Avoid primitives for optional persisted fields:

```java
int priority; // bad if field missing
Integer priority; // safer
```

But domain model can enforce non-null after adapter.

Use persistence DTO separate from domain.

---

## 42. Unknown Fields

Java POJO codecs/Jackson-like mapping may ignore unknown fields depending configuration.

Ensure forward compatibility:

```text
old app should ignore new fields
```

But do not ignore unknown schemaVersion silently if semantics could be unsafe.

Policy:

```text
unknown additive field:
  okay

unknown enum/status/action:
  fail safe

unknown schema version:
  read limited view or reject command
```

---

## 43. Backward-Compatible Aggregations

Aggregation pipelines often break during schema migration.

Example:

```javascript
{ $group: { _id: "$ownerUserId" } }
```

Old docs have `assigneeId`.

Migration-compatible:

```javascript
{
  $addFields: {
    effectiveOwnerUserId: {
      $ifNull: ["$ownerUserId", "$assigneeId"]
    }
  }
}
```

Temporary compatibility.

Later remove fallback after migration complete.

---

## 44. Backward-Compatible Queries

Query old and new field during transition.

Example:

```javascript
{
  tenantId: "t1",
  $or: [
    { ownerUserId: "u1" },
    {
      ownerUserId: { $exists: false },
      assigneeId: "u1"
    }
  ]
}
```

This can hurt index usage.

Therefore, build backfill and indexes quickly, and minimize transition window for hot queries.

Alternative: dual-write before query cutover.

---

## 45. Mixed Schema Performance

Mixed schema often makes queries slower.

Reasons:

- `$or` fallback,
- missing fields,
- multiple indexes,
- aggregation compatibility stages,
- projection branching,
- cache fragmentation.

Goal:

```text
compatibility window should be safe but not permanent
```

Complete migration and contract.

---

## 46. Dual-Write Danger

Dual-write old/new fields or collections can diverge.

Example:

```text
case.notes embedded
case_notes collection
```

New write succeeds to embedded but fails to collection.

Mitigation:

- transaction if both must be consistent,
- outbox/reconciliation if eventual,
- idempotent repair job,
- mismatch detector,
- limit dual-write window.

Dual-write should have:

```text
owner
duration
consistency strategy
monitoring
cleanup plan
```

---

## 47. Reconciliation Job

For any duplicated data:

```text
source of truth vs projection
```

Reconcile.

Example:

```text
case party summary in cases
full parties in case_parties
```

Job:

```text
read source
compute expected summary
compare with embedded summary
fix mismatch
record metric
```

Run during and after migration.

---

## 48. Migration Tooling Options

Java options:

- custom Spring Boot command runner,
- dedicated migration service,
- Mongock,
- Liquibase MongoDB extension,
- Flyway-like custom runner,
- Kubernetes Job,
- batch worker,
- admin CLI.

Regardless of tool, migration needs:

```text
idempotency
checkpointing
observability
dry run
rate limiting
approval
rollback
tenant scope
```

Tool does not replace design.

---

## 49. Migration Runner Architecture

Components:

```text
MigrationDefinition
MigrationStateRepository
BatchScanner
BatchProcessor
CheckpointStore
RateLimiter
Metrics
DryRunReporter
ErrorStore
```

Pseudo:

```java
interface MongoMigration {
    String id();
    void dryRun(MigrationContext ctx);
    MigrationBatchResult processBatch(MigrationContext ctx, MigrationCheckpoint checkpoint);
    boolean isComplete(MigrationContext ctx);
}
```

Migration state in MongoDB:

```javascript
{
  migrationId,
  tenantId,
  status,
  checkpoint,
  processed,
  modified,
  failed,
  updatedAt
}
```

---

## 50. Dry Run

Dry run should answer:

```text
how many documents affected?
sample before/after?
estimated write volume?
index impact?
possible errors?
tenant breakdown?
duration estimate?
```

Dry run must not mutate data.

Example report:

```text
Migration: case-ownerUserId-v2
Tenant A:
  candidates: 12,000,000
  missing assigneeId: 3,200
  conflicts: 0
  estimated batches: 24,000
```

---

## 51. Canary Migration

Start with:

```text
one small tenant
one collection subset
one region
one low-risk environment
```

Then scale.

Canary checks:

- data correctness,
- latency impact,
- app compatibility,
- index usage,
- migration speed,
- error rate,
- rollback.

Do not start with biggest tenant.

---

## 52. Large Tenant Strategy

Large tenant may need:

- special schedule,
- lower rate,
- dedicated migration window,
- more monitoring,
- precomputed batches,
- parallelization by safe partition,
- communication with business,
- rollback plan.

Tenant skew matters.

---

## 53. Parallel Migration

Parallelism improves speed but increases load.

Partition by:

```text
tenant
_id range
time range
shard key range
caseId hash bucket
```

Ensure workers do not overlap.

Use lease/claim:

```javascript
{
  partitionId,
  migrationId,
  status: "CLAIMED",
  claimedBy,
  leaseUntil
}
```

Avoid duplicate heavy updates.

Idempotency still required.

---

## 54. Migration and Replication Lag

Backfill writes can increase replication lag.

Monitor:

- primary write latency,
- secondary lag,
- majority write concern errors,
- CPU/disk,
- cache pressure,
- application p99.

Throttle if lag exceeds threshold.

Migration runner should be able to pause automatically.

---

## 55. Migration and Search/Projections

When source schema changes, update:

- search projection,
- worklist projection,
- dashboard counters,
- change stream consumer,
- outbox schema,
- analytics export,
- archive format.

Schema migration is not only source collection.

Create dependency checklist.

---

## 56. Migration and API Contract

Changing persisted field does not necessarily require API change.

Keep API stable if possible:

```text
database: assigneeId -> ownerUserId
API: assigneeId maybe remains for compatibility
```

Or API version separately.

Do not leak internal migration into public API unless intended.

---

## 57. Migration and Tests

Test layers:

```text
unit:
  reader adapter old/new docs

integration:
  repository queries mixed schema

migration:
  before/after fixture

compatibility:
  old app reads new doc
  new app reads old doc

performance:
  explain plans during transition

security:
  authorization field migration

rollback:
  app rollback after data partially migrated
```

Golden document fixtures are useful.

---

## 58. Example Full Migration Plan

Scenario:

```text
Move case notes from embedded array to case_notes collection.
```

Plan:

```text
1. Add case_notes collection and indexes.
2. Deploy code that writes new notes to case_notes and still reads embedded fallback.
3. Backfill existing embedded notes to case_notes with deterministic IDs.
4. Add metric: embedded notes fallback count.
5. Verify count: embedded notes vs case_notes.
6. Switch read path to case_notes only for canary tenant.
7. Roll out read path to all tenants.
8. Keep embedded notes untouched for rollback window.
9. Stop writing embedded notes if still dual-writing.
10. Remove embedded notes or keep last 3 preview notes.
11. Drop old indexes/cleanup code.
12. Record migration completion.
```

---

## 59. Production Runbook Template

```text
Migration name:
Owner:
Business reason:
Collections affected:
Fields affected:
Indexes affected:
Application versions:
Compatibility plan:
Expand deploy:
Backfill plan:
Cutover plan:
Contract plan:
Rollback plan:
Dry run result:
Canary plan:
Rate limits:
Monitoring dashboards:
Alert thresholds:
Expected duration:
Approval:
Communication:
Post-migration validation:
```

---

## 60. Anti-Patterns

### 60.1 Big Bang Migration

Deploy code and migrate all data at once with no fallback.

### 60.2 In-Place Type Change

Change field type without compatibility.

### 60.3 Drop Old Field Too Early

Old app still reads it.

### 60.4 No Checkpoint

Migration crashes and restarts from beginning.

### 60.5 No Idempotency

Retry corrupts data.

### 60.6 No Observability

No idea how many docs migrated.

### 60.7 Raw updateMany On Huge Collection

Creates load spike.

### 60.8 Dual-Write Forever

Data divergence.

### 60.9 No Search/Projection Update

Source migrated but search stale/broken.

### 60.10 No Rollback Plan

Incident forces improvisation.

---

## 61. Senior-Level Heuristics

```text
If old and new code can run together, design compatibility first.

If migration is not idempotent, it is not production-ready.

If backfill cannot pause, it is dangerous.

If rollback cannot read migrated data, contract happened too early.

If query uses $or for mixed schema, minimize transition window.

If new field is security-sensitive, shadow-evaluate before cutover.

If migration touches many tenants, track progress per tenant.

If index migration is needed, build before query cutover.

If projection/search depends on field, migrate it explicitly.

If field is in shard key, stop and redesign carefully.
```

---

## 62. Practical Exercise

Design migration for this change:

```text
Old cases document:

{
  tenantId,
  caseId,
  assigneeId,
  status,
  notes: [
    { text, createdAt, createdBy }
  ],
  documents: [
    { fileName, storageKey, uploadedAt }
  ]
}

New model:
- assigneeId renamed to ownerUserId
- notes moved to case_notes collection
- documents moved to case_documents collection
- cases stores recentNotePreview and documentCount only
- search projection must include ownerUserId and party/document text
- system must support rolling deploy and rollback
```

Answer:

1. expand phase,
2. compatibility reader,
3. writer strategy,
4. backfill order,
5. index creation,
6. projection update,
7. validation queries,
8. rollback plan,
9. contract phase,
10. observability metrics.

Suggested direction:

```text
Phase 1:
  add ownerUserId, case_notes, case_documents, indexes
  readers fallback
  writers dual or new+fallback

Phase 2:
  backfill ownerUserId
  extract notes/documents with deterministic IDs
  build search projection v2

Phase 3:
  canary read from new collections/projection
  monitor fallback/mismatch

Phase 4:
  switch all reads
  stop old writes

Phase 5:
  contract after safety window
  remove old arrays or keep preview
  drop old indexes
```

---

## 63. Summary

Schema evolution in MongoDB requires deliberate compatibility.

Key lessons:

1. MongoDB flexible schema does not eliminate schema responsibility.
2. Schema lives in code, queries, indexes, validation, projections, and operations.
3. Rolling deploy requires old/new app and old/new data compatibility.
4. Expand-contract is the core zero-downtime migration pattern.
5. Schema version helps readers and migration tracking.
6. Reader adapters centralize compatibility logic.
7. Backfill must be idempotent, checkpointed, rate-limited, observable, and pauseable.
8. Dual-write should be temporary and monitored.
9. Index migration must happen before query cutover and old indexes dropped later.
10. Collection split/merge requires deterministic IDs, fallback reads, and reconciliation.
11. Security-sensitive migrations need shadow evaluation.
12. Retention/shard-key/search migrations require special care.
13. Contract phase is where rollback becomes hard; do it after safety window.
14. Migration is an operational workflow, not a one-off script.
15. Tests must cover mixed schema and app rollback.

The most important sentence:

> In production MongoDB systems, schema flexibility is useful only when paired with compatibility discipline, migration observability, and rollback-aware design.

---

## 64. Bridge to Part 028

Part 028 will focus on:

- what to unit test,
- what not to mock,
- repository tests,
- aggregation pipeline tests,
- index expectation tests,
- schema compatibility tests,
- migration tests,
- transaction tests,
- concurrency tests,
- Testcontainers MongoDB,
- replica set testing,
- performance regression tests,
- fixtures,
- golden document snapshots,
- failure injection,
- CI strategy.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-028.md
```

Judul berikutnya:

```text
Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing
```

---

## 65. Status Seri

Selesai sampai bagian ini:

```text
Part 000 — Orientation: Why Document Database Exists, and When It Is the Wrong Tool
Part 001 — Document Database Mental Model: Aggregate, Boundary, Locality, and Shape
Part 002 — BSON, JSON, Document Structure, and Type Semantics
Part 003 — MongoDB Core Architecture: Database, Collection, Document, Replica Set, Shard
Part 004 — CRUD Semantics: Insert, Find, Update, Delete Without SQL Thinking
Part 005 — Query Model: Thinking in Predicates, Shapes, and Access Paths
Part 006 — Indexing Deep Dive I: B-Tree Mental Model, Compound Indexes, and Explain Plans
Part 007 — Indexing Deep Dive II: Multikey, Partial, Sparse, TTL, Unique, Text, Geo, Clustered
Part 008 — Data Modelling I: Embed vs Reference Decision Framework
Part 009 — Data Modelling II: Patterns for Real Systems
Part 010 — Schema Design for Java Applications: Entities, DTOs, POJOs, Records, and Immutability
Part 011 — Aggregation Pipeline I: Mental Model and Core Stages
Part 012 — Aggregation Pipeline II: Advanced Transformations, Joins, Windows, and Reports
Part 013 — Transactions, Atomicity, Consistency, and Retryable Writes
Part 014 — Concurrency Control and State Machines in MongoDB
Part 015 — Java Driver Mastery I: Connection, Client Lifecycle, CRUD, Codecs
Part 016 — Java Driver Mastery II: Transactions, Sessions, Change Streams, Monitoring
Part 017 — Spring Data MongoDB: Power, Abstractions, and Leaky Boundaries
Part 018 — Performance Engineering I: Query, Index, Memory, Working Set
Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure
Part 020 — Replication, High Availability, Read Scaling, and Failure Modes
Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking
Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries
Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets
Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka
Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections
Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search
Part 027 — Schema Evolution, Migration, Backfill, and Zero-Downtime Changes
```

Seri belum selesai. Masih lanjut ke Part 028 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-028.md">Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing ➡️</a>
</div>

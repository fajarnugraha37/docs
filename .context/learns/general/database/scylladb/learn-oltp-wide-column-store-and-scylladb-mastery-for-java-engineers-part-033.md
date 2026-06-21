# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-033.md

# Part 033 — Migration and Interoperability: Cassandra/PostgreSQL/MongoDB Migration, Dual-Write, CDC, Data Validation, Cutover, Rollback, Compatibility, dan Ecosystem Integration

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `033`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: migrasi dan interoperabilitas ScyllaDB dengan sistem lain: migration from Cassandra/PostgreSQL/MongoDB, query-shape redesign, dual-write, CDC/event streaming, snapshot + change replay, validation, cutover, rollback, data type compatibility, Java service migration, and ecosystem integration.

---

## 0. Posisi Part Ini dalam Seri

Part 032 membahas security and compliance.

Part ini membahas migrasi.

Migrasi database bukan hanya:

```text
export old data
import new data
change connection string
```

Untuk ScyllaDB, migrasi sering berarti:

```text
mengubah mental model data
mengubah query pattern
mengubah transaction boundary
mengubah consistency semantics
mengubah failure handling
mengubah observability
mengubah operational runbook
```

Jika kamu migrasi dari PostgreSQL/MongoDB/Cassandra ke ScyllaDB, pertanyaan utama bukan:

```text
Bagaimana cara copy data?
```

Pertanyaan utama:

```text
Apakah workload cocok untuk ScyllaDB?
Bagaimana access pattern dipetakan ke primary key?
Apa source of truth selama migrasi?
Bagaimana live changes tidak hilang?
Bagaimana hasil divalidasi?
Bagaimana rollback dilakukan?
Apa yang terjadi saat timeout?
```

---

## 1. Migration First Principles

Migration harus menjawab:

```text
1. Why migrate?
2. What workload moves?
3. What stays?
4. What is source of truth during migration?
5. How are writes handled during migration?
6. How is historical data moved?
7. How are live changes captured?
8. How is correctness validated?
9. How is read cutover done?
10. How is rollback done?
11. How are security/compliance preserved?
12. How is performance verified?
```

Tanpa jawaban ini, migrasi adalah gambling.

---

## 2. Reasons to Migrate to ScyllaDB

Valid reasons:

- higher write throughput,
- predictable low-latency key-value/wide-row access,
- horizontal scale,
- multi-tenant high-volume OLTP,
- time-series/event/log workloads,
- Cassandra-compatible ecosystem with better performance characteristics,
- reduced operational pain for specific Cassandra workloads,
- query-first denormalized serving layer.

Weak reasons:

- “NoSQL is faster”,
- “we want to replace all SQL”,
- “joins are slow, so remove relational model”,
- “we need analytics on OLTP cluster”,
- “we want flexible arbitrary query.”

ScyllaDB is excellent for designed access patterns, not arbitrary ad-hoc querying.

---

## 3. Migration Suitability Assessment

Before migration, classify each workload.

Good fit:

```text
point lookup by key
bounded partition range
append event/time-series
precomputed query view
high write volume
multi-tenant scoped reads
large scale derived serving table
```

Poor fit:

```text
ad-hoc query
complex joins
multi-row transactions
arbitrary filtering/sorting
OLAP aggregates
strong global uniqueness everywhere
small data with rich relational constraints
```

Some systems should become hybrid:

```text
PostgreSQL for relational source
ScyllaDB for high-scale serving views/events
ClickHouse/warehouse for analytics
Search engine for text/custom search
```

---

## 4. Migration Is Data Model Redesign

From PostgreSQL:

```sql
SELECT *
FROM cases c
JOIN parties p ON p.case_id = c.id
WHERE c.tenant_id = ?
  AND c.status = ?
ORDER BY c.updated_at DESC
LIMIT 50;
```

To ScyllaDB, design table:

```sql
CREATE TABLE cases_by_tenant_status_day_bucket (
    tenant_id uuid,
    status text,
    bucket_day date,
    bucket_id int,
    updated_at timestamp,
    case_id uuid,
    title text,
    source_version bigint,
    PRIMARY KEY ((tenant_id, status, bucket_day, bucket_id), updated_at, case_id)
) WITH CLUSTERING ORDER BY (updated_at DESC, case_id ASC);
```

Migration includes:

- denormalization,
- source_version,
- bucket strategy,
- query API changes,
- validation.

---

## 5. Migration Strategies Overview

Common strategies:

1. big bang offline migration,
2. snapshot load + maintenance window,
3. dual-write + backfill + cutover,
4. CDC/change stream + backfill + replay,
5. shadow read + progressive cutover,
6. event-sourced rebuild,
7. cache/serving-layer introduction,
8. table-by-table strangler migration.

For production critical systems, prefer incremental strategies.

---

## 6. Big Bang Migration

Process:

```text
stop writes
export source
transform
import ScyllaDB
validate
switch app
resume writes
```

Pros:

- simpler correctness,
- no dual-write race,
- clean cutover.

Cons:

- downtime,
- high risk,
- large rollback,
- hard for big data,
- all-or-nothing.

Suitable for:

- small datasets,
- internal tools,
- maintenance window acceptable,
- non-critical systems.

---

## 7. Dual-Write Migration

Process:

```text
1. create ScyllaDB target schema
2. app writes old DB + ScyllaDB
3. backfill old historical data to ScyllaDB
4. validate/shadow read
5. switch reads gradually
6. keep old DB writes for rollback
7. stop old DB later
```

Pros:

- low downtime,
- progressive validation,
- rollback possible.

Cons:

- partial failure complexity,
- dual-write consistency,
- live race,
- more code,
- operational overhead.

Most common for critical online migration.

---

## 8. CDC Migration

CDC/change stream captures live changes from source.

Process:

```text
1. start CDC from source at offset T
2. snapshot/backfill historical data
3. apply CDC changes after T
4. validate target catches up
5. switch reads/writes
```

Pros:

- avoids app dual-write for some changes,
- lower application coupling,
- good for database-to-database migration.

Cons:

- CDC semantics complex,
- ordering/duplicates,
- schema changes,
- offset management,
- delete handling,
- source-specific limitations.

---

## 9. Event-Sourced Migration

If source has event log:

```text
replay events into ScyllaDB projections
```

Pros:

- deterministic rebuild,
- audit-friendly,
- handles historical transitions,
- supports derived table rebuild.

Cons:

- requires complete event log,
- event schema evolution,
- replay performance,
- projection correctness.

Very strong pattern for regulatory systems.

---

## 10. Strangler Pattern

Move one access pattern at a time.

Example:

```text
phase 1: notifications feed to ScyllaDB
phase 2: assignee queue to ScyllaDB
phase 3: event history to ScyllaDB
phase 4: current case state remains PostgreSQL or moves later
```

This reduces risk.

Do not migrate entire monolith database because one endpoint is slow.

---

## 11. Source of Truth During Migration

Decide explicitly.

Options:

```text
old DB remains source
ScyllaDB becomes source
event stream is source
both temporarily? dangerous
```

During transition, avoid two independent sources.

If old DB source:

```text
ScyllaDB is derived serving table
```

If ScyllaDB source:

```text
old DB may become fallback/legacy copy
```

Authority matrix must be updated.

---

## 12. Migration from Cassandra

Cassandra to ScyllaDB is conceptually closest.

Similarities:

- CQL,
- partition/clustering keys,
- tunable consistency,
- LSM storage,
- denormalization model.

But still verify:

- CQL feature compatibility,
- driver compatibility,
- compaction/table options,
- indexes/MV behavior,
- TTL/tombstone patterns,
- UDT/collections,
- counters,
- LWT behavior/performance,
- topology/token/tablets differences,
- operational tooling.

Do not assume zero-risk drop-in.

---

## 13. Cassandra Migration Assessment

Questions:

```text
Which tables are huge?
Which partitions are large/hot?
Which queries use ALLOW FILTERING?
Which tables use counters?
Which use LWT?
Which use secondary indexes/MVs?
What compaction strategies?
What tombstone warnings?
What repair schedule?
Which driver version?
What consistency levels?
What multi-DC topology?
```

Migration is opportunity to fix bad Cassandra data models, not just copy them.

---

## 14. Cassandra Data Copy

Possible approaches:

- snapshot/SSTable-based migration if compatible and supported,
- ScyllaDB/Cassandra loaders,
- application-level export/import,
- Spark/ETL,
- dual-write and backfill,
- CDC if available.

Choose based on:

- downtime tolerance,
- data volume,
- schema compatibility,
- transformation needs,
- validation requirements.

If schema must change, application-level transform/backfill is often clearer.

---

## 15. Cassandra Driver Migration

Java app may use Cassandra driver.

ScyllaDB supports compatible CQL protocol but performance benefits may require Scylla-aware/shard-aware driver configuration.

Review:

- local datacenter,
- load balancing,
- prepared statements,
- token awareness,
- shard awareness,
- execution profiles,
- retry policy,
- speculative execution,
- metrics.

Test p99, not only functional correctness.

---

## 16. Migration from PostgreSQL

PostgreSQL has:

- joins,
- transactions,
- secondary indexes,
- foreign keys,
- constraints,
- ad-hoc queries,
- SQL aggregations.

ScyllaDB has:

- query-specific tables,
- denormalization,
- limited transaction scope,
- primary-key-driven queries,
- application-maintained invariants.

Migration from PostgreSQL is usually redesign.

---

## 17. PostgreSQL Workload Decomposition

Classify SQL workload:

```text
OLTP command source
read model/serving query
reporting/analytics
search
admin ad-hoc
foreign-key integrity
unique constraints
```

Do not migrate all to ScyllaDB.

Example hybrid:

```text
PostgreSQL: billing/account relational truth
ScyllaDB: high-volume case events and queues
Search: text/custom field search
ClickHouse/warehouse: reports
```

---

## 18. Foreign Keys and Constraints

PostgreSQL enforces constraints.

ScyllaDB generally does not enforce:

- foreign keys,
- joins,
- check constraints,
- rich uniqueness,
- multi-row transaction.

Application must implement:

- existence validation,
- idempotency,
- unique reservation with LWT,
- reconciliation,
- invariant validators.

If many invariants depend on relational constraints, migration cost is high.

---

## 19. PostgreSQL Transaction Boundary

SQL transaction:

```text
BEGIN;
UPDATE cases;
INSERT audit_event;
UPDATE queue;
COMMIT;
```

In ScyllaDB:

```text
not one general transaction
```

Need pattern:

- event sourcing,
- source/current + derived async,
- LWT for current,
- outbox/event log,
- reconciliation.

Migration must redesign consistency semantics.

---

## 20. PostgreSQL Snapshot + CDC

Common migration:

```text
1. take consistent snapshot/export
2. start logical replication/CDC from LSN
3. import snapshot to ScyllaDB
4. apply CDC changes
5. validate
6. cutover
```

Need handle:

- inserts,
- updates,
- deletes,
- transaction ordering,
- schema changes,
- backfill transformation,
- idempotent apply.

---

## 21. PostgreSQL Type Mapping

Map carefully:

| PostgreSQL | ScyllaDB/CQL Consideration |
|---|---|
| UUID | uuid |
| bigint | bigint |
| numeric/decimal | decimal or scaled integer |
| timestamp/timestamptz | timestamp, timezone discipline |
| jsonb | text/blob/UDT/table redesign |
| array | list/set or child table |
| enum | text with compatibility |
| bytea | blob or object storage |
| serial/bigserial | avoid global sequence; use UUID/ULID/snowflake |
| foreign key | application validation/invariant |

Do not blindly map JSONB to text if fields need query.

---

## 22. Sequence/Auto-Increment Migration

PostgreSQL sequences do not map naturally.

Options:

- UUID,
- time-sortable ID,
- region/tenant-scoped sequence service,
- application-generated monotonic ID per entity,
- event_version per aggregate via LWT/single-writer.

Avoid global counter table for high volume.

---

## 23. Migration from MongoDB

MongoDB has:

- document model,
- flexible schema,
- secondary indexes,
- embedded arrays,
- rich query filters,
- aggregation pipeline.

ScyllaDB requires:

- explicit access patterns,
- bounded partitions,
- CQL schema,
- denormalized query tables.

Migration from MongoDB is also redesign.

---

## 24. MongoDB Document Decomposition

MongoDB document:

```json
{
  "_id": "...",
  "tenantId": "...",
  "status": "OPEN",
  "parties": [...],
  "comments": [...],
  "customFields": {...}
}
```

ScyllaDB may split:

```text
case_current_by_id
case_parties_by_case
case_comments_by_case_day
case_custom_field_by_case
open_cases_by_assignee
search index for custom fields
```

Large embedded arrays should become child tables.

---

## 25. MongoDB Flexible Schema

MongoDB may contain heterogeneous documents.

Migration needs:

- schema discovery,
- version detection,
- default values,
- invalid document DLQ,
- old/new payload decoders,
- validation.

Do not assume all documents match current model.

---

## 26. MongoDB Query Migration

If MongoDB query:

```javascript
db.cases.find({
  tenantId,
  status,
  "customFields.priority": "HIGH",
  updatedAt: {$gte: ...}
}).sort({updatedAt: -1})
```

ScyllaDB may not be right target for arbitrary custom field filter.

Options:

- explicit table for fixed access pattern,
- search engine,
- OLAP/reporting system,
- product constraint.

---

## 27. Data Type and Semantic Compatibility

Migration can change semantics:

- null vs missing,
- timezone,
- numeric precision,
- string collation,
- case sensitivity,
- enum values,
- array/list ordering,
- duplicate array values,
- JSON field absence,
- timestamp precision,
- UUID format.

Define transformation rules.

---

## 28. Null vs Missing

PostgreSQL NULL, Mongo missing field, and ScyllaDB null/unset have different semantics.

Migration must decide:

```text
missing -> null?
missing -> default?
missing -> absent column?
missing -> invalid?
```

Java DTO must handle old data.

---

## 29. Timestamp Semantics

Decide:

- UTC storage,
- timezone conversion,
- event_time vs created_at vs updated_at,
- precision loss,
- sorting keys,
- late events.

Do not mix local timezone timestamps into clustering keys without normalization.

---

## 30. Decimal/Money

PostgreSQL `numeric` may have arbitrary precision.

ScyllaDB `decimal` or scaled long.

For money:

```text
store minor units as bigint
currency code separately
```

Avoid floating point.

---

## 31. Migration Pipeline Architecture

Pipeline:

```text
source reader
  -> transformer
  -> validator
  -> target writer
  -> checkpoint
  -> DLQ
  -> metrics
```

Exactly like part 022 but with source-specific adapters.

Need:

- idempotent target writes,
- source_version/updated_at,
- deterministic keys,
- bounded concurrency,
- throttle,
- resume,
- validation.

---

## 32. Migration Checkpoint

Checkpoint can be:

- PostgreSQL primary key cursor,
- LSN/CDC offset,
- Mongo resume token,
- Cassandra token range,
- file offset,
- Kafka offset,
- tenant/day/bucket.

Checkpoint after target write success.

Never checkpoint before durable target apply.

---

## 33. Migration DLQ

DLQ records:

```text
source system
source key
source version/offset
error code
payload sample/redacted
transformation version
timestamp
```

DLQ may contain PII; secure it.

DLQ enables repair/replay.

---

## 34. Validation Strategy

Validation levels:

1. row counts,
2. partition/bucket counts,
3. checksums,
4. random sample,
5. business invariant validation,
6. shadow reads,
7. dual-read comparison,
8. tenant-level validation,
9. performance validation.

Do not rely only on total row count.

---

## 35. Count Validation

Example:

```text
PostgreSQL count cases by tenant/status/day
ScyllaDB count target rows by tenant/status/day
```

Be careful:

- derived table may intentionally exclude CLOSED,
- duplicated rows due buckets,
- TTL differences,
- deletes.

Count needs same semantics.

---

## 36. Checksum Validation

Compute deterministic checksum per shard:

```text
tenant_id + bucket_day + bucket_id
```

Over normalized fields.

Benefits:

- catches value mismatch,
- scalable by shard.

Need same canonical serialization on source and target.

---

## 37. Shadow Read

During migration:

```text
serve old system result
also read new ScyllaDB result
compare asynchronously
record mismatch
```

Compare:

- IDs,
- ordering,
- pagination,
- counts,
- selected fields,
- staleness/source_version.

Shadow read before cutover is critical.

---

## 38. Dual-Read Fallback

After cutover:

```text
read ScyllaDB
if missing/stale, fallback old DB
record metric
```

Useful for safe rollout.

But fallback can hide issues.

Set threshold and timeline to remove fallback.

---

## 39. Cutover Strategy

Options:

- endpoint-by-endpoint,
- tenant-by-tenant,
- percentage rollout,
- region-by-region,
- internal users first,
- read-only cutover first,
- write cutover later.

For multi-tenant SaaS:

```text
tenant-by-tenant cutover is powerful
```

Mega tenants need separate plan.

---

## 40. Rollback Strategy

Rollback must be possible before cutover.

If reads switch to ScyllaDB but old DB still receives writes:

```text
rollback reads to old DB easy
```

If writes switch to ScyllaDB only:

```text
old DB becomes stale
rollback needs reverse sync
```

Decide rollback window.

Do not stop old writes before confidence.

---

## 41. Reverse Sync

If ScyllaDB becomes source but rollback to old DB might be needed:

```text
write ScyllaDB changes back to old DB
```

This is reverse dual-write/CDC.

Complex.

Avoid if possible by keeping old as source until cutover confidence.

---

## 42. Write Cutover

Read cutover and write cutover are separate.

Safe order often:

```text
1. old DB source
2. ScyllaDB derived/shadow read
3. read cutover to ScyllaDB for selected access pattern
4. keep writes source old + projection
5. later if desired, move source writes
```

Do not move writes first unless necessary.

---

## 43. API Compatibility

Migration may change:

- pagination cursor,
- ordering,
- consistency/freshness,
- error semantics,
- max page size,
- filtering support,
- response fields.

Preserve API contract or version it.

Do not leak database migration to clients unexpectedly.

---

## 44. Cursor Migration

Old cursor from PostgreSQL:

```json
{"offset": 100}
```

New cursor for ScyllaDB:

```json
{
  "v": 2,
  "bucketDay": "2026-06-21",
  "bucketId": 3,
  "lastUpdatedAt": "...",
  "lastCaseId": "..."
}
```

During transition:

- accept old cursor until expiry,
- return new cursor,
- sign cursor,
- include tenant/context,
- document compatibility.

---

## 45. Ordering Differences

PostgreSQL sort may be stable by:

```text
ORDER BY updated_at DESC, id ASC
```

ScyllaDB clustering order must match.

If not, pagination mismatch.

Always include tie-breaker:

```text
updated_at, case_id
```

Define ordering exactly.

---

## 46. Consistency Semantics Difference

PostgreSQL read after transaction commit is strong within primary.

ScyllaDB derived table may be eventually consistent.

Migration must define:

```text
does endpoint read source/current or derived?
does user expect read-your-write?
is stale acceptable?
```

Use version token/fallback if needed.

---

## 47. Transaction Semantics Difference

SQL transaction may update many tables atomically.

ScyllaDB migration may split:

- source update,
- event insert,
- derived update,
- outbox publish.

Need correctness patterns from part 031.

---

## 48. Search/Analytics Interoperability

Do not force ScyllaDB to replace search/OLAP.

Use:

- search engine for text/custom filtering,
- ClickHouse/warehouse for analytics,
- ScyllaDB for OLTP serving/source/events,
- Kafka/CDC for propagation.

Interoperability architecture often beats single database ideology.

---

## 49. Kafka/Event Integration

Use Kafka/stream for:

- change propagation,
- projection rebuild,
- outbox,
- search indexing,
- analytics ingestion,
- CDC transport.

Correctness needs:

- idempotent consumers,
- checkpoint after write,
- DLQ,
- ordering per key,
- replay plan.

---

## 50. Object Storage Integration

Large blobs/documents should usually live in object storage.

ScyllaDB stores:

```text
object_key
hash
size
content_type
version
created_at
```

Migration must copy/validate object storage too.

Do not migrate DB rows without object references.

---

## 51. Compatibility Testing

Test:

- source-to-target transform,
- old app + new data,
- new app + old data,
- cursor compatibility,
- enum compatibility,
- payload schema versions,
- timezone/numeric precision,
- delete handling,
- duplicate handling,
- rollback.

---

## 52. Performance Testing

Functional migration can still fail performance.

Test:

- p50/p95/p99,
- peak QPS,
- hot tenant,
- fanout,
- backfill impact,
- compaction after load,
- read after compaction,
- repair/backup impact,
- Java heap/GC.

Target schema may pass correctness but fail p99.

---

## 53. Migration Observability

Dashboard:

```text
backfill progress
CDC lag
dual-write success/failure
shadow mismatch
fallback rate
DLQ count
target p99
source p99
cutover cohort
tenant progress
validation status
```

Alerts:

```text
CDC lag too high
dual-write failure
mismatch above threshold
DLQ spike
fallback spike
target p99 regression
```

---

## 54. Security During Migration

Migration tools often see all data.

Controls:

- least privilege credentials,
- tenant scope,
- PII-safe logs,
- encrypted staging files,
- secure DLQ,
- audit runs,
- cleanup temp data,
- backup before destructive steps.

Migration is high-risk security event.

---

## 55. Compliance During Migration

Ensure:

- data residency preserved,
- privacy deletions included,
- legal holds respected,
- backup retention aligned,
- audit evidence,
- customer export/import controls,
- search/OLAP deletion propagation.

Do not migrate deleted data back into live system.

---

## 56. Decommission Old System

After cutover confidence:

```text
1. stop old reads
2. keep old writes during rollback window if needed
3. stop old writes
4. archive old data
5. revoke credentials
6. remove CDC/dual-write
7. remove code paths
8. update docs/runbooks
9. delete old data per policy
```

Leaving old systems alive creates security/cost/confusion risk.

---

## 57. Common Anti-Patterns

### 57.1 Lift-and-Shift SQL Schema

ScyllaDB needs query-first design.

### 57.2 No Source of Truth During Migration

Dual-master confusion.

### 57.3 No CDC/Dual-Write for Live Changes

Backfill misses updates.

### 57.4 Cutover Without Shadow Read

Blind migration.

### 57.5 Total Row Count Only Validation

Misses semantic mismatch.

### 57.6 No Rollback Window

Cutover becomes irreversible too early.

### 57.7 Stop Old Writes Too Soon

Rollback impossible.

### 57.8 Ignore Deletes

Stale/deleted data reappears.

### 57.9 Treat Search/OLAP as ScyllaDB Workload

Wrong tool.

### 57.10 Migration Logs Contain PII

Security incident.

---

## 58. Migration Checklist

```text
[ ] Migration goal clear.
[ ] Workload suitability assessed.
[ ] Source of truth defined.
[ ] Target access patterns documented.
[ ] Target table schemas reviewed.
[ ] Data type mapping defined.
[ ] ID strategy defined.
[ ] Historical backfill designed.
[ ] Live change capture designed.
[ ] Idempotency and checkpointing implemented.
[ ] DLQ secured.
[ ] Validation plan includes checksums/shadow reads.
[ ] Cutover plan staged.
[ ] Rollback plan possible.
[ ] API/cursor compatibility handled.
[ ] Performance load test done.
[ ] Observability dashboard ready.
[ ] Security/compliance reviewed.
[ ] Old system decommission plan exists.
```

---

## 59. Mental Model Compression

Remember:

```text
Migration is not copying rows.
Migration is changing the source/serving/correctness contract.
```

And:

```text
Backfill moves history.
CDC/dual-write moves live changes.
Validation proves equivalence.
Cutover changes authority.
Rollback preserves safety.
```

---

## 60. Summary

Migration to ScyllaDB is successful when access patterns, correctness, operations, and rollback are all designed.

Key lessons:

1. Assess workload fit before migrating.
2. ScyllaDB migration often requires data model redesign.
3. Cassandra migration is closest but still needs compatibility/performance validation.
4. PostgreSQL migration requires replacing joins/transactions/constraints with explicit patterns.
5. MongoDB migration requires document decomposition and schema discovery.
6. Big bang migration is simple but risky.
7. Dual-write/backfill/cutover is common for online systems.
8. CDC helps capture live changes but needs offset/order/delete handling.
9. Source of truth during migration must be explicit.
10. Validation must include counts, checksums, semantic checks, and shadow reads.
11. Read cutover and write cutover are separate.
12. Rollback requires old system to remain fresh enough.
13. API/cursor/ordering semantics may change.
14. Search/OLAP/object storage are part of interoperability architecture.
15. Migration observability and security are mandatory.
16. Old system must eventually be decommissioned.

---

## 61. Review Questions

1. Mengapa migrasi bukan sekadar copy data?
2. Apa workload yang cocok untuk ScyllaDB?
3. Apa workload yang buruk untuk ScyllaDB?
4. Apa strategi migrasi utama?
5. Kapan big bang migration masuk akal?
6. Apa risiko dual-write?
7. Bagaimana CDC migration bekerja?
8. Mengapa source of truth harus jelas?
9. Apa yang perlu dicek saat migrasi dari Cassandra?
10. Mengapa PostgreSQL migration biasanya redesign?
11. Bagaimana foreign key/constraint diganti?
12. Bagaimana MongoDB document dipecah?
13. Apa isu null vs missing?
14. Bagaimana checkpoint migration bekerja?
15. Apa saja validation level?
16. Mengapa shadow read penting?
17. Apa beda read cutover dan write cutover?
18. Bagaimana cursor migration dilakukan?
19. Apa observability migration yang penting?
20. Apa migration checklist?

---

## 62. Practical Exercise

Desain migration dari PostgreSQL ke ScyllaDB untuk endpoint:

```text
GET /tenants/{tenantId}/cases?status=OPEN&assigneeId=...&sort=dueAt
```

Current PostgreSQL:

```text
cases
case_assignees
case_parties
case_events
```

Requirement:

```text
- zero downtime
- tenant-by-tenant cutover
- old cursor accepted for 24 hours
- live writes continue
- rollback possible for 7 days
- privacy deletions must not reappear
```

Tulis:

```text
1. workload suitability
2. target ScyllaDB schema
3. source of truth during migration
4. backfill pipeline
5. CDC/dual-write plan
6. source_version strategy
7. validation plan
8. shadow read comparison
9. cursor v2 design
10. cutover plan
11. rollback plan
12. deletion replay
13. performance test
14. observability dashboard
15. decommission plan
```

---

## 63. Preview Part 034

Part berikutnya adalah capstone:

```text
Capstone:
end-to-end design of a ScyllaDB-backed regulatory case platform,
from requirements to data model, Java services, correctness, operations,
observability, security, migration, and production readiness review.
```

Part 033 membahas migrasi dan interoperabilitas.

Part 034 akan menjadi bagian terakhir seri ini: capstone end-to-end.

---

# End of Part 033


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Security and Compliance: Authentication, Authorization, TLS, Secrets, Encryption, Tenant Isolation, PII, Audit Logs, Privacy Deletion, Backup Security, dan Compliance-Oriented Data Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-034.md">Part 034 — Capstone: End-to-End Design of a ScyllaDB-Backed Regulatory Case Platform ➡️</a>
</div>

# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-031.md

# Part 031 — Anti-Patterns and Failure Case Catalogue

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 031 dari 035  
> Fokus: katalog anti-pattern, failure cases, warning signals, root causes, remediation, dan design review heuristics untuk MongoDB-backed Java systems  
> Target pembaca: Java software engineer / tech lead yang ingin mengenali pola kegagalan MongoDB sebelum menjadi incident production

---

## 0. Posisi Part Ini Dalam Seri

Part 000 sampai Part 030 sudah membahas konsep, modelling, query, index, aggregation, transactions, Java driver, Spring Data, performance, replication, sharding, tenancy, security, change streams, time series, search, migration, testing, observability, and DR.

Part 031 adalah katalog anti-pattern dan failure case.

Tujuannya bukan menakut-nakuti. Tujuannya membuat kamu bisa mengenali bau desain sejak awal.

Banyak incident MongoDB bukan disebabkan oleh “MongoDB jelek”, tetapi oleh mismatch antara:

```text
data model
access pattern
index
write path
tenancy
consistency requirement
operational process
```

Kalimat inti:

> Anti-pattern adalah desain yang terlihat produktif di awal tetapi menyembunyikan biaya yang baru muncul saat data, traffic, tenant, atau compliance pressure membesar.

---

## 1. Cara Membaca Katalog Ini

Setiap anti-pattern akan dibahas dengan format:

```text
Symptom:
  apa yang terlihat

Root cause:
  kenapa terjadi

Why it hurts:
  dampak production

Early warning:
  sinyal sebelum incident

Remediation:
  cara memperbaiki

Prevention:
  cara mencegah sejak desain
```

Tidak semua anti-pattern fatal dalam semua konteks. Kadang anti-pattern kecil masih acceptable pada sistem kecil.

Yang penting adalah:

```text
make trade-off explicit
```

Bukan:

```text
kebetulan jalan
```

---

## 2. Anti-Pattern: Treating MongoDB As SQL With JSON Columns

### Symptom

Desain collection seperti tabel relational, lalu document hanya menjadi row JSON.

```text
cases
case_status
case_parties
case_notes
case_documents
case_addresses
case_tags
```

Setiap screen membutuhkan banyak query/join manual.

### Root Cause

Engineer membawa SQL mental model penuh tanpa memikirkan aggregate boundary dan read locality.

### Why It Hurts

- banyak round trip,
- `$lookup` berlebihan,
- consistency tersebar,
- query lambat,
- transaction meningkat,
- document database advantage hilang.

### Early Warning

```text
setiap API detail screen butuh 10+ query
repository layer mirip ORM relational
banyak collection kecil untuk owned child data
tidak ada aggregate boundary
```

### Remediation

- identifikasi aggregate root,
- embed bounded owned child data,
- denormalize read summary,
- gunakan projection collection untuk query,
- hanya reference data yang benar-benar independent/unbounded.

### Prevention

Selalu mulai dengan pertanyaan:

```text
Data apa yang dibaca/ditulis bersama?
Apa yang lifecycle-nya sama?
Apa yang bounded?
Apa yang independent?
```

---

## 3. Anti-Pattern: One Giant Document

### Symptom

Satu document menyimpan semuanya:

```javascript
{
  caseId,
  parties: [...],
  notes: [...],
  auditTrail: [...],
  documents: [...],
  messages: [...],
  workflowHistory: [...]
}
```

### Root Cause

Over-correction dari relational thinking: semua di-embed tanpa batas.

### Why It Hurts

- document tumbuh tanpa batas,
- p99 read/write memburuk,
- array update mahal,
- contention tinggi,
- 16MB document limit risk,
- audit/history sulit query,
- partial load sulit,
- concurrent writers tabrakan.

### Early Warning

```text
array length terus naik
document p99 size naik
update note lambat
case detail load semua data
auditTrail array ribuan item
```

### Remediation

- pisahkan unbounded child collections,
- simpan preview/latest N di parent,
- gunakan pagination untuk notes/audit/documents,
- audit sebagai append-only collection,
- monitor document size.

### Prevention

Embed hanya jika:

```text
owned by parent
read together
bounded
updated together
not independently queried
```

---

## 4. Anti-Pattern: Unbounded Arrays

### Symptom

Array terus bertambah:

```javascript
events: []
comments: []
loginHistory: []
statusHistory: []
```

### Root Cause

Engineer nyaman dengan `$push` dan lupa upper bound.

### Why It Hurts

- document growth,
- hot document,
- large read amplification,
- array update contention,
- index multikey explosion,
- hard pagination.

### Early Warning

```text
$push used on high-volume field
no max size
no archive policy
array length not monitored
```

### Remediation

- move to child collection,
- bucket if appropriate,
- keep summary count/latest preview,
- create pagination endpoint.

### Prevention

Every array must have answer:

```text
maximum size?
growth rate?
query pattern?
archive/retention?
```

If no maximum, do not embed as normal array.

---

## 5. Anti-Pattern: Missing Tenant Filter

### Symptom

Query:

```javascript
db.cases.find({ caseId: "C-001" })
```

instead of:

```javascript
db.cases.find({ tenantId: "t1", caseId: "C-001" })
```

### Root Cause

Tenant treated as optional context, not invariant.

### Why It Hurts

- cross-tenant data leak,
- wrong record returned when IDs overlap,
- poor index targeting,
- sharding scatter,
- compliance incident.

### Early Warning

```text
repository method findById(id)
tenantId optional
unit tests only one tenant
global indexes without tenantId
```

### Remediation

- require `TenantId` in repository API,
- add tenant-scoped indexes,
- add tests with overlapping IDs,
- scan codebase for tenantless queries,
- centralize tenant-scoped query builder.

### Prevention

Rule:

```text
Every tenant-owned document query includes tenantId.
```

No exception without explicit admin/global path.

---

## 6. Anti-Pattern: Post-Filter Authorization

### Symptom

Application queries broad dataset, then filters unauthorized records in Java.

```java
List<Case> all = repository.search(query);
return all.stream().filter(authz::canSee).toList();
```

### Root Cause

Authorization implemented after data retrieval.

### Why It Hurts

- data leak risk in logs/memory/debug,
- search facets/counts leak,
- pagination broken,
- unauthorized docs affect relevance,
- unnecessary database load.

### Early Warning

```text
authorization in service after repository
search returns fewer than requested page size
facets/counts include restricted docs
```

### Remediation

- push authorization predicates into query/search,
- include permission snapshot in search projection,
- use role/team/sensitivity fields in indexes,
- test unauthorized close matches.

### Prevention

Authorization filter is part of query contract.

---

## 7. Anti-Pattern: Index Everything

### Symptom

Collection has dozens of indexes “just in case”.

### Root Cause

Index treated as free read optimization.

### Why It Hurts

- write amplification,
- memory pressure,
- disk usage,
- slower inserts/updates/deletes,
- index build risk,
- hard operational ownership.

### Early Warning

```text
indexes without owner/use case
old feature indexes still present
write latency grows after each feature
index size comparable/exceeds data size
```

### Remediation

- create index inventory,
- map indexes to query inventory,
- identify unused/overlapping indexes,
- drop safely after test/window,
- monitor write latency.

### Prevention

Every index needs:

```text
query owner
SLO
field order rationale
drop criteria
```

---

## 8. Anti-Pattern: No Index For Hot Query

### Symptom

API works in dev but slow in production.

Query:

```javascript
db.cases.find({ tenantId, status, assigneeId }).sort({ dueAt: 1 })
```

No compound index.

### Root Cause

Tiny test data hides query shape cost.

### Why It Hurts

- collection scans,
- high CPU,
- p99 latency,
- pool exhaustion,
- noisy neighbor.

### Early Warning

```text
slow query logs show COLLSCAN
docsExamined >> docsReturned
sort stage in memory
no explain review
```

### Remediation

- create compound index matching filter/sort,
- cap result size,
- add query inventory,
- add explain/performance regression test.

### Prevention

For every hot query, define index before production.

---

## 9. Anti-Pattern: Wrong Compound Index Order

### Symptom

Index exists but query still slow.

Index:

```javascript
{ dueAt: 1, status: 1, tenantId: 1 }
```

Query:

```javascript
{ tenantId, status, assigneeId }
sort dueAt
```

### Root Cause

Index field order not aligned with equality/range/sort/query pattern.

### Why It Hurts

- index underused,
- scan many keys,
- sort not supported,
- false confidence because “index exists”.

### Early Warning

```text
keysExamined high
winning plan not expected
filter fields not prefix-aligned
```

### Remediation

Design index from query shape:

```javascript
{ tenantId: 1, status: 1, assigneeId: 1, dueAt: 1, _id: 1 }
```

### Prevention

Index design requires explain and query inventory.

---

## 10. Anti-Pattern: Regex Search On Large Collection

### Symptom

```javascript
db.cases.find({ title: /fraud/i })
```

on millions of docs.

### Root Cause

Quick implementation of search without search index.

### Why It Hurts

- scans,
- CPU spikes,
- no relevance,
- no language handling,
- possible ReDoS-like abuse,
- tenant-wide expensive queries.

### Early Warning

```text
user-controlled regex
no max length
no tenant/time guardrail
search endpoint slow
```

### Remediation

- use Atlas Search / text index / search projection,
- restrict regex,
- use prefix search only if index-supported,
- rate limit,
- add async export for broad searches.

### Prevention

Classify search requirements before implementation.

---

## 11. Anti-Pattern: Search Without Authorization

### Symptom

Search index contains all records, query filters only text.

### Root Cause

Search projection built for relevance, not access control.

### Why It Hurts

- restricted data appears,
- autocomplete leaks names,
- facets leak counts,
- snippets leak confidential text.

### Early Warning

```text
search projection lacks permission fields
facets computed before auth filter
autocomplete global per tenant
```

### Remediation

- include authorization snapshot,
- apply auth filter inside search,
- test unauthorized documents,
- rebuild projection.

### Prevention

Search is an access path and must enforce security before scoring/faceting.

---

## 12. Anti-Pattern: Full Document Replacement For Small Changes

### Symptom

Application loads document, mutates field, saves full document.

```java
doc.setStatus(CLOSED);
repository.save(doc);
```

### Root Cause

ORM mindset; repository abstraction hides replacement semantics.

### Why It Hurts

- lost updates,
- fields removed if partial document,
- large write amplification,
- schema compatibility risk,
- overwrites concurrent changes.

### Early Warning

```text
save() used for state transition
partial projections saved
no version guard
```

### Remediation

Use targeted update operators:

```javascript
{ $set: { status: "CLOSED" }, $inc: { version: 1 } }
```

with guard:

```javascript
{ tenantId, caseId, status: "OPEN", version }
```

### Prevention

State transitions use guarded atomic updates, not blind save.

---

## 13. Anti-Pattern: No Optimistic Concurrency

### Symptom

Two users update same case; last write wins silently.

### Root Cause

No version field/state guard.

### Why It Hurts

- lost updates,
- invalid workflow,
- audit mismatch,
- user confusion.

### Early Warning

```text
updates filter only by _id
no version
no status guard
matchedCount ignored
```

### Remediation

- add `version`,
- use conditional updates,
- interpret matchedCount=0,
- return conflict/invalid state,
- add concurrency tests.

### Prevention

Every workflow aggregate needs concurrency model.

---

## 14. Anti-Pattern: Transactions Everywhere

### Symptom

Every write is wrapped in transaction, even single-document update.

### Root Cause

SQL habit or fear of inconsistency.

### Why It Hurts

- latency overhead,
- retry complexity,
- unknown commit result,
- resource retention,
- sharded transaction cost,
- unnecessary failure modes.

### Early Warning

```text
transaction template in every service method
single document update in transaction
external side effects inside transaction
```

### Remediation

- rely on single-document atomicity where enough,
- use transaction only for true multi-document invariant,
- move external effects to outbox.

### Prevention

Ask:

```text
What invariant requires transaction?
Can aggregate boundary avoid it?
```

---

## 15. Anti-Pattern: External Side Effects Inside Transaction

### Symptom

```text
start transaction
update DB
send email
commit
```

### Root Cause

Confusing DB atomicity with distributed side effect atomicity.

### Why It Hurts

- email sent but transaction aborts,
- transaction retries send duplicate email,
- external system inconsistent.

### Early Warning

```text
HTTP call, email, Kafka publish inside DB transaction callback
```

### Remediation

Use outbox:

```text
transaction:
  update DB
  insert outbox event

worker:
  sends external side effect idempotently
```

### Prevention

No non-idempotent external side effects inside DB transaction.

---

## 16. Anti-Pattern: Retry Without Idempotency

### Symptom

Timeout occurs, client retries, duplicate event/charge/update happens.

### Root Cause

Retry policy added without command identity.

### Why It Hurts

- duplicate audit/outbox,
- double notification,
- double decrement/increment,
- inconsistent state.

### Early Warning

```text
new UUID generated per retry
$inc retried blindly
$push event without eventId
```

### Remediation

- commandId/idempotency key,
- deterministic event IDs,
- unique idempotency record,
- duplicate key interpreted correctly.

### Prevention

Every retryable write must be idempotent.

---

## 17. Anti-Pattern: MongoDB As High-Throughput Queue

### Symptom

MongoDB collection used as main message broker for high-throughput fanout/work distribution.

### Root Cause

“Database already exists” convenience.

### Why It Hurts

- polling load,
- hot status indexes,
- claim contention,
- retry/dead-letter complexity,
- poor broker semantics,
- retention cleanup,
- scaling pain.

### Early Warning

```text
workers poll every 100ms
jobs collection huge
status PENDING index hot
queue latency grows
```

### Remediation

- use Kafka/RabbitMQ for messaging,
- keep MongoDB job collection for moderate domain work if needed,
- use lease/backoff/indexing,
- cap polling.

### Prevention

Use database for state; use broker for messaging when broker semantics matter.

---

## 18. Anti-Pattern: Hot Counter Document

### Symptom

All writes update:

```javascript
{ _id: "global-counter" }
```

### Root Cause

Need count/sequence implemented as single document.

### Why It Hurts

- write contention,
- throughput ceiling,
- p99 spikes,
- retry storms.

### Early Warning

```text
$inc same document high QPS
global sequential IDs
counter update dominates latency
```

### Remediation

- segmented counters,
- preallocated ranges,
- approximate counters,
- domain-friendly IDs,
- materialized rollups.

### Prevention

Do not require strict sequence unless business/legal truly requires it.

---

## 19. Anti-Pattern: Sharding To Fix Bad Query

### Symptom

Query slow on one replica set, team proposes sharding.

### Root Cause

Confusing horizontal scale with query optimization.

### Why It Hurts

- scatter-gather across shards,
- more operational complexity,
- bad query now runs everywhere.

### Early Warning

```text
no explain plan
no index review
no query inventory
shard key not in hot query
```

### Remediation

- fix query/index/data model first,
- shard only when data/load placement requires,
- design shard key from access patterns.

### Prevention

Sharding is data placement, not query plan magic.

---

## 20. Anti-Pattern: Bad Shard Key

### Symptom

Cluster sharded but one shard hot or queries scatter.

### Root Cause

Shard key chosen by convenience.

Examples:

```text
status
createdAt
tenantId only with huge tenant skew
field not used in queries
mutable field
```

### Why It Hurts

- hot shard,
- jumbo chunks,
- scatter-gather,
- transaction complexity,
- resharding pain.

### Early Warning

```text
low cardinality key
monotonic insert
largest tenant dominates
hot queries omit shard key
```

### Remediation

- evaluate shard key matrix,
- projections with different shard keys,
- zone/dedicated tenant placement,
- reshard if necessary.

### Prevention

Shard key review before production.

---

## 21. Anti-Pattern: Global Read Preference secondaryPreferred

### Symptom

Application globally reads from secondary to “scale reads”.

### Root Cause

Read scaling chosen without consistency analysis.

### Why It Hurts

- stale reads,
- read-your-write failures,
- authorization drift,
- confusing UI,
- workflow duplicate actions.

### Early Warning

```text
global MongoClient readPreference=secondaryPreferred
post-write UI stale
users repeat actions
```

### Remediation

- default primary,
- explicit secondary only for stale-tolerant queries,
- causal consistency where appropriate,
- label stale dashboards.

### Prevention

Read preference is per use case, not global performance knob.

---

## 22. Anti-Pattern: Majority Write Assumed To Mean Immediate Secondary Visibility

### Symptom

Write with majority then read from secondary; data missing.

### Root Cause

Misunderstanding read preference/read concern.

### Why It Hurts

- stale UX,
- wrong workflow decisions,
- duplicate commands.

### Early Warning

```text
majority writes + secondary reads for state-sensitive flow
```

### Remediation

- read from primary after write,
- use causally consistent sessions when appropriate,
- avoid secondary for state decisions.

### Prevention

Reason separately:

```text
write concern: acknowledgment
read preference: node selection
read concern: visibility
```

---

## 23. Anti-Pattern: No Backpressure

### Symptom

When DB slows, app keeps accepting work; retries explode.

### Root Cause

Unbounded concurrency and queues.

### Why It Hurts

- retry storm,
- pool exhaustion,
- outage amplification,
- DB collapse.

### Early Warning

```text
unbounded executor queue
no rate limit
background jobs ignore lag
retry count high
```

### Remediation

- bounded queues,
- semaphore/limiter,
- circuit breaker,
- tenant throttling,
- pause background jobs,
- retry budget.

### Prevention

Every write-heavy path needs backpressure strategy.

---

## 24. Anti-Pattern: Blind Bulk updateMany/deleteMany

### Symptom

Large production update/delete runs and causes lag/outage/data loss.

### Root Cause

No batch/checkpoint/dry-run.

### Why It Hurts

- replication lag,
- write load spike,
- wrong tenant affected,
- hard rollback,
- TTL/delete storm.

### Early Warning

```text
migration script has updateMany({})
no tenant filter
no dry run
no pause
```

### Remediation

- stop operation if possible,
- restore/repair if wrong,
- rebuild projections,
- add migration framework.

### Prevention

Bulk changes must be batch, tenant-scoped, idempotent, observable, and approved.

---

## 25. Anti-Pattern: No Migration Compatibility Window

### Symptom

Deploy new code that expects new field before old data migrated.

### Root Cause

Big-bang schema change.

### Why It Hurts

- runtime null errors,
- query misses data,
- rollback broken.

### Early Warning

```text
field rename done in one PR
no fallback reader
no old fixtures
```

### Remediation

- expand-contract,
- reader fallback,
- dual-write temporarily,
- backfill,
- contract later.

### Prevention

Every schema change has compatibility matrix.

---

## 26. Anti-Pattern: Blind TTL For Regulated Data

### Symptom

TTL deletes audit/case data that legal hold should preserve.

### Root Cause

TTL used as compliance retention engine without legal hold logic.

### Why It Hurts

- legal/compliance violation,
- data loss,
- irrecoverable evidence deletion.

### Early Warning

```text
TTL index on audit/cases
legalHold field ignored
retention policy complex but TTL simple
```

### Remediation

- stop TTL,
- restore if needed,
- explicit retention job,
- legal hold filter,
- deletion manifests.

### Prevention

TTL is cleanup, not compliance workflow.

---

## 27. Anti-Pattern: Audit As Best-Effort Log

### Symptom

Business state changes even when audit insert fails.

### Root Cause

Audit treated like application log.

### Why It Hurts

- audit divergence,
- no defensible history,
- compliance incident.

### Early Warning

```text
catch audit exception and continue
audit written asynchronously without guarantee
no audit count validation
```

### Remediation

- write audit in same transaction/atomic boundary,
- deterministic audit IDs,
- reconciliation,
- alert on audit failure.

### Prevention

Critical audit is source-of-evidence, not debug log.

---

## 28. Anti-Pattern: Search Index As Source Of Truth

### Symptom

Application makes critical decisions based on search projection state.

### Root Cause

Search is convenient and fast.

### Why It Hurts

- stale data,
- authorization lag,
- missing recent updates,
- projection bug affects correctness.

### Early Warning

```text
command validates from search index
case action button enabled based only on search result
```

### Remediation

- verify source document before command,
- use search only for discovery,
- display freshness,
- projection reconciliation.

### Prevention

Search is read model, not command authority.

---

## 29. Anti-Pattern: Change Stream As Domain Event Contract

### Symptom

External services consume raw update events and infer business events.

### Root Cause

Avoiding outbox/event modelling.

### Why It Hurts

- no actor/reason/context,
- schema tied to DB internals,
- hard versioning,
- consumers break on field rename,
- semantic ambiguity.

### Early Warning

```text
consumer maps status update to CaseEscalated
no outbox event schema
```

### Remediation

- introduce domain outbox,
- publish explicit events,
- keep change streams for projection/cache.

### Prevention

Database change != business event.

---

## 30. Anti-Pattern: No Rebuild Plan For Projections

### Symptom

Search/worklist/dashboard corrupted; no way to repair except manual edits.

### Root Cause

Projection assumed always correct.

### Why It Hurts

- stale/wrong UX,
- security exposure,
- long incident recovery.

### Early Warning

```text
no projection source-of-truth mapping
no rebuild job
no projection version
```

### Remediation

- build rebuild/reconciliation job,
- version projection,
- add lag/drift metrics.

### Prevention

Every derived model must be rebuildable.

---

## 31. Anti-Pattern: Production Data In Dev

### Symptom

Developers use production dump locally.

### Root Cause

Convenience debugging.

### Why It Hurts

- PII leak,
- compliance breach,
- secrets in dev,
- uncontrolled copies.

### Early Warning

```text
shared prod dump
real names/IDs in test fixtures
no anonymization pipeline
```

### Remediation

- revoke/delete dumps,
- create synthetic/anonymized data,
- audit access,
- policy enforcement.

### Prevention

Production data requires governance everywhere.

---

## 32. Anti-Pattern: App Uses Admin DB Credential

### Symptom

Runtime service connects as root/admin.

### Root Cause

Ease of setup, missing RBAC discipline.

### Why It Hurts

- app compromise = DB compromise,
- accidental drop/create,
- privilege escalation.

### Early Warning

```text
readWriteAnyDatabase
dbAdminAnyDatabase
root user in app secret
```

### Remediation

- create service-specific roles,
- rotate secrets,
- remove admin privilege,
- audit usage.

### Prevention

Least privilege per workload.

---

## 33. Anti-Pattern: Logs Contain Documents/Secrets

### Symptom

Logs include full Mongo URI, query payload, document body, PII.

### Root Cause

Debug logging in production.

### Why It Hurts

- credential leak,
- PII leak,
- audit/security incident,
- log system becomes sensitive data store.

### Early Warning

```text
log.info("doc={}", document)
log connection string
slow query logs with raw values widely accessible
```

### Remediation

- sanitize logs,
- rotate leaked credentials,
- restrict log access,
- remove sensitive values.

### Prevention

Structured safe logging with allowlist.

---

## 34. Anti-Pattern: Backup Never Restored

### Symptom

Backup exists, but restore fails during disaster.

### Root Cause

Backup treated as checkbox.

### Why It Hurts

- data loss,
- RTO missed,
- compliance failure.

### Early Warning

```text
no restore drill
unknown RTO
backup success only metric
keys not tested
```

### Remediation

- perform restore drill,
- document runbook,
- test app smoke,
- test keys/indexes/attachments.

### Prevention

Backup strategy includes scheduled restore validation.

---

## 35. Anti-Pattern: Restore Starts Workers Immediately

### Symptom

After restore, outbox republishes, retention deletes, migration reruns.

### Root Cause

No safe mode after restore.

### Why It Hurts

- duplicate notifications,
- data deleted after restore,
- corruption repeated.

### Early Warning

```text
workers auto-start with app
no DR safe mode
no restore epoch
```

### Remediation

- disable workers,
- reconcile state,
- enable gradually,
- add safe-mode config.

### Prevention

DR runbook includes worker startup order.

---

## 36. Anti-Pattern: No Query Limit

### Symptom

Endpoint returns unbounded results.

```javascript
db.cases.find({ tenantId })
```

### Root Cause

Assumes tenant data small.

### Why It Hurts

- memory blowup,
- large network response,
- long cursor,
- pool exhaustion,
- user timeout.

### Early Warning

```text
findAllByTenant
no limit
export via normal API
```

### Remediation

- enforce pagination,
- cap max limit,
- use async export for large data,
- projection.

### Prevention

Every list endpoint has limit/cursor.

---

## 37. Anti-Pattern: Offset Pagination At Scale

### Symptom

Page 10000 slow.

```javascript
skip(500000).limit(50)
```

### Root Cause

Offset pagination copied from SQL/UI habit.

### Why It Hurts

- scans/skips many records,
- inconsistent pages,
- slow deep pagination.

### Early Warning

```text
skip used on large collection
pageNumber API for operational data
```

### Remediation

- cursor/keyset pagination,
- stable sort with tie-breaker,
- cap deep browsing,
- async export for full data.

### Prevention

Use cursor pagination for large mutable datasets.

---

## 38. Anti-Pattern: Ignoring matchedCount

### Symptom

Update result ignored; API returns success even if no document changed.

### Root Cause

Assuming update always matches.

### Why It Hurts

- invalid state hidden,
- stale version ignored,
- wrong tenant/id not detected,
- idempotency ambiguous.

### Early Warning

```java
collection.updateOne(...);
return success;
```

### Remediation

Interpret:

```text
matchedCount
modifiedCount
upsertedId
duplicate key
write concern error
```

### Prevention

Every write result has domain mapping.

---

## 39. Anti-Pattern: Dynamic Arbitrary Client Query

### Symptom

API accepts raw MongoDB filter/sort/projection.

### Root Cause

Trying to build flexible search/reporting quickly.

### Why It Hurts

- operator injection,
- tenant leak,
- expensive queries,
- sensitive projection,
- arbitrary regex.

### Early Warning

```text
request body contains Mongo query DSL
```

### Remediation

- typed filters,
- allowlist fields/operators,
- server-side tenant/auth criteria,
- max limits,
- async reports.

### Prevention

Never expose raw database query DSL to untrusted clients.

---

## 40. Anti-Pattern: No Ownership For Index/Search/Migration

### Symptom

Nobody knows why index/search field/migration exists.

### Root Cause

Operational artifacts not treated as product code.

### Why It Hurts

- stale indexes,
- unsafe drops,
- search relevance decay,
- broken migrations,
- incident confusion.

### Early Warning

```text
index names auto-generated
no docs
migration scripts one-off
```

### Remediation

- inventory,
- owners,
- runbooks,
- naming conventions,
- lifecycle review.

### Prevention

Operational assets need ownership metadata.

---

## 41. Failure Case: Worklist Outage From Missing Compound Index

### Situation

A worklist endpoint:

```javascript
{ tenantId, status: "OPEN", assigneeId }
sort dueAt
limit 50
```

worked in staging but timed out in production.

### Root Cause

Index only:

```javascript
{ tenantId: 1, status: 1 }
```

Large tenant had millions of open cases. Sort not covered.

### Impact

- p99 spiked,
- pool checkout timeout,
- users could not process cases,
- retries worsened DB load.

### Fix

- add compound index,
- deploy cursor pagination,
- add explain test,
- add tenant skew perf test,
- add query inventory.

### Lesson

Indexes must match real production cardinality and sort.

---

## 42. Failure Case: Tenant Data Leak In Aggregation Lookup

### Situation

Aggregation joined `case_parties` by `caseId` only.

Two tenants both had `CASE-001`.

### Root Cause

`$lookup` missing tenant condition.

### Impact

Tenant A saw party from tenant B.

### Fix

- include tenantId in `$lookup` pipeline,
- test overlapping IDs,
- review all aggregations,
- add query builder guardrail.

### Lesson

Tenant filter must flow through joins.

---

## 43. Failure Case: TTL Deleted Legal-Hold Records

### Situation

Audit collection had TTL on `occurredAt`.

Legal hold was added later but TTL kept deleting old audit.

### Root Cause

TTL used for compliance retention.

### Impact

Evidence lost.

### Fix

- remove TTL,
- restore from backup if possible,
- explicit retention job,
- legal hold check,
- deletion manifest.

### Lesson

Legal retention is workflow, not blind expiration.

---

## 44. Failure Case: Retry Duplicated Notification

### Situation

Command timed out after DB commit but before HTTP response. Client retried with new command ID.

### Root Cause

No idempotency key from user intent.

### Impact

Two outbox events, two notifications.

### Fix

- client/server commandId,
- idempotency record,
- deterministic outbox ID,
- duplicate handling.

### Lesson

Timeout means uncertainty, not failure.

---

## 45. Failure Case: Search Projection Leaked Confidential Case

### Situation

Permission changed, source case updated, search projection lagged.

User could still find confidential case in search.

### Root Cause

Search projection used stale permission snapshot and detail endpoint trusted search.

### Impact

Security incident.

### Fix

- detail endpoint verifies source authorization,
- permission change triggers high-priority projection update,
- projection lag alert,
- search result hides sensitive snippets,
- rebuild projection.

### Lesson

Derived search index must not be final authorization authority.

---

## 46. Failure Case: Restore Republished Outbox

### Situation

Database restored to yesterday. Outbox events already published yesterday appeared pending again.

### Root Cause

Outbox state restored but external world not restored.

### Impact

Duplicate notifications/integrations.

### Fix

- disable workers after restore,
- reconcile event IDs with downstream,
- idempotent publish,
- restore epoch,
- runbook.

### Lesson

Restore is not just database rewind.

---

## 47. Failure Case: Hot Counter Bottleneck

### Situation

Every new case incremented one `caseNumberCounter` document.

### Root Cause

Strict sequential numbering requirement assumed, not validated.

### Impact

Write throughput capped, p99 high.

### Fix

- business accepted gap-tolerant per-tenant yearly range,
- preallocated ranges,
- audit generated IDs,
- monitoring.

### Lesson

Sequential IDs are distributed-system tax.

---

## 48. Failure Case: Migration Broke Old App Rollback

### Situation

Deploy renamed field and removed old field. New app had bug. Rollback old app failed.

### Root Cause

No expand-contract; contract done immediately.

### Impact

rollback impossible without emergency patch.

### Fix

- restore old field from backup/backfill,
- add reader fallback,
- migration runbook updated.

### Lesson

Rollback compatibility is part of migration design.

---

## 49. Anti-Pattern Review Checklist

Use this in design review:

```text
[ ] Are arrays bounded?
[ ] Are tenant filters mandatory?
[ ] Are hot queries indexed?
[ ] Is authorization applied in query/search?
[ ] Are writes guarded by version/state?
[ ] Are retries idempotent?
[ ] Are transactions justified?
[ ] Are side effects outboxed?
[ ] Are projections rebuildable?
[ ] Is migration expand-contract?
[ ] Is retention legal-hold aware?
[ ] Are backups restored in drills?
[ ] Are logs sanitized?
[ ] Is read preference per use case?
[ ] Is shard key reviewed?
[ ] Are background jobs backpressured?
```

---

## 50. Remediation Prioritization

When inheriting a problematic MongoDB system, prioritize:

### Critical Security/Compliance

```text
tenant leak
authorization bug
audit divergence
backup missing
secrets/log leaks
retention legal hold risk
```

### Critical Availability

```text
hot query without index
pool exhaustion
retry storm
unbounded export
write hotspot
```

### Data Correctness

```text
lost updates
no idempotency
migration corruption
projection drift
```

### Cost/Performance

```text
unused indexes
large documents
archive needed
search inefficiency
```

Fix highest risk first.

---

## 51. Senior-Level Heuristics

```text
If it grows forever, it needs a lifecycle.

If it is user-facing and unbounded, it will page you.

If tenantId is optional, security is accidental.

If query has no explain, performance is assumed.

If write can retry, idempotency is mandatory.

If data is derived, rebuild must exist.

If retention has legal hold, TTL alone is unsafe.

If restore has never happened, DR is unproven.

If field rename has no compatibility phase, rollback is broken.

If search index contains sensitive data, treat it as sensitive storage.

If one document coordinates many users, expect contention.
```

---

## 52. Practical Exercise

Audit this design:

```text
Collection cases:
{
  _id,
  caseId,
  tenantId,
  status,
  assigneeId,
  notes: [],
  auditTrail: [],
  documents: [],
  partyNames: [],
  createdAt,
  updatedAt
}

Queries:
- find by caseId only
- worklist by status + assigneeId sorted by dueAt
- search with regex over partyNames
- dashboard aggregates over all cases
- update status with repository.save()
- audit appended with $push
- retention uses TTL on createdAt
- app uses secondaryPreferred globally
- backup exists but never restored
```

Find at least 12 issues and propose remediation.

Expected issues include:

```text
find by caseId missing tenant
worklist index missing/tenant missing
regex search
unbounded notes/audit/documents arrays
repository.save lost update
audit not append-only collection
TTL wrong for retention/legal hold
secondaryPreferred stale reads
backup untested
dashboard broad aggregate
partyNames multikey/search issue
no optimistic locking
no idempotency
search authorization unknown
```

---

## 53. Summary

MongoDB anti-patterns usually come from implicit assumptions:

```text
data will stay small
tenants are similar
queries are simple
arrays are bounded
search is just regex
backup will work
retry is safe
secondary reads are fine
schema changes are easy
```

Key lessons:

1. Document modelling must follow aggregate boundary and boundedness.
2. Tenant isolation must be structural, tested, and indexed.
3. Hot queries need explicit index design.
4. Search, worklist, and command queries are different access paths.
5. Writes need concurrency control and idempotency.
6. Transactions are tools, not defaults.
7. Side effects need outbox.
8. Sharding cannot fix bad query design.
9. TTL is not compliance retention.
10. Audit is evidence, not debug log.
11. Derived projections must be rebuildable.
12. Security-sensitive data appears in logs/search/backups too.
13. Migration requires compatibility and rollback.
14. Restore requires application reconciliation.
15. Observability must identify operation, tenant, query shape, and remediation path.

The most important sentence:

> Most MongoDB failures are predictable if you look for unbounded growth, missing boundaries, implicit consistency assumptions, and operational shortcuts before production scale exposes them.

---

## 54. Bridge to Part 032

Part 032 will focus on architectural patterns:

- MongoDB in distributed Java systems,
- aggregate-oriented service design,
- command/query separation,
- outbox/inbox,
- event-driven projections,
- saga/process manager,
- cache aside,
- search projection,
- multi-tenant platform architecture,
- modular monolith vs microservices,
- MongoDB with Kafka/RabbitMQ/Redis/PostgreSQL,
- boundary decisions,
- reference architectures.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-032.md
```

Judul berikutnya:

```text
Part 032 — Architecture Patterns: MongoDB in Distributed Java Systems
```

---

## 55. Status Seri

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
Part 028 — Testing Strategy: Unit, Integration, Contract, Migration, and Failure Testing
Part 029 — Observability and Operations: Metrics, Logs, Profiling, Slow Queries, Runbooks
Part 030 — Backup, Restore, Disaster Recovery, Retention, and Compliance
Part 031 — Anti-Patterns and Failure Case Catalogue
```

Seri belum selesai. Masih lanjut ke Part 032 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Backup, Restore, Disaster Recovery, Retention, and Compliance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-032.md">Part 032 — Architecture Patterns: MongoDB in Distributed Java Systems ➡️</a>
</div>

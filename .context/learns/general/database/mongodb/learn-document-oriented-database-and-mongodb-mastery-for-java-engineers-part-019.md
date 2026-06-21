# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-019.md

# Part 019 — Performance Engineering II: Write Path, Bulk Operations, Hotspots, and Backpressure

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 019 dari 035  
> Fokus: write path, insert/update/delete behavior, bulk operations, write concern, contention, hot documents, counters, queue-like workloads, TTL, archival, backpressure, retry storms, dan predictable write latency  
> Target pembaca: Java software engineer yang ingin mampu mendesain write-heavy MongoDB system yang stabil, defensible, dan observable

---

## 0. Posisi Part Ini Dalam Seri

Part 018 membahas read/query performance:

- query shape,
- index shape,
- working set,
- memory,
- document size,
- projection,
- pagination,
- slow query,
- Java driver pool,
- latency budget.

Part 019 membahas sisi lain: write performance.

Banyak engineer merasa write hanya berarti:

```text
insert document
update field
delete document
```

Di production, write path jauh lebih kompleks.

Satu operasi write dapat menyentuh:

```text
document storage
indexes
journal
replication
write concern acknowledgement
transaction/session state
locks/concurrency control
change stream visibility
TTL/index maintenance
application retry layer
idempotency mechanism
observability pipeline
```

Write performance bukan hanya “berapa cepat insert satu document”, tetapi:

1. apakah latency stabil pada p95/p99,
2. apakah retry aman,
3. apakah update menyebabkan contention,
4. apakah document tumbuh tanpa batas,
5. apakah index terlalu banyak,
6. apakah write concern sesuai risiko,
7. apakah batch tidak menghancurkan database,
8. apakah failure menghasilkan duplikasi,
9. apakah aplikasi punya backpressure,
10. apakah operational invariant tetap benar saat terjadi partial failure.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan biaya insert, update, delete di MongoDB.
2. Memahami pengaruh index terhadap write amplification.
3. Membedakan ordered dan unordered bulk write.
4. Mendesain batch write yang idempotent dan recoverable.
5. Mengenali hot document dan hot key problem.
6. Mendesain counter yang scalable.
7. Menghindari queue anti-pattern di MongoDB.
8. Memahami pengaruh write concern terhadap latency dan durability.
9. Mendesain retry write yang aman.
10. Menerapkan backpressure di Java service.
11. Mengelola TTL cleanup dan archival tanpa mengejutkan production.
12. Membuat write latency yang predictable.
13. Membuat write-side observability yang actionable.

---

## 2. Write Path Mental Model

Saat aplikasi melakukan write:

```java
collection.updateOne(filter, update);
```

Secara konseptual MongoDB harus:

```text
receive command
select target server
validate command
match target document(s)
apply write operation
update affected indexes
record operation for durability/replication mechanisms
acknowledge according to write concern
return result to driver
driver maps result/errors
application commits/continues/retries
```

Untuk sharded cluster, ada tambahan:

```text
route through mongos
determine target shard(s)
coordinate multi-shard write if needed
```

Untuk transaction, ada tambahan:

```text
session state
transaction state
snapshot/commit protocol
retry semantics
possible unknown commit result
```

Jadi write latency tidak hanya “update field”.

---

## 3. Insert Cost

Insert tampak sederhana:

```javascript
db.cases.insertOne({
  tenantId: "t1",
  caseNumber: "CASE-001",
  status: "OPEN",
  createdAt: ISODate(...)
})
```

Biaya insert dipengaruhi oleh:

1. ukuran document,
2. jumlah index,
3. ukuran index entry,
4. uniqueness check,
5. write concern,
6. journaling/durability,
7. replication,
8. shard key routing,
9. validation rules,
10. encryption/compression,
11. network,
12. driver pool availability.

Jika collection memiliki 10 index, insert bukan hanya menulis document. MongoDB juga harus membuat/menjaga entries untuk index-index tersebut.

Prinsip:

```text
Every index is a read optimization and a write tax.
```

---

## 4. Update Cost

Update lebih kompleks daripada insert.

Contoh:

```javascript
db.cases.updateOne(
  { tenantId: "t1", _id: caseId },
  { $set: { status: "UNDER_REVIEW" } }
)
```

Biaya update dipengaruhi oleh:

1. mencari document target,
2. mengubah field,
3. apakah field tersebut di-index,
4. apakah ukuran document berubah,
5. apakah update menyentuh array besar,
6. apakah update conditional,
7. apakah update menyebabkan banyak index maintenance,
8. apakah ada concurrent update pada document sama,
9. apakah write concern menunggu replication,
10. apakah update berada dalam transaction.

Update field yang tidak di-index lebih murah daripada update field yang di-index.

Contoh:

```javascript
$set: { internalCommentDraft: "..." }
```

lebih murah daripada:

```javascript
$set: { status: "ESCALATED" }
```

jika `status` adalah bagian dari banyak compound index.

Namun field seperti `status` memang biasanya harus di-index karena query operational bergantung padanya. Jadi trade-off bukan menghindari index, tetapi menyadari write amplification-nya.

---

## 5. Delete Cost

Delete juga bukan gratis.

```javascript
db.cases.deleteOne({ tenantId: "t1", _id: caseId })
```

Biaya delete:

1. locate document,
2. remove document record,
3. remove all index entries,
4. replication/journal acknowledgement,
5. possible change stream event,
6. storage fragmentation/space reuse behavior,
7. cascading cleanup jika dilakukan aplikasi.

Dalam regulated systems, hard delete sering bukan operasi biasa.

Lebih umum:

```text
soft delete
archival
retention-driven deletion
legal hold aware deletion
```

Contoh:

```javascript
{
  status: "CLOSED",
  retention: {
    deleteAfter: ISODate("2033-01-01"),
    legalHold: false
  },
  deletedAt: null
}
```

Hard delete harus dikendalikan oleh retention policy, bukan UI action sembarangan.

---

## 6. Replacement vs Modifier Update

MongoDB mendukung replacement:

```javascript
db.cases.replaceOne(
  { _id: caseId },
  replacementDocument
)
```

Dan modifier update:

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $set: { status: "OPEN" } }
)
```

Replacement berbahaya jika:

- document besar,
- field baru bisa hilang,
- concurrent update bisa tertimpa,
- schema evolution belum aman,
- mapper Java tidak memuat semua field,
- partial projection lalu save ulang.

Classic bug:

```java
CaseDocument doc = repository.findSummaryById(caseId);
doc.setStatus("CLOSED");
repository.save(doc);
```

Jika `findSummaryById` hanya mengambil sebagian field, lalu `save` melakukan replacement, field lain bisa hilang.

Untuk write path performance dan correctness, gunakan operator update untuk perubahan spesifik.

---

## 7. Index Write Amplification

Misal document:

```javascript
{
  tenantId,
  status,
  assigneeId,
  dueAt,
  priority,
  region,
  productCode,
  riskScore,
  createdAt,
  updatedAt
}
```

Index:

```javascript
{ tenantId: 1, status: 1, dueAt: 1 }
{ tenantId: 1, assigneeId: 1, status: 1, dueAt: 1 }
{ tenantId: 1, priority: 1, riskScore: -1 }
{ tenantId: 1, productCode: 1, region: 1 }
{ tenantId: 1, updatedAt: -1 }
```

Update:

```javascript
{ $set: { status: "ESCALATED", updatedAt: now } }
```

Mungkin menyentuh beberapa index.

Jika high-volume state transitions terjadi terus, index maintenance menjadi biaya signifikan.

Trade-off:

```text
Need fast reads for queues/dashboards/search
but each mutable indexed field increases write cost
```

Prinsip:

```text
Index stable and hot read fields.
Be careful indexing highly volatile fields unless query requires it.
```

Namun operational systems sering memang query by mutable state. Jadi optimisasi dilakukan dengan:

- index minimal tapi tepat,
- materialized worklist,
- partial index,
- bounded state fields,
- archive closed data,
- separate write-heavy logs,
- avoid indexing noisy fields.

---

## 8. Mutable Field Dalam Banyak Index

Field yang sering berubah dan muncul di banyak index mahal.

Contoh `status` digunakan di 8 index.

Setiap transition:

```text
OPEN -> UNDER_REVIEW -> ESCALATED -> CLOSED
```

harus update banyak index entries.

Solusi:

1. Kurangi index yang menyertakan status.
2. Pisahkan hot queue collection.
3. Gunakan partial indexes untuk active states.
4. Gunakan materialized worklist.
5. Archive closed documents.
6. Gunakan different collection untuk active vs closed jika justified.

Contoh partial index:

```javascript
db.cases.createIndex(
  { tenantId: 1, assigneeId: 1, dueAt: 1 },
  { partialFilterExpression: { status: "OPEN" } }
)
```

Ini hanya mengindex document OPEN untuk query worklist tertentu.

---

## 9. Write Concern

Write concern menentukan kapan MongoDB menganggap write acknowledged.

Secara konseptual:

```text
w: 1
  primary acknowledges

w: majority
  majority of voting data-bearing members acknowledge

j: true
  journal acknowledgement involved
```

Trade-off:

```text
lower write concern:
  lower latency
  weaker durability/replication guarantee

higher write concern:
  stronger durability/replication guarantee
  higher latency
  more sensitive to replica lag/failure
```

Untuk regulated systems, default sembrono seperti “fastest possible” bisa berbahaya.

Pertanyaan:

1. Apakah write ini legally relevant?
2. Apakah kehilangan write acceptable?
3. Apakah duplicate write acceptable?
4. Apakah user harus melihat write setelah ack?
5. Apakah downstream audit bergantung pada write ini?
6. Apakah write bisa direkonstruksi dari source lain?

Contoh:

```text
audit event write:
  likely majority or carefully designed durability

temporary UI preference:
  maybe lower criticality

idempotency record:
  must be durable enough to prevent duplicate side effects
```

---

## 10. Read Concern and Write Path

Read concern dibahas di Part 013, tetapi penting untuk write flow.

Jika setelah write aplikasi membaca data:

```text
write case state
read case state for response
```

Pertanyaan:

- read dari primary atau secondary?
- apakah read-your-write diperlukan?
- apakah causal consistency digunakan?
- apakah transaction/snapshot diperlukan?

Bad pattern:

```text
write to primary
immediately read from secondary
user sees old state
```

Untuk workflow/state machine, ini bisa berbahaya.

Performance shortcut yang melemahkan correctness harus terlihat jelas sebagai decision.

---

## 11. Ordered vs Unordered Bulk Write

Bulk write digunakan untuk batch operation.

Ordered bulk:

```text
execute in order
stop on first error
preserve sequence semantics
```

Unordered bulk:

```text
can execute independently
continues after individual errors
often better throughput
```

Contoh Java driver concept:

```java
List<WriteModel<Document>> writes = List.of(
    new InsertOneModel<>(doc1),
    new UpdateOneModel<>(filter2, update2),
    new DeleteOneModel<>(filter3)
);

collection.bulkWrite(writes, new BulkWriteOptions().ordered(false));
```

Gunakan ordered jika:

- urutan penting,
- operasi berikutnya bergantung pada sebelumnya,
- failure harus stop cepat.

Gunakan unordered jika:

- independent records,
- batch import,
- backfill,
- idempotent updates,
- ingin throughput lebih baik,
- partial success bisa ditangani.

---

## 12. Bulk Write Batch Size

Batch terlalu kecil:

```text
too many round trips
low throughput
```

Batch terlalu besar:

```text
large memory
large network payload
long operation duration
harder retry
bigger failure blast radius
pool connection occupied longer
```

Heuristic awal:

```text
hundreds to low thousands operations per batch
```

Tetapi harus diuji dengan document size dan workload nyata.

Batch sizing harus mempertimbangkan:

- average document size,
- max document size,
- index count,
- write concern,
- network latency,
- timeout,
- failure recovery,
- memory,
- downstream pressure.

Prinsip:

```text
Batch for efficiency, not for unbounded accumulation.
```

---

## 13. Idempotent Bulk Write

Batch operation harus recoverable.

Bad:

```javascript
insert random _id every retry
```

Jika retry setelah unknown failure, bisa duplicate.

Better:

```javascript
use deterministic _id or unique natural key
```

Contoh:

```javascript
{
  _id: "caseImport:batch42:row100",
  importId: "batch42",
  rowNumber: 100,
  ...
}
```

Atau upsert:

```javascript
db.importedCases.updateOne(
  { importId: "batch42", sourceRecordId: "R100" },
  {
    $setOnInsert: {
      createdAt: now,
      ...
    },
    $set: {
      lastSeenAt: now
    }
  },
  { upsert: true }
)
```

Untuk Java batch job, simpan checkpoint:

```text
batch id
last processed offset
success count
failure count
last error
startedAt
completedAt
```

---

## 14. Retryable Writes: Safe But Not Magical

Retryable writes membantu terhadap transient network/server errors untuk operasi tertentu.

Namun application-level safety tetap perlu.

Contoh masalah:

```text
client sends write
server applies write
network drops before response
client doesn't know success
client retries
```

Jika write idempotent, aman.

Jika write non-idempotent:

```javascript
{ $inc: { balance: -100 } }
```

atau:

```javascript
{ $push: { events: eventWithoutUniqueId } }
```

retry bisa menggandakan effect jika tidak dikendalikan.

Solusi:

1. idempotency key,
2. unique request id,
3. conditional update,
4. event id in append,
5. transaction with idempotency record,
6. compare-and-set state transition.

---

## 15. Idempotency Record Pattern

Untuk command penting:

```text
commandId = unique per user intent
```

Collection:

```javascript
command_deduplication
```

Document:

```javascript
{
  _id: "tenant:t1:command:cmd-123",
  tenantId: "t1",
  commandId: "cmd-123",
  commandType: "ESCALATE_CASE",
  targetId: "case-1",
  status: "COMPLETED",
  resultRef: {
    caseId: "case-1",
    transitionId: "tr-999"
  },
  createdAt: ISODate(...),
  expiresAt: ISODate(...)
}
```

Flow:

```text
try insert idempotency record
if duplicate:
  return previous result or detect in-progress
perform state transition
mark completed
```

Caveat:

- need handle stuck IN_PROGRESS,
- TTL for dedup records,
- transaction or carefully ordered writes,
- idempotency key must represent user intent, not HTTP retry only.

---

## 16. Conditional Update For State Transition

Instead of:

```javascript
db.cases.updateOne(
  { _id: caseId },
  { $set: { status: "ESCALATED" } }
)
```

Use guard:

```javascript
db.cases.updateOne(
  {
    _id: caseId,
    tenantId: tenantId,
    status: "UNDER_REVIEW",
    version: expectedVersion
  },
  {
    $set: {
      status: "ESCALATED",
      escalatedAt: now,
      updatedAt: now
    },
    $inc: { version: 1 }
  }
)
```

Interpret result:

```text
matchedCount = 1, modifiedCount = 1:
  transition applied

matchedCount = 0:
  stale state, wrong tenant, missing case, or version conflict
```

This makes concurrency control part of the write path.

Performance impact:

- query must use appropriate index,
- version/status field update can touch indexes,
- but correctness benefit is essential.

---

## 17. Append Event With Deduplication

Bad:

```javascript
$push: { events: event }
```

If retried, duplicate event.

Better if embedded and bounded:

```javascript
$addToSet: { eventIds: eventId }
```

But event objects with `$addToSet` can be tricky if object equality differs.

Better for audit/event collection:

```javascript
db.case_audit_events.insertOne({
  _id: "case-1:transition-999",
  tenantId,
  caseId,
  transitionId,
  sequence,
  action,
  at,
  actorId,
  payload
})
```

Unique `_id` prevents duplicate.

If retry:

```text
duplicate key means event already recorded
```

Interpret duplicate key as idempotent success when appropriate.

---

## 18. Hot Document Problem

Hot document = many writes target same document.

Examples:

```javascript
{ _id: "global-sequence" }
{ _id: "tenant:t1:daily-counter:2026-06-21" }
{ _id: "case-1", auditEvents: [...] }
{ _id: "queue:pending", items: [...] }
```

Symptoms:

- high write latency,
- update conflicts/contention,
- retry increase,
- p99 spikes,
- throughput plateaus,
- one document/record becomes bottleneck.

MongoDB can handle concurrent operations, but one document as global coordination point is still a design smell at scale.

---

## 19. Counter Design

Naive:

```javascript
db.counters.updateOne(
  { _id: "caseNumber" },
  { $inc: { value: 1 } },
  { upsert: true }
)
```

For low volume, fine.

For high volume, this is hot document.

Alternatives:

### 19.1 Segmented Counter

```text
counter:tenant:t1:year:2026:segment:0
counter:tenant:t1:year:2026:segment:1
...
counter:tenant:t1:year:2026:segment:31
```

Writers choose segment.

Total count = sum segments.

Good for metrics, not strict sequential IDs.

### 19.2 Preallocated Ranges

One update reserves a range:

```text
service instance reserves 1000 IDs
```

Then local memory assigns IDs.

Trade-off:

- gaps possible,
- service crash loses unused IDs,
- strict no-gap sequence not guaranteed.

### 19.3 Domain-Friendly ID

Instead of strict sequence:

```text
CASE-2026-06-<random/base36>
CASE-<tenant>-<year>-<ULID>
```

Often better for distributed systems.

### 19.4 Use Database Transactional Sequence Only If Truly Required

If legal/regulatory requirement demands strict sequence, accept bottleneck and design capacity around it.

Do not invent strict sequence requirement unless business really needs it.

---

## 20. Queue-Like Workloads In MongoDB

MongoDB can support some queue-like patterns, but it is not a dedicated broker.

Bad queue pattern:

```javascript
{
  _id: "queue",
  items: [ huge array of jobs ]
}
```

Problems:

- hot document,
- unbounded array,
- contention,
- large fetch/update,
- bad failure recovery.

Better MongoDB-backed work claiming:

```javascript
db.jobs.findOneAndUpdate(
  {
    status: "PENDING",
    availableAt: { $lte: now }
  },
  {
    $set: {
      status: "CLAIMED",
      claimedBy: workerId,
      claimedAt: now,
      leaseUntil: leaseUntil
    },
    $inc: { attempt: 1 }
  },
  {
    sort: { priority: -1, availableAt: 1, _id: 1 },
    returnDocument: "after"
  }
)
```

Index:

```javascript
{ status: 1, availableAt: 1, priority: -1, _id: 1 }
```

Still, use this only for moderate task coordination.

For high-throughput messaging/event streaming, Kafka/RabbitMQ are better fit. Since those were already covered in prior series, the key here is boundary:

```text
MongoDB job collection:
  durable work items tied to domain state, moderate throughput, queryable status

Kafka/RabbitMQ:
  high-throughput messaging, fanout, backpressure semantics, broker-level delivery patterns
```

---

## 21. Lease Pattern

Lease pattern prevents permanent stuck jobs.

Job document:

```javascript
{
  _id,
  status: "PENDING" | "CLAIMED" | "DONE" | "FAILED",
  availableAt,
  claimedBy,
  claimedAt,
  leaseUntil,
  attempt,
  payload
}
```

Claim:

```javascript
db.jobs.findOneAndUpdate(
  {
    status: "PENDING",
    availableAt: { $lte: now }
  },
  {
    $set: {
      status: "CLAIMED",
      claimedBy: workerId,
      claimedAt: now,
      leaseUntil: new Date(now.getTime() + 60000)
    },
    $inc: { attempt: 1 }
  },
  {
    sort: { availableAt: 1, _id: 1 },
    returnDocument: "after"
  }
)
```

Reclaim expired:

```javascript
db.jobs.updateMany(
  {
    status: "CLAIMED",
    leaseUntil: { $lt: now }
  },
  {
    $set: {
      status: "PENDING",
      claimedBy: null,
      claimedAt: null,
      leaseUntil: null
    }
  }
)
```

Need:

- max attempts,
- dead-letter state,
- idempotent worker,
- observability,
- not too many polling workers,
- backoff when no job.

---

## 22. Polling Backpressure

A common failure:

```text
100 workers poll every 100ms
no jobs available
database QPS high doing empty queries
```

Fix:

1. exponential backoff when no job,
2. jitter,
3. limit workers,
4. use change streams carefully if appropriate,
5. queue system if workload is message-heavy,
6. separate job collection indexes,
7. cap poll frequency.

Pseudo:

```java
while (running) {
    Optional<Job> job = claimNextJob();

    if (job.isEmpty()) {
        sleep(backoff.nextWithJitter());
        continue;
    }

    backoff.reset();
    process(job.get());
}
```

---

## 23. TTL Index Cleanup

TTL indexes remove expired documents automatically.

Common uses:

- session cleanup,
- idempotency records,
- temporary tokens,
- transient jobs,
- short-lived logs,
- cache-like collection.

But TTL cleanup is not exact real-time deletion.

Do not rely on TTL as precise scheduler.

Bad:

```text
This token must disappear exactly at 10:00:00.000.
```

Better:

```text
Application checks expiresAt during validation.
TTL eventually cleans storage.
```

TTL delete creates write workload too.

If millions of documents expire at same timestamp, cleanup can spike.

Avoid synchronized expiry:

```text
bad: all expire at midnight
better: distribute expiry times
```

For regulated deletion, TTL may be part of retention execution, but legal hold and audit requirements usually require a more explicit deletion process.

---

## 24. Delete Storm and Expiry Storm

Delete storm happens when many documents become eligible for deletion at once.

Causes:

- TTL field set to same timestamp,
- batch job deletes too aggressively,
- retention job scans huge collection,
- archive job removes large ranges,
- test data cleanup in production-like env.

Effects:

- write load spike,
- index maintenance spike,
- replication lag,
- disk I/O pressure,
- cache churn,
- user-facing latency.

Mitigation:

1. batch deletes,
2. rate limit,
3. delete by indexed range,
4. spread expiry,
5. archive before delete,
6. run off-peak,
7. monitor replication lag,
8. pause/resume job,
9. separate cold collections.

---

## 25. Archival Write Path

Archival is not just delete.

Flow:

```text
select cold data
copy/move to archive store
verify integrity
mark archived
remove or shrink hot record
maintain retrieval path
preserve audit/legal metadata
```

Possible patterns:

### 25.1 Archive Collection

```text
cases_hot
cases_archive
```

### 25.2 Archive Database

```text
app_hot.cases
app_archive.cases_2026
```

### 25.3 External Cold Storage

Store immutable exported records in object storage with manifest/hash.

### 25.4 Summary Retained In Hot Store

Hot `cases` retains:

```javascript
{
  _id,
  tenantId,
  caseNumber,
  status: "ARCHIVED",
  archivedAt,
  archiveRef,
  legalHold,
  retentionClass
}
```

Detailed payload moved.

Regulated systems require:

- chain of custody,
- audit record,
- restore process,
- legal hold override,
- retention evidence,
- access control continuity.

---

## 26. Update Many Risk

`updateMany` can be dangerous.

Example:

```javascript
db.cases.updateMany(
  { status: "OPEN" },
  { $set: { priority: "NORMAL" } }
)
```

Problems:

- missing tenant filter,
- too many documents,
- index updates huge,
- replication lag,
- no per-record business validation,
- hard rollback,
- application cache/search inconsistency,
- audit trail missing.

Safer pattern:

1. estimate count,
2. require tenant/bounded filter,
3. run in batches,
4. checkpoint,
5. audit migration job,
6. monitor,
7. dry run,
8. allow pause,
9. write idempotently.

Batch:

```javascript
db.cases.find({
  tenantId: "t1",
  status: "OPEN",
  migrationFlag: { $ne: "m20260621" }
}).sort({ _id: 1 }).limit(500)
```

Then update by `_id` list.

---

## 27. Bulk Migration Pattern

Migration document:

```javascript
{
  _id: "migration:m20260621-normalize-priority:t1",
  migrationId: "m20260621-normalize-priority",
  tenantId: "t1",
  status: "RUNNING",
  lastSeenId: ObjectId("..."),
  processed: 123000,
  failed: 10,
  startedAt,
  updatedAt,
  completedAt
}
```

Batch loop:

```text
read next batch by _id > lastSeenId
apply idempotent updates
record checkpoint
sleep/rate limit if needed
repeat
```

Update:

```javascript
{
  $set: {
    priorityNormalized: "...",
    migration: {
      priorityNormalizedV1: true
    }
  }
}
```

Idempotent:

```text
running twice should not corrupt data
```

---

## 28. Write Backpressure

Backpressure means the system intentionally slows intake when downstream cannot keep up.

Without backpressure:

```text
requests continue
DB slows
threads pile up
pool exhausted
timeouts
retries
more load
outage
```

Backpressure tools:

1. request rate limit,
2. bounded queue,
3. semaphore around write-heavy operations,
4. circuit breaker,
5. reject non-critical writes,
6. degrade features,
7. async queue with max depth,
8. batch coalescing,
9. tenant-level throttling,
10. worker concurrency control.

For Java service:

```java
Semaphore writeLimiter = new Semaphore(100);

boolean acquired = writeLimiter.tryAcquire(50, TimeUnit.MILLISECONDS);
if (!acquired) {
    throw new TooManyRequestsException("Write capacity temporarily saturated");
}

try {
    performWrite();
} finally {
    writeLimiter.release();
}
```

Use with care. The number must be based on measurement.

---

## 29. Bulkhead Pattern

Separate resources for different workloads.

Bad:

```text
same service thread pool
same MongoClient/pool
same database
same indexes
for:
  user writes
  background migration
  dashboard refresh
  export
  cleanup job
```

A background job can starve user-facing traffic.

Better:

```text
separate worker pool
separate rate limit
separate MongoClient settings if needed
separate schedule
separate collection/index strategy
separate priority
```

Example:

```text
interactive writes:
  small pool, strict timeout, high priority

migration writes:
  limited concurrency, longer timeout, pauseable

analytics/export:
  async, off-peak, separate read preference if safe
```

---

## 30. Retry Storm Detailed

Retry storm sequence:

```text
1. DB latency increases.
2. App requests hit timeout.
3. Clients retry.
4. App also retries internally.
5. Effective load multiplies.
6. DB gets slower.
7. Pool wait increases.
8. More timeouts.
9. More retries.
10. System collapses.
```

Prevention:

1. retry only transient errors,
2. low max attempts,
3. exponential backoff,
4. jitter,
5. global retry budget,
6. circuit breaker,
7. idempotency,
8. request deadlines,
9. no retry after deadline nearly expired,
10. do not retry broad expensive queries.

Pseudo:

```java
Duration deadline = requestDeadline.remaining();

if (deadline.compareTo(Duration.ofMillis(200)) < 0) {
    throw new DeadlineExceededException();
}

retry.withMaxAttempts(2)
     .withBackoffAndJitter()
     .onlyOn(transientMongoErrors)
     .execute(operation);
```

---

## 31. Deadline Propagation

Each request should have an overall deadline.

Bad:

```text
HTTP timeout 30s
service call timeout 30s
Mongo socket timeout 30s
retry 3x
```

This can exceed user budget.

Better:

```text
request deadline = 2s
Mongo operation gets remaining budget
retry only if enough budget remains
```

Repository should not blindly run long after user has gone.

In Java:

```text
controller receives request
sets deadline/correlation
service passes deadline
repository chooses timeout/read preference/retry policy
```

The MongoDB Java driver has timeout settings, but application-level deadline management still matters.

---

## 32. Write Latency Percentiles

Measure write latency by operation type:

```text
case.create
case.transition
case.assign
case.addNote
case.appendAudit
case.bulkImport
case.archive
job.claim
job.complete
```

Not just:

```text
mongodb.write.duration
```

For each:

```text
p50
p95
p99
timeout rate
duplicate key rate
write conflict/conflict-like failure
retry count
matchedCount=0 count
modifiedCount=0 count
pool checkout time
```

`matchedCount=0` on conditional update is not always error. It may mean concurrency conflict or stale command. Track it separately.

---

## 33. Write Result Interpretation

For `updateOne`:

```text
matchedCount
modifiedCount
upsertedId
acknowledged
```

Interpret carefully.

Example:

```javascript
updateOne(
  { _id, status: "OPEN" },
  { $set: { status: "CLOSED" } }
)
```

Result:

```text
matched=0
modified=0
```

Could mean:

- document not found,
- wrong tenant,
- status not OPEN,
- already CLOSED,
- stale command,
- authorization filter excluded it.

Do not just return generic success.

For workflow, classify:

```text
NOT_FOUND
FORBIDDEN
INVALID_STATE
CONFLICT
ALREADY_APPLIED
```

Sometimes need pre-read or richer filter design.

---

## 34. Upsert Performance and Correctness

Upsert:

```javascript
db.records.updateOne(
  { naturalKey: "X" },
  {
    $setOnInsert: { createdAt: now },
    $set: { updatedAt: now, value: 123 }
  },
  { upsert: true }
)
```

Requires unique index on natural key.

Without unique index, concurrent upserts can create duplicates.

Index:

```javascript
db.records.createIndex(
  { tenantId: 1, naturalKey: 1 },
  { unique: true }
)
```

Upsert is powerful for idempotent ingestion, but only safe when identity is enforced.

---

## 35. Unique Index as Concurrency Primitive

Unique index can enforce invariant.

Examples:

```text
one active assignment per case
one idempotency key per command
one user external identity per tenant
one caseNumber per tenant
```

Example:

```javascript
db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true }
)
```

For conditional uniqueness, use partial unique index.

Example:

```javascript
db.case_assignments.createIndex(
  { tenantId: 1, caseId: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true }
  }
)
```

This prevents two active assignments if modelled in separate collection.

Performance cost: uniqueness check during write. Correctness benefit often worth it.

---

## 36. Partial Index For Active Data

If most cases are closed, but hot writes/reads target active cases:

```javascript
db.cases.createIndex(
  { tenantId: 1, assigneeId: 1, dueAt: 1 },
  {
    partialFilterExpression: {
      status: { $in: ["OPEN", "UNDER_REVIEW", "ESCALATED"] }
    }
  }
)
```

Benefit:

- smaller index,
- lower memory,
- lower write cost for closed cases,
- faster active queue queries.

Caution:

- query must include matching filter,
- partial index only applies when planner can prove condition,
- operational complexity increases.

---

## 37. Write Path and Sharding Preview

Part 021 covers sharding deeply, but write path must acknowledge it.

In sharded clusters, write performance depends heavily on shard key.

Good write routing:

```text
targeted write to one shard
```

Bad:

```text
scatter-gather write
```

Shard key should support:

- cardinality,
- distribution,
- query targeting,
- write distribution,
- tenant/jurisdiction strategy,
- avoidance of monotonic hot range.

If `tenantId` is shard key and one tenant dominates, hot tenant can dominate one shard.

If `createdAt` is shard key, newest writes can hotspot.

Shard key is performance architecture, not configuration detail.

---

## 38. Write Concern and Replication Lag

With stronger write concern, latency may increase when secondaries lag.

Symptoms:

```text
write latency high
primary CPU okay
replication lag high
w:majority writes slow
```

Causes:

- secondary disk slow,
- network latency,
- index build,
- large writes,
- delete storm,
- batch migration,
- resource saturation.

Do not solve by lowering write concern blindly.

Ask:

```text
Is durability requirement still valid?
Is lag transient?
Which workload caused lag?
Can background jobs be throttled?
Are secondaries underprovisioned?
Is write batch too large?
```

---

## 39. Journaling and Durability Concept

Journaling helps durability in crash scenarios.

As application engineer, you do not usually tune storage internals daily, but you must understand:

```text
acknowledged write does not always mean same durability level
write concern settings matter
crash/restart behavior matters
```

For critical business commands, choose write concern deliberately.

---

## 40. Change Streams and Write Path Cost

Change streams observe changes.

They are useful for:

- projection update,
- cache invalidation,
- search indexing,
- integration observer,
- audit enrichment.

But write-heavy systems with many change stream consumers can create downstream pressure.

Important:

```text
write success should not depend on slow change stream consumer
unless explicitly part of transaction/command flow
```

If projections lag:

- UI may see stale read model,
- search index delayed,
- dashboard delayed.

Need:

- lag metrics,
- resume token storage,
- idempotent consumer,
- replay strategy,
- dead-letter handling.

---

## 41. Audit Write Strategy

Regulated systems need strong audit.

Bad:

```text
update case status
then best-effort log audit
if audit fails, ignore
```

Maybe unacceptable.

Options:

### 41.1 Same Document

Embed transition history in case.

Pros:

- single-document atomicity.
- simple read for small history.

Cons:

- unbounded growth.
- hot document.
- p99 detail fetch.

### 41.2 Transaction: Case + Audit Event

Use transaction to update case and insert audit event.

Pros:

- stronger atomicity.

Cons:

- transaction overhead.
- complexity.
- retry handling.

### 41.3 Event-Sourced Command Log

Write immutable command/event first, derive state.

Pros:

- strong audit trail.

Cons:

- bigger architecture.

### 41.4 Outbox Pattern

Update case and insert outbox/audit record in same transaction or carefully designed atomic boundary.

For critical lifecycle transitions, prefer a design where state change and audit record cannot silently diverge.

---

## 42. Transaction Cost

Transactions are useful, but not free.

Costs:

- session management,
- snapshot/transaction state,
- commit coordination,
- potential retries,
- longer locks/resource retention,
- more complex error handling,
- larger failure surface,
- sharded transaction overhead if multi-shard.

Avoid transaction for everything.

Use transaction when:

```text
multiple documents must change atomically
and inconsistent intermediate state is unacceptable
```

Avoid when:

```text
single document atomic update is enough
eventual projection acceptable
workflow can be represented as idempotent steps
```

---

## 43. Transaction Retry Semantics

Transaction errors can include:

```text
TransientTransactionError
UnknownTransactionCommitResult
```

Application must handle:

```text
transaction may have committed even if client didn't receive result
```

Hence idempotency matters even with transaction.

Pseudo:

```java
executeTransactionWithRetry(() -> {
    insertIdempotencyRecord(commandId);
    updateCaseWithGuard(...);
    insertAuditEvent(...);
    markCommandCompleted(...);
});
```

If commit result unknown, retry must not duplicate audit/event/side-effect.

---

## 44. Side Effects and Database Writes

Never mix external side effects casually inside DB transaction.

Bad:

```text
start transaction
update case
send email
insert audit
commit
```

If commit fails after email sent, inconsistency.

Better:

```text
transaction:
  update case
  insert audit
  insert outbox notification

after commit:
  outbox worker sends email
```

Outbox worker idempotently sends external side effect.

This is not MongoDB-specific; it is distributed systems hygiene.

---

## 45. Outbox Pattern With MongoDB

Outbox document:

```javascript
{
  _id: "outbox:case-1:transition-999:notify",
  tenantId: "t1",
  aggregateType: "CASE",
  aggregateId: "case-1",
  eventType: "CASE_ESCALATED",
  payload: {...},
  status: "PENDING",
  availableAt: ISODate(...),
  attempt: 0,
  createdAt: ISODate(...),
  processedAt: null
}
```

Worker claims:

```javascript
findOneAndUpdate(
  { status: "PENDING", availableAt: { $lte: now } },
  {
    $set: {
      status: "PROCESSING",
      leaseUntil: leaseUntil,
      workerId: workerId
    },
    $inc: { attempt: 1 }
  },
  { sort: { availableAt: 1, _id: 1 } }
)
```

Then sends to Kafka/RabbitMQ/email/search index.

Completion:

```javascript
{ $set: { status: "DONE", processedAt: now } }
```

Failure:

```javascript
{ $set: { status: "PENDING", availableAt: retryAt, lastError: ... } }
```

Need:

- idempotent downstream key,
- max attempts,
- dead-letter,
- observability,
- cleanup/retention.

---

## 46. Write Skew and Application Invariants

MongoDB can enforce some invariants via single-document atomicity and unique indexes.

But cross-document invariant needs careful design.

Example:

```text
At most 5 active cases assigned to reviewer.
```

Naive flow:

```text
count active cases
if count < 5:
  assign new case
```

Concurrent requests can both pass count.

Solutions:

1. reviewer workload document with atomic counter,
2. transaction,
3. unique/slot documents,
4. queue assignment service,
5. accept eventual consistency and reconcile if business allows.

Atomic slot pattern:

```javascript
reviewer_slots
{
  _id: "tenant:t1:reviewer:u1:slot:1",
  caseId: "case-1",
  active: true
}
```

Try insert into available slot with unique key/invariant.

Design depends on invariant strictness.

---

## 47. Write Path For State Machines

State transition write should:

1. validate tenant/security,
2. validate current state,
3. validate version,
4. apply state change,
5. record transition metadata,
6. record audit/outbox,
7. return deterministic result,
8. be idempotent.

Command:

```json
{
  "commandId": "cmd-123",
  "caseId": "case-1",
  "expectedVersion": 7,
  "action": "ESCALATE",
  "reason": "SLA breach"
}
```

Write:

```javascript
db.cases.updateOne(
  {
    _id: "case-1",
    tenantId: "t1",
    status: "UNDER_REVIEW",
    version: 7
  },
  {
    $set: {
      status: "ESCALATED",
      escalationReason: "SLA breach",
      updatedAt: now
    },
    $inc: { version: 1 }
  }
)
```

Then audit/outbox according to atomicity requirement.

---

## 48. Handling Duplicate Key

Duplicate key is not always “error”.

For idempotency:

```text
duplicate idempotency key = command already processed/in progress
```

For natural key creation:

```text
duplicate caseNumber = conflict
```

For audit event:

```text
duplicate event id = already recorded
```

For user create:

```text
duplicate email = validation conflict
```

Do not map all duplicate key errors to HTTP 500.

Classify by index/invariant.

---

## 49. Error Taxonomy For Write Path

Create application error taxonomy:

```text
VALIDATION_FAILED
NOT_FOUND
FORBIDDEN
CONFLICT_VERSION
INVALID_STATE
DUPLICATE_KEY
TRANSIENT_DATABASE_ERROR
DATABASE_TIMEOUT
UNKNOWN_COMMIT_RESULT
BACKPRESSURE_REJECTED
```

Each has different response/retry behavior.

Example:

```text
CONFLICT_VERSION:
  client may refresh and retry with new version

TRANSIENT_DATABASE_ERROR:
  application may retry if idempotent and within deadline

DUPLICATE_KEY:
  conflict or idempotent success depending key

BACKPRESSURE_REJECTED:
  return 429/503 with retry-after depending API type
```

---

## 50. Observability: Write Operation Labels

Metrics should be labelled by use case, not only collection.

Bad:

```text
mongodb.update.duration
```

Better:

```text
mongodb.command.duration{
  operation="case.transition.escalate",
  collection="cases",
  command="updateOne"
}
```

Track:

```text
duration
pool checkout
matched count
modified count
upsert count
duplicate key count
timeout count
retry count
write concern error
transaction retry count
bulk partial failure count
```

---

## 51. Write Concern Errors vs Write Errors

Different categories:

```text
write error:
  operation itself failed, e.g. duplicate key

write concern error:
  write may have been applied but requested acknowledgement condition failed
```

This distinction matters.

Example:

```text
primary applied write
but majority acknowledgement failed before timeout
```

Application cannot simply assume not written.

Need careful retry/idempotency.

---

## 52. Command Result Logging

Do not log full sensitive document.

Log:

```text
operation
tenant
aggregate id
command id
matchedCount
modifiedCount
upsertedId present?
duration
retry attempt
correlation id
```

Example:

```text
case.transition result:
  tenant=t1
  caseId=case-1
  commandId=cmd-123
  from=UNDER_REVIEW
  to=ESCALATED
  matched=1
  modified=1
  durationMs=17
```

For failure:

```text
case.transition conflict:
  tenant=t1
  caseId=case-1
  commandId=cmd-123
  expectedVersion=7
  matched=0
  durationMs=8
```

---

## 53. Avoid Full Document Save In Spring Data

Spring Data `save` often feels natural.

But for write-hot aggregate:

```java
caseRepository.save(caseDocument);
```

Can imply full replacement/upsert-like behavior depending repository semantics.

For targeted updates, prefer:

```java
Query query = Query.query(
    Criteria.where("_id").is(caseId)
        .and("tenantId").is(tenantId)
        .and("status").is("UNDER_REVIEW")
        .and("version").is(expectedVersion)
);

Update update = new Update()
    .set("status", "ESCALATED")
    .set("updatedAt", now)
    .inc("version", 1);

UpdateResult result = mongoTemplate.updateFirst(query, update, CaseDocument.class);
```

This is clearer for concurrency and performance.

---

## 54. Bulk Import Architecture

Bad import:

```text
read CSV
for each row:
  insertOne
no idempotency
no checkpoint
no rate limit
no validation report
```

Production import needs:

1. import session document,
2. deterministic row identity,
3. validation phase,
4. batch write,
5. unordered where possible,
6. checkpoint,
7. error collection,
8. rate limiting,
9. resume,
10. reconciliation summary.

Collections:

```text
imports
import_errors
target_collection
```

Import session:

```javascript
{
  _id: "import-20260621-001",
  tenantId: "t1",
  status: "RUNNING",
  totalRows: 1000000,
  processedRows: 250000,
  successRows: 249900,
  failedRows: 100,
  lastOffset: 250000,
  startedAt,
  updatedAt
}
```

Target upsert key:

```javascript
{ tenantId, sourceSystem, sourceId }
```

Unique index required.

---

## 55. Write Path For High-Volume Audit

Audit events are append-heavy.

Design:

```javascript
{
  _id: "case-1:seq-000000001",
  tenantId: "t1",
  caseId: "case-1",
  sequence: 1,
  action: "CREATED",
  actorId: "u1",
  at: ISODate(...),
  payload: {...}
}
```

Index:

```javascript
{ tenantId: 1, caseId: 1, sequence: 1 }
{ tenantId: 1, at: -1 }
```

Do not over-index payload fields unless query needs them.

If audit query is mostly by caseId:

```text
optimize for caseId + sequence
```

If audit compliance search needs actor/time/action:

```text
consider additional indexes or separate search projection
```

Avoid embedding massive audit in `cases`.

---

## 56. Outlier Write Handling

Some aggregates receive far more writes than others.

Example:

```text
normal case: 20 audit events
large investigation case: 500,000 audit events
```

If using same embedded structure, outliers ruin p99.

Design for outlier:

- separate events collection,
- bucket events,
- summary count in case,
- latest N events embedded only,
- archive old events,
- dedicated retrieval API.

Example:

```javascript
{
  _id: caseId,
  latestAuditPreview: [
    { action, at, actorName }
  ],
  auditEventCount: 500000
}
```

Full audit endpoint paginates separately.

---

## 57. Write Amplification From Denormalization

Denormalization improves reads but can increase writes.

Example:

Case stores `assigneeName`.

If user changes display name, update many cases.

Options:

1. accept stale historical display name,
2. update only active cases,
3. resolve name at read time,
4. use separate user profile cache,
5. store immutable display snapshot for audit.

Do not blindly propagate all denormalized fields.

Classify denormalized fields:

```text
historical snapshot:
  should not update

current display:
  may update asynchronously

authorization-critical:
  should not be denormalized casually
```

---

## 58. Write Fan-Out

A single command can trigger many writes:

```text
close case
  update case
  insert audit
  insert outbox
  update worklist
  update dashboard counter
  update search projection
  notify parties
```

If all synchronous, latency and failure surface grow.

Better split:

Synchronous critical path:

```text
update case
insert audit/outbox
```

Async projections:

```text
worklist update
dashboard counter
search index
notification
```

But async requires:

- idempotent consumers,
- reconciliation,
- lag monitoring,
- eventual consistency UX,
- retry/dead-letter.

---

## 59. Write Path SLO

Define SLO by operation.

Example:

```text
case.transition:
  p95 < 100ms
  p99 < 500ms
  error rate < 0.1%
  duplicate side effect rate = 0
  audit divergence = 0

case.addNote:
  p95 < 150ms
  p99 < 700ms

bulk import:
  throughput 500 rows/s
  resumable
  no duplicate target records

archive job:
  max replication lag induced < 30s
  pauseable
```

Without SLO, performance conversation becomes vague.

---

## 60. Backpressure Response Semantics

When write capacity saturated, what should API return?

Options:

```text
429 Too Many Requests:
  caller is making too many requests, retry later

503 Service Unavailable:
  system temporarily unable to process

202 Accepted:
  accepted into durable queue for async processing

409 Conflict:
  state/version conflict, not load-related
```

Do not return 500 for intentional backpressure.

For user-facing command:

```text
try acquire write capacity
if unavailable:
  return 429/503 with safe retry guidance
```

For internal batch:

```text
pause/backoff
do not hammer DB
```

---

## 61. Tenant-Level Throttling

In multi-tenant systems, one tenant can overload shared database.

Implement:

```text
global write limiter
tenant write limiter
operation-specific limiter
```

Example:

```text
tenant A import job cannot starve tenant B interactive case transitions
```

Metrics by tenant:

```text
write QPS
write latency
error rate
retries
bulk job activity
```

Operationally sensitive, but necessary for shared platforms.

---

## 62. Write Path Capacity Planning

Ask:

```text
What writes happen per user action?
How many indexes are touched?
How large are documents?
How often are status fields updated?
How many audit events per command?
What is peak QPS?
What is batch job schedule?
How much replication lag is acceptable?
What write concern is required?
Are writes evenly distributed?
Are there hot keys?
```

Example case transition:

```text
update cases: 1
insert audit: 1
insert outbox: 1
update worklist: async
update dashboard: async
```

Peak:

```text
200 transitions/sec
=> 200 case updates/sec
=> 200 audit inserts/sec
=> 200 outbox inserts/sec
=> index maintenance across all
```

If each has multiple indexes, actual write load is larger.

---

## 63. Performance Test For Write Path

Test scenarios:

1. single case transition,
2. concurrent transition same case,
3. concurrent transitions different cases,
4. high-volume audit append,
5. bulk import,
6. archive delete batches,
7. TTL expiry spike,
8. duplicate command retry,
9. primary failover during write,
10. transaction unknown commit result,
11. secondary lag with majority writes,
12. background index build impact,
13. tenant import while others use UI.

Measure:

```text
p50/p95/p99
throughput
timeouts
retry count
duplicate key
matched=0 conflicts
replication lag
CPU
disk I/O
pool checkout
GC
```

---

## 64. Designing Predictable Write Latency

Predictability comes from:

1. bounded document size,
2. bounded arrays,
3. limited index count,
4. targeted updates,
5. avoiding hot documents,
6. using idempotency,
7. controlling batch sizes,
8. applying backpressure,
9. separating background workloads,
10. using appropriate write concern,
11. measuring p99,
12. rehearsing failure.

Unpredictability comes from:

- unbounded arrays,
- large random document growth,
- broad updateMany/deleteMany,
- retry storms,
- over-indexing,
- hot counters,
- synchronized TTL expiration,
- full document replacement,
- no tenant throttling,
- no observability.

---

## 65. Senior-Level Heuristics

Use these heuristics in design reviews:

```text
If write modifies a field in many indexes, ask if all indexes are necessary.

If write appends to an array, ask for the upper bound.

If upper bound is unknown, split the data.

If retry is possible, require idempotency key.

If command has external side effect, use outbox.

If operation scans then updates many docs, make it resumable and rate-limited.

If one document coordinates many actors, look for hot document.

If a counter must be exact and sequential, confirm business truly requires it.

If TTL deletes many docs at same time, expect cleanup spike.

If a background job shares resources with user traffic, add bulkhead/backpressure.

If write concern is lowered for performance, record the risk explicitly.
```

---

## 66. Practical Exercise

Design write path for this command:

```text
Escalate a regulatory case.

Requirements:
- must only escalate from UNDER_REVIEW
- actor must be authorized
- command may be retried by API gateway
- audit trail must not diverge from state transition
- notification should eventually be sent
- dashboard can lag by up to 30 seconds
- search index can lag by up to 60 seconds
- concurrent escalation attempts should not duplicate side effects
```

Propose:

1. collections involved,
2. indexes,
3. write concern,
4. transaction or non-transaction design,
5. idempotency strategy,
6. state transition update,
7. audit write,
8. outbox write,
9. retry behavior,
10. metrics.

Suggested design:

```text
collections:
  cases
  command_deduplication
  case_audit_events
  outbox_events

critical transaction:
  insert command_deduplication with commandId
  update case with tenantId + caseId + status + version guard
  insert audit event with deterministic event id
  insert outbox event with deterministic id
  mark command completed

async:
  notification worker consumes outbox
  dashboard projection worker updates counters
  search projection worker updates search index
```

Index examples:

```javascript
cases:
  { tenantId: 1, _id: 1 }
  { tenantId: 1, status: 1, assigneeId: 1, dueAt: 1 }

command_deduplication:
  { tenantId: 1, commandId: 1 } unique

case_audit_events:
  { tenantId: 1, caseId: 1, sequence: 1 }
  { tenantId: 1, at: -1 }

outbox_events:
  { status: 1, availableAt: 1, _id: 1 }
```

---

## 67. Summary

Write performance in MongoDB is shaped by more than raw insert speed.

Key points:

1. Insert/update/delete all pay index maintenance cost.
2. Mutable indexed fields increase write amplification.
3. Replacement updates can be dangerous for correctness and performance.
4. Bulk writes need idempotency, batch sizing, and checkpointing.
5. Retryable writes still require application-level idempotency.
6. Hot documents and global counters can cap throughput.
7. Queue-like workloads need lease, backoff, and realistic expectations.
8. TTL cleanup is eventual and can create delete spikes.
9. Archival is a write-path and compliance design, not just storage cleanup.
10. Backpressure prevents overload collapse.
11. Retry storm is a system failure amplifier.
12. Transactions are useful but need retry/commit uncertainty handling.
13. Outbox pattern separates critical state change from external side effects.
14. Observability must label write use cases and interpret write results.
15. Predictable write latency requires bounded data, controlled concurrency, and explicit failure semantics.

The most important sentence:

> A reliable MongoDB write path is not just fast; it is bounded, idempotent, observable, backpressured, and aligned with the business invariant it protects.

---

## 68. Bridge to Part 020

Part 020 will move from single-node/write-path concerns to distributed availability:

- replica set mental model,
- primary election,
- oplog,
- replication lag,
- read preference,
- read concern,
- write concern,
- failover behavior from Java apps,
- stale reads,
- monotonic read expectations,
- causal consistency,
- disaster recovery,
- backup/restore,
- HA testing,
- production runbook.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-020.md
```

Judul berikutnya:

```text
Part 020 — Replication, High Availability, Read Scaling, and Failure Modes
```

---

## 69. Status Seri

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
```

Seri belum selesai. Masih lanjut ke Part 020 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Performance Engineering I: Query, Index, Memory, Working Set</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-020.md">Part 020 — Replication, High Availability, Read Scaling, and Failure Modes ➡️</a>
</div>

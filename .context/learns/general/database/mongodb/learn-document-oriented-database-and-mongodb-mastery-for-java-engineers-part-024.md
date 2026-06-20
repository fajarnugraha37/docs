# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-024.md

# Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 024 dari 035  
> Fokus: change streams, oplog-derived observation, resume token, full document lookup, idempotent consumers, projection update, cache invalidation, search indexing, outbox comparison, Kafka/RabbitMQ boundary, backpressure, ordering, failure handling, dan Java implementation patterns  
> Target pembaca: Java software engineer / tech lead yang ingin memakai MongoDB dalam arsitektur event-driven tanpa mencampuradukkan database, CDC, outbox, message broker, dan event log

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas security. Bagian ini masuk ke integrasi event-driven.

MongoDB sering dipakai bersama:

- read model,
- search index,
- cache,
- dashboard summary,
- outbox worker,
- audit enrichment,
- notification pipeline,
- data sync,
- async projection.

MongoDB menyediakan **change streams**, yaitu mekanisme untuk mengamati perubahan data pada collection/database/deployment. Ini sangat berguna, tetapi sering disalahpahami.

Kesalahan umum:

```text
MongoDB change stream = Kafka topic
```

atau:

```text
Kalau ada change stream, tidak perlu outbox
```

atau:

```text
Semua business event cukup ambil dari update database
```

Itu berbahaya.

Kalimat inti:

> Change stream adalah observasi perubahan database; business event adalah kontrak domain. Keduanya bisa berhubungan, tetapi tidak identik.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan change stream sebagai mekanisme observasi perubahan.
2. Memahami hubungan change stream dengan oplog/replication.
3. Membedakan event database-level dan event domain/business-level.
4. Menjelaskan resume token dan failure recovery.
5. Memahami full document lookup dan update event shape.
6. Mendesain consumer yang idempotent.
7. Memahami ordering limitation.
8. Mendesain backpressure handling.
9. Membandingkan change stream vs outbox pattern.
10. Membandingkan change stream vs Kafka/RabbitMQ.
11. Menentukan use case yang cocok untuk change stream.
12. Menentukan use case yang tidak cocok.
13. Mengimplementasikan change stream consumer di Java secara aman.
14. Mendesain observability dan runbook untuk stream lag, resume failure, dan projection corruption.

---

## 2. Change Stream Mental Model

Change stream memungkinkan aplikasi menerima event ketika data berubah.

Contoh perubahan:

```text
insert document
update document
replace document
delete document
invalidate collection/database stream
```

Secara konseptual:

```text
application writes to MongoDB
MongoDB records change in replication log/oplog
change stream exposes ordered stream of change events
consumer reads events
consumer updates downstream system
```

Diagram:

```text
Case Service
    |
    | update cases
    v
MongoDB Primary
    |
    | replication log / oplog
    v
Change Stream
    |
    +--> Search Projection Consumer
    +--> Cache Invalidation Consumer
    +--> Dashboard Projection Consumer
```

Important:

```text
Change stream observes database changes after they happen.
It is not the command handler.
It is not the domain validation layer.
It is not automatically a durable external event contract.
```

---

## 3. Database Change Event vs Domain Event

Database change event says:

```text
document X in collection cases changed
field status updated from/to maybe available depending configuration
```

Domain event says:

```text
CaseEscalated
CaseAssigned
EvidenceSubmitted
DecisionApproved
LegalHoldApplied
```

Database event is physical/persistence-level.

Domain event is semantic/business-level.

Example database update:

```javascript
db.cases.updateOne(
  { tenantId: "t1", caseId: "C-001" },
  {
    $set: {
      status: "ESCALATED",
      updatedAt: now
    }
  }
)
```

Change stream may say:

```json
{
  "operationType": "update",
  "ns": { "db": "app", "coll": "cases" },
  "documentKey": { "_id": "..." },
  "updateDescription": {
    "updatedFields": {
      "status": "ESCALATED",
      "updatedAt": "..."
    },
    "removedFields": []
  }
}
```

Domain event should say:

```json
{
  "eventType": "CaseEscalated",
  "tenantId": "t1",
  "caseId": "C-001",
  "transitionId": "TR-999",
  "actorId": "u123",
  "reason": "SLA breach",
  "occurredAt": "..."
}
```

The domain event contains intent and context. The database change event may not.

---

## 4. Why This Distinction Matters

If downstream systems need to know **what happened semantically**, change stream alone can be insufficient.

Example:

```text
status changed to ESCALATED
```

Could be caused by:

- manual escalation,
- automatic SLA escalation,
- migration correction,
- restore operation,
- admin override,
- replay,
- test data seeding,
- compensation.

Change stream sees updated field.

Business event should distinguish cause.

Therefore:

```text
Use change streams for observing persistence changes.
Use outbox/domain events for explicit integration contracts.
```

---

## 5. Good Use Cases For Change Streams

Change streams are good for:

### 5.1 Cache invalidation

```text
case changed -> invalidate cache key
```

### 5.2 Search indexing

```text
case changed -> update search document
```

### 5.3 Read model projection

```text
case changed -> update worklist summary
```

### 5.4 Dashboard materialization

```text
case status changed -> recompute/update counters
```

### 5.5 Audit enrichment

If audit is already reliable elsewhere, change stream can enrich secondary logs.

### 5.6 UI notification trigger

```text
document changed -> notify UI refresh
```

But be careful if notification is business-critical.

### 5.7 Data sync to non-critical systems

```text
update analytics staging
```

### 5.8 Operational monitoring

```text
watch unusual delete/update patterns
```

---

## 6. Bad Use Cases For Change Streams

Change streams are not ideal as sole mechanism for:

### 6.1 Critical business event contract

External systems need guaranteed semantic event with reason/actor/schema.

Use outbox/domain event.

### 6.2 High-throughput durable event log

Kafka/event streaming platform is better.

### 6.3 Long-retention replayable event history

Change stream is not a long-term event store.

### 6.4 Complex fanout integration

If many consumers, independent offsets, long replay, backpressure isolation are needed, use broker/event log.

### 6.5 Command validation

Change stream reacts after write; it cannot enforce pre-write invariant.

### 6.6 Exactly-once side effects

Change stream consumers still need idempotency.

### 6.7 Cross-system transactional side effects

Use outbox with idempotent dispatch.

---

## 7. Change Stream vs Outbox Pattern

### 7.1 Change Stream

```text
source:
  database oplog/change event

event meaning:
  document changed

producer:
  MongoDB itself

consumer offset:
  resume token

schema:
  database change event shape

best for:
  projections, cache invalidation, indexing, internal observers
```

### 7.2 Outbox

```text
source:
  application writes explicit event document

event meaning:
  business event

producer:
  domain command handler

consumer offset:
  application-defined

schema:
  domain event contract

best for:
  integration, external event publishing, side effects, reliable domain events
```

### 7.3 Key Difference

Change stream asks:

```text
What changed in database?
```

Outbox asks:

```text
What business event did the application commit?
```

---

## 8. Change Stream vs Kafka/RabbitMQ

You already covered Kafka and RabbitMQ in prior series, so here we focus on boundary.

### Change Stream

```text
database observation
low setup if data already in MongoDB
consumer reads DB changes
limited as durable event platform
not primarily designed for independent consumer groups and long-term replay
```

### Kafka

```text
distributed event log
high-throughput stream processing
consumer groups
retention/replay
topic contracts
event-first architecture
```

### RabbitMQ

```text
message broker
routing/exchanges/queues
work distribution
delivery semantics
task/message workflows
```

Use change stream when:

```text
MongoDB is source of change and downstream is internal projection/cache/search
```

Use Kafka/RabbitMQ when:

```text
event/message is first-class integration contract
many services need durable decoupled consumption
retention/replay/fanout/backpressure semantics matter
```

---

## 9. Change Stream Event Shape

A change event can contain fields like:

```text
_id / resume token
operationType
clusterTime
wallTime
ns
documentKey
fullDocument
updateDescription
fullDocumentBeforeChange depending configuration
```

Common operation types:

```text
insert
update
replace
delete
invalidate
drop
rename
dropDatabase
```

Exact fields depend on operation, options, and MongoDB version/configuration.

Do not write consumers that assume every event has full document unless configured.

---

## 10. Resume Token

Every change stream event includes a resume token.

Consumer stores resume token after processing.

If consumer crashes:

```text
load last resume token
resume stream after token
continue
```

Pseudo:

```text
for each event:
  process event idempotently
  persist resume token
```

Important ordering:

```text
Do not persist resume token before side effect is durable,
unless side effect is idempotently recoverable.
```

If you save token first and crash before projection update, event is lost from consumer perspective.

If you process first then crash before token save, event may reprocess. Therefore consumer must be idempotent.

This is classic at-least-once consumer design.

---

## 11. Resume Token Storage

Store resume token per consumer.

Collection:

```text
change_stream_offsets
```

Document:

```javascript
{
  _id: "consumer:case-search-indexer:v1",
  consumerName: "case-search-indexer",
  streamScope: "app.cases",
  resumeToken: { ... },
  lastClusterTime: Timestamp(...),
  lastProcessedAt: ISODate(...),
  lastEventId: "...",
  status: "RUNNING",
  updatedAt: ISODate(...)
}
```

For multiple partitions/consumer instances, define ownership/lease.

Do not store only in memory.

---

## 12. At-Least-Once Processing

Change stream consumers should assume at-least-once delivery.

This means event may be processed more than once.

Consumer must be idempotent.

Example search index update:

```text
event for case C-001 version 8
```

Projection writes:

```javascript
db.case_search_documents.updateOne(
  { tenantId, caseId },
  {
    $set: {
      ...projectionFields,
      sourceVersion: 8,
      updatedAt: now
    }
  },
  { upsert: true }
)
```

If same event reprocessed, result remains same.

Better with version guard:

```javascript
{
  tenantId,
  caseId,
  sourceVersion: { $lt: eventVersion }
}
```

But if version missing, use event timestamp/order carefully.

---

## 13. Idempotent Consumer Pattern

Consumer event has:

```text
source collection
document key
document version
operation type
resume token / event id
```

Projection document stores:

```javascript
{
  tenantId,
  caseId,
  projectedFromVersion: 8,
  projectedFromClusterTime: ...,
  lastResumeTokenHash: "..."
}
```

On event:

```text
if event version <= projectedFromVersion:
  ignore

else:
  apply projection
```

If no version field, consider:

- updatedAt,
- clusterTime,
- deterministic replacement,
- replay-safe recompute from source document.

Best projection pattern:

```text
event tells which source changed
consumer reads source-of-truth document
recomputes projection deterministically
upserts projection
```

Then duplicate events are less harmful.

---

## 14. Full Document Lookup

For update events, change stream may include only changed fields unless configured to lookup full document.

Options conceptually:

```text
default:
  updateDescription only

fullDocument: updateLookup:
  include current full document after update
```

Trade-off:

```text
updateDescription:
  smaller event
  less data transfer
  consumer may need source read

fullDocument:
  easier projection
  larger payload
  can include sensitive fields
  extra lookup/cost
```

For security, avoid streaming full sensitive documents to consumers that do not need them.

---

## 15. Before Change / Pre-Images

Some MongoDB configurations support pre-images for change streams.

This can provide document state before change.

Useful for:

- diff computation,
- audit enrichment,
- counter decrement/increment,
- transition detection.

Costs/risks:

- storage overhead,
- sensitive data duplication,
- retention/security implications,
- version-specific setup.

If audit is legally important, do not rely casually on pre-images unless operationally guaranteed and tested.

Often better: command handler writes explicit audit event.

---

## 16. Detecting Meaningful Changes

Not every update should trigger downstream action.

Example update:

```javascript
{ $set: { lastViewedAt: now } }
```

should not update search index.

Consumer should filter:

```text
operationType
namespace
changed fields
document status
tenant
source version
```

Example:

```java
boolean relevant = changedFields.contains("status")
    || changedFields.contains("title")
    || changedFields.contains("parties")
    || changedFields.contains("permissions");
```

Avoid heavy downstream writes for irrelevant changes.

---

## 17. Watch Scope

You can watch at different scopes:

```text
collection
database
deployment/cluster
```

Prefer narrow scope when possible.

Collection-specific consumer is easier to reason about:

```text
watch app.cases for case projections
watch app.outbox_events for dispatch
watch app.case_documents for document index
```

Database/cluster-level watchers need more filtering and stronger discipline.

---

## 18. Pipeline Filtering

Change stream supports aggregation pipeline filtering.

Example conceptual filter:

```javascript
[
  {
    $match: {
      "ns.coll": "cases",
      "operationType": { $in: ["insert", "update", "replace", "delete"] }
    }
  }
]
```

Filter early to reduce consumer load.

But do not make pipeline so clever that it becomes unmaintainable.

---

## 19. Ordering Semantics

Within a single shard/replica set stream, change events have an order. In sharded clusters or multiple collections/consumers, ordering can be more complex.

Design principle:

```text
Do not rely on global total ordering unless explicitly guaranteed for your scope and tested.
```

For per-aggregate projections, use aggregate version:

```text
case.version
```

Then consumer can ignore stale/out-of-order events.

Example:

```javascript
{
  caseId: "C-001",
  version: 9
}
```

Projection applies only if:

```text
event.version > projection.version
```

This is robust even if events arrive weirdly.

---

## 20. Delete Events

Delete events may only contain document key, not full document.

If projection cleanup needs tenantId but document key does not contain tenantId, problem.

Design document key wisely.

Options:

1. `_id` includes tenantId.
2. store tenantId in projection key.
3. use pre-image if configured.
4. handle delete through explicit outbox event.
5. soft delete instead of hard delete and project from update event.

For regulated systems, soft delete/retention transition often better than hard delete.

Example:

```javascript
{
  tenantId,
  caseId,
  status: "DELETED",
  deletedAt: now
}
```

Change stream update includes tenant/status and projection can remove/mark.

---

## 21. Replace Events

Replace event means whole document replaced.

Consumers must handle:

```text
operationType = replace
fullDocument maybe present
updateDescription absent or different
```

If your code only handles `update`, projection will miss replace.

In production, avoid full replacement for important aggregates when possible, but consumers should still be robust.

---

## 22. Invalidate Events

Certain operations can invalidate streams, such as collection drop/rename depending scope.

Consumer must handle invalidation:

```text
alert
stop
restart with new stream if appropriate
manual intervention
full rebuild if needed
```

Do not silently ignore.

---

## 23. Change Stream Lag

Lag = consumer is behind current database changes.

Causes:

- consumer down,
- downstream slow,
- projection writes slow,
- fullDocument lookup heavy,
- high write volume,
- network issue,
- backpressure,
- resume failure,
- too many irrelevant events,
- bad filter.

Measure:

```text
last processed clusterTime/wallTime
current time
events processed/sec
events failed/sec
projection latency
resume token update latency
consumer loop error count
```

Expose:

```text
change_stream_lag_seconds{consumer="case-search-indexer"}
```

---

## 24. Backpressure

If downstream system is slow, change stream consumer must not blindly buffer unbounded events in memory.

Bad:

```text
read stream as fast as possible
put events into unbounded queue
downstream slow
heap grows
process dies
```

Better:

- bounded queue,
- controlled concurrency,
- pause/backoff,
- batch updates,
- circuit breaker,
- persistent work queue if needed,
- consumer lag metrics,
- dead-letter for poison events.

If consumer cannot keep up, decide:

```text
scale consumer?
reduce event volume?
filter better?
batch writes?
rebuild projection instead?
use Kafka/outbox for decoupling?
```

---

## 25. Poison Events

Poison event = event that always fails processing.

Example:

- unexpected schema,
- missing field,
- projection code bug,
- encryption/decryption failure,
- invalid downstream payload,
- unauthorized tenant config.

If consumer loops retrying same poison event forever, stream stalls.

Pattern:

```text
retry limited times
record failure
dead-letter event
alert
advance or stop depending criticality
```

Dead-letter document:

```javascript
{
  _id: "consumer:case-search-indexer:event:<hash>",
  consumerName: "case-search-indexer",
  resumeToken: {...},
  eventSummary: {...},
  errorClass: "ProjectionSchemaError",
  errorMessage: "...sanitized...",
  attempts: 5,
  firstFailedAt,
  lastFailedAt,
  status: "OPEN"
}
```

For critical projections, you may stop consumer and require human action. For non-critical, skip with DLQ and alert.

---

## 26. Rebuild Strategy

Every projection should have rebuild plan.

Why?

- consumer bug,
- missed events,
- resume token expired/unavailable,
- projection schema change,
- downstream corruption,
- new projection field,
- search index recreation.

Rebuild options:

```text
full rebuild from source collection
tenant-scoped rebuild
case-scoped rebuild
time-window rebuild
parallel rebuild
blue/green projection
```

Example:

```text
case_search_documents_v1
case_search_documents_v2
```

Build v2 while v1 serves traffic, then switch.

Change streams are not a substitute for rebuild capability.

---

## 27. Resume Token Expiry / Oplog Window Risk

If consumer is down longer than available history window, resume may fail.

Response:

```text
consumer cannot resume from old token
must rebuild projection or start from now with reconciliation
```

Therefore:

- monitor lag relative to oplog/change history window,
- alert before token becomes unusable,
- keep rebuild path,
- keep consumers healthy.

For critical integration, use durable event log/outbox with retention if long replay is needed.

---

## 28. Change Stream Security

Change stream can expose sensitive data.

Controls:

```text
consumer DB user least privilege
watch only needed collections
avoid fullDocument unless needed
sanitize logs
secure resume token storage
tenant filtering downstream
encrypt sensitive projection stores
audit consumer access if needed
```

Never log full change event in production.

Bad:

```java
log.info("event={}", event);
```

Good:

```java
log.info("change event consumer={} op={} coll={} docKey={} clusterTime={}",
    consumerName, operationType, collectionName, safeDocKey, clusterTime);
```

---

## 29. Tenant Handling

For multi-tenant collections, every event must carry tenant context.

If full document unavailable on update/delete, tenantId may be missing.

Therefore:

- include tenantId in document key or `_id` where possible,
- use full document lookup for update if safe,
- use soft delete,
- explicit outbox for tenant-critical deletes,
- projection collection key includes tenantId.

Consumer must not update projection without tenant scope.

---

## 30. Change Stream For Search Indexing

Pattern:

```text
watch cases
on relevant insert/update/replace/delete:
  recompute search document
  upsert into search index/projection
```

Search document:

```javascript
{
  tenantId,
  caseId,
  title,
  status,
  partiesText,
  allegationsText,
  permissionsSnapshot,
  sourceVersion,
  indexedAt
}
```

Important:

- include authorization filters in search index,
- remove/update on delete/retention,
- avoid indexing fields user should not search,
- handle redaction,
- handle stale index after permission changes.

Search index is a data store with security implications.

---

## 31. Change Stream For Cache Invalidation

Cache invalidation event:

```text
case changed -> evict cache key tenantId:caseId
```

Consumer does not need full document.

Idempotent:

```text
evict same key twice is okay
```

Failure behavior:

```text
if consumer down, cache may be stale
use TTL on cache
manual flush capability
monitor lag
```

For correctness-sensitive data, do not rely only on async invalidation; use cache TTL/version validation.

---

## 32. Change Stream For Worklist Projection

Source:

```text
cases
```

Projection:

```text
case_worklist_items
```

On case change:

```text
if case active:
  upsert worklist item
else:
  remove worklist item
```

Projection document:

```javascript
{
  tenantId,
  caseId,
  assigneeId,
  status,
  dueAt,
  priority,
  title,
  sourceVersion,
  projectedAt
}
```

Indexes:

```javascript
{ tenantId: 1, assigneeId: 1, status: 1, dueAt: 1 }
```

This can make worklist query fast and targeted even if `cases` collection shard key differs.

---

## 33. Change Stream For Dashboard Counters

Dashboard counters are tricky.

Naive:

```text
on status update, increment new status count, decrement old status count
```

Requires before and after state.

Options:

1. use pre-image,
2. explicit domain event with before/after,
3. recompute tenant counter periodically,
4. maintain counters in command handler,
5. use projection rebuild/reconciliation.

For critical counters, use reconciliation:

```text
eventual counter updated by stream
daily/hourly job recomputes and fixes drift
```

Projection drift is normal risk; design detection.

---

## 34. Change Stream vs Command Handler Projection

Two approaches.

### 34.1 Command Handler Updates Projection

```text
command transaction:
  update case
  update worklist
  update counters
```

Pros:

- synchronous consistency,
- less lag.

Cons:

- command latency higher,
- more write coupling,
- transaction complexity,
- more failure surface.

### 34.2 Change Stream Updates Projection

```text
command:
  update case

consumer:
  updates projection later
```

Pros:

- decoupled,
- command faster,
- projection can be rebuilt,
- fewer synchronous dependencies.

Cons:

- eventual consistency,
- lag,
- consumer failure,
- projection drift.

Use based on freshness requirement.

---

## 35. Outbox + Change Stream Hybrid

A powerful pattern:

```text
command writes outbox event
change stream watches outbox collection
publisher publishes to Kafka/RabbitMQ
```

Flow:

```text
transaction:
  update case
  insert audit event
  insert outbox event

change stream consumer:
  watches outbox_events
  publishes event
  marks outbox event dispatched
```

This combines:

- explicit domain event contract,
- atomic write of outbox with state,
- async publishing,
- MongoDB observation for dispatcher.

But if outbox worker can simply poll `outbox_events`, change stream is optional. Polling with lease can be more controllable.

---

## 36. Polling Outbox vs Watching Outbox

### Polling Outbox

Pros:

- simple,
- explicit lease,
- backpressure easy,
- retry/dead-letter easy,
- works without change stream dependency.

Cons:

- polling overhead,
- latency depends on poll interval.

### Change Stream Outbox

Pros:

- low-latency notification,
- less empty polling,
- reacts quickly.

Cons:

- resume handling,
- stream failure complexity,
- still need idempotency and retry,
- may still need polling/reconciliation for missed stuck items.

Robust approach:

```text
change stream for wake-up
polling/reconciliation for reliability
```

---

## 37. Java Driver Change Stream Basic Pattern

Conceptual Java sync driver style:

```java
MongoCollection<Document> collection = database.getCollection("cases");

MongoCursor<ChangeStreamDocument<Document>> cursor =
    collection.watch().iterator();

while (cursor.hasNext()) {
    ChangeStreamDocument<Document> event = cursor.next();
    process(event);
}
```

Production version needs:

- resume token,
- error handling,
- backoff,
- shutdown,
- idempotency,
- metrics,
- logging,
- filtering,
- bounded concurrency,
- dead-letter,
- checkpoint ordering.

---

## 38. Java Consumer Structure

Suggested structure:

```text
ChangeStreamRunner
  - opens stream
  - resumes from token
  - loops events
  - handles transient errors/backoff
  - lifecycle/shutdown

ChangeEventHandler
  - validates event
  - extracts tenant/key/version
  - filters irrelevant changes
  - applies projection idempotently

OffsetStore
  - loads/saves resume token

DeadLetterStore
  - records poison events

Metrics
  - lag, processed count, failures, retries
```

Do not put all logic in one while loop.

---

## 39. Checkpoint Ordering Pattern

Pseudo:

```java
while (running) {
    ChangeEvent event = cursor.next();

    try {
        handler.processIdempotently(event);
        offsetStore.save(event.resumeToken());
        metrics.success(event);
    } catch (RetryableException e) {
        retryOrRestartStream(e);
    } catch (PoisonEventException e) {
        deadLetterStore.save(event, e);
        offsetStore.save(event.resumeToken()); // only if policy allows skip
        metrics.deadLetter(event);
    }
}
```

Policy decision:

```text
critical projection:
  stop on poison event

non-critical projection:
  dead-letter and advance
```

Be explicit.

---

## 40. Consumer Lease For Multiple Instances

If you run multiple instances of same consumer, avoid duplicate processing unless idempotent and acceptable.

Options:

1. single active instance with lease,
2. multiple idempotent consumers same stream,
3. partition by tenant,
4. partition by collection/shard if supported/appropriate,
5. use Kafka/outbox if many consumers.

Lease document:

```javascript
{
  _id: "consumer:case-search-indexer:v1",
  ownerId: "pod-123",
  leaseUntil: ISODate(...),
  heartbeatAt: ISODate(...)
}
```

Acquire with conditional update.

Even with lease, design idempotent. Leases can fail during partitions/crashes.

---

## 41. Batch Processing

For high volume, process in batches.

Batch risks:

- checkpoint after batch may reprocess batch,
- large batch increases memory,
- one poison event blocks batch,
- downstream bulk write partial failure.

Pattern:

```text
small bounded batch
idempotent bulk upserts
per-event dead-letter if needed
save checkpoint after durable batch success
```

For projections, unordered bulk writes can improve throughput if events independent.

---

## 42. Projection Versioning

Projection schema evolves.

Add fields:

```text
case_search_documents schema v2
```

Options:

1. lazy update on next source change,
2. background rebuild,
3. dual projection collection,
4. schemaVersion field.

Projection document:

```javascript
{
  tenantId,
  caseId,
  projectionVersion: 2,
  sourceVersion: 18,
  indexedAt
}
```

Query service can require version:

```javascript
{ projectionVersion: 2 }
```

or tolerate old version during migration.

---

## 43. Reconciliation Job

Every async projection should have reconciliation.

Example:

```text
nightly compare cases updatedAt > projection.projectedAt
enqueue rebuild
```

Or:

```text
sample random cases
recompute projection
compare hash
```

Projection document can store hash:

```javascript
{
  projectionHash: "sha256..."
}
```

Reconciliation detects drift caused by missed events, bugs, or manual repair.

---

## 44. Projection Lag UX

If worklist/search/dashboard is eventually consistent, user experience should reflect it.

Examples:

```text
"Search results may take up to 60 seconds to update."

"Dashboard last updated at 10:23:14."

After command:
  return updated case state directly, do not rely on search projection.

For worklist:
  optimistically remove item from current user's list after action.
```

Do not let users repeatedly act because projection lag shows stale action.

Backend state transition guard still protects correctness.

---

## 45. Exactly-Once Myth

Do not claim exactly-once unless you can prove end-to-end semantics.

Change stream consumer can provide effectively-once outcome if:

- event processing idempotent,
- deterministic projection,
- unique keys,
- version guards,
- offset stored after durable side effect,
- duplicate handling correct.

But delivery/execution may be at-least-once.

Use language:

```text
at-least-once processing
idempotent side effects
effectively-once projection state
```

This is more honest.

---

## 46. Change Stream and Transactions

Changes from transactions appear when transaction commits.

Consumers observe committed changes, not uncommitted intermediate changes.

However:

- multiple documents may generate multiple change events,
- consumer may need correlate transaction-related events,
- domain context may be missing unless stored in documents/outbox,
- ordering across collections may be complex.

If downstream needs a single semantic event for transaction, use outbox.

---

## 47. Multi-Collection Projection

Example projection requires:

```text
cases
case_parties
case_documents
permissions
```

Watching only `cases` is insufficient.

Options:

1. watch all source collections,
2. on any source change, recompute projection for affected case,
3. use explicit outbox event from command handler,
4. maintain projection synchronously,
5. scheduled reconciliation.

Event must identify affected aggregate:

```text
tenantId + caseId
```

If `case_documents` change event lacks caseId, projection cannot update efficiently.

Design source documents with aggregate reference.

---

## 48. Schema Evolution and Change Streams

When document schema changes, consumer may break.

Example:

```text
field assigneeId renamed to ownerUserId
```

Consumer expecting `assigneeId` fails or produces wrong projection.

Strategies:

- backward-compatible readers,
- schema version field,
- dual-write old/new field during migration,
- update consumer before producer removes old field,
- migration event/rebuild projection.

Async consumers must be part of schema migration plan.

---

## 49. Change Streams In Sharded Clusters

In sharded clusters, change streams are supported but operationally more complex:

- events from multiple shards,
- routing/merge,
- shard topology changes,
- chunk migration,
- per-shard lag,
- global ordering caveats.

Application principle:

```text
use per-aggregate versioning and idempotency instead of relying on global ordering
```

Observe lag and errors carefully.

---

## 50. Failure Mode: Consumer Down

Effects:

```text
projection stale
cache stale
search stale
dashboard stale
outbox not dispatched if dependent
lag grows
resume token may eventually become unusable
```

Runbook:

```text
1. Identify consumer down time.
2. Check lag.
3. Restart consumer.
4. Verify resume success.
5. Monitor catch-up rate.
6. If cannot resume, rebuild projection.
7. Validate downstream correctness.
```

---

## 51. Failure Mode: Resume Fails

Possible causes:

- token too old,
- collection dropped/renamed,
- topology/history issue,
- stored token corrupt,
- permission/config change.

Runbook:

```text
1. Stop consumer.
2. Preserve failing token.
3. Determine last successfully processed time.
4. Decide rebuild from source or start from now with reconciliation.
5. Run projection rebuild.
6. Reset offset after validation.
7. Document incident.
```

Do not just delete offset and start from now without understanding data loss.

---

## 52. Failure Mode: Projection Bug

Example:

```text
consumer ignored permission changes
search results leak stale access
```

Runbook:

```text
1. Disable affected projection/search if security risk.
2. Fix consumer.
3. Rebuild projection from source.
4. Verify authorization filters.
5. Audit potential exposure.
6. Add regression test.
```

Projection bugs can be security incidents.

---

## 53. Failure Mode: Downstream Slow

Example:

```text
search engine slow
consumer backs up
lag grows
```

Options:

- pause non-critical indexing,
- scale downstream,
- reduce full document lookup,
- batch updates,
- apply circuit breaker,
- allow search stale indicator,
- rebuild later.

Do not let consumer OOM due to unbounded buffering.

---

## 54. Observability Checklist

Metrics:

```text
events processed/sec
events failed/sec
consumer lag seconds
resume attempts
resume failures
dead-letter count
processing duration
downstream write duration
offset save duration
fullDocument lookup count
batch size
queue depth
rebuild progress
projection freshness
```

Logs:

```text
consumer name
operation type
collection
tenantId if safe
document key
resume token hash
cluster time
error classification
correlation if available
```

Alerts:

```text
lag > SLA
consumer stopped
resume failure
dead-letter count > 0
projection freshness too old
downstream failure spike
```

---

## 55. Security Checklist

```text
[ ] Consumer uses least-privileged DB user.
[ ] Watches only needed collections.
[ ] Does not log full events/documents.
[ ] Handles tenantId safely.
[ ] Does not stream sensitive fields unnecessarily.
[ ] Search/projection enforces authorization.
[ ] Resume tokens stored securely.
[ ] Dead-letter records sanitized.
[ ] Rebuild process respects tenant/security boundaries.
[ ] Projection deletion respects retention/legal hold.
```

---

## 56. Design Checklist

Before using change stream:

```text
[ ] What source collection?
[ ] What operation types matter?
[ ] Is full document needed?
[ ] Is tenantId available in event?
[ ] What is idempotency key?
[ ] How is resume token stored?
[ ] What is lag SLA?
[ ] What happens if consumer down 24h?
[ ] What happens if resume fails?
[ ] Is projection rebuild possible?
[ ] How are poison events handled?
[ ] Is ordering required?
[ ] Is per-aggregate version available?
[ ] Is this really a domain event use case?
[ ] Would outbox/Kafka/RabbitMQ be more appropriate?
```

---

## 57. Practical Exercise

Design event-driven integration for regulatory case platform.

Requirements:

```text
- case transitions must produce reliable domain events
- search index must update within 60 seconds
- dashboard can lag 30 seconds
- cache should invalidate quickly
- notifications should not be sent twice
- audit must never diverge from state transition
- system is multi-tenant
- some cases are confidential
```

Design:

1. which flows use outbox,
2. which flows use change streams,
3. event schemas,
4. resume token storage,
5. idempotency keys,
6. projection collections,
7. lag metrics,
8. rebuild process,
9. security controls,
10. failure runbooks.

Suggested direction:

```text
critical domain event:
  command transaction writes case + audit + outbox event

external integration/notification:
  outbox publisher, idempotent event id

search projection:
  change stream on cases/related collections or outbox-driven projection
  includes permission snapshot
  rebuildable

dashboard:
  async projection with reconciliation

cache:
  change stream invalidation, TTL fallback

audit:
  written by command handler, not inferred only from change stream
```

---

## 58. Senior-Level Heuristics

```text
If downstream needs business meaning, use domain event/outbox.

If downstream only needs to know data changed, change stream may fit.

If event must be replayed months later, use durable event log/outbox, not only change stream.

If consumer can crash, persist resume token after durable side effect.

If event can be processed twice, make side effect idempotent.

If projection cannot be rebuilt, it is operationally fragile.

If delete event lacks tenantId, hard delete may break projection cleanup.

If fullDocument includes sensitive data, every consumer is now sensitive.

If consumer lag can violate UX/security, monitor and alert it.

If global ordering is assumed, challenge the design.
```

---

## 59. Summary

Change streams are powerful but must be positioned correctly.

Key lessons:

1. Change stream observes database changes; it is not automatically a domain event stream.
2. Database change events lack business intent unless stored in data/outbox.
3. Use change streams for cache invalidation, search indexing, projections, and internal observers.
4. Use outbox/domain events for critical integration contracts and side effects.
5. Use Kafka/RabbitMQ when durable broker semantics, fanout, retention, and consumer groups matter.
6. Resume tokens are central to recovery.
7. Consumers must be idempotent.
8. Store offset after durable side effect.
9. Full document lookup is convenient but has cost and security implications.
10. Deletes and replaces need explicit handling.
11. Projection rebuild is mandatory operational capability.
12. Consumer lag must be measured and alerted.
13. Poison events need dead-letter or stop policy.
14. Multi-tenant and authorization context must flow through projections.
15. Exactly-once is usually an outcome of idempotent design, not a delivery guarantee.

The most important sentence:

> Use change streams as a database observation mechanism; use outbox or a broker when you need an explicit, durable, semantic integration contract.

---

## 60. Bridge to Part 025

Part 025 will focus on:

- time series use cases,
- time series collection mental model,
- measurement, metadata, time field,
- bucketing,
- metrics vs audit vs business events,
- append-only log modelling,
- TTL retention,
- partitioning by tenant/domain,
- querying time ranges,
- downsampling,
- rollups,
- immutable audit record design,
- legal hold,
- deletion vs archival,
- time series limitations,
- case event history design.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-025.md
```

Judul berikutnya:

```text
Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections
```

---

## 61. Status Seri

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
```

Seri belum selesai. Masih lanjut ke Part 025 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-025.md">Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections ➡️</a>
</div>

# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-025.md

# Part 025 — Time Series, Logs, Audit Trails, and Retention-Oriented Collections

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 025 dari 035  
> Fokus: time series collections, logs, audit trails, append-only modelling, metrics, retention, TTL, buckets, rollups, legal hold, archival, immutable evidence, dan desain event history  
> Target pembaca: Java software engineer / tech lead yang mendesain sistem MongoDB untuk telemetry, operational logs, audit trail, regulatory case history, retention-heavy records, dan high-volume append-oriented data

---

## 0. Posisi Part Ini Dalam Seri

Part 024 membahas change streams dan event-driven integration. Sekarang kita masuk ke data yang sangat sering berbentuk append-oriented:

```text
time series
logs
audit trails
business event history
metrics
retention records
```

Semuanya terlihat mirip karena sama-sama:

```text
ada timestamp
bertambah terus
jarang di-update
sering di-query berdasarkan waktu
butuh retention
```

Tetapi secara domain, mereka berbeda.

Kesalahan umum:

```text
Semua yang punya timestamp dimasukkan ke time series collection.
```

atau:

```text
Audit trail = log teknis.
```

atau:

```text
TTL cukup untuk compliance deletion.
```

Bagian ini akan membedakan masing-masing model, lalu menunjukkan kapan MongoDB time series collection cocok, kapan standard collection lebih baik, dan bagaimana mendesain audit/retention untuk sistem regulasi.

Kalimat inti:

> Time-oriented data bukan satu jenis data. Metrics, logs, audit trails, and business events have different invariants, query needs, retention rules, and legal meaning.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Membedakan time series, logs, audit trail, business event, dan retention record.
2. Menjelaskan kapan MongoDB time series collection cocok.
3. Mendesain `timeField`, `metaField`, dan granularity.
4. Memahami bucket mental model.
5. Memahami risiko high-cardinality/dynamic metadata.
6. Mendesain append-only logs dan audit trail secara defensible.
7. Memahami TTL untuk time series dan standard collection.
8. Mendesain retention dengan legal hold.
9. Membuat rollup/downsampling.
10. Membedakan deletion, archival, anonymization, dan legal preservation.
11. Mendesain query time range yang index-aware.
12. Mendesain event history untuk regulatory case lifecycle.
13. Membuat Java ingestion/query patterns untuk time-oriented data.
14. Membuat observability dan operational checklist.

---

## 2. Klasifikasi Data Berbasis Waktu

### 2.1 Metrics / Measurements

Contoh:

```text
CPU usage every 10 seconds
API latency p95 every minute
sensor temperature reading
case queue count every 5 minutes
```

Ciri:

- numeric/measurement-oriented,
- frequent writes,
- mostly append,
- query by time range and metadata,
- downsampling common,
- retention policy clear.

Good fit for time series collection.

### 2.2 Logs

Contoh:

```text
application log line
security log
integration failure log
worker processing log
```

Ciri:

- textual/semi-structured,
- high volume,
- often searched by text/correlation,
- retention defined,
- may be better in log platform.

MongoDB can store some logs, but not always best log analytics system.

### 2.3 Audit Trail

Contoh:

```text
user escalated case
admin changed retention policy
support accessed tenant data
legal hold applied
```

Ciri:

- legally/operationally meaningful,
- append-only,
- actor/action/reason/context,
- must be defensible,
- must not silently disappear,
- often retention/legal hold controlled.

Usually use standard collection with explicit schema/invariant, not generic time series by default.

### 2.4 Business Event History

Contoh:

```text
CaseCreated
CaseAssigned
CaseEscalated
EvidenceSubmitted
DecisionApproved
```

Ciri:

- domain semantic,
- can drive workflows/projections,
- may need event schema/version,
- replay may matter,
- event contract matters.

Often model as event/outbox/event store depending architecture.

### 2.5 Retention Records

Contoh:

```text
delete case after 7 years unless legal hold
archive evidence after closure + 3 years
delete export artifact after 14 days
```

Ciri:

- lifecycle policy,
- deletion/archival evidence,
- legal/audit implication,
- must be queryable by due date.

Usually standard collection or fields in domain collection plus job records.

---

## 3. Time Series Collection: Mental Model

MongoDB time series collection is optimized for sequences of measurements over time.

A measurement has:

```text
timeField:
  timestamp of measurement

metaField:
  stable metadata used to group measurements

measurement fields:
  values that change over time
```

Example:

```javascript
{
  measuredAt: ISODate("2026-06-21T10:00:00Z"),
  metadata: {
    tenantId: "tenant-a",
    service: "case-service",
    endpoint: "POST /cases/{id}/escalate"
  },
  p95LatencyMs: 120,
  requestCount: 42,
  errorCount: 1
}
```

When creating time series collection, you define:

```javascript
db.createCollection("api_metrics", {
  timeseries: {
    timeField: "measuredAt",
    metaField: "metadata",
    granularity: "minutes"
  },
  expireAfterSeconds: 60 * 60 * 24 * 90
})
```

MongoDB groups time series data internally into buckets for storage/query efficiency. MongoDB documentation describes `metaField` as the field MongoDB uses to group documents for storage optimization and query efficiency, and documents also note that MongoDB automatically creates a compound index on the `metaField` and `timeField` for a time series collection. citeturn973597search0

---

## 4. `timeField`

`timeField` is the timestamp of the measurement.

Rules:

```text
must exist
must be date-like
should represent actual measurement time
should not be ingestion time unless that is the measurement
```

Example:

```javascript
{
  timestamp: ISODate("2026-06-21T10:00:00Z"),
  metadata: {...},
  value: 42
}
```

Pick clear names:

```text
measuredAt
observedAt
occurredAt
recordedAt
```

Be precise:

```text
occurredAt:
  when event happened

recordedAt:
  when system recorded it

ingestedAt:
  when MongoDB/app ingested it
```

For audit, this distinction matters.

---

## 5. `metaField`

`metaField` should contain stable metadata that groups related measurements.

Good metadata:

```javascript
{
  tenantId: "tenant-a",
  service: "case-service",
  endpoint: "POST /cases/{id}/escalate"
}
```

Bad metadata:

```javascript
{
  requestId: "unique-per-request",
  randomId: "...",
  userId: "millions-of-users-if-too-granular",
  stackTrace: "...",
  changingStatus: "..."
}
```

Why?

Too fine-grained or dynamic metadata creates many buckets and hurts efficiency. MongoDB time series considerations specifically warn that the number of buckets depends on the number of unique `metaField` values, so fine-grained or dynamic `metaField` values can create excessive buckets. citeturn973597search5

Heuristic:

```text
metaField should be stable and moderately cardinal.
measurement fields should hold changing values.
```

---

## 6. Granularity

Granularity tells MongoDB expected frequency of measurements:

```text
seconds
minutes
hours
```

Set it to match ingestion frequency. MongoDB docs recommend setting granularity to the value that most closely matches the time between incoming timestamps because this helps optimize storage. citeturn973597search2

Examples:

```text
sensor every 5 seconds:
  granularity = seconds

API rollup every 1 minute:
  granularity = minutes

daily tenant summary:
  granularity = hours or maybe standard collection instead
```

MongoDB best practices also describe bucket granularity as controlling how frequently data is bucketed and note custom bucketing parameters such as `bucketMaxSpanSeconds` and `bucketRoundingSeconds` for more precise bucket boundaries in supported versions. citeturn973597search3

---

## 7. Bucket Mental Model

Internally, MongoDB stores time series measurements in buckets.

You do not usually query bucket collection directly. But mentally:

```text
similar metadata + nearby time = grouped into bucket
```

Good bucket behavior:

```text
many measurements per bucket
stable metadata
time-local writes
efficient compression/query
```

Bad bucket behavior:

```text
unique metadata per measurement
out-of-order writes everywhere
too fine-grained metadata
measurement fields changing shape wildly
```

Bucket-friendly design:

```javascript
{
  measuredAt: ISODate(...),
  metadata: {
    tenantId: "tenant-a",
    service: "case-service",
    endpoint: "case-transition"
  },
  count: 100,
  p50: 20,
  p95: 120,
  p99: 400
}
```

Bucket-hostile design:

```javascript
{
  measuredAt: ISODate(...),
  metadata: {
    requestId: "unique",
    userAgent: "long/dynamic",
    correlationId: "unique"
  },
  payload: {...large varied object...}
}
```

---

## 8. Time Series Collection Is Not For Everything

Use time series collection for:

```text
measurements
metrics
sensor data
telemetry
regularly sampled values
operational rollups
device readings
application performance metrics
```

Be cautious for:

```text
audit trail
business event store
legal records
highly irregular documents
documents needing frequent updates/deletes
complex lifecycle/legal hold
arbitrary search over text
large heterogeneous payloads
```

A regulatory audit event has timestamp, but it is not merely a measurement.

---

## 9. Metrics vs Audit Trail

Metric:

```javascript
{
  measuredAt: ISODate(...),
  metadata: {
    tenantId: "tenant-a",
    service: "case-service"
  },
  transitionCount: 42,
  errorCount: 1
}
```

Audit:

```javascript
{
  tenantId: "tenant-a",
  caseId: "case-1",
  action: "CASE_ESCALATED",
  actorId: "u123",
  reason: "SLA breach",
  before: { status: "UNDER_REVIEW" },
  after: { status: "ESCALATED" },
  occurredAt: ISODate(...),
  commandId: "cmd-123"
}
```

Metric answers:

```text
how many / how fast / what value over time?
```

Audit answers:

```text
who did what, to which business object, why, and with what effect?
```

Do not compress away meaning that audit needs.

---

## 10. Standard Collection For Audit Trail

Audit collection example:

```javascript
db.case_audit_events.createIndex({
  tenantId: 1,
  caseId: 1,
  sequence: 1
})

db.case_audit_events.createIndex({
  tenantId: 1,
  occurredAt: -1
})

db.case_audit_events.createIndex({
  tenantId: 1,
  actorId: 1,
  occurredAt: -1
})
```

Document:

```javascript
{
  _id: "tenant-a:case-1:seq-0000000012",
  tenantId: "tenant-a",
  caseId: "case-1",
  sequence: 12,
  action: "CASE_ESCALATED",
  actor: {
    actorType: "USER",
    userId: "u123",
    displayNameSnapshot: "Reviewer A"
  },
  reason: "SLA breach",
  before: {
    status: "UNDER_REVIEW",
    version: 7
  },
  after: {
    status: "ESCALATED",
    version: 8
  },
  occurredAt: ISODate("2026-06-21T10:00:00Z"),
  recordedAt: ISODate("2026-06-21T10:00:01Z"),
  commandId: "cmd-123",
  correlationId: "corr-456",
  policySnapshot: {
    transitionPolicyVersion: "case-state-v4"
  }
}
```

This is not just time series. It is legal/operational evidence.

---

## 11. Append-Only Invariant

Audit/event records should be append-only.

Meaning:

```text
insert allowed
update generally forbidden
delete only by retention/legal process
```

Application runtime should not casually update audit.

Better:

```text
case-service can insert audit
retention-worker can archive/delete under policy
admin cannot manually alter without break-glass audit
```

If correction needed:

```text
append correction event
```

not mutate old event.

Example:

```javascript
{
  action: "AUDIT_CORRECTION_RECORDED",
  correctsEventId: "tenant-a:case-1:seq-0000000012",
  explanation: "...",
  actorId: "compliance-admin",
  occurredAt: ...
}
```

---

## 12. Sequence Number

For per-case audit, sequence number helps order events.

Options:

```text
global sequence
per-tenant sequence
per-case sequence
hybrid logical timestamp
```

Per-case sequence is often enough:

```text
case-1 sequence 1,2,3...
case-2 sequence 1,2,3...
```

But sequence generation can become contention if not designed.

Alternative:

- use case version,
- transition id,
- occurredAt + ObjectId/ULID,
- eventId sortable.

For strict ordering within aggregate, state transition update can increment version. Audit event stores resulting version.

Example:

```javascript
{
  caseId: "case-1",
  versionAfter: 8,
  sequence: 8
}
```

---

## 13. Audit Atomicity

Critical question:

```text
Can case state change without audit event?
```

If no, then design atomicity.

Options:

### 13.1 Same Document

Embed recent/current transition.

Not good for unbounded audit.

### 13.2 Transaction

Update case and insert audit in one transaction.

```text
transaction:
  update cases
  insert case_audit_events
  insert outbox event
```

### 13.3 Event-first / event sourcing

Write event as source, derive state.

More complex.

### 13.4 Outbox/audit hybrid

Command writes audit/outbox alongside state.

For regulatory lifecycle, transaction is often reasonable if throughput and shard locality support it.

---

## 14. Log Collection

Application logs are often better stored in log systems such as ELK/OpenSearch, Loki, Splunk, cloud logging, etc.

MongoDB can store structured operational logs for application-specific purposes:

```javascript
{
  tenantId: "tenant-a",
  logType: "IMPORT_ROW_FAILURE",
  importId: "import-123",
  rowNumber: 928,
  code: "INVALID_DATE",
  message: "Invalid submittedAt",
  occurredAt: ISODate(...),
  severity: "WARN"
}
```

But avoid storing generic high-volume application logs in primary operational MongoDB if:

- text search is heavy,
- retention massive,
- ingestion volume huge,
- log analysis needs specialized tooling,
- logs contain unbounded payload.

---

## 15. Retention-Oriented Collection

Retention record:

```javascript
{
  _id: "tenant-a:case-1",
  tenantId: "tenant-a",
  aggregateType: "CASE",
  aggregateId: "case-1",
  retentionPolicyId: "case-7-years-after-closure",
  status: "ELIGIBLE" | "HELD" | "ARCHIVED" | "DELETED",
  closedAt: ISODate("2026-06-21T00:00:00Z"),
  retainUntil: ISODate("2033-06-21T00:00:00Z"),
  deleteAfter: ISODate("2033-06-22T00:00:00Z"),
  legalHold: false,
  lastEvaluatedAt: ISODate(...),
  disposition: "DELETE"
}
```

Index:

```javascript
{ tenantId: 1, deleteAfter: 1, legalHold: 1, status: 1 }
```

This collection drives deletion/archival jobs.

It is not a time series collection. It is a lifecycle control plane.

---

## 16. TTL Index Mental Model

TTL index automatically removes documents after expiration.

Common use:

- sessions,
- temporary tokens,
- transient import staging,
- idempotency records,
- short-lived cache-like data,
- low-risk operational logs.

MongoDB TTL indexes are special indexes used to remove documents after a configured time. For time series collections, MongoDB supports collection-level `expireAfterSeconds`, and MongoDB 7.0+ also supports partial TTL indexes on time series collections with constraints around the `metaField`. citeturn973597search7turn973597search19

Important:

```text
TTL is cleanup mechanism, not exact scheduler.
TTL deletion is not legal review.
TTL can create delete workload.
TTL must be compatible with legal hold.
```

---

## 17. TTL For Time Series

Time series collection can be created with expiration:

```javascript
db.createCollection("api_metrics", {
  timeseries: {
    timeField: "measuredAt",
    metaField: "metadata",
    granularity: "minutes"
  },
  expireAfterSeconds: 60 * 60 * 24 * 90
})
```

This keeps around 90 days of metrics.

MongoDB docs describe enabling automatic removal for time series collections through `expireAfterSeconds` and also modifying it via `collMod` for existing collections. citeturn973597search16

Use for metrics/log-like data where automatic expiry is acceptable.

Do not use blind TTL for legal audit where legal hold can override deletion unless you design around it.

---

## 18. Legal Hold vs TTL

Legal hold means:

```text
do not delete even if retention period expired
```

TTL does not ask legal/compliance workflow before deleting.

Therefore:

Bad for legal records:

```javascript
db.case_audit_events.createIndex(
  { occurredAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 365 * 7 }
)
```

If legal hold applies, TTL can delete data that must be preserved.

Better:

- explicit retention job,
- legal hold filter,
- archive before delete,
- deletion manifest,
- audit retention action.

TTL may still be used for derived/non-authoritative projections.

---

## 19. Deletion vs Archival vs Anonymization

### 19.1 Deletion

Remove data.

Use when:

```text
policy says delete
no legal hold
no downstream requirement
```

Need evidence.

### 19.2 Archival

Move to cold/controlled storage.

Use when:

```text
hot access no longer needed
retention still required
legal/audit retrieval possible
```

### 19.3 Anonymization

Remove identifying fields while preserving aggregate data.

Use when:

```text
statistics needed
PII no longer allowed
```

### 19.4 Redaction

Hide fields from certain users/views.

Not same as deletion.

---

## 20. Retention Job Pattern

Retention worker loop:

```text
for each tenant:
  load retention policy
  find eligible records
  exclude legal hold
  process in batches
  archive/delete/anonymize
  write manifest
  update status
  emit audit
```

Pseudo query:

```javascript
db.retention_records.find({
  tenantId: "tenant-a",
  status: "ELIGIBLE",
  legalHold: { $ne: true },
  deleteAfter: { $lte: now }
}).sort({ deleteAfter: 1 }).limit(500)
```

Job must be:

- resumable,
- rate-limited,
- auditable,
- tenant-scoped,
- reversible only if archive exists,
- observable.

---

## 21. Deletion Manifest

Deletion run:

```javascript
{
  _id: "deletion-run-20260621-tenant-a",
  tenantId: "tenant-a",
  policyId: "case-retention-7y",
  startedAt: ISODate(...),
  completedAt: ISODate(...),
  candidateCount: 10000,
  deletedCount: 9980,
  skippedLegalHoldCount: 20,
  actor: "retention-worker",
  approvalRef: "approval-123",
  criteria: {
    deleteAfterLte: ISODate(...)
  },
  status: "COMPLETED",
  hash: "..."
}
```

This record proves deletion followed policy.

If deleting individual documents, you may store hashed IDs rather than sensitive details.

---

## 22. Time Range Query Design

Most time-oriented queries look like:

```javascript
{
  tenantId: "tenant-a",
  occurredAt: {
    $gte: start,
    $lt: end
  }
}
```

Index:

```javascript
{ tenantId: 1, occurredAt: -1 }
```

For audit by case:

```javascript
{ tenantId: 1, caseId: 1, sequence: 1 }
```

For actor investigation:

```javascript
{ tenantId: 1, actorId: 1, occurredAt: -1 }
```

For retention:

```javascript
{ tenantId: 1, deleteAfter: 1, legalHold: 1 }
```

Do not create one giant generic log collection with arbitrary search requirements and no query discipline.

---

## 23. Time Series Query Pattern

Example metrics query:

```javascript
db.api_metrics.find({
  "metadata.tenantId": "tenant-a",
  "metadata.service": "case-service",
  measuredAt: {
    $gte: ISODate("2026-06-21T00:00:00Z"),
    $lt: ISODate("2026-06-22T00:00:00Z")
  }
})
```

Aggregation:

```javascript
db.api_metrics.aggregate([
  {
    $match: {
      "metadata.tenantId": "tenant-a",
      "metadata.service": "case-service",
      measuredAt: {
        $gte: start,
        $lt: end
      }
    }
  },
  {
    $group: {
      _id: {
        endpoint: "$metadata.endpoint",
        hour: { $dateTrunc: { date: "$measuredAt", unit: "hour" } }
      },
      requestCount: { $sum: "$requestCount" },
      errorCount: { $sum: "$errorCount" },
      avgP95: { $avg: "$p95LatencyMs" }
    }
  }
])
```

Time series is strong for measurement-oriented aggregation.

---

## 24. Rollups

Raw metrics can be high volume.

Rollup strategy:

```text
raw 10-second metrics retained 7 days
1-minute rollup retained 90 days
1-hour rollup retained 2 years
daily rollup retained 7 years
```

Collections:

```text
api_metrics_raw
api_metrics_1m
api_metrics_1h
api_metrics_1d
```

Rollup document:

```javascript
{
  measuredAt: ISODate("2026-06-21T10:00:00Z"),
  metadata: {
    tenantId: "tenant-a",
    service: "case-service",
    endpoint: "case-transition"
  },
  requestCount: 1234,
  errorCount: 12,
  p50LatencyMs: 22,
  p95LatencyMs: 180,
  p99LatencyMs: 600
}
```

Rollup job must be idempotent.

---

## 25. Downsampling

Downsampling reduces precision for older data.

Example:

```text
raw:
  every 10 seconds

after 7 days:
  aggregate to 1 minute

after 90 days:
  aggregate to 1 hour

after 2 years:
  aggregate to daily
```

This reduces storage and query cost.

For legal audit, do not downsample. Audit needs event-level evidence.

Again:

```text
metrics can be downsampled
audit cannot be downsampled casually
```

---

## 26. Bucket Pattern For Standard Collections

If time series collection does not fit, use bucket pattern.

Example audit bucket per case/month:

```javascript
{
  _id: "tenant-a:case-1:audit:2026-06",
  tenantId: "tenant-a",
  caseId: "case-1",
  bucketMonth: "2026-06",
  eventCount: 120,
  events: [
    {
      sequence: 1,
      action: "CREATED",
      occurredAt: ISODate(...)
    }
  ]
}
```

Pros:

- fewer documents,
- locality by case/time,
- efficient batch retrieval.

Cons:

- bucket document can grow,
- concurrent appends to same bucket,
- more complex updates,
- individual event indexing limited,
- legal/audit immutability complexity.

For critical audit, individual event documents are often simpler and more defensible.

---

## 27. Individual Event Document vs Bucket

### Individual Event Document

Pros:

```text
simple append
easy index
easy unique event id
easy legal trace
easy partial query
```

Cons:

```text
more documents
higher index volume
```

### Bucketed Events

Pros:

```text
fewer documents
better locality for sequence reads
possible compression benefits
```

Cons:

```text
update hot bucket
unbounded bucket risk
harder event-level query
harder event-level legal handling
```

For regulated audit, prefer individual event documents unless volume makes bucket necessary and design is carefully reviewed.

---

## 28. Immutable Audit and Correction

Never rewrite history silently.

If wrong audit event was produced:

```text
append correction
```

Example:

```javascript
{
  action: "AUDIT_EVENT_CORRECTED",
  correctsEventId: "audit-123",
  correctionType: "REASON_TEXT_CORRECTION",
  originalHash: "...",
  correctedFields: {
    reason: "Corrected reason text"
  },
  actorId: "compliance-admin",
  approvalRef: "approval-789",
  occurredAt: ISODate(...)
}
```

Consumers can render corrected view, but original remains.

---

## 29. Event Hash / Tamper Evidence

Audit event can include hash.

```javascript
{
  eventHash: "sha256(canonical event)",
  previousHash: "previous event hash"
}
```

For per-case chain:

```text
event n hash depends on event n-1 hash
```

Pros:

- tamper evidence,
- chain integrity.

Cons:

- correction complexity,
- migration complexity,
- canonicalization,
- backfill,
- performance,
- operational key/signature management if signing.

Use if compliance requires strong tamper evidence.

---

## 30. Actor Snapshot

Audit should store actor snapshot, not only userId.

Why?

User name/role/team can change later.

Example:

```javascript
actor: {
  userId: "u123",
  displayName: "A. Reviewer",
  emailHash: "...",
  roleSnapshot: ["CASE_REVIEWER"],
  teamId: "team-enforcement"
}
```

But avoid storing unnecessary PII.

Balance:

```text
enough evidence
minimal sensitive data
```

---

## 31. Policy Snapshot

For defensibility, audit can store policy version.

Example:

```javascript
policySnapshot: {
  stateMachineVersion: "case-state-v6",
  authorizationPolicyVersion: "case-access-v3",
  retentionPolicyId: "case-7y-v2"
}
```

This helps answer:

```text
why was this transition allowed at that time?
```

without relying on current policy.

---

## 32. Audit Query Use Cases

Design indexes for actual audit use.

Use cases:

```text
view case history ordered by sequence
find actions by actor in date range
find all legal hold changes
find support accesses to tenant data
investigate changes in time window
export audit for case
prove retention deletion
```

Indexes:

```javascript
{ tenantId: 1, caseId: 1, sequence: 1 }
{ tenantId: 1, actor.userId: 1, occurredAt: -1 }
{ tenantId: 1, action: 1, occurredAt: -1 }
{ tenantId: 1, occurredAt: -1 }
{ commandId: 1 } // if globally unique or include tenant
```

Do not index entire payload by default.

---

## 33. Audit Volume Management

Audit grows forever unless retention/archive exists.

Strategies:

1. hot audit collection for recent data,
2. archive old audit to cold storage,
3. keep manifest in MongoDB,
4. search archived audit separately,
5. tenant-specific retention,
6. legal hold excludes archive/delete,
7. compress/export immutable files,
8. split by time/tenant if needed.

Do not let audit growth silently degrade operational `cases` collection.

---

## 34. Case Event History Design

For regulatory case lifecycle:

```javascript
{
  _id: "tenant-a:case-1:v8",
  tenantId: "tenant-a",
  caseId: "case-1",
  versionAfter: 8,
  eventType: "CASE_ESCALATED",
  transition: {
    from: "UNDER_REVIEW",
    to: "ESCALATED"
  },
  actor: {...},
  reason: "SLA breach",
  occurredAt: ISODate(...),
  recordedAt: ISODate(...),
  commandId: "cmd-123",
  correlationId: "corr-456",
  evidenceRefs: ["doc-1"],
  policySnapshot: {...}
}
```

This can serve as:

- audit trail,
- event history,
- projection source,
- compliance evidence.

But be clear whether it is:

```text
audit event
business event
event store source of truth
```

Different commitments.

---

## 35. Metrics For Case Platform

Useful metrics:

```text
case_created_count
case_transition_count
case_transition_latency
case_open_count
case_overdue_count
case_assignment_count
case_decision_count
case_reopened_count
audit_insert_latency
outbox_lag
retention_job_deleted_count
legal_hold_count
```

These are metrics, not audit.

Store metrics in time series collection or external metrics system.

MongoDB time series can be used for application-specific tenant metrics if query needs are within MongoDB.

---

## 36. Operational Logs vs Audit

Operational log:

```text
outbox worker failed to publish event
retry attempt 3
```

Audit:

```text
case escalated by user
```

Operational logs can expire quickly.

Audit may be retained for years.

Do not mix retention and access policies.

---

## 37. Java Ingestion Pattern For Metrics

Batch metrics.

Bad:

```java
for (Metric m : metrics) {
    collection.insertOne(toDocument(m));
}
```

Better:

```java
collection.insertMany(metricDocuments, new InsertManyOptions().ordered(false));
```

Use:

- bounded batch size,
- flush interval,
- retry with idempotency if needed,
- avoid blocking critical request path,
- drop/aggregate if metrics pipeline degraded.

Metrics should not take down business command path.

---

## 38. Java Audit Insert Pattern

Audit is critical.

Do not treat audit same as best-effort metric.

Pattern:

```text
command handler:
  validate
  update aggregate
  insert audit event
  insert outbox event if needed
  commit
```

For transaction:

```java
withTransaction(session, () -> {
    updateCaseState(session, command);
    insertAuditEvent(session, auditEvent);
    insertOutboxEvent(session, domainEvent);
});
```

If transaction not used, you need another consistency strategy. Do not silently ignore audit insert failure.

---

## 39. Idempotent Audit Insert

Use deterministic event id.

```text
tenantId + commandId + eventType
```

or:

```text
tenantId + caseId + versionAfter
```

Example:

```javascript
_id: "tenant-a:case-1:v8"
```

If retry inserts same audit:

```text
duplicate key means audit already exists
```

Interpret carefully.

---

## 40. Retention Job Java Pattern

Pseudo:

```java
while (running) {
    List<RetentionRecord> batch = retentionRepository.findEligible(tenantId, now, 500);

    if (batch.isEmpty()) {
        break;
    }

    for (RetentionRecord record : batch) {
        processWithAudit(record);
    }

    rateLimiter.pauseIfNeeded();
}
```

Important:

- checkpoint,
- bounded batch,
- per-tenant run,
- dry-run mode,
- legal hold recheck at action time,
- audit deletion action,
- metrics.

---

## 41. Dry Run Retention

Before deleting:

```text
dry run:
  count candidates
  sample candidates
  verify policy
  report legal hold exclusions
  estimate storage impact
  approval
```

Dry-run record:

```javascript
{
  _id: "dryrun-retention-tenant-a-20260621",
  tenantId: "tenant-a",
  policyId: "case-7y",
  candidateCount: 10000,
  legalHoldCount: 20,
  estimatedDeleteCount: 9980,
  generatedAt: ISODate(...),
  status: "AWAITING_APPROVAL"
}
```

---

## 42. Out-of-Order Time Data

Time series collections perform best when data arrives roughly in time order for metadata groups.

If ingestion is heavily out-of-order, late, or backfilled, test carefully.

Use cases:

```text
IoT device offline then uploads old readings
batch import historical metrics
corrected historical measurement
```

Options:

- standard collection,
- batch load by time order,
- separate historical import path,
- choose granularity carefully,
- accept performance trade-off.

---

## 43. Late Arriving Audit Events

Audit should generally record actual `occurredAt` and `recordedAt`.

Example:

```javascript
{
  occurredAt: ISODate("2026-06-20T10:00:00Z"),
  recordedAt: ISODate("2026-06-21T09:00:00Z"),
  action: "EXTERNAL_EVIDENCE_RECEIVED"
}
```

Do not overwrite occurredAt with ingestion time.

For ordering:

```text
sequence may follow recorded/accepted order
occurredAt may be earlier
```

Render both when needed.

---

## 44. Clock Skew

Distributed systems have clock skew.

Audit event timestamp from client is not always trustworthy.

Use:

```text
server recordedAt
trusted occurredAt if from authoritative source
source timestamp separately
```

Example:

```javascript
{
  sourceOccurredAt: ISODate(...),
  recordedAt: ISODate(...),
  sourceSystem: "external-registry"
}
```

For legal evidence, timestamp provenance matters.

---

## 45. Time Zone

Store timestamps in UTC.

Render in user/tenant timezone.

For retention, be precise:

```text
retain until end of local business day?
retain until UTC instant?
```

Policy should define exact instant.

Avoid ambiguous local dates around DST.

Use:

```text
Instant for storage
ZoneId for policy/rendering
LocalDate only for date-only domain concepts
```

In Java:

```java
Instant occurredAt;
ZoneId tenantZone;
LocalDate closureDate;
```

---

## 46. Partitioning By Tenant/Time

For huge standard collections:

```text
tenantId + occurredAt
```

is common.

Indexes:

```javascript
{ tenantId: 1, occurredAt: -1 }
{ tenantId: 1, caseId: 1, sequence: 1 }
```

Sharding:

```javascript
{ tenantId: 1, caseId: 1, sequence: 1 }
```

or:

```javascript
{ tenantId: 1, occurredAt: 1 }
```

depending query.

For archive:

```text
old data can move to archive collection by time range
```

---

## 47. Hot vs Cold Collections

Separate:

```text
case_audit_events_hot
case_audit_events_archive
```

or:

```text
case_audit_events
archive store
```

Hot:

- recent,
- frequent query,
- low latency,
- indexes for UI.

Cold:

- old,
- rarely queried,
- cheaper storage,
- stronger archival controls,
- different SLA.

Keep pointer/manifest in MongoDB:

```javascript
{
  tenantId,
  caseId,
  archiveRef,
  archivedThroughSequence,
  archivedAt,
  hashManifest
}
```

---

## 48. Archive Integrity

Archive should be verifiable.

Manifest:

```javascript
{
  _id: "archive:tenant-a:case-1:audit:2026",
  tenantId: "tenant-a",
  caseId: "case-1",
  eventCount: 12345,
  sequenceFrom: 1,
  sequenceTo: 12345,
  storageUri: "s3://...",
  sha256: "...",
  createdAt,
  createdBy: "archive-worker",
  retentionPolicyId: "audit-10y"
}
```

Do not expose raw storage URI to unauthorized clients.

---

## 49. Querying Archive

Archive retrieval should be explicit:

```text
request archive
authorize
retrieve manifest
verify hash if needed
stream results
audit access
```

Archive query may be slower.

UI should communicate:

```text
older audit records are archived; retrieval may take longer
```

---

## 50. Time Series For Business Metrics

For tenant dashboard metrics:

```javascript
{
  measuredAt: ISODate("2026-06-21T10:00:00Z"),
  metadata: {
    tenantId: "tenant-a",
    metricName: "case_state_counts"
  },
  open: 123,
  underReview: 45,
  escalated: 6,
  closed: 10000
}
```

This is a measurement snapshot.

It is fine to expire/downsample depending policy.

Do not confuse it with source-of-truth state.

---

## 51. Reconciliation For Metrics

Metrics derived from source can drift.

Add reconciliation:

```text
daily recompute from cases
compare with metric
record discrepancy
fix if needed
```

Metric drift may be acceptable; audit drift is not.

Define tolerance.

---

## 52. Observability For Retention

Metrics:

```text
retention_candidates_count
retention_deleted_count
retention_archived_count
retention_skipped_legal_hold_count
retention_job_duration
retention_job_error_count
delete_batch_size
replication_lag_during_retention
archive_bytes_written
```

Logs:

```text
tenant
policy
jobId
batchId
counts
duration
error class
```

Alerts:

```text
retention job overdue
legal hold violation attempt
delete errors
archive verification failed
TTL/delete storm
```

---

## 53. Observability For Time Series Ingestion

Metrics:

```text
metrics_insert_rate
metrics_batch_size
metrics_insert_latency
metrics_insert_error_rate
late_measurement_count
bucket/cardinality indicators if available
storage growth
query latency
rollup lag
```

If metrics ingestion threatens business database, isolate it.

---

## 54. Security Considerations

Time-oriented data can still be sensitive.

Audit/logs may contain:

- user identity,
- IP address,
- case reference,
- PII in message,
- reason text,
- evidence metadata,
- support access details.

Rules:

```text
do not log sensitive payload casually
classify audit/log fields
restrict access
encrypt if needed
redact exports
control retention
protect archive
```

Operational logs are a common PII leak path.

---

## 55. Design Checklist: Time Series Collection

```text
[ ] Is data measurement-like?
[ ] Is schema relatively stable?
[ ] Is timeField clear?
[ ] Is metaField stable and not too high-cardinality?
[ ] Is granularity aligned with ingestion frequency?
[ ] Is retention simple enough for expireAfterSeconds?
[ ] Are queries mostly by metadata + time range?
[ ] Are rollups/downsampling needed?
[ ] Is this not legal audit/source-of-truth event history?
[ ] Is ingestion ordered enough?
[ ] Is security classification understood?
```

---

## 56. Design Checklist: Audit Trail

```text
[ ] Is audit append-only?
[ ] Is audit atomic with business state change?
[ ] Does event include actor/action/reason/time?
[ ] Are before/after or version references captured?
[ ] Is commandId captured?
[ ] Is tenantId captured?
[ ] Is policy version captured?
[ ] Is sequence/version captured?
[ ] Are indexes aligned with audit use cases?
[ ] Is update/delete restricted?
[ ] Is retention/legal hold explicit?
[ ] Is archive strategy defined?
[ ] Is correction append-only?
[ ] Is access to audit itself audited?
```

---

## 57. Design Checklist: Retention

```text
[ ] Are retention policies explicit?
[ ] Are policies tenant-specific?
[ ] Is legal hold modelled?
[ ] Is TTL safe for this data?
[ ] Is deletion auditable?
[ ] Is archive required before deletion?
[ ] Is anonymization needed instead of delete?
[ ] Are search/index/log/downstream copies handled?
[ ] Are backups considered?
[ ] Is retention job resumable?
[ ] Is dry-run/approval supported?
[ ] Are deletion manifests generated?
[ ] Is restore/recovery defined?
```

---

## 58. Practical Exercise

Design storage for a regulatory enforcement platform.

Data types:

```text
1. API latency metrics
2. Case lifecycle audit
3. User login security logs
4. Outbox publish attempts
5. Case state daily dashboard counts
6. Retention eligibility records
7. Legal hold changes
8. Evidence access logs
```

For each, decide:

1. time series collection or standard collection,
2. key fields,
3. indexes,
4. retention,
5. legal hold,
6. archive strategy,
7. security level,
8. query patterns.

Suggested direction:

```text
API latency metrics:
  time series, meta service/endpoint/tenant, TTL + rollups

Case lifecycle audit:
  standard append-only collection, transaction with state change, legal retention

User login security logs:
  standard or security log platform, retention/security policy

Outbox publish attempts:
  standard operational collection, TTL after completion if not audit-critical

Daily dashboard counts:
  time series or summary collection, downsample/retain by policy

Retention eligibility:
  standard collection, indexed by tenant/deleteAfter/legalHold

Legal hold changes:
  audit collection, append-only, long retention

Evidence access logs:
  audit/security collection, sensitive, strict retention/legal hold
```

---

## 59. Senior-Level Heuristics

```text
If data is measurement-like, time series may fit.

If data is legal evidence, do not treat it as disposable telemetry.

If legal hold can apply, blind TTL is dangerous.

If metaField is unique per event, time series buckets will suffer.

If audit can be modified, audit is weak.

If retention deletion is not audited, it is not defensible.

If archive cannot be verified, archive is just a copy.

If old data is rarely queried, move it out of hot path.

If metric drift is acceptable, reconcile periodically.

If audit drift exists, treat as incident.

If timestamp meaning is unclear, legal interpretation will be unclear.
```

---

## 60. Summary

Time-oriented data must be modelled by invariant, not just by timestamp.

Key lessons:

1. Metrics, logs, audit trails, business events, and retention records are different.
2. MongoDB time series collections fit measurement-like data with stable metadata and time-range queries.
3. `metaField` should be stable and not too fine-grained.
4. Granularity should match ingestion frequency.
5. TTL is useful for ephemeral/metric data but dangerous for legal records with legal hold.
6. Audit trail should be append-only, atomic with business change, and defensible.
7. Business events need semantic context; database timestamps are not enough.
8. Rollups/downsampling are good for metrics, not for audit.
9. Retention requires explicit policy, legal hold, manifests, and operational audit.
10. Archive must be verifiable and access-controlled.
11. Hot/cold separation protects performance.
12. Java ingestion should batch metrics but treat audit as critical.
13. Timezone, clock skew, occurredAt, recordedAt, and ingestedAt must be modelled deliberately.
14. Query patterns determine indexes and sharding.
15. Security applies strongly to logs/audit because they often contain sensitive context.

The most important sentence:

> A timestamp does not define the data model; the invariant does.

---

## 61. Bridge to Part 026

Part 026 will focus on:

- basic text search vs Atlas Search,
- search index vs database index,
- analyzers,
- tokenization,
- stemming,
- relevance scoring,
- autocomplete,
- faceted search,
- search pagination,
- search consistency,
- geospatial search,
- vector search,
- embeddings,
- hybrid search,
- filters,
- authorization-aware search,
- when to use MongoDB Search vs Elasticsearch/OpenSearch.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-026.md
```

Judul berikutnya:

```text
Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search
```

---

## 62. Status Seri

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
```

Seri belum selesai. Masih lanjut ke Part 026 sampai Part 035.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-026.md">Part 026 — Search, Atlas Search, Text Search, Geospatial, and Vector Search ➡️</a>
</div>

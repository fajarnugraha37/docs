# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-032.md

# Part 032 — Architecture Patterns: MongoDB in Distributed Java Systems

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 032 dari 035  
> Fokus: MongoDB dalam arsitektur Java terdistribusi, aggregate-oriented service design, modular monolith, microservices, CQRS, outbox/inbox, read projections, cache-aside, search projection, saga/process manager, multi-tenant platform, dan integrasi dengan Kafka/RabbitMQ/Redis/PostgreSQL  
> Target pembaca: Java software engineer / tech lead yang ingin memakai MongoDB sebagai bagian dari sistem besar secara arsitektural, bukan hanya sebagai database CRUD

---

## 0. Posisi Part Ini Dalam Seri

Part 031 membahas anti-pattern dan failure case. Sekarang kita masuk ke bagian arsitektur sistem.

MongoDB jarang berdiri sendirian. Dalam sistem Java modern, MongoDB biasanya berada bersama:

```text
Spring Boot services
REST/gRPC APIs
Kafka/RabbitMQ
Redis
PostgreSQL/MySQL
object storage
search engine
identity provider
workflow engine
observability stack
batch jobs
analytics/warehouse
```

Pertanyaan pentingnya bukan:

```text
Apakah MongoDB bagus?
```

Pertanyaan yang lebih benar:

```text
Untuk boundary mana MongoDB adalah storage yang tepat?
Untuk data model mana document database memberi advantage?
Untuk integrasi mana MongoDB harus dibantu outbox/broker/search/cache?
Kapan PostgreSQL lebih tepat?
Kapan Redis lebih tepat?
Kapan Kafka/RabbitMQ harus menjadi event/message backbone?
```

Kalimat inti:

> MongoDB paling kuat ketika digunakan sebagai aggregate/document store untuk boundary yang jelas, bukan sebagai pengganti semua sistem data.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menempatkan MongoDB dalam arsitektur Java terdistribusi.
2. Mendesain service boundary berbasis aggregate.
3. Memahami kapan modular monolith lebih baik daripada microservices.
4. Menerapkan CQRS/read projection secara pragmatis.
5. Menggunakan outbox untuk reliable integration.
6. Menggunakan inbox/idempotency untuk consumer safety.
7. Mendesain projection dari MongoDB ke search/cache/dashboard.
8. Menentukan kapan memakai Redis, Kafka, RabbitMQ, PostgreSQL, dan MongoDB bersama.
9. Mendesain saga/process manager untuk workflow lintas boundary.
10. Menghindari distributed transaction trap.
11. Mendesain multi-tenant platform architecture.
12. Memahami application-level routing, cell architecture, and tenant placement.
13. Membuat reference architecture regulatory case platform.
14. Membuat checklist arsitektur production.

---

## 2. MongoDB As Aggregate Store

MongoDB cocok ketika domain memiliki aggregate yang:

```text
punya identity jelas
dibaca/ditulis sebagai unit
punya nested owned data yang bounded
butuh flexible document shape
butuh high write/read throughput by aggregate key
punya query pattern yang bisa di-index
```

Contoh:

```text
case
investigation
policy document
tenant configuration
workflow instance
import job
support access request
retention policy
```

MongoDB bukan hanya “JSON storage”. Ia cocok untuk aggregate-oriented persistence.

---

## 3. Aggregate Boundary

Aggregate boundary menjawab:

```text
Apa yang harus konsisten bersama?
Apa yang lifecycle-nya sama?
Apa yang bisa berubah bersama?
Apa yang dibaca bersama?
Apa yang boleh eventual?
```

Example:

```text
Case aggregate:
  core status
  owner
  priority
  current stage
  due date
  summary fields
  bounded metadata
```

Not necessarily inside case aggregate:

```text
audit events
large evidence files
all notes
all documents
search text projection
dashboard counters
full workflow history if unbounded
```

Boundary salah menyebabkan:

- one giant document,
- too many transactions,
- too many joins/lookups,
- stale projections,
- inconsistent workflow.

---

## 4. Service Boundary vs Collection Boundary

Jangan samakan collection dengan service.

Satu service bisa memiliki beberapa collection:

```text
case-service:
  cases
  case_audit_events
  case_notes
  case_documents
  outbox_events
  idempotency_records
  case_worklist_items
```

Satu boundary service bertanggung jawab atas invariants.

Collection adalah storage layout.

Service boundary adalah ownership boundary.

Aturan:

```text
Only owning service writes its collections.
Other services consume API/events/projections.
```

Jika banyak service langsung update collection yang sama, ownership kabur.

---

## 5. Modular Monolith With MongoDB

Untuk banyak organisasi, modular monolith lebih aman daripada microservices terlalu awal.

Structure:

```text
one deployable application
modules with strict package boundaries
shared MongoDB cluster/database
separate collections per module
internal events/outbox optional
single transaction boundary easier
```

Pros:

- simpler deployment,
- easier local development,
- fewer distributed failure modes,
- easier refactoring,
- transaction across modules possible if needed.

Cons:

- can become big ball of mud,
- scaling/deploy independence lower,
- ownership boundaries need discipline.

Use when:

```text
team small/medium
domain still evolving
high consistency across modules
microservices overhead not justified
```

---

## 6. Microservices With MongoDB

Microservices rule:

```text
database per service ownership
```

Not necessarily physically separate cluster, but ownership must be clear.

Example:

```text
case-service owns cases and case_audit_events
document-service owns document metadata and storage references
notification-service owns notification preferences/status
reporting-service owns reporting projections
```

Anti-pattern:

```text
service A writes service B's MongoDB collection directly
```

Use API or events.

Microservices add:

- network failure,
- eventual consistency,
- schema/event versioning,
- operational complexity,
- duplicate data/projections,
- harder testing.

Use when:

```text
clear domain boundaries
independent scaling/deploy needed
team ownership aligned
integration contracts mature
```

---

## 7. MongoDB And DDD Aggregates

DDD aggregate principles fit document databases well, with caveats.

Good fit:

```text
aggregate root = document root
owned bounded value objects embedded
aggregate version stored
state transition through aggregate root
```

Example:

```javascript
{
  _id: "tenant-a:case-1",
  tenantId: "tenant-a",
  caseId: "case-1",
  status: "UNDER_REVIEW",
  ownerUserId: "u123",
  priority: "HIGH",
  version: 7,
  sla: {
    dueAt: ISODate(...),
    breached: false
  },
  tags: ["AML", "URGENT"]
}
```

Command:

```text
EscalateCase
```

Update:

```javascript
filter:
  tenantId, caseId, status: "UNDER_REVIEW", version: 7

update:
  $set status=ESCALATED, updatedAt=...
  $inc version
```

This preserves aggregate invariant.

---

## 8. CQRS Pragmatism

CQRS means separating command model and query/read model.

You do not need full event sourcing to use CQRS.

Example:

```text
Command model:
  cases collection optimized for state transitions by tenantId+caseId

Read model:
  case_worklist_items optimized for assignee worklist
  case_search_documents optimized for full-text search
  dashboard_summaries optimized for dashboards
```

This is often a natural MongoDB pattern.

Trade-off:

```text
more write/projection complexity
better query performance and simpler indexes
eventual consistency
```

Use CQRS when one collection cannot satisfy competing access patterns well.

---

## 9. Projection Collections

Projection collection is derived data.

Examples:

```text
case_worklist_items
case_search_documents
case_dashboard_summaries
case_timeline_view
tenant_usage_daily
```

Projection rules:

```text
source of truth exists elsewhere
projection has sourceVersion/projectedAt
projection can be rebuilt
projection has own indexes
projection can be stale within SLA
```

Projection document example:

```javascript
{
  _id: "tenant-a:u123:case-1",
  tenantId: "tenant-a",
  assigneeId: "u123",
  caseId: "case-1",
  caseNumber: "CASE-001",
  status: "OPEN",
  priority: "HIGH",
  dueAt: ISODate(...),
  sourceVersion: 12,
  projectedAt: ISODate(...)
}
```

---

## 10. Command Side Pattern

Command side flow:

```text
HTTP/gRPC command
  -> authenticate
  -> authorize
  -> validate command
  -> load/current state if needed
  -> atomic guarded update or transaction
  -> insert audit
  -> insert outbox event if external/domain integration needed
  -> return command result
```

For single-document aggregate transition:

```text
conditional update + audit/outbox transaction if audit/outbox must be atomic
```

If audit/outbox not in same transaction, you need consistency repair.

---

## 11. Query Side Pattern

Query side flow:

```text
HTTP query
  -> authenticate
  -> authorize
  -> build tenant+auth filter
  -> query optimized collection/projection
  -> project DTO
  -> redact
  -> return page/cursor
```

Query side must not mutate state.

Query side should use:

- projection,
- limit,
- cursor pagination,
- index-aligned filter,
- safe sorting,
- role-specific projection.

---

## 12. Outbox Pattern

Outbox solves:

```text
state changed in MongoDB
external event/message must be published
```

Pattern:

```text
transaction:
  update aggregate
  insert audit
  insert outbox event

publisher:
  reads outbox
  publishes to Kafka/RabbitMQ/etc.
  marks dispatched
```

Outbox event:

```javascript
{
  _id: "event-tenant-a-case-1-v8",
  tenantId: "tenant-a",
  aggregateType: "CASE",
  aggregateId: "case-1",
  eventType: "CaseEscalated",
  schemaVersion: 2,
  payload: {
    caseId: "case-1",
    from: "UNDER_REVIEW",
    to: "ESCALATED"
  },
  occurredAt: ISODate(...),
  status: "PENDING",
  attempts: 0
}
```

Outbox gives durable explicit business event.

---

## 13. Polling Outbox

Polling pattern:

```javascript
findOneAndUpdate(
  {
    status: "PENDING",
    availableAt: { $lte: now },
    leaseUntil: { $lt: now }
  },
  {
    $set: {
      status: "PROCESSING",
      leaseOwner: workerId,
      leaseUntil: now + 30s
    },
    $inc: { attempts: 1 }
  },
  { sort: { availableAt: 1 } }
)
```

Benefits:

- controlled backpressure,
- retry and dead-letter easy,
- no dependency on change stream.

Add indexes:

```javascript
{ status: 1, availableAt: 1, leaseUntil: 1 }
{ eventType: 1, status: 1 }
```

Outbox collection can be archived/TTL'd after safe retention.

---

## 14. Change Stream Outbox Hybrid

Use change stream as wake-up signal for outbox.

```text
change stream watches outbox_events inserts
worker wakes quickly
polling/reconciliation still exists
```

This combines low latency with reliability.

Do not rely solely on change stream if you need recovery after long downtime without rebuild/reconciliation.

---

## 15. Inbox Pattern

Consumer service needs idempotency.

Inbox record:

```javascript
{
  _id: "source-service:event-id",
  eventId: "event-id",
  source: "case-service",
  receivedAt: ISODate(...),
  processedAt: ISODate(...),
  status: "PROCESSED"
}
```

Consumer flow:

```text
receive event
try insert inbox record
if duplicate -> skip
process business update
mark processed
```

If processing and inbox insert need atomicity, use transaction in consumer's DB.

Inbox prevents duplicate event processing.

---

## 16. Saga / Process Manager

Saga coordinates multi-step business process across services.

Example:

```text
CaseEscalated
  -> notify supervisor
  -> create review task
  -> update SLA dashboard
  -> request external registry check
```

Process manager state:

```javascript
{
  _id: "tenant-a:case-1:escalation-process-1",
  tenantId: "tenant-a",
  caseId: "case-1",
  processType: "ESCALATION",
  status: "WAITING_EXTERNAL_CHECK",
  steps: [
    { name: "NOTIFY_SUPERVISOR", status: "DONE" },
    { name: "CREATE_REVIEW_TASK", status: "DONE" },
    { name: "EXTERNAL_CHECK", status: "PENDING" }
  ],
  version: 3,
  updatedAt: ISODate(...)
}
```

MongoDB is good for saga state if process document is bounded.

---

## 17. Avoid Distributed Transactions

Across services:

```text
case-service DB
notification-service DB
external registry
Kafka
```

Do not try to make one ACID transaction across all.

Use:

- local transaction,
- outbox,
- idempotent consumer,
- saga/process manager,
- compensation,
- retries with backoff,
- reconciliation.

Distributed consistency is workflow design, not magic.

---

## 18. Cache-Aside With Redis

Redis complements MongoDB.

Use Redis for:

```text
short-lived cache
session/token cache
rate limiting
distributed locks with caution
idempotency short window maybe
hot reference data cache
```

Cache-aside flow:

```text
read cache
if miss read MongoDB
write cache with TTL
on write invalidate cache
```

Rules:

- cache is not source of truth,
- TTL exists,
- invalidate on change,
- avoid caching unauthorized data globally,
- tenant/auth part of cache key,
- handle stale data.

Example key:

```text
tenant-a:case-detail:case-1:v12
```

---

## 19. Cache Invalidation

Options:

```text
synchronous invalidation in command handler
change stream invalidation
outbox event invalidation
TTL fallback
namespace version bump
```

Critical state should verify MongoDB source on command.

Cache improves performance, not correctness.

---

## 20. Redis Lock Caution

Distributed locks are often misused.

If using Redis lock for MongoDB write coordination, ask:

```text
Can MongoDB conditional update solve this?
Can unique index solve this?
Can version field solve this?
What happens if lock expires early?
What happens during network partition?
```

Prefer database atomicity for database invariants.

Use locks for external coordination only when carefully designed.

---

## 21. PostgreSQL + MongoDB

Sometimes both are correct.

Use PostgreSQL for:

```text
strong relational constraints
complex joins across normalized data
financial ledger/accounting
reporting with SQL
strict schema governance
ad hoc BI
```

Use MongoDB for:

```text
aggregate document state
flexible nested data
case documents
workflow state
tenant config
semi-structured forms
```

Pattern:

```text
MongoDB owns operational aggregate
PostgreSQL/warehouse owns analytics/reporting projection
```

Do not dual-write both as equal source of truth without clear ownership.

---

## 22. MongoDB + Kafka

Kafka is event log/stream platform.

Use Kafka for:

```text
cross-service event distribution
consumer groups
replay
stream processing
analytics pipeline
integration backbone
```

MongoDB outbox -> Kafka is common.

Flow:

```text
case-service writes outbox
publisher sends CaseEscalated to Kafka
consumers update projections/workflows
```

Kafka is not database. MongoDB is not Kafka.

Use each for its role.

---

## 23. MongoDB + RabbitMQ

RabbitMQ is message broker/work distribution/routing.

Use RabbitMQ for:

```text
task queues
command dispatch
work distribution
routing with exchanges
retry/dead-letter workflow
```

MongoDB stores durable state.

RabbitMQ moves work/messages.

Example:

```text
outbox event triggers document OCR job
RabbitMQ queue distributes OCR work
MongoDB stores OCR result metadata
```

---

## 24. MongoDB + Object Storage

Large binary files should usually live in object storage, not MongoDB documents.

MongoDB stores metadata:

```javascript
{
  tenantId,
  caseId,
  documentId,
  fileName,
  contentType,
  size,
  storageKey,
  checksum,
  classification,
  uploadedAt,
  retention,
  legalHold
}
```

Object storage stores bytes.

Rules:

- storage key not exposed directly,
- signed URL/proxy with authorization,
- region/data residency aligned,
- encryption,
- lifecycle retention,
- checksum validation,
- virus scan status.

---

## 25. MongoDB + Search Engine

MongoDB source/projection -> search index.

Pattern:

```text
case updated
  -> outbox/change stream
  -> search projector
  -> Atlas Search / OpenSearch / Elasticsearch
```

Search is derived.

Rules:

- tenant/auth filters,
- projection rebuild,
- lag metrics,
- deletion propagation,
- no sensitive fields unless authorized,
- relevance tests.

---

## 26. MongoDB + Analytics/Warehouse

Operational MongoDB is not always analytics system.

Pattern:

```text
operational MongoDB
  -> CDC/outbox/export
  -> data lake/warehouse
  -> BI/reporting
```

Use warehouse for:

```text
large joins
historical analytics
cross-domain reporting
ad hoc queries
cost-efficient scans
```

Ensure:

- PII governance,
- tenant consent/policy,
- retention,
- data lineage,
- schema versioning.

---

## 27. Multi-Tenant Platform Architecture

Core components:

```text
tenant registry
routing layer
policy service
case service
document service
search/projection service
notification service
retention service
support/admin portal
audit service/sink
```

Tenant registry drives:

- placement,
- region,
- tier,
- retention,
- encryption key,
- feature flags,
- quota.

MongoDB collections store tenant-owned data with tenantId and/or per-tenant database/cluster.

---

## 28. Cell Architecture

Cell architecture groups tenants into cells.

```text
Cell APAC-1:
  app instances
  MongoDB cluster/shards
  Redis
  search index
  outbox workers

Cell EU-1:
  app instances
  MongoDB cluster/shards
  Redis
  search index
  outbox workers
```

Benefits:

- blast radius reduction,
- data residency,
- tenant placement,
- scaling by cell,
- operational isolation.

Tenant registry maps:

```text
tenant-a -> cell APAC-1
tenant-b -> cell EU-1
```

Routing layer sends request to correct cell.

---

## 29. Large Tenant Isolation

For huge tenant:

```text
dedicated shard
dedicated database
dedicated cluster
dedicated cell
```

Decision criteria:

- data size,
- QPS,
- regulatory contract,
- noisy neighbor risk,
- restore requirement,
- cost.

Hybrid model:

```text
small tenants shared
large/premium tenants dedicated
```

Requires migration path:

```text
move tenant from shared to dedicated placement
```

---

## 30. Tenant Migration Between Cells

Tenant move is complex.

Steps:

```text
freeze or dual-write?
snapshot tenant data
copy to target cell
sync changes
validate counts/checksums
switch routing
rebuild projections/search
monitor
cleanup old cell after window
```

Use if business requires.

For many systems, avoid frequent tenant moves unless platform built for it.

---

## 31. API Boundary Pattern

For service-owned MongoDB data, expose API:

```text
GET /cases/{caseId}
POST /cases/{caseId}/escalate
GET /cases/search
```

Not:

```text
other service directly queries cases collection
```

Internal services can consume events/projections for read needs.

Direct DB sharing creates tight coupling.

---

## 32. Read Replica Service Pattern

If another service needs read-optimized view:

```text
case-service publishes CaseUpdated
reporting-service stores its own projection
```

This avoids cross-service database reads.

Trade-off:

- eventual consistency,
- projection rebuild,
- event contract.

But ownership boundary clearer.

---

## 33. BFF/API Composition

For UI screen needing multiple domains:

```text
case detail
documents
comments
tasks
notifications
```

Options:

- API gateway/BFF calls services,
- composition service,
- precomputed view model,
- modular monolith internal calls.

Avoid making frontend call many services if latency/security complex.

MongoDB can store composed view projection for heavy screens.

---

## 34. Workflow Engine vs MongoDB State Machine

For simple workflow:

```text
case status machine in MongoDB document
```

Good.

For complex long-running workflow:

```text
many steps
timers
human tasks
external callbacks
compensation
visibility
```

Consider workflow engine/process manager.

MongoDB can store process manager state, but don't reinvent full workflow engine accidentally.

---

## 35. State Machine Pattern

State transition:

```text
OPEN -> UNDER_REVIEW -> ESCALATED -> DECIDED -> CLOSED
```

Implement with guarded update:

```javascript
db.cases.updateOne(
  {
    tenantId,
    caseId,
    status: "UNDER_REVIEW",
    version: expectedVersion
  },
  {
    $set: {
      status: "ESCALATED",
      updatedAt: now
    },
    $inc: { version: 1 }
  }
)
```

Audit event stores transition.

This is robust and simple.

---

## 36. Event Sourcing With MongoDB

MongoDB can store event streams:

```text
case_events
```

Event sourcing means event log is source of truth.

Pros:

- complete history,
- replay,
- temporal reasoning,
- audit natural.

Cons:

- complexity,
- schema evolution of events,
- projections mandatory,
- query model separate,
- snapshots,
- replay cost,
- team maturity.

Do not choose event sourcing just because you need audit.

For most systems:

```text
state document + audit/outbox events
```

is simpler.

---

## 37. Snapshot Pattern

If event sourcing or long history, use snapshots.

```javascript
{
  tenantId,
  caseId,
  version: 120,
  state: {...},
  snapshotAt: ISODate(...)
}
```

Rehydrate:

```text
load latest snapshot
apply events after snapshot
```

But snapshot adds migration and consistency complexity.

Use only when event sourcing is truly chosen.

---

## 38. Materialized View Pattern

Dashboard summary:

```javascript
{
  tenantId,
  date,
  statusCounts: {
    open: 120,
    escalated: 4
  },
  updatedAt
}
```

Updated by:

- command handler,
- change stream,
- outbox consumer,
- scheduled aggregation.

Need reconciliation.

Materialized views are derived; never source of truth for commands.

---

## 39. Inbox/Outbox In Same Service

Service may both publish and consume events.

Collections:

```text
outbox_events
inbox_events
```

Outbox for events this service publishes.

Inbox for events this service consumes from others.

Both need retention.

---

## 40. Idempotency Record Pattern

For external API commands:

```javascript
{
  _id: "tenant-a:cmd-123",
  tenantId,
  commandId,
  operation: "ESCALATE_CASE",
  requestHash,
  responseSnapshot,
  status: "COMPLETED",
  createdAt,
  expiresAt
}
```

Flow:

```text
insert idempotency pending
execute command
store result
duplicate same commandId returns same response
duplicate different payload fails
```

This handles retries.

---

## 41. Distributed Lock Alternatives

Before adding distributed lock, consider MongoDB primitives:

### Unique index

```text
only one active assignment
```

### Conditional update

```text
update if status/version match
```

### findOneAndUpdate claim

```text
claim job with lease
```

### Transaction

```text
multi-document invariant
```

Locks often hide data modelling issue.

---

## 42. Reference Data Pattern

Reference data:

```text
case types
jurisdictions
product codes
policy versions
teams
roles
```

Options:

- embed snapshot in case,
- reference by ID,
- cache reference data,
- version reference data.

For audit/defensibility, store snapshot:

```javascript
product: {
  code: "AML",
  nameSnapshot: "Anti-Money Laundering"
}
```

so history remains meaningful if reference name changes.

---

## 43. Form/Schema-Driven Data

MongoDB fits dynamic forms.

Example:

```javascript
{
  tenantId,
  formId,
  formVersion,
  responses: {
    "field_1": "value",
    "field_2": 42
  }
}
```

Need:

- form schema version,
- validation,
- indexing selected fields,
- search projection,
- migration strategy,
- type safety boundary.

Do not query arbitrary dynamic fields without index plan.

---

## 44. Policy Snapshot Pattern

For decisions:

```text
why was this action allowed?
```

Store policy snapshot/version:

```javascript
{
  decision: "APPROVED",
  policySnapshot: {
    policyId: "enforcement-decision-v3",
    ruleVersion: "2026-05-01",
    evaluatedFactsHash: "..."
  }
}
```

This helps audit.

---

## 45. Integration Contract Versioning

Events and APIs need schema version.

Outbox event:

```javascript
{
  eventType: "CaseEscalated",
  schemaVersion: 2,
  payload: {...}
}
```

Consumers must tolerate additive fields.

Breaking changes require:

- new version,
- dual publish maybe,
- compatibility window,
- contract tests.

Database schema version and event schema version are different.

---

## 46. Modular Boundary Checklist

For each module/service:

```text
owned aggregates
owned collections
public APIs
published events
consumed events
read projections
data retention
security boundary
operational owner
SLO
```

If ownership unclear, architecture will decay.

---

## 47. Reference Architecture: Regulatory Case Platform

Components:

```text
case-command-service
case-query-service
case-search-service
document-service
notification-service
retention-service
reporting-service
tenant-admin-service
support-access-service
```

Storage:

```text
MongoDB:
  cases, case_audit_events, case_notes, case_documents metadata,
  outbox_events, idempotency_records, retention_records

Object storage:
  evidence files

Search:
  case_search_documents / Atlas Search / OpenSearch

Redis:
  cache, rate limits

Kafka/RabbitMQ:
  integration events / async jobs

Warehouse:
  long-term analytics
```

---

## 48. Command Flow Example

Escalate case:

```text
1. API receives commandId.
2. Authenticate user.
3. Resolve tenant and permissions.
4. Insert/check idempotency record.
5. Transaction:
   - guarded update case
   - insert audit event
   - insert outbox CaseEscalated
6. Return result.
7. Outbox publisher sends event.
8. Projection consumers update worklist/search/dashboard.
9. Notification service sends supervisor notification idempotently.
```

This pattern separates correctness from async side effects.

---

## 49. Query Flow Example

Case worklist:

```text
1. API resolves tenant/user.
2. Query case_worklist_items with tenant + assignee/team + status.
3. Index supports dueAt sort.
4. Return cursor page.
5. On command, verify source case before state change.
```

Projection can be stale, but command side enforces truth.

---

## 50. Search Flow Example

Search cases:

```text
1. User query validated.
2. Tenant and authorization filters built.
3. Search projection queried.
4. Results include caseId/sourceVersion.
5. Detail view fetches source case and rechecks authorization.
6. If projection stale, source wins.
```

Search is discovery, not final authority.

---

## 51. Retention Flow Example

Retention worker:

```text
1. Load tenant policy.
2. Find eligible retention_records.
3. Exclude legal hold.
4. Dry-run/approval if required.
5. Archive/delete/anonymize in batches.
6. Write deletion manifest.
7. Emit audit/outbox event.
8. Rebuild/remove projections/search.
```

Retention is domain workflow.

---

## 52. Reporting Flow Example

Operational queries should not become analytics monster.

Flow:

```text
MongoDB operational source
  -> outbox/change stream/export
  -> reporting projection/warehouse
  -> BI dashboards
```

Avoid running huge cross-tenant aggregations on primary operational collections.

---

## 53. Architecture Decision Record Template

For MongoDB decisions:

```text
Decision:
Context:
Forces:
Access patterns:
Data growth:
Consistency needs:
Tenancy/security:
Alternatives:
Chosen design:
Trade-offs:
Operational implications:
Migration path:
Rollback:
Monitoring:
```

Use ADRs for:

- embed vs reference,
- shard key,
- projection,
- outbox,
- search engine,
- tenancy model,
- backup/DR.

---

## 54. Production Architecture Checklist

```text
[ ] aggregate boundaries documented
[ ] collection ownership clear
[ ] hot query inventory exists
[ ] indexes mapped to queries
[ ] command writes idempotent
[ ] audit/outbox atomic where needed
[ ] external side effects outboxed
[ ] projections rebuildable
[ ] search authorization-aware
[ ] tenant routing defined
[ ] retention/legal hold modelled
[ ] backup/restore tested
[ ] observability per operation
[ ] migration strategy expand-contract
[ ] failure runbooks exist
```

---

## 55. Anti-Architecture Smells

```text
every service writes same collection
frontend queries arbitrary search DSL
all operations use transaction
no service owns outbox
MongoDB used as queue at high scale
search projection not rebuildable
tenant registry missing
one database credential for all services
no clear source of truth
reporting queries hit primary operational collection
cache stores unauthorized shared data
```

---

## 56. Senior-Level Heuristics

```text
Use MongoDB for aggregate state, not for every data problem.

Use outbox for external effects, not direct publish inside transaction.

Use projections when query pattern conflicts with command model.

Use Redis for cache/rate limiting, not source of truth.

Use Kafka/RabbitMQ for event/message distribution, not MongoDB polling at extreme scale.

Use PostgreSQL when relational constraints/reporting dominate.

Use search index for relevance, not command validation.

Use tenant registry as control plane for multi-tenant placement.

Use cell architecture when blast radius/residency/scaling require it.

Do not introduce microservices before ownership boundaries are real.
```

---

## 57. Practical Exercise

Design architecture for this platform:

```text
A multi-tenant regulatory case platform:
- case lifecycle with strict audit
- evidence documents in object storage
- full-text and semantic search
- worklist per reviewer
- notifications
- dashboards
- retention/legal hold
- premium tenants with dedicated placement
- integrations to external registries
- Java/Spring Boot services
```

Answer:

1. service/module boundaries,
2. MongoDB collections per boundary,
3. aggregate boundaries,
4. command flow,
5. query projections,
6. outbox/inbox,
7. broker usage,
8. Redis usage,
9. search architecture,
10. object storage architecture,
11. tenancy routing,
12. retention workflow,
13. observability and DR.

Suggested architecture:

```text
case-service:
  cases, case_audit_events, outbox, idempotency

document-service:
  document metadata, object storage refs

search-service:
  search projections/index

notification-service:
  inbox, notification status

retention-service:
  retention_records, deletion manifests

tenant-service:
  tenant registry, placement, policy

Redis:
  cache/rate limit

Kafka/RabbitMQ:
  domain events/jobs

Object storage:
  evidence bytes

Warehouse:
  analytics
```

---

## 58. Summary

MongoDB works best as part of an intentional architecture.

Key lessons:

1. MongoDB is strong as an aggregate/document store.
2. Collection boundary is not the same as service boundary.
3. Modular monolith can be better than premature microservices.
4. Microservices require clear data ownership.
5. CQRS/projections solve conflicting query patterns.
6. Outbox provides reliable domain event publishing.
7. Inbox provides idempotent event consumption.
8. Sagas/process managers coordinate long-running cross-service workflows.
9. Redis, Kafka, RabbitMQ, PostgreSQL, search engines, and object storage complement MongoDB.
10. Search/cache/projections are derived and rebuildable.
11. Tenant registry is control plane for multi-tenant systems.
12. Cell architecture can reduce blast radius and support residency.
13. Avoid distributed transaction fantasies; design local transactions + events + compensation.
14. Architecture decisions need documented trade-offs.
15. Production readiness includes ownership, observability, migration, security, and DR.

The most important sentence:

> MongoDB architecture succeeds when document boundaries, service ownership, query projections, integration events, and operational responsibilities are aligned around explicit domain invariants.

---

## 59. Bridge to Part 033

Part 033 will begin the capstone:

- designing a regulatory case management platform,
- requirements,
- domain model,
- aggregate boundaries,
- collections,
- indexes,
- tenancy,
- security,
- audit,
- search,
- retention,
- DR,
- event-driven integration,
- operational model.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-033.md
```

Judul berikutnya:

```text
Part 033 — Capstone I: Designing a Regulatory Case Management Platform on MongoDB
```

---

## 60. Status Seri

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
Part 032 — Architecture Patterns: MongoDB in Distributed Java Systems
```

Seri belum selesai. Masih lanjut ke Part 033 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Anti-Patterns and Failure Case Catalogue</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-033.md">Part 033 — Capstone I: Designing a Regulatory Case Management Platform on MongoDB ➡️</a>
</div>

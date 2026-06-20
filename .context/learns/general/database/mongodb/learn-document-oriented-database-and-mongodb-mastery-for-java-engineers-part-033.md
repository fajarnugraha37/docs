# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-033.md

# Part 033 — Capstone I: Designing a Regulatory Case Management Platform on MongoDB

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 033 dari 035  
> Fokus: capstone arsitektur end-to-end untuk regulatory case management platform menggunakan MongoDB, Java/Spring Boot, outbox, search, retention, tenancy, audit, observability, dan disaster recovery  
> Target pembaca: Java software engineer / tech lead yang ingin melihat bagaimana semua konsep MongoDB dari seri ini dipakai bersama dalam desain sistem production-grade

---

## 0. Posisi Part Ini Dalam Seri

Bagian sebelumnya membahas architecture patterns. Sekarang kita masuk capstone.

Capstone ini akan mendesain satu sistem besar:

```text
Regulatory Case Management Platform
```

Bayangkan platform untuk lembaga regulator, compliance division, atau enterprise investigation team.

Sistem ini harus mendukung:

- multi-tenant,
- case lifecycle,
- strict audit,
- evidence/document management,
- reviewer worklist,
- search,
- semantic retrieval,
- dashboard,
- notifications,
- legal hold,
- retention,
- export,
- support access,
- backup/restore,
- data residency,
- operational observability.

Tujuan capstone bukan membuat satu desain yang “paling benar”. Tujuannya menunjukkan cara berpikir:

```text
requirement -> invariants -> aggregate boundary -> collection design -> index -> consistency model -> operational model
```

Kalimat inti:

> Production-grade MongoDB design starts from domain invariants and access patterns, not from collection names.

---

## 1. Problem Statement

Kita membangun platform bernama:

```text
Regulatory Case Management Platform
```

Platform digunakan oleh beberapa tenant:

```text
Tenant A: financial regulator region APAC
Tenant B: European compliance agency
Tenant C: large bank internal compliance
Tenant D: premium enterprise tenant with dedicated isolation
```

User dapat:

- membuat case,
- assign case ke reviewer/team,
- menambahkan parties,
- upload evidence documents,
- menulis notes,
- melakukan status transition,
- apply legal hold,
- search cases/documents,
- melihat worklist,
- generate dashboard,
- export case package,
- close case,
- menjalankan retention/archive.

---

## 2. Functional Requirements

### 2.1 Case Lifecycle

Case status:

```text
DRAFT
OPEN
UNDER_REVIEW
ESCALATED
AWAITING_DECISION
DECIDED
CLOSED
ARCHIVED
```

Transitions:

```text
DRAFT -> OPEN
OPEN -> UNDER_REVIEW
UNDER_REVIEW -> ESCALATED
UNDER_REVIEW -> AWAITING_DECISION
ESCALATED -> AWAITING_DECISION
AWAITING_DECISION -> DECIDED
DECIDED -> CLOSED
CLOSED -> ARCHIVED
```

Rules:

- only authorized roles can transition,
- transition requires reason,
- transition must produce audit event,
- some transitions notify users,
- transition must be idempotent by command ID.

### 2.2 Worklist

Users need list of cases assigned to them or their team.

Filter:

```text
tenant
assignee
team
status
due date
priority
jurisdiction
```

Sort:

```text
dueAt ASC
priority DESC maybe
updatedAt DESC
```

### 2.3 Search

Users need:

- exact case number search,
- party name autocomplete,
- full-text search on summary/allegation text,
- filter by status/jurisdiction/product/team,
- semantic search over evidence text,
- geospatial search for incident/inspection location.

Search must be tenant-aware and authorization-aware.

### 2.4 Audit

Every meaningful action must be auditable:

- actor,
- tenant,
- case,
- action,
- reason,
- before/after,
- policy version,
- command ID,
- occurredAt/recordedAt,
- correlation ID.

Audit should be append-only.

### 2.5 Evidence

Evidence files stored in object storage. MongoDB stores metadata.

Evidence metadata includes:

- file name,
- content type,
- size,
- checksum,
- storage key,
- classification,
- legal hold,
- virus scan status,
- OCR status,
- extracted text reference,
- retention.

### 2.6 Retention and Legal Hold

Each tenant has retention policy.

Legal hold can prevent deletion/archive.

Closed cases may be:

- archived,
- anonymized,
- deleted,
- preserved indefinitely.

### 2.7 Multi-Tenancy

Tenant boundary mandatory.

Some tenants are shared.

Premium tenants may be dedicated database/cluster/cell.

EU tenants must remain in EU including backups/search/object storage.

### 2.8 Notifications

Actions may trigger notifications:

- case assigned,
- escalated,
- decision requested,
- legal hold applied,
- export ready.

Notifications must not be duplicated on retry.

### 2.9 Reporting and Dashboard

Dashboards:

- open cases by status,
- overdue cases,
- cases by product/jurisdiction,
- transition throughput,
- SLA breach,
- retention backlog.

Dashboard can lag 30-60 seconds.

### 2.10 Export

Authorized user can export case package.

Export includes:

- case core,
- audit trail,
- notes,
- parties,
- document metadata,
- selected files,
- manifest,
- checksum.

Export is async and audited.

---

## 3. Non-Functional Requirements

### 3.1 Availability

```text
case command API: high availability
search: degraded acceptable
dashboard: degraded acceptable
export: async, can be delayed
```

### 3.2 Consistency

```text
case transition + audit + outbox:
  strongly consistent within local transaction

search/worklist/dashboard:
  eventually consistent

notifications:
  at-least-once delivery, idempotent processing

retention:
  controlled batch with audit
```

### 3.3 Performance

```text
case detail p95 < 200ms
worklist p95 < 200ms
case transition p95 < 300ms
search p95 < 700ms
dashboard p95 < 1s or precomputed
```

### 3.4 Security

```text
tenant isolation
role/team/sensitivity authorization
audit support access
TLS
least privilege
secrets management
sensitive field redaction
backup encryption
```

### 3.5 Compliance

```text
audit retained 10 years
legal hold overrides retention
export audited
deletion manifest required
data residency enforced
restore drills recorded
```

---

## 4. Core Domain Invariants

Important invariants:

```text
case status transition must follow state machine
case transition must be audited
case update must not lose concurrent changes
case belongs to exactly one tenant
tenant data must not leak
case number unique per tenant
legal hold prevents deletion/archive
evidence file metadata must match object checksum
notification must not duplicate for same event
retention deletion must be auditable
support access must be approved and audited
```

Design follows these invariants.

---

## 5. Bounded Contexts / Modules

Suggested modules/services:

```text
tenant-service
identity/access module
case-command-service
case-query-service
document-service
search-service
notification-service
retention-service
export-service
support-access-service
reporting-service
```

For smaller team, these can be modules in modular monolith.

For larger organization, some become services.

Ownership:

```text
case-command-service owns cases and case audit
document-service owns document metadata and storage coordination
search-service owns search projection/index
retention-service owns retention execution
tenant-service owns tenant registry/policy
```

---

## 6. High-Level Architecture

```text
                         +----------------------+
                         |      API Gateway     |
                         +----------+-----------+
                                    |
                                    v
+----------------+       +----------------------+       +----------------+
| Identity/IdP   |<----->| Java/Spring Services |<----->| Redis          |
+----------------+       +----------+-----------+       +----------------+
                                    |
                                    v
                         +----------------------+
                         | MongoDB              |
                         | cases, audit, etc.   |
                         +----------+-----------+
                                    |
                  +-----------------+------------------+
                  |                                    |
                  v                                    v
        +------------------+                 +------------------+
        | Outbox Publisher |                 | Projection Workers|
        +--------+---------+                 +--------+---------+
                 |                                    |
                 v                                    v
        +------------------+                 +------------------+
        | Kafka/RabbitMQ   |                 | Search Index      |
        +------------------+                 +------------------+

External:
  Object storage for evidence files
  Warehouse for analytics
  KMS/secret manager
  Observability stack
```

---

## 7. Tenancy Model

Use hybrid:

```text
small/medium tenants:
  shared regional cluster/cell

large/premium tenants:
  dedicated database/cluster/cell

EU tenants:
  EU cell

APAC tenants:
  APAC cell
```

Tenant registry:

```javascript
{
  _id: "tenant-a",
  tenantCode: "TENANT_A",
  name: "Tenant A",
  status: "ACTIVE",
  tier: "SHARED" | "DEDICATED_DB" | "DEDICATED_CLUSTER",
  cell: "apac-1",
  region: "APAC",
  jurisdiction: "ID",
  dataResidency: {
    allowedRegions: ["ap-southeast-3"],
    primaryRegion: "ap-southeast-3"
  },
  storagePlacement: {
    mode: "SHARED_COLLECTION",
    database: "case_platform",
    clusterRef: "mongodb-apac-1",
    shardZone: "APAC"
  },
  retentionPolicyId: "case-retention-7y-v1",
  encryptionKeyRef: "kms-key-tenant-a",
  featureFlags: {
    semanticSearch: true,
    premiumRestore: false
  },
  quotas: {
    maxConcurrentExports: 2,
    bulkImportConcurrency: 1
  },
  createdAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Tenant registry is control plane.

---

## 8. Collection Overview

Main collections:

```text
tenants
cases
case_audit_events
case_parties
case_notes
case_documents
case_worklist_items
case_search_documents
evidence_chunks
case_dashboard_summaries
retention_records
legal_hold_records
outbox_events
idempotency_records
inbox_events
export_jobs
support_access_requests
support_access_audit
migration_state
deletion_manifests
archive_manifests
```

Some are source of truth, some are projections.

---

## 9. Source vs Derived Classification

### Source of Truth

```text
tenants
cases
case_audit_events
case_parties
case_notes
case_documents
retention_records
legal_hold_records
support_access_requests
idempotency_records within active window
outbox_events until safely dispatched/retained
```

### Derived

```text
case_worklist_items
case_search_documents
evidence_chunks embeddings if rebuildable from source/OCR
case_dashboard_summaries
cache
search index
warehouse tables
```

### External Source/Dependency

```text
object storage evidence bytes
identity provider
KMS keys
message broker
```

DR and backup strategy depends on this classification.

---

## 10. `cases` Collection

Purpose:

```text
authoritative current case state
bounded aggregate core
command-side state transitions
detail header
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  caseNumber: "CASE-2026-0001",
  schemaVersion: 1,

  status: "UNDER_REVIEW",
  priority: "HIGH",
  productCode: "LENDING",
  jurisdiction: "ID",
  region: "APAC",

  title: "Suspicious lending practice investigation",
  summary: "Short summary for case detail and search projection.",

  ownerUserId: "u123",
  ownerTeamId: "team-enforcement",

  lifecycle: {
    openedAt: ISODate(...),
    dueAt: ISODate(...),
    closedAt: null,
    archivedAt: null
  },

  access: {
    owningTeamId: "team-enforcement",
    sensitivity: "CONFIDENTIAL",
    allowedRoleCodes: ["INVESTIGATOR", "SUPERVISOR"],
    restricted: true
  },

  sla: {
    dueAt: ISODate(...),
    breached: false,
    breachAt: null
  },

  counters: {
    noteCount: 12,
    documentCount: 5,
    partyCount: 3
  },

  latestNotePreview: {
    noteId: "note-11",
    textPreview: "Requested additional evidence...",
    createdAt: ISODate(...)
  },

  retention: {
    policyId: "case-retention-7y-v1",
    retainUntil: null,
    deleteAfter: null,
    legalHold: false
  },

  version: 17,
  createdAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Bounded data only.

Unbounded:

- notes,
- audit events,
- documents,
- full party details,
- workflow history,

go to separate collections.

---

## 11. `cases` Indexes

### Unique Case Number Per Tenant

```javascript
db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true }
)
```

### Case Lookup

```javascript
db.cases.createIndex(
  { tenantId: 1, caseId: 1 },
  { unique: true }
)
```

### Worklist If Querying Cases Directly

```javascript
db.cases.createIndex({
  tenantId: 1,
  ownerUserId: 1,
  status: 1,
  "lifecycle.dueAt": 1,
  _id: 1
})
```

However, worklist uses projection collection for scale.

### Retention Candidate

```javascript
db.cases.createIndex({
  tenantId: 1,
  "retention.deleteAfter": 1,
  "retention.legalHold": 1,
  status: 1
})
```

### Admin By Status

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  updatedAt: -1
})
```

Indexes are mapped to query inventory.

---

## 12. Case State Transition

Command:

```text
EscalateCase
```

Request:

```json
{
  "commandId": "cmd-abc-123",
  "reason": "SLA breach",
  "expectedVersion": 17
}
```

Flow:

```text
1. resolve tenant/user
2. validate permission
3. check idempotency
4. transaction:
   - guarded update cases
   - insert audit event
   - insert outbox event
   - insert/update idempotency result
5. return result
```

Guarded update:

```javascript
db.cases.updateOne(
  {
    tenantId: "tenant-a",
    caseId: "case-2026-0001",
    status: "UNDER_REVIEW",
    version: 17
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

If matchedCount = 0:

```text
conflict
invalid state
wrong version
not found
```

Service maps result carefully.

---

## 13. Idempotency Record

Collection:

```text
idempotency_records
```

Document:

```javascript
{
  _id: "tenant-a:cmd-abc-123",
  tenantId: "tenant-a",
  commandId: "cmd-abc-123",
  operation: "ESCALATE_CASE",
  requestHash: "sha256...",
  status: "COMPLETED",
  result: {
    caseId: "case-2026-0001",
    newStatus: "ESCALATED",
    version: 18
  },
  createdAt: ISODate(...),
  expiresAt: ISODate(...)
}
```

Index:

```javascript
db.idempotency_records.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
)
```

Retention window should cover client retries and uncertainty.

---

## 14. Audit Event Collection

Collection:

```text
case_audit_events
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001:v18",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  caseNumber: "CASE-2026-0001",
  aggregateType: "CASE",
  eventType: "CASE_ESCALATED",
  versionAfter: 18,
  sequence: 18,

  actor: {
    actorType: "USER",
    userId: "u123",
    displayNameSnapshot: "Reviewer A",
    roleSnapshot: ["INVESTIGATOR"]
  },

  reason: "SLA breach",

  before: {
    status: "UNDER_REVIEW",
    version: 17
  },

  after: {
    status: "ESCALATED",
    version: 18
  },

  policySnapshot: {
    transitionPolicyVersion: "case-state-v6",
    authorizationPolicyVersion: "case-access-v4"
  },

  commandId: "cmd-abc-123",
  correlationId: "corr-xyz",
  occurredAt: ISODate(...),
  recordedAt: ISODate(...)
}
```

Indexes:

```javascript
db.case_audit_events.createIndex({
  tenantId: 1,
  caseId: 1,
  sequence: 1
})

db.case_audit_events.createIndex({
  tenantId: 1,
  "actor.userId": 1,
  occurredAt: -1
})

db.case_audit_events.createIndex({
  tenantId: 1,
  eventType: 1,
  occurredAt: -1
})

db.case_audit_events.createIndex({
  tenantId: 1,
  occurredAt: -1
})
```

Audit is append-only.

---

## 15. Parties Collection

Collection:

```text
case_parties
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001:party-1",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  partyId: "party-1",
  role: "SUBJECT",
  partyType: "PERSON",
  name: {
    displayName: "Jane Doe",
    normalized: "jane doe"
  },
  identifiers: {
    nationalIdEncrypted: "...",
    nationalIdHash: "hmac..."
  },
  address: {
    country: "ID",
    city: "Jakarta"
  },
  sensitivity: "RESTRICTED",
  createdAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Indexes:

```javascript
db.case_parties.createIndex({
  tenantId: 1,
  caseId: 1,
  partyId: 1
}, { unique: true })

db.case_parties.createIndex({
  tenantId: 1,
  "name.normalized": 1
})

db.case_parties.createIndex({
  tenantId: 1,
  "identifiers.nationalIdHash": 1
})
```

Party search may use search projection/autocomplete, not raw regex.

---

## 16. Notes Collection

Collection:

```text
case_notes
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001:note-123",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  noteId: "note-123",
  body: "Requested additional evidence from institution.",
  visibility: "INTERNAL",
  sensitivity: "CONFIDENTIAL",
  createdBy: {
    userId: "u123",
    displayNameSnapshot: "Reviewer A"
  },
  createdAt: ISODate(...),
  updatedAt: ISODate(...),
  deleted: false
}
```

Indexes:

```javascript
db.case_notes.createIndex({
  tenantId: 1,
  caseId: 1,
  createdAt: -1
})

db.case_notes.createIndex({
  tenantId: 1,
  createdBy: 1,
  createdAt: -1
})
```

Notes are unbounded, so not embedded fully in `cases`.

---

## 17. Document Metadata Collection

Collection:

```text
case_documents
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001:doc-123",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  documentId: "doc-123",

  fileName: "evidence.pdf",
  contentType: "application/pdf",
  sizeBytes: 481923,
  checksumSha256: "...",

  storage: {
    provider: "s3",
    bucketRef: "evidence-apac",
    storageKey: "tenant-a/case-2026-0001/doc-123",
    region: "ap-southeast-3"
  },

  classification: "CONFIDENTIAL",
  virusScan: {
    status: "CLEAN",
    scannedAt: ISODate(...)
  },

  ocr: {
    status: "COMPLETED",
    textExtractRef: "ocr/doc-123/v1",
    completedAt: ISODate(...)
  },

  retention: {
    policyId: "evidence-retention-10y-v1",
    legalHold: false,
    retainUntil: ISODate(...),
    deleteAfter: ISODate(...)
  },

  uploadedBy: {
    userId: "u123",
    displayNameSnapshot: "Reviewer A"
  },
  uploadedAt: ISODate(...)
}
```

Indexes:

```javascript
db.case_documents.createIndex({
  tenantId: 1,
  caseId: 1,
  uploadedAt: -1
})

db.case_documents.createIndex({
  tenantId: 1,
  documentId: 1
}, { unique: true })

db.case_documents.createIndex({
  tenantId: 1,
  "retention.deleteAfter": 1,
  "retention.legalHold": 1
})
```

Object bytes live outside MongoDB.

---

## 18. Worklist Projection

Collection:

```text
case_worklist_items
```

Document:

```javascript
{
  _id: "tenant-a:u123:case-2026-0001",
  tenantId: "tenant-a",
  assigneeId: "u123",
  teamId: "team-enforcement",
  caseId: "case-2026-0001",
  caseNumber: "CASE-2026-0001",
  title: "Suspicious lending practice investigation",
  status: "ESCALATED",
  priority: "HIGH",
  dueAt: ISODate(...),
  jurisdiction: "ID",
  productCode: "LENDING",
  sensitivity: "CONFIDENTIAL",
  sourceVersion: 18,
  projectedAt: ISODate(...)
}
```

Indexes:

```javascript
db.case_worklist_items.createIndex({
  tenantId: 1,
  assigneeId: 1,
  status: 1,
  dueAt: 1,
  _id: 1
})

db.case_worklist_items.createIndex({
  tenantId: 1,
  teamId: 1,
  status: 1,
  dueAt: 1,
  _id: 1
})
```

Source:

```text
cases + assignment rules
```

Update via outbox/change stream.

Rebuildable from `cases`.

---

## 19. Search Projection

Collection:

```text
case_search_documents
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  caseNumber: "CASE-2026-0001",
  title: "Suspicious lending practice investigation",
  summary: "Short summary...",
  searchableText: "Suspicious lending practice investigation ...",
  partyNames: ["Jane Doe", "ACME Ltd"],
  productCode: "LENDING",
  jurisdiction: "ID",
  status: "ESCALATED",
  priority: "HIGH",
  ownerUserId: "u123",
  ownerTeamId: "team-enforcement",

  permission: {
    owningTeamId: "team-enforcement",
    sensitivity: "CONFIDENTIAL",
    allowedRoleCodes: ["INVESTIGATOR", "SUPERVISOR"]
  },

  lifecycle: {
    openedAt: ISODate(...),
    dueAt: ISODate(...),
    closedAt: null
  },

  sourceVersion: 18,
  projectionVersion: 3,
  projectedAt: ISODate(...)
}
```

Search index includes:

- exact case number,
- autocomplete case number,
- autocomplete party names,
- full-text title/summary/searchableText,
- filterable tenant/status/jurisdiction/product/permission,
- facets by status/product/jurisdiction/year.

Search query must include tenant and auth filters.

---

## 20. Evidence Chunks For Semantic Search

Collection:

```text
evidence_chunks
```

Document:

```javascript
{
  _id: "tenant-a:doc-123:chunk-0007",
  tenantId: "tenant-a",
  caseId: "case-2026-0001",
  documentId: "doc-123",
  chunkId: "chunk-0007",

  source: {
    documentVersion: 1,
    ocrVersion: 2,
    pageFrom: 3,
    pageTo: 3
  },

  text: "The transaction pattern indicates repeated small transfers...",
  embedding: [0.012, -0.091, 0.33],

  embeddingMetadata: {
    model: "embedding-model-x",
    modelVersion: "2026-01",
    dimensions: 768
  },

  classification: "CONFIDENTIAL",
  permission: {
    owningTeamId: "team-enforcement",
    sensitivity: "CONFIDENTIAL"
  },

  createdAt: ISODate(...),
  sourceVersion: 5
}
```

Vector search must filter:

```text
tenantId
case permission
classification/sensitivity
document status
embedding model version
```

---

## 21. Dashboard Summaries

Collection:

```text
case_dashboard_summaries
```

Document:

```javascript
{
  _id: "tenant-a:2026-06-21:status-summary",
  tenantId: "tenant-a",
  date: "2026-06-21",
  summaryType: "CASE_STATUS",
  statusCounts: {
    open: 120,
    underReview: 45,
    escalated: 6,
    awaitingDecision: 9,
    closed: 1000
  },
  overdueCount: 12,
  sourceWatermark: ISODate(...),
  updatedAt: ISODate(...)
}
```

Dashboard can lag.

Updated by projection worker or scheduled aggregation.

Reconciled periodically.

---

## 22. Retention Records

Collection:

```text
retention_records
```

Document:

```javascript
{
  _id: "tenant-a:CASE:case-2026-0001",
  tenantId: "tenant-a",
  aggregateType: "CASE",
  aggregateId: "case-2026-0001",
  retentionPolicyId: "case-retention-7y-v1",
  status: "ACTIVE" | "ELIGIBLE" | "HELD" | "ARCHIVED" | "DELETED",
  closedAt: ISODate(...),
  retainUntil: ISODate(...),
  deleteAfter: ISODate(...),
  legalHold: false,
  disposition: "ARCHIVE_THEN_DELETE",
  lastEvaluatedAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Index:

```javascript
db.retention_records.createIndex({
  tenantId: 1,
  status: 1,
  deleteAfter: 1,
  legalHold: 1
})
```

Retention worker is tenant-scoped and audited.

---

## 23. Legal Hold Records

Collection:

```text
legal_hold_records
```

Document:

```javascript
{
  _id: "tenant-a:hold-123",
  tenantId: "tenant-a",
  targetType: "CASE",
  targetId: "case-2026-0001",
  status: "ACTIVE",
  reason: "Court order ABC",
  appliedBy: {
    userId: "legal-1",
    displayNameSnapshot: "Legal Officer"
  },
  appliedAt: ISODate(...),
  releasedBy: null,
  releasedAt: null,
  approvalRef: "approval-987"
}
```

Legal hold updates source retention state and emits audit.

Never rely only on a flag without evidence record.

---

## 24. Outbox Events

Collection:

```text
outbox_events
```

Document:

```javascript
{
  _id: "tenant-a:case-2026-0001:CaseEscalated:v18",
  tenantId: "tenant-a",
  aggregateType: "CASE",
  aggregateId: "case-2026-0001",
  eventType: "CaseEscalated",
  schemaVersion: 2,
  payload: {
    caseId: "case-2026-0001",
    caseNumber: "CASE-2026-0001",
    fromStatus: "UNDER_REVIEW",
    toStatus: "ESCALATED",
    version: 18
  },
  occurredAt: ISODate(...),
  status: "PENDING",
  availableAt: ISODate(...),
  attempts: 0,
  leaseOwner: null,
  leaseUntil: null,
  lastError: null
}
```

Indexes:

```javascript
db.outbox_events.createIndex({
  status: 1,
  availableAt: 1,
  leaseUntil: 1
})

db.outbox_events.createIndex({
  tenantId: 1,
  aggregateId: 1,
  occurredAt: 1
})
```

Published to Kafka/RabbitMQ for integration.

---

## 25. Export Jobs

Collection:

```text
export_jobs
```

Document:

```javascript
{
  _id: "tenant-a:export-123",
  tenantId: "tenant-a",
  exportId: "export-123",
  requestedBy: {
    userId: "u123",
    displayNameSnapshot: "Supervisor A"
  },
  scope: {
    type: "CASE",
    caseId: "case-2026-0001"
  },
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "EXPIRED",
  options: {
    includeEvidenceFiles: true,
    includeAudit: true,
    redactRestrictedFields: false
  },
  artifact: {
    storageKey: null,
    checksumSha256: null,
    expiresAt: null
  },
  approvalRef: "approval-123",
  createdAt: ISODate(...),
  completedAt: null
}
```

Export is async, audited, rate-limited, encrypted.

---

## 26. Support Access

Collection:

```text
support_access_requests
```

Document:

```javascript
{
  _id: "support-access-123",
  tenantId: "tenant-a",
  requestedBy: "support-user-1",
  approvedBy: "tenant-admin-1",
  scope: {
    type: "CASE",
    caseId: "case-2026-0001",
    permissions: ["READ_METADATA", "READ_AUDIT"]
  },
  reason: "Troubleshooting export failure",
  status: "APPROVED",
  validFrom: ISODate(...),
  validUntil: ISODate(...),
  createdAt: ISODate(...)
}
```

Every support access event writes audit:

```text
support_access_audit
```

Support tooling uses same tenant/auth guardrails.

---

## 27. Sharding Strategy

Initial non-sharded may be acceptable. For large scale, candidate shard keys:

### `cases`

```javascript
{ tenantId: 1, caseId: "hashed" }
```

Rationale:

- tenant scoped,
- case lookup targeted,
- large tenant can distribute,
- avoids tenantId-only huge tenant hotspot.

### `case_audit_events`

Option A:

```javascript
{ tenantId: 1, caseId: 1, sequence: 1 }
```

Good for case audit history.

Option B:

```javascript
{ tenantId: 1, eventId: "hashed" }
```

Better write distribution but worse case history locality.

Choose based on audit read/write distribution.

### `case_worklist_items`

```javascript
{ tenantId: 1, assigneeId: 1, dueAt: 1 }
```

or separate strategy based on workload.

### Search projection

Depends on Atlas Search / search backend; tenant filter mandatory.

### Zone Sharding

For data residency:

```javascript
{ region: 1, tenantId: 1, caseId: "hashed" }
```

If region-based placement required.

Warning:

```text
Shard key must be validated with real query matrix and tenant skew.
```

---

## 28. Java Service Layer Design

Package structure example:

```text
com.acme.caseplatform.casecommand
  application
  domain
  infrastructure.mongo
  infrastructure.outbox
  api

com.acme.caseplatform.casequery
  application
  infrastructure.mongo
  api

com.acme.caseplatform.retention
com.acme.caseplatform.search
com.acme.caseplatform.tenant
```

Keep domain independent from MongoDB driver classes.

Use adapters:

```text
CaseDocumentMapper
CaseRepositoryMongo
AuditEventRepositoryMongo
OutboxRepositoryMongo
```

Domain command handler should not build raw BSON directly.

---

## 29. Transaction Boundary

For case transition:

```text
case update + audit insert + outbox insert + idempotency update
```

Use transaction if on replica set/sharded cluster with compatible shard locality.

Pseudo:

```java
transactionTemplate.execute(session -> {
    IdempotencyResult existing = idempotency.tryStart(commandId, requestHash);
    if (existing.completed()) return existing.response();

    CaseUpdateResult update = caseRepository.escalate(session, command);

    auditRepository.insert(session, auditEvent);
    outboxRepository.insert(session, outboxEvent);
    idempotency.complete(session, commandId, response);

    return response;
});
```

If transaction fails with unknown commit, use idempotency to reconcile.

---

## 30. Repository Contract

Repository methods require tenant.

```java
interface CaseRepository {
    Optional<CaseDocument> findByTenantAndCaseId(TenantId tenantId, CaseId caseId);

    TransitionUpdateResult transition(
        ClientSession session,
        TenantId tenantId,
        CaseId caseId,
        CaseStatus expectedStatus,
        long expectedVersion,
        CaseStatus newStatus,
        Instant now
    );
}
```

No:

```java
findById(caseId)
```

No tenantless operations for tenant-owned data.

---

## 31. Authorization Model

Authorization filter fields in `cases` and projections:

```javascript
access: {
  owningTeamId,
  sensitivity,
  allowedRoleCodes,
  restricted
}
```

Application builds criteria:

```text
tenantId == ctx.tenantId
AND (
  owningTeamId IN user.teams
  OR role SUPERVISOR
)
AND sensitivity <= user.clearance
```

Commands also check domain-specific permission.

Search/detail/list all apply authorization.

Detail endpoint rechecks source document even if found by search.

---

## 32. Security Design

Baseline:

```text
TLS
private network
least privilege DB users per service
secret manager
no raw Mongo URI logs
tenant-aware query guardrails
sensitive field classification
field encryption/HMAC for identifiers
backup encryption
support access audit
```

DB users:

```text
case-command-user
case-query-user
search-projector-user
retention-worker-user
outbox-publisher-user
migration-runner-user
backup-agent-user
```

Runtime service not admin.

---

## 33. Observability Design

Operation metrics:

```text
case.command.transition.duration
case.query.detail.duration
case.query.worklist.duration
case.search.duration
case.audit.find.duration
outbox.pending.age
search.projection.lag
dashboard.freshness
retention.overdue.count
migration.progress
```

Mongo metrics:

```text
command duration
pool checkout
server selection timeout
docs examined
slow query logs/profiler
replication lag
connection count
disk/CPU/cache
```

Business alerts:

```text
audit insert failure
outbox lag > 30s
search projection lag > 60s
retention overdue
tenant error spike
support access anomaly
```

---

## 34. Testing Strategy

Tests:

```text
unit:
  state machine
  authorization
  retention policy
  search projection builder

integration:
  repositories with Testcontainers MongoDB
  transactions
  unique indexes
  aggregation
  tenant isolation

contract:
  outbox event schema
  old document fixtures
  API response

migration:
  idempotent backfill
  mixed schema

failure:
  duplicate command retry
  optimistic conflict
  transient error

staging:
  failover
  restore drill
  search index behavior
```

Mandatory fixture:

```text
tenant-a and tenant-b both have CASE-001
```

---

## 35. Backup / DR Design

Backup source-of-truth data:

```text
MongoDB source collections
object storage evidence
tenant registry
KMS keys
search definitions
configuration
```

Derived data rebuild:

```text
worklist
search projection
dashboard
cache
```

RPO/RTO:

```text
cases/audit: RPO 5 min, RTO 2h
search: rebuild RTO 8h
dashboard: rebuild RTO 2h
exports: can regenerate unless artifact required
```

Restore safe mode:

```text
OUTBOX_WORKER_ENABLED=false
RETENTION_WORKER_ENABLED=false
MIGRATION_RUNNER_ENABLED=false
SEARCH_PROJECTOR_ENABLED=false
```

Then reconcile.

---

## 36. Retention Design

Retention workflow:

```text
case closed
  -> compute retainUntil/deleteAfter
  -> create/update retention_record

legal hold applied
  -> update case retention.legalHold
  -> update retention_record
  -> insert legal_hold_record
  -> audit event

retention worker
  -> dry run
  -> approval if needed
  -> archive/delete/anonymize in batches
  -> deletion manifest
  -> audit
  -> remove search/projection
```

No blind TTL for cases/audit.

TTL allowed for:

- idempotency after window,
- temporary export artifact metadata after expiry maybe,
- transient import staging.

---

## 37. Event-Driven Integration

Events:

```text
CaseCreated
CaseAssigned
CaseEscalated
CaseClosed
LegalHoldApplied
EvidenceUploaded
ExportReady
RetentionDispositionCompleted
```

Outbox publishes.

Consumers:

```text
notification-service
search-projector
dashboard-projector
reporting-ingestor
external-registry-sync
```

Consumers use inbox/idempotency.

Event payload minimal, no full sensitive document.

---

## 38. Failure Scenarios

### Case transition DB timeout

Use idempotency commandId to retry/reconcile.

### Search stale

Detail endpoint source recheck prevents wrong command.

### Outbox publisher down

Outbox lag alert; events remain pending.

### Notification duplicate

Notification service inbox deduplicates by eventId.

### Bad migration

Pause migration, use expand-contract rollback, repair with backup if needed.

### Legal hold missed

Treat as compliance incident; audit/repair.

### Tenant noisy import

Tenant-level rate limit and bulkhead.

---

## 39. Decision Trade-Offs

### Why not store all notes/audit/documents embedded?

Unbounded growth.

### Why projection for worklist?

Different query shape than case command model.

### Why outbox?

Reliable integration without distributed transactions.

### Why not search source document directly?

Security/projection/relevance/schema reasons.

### Why hybrid tenancy?

Small tenants need cost efficiency; large tenants need isolation.

### Why not use MongoDB as queue?

Outbox moderate use okay; high-scale messaging belongs to broker.

---

## 40. Architecture Review Checklist

```text
[ ] tenant boundary mandatory?
[ ] aggregate boundary bounded?
[ ] unbounded data separated?
[ ] command state transitions guarded?
[ ] audit atomic with command?
[ ] outbox atomic with command?
[ ] projections rebuildable?
[ ] search authorization-aware?
[ ] retention legal-hold aware?
[ ] indexes mapped to hot queries?
[ ] sharding candidate reviewed?
[ ] backup/restore tested?
[ ] workers safe after restore?
[ ] observability per operation?
[ ] migration expand-contract?
[ ] support access audited?
```

---

## 41. Risks and Mitigations

### Risk: Worklist projection drift

Mitigation:

```text
sourceVersion
projection lag metric
reconciliation job
rebuild tool
```

### Risk: Search permission stale

Mitigation:

```text
detail source recheck
permission update high priority
projection lag alert
sensitive result snippets disabled
```

### Risk: Tenant skew

Mitigation:

```text
tenant metrics
dedicated placement
shard key review
tenant quotas
```

### Risk: Retention wrong delete

Mitigation:

```text
dry run
approval
legal hold check
deletion manifest
backup
```

### Risk: Migration breaks old data

Mitigation:

```text
schema fixtures
reader fallback
expand-contract
canary tenant
```

---

## 42. Capstone Deliverable Summary

The proposed platform uses MongoDB as:

```text
aggregate store:
  cases

append-only evidence:
  case_audit_events

metadata store:
  documents, parties, notes

projection store:
  worklist, dashboard, search docs

workflow/control store:
  outbox, idempotency, retention, export, support access
```

MongoDB is complemented by:

```text
object storage:
  evidence files

search/vector:
  full-text/semantic retrieval

Redis:
  cache/rate limiting

Kafka/RabbitMQ:
  integration and work distribution

warehouse:
  analytics/reporting

KMS/secret manager:
  keys/secrets

observability:
  metrics/logs/traces/profiler
```

---

## 43. Practical Exercise

Extend the design for these new requirements:

```text
1. A premium tenant requires dedicated cluster.
2. A regulator wants EU-only backup and search.
3. A new workflow requires external registry check before decision.
4. Semantic search must exclude confidential evidence unless user has clearance.
5. Tenant wants restore of one deleted case.
6. Retention policy changes from 7 to 10 years for one tenant.
7. Dashboard must include SLA trend for 2 years.
```

For each requirement, answer:

1. which collection/service changes,
2. data migration needed,
3. index/search changes,
4. event/outbox changes,
5. security/retention impact,
6. observability impact,
7. DR impact.

---

## 44. Senior-Level Heuristics

```text
If it is source of truth, protect it with transactions/audit/backup.

If it is derived, make it rebuildable and observable.

If it is tenant-owned, require tenantId everywhere.

If it is searchable, enforce authorization inside search.

If it triggers external side effect, use outbox.

If it consumes events, use inbox/idempotency.

If it is unbounded, separate it from core document.

If it can be deleted by policy, model retention/legal hold explicitly.

If it is sensitive, classify before indexing/logging/exporting.

If it must survive disaster, restore it in drills.
```

---

## 45. Summary

This capstone shows how MongoDB design becomes system design.

Key lessons:

1. Start with domain invariants, not collection names.
2. Keep aggregate core bounded.
3. Put unbounded history/notes/documents in separate collections.
4. Use guarded atomic updates for state transitions.
5. Write audit and outbox atomically with critical state change.
6. Use projection collections for worklist/search/dashboard.
7. Treat search as authorization-aware derived access model.
8. Use object storage for evidence bytes and MongoDB for metadata.
9. Use hybrid tenancy for cost/isolation trade-off.
10. Use outbox/inbox for reliable event integration.
11. Use retention records and legal hold records for compliance.
12. Use operation-level observability and tenant-level metrics.
13. Make restore safe by disabling/reconciling workers.
14. Make migrations expand-contract.
15. Keep source-vs-derived classification explicit.

The most important sentence:

> A production MongoDB platform is not a set of collections; it is a set of domain invariants, ownership boundaries, access paths, derived models, and operational promises encoded into data design.

---

## 46. Bridge to Part 034

Part 034 will continue the capstone from architecture to implementation blueprint:

- Java package structure,
- Spring Boot modules,
- Mongo configuration,
- repository code patterns,
- transaction template,
- idempotency service,
- outbox publisher,
- projection worker,
- migration runner,
- tests,
- observability instrumentation,
- deployment and runbook skeleton.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-034.md
```

Judul berikutnya:

```text
Part 034 — Capstone II: Production-Grade Java Implementation Blueprint
```

---

## 47. Status Seri

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
Part 033 — Capstone I: Designing a Regulatory Case Management Platform on MongoDB
```

Seri belum selesai. Masih lanjut ke Part 034 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Architecture Patterns: MongoDB in Distributed Java Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-034.md">Part 034 — Capstone II: Production-Grade Java Implementation Blueprint ➡️</a>
</div>

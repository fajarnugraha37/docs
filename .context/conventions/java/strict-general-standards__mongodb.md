# Strict General Standards: MongoDB

> Mandatory standards for LLM/code agents when designing, implementing, reviewing, or modifying systems that use MongoDB.

MongoDB is a document database. It must be treated as a document-oriented operational datastore with explicit document boundaries, query-driven schema design, index governance, consistency choices, and operational safety. It must not be treated as a generic JSON dump, relational database clone, cache, queue, search engine, or magic schema-less persistence layer.

---

## 1. Purpose

This standard exists to prevent LLM-generated MongoDB implementations from producing systems that are easy to demo but unsafe in production.

LLMs must use this standard whenever they:

- design MongoDB collections;
- create or modify MongoDB queries;
- define indexes;
- implement repositories/DAOs;
- implement aggregation pipelines;
- implement transactions;
- implement sharding or multi-tenant storage;
- consume change streams;
- create schema validation rules;
- write migration scripts;
- configure MongoDB Atlas/self-managed deployments;
- implement security, backup, monitoring, or operational controls.

---

## 2. Non-Negotiable Rule

**MongoDB is not schema-less in production. It is schema-flexible.**

Every production MongoDB collection must have:

1. explicit ownership;
2. documented document shape;
3. documented access patterns;
4. indexes that match those access patterns;
5. write/update semantics;
6. consistency expectations;
7. retention/deletion rules;
8. migration strategy;
9. security classification;
10. observability and backup strategy.

If the LLM cannot explain these, it must not generate the MongoDB implementation.

---

## 3. MongoDB Is Appropriate When

Use MongoDB when most of the following are true:

- the aggregate naturally fits as a document;
- data is commonly accessed together;
- flexible or evolving structure is valuable;
- application query patterns are known;
- denormalization is acceptable and governed;
- document-level atomicity covers most writes;
- horizontal scaling/sharding may be needed;
- change streams or document-level updates are useful;
- JSON/BSON-style model reduces impedance mismatch.

Good examples:

- product catalog with variable attributes;
- profile document with nested settings;
- case file snapshot/read model;
- form submission payload with versioned schema;
- event-enriched operational read model;
- content management documents;
- tenant-scoped configuration documents;
- workflow/case aggregate where most data is read/written together.

---

## 4. MongoDB Is Not Appropriate When

Do not choose MongoDB by default when:

- relational constraints are the core correctness mechanism;
- frequent ad hoc joins are required;
- cross-aggregate transactions dominate;
- reporting/OLAP scans dominate;
- full-text relevance/search ranking is the primary requirement and Elasticsearch/OpenSearch/Atlas Search is not planned;
- financial ledger invariants require relational/append-only transactional modeling;
- schema is unknown because analysis was skipped;
- developers want to avoid database design discipline;
- the team cannot operate replica sets, backups, indexes, migrations, or query performance.

MongoDB must not be selected merely because “JSON is easy.”

---

## 5. Version Policy

LLMs must state the target MongoDB version when generating version-sensitive features.

Mandatory rules:

- Prefer a currently supported MongoDB major version for new production systems.
- Do not assume a feature exists without checking the target version.
- Do not generate commands from old shell syntax when modern `mongosh` or driver APIs are expected.
- Do not use deprecated APIs unless maintaining a legacy system.
- If Atlas is used, state which capability depends on Atlas rather than MongoDB Community/Enterprise server.
- If using vector search, search indexes, online archive, or cloud-specific backups, mark them as Atlas-specific where applicable.

Example requirement header:

```md
MongoDB target: MongoDB 8.x or organization-approved supported version
Deployment: Atlas / self-managed replica set / sharded cluster
Driver: Java driver / Node driver / Go driver / .NET driver
Read/write concerns: defined per operation class
```

---

## 6. Core Mental Model

MongoDB design starts from **queries and document lifecycle**, not from ERD normalization.

The LLM must answer:

1. What does the application read most often?
2. What does it update most often?
3. Which fields change independently?
4. Which fields grow without bound?
5. Which data must be consistent atomically?
6. Which data can be duplicated?
7. Which data needs historical audit?
8. Which data is tenant/user/security scoped?
9. Which fields drive filters, sorts, uniqueness, and sharding?
10. What is the expected collection size and growth rate?

If these are unknown, produce a provisional model and mark assumptions explicitly.

---

## 7. Collection Ownership

Every collection must have exactly one owning service/module.

Mandatory rules:

- Do not let multiple services write to the same collection.
- Do not let shared libraries hide writes to shared MongoDB collections.
- Do not expose raw collection access across bounded contexts.
- Do not allow unrelated aggregates to share one generic collection.
- Collection name must reflect domain ownership, not technical convenience.
- Cross-service access must happen through APIs/events/read models, not direct DB access.

Required collection ownership record:

```md
Collection: enforcement_cases
Owner service: case-service
Owned aggregate: EnforcementCase
Primary access patterns:

- get case by caseId
- list cases by tenant/status/updatedAt
- update case state with optimistic version
  External writers: none
  External readers: reporting projection only
  Retention: 7 years after closure
  Security class: restricted case data
```

---

## 8. Document Modeling Rules

### 8.1 Model Documents Around Aggregates

Documents should usually represent an aggregate boundary.

A document may contain nested data when:

- the nested data is read with the parent;
- the nested data lifecycle is owned by the parent;
- the nested array is bounded or explicitly capped;
- updates do not cause high write contention;
- duplication is acceptable.

A document should reference another document when:

- the child has independent lifecycle;
- the child grows without bound;
- the child is shared by many parents;
- the child is updated frequently and independently;
- embedding would cause document bloat;
- authorization differs between parent and child.

### 8.2 Do Not Normalize Blindly

Do not automatically translate relational tables to MongoDB collections.

Bad:

```text
users
user_addresses
user_preferences
user_notifications
user_roles
```

Potentially better:

```text
users
  profile
  preferences
  bounded addresses[]
user_role_assignments      // separate if security lifecycle/audit requires it
notifications              // separate if unbounded/high volume
```

### 8.3 Do Not Embed Unbounded Arrays

Arrays that can grow without a strict business limit must not be embedded.

Examples of unsafe unbounded arrays:

- audit logs;
- comments;
- workflow history;
- messages;
- notifications;
- activity events;
- attachments;
- access logs;
- time-series readings.

Use separate collection, bucket pattern, event store, or specialized time-series collection.

### 8.4 Avoid Large Documents

Mandatory rules:

- Do not design documents that approach MongoDB BSON document size limits.
- Do not store large binaries in normal documents.
- Use object storage/GridFS only when justified.
- Store metadata and external object references when possible.
- Bound nested structures explicitly.

---

## 9. Schema Validation

MongoDB schema flexibility must be controlled.

Mandatory rules:

- Every production collection must define an application schema.
- Critical collections should also define MongoDB JSON Schema validation.
- Validation must cover required fields, types, enum-like fields, and structural invariants.
- Validation must not replace application-level business validation.
- Validation rules must be migrated version-by-version.
- Validation bypass must not be used in normal application code.

Example:

```javascript
db.createCollection("cases", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "caseId",
        "tenantId",
        "status",
        "version",
        "createdAt",
        "updatedAt",
      ],
      properties: {
        caseId: { bsonType: "string" },
        tenantId: { bsonType: "string" },
        status: { enum: ["DRAFT", "OPEN", "UNDER_REVIEW", "CLOSED"] },
        version: { bsonType: "long" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  },
});
```

---

## 10. Identifier Rules

Mandatory rules:

- Use stable domain identifiers when the domain already has one.
- Do not expose internal `_id` as the only external API identifier unless intentionally accepted.
- Keep `_id` indexed and immutable.
- For externally visible resources, prefer explicit fields such as `caseId`, `userId`, `tenantId`.
- Do not mix ObjectId/string/UUID formats for the same logical identifier.
- If using UUID, standardize representation across driver, schema, and API.

Recommended pattern:

```json
{
  "_id": ObjectId("..."),
  "caseId": "CASE-2026-00001",
  "tenantId": "tenant-a",
  "version": 12
}
```

---

## 11. Time and Audit Fields

Every mutable business collection must include:

```json
{
  "createdAt": "date",
  "createdBy": "actor id",
  "updatedAt": "date",
  "updatedBy": "actor id",
  "version": "number/long"
}
```

Mandatory rules:

- Use UTC timestamps.
- Do not store local time without timezone semantics.
- Do not let clients provide trusted audit timestamps.
- Use server/application-controlled audit fields.
- If regulatory audit is required, do not rely only on overwritten document state; store immutable audit events separately.

---

## 12. Optimistic Concurrency

Mutable aggregate documents must use optimistic concurrency when concurrent updates are possible.

Mandatory update pattern:

```javascript
const result = await collection.updateOne(
  { caseId, tenantId, version: expectedVersion },
  {
    $set: {
      status: "UNDER_REVIEW",
      updatedAt: now,
      updatedBy: actorId,
    },
    $inc: { version: 1 },
  },
);

if (result.matchedCount === 0) {
  throw new ConflictError("Document was modified by another transaction");
}
```

Rules:

- Do not implement read-modify-write without version check.
- Do not overwrite whole documents unless replacement semantics are intentional.
- Do not silently ignore `matchedCount === 0`.
- Return conflict/409 behavior at API boundary when version mismatch occurs.

---

## 13. Atomicity and Transactions

MongoDB atomicity is strongest within a single document. Multi-document transactions are supported but must be used deliberately.

Mandatory rules:

- Prefer document model that keeps aggregate invariants within one document.
- Use multi-document transactions only when cross-document atomicity is truly required.
- Keep transactions short.
- Do not include remote HTTP calls, message publishing, file I/O, or user interaction inside transactions.
- Do not use transactions to hide bad document boundaries.
- Configure appropriate read concern/write concern when correctness depends on durability/visibility.
- Retry transient transaction errors according to driver guidance.
- Test transaction behavior under failover and write conflicts.

Allowed transaction examples:

- update aggregate document and local outbox document atomically;
- move state between two tightly coupled documents where redesign is not viable;
- update reference data and index/projection document in the same service boundary.

Disallowed transaction examples:

- long workflow spanning multiple services;
- compensatable business processes better modeled as saga/workflow;
- bulk data migration touching thousands of unrelated documents in one transaction;
- cross-service consistency via shared database.

---

## 14. Read Concern and Write Concern

LLMs must not rely on default durability semantics without stating them.

Mandatory rules:

- Use acknowledged writes for application mutations.
- Use majority write concern for correctness-critical writes unless the platform has an approved alternative.
- Use appropriate read concern for reads that must observe durable/majority-committed data.
- Do not use unacknowledged writes for business state.
- Do not mix weak write concern with optimistic locking/audit-sensitive updates.
- Document consistency requirements per repository method.

Example classification:

```md
Operation: submit case
Write concern: majority
Read concern: majority/snapshot where required
Failure behavior: retry transient errors; return conflict on version mismatch
```

---

## 15. Index Design

Indexes must be designed from access patterns. Do not create indexes randomly.

Mandatory rules:

- Every query path must have an index review.
- Every index must have a known query/use-case owner.
- Compound indexes must follow filter + sort + equality/range reasoning.
- Unique business identifiers must have unique indexes.
- Tenant-scoped uniqueness must include `tenantId`.
- Do not create redundant indexes.
- Do not index every field.
- Do not create high-cardinality, write-heavy indexes without cost review.
- Do not let application queries rely on collection scans.
- Validate with `explain()` for important queries.

Example:

```javascript
db.cases.createIndex(
  { tenantId: 1, status: 1, updatedAt: -1, caseId: 1 },
  { name: "idx_cases_tenant_status_updated_case" },
);
```

---

## 16. Unique Indexes

Mandatory rules:

- Use unique indexes for business uniqueness, not only application checks.
- For multi-tenant systems, include tenant scope.
- Handle duplicate key errors explicitly and map them to domain/API errors.
- Do not assume uniqueness across shards unless the unique index is compatible with shard key restrictions.

Example:

```javascript
db.cases.createIndex(
  { tenantId: 1, caseNumber: 1 },
  { unique: true, name: "uq_cases_tenant_case_number" },
);
```

---

## 17. Partial and Sparse Indexes

Partial indexes are allowed when the query predicate is stable and explicit.

Example:

```javascript
db.cases.createIndex(
  { tenantId: 1, assignedOfficerId: 1, updatedAt: -1 },
  {
    partialFilterExpression: { status: { $in: ["OPEN", "UNDER_REVIEW"] } },
    name: "idx_cases_active_by_officer",
  },
);
```

Rules:

- Do not use sparse indexes when missing/null semantics are unclear.
- Document query predicates that depend on partial indexes.
- Test that the query planner actually uses the intended index.

---

## 18. TTL Indexes

TTL indexes may be used for automatic expiration of disposable data.

Allowed:

- sessions;
- temporary tokens;
- short-lived idempotency records;
- cache-like documents;
- ephemeral workflow locks.

Not allowed without strong justification:

- legal records;
- financial records;
- audit trails;
- regulatory case history;
- user data requiring explicit retention workflow.

Mandatory rules:

- TTL deletion is not instant; do not use it for precise scheduling.
- TTL must be documented in data retention policy.
- TTL fields must be date typed.
- TTL must not conflict with backup/legal hold requirements.

---

## 19. Query Design

Mandatory rules:

- Query by indexed predicates.
- Always include tenant/security scope where applicable.
- Avoid unbounded collection scans.
- Avoid regex prefix/suffix search unless indexed and explicitly reviewed.
- Avoid `$where` and server-side JavaScript.
- Avoid unbounded `$in` lists.
- Avoid returning entire documents when only a projection is needed.
- Use projection for large documents.
- Do not expose raw client-provided query objects to MongoDB.
- Validate and whitelist filters/sorts from API clients.

Bad:

```javascript
db.cases.find(req.query);
```

Good:

```javascript
db.cases
  .find(
    {
      tenantId: actor.tenantId,
      status: { $in: allowedStatuses },
      updatedAt: { $gte: from, $lt: to },
    },
    {
      projection: { caseId: 1, status: 1, updatedAt: 1, assignedOfficerId: 1 },
    },
  )
  .sort({ updatedAt: -1, caseId: 1 })
  .limit(limit);
```

---

## 20. Pagination

Mandatory rules:

- Do not use unbounded `skip` for deep pagination.
- Prefer keyset/range pagination for large collections.
- Sort order must be deterministic.
- Include stable tie-breaker field in sort.
- Pagination filters must match indexes.
- API cursors must be opaque and tamper-resistant where needed.

Example:

```javascript
db.cases
  .find({
    tenantId,
    status,
    $or: [
      { updatedAt: { $lt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, caseId: { $gt: cursor.caseId } },
    ],
  })
  .sort({ updatedAt: -1, caseId: 1 })
  .limit(50);
```

---

## 21. Aggregation Pipeline Rules

Aggregation pipelines must be treated as production code.

Mandatory rules:

- Put `$match` early when possible.
- Ensure `$match` can use indexes.
- Avoid unbounded `$lookup`.
- Avoid `$group` over massive unfiltered datasets.
- Avoid pipeline stages that force large memory use unless reviewed.
- Use `allowDiskUse` deliberately, not as a blanket fix.
- Project only required fields.
- Test pipelines with production-like data volume.
- Document pipeline input cardinality and expected output cardinality.

Example pipeline header:

```md
Pipeline: case workload summary
Input cardinality: cases per tenant per 30 days
Index dependency: { tenantId: 1, createdAt: -1, status: 1 }
Memory risk: bounded by date range
```

---

## 22. `$lookup` and Join Guardrails

`$lookup` is allowed but must not recreate relational join-heavy modeling accidentally.

Mandatory rules:

- Use `$lookup` only for bounded and indexed relationships.
- Do not use `$lookup` for hot request paths without performance validation.
- Do not join large unbounded collections interactively.
- Consider denormalized read model when repeated joins are required.
- Document why embedded or duplicated data was not used.

---

## 23. Updates and Mutations

Mandatory rules:

- Use atomic update operators (`$set`, `$inc`, `$push`, `$pull`, etc.) instead of read-modify-write where possible.
- Use filtered positional updates deliberately.
- Do not replace whole documents accidentally.
- Do not update many documents without filter review.
- Bulk updates must be idempotent and checkpointable.
- Always inspect matched/modified counts.

Bad:

```javascript
await db.cases.updateOne({ caseId }, req.body);
```

Good:

```javascript
await db.cases.updateOne(
  { tenantId, caseId, version },
  {
    $set: {
      title: command.title,
      updatedAt: now,
      updatedBy: actorId,
    },
    $inc: { version: 1 },
  },
);
```

---

## 24. Bulk Writes

Bulk writes must be explicit about ordering, idempotency, and error handling.

Mandatory rules:

- Use `bulkWrite` for controlled batches, not one request per document.
- Choose ordered/unordered intentionally.
- Use deterministic `_id` or unique keys for idempotent upserts.
- Log partial failure details safely.
- Do not perform huge unbounded bulk operations in online request paths.
- Use batch checkpoints for migrations/backfills.

---

## 25. Multi-Tenancy

Mandatory rules:

- Every tenant-scoped collection must include `tenantId` or equivalent partition/security scope.
- Every tenant-scoped query must include tenant filter at repository level.
- Unique indexes must include tenant scope unless global uniqueness is required.
- Avoid exposing tenant filters to client control.
- Consider collection/database separation only when operational/security requirements justify it.
- Test tenant isolation explicitly.

Bad:

```javascript
db.cases.find({ caseId });
```

Good:

```javascript
db.cases.findOne({ tenantId: actor.tenantId, caseId });
```

---

## 26. Authorization Boundary

MongoDB filters are not a replacement for authorization design, but they are part of enforcement.

Mandatory rules:

- Authorization must happen before mutation.
- Repository queries must include object/tenant scope.
- Do not trust client-provided IDs without verifying access.
- Do not return documents and filter sensitive fields only in frontend.
- Use projection/redaction for sensitive fields where needed.
- If field-level access differs by role, define explicit DTO/projection per role.

---

## 27. Sharding

Sharding must be justified by data volume, write throughput, geographic/data residency needs, or operational scale.

Do not shard because it sounds scalable.

Before sharding, define:

- workload growth;
- top queries;
- write distribution;
- tenant distribution;
- candidate shard key;
- cardinality;
- monotonicity risk;
- jumbo chunk risk;
- zone/data residency requirements;
- unique index impact;
- operational ownership.

Shard key rules:

- Must align with high-volume query patterns.
- Must distribute writes evenly.
- Must avoid single hot shard.
- Must avoid low-cardinality values alone.
- Must avoid purely monotonically increasing values unless hashed/combined appropriately.
- Must consider unique index constraints.
- Must be hard to change; choose carefully.

Bad shard keys:

```text
status
createdAt
countryCode
booleanFlag
```

Potentially better depending on workload:

```text
{ tenantId: 1, caseId: 1 }
{ tenantId: 1, createdAt: 1 }
{ hashedUserId: "hashed" }
```

---

## 28. Replica Sets and High Availability

Production MongoDB must run as a replica set or managed equivalent.

Mandatory rules:

- Do not run standalone MongoDB for production business data.
- Use replica sets for availability and change streams.
- Understand primary election behavior.
- Configure application retry behavior for failover.
- Use majority write concern where durability matters.
- Ensure backup and restore procedures are tested.
- Do not read from secondaries unless stale-read semantics are acceptable.

---

## 29. Change Streams

Change streams are for reacting to database changes, not for replacing domain event design blindly.

Allowed uses:

- internal projections;
- cache invalidation;
- search index synchronization;
- lightweight integration triggers;
- audit projections where acceptable;
- operational notifications.

Mandatory rules:

- Store resume tokens/checkpoints.
- Consumers must be idempotent.
- Do not assume exactly-once side effects.
- Filter change events as close to source as practical.
- Handle invalidate/drop/rename events.
- Define replay/rebuild procedure.
- Do not expose raw change stream payload as public domain event without contract mapping.

---

## 30. Outbox Pattern With MongoDB

When MongoDB state changes must emit reliable integration events, use an outbox pattern.

Mandatory rules:

- Write aggregate change and outbox record atomically.
- Use transaction if outbox is stored in separate collection and atomicity is required.
- Use deterministic event ID.
- Consumers must be idempotent.
- Publisher must support retry and checkpointing.
- Do not publish to Kafka/RabbitMQ directly after DB write without failure analysis.

Example outbox document:

```json
{
  "_id": "evt_01J...",
  "aggregateType": "Case",
  "aggregateId": "CASE-2026-00001",
  "eventType": "CaseSubmitted",
  "eventVersion": 1,
  "occurredAt": "2026-06-10T10:00:00Z",
  "payload": {},
  "publishedAt": null
}
```

---

## 31. Time-Series Collections

Use MongoDB time-series collections only when the workload fits time-series storage.

Mandatory rules:

- Define time field explicitly.
- Define metadata field intentionally.
- Keep measurements append-heavy.
- Do not use time-series collections for arbitrary mutable documents.
- Define retention policy.
- Define query time ranges.
- Avoid high-cardinality metadata misuse without review.

---

## 32. Search and Vector Search Boundary

MongoDB query indexes are not full search infrastructure by default.

Mandatory rules:

- Use normal indexes for exact/range/filter workloads.
- Use Atlas Search or external search engine for relevance-based full-text search when needed.
- Do not build search by regex over unbounded text.
- Do not store embeddings/vector fields without model/version/dimension metadata.
- Do not mix search ranking correctness with transactional correctness.
- Define synchronization/rebuild path for search indexes.

---

## 33. Data Validation in Application Layer

Application validation must remain authoritative for business rules.

Mandatory rules:

- Validate commands before writing.
- Validate enum/state transitions explicitly.
- Validate nested document size and array bounds.
- Validate ownership/tenant scope.
- Validate idempotency keys for commands.
- Validate unknown fields policy: reject, ignore, or preserve explicitly.

---

## 34. State Machine Persistence

For workflow/case systems, state transitions must be guarded.

Mandatory rules:

- Store current state explicitly.
- Store version/revision.
- Check allowed transition before update.
- Use optimistic concurrency in transition updates.
- Store immutable transition history separately if audit is required.
- Do not infer current state from mutable UI fields.

Example:

```javascript
await db.cases.updateOne(
  {
    tenantId,
    caseId,
    status: "OPEN",
    version: expectedVersion,
  },
  {
    $set: {
      status: "UNDER_REVIEW",
      updatedAt: now,
      updatedBy: actorId,
    },
    $inc: { version: 1 },
  },
);
```

---

## 35. Soft Delete and Retention

Soft delete must be a business decision, not a default habit.

Mandatory rules:

- If using soft delete, include `deletedAt`, `deletedBy`, and deletion reason when required.
- All normal queries must exclude deleted documents by default.
- Indexes must account for active vs deleted documents.
- Define purge/retention process.
- Do not use soft delete as a substitute for audit history.
- Do not accidentally make unique indexes block recreation due to deleted records unless intended.

Example partial unique index:

```javascript
db.users.createIndex(
  { tenantId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: "uq_active_user_email_per_tenant",
  },
);
```

---

## 36. Migration Standards

MongoDB migrations must be explicit, repeatable, and safe.

Mandatory rules:

- Every schema change must have a migration plan.
- Support rolling deployment compatibility when needed.
- Avoid one-shot unbounded updates in production.
- Use batched, checkpointed migrations for large collections.
- Create indexes in a production-safe way.
- Backfill new fields before making them required.
- Keep old readers/writers compatible during rollout.
- Provide rollback or forward-fix strategy.

Migration phases:

1. add optional field/index;
2. deploy dual-read/dual-write if needed;
3. backfill in batches;
4. verify counts and correctness;
5. enforce schema validation;
6. remove old field/path in later release.

---

## 37. Repository/DAO Rules

LLM-generated repository code must not leak raw MongoDB access upward.

Mandatory rules:

- Repository methods must be named by business intent.
- Repository must enforce tenant scope where applicable.
- Repository must own query shapes and projections.
- Do not pass arbitrary user filters directly to MongoDB.
- Do not return raw persistence documents if API/domain model differs.
- Map database errors to domain/application errors.
- Include timeout/cancellation support.

Bad:

```typescript
find(query: any): Promise<any[]>
```

Good:

```typescript
findOpenCasesForOfficer(input: {
  tenantId: string;
  officerId: string;
  cursor?: CaseCursor;
  limit: number;
}): Promise<CaseSummaryPage>
```

---

## 38. Driver and Connection Management

Mandatory rules:

- Use official MongoDB drivers unless a platform-approved wrapper exists.
- Reuse `MongoClient`; do not create a new client per request.
- Configure connection pool intentionally.
- Set operation timeout or context deadline.
- Handle retryable writes/read behavior intentionally.
- Do not log credentials or connection strings.
- Use TLS for network connections.
- Use secret manager for credentials.

---

## 39. Security Standards

Mandatory rules:

- Authentication must be enabled.
- Use least-privilege database users/roles.
- Do not use admin/root users from application code.
- Restrict network exposure.
- Use TLS in transit.
- Use encryption at rest according to platform policy.
- Enable audit logging where required.
- Protect backups with encryption and access controls.
- Do not expose MongoDB directly to the public internet.
- Do not let developers bypass authorization by connecting directly to production DB.

Application account example:

```md
User: case_service_app
Permissions:

- read/write on case_service.cases
- read/write on case_service.case_outbox
- no admin privileges
- no access to unrelated databases
```

---

## 40. Injection and Query Safety

MongoDB injection is real.

Mandatory rules:

- Never pass raw request bodies as MongoDB queries.
- Reject operator injection such as `$ne`, `$gt`, `$where`, `$regex` unless explicitly whitelisted.
- Validate object IDs and scalar types.
- Whitelist sortable fields.
- Whitelist filterable fields.
- Disable or forbid server-side JavaScript features unless explicitly required.

Bad:

```javascript
await users.findOne({ email: req.body.email, password: req.body.password });
```

If `req.body.password` can be `{ "$ne": null }`, this may become an injection vulnerability.

Good:

```javascript
const email = parseEmail(req.body.email);
const password = parseString(req.body.password);
await users.findOne({ email });
```

---

## 41. Backup and Restore

Mandatory rules:

- Every production MongoDB deployment must have backup strategy.
- Restore must be tested, not only backup creation.
- Define RPO/RTO.
- Include point-in-time restore if required.
- Encrypt backups.
- Restrict backup access.
- Test restore into isolated environment.
- Include index recreation and application compatibility checks.

Backup plan template:

```md
Database/cluster:
RPO:
RTO:
Backup method:
Retention:
Encryption:
Restore test frequency:
Owner:
Last restore test:
```

---

## 42. Observability

Mandatory metrics/logs/traces:

- query latency by operation;
- slow queries;
- command failure rate;
- connection pool usage;
- replica lag;
- primary elections;
- lock/write conflict indicators;
- index usage;
- collection scans;
- disk usage;
- memory/cache pressure;
- oplog window;
- change stream lag;
- transaction aborts/retries;
- backup status;
- shard/chunk imbalance where applicable.

Mandatory rules:

- Log repository operation names, not raw sensitive documents.
- Include trace/correlation ID.
- Do not log PII/secrets/token fields.
- Monitor slow query logs/profiler output.
- Add dashboards before production release.
- Alert on symptoms, not noise.

---

## 43. Performance Review Checklist

Before approving MongoDB code, verify:

- [ ] query uses expected index;
- [ ] query includes tenant/security scope;
- [ ] sort is covered or acceptable;
- [ ] projection is used for large documents;
- [ ] result size is bounded;
- [ ] pagination is safe;
- [ ] write path checks matched/modified count;
- [ ] update path uses optimistic version where needed;
- [ ] aggregation pipeline has bounded input;
- [ ] no unbounded arrays are embedded;
- [ ] indexes are not redundant;
- [ ] no collection scan on hot path;
- [ ] migration path exists for schema/index changes.

---

## 44. Common Anti-Patterns

### 44.1 Schema-Less Dump

Storing arbitrary JSON without ownership, validation, or access patterns.

### 44.2 Relational MongoDB

Creating collections that mirror every relational table and then rebuilding joins in application code.

### 44.3 God Collection

Putting unrelated document types in one collection with `type` field and no strong boundary.

### 44.4 Unbounded Embedded Array

Embedding comments/events/logs/messages in a parent document forever.

### 44.5 Index Everything

Creating indexes on every field and destroying write performance/storage efficiency.

### 44.6 No Index Until Slow

Shipping queries without index review and waiting for production latency.

### 44.7 Raw Query API

Letting API clients send arbitrary MongoDB filters/sorts/operators.

### 44.8 Transaction as Design Patch

Using multi-document transactions to compensate for bad document boundaries.

### 44.9 Shared Database Between Services

Multiple microservices writing to the same MongoDB collections.

### 44.10 Tenant Filter in Controller Only

Applying tenant isolation outside repository and risking bypass.

### 44.11 Skip-Based Deep Pagination

Using `skip(1000000)` on large collections.

### 44.12 Search by Regex Everywhere

Using case-insensitive regex scans as search implementation.

### 44.13 Blind Upsert

Using upsert without uniqueness and idempotency design.

### 44.14 Change Stream as Public Event Contract

Publishing raw MongoDB change payloads as integration events.

### 44.15 Production Standalone MongoDB

Running standalone MongoDB for production business state.

---

## 45. Required Design Template

Every MongoDB-backed feature must include:

```md
## MongoDB Design

Collection(s):
Owner service/module:
Deployment type: replica set / sharded cluster / Atlas
MongoDB target version:

### Document Model

Document purpose:
Aggregate boundary:
Embedded fields:
Referenced documents:
Unbounded data handling:
Schema validation:

### Access Patterns

1.
2.
3.

### Indexes

- index:
  reason:
  query:
  uniqueness:

### Consistency

Atomicity boundary:
Optimistic locking:
Transaction use:
Read concern:
Write concern:

### Security

Tenant scope:
PII/sensitive fields:
Application role:
Field projection/redaction:

### Operations

Retention:
Backup/restore:
Migration:
Monitoring:
Failure behavior:
```

---

## 46. LLM Implementation Rules

When generating MongoDB code, the LLM must:

1. define collection ownership;
2. define document shape;
3. define access patterns before indexes;
4. generate indexes for query paths;
5. include tenant/security filters;
6. use projection for list/read-summary APIs;
7. include optimistic concurrency for mutable aggregates;
8. handle duplicate key and write conflict errors;
9. avoid raw query injection;
10. set operation timeout/cancellation;
11. avoid unbounded arrays and unbounded queries;
12. include migration/index creation notes;
13. include tests for query and repository behavior;
14. include observability hooks;
15. state assumptions and target MongoDB version.

---

## 47. Review Checklist

A MongoDB implementation is not acceptable unless:

- [ ] MongoDB is justified against relational/cache/search/OLAP alternatives;
- [ ] document boundaries match access patterns;
- [ ] unbounded arrays are avoided;
- [ ] schema validation or application schema is defined;
- [ ] indexes support all hot queries;
- [ ] unique constraints are enforced by indexes;
- [ ] tenant/security scope is enforced at repository/query level;
- [ ] write paths inspect results and handle conflicts;
- [ ] multi-document transactions are justified;
- [ ] read/write concerns are defined where correctness matters;
- [ ] migrations are safe and backward compatible;
- [ ] backups and restore tests are planned;
- [ ] monitoring covers slow queries, index usage, pool usage, and replication health;
- [ ] secrets are not embedded in code/config;
- [ ] raw MongoDB query injection is impossible from public APIs.

---

## 48. Acceptance Criteria

A feature using MongoDB is accepted only when:

1. document model is reviewed against real access patterns;
2. every hot query has `explain()` evidence or equivalent validation;
3. every business uniqueness invariant has a unique index;
4. every mutable aggregate has concurrency control;
5. every tenant-scoped query includes tenant scope;
6. large/unbounded child data is modeled separately;
7. schema evolution/migration plan exists;
8. backup/restore and observability are accounted for;
9. security controls are documented;
10. failure behavior under duplicate key, timeout, failover, and conflict is tested.

---

## 49. Enforcement Snippet for LLM Agents

Add this to agent instructions when MongoDB code is generated:

```md
Before writing MongoDB code, identify the collection owner, document aggregate boundary, access patterns, indexes, consistency requirements, tenant/security scope, and migration path. Do not generate schema-less arbitrary JSON storage. Do not pass raw client query objects to MongoDB. Do not embed unbounded arrays. Do not use multi-document transactions to hide bad document design. Every hot query must have an index plan, every mutable aggregate must have concurrency control, and every tenant-scoped query must include tenant scope at repository level.
```

---

## 50. Source Baseline

This standard is aligned with:

- MongoDB Manual — document database, CRUD, indexes, replication, sharding, transactions, and operational behavior;
- MongoDB Data Modeling documentation — model around application access patterns and store together what is accessed together;
- MongoDB Schema Validation documentation — flexible schema with validation rules after application schema is established;
- MongoDB Transactions documentation — distributed transactions for multi-document atomicity when required;
- MongoDB Change Streams documentation — real-time change subscriptions over collections/databases/deployments;
- MongoDB Sharding documentation — data distribution across machines for large datasets/high throughput;
- MongoDB Security Checklist — authentication, authorization, network exposure, encryption, auditing, and hardening guidance.

# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-022.md

# Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 022 dari 035  
> Fokus: multi-tenancy, tenant isolation, shared collections, database-per-tenant, shard key dengan tenant, noisy neighbor, authorization guardrails, data residency, per-tenant retention, encryption, backup/restore, dan regulatory defensibility  
> Target pembaca: Java software engineer / tech lead yang mendesain platform case management, SaaS, atau sistem regulasi dengan data boundary yang harus eksplisit dan defensible

---

## 0. Posisi Part Ini Dalam Seri

Part 021 membahas sharding sebagai data placement dan scale boundary. Sekarang kita masuk ke isu yang sangat sering muncul di sistem nyata:

```text
multi-tenancy
```

Multi-tenancy bukan hanya “tambahkan field tenantId”.

Untuk sistem regulasi, enforcement, compliance, financial services, healthcare, government, enterprise SaaS, atau case management, tenant boundary menyentuh:

- data isolation,
- access control,
- index design,
- sharding,
- backup/restore,
- retention,
- encryption,
- auditability,
- data residency,
- operational blast radius,
- noisy neighbor,
- support access,
- legal hold,
- defensible deletion.

Kalimat inti:

> Dalam sistem multi-tenant, `tenantId` bukan hanya filter. Ia adalah security boundary, routing boundary, operational boundary, compliance boundary, dan failure containment boundary.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Menjelaskan model-model multi-tenancy di MongoDB.
2. Membandingkan shared collection, collection-per-tenant, database-per-tenant, cluster-per-tenant, dan hybrid model.
3. Mendesain index dengan `tenantId` secara benar.
4. Memahami tenant skew dan noisy neighbor.
5. Menentukan kapan tenant harus dipisah secara fisik/logis.
6. Mendesain query guardrail agar tenant filter tidak pernah lupa.
7. Memahami hubungan tenant boundary dengan shard key.
8. Mendesain retention dan legal hold per tenant.
9. Memahami backup/restore per tenant sebagai problem domain, bukan hanya infrastructure.
10. Mendesain authorization dan row/document-level security di application layer.
11. Memahami data residency dan jurisdictional partitioning.
12. Membuat checklist regulatory defensibility untuk MongoDB-backed multi-tenant system.

---

## 2. Multi-Tenancy: Definisi Praktis

Multi-tenancy berarti satu platform melayani banyak tenant atau organisasi dengan tingkat sharing tertentu.

Tenant bisa berarti:

```text
customer organization
regulatory agency
jurisdiction
business unit
region
client
department
environment
```

Contoh:

```text
Tenant A: Financial regulator Indonesia
Tenant B: Financial regulator Singapore
Tenant C: Internal compliance division
Tenant D: Large bank enterprise customer
```

Data tenant A tidak boleh bercampur secara tidak terkendali dengan tenant B.

“Tidak bercampur” bisa berarti:

- tidak bisa diakses,
- tidak muncul di query,
- tidak ikut export,
- tidak ikut restore,
- tidak berada di region yang salah,
- tidak memakai encryption key yang sama,
- tidak terkena batch job tenant lain,
- tidak terhapus oleh retention tenant lain.

---

## 3. Tenant Boundary Dalam MongoDB

Tenant boundary bisa diterapkan di beberapa layer:

```text
application layer:
  every query includes tenantId and authorization constraints

database schema layer:
  tenantId stored in every tenant-owned document

index layer:
  tenantId prefix in indexes

sharding layer:
  tenantId included in shard key / zone rules

encryption layer:
  per-tenant key strategy

operational layer:
  backup/restore, monitoring, throttling by tenant

compliance layer:
  retention, legal hold, audit per tenant
```

Jika hanya satu layer yang menjaga tenant isolation, risiko bug tinggi.

Gunakan defense in depth.

---

## 4. Model Multi-Tenancy

Ada beberapa model umum.

```text
1. shared collection
2. collection per tenant
3. database per tenant
4. cluster per tenant
5. hybrid
```

Tidak ada model universal terbaik. Pilihan bergantung pada:

- jumlah tenant,
- ukuran tenant,
- regulatory isolation,
- query pattern,
- data residency,
- operational tooling,
- cost,
- customization,
- backup/restore needs,
- performance isolation,
- security posture.

---

## 5. Shared Collection Model

Semua tenant memakai collection yang sama.

Contoh:

```text
cases
case_audit_events
case_documents
case_worklist_items
```

Setiap document punya `tenantId`.

```javascript
{
  _id: "case-001",
  tenantId: "tenant-a",
  caseNumber: "A-2026-001",
  status: "OPEN"
}
```

### Pros

```text
simple schema management
simple deployment
good for many small tenants
shared indexes
shared code path
easy cross-tenant operations if permitted
cost efficient
```

### Cons

```text
tenant filter bug can leak data
large tenant can affect others
per-tenant restore hard
per-tenant encryption harder
per-tenant retention requires discipline
tenant-specific customization harder
data residency needs sharding/zoning discipline
```

### Cocok Untuk

- banyak tenant kecil/menengah,
- isolation requirement moderate,
- operational simplicity penting,
- team punya strong query guardrail.

---

## 6. Collection Per Tenant

Setiap tenant punya collection sendiri.

```text
cases_tenant_a
cases_tenant_b
case_audit_events_tenant_a
case_audit_events_tenant_b
```

### Pros

```text
logical separation clearer
tenant-specific indexes possible
tenant-specific retention easier
some operations easier by collection
reduced risk of missing tenant filter within collection
```

### Cons

```text
collection explosion
schema migration harder
index management harder
code dynamic collection routing
operational overhead
monitoring complexity
too many namespaces
cross-tenant queries harder
```

### Cocok Untuk

- jumlah tenant terbatas,
- tenant customization tinggi,
- query/index pattern beda antar tenant,
- operational tooling sanggup.

Namun untuk banyak tenant, model ini bisa menjadi berat.

---

## 7. Database Per Tenant

Setiap tenant punya database sendiri.

```text
tenant_a.cases
tenant_a.case_audit_events

tenant_b.cases
tenant_b.case_audit_events
```

### Pros

```text
stronger logical isolation
backup/restore per tenant lebih mudah daripada shared collection
tenant-specific users/roles possible
tenant-specific indexes/config easier
migration can be tenant-scoped
```

### Cons

```text
many databases
connection/routing complexity
migration orchestration
monitoring per database
cross-tenant operations harder
resource sharing still exists if same cluster
more operational overhead
```

### Cocok Untuk

- enterprise SaaS dengan tenant besar,
- per-tenant restore penting,
- tenant customization cukup tinggi,
- jumlah tenant tidak terlalu besar atau tooling matang.

---

## 8. Cluster Per Tenant

Setiap tenant memakai cluster sendiri.

### Pros

```text
strong physical isolation
performance isolation
security boundary stronger
maintenance tenant-specific
data residency easier
backup/restore isolated
no noisy neighbor across tenants
```

### Cons

```text
expensive
operational overhead high
provisioning complexity
fleet management
version upgrades
observability fragmentation
low utilization for small tenants
```

### Cocok Untuk

- tenant sangat besar,
- high compliance,
- strict data residency,
- dedicated enterprise contract,
- tenant needs custom SLA,
- blast radius must be isolated.

---

## 9. Hybrid Model

Hybrid sering paling realistis.

Contoh:

```text
small tenants:
  shared collection/shared cluster

large tenants:
  dedicated database or dedicated shard/cluster

regulated tenants:
  region-specific cluster

premium tenants:
  isolated cluster

archive:
  separate archive database/cluster
```

Hybrid mengakui kenyataan:

```text
not all tenants have same size, risk, cost, or regulatory needs
```

Tetapi hybrid butuh:

- tenant registry,
- routing layer,
- migration path antar tier,
- observability by tenant,
- operational automation,
- clear support tooling.

---

## 10. Tenant Registry

Multi-tenant platform butuh tenant registry.

Collection contoh:

```javascript
{
  _id: "tenant-a",
  tenantCode: "TENANT_A",
  name: "Tenant A",
  status: "ACTIVE",
  tier: "SHARED" | "DEDICATED_DB" | "DEDICATED_CLUSTER",
  region: "APAC",
  jurisdiction: "ID",
  dataResidency: {
    allowedRegions: ["ap-southeast-3"],
    primaryRegion: "ap-southeast-3"
  },
  storagePlacement: {
    mode: "SHARED_COLLECTION",
    database: "app",
    clusterRef: "cluster-apac-1",
    shardZone: "APAC"
  },
  retentionPolicyId: "retention-id-standard-7y",
  encryptionKeyRef: "kms-key-tenant-a",
  createdAt: ISODate(...),
  updatedAt: ISODate(...)
}
```

Tenant registry menjadi sumber kebenaran untuk:

- routing,
- policy,
- region,
- retention,
- encryption,
- feature flags,
- quota,
- support access,
- migration state.

---

## 11. `tenantId` Di Setiap Document

Dalam shared collection, semua tenant-owned document harus menyimpan `tenantId`.

Contoh:

```javascript
{
  _id: "case-1",
  tenantId: "tenant-a",
  ...
}
```

Termasuk:

- cases,
- audit events,
- outbox events,
- worklist items,
- search documents,
- attachment metadata,
- comments,
- notes,
- tasks,
- decision records,
- idempotency records,
- retention records.

Anti-pattern:

```javascript
{
  _id: "case-1",
  ...
}
```

lalu tenant dicari lewat parent join/application memory.

Itu membuat query, index, authorization, sharding, backup, and deletion jauh lebih rapuh.

---

## 12. TenantId Sebagai Prefix Index

Dalam shared multi-tenant collection, index hot query biasanya diawali `tenantId`.

Contoh:

```javascript
db.cases.createIndex({
  tenantId: 1,
  status: 1,
  assigneeId: 1,
  dueAt: 1
})
```

Kenapa?

1. query tenant-scoped,
2. security boundary,
3. selectivity,
4. shard targeting jika shard key memakai tenant,
5. menghindari scan lintas tenant,
6. memudahkan per-tenant performance metrics.

Anti-pattern:

```javascript
db.cases.createIndex({ status: 1, dueAt: 1 })
```

Untuk multi-tenant shared collection, query:

```javascript
{ status: "OPEN" }
```

harus dicurigai karena tidak tenant-scoped.

---

## 13. Mandatory Tenant Filter

Repository API harus memaksa tenant.

Bad:

```java
Optional<CaseDocument> findById(CaseId caseId);
```

Better:

```java
Optional<CaseDocument> findByTenantIdAndCaseId(TenantId tenantId, CaseId caseId);
```

Bad:

```java
List<CaseDocument> findByStatus(String status);
```

Better:

```java
CasePage findByTenantIdAndStatus(
    TenantId tenantId,
    CaseStatus status,
    Cursor cursor,
    int limit
);
```

Tenant filter tidak boleh optional.

Bahkan untuk internal jobs, tenant boundary harus eksplisit:

```java
runRetentionJobForTenant(TenantId tenantId)
```

bukan:

```java
runRetentionJob()
```

kecuali memang global job dengan guardrail kuat.

---

## 14. Tenant Context Propagation

Dalam Java service, tenant context biasanya datang dari:

- authenticated user claims,
- request header verified by gateway,
- route/domain,
- mTLS/client identity,
- service-to-service token,
- batch job configuration.

Tenant context harus immutable selama request.

Contoh:

```java
record RequestContext(
    TenantId tenantId,
    UserId userId,
    Set<Role> roles,
    CorrelationId correlationId
) {}
```

Repository tidak boleh menerima raw string dari controller sembarangan.

Lebih aman:

```java
caseRepository.findWorklist(requestContext.tenantId(), ...)
```

---

## 15. Guardrail Di Query Builder

Buat utility yang selalu inject tenant condition.

Bad:

```java
Query query = new Query();
if (filter.status() != null) {
  query.addCriteria(Criteria.where("status").is(filter.status()));
}
```

Better:

```java
Query query = tenantScopedQuery(ctx.tenantId());
query.addCriteria(Criteria.where("status").is(filter.status()));
```

Atau:

```java
TenantScopedMongoOperations tenantOps = mongoOps.forTenant(ctx.tenantId());
tenantOps.find(queryWithoutTenant, CaseDocument.class);
```

`tenantOps` internally adds tenant criterion.

Tetapi hati-hati: automatic injection harus transparent dan testable. Jangan sampai aggregation pipeline lupa tenant di `$lookup`.

---

## 16. Aggregation Tenant Guardrails

Aggregation lebih mudah bocor karena pipeline kompleks.

Bad:

```javascript
[
  { $match: { status: "OPEN" } },
  { $lookup: { from: "case_parties", localField: "_id", foreignField: "caseId", as: "parties" } }
]
```

Problems:

- no tenant filter,
- lookup foreign collection may join across tenants if `caseId` not globally unique,
- index not tenant-scoped.

Better:

```javascript
[
  { $match: { tenantId: "tenant-a", status: "OPEN" } },
  {
    $lookup: {
      from: "case_parties",
      let: { caseId: "$_id", tenantId: "$tenantId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$tenantId", "$$tenantId"] },
                { $eq: ["$caseId", "$$caseId"] }
              ]
            }
          }
        }
      ],
      as: "parties"
    }
  }
]
```

Tenant must flow through joins/lookups.

---

## 17. Tenant Filter Test

Create tests that fail if tenant criteria missing.

Example pseudo-test:

```java
@Test
void worklistQueryMustIncludeTenantId() {
    Query query = builder.buildWorklistQuery(tenantId, filter);

    assertThat(query).containsCriteria("tenantId", tenantId.value());
}
```

For aggregation:

```java
@Test
void aggregationMustStartWithTenantMatch() {
    List<Document> pipeline = builder.buildPipeline(tenantId, filter);

    assertThat(pipeline.get(0)).containsMatchOn("tenantId");
}
```

Also test negative case:

```text
tenant A request must never return tenant B document
```

Use fixtures with overlapping IDs:

```text
tenant-a caseId=CASE-001
tenant-b caseId=CASE-001
```

This catches hidden assumption that caseId is globally unique.

---

## 18. Overlapping IDs Across Tenants

Decide whether IDs are globally unique or tenant-scoped.

Tenant-scoped:

```text
tenant A: CASE-001
tenant B: CASE-001
```

Then every query must include tenantId.

Globally unique:

```text
caseId = UUID/ULID global
```

Still include tenantId for security and routing.

Best practice:

```text
Even if IDs are globally unique, include tenantId in queries for authorization and index targeting.
```

Do not rely on ID uniqueness as security boundary.

---

## 19. Noisy Neighbor Problem

Noisy neighbor = one tenant consumes shared resources and affects others.

Examples:

- large import,
- broad search,
- dashboard refresh storm,
- bulk export,
- retention delete,
- tenant-specific bug,
- high write volume,
- many concurrent users,
- large documents,
- secondary reads/reporting.

Symptoms:

```text
tenant A import increases latency for tenant B
```

Mitigation:

1. tenant-level rate limits,
2. per-tenant quotas,
3. bulkhead worker pools,
4. separate queues,
5. dedicated shards/clusters for large tenants,
6. operation-level throttling,
7. background job scheduling,
8. query guardrails,
9. max page size,
10. export as async job,
11. archive/search separation.

---

## 20. Tenant-Level Rate Limiting

Implement limits by:

```text
tenant
operation type
endpoint
background job
write/read class
```

Example:

```text
tenant A:
  interactive case transition: high priority
  export: low priority
  import: capped concurrency
  dashboard: cached/materialized
```

Pseudo:

```java
RateLimiter limiter = tenantLimiters.forTenantAndOperation(tenantId, "bulk-import");

if (!limiter.tryAcquire()) {
    throw new TooManyRequestsException("Tenant import rate exceeded");
}
```

For fairness:

- do not let batch jobs consume all DB capacity,
- prefer protecting interactive flows,
- expose quota status in admin.

---

## 21. Tenant-Specific Metrics

All important metrics should be sliceable by tenant, with cardinality control.

Metrics:

```text
request latency by tenant
Mongo command latency by tenant/use case
write QPS by tenant
read QPS by tenant
error rate by tenant
retry count by tenant
background job lag by tenant
outbox lag by tenant
dashboard freshness by tenant
storage size by tenant
document count by tenant
```

Caution:

- metrics label cardinality can explode if thousands of tenants.
- use top-N, sampling, exemplars, logs, or per-tenant dashboards for important tenants.

For enterprise/regulatory systems, per-tenant visibility is critical for incident diagnosis.

---

## 22. Tenant Skew

Tenant skew means data/workload uneven across tenants.

Example:

```text
Tenant A: 80% data
Tenant B: 10%
Tenant C-Z: 10%
```

Implications:

- `tenantId` only shard key may be poor,
- tenant A needs dedicated strategy,
- query performance differs by tenant,
- index selectivity differs,
- backup/restore times differ,
- retention job duration differs,
- migration rollout must account for large tenant.

Design with largest tenant in mind, not average tenant.

---

## 23. Shard Key With Tenant

From Part 021:

```javascript
{ tenantId: 1 }
```

is simple but risky if tenant skew.

Alternatives:

```javascript
{ tenantId: 1, caseId: "hashed" }
{ tenantId: 1, assigneeId: 1, dueAt: 1 }
{ region: 1, tenantId: 1, caseId: "hashed" }
```

Use collection-specific shard keys.

Example:

```text
cases:
  tenant + caseId hashed

case_worklist_items:
  tenant + assignee + dueAt

case_audit_events:
  tenant + caseId + sequence

dashboard_summaries:
  tenant

archive_records:
  tenant + closedAt
```

TenantId is often necessary but not always sufficient.

---

## 24. Tenant Isolation Matrix

Evaluate isolation by dimension.

```text
Data visibility:
  can tenant see others?

Performance:
  can tenant slow others?

Storage:
  can tenant fill disk?

Operational:
  can tenant restore/delete independently?

Security:
  can tenant use separate credentials/keys?

Compliance:
  can tenant have separate retention/data residency?

Failure:
  can tenant incident be isolated?

Customization:
  can tenant have custom indexes/schema?
```

Shared collection scores low on physical/performance isolation but high on simplicity.

Cluster-per-tenant scores high on isolation but high on cost.

Hybrid often balances.

---

## 25. Authorization Is Not Just TenantId

TenantId answers:

```text
which organization?
```

But within tenant, you still need authorization.

Example:

```text
user can access only assigned cases
user can access cases in region
user can view but not decide
user can see redacted documents only
supervisor can see team cases
legal officer can see archived cases
```

Query must include both:

```text
tenant scope
authorization scope
```

Example:

```javascript
db.cases.find({
  tenantId: "tenant-a",
  status: "OPEN",
  $or: [
    { assigneeId: "user-1" },
    { reviewerTeamId: { $in: ["team-1", "team-2"] } }
  ]
})
```

Authorization fields need indexing if used in hot queries.

---

## 26. Permission Snapshot Pattern

For performance, systems often store permission-related snapshot in document.

Example:

```javascript
{
  tenantId: "tenant-a",
  caseId: "case-1",
  access: {
    regionCode: "ID-JK",
    owningTeamId: "team-enforcement",
    sensitivity: "CONFIDENTIAL",
    allowedRoleCodes: ["CASE_REVIEWER", "SUPERVISOR"]
  }
}
```

Pros:

- query can filter without remote authorization service,
- indexable,
- faster list views.

Cons:

- permission changes require update/backfill,
- stale permission risk,
- must distinguish display/access snapshot vs authoritative policy.

Rule:

```text
Use snapshots for performance only when you have invalidation/reconciliation strategy.
Do not silently weaken authorization correctness.
```

---

## 27. Authorization Filter Builder

Centralize authorization filter construction.

```java
Criteria tenant = Criteria.where("tenantId").is(ctx.tenantId().value());

Criteria authorization = authorizationCriteriaFactory.forUser(ctx.user(), Operation.VIEW_CASE);

Query query = new Query(new Criteria().andOperator(tenant, authorization));
```

Avoid every repository hand-writing authorization.

Need tests:

- user sees allowed docs,
- user does not see forbidden docs,
- cross-tenant forbidden,
- role change behavior,
- admin override behavior,
- redaction behavior.

---

## 28. Redaction

Not all access is binary.

Some users may access case but not sensitive fields.

MongoDB projection can help:

```javascript
{
  caseNumber: 1,
  status: 1,
  summary: 1,
  "sensitiveDetails": 0
}
```

But redaction should be explicit in API response mapping.

Avoid returning full document to application/UI then hoping frontend hides fields.

Backend should shape response by permission.

Possible models:

- separate sensitive subdocument,
- separate collection with stricter access,
- field-level encryption,
- projection by role,
- redacted DTO.

---

## 29. Data Residency

Data residency = data must stay in allowed jurisdiction/region.

In MongoDB architecture, residency affects:

- cluster region,
- shard zones,
- backups,
- analytics/export,
- search indexes,
- logs,
- monitoring,
- support access,
- object storage attachments,
- cache,
- queue/outbox destination,
- disaster recovery region.

Do not say:

```text
cases are in EU cluster, so residency solved
```

Ask:

```text
Are audit logs also in EU?
Are backups in EU?
Are search indexes in EU?
Are attachments in EU?
Are error logs leaking payload to global monitoring?
Are support exports controlled?
```

---

## 30. Zone Sharding For Residency

Zone sharding can bind data ranges to shards.

Example shard key:

```javascript
{ jurisdiction: 1, tenantId: 1, caseId: "hashed" }
```

Zones:

```text
jurisdiction=EU -> EU shards
jurisdiction=ID -> Indonesia/APAC shards
jurisdiction=US -> US shards
```

Caution:

- jurisdiction must be known at insert,
- jurisdiction should be immutable or carefully managed,
- zone key low cardinality must be combined with high-cardinality fields,
- query must include jurisdiction/tenant for targeting,
- all related collections need compatible placement.

---

## 31. Cross-Region Queries

Regulatory admin may ask:

```text
show global dashboard across all regions
```

This can violate residency or be expensive.

Options:

1. aggregate only non-sensitive metrics,
2. region-local dashboards with central metadata,
3. async compliance report with approvals,
4. anonymized summaries,
5. federated query with strict controls,
6. no cross-region raw data access.

Design explicitly.

---

## 32. Per-Tenant Retention

Different tenants may have different retention rules.

Example:

```text
Tenant A:
  cases retained 7 years after closure

Tenant B:
  cases retained 10 years

Tenant C:
  audit retained indefinitely

Tenant D:
  delete PII after 3 years unless legal hold
```

Do not hardcode one TTL/index for all data if retention differs.

Retention fields:

```javascript
{
  retention: {
    policyId: "case-retention-7y",
    retainUntil: ISODate("2033-06-21"),
    deleteAfter: ISODate("2033-06-22"),
    legalHold: false,
    disposition: "DELETE" | "ARCHIVE" | "ANONYMIZE"
  }
}
```

Per-tenant retention job should use tenant policy.

---

## 33. Legal Hold

Legal hold overrides normal retention deletion.

Example:

```javascript
{
  tenantId: "tenant-a",
  caseId: "case-1",
  retention: {
    retainUntil: ISODate("2030-01-01"),
    deleteAfter: ISODate("2030-01-02"),
    legalHold: true,
    legalHoldReason: "Court order XYZ",
    legalHoldAppliedAt: ISODate(...)
  }
}
```

Retention job filter:

```javascript
{
  tenantId: "tenant-a",
  "retention.deleteAfter": { $lte: now },
  "retention.legalHold": { $ne: true }
}
```

Index:

```javascript
{ tenantId: 1, "retention.deleteAfter": 1, "retention.legalHold": 1 }
```

Do not rely only on TTL index if legal hold can change deletion eligibility unless TTL field is managed carefully.

---

## 34. TTL and Tenant Retention

TTL indexes can clean documents after expiry, but:

- TTL is not exact,
- TTL deletion is automatic,
- legal hold needs careful handling,
- per-tenant rules may differ,
- TTL cleanup can create spikes.

For complex regulated retention, prefer explicit retention job:

```text
find eligible documents
verify policy/legal hold
archive/export if needed
delete/anonymize in controlled batches
audit the action
```

TTL can still be useful for low-risk ephemeral data:

- sessions,
- idempotency keys after safe period,
- temporary import staging,
- temporary tokens.

---

## 35. Defensible Deletion

Defensible deletion means you can prove data was deleted according to policy, not accidentally or arbitrarily.

Need record:

```javascript
{
  _id: "deletion-run-20260621-tenant-a",
  tenantId: "tenant-a",
  policyId: "case-retention-7y",
  startedAt,
  completedAt,
  candidateCount,
  deletedCount,
  skippedLegalHoldCount,
  operator: "system",
  approvalRef,
  hashManifestRef,
  status: "COMPLETED"
}
```

For each deletion batch:

```text
input criteria
documents selected
legal hold check
action performed
errors
verification
```

In regulated systems, deletion itself is an auditable event.

---

## 36. Anonymization vs Deletion

Sometimes retention requires removing PII but keeping case statistics.

Example:

```javascript
{
  caseId: "case-1",
  tenantId: "tenant-a",
  status: "CLOSED",
  closedAt: ISODate(...),
  party: {
    name: null,
    identifier: null,
    anonymized: true
  },
  aggregateStats: {...}
}
```

Anonymization must be:

- irreversible enough for policy,
- consistently applied across collections,
- audited,
- search index updated,
- backups considered,
- downstream systems updated.

Be careful: simply setting fields to null in primary collection may not remove data from audit, search, exports, logs, backups, and attachments.

---

## 37. Per-Tenant Encryption

Options:

```text
cluster-level encryption at rest
database-level access separation
client-side field-level encryption
per-tenant KMS key
application-level encryption
```

Per-tenant encryption key benefits:

- stronger isolation,
- crypto-shredding possibilities,
- tenant-specific key rotation,
- compliance.

Costs:

- key management complexity,
- query limitations on encrypted fields,
- operational risk,
- performance overhead,
- backup/restore key dependency.

Do not choose per-tenant encryption casually, but for high-regulation tenants it may be necessary.

---

## 38. Key Rotation

If per-tenant key:

```text
tenant-a-key-v1 -> tenant-a-key-v2
```

Need:

- rotation process,
- re-encryption/backfill,
- dual-read period maybe,
- audit,
- rollback,
- performance plan,
- backup compatibility.

Key rotation is migration.

Treat it with same seriousness as schema migration.

---

## 39. Backup/Restore Per Tenant

Shared collection makes per-tenant restore hard.

Scenario:

```text
Tenant A accidentally deletes 1000 cases.
Need restore only Tenant A to yesterday.
Tenant B has new writes today that must remain.
```

Full cluster restore is not acceptable.

Options:

1. point-in-time restore to separate environment,
2. extract tenant A affected data,
3. reconcile with current production,
4. reinsert/update with audit,
5. handle references/outbox/search,
6. preserve command history.

This is application-level restore workflow.

If per-tenant restore is core requirement, consider database-per-tenant or stronger isolation.

---

## 40. Tenant Restore Complexity

Restoring one tenant requires:

- cases,
- audit events,
- documents metadata,
- attachments,
- worklist projections,
- search documents,
- dashboard summaries,
- idempotency records maybe,
- outbox state,
- retention metadata,
- permissions,
- references to users/teams.

If restored case conflicts with new current state:

```text
Which wins?
Do we merge?
Do we create restore copy?
Do we replay events?
Do we require approval?
```

Define restore semantics before incident.

---

## 41. Tenant Export

Enterprise tenants often request data export.

Export must respect:

- tenant boundary,
- authorization,
- retention/legal hold,
- redaction,
- encryption,
- data residency,
- rate limit,
- audit,
- format/version,
- chain of custody.

Do not implement export as:

```text
db.collection.find({ tenantId }).toArray()
```

for large tenants.

Use:

- async export job,
- checkpointing,
- streaming,
- signed manifest,
- batch size,
- backpressure,
- audit log,
- checksum/hash,
- expiry for export artifact.

---

## 42. Support Access

Support engineers may need access to tenant data.

Risks:

- cross-tenant accidental access,
- overprivileged tooling,
- data exfiltration,
- lack of audit.

Design:

```text
support access request
approval workflow
tenant-specific scope
time-bound access
reason code
read-only by default
redaction if possible
full audit
break-glass procedure
```

Support tooling must use same tenant guardrails as product APIs.

No direct ad-hoc production database query except tightly controlled emergency process.

---

## 43. Administrative Global Queries

Some platform-level operations are global:

- billing,
- tenant health,
- quota,
- storage usage,
- global incident diagnosis,
- compliance summary.

Do not mix raw tenant data access with platform metadata.

Use separate collections:

```text
tenant_registry
tenant_usage_daily
tenant_health_summary
tenant_quota
```

These can be global because they contain metadata/summaries, not raw case content.

---

## 44. Cross-Tenant Analytics

If cross-tenant analytics needed:

- anonymize,
- aggregate,
- separate analytics pipeline,
- enforce contractual/legal constraints,
- avoid raw data mixing,
- tenant opt-in if required,
- use data minimization.

Operational MongoDB cluster may not be the right place for broad cross-tenant analytics.

Use warehouse/lake with governance if needed.

---

## 45. Query Guardrails For Search Screens

Multi-tenant search endpoint must constrain:

```text
tenantId mandatory
allowed filters
allowed sort fields
max page size
no unbounded regex
no arbitrary field query
time range max if broad
authorization filter
projection/redaction
```

Bad:

```text
POST /search
{
  "collection": "cases",
  "filter": {...},
  "sort": {...}
}
```

This is dangerous in multi-tenant systems.

Better:

```text
GET /cases/search?mode=WORKLIST&status=OPEN&cursor=...
```

or typed search request with validation.

---

## 46. Collection Naming and Tenant Data

Avoid dynamic collection names unless chosen model requires it.

Shared collection naming:

```text
cases
case_audit_events
case_documents
```

Document contains `tenantId`.

Collection-per-tenant naming requires safe naming:

```text
cases_tenant_abc
```

Avoid constructing names directly from untrusted tenant input.

Use tenant registry mapping:

```text
tenantId -> collectionName
```

---

## 47. Schema Evolution Across Tenants

In shared collection, schema migration affects all tenants.

In database-per-tenant, migration can roll tenant-by-tenant.

Hybrid:

```text
migration orchestrator reads tenant registry
applies migration by placement
records per-tenant migration state
```

Migration record:

```javascript
{
  _id: "tenant-a:migration:case-schema-v12",
  tenantId: "tenant-a",
  migrationId: "case-schema-v12",
  status: "COMPLETED",
  startedAt,
  completedAt,
  processed,
  failed
}
```

Large tenants may need separate migration windows.

---

## 48. Tenant Offboarding

Tenant offboarding includes:

1. disable access,
2. export data if contract requires,
3. retain data for required period,
4. delete/anonymize after retention,
5. revoke keys,
6. remove search indexes/projections,
7. cleanup outbox/jobs,
8. archive audit proof,
9. update tenant registry,
10. audit completion.

Do not simply drop tenant data immediately unless policy allows.

Offboarding is a lifecycle.

---

## 49. Tenant Onboarding

Tenant onboarding includes:

1. create tenant registry record,
2. assign placement/region,
3. assign retention policy,
4. assign encryption key if needed,
5. initialize indexes/projections if tenant-specific,
6. create admin users/roles,
7. configure quotas,
8. configure support access policy,
9. seed reference data,
10. verify health.

For shared collection, onboarding is mostly metadata.

For database/cluster-per-tenant, onboarding includes provisioning.

---

## 50. Multi-Tenant Testing Strategy

Test dimensions:

```text
cross-tenant isolation
same caseId in different tenants
same user email in different tenants
tenant-specific retention
tenant-specific roles
tenant-specific region
large tenant performance
noisy neighbor
per-tenant restore simulation
tenant migration between placement tiers
support access
redaction
```

Fixture:

```text
tenant-a:
  caseId CASE-001
  user reviewer@example.com

tenant-b:
  caseId CASE-001
  user reviewer@example.com
```

This catches accidental global uniqueness assumptions.

---

## 51. Static Analysis / Code Review Rules

Introduce code review checks:

```text
Repository methods must accept TenantId.
Mongo queries on tenant-owned collections must include tenantId.
Aggregation $lookup must include tenantId join.
Indexes on shared collections should usually prefix tenantId.
Background jobs must be tenant-scoped or explicitly global.
Exports must be async and audited.
Deletes must check retention/legal hold.
Support tools must use tenant-scoped APIs.
```

For mature teams, add tests or linting around query builders.

---

## 52. Security Boundary In Depth

Tenant isolation should not rely only on one thing.

Layers:

```text
authentication:
  identify user/service

authorization:
  what tenant and actions allowed?

application query guard:
  tenant criteria injected

database roles:
  least privilege

network:
  restricted access

encryption:
  protect at rest/in transit

audit:
  detect and prove access

observability:
  identify anomalies

operational process:
  approvals for support/export/delete
```

If app bug misses tenant filter, other layers may not fully prevent leak in shared collection. That is why tests and repository design matter.

---

## 53. Regulatory Defensibility

Defensible system must answer:

```text
Who accessed tenant data?
Why?
When?
From where?
What changed?
What policy applied?
Was retention followed?
Was legal hold respected?
Where was data stored?
Was data exported?
Was data deleted?
Can we prove it?
```

MongoDB design must preserve evidence:

- audit events,
- immutable command records,
- deletion manifests,
- export manifests,
- support access logs,
- retention job logs,
- tenant policy snapshots,
- schema migration records.

---

## 54. Anti-Patterns

### 54.1 Optional Tenant Filter

```java
search(filter, Optional<TenantId>)
```

Dangerous.

### 54.2 Global Repository For Tenant Data

```java
caseRepository.findById(id)
```

### 54.3 Cross-Tenant `$lookup`

Join by `caseId` only.

### 54.4 TenantId Not In Index

Leads to broad scans and possible leaks.

### 54.5 One Huge Tenant In Shared Model Without Plan

Noisy neighbor waiting to happen.

### 54.6 TTL For Regulated Deletion Without Legal Hold

Can delete data that should be preserved.

### 54.7 Direct Production DB Support Queries

Bypasses audit and guardrails.

### 54.8 Export Without Audit

Data exfiltration risk.

### 54.9 Same Retention Policy For All Tenants

Often wrong.

### 54.10 Treating Data Residency As Only Primary DB Location

Backups/logs/search/exports may violate.

---

## 55. Design Review Checklist

```text
[ ] What is tenant definition?
[ ] Which tenancy model is used?
[ ] Why this model?
[ ] Is tenantId present in every tenant-owned document?
[ ] Are repository methods tenant-scoped?
[ ] Are indexes tenant-prefixed?
[ ] Are aggregation lookups tenant-safe?
[ ] How are authorizations filtered?
[ ] How is redaction handled?
[ ] How are noisy tenants throttled?
[ ] How is tenant skew handled?
[ ] Is shard key tenant-aware?
[ ] How is data residency enforced?
[ ] Are backups region-compliant?
[ ] Is per-tenant restore required?
[ ] Is per-tenant export audited?
[ ] Are retention policies per tenant?
[ ] How is legal hold handled?
[ ] How is support access approved/audited?
[ ] How is tenant offboarding performed?
[ ] What metrics exist by tenant?
```

---

## 56. Practical Exercise

Design a multi-tenant MongoDB platform for regulatory case management.

Requirements:

```text
- 50 tenants
- 3 huge tenants, 47 small tenants
- EU tenants must stay in EU
- APAC tenants must stay in APAC
- tenant-specific retention: 7, 10, or indefinite years
- legal hold can override deletion
- support access must be audited
- users can only see cases assigned to their team
- some cases are confidential and require special role
- large tenants run bulk imports
- per-tenant export is contractually required
- per-tenant restore is required for premium tenants only
```

Answer:

1. tenancy model,
2. tenant registry structure,
3. collection design,
4. index strategy,
5. shard key/zone strategy,
6. authorization filter model,
7. retention model,
8. legal hold model,
9. support access model,
10. export/restore strategy,
11. noisy neighbor mitigation,
12. testing strategy.

Suggested direction:

```text
small tenants:
  shared collections per region cluster

huge/premium tenants:
  dedicated database or dedicated cluster/shard zone

tenant registry:
  placement, region, retention, encryption key, tier

queries:
  mandatory tenantId + authorization criteria

indexes:
  tenantId prefix for shared collections

data residency:
  region-specific clusters or zone sharding

retention:
  explicit retention job, not blind TTL for regulated case data

support:
  time-bound approved access, audited

exports:
  async, checkpointed, signed manifest

restore:
  premium tenant isolated enough to make restore feasible
```

---

## 57. Senior-Level Heuristics

```text
If tenantId is optional, the design is unsafe.

If support can query DB directly, auditability is weak.

If export is synchronous, large tenants will break it.

If per-tenant restore is required, shared collection may be costly.

If tenantId is not in indexes, performance and isolation suffer.

If largest tenant is not modelled separately, capacity planning is fantasy.

If retention ignores legal hold, deletion is not defensible.

If data residency ignores backups/search/logs, it is incomplete.

If authorization is only checked after fetching documents, leak risk is higher.

If tenant boundary is not tested with overlapping IDs, hidden bugs remain.
```

---

## 58. Summary

Multi-tenancy in MongoDB is not solved by adding `tenantId`.

Key lessons:

1. Tenancy model shapes security, operations, compliance, performance, and cost.
2. Shared collection is simple but requires strong guardrails.
3. Database/cluster-per-tenant improves isolation but increases operations.
4. Hybrid models are often best for real SaaS/regulatory platforms.
5. `tenantId` must be present in every tenant-owned document.
6. Repository methods should require `TenantId`.
7. Indexes in shared collections usually need `tenantId` prefix.
8. Aggregation and `$lookup` must preserve tenant boundary.
9. Authorization is tenant + user/team/role/sensitivity, not tenant alone.
10. Tenant skew and noisy neighbor require throttling and placement strategy.
11. Data residency includes backups, search, logs, exports, and analytics.
12. Per-tenant retention and legal hold require explicit modelling.
13. Per-tenant restore/export are domain capabilities, not simple DB commands.
14. Support access must be approved, scoped, time-bound, and audited.
15. Regulatory defensibility depends on evidence: audit, policy snapshots, deletion/export manifests, and access logs.

The most important sentence:

> In a multi-tenant regulated system, tenant isolation is not a filter condition; it is an end-to-end invariant that must be enforced, indexed, tested, monitored, audited, and operationalized.

---

## 59. Bridge to Part 023

Part 023 will focus on security:

- authentication mechanisms,
- authorization/RBAC,
- least privilege,
- application users vs database users,
- network security,
- TLS,
- secrets management,
- sensitivity classification,
- encryption at rest,
- client-side field-level encryption,
- queryable encryption,
- audit logging,
- data masking,
- backup security,
- secure connection handling in Java,
- security review checklist.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-023.md
```

Judul berikutnya:

```text
Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets
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
```

Seri belum selesai. Masih lanjut ke Part 023 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Sharding Deep Dive: Horizontal Scale Without Magical Thinking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-023.md">Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets ➡️</a>
</div>

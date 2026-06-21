# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-024.md

# Part 024 — Multi-Tenant ScyllaDB Design: Tenant Isolation, Noisy Neighbor, Hot Tenants, Quotas, dan Operational Controls

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `024`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: desain ScyllaDB untuk sistem multi-tenant: tenant isolation, partition key, noisy neighbor, hot tenant, quotas, fairness, per-tenant throttling, shared vs dedicated clusters, schema/keyspace strategy, backfill fairness, observability, security boundary, dan operational controls.

---

## 0. Posisi Part Ini dalam Seri

Part 023 membahas schema evolution.

Part ini membahas tantangan yang sering muncul di SaaS/regulatory/enterprise platform:

```text
banyak tenant
ukuran tenant tidak merata
tenant besar membuat hot partitions
tenant kecil butuh p99 stabil
backfill tenant besar mengganggu semua
query by tenant terlalu luas
retention berbeda antar tenant
compliance/security berbeda antar tenant
```

Multi-tenancy bukan hanya menambahkan kolom:

```sql
tenant_id uuid
```

Multi-tenancy adalah desain isolation di semua layer:

```text
data model
partition key
Java repository
rate limiting
backfill
monitoring
security
operational runbook
capacity planning
cost attribution
```

Tujuan part ini:

> Membuat kamu mampu mendesain ScyllaDB shared platform yang tetap fair dan predictable walau tenant skew ekstrem.

---

## 1. Multi-Tenant Mental Model

Tenant adalah boundary bisnis dan operasional.

Tenant bisa berarti:

- customer,
- organization,
- agency,
- region,
- legal entity,
- workspace,
- product environment.

Dalam SaaS, tenant biasanya punya:

```text
data ownership
quota
authorization boundary
billing
retention policy
SLO
support contract
```

Database schema harus menghormati boundary ini.

---

## 2. Tenant ID in Every Primary Key?

Rule umum:

```text
Tenant-scoped data should include tenant_id in partition key.
```

Example:

```sql
PRIMARY KEY ((tenant_id, case_id))
```

Bukan:

```sql
PRIMARY KEY ((case_id))
```

kecuali `case_id` globally unique dan authorization tetap enforced.

Mengapa tenant_id penting:

- data isolation,
- query scoping,
- easier delete/export per tenant,
- cost attribution,
- quota,
- debugging,
- backfill per tenant,
- GDPR/privacy workflow,
- accidental cross-tenant query prevention.

---

## 3. Tenant ID Alone Is Not Enough

Bad:

```sql
PRIMARY KEY ((tenant_id), updated_at, case_id)
```

Jika tenant besar punya 100 juta cases:

```text
one huge partition per tenant
```

Ini buruk.

Better:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), updated_at, case_id)
```

atau:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

Tenant_id harus dikombinasikan dengan dimensi selektif/bucket.

---

## 4. Shared Table Pattern

Most common:

```text
all tenants share same table
tenant_id included in key
```

Example:

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    version bigint,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id))
);
```

Pros:

- simple operations,
- efficient capacity sharing,
- one schema,
- easier migrations,
- lower overhead.

Cons:

- noisy neighbor risk,
- tenant-specific retention harder,
- per-tenant backup/restore harder,
- per-tenant schema customization hard,
- extreme tenant may dominate cluster.

---

## 5. Keyspace per Tenant Pattern

Alternative:

```text
tenant_abc.case_current_by_id
tenant_xyz.case_current_by_id
```

Pros:

- stronger operational isolation,
- tenant-specific retention/replication possible,
- easier per-tenant drop/export,
- clearer blast radius.

Cons:

- many keyspaces/tables overhead,
- schema migration complexity,
- driver metadata overhead,
- operational scale issues,
- not practical for many small tenants.

Good for:

- few large enterprise tenants,
- strict compliance isolation,
- dedicated capacity model.

Bad for:

- thousands/millions small tenants.

---

## 6. Cluster per Tenant Pattern

Dedicated cluster for tenant.

Pros:

- strongest isolation,
- independent scaling,
- independent maintenance window,
- custom security/compliance,
- noisy neighbor eliminated.

Cons:

- high cost,
- operational overhead,
- automation required,
- capacity fragmentation.

Use for:

- mega tenants,
- regulated/high-compliance customers,
- custom SLO,
- large enough revenue/cost justification.

---

## 7. Hybrid Tenancy

Common mature architecture:

```text
small tenants -> shared cluster/table
medium tenants -> shared but quota/isolation
mega tenants -> dedicated keyspace or cluster
regulated tenants -> dedicated environment
```

Need tenant placement system:

```text
tenant_id -> placement
```

Example:

```sql
CREATE TABLE tenant_placement_by_id (
    tenant_id uuid PRIMARY KEY,
    placement_type text,
    cluster_id text,
    keyspace_name text,
    region text,
    status text,
    updated_at timestamp
);
```

Application resolves placement before query.

---

## 8. Tenant Placement as Routing Contract

If tenants can move between clusters/keyspaces, placement becomes critical.

Flow:

```text
request -> auth tenant_id -> placement lookup/cache -> Scylla session/cluster -> repository
```

Placement cache must be:

- consistent enough,
- invalidated on move,
- secure,
- observable.

Tenant move/migration is advanced operational workflow.

Do not add placement indirection unless needed.

---

## 9. Noisy Neighbor

Noisy neighbor is one tenant consuming shared resources and hurting others.

Resources:

- CPU,
- disk IO,
- compaction,
- memory/cache,
- network,
- connections/in-flight,
- coordinator capacity,
- shard hotspots,
- table storage,
- repair/streaming bandwidth.

Causes:

- high QPS tenant,
- huge backfill,
- bad query,
- hot partition,
- large export,
- many retries,
- large payload,
- polling storm.

---

## 10. Tenant Skew

Tenant data and traffic often follow power law.

Example:

```text
top 1% tenants = 80% traffic
largest tenant = 10,000x smallest tenant
```

Design assuming uniform tenants will fail.

Always model:

```text
p50 tenant
p95 tenant
p99 tenant
mega tenant
```

Capacity planning must include skew.

---

## 11. Partition Key Design for Multi-Tenant Data

Good pattern:

```text
tenant_id + entity_id
```

for point lookup.

```sql
PRIMARY KEY ((tenant_id, case_id))
```

Good for current by id.

For list query:

```text
tenant_id + access_dimension + time_bucket + hash_bucket
```

Example:

```sql
PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
```

This prevents one tenant or assignee from creating unbounded partition.

---

## 12. Tenant-Scoped Hot Partition

Even with tenant_id, low-cardinality dimension is dangerous.

Bad:

```sql
PRIMARY KEY ((tenant_id, status), updated_at, case_id)
```

If tenant has many OPEN cases:

```text
partition tenant+OPEN huge/hot
```

Better:

```sql
PRIMARY KEY ((tenant_id, status, bucket_day, bucket_id), updated_at, case_id)
```

or split by assignee/team.

---

## 13. Global Low-Cardinality Partition

Worse:

```sql
PRIMARY KEY ((status), updated_at, case_id)
```

This mixes all tenants.

Problems:

- hot global partition,
- authorization risk,
- noisy neighbor,
- impossible tenant isolation.

Avoid global low-cardinality partition keys.

---

## 14. Tenant Bucket Strategy

Bucket by:

- day/hour/month,
- hash of entity,
- status + time,
- assignee + time,
- version range.

Example hash bucket:

```java
int bucketId = floorMod(stableHash(caseId), bucketCount);
```

Partition:

```text
tenant_id, assignee_id, bucket_day, bucket_id
```

Bucket count may vary by tenant size.

But variable bucket count complicates reads.

---

## 15. Adaptive Bucket Count per Tenant

Small tenant:

```text
bucket_count = 1
```

Large tenant:

```text
bucket_count = 16
```

Mega tenant:

```text
bucket_count = 128
```

Need table:

```sql
CREATE TABLE tenant_bucket_policy_by_id (
    tenant_id uuid,
    access_path text,
    bucket_count int,
    effective_from timestamp,
    PRIMARY KEY ((tenant_id), access_path)
);
```

Risks:

- changing bucket_count affects reads/writes,
- old rows in old bucket layout,
- cursor complexity,
- dual-bucket migration.

Prefer simple fixed bucket count until needed.

---

## 16. Tenant Bucket Policy Version

If bucket count changes, version it:

```text
bucket_policy_version
bucket_count
effective_from
```

Rows can include:

```text
bucket_policy_version
```

Reader may need query old+new policies during transition.

This is schema evolution problem.

---

## 17. Per-Tenant Quotas

Quota types:

```text
read QPS
write QPS
storage bytes
row count
large export count
backfill concurrency
max payload size
max page size
max fanout
max retention
```

Quota protects shared cluster.

Application must enforce before database request.

---

## 18. Per-Tenant Rate Limiting

Implement rate limiter keyed by tenant_id.

Example:

```text
tenant A: 1000 rps
tenant B: 100 rps
```

Limits can be per operation:

```text
authoritative reads
derived reads
writes
exports
backfills
LWT commands
```

Do not use one global limiter only.

---

## 19. Per-Tenant In-Flight Limit

QPS limiter is not enough.

If tenant’s requests are slow, in-flight accumulates.

Use:

```text
max in-flight DB operations per tenant
```

Example:

```text
tenant A max 256 DB ops
tenant B max 32 DB ops
```

This prevents one tenant from occupying all driver/cluster capacity.

---

## 20. Per-Tenant Backpressure

When tenant exceeds quota:

- return 429,
- degrade non-critical endpoints,
- pause tenant backfill,
- reduce page size,
- serve stale cache if allowed,
- queue lower-priority work.

Do not let excess traffic become retry storm.

---

## 21. Priority Classes

Not all operations equal.

Priority:

```text
P0 command writes / auth / critical state
P1 user interactive reads
P2 feeds/derived views
P3 exports/reports
P4 backfill/rebuild
```

Backfill should not compete with P0.

Implement separate execution profiles and throttles.

---

## 22. Tenant-Aware Bulk Jobs

Backfill/export should be tenant-aware.

Features:

```text
per-tenant checkpoint
per-tenant throttle
pause tenant
skip tenant
resume tenant
tenant progress
tenant-specific error count
```

For mega tenant, split further by bucket/range.

---

## 23. Tenant Isolation in Java Repository

Repository method should require tenant_id.

Bad:

```java
findCase(CaseId caseId)
```

Good:

```java
findCase(TenantId tenantId, CaseId caseId)
```

Bad:

```java
findByExternalRef(String ref)
```

Good:

```java
findByExternalRef(TenantId tenantId, ExternalRef ref)
```

This prevents accidental cross-tenant access and improves partitioning.

---

## 24. Tenant ID From Auth Context

Tenant ID should come from authenticated context, not arbitrary request body.

Flow:

```text
auth token -> tenant_id
request path/body tenant -> validate matches auth
repository uses authenticated tenant_id
```

Never trust client-supplied tenant_id without authorization.

---

## 25. Cross-Tenant Admin Queries

Admin endpoints may query across tenants.

Do not run cross-tenant online scans on ScyllaDB hot path.

Options:

- OLAP/search system,
- async export job,
- tenant-by-tenant throttled scan,
- precomputed admin index,
- pagination with tenant cursor.

Cross-tenant operations need special rate limits and audit.

---

## 26. Tenant Data Deletion

Deleting tenant data:

```text
tenant offboarding
privacy deletion
contract termination
```

If shared tables:

```text
delete rows across many tables/partitions
```

This can create tombstones and long jobs.

Strategies:

- tenant-scoped keyspaces for strict deletion,
- table design with tenant/date buckets,
- async deletion job,
- retention/anonymization,
- drop dedicated keyspace/cluster if isolated,
- legal audit of deletion.

Tenant deletion in shared table is operationally heavy.

---

## 27. Tenant Export

Tenant export requires:

- enumerate tenant tables,
- scan tenant partitions/buckets,
- consistent snapshot semantics? maybe not trivial,
- throttle,
- object storage output,
- progress,
- authorization/audit,
- PII handling.

Do not implement export as:

```text
SELECT * WHERE tenant_id=?
```

unless partition key supports bounded scan and tenant small.

Often use event log/source-of-truth + object storage.

---

## 28. Tenant Restore

Per-tenant restore in shared tables is hard.

Questions:

```text
restore to same tenant?
restore to new tenant?
overwrite existing data?
merge?
handle tombstones?
derived tables rebuilt?
external indexes?
```

Dedicated keyspace/cluster simplifies restore.

For shared tables, design restore as application-level replay/import, not raw table restore.

---

## 29. Tenant Retention Policies

Tenants may have different retention:

```text
tenant A: notifications 30d
tenant B: notifications 365d
```

Putting both in same TTL table creates mixed TTL values and compaction inefficiency.

Options:

- separate table per retention class,
- keyspace/cluster per retention tier,
- no table TTL; application retention job,
- object archive for long retention,
- tenant placement by retention.

Retention is multi-tenancy design input.

---

## 30. Tenant-Specific Schema Customization

Avoid per-tenant schema variation in shared table.

Bad:

```text
tenant A has columns X,Y
tenant B has columns Z
```

This causes code/schema chaos.

Use:

- common schema,
- feature flags,
- metadata map only for small bounded non-query fields,
- external search/document system for custom fields,
- dedicated tenant environment if truly custom.

---

## 31. Tenant Custom Fields

Enterprise customers often want custom fields.

Do not add column per customer.

Options:

1. bounded metadata map for display-only fields,
2. custom field table:

```sql
CREATE TABLE case_custom_field_by_case (
    tenant_id uuid,
    case_id uuid,
    field_id text,
    value_text text,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id), field_id)
);
```

3. queryable custom fields in search system,
4. per-tenant projection if high value.

If query by custom field:

```text
ScyllaDB table per field/filter can explode.
Use search/OLAP.
```

---

## 32. Authorization Boundary

ScyllaDB itself may not enforce row-level tenant authorization for application queries.

Application must enforce:

```text
tenant_id in every query
auth context matches tenant_id
no cross-tenant query unless admin
```

Database roles can separate keyspaces, but shared table row-level isolation is application responsibility.

---

## 33. Encryption and Tenant Isolation

If compliance requires tenant-specific encryption keys:

Options:

- application-level envelope encryption per tenant,
- dedicated keyspace/cluster with disk encryption,
- external KMS integration,
- separate clusters for strict tenants.

Application-level encryption affects:

- queryability,
- secondary indexes,
- search projections,
- key rotation,
- payload size,
- Java mapper.

---

## 34. Tenant Key Rotation

If encrypting tenant data with tenant key:

Need:

- key version in row/payload,
- decrypt old versions,
- re-encrypt job,
- pause/retry,
- audit,
- failure handling,
- backup compatibility.

This is schema/data evolution plus security.

---

## 35. Per-Tenant Observability

Metrics should include tenant dimension carefully.

Raw tenant_id label can be high cardinality.

Options:

- top-N tenant metrics,
- sampled logs with tenant_id,
- hashed tenant bucket,
- tenant-specific dashboards for large tenants,
- aggregate by tenant tier.

Need answer:

```text
Which tenant caused spike?
Which tenant is affected?
Which tenants exceed quota?
```

without destroying metrics backend.

---

## 36. Tenant Tiers

Classify tenants:

```text
free
standard
enterprise
regulated
mega
internal
```

Tiers drive:

- quota,
- retention,
- placement,
- SLO,
- backup policy,
- support priority,
- max export size,
- throttling.

Store tier in tenant metadata.

---

## 37. Capacity Planning by Tenant

Track:

```text
rows per tenant
bytes per tenant
read QPS
write QPS
p99 latency
LWT count
fanout count
tombstone warnings
large partition risk
backfill load
export usage
```

Estimate:

```text
growth rate
top tenant growth
new tenant onboarding
seasonal spikes
```

Plan capacity for p99 tenant, not average.

---

## 38. Cost Attribution

Shared cluster cost can be attributed by:

- storage bytes,
- read/write request units,
- data transfer,
- backfill/export usage,
- dedicated resources,
- support tier.

Even if not billed, cost attribution helps decide when to move tenant to dedicated cluster.

---

## 39. Mega Tenant Migration

When tenant outgrows shared cluster:

```text
move to dedicated cluster/keyspace
```

Migration steps:

```text
1. provision target
2. dual-write tenant to source+target
3. backfill historical tenant data
4. validate
5. cutover reads/writes for tenant
6. keep rollback window
7. remove tenant from shared cluster later
```

This is schema/backfill/cutover problem scoped to tenant.

---

## 40. Tenant Move Requires Placement Version

During move:

```text
tenant placement changes
```

Need:

- placement version,
- cache invalidation,
- dual-write routing,
- read fallback,
- idempotent writes,
- replay missed writes,
- cutover flag.

Placement row:

```text
tenant_id
current_cluster
target_cluster
migration_status
placement_version
```

---

## 41. Multi-Region Tenancy

Tenants may be assigned home region.

Pattern:

```text
tenant_id -> home_region
writes routed to home region
reads local/remote depending product
```

Benefits:

- data residency,
- latency,
- conflict reduction.

Risks:

- cross-region failover,
- tenant move,
- replication lag,
- active-active conflicts.

Part 025 covers multi-region deeply.

---

## 42. Data Residency

Regulatory tenants may require:

```text
EU data stays in EU
Indonesia data stays in Indonesia
US data stays in US
```

This affects:

- cluster placement,
- keyspace replication,
- backups,
- logs,
- metrics,
- support tooling,
- export location,
- disaster recovery.

Tenant metadata must include residency constraints.

---

## 43. Tenant-Aware Schema Evolution

Schema migration should consider tenant tiers.

Cutover strategy:

```text
internal tenant
small canary tenants
standard tenants
large tenants
regulated tenants last
mega tenant separately
```

Backfill order:

```text
small tenants first to validate
large tenants with dedicated window/throttle
```

---

## 44. Tenant-Aware Incident Response

Incident questions:

```text
Is this all tenants or one tenant?
Which tenants affected?
Is one tenant causing load?
Can we throttle offender?
Can we move/degrade tenant?
Can we disable exports/backfills?
```

Need controls before incident.

---

## 45. Tenant Kill Switch

For extreme abuse/bug:

- disable export for tenant,
- reduce tenant rate limit,
- pause tenant backfill,
- disable expensive feature,
- force cached/stale reads,
- temporarily block writes? only if business allows.

Controls should be audited and reversible.

---

## 46. API Limits by Tenant

Examples:

```text
max page size
max date range
max export rows
max concurrent exports
max bulk import size
max custom fields
max notifications/day
max command rate
```

Limits depend on tier.

Enforce before DB query.

---

## 47. Query Design for Tenant Lists

For tenant dashboard:

```text
list cases updated today
```

Use:

```sql
PRIMARY KEY ((tenant_id, bucket_day, bucket_id), updated_at, case_id)
```

Not:

```sql
WHERE tenant_id=? ALLOW FILTERING
```

Every tenant list must have bounded dimensions.

---

## 48. Tenant-Level Aggregates

Dashboard per tenant:

```text
open case count by status
```

Options:

- async aggregate table,
- OLAP,
- event-derived count,
- approximate counter with reconciliation.

Do not scan all tenant cases per request.

---

## 49. Tenant-Level Search

Search across tenant cases:

```text
party name
address
text
custom fields
```

Use search engine scoped by tenant_id.

ScyllaDB stores source/current metadata and IDs.

Search result action validates source row in ScyllaDB.

---

## 50. Tenant-Level Reporting

Reporting/analytics:

- long range,
- group by,
- counts,
- exports.

Use OLAP/warehouse/ClickHouse-style system.

ScyllaDB can feed OLAP via CDC/events/backfill.

Do not run reporting scans on OLTP cluster.

---

## 51. Table Design Examples

### 51.1 Current Case

```sql
CREATE TABLE case_current_by_id (
    tenant_id uuid,
    case_id uuid,
    status text,
    version bigint,
    updated_at timestamp,
    PRIMARY KEY ((tenant_id, case_id))
);
```

### 51.2 Assignee Queue

```sql
CREATE TABLE open_cases_by_assignee_day_bucket (
    tenant_id uuid,
    assignee_id uuid,
    bucket_day date,
    bucket_id int,
    due_at timestamp,
    case_id uuid,
    source_version bigint,
    title text,
    PRIMARY KEY ((tenant_id, assignee_id, bucket_day, bucket_id), due_at, case_id)
);
```

### 51.3 Tenant Event Log by Day

```sql
CREATE TABLE case_events_by_tenant_day_bucket (
    tenant_id uuid,
    bucket_day date,
    bucket_id int,
    event_time timestamp,
    event_id uuid,
    case_id uuid,
    event_type text,
    PRIMARY KEY ((tenant_id, bucket_day, bucket_id), event_time, event_id)
);
```

This supports tenant export/backfill by day/bucket.

---

## 52. Tenant Deletion-Friendly Design

If tenant deletion/export is requirement, include tenant/day buckets in source/event tables.

This lets jobs enumerate:

```text
tenant -> days -> buckets
```

instead of global scans.

But do not make one tenant partition huge.

---

## 53. Backfill Fairness Example

Backfill all tenants:

Bad:

```text
process largest tenant first at max speed
```

Good:

```text
round-robin tenants
weighted by tier/quota
max in-flight per tenant
checkpoint per tenant
pause noisy tenant
```

This avoids starving small tenants.

---

## 54. Noisy Neighbor Detection

Signals:

```text
tenant QPS spike
tenant timeout spike
tenant hot partition warnings
tenant export/backfill active
tenant payload bytes spike
tenant retry rate spike
tenant stale validation fanout spike
```

Need correlation:

```text
operation + tenant + table + key hash
```

---

## 55. Hot Tenant vs Hot Partition

Hot tenant:

```text
many operations across many partitions
```

Can be mitigated by rate limiting or capacity.

Hot partition:

```text
too many operations to same partition/key
```

Adding nodes may not help.

Need bucketing/caching/single-writer/rate limit.

Distinguish them.

---

## 56. Tenant-Aware Caching

Cache can reduce hot tenant load.

But cache by tenant:

```text
cache key includes tenant_id
```

Avoid cross-tenant leakage.

For multi-tenant cache:

- tenant in key,
- per-tenant cache quota,
- eviction isolation,
- encryption if needed,
- no raw PII in shared metrics/logs.

---

## 57. Security Logging

Logs should include tenant for audit, but avoid sensitive data.

Good:

```text
tenant_id
operation
table
partition_key_hash
request_id
```

Bad:

```text
full email/case title/legal identifier
```

---

## 58. Testing Multi-Tenancy

Test:

```text
small tenant
large tenant
mega tenant
hot tenant
hot partition within tenant
tenant export
tenant deletion
per-tenant quota
cross-tenant access attempt
tenant-specific retention
rolling migration per tenant
tenant move
```

Load test with skew.

Uniform tenants hide problems.

---

## 59. Multi-Tenant Load Test

Dataset:

```text
1000 small tenants
50 medium tenants
5 large tenants
1 mega tenant
```

Traffic:

```text
some tenants idle
some bursty
mega tenant continuous
one abusive tenant
backfill on large tenant
exports running
```

Measure:

- global p99,
- p99 for small tenants,
- mega tenant p99,
- timeout by tenant,
- fairness,
- cluster metrics.

---

## 60. Operational Dashboard

Dashboard:

```text
top tenants by read QPS
top tenants by write QPS
top tenants by timeout
top tenants by latency
top tenants by bytes
top tenants by storage
active exports/backfills
quota violations
hot partition samples
tenant tier distribution
```

High-cardinality control is important.

---

## 61. Common Anti-Patterns

### 61.1 Partition by tenant_id only

Creates huge partitions.

### 61.2 Global status partition

Mixes all tenants and hot values.

### 61.3 No per-tenant quota

One tenant can hurt all.

### 61.4 Backfill tenant data without throttle

Noisy neighbor.

### 61.5 Trust tenant_id from request body

Security bug.

### 61.6 Custom schema per tenant in shared table

Operational chaos.

### 61.7 Reporting on OLTP cluster

Noisy scans.

### 61.8 No tenant dimension in metrics/logs

Cannot debug.

### 61.9 Dedicated cluster for every tenant too early

Cost/ops explosion.

### 61.10 Shared cluster for mega regulated tenant too long

Isolation/SLO risk.

---

## 62. Multi-Tenant Design Checklist

```text
[ ] Is tenant_id in every tenant-scoped primary key?
[ ] Is tenant_id combined with selective/bucket dimension?
[ ] Are low-cardinality global partitions avoided?
[ ] Is per-tenant QPS limit defined?
[ ] Is per-tenant in-flight limit defined?
[ ] Are tenant tiers defined?
[ ] Are mega tenants handled?
[ ] Are exports/backfills tenant-throttled?
[ ] Is tenant deletion/export workflow designed?
[ ] Is tenant retention policy supported?
[ ] Is cross-tenant admin query off OLTP path?
[ ] Is tenant_id from auth context?
[ ] Are metrics tenant-aware without high-cardinality overload?
[ ] Are hot tenant and hot partition distinguishable?
[ ] Is placement model needed?
[ ] Is rollback/move plan defined for tenant migration?
```

---

## 63. Mental Model Compression

Remember:

```text
tenant_id gives scope,
but bucket/selective dimensions give scalability.
```

And:

```text
multi-tenancy is not a column;
it is isolation policy across schema, code, traffic, ops, and security.
```

---

## 64. Summary

Multi-tenant ScyllaDB design requires balancing sharing efficiency with isolation.

Key lessons:

1. Include tenant_id in tenant-scoped primary keys.
2. Never partition by tenant_id alone for large lists.
3. Avoid global low-cardinality partitions.
4. Use tenant + access dimension + time/hash bucket.
5. Tenant skew follows power law.
6. Noisy neighbor must be controlled at application layer.
7. Per-tenant QPS and in-flight limits are essential.
8. Backfill/export must be tenant-aware and throttled.
9. Shared table, keyspace-per-tenant, and cluster-per-tenant each have trade-offs.
10. Hybrid tenancy is common for mature systems.
11. Tenant placement becomes routing contract if tenants move.
12. Tenant deletion/export/restore are hard in shared tables.
13. Retention differences may require table/keyspace/cluster separation.
14. Custom fields should not become per-tenant schema chaos.
15. Authorization must enforce tenant scope before repository calls.
16. Observability must answer which tenant caused or suffered an issue.
17. Testing must include skew, hot tenants, and noisy-neighbor scenarios.
18. Multi-tenancy spans data model, Java client, operations, and security.

---

## 65. Review Questions

1. Mengapa tenant_id harus ada di primary key tenant-scoped data?
2. Kenapa partition by tenant_id saja buruk?
3. Apa beda hot tenant dan hot partition?
4. Apa itu noisy neighbor?
5. Kapan shared table cocok?
6. Kapan keyspace-per-tenant cocok?
7. Kapan cluster-per-tenant cocok?
8. Apa itu hybrid tenancy?
9. Apa risiko adaptive bucket count per tenant?
10. Bagaimana per-tenant quota diterapkan?
11. Mengapa in-flight limit penting selain QPS?
12. Bagaimana backfill dibuat tenant-fair?
13. Kenapa tenant_id harus dari auth context?
14. Bagaimana cross-tenant admin query sebaiknya dibuat?
15. Mengapa tenant deletion di shared table sulit?
16. Bagaimana retention berbeda memengaruhi schema?
17. Bagaimana custom fields dimodelkan?
18. Apa metrik tenant-aware yang penting?
19. Bagaimana mega tenant dipindah ke dedicated cluster?
20. Apa checklist multi-tenant design?

---

## 66. Practical Exercise

Desain multi-tenant ScyllaDB untuk regulatory case platform:

```text
- 10,000 small tenants
- 100 medium tenants
- 5 mega tenants
- tenant punya retention berbeda
- ada endpoint assignee queue
- ada audit export per tenant
- ada custom fields
- ada regulatory data residency
```

Tuliskan:

```text
1. tenant metadata table
2. placement strategy
3. table primary keys
4. bucket strategy
5. quota model
6. per-tenant backpressure
7. export design
8. deletion/offboarding design
9. custom field design
10. search/reporting offload
11. observability labels
12. mega tenant migration plan
13. noisy neighbor controls
14. testing plan
15. operational runbook
```

---

## 67. Preview Part 025

Part berikutnya membahas:

```text
Multi-Region and Multi-DC Design:
NetworkTopologyStrategy,
LOCAL_QUORUM,
home region,
active-active vs active-passive,
data residency,
latency,
failover,
conflict handling,
and disaster recovery trade-offs.
```

Part 024 membahas multi-tenancy.

Part 025 akan memperdalam multi-region dan multi-datacenter.

---

# End of Part 024

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Schema Evolution: DDL Safety, Rolling Deploy, Compatibility, Dual-Write, Backfill, dan Migration Playbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-025.md">Part 025 — Multi-Region and Multi-DC Design: NetworkTopologyStrategy, LOCAL_QUORUM, Home Region, Active-Active, Failover, dan DR Trade-offs ➡️</a>
</div>

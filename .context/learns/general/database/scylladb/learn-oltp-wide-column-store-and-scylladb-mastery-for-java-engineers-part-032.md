# learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-032.md

# Part 032 — Security and Compliance: Authentication, Authorization, TLS, Secrets, Encryption, Tenant Isolation, PII, Audit Logs, Privacy Deletion, Backup Security, dan Compliance-Oriented Data Design

> Seri: `learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers`  
> Part: `032`  
> Target pembaca: Java software engineer yang ingin memahami ScyllaDB sebagai distributed OLTP wide-column database secara production-grade.  
> Fokus part ini: security dan compliance untuk ScyllaDB-backed Java systems: authentication, authorization, TLS, secrets management, encryption, tenant isolation, PII handling, audit logs, privacy deletion, data residency, backup security, least privilege, secure observability, and compliance-aware data modeling.

---

## 0. Posisi Part Ini dalam Seri

Part 031 membahas correctness patterns.

Part ini membahas security dan compliance.

Untuk sistem OLTP yang menyimpan data bisnis/regulatory, security bukan lapisan tambahan setelah schema selesai.

Security harus memengaruhi:

```text
primary key design
tenant_id usage
authorization boundary
table authority
audit trail
retention
TTL
backup
restore
logs
metrics
encryption
data residency
operator access
migration/backfill tooling
```

Security failure sering tidak terlihat sebagai latency/error.

Ia bisa berupa:

```text
cross-tenant data leak
PII in logs
backup exposed
wrong tenant restore
privacy deletion resurrected
operator has excessive privilege
debug endpoint leaks query data
derived table not deleted
search index retains deleted data
```

Tujuan part ini:

> Membuat kamu mendesain ScyllaDB-backed Java service yang aman secara teknis dan siap compliance secara operasional.

---

## 1. Security Is a Data Model Concern

Security bukan hanya:

```text
enable TLS
set username/password
done
```

Security juga:

- apakah semua query scoped by tenant?
- apakah tenant_id berasal dari auth context?
- apakah PII diduplikasi ke derived table?
- apakah backup terenkripsi?
- apakah restore replay privacy deletions?
- apakah logs mengandung raw keys?
- apakah search index menyimpan data yang seharusnya dihapus?
- apakah operator bisa query semua tenant?
- apakah retention sesuai regulasi?

Data model menentukan blast radius.

---

## 2. Threat Model

Mulai dari threat model.

Pertanyaan:

```text
1. Data apa yang sensitif?
2. Siapa actor yang bisa mengakses sistem?
3. Apa boundary tenant?
4. Apa boundary region/residency?
5. Apa yang terjadi jika service credential bocor?
6. Apa yang terjadi jika backup bucket bocor?
7. Apa yang terjadi jika operator salah menjalankan query?
8. Apa yang terjadi jika logs/traces bocor?
9. Apa yang terjadi jika app bug query tanpa tenant_id?
10. Apa compliance requirement?
```

Threat model mengubah desain.

---

## 3. Data Classification

Classify data:

```text
public
internal
confidential
PII
sensitive PII
regulated/legal
secret/credential
audit-critical
```

Examples:

| Data | Classification |
|---|---|
| case title | confidential/regulatory |
| party name | PII |
| national ID | sensitive PII |
| case status | confidential |
| audit event actor | audit-critical |
| object storage key | confidential |
| auth token | secret |
| tenant_id | internal/confidential |
| partition key hash | internal |

Classification drives:

- encryption,
- logging,
- masking,
- access control,
- retention,
- backup policy,
- export controls.

---

## 4. Authentication to ScyllaDB

Authentication answers:

```text
who is connecting to database?
```

Production should use authenticated DB connections.

Java service uses:

- username/password,
- certificate-based auth if supported/setup,
- secrets manager,
- rotated credentials.

Avoid:

- hardcoded credentials,
- shared admin user,
- default credentials,
- credentials in logs/config dumps,
- long-lived secrets without rotation plan.

---

## 5. Authorization in ScyllaDB

Authorization answers:

```text
what can this identity do?
```

Use least privilege.

Service should not connect as superuser/admin.

Example roles:

```text
case_service_rw
case_service_ro
migration_runner
backfill_runner
reporting_ro
ops_admin
```

Privileges should be scoped to:

- keyspace,
- table,
- read/write,
- DDL,
- admin operations.

Application runtime usually should not have DDL privileges.

---

## 6. Least Privilege Pattern

Runtime app:

```text
SELECT/INSERT/UPDATE/DELETE on required tables only
no DROP
no ALTER
no CREATE
no admin
```

Migration tool:

```text
DDL privileges
limited execution environment
audited
manual approval
```

Backfill tool:

```text
read source, write target
maybe no DDL
rate-limited
audited
```

Export tool:

```text
read only
tenant-scoped
audited
```

Least privilege reduces blast radius.

---

## 7. Separate Credentials by Workload

Do not use one credential for everything.

Use separate identities for:

- online service,
- migration,
- backfill,
- analytics export,
- admin/ops,
- test/staging.

If backfill credential leaks, it should not be able to drop keyspaces.

If app credential leaks, it should not be able to read unrelated keyspaces.

---

## 8. Credential Rotation

Credential rotation plan:

```text
1. create new credential
2. deploy app supporting new secret
3. switch secret reference
4. verify connections
5. revoke old credential
6. monitor failures
```

Avoid downtime.

Java app should support secret reload or rolling restart.

Monitor authentication failures during rotation.

---

## 9. Secrets Management

Secrets should come from:

- cloud secrets manager,
- Kubernetes Secret with encryption + RBAC,
- Vault,
- secure runtime injection.

Avoid:

- source code,
- image layers,
- plain config repo,
- logs,
- stack traces,
- metrics labels,
- debug endpoint.

Do not print driver config with password.

---

## 10. TLS in Transit

Use TLS for client-to-node connections when data crosses untrusted network or compliance requires.

TLS protects:

- credentials,
- query data,
- result rows,
- metadata.

Consider also node-to-node encryption depending deployment/security model.

Java driver must be configured with:

- truststore/cert,
- hostname verification if applicable,
- protocol/cipher policy,
- certificate rotation plan.

---

## 11. Certificate Rotation

Certificate rotation can break DB connectivity if not planned.

Plan:

```text
1. trust old + new CA/cert
2. deploy trust update
3. rotate server certs
4. rotate client certs if mutual TLS
5. remove old trust
```

Test in staging.

Monitor connection/auth errors.

---

## 12. Encryption at Rest

Encryption at rest can happen at:

- disk/volume layer,
- filesystem,
- database feature/config if available,
- application-level field encryption,
- object storage encryption,
- backup encryption.

Disk encryption protects against stolen disks.

It does not protect against:

- compromised app credential,
- malicious query,
- operator with DB access,
- logs containing PII.

Need layered security.

---

## 13. Application-Level Encryption

Encrypt sensitive fields before writing to DB.

Use for:

- national ID,
- secrets,
- high-risk PII,
- tenant-specific key requirements.

Trade-offs:

- cannot query encrypted field unless special scheme,
- indexes/search affected,
- key rotation complex,
- payload grows,
- Java mapper complexity,
- backups still contain ciphertext but key management critical.

---

## 14. Envelope Encryption

Pattern:

```text
data encrypted with data key
data key encrypted with tenant/master key
row stores ciphertext + key version
```

Fields:

```text
ciphertext blob
key_version int
encryption_context text
```

Key management via KMS.

Need:

- decrypt old key versions,
- rotate keys,
- audit key usage,
- handle KMS outage.

---

## 15. Tenant-Specific Encryption

If tenant requires own key:

```text
tenant_id -> key_id/current_key_version
```

Row may store:

```text
tenant_id
encrypted_payload
key_version
```

Key rotation requires re-encrypt job.

Tenant offboarding may use cryptographic erasure:

```text
destroy tenant key
```

But only if all copies are encrypted solely with that key and policy allows.

---

## 16. Encryption and Queryability

Encrypted fields cannot be filtered/sorted normally.

If need query by sensitive field:

Options:

- store keyed hash for exact lookup,
- search system with secure indexing,
- deterministic encryption with careful threat analysis,
- avoid query requirement,
- tokenize field.

Example exact lookup:

```sql
CREATE TABLE subject_by_national_id_hash (
    tenant_id uuid,
    national_id_hash blob,
    subject_id uuid,
    PRIMARY KEY ((tenant_id, national_id_hash))
);
```

Hash must be keyed/HMAC to resist dictionary attacks.

---

## 17. Tenant Isolation

Tenant isolation is both security and scalability.

Rules:

```text
tenant_id from auth context
tenant_id included in primary key
repository requires TenantId
cross-tenant admin path separate
logs/traces scoped
cache key includes tenant_id
search index scoped by tenant_id
object storage path scoped by tenant_id
```

Do not trust request body tenant_id.

---

## 18. Cross-Tenant Query Prevention

Bad repository:

```java
Optional<Case> findByCaseId(CaseId caseId);
```

Good:

```java
Optional<Case> findByTenantAndCase(TenantId tenantId, CaseId caseId);
```

Bad CQL:

```sql
SELECT * FROM case_current_by_id WHERE case_id = ? ALLOW FILTERING;
```

Good CQL:

```sql
SELECT ...
FROM case_current_by_id
WHERE tenant_id = ?
  AND case_id = ?;
```

---

## 19. Authorization at Service Layer

ScyllaDB shared table cannot by itself enforce row-level tenant authorization for app queries.

Service must enforce:

```text
auth principal -> tenant membership -> operation permission -> tenant_id scoped query
```

Every command:

```text
who?
tenant?
role?
permission?
target?
```

Do not rely only on UI hiding buttons.

---

## 20. Admin Access

Admin tools are dangerous.

Admin queries may bypass tenant scope.

Controls:

- separate admin service,
- explicit permissions,
- audit logs,
- approval workflow,
- read-only by default,
- tenant selector required,
- result redaction,
- no arbitrary CQL console for broad users.

---

## 21. Audit Logging

Audit log records security-relevant actions:

```text
who did what to which tenant/entity when and why
```

Audit events:

- login/admin access,
- case state transition,
- permission change,
- export requested,
- privacy deletion,
- backup restore,
- schema migration,
- tenant placement change,
- credential rotation,
- operator override.

Audit logs should be append-only/immutable-ish and protected.

---

## 22. Audit Log Data Model

Example:

```sql
CREATE TABLE audit_events_by_tenant_day (
    tenant_id uuid,
    bucket_day date,
    event_time timestamp,
    event_id uuid,
    actor_id uuid,
    actor_type text,
    action text,
    target_type text,
    target_id text,
    reason text,
    metadata text,
    PRIMARY KEY ((tenant_id, bucket_day), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

For global admin audit, also write:

```text
audit_events_by_actor_day
```

or external audit system.

---

## 23. Audit Log Integrity

Audit log should be hard to alter.

Options:

- append-only event table,
- restricted delete privileges,
- retention/legal hold,
- hash chain,
- external immutable storage,
- WORM object storage,
- separate security account.

Do not let normal service account delete audit history casually.

---

## 24. PII in Logs

Never log:

- national ID,
- full address,
- email if not needed,
- raw payload,
- auth token,
- secrets,
- full object storage signed URL,
- raw query values for sensitive fields.

Use:

```text
tenant_id if allowed
case_id if allowed
hash/redacted key
request_id
operation
```

Review logging like data storage.

---

## 25. PII in Metrics

Metrics labels are widely replicated and retained.

Do not label metrics with:

```text
email
case_id
user_id
national_id
raw tenant names
request_id
```

Use bounded labels:

```text
tenant_tier
operation
table
result
region
```

For tenant observability, use top-N controlled pipeline or logs.

---

## 26. PII in Tracing

Tracing systems often have broad access.

Trace attributes should avoid raw values.

Good:

```text
tenant_tier=enterprise
db.table=case_current_by_id
partition_key_hash=...
```

Bad:

```text
party_name=...
national_id=...
full_address=...
```

---

## 27. Data Minimization

Do not store data you do not need.

Ask:

```text
Why is this field stored?
How long is it needed?
Can we store reference instead?
Can we tokenize?
Can we hash?
Can we redact?
Can we avoid copying to derived tables?
```

Security improves when less sensitive data exists.

---

## 28. Denormalization and PII Duplication

ScyllaDB often duplicates data across tables.

Each duplicate increases:

- deletion complexity,
- breach blast radius,
- backup exposure,
- retention complexity,
- access control burden.

For PII:

```text
duplicate IDs/references, not full sensitive payload
```

Example:

Bad:

```text
party_name and address copied into 6 derived tables
```

Better:

```text
derived table stores case_id/title summary if allowed
source table stores full party details
```

---

## 29. Privacy Deletion

Privacy deletion requires removing/anonymizing data across:

- source tables,
- derived tables,
- search indexes,
- caches,
- object storage,
- backups policy/deletion replay,
- logs if applicable policy,
- analytics/OLAP.

Data model must support finding all locations.

If PII is duplicated everywhere, deletion is harder.

---

## 30. Deletion Log

Privacy deletion should create durable event:

```sql
CREATE TABLE privacy_deletions_by_time (
    bucket_day date,
    deletion_time timestamp,
    deletion_id uuid,
    tenant_id uuid,
    subject_type text,
    subject_id text,
    actor_id uuid,
    reason text,
    status text,
    PRIMARY KEY ((bucket_day), deletion_time, deletion_id)
);
```

This supports:

- audit,
- restore deletion replay,
- validation,
- async projection deletes.

---

## 31. Delete vs Anonymize

Options:

### Delete

Remove rows/cells.

Pros:

- data gone from live table eventually.

Cons:

- tombstones,
- backup retention issue,
- derived cleanup,
- audit complication.

### Anonymize

Replace PII with irreversible placeholder.

Pros:

- preserves referential/audit structure,
- fewer missing rows.

Cons:

- must be irreversible,
- still maybe personal if linkable,
- careful legal interpretation.

Choose with legal/compliance.

---

## 32. Legal Hold

Legal hold can override deletion/TTL.

If case under hold:

- prevent automatic TTL deletion,
- preserve audit,
- mark data,
- adjust backup retention,
- restrict access,
- log all access.

Model legal hold explicitly.

---

## 33. Retention Policies

Retention should be table/data-class specific.

Examples:

```text
audit events: 7 years
notifications: 90 days
idempotency keys: 30 days
debug logs: 14 days
backups: 35 days
legal hold: indefinite until released
```

Do not use one retention for all.

---

## 34. TTL and Compliance

TTL can enforce retention automatically.

But TTL has caveats:

- expiry creates tombstones,
- compaction timing matters,
- not instant deletion from backups,
- mixed TTL affects compaction,
- legal hold conflicts.

For compliance deletion, TTL alone may not be enough.

---

## 35. Data Residency

Data residency affects:

- ScyllaDB replication,
- backup location,
- logs/traces/metrics,
- search/OLAP projection,
- object storage,
- support access,
- admin tools.

Tenant metadata should include residency policy.

Application must route writes/reads accordingly.

---

## 36. Search/OLAP Compliance

Derived systems often leak data.

If ScyllaDB enforces residency but search index is global:

```text
compliance failure
```

Ensure:

- tenant-scoped index,
- regional index,
- delete propagation,
- access control,
- backup/retention aligned.

---

## 37. Object Storage Security

Rows often store object references.

Object storage needs:

- per-tenant path/prefix,
- access control,
- encryption,
- signed URL expiration,
- audit,
- retention/legal hold,
- deletion workflow,
- hash/integrity validation.

DB row security is insufficient if object storage is open.

---

## 38. Backup Security

Backups contain sensitive data.

Controls:

- encryption,
- least privilege,
- immutable storage,
- separate account/project,
- access audit,
- retention,
- deletion policy,
- restore approval,
- no public buckets,
- key rotation.

Backup compromise is full data compromise.

---

## 39. Restore Security

Restore is powerful.

Controls:

- approval workflow,
- isolated restore environment,
- tenant scope validation,
- audit log,
- data minimization,
- deletion replay,
- access-limited forensic cluster,
- cleanup after restore.

Do not let broad engineers restore production backups locally.

---

## 40. Export Security

Tenant/customer exports are high-risk.

Controls:

- authorization,
- approval if sensitive,
- audit event,
- data minimization,
- encryption,
- expiring download link,
- watermarking maybe,
- rate limits,
- tenant scope,
- output retention/deletion.

Export jobs should be tenant-aware and logged.

---

## 41. Backfill/Migration Security

Backfill jobs often have broad access.

Controls:

- separate credentials,
- read/write scope limited,
- dry run,
- code review,
- audit,
- PII-safe logs,
- throttle,
- kill switch,
- output DLQ protection.

Backfill DLQ may contain sensitive payload; secure it.

---

## 42. Schema Migration Security

Migration tool often has DDL privileges.

Controls:

- restricted identity,
- migration review,
- approval,
- immutable migration files,
- checksum,
- audit who applied,
- no ad-hoc DDL in production shell.

DDL can drop data.

Treat it like privileged operation.

---

## 43. Runtime Query Guardrails

Application can guard:

```text
tenant_id required
max page size
max date range
no ALLOW FILTERING in hot path
no SELECT * for sensitive table
operation must have execution profile
```

Fail fast if guardrails violated.

---

## 44. Secure Coding for Repositories

Repository should:

- never build CQL with string concatenated user input,
- use prepared statements,
- bind values,
- enforce tenant_id,
- validate limits,
- redact logs,
- classify errors safely,
- avoid leaking existence across tenants.

Example existence leak:

```text
404 if case exists in other tenant vs same response for unauthorized
```

Be careful.

---

## 45. Error Message Hygiene

Do not return internal details:

Bad:

```json
{
  "error": "InvalidQueryException: unconfigured table tenant_secret_case_current"
}
```

Good:

```json
{
  "error": "Request could not be completed"
}
```

Log details internally with safe redaction.

---

## 46. Side-Channel Risks

Side channels:

- timing difference reveals row exists,
- error difference reveals tenant/case ID,
- count endpoint leaks data volume,
- pagination cursor encodes sensitive key,
- metrics/logs expose tenant size.

Mitigate where threat model requires.

---

## 47. Cursor Security

API cursor may contain:

- tenant_id,
- partition key,
- timestamp,
- case_id,
- bucket info.

Protect cursor:

- sign with HMAC,
- encrypt if sensitive,
- include expiry,
- include tenant/auth context,
- validate on use,
- version cursor.

Do not trust client cursor.

---

## 48. Cache Security

Cache keys must include tenant_id.

Cache values may contain PII.

Controls:

- encryption if needed,
- TTL,
- per-tenant isolation,
- no cross-tenant key collisions,
- access control,
- invalidation on permission/privacy changes.

---

## 49. Multi-Tenant Authorization Tests

Test:

```text
tenant A cannot read tenant B case
tenant A cursor cannot be used by tenant B
tenant A cache key does not hit tenant B
admin requires permission
export scoped to tenant
search result validates tenant
object URL scoped/authorized
```

Security tests should be automated.

---

## 50. Audit of Reads

Some compliance regimes require read audit.

Read audit can be expensive.

Options:

- audit admin/sensitive reads only,
- sample normal reads,
- audit exports,
- audit bulk reads,
- audit access to sensitive fields,
- store in separate audit system.

Do not log full data read.

---

## 51. Audit of Writes

Write audit is usually mandatory.

For every command:

```text
actor
tenant
target
action
command_id
source IP/session maybe
result
timestamp
reason
```

Event log can double as business audit if designed securely.

Security audit may need separate immutable log.

---

## 52. Least-Privilege Java Service Design

Split services if needed:

```text
case-command-service: writes current/events
case-query-service: reads views
export-service: read-heavy, audited
backfill-worker: migration scoped
admin-service: privileged, heavily audited
```

Separate credentials and rate limits.

---

## 53. Secrets in Observability

Never put secrets into:

- exception messages,
- MDC/log context,
- trace attributes,
- metrics labels,
- health endpoint,
- actuator/config endpoint.

Review debug endpoints.

Disable unsafe config dump in production.

---

## 54. Health Endpoint Security

Health endpoints should not reveal:

- database hostnames,
- usernames,
- schema names if sensitive,
- stack traces,
- internal topology,
- tenant info.

Expose simple status externally.

Detailed health internal only.

---

## 55. Compliance Evidence

Auditors may ask for evidence:

- access logs,
- backup success,
- restore drills,
- encryption config,
- key rotation,
- deletion records,
- retention policy,
- migration approvals,
- incident response,
- least privilege review.

Build systems to produce evidence.

---

## 56. Security Incident Response

Plan:

```text
detect
contain
revoke credentials
rotate secrets
audit access
identify data scope
restore if destructive
notify stakeholders
patch vulnerability
postmortem
```

Database-specific:

- disable compromised role,
- rotate DB password/cert,
- review query logs/audit,
- check backup access,
- validate tenant isolation,
- scan for unauthorized export.

---

## 57. Common Anti-Patterns

### 57.1 App Uses Superuser

Huge blast radius.

### 57.2 Tenant ID from Request Body

Cross-tenant access bug.

### 57.3 PII in Derived Tables Everywhere

Deletion and breach blast radius.

### 57.4 Raw IDs/PII in Metrics Labels

Monitoring becomes data leak.

### 57.5 Backups Unencrypted or Broadly Accessible

Full data compromise.

### 57.6 Admin CQL Console for Many Engineers

Audit/control problem.

### 57.7 No Deletion Replay After Restore

Privacy deletion undone.

### 57.8 Search Index Ignored in Deletion

Data remains outside DB.

### 57.9 Cursor Contains Unsigned Sensitive Keys

Tampering/leak risk.

### 57.10 One Credential for App, Migration, Backfill

No least privilege.

---

## 58. Security Checklist

```text
[ ] Threat model exists.
[ ] Data classification exists.
[ ] Runtime DB role is least privilege.
[ ] Migration/backfill/export roles separate.
[ ] Credentials stored in secret manager.
[ ] Credential rotation tested.
[ ] TLS configured where required.
[ ] Tenant_id from auth context.
[ ] Repository requires tenant_id.
[ ] Cross-tenant tests exist.
[ ] PII logging policy enforced.
[ ] Metrics/traces are PII-safe.
[ ] Backups encrypted/access-controlled.
[ ] Restore requires approval/audit.
[ ] Privacy deletion log exists.
[ ] Derived/search/object storage deletion covered.
[ ] Cursor signed/encrypted as needed.
[ ] Admin tools audited.
[ ] Security incident runbook exists.
```

---

## 59. Mental Model Compression

Remember:

```text
Authentication proves who connects.
Authorization limits what they can do.
Tenant scoping limits whose data they touch.
Encryption limits what stolen storage reveals.
Audit tells what happened.
Retention/deletion controls how long data exists.
Backup security protects the biggest copy of everything.
```

And:

```text
Every denormalized copy of PII is a new compliance obligation.
```

---

## 60. Summary

Security and compliance must be designed into ScyllaDB-backed systems from the schema upward.

Key lessons:

1. Security is a data model concern.
2. Threat model and data classification drive controls.
3. Runtime services should not use superuser/admin credentials.
4. Use separate credentials for app, migration, backfill, export, and admin.
5. Secrets must be managed and rotated.
6. TLS protects data/credentials in transit.
7. Encryption at rest is necessary but not sufficient.
8. Application-level encryption affects queryability and key rotation.
9. Tenant isolation must be enforced in repository APIs and auth context.
10. Admin/export/backfill tools require audit and least privilege.
11. Audit logs must be durable and protected.
12. PII must not leak into logs/metrics/traces/cursors.
13. Denormalization multiplies privacy deletion and breach surface.
14. Privacy deletion requires source, derived, search, cache, object, backup strategy.
15. Backup compromise is full data compromise.
16. Restore must replay deletion/privacy constraints.
17. Compliance evidence should be produced by systems, not manual archaeology.

---

## 61. Review Questions

1. Mengapa security adalah data model concern?
2. Apa isi threat model untuk ScyllaDB-backed service?
3. Apa itu data classification?
4. Mengapa runtime app tidak boleh pakai superuser?
5. Kenapa credential app/migration/backfill harus dipisah?
6. Apa risiko secrets di config/log?
7. Apa yang dilindungi TLS?
8. Apa batasan encryption at rest?
9. Kapan application-level encryption berguna?
10. Bagaimana query exact lookup pada encrypted sensitive field?
11. Mengapa tenant_id harus dari auth context?
12. Bagaimana mencegah cross-tenant query?
13. Apa isi audit event?
14. Mengapa PII di metrics label berbahaya?
15. Apa risiko denormalisasi PII?
16. Bagaimana privacy deletion didesain?
17. Kenapa backup security sangat penting?
18. Apa kontrol untuk export security?
19. Bagaimana cursor diamankan?
20. Apa checklist security?

---

## 62. Practical Exercise

Desain security/compliance untuk regulatory case platform:

```text
Data:
- case metadata
- party names
- national IDs
- audit events
- evidence object references
- search index
- backup
```

Requirement:

```text
- multi-tenant SaaS
- enterprise admin export
- privacy deletion
- legal hold
- data residency by tenant
- Java services deployed in Kubernetes
```

Tulis:

```text
1. threat model
2. data classification table
3. DB roles/privileges
4. secrets management plan
5. TLS/cert rotation plan
6. tenant isolation enforcement
7. encryption strategy
8. PII denormalization rules
9. audit log schema
10. privacy deletion workflow
11. backup security controls
12. export controls
13. logging/tracing redaction policy
14. cursor security
15. compliance evidence dashboard
16. incident response runbook
```

---

## 63. Preview Part 033

Part berikutnya membahas:

```text
Migration and Interoperability:
moving from Cassandra/PostgreSQL/MongoDB,
dual-write,
CDC,
data validation,
cutover,
rollback,
compatibility,
and ecosystem integration.
```

Part 032 membahas security/compliance.

Part 033 akan membahas migrasi dan interoperabilitas dengan sistem lain.

---

# End of Part 032

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Correctness Patterns: Idempotency, Deduplication, Sagas, Outbox, Event Sourcing, Versioned State Machines, Single-Writer, Reconciliation, Read-Your-Write, dan Domain Invariants</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-oltp-wide-column-store-and-scylladb-mastery-for-java-engineers-part-033.md">Part 033 — Migration and Interoperability: Cassandra/PostgreSQL/MongoDB Migration, Dual-Write, CDC, Data Validation, Cutover, Rollback, Compatibility, dan Ecosystem Integration ➡️</a>
</div>

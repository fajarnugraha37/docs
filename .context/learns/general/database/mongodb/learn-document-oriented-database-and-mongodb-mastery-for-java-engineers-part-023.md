# learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-023.md

# Part 023 — Security: Authentication, Authorization, Encryption, Auditing, and Secrets

> Seri: Document-Oriented Database and MongoDB Mastery for Java Engineers  
> Bagian: 023 dari 035  
> Fokus: threat model, authentication, RBAC, least privilege, TLS, network boundary, secrets, encryption at rest, in-use/client-side encryption, audit logging, masking/redaction, backup security, dan secure Java connection handling  
> Target pembaca: Java software engineer / tech lead yang mendesain MongoDB-backed system untuk domain sensitif, multi-tenant, case management, regulatory, compliance, enterprise SaaS, atau financial systems

---

## 0. Posisi Part Ini Dalam Seri

Part 022 membahas multi-tenancy dan regulatory boundary. Bagian ini melanjutkan tema yang sama dari sisi security.

Security MongoDB bukan hanya:

```text
pakai password
aktifkan TLS
selesai
```

Security adalah desain berlapis:

```text
identity
authentication
authorization
network boundary
transport encryption
data encryption
field sensitivity
secrets management
auditability
backup protection
operational access
application query guardrail
incident response
```

MongoDB menyediakan fitur keamanan seperti authentication, access control/RBAC, transport encryption/TLS, encryption at rest, auditing pada edisi/produk tertentu, dan in-use/client-side encryption. Namun fitur hanya efektif jika desain aplikasi, deployment, dan proses operasional mendukungnya.

Kalimat inti:

> Security database tidak boleh diperlakukan sebagai konfigurasi ops belaka; ia harus menjadi bagian dari domain boundary, repository design, deployment architecture, dan audit model aplikasi.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus mampu:

1. Membuat threat model dasar untuk MongoDB-backed application.
2. Membedakan authentication, authorization, encryption, auditing, dan masking.
3. Menentukan kapan memakai user/password, X.509, IAM/OIDC/Kerberos/LDAP, atau managed identity sesuai environment.
4. Mendesain RBAC dan least privilege untuk aplikasi, admin, reporting, migration, backup, dan support tooling.
5. Menghindari anti-pattern seperti shared admin credential untuk semua service.
6. Menggunakan TLS dan network isolation sebagai baseline.
7. Mengelola secrets dengan rotation dan zero-leak logging.
8. Mengklasifikasikan field berdasarkan sensitivity.
9. Memahami encryption at rest vs transport encryption vs in-use/client-side field encryption.
10. Mendesain audit logging yang defensible.
11. Mendesain redaction/masking di API layer.
12. Mengamankan backup, restore, export, dan support access.
13. Membuat secure MongoDB Java connection pattern.
14. Membuat checklist security review untuk production.

---

## 2. Security Mental Model

Security terdiri dari beberapa pertanyaan berbeda.

```text
Authentication:
  siapa kamu?

Authorization:
  apa yang boleh kamu lakukan?

Confidentiality:
  siapa yang bisa membaca data?

Integrity:
  siapa yang bisa mengubah data, dan apakah perubahan valid?

Availability:
  apakah sistem tetap tersedia terhadap abuse/failure?

Auditability:
  bisakah kita membuktikan siapa melakukan apa, kapan, dan kenapa?

Non-repudiation / defensibility:
  bisakah aksi penting dipertanggungjawabkan secara legal/operasional?

Data minimization:
  apakah kita hanya menyimpan/memproses data yang perlu?
```

Jangan mencampur semuanya.

Contoh:

```text
TLS melindungi data in transit.
TLS tidak mencegah user dengan role terlalu luas membaca seluruh collection.

Encryption at rest melindungi data file saat disk dicuri.
Encryption at rest tidak mencegah aplikasi overprivileged membaca field sensitif.

Audit log mencatat akses/perubahan.
Audit log tidak mencegah akses jika authorization salah.

Masking di UI menyembunyikan tampilan.
Masking di UI tidak aman jika API mengirim data mentah.
```

---

## 3. Threat Model Untuk MongoDB Application

Mulai dari ancaman nyata.

### 3.1 External attacker

```text
mencoba connect ke database
mencuri credential
exploit exposed port
brute-force auth
MITM network traffic
```

### 3.2 Malicious or compromised application

```text
service credential bocor
service punya privilege terlalu luas
bug query tanpa tenant filter
injection-like unsafe query construction
```

### 3.3 Insider threat

```text
admin/support membaca data tenant tanpa alasan
developer memakai prod dump di laptop
operator menjalankan query salah
```

### 3.4 Tenant boundary failure

```text
tenant A melihat tenant B
support export salah tenant
backup restore mencampur tenant
search index tidak tenant-filtered
```

### 3.5 Data lifecycle failure

```text
data tidak terhapus sesuai retention
legal hold dilanggar
PII masih ada di audit/search/log/backup
```

### 3.6 Availability abuse

```text
tenant menjalankan export besar
query regex tidak terkendali
import job overload
retry storm
```

Security tidak hanya data leak. Query abuse juga security/availability risk.

---

## 4. Defense in Depth

Jangan bergantung pada satu layer.

Layer:

```text
network:
  private connectivity, firewall/security group, no public DB exposure

transport:
  TLS

identity:
  separate DB users / workload identity

authorization:
  least privilege roles

application:
  tenant/authorization guardrails

schema:
  sensitivity classification, field placement

encryption:
  at rest, in transit, in use where needed

secrets:
  vault/KMS, rotation

audit:
  database audit + application audit

operations:
  controlled support access, backup security, approvals

observability:
  anomaly detection, access logs, query metrics
```

Jika satu layer gagal, layer lain mengurangi blast radius.

---

## 5. Authentication

Authentication menentukan bagaimana client membuktikan identity ke MongoDB.

MongoDB mendukung beberapa authentication mechanism tergantung deployment/edition/product, seperti SCRAM, X.509, LDAP/Kerberos untuk Enterprise contexts, AWS IAM untuk Atlas contexts, dan OIDC/workload identity support di environment tertentu. Java driver juga menyediakan mekanisme authentication yang sesuai untuk beberapa mode tersebut.

Pilih berdasarkan environment dan security posture.

---

## 6. SCRAM Username/Password

SCRAM adalah mekanisme username/password umum.

Contoh connection string:

```text
mongodb://app_user:secret@host1,host2,host3/appdb?replicaSet=rs0&authSource=admin
```

Untuk production:

```text
do not hardcode password
do not commit connection string
do not print full URI in logs
use secret manager
rotate credentials
use unique user per application/service
use least privilege
```

Anti-pattern:

```text
one admin user used by all services
```

Better:

```text
case-service user
reporting-service user
migration-runner user
backup-agent user
support-readonly user
```

Each with scoped privileges.

---

## 7. X.509 / Mutual TLS

X.509 can authenticate clients using certificates. It is useful where certificate lifecycle is well-managed.

Pros:

- avoids static password style,
- strong machine identity,
- fits mTLS environments.

Cons:

- certificate issuance/rotation complexity,
- truststore/keystore management,
- operational failure if cert expires,
- Java TLS configuration complexity.

Use when organization has mature PKI/certificate automation.

---

## 8. IAM / OIDC / Workload Identity

In cloud/Kubernetes/managed environments, workload identity reduces static secrets.

Examples:

```text
AWS IAM auth in Atlas context
OIDC / workload identity federation where supported
Kubernetes service account identity
```

Benefits:

- fewer long-lived passwords,
- rotation handled by platform,
- identity tied to workload,
- better audit/least privilege.

Costs:

- setup complexity,
- provider-specific behavior,
- local development story,
- token refresh/metadata dependencies.

If available and mature in your org, workload identity is usually preferable to static passwords.

---

## 9. Authentication Source and User Scope

MongoDB users exist in authentication databases and can have roles across databases.

Do not create duplicate users unnecessarily.

Plan:

```text
app database:
  application data

admin/auth database:
  credentials/roles depending deployment model

roles:
  scoped to database/collection/actions
```

For multi-tenant database-per-tenant model, decide:

- one app user with roles across tenant DBs,
- per-tenant DB user,
- per-service user,
- per-service-per-tenant user.

More isolation increases operations complexity.

---

## 10. Authorization and RBAC

MongoDB grants privileges through roles.

Role controls:

```text
actions
resources
database
collection
cluster-level commands
```

Built-in roles exist for common cases, but production systems often need custom roles.

Principle:

```text
service should have only the privileges needed for its job
```

Not:

```text
readWriteAnyDatabase
dbAdminAnyDatabase
root
```

for application runtime.

---

## 11. Least Privilege By Workload

Different workloads need different privileges.

### 11.1 Case API service

Needs:

```text
read/write cases
read/write audit/outbox maybe
read reference data
```

Does not need:

```text
drop collection
create user
cluster admin
backup
index drop in runtime
```

### 11.2 Reporting service

Needs:

```text
read-only access to reporting collections or specific views
```

Does not need write.

### 11.3 Migration runner

May need:

```text
read/write target collections
create indexes if migration-managed
```

But only during controlled execution.

### 11.4 Backup agent

Needs backup-related privileges, not application write.

### 11.5 Support tool

Prefer read-only, tenant-scoped through application API, not direct DB.

---

## 12. Application User vs Human User

Do not map every human user to MongoDB DB user in normal web app.

Typical pattern:

```text
Application authenticates user via IdP.
Application authorizes user.
Application uses service DB credential to query MongoDB.
Application enforces tenant/user permissions.
```

MongoDB DB user represents service identity, not end-user identity.

Therefore, application audit must record end-user actions.

Database audit may show:

```text
case-service updated cases
```

Application audit must show:

```text
user u123 escalated case C-001 with reason X
```

Both are useful at different layers.

---

## 13. Runtime DB User Should Not Be Admin

Anti-pattern:

```text
Spring Boot service uses MongoDB root user.
```

Risk:

- application exploit becomes database admin,
- bug can drop collections,
- compromised service can read/write everything,
- blast radius huge.

Runtime user should not have:

```text
dropDatabase
dropCollection
createUser
grantRole
replSetConfigure
shutdown
serverStatus if not needed
collMod if not needed
createIndex if index creation is controlled elsewhere
```

Decide whether application may create indexes on startup. In regulated production, many teams disable runtime index management and apply indexes via migration pipeline.

---

## 14. Custom Roles

Example concept:

```javascript
{
  role: "caseServiceRole",
  privileges: [
    {
      resource: { db: "app", collection: "cases" },
      actions: ["find", "insert", "update"]
    },
    {
      resource: { db: "app", collection: "case_audit_events" },
      actions: ["find", "insert"]
    },
    {
      resource: { db: "app", collection: "outbox_events" },
      actions: ["find", "insert", "update"]
    }
  ],
  roles: []
}
```

Exact role syntax and actions should be verified against current MongoDB docs/version.

The architectural principle is stable:

```text
grant by service and collection, not by convenience.
```

---

## 15. Collection-Level Privilege and Projections

MongoDB RBAC can limit collection-level access, but field-level authorization is mostly application responsibility unless using specialized encryption/redaction patterns.

If user can see case header but not sensitive details, do not rely on DB role if service has full access. The service must shape result.

Patterns:

- separate sensitive collection,
- separate API projection,
- field-level encryption,
- application redaction,
- access-specific read models.

---

## 16. Network Security

Database should not be publicly exposed unless explicitly managed with strong controls.

Baseline:

```text
private network
security groups/firewall allow only app subnets
no 0.0.0.0/0 database access
restrict admin access
bastion/VPN/private endpoint
monitor connection sources
```

For Atlas/managed deployments:

- IP access lists/private endpoint/peering,
- VPC/VNet controls,
- least privilege project roles,
- avoid broad public access.

Network security reduces attack surface before authentication even runs.

---

## 17. TLS / Transport Encryption

TLS protects data in transit between client and MongoDB.

Use TLS for production.

In Java driver, TLS can be enabled through connection string or `MongoClientSettings`.

Connection string style:

```text
mongodb://host1,host2,host3/?tls=true
```

SRV Atlas style often implies TLS depending connection string template.

Do not disable certificate validation in production.

Anti-pattern:

```text
tlsAllowInvalidCertificates=true
```

This may be acceptable only for local/dev experiments, not production.

---

## 18. Java TLS Configuration

Java TLS may involve:

```text
truststore
keystore
certificate chain
hostname verification
mTLS client certificate
JDK TLS version
container CA bundle
```

Common failure modes:

- missing CA in container image,
- expired certificate,
- wrong hostname,
- disabled TLS versions,
- truststore not mounted,
- secret rotation without restart/reload,
- environment mismatch.

Operational checklist:

```text
monitor cert expiry
automate rotation
test connection after rotation
do not log key material
pin trusted CAs appropriately
avoid custom insecure TrustManager
```

---

## 19. Secrets Management

MongoDB credentials and certificates are secrets.

Do not store in:

```text
Git
Docker image
plain config file
logs
stack traces
Jira tickets
screenshots
shared docs
```

Use:

```text
Vault
KMS/Secrets Manager
Kubernetes Secrets with envelope encryption and RBAC
cloud secret manager
external secret operator
CI/CD secret store
```

Secrets need:

- ownership,
- rotation,
- access audit,
- least privilege,
- emergency revocation,
- environment separation,
- no reuse across prod/staging/dev.

---

## 20. Connection String Leakage

Connection strings often contain credentials.

Bad logging:

```java
log.info("Connecting to MongoDB {}", connectionString);
```

Better:

```java
log.info("Connecting to MongoDB cluster={}, database={}, tls={}",
    safeClusterName, databaseName, tlsEnabled);
```

If exception includes URI, sanitize.

Create utility:

```java
String sanitizeMongoUri(String uri) {
    return uri.replaceAll("://([^:@]+):([^@]+)@", "://$1:****@");
}
```

But be careful with URI variants. Prefer never logging raw URI.

---

## 21. Credential Rotation

Rotation plan:

```text
create new credential
deploy app supporting new credential
verify traffic
revoke old credential
monitor failures
audit completion
```

For zero-downtime rotation, use dual credential window.

If static secret is in many services, rotation is harder. Unique service credentials make blast radius and rotation easier.

Test rotation in staging.

---

## 22. Field Sensitivity Classification

Before encryption/redaction, classify fields.

Example levels:

```text
PUBLIC:
  non-sensitive reference data

INTERNAL:
  operational metadata

CONFIDENTIAL:
  case details, internal notes

RESTRICTED:
  PII, national ID, financial account, health data

SECRET:
  credentials, tokens, encryption keys

LEGAL_HOLD / REGULATED:
  data subject to retention/legal controls
```

Example case document:

```javascript
{
  tenantId: "tenant-a",
  caseNumber: "CASE-001",
  status: "OPEN",
  parties: [
    {
      name: "Jane Doe",              // RESTRICTED/PII
      nationalId: "..."              // RESTRICTED/PII
    }
  ],
  allegations: [...],                // CONFIDENTIAL
  internalNotes: [...],              // CONFIDENTIAL/RESTRICTED
  audit: {...},                      // REGULATED
  access: {...}                      // SECURITY-SENSITIVE
}
```

Classification drives:

- projection,
- encryption,
- masking,
- retention,
- logging,
- search indexing,
- export policy,
- support access,
- test data generation.

---

## 23. Encryption Types

Common categories:

```text
transport encryption:
  TLS; protects network traffic

encryption at rest:
  protects stored data files/backups/storage media

in-use/client-side field encryption:
  application encrypts specific fields before database stores them

application-level encryption:
  custom encryption before persistence

tokenization:
  replace sensitive value with token stored/managed elsewhere

hashing:
  one-way representation for matching/verification
```

Each solves different problem.

---

## 24. Encryption At Rest

Encryption at rest protects data files on disk/storage.

Useful against:

- stolen disk/snapshot,
- storage-level exposure,
- some infrastructure risks.

Does not protect against:

- overprivileged DB user,
- compromised app credential,
- query returning sensitive data,
- logs/export leaks,
- malicious admin with DB access depending key controls.

It is necessary baseline in many environments, but not sufficient alone.

---

## 25. Client-Side / In-Use Field Encryption

Client-side field encryption means application encrypts specific fields before sending to MongoDB. MongoDB stores ciphertext.

Benefits:

- DB/storage/admin may not see plaintext,
- stronger field confidentiality,
- per-field/per-tenant key possibilities.

Costs:

- query limitations depending encryption mode,
- key management,
- schema/mapping complexity,
- performance overhead,
- migration complexity,
- operational debugging harder.

Use for highly sensitive fields:

- national ID,
- tax ID,
- health/financial identifiers,
- secrets/tokens,
- private evidence metadata.

Do not encrypt everything blindly. Queryability and operations will suffer.

---

## 26. Queryable Encryption

Queryable encryption allows querying encrypted fields for supported query types/modes, but it has constraints and version/product-specific limitations.

Design questions:

```text
Which fields need encryption?
Which fields need equality search?
Which fields need range/prefix/search?
What leakage is acceptable?
What indexes/search features still work?
What is key rotation plan?
How do we test migrations?
How do we handle local dev?
```

If field needs full-text search, substring search, sorting, or analytics, encryption strategy must be chosen carefully.

Sometimes better:

- store encrypted original,
- store normalized hashed token for equality match,
- use external secure search/tokenization,
- avoid searching that field.

---

## 27. Hashing Sensitive Identifiers

For equality lookup without storing plaintext:

```text
nationalIdHash = HMAC_SHA256(tenantSecret, normalizedNationalId)
```

Document:

```javascript
{
  nationalIdEncrypted: <ciphertext>,
  nationalIdHash: "hmac..."
}
```

Query:

```javascript
{ tenantId, nationalIdHash }
```

Benefits:

- equality lookup,
- plaintext not stored,
- tenant-specific secret reduces cross-tenant correlation.

Cautions:

- use keyed HMAC, not raw SHA256 for low-entropy identifiers,
- normalize consistently,
- protect key,
- handle rotation,
- collision extremely unlikely but design consciously,
- hash can still be sensitive metadata.

---

## 28. Masking and Redaction

Masking is presentation-level transformation.

Example:

```text
nationalId: "********1234"
```

Redaction removes field entirely.

Backend should enforce masking/redaction before response leaves service.

Bad:

```text
API returns full nationalId
frontend masks
```

Better:

```text
API returns maskedNationalId only unless permission allows full value
```

DTOs should be permission-specific:

```java
record CasePartyPublicView(
    String name,
    String maskedNationalId
) {}

record CasePartyRestrictedView(
    String name,
    String nationalId
) {}
```

---

## 29. Sensitive Data In Logs

Do not log full documents.

Bad:

```java
log.info("Created case {}", caseDocument);
```

Risk:

- PII in logs,
- audit data in logs,
- evidence details in logs,
- secrets in logs,
- logs replicated to external systems.

Log:

```text
tenantId
caseId
commandId
operation
status
duration
result count
error classification
```

Not:

```text
party name
national ID
full address
free text notes
evidence content
access tokens
connection strings
```

Use structured logging with field allowlist.

---

## 30. Sensitive Data In Exceptions

Exceptions can leak:

- connection URI,
- document content,
- query filters,
- user input,
- stack traces with secrets,
- duplicate key values.

Sanitize error handling.

Example:

```java
catch (DuplicateKeyException e) {
    throw new ConflictException("Case number already exists");
}
```

Do not return raw database exception to client.

---

## 31. Search Index and Sensitive Data

Search indexes duplicate data.

If you index PII/confidential text, you must treat search index as sensitive data store.

Questions:

```text
Is search index in same region?
Is it encrypted?
Does it enforce tenant/authorization filter?
Can support access search index?
How is deletion/retention propagated?
How is legal hold handled?
How are redactions reflected?
```

Never forget search projection in data lifecycle.

---

## 32. Backup Security

Backups are sensitive.

Backup security includes:

```text
encryption
access control
retention
region/data residency
restore audit
integrity verification
separation of duties
key availability
secure deletion of expired backups
```

Threat:

```text
production DB is secure, but backup dump is copied to unsecured bucket
```

For regulated systems, backup handling is often as important as primary DB security.

---

## 33. Restore Security

Restore can leak data.

Example:

```text
restore production backup to staging where many developers have access
```

Need:

- masked/anonymized restore for lower env,
- approval for production restore,
- audit of who restored,
- environment access control,
- data residency check,
- encryption key access,
- cleanup after temporary restore.

If using real production data in non-prod, governance must be explicit.

---

## 34. Export Security

Exports are data exfiltration risk.

Export process should include:

- requester identity,
- tenant scope,
- approval,
- purpose,
- data fields included,
- redaction rules,
- encryption of artifact,
- expiry,
- download audit,
- checksum/manifest,
- retention/deletion of export file.

Do not let generic MongoDB export become product feature without policy.

---

## 35. Audit Logging: Database vs Application

Database audit can capture:

```text
DB user performed operation
collection accessed
command type
source address
```

Application audit can capture:

```text
end-user identity
business action
reason
case id
before/after state
authorization context
command id
approval id
```

Both are different.

For regulatory defensibility, application audit is usually essential because DB only sees service account.

---

## 36. Application Audit Event Design

Example:

```javascript
{
  _id: "audit:case-1:transition-999",
  tenantId: "tenant-a",
  aggregateType: "CASE",
  aggregateId: "case-1",
  action: "CASE_ESCALATED",
  actor: {
    userId: "u123",
    displayName: "Reviewer A",
    authMethod: "OIDC",
    roles: ["CASE_REVIEWER"]
  },
  reason: "SLA breach",
  commandId: "cmd-123",
  before: {
    status: "UNDER_REVIEW",
    version: 7
  },
  after: {
    status: "ESCALATED",
    version: 8
  },
  occurredAt: ISODate(...),
  correlationId: "...",
  sourceIp: "...",
  userAgent: "...",
  policySnapshot: {
    authorizationRuleVersion: "case-access-v5"
  }
}
```

Audit event should be append-only.

Avoid storing excessive sensitive payload in audit unless required.

---

## 37. Audit Integrity

Audit log must be hard to tamper with.

Options:

- append-only application design,
- DB role denies update/delete audit for runtime user where possible,
- separate audit writer role,
- immutable storage/export,
- hash chaining,
- periodic signed manifest,
- external audit sink,
- restricted admin access,
- monitoring on audit modifications.

Example hash chain:

```text
eventHash = hash(previousHash + canonicalEventJson)
```

This can improve tamper evidence, but operational complexity increases.

---

## 38. Who Can Delete Audit?

Usually:

```text
almost nobody
```

Retention may eventually archive/delete audit according to policy, but normal application runtime should not update/delete audit events.

If case service needs to insert audit:

```text
grant insert/read as needed
deny update/delete if feasible
```

Operational retention job has separate identity and process.

---

## 39. Secrets In MongoDB

Do not store application secrets in MongoDB unless designed as a secret store.

Examples to avoid:

- API keys plaintext,
- OAuth refresh tokens plaintext,
- encryption keys,
- database passwords,
- private keys.

If storing tokens is necessary:

- encrypt,
- limit access,
- rotate,
- hash lookup tokens,
- expire,
- audit access,
- separate collection/role.

Never store master encryption keys in same DB that they protect.

---

## 40. Database Credentials In Kubernetes

Common setup:

```text
Secret -> env var -> Spring Boot config
```

Risks:

- env vars visible in process dumps/diagnostics,
- Kubernetes Secret base64 is not encryption by itself,
- too many service accounts can read secrets,
- logs can print config,
- secret rotation needs restart/reload.

Better:

- external secret manager,
- least privilege Kubernetes RBAC,
- mounted files with restricted perms where appropriate,
- short-lived workload identity if available,
- automated rotation.

---

## 41. Secure Java Configuration

Example Spring Boot config style:

```yaml
spring:
  data:
    mongodb:
      uri: ${MONGODB_URI}
```

Ensure:

- `MONGODB_URI` comes from secret manager,
- URI includes TLS where needed,
- authSource correct,
- database user least privilege,
- no URI logging,
- separate credentials per environment,
- test/prod separated.

For custom client:

```java
ConnectionString connectionString = new ConnectionString(mongoUri);

MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(connectionString)
    .applyToSslSettings(builder -> builder.enabled(true))
    .applicationName("case-service")
    .build();

MongoClient client = MongoClients.create(settings);
```

Do not implement insecure trust manager.

---

## 42. Application Name

Set application name in MongoDB connection settings.

Why:

```text
observability
audit correlation
connection attribution
query diagnostics
incident response
```

Example:

```java
MongoClientSettings.builder()
    .applicationName("case-service-prod")
```

This helps distinguish services.

---

## 43. Separate Credentials Per Service

Example services:

```text
case-command-service
case-query-service
reporting-service
outbox-worker
migration-runner
retention-worker
support-tool
```

Each should have separate DB user/identity.

Benefits:

- least privilege,
- rotation per service,
- audit attribution,
- revoke compromised service only,
- observe usage patterns.

---

## 44. Migration Credentials

Migration tool often needs elevated privileges.

Do not run application all the time with migration privileges.

Pattern:

```text
runtime app user:
  normal CRUD only

migration user:
  createIndex, collMod, backfill writes as needed
  used only in deployment pipeline
  short-lived if possible
```

Migration logs must be audited.

---

## 45. Index Creation Security

Auto-index creation by application is convenient in dev.

In production, consider controlled index migration.

Risks of runtime auto-index:

- app startup unexpectedly creates heavy index,
- performance impact,
- privilege too broad,
- uncontrolled schema drift.

Production pattern:

```text
index definitions reviewed
applied by migration pipeline
observed during build
runtime app lacks createIndex/dropIndex unless required
```

---

## 46. Injection-Like Risks In MongoDB Queries

MongoDB does not use SQL, but unsafe query construction can still be dangerous.

Example:

```json
{
  "username": { "$ne": null },
  "password": { "$ne": null }
}
```

If raw JSON filter from user is accepted, operators can change semantics.

Bad API:

```text
POST /cases/search
body = arbitrary MongoDB query
```

Risks:

- bypass filters,
- expensive queries,
- tenant leakage,
- operator injection,
- regex DoS,
- projection of sensitive fields.

Better:

- typed filter DTO,
- allowlist fields,
- allowlist operators,
- mandatory tenant/auth filter,
- max limits,
- reject unknown fields,
- no raw Mongo operators from client.

---

## 47. Regex and ReDoS-Like Query Abuse

User-controlled regex can cause expensive queries.

Rules:

```text
no arbitrary regex on large collections
limit length
escape input by default
prefer prefix search/search index
time-box query
require tenant filter
rate limit
```

For search, use purpose-built search feature/index.

---

## 48. Projection Abuse

If API lets user choose fields:

```text
fields=*
include=sensitiveDetails
```

risk data leak.

Use projection allowlists per role.

Example:

```java
AllowedProjection projection = projectionPolicy.forUser(ctx, "CASE_LIST");
```

Do not expose raw MongoDB projection to client.

---

## 49. Sort/Filter Abuse As Security Availability Risk

Broad query can be denial-of-service.

Guardrails:

- allowed filters,
- allowed sorts,
- max page size,
- time range cap,
- async export,
- query timeout/deadline,
- rate limit,
- tenant quota.

Availability is part of security.

---

## 50. Data Minimization

Do not store data just because document database makes it easy.

Ask:

```text
Do we need this field?
For how long?
Who can see it?
Is it required for audit?
Can it be tokenized?
Can it be summarized?
Can it be stored in separate restricted collection?
```

Flexible schema can become flexible over-collection.

Regulated systems should practice data minimization.

---

## 51. Secure Attachment Metadata

Many MongoDB systems store metadata in MongoDB and binary files elsewhere.

Attachment metadata may include sensitive fields:

```text
fileName
mimeType
uploadedBy
documentType
classification
storageKey
checksum
virusScanStatus
legalHold
```

Do not expose storage key directly if it grants access.

Use signed URLs or proxy with authorization.

Storage system must align with tenant, region, retention, encryption, and audit.

---

## 52. Secure Outbox

Outbox payload can leak sensitive data.

Bad:

```javascript
{
  eventType: "CASE_UPDATED",
  payload: fullCaseDocument
}
```

Better:

```javascript
{
  eventType: "CASE_ESCALATED",
  payload: {
    tenantId,
    caseId,
    transitionId,
    status
  }
}
```

Downstream service fetches details if authorized.

Outbox is often copied to Kafka/logs/third-party systems; minimize payload.

---

## 53. Secure Change Streams

Change streams may expose full document/update data depending configuration.

Consumers must be authorized and trusted.

Risks:

- projection worker sees all tenant data,
- logs full change event,
- downstream index contains sensitive fields,
- resume token storage not protected,
- change event sent to broad messaging topic.

Design:

- separate consumers by purpose,
- minimize full document lookup,
- protect resume tokens,
- sanitize logs,
- enforce tenant handling downstream.

---

## 54. Security In Test Data

Do not use real PII in tests.

Use:

- synthetic data,
- anonymized production snapshots,
- masking pipeline,
- fake IDs,
- fake names,
- no real secrets.

If production data is used for debugging, require approval, audit, restricted environment, and cleanup.

---

## 55. Vulnerability and Patch Management

Database security includes version management.

Process:

```text
track MongoDB server version
track Java driver version
track Spring Data MongoDB version
track CVEs/security advisories
test upgrades
patch regularly
remove unsupported versions
```

Do not leave database/driver versions stale because “it works”.

---

## 56. Secure Defaults Checklist

Baseline for production:

```text
[ ] authentication enabled
[ ] no default/admin shared app user
[ ] RBAC least privilege
[ ] TLS enabled
[ ] DB not publicly exposed
[ ] secrets in secret manager
[ ] credential rotation plan
[ ] app name set in driver
[ ] logs sanitize connection strings and documents
[ ] tenant guardrails tested
[ ] sensitive fields classified
[ ] backup encrypted and access-controlled
[ ] support access audited
[ ] export controlled
[ ] audit log append-only
[ ] production data not copied freely to dev
[ ] migration privileges separated
```

---

## 57. Security Review: Repository Layer

Ask:

```text
[ ] Does every tenant-owned query include tenantId?
[ ] Does authorization filter apply before fetch?
[ ] Are projections role-specific?
[ ] Can client inject raw query operators?
[ ] Are regex/search inputs controlled?
[ ] Is max limit enforced?
[ ] Are sensitive fields excluded by default?
[ ] Are repository methods named by use case?
[ ] Are aggregation lookups tenant-safe?
[ ] Are writes guarded by tenant and version/state when needed?
```

---

## 58. Security Review: Data Model

Ask:

```text
[ ] Which fields are PII?
[ ] Which fields are confidential?
[ ] Which fields are audit/legal records?
[ ] Which fields require encryption?
[ ] Which fields appear in search index?
[ ] Which fields appear in logs/events/outbox?
[ ] Which fields need retention/legal hold?
[ ] Can sensitive fields be separated?
[ ] Is redaction possible without fetching full data?
[ ] Is document over-collecting?
```

---

## 59. Security Review: Operations

Ask:

```text
[ ] Who can access production DB?
[ ] Is access approved/time-bound?
[ ] Are admin actions audited?
[ ] Are backups encrypted?
[ ] Can backup be restored securely?
[ ] Are lower environments protected from prod data leaks?
[ ] Are credentials rotated?
[ ] Are certs monitored for expiry?
[ ] Are migration jobs reviewed?
[ ] Are exports approved and expiring?
[ ] Are support tools tenant-scoped?
```

---

## 60. Security Review: Java Runtime

Ask:

```text
[ ] Does app use least-privileged DB user?
[ ] Is Mongo URI sanitized in logs?
[ ] Is TLS enabled?
[ ] Are invalid certs disallowed?
[ ] Are timeouts bounded?
[ ] Is applicationName set?
[ ] Are retries idempotent?
[ ] Are errors sanitized?
[ ] Are dependencies patched?
[ ] Are secrets loaded securely?
[ ] Are metrics safe from PII?
```

---

## 61. Incident Scenarios

### 61.1 Credential Leaked

Response:

```text
revoke credential
rotate secret
deploy new credential
audit access by credential
check unusual queries
check exports/backups
notify according to policy
```

Mitigation if designed well:

- unique service credential,
- least privilege,
- logs show applicationName/source,
- rotation automated.

### 61.2 Tenant Data Leak

Response:

```text
identify affected tenant/data
stop leak
preserve logs
audit access
determine root cause
notify legal/compliance
patch guardrail
add regression test
review similar queries
```

### 61.3 Support Misuse

Response:

```text
disable access
review audit log
investigate scope
tighten approval
notify as required
```

### 61.4 Backup Exposed

Response:

```text
revoke access
rotate encryption keys if needed
determine downloaded data
audit bucket/object access
legal notification
improve backup controls
```

---

## 62. Practical Exercise

Design security architecture for a MongoDB-backed regulatory case platform.

Requirements:

```text
- multi-tenant
- case data contains PII and confidential allegations
- audit trail must be defensible
- support access must be approved and audited
- EU tenant data must remain in EU
- application runs in Kubernetes
- services include case-command, case-query, reporting, retention-worker, outbox-worker
- users authenticate via corporate IdP
- some fields need equality search but should not be plaintext
- exports are allowed but must be controlled
```

Answer:

1. authentication mechanism for services,
2. DB users/roles per service,
3. TLS/network controls,
4. secrets management,
5. tenant/authorization query guardrails,
6. field sensitivity classification,
7. encryption strategy,
8. hash/token strategy for equality search,
9. audit event model,
10. support access workflow,
11. export security,
12. backup/restore security,
13. logging redaction rules,
14. incident response playbook.

Suggested direction:

```text
services:
  unique workload identity or unique DB credentials per service

roles:
  case-command can update cases/insert audit/outbox
  case-query read limited collections
  reporting read reporting projections only
  retention-worker controlled delete/archive privileges
  migration-runner separate elevated credential

security:
  TLS, private network, no public DB
  secrets from secret manager
  no raw URI logs

data:
  classify PII/confidential/audit
  encrypt high-sensitive fields
  HMAC normalized identifiers for equality search
  separate sensitive collections where useful

audit:
  append-only audit events with user, commandId, before/after, reason
  support/export/deletion audited

operations:
  encrypted backups
  restore approval
  lower env anonymization
  export manifests and expiry
```

---

## 63. Senior-Level Heuristics

```text
If runtime app uses admin DB user, security boundary is weak.

If tenant filter is optional, data isolation is fragile.

If API returns full document and frontend hides fields, redaction is broken.

If connection string can appear in logs, credential leakage is likely.

If support accesses DB directly, auditability is incomplete.

If backup is less protected than database, backup is the weakest link.

If search index contains PII, treat search as sensitive storage.

If outbox contains full payload, downstream leakage risk increases.

If encryption keys live with encrypted data, encryption value is reduced.

If audit can be updated/deleted by normal app user, audit integrity is weak.

If production data is copied to dev freely, all production controls are bypassed.
```

---

## 64. Summary

MongoDB security is a layered architecture problem.

Key lessons:

1. Authentication identifies database clients; application still identifies end users.
2. RBAC should be least-privilege per service/workload.
3. Runtime application should not use admin credentials.
4. TLS and private networking are production baselines.
5. Secrets must be managed, rotated, and never logged.
6. Field sensitivity classification drives encryption, redaction, logging, retention, and search policy.
7. Encryption at rest, TLS, and client-side encryption solve different problems.
8. Queryable/encrypted fields require careful query design.
9. Backend must enforce redaction; frontend masking is insufficient.
10. Logs, outbox, search, backups, and exports are common leak paths.
11. Audit logging must capture business actor/action/reason, not just DB user.
12. Support access must be approved, scoped, time-bound, and audited.
13. Backup/restore security is part of data protection.
14. Query guardrails prevent both data leaks and availability abuse.
15. Security review must cover repository layer, data model, operations, and Java runtime.

The most important sentence:

> A secure MongoDB system is not created by one setting; it is created by aligning identity, privilege, network, encryption, data modelling, query guardrails, audit, and operations around explicit security invariants.

---

## 65. Bridge to Part 024

Part 024 will focus on:

- change streams,
- oplog-derived observation,
- insert/update/delete event shape,
- full document lookup,
- resume token,
- idempotent consumers,
- ordering limitations,
- backpressure,
- change stream vs outbox,
- change stream vs Kafka topic,
- cache invalidation,
- search indexing,
- read model update,
- audit enrichment,
- Java implementation pattern,
- production failure handling.

Nama file berikutnya:

```text
learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-024.md
```

Judul berikutnya:

```text
Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka
```

---

## 66. Status Seri

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
```

Seri belum selesai. Masih lanjut ke Part 024 sampai Part 035.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Multi-Tenancy, Data Isolation, and Regulatory Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-document-oriented-database-and-mongodb-mastery-for-java-engineers-part-024.md">Part 024 — Change Streams and Event-Driven Integration Without Confusing MongoDB with Kafka ➡️</a>
</div>

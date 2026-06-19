# learn-aws-cloud-architecture-mastery-for-java-engineers-part-027.md

# Part 027 — Multi-Tenant SaaS on AWS: Tenant Isolation, Account Strategy, Data Partitioning, dan Noisy Neighbor Control

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain, membangun, mengoperasikan, dan mempertanggungjawabkan arsitektur SaaS multi-tenant di AWS.  
> Fokus part ini: multi-tenancy sebagai sistem isolasi, operability, cost, dan governance; bukan sekadar menambahkan kolom `tenant_id`.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membahas fondasi AWS: account, IAM, networking, compute, storage, data, event integration, workflow, security, observability, reliability, performance, cost, IaC, deployment, configuration, API, dan governance.

Part ini menggabungkan banyak topik tersebut ke satu desain yang lebih realistis: **SaaS multi-tenant**.

SaaS multi-tenant bukan hanya pertanyaan:

> “Satu database dipakai banyak customer atau satu database per customer?”

Pertanyaan yang lebih tepat:

> “Bagaimana setiap tenant mendapat pengalaman yang aman, predictable, observable, auditable, billable, dan recoverable, sambil platform tetap efisien secara operasional dan biaya?”

Di AWS, tenant isolation adalah topik fundamental dalam desain SaaS. AWS SaaS Architecture Fundamentals mendefinisikan tenant isolation sebagai penggunaan tenant context untuk membatasi resource yang dapat diakses oleh tenant tertentu. Artinya, isolation bukan otomatis berarti semua resource harus dedicated; isolation adalah **kontrol akses berbasis tenant context** yang berlaku di semua layer.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, Anda diharapkan mampu:

1. Membedakan **tenant**, **user**, **account**, **workspace**, **organization**, **environment**, dan **deployment unit**.
2. Memahami silo, pool, dan bridge model dalam SaaS architecture.
3. Mendesain tenant isolation pada layer identity, compute, data, storage, messaging, encryption, observability, dan cost.
4. Menentukan kapan harus memakai account-per-tenant, VPC-per-tenant, database-per-tenant, schema-per-tenant, table-per-tenant, atau partition-key-per-tenant.
5. Mendesain data partitioning dengan `tenant_id` secara aman, bukan sekadar “query pakai WHERE tenant_id”.
6. Mengelola noisy neighbor dari sisi compute, database, queue, cache, rate limit, dan quota.
7. Membuat tenant-aware observability dan audit trail.
8. Merancang onboarding, offboarding, tenant migration, dan tenant tiering.
9. Menyusun ADR untuk multi-tenant architecture.
10. Mengidentifikasi failure mode kritis dalam sistem SaaS multi-tenant.

---

## 2. Mental Model: Multi-Tenancy adalah Controlled Sharing

Multi-tenancy berarti beberapa tenant menggunakan satu platform yang sama dengan tingkat sharing tertentu.

Tetapi “sharing” memiliki banyak bentuk:

- shared application code;
- shared runtime;
- shared database engine;
- shared table;
- shared queue;
- shared cache;
- shared account;
- shared network;
- shared logging pipeline;
- shared IAM role;
- shared encryption key;
- shared deployment pipeline;
- shared operational team;
- shared cost center.

Top engineer tidak bertanya:

> “Apakah sistem ini multi-tenant?”

Mereka bertanya:

> “Layer mana yang shared, layer mana yang silo, dan kontrol apa yang memastikan sharing itu aman?”

Multi-tenancy adalah **controlled sharing**.

Jika sharing tidak dikontrol, hasilnya:

- data leak;
- noisy neighbor;
- tenant starvation;
- audit ambiguity;
- cost attribution failure;
- support confusion;
- recovery yang terlalu luas;
- compliance breach.

---

## 3. Definisi Penting

### 3.1 Tenant

Tenant adalah boundary komersial/organisasional yang menerima layanan SaaS.

Contoh tenant:

- satu perusahaan customer;
- satu regulator agency;
- satu business unit customer;
- satu partner organization;
- satu workspace enterprise;
- satu government department.

Tenant **bukan selalu user**.

Satu tenant biasanya punya banyak user.

```text
Tenant A
├── User A1
├── User A2
└── User A3

Tenant B
├── User B1
└── User B2
```

### 3.2 User

User adalah actor manusia atau machine identity yang beroperasi dalam konteks tenant.

User identity menjawab:

> “Siapa yang melakukan action?”

Tenant context menjawab:

> “Atas nama tenant mana action ini dilakukan?”

Keduanya berbeda.

Contoh:

```text
user_id   = 7812
email     = investigator@agency-a.gov
tenant_id = agency-a
role      = case-investigator
```

### 3.3 Tenant Context

Tenant context adalah data runtime yang menentukan tenant aktif untuk request/event/workflow.

Tenant context bisa berasal dari:

- JWT claim;
- API key mapping;
- mTLS client certificate;
- subdomain;
- path prefix;
- request header dari trusted gateway;
- queue message metadata;
- event envelope;
- workflow input;
- database session context.

Tenant context harus dianggap **security-critical input**.

Jangan percaya `tenant_id` dari request body publik tanpa validasi terhadap identity.

### 3.4 Deployment Unit

Deployment unit adalah unit aplikasi/infrastruktur yang bisa dideploy, di-scale, dan dioperasikan secara independen.

Contoh:

- satu ECS service shared untuk semua tenant;
- satu ECS service per tenant;
- satu Lambda function shared;
- satu stack CloudFormation per tenant;
- satu AWS account per tenant.

Tenant tidak harus sama dengan deployment unit.

### 3.5 Isolation Boundary

Isolation boundary adalah batas yang mencegah tenant mempengaruhi atau mengakses tenant lain.

Boundary bisa berupa:

- IAM policy;
- AWS account;
- VPC;
- subnet;
- security group;
- database instance;
- database schema;
- partition key;
- KMS key;
- SQS queue;
- rate limiter;
- quota;
- worker pool;
- cache namespace;
- log group;
- OpenSearch index;
- S3 prefix/bucket;
- service deployment.

Tidak semua boundary memiliki kekuatan yang sama.

---

## 4. SaaS Model: Silo, Pool, dan Bridge

AWS SaaS Lens membahas tiga model umum: **silo**, **pool**, dan **bridge**.

### 4.1 Silo Model

Pada silo model, tenant mendapatkan resource dedicated.

Contoh:

```text
Tenant A
├── ECS Service A
├── RDS Database A
├── S3 Bucket A
└── KMS Key A

Tenant B
├── ECS Service B
├── RDS Database B
├── S3 Bucket B
└── KMS Key B
```

Kelebihan:

- isolation kuat;
- noisy neighbor lebih mudah dikendalikan;
- compliance lebih mudah dijelaskan;
- backup/restore per tenant lebih sederhana;
- tenant-specific customization lebih mudah;
- blast radius lebih kecil.

Kekurangan:

- biaya lebih tinggi;
- provisioning lebih kompleks;
- operasi lebih berat;
- upgrade massal lebih sulit;
- observability perlu agregasi lintas tenant;
- capacity utilization sering rendah.

Silo cocok untuk:

- enterprise/high-value tenant;
- tenant regulated;
- tenant dengan data residency ketat;
- tenant dengan traffic sangat besar;
- tenant yang butuh dedicated encryption boundary;
- tenant yang punya custom deployment schedule.

### 4.2 Pool Model

Pada pool model, tenant berbagi resource.

Contoh:

```text
Shared Platform
├── ECS Service shared
├── RDS shared database
├── S3 shared bucket
├── SQS shared queue
└── KMS shared key

Data dibedakan oleh tenant_id.
```

Kelebihan:

- cost efficiency tinggi;
- operasional lebih sederhana;
- deployment lebih mudah;
- scaling agregat lebih efisien;
- onboarding tenant cepat.

Kekurangan:

- isolation lebih kompleks;
- risk data leak lebih tinggi jika aplikasi salah;
- noisy neighbor lebih sulit;
- restore per tenant lebih rumit;
- cost attribution lebih sulit;
- tenant-specific customization lebih sulit.

Pool cocok untuk:

- small/medium tenants;
- freemium/self-service SaaS;
- tenant dengan beban ringan;
- workload yang butuh efisiensi biaya tinggi;
- produk standar dengan customization rendah.

### 4.3 Bridge Model

Bridge model menggabungkan silo dan pool.

Contoh:

```text
Shared Layer
├── API Gateway
├── Auth Service
├── Shared Web/API Layer
└── Shared Observability

Dedicated/Pooled by capability
├── Tenant A dedicated database
├── Tenant B dedicated database
├── Shared notification service
└── Shared reporting pipeline
```

Bridge model sering paling realistis.

Jarang ada sistem SaaS matang yang 100% pool atau 100% silo di semua layer.

Contoh bridge:

- compute shared, database dedicated;
- API shared, queue per tenant;
- database shared, KMS key per tenant;
- workflow shared, storage bucket per tenant;
- core platform pooled, regulated tenant siloed;
- free tier pooled, enterprise tier siloed.

Bridge cocok ketika:

- tenant memiliki kebutuhan isolation berbeda;
- beberapa layer bottleneck sedangkan layer lain aman dishare;
- tenant tier mempengaruhi SLA;
- cost dan compliance harus diseimbangkan.

---

## 5. Kesalahan Umum: Multi-Tenant Disamakan dengan `tenant_id`

Banyak sistem menganggap cukup menambahkan kolom:

```sql
tenant_id VARCHAR NOT NULL
```

Lalu semua query memakai:

```sql
WHERE tenant_id = ?
```

Ini perlu, tetapi tidak cukup.

Masalahnya:

1. Satu query lupa `tenant_id` bisa membocorkan data.
2. Background job mungkin tidak punya tenant context yang benar.
3. Admin support tool sering melewati filter normal.
4. Report query sering melakukan join kompleks dan lupa tenant boundary.
5. Cache key bisa tidak mengandung tenant id.
6. Search index bisa mencampur document tenant.
7. S3 object key bisa guessable.
8. Event/message bisa kehilangan tenant context.
9. Audit log bisa tidak tenant-aware.
10. Data restore per tenant sulit.

Multi-tenancy harus dirancang end-to-end.

Invariant yang lebih kuat:

> Setiap data access, side effect, event, log, metric, trace, cache entry, object, workflow execution, dan background job harus memiliki tenant context eksplisit atau berada dalam resource yang dedicated untuk tenant tersebut.

---

## 6. Tenant Context Propagation

Tenant context tidak boleh hanya hidup di HTTP controller.

Ia harus mengalir ke semua layer:

```text
HTTP Request
  ↓
Auth Gateway / API Gateway / ALB
  ↓
Application Filter / Middleware
  ↓
Service Layer
  ↓
Repository / Data Access
  ↓
Outbox Event
  ↓
SQS / EventBridge / Kinesis
  ↓
Worker / Lambda / Step Functions
  ↓
Downstream Write / Audit Log / Metric / Trace
```

### 6.1 Tenant Context dalam HTTP

Contoh sumber tenant context:

- `tenant_id` claim dalam JWT;
- subdomain: `tenant-a.example.com`;
- path: `/tenants/{tenantId}/cases`;
- API key mapping;
- mutual TLS certificate mapping.

Prinsip:

- tenant context harus divalidasi terhadap identity;
- jangan membiarkan user memilih tenant arbitrary tanpa authorization;
- jangan percaya tenant header dari internet kecuali diset oleh trusted gateway;
- canonical tenant context harus dibuat sekali di boundary awal.

Contoh Java pseudo-code:

```java
public final class TenantContext {
    private final String tenantId;
    private final String userId;
    private final Set<String> roles;
    private final String requestId;

    public TenantContext(String tenantId, String userId, Set<String> roles, String requestId) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.userId = Objects.requireNonNull(userId);
        this.roles = Set.copyOf(roles);
        this.requestId = Objects.requireNonNull(requestId);
    }

    public String tenantId() { return tenantId; }
    public String userId() { return userId; }
    public Set<String> roles() { return roles; }
    public String requestId() { return requestId; }
}
```

### 6.2 Tenant Context dalam Event

Event harus membawa tenant metadata.

```json
{
  "event_id": "evt-8f36",
  "event_type": "case.escalated",
  "tenant_id": "agency-a",
  "actor_id": "user-123",
  "correlation_id": "req-789",
  "causation_id": "cmd-456",
  "occurred_at": "2026-06-20T10:12:00Z",
  "schema_version": 3,
  "payload": {
    "case_id": "case-001",
    "new_stage": "LEGAL_REVIEW"
  }
}
```

Tenant context tidak boleh hilang saat:

- event masuk queue;
- event diproses worker;
- retry terjadi;
- event direplay;
- workflow di-redrive;
- DLQ diproses ulang.

### 6.3 Tenant Context dalam Log dan Trace

Structured log minimal:

```json
{
  "timestamp": "2026-06-20T10:12:03Z",
  "level": "INFO",
  "service": "case-service",
  "tenant_id": "agency-a",
  "user_id": "user-123",
  "request_id": "req-789",
  "trace_id": "1-abc",
  "case_id": "case-001",
  "message": "Case escalated"
}
```

Tanpa tenant context di log, support dan audit multi-tenant akan menyakitkan.

---

## 7. Tenant Isolation Layer by Layer

### 7.1 Identity Isolation

Identity isolation menjawab:

> “Apakah actor ini boleh bertindak untuk tenant ini?”

Pattern umum:

1. User login melalui identity provider.
2. Token berisi `tenant_id`, `user_id`, role, scope.
3. API/service memvalidasi token.
4. Application authorization mengecek action terhadap tenant context.
5. Data access wajib menggunakan tenant context.

Contoh JWT claim:

```json
{
  "sub": "user-123",
  "tenant_id": "agency-a",
  "roles": ["case-investigator"],
  "scope": "case:read case:write"
}
```

Jika satu user bisa berada di banyak tenant, hindari ambiguous token.

Lebih aman:

- user memilih tenant aktif saat session dibuat;
- token issued untuk tenant aktif;
- switching tenant menghasilkan token/session baru;
- audit log mencatat tenant aktif.

### 7.2 Compute Isolation

Compute options:

| Model | Contoh | Isolation | Cost | Complexity |
|---|---|---:|---:|---:|
| Shared compute | satu ECS service untuk semua tenant | rendah-sedang | rendah | rendah |
| Tenant-aware pool | shared ECS dengan per-tenant rate limit | sedang | rendah-sedang | sedang |
| Service per tenant | ECS service per tenant | tinggi | tinggi | sedang-tinggi |
| Account per tenant | stack penuh per tenant | sangat tinggi | tinggi | tinggi |

Compute shared harus punya:

- tenant-aware rate limit;
- tenant-aware concurrency control;
- tenant-aware queue partitioning;
- per-tenant metric;
- noisy-neighbor alarm;
- safe memory/CPU isolation.

### 7.3 Network Isolation

Network isolation bisa dilakukan dengan:

- shared VPC;
- subnet per tier;
- security group per service;
- VPC per tenant;
- account/VPC per tenant;
- PrivateLink per tenant/partner;
- Transit Gateway untuk segmented networks.

Namun network isolation tidak cukup untuk data isolation.

Jika semua tenant mengakses satu API shared, network boundary tidak membedakan tenant. Tenant isolation tetap harus dilakukan di identity/application/data layer.

### 7.4 Data Isolation

Data isolation bisa dilakukan pada beberapa level:

| Level | Contoh | Isolation | Operability | Cost |
|---|---|---:|---:|---:|
| Database per tenant | RDS DB instance per tenant | sangat tinggi | berat | tinggi |
| Cluster per tenant | Aurora cluster per tenant | sangat tinggi | berat | tinggi |
| Schema per tenant | PostgreSQL schema per tenant | tinggi | sedang | sedang |
| Table per tenant | DynamoDB table per tenant | tinggi | sedang-berat | sedang-tinggi |
| Partition per tenant | `tenant_id` partition key | sedang | mudah | rendah |
| Row-level partition | shared table + tenant filter | sedang | mudah | rendah |

Tidak ada jawaban universal.

Keputusan tergantung:

- sensitivity data;
- compliance;
- tenant size;
- SLA;
- backup/restore requirement;
- query pattern;
- reporting requirement;
- cost target;
- operational maturity.

### 7.5 Storage Isolation

S3 pattern:

1. Bucket per tenant.
2. Prefix per tenant.
3. Shared bucket + object metadata tenant.
4. Dedicated account bucket.

Contoh key:

```text
s3://case-evidence-prod/tenant=agency-a/case=case-001/document=doc-789/original.pdf
```

Tetapi jangan hanya mengandalkan naming convention.

Tambahkan:

- IAM condition;
- bucket policy;
- KMS encryption context;
- object tagging;
- application authorization;
- presigned URL yang scoped;
- access log.

### 7.6 Messaging Isolation

Messaging options:

| Model | Contoh | Cocok untuk |
|---|---|---|
| Shared queue | `case-events-prod` | tenant kecil, throughput merata |
| Queue per tenant | `case-events-agency-a` | tenant besar/regulated |
| Queue per tier | `case-events-enterprise`, `case-events-standard` | tier-based SLA |
| FIFO group per tenant | `MessageGroupId = tenant_id` | ordering per tenant |
| Stream partition by tenant | Kinesis partition key = tenant_id | per-tenant ordering/lag visibility |

Risiko shared queue:

- tenant besar memenuhi queue;
- DLQ tercampur;
- replay memproses semua tenant;
- visibility timeout dan retry mempengaruhi global throughput;
- worker tidak adil.

Mitigasi:

- tenant-aware worker scheduling;
- per-tenant rate limit;
- queue per high-volume tenant;
- DLQ tagging;
- message attribute `tenant_id`;
- consumer metric per tenant.

### 7.7 Cache Isolation

Cache leak adalah failure mode yang sering diremehkan.

Buruk:

```text
cache key = case:123
```

Lebih aman:

```text
cache key = tenant:agency-a:case:123
```

Cache harus mempertimbangkan:

- tenant namespace;
- TTL;
- invalidation;
- per-tenant quota;
- memory eviction;
- hot key;
- PII leakage;
- serialization compatibility.

Jika Redis/ElastiCache shared, tenant besar bisa mengusir cache tenant lain.

Mitigasi:

- key namespace per tenant;
- max memory policy awareness;
- per-tenant cache budget;
- dedicated cache untuk tenant besar;
- cache metrics by tenant jika memungkinkan.

### 7.8 Search Isolation

Search engine multi-tenant bisa memakai:

- index per tenant;
- shared index dengan `tenant_id` filter;
- index per tier/domain;
- dedicated OpenSearch domain untuk enterprise tenant.

Shared index risk:

- query lupa filter tenant;
- analyzer/mapping change berdampak semua tenant;
- reindex global mahal;
- noisy neighbor query berat;
- snapshot/restore per tenant sulit.

Minimum requirement:

- semua query search wajib menambahkan tenant filter;
- application-level search gateway;
- jangan expose raw OpenSearch query langsung ke tenant;
- query budget;
- per-tenant audit.

### 7.9 Encryption Isolation

Encryption options:

1. Shared AWS managed key.
2. Shared customer-managed KMS key.
3. KMS key per tenant.
4. KMS key per tenant tier.
5. KMS key per data classification.

KMS key per tenant memberikan boundary kuat untuk:

- disable tenant access;
- crypto-shred offboarding;
- audit KMS use per tenant;
- compliance story.

Tetapi membawa cost/operational complexity:

- key lifecycle;
- grants;
- policy management;
- quota;
- rotation;
- disaster recovery;
- restore complexity.

---

## 8. Account Strategy untuk Multi-Tenant SaaS

### 8.1 Account-per-Environment

Minimum baseline:

```text
org-root
├── security
├── log-archive
├── shared-services
├── network
├── dev
├── staging
└── prod
```

Ini memisahkan environment, tetapi belum tenant.

### 8.2 Account-per-Tenant

```text
prod-tenants-ou
├── tenant-agency-a-prod
├── tenant-agency-b-prod
└── tenant-agency-c-prod
```

Kelebihan:

- blast radius kuat;
- IAM boundary kuat;
- billing attribution jelas;
- quota terpisah;
- audit lebih mudah;
- tenant-specific compliance lebih mudah;
- deletion/offboarding lebih eksplisit.

Kekurangan:

- account vending diperlukan;
- deployment automation lebih kompleks;
- observability aggregation wajib;
- shared services harus cross-account;
- upgrade orchestration lebih berat;
- terlalu mahal untuk small tenants.

### 8.3 Account-per-Tier

```text
prod-pooled-standard
prod-pooled-premium
prod-dedicated-enterprise-a
prod-dedicated-enterprise-b
```

Ini sering realistis.

Tenant kecil dipool.
Tenant besar/regulated disilo.

### 8.4 Shared Platform Account + Tenant Workload Account

```text
platform-prod
├── identity
├── billing
├── tenant catalog
├── control plane API
└── provisioning system

workload accounts
├── pooled-standard-prod
├── pooled-premium-prod
├── tenant-agency-a-prod
└── tenant-agency-b-prod
```

Pattern ini memisahkan:

- SaaS control plane;
- tenant data plane.

Control plane mengelola tenant, entitlement, provisioning, deployment, billing, dan metadata.

Data plane menjalankan workload tenant.

---

## 9. SaaS Control Plane vs Data Plane

### 9.1 SaaS Control Plane

Control plane SaaS menjawab:

- tenant mana yang ada;
- tier apa tenant tersebut;
- resource apa yang dialokasikan;
- region mana yang dipakai;
- fitur apa yang enabled;
- quota apa yang berlaku;
- billing plan apa yang digunakan;
- deployment version apa yang aktif;
- KMS key apa yang dipakai;
- data residency requirement;
- contact/support metadata;
- onboarding/offboarding state.

Contoh service control plane:

```text
Tenant Catalog Service
Provisioning Service
Entitlement Service
Billing/Usage Service
Identity Mapping Service
Deployment Orchestrator
Admin Console
```

### 9.2 SaaS Data Plane

Data plane menjalankan request tenant:

```text
API Service
Case Service
Document Service
Workflow Service
Notification Worker
Search Indexer
Reporting Pipeline
```

Control plane harus highly protected.

Jika control plane rusak, tenant provisioning, entitlement, dan routing bisa kacau.

### 9.3 Tenant Catalog

Tenant catalog adalah sumber kebenaran tentang tenant.

Contoh schema:

```json
{
  "tenant_id": "agency-a",
  "tenant_slug": "agency-a",
  "status": "ACTIVE",
  "tier": "ENTERPRISE",
  "deployment_model": "SILO",
  "home_region": "ap-southeast-1",
  "account_id": "123456789012",
  "data_residency": "SG",
  "kms_key_id": "arn:aws:kms:...",
  "rds_cluster_id": "agency-a-case-db",
  "s3_bucket": "case-evidence-agency-a-prod",
  "api_base_url": "https://agency-a.example.com",
  "quota": {
    "api_rps": 500,
    "max_cases": 1000000,
    "max_storage_gb": 2000
  }
}
```

Tenant catalog harus:

- versioned;
- auditable;
- protected with least privilege;
- replicated carefully;
- cached with clear invalidation semantics;
- available during request routing.

---

## 10. Tenant Onboarding Lifecycle

Tenant onboarding adalah state machine.

```text
REQUESTED
  ↓
VALIDATED
  ↓
PROVISIONING
  ↓
CONFIGURING_IDENTITY
  ↓
SEEDING_DATA
  ↓
RUNNING_SMOKE_TEST
  ↓
ACTIVE
```

Failure states:

```text
PROVISIONING_FAILED
IDENTITY_SETUP_FAILED
SEEDING_FAILED
VALIDATION_FAILED
ROLLBACK_REQUIRED
```

Onboarding steps:

1. Create tenant record in control plane.
2. Allocate tenant id.
3. Determine deployment model.
4. Provision account/resource if needed.
5. Create KMS key or grants if needed.
6. Create database partition/schema/database.
7. Create S3 prefix/bucket.
8. Configure identity provider mapping.
9. Configure quota/entitlement.
10. Configure observability labels.
11. Run smoke test.
12. Activate tenant.
13. Emit audit event.

### 10.1 Idempotent Provisioning

Provisioning must be idempotent.

If onboarding fails after creating S3 bucket but before creating database schema, retry should continue safely.

Bad:

```text
create everything blindly
```

Better:

```text
ensure tenant record exists
ensure account exists
ensure role exists
ensure bucket exists
ensure schema exists
ensure config exists
activate only after all checks pass
```

Use natural idempotency keys:

```text
tenant_id = agency-a
provisioning_execution_id = prov-20260620-0001
```

### 10.2 Step Functions for Onboarding

Step Functions fits tenant onboarding because:

- onboarding is long-running;
- each step can retry independently;
- failures need audit trail;
- human approval may be needed;
- compensation may be needed;
- execution history is useful for support/compliance.

---

## 11. Tenant Offboarding Lifecycle

Offboarding is harder than onboarding.

State machine:

```text
ACTIVE
  ↓
SUSPENSION_REQUESTED
  ↓
SUSPENDED
  ↓
EXPORT_PENDING
  ↓
RETENTION_HOLD
  ↓
DELETION_SCHEDULED
  ↓
DELETED
```

Consider:

- legal hold;
- data export;
- billing closure;
- retention policy;
- audit trail retention;
- KMS key deletion schedule;
- backup deletion;
- search index deletion;
- cache invalidation;
- DLQ cleanup;
- object lifecycle;
- user access revocation.

Do not immediately delete tenant data just because subscription ended.

Regulated systems often require retention.

### 11.1 Crypto-Shredding

If tenant has dedicated KMS key, disabling/deleting the key can make encrypted data inaccessible.

But treat this carefully:

- KMS key deletion has waiting period;
- backups may depend on the key;
- logs may reference data identifiers;
- legal hold may prevent deletion;
- accidental key deletion can be catastrophic.

Crypto-shredding is not a substitute for correct data deletion policy, but it can be part of defense-in-depth.

---

## 12. Tenant-Aware Data Design

### 12.1 Relational Shared Table

Example:

```sql
CREATE TABLE cases (
    tenant_id       VARCHAR(64) NOT NULL,
    case_id         UUID NOT NULL,
    case_number     VARCHAR(64) NOT NULL,
    status          VARCHAR(64) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    PRIMARY KEY (tenant_id, case_id)
);

CREATE UNIQUE INDEX ux_cases_tenant_case_number
ON cases (tenant_id, case_number);
```

Important:

- primary key includes tenant id;
- unique constraints include tenant id;
- indexes match tenant-scoped query;
- no global uniqueness unless intended;
- FK design includes tenant id;
- report query must preserve tenant boundary.

Bad unique constraint:

```sql
UNIQUE (case_number)
```

This incorrectly makes case number globally unique across all tenants.

Better:

```sql
UNIQUE (tenant_id, case_number)
```

### 12.2 Foreign Key with Tenant Boundary

```sql
CREATE TABLE case_documents (
    tenant_id   VARCHAR(64) NOT NULL,
    case_id     UUID NOT NULL,
    document_id UUID NOT NULL,
    PRIMARY KEY (tenant_id, case_id, document_id),
    FOREIGN KEY (tenant_id, case_id)
      REFERENCES cases (tenant_id, case_id)
);
```

This prevents accidentally linking document from tenant A to case from tenant B.

### 12.3 Repository Boundary in Java

Bad repository:

```java
Optional<Case> findById(UUID caseId);
```

Better:

```java
Optional<Case> findByTenantIdAndCaseId(String tenantId, UUID caseId);
```

Even better: tenant context is required by type.

```java
public interface CaseRepository {
    Optional<Case> findById(TenantContext tenant, CaseId caseId);
    List<Case> findOpenCases(TenantContext tenant, PageRequest page);
    void save(TenantContext tenant, Case caseData);
}
```

Make tenant omission impossible or highly visible.

### 12.4 Row-Level Security

For PostgreSQL/Aurora PostgreSQL, row-level security can add a database-level guardrail.

But RLS is not magic:

- connection pooling must set tenant session variable correctly;
- migration/admin jobs must be careful;
- bypass roles are dangerous;
- debugging becomes harder;
- performance must be tested.

Application-level tenant checks are still needed.

### 12.5 DynamoDB Tenant Key Design

Pooled table:

```text
PK = TENANT#agency-a
SK = CASE#case-001
```

Or if tenant has high cardinality per entity:

```text
PK = TENANT#agency-a#CASE#case-001
SK = METADATA
```

Potential issue:

- one huge tenant can become hot;
- partition strategy must consider tenant size;
- adaptive capacity helps but does not fix bad design for extreme hot keys.

For high-volume tenant, consider:

```text
PK = TENANT#agency-a#SHARD#07
SK = CASE#case-001
```

But write sharding complicates query.

### 12.6 S3 Tenant Object Design

Example:

```text
s3://evidence-prod/tenant_id=agency-a/case_id=case-001/document_id=doc-001/original.pdf
```

Metadata:

```json
{
  "tenant_id": "agency-a",
  "case_id": "case-001",
  "document_id": "doc-001",
  "classification": "CONFIDENTIAL",
  "retention_until": "2033-01-01"
}
```

S3 access should not rely only on application convention.

Use:

- IAM scoped to prefix where possible;
- bucket policy;
- KMS key policy;
- object tags;
- presigned URL generated only after authorization;
- CloudTrail data events for sensitive buckets if required.

---

## 13. Noisy Neighbor Control

AWS SaaS Lens describes noisy neighbor as the situation where one user/tenant puts load on shared resources and degrades the experience of another.

Noisy neighbor can happen at many layers.

### 13.1 Compute Noisy Neighbor

Symptoms:

- tenant A sends burst requests;
- shared ECS service scales but too late;
- CPU/memory consumed by tenant A;
- tenant B latency increases.

Controls:

- per-tenant rate limit;
- per-tenant concurrency limit;
- tenant-aware work queue;
- separate worker pool for enterprise tenants;
- autoscaling on backlog and latency;
- tenant tier routing;
- circuit breaker per tenant.

### 13.2 Database Noisy Neighbor

Symptoms:

- tenant A runs expensive reports;
- shared DB CPU spikes;
- locks affect other tenants;
- connection pool exhausted;
- slow queries degrade all tenants.

Controls:

- query governor;
- read replica for reporting;
- async export instead of synchronous report;
- tenant-specific connection pool limit;
- dedicated database for high-volume tenant;
- index per common tenant-scoped query;
- workload isolation.

### 13.3 Queue Noisy Neighbor

Symptoms:

- tenant A produces millions of messages;
- shared queue backlog grows;
- tenant B messages wait behind tenant A;
- DLQ contains mixed tenant failures.

Controls:

- queue per tier;
- queue per high-volume tenant;
- fair scheduling;
- FIFO message group per tenant when ordering needed;
- event attribute `tenant_id`;
- per-tenant backlog metrics;
- redrive by tenant.

### 13.4 Cache Noisy Neighbor

Symptoms:

- tenant A fills cache;
- tenant B hot keys evicted;
- cache miss spikes DB load;
- global latency worsens.

Controls:

- key namespace;
- per-tenant cache budget;
- dedicated cache for high-value tenants;
- TTL tuning;
- fallback protection;
- cache metrics.

### 13.5 Observability Noisy Neighbor

Symptoms:

- tenant A generates massive logs;
- CloudWatch ingestion cost spikes;
- log query becomes slow;
- important logs drowned.

Controls:

- log sampling by tenant/tier;
- redaction;
- per-tenant log volume metrics;
- log retention by classification;
- high-value audit logs separated from debug logs.

---

## 14. Tenant-Aware Rate Limiting

Rate limiting must understand tenant, not just IP.

Potential dimensions:

- tenant id;
- user id;
- API key;
- endpoint/action;
- tier;
- region;
- operation cost;
- burst vs sustained rate.

Example limit table:

| Tier | API RPS | Concurrent workflows | Export jobs | Storage |
|---|---:|---:|---:|---:|
| Free | 5 | 2 | 1 | 5 GB |
| Standard | 50 | 10 | 5 | 100 GB |
| Enterprise | 500 | 100 | 50 | custom |

Rate limit failure should be explicit:

```json
{
  "error": "tenant_rate_limit_exceeded",
  "tenant_id": "agency-a",
  "limit": "api_rps",
  "retry_after_seconds": 10
}
```

Do not return misleading 500.

---

## 15. Tenant-Aware Observability

Every major metric should be sliceable by tenant or tenant tier.

But be careful: per-tenant metrics can create high cardinality.

Approach:

- per-tenant metrics for top N/high-value tenants;
- tier-level metrics for aggregate;
- sampled tenant metrics for long tail;
- logs contain tenant id for query;
- traces contain tenant id as attribute where safe;
- business KPIs aggregated by tenant.

### 15.1 Metrics

Useful metrics:

```text
api.requests.count by tenant_id/tier
api.errors.count by tenant_id/tier
api.latency.p95 by tenant_id/tier
workflow.execution.count by tenant_id/tier
workflow.failure.count by tenant_id/tier
queue.backlog by tenant_id/tier
storage.bytes by tenant_id
cost.estimated by tenant_id
rate_limit.rejected by tenant_id
```

### 15.2 Logs

Mandatory fields:

```text
tenant_id
user_id
request_id
trace_id
operation
resource_type
resource_id
outcome
error_code
```

### 15.3 Traces

Trace tags:

```text
tenant.id = agency-a
tenant.tier = enterprise
case.id = case-001
operation = escalate_case
```

Avoid putting sensitive tenant names or PII in trace fields if traces are shared broadly.

---

## 16. Tenant-Aware Audit Trail

For regulated SaaS, audit trail is not optional.

Audit event should answer:

- who acted;
- for which tenant;
- on what resource;
- what changed;
- when;
- from where;
- under what authorization;
- correlation/request id;
- old/new values where appropriate;
- system actor vs human actor;
- reason/justification where required.

Example audit event:

```json
{
  "audit_event_id": "aud-001",
  "tenant_id": "agency-a",
  "actor_type": "USER",
  "actor_id": "user-123",
  "actor_role": "case-supervisor",
  "action": "CASE_ESCALATED",
  "resource_type": "CASE",
  "resource_id": "case-001",
  "occurred_at": "2026-06-20T10:12:00Z",
  "source_ip": "203.0.113.10",
  "request_id": "req-789",
  "authorization_decision": "ALLOW",
  "reason_code": "HIGH_RISK_CASE",
  "before": {
    "stage": "INVESTIGATION"
  },
  "after": {
    "stage": "LEGAL_REVIEW"
  }
}
```

Audit logs should be:

- append-only;
- immutable where required;
- tenant-filterable;
- retained according to policy;
- protected from application admins where necessary;
- exportable for tenant audit requests.

---

## 17. Tenant-Aware Cost Allocation

SaaS profitability depends on cost attribution.

Cost allocation models:

1. Direct AWS tags where resource dedicated.
2. Usage metering where resource shared.
3. Approximation by request count/storage/compute time.
4. Tier-based allocation.
5. Hybrid model.

For dedicated resource:

```text
aws:tag/TenantId = agency-a
aws:tag/Environment = prod
aws:tag/CostCenter = enterprise-saas
```

For shared resource, AWS bill cannot automatically split by tenant.

You need application-level metering:

```json
{
  "tenant_id": "agency-a",
  "metric": "document_storage_gb_hours",
  "value": 123.4,
  "period": "2026-06",
  "source": "storage-meter"
}
```

Metering dimensions:

- API calls;
- workflow executions;
- documents processed;
- storage GB-month;
- data scanned;
- export jobs;
- AI/ML inference calls;
- queue messages;
- report generation time;
- support/admin operations.

Cost engineering warning:

> In pooled SaaS, if you cannot attribute cost per tenant, you cannot know which tenant is profitable.

---

## 18. Tenant Tiering

Tenant tiers map business plan to technical controls.

Example:

| Capability | Standard | Premium | Enterprise |
|---|---|---|---|
| Deployment | pooled | pooled + priority | silo/bridge |
| API quota | medium | high | custom |
| Data key | shared tier key | tenant key optional | tenant KMS key |
| Queue | shared | tier queue | dedicated queue |
| Support | standard | priority | dedicated SRE runbook |
| Restore | platform-level | tenant export | tenant-specific restore |
| Data residency | default | selected region | contractual |
| Observability | aggregate | tenant metrics | tenant dashboard |

Tiers should be enforceable by system, not just documented.

Entitlement service should answer:

```text
Is tenant agency-a allowed to use feature X?
What quota applies?
What deployment model applies?
What isolation mode applies?
```

---

## 19. Migration Between Isolation Models

Tenant may move:

- pooled → dedicated;
- dedicated → pooled;
- standard tier → enterprise tier;
- region A → region B;
- shared DB → tenant DB;
- shared queue → dedicated queue.

Plan for this early.

### 19.1 Pooled to Silo Migration

Steps:

1. Freeze tenant writes or enable dual-write carefully.
2. Export tenant data from pooled store.
3. Provision dedicated resources.
4. Import data.
5. Validate counts/checksums.
6. Replay missed events.
7. Switch routing in tenant catalog.
8. Monitor.
9. Decommission old tenant partition after retention.

Major risk:

- data divergence;
- event replay duplicate side effects;
- search index mismatch;
- object references wrong;
- cache stale;
- long-running workflow references old resource.

### 19.2 Tenant ID Immutability

Tenant ID should be immutable.

Tenant name/slug can change.

Bad:

```text
tenant_id = company-name
```

Better:

```text
tenant_id = tnt_01JZ...  // stable opaque id
tenant_slug = agency-a
```

Why:

- tenant name changes;
- mergers happen;
- branding changes;
- slugs can collide;
- URLs can be migrated;
- audit logs need stable identity.

---

## 20. Multi-Region Multi-Tenant Considerations

Multi-region SaaS adds complexity:

- tenant home region;
- data residency;
- control plane replication;
- tenant routing;
- per-region tenant catalog cache;
- cross-region backup;
- global identity;
- regional outage failover;
- latency vs compliance.

Tenant catalog must know:

```text
tenant_id -> home_region -> deployment endpoint -> data boundary
```

Example:

```json
{
  "tenant_id": "agency-a",
  "home_region": "ap-southeast-1",
  "failover_region": "ap-southeast-2",
  "data_residency": "APAC",
  "routing_policy": "home-region-only"
}
```

Do not implement active-active multi-region unless business requirements justify it.

Multi-region affects:

- consistency;
- identity session;
- audit ordering;
- workflow execution;
- KMS keys;
- S3 replication;
- database replication;
- cost;
- incident response.

---

## 21. Security Failure Modes in Multi-Tenant SaaS

### 21.1 Missing Tenant Filter

A repository method forgets `tenant_id`.

Impact:

- cross-tenant data leak.

Controls:

- tenant context required by API;
- DB composite keys;
- RLS where appropriate;
- integration tests;
- static analysis/conventions;
- code review checklist.

### 21.2 Cache Key Leak

Cache key omits tenant id.

Impact:

- tenant A receives tenant B data.

Controls:

- cache key builder requires tenant context;
- cache tests;
- prefix by tenant;
- do not handcraft keys everywhere.

### 21.3 Search Query Leak

Search query misses tenant filter.

Impact:

- search results include other tenant docs.

Controls:

- central search gateway;
- mandatory tenant filter injection;
- index-per-tenant for high-risk tenants;
- query tests.

### 21.4 Presigned URL Leak

Application generates URL for object without tenant authorization.

Impact:

- object exfiltration.

Controls:

- authorize before signing;
- short TTL;
- object key includes tenant;
- metadata validation;
- KMS policy;
- audit signed URL generation.

### 21.5 Admin Tool Bypass

Internal admin console lacks tenant boundary.

Impact:

- support user sees all data accidentally.

Controls:

- admin actions require selected tenant context;
- elevated access workflow;
- audit every admin read/write;
- break-glass approval;
- data minimization.

### 21.6 Background Job Without Tenant Context

Scheduled job processes data globally.

Impact:

- tenant mix-up;
- large blast radius;
- wrong notifications.

Controls:

- job iterates tenant catalog;
- each job execution scoped to one tenant or shard;
- tenant context in logs/events;
- checkpoint per tenant.

### 21.7 Tenant Deletion Incomplete

Offboarding deletes DB rows but leaves S3/search/cache/backups.

Impact:

- compliance violation;
- ghost data;
- billing confusion.

Controls:

- offboarding state machine;
- deletion inventory;
- retention policy;
- evidence of deletion;
- legal hold handling.

---

## 22. Reference Architecture: Regulated Case Management SaaS

### 22.1 Requirements

Platform:

- serves multiple regulatory agencies;
- each agency is a tenant;
- data includes sensitive case evidence;
- workflows are long-running;
- audit trail is mandatory;
- tenant-specific retention applies;
- enterprise tenants require stronger isolation;
- standard tenants require cost-efficient pooling.

### 22.2 Proposed Model

Use bridge model.

```text
Control Plane Account
├── Tenant Catalog
├── Entitlement Service
├── Provisioning Workflow
├── Billing/Metering
└── Admin Console

Shared Prod Account: Standard Tenants
├── API Gateway / ALB
├── ECS Services
├── Shared Aurora Cluster
├── Shared S3 Bucket with tenant prefixes
├── Shared SQS/EventBridge
├── Shared OpenSearch Index with tenant filter
└── Shared KMS key per classification/tier

Dedicated Tenant Accounts: Enterprise/Regulated
├── ECS Services or dedicated service namespace
├── Dedicated Aurora schema/cluster depending tier
├── Dedicated S3 bucket
├── Dedicated queues
├── Tenant KMS key
└── Tenant-specific dashboards

Security/Log Archive Accounts
├── Organization CloudTrail
├── Centralized logs
├── Security Hub
└── GuardDuty findings
```

### 22.3 Tenant Isolation Choices

| Layer | Standard Tenant | Enterprise Tenant |
|---|---|---|
| Account | pooled prod account | dedicated account |
| Compute | shared ECS services | dedicated ECS services or capacity |
| Database | shared Aurora with tenant id | dedicated schema/cluster |
| Storage | shared bucket prefix | dedicated bucket |
| KMS | shared key by tier/classification | tenant KMS key |
| Queue | shared/tier queue | dedicated queue |
| Search | shared index + tenant filter | index per tenant |
| Observability | aggregate + tenant logs | tenant dashboard |
| Cost | metered application usage | AWS tags + metering |
| Backup/restore | platform-level + tenant export | tenant-specific restore plan |

### 22.4 Case Escalation Flow

```text
1. User authenticates.
2. Token includes tenant context.
3. API receives request to escalate case.
4. Application authorizes user for tenant and case.
5. Case row updated with tenant-scoped optimistic locking.
6. Audit event written.
7. Outbox event created with tenant_id.
8. Event published to EventBridge/SQS.
9. Workflow service starts Step Functions execution with tenant context.
10. Notification worker sends tenant-scoped notification.
11. Metrics/logs/traces include tenant_id and correlation_id.
```

Invariant:

> No case action may execute without tenant context, actor context, resource id, authorization decision, and audit event.

---

## 23. Java Implementation Blueprint

### 23.1 Tenant Context Filter

```java
public final class TenantContextFilter implements Filter {
    private final TokenVerifier tokenVerifier;

    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        String token = extractBearerToken(request);
        VerifiedToken verified = tokenVerifier.verify(token);

        TenantContext context = new TenantContext(
                verified.tenantId(),
                verified.userId(),
                verified.roles(),
                getOrCreateRequestId(request)
        );

        TenantContextHolder.set(context);
        try {
            chain.doFilter(req, res);
        } finally {
            TenantContextHolder.clear();
        }
    }
}
```

Be careful with thread locals in async/reactive code.

In async systems, pass context explicitly or use framework-supported context propagation.

### 23.2 Repository Contract

```java
public final class CaseService {
    private final CaseRepository repository;
    private final AuthorizationService authorization;
    private final AuditPublisher audit;

    public void escalateCase(TenantContext tenant, CaseId caseId, EscalationReason reason) {
        authorization.require(tenant, "case:escalate", caseId);

        CaseRecord record = repository.findById(tenant, caseId)
                .orElseThrow(() -> new NotFoundException("case not found"));

        record.escalate(reason);
        repository.save(tenant, record);

        audit.publish(AuditEvent.caseEscalated(tenant, caseId, reason));
    }
}
```

Notice that `TenantContext` is explicit.

### 23.3 Cache Key Builder

```java
public final class CacheKeys {
    public static String caseById(TenantContext tenant, CaseId caseId) {
        return "tenant:" + tenant.tenantId() + ":case:" + caseId.value();
    }
}
```

Do not let each developer manually build cache keys.

### 23.4 Event Envelope

```java
public record DomainEventEnvelope<T>(
        String eventId,
        String eventType,
        String tenantId,
        String actorId,
        String correlationId,
        String causationId,
        Instant occurredAt,
        int schemaVersion,
        T payload
) {}
```

Every event should carry tenant context.

### 23.5 Tenant-Aware AWS SDK Usage

For pooled model, application identity may be shared but authorization is application-enforced.

For silo/dedicated model, tenant context may also map to AWS role/resource.

Example pattern:

```java
public S3Client s3ClientForTenant(TenantRuntime runtime) {
    if (runtime.requiresAssumeRole()) {
        AwsCredentialsProvider provider = StsAssumeRoleCredentialsProvider.builder()
                .refreshRequest(r -> r.roleArn(runtime.roleArn())
                        .roleSessionName("tenant-" + runtime.tenantId()))
                .stsClient(stsClient)
                .build();

        return S3Client.builder()
                .region(runtime.region())
                .credentialsProvider(provider)
                .build();
    }

    return sharedS3Client;
}
```

Do not create new SDK clients per request unless you know why.

Cache clients/providers carefully and respect credential refresh.

---

## 24. Testing Multi-Tenant Isolation

### 24.1 Unit Tests

Test repository requires tenant context.

```text
Given tenant A and tenant B both have case_id X
When tenant A requests case X
Then only tenant A data is returned
```

### 24.2 Integration Tests

Create two tenants with overlapping identifiers.

```text
Tenant A: case_number = 001
Tenant B: case_number = 001
```

Test:

- API read;
- API write;
- search;
- export;
- cache;
- background jobs;
- event processing;
- admin console;
- report generation.

### 24.3 Security Tests

Attempt:

- changing tenant id in path;
- changing tenant header;
- using token from tenant A on tenant B resource;
- replaying presigned URL;
- invoking admin API without tenant selection;
- querying report endpoint with global filters.

### 24.4 Chaos/Load Tests

Simulate tenant A overload.

Expected:

- tenant B remains within SLO;
- tenant A gets throttled/degraded;
- alarms fire with tenant id;
- backlog is visible per tenant;
- cost spike is attributable.

---

## 25. Operational Runbook: Tenant Incident

### Scenario: Tenant B sees data from Tenant A

Immediate actions:

1. Stop affected endpoint/feature if needed.
2. Identify tenant(s), user(s), request ids, time window.
3. Pull audit logs and access logs.
4. Identify data classes exposed.
5. Check cache/search/report/export layers.
6. Revoke active sessions if needed.
7. Disable presigned URLs if impacted.
8. Preserve evidence.
9. Notify internal security/compliance.
10. Follow contractual/regulatory notification process.
11. Patch root cause.
12. Add regression test.
13. Backfill audit evidence.
14. Write post-incident review.

### Scenario: Tenant A overload degrades Tenant B

Actions:

1. Identify bottleneck layer.
2. Apply tenant rate limit.
3. Move tenant A to dedicated queue/worker if possible.
4. Scale relevant resource.
5. Protect database from expensive queries.
6. Communicate tenant-specific degradation.
7. Update quota/tier configuration.
8. Add alarm for early detection.

---

## 26. ADR Template

```markdown
# ADR: Multi-Tenant Isolation Model for <Workload>

## Status
Proposed / Accepted / Deprecated

## Context
- Tenants:
- Data sensitivity:
- Regulatory constraints:
- Expected tenant count:
- Largest tenant traffic:
- Tenant tiering model:
- RTO/RPO:
- Data residency:

## Decision
We will use:
- Account model:
- Compute model:
- Database isolation model:
- Storage isolation model:
- Messaging isolation model:
- Search isolation model:
- KMS model:
- Observability model:
- Cost allocation model:

## Rationale
- Why not full silo:
- Why not full pool:
- Why bridge model if chosen:

## Invariants
- Every request must have tenant context.
- Every event must include tenant_id.
- Every repository method must require tenant context.
- Every cache key must include tenant namespace.
- Every audit event must include tenant_id and actor_id.
- Every tenant must have measurable usage.

## Failure Modes
- Missing tenant filter:
- Noisy neighbor:
- Tenant offboarding incomplete:
- Cross-tenant search result:
- Shared queue backlog:
- Cost attribution failure:

## Consequences
Positive:
- ...

Negative:
- ...

## Review Date
<date>
```

---

## 27. Production Checklist

### Tenant Context

- [ ] Tenant id is immutable.
- [ ] Tenant slug/name can change without breaking identity.
- [ ] Tenant context is validated at request boundary.
- [ ] Tenant context propagates to events, jobs, logs, traces, and audit.
- [ ] Background jobs are tenant-scoped or explicitly global.

### Identity and Authorization

- [ ] Token tenant claim is verified.
- [ ] User membership is checked.
- [ ] Admin tools require explicit tenant context.
- [ ] Break-glass access is audited.
- [ ] Cross-tenant support access is controlled.

### Data

- [ ] Primary keys/indexes include tenant where needed.
- [ ] Unique constraints are tenant-scoped.
- [ ] Repository methods require tenant context.
- [ ] Search queries enforce tenant filter.
- [ ] Cache keys include tenant namespace.
- [ ] Object storage keys/tags/policies are tenant-aware.

### Noisy Neighbor

- [ ] Per-tenant rate limits exist.
- [ ] Per-tenant metrics exist for high-value tenants.
- [ ] Queue backlog is visible by tenant/tier.
- [ ] Expensive reports are isolated or async.
- [ ] High-volume tenant migration path exists.

### Observability and Audit

- [ ] Logs include tenant id.
- [ ] Audit events include tenant id and actor id.
- [ ] Metrics can detect tenant-specific degradation.
- [ ] Traces can be correlated to tenant safely.
- [ ] Tenant incident runbook exists.

### Cost

- [ ] Dedicated resources are tagged.
- [ ] Shared resource usage is metered.
- [ ] Tenant profitability can be estimated.
- [ ] Tenant tier maps to technical quota.
- [ ] Cost anomaly can be traced to tenant/tier.

### Lifecycle

- [ ] Onboarding is idempotent.
- [ ] Offboarding handles retention and legal hold.
- [ ] Tenant export exists.
- [ ] Tenant deletion inventory exists.
- [ ] Tenant migration between tiers/models is planned.

---

## 28. Exercises

### Exercise 1 — Choose Isolation Model

Design tenant isolation for a SaaS with:

- 500 small tenants;
- 5 enterprise tenants;
- sensitive documents;
- strict audit trail;
- variable tenant traffic;
- APAC and EU data residency.

Produce:

- account model;
- compute model;
- database model;
- storage model;
- KMS model;
- observability model;
- migration path for tenant upgrade.

### Exercise 2 — Find Tenant Leak Risks

Review this pseudo-design:

```text
Shared API
Shared RDS table with tenant_id
Shared Redis cache
Shared OpenSearch index
Shared S3 bucket
Shared SQS queue
```

Find at least 15 tenant leak/noisy-neighbor risks.

### Exercise 3 — Design Tenant-Aware Event Envelope

Create event envelope for:

- case created;
- case escalated;
- document uploaded;
- workflow approved;
- tenant suspended.

Ensure each event supports:

- audit;
- replay;
- idempotency;
- tenant routing;
- schema evolution.

### Exercise 4 — Tenant Offboarding State Machine

Design a Step Functions state machine for tenant offboarding with:

- suspension;
- export;
- retention hold;
- deletion approval;
- data deletion;
- KMS key handling;
- audit evidence.

---

## 29. Key Takeaways

1. Multi-tenancy is controlled sharing, not just shared database tables.
2. Tenant isolation is enforced by tenant context across identity, application, data, storage, messaging, cache, search, encryption, logs, and cost.
3. Silo, pool, and bridge are not moral choices; they are trade-off models.
4. Bridge model is often the most realistic architecture for mature SaaS.
5. Tenant id must be immutable and propagated everywhere.
6. `tenant_id` column is necessary in pooled data models, but not sufficient.
7. Cache/search/background jobs/admin tools are common cross-tenant leak points.
8. Noisy neighbor is an isolation problem as much as a performance problem.
9. Tenant-aware observability and cost attribution are required for operating SaaS at scale.
10. Onboarding, offboarding, tenant migration, and tier upgrades are workflows, not scripts.

---

## 30. Referensi Resmi dan Bacaan Lanjutan

- AWS Well-Architected SaaS Lens — Silo, Pool, and Bridge Models: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html
- AWS SaaS Architecture Fundamentals — Tenant Isolation: https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html
- AWS SaaS Tenant Isolation Strategies: https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html
- AWS SaaS Lens — Noisy Neighbor: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/noisy-neighbor.html
- AWS Guidance for Multi-Tenant Architectures on AWS: https://docs.aws.amazon.com/solutions/multi-tenant-architectures-on-aws/
- AWS Well-Architected SaaS Lens — Pool Isolation: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/pool-isolation.html
- AWS Well-Architected SaaS Lens — Silo Isolation: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-isolation.html
- AWS Well-Architected SaaS Lens — Bridge Model: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/bridge-model.html

---

## 31. Status Seri

Part ini adalah **Part 027** dari seri `learn-aws-cloud-architecture-mastery-for-java-engineers`.

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-028.md
```

Judul berikutnya:

```text
Resilient Integration with AWS APIs: Retry, Timeout, Idempotency, Throttling, Quota, dan Backoff
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Governance, Audit, and Compliance: CloudTrail, Config, Control Tower, Security Hub</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-028.md">Part 028 — Resilient Integration with AWS APIs: Retry, Timeout, Idempotency, Throttling, Quota, dan Backoff ➡️</a>
</div>

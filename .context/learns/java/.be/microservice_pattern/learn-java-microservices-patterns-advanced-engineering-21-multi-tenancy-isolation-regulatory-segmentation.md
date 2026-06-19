# learn-java-microservices-patterns-advanced-engineering — Part 21
# Multi-Tenancy, Isolation, and Regulatory Segmentation

> Seri: `learn-java-microservices-patterns-advanced-engineering`  
> Part: `21 / 35`  
> File: `learn-java-microservices-patterns-advanced-engineering-21-multi-tenancy-isolation-regulatory-segmentation.md`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Principal Engineer / Architecture Engineering

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 20, kita sudah membahas fondasi microservices dari sisi:

1. distributed systems reality,
2. service boundary,
3. domain modeling,
4. communication style,
5. event-driven architecture,
6. saga dan compensation,
7. outbox/inbox,
8. consistency dan invariant,
9. data ownership,
10. query pattern,
11. gateway/BFF,
12. discovery/configuration,
13. resilience,
14. backpressure,
15. idempotency,
16. workflow,
17. state machine,
18. service-to-service security.

Part ini membahas **multi-tenancy** dan **regulatory segmentation**.

Ini penting karena banyak engineer menyederhanakan multi-tenancy menjadi:

```text
Tambahkan kolom tenant_id di semua tabel.
```

Itu terlalu dangkal.

Dalam sistem enterprise, SaaS, government, financial, healthcare, atau regulatory case management, tenant bukan hanya data filter. Tenant bisa menjadi:

1. boundary kepemilikan data,
2. boundary authorization,
3. boundary audit,
4. boundary encryption,
5. boundary rate limit,
6. boundary configuration,
7. boundary feature rollout,
8. boundary operational support,
9. boundary incident blast radius,
10. boundary legal/compliance,
11. boundary deployment,
12. boundary migration,
13. boundary observability,
14. boundary cost attribution.

Jadi pertanyaan utamanya bukan:

```text
Bagaimana menambah tenant_id?
```

Pertanyaan sebenarnya:

```text
Isolasi apa yang harus dijamin, pada layer mana, dengan biaya dan kompleksitas berapa, dan bagaimana membuktikannya saat terjadi incident, audit, atau dispute?
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. membedakan tenant, user, organization, agency, customer, environment, dan partition;
2. mendesain model multi-tenancy yang sesuai dengan risiko bisnis;
3. memilih strategi isolasi data:
   - shared table,
   - shared schema,
   - schema-per-tenant,
   - database-per-tenant,
   - cluster/account-per-tenant,
   - hybrid tiered tenancy;
4. mendesain tenant-aware service boundary;
5. mendesain tenant-aware API, event, cache, messaging, workflow, observability, dan security;
6. mengenali tenant isolation bug sebelum masuk production;
7. menghindari cross-tenant data leakage;
8. membuat tenant-aware authorization yang tidak hanya bergantung pada role;
9. mendesain tenant-aware rate limiting dan noisy-neighbor protection;
10. menilai kapan tenant butuh physical isolation;
11. mendesain regulatory segmentation untuk agency/domain/legal boundary;
12. membuat checklist production readiness multi-tenant system;
13. menjelaskan trade-off isolation vs cost vs operability secara defensible.

---

## 2. Definisi Dasar

### 2.1 Tenant

Tenant adalah unit isolasi logical, contractual, operational, atau regulatory yang dilayani oleh sistem yang sama.

Tenant bisa berupa:

1. perusahaan customer,
2. agency pemerintahan,
3. business unit,
4. region,
5. regulator domain,
6. partner,
7. marketplace seller,
8. organization,
9. workspace,
10. branch,
11. product instance,
12. legal entity.

Tenant tidak selalu sama dengan user.

Contoh:

```text
User: alice@example.com
Tenant: Agency A
Role: case_officer
Permission: approve_application
Scope: application submitted to Agency A only
```

User yang sama bisa punya akses ke beberapa tenant.

```text
User: consultant@example.com
Tenant memberships:
- Company A as Admin
- Company B as Viewer
- Company C as External Agent
```

Maka `user_id` tidak boleh diperlakukan sebagai tenant boundary.

---

### 2.2 Multi-Tenancy

Multi-tenancy berarti satu sistem/platform melayani banyak tenant dengan sebagian resource bersama.

Resource yang bisa shared:

1. codebase,
2. deployment,
3. compute node,
4. database server,
5. database schema,
6. table,
7. message broker,
8. topic/queue,
9. cache cluster,
10. object storage bucket,
11. identity provider,
12. observability pipeline,
13. admin console,
14. CI/CD pipeline.

Resource yang bisa isolated:

1. account/subscription/project,
2. cluster,
3. namespace,
4. service instance,
5. database,
6. schema,
7. table partition,
8. row,
9. encryption key,
10. topic,
11. queue,
12. cache namespace,
13. log index,
14. metric tag,
15. feature flag set,
16. config profile.

---

### 2.3 Tenant Isolation

Tenant isolation adalah kemampuan sistem membatasi akses dan efek runtime berdasarkan tenant context.

Isolasi bukan hanya security. Isolasi mencakup:

1. data isolation,
2. compute isolation,
3. network isolation,
4. identity isolation,
5. authorization isolation,
6. encryption isolation,
7. operational isolation,
8. performance isolation,
9. observability isolation,
10. failure isolation,
11. compliance isolation,
12. cost isolation.

Kalimat penting:

```text
Multi-tenancy tanpa tenant isolation adalah shared system dengan harapan baik.
```

---

## 3. Masalah Yang Sebenarnya Diselesaikan Multi-Tenancy

Multi-tenancy biasanya dibuat untuk:

1. menurunkan biaya per customer,
2. mempercepat onboarding tenant baru,
3. menyederhanakan upgrade software,
4. mengonsolidasikan operasi,
5. memungkinkan standardisasi platform,
6. mengurangi duplikasi deployment,
7. memusatkan observability,
8. memungkinkan cross-tenant product analytics,
9. mempercepat feature rollout.

Namun multi-tenancy menambah risiko:

1. cross-tenant data leakage,
2. noisy neighbor,
3. blast radius lebih besar,
4. compliance breach,
5. sulit melakukan tenant-specific customization,
6. sulit rollback per tenant,
7. sulit backup/restore per tenant,
8. sulit data residency,
9. sulit incident containment,
10. sulit cost attribution,
11. sulit audit evidence,
12. sulit tenant migration.

Maka multi-tenancy adalah trade-off, bukan default virtue.

---

## 4. Tenant Bukan Sekadar Kolom `tenant_id`

Desain yang sering muncul:

```sql
CREATE TABLE application (
    id BIGINT PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    applicant_name VARCHAR(255) NOT NULL
);
```

Ini bisa menjadi bagian dari solusi, tetapi tidak cukup.

Pertanyaan yang belum dijawab:

1. Siapa yang menetapkan `tenant_id`?
2. Apakah client boleh mengirim `tenant_id`?
3. Apakah `tenant_id` diambil dari token?
4. Apakah user bisa switch tenant?
5. Apakah role berbeda per tenant?
6. Apakah service-to-service call membawa tenant context?
7. Apakah cache key mengandung tenant?
8. Apakah message event mengandung tenant?
9. Apakah query selalu memfilter tenant?
10. Apakah audit log menyimpan tenant?
11. Apakah log bisa diakses per tenant?
12. Apakah rate limit per tenant?
13. Apakah backup/restore bisa per tenant?
14. Apakah tenant bisa dipindah ke database lain?
15. Apakah ada data yang boleh cross-tenant?
16. Apakah ada super-admin?
17. Apakah super-admin aksesnya diaudit?
18. Apakah bug satu tenant bisa merusak queue semua tenant?
19. Apakah batch job memproses semua tenant dalam satu transaction?
20. Apakah satu tenant besar bisa menghabiskan connection pool?

Kolom `tenant_id` hanya menjawab satu layer: row-level data partition.

Microservices multi-tenancy butuh tenant context dari edge sampai storage.

---

## 5. Tenant Context

### 5.1 Definisi Tenant Context

Tenant context adalah informasi runtime yang menjawab:

```text
Request/event/job ini sedang bertindak untuk tenant siapa, dengan actor siapa, di scope apa, atas authority apa?
```

Contoh tenant context:

```json
{
  "tenantId": "agency-a",
  "tenantType": "REGULATOR_AGENCY",
  "actorType": "USER",
  "actorId": "u-12345",
  "subjectId": "u-12345",
  "delegatedBy": null,
  "roles": ["CASE_OFFICER"],
  "permissions": ["APPLICATION_REVIEW"],
  "region": "SG",
  "dataResidency": "SG",
  "policyVersion": "2026-06-01",
  "requestId": "req-abc",
  "correlationId": "corr-xyz"
}
```

Tenant context harus tersedia pada:

1. API layer,
2. service layer,
3. repository layer,
4. message producer,
5. message consumer,
6. batch job,
7. scheduler,
8. workflow engine,
9. cache access,
10. log/tracing,
11. audit trail,
12. external integration.

---

### 5.2 Tenant Context Source

Tenant context bisa berasal dari:

1. authenticated token claim,
2. selected workspace in UI,
3. route/domain/subdomain,
4. mTLS client certificate,
5. API key binding,
6. service account binding,
7. message envelope,
8. batch job parameter,
9. workflow instance metadata,
10. admin console selection.

Urutan trust penting.

Bad design:

```http
POST /applications
X-Tenant-Id: agency-a
Authorization: Bearer token-for-agency-b
```

Jika backend percaya `X-Tenant-Id` dari client tanpa validasi terhadap token, bug ini bisa menjadi cross-tenant breach.

Better design:

```text
Effective tenant = intersection(
  tenant selected by request,
  tenants allowed by authenticated principal,
  tenants allowed by route/API key/client certificate,
  tenants allowed by service policy
)
```

---

### 5.3 Tenant Context Propagation

Tenant context harus dipropagasi secara eksplisit.

Synchronous call:

```text
API Gateway
  -> Application Service
      -> Profile Service
      -> Document Service
```

Context propagation bisa melalui:

1. JWT claim,
2. internal signed token,
3. trusted headers dari gateway,
4. mTLS workload identity + context header,
5. request-scoped context object.

Asynchronous call:

```text
ApplicationSubmitted event:
- tenantId
- actorId
- correlationId
- causationId
- policyVersion
- dataClassification
```

Batch job:

```text
jobName=DailySlaEscalation
mode=perTenant
tenantId=agency-a
```

Kalau batch job berjalan tanpa tenant context, biasanya akan muncul query global yang rawan:

```sql
SELECT * FROM application WHERE status = 'PENDING'
```

Seharusnya:

```sql
SELECT * FROM application
WHERE tenant_id = :tenantId
AND status = 'PENDING'
```

Atau batch dirancang sebagai orchestrator per tenant dengan isolation dan rate limit per tenant.

---

## 6. Tenant Isolation Model

Ada beberapa model isolasi utama.

---

## 6.1 Shared Everything / Pooled Model

Semua tenant berbagi deployment, database, schema, table, broker, cache.

```text
Single app deployment
Single database
Single schema
Shared tables
tenant_id column
```

Contoh:

```text
application
- id
- tenant_id
- status
- applicant_name
```

Kelebihan:

1. biaya rendah,
2. operasional sederhana,
3. onboarding tenant cepat,
4. upgrade mudah,
5. cocok untuk banyak tenant kecil,
6. utilization tinggi.

Kekurangan:

1. cross-tenant leakage risk tinggi,
2. noisy neighbor tinggi,
3. restore per tenant sulit,
4. data residency sulit,
5. schema customization sulit,
6. compliance evidence lebih kompleks,
7. query wajib tenant-safe di semua tempat,
8. batch job rawan global impact.

Cocok untuk:

1. tenant kecil,
2. risiko rendah-menengah,
3. product SaaS umum,
4. tidak ada strict regulatory isolation,
5. cost efficiency prioritas utama.

Tidak cocok untuk:

1. tenant dengan strict legal isolation,
2. tenant enterprise besar,
3. government/regulatory tenant dengan data sovereignty,
4. tenant yang butuh backup/restore mandiri,
5. tenant yang butuh custom release window.

---

## 6.2 Shared Database, Schema-per-Tenant

Semua tenant berbagi database server, tetapi punya schema masing-masing.

```text
Database: app_db
Schemas:
- tenant_agency_a.application
- tenant_agency_b.application
- tenant_agency_c.application
```

Kelebihan:

1. isolasi lebih kuat daripada row-level,
2. query lebih aman karena default schema tenant,
3. restore per schema lebih mungkin,
4. customization lebih mudah,
5. migration bisa per tenant.

Kekurangan:

1. migration orchestration lebih kompleks,
2. connection pool bisa membengkak,
3. schema count besar menyulitkan DBA,
4. reporting lintas tenant lebih sulit,
5. operational automation wajib matang,
6. metadata tenant-to-schema harus aman.

Cocok untuk:

1. tenant menengah,
2. compliance sedang,
3. beberapa tenant butuh customization ringan,
4. jumlah tenant tidak terlalu besar,
5. restore/migration per tenant penting.

---

## 6.3 Database-per-Tenant

Setiap tenant punya database sendiri.

```text
Tenant A -> db_agency_a
Tenant B -> db_agency_b
Tenant C -> db_agency_c
```

Kelebihan:

1. isolasi data kuat,
2. backup/restore per tenant lebih mudah,
3. migration per tenant lebih fleksibel,
4. noisy neighbor lebih mudah dikontrol,
5. encryption key per database lebih mudah,
6. compliance evidence lebih kuat,
7. tenant export/delete lebih mudah.

Kekurangan:

1. biaya lebih tinggi,
2. connection management kompleks,
3. migration orchestration kompleks,
4. schema drift risk tinggi,
5. observability harus agregasi banyak database,
6. cross-tenant analytics lebih sulit,
7. onboarding butuh provisioning.

Cocok untuk:

1. enterprise SaaS,
2. tenant besar,
3. regulated tenant,
4. data residency/retention berbeda,
5. performance isolation penting.

---

## 6.4 Deployment-per-Tenant

Setiap tenant punya service deployment sendiri, tetapi mungkin masih berbagi cluster/database server.

```text
Namespace agency-a:
- application-service
- document-service
- workflow-service

Namespace agency-b:
- application-service
- document-service
- workflow-service
```

Kelebihan:

1. release per tenant,
2. config per tenant,
3. scaling per tenant,
4. blast radius lebih kecil,
5. performance isolation lebih baik,
6. incident containment lebih mudah.

Kekurangan:

1. deployment count meningkat,
2. platform automation wajib kuat,
3. observability lebih kompleks,
4. cost lebih tinggi,
5. version skew antar tenant,
6. support matrix lebih berat.

Cocok untuk:

1. tenant besar,
2. tenant dengan custom release window,
3. tenant regulated,
4. tenant dengan workload berbeda ekstrem,
5. tenant yang butuh dedicated ops support.

---

## 6.5 Cluster/Account-per-Tenant / Silo Model

Setiap tenant memiliki stack terisolasi penuh.

```text
Tenant A:
- cloud account/project/subscription sendiri
- cluster sendiri
- database sendiri
- broker sendiri
- cache sendiri
- storage sendiri

Tenant B:
- stack terpisah
```

Kelebihan:

1. isolasi paling kuat,
2. blast radius paling kecil,
3. compliance boundary mudah dijelaskan,
4. per-tenant audit lebih jelas,
5. per-tenant encryption dan network policy kuat,
6. data residency lebih mudah,
7. tenant-specific incident tidak menyebar.

Kekurangan:

1. biaya tinggi,
2. operasional kompleks,
3. provisioning lambat jika automation buruk,
4. upgrade banyak stack,
5. platform engineering wajib matang,
6. underutilization tinggi.

Cocok untuk:

1. high-risk regulated tenant,
2. government agency isolation,
3. financial-grade tenant,
4. strict contractual isolation,
5. tenant dengan data residency khusus,
6. tenant yang tidak boleh berbagi infra.

---

## 6.6 Hybrid Tenancy

Dalam praktik, model terbaik sering hybrid.

Contoh:

```text
Tier Free / Small:
- pooled app
- pooled database
- row-level tenant isolation

Tier Enterprise:
- shared app
- database-per-tenant

Tier Regulated:
- deployment-per-tenant
- database-per-tenant
- dedicated encryption key

Tier Sovereign:
- account/cluster-per-tenant
```

Hybrid tenancy memungkinkan balancing:

1. cost,
2. isolation,
3. performance,
4. compliance,
5. customizability,
6. operability.

Namun hybrid tenancy harus didesain sejak awal agar tenant bisa dipindah antar tier.

Kalau tidak, tenant migration akan menjadi project besar.

---

## 7. Isolation Dimension Matrix

Satu tenant model tidak cukup. Kita perlu mengevaluasi isolasi per dimensi.

| Dimension | Shared Row | Schema per Tenant | DB per Tenant | Deployment per Tenant | Account/Cluster per Tenant |
|---|---:|---:|---:|---:|---:|
| Data confidentiality | Medium | Medium-High | High | High | Very High |
| Query safety | Low-Medium | High | High | High | Very High |
| Backup/restore per tenant | Hard | Medium | Easy | Easy | Easy |
| Cost efficiency | Very High | High | Medium | Low-Medium | Low |
| Operational complexity | Low | Medium | High | High | Very High |
| Noisy neighbor protection | Low | Low-Medium | Medium-High | High | Very High |
| Custom release | Hard | Hard-Medium | Medium | Easy | Easy |
| Data residency | Hard | Medium | High | High | Very High |
| Compliance evidence | Hard | Medium | High | High | Very High |
| Tenant migration | Medium | Medium | Medium | Hard | Hard |
| Cross-tenant analytics | Easy | Medium | Hard | Hard | Very Hard |

Top-tier engineer tidak bertanya:

```text
Model mana yang paling bagus?
```

Tetapi:

```text
Untuk tenant risk class ini, isolation dimension mana yang wajib kuat, mana yang cukup logical, dan mana yang bisa dikompensasi dengan monitoring/audit?
```

---

## 8. Tenant Risk Classification

Sebelum memilih arsitektur, klasifikasikan tenant.

Contoh risk class:

```text
Tenant Class S0 — Internal sandbox
Tenant Class S1 — Small commercial tenant
Tenant Class S2 — Standard production tenant
Tenant Class S3 — Enterprise tenant
Tenant Class S4 — Regulated tenant
Tenant Class S5 — Sovereign / high-confidentiality tenant
```

Mapping:

| Risk Class | Isolation Suggestion |
|---|---|
| S0 | pooled everything |
| S1 | pooled DB + strict tenant_id + RLS optional |
| S2 | pooled app + stronger logical controls |
| S3 | DB-per-tenant or schema-per-tenant |
| S4 | DB-per-tenant + tenant-aware deployment + dedicated keys |
| S5 | dedicated account/cluster/stack |

Pertanyaan review:

1. Apa dampak jika data tenant A terlihat tenant B?
2. Apakah kontrak melarang shared infrastructure?
3. Apakah regulator butuh bukti isolasi physical/logical?
4. Apakah tenant punya data residency requirement?
5. Apakah tenant butuh backup/restore sendiri?
6. Apakah tenant butuh custom release window?
7. Apakah tenant workload jauh lebih besar dari tenant lain?
8. Apakah tenant punya encryption key sendiri?
9. Apakah tenant ingin audit log sendiri?
10. Apakah tenant bisa membayar isolation cost?

---

## 9. Tenant-Aware Domain Modeling

Tenant harus masuk ke domain model secara sadar.

Ada tiga pendekatan.

---

### 9.1 Tenant as Ambient Context

Tenant tidak muncul sebagai field domain object secara eksplisit di semua method. Tenant disediakan oleh request context.

```java
public final class TenantContext {
    private final String tenantId;
    private final String actorId;
    private final Set<String> permissions;

    public TenantContext(String tenantId, String actorId, Set<String> permissions) {
        this.tenantId = requireNonBlank(tenantId);
        this.actorId = requireNonBlank(actorId);
        this.permissions = Set.copyOf(permissions);
    }

    public String tenantId() {
        return tenantId;
    }

    public String actorId() {
        return actorId;
    }

    public boolean hasPermission(String permission) {
        return permissions.contains(permission);
    }

    private static String requireNonBlank(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
        return value;
    }
}
```

Kelebihan:

1. method signature lebih ringkas,
2. tenant context bisa dipusatkan,
3. cocok untuk application service.

Risiko:

1. implicit dependency,
2. mudah lupa pada async/thread boundary,
3. ThreadLocal risk,
4. virtual thread/inheritable context hazard,
5. test bisa tidak eksplisit.

---

### 9.2 Tenant as Explicit Parameter

Tenant selalu muncul di method boundary.

```java
public interface ApplicationRepository {
    Optional<Application> findById(TenantId tenantId, ApplicationId applicationId);

    void save(TenantId tenantId, Application application);
}
```

Kelebihan:

1. eksplisit,
2. mudah dites,
3. query lebih aman,
4. async lebih aman,
5. cocok untuk repository dan service boundary.

Kekurangan:

1. signature lebih panjang,
2. banyak plumbing,
3. developer bisa merasa repetitif.

Untuk system critical, explicit tenant parameter biasanya lebih aman di repository dan integration boundary.

---

### 9.3 Tenant as Aggregate Ownership

Tenant menjadi bagian dari identity aggregate.

```java
public final class ApplicationId {
    private final String tenantId;
    private final String applicationNumber;

    public ApplicationId(String tenantId, String applicationNumber) {
        this.tenantId = tenantId;
        this.applicationNumber = applicationNumber;
    }

    public String tenantId() {
        return tenantId;
    }

    public String applicationNumber() {
        return applicationNumber;
    }
}
```

Kelebihan:

1. mencegah accidental cross-tenant access,
2. identity lebih domain-aware,
3. bagus untuk globally unique business identity.

Kekurangan:

1. ID lebih kompleks,
2. interoperability perlu hati-hati,
3. external API perlu canonical format.

Contoh canonical ID:

```text
agency-a:APP-2026-000123
```

Atau tetap pisahkan:

```json
{
  "tenantId": "agency-a",
  "applicationNumber": "APP-2026-000123"
}
```

Untuk security, memisahkan tenantId dan objectId sering lebih mudah divalidasi.

---

## 10. Tenant-Aware API Design

### 10.1 Tenant dari Path

```http
GET /tenants/{tenantId}/applications/{applicationId}
```

Kelebihan:

1. eksplisit,
2. cocok untuk admin/multi-tenant users,
3. mudah dirouting,
4. log jelas.

Risiko:

1. user bisa mengganti tenantId di URL,
2. wajib object-level authorization,
3. tenantId tidak boleh dipercaya tanpa token validation.

Rule:

```text
tenantId in path is requested tenant, not authorized tenant.
```

Backend tetap harus validasi:

```text
principal can access tenantId AND principal can access applicationId within tenantId
```

---

### 10.2 Tenant dari Subdomain

```text
agency-a.example.com
agency-b.example.com
```

Kelebihan:

1. UX jelas,
2. cookie/session isolation lebih mudah,
3. branding/customization mudah,
4. routing per tenant bisa dilakukan di edge.

Risiko:

1. DNS/certificate management,
2. tenant alias lifecycle,
3. domain takeover risk,
4. multi-tenant user switching lebih kompleks.

---

### 10.3 Tenant dari Token Claim

```json
{
  "sub": "u-123",
  "tenant": "agency-a",
  "roles": ["case_officer"]
}
```

Kelebihan:

1. simple untuk single-tenant session,
2. request tidak perlu tenantId eksplisit,
3. minim spoofing dari URL/header.

Risiko:

1. user multi-tenant butuh token switching,
2. role per tenant bisa kompleks,
3. token terlalu besar jika banyak tenant,
4. stale permission sampai token expiry.

---

### 10.4 Tenant dari Header

```http
X-Tenant-Id: agency-a
```

Ini hanya aman jika:

1. header dibuat oleh trusted gateway,
2. client header dibuang/di-override di edge,
3. header ditandatangani atau context diverifikasi,
4. service internal tidak exposed langsung,
5. token principal tetap divalidasi.

Jangan menerima tenant header mentah dari internet.

---

## 11. Tenant-Aware Authorization

Role saja tidak cukup.

Bad model:

```text
User has role CASE_OFFICER.
Therefore user can view all applications.
```

Better model:

```text
User has role CASE_OFFICER in tenant agency-a.
User can view application only if application.tenantId == agency-a
and application is assigned to allowed unit/queue/scope.
```

Authorization harus mempertimbangkan:

1. tenant,
2. actor,
3. role,
4. permission,
5. object ownership,
6. organizational unit,
7. case assignment,
8. workflow state,
9. sensitivity level,
10. delegation,
11. purpose of access,
12. break-glass condition,
13. policy version.

Contoh policy thinking:

```text
Can actor A perform action X on object O under tenant T at state S for purpose P?
```

Bukan:

```text
Does actor A have role R?
```

---

## 12. Broken Object Level Authorization Dalam Multi-Tenant System

Salah satu bug paling umum:

```http
GET /applications/APP-1001
Authorization: Bearer token-for-agency-a
```

Backend:

```sql
SELECT * FROM application WHERE id = 'APP-1001'
```

Jika `APP-1001` milik Agency B, data bocor.

Query minimal:

```sql
SELECT * FROM application
WHERE tenant_id = :tenantId
AND id = :applicationId
```

Tetapi itu masih belum cukup jika ada unit/assignment/sensitivity.

```sql
SELECT * FROM application
WHERE tenant_id = :tenantId
AND id = :applicationId
AND unit_id IN (:allowedUnitIds)
AND sensitivity_level <= :maxSensitivity
```

Rule:

```text
Every object lookup in multi-tenant system must be tenant-scoped and authorization-scoped.
```

---

## 13. Tenant-Aware Repository Pattern

Bad repository:

```java
Optional<Application> findById(String applicationId);
```

Better:

```java
Optional<Application> findByTenantAndId(TenantId tenantId, ApplicationId applicationId);
```

Even better, encode tenant scope into repository instance:

```java
public final class TenantScopedApplicationRepository {
    private final DataSource dataSource;
    private final TenantId tenantId;

    public TenantScopedApplicationRepository(DataSource dataSource, TenantId tenantId) {
        this.dataSource = dataSource;
        this.tenantId = tenantId;
    }

    public Optional<Application> findById(ApplicationId applicationId) {
        String sql = """
            SELECT id, tenant_id, status, applicant_name, version
            FROM application
            WHERE tenant_id = ?
            AND id = ?
            """;

        // JDBC implementation omitted for brevity.
        return Optional.empty();
    }
}
```

Benefit:

1. tenant injected once,
2. every query is tenant-scoped by construction,
3. test can verify no tenantless repository is used.

Risk:

1. scope lifecycle must be managed correctly,
2. do not cache tenant-scoped repository globally.

---

## 14. Tenant-Aware Database Techniques

### 14.1 Application-Enforced Tenant Filter

Application code always adds `tenant_id = ?`.

Kelebihan:

1. portable,
2. simple,
3. framework-agnostic.

Kekurangan:

1. developer bisa lupa,
2. raw SQL risk,
3. ORM filter bypass risk,
4. test coverage wajib kuat.

---

### 14.2 Row-Level Security

Database menegakkan row-level access policy.

Konsep:

```text
Application sets current tenant context in DB session.
DB policy restricts rows by tenant_id.
```

Kelebihan:

1. defense-in-depth,
2. melindungi dari query lupa filter,
3. bagus untuk shared table model.

Kekurangan:

1. vendor-specific,
2. connection pool context leakage risk,
3. migration/test lebih kompleks,
4. debugging lebih sulit,
5. DBA/security review perlu matang.

Connection pool risk:

```text
Connection used by tenant A
current_setting('tenant_id') = agency-a
Connection returned to pool
Connection reused by tenant B
If tenant context not reset -> leakage or wrong filtering
```

Rule:

```text
Every borrowed DB connection must set tenant context.
Every returned DB connection must clear/reset tenant context.
```

---

### 14.3 Schema Switching

Untuk schema-per-tenant:

```sql
SET search_path TO tenant_agency_a;
```

Atau di Oracle:

```sql
ALTER SESSION SET CURRENT_SCHEMA = TENANT_AGENCY_A;
```

Risiko sama dengan RLS: session state leakage.

Rule:

```text
Never rely on sticky session state without strict connection lifecycle control.
```

Better:

1. set schema at connection checkout,
2. verify schema before query,
3. reset schema at return,
4. avoid long-lived transaction crossing tenants,
5. never reuse tenant-bound EntityManager across tenants.

---

### 14.4 Database-per-Tenant Routing

DataSource dipilih berdasarkan tenant.

```java
public interface TenantDataSourceResolver {
    DataSource resolve(TenantId tenantId);
}
```

Risiko:

1. connection pool per tenant bisa meledak,
2. cold tenant DB connection latency,
3. credential rotation per tenant,
4. migration version drift,
5. transaction cannot cross tenant DB easily.

Mitigasi:

1. pool cap per tenant,
2. lazy pool creation,
3. pool eviction for inactive tenant,
4. migration registry,
5. tenant placement metadata,
6. global connection budget,
7. per-tenant health status.

---

## 15. Tenant-Aware Messaging

Event/message wajib membawa tenant context.

```json
{
  "messageId": "msg-123",
  "messageType": "ApplicationSubmitted",
  "schemaVersion": 3,
  "tenantId": "agency-a",
  "actorId": "u-123",
  "correlationId": "corr-456",
  "causationId": "cmd-789",
  "occurredAt": "2026-06-19T10:15:30Z",
  "payload": {
    "applicationId": "APP-2026-000123"
  }
}
```

Pertanyaan desain:

1. Apakah topic shared atau per tenant?
2. Apakah queue shared atau per tenant?
3. Apakah DLQ shared atau per tenant?
4. Apakah partition key tenantId?
5. Apakah ordering diperlukan per tenant atau global?
6. Apakah replay bisa per tenant?
7. Apakah poison message satu tenant menghentikan tenant lain?
8. Apakah consumer concurrency per tenant dibatasi?
9. Apakah tenantId dalam event diverifikasi terhadap payload?
10. Apakah event mengandung data sensitif tenant lain?

---

### 15.1 Shared Topic

```text
Topic: application-events
Messages from all tenants
```

Kelebihan:

1. operationally simple,
2. topic count rendah,
3. consumer lebih mudah.

Kekurangan:

1. consumer wajib filter tenant,
2. replay per tenant lebih sulit,
3. DLQ shared bisa noisy,
4. access control lebih kasar,
5. data leakage risk jika consumer unauthorized.

---

### 15.2 Topic per Tenant

```text
Topic: agency-a.application-events
Topic: agency-b.application-events
```

Kelebihan:

1. stronger isolation,
2. replay per tenant lebih mudah,
3. ACL lebih jelas,
4. noisy neighbor lebih terkontrol.

Kekurangan:

1. topic count besar,
2. provisioning lebih kompleks,
3. consumer subscription dinamis,
4. monitoring lebih kompleks.

---

### 15.3 Partition by Tenant

Shared topic tetapi partition key adalah tenantId.

Kelebihan:

1. ordering per tenant lebih natural,
2. load distribution bisa dikontrol,
3. replay tetap mungkin dengan filter.

Kekurangan:

1. hot tenant bisa membuat hot partition,
2. jumlah partition harus dirancang,
3. tenant migration antar partition tidak trivial.

Untuk tenant besar, bisa gunakan composite key:

```text
tenantId + aggregateId
```

Namun ordering per tenant global hilang.

---

## 16. Tenant-Aware Cache

Cache adalah sumber leakage yang sering diremehkan.

Bad cache key:

```text
application:APP-2026-000123
```

Better:

```text
tenant:agency-a:application:APP-2026-000123
```

Untuk authorization-sensitive data:

```text
tenant:agency-a:user:u-123:permissions:v7:application:APP-2026-000123
```

Cache harus mempertimbangkan:

1. tenantId,
2. user/role scope jika data authorization-dependent,
3. locale/region jika berbeda,
4. policy version,
5. data classification,
6. feature flag version,
7. schema version.

Cache anti-pattern:

```text
Cache a response for admin, then serve it to normal user.
```

Atau:

```text
Cache profile by userId only, padahal userId bisa sama dari external IdP berbeda tenant.
```

Rule:

```text
Every cache key must include all dimensions that affect data visibility.
```

---

## 17. Tenant-Aware Search Index

Search index sering menjadi read model lintas tenant.

Risiko:

1. query lupa tenant filter,
2. index alias salah,
3. document-level ACL tidak diterapkan,
4. reindex global bocor,
5. autocomplete menunjukkan data tenant lain,
6. aggregation count bocor,
7. suggestions bocor,
8. logs menyimpan query sensitif.

Strategi:

1. shared index + tenant field,
2. index-per-tenant,
3. alias-per-tenant,
4. filtered alias,
5. document-level security,
6. tenant-aware query builder.

Bad query:

```json
{
  "query": {
    "match": {
      "applicantName": "John"
    }
  }
}
```

Better:

```json
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenantId": "agency-a" } },
        { "terms": { "unitId": ["unit-1", "unit-2"] } }
      ],
      "must": [
        { "match": { "applicantName": "John" } }
      ]
    }
  }
}
```

---

## 18. Tenant-Aware Object Storage

Object storage risks:

1. shared bucket path confusion,
2. predictable object key,
3. signed URL leakage,
4. missing tenant prefix,
5. public bucket misconfiguration,
6. cross-tenant restore,
7. encryption key reuse.

Bad key:

```text
documents/12345.pdf
```

Better:

```text
tenants/agency-a/applications/APP-2026-000123/documents/doc-12345.pdf
```

Even better with opaque IDs:

```text
tenants/agency-a/objects/2026/06/19/01JZ8...bin
```

Metadata:

```json
{
  "tenantId": "agency-a",
  "ownerType": "APPLICATION",
  "ownerId": "APP-2026-000123",
  "classification": "CONFIDENTIAL",
  "checksum": "sha256:...",
  "retentionPolicy": "7y"
}
```

Signed URL rule:

```text
Signed URL must be generated only after authorization check and must expire quickly.
```

---

## 19. Tenant-Aware Workflow

Workflow instance harus tenant-scoped.

```text
workflow_instance
- id
- tenant_id
- process_key
- process_version
- business_key
- state
- started_by
- started_at
```

Workflow risks:

1. timer job scans all tenants together,
2. escalation sends notification to wrong tenant,
3. process variable contains tenant-sensitive data,
4. workflow admin can see all tenants,
5. incident retry affects all tenants,
6. process migration applies globally without tenant approval.

Better design:

1. workflow instance has tenantId,
2. every task has tenantId,
3. every timer has tenantId,
4. every external task lock includes tenantId,
5. process definition rollout can be tenant-specific,
6. workflow audit includes tenantId,
7. workflow query filters tenantId,
8. operational retry can be scoped by tenant.

---

## 20. Tenant-Aware Observability

Observability harus tenant-aware tetapi tidak membocorkan data.

### 20.1 Logs

Every log event should include:

```text
correlationId
traceId
tenantId
service
operation
actorType
result
errorCategory
```

Jangan log data sensitif:

```text
applicantName
identityNumber
personalEmail
rawToken
fullDocumentContent
```

Risk:

```text
Tenant A support engineer can access logs containing Tenant B data.
```

Mitigasi:

1. log access control,
2. tenant-specific log indexes,
3. redaction,
4. data classification,
5. audit access to logs,
6. correlation without PII.

---

### 20.2 Metrics

Tenant label berguna untuk noisy-neighbor dan SLA.

Contoh:

```text
http_requests_total{tenant_class="S3", service="application"}
workflow_backlog{tenant_id="agency-a", process="application-review"}
```

Namun high-cardinality risk besar jika tenant banyak.

Strategi:

1. label by tenantClass untuk global metrics,
2. label by tenantId hanya untuk premium/high-risk tenants,
3. exemplars/log linking untuk drill-down,
4. per-tenant dashboard on demand,
5. cardinality budget.

---

### 20.3 Traces

Trace attribute:

```text
tenant.id = agency-a
tenant.class = S4
actor.type = USER
operation.name = SubmitApplication
```

Risk:

1. tenantId sebagai high-cardinality attribute,
2. trace data contains PII,
3. cross-service propagation missing tenant,
4. sampling hides tenant-specific issue.

Sampling strategy:

1. higher sampling for high-risk tenants,
2. always sample errors,
3. sample workflow incidents,
4. sample cross-tenant admin operations,
5. sample suspicious authorization failures.

---

## 21. Tenant-Aware Rate Limiting and Noisy Neighbor Protection

Noisy neighbor terjadi ketika satu tenant menggunakan resource berlebihan dan memengaruhi tenant lain.

Resource yang bisa habis:

1. CPU,
2. memory,
3. DB connection,
4. DB IOPS,
5. thread pool,
6. virtual thread carrier saturation,
7. message consumer concurrency,
8. broker partition,
9. cache memory,
10. object storage bandwidth,
11. third-party API quota,
12. search cluster CPU,
13. report generation worker.

Rate limit dimension:

1. per tenant,
2. per user,
3. per API key,
4. per endpoint,
5. per operation type,
6. per tenant class,
7. per external integration,
8. per job type.

Example:

```text
Tenant S1:
- 100 requests/minute
- 5 concurrent report jobs
- 10 message processing concurrency

Tenant S4:
- 5000 requests/minute
- dedicated worker pool
- dedicated DB pool cap
```

Noisy neighbor controls:

1. tenant-level rate limiter,
2. tenant-level concurrency limiter,
3. tenant-level queue,
4. tenant-level worker pool,
5. tenant-level DB pool cap,
6. tenant-level circuit breaker,
7. tenant-level bulkhead,
8. tenant-level cache quota,
9. tenant-level message partitioning,
10. tenant-level autoscaling metric.

---

## 22. Tenant-Aware Configuration and Feature Flags

Tenant-specific config examples:

1. retention period,
2. SLA threshold,
3. notification template,
4. workflow version,
5. enabled modules,
6. integration endpoint,
7. rate limit,
8. timezone,
9. locale,
10. data residency,
11. encryption key id,
12. support contact,
13. rollout cohort.

Config hierarchy:

```text
Default platform config
  -> environment config
      -> tenant class config
          -> tenant config
              -> user/session override if allowed
```

Conflict resolution must be explicit.

Example:

```text
retention.default = 5y
retention.tenantClass.S4 = 7y
retention.tenant.agency-a = 10y
```

Feature flag risk:

1. enable feature for wrong tenant,
2. inconsistent behavior across services,
3. flag removed before all tenants migrated,
4. stale flag cached,
5. flag state not included in audit.

Rule:

```text
Tenant-affecting flags must be observable and auditable.
```

---

## 23. Tenant-Aware Encryption

Encryption strategy:

1. shared key for all tenants,
2. key per tenant class,
3. key per tenant,
4. key per data domain per tenant,
5. key per object/document.

Key-per-tenant benefits:

1. stronger isolation,
2. crypto-shredding per tenant,
3. clearer audit,
4. tenant-specific key rotation,
5. reduced blast radius.

Costs:

1. key management complexity,
2. KMS quota/cost,
3. rotation orchestration,
4. re-encryption process,
5. key access policy complexity.

Encryption context should include tenant:

```json
{
  "tenantId": "agency-a",
  "dataDomain": "application-document",
  "classification": "confidential"
}
```

Never allow service to decrypt tenant data without tenant-scoped authorization.

---

## 24. Tenant-Aware Admin and Support Access

Support/admin access is a high-risk path.

Bad model:

```text
Support admin has global DB read access.
```

Better model:

1. support access requires tenant selection,
2. tenant access requires reason code,
3. high-risk access requires approval,
4. session expires quickly,
5. all reads are audited,
6. export/download needs stronger control,
7. PII fields masked by default,
8. break-glass has incident ticket,
9. tenant can receive access report if required.

Audit log:

```json
{
  "eventType": "SUPPORT_ACCESS_GRANTED",
  "tenantId": "agency-a",
  "supportUserId": "support-123",
  "reasonCode": "INCIDENT_INVESTIGATION",
  "ticketId": "INC-2026-001",
  "approvedBy": "manager-999",
  "expiresAt": "2026-06-19T12:00:00Z"
}
```

---

## 25. Tenant-Aware Batch Jobs

Batch jobs are one of the most dangerous multi-tenant components.

Bad batch:

```java
List<Application> overdue = repository.findOverdueApplications();
for (Application app : overdue) {
    escalationService.escalate(app);
}
```

Problems:

1. scans all tenants,
2. one tenant failure stops all,
3. no per-tenant rate limit,
4. no tenant-specific SLA,
5. hard to retry one tenant,
6. audit unclear.

Better batch:

```java
for (Tenant tenant : tenantRegistry.activeTenants()) {
    try {
        processTenant(tenant.id());
    } catch (Exception e) {
        recordTenantFailure(tenant.id(), e);
    }
}
```

Even better:

```text
Scheduler emits TenantSlaScanRequested per tenant.
Workers process tenant-scoped job with concurrency limit.
Failure is isolated per tenant.
```

Batch job record:

```text
job_execution
- job_id
- job_name
- tenant_id
- started_at
- finished_at
- status
- processed_count
- failed_count
- error_category
```

---

## 26. Tenant Registry

A mature multi-tenant system needs tenant registry.

Tenant registry stores:

1. tenant id,
2. display name,
3. tenant class,
4. status,
5. data region,
6. isolation model,
7. database location,
8. schema name,
9. deployment namespace,
10. encryption key id,
11. feature set,
12. rate limit profile,
13. compliance profile,
14. support plan,
15. onboarding date,
16. offboarding date,
17. migration state,
18. owner/contact.

Example:

```json
{
  "tenantId": "agency-a",
  "tenantClass": "S4_REGULATED",
  "status": "ACTIVE",
  "dataRegion": "SG",
  "isolationModel": "DATABASE_PER_TENANT",
  "databaseRef": "db-agency-a-prod",
  "encryptionKeyRef": "kms-key-agency-a",
  "rateLimitProfile": "regulated-standard",
  "featureProfile": "case-management-v3",
  "complianceProfile": "retention-10y-audit-heavy"
}
```

Tenant registry becomes critical infrastructure.

It must be:

1. highly available,
2. cached safely,
3. audited,
4. versioned,
5. protected by strict authorization,
6. recoverable,
7. tested for stale-data behavior.

---

## 27. Tenant Lifecycle

Tenant lifecycle:

```text
Prospect
  -> Provisioning
  -> Active
  -> Suspended
  -> Migrating
  -> Archived
  -> Offboarded
  -> Deleted/Retained
```

### 27.1 Provisioning

Provisioning steps:

1. create tenant registry entry,
2. allocate isolation model,
3. create database/schema if needed,
4. run migrations,
5. create encryption key,
6. create namespace/deployment if needed,
7. configure identity provider mapping,
8. configure default roles,
9. create storage prefix/bucket,
10. create message topic/queue if needed,
11. create dashboards/alerts,
12. configure rate limits,
13. enable feature profile,
14. run smoke test,
15. mark tenant active.

Provisioning must be idempotent.

---

### 27.2 Suspension

Tenant suspension may mean:

1. block login,
2. block writes but allow reads,
3. block external integrations,
4. pause batch jobs,
5. keep audit accessible,
6. keep billing/reporting,
7. reject API with clear status.

Suspension is not deletion.

---

### 27.3 Migration

Tenant migration examples:

1. pooled DB to DB-per-tenant,
2. region A to region B,
3. shared deployment to dedicated deployment,
4. tenant class upgrade,
5. encryption key rotation,
6. schema version migration.

Migration phases:

```text
Plan
  -> Freeze/dual-write decision
  -> Snapshot
  -> CDC sync
  -> Validate
  -> Cutover
  -> Monitor
  -> Decommission old path
```

Migration requires reconciliation.

---

### 27.4 Offboarding

Offboarding steps:

1. disable new login,
2. stop writes,
3. export data if required,
4. preserve audit if required,
5. apply retention policy,
6. delete or archive data,
7. revoke keys/secrets,
8. delete storage objects,
9. remove topics/queues,
10. remove deployment/resources,
11. close support access,
12. produce offboarding evidence.

Offboarding is compliance-sensitive.

---

## 28. Regulatory Segmentation

Regulatory segmentation is multi-tenancy plus legal/policy boundary.

A tenant may represent:

1. regulator agency,
2. licensing authority,
3. enforcement unit,
4. investigation unit,
5. appeal board,
6. legal department,
7. external party,
8. public user group.

Segmentation concerns:

1. case visibility,
2. officer assignment,
3. conflict of interest,
4. separation of duties,
5. legal hold,
6. evidence handling,
7. audit immutability,
8. retention schedule,
9. escalation authority,
10. appeal independence,
11. cross-agency sharing,
12. public/private data separation.

Example:

```text
Case is owned by Agency A Enforcement Unit.
Appeal is reviewed by Appeal Board.
Legal memo is visible only to Legal Unit.
Public applicant can see submitted documents but not internal notes.
Auditor can see access history but not modify case.
```

Here, simple tenantId is insufficient. We need multiple segmentation dimensions:

```text
tenantId
agencyId
businessUnitId
caseOwnerUnitId
workflowStage
confidentialityLevel
legalHold
actorPurpose
```

---

## 29. Segmentation Matrix Example

| Data / Action | Applicant | Case Officer | Supervisor | Legal | Appeal Board | Auditor |
|---|---:|---:|---:|---:|---:|---:|
| Submitted form | Own only | Assigned tenant/unit | Unit | Case-related | Appeal-related | Read audit scope |
| Internal notes | No | Assigned case | Unit | Case-related | Limited | Access metadata |
| Legal memo | No | No/limited | Limited | Full | Limited | Metadata only |
| Decision letter | Own | Assigned | Unit | Case-related | Appeal-related | Read |
| Audit trail | Own limited | Case limited | Unit | Case-related | Appeal-related | Full read |
| Reopen case | No | If allowed state | Yes | No | No | No |
| Override SLA | No | No | Yes | No | No | No |

A top-tier design makes this matrix explicit before coding.

---

## 30. Tenant-Aware Data Sharing

Sometimes cross-tenant sharing is required.

Examples:

1. parent company manages subsidiaries,
2. regulator shares case with another agency,
3. public applicant submits to multiple agencies,
4. joint investigation,
5. centralized reporting,
6. external auditor access.

Do not solve this by bypassing tenant filter.

Create explicit sharing model:

```text
shared_resource_grant
- grant_id
- resource_tenant_id
- resource_type
- resource_id
- grantee_tenant_id
- grantee_actor_type
- grantee_actor_id
- permissions
- purpose
- valid_from
- valid_until
- approved_by
- created_at
```

Access rule:

```text
Allow if actor belongs to owner tenant
OR actor has valid sharing grant for resource/action/purpose.
```

Sharing must be:

1. explicit,
2. time-bound,
3. purpose-bound,
4. auditable,
5. revocable,
6. least-privilege.

---

## 31. Tenant-Aware Java Implementation Patterns

### 31.1 Avoid Raw String Tenant Everywhere

Bad:

```java
String tenantId = request.getHeader("X-Tenant-Id");
```

Better:

```java
public record TenantId(String value) {
    public TenantId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("tenant id must not be blank");
        }
        if (!value.matches("[a-z0-9][a-z0-9-]{1,62}")) {
            throw new IllegalArgumentException("invalid tenant id format");
        }
    }
}
```

For Java 8:

```java
public final class TenantId {
    private final String value;

    public TenantId(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("tenant id must not be blank");
        }
        if (!value.matches("[a-z0-9][a-z0-9-]{1,62}")) {
            throw new IllegalArgumentException("invalid tenant id format");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TenantId)) return false;
        TenantId other = (TenantId) o;
        return value.equals(other.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return value;
    }
}
```

---

### 31.2 Tenant Context Holder: Use Carefully

ThreadLocal example:

```java
public final class TenantContextHolder {
    private static final ThreadLocal<TenantContext> CURRENT = new ThreadLocal<>();

    private TenantContextHolder() {
    }

    public static void set(TenantContext context) {
        CURRENT.set(Objects.requireNonNull(context));
    }

    public static TenantContext current() {
        TenantContext context = CURRENT.get();
        if (context == null) {
            throw new IllegalStateException("tenant context is missing");
        }
        return context;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Filter pattern:

```java
try {
    TenantContextHolder.set(resolveTenantContext(request));
    chain.doFilter(request, response);
} finally {
    TenantContextHolder.clear();
}
```

Important:

1. always clear in `finally`,
2. do not rely on ThreadLocal across async boundary,
3. virtual threads reduce thread reuse hazard but do not remove context propagation problem,
4. explicit parameter is safer for core logic,
5. tests must fail if context missing.

---

### 31.3 Tenant-Safe SQL Builder Principle

Centralize tenant predicate.

```java
public final class TenantPredicates {
    private TenantPredicates() {
    }

    public static String applicationTenantPredicate() {
        return "tenant_id = ?";
    }
}
```

But this is weak if developers can bypass it.

Better:

1. repository methods require TenantId,
2. static analysis checks tenantless query,
3. integration tests inject two tenants,
4. mutation test removes tenant filter and test must fail,
5. database RLS as defense-in-depth.

---

### 31.4 Tenant-Aware Event Envelope

```java
public final class IntegrationEvent<T> {
    private final UUID messageId;
    private final TenantId tenantId;
    private final String type;
    private final int schemaVersion;
    private final Instant occurredAt;
    private final String correlationId;
    private final String causationId;
    private final T payload;

    public IntegrationEvent(
            UUID messageId,
            TenantId tenantId,
            String type,
            int schemaVersion,
            Instant occurredAt,
            String correlationId,
            String causationId,
            T payload
    ) {
        this.messageId = Objects.requireNonNull(messageId);
        this.tenantId = Objects.requireNonNull(tenantId);
        this.type = requireNonBlank(type);
        this.schemaVersion = schemaVersion;
        this.occurredAt = Objects.requireNonNull(occurredAt);
        this.correlationId = requireNonBlank(correlationId);
        this.causationId = requireNonBlank(causationId);
        this.payload = Objects.requireNonNull(payload);
    }

    public TenantId tenantId() {
        return tenantId;
    }

    private static String requireNonBlank(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("value must not be blank");
        }
        return value;
    }
}
```

For Java 16+ this can be a record.

For Java 17+ sealed event hierarchies can help control event types.

---

## 32. Java 8–25 Considerations

### Java 8

Common in legacy enterprise systems.

Considerations:

1. no records,
2. no sealed classes,
3. no pattern matching,
4. more boilerplate for value objects,
5. ThreadLocal common but dangerous,
6. CompletableFuture async context propagation manual,
7. javax/jakarta split likely relevant in older stacks.

Recommendation:

1. create explicit value classes for TenantId and TenantContext,
2. avoid raw String tenant usage,
3. add repository contract tests,
4. use filter/interceptor to resolve context,
5. explicit tenant parameter in core logic.

---

### Java 11

Better HTTP client and runtime baseline.

Considerations:

1. `HttpClient` can propagate tenant-aware headers,
2. use immutable value types manually,
3. better container awareness than Java 8,
4. still no records/sealed.

---

### Java 17

Strong baseline for modern enterprise.

Useful features:

1. records for TenantId/TenantContext DTO-like values,
2. sealed classes for tenant lifecycle states,
3. improved switch expressions,
4. stronger runtime baseline,
5. better container/JVM ergonomics.

Example:

```java
public sealed interface TenantStatus permits ActiveTenant, SuspendedTenant, MigratingTenant {
}

public record ActiveTenant(TenantId id) implements TenantStatus {
}

public record SuspendedTenant(TenantId id, String reason) implements TenantStatus {
}

public record MigratingTenant(TenantId id, String migrationId) implements TenantStatus {
}
```

---

### Java 21

Virtual threads can improve blocking service scalability, but they do not solve tenant isolation.

Risks:

1. one tenant can create huge concurrency unless limited,
2. DB pool remains bottleneck,
3. external API quota remains bottleneck,
4. ThreadLocal context still must be handled carefully,
5. structured concurrency can help scope work but requires discipline.

Rule:

```text
Virtual threads make waiting cheaper, not downstream capacity infinite.
```

Tenant-aware concurrency limiter still required.

---

### Java 25

Java 25 is useful as latest platform horizon. Design should not depend on unreleased/preview-only features for core tenant isolation unless your runtime policy allows it.

Principles:

1. use stable language features for correctness boundary,
2. avoid magic framework-only tenant filtering,
3. use explicit value objects,
4. use structured concurrency/scoped values only if stable and supported by your deployment baseline,
5. keep Java 8/11 compatibility only if product actually needs it.

---

## 33. Framework Positioning

### Spring / Spring Boot

Relevant tools:

1. servlet filters / WebFlux filters,
2. Spring Security authentication and authorization context,
3. method security,
4. Spring Data repository conventions,
5. Hibernate filters for tenant_id,
6. AbstractRoutingDataSource for DB-per-tenant,
7. Spring Cloud Gateway for tenant routing,
8. Micrometer/OpenTelemetry tenant-aware observations,
9. Spring Batch tenant-aware jobs.

Risks:

1. Hibernate filter bypass via native query,
2. ThreadLocal tenant context leakage,
3. async executor not propagating context,
4. AbstractRoutingDataSource pool explosion,
5. global admin endpoint not tenant-safe.

---

### Jakarta / MicroProfile

Relevant tools:

1. Jakarta Security,
2. Jakarta REST filters,
3. CDI interceptors,
4. MicroProfile JWT,
5. MicroProfile Config,
6. MicroProfile Fault Tolerance,
7. MicroProfile Telemetry,
8. JPA multi-tenancy patterns depending provider.

Risks:

1. container context propagation misunderstanding,
2. JPA tenant filter bypass,
3. default datasource shared incorrectly,
4. JWT tenant claim not validated against resource.

---

### Quarkus

Relevant tools:

1. OIDC/JWT integration,
2. RESTEasy Reactive filters,
3. Hibernate ORM multi-tenancy support,
4. SmallRye Config,
5. SmallRye Fault Tolerance,
6. OpenTelemetry,
7. Kubernetes-native configuration.

Risks:

1. reactive context propagation,
2. tenant routing in native image configuration,
3. extension-specific assumptions.

---

### Plain Java

Plain Java can be strong if disciplined:

1. explicit TenantContext,
2. explicit repository contract,
3. JDBC query helpers,
4. message envelope,
5. custom tenant registry client,
6. small framework surface.

But plain Java requires more manual guardrails.

---

## 34. Failure Modes

### 34.1 Cross-Tenant Read Leak

Cause:

1. missing tenant predicate,
2. insecure object lookup,
3. cache key missing tenant,
4. search query missing tenant filter,
5. report query global.

Impact:

1. data breach,
2. compliance incident,
3. trust loss,
4. legal exposure.

Detection:

1. synthetic cross-tenant tests,
2. audit anomaly,
3. access log query,
4. tenant-specific canary data.

---

### 34.2 Cross-Tenant Write Corruption

Cause:

1. wrong tenant context,
2. connection session state leak,
3. admin operation applies globally,
4. batch job missing tenant scope.

Impact:

1. data corruption,
2. wrong decision issued,
3. incorrect notification,
4. difficult reconciliation.

---

### 34.3 Noisy Neighbor Outage

Cause:

1. one tenant spikes traffic,
2. report job consumes DB,
3. event backlog from one tenant,
4. retry storm from one integration.

Impact:

1. all tenants degraded,
2. SLA breach,
3. cascading failure.

Mitigation:

1. tenant-level bulkhead,
2. tenant-level rate limit,
3. queue per tenant/class,
4. DB pool cap,
5. report isolation.

---

### 34.4 Tenant Context Lost in Async Boundary

Cause:

1. CompletableFuture without context propagation,
2. executor thread reuse,
3. messaging handler missing tenant envelope,
4. scheduled job lacks tenant.

Impact:

1. wrong authorization,
2. global query,
3. audit missing tenant,
4. cache pollution.

---

### 34.5 Tenant Misrouting

Cause:

1. tenant registry stale,
2. DNS/subdomain mapping wrong,
3. DB routing config wrong,
4. migration partial cutover.

Impact:

1. writes to wrong DB,
2. downtime for tenant,
3. data split-brain.

Mitigation:

1. tenant registry versioning,
2. write fence,
3. cutover validation,
4. checksum reconciliation,
5. read-only migration phase.

---

## 35. Testing Strategy

### 35.1 Two-Tenant Test Minimum

Every multi-tenant service must have tests with at least two tenants.

Example:

```text
Tenant A has Application APP-1
Tenant B has Application APP-1 or APP-2
User from Tenant A requests Tenant B object
Expected: 403 or 404 depending policy
```

Do not only test one tenant.

Single-tenant tests hide leakage.

---

### 35.2 Same ID Different Tenant Test

Create same business ID in different tenants.

```text
agency-a / APP-001
agency-b / APP-001
```

Then verify:

1. read returns correct tenant object,
2. update affects only correct tenant,
3. cache does not collide,
4. search returns correct tenant,
5. audit logs correct tenant,
6. events contain correct tenant.

---

### 35.3 Tenant Filter Mutation Test

Intentionally remove tenant predicate in test branch and ensure tests fail.

If tests still pass, tenant isolation test is weak.

---

### 35.4 Cache Leakage Test

1. Tenant A requests object X.
2. Response cached.
3. Tenant B requests object with same ID.
4. Verify Tenant B does not receive Tenant A response.

---

### 35.5 Message Replay Test

Replay events for tenant A only.

Verify:

1. tenant B projections unchanged,
2. tenant A projection correct,
3. DLQ scoped correctly,
4. replay job audit includes tenant.

---

### 35.6 Noisy Neighbor Load Test

Simulate tenant A high load.

Verify tenant B:

1. latency remains within SLO,
2. error rate remains acceptable,
3. DB pool not exhausted,
4. queue worker not monopolized,
5. rate limit triggers for tenant A only.

---

### 35.7 Admin Access Test

Verify support/admin:

1. cannot access tenant without grant,
2. grant is time-bound,
3. access is audited,
4. export requires additional permission,
5. break-glass records reason.

---

## 36. Observability and Alerting Checklist

Metrics:

1. request count by tenant class,
2. error rate by tenant class,
3. latency by tenant class,
4. rate-limit count by tenant,
5. DB pool usage by tenant if DB-per-tenant,
6. queue lag by tenant,
7. DLQ count by tenant,
8. workflow backlog by tenant,
9. failed authorization by tenant,
10. support access by tenant,
11. config change by tenant,
12. migration status by tenant.

Alerts:

1. tenant-specific error spike,
2. tenant-specific backlog spike,
3. tenant-specific auth failure spike,
4. cross-tenant access denial anomaly,
5. high support access volume,
6. tenant registry inconsistent,
7. tenant migration stuck,
8. tenant DB unavailable,
9. tenant encryption key disabled,
10. tenant rate limit exhausted.

Logs:

1. include tenantId or tenantClass,
2. redact sensitive fields,
3. never log raw token,
4. never log full PII payload,
5. audit admin access.

Traces:

1. tenant context propagated,
2. external call includes tenant-safe metadata,
3. high-risk tenant sampling policy,
4. no PII attributes.

---

## 37. Production Readiness Checklist

### Tenant Model

- [ ] Tenant definition is documented.
- [ ] Tenant is distinct from user, organization, role, and environment.
- [ ] Tenant risk classes are defined.
- [ ] Isolation model is mapped per risk class.
- [ ] Tenant registry exists or is intentionally unnecessary.
- [ ] Tenant lifecycle is defined.

### API

- [ ] Tenant source is explicit.
- [ ] Tenant from client is never blindly trusted.
- [ ] Path/header/token tenant mismatch is handled.
- [ ] Object-level authorization includes tenant.
- [ ] Cross-tenant sharing has explicit grant model.

### Data

- [ ] Every table/read model has tenant strategy.
- [ ] Every repository method is tenant-scoped.
- [ ] Raw SQL is reviewed for tenant predicate.
- [ ] RLS/schema switching session state is reset safely if used.
- [ ] Backup/restore per tenant is defined.
- [ ] Data deletion/retention per tenant is defined.

### Messaging

- [ ] Every message includes tenantId where relevant.
- [ ] DLQ can be analyzed per tenant.
- [ ] Replay can be scoped per tenant.
- [ ] Consumer concurrency is tenant-aware if needed.
- [ ] Poison message from one tenant does not block all tenants.

### Cache/Search/Storage

- [ ] Cache keys include tenant and visibility dimensions.
- [ ] Search queries always include tenant filter or use tenant index/alias.
- [ ] Object storage paths/metadata include tenant.
- [ ] Signed URL generation requires authorization.
- [ ] Sensitive cached data has proper TTL and invalidation.

### Security

- [ ] Tenant-aware authorization is implemented.
- [ ] Admin/support access is tenant-scoped.
- [ ] Break-glass access is audited.
- [ ] Tenant-specific encryption strategy is defined.
- [ ] Tenant context cannot be spoofed.

### Operations

- [ ] Rate limit is tenant-aware.
- [ ] Noisy-neighbor controls exist.
- [ ] Tenant-specific dashboards exist for high-risk tenants.
- [ ] Tenant migration process exists.
- [ ] Tenant offboarding process exists.
- [ ] Config and feature flags are tenant-aware and auditable.

### Testing

- [ ] Two-tenant test data is mandatory.
- [ ] Same-ID different-tenant test exists.
- [ ] Cache leakage test exists.
- [ ] Search leakage test exists.
- [ ] Message replay per tenant is tested.
- [ ] Noisy-neighbor load test exists.
- [ ] Admin/support access test exists.

---

## 38. Architecture Review Questions

Use these questions in design review:

1. What exactly is a tenant in this system?
2. Can one user belong to multiple tenants?
3. Can one tenant have multiple organizations/units?
4. Where does tenant context originate?
5. Can tenant context be spoofed?
6. How is tenant context propagated over HTTP?
7. How is tenant context propagated over messaging?
8. How is tenant context represented in batch jobs?
9. Does every repository method require tenant scope?
10. Can raw SQL bypass tenant filter?
11. What happens if tenantId in URL differs from token?
12. Is cache key tenant-safe?
13. Is search index tenant-safe?
14. Is object storage path tenant-safe?
15. Are logs safe for tenant-specific support access?
16. Are metrics high-cardinality safe?
17. Can one tenant overload the system?
18. Can one tenant's poison message block others?
19. Can one tenant be restored independently?
20. Can one tenant be migrated independently?
21. Can one tenant be deleted/offboarded defensibly?
22. Are tenant configs audited?
23. Are feature flags tenant-scoped?
24. Are admin accesses tenant-scoped and audited?
25. Is cross-tenant sharing explicit and revocable?
26. Are regulatory segments more granular than tenant?
27. How do we prove tenant isolation during audit?
28. How do we detect cross-tenant leakage?
29. How do we contain tenant-specific incident?
30. What is the cost of stronger isolation?

---

## 39. Case Study: Regulatory Case Management Platform

Assume a platform supports multiple regulatory agencies.

### 39.1 Domain

```text
Agency
  -> Application
  -> Case
  -> Enforcement Action
  -> Appeal
  -> Legal Review
  -> Audit Trail
```

Tenants:

```text
Agency A
Agency B
Agency C
```

Segmentation inside tenant:

```text
Licensing Unit
Compliance Unit
Investigation Unit
Legal Unit
Appeal Board
External Applicant
Auditor
```

### 39.2 Naive Design

```text
All agencies share database.
Every table has agency_id.
Roles are global.
Reports query all agencies.
Support can view all data.
Cache key uses application_id only.
Events do not include agency_id.
```

Failure risks:

1. Agency A sees Agency B application,
2. report exposes cross-agency data,
3. support access unaudited,
4. cache returns wrong agency object,
5. event projection mixes agency data,
6. escalation job sends email to wrong agency,
7. legal memo visible to case officer incorrectly.

### 39.3 Improved Design

Tenant model:

```text
Tenant = Agency
Regulatory segment = Unit + Case Assignment + Sensitivity + Workflow Stage
```

Isolation:

```text
Standard agency: shared app + schema-per-agency
High-risk agency: dedicated DB + dedicated encryption key
Sovereign agency: dedicated stack
```

API:

```http
GET /agencies/{agencyId}/applications/{applicationId}
```

Authorization:

```text
principal has access to agencyId
AND principal has unit/assignment permission
AND application belongs to agencyId
AND workflow state allows action
```

Cache:

```text
agency:{agencyId}:application:{applicationId}:visibility:{policyVersion}:{actorScopeHash}
```

Event:

```json
{
  "type": "ApplicationApproved",
  "tenantId": "agency-a",
  "agencyId": "agency-a",
  "unitId": "licensing",
  "actorId": "officer-123",
  "applicationId": "APP-2026-000123",
  "decisionId": "DEC-2026-000456"
}
```

Workflow:

```text
Application Review workflow instance:
- tenantId = agency-a
- processVersion = review-v4
- state = PendingSupervisorApproval
- assignedUnit = licensing
- sensitivity = confidential
```

Audit:

```text
Every read/write/admin access has tenantId, actorId, purpose, objectId, decision.
```

Operations:

```text
Rate limit per agency.
Report worker per tenant class.
Queue lag dashboard per agency.
Tenant-specific incident runbook.
```

---

## 40. Common Anti-Patterns

### 40.1 `tenant_id` Everywhere, Discipline Nowhere

Symptom:

```text
Tables have tenant_id but code frequently forgets it.
```

Fix:

1. repository contract requires tenant,
2. DB-level policy where possible,
3. tests with two tenants,
4. static analysis/query review,
5. cache/search/storage tenant keys.

---

### 40.2 Global Admin Without Audit

Symptom:

```text
Support team can search all tenants without reason or audit.
```

Fix:

1. tenant-scoped support grant,
2. reason code,
3. approval,
4. expiry,
5. audit.

---

### 40.3 Shared Cache Key

Symptom:

```text
Cache key = objectId
```

Fix:

```text
Cache key = tenant + objectId + visibility dimensions
```

---

### 40.4 Batch Job Without Tenant Scope

Symptom:

```text
One nightly job processes all tenants globally.
```

Fix:

1. per-tenant job execution,
2. tenant concurrency limit,
3. tenant failure isolation,
4. tenant audit.

---

### 40.5 Tenant Isolation Only at UI

Symptom:

```text
UI hides data, backend API still allows direct access.
```

Fix:

```text
Backend must enforce object-level tenant authorization.
```

---

### 40.6 Token Role Without Tenant Scope

Symptom:

```json
{
  "roles": ["ADMIN"]
}
```

But admin of what tenant?

Fix:

```json
{
  "tenantRoles": {
    "agency-a": ["ADMIN"],
    "agency-b": ["VIEWER"]
  }
}
```

Or use scoped authorization service.

---

### 40.7 Cross-Tenant Analytics via Production Tables

Symptom:

```text
Reporting team queries production DB across tenants.
```

Fix:

1. governed reporting store,
2. anonymization/pseudonymization,
3. tenant-level access control,
4. aggregate-only views if required,
5. audit queries.

---

## 41. Practical Exercises

### Exercise 1 — Tenant Boundary Review

Pick an existing system and answer:

1. What is the tenant?
2. What is not a tenant?
3. Can a user belong to multiple tenants?
4. Does every table have tenant strategy?
5. Does every API enforce tenant authorization?
6. Does every event include tenant context?
7. Does every cache key include tenant?
8. Does support access have tenant audit?

Deliverable:

```text
Tenant Boundary Decision Record
```

---

### Exercise 2 — Two-Tenant Leakage Test

Create test data:

```text
Tenant A: APP-001, applicant Alice
Tenant B: APP-001, applicant Bob
```

Test:

1. Tenant A reads APP-001 -> Alice
2. Tenant B reads APP-001 -> Bob
3. Tenant A cannot update Tenant B APP-001
4. Cache does not mix Alice/Bob
5. Search returns only tenant-specific result

---

### Exercise 3 — Noisy Neighbor Simulation

Simulate:

```text
Tenant A sends 10x normal traffic.
Tenant B sends normal traffic.
```

Measure:

1. Tenant B p95 latency,
2. DB connection pool usage,
3. queue lag,
4. rate limiting,
5. error rate,
6. circuit breaker state.

Goal:

```text
Tenant A may be degraded; Tenant B should remain healthy within agreed SLO.
```

---

### Exercise 4 — Tenant Migration Design

Design migration:

```text
Tenant agency-a moves from pooled DB to database-per-tenant.
```

Include:

1. data extraction,
2. CDC/dual-write decision,
3. validation,
4. cutover,
5. rollback,
6. tenant registry update,
7. audit evidence,
8. downtime target.

---

### Exercise 5 — Regulatory Segmentation Matrix

Create matrix:

```text
Rows: data/action
Columns: roles/units
Cells: permission and condition
```

Include:

1. applicant,
2. case officer,
3. supervisor,
4. legal,
5. appeal board,
6. auditor,
7. support admin.

---

## 42. Mental Model Summary

Multi-tenancy is not one pattern. It is a set of isolation decisions across layers.

The core model:

```text
Tenant = isolation subject
Tenant context = runtime proof of scope
Tenant isolation = enforcement across layers
Tenant registry = source of tenant placement/configuration
Tenant lifecycle = operational reality
Regulatory segmentation = tenant + policy + legal boundary
```

A system is not tenant-safe because it has `tenant_id` columns.

A system becomes tenant-safe when:

1. tenant context is trustworthy,
2. tenant context is propagated,
3. every resource access is tenant-scoped,
4. every side effect is tenant-scoped,
5. every operational path is tenant-scoped,
6. every admin path is tenant-scoped,
7. every failure can be contained per tenant,
8. every isolation claim can be tested and audited.

Top-tier microservices engineers treat tenant isolation as an invariant, not a convention.

---

## 43. Key Takeaways

1. Tenant is not always user or organization.
2. Tenant isolation is multi-dimensional.
3. `tenant_id` is necessary in some models but never sufficient by itself.
4. API, DB, cache, search, messaging, workflow, batch, observability, and admin tooling must all be tenant-aware.
5. Tenant context must be trusted, propagated, validated, and audited.
6. Shared everything optimizes cost but increases leakage/noisy-neighbor risk.
7. Dedicated stack optimizes isolation but increases operational cost.
8. Hybrid tenancy is common in serious systems.
9. Regulatory segmentation often requires finer boundaries than tenant alone.
10. Multi-tenancy must be tested with at least two tenants and same IDs.
11. Noisy neighbor is a tenancy failure, not just performance issue.
12. Support/admin access is one of the highest-risk tenant paths.
13. Tenant migration/offboarding must be designed before the first large customer asks for it.
14. Tenant isolation must be provable during audit and incident review.

---

## 44. References

- AWS SaaS Architecture Fundamentals — Tenant Isolation: https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html
- AWS SaaS Tenant Isolation Strategies: https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/
- AWS Guidance for Multi-Tenant Architectures: https://docs.aws.amazon.com/solutions/multi-tenant-architectures-on-aws/
- Microsoft Azure Architecture Center — Architect multitenant solutions: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview
- Microsoft Azure Architecture Center — Tenancy models: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
- Microsoft Azure SQL — SaaS tenancy app design patterns: https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns
- OWASP Multi Tenant Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- OWASP API Security — Broken Object Level Authorization: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- OWASP Cloud Tenant Isolation Project: https://owasp.org/www-project-cloud-tenant-isolation/
- Kubernetes Documentation — Multi-tenancy: https://kubernetes.io/docs/concepts/security/multi-tenancy/
- Amazon EKS Best Practices — Tenant Isolation: https://docs.aws.amazon.com/eks/latest/best-practices/tenant-isolation.html

---

# Status Seri

Selesai: Part 21 dari 35.

Seri belum selesai.

Part berikutnya:

```text
Part 22 — Observability Pattern for Microservices
```

File berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-22-observability-patterns.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-20-service-to-service-security-patterns.md">⬅️ Part 20 — Service-to-Service Security Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-22-observability-patterns.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>

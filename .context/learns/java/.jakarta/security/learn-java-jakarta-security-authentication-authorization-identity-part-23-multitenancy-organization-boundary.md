# Part 23 — Multi-Tenancy, Organization Boundary, and Cross-Entity Authorization

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-23-multitenancy-organization-boundary-cross-entity-authorization.md`  
> Target: Java 8–25, Java EE/Jakarta EE, Servlet, JAX-RS, CDI/EJB, Jakarta Security, Jakarta Authorization, enterprise case-management/regulatory systems.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas identity, role, permission, token, session, OIDC, SAML, mTLS, method security, dan security context propagation. Semua itu menjawab pertanyaan:

> “Siapa caller-nya dan apa credential-nya valid?”

Tetapi dalam sistem enterprise yang sebenarnya, terutama sistem regulatory, case management, licensing, enforcement, compliance, atau B2B portal, pertanyaan yang lebih sulit adalah:

> “Caller ini sedang bertindak untuk entitas/organisasi/tenant yang mana, terhadap resource milik siapa, dalam state apa, melalui hubungan apa, dan apakah aksi ini defensible secara bisnis dan audit?”

Multi-tenancy dan cross-entity authorization adalah area tempat banyak authorization bug serius muncul. Bukan karena developer tidak tahu `@RolesAllowed`, tetapi karena model security terlalu datar.

Contoh authorization datar:

```java
@RolesAllowed("OFFICER")
public CaseDto getCase(String caseId) {
    return caseRepository.findById(caseId);
}
```

Kode ini terlihat secured, tetapi belum menjawab:

1. Apakah case tersebut berada dalam agency/tenant yang sama dengan officer?
2. Apakah officer assigned ke case tersebut?
3. Apakah officer boleh melihat semua case atau hanya case dalam division-nya?
4. Apakah officer sedang acting as delegated officer?
5. Apakah case berada di state yang memperbolehkan read/update?
6. Apakah officer punya conflict of interest?
7. Apakah akses ini harus dicatat sebagai audit event?
8. Apakah `caseId` bisa ditebak dari URL dan dipakai untuk horizontal privilege escalation?

Bagian ini membahas cara berpikir dan mendesain authorization yang benar untuk sistem multi-tenant dan cross-entity.

---

## 1. Mental Model Utama

### 1.1 Authentication Tidak Sama Dengan Tenant Resolution

Authentication menjawab:

```text
Apakah caller ini benar-benar Fajar?
```

Tenant resolution menjawab:

```text
Dalam request ini, Fajar sedang bertindak untuk tenant/organization/entity yang mana?
```

Authorization menjawab:

```text
Apakah Fajar, dalam konteks tenant/entity tersebut, boleh melakukan action ini terhadap resource ini sekarang?
```

Tiga proses ini sering bercampur, padahal harus dipisahkan.

```text
Authentication
  -> establishes caller identity

Tenant / organization resolution
  -> establishes active operational boundary

Authorization
  -> evaluates subject + active boundary + action + resource + state + relationship
```

Kalau tenant resolution salah, authorization yang terlihat benar tetap bisa bocor.

---

### 1.2 Multi-Tenancy Bukan Hanya Database Partitioning

Banyak developer menganggap multi-tenancy hanya pilihan database:

1. shared database shared schema,
2. shared database separate schema,
3. separate database per tenant.

Itu hanya storage topology. Security multi-tenant lebih luas:

| Layer | Pertanyaan Security |
|---|---|
| Identity | User ini milik organization mana saja? |
| Session | Active organization sekarang yang mana? |
| Token | Token menyatakan tenant atau hanya subject? |
| API | Tenant diambil dari path, header, claim, atau DB? |
| Service | Apakah downstream service menerima tenant context valid? |
| Repository | Apakah query selalu terfilter tenant? |
| Cache | Apakah cache key include tenant? |
| Audit | Apakah actor dan tenant tercatat? |
| UI | Apakah user bisa switch organization dengan aman? |
| Admin | Apakah support/admin bisa cross-tenant? |

Multi-tenancy harus diperlakukan sebagai **security invariant**, bukan sekadar pilihan persistence.

---

### 1.3 Tenant Boundary Adalah Boundary Otorisasi

Tenant boundary adalah batas yang tidak boleh dilanggar secara tidak sengaja.

Contoh tenant:

1. company,
2. agency,
3. ministry,
4. department,
5. regulator unit,
6. licensee organization,
7. service provider,
8. customer account,
9. case-owning authority,
10. business entity.

Dalam sistem regulatory, tenant bisa memiliki banyak bentuk:

```text
User
  -> belongs to Agency A
  -> temporarily delegated to Agency B
  -> assigned to Case C
  -> can view Entity X
  -> cannot approve Entity X because conflict-of-interest rule
```

Jadi tenant bukan hanya kolom `tenant_id`. Tenant adalah batas meaning, ownership, authority, dan accountability.

---

## 2. Terminologi Penting

### 2.1 Tenant

Tenant adalah boundary isolasi utama. Dalam SaaS, tenant biasanya customer. Dalam government/regulatory system, tenant bisa agency, department, statutory board, organization, atau regulated entity.

Tenant dapat berarti:

```text
resource owner boundary
billing boundary
configuration boundary
data isolation boundary
authorization boundary
audit/reporting boundary
```

Tidak semua sistem memakai istilah tenant, tetapi konsepnya tetap ada.

---

### 2.2 Organization

Organization adalah entitas bisnis tempat user berafiliasi.

Contoh:

```text
User: alice@example.com
Organizations:
  - ABC Pte Ltd
  - XYZ Pte Ltd
  - Regulator Agency A
```

User bisa memiliki banyak organization. Karena itu, `user_id` saja tidak cukup untuk authorization.

---

### 2.3 Active Organization / Active Tenant

Active organization adalah organization yang dipilih untuk request/session saat ini.

Contoh:

```text
Alice login.
Alice punya akses ke Company A dan Company B.
Alice memilih "Act as Company A".
Request berikutnya harus dievaluasi dalam active organization Company A.
```

Tanpa active organization yang eksplisit, sistem sering melakukan implicit guess yang berbahaya.

---

### 2.4 Membership

Membership adalah hubungan user dengan organization.

```text
User U is member of Organization O with role R from date A to date B.
```

Membership biasanya punya atribut:

1. status: active/suspended/revoked/pending,
2. role: admin/member/approver/viewer,
3. source: IdP/local invite/delegation/import,
4. validity period,
5. approval metadata,
6. tenant scope,
7. delegation reason,
8. audit trail.

---

### 2.5 Resource Ownership

Resource ownership menjawab:

```text
Resource ini milik tenant/entity yang mana?
```

Contoh:

```text
Case.case_owner_agency_id
Application.applicant_org_id
Invoice.tenant_id
Document.owner_entity_id
Appeal.original_case_id -> Case.owner_agency_id
```

Authorization yang baik hampir selalu butuh melihat ownership resource.

---

### 2.6 Cross-Entity Access

Cross-entity access terjadi ketika actor dari satu boundary mengakses resource boundary lain.

Contoh sah:

1. regulator melihat application milik company,
2. delegated officer bertindak untuk agency lain,
3. support admin membantu tenant tertentu,
4. auditor membaca semua case lintas agency,
5. central admin melakukan configuration global,
6. inter-agency case handover,
7. appeal authority membaca case dari enforcement unit.

Cross-entity access tidak selalu salah. Yang salah adalah cross-entity access tanpa model, tanpa policy, dan tanpa audit.

---

## 3. Threat Model Multi-Tenant

### 3.1 Horizontal Privilege Escalation

Horizontal privilege escalation terjadi ketika user dengan privilege setara mengakses resource user/tenant lain.

Contoh:

```http
GET /api/tenants/TENANT_A/cases/1001
```

Attacker mengganti ID:

```http
GET /api/tenants/TENANT_A/cases/1002
```

Atau lebih buruk:

```http
GET /api/tenants/TENANT_B/cases/2001
```

Kalau backend hanya mengecek `@RolesAllowed("USER")`, akses bocor.

---

### 3.2 Broken Object Level Authorization

BOLA terjadi ketika API menerima object identifier dari client tetapi tidak membuktikan bahwa caller boleh mengakses object tersebut.

Contoh buruk:

```java
@GET
@Path("/documents/{documentId}")
@RolesAllowed("ORG_USER")
public DocumentDto getDocument(@PathParam("documentId") UUID documentId) {
    return documentRepository.findDto(documentId);
}
```

Aman secara role, tetapi tidak aman secara object.

Versi lebih benar:

```java
@GET
@Path("/organizations/{organizationId}/documents/{documentId}")
@RolesAllowed("ORG_USER")
public DocumentDto getDocument(
        @PathParam("organizationId") UUID organizationId,
        @PathParam("documentId") UUID documentId) {

    Actor actor = actorContext.currentActor();
    OrganizationId activeOrg = tenantResolver.resolveFromPath(organizationId);

    Document doc = documentRepository.findById(documentId)
            .orElseThrow(NotFoundException::new);

    authorizationService.assertAllowed(actor, Action.DOCUMENT_READ, doc, activeOrg);

    return mapper.toDto(doc);
}
```

Tetapi masih perlu hati-hati: response 404 vs 403, audit event, dan repository query harus tenant-safe.

---

### 3.3 Tenant Confusion

Tenant confusion terjadi ketika tenant dari satu sumber bertentangan dengan tenant dari sumber lain.

Contoh request:

```http
GET /api/tenants/A/cases/123
Authorization: Bearer <token with tenant=B>
X-Tenant-Id: C
Cookie: activeTenant=D
```

Pertanyaan:

```text
Tenant mana yang dipercaya?
```

Kalau sistem tidak punya aturan deterministik, attacker bisa memilih sumber yang menguntungkan.

Aturan yang lebih aman:

1. definisikan satu sumber canonical per endpoint,
2. validasi semua sumber lain konsisten atau abaikan,
3. jangan membiarkan client override tenant context sembarangan,
4. log mismatch sebagai suspicious event.

---

### 3.4 Cache Leakage

Cache leakage terjadi ketika cache key tidak memasukkan tenant/actor/permission context.

Contoh buruk:

```java
@CacheResult(cacheName = "case-summary")
public CaseSummary getCaseSummary(UUID caseId) {
    return repository.findSummary(caseId);
}
```

Kalau `caseId` tidak global unique atau response berbeda tergantung tenant/role, data bisa bocor.

Versi lebih aman:

```java
public CacheKey cacheKey(Actor actor, TenantId tenantId, UUID caseId) {
    return new CacheKey("case-summary", tenantId.value(), caseId.toString(), actor.visibilityScopeHash());
}
```

Prinsip:

```text
Jika response dipengaruhi oleh tenant, actor, role, classification, locale, atau permission,
cache key harus memuat dimensi tersebut atau response tidak boleh dicache shared.
```

---

### 3.5 Background Job Leakage

Background job sering tidak punya user session. Kalau job memproses data lintas tenant tanpa context, bug bisa menyebar masif.

Contoh buruk:

```java
public void sendExpiryReminders() {
    List<Application> apps = applicationRepository.findExpiringSoon();
    for (Application app : apps) {
        emailService.sendReminder(app);
    }
}
```

Masalah:

1. tenant context tidak eksplisit,
2. template config mungkin tenant-specific,
3. sender identity mungkin tenant-specific,
4. audit actor tidak jelas,
5. data protection boundary kabur.

Versi lebih aman:

```java
public void sendExpiryReminders() {
    for (TenantId tenantId : tenantRepository.findActiveTenantIds()) {
        SystemActor actor = SystemActor.forTenant(tenantId, "expiry-reminder-job");
        tenantContext.runAs(tenantId, actor, () -> {
            List<Application> apps = applicationRepository.findExpiringSoonForTenant(tenantId);
            for (Application app : apps) {
                authorizationService.assertAllowed(actor, Action.APPLICATION_SEND_REMINDER, app, tenantId);
                emailService.sendReminder(app, actor);
            }
        });
    }
}
```

---

## 4. Authorization Tuple

Untuk sistem multi-tenant, authorization tidak cukup dengan:

```text
user has role X
```

Model yang lebih robust:

```text
Decision = f(subject, action, resource, tenant, state, relationship, context)
```

Atau:

```text
Can actor A perform action P on resource R within tenant T under context C?
```

### 4.1 Subject

Subject adalah actor yang melakukan aksi.

Subject bisa berupa:

1. human user,
2. service account,
3. scheduled job,
4. delegated actor,
5. support admin,
6. external system,
7. impersonated user,
8. on-behalf-of actor.

Subject harus punya identity stabil.

```java
public sealed interface Actor permits HumanActor, ServiceActor, SystemActor {
    ActorId id();
    Set<PrincipalRef> principals();
    Set<TenantMembership> memberships();
}
```

Untuk Java 8, sealed interface tidak tersedia; gunakan interface biasa + controlled constructors/factory.

---

### 4.2 Action

Action adalah operasi bisnis, bukan sekadar HTTP method.

Kurang baik:

```text
GET
POST
PUT
DELETE
```

Lebih baik:

```text
CASE_READ
CASE_ASSIGN
CASE_APPROVE
CASE_REOPEN
CASE_ESCALATE
DOCUMENT_DOWNLOAD
APPLICATION_SUBMIT
APPLICATION_WITHDRAW
LICENSE_SUSPEND
```

HTTP method hanya transport action. Authorization action harus domain action.

---

### 4.3 Resource

Resource adalah object yang dilindungi.

Resource bisa:

1. entity database,
2. aggregate root,
3. generated report,
4. document/blob,
5. workflow transition,
6. dashboard metric,
7. search result,
8. configuration,
9. export file,
10. tenant admin console.

Penting: search result juga resource. Banyak sistem aman pada detail endpoint tetapi bocor pada listing/search/export.

---

### 4.4 Tenant

Tenant adalah boundary operasional.

Tenant bisa berasal dari:

1. path: `/tenants/{tenantId}`,
2. subdomain: `tenant-a.example.com`,
3. header internal terpercaya,
4. token claim,
5. session active tenant,
6. resource ownership,
7. authenticated client registration,
8. database row.

Tidak semua sumber sama kuatnya.

---

### 4.5 State

State adalah lifecycle state resource.

Contoh:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
PENDING_APPROVAL
APPROVED
REJECTED
SUSPENDED
CLOSED
ARCHIVED
```

Authorization sering state-dependent.

```text
Applicant can edit application only when DRAFT or RETURNED_FOR_AMENDMENT.
Officer can approve only when PENDING_APPROVAL.
Approver cannot approve if they prepared the recommendation.
Archived cases are read-only except for records officer.
```

---

### 4.6 Relationship

Relationship menjawab hubungan actor dengan resource.

Contoh:

```text
is owner
is assigned officer
is supervisor of assigned officer
is delegated approver
is case team member
is organization admin
is appeal authority
is auditor
has conflict of interest
```

Role tanpa relationship biasanya terlalu luas.

---

### 4.7 Context

Context adalah kondisi tambahan.

Contoh:

1. waktu,
2. channel,
3. IP/network zone,
4. authentication strength,
5. MFA status,
6. risk score,
7. device posture,
8. emergency mode,
9. case sensitivity,
10. data classification,
11. request purpose,
12. delegation expiry.

Contoh rule:

```text
User boleh melihat document classified RESTRICTED hanya jika:
- user assigned ke case,
- access melalui intranet,
- session MFA masih fresh,
- purpose dicatat,
- document belum sealed.
```

---

## 5. Tenant Resolution Design

### 5.1 Jangan Ambil Tenant Secara Implicit Dari Mana Saja

Anti-pattern:

```java
String tenantId = request.getHeader("X-Tenant-Id");
```

Header dari client bukan sumber terpercaya kecuali diset oleh trusted gateway dan header spoofing dicegah.

Anti-pattern lain:

```java
TenantId tenantId = currentUser.getDefaultTenant();
```

Default tenant berbahaya untuk user multi-organization karena aksi bisa masuk tenant salah.

---

### 5.2 Sumber Tenant Harus Ditentukan Per Interaction Type

| Interaction | Sumber Tenant yang Disarankan |
|---|---|
| Browser session BFF | active tenant dalam server-side session |
| REST API tenant-scoped | path parameter + membership validation |
| Machine-to-machine | token audience/client + tenant claim atau client registration |
| Admin console | explicit tenant selection + elevated permission + audit |
| Webhook inbound | credential/client mapping ke tenant |
| Background job | explicit loop per tenant |
| Message consumer | tenant dalam message envelope yang ditandatangani/terpercaya |

---

### 5.3 Tenant Resolver

Buat tenant resolution sebagai komponen eksplisit.

```java
public interface TenantResolver {
    TenantContext resolve(RequestContext request, Actor actor);
}
```

Contoh model:

```java
public final class TenantContext {
    private final TenantId tenantId;
    private final TenantSource source;
    private final boolean crossTenant;
    private final String reason;

    public TenantContext(TenantId tenantId, TenantSource source, boolean crossTenant, String reason) {
        this.tenantId = Objects.requireNonNull(tenantId);
        this.source = Objects.requireNonNull(source);
        this.crossTenant = crossTenant;
        this.reason = reason;
    }

    public TenantId tenantId() { return tenantId; }
    public TenantSource source() { return source; }
    public boolean crossTenant() { return crossTenant; }
    public String reason() { return reason; }
}
```

Java 16+ bisa memakai record:

```java
public record TenantContext(
        TenantId tenantId,
        TenantSource source,
        boolean crossTenant,
        String reason) {
}
```

---

### 5.4 Tenant Source Precedence

Contoh precedence untuk browser app:

```text
1. authenticated session activeTenant
2. path tenantId must equal activeTenant for tenant-scoped endpoint
3. resource owner tenant must equal activeTenant unless cross-tenant policy allows
4. header tenant ignored unless internal gateway-authenticated
```

Contoh precedence untuk API service:

```text
1. validated access token issuer/audience/client
2. tenant claim or client-to-tenant registration
3. path tenantId must match allowed tenant set
4. resource tenant must match resolved tenant
```

Jangan membiarkan precedence ambigu.

---

### 5.5 Tenant Mismatch Handling

Jika tenant dari path/token/session/resource tidak cocok, jangan otomatis memilih salah satu. Treat as authorization failure atau suspicious request.

```java
if (!pathTenant.equals(sessionTenant)) {
    audit.warn("TENANT_MISMATCH", actor, Map.of(
        "pathTenant", pathTenant,
        "sessionTenant", sessionTenant
    ));
    throw new ForbiddenException("Tenant context mismatch");
}
```

Untuk public API, response bisa generic. Detail masuk audit/log internal.

---

## 6. Organization Membership Model

### 6.1 Membership Bukan Role Sederhana

Membership harus menjadi first-class concept.

```java
public final class Membership {
    private final UserId userId;
    private final OrganizationId organizationId;
    private final Set<OrgRole> roles;
    private final MembershipStatus status;
    private final Instant validFrom;
    private final Instant validUntil;
    private final MembershipSource source;
}
```

Jangan hanya menyimpan:

```text
user.role = ADMIN
```

Karena role tanpa organization tidak menjawab `admin di organization mana`.

---

### 6.2 User Multi-Organization

User bisa berada di banyak organization:

```text
User Alice
  - Company A: OrgAdmin
  - Company B: Viewer
  - Regulator Agency: Officer
```

Maka role harus scoped:

```text
(organization_id, role)
```

Bukan global:

```text
role = ADMIN
```

---

### 6.3 Active Organization Switching

Switch organization harus dianggap security event.

Flow yang sehat:

```text
1. User login.
2. System loads active memberships.
3. User selects organization.
4. System stores active organization in server-side session.
5. System invalidates tenant-scoped caches/CSRF tokens if necessary.
6. Audit event: ACTIVE_ORGANIZATION_SELECTED.
7. All tenant-scoped endpoints validate active organization.
```

Contoh:

```java
@POST
@Path("/session/active-organization")
public Response switchOrganization(SwitchOrganizationRequest req) {
    Actor actor = actorContext.currentActor();

    membershipService.assertActiveMember(actor.userId(), req.organizationId());

    sessionTenantStore.setActiveOrganization(req.organizationId());

    audit.info("ACTIVE_ORGANIZATION_SWITCHED", actor, Map.of(
            "organizationId", req.organizationId().toString()
    ));

    return Response.noContent().build();
}
```

---

### 6.4 Revocation Saat Session Masih Hidup

Jika membership dicabut saat session masih aktif, apa yang terjadi?

Pilihan desain:

1. immediate revocation: session invalidated atau access denied pada next request,
2. near-real-time: membership cache TTL pendek,
3. session-bound snapshot: role berlaku sampai session expiry,
4. hybrid: high-risk permission selalu live-check.

Untuk enterprise/regulatory, rekomendasi:

```text
Membership removal and high-privilege role changes should be effective quickly,
especially for admin/approval/access-to-sensitive-data permissions.
```

Implementasi:

1. membership version dalam session,
2. `user_access_version` di DB/Redis,
3. compare pada request,
4. invalidate session/cache jika version berubah.

```java
public void assertMembershipFresh(Actor actor) {
    long currentVersion = membershipVersionRepository.getVersion(actor.userId());
    if (actor.membershipVersion() < currentVersion) {
        throw new ReauthenticationRequiredException("Membership changed");
    }
}
```

---

## 7. Resource Ownership Modelling

### 7.1 Ownership Harus Ada Di Domain Model

Resource tenant-sensitive harus punya ownership eksplisit.

```java
public interface TenantOwnedResource {
    TenantId tenantId();
}
```

Contoh:

```java
public final class Case implements TenantOwnedResource {
    private CaseId id;
    private TenantId owningAgencyId;
    private CaseStatus status;
    private OfficerId assignedOfficerId;

    @Override
    public TenantId tenantId() {
        return owningAgencyId;
    }
}
```

Kalau ownership hanya bisa disimpulkan melalui chain join yang tidak jelas, authorization akan rapuh.

---

### 7.2 Derived Ownership

Tidak semua resource punya `tenant_id` langsung.

Contoh:

```text
Document -> Case -> Agency
Appeal -> OriginalCase -> Agency
Payment -> Application -> ApplicantOrganization
Attachment -> ParentEntity -> Tenant
```

Derived ownership harus diformalisasi:

```java
public interface ResourceOwnershipResolver<R> {
    TenantId resolveTenant(R resource);
}
```

Jangan copy-paste join ownership di banyak tempat.

---

### 7.3 Ownership Mutation

Resource bisa berpindah tenant/entity?

Contoh:

1. case transferred ke agency lain,
2. company merger,
3. officer reassignment,
4. appeal moved to appeal board,
5. document reclassified.

Ownership mutation harus sangat hati-hati:

```text
ownership change = security boundary change
```

Harus ada:

1. authorization khusus,
2. audit event,
3. cache invalidation,
4. notification jika perlu,
5. re-evaluation of pending tasks,
6. access revocation.

---

## 8. Data Access Enforcement

### 8.1 Authorization Tidak Boleh Hanya Di Controller

Controller-level authorization penting, tetapi tidak cukup.

Anti-pattern:

```java
@RolesAllowed("OFFICER")
public List<CaseDto> searchCases(SearchRequest request) {
    return caseRepository.search(request);
}
```

Kalau repository tidak tenant-aware, search endpoint bocor.

Lebih baik:

```java
public List<CaseDto> searchCases(SearchRequest request) {
    Actor actor = actorContext.currentActor();
    TenantContext tenant = tenantContext.current();

    CaseSearchPolicy policy = authorizationService.caseSearchPolicy(actor, tenant);

    return caseRepository.search(request, policy.toDataScope());
}
```

---

### 8.2 Data Scope

Data scope adalah hasil authorization yang bisa dipakai repository.

```java
public final class DataScope {
    private final TenantId tenantId;
    private final Set<DivisionId> allowedDivisions;
    private final Optional<OfficerId> assignedOnly;
    private final boolean includeArchived;
    private final Set<Classification> maxClassifications;
}
```

Contoh query:

```sql
SELECT c.*
FROM cases c
WHERE c.tenant_id = :tenantId
  AND (:assignedOnly IS NULL OR c.assigned_officer_id = :assignedOnly)
  AND c.division_id IN (:allowedDivisions)
  AND c.classification IN (:allowedClassifications)
```

Authorization service menghasilkan scope; repository menerjemahkan scope menjadi predicate.

---

### 8.3 Find By ID Harus Tenant-Aware

Anti-pattern paling umum:

```java
caseRepository.findById(caseId)
```

Lebih baik:

```java
caseRepository.findByIdAndTenant(caseId, tenantId)
```

Atau jika butuh 403 vs 404 distinction:

```java
Optional<Case> anyCase = caseRepository.findById(caseId);
if (anyCase.isEmpty()) {
    throw new NotFoundException();
}

authorizationService.assertAllowed(actor, Action.CASE_READ, anyCase.get(), tenantContext);
```

Trade-off:

| Approach | Pro | Kontra |
|---|---|---|
| `findByIdAndTenant` | mengurangi leakage | sulit bedakan not found vs forbidden |
| `findById` lalu authorize | bisa audit denial | harus hati-hati jangan expose existence |

Untuk API eksternal, sering response tetap 404 agar tidak memberi sinyal resource existence. Audit internal tetap mencatat forbidden attempt.

---

### 8.4 List/Search/Export Lebih Berbahaya Dari Detail

Developer sering mengamankan detail endpoint tetapi lupa search/export.

Contoh endpoint berbahaya:

```text
GET /api/cases/search?companyName=A
GET /api/reports/export-all
GET /api/documents/recent
GET /api/dashboard/statistics
```

Data leakage bisa terjadi lewat:

1. count,
2. autocomplete,
3. dropdown,
4. CSV export,
5. dashboard aggregate,
6. timeline feed,
7. notification list,
8. audit view,
9. document metadata,
10. error message.

Prinsip:

```text
Every query that returns resource data must be scoped.
Every aggregate that reveals tenant data must be scoped.
Every export must be authorized separately.
```

---

## 9. Database-Level Defense

### 9.1 App-Level Authorization Tetap Wajib

Database-level defense bukan pengganti app-level authorization. Namun untuk multi-tenancy, defense-in-depth di database sangat berharga.

Pilihan:

1. row tenant column,
2. schema per tenant,
3. database per tenant,
4. database row-level security,
5. views with tenant predicate,
6. stored procedures enforcing tenant,
7. separate DB user per tenant/service.

---

### 9.2 Shared Schema + Tenant Column

Model:

```sql
CREATE TABLE cases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL,
    assigned_officer_id UUID,
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_cases_tenant_id_id ON cases(tenant_id, id);
CREATE INDEX idx_cases_tenant_status ON cases(tenant_id, status);
```

Pro:

1. operationally simple,
2. cost efficient,
3. good for many tenants,
4. easy cross-tenant reporting if authorized.

Kontra:

1. high blast radius if predicate missing,
2. cache key harus hati-hati,
3. migration per tenant lebih sulit,
4. noisy neighbor risk.

Invarian:

```text
Every tenant-owned table must have tenant_id or deterministic ownership chain.
Every query must apply tenant predicate unless explicitly cross-tenant and audited.
```

---

### 9.3 Schema Per Tenant

Model:

```text
tenant_a.cases
tenant_b.cases
tenant_c.cases
```

Pro:

1. stronger accidental isolation,
2. backup/restore per tenant lebih mudah,
3. privilege boundary bisa lebih kuat.

Kontra:

1. operational complexity,
2. migration many schemas,
3. connection/schema switching,
4. cross-tenant analytics lebih sulit.

---

### 9.4 Database Per Tenant

Pro:

1. strongest operational isolation,
2. easier tenant-level restore,
3. better noisy-neighbor isolation,
4. compliance-friendly for some contexts.

Kontra:

1. high cost,
2. many connections,
3. many migrations,
4. cross-tenant reporting complex,
5. configuration sprawl.

---

### 9.5 Row-Level Security

Beberapa database mendukung row-level security. Namun aplikasi Java/Jakarta harus tetap membawa tenant context ke DB secara aman.

Pattern:

```text
request -> resolve tenant -> set DB session variable -> DB policy filters rows
```

Risiko:

1. connection pooling lupa reset session variable,
2. tenant context leak antar request,
3. privileged connection bypass policy,
4. batch job salah set tenant,
5. policy terlalu kompleks dan sulit dites.

Jika memakai connection pool seperti HikariCP, pastikan tenant/session variable dibersihkan saat connection dikembalikan ke pool.

---

## 10. Jakarta/JPA Repository Pattern Untuk Tenant Safety

### 10.1 Tenant-Aware Repository Interface

Buat repository contract yang memaksa tenant context.

```java
public interface TenantScopedRepository<ID, E extends TenantOwnedResource> {
    Optional<E> findById(TenantId tenantId, ID id);
    List<E> findAll(TenantId tenantId, PageRequest pageRequest);
}
```

Tujuan: mencegah developer memakai `findById(id)` secara tidak sengaja.

---

### 10.2 Criteria Builder Dengan Scope

```java
public List<Case> search(CaseSearchRequest request, DataScope scope) {
    CriteriaBuilder cb = em.getCriteriaBuilder();
    CriteriaQuery<Case> cq = cb.createQuery(Case.class);
    Root<Case> root = cq.from(Case.class);

    List<Predicate> predicates = new ArrayList<>();
    predicates.add(cb.equal(root.get("tenantId"), scope.tenantId()));

    if (scope.assignedOnly().isPresent()) {
        predicates.add(cb.equal(root.get("assignedOfficerId"), scope.assignedOnly().get()));
    }

    if (!scope.allowedDivisions().isEmpty()) {
        predicates.add(root.get("divisionId").in(scope.allowedDivisions()));
    }

    cq.where(predicates.toArray(new Predicate[0]));
    return em.createQuery(cq).getResultList();
}
```

---

### 10.3 Tenant Filter Anti-Pattern

Beberapa ORM punya filter tenant otomatis. Itu membantu, tapi jangan membuat tim berpikir authorization selesai.

Masalah filter otomatis:

1. bisa tidak aktif pada native query,
2. bisa bypass pada admin connection,
3. tidak menangani relationship/state permission,
4. tidak cocok untuk cross-tenant admin,
5. bisa salah untuk aggregate/report.

Gunakan sebagai defense-in-depth, bukan satu-satunya authorization.

---

## 11. Cross-Tenant Admin

### 11.1 Cross-Tenant Admin Harus Explicit

Admin global sering menjadi sumber kebocoran.

Anti-pattern:

```java
if (actor.hasRole("ADMIN")) {
    return repository.findAll();
}
```

Lebih baik:

```text
Global admin privilege is not equal to automatic access to all tenant data.
```

Pisahkan:

1. platform configuration admin,
2. tenant support admin,
3. security admin,
4. data auditor,
5. break-glass admin,
6. tenant delegated admin.

---

### 11.2 Purpose-Bound Access

Untuk support/admin cross-tenant, akses harus punya purpose.

```java
public final class CrossTenantAccessRequest {
    private final TenantId targetTenant;
    private final CrossTenantPurpose purpose;
    private final String ticketNumber;
    private final Duration duration;
}
```

Flow:

```text
1. Admin requests access to tenant X.
2. System checks admin has support role.
3. System requires reason/ticket.
4. Optional approval required.
5. Temporary access context created.
6. All actions audited with target tenant and reason.
7. Access expires automatically.
```

---

### 11.3 Break-Glass Access

Break-glass adalah emergency override.

Harus memiliki:

1. explicit activation,
2. strong authentication/MFA,
3. reason mandatory,
4. time-boxed duration,
5. alert to security/admin,
6. immutable audit trail,
7. post-incident review,
8. minimal permission set.

Jangan implement break-glass sebagai hidden superuser account tanpa audit.

---

## 12. Delegation and Acting On Behalf Of

### 12.1 Delegation Bukan Impersonation Biasa

Impersonation:

```text
System pretends admin is Alice.
```

Delegation/on-behalf-of:

```text
Admin Bob acts on behalf of Alice, but Bob remains visible as executor.
```

Audit harus menyimpan:

```text
initiator = Bob
represented_subject = Alice / Organization A
action = SUBMIT_APPLICATION
resource = Application 123
tenant = Organization A
reason = support ticket / formal delegation
```

---

### 12.2 Actor Model Untuk Delegation

```java
public final class EffectiveActor {
    private final ActorId executorId;
    private final Optional<ActorId> representedUserId;
    private final TenantId activeTenantId;
    private final Set<Permission> effectivePermissions;
    private final DelegationContext delegation;
}
```

Jangan overwrite principal menjadi user yang diwakili tanpa menyimpan executor asli.

---

### 12.3 Delegation Expiry

Delegation harus punya validity.

```text
Delegation:
  from_user = Alice
  to_user = Bob
  tenant = Company A
  permissions = APPLICATION_SUBMIT, DOCUMENT_UPLOAD
  valid_from = 2026-06-01
  valid_until = 2026-06-30
  reason = maternity cover
  approved_by = OrgAdmin
```

Authorization check:

```java
boolean allowedByDelegation = delegationService.hasActiveDelegation(
        representedUser,
        executor,
        tenant,
        action,
        clock.instant()
);
```

---

## 13. Tenant Context and SecurityContext

### 13.1 Jangan Memasukkan Semua Tenant Logic Ke `SecurityContext`

Jakarta Security `SecurityContext` menyediakan caller principal dan role check. Tetapi tenant context biasanya domain-specific.

Jangan memaksa semua menjadi role:

```text
ROLE_TENANT_A_ADMIN
ROLE_TENANT_B_ADMIN
ROLE_TENANT_C_VIEWER
```

Ini akan meledak.

Lebih baik:

```text
SecurityContext -> who is caller?
TenantContext -> active tenant/organization?
AuthorizationService -> can caller do action in this tenant against this resource?
```

---

### 13.2 Bridge Dari SecurityContext Ke Actor

```java
@RequestScoped
public class ActorContext {
    @Inject
    SecurityContext securityContext;

    @Inject
    MembershipService membershipService;

    public Actor currentActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new UnauthenticatedException();
        }

        UserId userId = UserId.fromPrincipal(principal.getName());
        List<Membership> memberships = membershipService.findActiveMemberships(userId);

        return HumanActor.authenticated(userId, principal, memberships);
    }
}
```

Catatan: jangan load membership dari DB berkali-kali tanpa cache/freshness strategy.

---

### 13.3 Tenant Context Request Scoped

```java
@RequestScoped
public class CurrentTenant {
    private TenantContext tenantContext;

    public TenantContext get() {
        if (tenantContext == null) {
            throw new IllegalStateException("Tenant context not resolved");
        }
        return tenantContext;
    }

    public void set(TenantContext tenantContext) {
        if (this.tenantContext != null) {
            throw new IllegalStateException("Tenant context already set");
        }
        this.tenantContext = tenantContext;
    }
}
```

Tenant context sebaiknya immutable setelah resolved untuk request.

---

## 14. API Design Untuk Tenant Safety

### 14.1 URL Design

Tenant-scoped endpoint sebaiknya eksplisit:

```http
GET /api/organizations/{organizationId}/applications/{applicationId}
POST /api/agencies/{agencyId}/cases/{caseId}/assign
GET /api/tenants/{tenantId}/reports/monthly
```

Tetapi path tenant bukan otomatis dipercaya. Tetap harus divalidasi dengan membership dan resource ownership.

---

### 14.2 Jangan Campur Global ID dan Tenant ID Tanpa Verifikasi

Misalnya:

```http
GET /api/organizations/A/applications/999
```

Backend harus membuktikan:

```text
application 999 belongs to organization A
caller can access organization A
caller can perform APPLICATION_READ on application 999
```

Jangan hanya pakai `organizationId` untuk UI breadcrumb.

---

### 14.3 404 vs 403

Dalam multi-tenant API, response error harus dipilih hati-hati.

| Situation | External Response | Internal Audit |
|---|---|---|
| Resource tidak ada | 404 | optional |
| Resource ada tapi tenant lain | 404 atau 403 | wajib audit suspicious/denied |
| Caller tenant mismatch | 403 | wajib audit |
| Unauthenticated | 401 | auth audit |
| Authenticated but no permission | 403 | authorization audit |

Untuk resource existence yang sensitif, gunakan 404 agar attacker tidak bisa enumerate.

---

## 15. Authorization Service Design

### 15.1 Interface

```java
public interface AuthorizationService {
    AuthorizationDecision decide(Actor actor, Action action, ResourceRef resource, TenantContext tenantContext);

    default void assertAllowed(Actor actor, Action action, ResourceRef resource, TenantContext tenantContext) {
        AuthorizationDecision decision = decide(actor, action, resource, tenantContext);
        if (!decision.allowed()) {
            throw new ForbiddenException(decision.safeMessage());
        }
    }
}
```

Decision object:

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final DenialCode denialCode;
    private final String safeMessage;
    private final Map<String, Object> auditAttributes;
}
```

---

### 15.2 Policy Composition

Authorization policy bisa terdiri dari beberapa rule:

```text
allow if:
  actor is active member of tenant
  AND resource belongs to tenant
  AND actor has permission CASE_APPROVE
  AND case.status == PENDING_APPROVAL
  AND actor != case.preparedBy
  AND actor has no conflict of interest
  AND tenant is not suspended
```

Kode:

```java
public AuthorizationDecision canApproveCase(Actor actor, Case c, TenantContext tenant) {
    return DecisionChain.start()
        .require(() -> actor.isAuthenticated(), "UNAUTHENTICATED")
        .require(() -> actor.isActiveMemberOf(tenant.tenantId()), "NOT_TENANT_MEMBER")
        .require(() -> c.tenantId().equals(tenant.tenantId()), "RESOURCE_OUTSIDE_TENANT")
        .require(() -> actor.hasPermission(tenant.tenantId(), Permission.CASE_APPROVE), "MISSING_PERMISSION")
        .require(() -> c.status() == CaseStatus.PENDING_APPROVAL, "INVALID_CASE_STATE")
        .require(() -> !c.preparedBy().equals(actor.id()), "MAKER_CHECKER_VIOLATION")
        .require(() -> !conflictService.hasConflict(actor, c), "CONFLICT_OF_INTEREST")
        .allow();
}
```

---

### 15.3 Denial Codes

Gunakan denial code internal yang stabil.

```text
NOT_TENANT_MEMBER
RESOURCE_OUTSIDE_TENANT
MISSING_PERMISSION
INVALID_RESOURCE_STATE
MAKER_CHECKER_VIOLATION
DELEGATION_EXPIRED
TENANT_SUSPENDED
CROSS_TENANT_ACCESS_REQUIRES_REASON
```

Manfaat:

1. audit lebih jelas,
2. test lebih deterministik,
3. debugging lebih cepat,
4. UI bisa menampilkan pesan aman,
5. policy review lebih mudah.

---

## 16. Tenant-Safe Caching

### 16.1 Cache Key Harus Tenant-Aware

Buruk:

```java
cache.get("case:" + caseId)
```

Lebih aman:

```java
cache.get("tenant:" + tenantId + ":case:" + caseId)
```

Jika response dipengaruhi role:

```java
cache.get("tenant:" + tenantId + ":case:" + caseId + ":visibility:" + visibilityHash)
```

---

### 16.2 Authorization Cache

Caching permission bisa berguna, tetapi berbahaya.

Pertanyaan:

1. Berapa TTL?
2. Apa invalidation trigger saat role berubah?
3. Apakah permission tergantung state resource?
4. Apakah permission tergantung delegation expiry?
5. Apakah cache include tenant?
6. Apakah cache include actor?
7. Apakah cache include policy version?

Model cache key:

```text
authz:{policyVersion}:{actorId}:{tenantId}:{action}:{resourceType}:{resourceId}:{resourceVersion}
```

Jika resource state berubah, `resourceVersion` berubah.

---

### 16.3 Cache Negative Decisions?

Negative decision bisa dicache, tetapi hati-hati:

1. user baru diberi role,
2. delegation baru dibuat,
3. case assigned ke user,
4. tenant status berubah.

Untuk high-risk authorization, lebih baik TTL pendek atau no cache.

---

## 17. Event, Message, and Outbox Multi-Tenancy

### 17.1 Message Envelope Harus Memuat Tenant

```json
{
  "eventId": "...",
  "eventType": "CaseAssigned",
  "tenantId": "agency-a",
  "actorId": "officer-123",
  "resourceId": "case-999",
  "occurredAt": "2026-06-17T10:00:00Z",
  "correlationId": "..."
}
```

Consumer tidak boleh menebak tenant dari resource ID saja jika message bisa diproses lintas tenant.

---

### 17.2 Message Authentication

Kalau message dari external system, tenant di payload tidak otomatis dipercaya. Harus ada:

1. signature,
2. mTLS client identity,
3. client registration,
4. issuer validation,
5. replay prevention,
6. idempotency.

---

### 17.3 Outbox Pattern

Outbox harus tenant-aware.

```sql
CREATE TABLE outbox_event (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload CLOB NOT NULL,
    created_at TIMESTAMP NOT NULL,
    published_at TIMESTAMP NULL
);
```

Publisher harus menjaga tenant context ketika mengirim event.

---

## 18. Audit Model Untuk Multi-Tenant Authorization

### 18.1 Audit Field Minimal

Audit event authorization harus memuat:

```text
actor_id
actor_type
executor_id
represented_subject_id
active_tenant_id
target_tenant_id
resource_type
resource_id
action
decision
reason_code
policy_version
request_id
correlation_id
ip_address / client_id
user_agent / service_name
timestamp
```

Untuk cross-tenant access:

```text
cross_tenant = true
purpose
approval_id
ticket_number
expiry
```

---

### 18.2 Audit Actor vs Subject

Jangan hanya simpan `user_id`.

Contoh:

```text
executor = support_admin_bob
represented = company_user_alice
active_tenant = company_a
action = APPLICATION_SUBMIT
```

Jika hanya mencatat Alice, maka Bob bisa menyembunyikan aksinya. Jika hanya Bob, business context hilang.

---

### 18.3 Audit Denied Access

Denied access juga penting.

Terutama:

1. tenant mismatch,
2. resource outside tenant,
3. repeated ID enumeration,
4. cross-tenant attempt,
5. expired delegation,
6. admin without purpose,
7. permission check after role revoked.

Denied audit bukan sekadar security monitoring; ini membantu debugging dan defensibility.

---

## 19. Testing Strategy

### 19.1 Permission Matrix

Buat matrix:

| Actor | Tenant | Resource Tenant | Relationship | State | Action | Expected |
|---|---|---|---|---|---|---|
| OrgAdmin A | A | A | owner org | DRAFT | APPLICATION_EDIT | allow |
| OrgAdmin A | A | B | none | DRAFT | APPLICATION_EDIT | deny |
| Officer A | A | A | assigned | PENDING | CASE_APPROVE | allow/deny depends maker-checker |
| Officer A | A | A | preparer | PENDING | CASE_APPROVE | deny |
| SupportAdmin | platform | A | purpose active | any | CASE_READ | allow + audit |
| SupportAdmin | platform | A | no purpose | any | CASE_READ | deny |

---

### 19.2 BOLA Tests

Untuk setiap endpoint yang menerima ID:

1. valid actor + own tenant + own resource = allowed,
2. valid actor + own tenant + other tenant resource = denied/404,
3. valid actor + other tenant path + own resource = denied,
4. valid actor + guessed ID = denied/404,
5. no auth = 401,
6. wrong role = 403.

---

### 19.3 Search/Export Tests

Test bukan hanya detail endpoint.

```text
Given tenant A and tenant B data exist
When tenant A user searches all cases
Then tenant B cases must not appear
And total count must not include tenant B
And export must not include tenant B
And dashboard aggregate must not include tenant B
```

---

### 19.4 Cache Tests

Test cache leakage:

```text
1. User A reads resource in tenant A.
2. User B reads same numeric ID in tenant B.
3. Response must not reuse tenant A cached object.
```

---

### 19.5 Revocation Tests

```text
Given user has role APPROVER in tenant A
And user session is active
When role APPROVER is revoked
Then next approval action must be denied
And audit should record stale membership/session refresh
```

---

## 20. Common Anti-Patterns

### 20.1 Global Role Explosion

```text
TENANT_A_ADMIN
TENANT_B_ADMIN
TENANT_C_ADMIN
```

Masalah:

1. tidak scalable,
2. role name coupling dengan tenant,
3. sulit revoke,
4. token terlalu besar,
5. migration susah.

Lebih baik:

```text
membership: user -> tenant -> role
```

---

### 20.2 Trusting Tenant Header From Browser

```http
X-Tenant-Id: tenant-b
```

Kalau browser bisa mengirim header, attacker bisa mengubahnya.

Gunakan:

1. server-side session active tenant,
2. path tenant + membership validation,
3. gateway-set header yang client header-nya di-strip.

---

### 20.3 UI-Only Tenant Filtering

UI menyembunyikan tenant lain, tetapi API tetap menerima tenant/resource ID lain.

Ini bukan security.

---

### 20.4 Repository `findAll()` Dalam Endpoint Tenant

```java
return repository.findAll();
```

Dalam sistem multi-tenant, `findAll()` harus dicurigai.

---

### 20.5 Cross-Tenant Admin Tanpa Reason

Admin bisa melihat semua tenant data tanpa reason, ticket, approval, atau audit. Ini sulit dipertahankan di environment regulated.

---

### 20.6 Cache Key Tidak Memuat Tenant

Sudah dibahas, tetapi sangat umum dan sangat berbahaya.

---

### 20.7 Tenant Context Disimpan Dalam Static/ThreadLocal Tanpa Cleanup

Thread reuse bisa menyebabkan tenant leak.

```java
static ThreadLocal<TenantId> currentTenant = new ThreadLocal<>();
```

Jika tidak `remove()` dalam finally, request berikutnya bisa memakai tenant sebelumnya.

---

## 21. Java 8–25 Considerations

### 21.1 Java 8

Java 8 masih banyak dipakai di legacy Java EE.

Keterbatasan:

1. tidak ada records,
2. tidak ada sealed classes,
3. tidak ada virtual threads,
4. context propagation sering manual,
5. `Optional` ada tetapi belum sematang usage modern,
6. immutable data class verbose.

Rekomendasi:

1. gunakan final fields,
2. static factory,
3. explicit value objects,
4. avoid mutable tenant context,
5. test ThreadLocal cleanup.

---

### 21.2 Java 11/17

Java 11/17 sering menjadi baseline enterprise modern.

Manfaat:

1. better TLS defaults,
2. better HTTP client sejak Java 11,
3. records tersedia sejak Java 16,
4. sealed classes sejak Java 17,
5. modern library compatibility.

Untuk model security:

```java
public record TenantId(String value) {
    public TenantId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("tenant id is required");
        }
    }
}
```

---

### 21.3 Java 21–25

Java 21 membawa virtual threads sebagai fitur final. Java 25 adalah LTS berikutnya setelah Java 21.

Perhatian:

1. ThreadLocal tetap ada, tetapi propagation harus dipikir ulang.
2. Jangan mengasumsikan security context otomatis ikut ke virtual thread baru.
3. Structured concurrency/scoped values bisa membantu desain context eksplisit, tergantung versi dan status fitur.
4. Library/container support harus dicek.

Prinsip tetap:

```text
Tenant context and actor context must be explicit at boundary.
Do not rely on accidental thread affinity.
```

---

## 22. Design Blueprint

### 22.1 Request Lifecycle Tenant-Safe

```text
1. Request enters container.
2. Authentication mechanism establishes caller principal.
3. ActorContext maps principal to actor/memberships.
4. TenantResolver resolves active tenant from canonical source.
5. TenantResolver validates membership/consistency.
6. Resource is loaded tenant-safely or ownership is resolved.
7. AuthorizationService evaluates actor + action + resource + tenant + state + relationship.
8. Repository applies DataScope.
9. Response is filtered/mapped according to permission.
10. Audit records decision and action.
```

---

### 22.2 Layering

```text
Controller / Resource
  - parse request
  - resolve tenant/resource IDs
  - call application service

Application Service
  - transaction boundary
  - authorization orchestration
  - business operation

Authorization Service
  - policy evaluation
  - permission decision
  - denial code

Tenant Service
  - membership
  - active tenant
  - tenant status

Repository
  - tenant-aware data access
  - data scope predicates

Audit Service
  - records actor/tenant/resource/action/decision
```

---

### 22.3 Example End-to-End

```java
@POST
@Path("/agencies/{agencyId}/cases/{caseId}/approve")
@RolesAllowed("OFFICER")
@Transactional
public Response approveCase(
        @PathParam("agencyId") UUID agencyId,
        @PathParam("caseId") UUID caseId,
        ApproveCaseRequest request) {

    Actor actor = actorContext.currentActor();
    TenantContext tenant = tenantResolver.resolveAgencyPath(actor, new TenantId(agencyId));

    Case c = caseRepository.findByIdAndTenant(new TenantId(agencyId), new CaseId(caseId))
            .orElseThrow(NotFoundException::new);

    authorizationService.assertAllowed(actor, Action.CASE_APPROVE, c, tenant);

    c.approve(actor.id(), request.decision(), request.comment(), clock.instant());

    audit.record(AuditEvent.success(
            actor,
            tenant,
            Action.CASE_APPROVE,
            ResourceRef.caseRef(c.id()),
            Map.of("caseStatus", c.status().name())
    ));

    return Response.noContent().build();
}
```

Kekuatan desain ini:

1. role check tetap ada sebagai coarse gate,
2. tenant path divalidasi,
3. repository tenant-aware,
4. domain authorization tetap mengecek state/relationship,
5. business action mencatat actor,
6. audit eksplisit.

---

## 23. Review Checklist

Gunakan checklist ini saat review sistem multi-tenant.

### 23.1 Identity and Membership

- [ ] Apakah user bisa punya banyak organization?
- [ ] Apakah role scoped per organization/tenant?
- [ ] Apakah membership punya status dan validity?
- [ ] Apakah revocation berlaku saat session masih hidup?
- [ ] Apakah delegated access dimodelkan eksplisit?

### 23.2 Tenant Resolution

- [ ] Apakah canonical tenant source jelas per endpoint?
- [ ] Apakah tenant mismatch ditolak?
- [ ] Apakah tenant header dari browser tidak dipercaya?
- [ ] Apakah active tenant switching diaudit?
- [ ] Apakah background job explicit per tenant?

### 23.3 Resource Ownership

- [ ] Apakah semua resource sensitive punya owner tenant?
- [ ] Apakah derived ownership diformalisasi?
- [ ] Apakah ownership transfer diaudit?
- [ ] Apakah resource ID lookup tenant-safe?

### 23.4 Authorization

- [ ] Apakah authorization memakai subject/action/resource/tenant/state/relationship?
- [ ] Apakah search/export/dashboard scoped?
- [ ] Apakah denial code deterministik?
- [ ] Apakah cross-tenant admin butuh reason/purpose?
- [ ] Apakah break-glass time-boxed dan audited?

### 23.5 Data and Cache

- [ ] Apakah query selalu tenant-scoped?
- [ ] Apakah native query direview?
- [ ] Apakah cache key memuat tenant?
- [ ] Apakah authorization cache punya invalidation?
- [ ] Apakah DB/session variable dibersihkan di connection pool?

### 23.6 Audit

- [ ] Apakah audit menyimpan actor dan represented actor?
- [ ] Apakah active tenant dan target tenant dicatat?
- [ ] Apakah denied access diaudit?
- [ ] Apakah cross-tenant access punya purpose/ticket?
- [ ] Apakah policy version tercatat?

---

## 24. Intisari

Multi-tenancy dan cross-entity authorization adalah area tempat security system diuji secara nyata.

Mental model penting:

```text
Authentication establishes who the caller is.
Tenant resolution establishes where/for whom the caller is acting.
Authorization establishes whether that caller may perform this action on this resource in this tenant under this state and relationship.
```

Role saja tidak cukup. Tenant ID saja tidak cukup. Token claim saja tidak cukup. Path parameter saja tidak cukup. UI filtering tidak cukup.

Sistem yang defensible harus memiliki:

1. actor model jelas,
2. tenant/organization model eksplisit,
3. membership scoped dan revocable,
4. resource ownership formal,
5. authorization tuple kaya,
6. data access scoped,
7. cache tenant-safe,
8. cross-tenant access purpose-bound,
9. audit lengkap,
10. test untuk horizontal privilege escalation.

Dalam konteks Jakarta/Java enterprise, `SecurityContext`, Servlet/JAX-RS, CDI/EJB, Jakarta Security, dan Jakarta Authorization memberi fondasi. Tetapi tenant-aware authorization adalah desain domain yang harus dibuat secara sadar oleh engineer.

---

## 25. Referensi

- Jakarta Security 4.0 Specification — https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta Authorization 3.0 Specification — https://jakarta.ee/specifications/authorization/3.0/jakarta-authorization-spec-3.0
- Jakarta Persistence 3.2 Specification — https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2
- OWASP Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Multi Tenant Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

---

## 26. Status Seri

Selesai:

```text
Part 23 — Multi-Tenancy, Organization Boundary, and Cross-Entity Authorization
```

Seri belum selesai.

Berikutnya:

```text
Part 24 — Domain Authorization for Case Management and Workflow Systems
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-22-security-context-propagation.md">⬅️ Part 22 — Security Context Propagation: Threads, Executors, Async, Virtual Threads, Reactive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-security-authentication-authorization-identity-part-24-domain-authorization-case-management-workflow.md">Part 24 — Domain Authorization for Case Management and Workflow Systems ➡️</a>
</div>

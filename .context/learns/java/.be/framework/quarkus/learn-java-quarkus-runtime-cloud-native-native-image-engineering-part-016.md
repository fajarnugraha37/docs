# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-016

# Part 016 — Security II: Authorization Model, Policy Enforcement, RBAC/ABAC, Method Security

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / Production / Architecture  
> Fokus: authorization model di Quarkus, bukan sekadar annotation security  
> Status: Part 016 dari maksimal 35 part  
> Prasyarat: Part 015 tentang Authentication, OIDC, Keycloak, JWT, Token Propagation

---

## 0. Tujuan Part Ini

Pada Part 015 kita sudah membahas authentication: bagaimana request membuktikan identitasnya melalui OIDC, JWT, Keycloak, token propagation, service-to-service identity, dan `SecurityIdentity`.

Part ini naik satu level:

> Setelah sistem tahu **siapa** pemanggilnya, bagaimana sistem memutuskan **apa yang boleh dilakukan**?

Di banyak aplikasi enterprise, authorization sering direduksi menjadi:

```java
@RolesAllowed("ADMIN")
```

Itu cukup untuk demo, tetapi tidak cukup untuk sistem nyata yang memiliki:

- user internal dan eksternal,
- multi-role,
- multi-tenant,
- ownership,
- delegated access,
- acting-on-behalf-of,
- approval workflow,
- state machine,
- escalation,
- regulatory audit,
- read/write separation,
- historical visibility,
- case confidentiality,
- module-level permissions,
- feature flags,
- service-to-service calls,
- operation-level permission,
- object-level permission.

Dalam sistem seperti itu, pertanyaan sebenarnya bukan lagi:

> Apakah user punya role ADMIN?

Tetapi:

> Apakah identity ini, dalam konteks tenant ini, terhadap resource ini, pada state ini, melalui channel ini, dengan delegation ini, boleh menjalankan operation ini, dan apakah keputusan tersebut bisa diaudit?

Itulah authorization engineering.

---

## 1. Authentication vs Authorization

Authentication menjawab:

```text
Who are you?
```

Authorization menjawab:

```text
What are you allowed to do?
```

Contoh:

```text
User: alice
Authenticated: yes
Roles: CASE_OFFICER, REVIEWER
Tenant: agency-a
Department: enforcement
Request: approve case CASE-123
Case owner agency: agency-a
Case assigned officer: bob
Case state: PENDING_REVIEW
```

Pertanyaan authorization:

```text
Bolehkah alice approve CASE-123?
```

Jawabannya tidak cukup dari role.

Mungkin:

- `REVIEWER` boleh approve,
- tetapi tidak boleh approve case yang dibuat sendiri,
- hanya boleh approve case dalam agency yang sama,
- hanya boleh approve jika case dalam state `PENDING_REVIEW`,
- tidak boleh approve jika ada conflict-of-interest flag,
- boleh approve jika delegated reviewer aktif,
- semua keputusan harus dicatat untuk audit.

Authorization adalah **policy decision over identity + action + resource + context**.

---

## 2. Mental Model Authorization yang Sehat

Model authorization yang baik minimal punya lima komponen:

```text
Subject  +  Action  +  Resource  +  Context  =>  Decision
```

Contoh:

```text
Subject:
  userId = alice
  roles = [REVIEWER]
  tenant = agency-a

Action:
  APPROVE_CASE

Resource:
  caseId = CASE-123
  ownerAgency = agency-a
  state = PENDING_REVIEW
  createdBy = bob

Context:
  channel = intranet
  requestTime = 2026-06-20T10:00
  delegation = none
  mfa = true

Decision:
  ALLOW
```

Atau:

```text
Decision:
  DENY(reason = "same_user_cannot_approve_own_case")
```

Ini jauh lebih kuat daripada:

```java
@RolesAllowed("REVIEWER")
```

Karena annotation role hanya melihat sebagian kecil dari realitas.

---

## 3. Authorization Layer di Quarkus

Quarkus menyediakan beberapa level authorization:

1. Endpoint/path-level security
2. Annotation-based method security
3. Programmatic authorization via `SecurityIdentity`
4. Permission-based authorization
5. Custom identity augmentation
6. HTTP security policy
7. External authorization integration
8. Domain-level authorization service

Secara praktis, production-grade Quarkus service biasanya memakai kombinasi:

```text
HTTP security config
        ↓
method-level coarse gate
        ↓
domain authorization service
        ↓
resource ownership/state check
        ↓
audit decision
```

Jangan menaruh semua authorization di annotation.

Annotation cocok sebagai coarse-grained guard.

Domain authorization harus tetap eksplisit di service/domain layer.

---

## 4. SecurityIdentity sebagai Runtime Identity Object

Di Quarkus, identity yang sudah diautentikasi direpresentasikan oleh `SecurityIdentity`.

Konsepnya:

```java
@Inject
SecurityIdentity identity;
```

Identity biasanya berisi:

- principal,
- roles,
- credentials,
- attributes,
- permissions,
- authentication mechanism metadata.

Contoh penggunaan:

```java
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class CurrentUserService {

    @Inject
    SecurityIdentity identity;

    public String username() {
        return identity.getPrincipal().getName();
    }

    public boolean hasRole(String role) {
        return identity.hasRole(role);
    }

    public <T> T attribute(String name) {
        return identity.getAttribute(name);
    }
}
```

Tetapi hati-hati:

```java
identity.hasRole("ADMIN")
```

bukan authorization lengkap.

Itu hanya predicate sederhana.

---

## 5. Common Security Annotations di Quarkus

Quarkus mendukung annotation standar Jakarta Security/Jakarta Annotation dan annotation tambahan.

Umumnya:

```java
@PermitAll
@DenyAll
@RolesAllowed
@Authenticated
```

Contoh:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/admin")
public class AdminResource {

    @GET
    @RolesAllowed("ADMIN")
    public String adminOnly() {
        return "admin";
    }
}
```

`@RolesAllowed` menjawab:

```text
Apakah identity memiliki salah satu role yang disebutkan?
```

Bukan:

```text
Apakah identity boleh melakukan operasi domain tertentu?
```

Quarkus juga menyediakan `io.quarkus.security.Authenticated` untuk endpoint yang hanya perlu identity valid tanpa role spesifik.

```java
import io.quarkus.security.Authenticated;

@Authenticated
public class ProfileResource {
}
```

Maknanya:

```text
Semua authenticated user boleh masuk.
```

Tetapi operation internal tetap perlu check domain.

---

## 6. `@PermitAll` Bukan Selalu “Public Full Access”

`@PermitAll` berarti method boleh dipanggil tanpa role restriction.

Tetapi dalam Quarkus, security juga bisa diatur melalui HTTP path policy di config.

Contoh:

```properties
quarkus.http.auth.permission.public.paths=/public/*
quarkus.http.auth.permission.public.policy=permit

quarkus.http.auth.permission.secured.paths=/api/*
quarkus.http.auth.permission.secured.policy=authenticated
```

Jika path-level policy membatasi `/api/*`, maka annotation di method tidak boleh dibaca secara naïf sebagai satu-satunya sumber kebenaran.

Prinsip:

> Authorization efektif adalah hasil gabungan antara HTTP policy, annotation security, identity, dan domain logic.

---

## 7. Deny-by-Default

Untuk sistem serius, gunakan mental model:

```text
Default: DENY
Allow only by explicit rule.
```

Jangan:

```text
Default: ALLOW unless blocked.
```

Alasannya:

- endpoint baru bisa lupa diberi annotation,
- role baru bisa kebetulan match,
- module baru bisa terbuka,
- path config bisa terlalu luas,
- service internal bisa dipanggil dari channel salah,
- object-level check bisa lupa.

Contoh path policy:

```properties
quarkus.http.auth.permission.public.paths=/q/health/*,/q/metrics,/openapi/*
quarkus.http.auth.permission.public.policy=permit

quarkus.http.auth.permission.api.paths=/api/*
quarkus.http.auth.permission.api.policy=authenticated
```

Lalu di code:

```java
@Path("/api/cases")
@Authenticated
public class CaseResource {
}
```

Dan di service:

```java
authorization.requireCanViewCase(caseId);
```

---

## 8. Role-Based Access Control / RBAC

RBAC adalah model paling umum:

```text
User has Role
Role grants Permission
Permission allows Action
```

Contoh:

```text
alice -> CASE_REVIEWER
CASE_REVIEWER -> CASE_VIEW, CASE_APPROVE
```

Di Quarkus annotation sederhana:

```java
@RolesAllowed("CASE_REVIEWER")
public CaseDto getCase(String id) {
    ...
}
```

Masalahnya:

```text
CASE_REVIEWER boleh view case apa?
Semua case?
Hanya tenant sendiri?
Hanya assigned case?
Hanya case bukan restricted?
Hanya case aktif?
```

RBAC cocok untuk coarse gate:

```text
Apakah user termasuk kelas actor yang mungkin melakukan operasi ini?
```

RBAC tidak cukup untuk object-level decision.

---

## 9. Permission-Based Authorization

Quarkus mendukung permission-based authorization melalui `@PermissionsAllowed`.

Contoh konseptual:

```java
import io.quarkus.security.PermissionsAllowed;

@PermissionsAllowed("case:read")
public CaseDto readCase(String id) {
    ...
}
```

Permission lebih granular daripada role.

Role:

```text
CASE_REVIEWER
```

Permission:

```text
case:read
case:approve
case:assign
case:close
case:reopen
case:export
case:delete
```

Namun permission saja juga belum cukup jika tidak mengandung resource context.

```text
case:approve
```

belum menjawab:

```text
case yang mana?
state apa?
tenant apa?
siapa creator?
```

Maka permission-based annotation bagus untuk **operation-level coarse gate**, tetapi object-level check tetap perlu domain authorization.

---

## 10. Jangan Campur Semua Annotation secara Buta

Contoh kurang baik:

```java
@RolesAllowed("REVIEWER")
@PermissionsAllowed("case:approve")
public void approve(...) {
}
```

Secara desain, ini juga membingungkan:

- apakah role dan permission harus dua-duanya benar?
- apakah salah satu cukup?
- apakah role dipakai sebagai coarse gate dan permission fine gate?
- apa yang di-audit?
- siapa owner policy?

Lebih sehat:

```java
@PermissionsAllowed("case:approve")
public Response approve(...) {
    caseCommandService.approve(...);
}
```

Lalu di service:

```java
authorization.requireCanApproveCase(caseId);
```

Atau:

```java
@RolesAllowed("CASE_REVIEWER")
public Response approve(...) {
    authorization.requireCanApproveCase(caseId);
    caseCommandService.approve(...);
}
```

Kuncinya: jangan membuat policy tersebar tanpa desain.

---

## 11. Attribute-Based Access Control / ABAC

ABAC memakai attributes.

Contoh attributes:

Subject attributes:

```text
userId
agency
department
clearanceLevel
employmentType
groups
delegation
mfa
channel
```

Resource attributes:

```text
tenantId
ownerAgency
classification
state
createdBy
assignedTo
amount
riskLevel
```

Context attributes:

```text
requestTime
networkZone
authMethod
deviceTrust
ipRange
country
operationMode
```

Policy:

```text
ALLOW if
  subject.agency == resource.ownerAgency
  AND subject.role contains REVIEWER
  AND resource.state == PENDING_REVIEW
  AND resource.createdBy != subject.userId
  AND context.mfa == true
```

ABAC lebih ekspresif daripada RBAC.

Tetapi ABAC juga lebih sulit:

- policy bisa sulit dipahami,
- performance bisa mahal,
- audit reason harus jelas,
- data dependency bertambah,
- testing matrix meledak.

Gunakan ABAC untuk aturan yang memang object/context-sensitive.

---

## 12. Policy Decision Point dan Policy Enforcement Point

Gunakan dua konsep:

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
```

PEP adalah tempat enforcement terjadi.

Contoh PEP:

- REST resource,
- service method,
- command handler,
- message consumer,
- scheduler job,
- GraphQL resolver,
- gRPC method.

PDP adalah tempat keputusan dibuat.

Contoh PDP:

- `CaseAuthorizationService`,
- external policy engine,
- Keycloak Authorization Services,
- OPA,
- custom permission service.

Contoh desain:

```java
@Path("/api/cases/{caseId}/approve")
public class CaseApprovalResource {

    private final CaseApplicationService service;
    private final CaseAuthorizationService authorization;

    public CaseApprovalResource(
            CaseApplicationService service,
            CaseAuthorizationService authorization
    ) {
        this.service = service;
        this.authorization = authorization;
    }

    @POST
    @RolesAllowed("CASE_REVIEWER")
    public Response approve(@PathParam("caseId") String caseId, ApproveRequest request) {
        authorization.requireCanApprove(caseId);
        service.approve(caseId, request);
        return Response.noContent().build();
    }
}
```

Resource method adalah PEP.

`CaseAuthorizationService` adalah PDP lokal.

---

## 13. Domain Authorization Service

Untuk sistem kompleks, buat authorization service eksplisit:

```java
@ApplicationScoped
public class CaseAuthorizationService {

    private final SecurityIdentity identity;
    private final CaseRepository caseRepository;

    public CaseAuthorizationService(
            SecurityIdentity identity,
            CaseRepository caseRepository
    ) {
        this.identity = identity;
        this.caseRepository = caseRepository;
    }

    public void requireCanApprove(String caseId) {
        AuthorizationDecision decision = canApprove(caseId);

        if (decision.denied()) {
            throw new ForbiddenOperationException(decision.reasonCode());
        }
    }

    public AuthorizationDecision canApprove(String caseId) {
        CaseRecord c = caseRepository.getRequired(caseId);

        if (!identity.hasRole("CASE_REVIEWER")) {
            return AuthorizationDecision.deny("missing_case_reviewer_role");
        }

        String userId = identity.getPrincipal().getName();

        if (c.createdBy().equals(userId)) {
            return AuthorizationDecision.deny("creator_cannot_approve_own_case");
        }

        String userAgency = identity.getAttribute("agency");
        if (!c.ownerAgency().equals(userAgency)) {
            return AuthorizationDecision.deny("cross_agency_access_denied");
        }

        if (c.state() != CaseState.PENDING_REVIEW) {
            return AuthorizationDecision.deny("case_not_pending_review");
        }

        return AuthorizationDecision.allow();
    }
}
```

Ini terlihat lebih panjang daripada annotation.

Tetapi ini memberi:

- explainability,
- testability,
- auditability,
- domain ownership,
- reason code,
- clear boundary,
- easier refactoring.

---

## 14. AuthorizationDecision sebagai First-Class Object

Jangan hanya return boolean.

Kurang baik:

```java
boolean allowed = canApprove(caseId);
```

Lebih baik:

```java
public record AuthorizationDecision(
        boolean allowed,
        String reasonCode,
        Map<String, Object> evidence
) {
    public static AuthorizationDecision allow() {
        return new AuthorizationDecision(true, "allowed", Map.of());
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(false, reasonCode, Map.of());
    }

    public boolean denied() {
        return !allowed;
    }
}
```

Kenapa?

Karena production butuh menjawab:

```text
Kenapa user ditolak?
Aturan mana yang gagal?
Apakah denial ini harus dilog?
Apakah reason boleh ditampilkan ke user?
Apakah reason hanya untuk audit internal?
```

Boolean tidak cukup.

---

## 15. Public Error vs Internal Reason

Jangan selalu expose reason internal ke client.

Contoh internal reason:

```text
cross_agency_access_denied
case_classified_as_sensitive
investigation_conflict_of_interest
watchlist_visibility_denied
```

Jika diexpose mentah, bisa membocorkan informasi.

Lebih aman:

HTTP response:

```json
{
  "type": "https://example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "ACCESS_DENIED",
  "message": "You are not allowed to perform this operation."
}
```

Internal audit:

```json
{
  "event": "AUTHORIZATION_DENIED",
  "userId": "alice",
  "operation": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "CASE-123",
  "reason": "creator_cannot_approve_own_case",
  "tenant": "agency-a"
}
```

Prinsip:

> Client gets safe error. Audit gets precise reason.

---

## 16. 401 vs 403

Bedakan:

```text
401 Unauthorized = request belum authenticated / credential invalid.
403 Forbidden = authenticated, tetapi tidak boleh.
```

Contoh:

- token tidak ada → 401
- token expired → 401
- token valid tetapi role tidak cukup → 403
- token valid tetapi object beda tenant → 403
- token valid tetapi operation tidak boleh di state itu → 403

Jangan return 404 untuk semua authorization denial kecuali ada alasan security yang jelas untuk menyembunyikan existence.

Pattern:

```text
Resource confidentiality high:
  unauthorized access may return 404 to avoid enumeration.

General business operation:
  return 403 with generic public error.
```

Tetapi audit internal tetap harus mencatat denial.

---

## 17. Resource Ownership Check

Salah satu bug authorization paling umum:

```text
User bisa akses resource milik user/tenant lain dengan mengganti ID.
```

Contoh buruk:

```java
@GET
@Path("/{caseId}")
@RolesAllowed("CASE_VIEWER")
public CaseDto get(@PathParam("caseId") String caseId) {
    return caseService.get(caseId);
}
```

Masalah:

```text
CASE_VIEWER role tidak memastikan caseId milik tenant/agency/user yang benar.
```

Lebih aman:

```java
@GET
@Path("/{caseId}")
@RolesAllowed("CASE_VIEWER")
public CaseDto get(@PathParam("caseId") String caseId) {
    authorization.requireCanViewCase(caseId);
    return caseService.get(caseId);
}
```

Atau repository scoped:

```java
public CaseRecord getVisibleCase(String caseId, CurrentActor actor) {
    return entityManager.createQuery("""
        select c
        from CaseRecord c
        where c.id = :caseId
          and c.ownerAgency = :agency
        """, CaseRecord.class)
        .setParameter("caseId", caseId)
        .setParameter("agency", actor.agency())
        .getSingleResult();
}
```

Defense-in-depth:

- authorization service check,
- repository scoped query,
- database row-level security jika relevan,
- audit denied attempts.

---

## 18. Tenant Boundary

Multi-tenant authorization harus eksplisit.

Jangan hanya:

```java
identity.hasRole("ADMIN")
```

Tanyakan:

```text
ADMIN untuk tenant mana?
Global admin atau tenant admin?
Boleh cross-tenant?
Apakah tenant dari token trusted?
Apakah tenant dari URL harus sama dengan token?
```

Contoh:

```java
@Path("/api/tenants/{tenantId}/cases")
public class TenantCaseResource {

    @GET
    @RolesAllowed("CASE_VIEWER")
    public List<CaseDto> list(@PathParam("tenantId") String tenantId) {
        authorization.requireTenantAccess(tenantId);
        return caseService.listForTenant(tenantId);
    }
}
```

Policy:

```java
public void requireTenantAccess(String tenantId) {
    String actorTenant = identity.getAttribute("tenant");

    if (!tenantId.equals(actorTenant) && !identity.hasRole("GLOBAL_ADMIN")) {
        throw new ForbiddenOperationException("tenant_mismatch");
    }
}
```

Invariant:

> Tenant from request must never be trusted without comparison against authenticated identity.

---

## 19. Role Mapping: Token Role vs Application Role

OIDC token sering berisi role dari IdP.

Contoh token:

```json
{
  "sub": "alice",
  "realm_access": {
    "roles": ["offline_access", "uma_authorization", "case-reviewer"]
  },
  "resource_access": {
    "aceas-api": {
      "roles": ["case-reviewer", "case-approver"]
    }
  }
}
```

Aplikasi harus memutuskan:

```text
Role mana yang dipakai?
Realm role?
Client role?
Group?
Scope?
Custom claim?
```

Jangan biarkan role mapping informal.

Buat mapping eksplisit:

```text
IdP role                  Application role
------------------------------------------------
aceas-api:case-reviewer   CASE_REVIEWER
aceas-api:case-approver   CASE_APPROVER
group:/agency-a/reviewer  AGENCY_REVIEWER
```

Kalau mapping dilakukan di Quarkus identity augmentor, dokumentasikan.

Kalau mapping dilakukan di Keycloak mapper, dokumentasikan.

Kalau mapping dilakukan di gateway, dokumentasikan.

---

## 20. SecurityIdentityAugmentor

Kadang identity dari token belum cukup.

Misalnya token hanya punya:

```text
sub = alice
roles = [user]
```

Aplikasi butuh:

```text
agency
department
case permissions
delegations
clearance
```

Quarkus memungkinkan custom `SecurityIdentityAugmentor`.

Contoh konseptual:

```java
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.SecurityIdentityAugmentor;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ApplicationSecurityIdentityAugmentor implements SecurityIdentityAugmentor {

    @Override
    public Uni<SecurityIdentity> augment(
            SecurityIdentity identity,
            AuthenticationRequestContext context
    ) {
        if (identity.isAnonymous()) {
            return Uni.createFrom().item(identity);
        }

        String userId = identity.getPrincipal().getName();

        return context.runBlocking(() -> {
            UserAccessProfile profile = loadAccessProfile(userId);

            QuarkusSecurityIdentity.Builder builder =
                    QuarkusSecurityIdentity.builder(identity);

            for (String role : profile.roles()) {
                builder.addRole(role);
            }

            builder.addAttribute("agency", profile.agency());
            builder.addAttribute("department", profile.department());
            builder.addAttribute("clearance", profile.clearance());

            return builder.build();
        });
    }

    private UserAccessProfile loadAccessProfile(String userId) {
        // Load from DB/cache/external IAM.
        throw new UnsupportedOperationException("example");
    }
}
```

Catatan penting:

- identity augmentation bisa berdampak latency,
- jangan query database per request tanpa cache jika traffic tinggi,
- hati-hati blocking operation dalam reactive request,
- pikirkan invalidation saat permission berubah,
- audit sumber role/attribute.

---

## 21. Permission as Data

Pada sistem besar, permission tidak selalu hardcoded.

Contoh tabel:

```sql
user_permission (
  user_id,
  tenant_id,
  permission_code,
  resource_type,
  resource_id,
  valid_from,
  valid_until
)
```

Atau:

```sql
role_permission (
  role_code,
  permission_code
)
```

Atau delegation:

```sql
delegation (
  from_user,
  to_user,
  permission_code,
  resource_type,
  valid_from,
  valid_until,
  status
)
```

Keuntungan:

- permission bisa diubah tanpa deploy,
- audit bisa melihat siapa memberi akses,
- cocok untuk delegation,
- cocok untuk temporary role,
- cocok untuk restricted case.

Risiko:

- performance query authorization,
- stale cache,
- policy menjadi data yang sulit dikontrol,
- change management lebih kompleks,
- butuh admin UI,
- butuh audit atas perubahan permission.

---

## 22. Authorization Cache

Authorization sering butuh data:

- role mapping,
- group membership,
- tenant membership,
- delegation,
- clearance,
- resource metadata.

Jika semua query dilakukan setiap request, sistem bisa lambat.

Cache berguna, tetapi berbahaya.

Cache design harus menjawab:

```text
Apa key-nya?
Apa value-nya?
Berapa TTL?
Bagaimana invalidation?
Apakah deny juga dicache?
Apakah permission revoke harus immediate?
Apakah cache per-node atau distributed?
Apakah cache boleh stale?
```

Contoh:

```text
UserAccessProfile cache:
  key: userId + tenantId
  ttl: 5 minutes
  invalidate: user permission update event
```

Untuk high-risk operation:

```text
Do not rely only on cache.
Fetch latest or use short TTL.
```

Contoh high-risk:

- approve case,
- delete record,
- export sensitive data,
- assign investigator,
- override decision,
- close enforcement case.

---

## 23. Method Security vs Domain Security

Method security:

```java
@RolesAllowed("CASE_REVIEWER")
public void approveCase(...) { }
```

Domain security:

```java
authorization.requireCanApprove(caseId);
```

Perbandingan:

| Aspek | Method Security | Domain Security |
|---|---|---|
| Cocok untuk | coarse gate | object/context decision |
| Bisa lihat resource state? | sulit | ya |
| Bisa reason code? | terbatas | ya |
| Bisa audit detail? | terbatas | ya |
| Mudah dibaca? | ya | butuh struktur |
| Risiko over-simplification | tinggi | rendah |
| Cocok untuk regulatory system | hanya sebagai lapisan awal | wajib |

Gunakan keduanya, tapi jangan menggantikan domain security dengan annotation.

---

## 24. Authorization untuk Command vs Query

Tidak semua operation sama.

Query:

```text
view case
list cases
download document
search person
export report
```

Command:

```text
create case
approve case
reject appeal
assign officer
close investigation
send notice
```

Query authorization biasanya fokus pada visibility.

Command authorization fokus pada capability + state transition.

Contoh query:

```java
authorization.requireCanViewCase(caseId);
```

Contoh command:

```java
authorization.requireCanTransitionCase(caseId, CaseAction.APPROVE);
```

Untuk command, policy harus mempertimbangkan:

- actor role,
- current state,
- requested transition,
- ownership,
- assignment,
- conflict of interest,
- required checklist,
- mandatory fields,
- delegated authority,
- deadline/SLA,
- previous approvals.

---

## 25. Authorization untuk State Machine

Dalam workflow system, authorization harus melekat ke transition.

Contoh state:

```text
DRAFT
SUBMITTED
PENDING_REVIEW
APPROVED
REJECTED
CLOSED
```

Transition:

```text
SUBMIT
ASSIGN_REVIEWER
APPROVE
REJECT
REOPEN
CLOSE
```

Authorization matrix:

| State | Action | Allowed Actor | Extra Condition |
|---|---|---|---|
| DRAFT | SUBMIT | CASE_CREATOR | creator == actor |
| SUBMITTED | ASSIGN_REVIEWER | CASE_MANAGER | same agency |
| PENDING_REVIEW | APPROVE | CASE_REVIEWER | actor != creator |
| PENDING_REVIEW | REJECT | CASE_REVIEWER | actor != creator |
| CLOSED | REOPEN | CASE_MANAGER | within reopen window |

Code pattern:

```java
public void requireCanTransition(String caseId, CaseAction action) {
    CaseRecord c = caseRepository.getRequired(caseId);
    CurrentActor actor = currentActor();

    CaseTransitionPolicy policy = transitionPolicyRegistry.get(c.state(), action);

    AuthorizationDecision decision = policy.evaluate(actor, c);

    if (decision.denied()) {
        throw new ForbiddenOperationException(decision.reasonCode());
    }
}
```

Ini jauh lebih kuat daripada menyebarkan role check di banyak endpoint.

---

## 26. Authorization untuk List/Search Endpoint

List endpoint sering bocor data.

Buruk:

```java
@GET
@RolesAllowed("CASE_VIEWER")
public List<CaseDto> search(@QueryParam("agency") String agency) {
    return repository.search(agency);
}
```

User bisa mengganti query parameter.

Lebih aman:

```java
public List<CaseDto> search(SearchCaseRequest request) {
    CurrentActor actor = currentActor();

    SearchCaseCriteria criteria = SearchCaseCriteria.from(request)
            .restrictedToVisibleScope(actor);

    return repository.search(criteria);
}
```

Rule:

> Authorization untuk search/list harus diterapkan di query predicate, bukan filter setelah data diambil.

Kenapa?

- menghindari data leakage,
- lebih efisien,
- pagination benar,
- count benar,
- audit scope jelas.

Contoh SQL predicate:

```sql
where c.owner_agency = :actorAgency
  and c.classification <= :actorClearance
```

Jangan:

```java
repository.searchAll()
    .stream()
    .filter(c -> authorization.canView(c).allowed())
```

Untuk dataset besar, itu salah secara security dan performance.

---

## 27. Field-Level Authorization

Kadang user boleh melihat resource, tapi tidak semua field.

Contoh:

```text
Case visible:
  id
  status
  createdDate
  assignedOfficer

Restricted fields:
  informantName
  investigationNotes
  internalRiskScore
  enforcementRecommendation
```

DTO mapping harus sadar authorization:

```java
public CaseDto toDto(CaseRecord c, CurrentActor actor) {
    return new CaseDto(
            c.id(),
            c.status(),
            c.createdDate(),
            actor.canViewSensitiveFields() ? c.informantName() : null,
            actor.canViewInternalNotes() ? c.internalNotes() : null
    );
}
```

Lebih baik explicit field mask:

```java
public record CaseViewPolicy(
        boolean canViewSensitiveFields,
        boolean canViewInternalNotes,
        boolean canViewAuditTrail
) {}
```

Lalu mapper:

```java
CaseViewPolicy policy = authorization.viewPolicyFor(c);
return mapper.toDto(c, policy);
```

Jangan hanya rely pada frontend hiding.

---

## 28. Action-Level Authorization di UI

Backend tetap sumber kebenaran.

Tetapi UI butuh tahu action apa yang boleh ditampilkan.

Pattern:

```json
{
  "id": "CASE-123",
  "status": "PENDING_REVIEW",
  "allowedActions": [
    "APPROVE",
    "REJECT",
    "REQUEST_INFO"
  ]
}
```

Backend menghitung:

```java
AllowedActions actions = authorization.allowedActionsForCase(caseId);
```

Manfaat:

- UI tidak hardcode role logic,
- UX lebih baik,
- action button tidak muncul salah,
- policy tetap centralized.

Tetapi:

> allowedActions untuk UI bukan enforcement final. Command endpoint tetap wajib enforce ulang.

Karena state/resource bisa berubah setelah UI render.

---

## 29. Time-of-Check to Time-of-Use / TOCTOU

Masalah:

```text
Check authorization.
Resource berubah.
Execute command.
```

Contoh:

```java
authorization.requireCanApprove(caseId);
caseService.approve(caseId);
```

Di antara check dan approve:

- case state berubah,
- assignment berubah,
- permission dicabut,
- deadline lewat.

Mitigasi:

1. Check dekat dengan write operation.
2. Gunakan transaction boundary.
3. Gunakan optimistic locking.
4. Validate state transition inside same transaction.
5. Jangan rely pada allowedActions UI.
6. Audit final decision at command time.

Contoh:

```java
@Transactional
public void approve(String caseId, ApproveCommand command) {
    CaseRecord c = caseRepository.getForUpdateOrOptimistic(caseId);

    authorization.requireCanApprove(c);

    c.approve(command.reason(), currentActor.userId());
}
```

---

## 30. Authorization dan Transaction Boundary

Authorization kadang butuh DB state.

Jika command dan authorization membaca state yang sama, sebaiknya satu transaction.

Contoh:

```java
@Transactional
public void closeCase(String caseId) {
    CaseRecord c = caseRepository.getRequired(caseId);

    authorization.requireCanClose(c);

    c.close(currentActor.userId());
}
```

Jangan:

```java
authorization.requireCanClose(caseId); // transaction A
caseService.close(caseId);             // transaction B
```

Jika ada race condition, hasilnya bisa salah.

Rule:

> For state-changing command, authorization decision should be based on the same state that the command modifies.

---

## 31. Authorization pada Message Consumer

Jangan lupa authorization tidak hanya HTTP.

Message consumer juga melakukan action.

Contoh:

```java
@Incoming("case-approval-events")
public Uni<Void> consume(CaseApprovalEvent event) {
    ...
}
```

Pertanyaan:

```text
Siapa actor?
Apakah event trusted?
Apakah event membawa service identity?
Apakah producer authorized?
Apakah event sudah divalidasi?
Apakah event replay boleh?
```

Pattern:

- service-to-service identity pada channel,
- event signature jika perlu,
- producer authorization,
- consumer idempotency,
- domain validation,
- audit actor = system/service/user-on-behalf-of.

Contoh actor model:

```text
actorType = SERVICE
actorId = case-orchestrator
onBehalfOf = alice
correlationId = ...
```

Jangan menganggap semua event internal aman.

---

## 32. Authorization pada Scheduler/Batch Job

Scheduler berjalan tanpa user interactive.

Contoh:

```java
@Scheduled(cron = "0 0 1 * * ?")
void autoCloseExpiredCases() { ... }
```

Pertanyaan:

```text
Actor-nya siapa?
Apakah job boleh close semua tenant?
Apakah ada tenant exclusion?
Apakah ada approval required?
Apakah action harus diaudit sebagai system?
```

Gunakan system actor eksplisit:

```java
CurrentActor systemActor = CurrentActor.system("auto-close-expired-cases");
```

Audit:

```json
{
  "actorType": "SYSTEM",
  "actorId": "auto-close-expired-cases",
  "operation": "CASE_AUTO_CLOSE",
  "resourceId": "CASE-123"
}
```

Jangan biarkan scheduler bypass domain invariant.

Scheduler boleh bypass user permission, tetapi tidak boleh bypass business invariant.

---

## 33. Service-to-Service Authorization

Dalam microservices, tidak cukup berkata:

```text
Request dari internal network.
```

Butuh service identity.

Contoh:

```text
report-service calls case-service
```

Case service harus tahu:

```text
caller service = report-service
allowed operation = case:read-summary
tenant scope = agency-a
purpose = reporting
```

Policy:

```text
report-service boleh read summary
report-service tidak boleh approve case
report-service tidak boleh read investigation notes
```

Implementation:

- mTLS identity,
- JWT client credentials,
- OAuth2 token exchange,
- audience validation,
- scope validation,
- service role mapping,
- endpoint-level policy,
- downstream audit.

Contoh:

```java
@RolesAllowed("svc-report-reader")
public CaseSummaryDto summary(String caseId) {
    authorization.requireServiceCanReadSummary(caseId);
    ...
}
```

---

## 34. Delegated Authorization

Enterprise apps sering memiliki delegation:

```text
Alice delegated approval authority to Bob from 2026-06-01 to 2026-06-10.
```

Model:

```text
Delegation:
  fromUser
  toUser
  permissions
  tenant
  resourceScope
  validFrom
  validUntil
  status
  reason
```

Policy:

```text
Bob can approve if:
  Bob has base role eligible for delegation
  delegation active
  permission includes CASE_APPROVE
  resource in delegated scope
  action not prohibited
```

Audit harus mencatat:

```text
actor = bob
delegatedFrom = alice
operation = CASE_APPROVE
```

Jangan mengganti identity Bob menjadi Alice.

Itu merusak audit.

---

## 35. Acting on Behalf Of

Kadang service melakukan action on behalf of user.

Contoh:

```text
frontend -> gateway -> case-service -> notification-service
```

Notification service menerima request dari case-service, tetapi action berasal dari Alice.

Actor model:

```java
public record CurrentActor(
        ActorType type,
        String actorId,
        String onBehalfOf,
        String tenant,
        Set<String> roles
) {}
```

Contoh:

```text
type = SERVICE
actorId = case-service
onBehalfOf = alice
```

Policy harus jelas:

- apakah service allowed to act on behalf of user?
- apakah user permission tetap dicek?
- apakah service permission juga dicek?
- apakah chain terlalu panjang?
- bagaimana audit dilakukan?

---

## 36. Policy Placement Anti-Pattern

### Anti-pattern 1: Authorization di frontend

```text
Hide button if role != ADMIN.
```

Itu UX, bukan security.

### Anti-pattern 2: Authorization tersebar di controller

```java
if (identity.hasRole("X")) ...
if (identity.hasRole("Y")) ...
```

Hasil:

- susah audit,
- susah test,
- inconsistent,
- sulit refactor.

### Anti-pattern 3: Generic admin bypass

```java
if (identity.hasRole("ADMIN")) return allow();
```

Admin pun harus punya scope.

Lebih baik:

```text
GLOBAL_ADMIN
TENANT_ADMIN
MODULE_ADMIN
SECURITY_ADMIN
SUPPORT_ADMIN
READONLY_AUDITOR
```

### Anti-pattern 4: Role name sebagai business rule

```java
if (role.equals("SENIOR_CASE_REVIEWER")) approveHighRiskCase();
```

Lebih baik:

```text
permission = CASE_APPROVE_HIGH_RISK
```

### Anti-pattern 5: Authorization setelah data loaded semua

```java
List<Case> all = repository.findAll();
filterVisible(all);
```

Salah untuk data leakage dan performance.

### Anti-pattern 6: Permission without reason

```java
throw new ForbiddenException();
```

Operationally poor.

Butuh reason internal.

---

## 37. Testing Authorization

Authorization harus diuji sebagai matrix.

Contoh matrix:

| Actor | Role | Tenant | Case State | Case Creator | Expected |
|---|---|---|---|---|---|
| Alice | REVIEWER | A | PENDING_REVIEW | Bob | ALLOW |
| Alice | REVIEWER | A | PENDING_REVIEW | Alice | DENY |
| Alice | VIEWER | A | PENDING_REVIEW | Bob | DENY |
| Alice | REVIEWER | B | PENDING_REVIEW | Bob | DENY |
| Alice | REVIEWER | A | CLOSED | Bob | DENY |

Unit test authorization service:

```java
class CaseAuthorizationServiceTest {

    @Test
    void reviewer_can_approve_case_in_same_agency_not_created_by_self() {
        // arrange
        // actor: REVIEWER agency-a
        // case: owner agency-a, creator bob, state PENDING_REVIEW

        // act
        AuthorizationDecision decision = authorization.canApprove(caseId);

        // assert
        assertTrue(decision.allowed());
    }

    @Test
    void creator_cannot_approve_own_case() {
        AuthorizationDecision decision = authorization.canApprove(caseId);

        assertFalse(decision.allowed());
        assertEquals("creator_cannot_approve_own_case", decision.reasonCode());
    }
}
```

Quarkus security testing bisa memakai `@TestSecurity` untuk mensimulasikan identity.

Contoh konseptual:

```java
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.junit.jupiter.api.Test;

@QuarkusTest
class CaseResourceSecurityTest {

    @Test
    @TestSecurity(user = "alice", roles = {"CASE_REVIEWER"})
    void reviewer_can_call_approve_endpoint() {
        // call endpoint and assert status
    }

    @Test
    @TestSecurity(user = "bob", roles = {"CASE_VIEWER"})
    void viewer_cannot_call_approve_endpoint() {
        // call endpoint and assert 403
    }
}
```

Test endpoint-level security dan domain-level security secara terpisah.

---

## 38. Authorization Test Pyramid

Gunakan beberapa lapisan:

```text
1. Unit test policy object
2. Unit test authorization service
3. Component test with mocked identity/resource
4. QuarkusTest endpoint security test
5. Integration test with real OIDC/Keycloak if necessary
6. E2E test for critical business flow
```

Jangan hanya E2E.

E2E lambat dan tidak cukup eksplisit untuk policy matrix.

---

## 39. Authorization Observability

Authorization denial harus bisa dilihat.

Metrics:

```text
authorization_decision_total{operation,resource_type,decision,reason}
authorization_denied_total{operation,reason}
authorization_policy_latency_ms{operation}
authorization_cache_hit_total
authorization_cache_miss_total
```

Log event:

```json
{
  "event": "AUTHORIZATION_DECISION",
  "decision": "DENY",
  "reason": "tenant_mismatch",
  "operation": "CASE_VIEW",
  "resourceType": "CASE",
  "resourceId": "CASE-123",
  "actorId": "alice",
  "tenant": "agency-a",
  "correlationId": "..."
}
```

Hati-hati cardinality.

Jangan jadikan `resourceId` label metrics.

Gunakan `resourceId` di log/audit, bukan metrics label.

---

## 40. Audit Trail untuk Authorization

Authorization audit bukan hanya denial.

Untuk critical operation, audit allow juga penting.

Contoh:

```json
{
  "event": "AUTHORIZATION_ALLOWED",
  "operation": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "CASE-123",
  "actorId": "alice",
  "roles": ["CASE_REVIEWER"],
  "reason": "reviewer_same_agency_not_creator",
  "policyVersion": "case-approval-policy-v3",
  "timestamp": "2026-06-20T10:00:00Z"
}
```

Kenapa allow perlu audit?

Karena ketika ada dispute, pertanyaan bukan hanya:

```text
Siapa yang approve?
```

Tetapi:

```text
Atas dasar authorization apa dia boleh approve?
```

Dalam sistem regulatory, itu sangat penting.

---

## 41. Policy Versioning

Policy berubah.

Contoh:

```text
Sebelum 2026-07-01:
  reviewer boleh approve high risk case.

Setelah 2026-07-01:
  high risk case butuh senior reviewer.
```

Jika audit hanya menyimpan result, sulit menjelaskan keputusan historis.

Simpan:

```text
policyVersion
decisionReason
input facts minimal
```

Contoh:

```java
AuthorizationDecision.allow(
    "senior_reviewer_required_for_high_risk",
    "case-approval-policy-v4"
);
```

Jangan menggantungkan audit historis pada policy code terbaru.

---

## 42. External Policy Engine

Kadang policy terlalu kompleks untuk hardcoded Java.

Pilihan:

- Keycloak Authorization Services,
- OPA/Rego,
- custom entitlement service,
- database-driven permission service,
- commercial IAM/IGA/PAM tools.

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Java domain service | dekat domain, cepat, type-safe | redeploy untuk policy change |
| DB-driven permission | dynamic | kompleks dan rawan stale |
| Keycloak Authorization Services | centralized IAM | coupling ke IAM model |
| OPA | policy-as-code | butuh skill Rego/ops |
| External entitlement service | centralized enterprise | latency, availability dependency |

Untuk domain workflow yang kuat, sering lebih sehat:

```text
Technical entitlement dari IAM
+
Domain authorization di application service
```

Jangan outsource semua domain rule ke IAM jika rule membutuhkan aggregate state kompleks.

---

## 43. Keycloak Authorization Services Positioning

Keycloak bisa dipakai untuk centralized authorization.

Cocok untuk:

- resource/scope permission,
- role/group mapping,
- UMA-like resource authorization,
- centralized entitlement,
- API access policy.

Tetapi tetap berhati-hati:

```text
Keycloak tidak otomatis tahu state case, assignment, conflict of interest, or transactional invariant.
```

Maka domain rule tetap di service.

Pattern:

```text
Keycloak:
  Can user generally access module/capability?

Application:
  Can user perform this operation on this specific resource now?
```

---

## 44. Authorization untuk Native Image

Authorization code biasanya native-friendly jika:

- tidak bergantung reflection dinamis,
- tidak load policy class by string sembarangan,
- tidak memakai dynamic scripting engine yang tidak compatible,
- JSON serialization untuk decision jelas,
- external policy client compatible.

Hati-hati:

- library IAM custom,
- expression engine,
- scripting,
- reflection-heavy permission mapper,
- dynamic classpath scanning,
- runtime annotation scanning.

Quarkus lebih suka informasi diketahui saat build.

Jika authorization engine memakai dynamic reflection, native image bisa gagal atau butuh metadata khusus.

---

## 45. Performance Engineering

Authorization bisa menjadi bottleneck.

Sumber latency:

- DB lookup user permissions,
- DB lookup resource metadata,
- external IAM call,
- remote policy engine,
- cache miss,
- token introspection,
- tenant resolution,
- role expansion.

Strategi:

1. Put coarse roles in token.
2. Cache user access profile.
3. Query resource metadata with main aggregate.
4. Avoid remote call per object in list endpoint.
5. Push visibility predicate into SQL.
6. Batch authorization for list results.
7. Use short TTL for revocation-sensitive permission.
8. Measure policy latency.

Jangan membuat endpoint list 50 item melakukan 50 remote authorization calls.

---

## 46. Batch Authorization

Untuk list/search:

```java
Map<String, AuthorizationDecision> decisions =
        authorization.canViewCases(actor, caseIds);
```

Bukan:

```java
for (String caseId : caseIds) {
    authorization.canViewCase(caseId);
}
```

Tapi lebih baik lagi:

```text
query hanya mengembalikan visible cases.
```

Batch authorization berguna untuk allowedActions:

```java
Map<String, AllowedActions> actions =
        authorization.allowedActionsForCases(actor, cases);
```

---

## 47. Authorization Failure Mode

### Failure mode 1: IAM unavailable

Policy:

```text
Fail closed for protected operation.
Maybe fail open for public non-sensitive endpoint only.
```

### Failure mode 2: permission cache stale

Mitigation:

- short TTL,
- event invalidation,
- high-risk operation fresh check,
- audit policy source.

### Failure mode 3: token role outdated

Mitigation:

- short token lifetime,
- back-channel revocation for high-risk,
- central permission check,
- token exchange.

### Failure mode 4: service identity missing

Mitigation:

- reject,
- no anonymous internal calls.

### Failure mode 5: tenant claim missing

Mitigation:

- reject if endpoint tenant-scoped.

---

## 48. Recommended Architecture Template

Untuk enterprise Quarkus service:

```text
REST Resource
  - request parsing
  - coarse annotation
  - no business policy except delegation to service

Application Service
  - transaction boundary
  - load aggregate
  - call authorization service
  - execute command/query

Authorization Service
  - maps SecurityIdentity to CurrentActor
  - evaluates policy
  - returns AuthorizationDecision
  - emits audit decision when needed

Policy Objects
  - operation-specific rules
  - testable
  - explicit reason code

Repository
  - scoped query for list/search
  - tenant/resource predicate

Audit Service
  - records allow/deny for critical operations
```

---

## 49. Example: Regulatory Case Approval

### Business rule

```text
A case can be approved only if:
1. actor is authenticated
2. actor has CASE_APPROVER permission
3. actor belongs to same agency as case
4. case is in PENDING_APPROVAL
5. actor is not the creator
6. actor is not assigned conflict-of-interest
7. if case risk is HIGH, actor must have SENIOR_APPROVER
8. approval must be audited
```

### Policy implementation sketch

```java
@ApplicationScoped
public class CaseApprovalPolicy {

    public AuthorizationDecision evaluate(CurrentActor actor, CaseRecord c) {
        if (!actor.hasPermission("CASE_APPROVE")) {
            return AuthorizationDecision.deny("missing_case_approve_permission");
        }

        if (!actor.tenantId().equals(c.tenantId())) {
            return AuthorizationDecision.deny("tenant_mismatch");
        }

        if (c.state() != CaseState.PENDING_APPROVAL) {
            return AuthorizationDecision.deny("invalid_case_state");
        }

        if (c.createdBy().equals(actor.userId())) {
            return AuthorizationDecision.deny("creator_cannot_approve");
        }

        if (c.conflictUsers().contains(actor.userId())) {
            return AuthorizationDecision.deny("conflict_of_interest");
        }

        if (c.riskLevel() == RiskLevel.HIGH
                && !actor.hasPermission("CASE_APPROVE_HIGH_RISK")) {
            return AuthorizationDecision.deny("high_risk_requires_senior_permission");
        }

        return AuthorizationDecision.allow("case_approval_policy_v1");
    }
}
```

### Command service

```java
@ApplicationScoped
public class CaseApprovalService {

    private final CaseRepository repository;
    private final CaseAuthorizationService authorization;
    private final AuditService audit;

    public CaseApprovalService(
            CaseRepository repository,
            CaseAuthorizationService authorization,
            AuditService audit
    ) {
        this.repository = repository;
        this.authorization = authorization;
        this.audit = audit;
    }

    @Transactional
    public void approve(String caseId, ApproveCaseCommand command) {
        CaseRecord c = repository.getRequired(caseId);

        AuthorizationDecision decision = authorization.canApprove(c);

        audit.recordAuthorizationDecision(
                "CASE_APPROVE",
                "CASE",
                caseId,
                decision
        );

        if (decision.denied()) {
            throw new ForbiddenOperationException(decision.reasonCode());
        }

        c.approve(command.reason(), authorization.currentActor().userId());
    }
}
```

---

## 50. Production Checklist

Sebelum authorization dianggap production-ready:

- [ ] Semua endpoint protected by default.
- [ ] Public endpoints explicitly listed.
- [ ] Annotation security dipakai sebagai coarse gate.
- [ ] Domain authorization service tersedia.
- [ ] Object ownership check tersedia.
- [ ] Tenant boundary enforced.
- [ ] List/search query scoped.
- [ ] Command authorization berada dalam transaction yang sama dengan state mutation.
- [ ] 401 dan 403 dibedakan.
- [ ] Public error tidak membocorkan internal reason.
- [ ] Internal reason code dicatat.
- [ ] Critical allow/deny diaudit.
- [ ] Policy version disimpan untuk critical decision.
- [ ] Permission cache punya TTL/invalidation.
- [ ] Revocation strategy jelas.
- [ ] Service-to-service identity divalidasi.
- [ ] Scheduler/batch punya system actor.
- [ ] Message consumer punya trust/auth model.
- [ ] Delegation/acting-on-behalf-of diaudit.
- [ ] Authorization test matrix tersedia.
- [ ] Endpoint security test tersedia.
- [ ] Native image compatibility dipikirkan.
- [ ] Observability metrics/logs tersedia.
- [ ] No frontend-only authorization.
- [ ] No global admin bypass tanpa scope.
- [ ] No unscoped repository query for sensitive data.

---

## 51. Ringkasan Invariants

Pegang invariants berikut:

1. **Authentication is not authorization.**
2. **Role is not permission.**
3. **Permission is not object-level authorization.**
4. **Frontend visibility is not enforcement.**
5. **Tenant from URL is not trusted until compared with identity.**
6. **List/search authorization must be pushed into query scope.**
7. **Command authorization must happen close to mutation.**
8. **Authorization decision should have reason, not just boolean.**
9. **Public error should be safe; audit reason should be precise.**
10. **Critical authorization must be testable as matrix.**
11. **Service calls need service identity, not internal-network assumption.**
12. **Scheduler and message consumer still need actor model.**
13. **Admin must have scope.**
14. **Policy changes need versioning for auditability.**
15. **Default should be deny.**

---

## 52. Latihan Top 1% Engineer

Ambil satu use case:

```text
Officer wants to approve a high-risk enforcement case.
```

Buat:

1. Subject model.
2. Resource model.
3. Action enum.
4. Context model.
5. Authorization matrix.
6. Policy object.
7. Denial reason codes.
8. Audit event schema.
9. Unit test matrix.
10. Query scoping strategy.
11. Service-to-service propagation rule.
12. Revocation/cache strategy.

Jika kamu bisa menjelaskan semua itu, kamu tidak lagi berpikir authorization sebagai annotation.

Kamu sudah berpikir sebagai engineer yang mendesain sistem aman, operable, dan defensible.

---

## 53. Apa yang Tidak Dibahas Ulang

Part ini sengaja tidak mengulang:

- dasar JWT,
- dasar OIDC,
- dasar Keycloak setup,
- dasar Java annotation,
- dasar Jakarta REST,
- dasar HTTP 401/403 secara tutorial,
- dasar database role table.

Semua konsep itu sudah masuk di seri sebelumnya atau Part 015.

Fokus part ini adalah:

```text
Authorization as system design.
```

---

## 54. Referensi Resmi yang Relevan

Untuk pendalaman langsung dari dokumentasi Quarkus:

- Quarkus Security Authorization of Web Endpoints
- Quarkus Security Testing
- Quarkus Security Customization / SecurityIdentityAugmentor
- Quarkus OIDC Bearer Token Authentication
- Quarkus OIDC Token Propagation
- Quarkus JWT RBAC
- Quarkus Keycloak Authorization Services
- Quarkus Proactive Authentication

---

## 55. Penutup

Authorization adalah salah satu area yang paling sering terlihat sederhana tetapi paling mahal jika salah.

Di Quarkus, annotation seperti `@RolesAllowed`, `@Authenticated`, dan `@PermissionsAllowed` sangat berguna, tetapi tidak boleh menjadi satu-satunya model.

Untuk sistem kecil, role annotation mungkin cukup.

Untuk sistem enterprise/regulatory, kamu butuh:

```text
identity model
+ permission model
+ resource ownership
+ tenant boundary
+ state machine authorization
+ audit reason
+ policy versioning
+ test matrix
+ operational visibility
```

Itulah perbedaan antara “endpoint aman” dan “sistem authorization yang defensible”.

---

# Status Seri

Part 016 selesai.

Seri belum selesai dan belum mencapai bagian terakhir.

Part berikutnya:

> Part 017 — Security III: mTLS, Secrets, Crypto, Native Image Security, Supply Chain


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-015.md">⬅️ Part 015 — Security I: Authentication, OIDC, Keycloak, JWT, Token Propagation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-017.md">Part 017 — Security III: mTLS, Secrets, Crypto, Native Image Security, Supply Chain ➡️</a>
</div>

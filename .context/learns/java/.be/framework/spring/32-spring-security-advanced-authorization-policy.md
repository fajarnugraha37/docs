# 32 — Spring Security Advanced: Authorization Architecture and Policy Enforcement

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `32 / 35`  
> File: `32-spring-security-advanced-authorization-policy.md`  
> Fokus: authorization tingkat lanjut di aplikasi Spring enterprise: URL, method, object, query, tenant, policy, audit, testing, dan failure model.

---

## 0. Posisi Materi Ini dalam Seri

Part 18 sudah membahas **Spring Security application architecture**: `SecurityFilterChain`, `FilterChainProxy`, `AuthenticationManager`, `AuthenticationProvider`, `SecurityContext`, request authorization, method security dasar, OAuth2/OIDC/JWT, session/stateless, CSRF, CORS, dan common misconfiguration.

Part ini tidak mengulang itu.

Part ini membahas pertanyaan yang lebih sulit:

```text
Setelah user berhasil login dan identitasnya valid,
bagaimana sistem memutuskan user boleh melakukan aksi apa,
terhadap object apa,
dalam tenant mana,
dengan state bisnis apa,
melalui channel apa,
dan bagaimana keputusan itu bisa diaudit, diuji, dan dipertahankan secara regulatory?
```

Di sistem kecil, authorization sering cukup dengan:

```java
.hasRole("ADMIN")
```

Di sistem enterprise, terutama regulatory/case-management/workflow system, authorization biasanya bergantung pada:

- role;
- permission;
- tenant;
- agency/organization;
- ownership;
- assignment;
- case state;
- escalation state;
- data classification;
- channel;
- time window;
- conflict of interest;
- separation of duties;
- maker-checker rule;
- delegation;
- auditability;
- reason code;
- legal defensibility.

Karena itu, authorization bukan sekadar security concern. Ia adalah **business policy enforcement layer**.

---

## 1. Mental Model Utama: Authentication Bukan Authorization

Authentication menjawab:

```text
Siapa user ini?
```

Authorization menjawab:

```text
Apa yang boleh dilakukan user ini, pada resource ini, dalam konteks ini?
```

Contoh sederhana:

```text
Authentication:
- userId = "u-123"
- username = "alice"
- authorities = ["ROLE_OFFICER", "CASE_READ"]
- tenant = "agency-a"

Authorization:
- Alice boleh melihat case C-100? Ya, karena assigned officer.
- Alice boleh approve case C-100? Tidak, karena ia pembuat submission.
- Alice boleh reopen case C-100? Tidak, karena state sudah CLOSED dan retention lock aktif.
- Alice boleh export report? Ya, tetapi hanya untuk agency-a.
```

Top-tier Spring engineer harus memisahkan dua hal ini secara ketat.

Authentication adalah **identity establishment**.  
Authorization adalah **policy decision**.

Kalau dua hal ini dicampur, sistem biasanya mengalami masalah berikut:

1. JWT/authority menjadi terlalu besar.
2. Role berubah menjadi dump semua business permission.
3. Controller penuh dengan `if (user.hasRole(...))`.
4. Query tidak terfilter dengan benar.
5. Object-level access bocor.
6. Audit tidak bisa menjelaskan alasan keputusan.
7. Policy berubah harus redeploy banyak service.
8. Permission matrix tidak bisa diuji secara sistematis.

---

## 2. Authorization Layer dalam Aplikasi Spring

Dalam aplikasi Spring, authorization bisa muncul di beberapa layer.

```text
HTTP request layer
    ↓
Controller/resource method layer
    ↓
Application service method layer
    ↓
Domain policy layer
    ↓
Repository/query/data-access layer
    ↓
Database/RLS/storage layer
```

Masing-masing punya fungsi berbeda.

| Layer | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|
| HTTP URL authorization | coarse-grained access ke endpoint | object-level rule kompleks |
| Controller annotation | validasi akses dekat API contract | policy domain mendalam |
| Service method security | use-case-level enforcement | row filtering skala besar |
| Domain policy service | business authorization kaya konteks | menggantikan semua request filter |
| Query/data filter | mencegah data bocor di listing/search | menjelaskan semua alasan policy |
| Database RLS | defense-in-depth data isolation | menggantikan app-level workflow policy |

Prinsipnya:

```text
Authorization tidak boleh hanya ada di satu tempat jika sistem punya banyak akses path.
Tetapi authorization juga tidak boleh diduplikasi acak di semua tempat.
```

Yang dibutuhkan adalah **layered enforcement**.

---

## 3. Coarse-Grained vs Fine-Grained Authorization

### 3.1 Coarse-Grained Authorization

Contoh:

```java
.requestMatchers("/admin/**").hasRole("ADMIN")
.requestMatchers(HttpMethod.GET, "/cases/**").hasAuthority("CASE_READ")
.requestMatchers(HttpMethod.POST, "/cases/**").hasAuthority("CASE_CREATE")
```

Ini menjawab:

```text
Apakah user secara umum boleh masuk ke area/fungsi ini?
```

Kelebihan:

- cepat;
- mudah dibaca;
- cocok di filter chain;
- murah secara runtime;
- bagus untuk memblokir request awal.

Kekurangan:

- tidak tahu object spesifik;
- tidak tahu state bisnis;
- tidak tahu assignment;
- tidak tahu conflict-of-interest;
- tidak tahu tenant object kecuali path/header/token cukup kaya.

### 3.2 Fine-Grained Authorization

Contoh:

```text
User boleh approve case jika:
- memiliki permission CASE_APPROVE;
- berada dalam tenant yang sama;
- case state = PENDING_APPROVAL;
- user bukan creator case;
- user berada dalam approval group yang sesuai;
- tidak ada conflict-of-interest flag;
- delegation masih valid;
- approval window belum lewat.
```

Ini tidak cukup diekspresikan sebagai `hasRole("APPROVER")`.

Fine-grained authorization membutuhkan:

- subject;
- action;
- resource;
- context;
- policy;
- decision;
- reason.

Model yang lebih kuat:

```text
can(subject, action, resource, context) -> decision
```

Atau lebih eksplisit:

```java
AuthorizationDecision decide(AuthorizationRequest request)
```

---

## 4. Subject, Action, Resource, Context

Authorization enterprise sebaiknya dimodelkan sebagai empat unsur.

```text
Subject  = siapa yang meminta akses
Action   = operasi yang ingin dilakukan
Resource = object atau resource yang ditarget
Context  = kondisi tambahan saat keputusan dibuat
```

Contoh:

```java
record AuthorizationRequest(
    AuthSubject subject,
    Action action,
    ResourceRef resource,
    AuthorizationContext context
) {}
```

### 4.1 Subject

Subject bukan hanya username.

Ia bisa mengandung:

```java
record AuthSubject(
    String userId,
    String tenantId,
    Set<String> roles,
    Set<String> permissions,
    Set<String> groups,
    Set<String> actingAsDelegations,
    boolean serviceAccount
) {}
```

### 4.2 Action

Action harus domain-specific.

Buruk:

```text
READ
WRITE
DELETE
```

Lebih baik:

```text
CASE_VIEW
CASE_ASSIGN
CASE_SUBMIT
CASE_APPROVE
CASE_REJECT
CASE_REOPEN
CASE_EXPORT
CASE_ESCALATE
CASE_OVERRIDE_SLA
```

Kenapa?

Karena `WRITE` terlalu kasar. `CASE_APPROVE` dan `CASE_REOPEN` sama-sama write, tetapi risikonya berbeda.

### 4.3 Resource

Resource bisa berupa object lengkap atau reference.

```java
record ResourceRef(
    String type,
    String id,
    String tenantId
) {}
```

Untuk keputusan sederhana, `ResourceRef` cukup.  
Untuk keputusan berbasis state, policy engine mungkin perlu load snapshot object.

### 4.4 Context

Context menangkap kondisi runtime.

```java
record AuthorizationContext(
    String channel,
    Instant now,
    String requestIp,
    String correlationId,
    Map<String, Object> attributes
) {}
```

Contoh context:

- channel = `INTERNAL_PORTAL`, `PUBLIC_API`, `BATCH_JOB`, `SYSTEM_EVENT`;
- request origin;
- delegation mode;
- emergency override;
- read-only maintenance window;
- feature flag;
- case assignment override reason.

---

## 5. Spring Security AuthorizationManager

Spring Security modern menggunakan `AuthorizationManager<T>` sebagai komponen inti untuk authorization decision.

Secara konseptual:

```java
AuthorizationResult authorize(Supplier<Authentication> authentication, T object)
```

`T` bisa berupa:

- HTTP request context;
- method invocation;
- message;
- domain object;
- custom authorization target.

`AuthorizationManager` menjadi titik penting karena ia menyatukan pola authorization request-based dan method-based.

Contoh custom manager untuk request:

```java
@Component
public class TenantRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final TenantAccessService tenantAccessService;

    public TenantRequestAuthorizationManager(TenantAccessService tenantAccessService) {
        this.tenantAccessService = tenantAccessService;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context
    ) {
        Authentication auth = authentication.get();
        String tenantId = context.getVariables().get("tenantId");

        boolean granted = tenantAccessService.canAccessTenant(auth, tenantId);
        return new AuthorizationDecision(granted);
    }
}
```

Pada Spring Security 7, API bergerak dari model `check` menuju `authorize`/`AuthorizationResult` pada beberapa area. Saat menulis library internal, jangan mengikat terlalu keras pada deprecated method. Bungkus logic domain Anda di service sendiri, lalu adapt ke interface Spring Security.

Contoh pendekatan lebih stabil:

```java
public interface PolicyDecisionService {
    PolicyDecision decide(PolicyRequest request);
}
```

Lalu adapter Spring Security:

```java
@Component
public final class CaseRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final PolicyDecisionService policy;

    public CaseRequestAuthorizationManager(PolicyDecisionService policy) {
        this.policy = policy;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext context
    ) {
        PolicyRequest request = PolicyRequest.from(authentication.get(), context);
        PolicyDecision decision = policy.decide(request);
        return new AuthorizationDecision(decision.granted());
    }
}
```

Dengan model ini, Spring Security hanyalah enforcement adapter. Policy utama tetap milik application/domain layer.

---

## 6. Request-Level Authorization

Request-level authorization terjadi di filter chain sebelum request masuk controller.

Contoh:

```java
@Bean
SecurityFilterChain apiSecurity(HttpSecurity http,
                                CaseRequestAuthorizationManager caseAuthz) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(HttpMethod.GET, "/api/health").permitAll()
            .requestMatchers(HttpMethod.GET, "/api/cases/{caseId}").access(caseAuthz)
            .requestMatchers("/api/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .build();
}
```

Request-level authorization bagus untuk:

- endpoint exposure;
- coarse permission;
- path variable tenant check;
- API group access;
- public/private/admin split;
- pre-controller rejection.

Tetapi tidak ideal untuk:

- keputusan berdasarkan object state yang butuh query kompleks;
- decision yang harus terjadi setelah input divalidasi;
- policy yang bergantung pada domain invariant;
- list/search filtering;
- partial object visibility.

### 6.1 Rule Ordering

Order authorization rule sangat penting.

Buruk:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/**").authenticated()
    .requestMatchers("/api/admin/**").hasRole("ADMIN")
)
```

Rule kedua tidak berguna jika rule pertama sudah match lebih dahulu.

Lebih baik:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/admin/**").hasRole("ADMIN")
    .requestMatchers("/api/**").authenticated()
)
```

Prinsip:

```text
Specific before general.
Deny-by-default at the end.
```

---

## 7. Method-Level Authorization

Method security cocok untuk use-case boundary.

Contoh:

```java
@Service
public class CaseApprovalService {

    @PreAuthorize("hasAuthority('CASE_APPROVE')")
    public ApprovalResult approve(String caseId, ApprovalCommand command) {
        // application use case
    }
}
```

Tetapi untuk policy kompleks, expression string cepat menjadi sulit dirawat.

Buruk:

```java
@PreAuthorize("hasAuthority('CASE_APPROVE') and @caseSecurity.isAssigned(authentication, #caseId) and @caseSecurity.isPending(#caseId) and !@caseSecurity.isCreator(authentication, #caseId)")
public ApprovalResult approve(String caseId, ApprovalCommand command) { ... }
```

Lebih baik:

```java
@PreAuthorize("@casePolicy.canApprove(authentication, #caseId)")
public ApprovalResult approve(String caseId, ApprovalCommand command) { ... }
```

Atau lebih eksplisit dengan custom annotation/aspect/authorization manager.

### 7.1 Method Security sebagai Boundary

Method security cocok ditempatkan di application service, bukan domain entity.

```text
Controller
  → Application Service  ← method security boundary
      → Domain Service
      → Repository
```

Kenapa bukan controller saja?

Karena application service bisa dipanggil dari:

- REST controller;
- GraphQL resolver;
- scheduler;
- message listener;
- batch job;
- internal module;
- test fixture;
- future adapter.

Kalau authorization hanya di controller, akses path lain bisa bypass.

### 7.2 Self-Invocation Problem

Method security berbasis proxy.

Ini bermasalah:

```java
@Service
public class CaseService {

    public void outer(String caseId) {
        approve(caseId); // internal call, proxy dilewati
    }

    @PreAuthorize("hasAuthority('CASE_APPROVE')")
    public void approve(String caseId) {
        // protected? tidak jika dipanggil dari outer()
    }
}
```

Solusi desain:

1. Pisahkan protected method ke bean lain.
2. Letakkan security di public application boundary.
3. Jangan mengandalkan annotation pada internal helper method.
4. Test negative path melalui entry point nyata.

---

## 8. Object-Level Authorization

Object-level authorization menjawab:

```text
Bolehkan subject melakukan action terhadap object spesifik ini?
```

Contoh:

```java
public boolean canViewCase(Authentication authentication, CaseId caseId) {
    CaseSnapshot c = caseQuery.getAuthorizationSnapshot(caseId);

    AuthSubject subject = subjectFactory.from(authentication);

    return c.tenantId().equals(subject.tenantId())
        && subject.hasPermission("CASE_VIEW")
        && (
            c.assignedOfficerId().equals(subject.userId())
            || subject.hasRole("SUPERVISOR")
            || c.visibilityGroupIds().stream().anyMatch(subject.groups()::contains)
        );
}
```

### 8.1 Jangan Load Full Aggregate jika Tidak Perlu

Authorization sering butuh subset data:

```text
case_id
case_tenant_id
case_state
assigned_officer_id
created_by
classification
visibility_group
lock_status
```

Jangan selalu load aggregate penuh jika hanya perlu authorization snapshot.

Buat query khusus:

```java
public record CaseAuthorizationSnapshot(
    String caseId,
    String tenantId,
    String state,
    String assignedOfficerId,
    String createdBy,
    String classification,
    boolean locked
) {}
```

Repository:

```java
public interface CaseAuthorizationQuery {
    Optional<CaseAuthorizationSnapshot> findAuthorizationSnapshot(String caseId);
}
```

Kelebihan:

- lebih cepat;
- tidak memicu lazy loading;
- policy input eksplisit;
- mudah diaudit;
- tidak mencampur mutation aggregate dengan policy read.

### 8.2 Fail Closed

Jika object tidak ditemukan atau snapshot tidak lengkap, default harus deny.

```java
return repository.findAuthorizationSnapshot(caseId)
    .map(snapshot -> evaluate(subject, action, snapshot))
    .orElse(PolicyDecision.deny("RESOURCE_NOT_FOUND_OR_NOT_VISIBLE"));
```

Jangan bedakan terlalu jelas antara:

```text
resource tidak ada
resource ada tapi tidak boleh dilihat
```

untuk API publik atau cross-tenant context, karena bisa menyebabkan resource enumeration.

---

## 9. Domain Object Security dan ACL

Spring Security menyediakan dukungan ACL untuk domain object security.

Model ACL berguna jika sistem punya pola:

```text
identity X punya permission Y pada object Z
```

Contoh:

```text
User Alice punya READ pada Document D1.
Group Supervisor punya WRITE pada Case C2.
Role Auditor punya READ_AUDIT pada Case C3.
```

ACL cocok untuk:

- document management;
- object sharing;
- collaboration system;
- per-object permission eksplisit;
- grant/revoke permission yang dinamis.

ACL kurang cocok jika rule utama bergantung pada:

- workflow state;
- assignment derived;
- tenant policy;
- ABAC rule kompleks;
- separation of duties;
- temporal condition;
- computed business rule.

Di banyak enterprise system, ACL hanya salah satu input policy, bukan seluruh policy.

Contoh hybrid:

```text
Grant if:
- user has CASE_VIEW authority; and
- same tenant; and
- object classification <= user clearance; and
- either assigned officer or ACL grants READ; and
- case is not sealed unless user has SEALED_CASE_VIEW.
```

---

## 10. RBAC, PBAC, ABAC, ReBAC

### 10.1 RBAC — Role-Based Access Control

```text
User → Role → Permission
```

Contoh:

```text
ROLE_CASE_OFFICER → CASE_VIEW, CASE_UPDATE
ROLE_SUPERVISOR   → CASE_ASSIGN, CASE_APPROVE
ROLE_ADMIN        → USER_MANAGE
```

Kelebihan:

- mudah dipahami;
- cocok untuk coarse access;
- bagus untuk enterprise admin UI.

Kelemahan:

- role explosion;
- sulit menangkap context;
- tidak cukup untuk object-level policy.

### 10.2 PBAC — Permission-Based Access Control

Policy didasarkan pada permission eksplisit.

```text
CASE_APPROVE
CASE_REOPEN
REPORT_EXPORT
```

Lebih fleksibel daripada role langsung.

Model umum:

```text
User → Role → Permission
Application checks Permission
```

Jangan check role langsung di seluruh codebase jika permission adalah konsep stabil.

Buruk:

```java
hasRole("SENIOR_OFFICER")
```

Lebih baik:

```java
hasAuthority("CASE_APPROVE")
```

Karena role organisasi bisa berubah, tetapi action bisnis lebih stabil.

### 10.3 ABAC — Attribute-Based Access Control

Policy didasarkan pada attribute subject/resource/context.

Contoh:

```text
subject.agency == resource.agency
subject.clearance >= resource.classification
context.channel == INTERNAL_PORTAL
resource.state in [PENDING_REVIEW, PENDING_APPROVAL]
```

ABAC cocok untuk regulatory system karena rule sering bergantung pada kombinasi atribut.

### 10.4 ReBAC — Relationship-Based Access Control

Policy didasarkan pada relasi.

Contoh:

```text
user is assigned officer of case
user supervises assigned officer
user belongs to team responsible for case
user is delegated approver for creator's unit
```

ReBAC sering muncul dalam case management.

### 10.5 Model Realistis

Sistem enterprise biasanya hybrid:

```text
RBAC untuk coarse access
PBAC untuk action-level access
ABAC untuk policy condition
ReBAC untuk ownership/assignment/supervision
ACL untuk per-object grant/revoke khusus
```

---

## 11. Policy Decision Point dan Policy Enforcement Point

Dua konsep penting:

```text
PDP = Policy Decision Point
PEP = Policy Enforcement Point
```

PDP menjawab:

```text
Allow atau deny?
```

PEP melakukan enforcement:

```text
Jika deny, hentikan request/operation.
```

Dalam Spring:

| Komponen | Peran |
|---|---|
| `SecurityFilterChain` | PEP request-level |
| `AuthorizationManager` | adapter PDP/decision component |
| `@PreAuthorize` | PEP method-level |
| custom `PolicyService` | PDP domain/application |
| repository query filter | PEP data-level |
| database RLS | PEP storage-level |

Desain yang sehat:

```text
Controller/Filter/Method Security = enforcement adapter
PolicyService = policy decision pusat
Domain/Repository = policy-aware data retrieval
Audit = decision recording
```

---

## 12. PolicyDecision Model

Jangan hanya return boolean untuk policy penting.

Boolean tidak cukup untuk:

- audit;
- debugging;
- support issue;
- regulatory explanation;
- metrics;
- policy review;
- testing matrix.

Lebih baik:

```java
public record PolicyDecision(
    boolean granted,
    String reasonCode,
    String message,
    Map<String, Object> attributes
) {
    public static PolicyDecision allow(String reasonCode) {
        return new PolicyDecision(true, reasonCode, null, Map.of());
    }

    public static PolicyDecision deny(String reasonCode) {
        return new PolicyDecision(false, reasonCode, null, Map.of());
    }
}
```

Contoh reason code:

```text
ALLOW_ASSIGNED_OFFICER
ALLOW_SUPERVISOR_SAME_TENANT
DENY_MISSING_PERMISSION
DENY_CROSS_TENANT
DENY_CASE_STATE_NOT_APPROVABLE
DENY_MAKER_CHECKER_VIOLATION
DENY_CLASSIFICATION_TOO_HIGH
DENY_RESOURCE_NOT_FOUND_OR_NOT_VISIBLE
DENY_DELEGATION_EXPIRED
```

Reason code harus stabil. Jangan jadikan message bebas sebagai contract.

---

## 13. Designing a Domain Policy Service

Contoh interface:

```java
public interface CaseAuthorizationPolicy {

    PolicyDecision canView(AuthSubject subject, CaseAuthorizationSnapshot resource, AuthzContext context);

    PolicyDecision canUpdate(AuthSubject subject, CaseAuthorizationSnapshot resource, AuthzContext context);

    PolicyDecision canApprove(AuthSubject subject, CaseAuthorizationSnapshot resource, AuthzContext context);

    PolicyDecision canAssign(AuthSubject subject, CaseAuthorizationSnapshot resource, AuthzContext context);
}
```

Implementasi:

```java
@Component
public class DefaultCaseAuthorizationPolicy implements CaseAuthorizationPolicy {

    @Override
    public PolicyDecision canApprove(
            AuthSubject subject,
            CaseAuthorizationSnapshot c,
            AuthzContext context
    ) {
        if (!subject.permissions().contains("CASE_APPROVE")) {
            return PolicyDecision.deny("DENY_MISSING_PERMISSION");
        }

        if (!subject.tenantId().equals(c.tenantId())) {
            return PolicyDecision.deny("DENY_CROSS_TENANT");
        }

        if (!"PENDING_APPROVAL".equals(c.state())) {
            return PolicyDecision.deny("DENY_CASE_STATE_NOT_APPROVABLE");
        }

        if (subject.userId().equals(c.createdBy())) {
            return PolicyDecision.deny("DENY_MAKER_CHECKER_VIOLATION");
        }

        if (c.locked()) {
            return PolicyDecision.deny("DENY_RESOURCE_LOCKED");
        }

        return PolicyDecision.allow("ALLOW_APPROVER_SAME_TENANT");
    }
}
```

### 13.1 Jangan Campur Policy dengan Side Effect

Policy function sebaiknya pure atau hampir pure.

Buruk:

```java
if (allowed) {
    auditRepository.insert(...);
    notificationService.send(...);
    caseRepository.update(...);
}
```

Lebih baik:

```java
PolicyDecision decision = policy.canApprove(subject, snapshot, context);
policyAudit.record(request, decision);
if (!decision.granted()) throw new AccessDeniedException(decision.reasonCode());
```

Policy memutuskan. Application service mengorkestrasi side effect.

---

## 14. Custom Method Authorization with Policy Service

Pola sederhana:

```java
@Component("caseAuthz")
public class CaseMethodSecurity {

    private final CaseAuthorizationQuery query;
    private final CaseAuthorizationPolicy policy;
    private final AuthSubjectFactory subjectFactory;

    public CaseMethodSecurity(
            CaseAuthorizationQuery query,
            CaseAuthorizationPolicy policy,
            AuthSubjectFactory subjectFactory
    ) {
        this.query = query;
        this.policy = policy;
        this.subjectFactory = subjectFactory;
    }

    public boolean canApprove(Authentication authentication, String caseId) {
        AuthSubject subject = subjectFactory.from(authentication);

        return query.findAuthorizationSnapshot(caseId)
            .map(snapshot -> policy.canApprove(subject, snapshot, AuthzContext.current()))
            .map(PolicyDecision::granted)
            .orElse(false);
    }
}
```

Service:

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
public ApprovalResult approve(String caseId, ApprovalCommand command) {
    // mutation logic
}
```

Kelemahan expression-based method security:

- string expression tidak mudah direfactor;
- compile-time safety rendah;
- policy reason hilang jika hanya boolean;
- raw SpEL bisa menjadi terlalu kompleks.

Untuk sistem besar, lebih baik gunakan custom authorization component dan explicit guard.

---

## 15. Explicit Guard Pattern

Alih-alih semua lewat annotation, gunakan guard object.

```java
@Component
public class CaseAuthorizationGuard {

    private final CaseAuthorizationQuery query;
    private final CaseAuthorizationPolicy policy;
    private final AuthSubjectProvider subjectProvider;
    private final PolicyAuditSink auditSink;

    public void requireApprove(String caseId) {
        AuthSubject subject = subjectProvider.currentSubject();
        CaseAuthorizationSnapshot snapshot = query.findAuthorizationSnapshot(caseId)
            .orElseThrow(() -> new AccessDeniedException("DENY_RESOURCE_NOT_FOUND_OR_NOT_VISIBLE"));

        PolicyDecision decision = policy.canApprove(subject, snapshot, AuthzContext.current());
        auditSink.record(subject, "CASE_APPROVE", caseId, decision);

        if (!decision.granted()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }
}
```

Service:

```java
@Transactional
public ApprovalResult approve(String caseId, ApprovalCommand command) {
    authorization.requireApprove(caseId);

    Case c = caseRepository.getForUpdate(caseId);
    c.approve(command.reason());
    return mapper.toResult(c);
}
```

Kelebihan:

- explicit;
- testable;
- reason code preserved;
- audit centralized;
- tidak tergantung SpEL;
- cocok untuk complex enterprise policy.

Kekurangan:

- developer harus disiplin memanggil guard;
- perlu code review/checklist;
- bisa lupa jika tidak ada convention/platform guard.

Untuk high-risk operation, explicit guard sering lebih defensible daripada annotation tersembunyi.

---

## 16. Query-Level Authorization

Method/object authorization tidak cukup untuk listing/search.

Contoh endpoint:

```http
GET /api/cases?status=OPEN
```

Kalau query mengambil semua case lalu filter di memory:

```java
List<Case> all = repository.findByStatus("OPEN");
return all.stream()
    .filter(c -> policy.canView(subject, c).granted())
    .toList();
```

Masalah:

- data bocor ke memory service;
- lambat;
- pagination salah;
- total count salah;
- cache/search index bisa bocor;
- audit sulit.

Lebih baik authorization masuk ke query predicate.

Contoh:

```java
public Page<CaseListItem> searchVisibleCases(CaseSearchCriteria criteria, AuthSubject subject, Pageable pageable) {
    return queryFactory
        .select(caseListProjection)
        .from(caseTable)
        .where(
            caseTable.tenantId.eq(subject.tenantId()),
            caseTable.status.eq(criteria.status()),
            visibilityPredicate(subject)
        )
        .page(pageable);
}
```

Visibility predicate:

```java
private Predicate visibilityPredicate(AuthSubject subject) {
    if (subject.hasPermission("CASE_VIEW_ALL_IN_TENANT")) {
        return alwaysTrue();
    }

    return anyOf(
        caseTable.assignedOfficerId.eq(subject.userId()),
        caseTable.visibilityGroupId.in(subject.groups()),
        caseTable.createdBy.eq(subject.userId())
    );
}
```

### 16.1 The Pagination Trap

Buruk:

```text
Fetch page 1 of 20 rows from DB
Filter unauthorized rows in app
Return 7 rows
```

User melihat page size tidak konsisten. Lebih buruk lagi, total count bisa mengungkap adanya hidden rows.

Benar:

```text
Apply authorization predicate in DB/search query
Then paginate authorized result
```

### 16.2 Search Index Authorization

Kalau menggunakan Elasticsearch/OpenSearch:

- index harus punya tenant/visibility field;
- query harus selalu menambahkan authorization filter;
- jangan mengandalkan post-filter di application untuk high-risk data;
- snapshot permission saat indexing perlu strategi invalidation jika permission berubah.

---

## 17. Database Row-Level Security sebagai Defense-in-Depth

Database Row-Level Security/RLS bisa membantu mencegah cross-tenant leak.

Tetapi RLS bukan pengganti Spring authorization.

RLS bagus untuk:

- tenant isolation;
- hard data boundary;
- defense-in-depth;
- mengurangi risiko developer lupa `tenant_id` predicate.

RLS kurang untuk:

- workflow state policy;
- maker-checker;
- business action permission;
- UI capability decision;
- audit reason code;
- multi-resource policy.

Model sehat:

```text
Spring policy decides business authorization.
Query predicate enforces visibility.
Database RLS protects isolation if application bug occurs.
```

---

## 18. Tenant-Aware Authorization

Multi-tenancy harus menjadi invariant authorization.

Rule dasar:

```text
Subject tenant must match resource tenant, unless explicit cross-tenant/system permission exists.
```

Contoh:

```java
if (!subject.tenantId().equals(resource.tenantId())) {
    if (!subject.permissions().contains("CROSS_TENANT_ACCESS")) {
        return PolicyDecision.deny("DENY_CROSS_TENANT");
    }
}
```

### 18.1 Tenant dari Token Tidak Selalu Cukup

Token bisa mengandung tenant claim:

```json
{
  "sub": "u-123",
  "tenant": "agency-a",
  "scope": "case:read"
}
```

Tetapi resource tenant tetap harus diverifikasi dari data.

Jangan hanya percaya path:

```http
GET /tenants/agency-a/cases/C-100
```

Harus cek:

```text
C-100 benar milik agency-a?
Subject boleh access agency-a?
```

### 18.2 Tenant Context Propagation

Jika authorization bergantung tenant context, pastikan tenant context ikut ke:

- async task;
- scheduler;
- message listener;
- WebClient call;
- audit log;
- metrics tag secara terkendali;
- transaction boundary.

Jangan pakai raw `ThreadLocal` tanpa propagation strategy, terutama dengan async, Reactor, dan virtual threads.

---

## 19. Authorization untuk Workflow/State Machine

Di case-management system, authorization sering bergantung pada state transition.

Contoh:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> PENDING_APPROVAL
PENDING_APPROVAL -> APPROVED
PENDING_APPROVAL -> REJECTED
APPROVED -> CLOSED
CLOSED -> REOPENED
```

Tidak semua user boleh menjalankan semua transition.

Model yang kuat:

```java
record TransitionPolicyRequest(
    AuthSubject subject,
    String caseId,
    CaseState fromState,
    CaseAction action,
    AuthzContext context
) {}
```

Policy:

```java
PolicyDecision canTransition(TransitionPolicyRequest request)
```

Contoh:

```java
if (request.action() == CaseAction.APPROVE) {
    return canApprove(request.subject(), snapshot, request.context());
}
```

### 19.1 Jangan Pisahkan Authorization dari Transition Invariant

Buruk:

```java
if (userCanApprove()) {
    case.approve();
}
```

Tetapi `case.approve()` sendiri tidak cek state.

Lebih baik:

```java
authorization.requireTransition(caseId, CaseAction.APPROVE);
Case c = repository.getForUpdate(caseId);
c.approve(command.reason()); // domain still validates state invariant
```

Authorization menjawab **siapa boleh mencoba**.  
Domain invariant menjawab **apakah transition valid secara bisnis**.

Keduanya berbeda dan keduanya perlu.

---

## 20. Separation of Duties dan Maker-Checker

Enterprise workflow sering punya rule:

```text
Orang yang membuat/request tidak boleh approve.
```

Contoh policy:

```java
if (subject.userId().equals(snapshot.createdBy())) {
    return PolicyDecision.deny("DENY_MAKER_CHECKER_VIOLATION");
}
```

Rule bisa lebih kompleks:

```text
- creator tidak boleh approve;
- last modifier tidak boleh approve;
- approver level 1 dan approver level 2 harus berbeda;
- supervisor tidak boleh approve subordinate tertentu jika conflict flag aktif;
- emergency override harus punya reason dan audit escalation.
```

Desain data harus mendukung rule ini:

```text
created_by
last_modified_by
submitted_by
reviewed_by
approved_by
approval_level
delegated_from
override_reason
conflict_flag
```

Kalau data tidak disimpan, policy tidak bisa dibuktikan.

---

## 21. Authorization Audit

Authorization audit harus menjawab:

```text
Siapa meminta apa, terhadap resource mana, kapan, dari channel mana, hasilnya apa, dan alasan policy-nya apa?
```

Minimal record:

```java
record AuthorizationAuditRecord(
    String correlationId,
    String subjectId,
    String tenantId,
    String action,
    String resourceType,
    String resourceId,
    boolean granted,
    String reasonCode,
    String channel,
    Instant decidedAt
) {}
```

### 21.1 Audit Semua atau Hanya Denied?

Tergantung risiko.

| Strategy | Kelebihan | Kekurangan |
|---|---|---|
| Audit denied only | volume rendah | tidak bisa rekonstruksi semua access |
| Audit high-risk action only | seimbang | butuh klasifikasi action |
| Audit all authorization | defensible | volume besar, perlu retention |

Untuk high-risk regulatory operations, minimal audit:

- denied high-risk operation;
- granted mutation operation;
- granted export/download;
- override/delegation;
- cross-tenant/system access;
- admin permission change.

### 21.2 Jangan Masukkan PII Berlebihan

Audit authorization harus cukup untuk investigasi, tapi jangan jadi kebocoran data.

Simpan:

```text
resource id, type, action, reason code, subject id
```

Hindari:

```text
full payload, full document content, raw token, password, secret, excessive personal data
```

---

## 22. Policy Reason dan User-Facing Error

Internal reason code tidak selalu boleh ditampilkan ke user.

Contoh internal:

```text
DENY_RESOURCE_EXISTS_BUT_CROSS_TENANT
```

Kalau ditampilkan, bisa mengungkap resource existence.

External response:

```json
{
  "type": "https://example.com/problems/access-denied",
  "title": "Access denied",
  "status": 403,
  "detail": "You are not allowed to perform this action.",
  "correlationId": "..."
}
```

Internal log/audit:

```text
reasonCode=DENY_CROSS_TENANT
resourceType=CASE
resourceId=C-100
subject=u-123
tenant=agency-a
```

Prinsip:

```text
Expose generic denial to caller.
Record precise reason internally.
```

---

## 23. Authorization Caching

Authorization decision caching berbahaya jika tidak hati-hati.

Boleh dicache jika:

- rule stabil;
- input key lengkap;
- TTL pendek;
- invalidation jelas;
- decision bukan untuk high-risk mutation;
- context tidak mengandung state cepat berubah.

Jangan cache jika:

- permission baru saja berubah;
- object state cepat berubah;
- assignment berubah;
- delegation bisa expired;
- action high-risk;
- tenant switch dinamis;
- policy bergantung waktu real-time.

### 23.1 Cache Key Harus Lengkap

Buruk:

```text
caseId -> true
```

Lebih baik:

```text
subjectId + tenantId + action + resourceType + resourceId + policyVersion + authzVersion
```

Contoh:

```java
record AuthzCacheKey(
    String subjectId,
    String tenantId,
    String action,
    String resourceType,
    String resourceId,
    long subjectPermissionVersion,
    long resourceVisibilityVersion,
    String policyVersion
) {}
```

Jika tidak punya version, pakai TTL pendek dan jangan cache high-risk mutation.

### 23.2 Stale Authorization

Kasus:

```text
09:00 user punya CASE_APPROVE
09:01 decision allow dicache 30 menit
09:02 permission dicabut
09:03 user masih bisa approve karena cache stale
```

Mitigasi:

- permission version;
- session revocation;
- short TTL;
- no cache for mutation;
- event-driven invalidation;
- re-check at mutation boundary.

---

## 24. Authorization in Distributed Systems

Dalam microservices, ada dua pola buruk yang sering muncul.

### 24.1 Trusting Upstream Too Much

Service A sudah authorize, lalu Service B percaya penuh.

Masalah:

- Service B bisa dipanggil dari path lain;
- policy Service A mungkin tidak lengkap;
- token forwarded bisa terlalu privileged;
- confused deputy.

### 24.2 Every Service Reimplements Policy

Setiap service punya policy sendiri.

Masalah:

- inconsistent decisions;
- duplication;
- audit tersebar;
- perubahan policy sulit.

### 24.3 Model Lebih Sehat

```text
Gateway/API edge     : coarse request authn/authz
Application service  : use-case authorization
Domain policy module : shared policy library atau policy service
Data service         : enforces resource visibility
Audit sink           : centralized decision record
```

Untuk high-risk policy, bisa pakai centralized PDP, tetapi harus perhatikan:

- latency;
- availability;
- caching;
- policy versioning;
- fallback semantics;
- audit correlation;
- deploy coordination.

Jika PDP down, default untuk high-risk operation biasanya **deny**, bukan allow.

---

## 25. Confused Deputy Problem

Confused deputy terjadi ketika service dengan privilege tinggi melakukan aksi atas nama caller tanpa memeriksa apakah caller boleh.

Contoh:

```text
User A tidak boleh melihat Document D1.
User A memanggil Report Service.
Report Service punya service account dengan access luas.
Report Service mengambil D1 dan mengembalikannya ke User A.
```

Mitigasi:

1. Propagate subject identity.
2. Gunakan on-behalf-of token jika memungkinkan.
3. Service account permission jangan terlalu luas.
4. Downstream service tetap enforce resource authorization.
5. Audit `actor` dan `effective subject`.

Model audit:

```text
actor = report-service
onBehalfOf = user-a
resource = document-d1
decision = deny
reason = DENY_ON_BEHALF_SUBJECT_NOT_ALLOWED
```

---

## 26. Custom Authorization Annotation

Untuk mengurangi SpEL string di codebase, bisa buat annotation.

```java
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireCasePermission {
    String action();
    String caseIdParam() default "caseId";
}
```

Aspect:

```java
@Aspect
@Component
public class RequireCasePermissionAspect {

    private final CaseAuthorizationGuard guard;

    @Around("@annotation(requirement)")
    public Object authorize(ProceedingJoinPoint pjp,
                            RequireCasePermission requirement) throws Throwable {
        String caseId = extractArgument(pjp, requirement.caseIdParam());
        guard.require(caseId, requirement.action());
        return pjp.proceed();
    }
}
```

Usage:

```java
@RequireCasePermission(action = "CASE_APPROVE", caseIdParam = "caseId")
public ApprovalResult approve(String caseId, ApprovalCommand command) {
    ...
}
```

### 26.1 Risiko Custom Annotation

Custom annotation bisa menjadi bagus jika:

- semantics jelas;
- extraction argument robust;
- test coverage kuat;
- failure closed;
- audit terintegrasi;
- tidak menyembunyikan policy terlalu jauh.

Bisa buruk jika:

- reflection argument fragile;
- parameter name tidak tersedia;
- annotation terlalu generic;
- internal call bypass;
- tidak ada negative test.

---

## 27. Authorization for Data Export and Reports

Export/report sering lebih berbahaya daripada single read.

Contoh:

```http
GET /api/reports/cases/export
```

Risiko:

- mass data exfiltration;
- cross-tenant leak;
- query filter lupa;
- async job berjalan dengan system user;
- file tersimpan di object storage tanpa tenant/security metadata;
- download link bisa diteruskan ke user lain.

Policy export harus menjawab:

```text
- boleh export jenis report ini?
- scope tenant apa?
- max date range?
- max row count?
- field sensitif boleh ikut?
- perlu approval?
- perlu watermark?
- link expiry berapa lama?
- audit siapa yang download?
```

Spring pattern:

```java
authorization.requireReportExport(reportType, criteria);
ExportJob job = exportService.createJob(subject, reportType, criteria);
```

Async worker harus menyimpan subject/scope snapshot:

```java
record ExportAuthorizationSnapshot(
    String requestedBy,
    String tenantId,
    Set<String> permissions,
    ReportScope scope,
    Instant requestedAt
) {}
```

Jangan biarkan worker memakai unlimited system permission tanpa scope original.

---

## 28. Authorization for Admin Functions

Admin bukan berarti superuser tanpa batas.

Admin function perlu dipisah:

```text
USER_VIEW
USER_CREATE
USER_DISABLE
ROLE_ASSIGN
ROLE_REMOVE
TENANT_CONFIG_UPDATE
SYSTEM_CONFIG_UPDATE
AUDIT_VIEW
SECURITY_EVENT_VIEW
```

High-risk admin action harus punya:

- permission khusus;
- audit wajib;
- maker-checker untuk role/permission change;
- reason mandatory;
- optional step-up authentication;
- notification ke owner/security team;
- denial by default untuk self-escalation.

Contoh self-escalation rule:

```java
if (command.targetUserId().equals(subject.userId())
    && command.addedPermissions().contains("ROLE_ASSIGN")) {
    return PolicyDecision.deny("DENY_SELF_PRIVILEGE_ESCALATION");
}
```

---

## 29. Method Security Testing

Gunakan test negatif sebagai first-class citizen.

Contoh:

```java
@SpringBootTest
@AutoConfigureMockMvc
class CaseApprovalSecurityTest {

    @Test
    @WithMockUser(authorities = "CASE_VIEW")
    void approve_denied_when_missingPermission() throws Exception {
        mockMvc.perform(post("/api/cases/C-100/approve")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"ok\"}"))
            .andExpect(status().isForbidden());
    }
}
```

Untuk policy service, gunakan plain unit test matrix.

```java
@ParameterizedTest
@MethodSource("approvalCases")
void canApprove_matrix(AuthSubject subject,
                       CaseAuthorizationSnapshot snapshot,
                       String expectedReason,
                       boolean expectedGranted) {
    PolicyDecision decision = policy.canApprove(subject, snapshot, context);

    assertThat(decision.granted()).isEqualTo(expectedGranted);
    assertThat(decision.reasonCode()).isEqualTo(expectedReason);
}
```

### 29.1 Authorization Matrix

Buat matrix:

| Subject | Permission | Tenant | Resource State | Relationship | Expected |
|---|---|---|---|---|---|
| officer | CASE_APPROVE | same | PENDING_APPROVAL | not creator | allow |
| officer | CASE_APPROVE | same | DRAFT | not creator | deny state |
| officer | CASE_APPROVE | different | PENDING_APPROVAL | not creator | deny tenant |
| creator | CASE_APPROVE | same | PENDING_APPROVAL | creator | deny maker-checker |
| auditor | CASE_VIEW | same | CLOSED | none | allow read only |

Authorization tanpa matrix biasanya rapuh.

---

## 30. Testing Query-Level Authorization

Test bukan hanya endpoint 403/200.

Harus test:

1. authorized rows muncul;
2. unauthorized rows tidak muncul;
3. pagination benar setelah filter;
4. total count tidak bocor;
5. sort tidak bypass filter;
6. search keyword tidak bypass filter;
7. export menggunakan filter yang sama;
8. tenant predicate selalu ada.

Contoh:

```java
@Test
void searchCases_returnsOnlyVisibleCasesForOfficer() {
    seedCase("C-1", tenantA, assignedToAlice);
    seedCase("C-2", tenantA, assignedToBob);
    seedCase("C-3", tenantB, assignedToAlice);

    Page<CaseListItem> result = query.searchVisibleCases(criteria, aliceSubject, PageRequest.of(0, 20));

    assertThat(result.getContent())
        .extracting(CaseListItem::caseId)
        .containsExactly("C-1");
}
```

---

## 31. Observability for Authorization

Metrics yang berguna:

```text
authz.decisions.total{action,result,reasonCode}
authz.denied.total{action,reasonCode}
authz.decision.duration{action}
authz.policy.cache.hit/miss
authz.query.filtered.count
authz.override.total{action}
```

Hati-hati cardinality.

Jangan jadikan `userId`, `caseId`, atau raw tenant sebagai metric tag jika cardinality tinggi.

Untuk trace/log:

```text
correlationId=...
subjectId=...
action=CASE_APPROVE
resourceType=CASE
resourceId=C-100
decision=DENY
reasonCode=DENY_MAKER_CHECKER_VIOLATION
```

Untuk metric:

```text
action=CASE_APPROVE
result=DENY
reasonCode=DENY_MAKER_CHECKER_VIOLATION
```

---

## 32. Common Authorization Failure Modes

### 32.1 Missing Deny-by-Default

Semua path yang tidak match harus deny.

```java
.anyRequest().denyAll()
```

atau minimal:

```java
.anyRequest().authenticated()
```

untuk area yang memang semua authenticated.

### 32.2 Controller Protected, Service Unprotected

REST endpoint aman, tapi scheduler/message listener bisa panggil service tanpa check.

Solusi:

- guard di application service;
- policy check di use-case boundary;
- test non-HTTP entry point.

### 32.3 List Endpoint Leaks Data

Single read protected, tetapi search/list tidak filter tenant/visibility.

Solusi:

- authorization predicate di query;
- shared visibility spec;
- test pagination/count.

### 32.4 Role Explosion

Setiap kombinasi business rule dibuat role baru:

```text
ROLE_AGENCY_A_CASE_APPROVER_LEVEL_1_TEMP_DELEGATE
```

Solusi:

- role untuk grouping;
- permission untuk action;
- attribute/policy untuk context.

### 32.5 JWT Contains Too Much Authorization State

JWT menyimpan semua object permission.

Risiko:

- token besar;
- stale permission;
- revoke sulit;
- leakage.

Solusi:

- token berisi identity dan coarse permissions;
- object-level decision di app/policy service;
- version/revocation untuk high-risk.

### 32.6 Authorization Based on UI Only

Button disembunyikan, tetapi API tetap bisa dipanggil.

Solusi:

- UI permission hanya untuk UX;
- server tetap enforce semua operation.

### 32.7 Internal Endpoint Trusted Blindly

`/internal/**` dianggap aman karena network internal.

Solusi:

- service authentication;
- scoped service permission;
- on-behalf-of subject;
- audit;
- network trust bukan authorization.

---

## 33. Authorization Review Checklist

Gunakan checklist ini saat review PR.

### 33.1 Endpoint/API

- Apakah endpoint punya coarse authorization?
- Apakah rule spesifik diletakkan sebelum rule umum?
- Apakah default deny jelas?
- Apakah 401/403 semantics benar?
- Apakah response tidak mengungkap resource existence yang sensitif?

### 33.2 Use Case

- Apakah mutation high-risk punya explicit guard?
- Apakah guard berada di application service, bukan hanya controller?
- Apakah self-invocation proxy issue tidak terjadi?
- Apakah async/scheduler/message path juga enforce policy?

### 33.3 Resource/Object

- Apakah tenant resource diverifikasi dari data?
- Apakah object state masuk policy?
- Apakah maker-checker/separation-of-duties dicek?
- Apakah authorization snapshot cukup dan tidak over-fetch?

### 33.4 Query/List/Search

- Apakah authorization predicate masuk query?
- Apakah pagination/count dilakukan setelah filter DB?
- Apakah export/report memakai filter yang sama?
- Apakah search index punya tenant/visibility filter?

### 33.5 Audit/Observability

- Apakah denied high-risk action diaudit?
- Apakah granted mutation/export diaudit?
- Apakah reason code stabil?
- Apakah correlation ID dicatat?
- Apakah PII/secrets tidak masuk log/audit berlebihan?

### 33.6 Testing

- Apakah ada positive dan negative test?
- Apakah ada matrix test untuk policy?
- Apakah cross-tenant test ada?
- Apakah missing permission test ada?
- Apakah stale/cache scenario dipikirkan?

---

## 34. Design Heuristics for Top-Tier Spring Authorization

1. Jangan jadikan role sebagai semua hal.
2. Gunakan permission/action sebagai contract stabil.
3. Pisahkan identity establishment dari policy decision.
4. Treat authorization as domain/application policy, not just framework config.
5. Gunakan request-level authorization untuk coarse gate.
6. Gunakan method/use-case authorization untuk operation boundary.
7. Gunakan query predicate untuk listing/search/export.
8. Gunakan database/RLS sebagai defense-in-depth, bukan satu-satunya policy.
9. Simpan reason code untuk decision penting.
10. Default deny jika context/resource tidak lengkap.
11. Jangan cache high-risk mutation authorization sembarangan.
12. Jangan percaya UI sebagai enforcement.
13. Jangan percaya upstream service tanpa on-behalf-of semantics.
14. Jangan tampilkan denial reason sensitif ke caller.
15. Test authorization sebagai matrix, bukan beberapa happy path.

---

## 35. Mini Blueprint: Case Approval Authorization

### 35.1 Requirement

```text
User boleh approve case jika:
- authenticated;
- punya permission CASE_APPROVE;
- tenant sama dengan case;
- case state PENDING_APPROVAL;
- user bukan creator/submitter;
- user tidak punya conflict flag pada case;
- jika delegated, delegation valid;
- action diaudit baik allow maupun deny;
- API response tidak membocorkan detail sensitif.
```

### 35.2 Components

```text
SecurityFilterChain
  coarse endpoint protection

CaseApprovalController
  maps HTTP command

CaseApprovalService
  transaction/use-case boundary

CaseAuthorizationGuard
  explicit enforcement + audit

CaseAuthorizationPolicy
  pure policy decision

CaseAuthorizationQuery
  loads minimal snapshot

PolicyAuditSink
  records decision
```

### 35.3 Flow

```text
POST /api/cases/{caseId}/approve
  ↓
SecurityFilterChain checks authenticated + CASE_APPROVE coarse authority
  ↓
Controller parses/validates request
  ↓
CaseApprovalService.approve(caseId, command)
  ↓
CaseAuthorizationGuard.requireApprove(caseId)
  ↓
CaseAuthorizationQuery.findAuthorizationSnapshot(caseId)
  ↓
CaseAuthorizationPolicy.canApprove(subject, snapshot, context)
  ↓
PolicyAuditSink.record(...)
  ↓
if deny -> AccessDeniedException
if allow -> continue mutation
  ↓
Case aggregate locked/loaded
  ↓
Domain validates state transition
  ↓
Persist approval
  ↓
Publish after-commit event/outbox
```

### 35.4 Why This Is Defensible

- coarse request-level protection rejects obvious invalid caller;
- application service guard protects non-HTTP callers;
- policy is testable without Spring;
- query uses minimal snapshot;
- reason code is stable;
- audit captures allow/deny;
- domain still enforces state invariant;
- transaction boundary is explicit;
- failure defaults to deny.

---

## 36. Ringkasan

Authorization advanced di Spring bukan hanya konfigurasi `HttpSecurity`.

Untuk sistem enterprise, authorization harus diperlakukan sebagai:

```text
policy decision + policy enforcement + data visibility + audit + test matrix
```

Spring Security menyediakan enforcement adapter yang kuat:

- `SecurityFilterChain`;
- `AuthorizationManager`;
- method security;
- expression support;
- ACL support;
- testing support.

Tetapi policy enterprise tetap harus didesain sebagai model aplikasi/domain yang eksplisit.

Top-tier engineer tidak hanya bertanya:

```text
Bagaimana cara membuat endpoint ini 403?
```

Tetapi bertanya:

```text
Apa subject/action/resource/context policy-nya?
Di layer mana enforcement terjadi?
Apakah list/search/export juga aman?
Apakah reason decision terekam?
Apakah cross-tenant dan maker-checker tertutup?
Apakah policy ini bisa diuji sebagai matrix?
Apakah denial response aman?
Apakah async/internal caller bisa bypass?
```

Itulah level berpikir yang membedakan penggunaan Spring Security biasa dari authorization architecture yang siap untuk sistem besar.

---

## 37. Referensi Utama

- Spring Security Reference — Authorization Architecture
- Spring Security Reference — Authorize HTTP Requests
- Spring Security Reference — Method Security
- Spring Security Reference — Domain Object Security ACLs
- Spring Security API — `AuthorizationManager`
- Spring Security API — `AclPermissionEvaluator`
- Spring Framework Reference — AOP Proxying
- Spring Boot Reference — Security auto-configuration and testing support

---

## 38. Status Seri

```text
Part saat ini : 32 dari 35
Status        : belum selesai
Berikutnya    : 33-migration-engineering-spring5-6-7-boot2-3-4.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./31-spring-cloud-distributed-system-integration.md">⬅️ Part 31 — Spring Cloud and Distributed System Integration</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./33-migration-engineering-spring5-6-7-boot2-3-4.md">Part 33 — Migration Engineering: Spring 5 → 6 → 7, Boot 2 → 3 → 4 ➡️</a>
</div>

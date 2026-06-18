# 26 — Security Design Patterns: Authorization Context, Policy Boundary, Capability, and Auditability

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 26 dari 35  
> Target: Java 8 sampai Java 25  
> File: `26-security-design-patterns-authz-context-policy-boundary.md`

---

## 0. Peta Besar

Security design pattern bukan terutama tentang menambahkan library security, annotation, JWT validator, atau filter HTTP. Itu hanya mekanisme.

Security design pattern adalah cara mendesain sistem agar pertanyaan berikut selalu punya jawaban eksplisit:

```text
Siapa subject-nya?
Apa resource/object yang diakses?
Operasi apa yang diminta?
Dalam konteks apa?
Berdasarkan policy mana?
Dengan bukti/evidence apa keputusan diberikan?
Apa yang dicatat untuk audit?
Apa yang terjadi jika informasi tidak lengkap?
```

Dalam codebase enterprise Java, masalah keamanan jarang muncul karena developer tidak tahu bahwa authorization penting. Masalah sering muncul karena authorization tersebar, implisit, tidak punya boundary, dan bergantung pada asumsi UI atau role string.

Contoh buruk yang sering terlihat:

```java
if (user.hasRole("ADMIN")) {
    application.approve();
}
```

Kode ini tampak aman, tetapi sebenarnya sangat miskin informasi:

```text
Role admin untuk module apa?
Apakah admin boleh approve object milik region lain?
Apakah application sudah dalam state yang boleh di-approve?
Apakah ada conflict of interest?
Apakah pembuat application boleh approve application sendiri?
Apakah action harus dicatat sebagai audit event?
Apakah approval perlu reason?
Apakah policy berbeda untuk manual approval vs batch approval?
```

Top engineer tidak hanya bertanya “sudah dicek role atau belum?”. Pertanyaan yang lebih benar:

```text
Apakah authorization model-nya mampu merepresentasikan aturan bisnis, object ownership,
state, tenant, delegation, channel, time, risk level, dan auditability secara eksplisit?
```

---

## 1. Tujuan Pembelajaran

Setelah mempelajari part ini, kamu diharapkan mampu:

1. Membedakan authentication, authorization, identity, principal, subject, permission, role, policy, dan capability.
2. Mendesain authorization sebagai boundary eksplisit, bukan sebagai `if` tersebar.
3. Menggunakan Policy Object untuk membuat access decision yang testable dan auditable.
4. Mendesain `SecurityContext` / `AccessContext` dengan aman tanpa membuat global state berbahaya.
5. Membedakan RBAC, ABAC, ReBAC, ACL, ownership-based access, dan capability-based access.
6. Mengenali anti-pattern seperti scattered role check, trust client input, confused deputy, dan authorization-after-mutation.
7. Mendesain audit event sebagai domain/security evidence, bukan sekadar log string.
8. Mengikat security pattern dengan Java 8–25, terutama records, sealed classes, pattern matching, virtual threads, scoped values, dan structured concurrency.
9. Mendesain testing strategy untuk access control, object-level authorization, dan policy regression.
10. Mampu melakukan security design review terhadap Java service/module nyata.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sistem regulatory case management.

Ada entity:

```text
Application
Case
Inspection
Appeal
Violation
Sanction
Correspondence
Payment
Document
AuditTrail
```

Ada actor:

```text
External Applicant
Agency Officer
Case Officer
Supervisor
Legal Officer
System Integration User
Batch Job
Support Admin
```

Ada action:

```text
view
create
draft
submit
assign
approve
reject
withdraw
escalate
generate letter
download document
update sensitive field
trigger integration
```

Jika authorization hanya dibuat seperti ini:

```java
@PreAuthorize("hasRole('OFFICER')")
public CaseDetail getCase(String caseId) {
    return caseRepository.find(caseId);
}
```

maka banyak pertanyaan penting tidak terjawab:

```text
OFFICER mana?
Officer dari agency mana?
Officer boleh melihat case status apa?
Officer boleh melihat document sensitive atau tidak?
Apakah object milik tenant/agency berbeda?
Apakah assigned officer saja yang boleh update?
Apakah supervisor boleh override?
Apakah external applicant boleh melihat case internal?
Apakah read access berbeda dengan export access?
Apakah field-level access berbeda dengan object-level access?
```

Masalah ini dikenal dalam praktik API security sebagai object-level authorization issue. OWASP API Security Top 10 2023 menempatkan Broken Object Level Authorization sebagai risiko API nomor satu; masalahnya muncul karena endpoint menerima object identifier dan tidak melakukan authorization object-level secara benar untuk setiap fungsi yang mengakses data berdasarkan ID dari user.

Dalam desain Java enterprise, solusi yang matang bukan hanya “tambahkan annotation”. Solusinya adalah memodelkan access decision sebagai bagian dari application boundary.

---

## 3. Mental Model: Security Sebagai Decision Boundary

Security bukan fitur sampingan. Security adalah boundary keputusan.

```text
Request masuk
    ↓
Authentication: siapa caller-nya?
    ↓
Context construction: dari mana, channel apa, tenant apa, delegation apa?
    ↓
Resource loading: object apa yang hendak diakses?
    ↓
Authorization policy: apakah subject boleh melakukan action terhadap object?
    ↓
Domain invariant: apakah action valid terhadap state object?
    ↓
Mutation / read / side effect
    ↓
Audit event
```

Security design yang buruk mencampur semuanya:

```java
public void approve(String applicationId, User user) {
    Application app = repo.find(applicationId);

    if (!user.getRoles().contains("ADMIN")) {
        throw new RuntimeException("Forbidden");
    }

    if (!app.getStatus().equals("SUBMITTED")) {
        throw new RuntimeException("Invalid status");
    }

    app.setStatus("APPROVED");
    repo.save(app);
    log.info("approved");
}
```

Security design yang lebih matang memisahkan jenis keputusan:

```text
Authentication decision:
    Token valid? Session valid? Caller known?

Authorization decision:
    Caller may approve this application?

Domain decision:
    Application can transition from SUBMITTED to APPROVED?

Audit decision:
    What evidence must be recorded for this sensitive action?
```

Pemisahan ini penting karena failure mode-nya berbeda.

| Decision | Jika Salah | Dampak |
|---|---|---|
| Authentication | Caller palsu diterima | Identity compromise |
| Authorization | Caller asli mengakses object/action yang tidak boleh | Privilege escalation |
| Domain invariant | Action legal secara security tetapi illegal secara bisnis | Data corruption |
| Audit | Action benar tetapi tidak dapat dibuktikan | Compliance failure |
| Error handling | Detail internal bocor | Information disclosure |
| Context propagation | Authorization memakai context salah | Confused deputy / cross-tenant bug |

---

## 4. Vocabulary yang Harus Jelas

### 4.1 Authentication

Authentication menjawab:

```text
Siapa caller ini?
```

Contoh:

```text
Password login
OIDC login
SAML assertion
mTLS client certificate
API key
service account token
signed request
```

Authentication menghasilkan identity/principal, tetapi belum menjawab apakah caller boleh melakukan action tertentu.

---

### 4.2 Authorization

Authorization menjawab:

```text
Apakah subject ini boleh melakukan operation ini terhadap resource ini dalam context ini?
```

Formula penting:

```text
Authorization = f(subject, action, resource, context, policy)
```

Bukan:

```text
Authorization = f(role)
```

Role hanya salah satu input.

---

### 4.3 Identity

Identity adalah representasi siapa user/service.

```java
public record Identity(
        String subjectId,
        IdentityType type,
        String displayName
) {}

enum IdentityType {
    HUMAN_USER,
    SERVICE_ACCOUNT,
    BATCH_JOB,
    SYSTEM_INTEGRATION
}
```

Identity harus stabil dan tidak boleh hanya memakai display name/email jika sistem butuh audit kuat.

---

### 4.4 Principal

Principal adalah identity yang sudah dikenali oleh security runtime.

Di Java/Jakarta/Spring, istilah principal sering muncul pada:

```text
java.security.Principal
SecurityContext
Authentication
JWT subject
OIDC principal
```

Principal sering terlalu teknis untuk langsung dipakai di domain. Biasanya perlu diterjemahkan ke `Actor`, `Subject`, atau `AccessSubject` milik aplikasi.

---

### 4.5 Subject / Actor

Subject adalah entity yang meminta akses.

```java
public record AccessSubject(
        SubjectId id,
        SubjectKind kind,
        Set<Role> roles,
        Set<Permission> permissions,
        OrganizationId organizationId,
        Set<AgencyId> agencies,
        boolean supportImpersonationActive
) {}
```

Subject tidak selalu human user. Batch job, integration client, dan internal service juga subject.

---

### 4.6 Resource / Object

Resource adalah object yang hendak diakses.

```java
public record ProtectedResource(
        ResourceType type,
        String id,
        OrganizationId ownerOrganization,
        AgencyId agencyId,
        Sensitivity sensitivity,
        LifecycleState state
) {}
```

Object-level authorization hanya bisa dilakukan jika policy punya informasi object.

---

### 4.7 Action / Operation

Action adalah operasi yang diminta.

```java
public enum CaseAction {
    VIEW,
    EDIT,
    ASSIGN,
    APPROVE,
    REJECT,
    ESCALATE,
    DOWNLOAD_DOCUMENT,
    EXPORT,
    DELETE_DRAFT
}
```

Jangan terlalu cepat menyamakan action dengan HTTP method.

```text
GET /cases/{id}         -> VIEW_CASE
GET /cases/{id}/export  -> EXPORT_CASE
POST /cases/{id}/approve -> APPROVE_CASE
PATCH /cases/{id}       -> EDIT_CASE
```

`GET` bisa jauh lebih sensitif daripada `POST` jika menghasilkan data rahasia.

---

### 4.8 Permission

Permission adalah hak granular.

```java
public record Permission(String value) {
    public static final Permission CASE_APPROVE = new Permission("case.approve");
    public static final Permission CASE_VIEW_SENSITIVE = new Permission("case.view-sensitive");
}
```

Permission biasanya lebih stabil daripada role.

Role adalah grouping.
Permission adalah capability deklaratif.

---

### 4.9 Role

Role adalah kumpulan responsibility/permission.

```text
CASE_OFFICER
SUPERVISOR
LEGAL_OFFICER
SUPPORT_ADMIN
SYSTEM_INTEGRATION
```

Role baik untuk assignment dan operasional, tetapi buruk jika menjadi satu-satunya basis authorization.

Anti-pattern:

```java
if (role.equals("ADMIN")) { ... }
```

Lebih baik:

```java
policy.authorize(subject, CaseAction.APPROVE, resource, context);
```

---

### 4.10 Policy

Policy adalah aturan keputusan.

```text
A supervisor may approve a submitted case if:
- subject has CASE_APPROVE permission,
- subject belongs to the same agency,
- subject is not the original submitter,
- case status is SUBMITTED,
- case risk level is not HIGH unless subject has HIGH_RISK_APPROVER,
- action is performed through internal channel,
- all mandatory review checks are completed.
```

Policy harus bisa dites, dijelaskan, dan diaudit.

---

### 4.11 Capability

Capability adalah token/object/permission yang merepresentasikan hak melakukan operasi tertentu.

Contoh:

```java
public record ApprovalCapability(
        CaseId caseId,
        SubjectId grantedTo,
        Instant expiresAt,
        String reason
) {}
```

Capability pattern berguna saat hak akses ingin dikemas sebagai object yang bisa dipassing ke fungsi tanpa perlu mengecek ulang banyak context, selama capability itu dibuat melalui authorization path yang benar.

Namun capability juga berbahaya jika tidak punya scope, expiry, revocation, dan audit.

---

## 5. Pattern #1 — Authorization Policy Object

### 5.1 Problem

Authorization tersebar di controller, service, repository, mapper, dan UI.

Contoh buruk:

```java
if (user.hasRole("SUPERVISOR") || user.hasRole("ADMIN")) {
    if (caseRecord.getAgencyId().equals(user.getAgencyId())) {
        if (!caseRecord.getCreatedBy().equals(user.getId())) {
            approve(caseRecord);
        }
    }
}
```

Masalah:

```text
Sulit dites secara utuh.
Sulit tahu policy mana yang sedang berlaku.
Sulit audit kenapa akses ditolak.
Sulit reuse di endpoint lain.
Sulit ubah rule tanpa regression.
Sulit membedakan security decision dan domain decision.
```

---

### 5.2 Solution

Buat policy object eksplisit.

```java
public interface AuthorizationPolicy<A, R> {
    AccessDecision authorize(AccessSubject subject, A action, R resource, AccessContext context);
}
```

Dengan result eksplisit:

```java
public sealed interface AccessDecision
        permits AccessDecision.Permit, AccessDecision.Deny {

    record Permit(List<AccessReason> reasons) implements AccessDecision {}

    record Deny(DenyCode code, List<AccessReason> reasons) implements AccessDecision {}

    default boolean permitted() {
        return this instanceof Permit;
    }
}

public record AccessReason(String code, String message) {}

public enum DenyCode {
    NOT_AUTHENTICATED,
    MISSING_PERMISSION,
    DIFFERENT_AGENCY,
    CONFLICT_OF_INTEREST,
    UNSUPPORTED_CHANNEL,
    RESOURCE_STATE_NOT_ALLOWED,
    RESOURCE_NOT_FOUND_OR_NOT_VISIBLE
}
```

Contoh policy:

```java
public final class CaseApprovalPolicy
        implements AuthorizationPolicy<CaseAction, CaseResource> {

    @Override
    public AccessDecision authorize(
            AccessSubject subject,
            CaseAction action,
            CaseResource resource,
            AccessContext context
    ) {
        if (action != CaseAction.APPROVE) {
            return deny(DenyCode.MISSING_PERMISSION, "Unsupported action for this policy");
        }

        if (!subject.permissions().contains(Permission.CASE_APPROVE)) {
            return deny(DenyCode.MISSING_PERMISSION, "Subject lacks case.approve permission");
        }

        if (!subject.agencies().contains(resource.agencyId())) {
            return deny(DenyCode.DIFFERENT_AGENCY, "Subject agency does not match case agency");
        }

        if (resource.createdBy().equals(subject.id())) {
            return deny(DenyCode.CONFLICT_OF_INTEREST, "Creator cannot approve own case");
        }

        if (context.channel() != AccessChannel.INTERNAL_PORTAL) {
            return deny(DenyCode.UNSUPPORTED_CHANNEL, "Approval requires internal portal channel");
        }

        if (resource.state() != CaseState.SUBMITTED) {
            return deny(DenyCode.RESOURCE_STATE_NOT_ALLOWED, "Case is not submitted");
        }

        return new AccessDecision.Permit(List.of(
                new AccessReason("CASE_APPROVE_ALLOWED", "Subject may approve this case")
        ));
    }

    private static AccessDecision.Deny deny(DenyCode code, String message) {
        return new AccessDecision.Deny(code, List.of(new AccessReason(code.name(), message)));
    }
}
```

---

### 5.3 Usage di Application Service

```java
public final class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final CaseApprovalPolicy approvalPolicy;
    private final AuditSink auditSink;

    public ApproveCaseUseCase(
            CaseRepository caseRepository,
            CaseApprovalPolicy approvalPolicy,
            AuditSink auditSink
    ) {
        this.caseRepository = caseRepository;
        this.approvalPolicy = approvalPolicy;
        this.auditSink = auditSink;
    }

    public void approve(ApproveCaseCommand command, AccessSubject subject, AccessContext context) {
        CaseRecord caseRecord = caseRepository.findRequired(command.caseId());
        CaseResource resource = CaseResource.from(caseRecord);

        AccessDecision decision = approvalPolicy.authorize(
                subject,
                CaseAction.APPROVE,
                resource,
                context
        );

        if (decision instanceof AccessDecision.Deny deny) {
            auditSink.record(AuditEvent.accessDenied(
                    subject.id(),
                    resource.id(),
                    CaseAction.APPROVE.name(),
                    deny.code().name(),
                    context.correlationId()
            ));
            throw new ForbiddenException(deny.code());
        }

        caseRecord.approveBy(subject.id(), command.reason());
        caseRepository.save(caseRecord);

        auditSink.record(AuditEvent.caseApproved(
                subject.id(),
                resource.id(),
                context.correlationId()
        ));
    }
}
```

Perhatikan urutannya:

```text
Load resource
Authorize subject-action-resource-context
Mutate domain
Persist
Audit
```

Untuk operasi yang sensitif, audit denial juga penting.

---

## 6. Pattern #2 — Access Context Object

### 6.1 Problem

Banyak policy butuh informasi selain user dan role:

```text
channel
client application
tenant
agency
request time
source IP / network zone
delegation/impersonation
correlation ID
authentication method
assurance level
session age
feature flag
risk signal
```

Jika informasi ini diambil langsung dari static/global object di banyak tempat, security decision menjadi tidak deterministik dan sulit dites.

---

### 6.2 Solution

Modelkan context sebagai immutable value object.

```java
public record AccessContext(
        TenantId tenantId,
        AccessChannel channel,
        ClientId clientId,
        Instant requestTime,
        String correlationId,
        AuthenticationMethod authenticationMethod,
        AssuranceLevel assuranceLevel,
        Optional<DelegationContext> delegation,
        NetworkZone networkZone
) {}

public enum AccessChannel {
    INTERNAL_PORTAL,
    EXTERNAL_PORTAL,
    PUBLIC_API,
    BATCH,
    SYSTEM_INTEGRATION
}

public enum NetworkZone {
    INTERNET,
    INTRANET,
    PRIVATE_SERVICE_NETWORK
}
```

Kelebihan:

```text
Policy menjadi pure-ish function.
Testing mudah.
Audit bisa memakai context yang sama.
Context tidak tersebar sebagai ThreadLocal random.
Cross-boundary propagation eksplisit.
```

---

### 6.3 ThreadLocal vs ScopedValue

Di Java lama, context sering disimpan di `ThreadLocal`.

```java
public final class SecurityContextHolder {
    private static final ThreadLocal<AccessContext> CURRENT = new ThreadLocal<>();

    public static AccessContext current() {
        AccessContext context = CURRENT.get();
        if (context == null) {
            throw new IllegalStateException("No access context");
        }
        return context;
    }

    public static void set(AccessContext context) {
        CURRENT.set(context);
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Masalah:

```text
Context leak jika lupa clear.
Sulit dengan async execution.
Sulit dengan thread pool reuse.
Berbahaya dengan virtual threads jika asumsi lama dibawa tanpa review.
```

Java modern memperkenalkan `ScopedValue` sebagai mekanisme context yang lexical-scoped dan immutable-friendly.

Contoh konseptual Java 25:

```java
public final class AccessScope {
    public static final ScopedValue<AccessContext> ACCESS_CONTEXT = ScopedValue.newInstance();

    public static AccessContext current() {
        if (!ACCESS_CONTEXT.isBound()) {
            throw new IllegalStateException("No access context bound");
        }
        return ACCESS_CONTEXT.get();
    }
}
```

Usage:

```java
ScopedValue.where(AccessScope.ACCESS_CONTEXT, accessContext)
        .run(() -> useCase.approve(command));
```

Tetapi prinsip desainnya tetap sama:

```text
Security context boleh tersedia secara scoped untuk infrastructure convenience,
tetapi business/security policy sebaiknya tetap menerima context sebagai parameter eksplisit
pada boundary penting.
```

---

## 7. Pattern #3 — Permission Evaluator / Authorization Service

### 7.1 Problem

Kadang ada banyak policy, banyak resource type, dan banyak action.

Jika semua use case tahu policy konkret, application service menjadi penuh wiring policy.

---

### 7.2 Solution

Buat authorization service sebagai dispatcher ke policy.

```java
public interface AuthorizationService {
    AccessDecision authorize(AuthorizationRequest request);
}

public record AuthorizationRequest(
        AccessSubject subject,
        Action action,
        ProtectedResource resource,
        AccessContext context
) {}

public record Action(String value) {
    public static Action of(String value) {
        return new Action(value);
    }
}
```

Implementation:

```java
public final class DefaultAuthorizationService implements AuthorizationService {
    private final List<ResourceAuthorizationPolicy> policies;

    public DefaultAuthorizationService(List<ResourceAuthorizationPolicy> policies) {
        this.policies = List.copyOf(policies);
    }

    @Override
    public AccessDecision authorize(AuthorizationRequest request) {
        for (ResourceAuthorizationPolicy policy : policies) {
            if (policy.supports(request.action(), request.resource().type())) {
                return policy.authorize(request);
            }
        }
        return new AccessDecision.Deny(
                DenyCode.MISSING_PERMISSION,
                List.of(new AccessReason("NO_POLICY", "No policy registered for action/resource"))
        );
    }
}
```

Important invariant:

```text
No policy found = deny
Policy failure = deny
Missing context = deny
Unknown action = deny
Unknown resource = deny or not found, depending information disclosure strategy
```

OWASP Authorization Cheat Sheet menekankan prinsip deny by default dan least privilege. Dalam desain Java, prinsip ini harus muncul sebagai behavior default authorization service, bukan hanya guideline di dokumen.

---

## 8. Pattern #4 — Capability Object

### 8.1 Problem

Kadang operasi internal terdiri dari beberapa step.

Contoh:

```text
Step 1: authorize approve
Step 2: validate domain
Step 3: generate decision letter
Step 4: update case status
Step 5: publish event
```

Jika setiap step mengecek ulang role/user sendiri, logic security bisa tersebar dan tidak konsisten.

---

### 8.2 Solution

Setelah authorization berhasil, buat capability object yang scope-nya spesifik.

```java
public record CaseApprovalCapability(
        CaseId caseId,
        SubjectId approverId,
        Instant grantedAt,
        Instant expiresAt,
        String policyVersion,
        List<AccessReason> reasons
) {
    public boolean expired(Instant now) {
        return !now.isBefore(expiresAt);
    }
}
```

Factory capability:

```java
public final class CaseApprovalAuthorizer {
    private final CaseApprovalPolicy policy;
    private final Clock clock;

    public CaseApprovalAuthorizer(CaseApprovalPolicy policy, Clock clock) {
        this.policy = policy;
        this.clock = clock;
    }

    public CaseApprovalCapability authorize(
            AccessSubject subject,
            CaseResource resource,
            AccessContext context
    ) {
        AccessDecision decision = policy.authorize(subject, CaseAction.APPROVE, resource, context);

        if (decision instanceof AccessDecision.Deny deny) {
            throw new ForbiddenException(deny.code());
        }

        AccessDecision.Permit permit = (AccessDecision.Permit) decision;
        Instant now = clock.instant();

        return new CaseApprovalCapability(
                resource.caseId(),
                subject.id(),
                now,
                now.plusSeconds(60),
                "case-approval-v3",
                permit.reasons()
        );
    }
}
```

Domain method menerima capability:

```java
public void approve(CaseApprovalCapability capability, ApprovalReason reason, Instant now) {
    if (!id.equals(capability.caseId())) {
        throw new IllegalArgumentException("Capability does not belong to this case");
    }
    if (capability.expired(now)) {
        throw new IllegalStateException("Capability expired");
    }
    if (state != CaseState.SUBMITTED) {
        throw new IllegalStateException("Case is not submitted");
    }

    this.state = CaseState.APPROVED;
    this.approvedBy = capability.approverId();
    this.approvedAt = now;
    this.approvalReason = reason.value();
}
```

Capability pattern membantu membuat operasi sensitif menjadi eksplisit.

Namun jangan salah gunakan capability untuk menyembunyikan authorization permanen. Capability harus punya:

```text
scope
subject
resource
action
expiry
source policy version
audit evidence
non-transferability jika perlu
revocation model jika long-lived
```

---

## 9. Pattern #5 — Secure Facade

### 9.1 Problem

Domain service atau repository bisa dipanggil dari banyak entry point:

```text
REST API
batch job
message consumer
admin tool
integration endpoint
scheduler
```

Jika authorization hanya dilakukan di controller, entry point lain bisa bypass.

---

### 9.2 Solution

Buat secure application facade yang menjadi satu-satunya entry point untuk operasi sensitif.

```java
public final class SecureCaseFacade {
    private final AuthorizationService authorizationService;
    private final CaseRepository caseRepository;
    private final CaseWorkflowService workflowService;
    private final AuditSink auditSink;

    public SecureCaseFacade(
            AuthorizationService authorizationService,
            CaseRepository caseRepository,
            CaseWorkflowService workflowService,
            AuditSink auditSink
    ) {
        this.authorizationService = authorizationService;
        this.caseRepository = caseRepository;
        this.workflowService = workflowService;
        this.auditSink = auditSink;
    }

    public void approve(ApproveCaseCommand command, AccessSubject subject, AccessContext context) {
        CaseRecord caseRecord = caseRepository.findRequired(command.caseId());
        ProtectedResource resource = ProtectedResource.fromCase(caseRecord);

        AccessDecision decision = authorizationService.authorize(new AuthorizationRequest(
                subject,
                Action.of("case.approve"),
                resource,
                context
        ));

        if (decision instanceof AccessDecision.Deny deny) {
            auditSink.record(AuditEvent.accessDenied(subject, resource, "case.approve", deny, context));
            throw new ForbiddenException(deny.code());
        }

        workflowService.approve(caseRecord, subject.id(), command.reason());
        caseRepository.save(caseRecord);
        auditSink.record(AuditEvent.accessGranted(subject, resource, "case.approve", context));
    }
}
```

Controller, consumer, dan scheduler harus masuk melalui facade ini atau facade sejenis yang security-aware.

Anti-pattern:

```text
REST path secure, batch path bypass.
UI button hidden, backend mutation still open.
Admin endpoint trusts caller role without object check.
Repository returns data before visibility filter.
```

---

## 10. Pattern #6 — Resource Visibility Filter

### 10.1 Problem

Read/list endpoint sering lebih sulit daripada write endpoint.

Contoh:

```java
List<CaseRecord> cases = caseRepository.findAllOpenCases();
return mapper.toResponse(cases);
```

Jika filter authorization dilakukan setelah query:

```java
return cases.stream()
        .filter(c -> policy.canView(subject, c))
        .map(mapper::toResponse)
        .toList();
```

masalahnya:

```text
Data sensitif sudah ter-load ke memory.
Pagination salah.
Count salah.
Performance buruk.
Audit sulit.
Filter bisa lupa di endpoint lain.
```

---

### 10.2 Solution

Buat visibility criteria sebagai bagian query boundary.

```java
public record CaseVisibilityScope(
        TenantId tenantId,
        Set<AgencyId> visibleAgencies,
        boolean mayViewSensitive,
        boolean mayViewClosedCases
) {}
```

Resolver:

```java
public final class CaseVisibilityResolver {
    public CaseVisibilityScope resolve(AccessSubject subject, AccessContext context) {
        if (subject.permissions().contains(Permission.CASE_VIEW_ALL)) {
            return new CaseVisibilityScope(
                    context.tenantId(),
                    subject.agencies(),
                    subject.permissions().contains(Permission.CASE_VIEW_SENSITIVE),
                    subject.permissions().contains(Permission.CASE_VIEW_CLOSED)
            );
        }

        return new CaseVisibilityScope(
                context.tenantId(),
                subject.agencies(),
                false,
                false
        );
    }
}
```

Repository menggunakan scope:

```java
public interface CaseQueryRepository {
    Page<CaseSummary> search(CaseSearchQuery query, CaseVisibilityScope visibilityScope, PageRequest pageRequest);
}
```

SQL concept:

```sql
WHERE tenant_id = :tenantId
  AND agency_id IN (:visibleAgencies)
  AND (:mayViewClosedCases = true OR status <> 'CLOSED')
  AND (:mayViewSensitive = true OR sensitivity <> 'HIGH')
```

Security principle:

```text
List/query authorization harus berada sedekat mungkin dengan data selection boundary.
Object detail authorization tetap harus dicek saat object detail dibuka.
```

---

## 11. Pattern #7 — Field-Level Authorization / Data Masking

### 11.1 Problem

User boleh melihat object, tetapi tidak semua field.

Contoh:

```text
Officer boleh lihat case summary.
Supervisor boleh lihat internal note.
Legal officer boleh lihat legal opinion.
External applicant boleh lihat public-facing decision, bukan internal assessment.
Support admin boleh lihat metadata, bukan content PII.
```

Object-level authorization saja tidak cukup.

OWASP API Security 2023 juga membahas broken object property level authorization, yaitu API mengekspos properti object yang tidak seharusnya dapat diakses caller.

---

### 11.2 Solution

Pisahkan view model berdasarkan audience atau gunakan presenter yang security-aware.

Audience-specific DTO:

```java
public record ExternalCaseView(
        String caseNo,
        String status,
        String submittedAt,
        String publicDecision
) {}

public record OfficerCaseView(
        String caseNo,
        String status,
        String applicantName,
        String internalAssessment,
        String assignedOfficer
) {}
```

Security-aware presenter:

```java
public final class CasePresenter {
    public CaseDetailResponse present(
            CaseRecord caseRecord,
            AccessSubject subject,
            AccessContext context
    ) {
        boolean mayViewSensitive = subject.permissions().contains(Permission.CASE_VIEW_SENSITIVE);
        boolean mayViewInternalNote = subject.permissions().contains(Permission.CASE_VIEW_INTERNAL_NOTE);

        return new CaseDetailResponse(
                caseRecord.caseNo(),
                caseRecord.status().name(),
                mayViewSensitive ? caseRecord.applicantName() : "***",
                mayViewInternalNote ? caseRecord.internalNote() : null
        );
    }
}
```

Better for high-risk systems:

```text
Prefer audience-specific response models for strongly different audiences.
Use masking only when field set is mostly same and masking rules are simple.
```

Anti-pattern:

```java
return objectMapper.writeValueAsString(entity);
```

Entity exposure sering menjadi sumber kebocoran field.

---

## 12. Pattern #8 — Audit Event Pattern

### 12.1 Problem

Banyak sistem menganggap audit sama dengan log.

```java
log.info("User {} approved case {}", userId, caseId);
```

Ini tidak cukup untuk sistem yang butuh defensibility.

Audit event harus menjawab:

```text
Siapa melakukan apa?
Terhadap object apa?
Kapan?
Dari channel mana?
Berdasarkan authorization decision apa?
Apa hasilnya?
Apa reason/evidence?
Apa correlation/causation id?
Apakah ada before/after value untuk perubahan penting?
```

---

### 12.2 Solution

Modelkan audit sebagai structured event.

```java
public record AuditEvent(
        AuditEventId id,
        Instant occurredAt,
        SubjectId actorId,
        String actorType,
        String action,
        String resourceType,
        String resourceId,
        String outcome,
        String reasonCode,
        String correlationId,
        Map<String, String> attributes
) {
    public static AuditEvent accessDenied(
            AccessSubject subject,
            ProtectedResource resource,
            String action,
            AccessDecision.Deny deny,
            AccessContext context
    ) {
        return new AuditEvent(
                AuditEventId.newId(),
                context.requestTime(),
                subject.id(),
                subject.kind().name(),
                action,
                resource.type().name(),
                resource.id(),
                "DENIED",
                deny.code().name(),
                context.correlationId(),
                Map.of(
                        "tenantId", context.tenantId().value(),
                        "channel", context.channel().name()
                )
        );
    }
}
```

Audit harus structured, queryable, dan stabil.

---

### 12.3 Audit vs Log

| Aspect | Log | Audit Event |
|---|---|---|
| Tujuan | Debug/ops | Accountability/compliance |
| Format | Bisa bebas | Structured dan stabil |
| Retention | Operasional | Legal/regulatory policy |
| Audience | Engineer/SRE | Auditor, compliance, investigator |
| Completeness | Best effort | Harus memenuhi evidence requirement |
| Sensitive data | Harus hati-hati | Harus sangat terkendali |

Audit event bukan tempat membuang seluruh payload. Audit event harus menyimpan evidence yang cukup, bukan semua data.

---

## 13. Pattern #9 — Deny by Default

### 13.1 Problem

Default behavior sering tidak sengaja permit.

Contoh buruk:

```java
public boolean canAccess(User user, Action action) {
    if (action == Action.DELETE && user.isAdmin()) {
        return true;
    }
    if (action == Action.UPDATE && user.isOfficer()) {
        return true;
    }
    return true; // oops
}
```

Atau:

```java
switch (action) {
    case APPROVE -> checkApprove(user);
    case REJECT -> checkReject(user);
    default -> true;
}
```

---

### 13.2 Solution

Unknown harus deny.

```java
public AccessDecision authorize(AuthorizationRequest request) {
    return switch (request.action().value()) {
        case "case.view" -> authorizeView(request);
        case "case.approve" -> authorizeApprove(request);
        case "case.reject" -> authorizeReject(request);
        default -> deny(DenyCode.MISSING_PERMISSION, "Unknown action");
    };
}
```

Dengan sealed action lebih aman:

```java
public sealed interface CaseOperation permits ViewCase, ApproveCase, RejectCase, AssignCase {}

public record ViewCase(CaseId caseId) implements CaseOperation {}
public record ApproveCase(CaseId caseId) implements CaseOperation {}
public record RejectCase(CaseId caseId) implements CaseOperation {}
public record AssignCase(CaseId caseId, SubjectId assigneeId) implements CaseOperation {}
```

Exhaustive switch membantu mengurangi missing branch.

```java
public AccessDecision authorize(CaseOperation operation, AccessSubject subject, CaseRecord record) {
    return switch (operation) {
        case ViewCase view -> authorizeView(subject, record);
        case ApproveCase approve -> authorizeApprove(subject, record);
        case RejectCase reject -> authorizeReject(subject, record);
        case AssignCase assign -> authorizeAssign(subject, record, assign.assigneeId());
    };
}
```

---

## 14. Pattern #10 — Authorization Before Mutation

### 14.1 Problem

Mutation dilakukan sebelum authorization.

```java
public void updateCase(UpdateCaseRequest request, User user) {
    CaseRecord record = caseRepository.find(request.caseId());
    record.update(request); // mutation first

    if (!canEdit(user, record)) {
        throw new ForbiddenException();
    }

    caseRepository.save(record);
}
```

Walaupun exception terjadi sebelum save, mutation terhadap managed JPA entity bisa saja flush otomatis tergantung transaction behavior.

Ini berbahaya.

---

### 14.2 Solution

Authorize sebelum mutation.

```java
public void updateCase(UpdateCaseCommand command, AccessSubject subject, AccessContext context) {
    CaseRecord record = caseRepository.findRequired(command.caseId());
    ProtectedResource resource = ProtectedResource.fromCase(record);

    AccessDecision decision = authorizationService.authorize(new AuthorizationRequest(
            subject,
            Action.of("case.update"),
            resource,
            context
    ));

    if (decision instanceof AccessDecision.Deny deny) {
        throw new ForbiddenException(deny.code());
    }

    record.update(command.patch());
    caseRepository.save(record);
}
```

Rule:

```text
For sensitive operation:
1. Load minimum required resource state.
2. Authorize.
3. Validate domain invariant.
4. Mutate.
5. Persist.
6. Audit.
```

---

## 15. Authorization Model: RBAC, ABAC, ReBAC, ACL, Ownership, Capability

### 15.1 RBAC — Role-Based Access Control

RBAC memberi akses berdasarkan role.

```text
SUPERVISOR can approve case
OFFICER can edit case
LEGAL_OFFICER can add legal opinion
```

Kelebihan:

```text
Mudah dipahami.
Mudah dikelola organisasi.
Cocok untuk coarse-grained permission.
```

Kelemahan:

```text
Tidak cukup untuk object-level access.
Role explosion.
Sulit menangani condition: same agency, owner, status, risk level.
```

RBAC cocok sebagai input awal policy, bukan keseluruhan policy.

---

### 15.2 ABAC — Attribute-Based Access Control

ABAC memakai atribut subject, object, action, dan environment.

NIST SP 800-162 mendefinisikan ABAC sebagai metodologi access control yang menentukan authorization dengan mengevaluasi atribut subject, object, operation, dan kadang environment condition terhadap policy/rules.

Contoh:

```text
subject.agency == resource.agency
AND subject.permissions contains case.approve
AND resource.status == SUBMITTED
AND context.channel == INTERNAL_PORTAL
AND context.assuranceLevel >= HIGH
```

ABAC kuat untuk enterprise/regulatory system.

Kelemahan:

```text
Policy bisa sulit dibaca jika terlalu generik.
Debugging keputusan bisa sulit tanpa explanation model.
Performance query/list filtering lebih kompleks.
```

---

### 15.3 ReBAC — Relationship-Based Access Control

ReBAC memakai relasi.

```text
User is assigned officer of case.
User supervises assigned officer.
User belongs to same team.
User is delegated reviewer.
```

Cocok untuk:

```text
case assignment
organization hierarchy
collaboration
ownership
supervision
```

Kelemahan:

```text
Graph relation bisa kompleks.
Harus jelas source of truth relasi.
Harus hati-hati dengan caching.
```

---

### 15.4 ACL — Access Control List

ACL menyimpan daftar subject/permission per object.

```text
case-123:
  user-A: view
  user-B: edit
  group-C: approve
```

Cocok untuk resource collaborative atau document-like.

Kelemahan:

```text
Bisa sulit dikelola massal.
Inherited permission kompleks.
Revocation harus kuat.
```

---

### 15.5 Ownership-Based Access

Object owner boleh akses object tertentu.

```text
Applicant can view their own application.
Creator can edit draft before submission.
Assigned officer can update assigned case.
```

Anti-pattern umum:

```java
if (request.userId().equals(currentUser.id())) { ... }
```

Jangan percaya `userId` dari request body. Owner harus dibandingkan dengan authenticated subject dan object dari database.

---

### 15.6 Capability-Based Access

Capability menyatakan hak spesifik untuk melakukan operasi.

Cocok untuk:

```text
temporary approval token
one-time download link
delegated action
internal operation setelah authorization
```

Harus punya:

```text
scope
expiry
audience
non-transferability
signature/integrity jika keluar proses
revocation jika long-lived
```

---

## 16. Authentication Token Pattern: Trust Boundary untuk JWT/OIDC

Part ini tidak mengulang security cryptography atau OIDC detail, tetapi pattern-level concern penting.

JWT/OIDC token bukan domain user object. Token adalah external credential/claim container yang harus divalidasi dan diterjemahkan.

Security boundary:

```text
Raw token
    ↓ validate issuer/audience/signature/expiry/algorithm/etc.
Validated token claims
    ↓ map
Application identity
    ↓ enrich/load
Access subject
```

Jangan langsung memakai claim mentah sebagai authorization truth tanpa validasi dan mapping.

Bad:

```java
String role = jwt.getClaim("role");
if (role.equals("ADMIN")) { ... }
```

Better:

```java
AccessSubject subject = subjectResolver.resolve(validatedToken, context);
authorizationService.authorize(requestFor(subject, resource, action, context));
```

RFC 8725 sebagai JWT Best Current Practices menekankan validasi kriptografis, pembatasan algoritma, input validation, dan mitigasi berbagai confusion/implementation pitfalls. Untuk desain pattern, takeaway-nya:

```text
Token validation is infrastructure.
Subject construction is application security boundary.
Authorization is policy boundary.
```

---

## 17. Confused Deputy Pattern dan Pencegahannya

### 17.1 Apa itu Confused Deputy?

Confused deputy terjadi ketika komponen yang punya privilege tinggi digunakan oleh caller privilege rendah untuk melakukan sesuatu yang caller tidak boleh lakukan.

Contoh:

```text
External user tidak boleh download internal document.
Endpoint export memanggil DocumentService dengan system privilege.
DocumentService mengizinkan karena caller internal service.
Akhirnya external user memperoleh document.
```

Problem-nya bukan hanya authentication. Problem-nya adalah service downstream tidak tahu original actor dan intended authorization.

---

### 17.2 Pencegahan

Pattern:

```text
Propagate original actor context.
Propagate purpose/action.
Separate service identity from user identity.
Use scoped capability for delegated internal operation.
Downstream verifies capability or context.
Audit both actor and service.
```

Model:

```java
public record CallContext(
        ServiceIdentity callingService,
        Optional<AccessSubject> originalSubject,
        String purpose,
        String correlationId
) {}
```

Jangan hanya ini:

```text
Service A calls Service B with service token.
Service B trusts Service A completely.
```

Lebih aman:

```text
Service A calls Service B with service token + original subject + scoped purpose/capability.
Service B validates service identity and evaluates whether purpose/capability allows operation.
```

---

## 18. Anti-Pattern Catalog

### 18.1 Scattered Role Check

Gejala:

```java
if (user.hasRole("ADMIN")) { ... }
```

tersebar di controller, service, mapper, repository.

Dampak:

```text
Policy tidak konsisten.
Sulit audit.
Sulit test secara sistematis.
Sulit ubah role model.
Role menjadi semantic dumping ground.
```

Refactoring:

```text
Inventory role checks.
Kelompokkan by action/resource.
Buat permission/action enum.
Buat policy object.
Pindahkan check ke application boundary.
Tambahkan regression tests.
```

---

### 18.2 Trust Client Input

Bad:

```java
if (request.userId().equals(currentUser.id())) {
    updateProfile(request);
}
```

Lebih buruk:

```java
if (request.role().equals("ADMIN")) {
    approve();
}
```

Rule:

```text
Client input is request data, not authority data.
Authority comes from authenticated context and trusted server-side source.
```

---

### 18.3 UI-Only Authorization

Gejala:

```text
Button approve disembunyikan di frontend.
Backend endpoint tetap bisa dipanggil.
```

Frontend boleh membantu UX, tetapi backend harus menjadi source of enforcement.

---

### 18.4 Authorization After Mutation

Mutation terjadi sebelum check.

Bahaya khusus di JPA/Hibernate:

```text
Managed entity berubah.
Flush bisa terjadi sebelum exception keluar.
Transactional boundary tidak sesuai asumsi developer.
```

---

### 18.5 Repository as Security Bypass

Repository bisa dipakai langsung oleh banyak service tanpa visibility filtering.

```java
caseRepository.findById(id)
```

dipakai di endpoint external tanpa authorization.

Refactoring:

```text
Pisahkan internal repository dan authorized query service.
Buat SecureFacade.
Tambahkan visibility scope untuk query.
Batasi injection repository langsung ke controller.
```

---

### 18.6 God Admin

Semua masalah diselesaikan dengan role admin.

```text
ADMIN can do everything.
```

Dampak:

```text
Least privilege gagal.
Support user terlalu kuat.
Audit risk tinggi.
Insider threat meningkat.
```

Lebih baik:

```text
Break-glass access.
Time-bound elevation.
Reason required.
Dual control untuk action tertentu.
Audit high severity.
```

---

### 18.7 Permission Explosion

Setiap tombol dibuat permission baru tanpa taxonomy.

```text
CASE_APPROVE_BUTTON_ENABLED
CASE_APPROVE_PAGE_VISIBLE
CASE_APPROVE_API_ALLOWED
CASE_APPROVE_MENU_ALLOWED
```

Lebih baik:

```text
Permission merepresentasikan capability bisnis.
UI affordance diturunkan dari permission/action availability.
```

---

### 18.8 Annotation Magic Authorization

Bad:

```java
@PreAuthorize("hasRole('ADMIN') or #id == principal.id")
public CaseDetail getCase(String id) { ... }
```

Annotation expression cocok untuk coarse gate, tetapi buruk untuk complex object-level/domain policy.

Masalah:

```text
String expression sulit refactor.
Object belum tentu loaded.
Policy tersebar di annotation.
Testing granular sulit.
Explanation/audit lemah.
```

Gunakan annotation sebagai outer gate jika perlu, tetapi policy object tetap menjadi authoritative decision untuk operasi kompleks.

---

### 18.9 Audit as Log String

Bad:

```java
log.info("User approved case");
```

Tidak cukup untuk audit.

Refactor ke structured audit event.

---

### 18.10 Overexposed DTO / Entity Leakage

Bad:

```java
return caseEntity;
```

Dampak:

```text
Sensitive field bocor.
Internal status bocor.
Lazy-loaded relation bocor.
Mass assignment risk untuk input.
Contract coupling ke persistence.
```

---

## 19. Java 8–25 Perspective

### 19.1 Java 8

Relevant features:

```text
Functional interface untuk policy predicate.
Optional untuk context optional secara eksplisit.
Stream untuk policy composition, dengan hati-hati.
```

Contoh predicate policy ringan:

```java
@FunctionalInterface
public interface AccessRule {
    Optional<AccessReason> denyReason(AuthorizationRequest request);
}
```

Rule composition:

```java
public AccessDecision authorize(AuthorizationRequest request) {
    List<AccessReason> denies = rules.stream()
            .map(rule -> rule.denyReason(request))
            .flatMap(Optional::stream)
            .toList();

    if (!denies.isEmpty()) {
        return new AccessDecision.Deny(DenyCode.MISSING_PERMISSION, denies);
    }
    return new AccessDecision.Permit(List.of(new AccessReason("PERMIT", "All rules passed")));
}
```

Catatan: jangan membuat stream chain terlalu clever untuk security-critical logic. Readability lebih penting.

---

### 19.2 Java 14–17 Records

Records cocok untuk immutable security request/result/context.

```java
public record AuthorizationRequest(
        AccessSubject subject,
        Action action,
        ProtectedResource resource,
        AccessContext context
) {}
```

Security object harus immutable sejauh mungkin.

---

### 19.3 Java 17 Sealed Classes

Sealed classes cocok untuk decision result dan operation model.

```java
public sealed interface AccessDecision permits AccessDecision.Permit, AccessDecision.Deny {
    record Permit(List<AccessReason> reasons) implements AccessDecision {}
    record Deny(DenyCode code, List<AccessReason> reasons) implements AccessDecision {}
}
```

Keuntungan:

```text
Caller dipaksa menghadapi permit/deny secara eksplisit.
Pattern matching switch bisa exhaustive.
```

---

### 19.4 Pattern Matching Switch

Pattern matching membuat handling decision lebih jelas.

```java
switch (decision) {
    case AccessDecision.Permit permit -> proceed(permit);
    case AccessDecision.Deny deny -> reject(deny);
}
```

Ini lebih aman daripada boolean `true/false` yang kehilangan reason.

---

### 19.5 Virtual Threads

Virtual threads membuat blocking-per-request menjadi lebih murah, tetapi tidak menghapus kebutuhan security context yang benar.

Risiko:

```text
ThreadLocal assumption lama.
Context leak.
Library yang memakai ThreadLocal untuk security context.
Async boundary yang kehilangan context.
```

Prinsip:

```text
Jangan bergantung pada global mutable context untuk keputusan penting.
Pass AccessContext eksplisit pada boundary penting.
Gunakan scoped context untuk infrastructure convenience, bukan domain truth.
```

---

### 19.6 Scoped Values

Scoped values membantu context propagation yang lexical dan immutable-friendly.

Use case:

```text
correlation id
request metadata
access context
trace context
```

Tetapi tetap hati-hati:

```text
Policy object tetap lebih testable jika context diterima eksplisit.
```

---

### 19.7 Structured Concurrency

Structured concurrency membantu ketika satu request melakukan beberapa subtask yang harus berbagi lifecycle/cancellation.

Security implication:

```text
Subtask harus menerima context yang sama.
Cancellation harus menghentikan semua child tasks.
Audit harus tahu semua downstream call terkait satu request.
```

---

## 20. Step-by-Step Design: Secure Approval Use Case

### Step 1 — Definisikan Action

```java
public enum CaseAction {
    VIEW,
    EDIT,
    APPROVE,
    REJECT,
    ASSIGN,
    DOWNLOAD_DOCUMENT,
    EXPORT
}
```

---

### Step 2 — Definisikan Subject

```java
public record AccessSubject(
        SubjectId id,
        SubjectKind kind,
        Set<Role> roles,
        Set<Permission> permissions,
        Set<AgencyId> agencies
) {}
```

---

### Step 3 — Definisikan Resource View untuk Authorization

Jangan harus pass seluruh entity jika policy hanya butuh subset.

```java
public record CaseResource(
        CaseId caseId,
        AgencyId agencyId,
        SubjectId createdBy,
        CaseState state,
        RiskLevel riskLevel,
        Sensitivity sensitivity
) {
    public static CaseResource from(CaseRecord record) {
        return new CaseResource(
                record.id(),
                record.agencyId(),
                record.createdBy(),
                record.state(),
                record.riskLevel(),
                record.sensitivity()
        );
    }
}
```

---

### Step 4 — Definisikan Context

```java
public record AccessContext(
        TenantId tenantId,
        AccessChannel channel,
        Instant requestTime,
        String correlationId,
        AssuranceLevel assuranceLevel
) {}
```

---

### Step 5 — Buat Policy

```java
public final class CasePolicy {
    public AccessDecision authorize(
            AccessSubject subject,
            CaseAction action,
            CaseResource resource,
            AccessContext context
    ) {
        return switch (action) {
            case VIEW -> authorizeView(subject, resource, context);
            case APPROVE -> authorizeApprove(subject, resource, context);
            case REJECT -> authorizeReject(subject, resource, context);
            case EDIT -> authorizeEdit(subject, resource, context);
            case ASSIGN -> authorizeAssign(subject, resource, context);
            case DOWNLOAD_DOCUMENT -> authorizeDownload(subject, resource, context);
            case EXPORT -> authorizeExport(subject, resource, context);
        };
    }

    private AccessDecision authorizeApprove(
            AccessSubject subject,
            CaseResource resource,
            AccessContext context
    ) {
        List<AccessReason> denies = new ArrayList<>();

        if (!subject.permissions().contains(Permission.CASE_APPROVE)) {
            denies.add(new AccessReason("MISSING_PERMISSION", "Missing case.approve"));
        }
        if (!subject.agencies().contains(resource.agencyId())) {
            denies.add(new AccessReason("DIFFERENT_AGENCY", "Different agency"));
        }
        if (subject.id().equals(resource.createdBy())) {
            denies.add(new AccessReason("CONFLICT_OF_INTEREST", "Creator cannot approve"));
        }
        if (resource.state() != CaseState.SUBMITTED) {
            denies.add(new AccessReason("INVALID_STATE", "Case is not submitted"));
        }
        if (context.channel() != AccessChannel.INTERNAL_PORTAL) {
            denies.add(new AccessReason("UNSUPPORTED_CHANNEL", "Approval requires internal portal"));
        }
        if (resource.riskLevel() == RiskLevel.HIGH
                && !subject.permissions().contains(Permission.CASE_APPROVE_HIGH_RISK)) {
            denies.add(new AccessReason("HIGH_RISK_PERMISSION_REQUIRED", "High risk approval requires stronger permission"));
        }

        if (!denies.isEmpty()) {
            return new AccessDecision.Deny(DenyCode.MISSING_PERMISSION, List.copyOf(denies));
        }

        return new AccessDecision.Permit(List.of(
                new AccessReason("CASE_APPROVE_ALLOWED", "All approval rules passed")
        ));
    }

    // Other methods omitted for brevity in this section.
}
```

---

### Step 6 — Gunakan di Use Case

```java
public void approve(ApproveCaseCommand command, AccessSubject subject, AccessContext context) {
    CaseRecord record = caseRepository.findRequired(command.caseId());
    CaseResource resource = CaseResource.from(record);

    AccessDecision decision = casePolicy.authorize(subject, CaseAction.APPROVE, resource, context);

    switch (decision) {
        case AccessDecision.Permit permit -> {
            record.approve(subject.id(), command.reason(), context.requestTime());
            caseRepository.save(record);
            auditSink.record(AuditEvent.permitted(subject, resource, "case.approve", permit, context));
        }
        case AccessDecision.Deny deny -> {
            auditSink.record(AuditEvent.denied(subject, resource, "case.approve", deny, context));
            throw new ForbiddenException(deny.code());
        }
    }
}
```

---

## 21. Testing Strategy

### 21.1 Policy Unit Test

Policy harus bisa dites tanpa HTTP, DB, Spring, atau container.

```java
class CasePolicyTest {
    private final CasePolicy policy = new CasePolicy();

    @Test
    void supervisorFromSameAgencyCanApproveSubmittedCase() {
        AccessSubject subject = subjectWith(Permission.CASE_APPROVE, AgencyId.of("A1"));
        CaseResource resource = submittedCaseInAgency("A1");
        AccessContext context = internalPortalContext();

        AccessDecision decision = policy.authorize(subject, CaseAction.APPROVE, resource, context);

        assertTrue(decision instanceof AccessDecision.Permit);
    }

    @Test
    void creatorCannotApproveOwnCase() {
        SubjectId creator = SubjectId.of("u1");
        AccessSubject subject = subjectWithId(creator, Permission.CASE_APPROVE, AgencyId.of("A1"));
        CaseResource resource = submittedCaseCreatedBy("A1", creator);
        AccessContext context = internalPortalContext();

        AccessDecision decision = policy.authorize(subject, CaseAction.APPROVE, resource, context);

        assertTrue(decision instanceof AccessDecision.Deny);
        AccessDecision.Deny deny = (AccessDecision.Deny) decision;
        assertTrue(deny.reasons().stream().anyMatch(r -> r.code().equals("CONFLICT_OF_INTEREST")));
    }
}
```

---

### 21.2 Matrix Test

Authorization sangat cocok untuk matrix test.

```text
role | permission | agency match | owner | state | channel | expected
```

Contoh:

```java
@ParameterizedTest
@MethodSource("approvalCases")
void approvalPolicyMatrix(ApprovalPolicyCase tc) {
    AccessDecision decision = policy.authorize(tc.subject(), CaseAction.APPROVE, tc.resource(), tc.context());
    assertEquals(tc.expectedPermit(), decision instanceof AccessDecision.Permit);
}
```

Matrix test membantu mencegah regression policy.

---

### 21.3 Object-Level Authorization Test

Test endpoint harus memastikan user tidak bisa mengganti ID object.

```text
User A can view case A.
User B cannot view case A by changing URL id.
```

---

### 21.4 Field-Level Authorization Test

Test response tidak mengandung field sensitif.

```java
assertThat(json).doesNotContain("internalAssessment");
assertThat(json).doesNotContain("legalOpinion");
```

Lebih baik lagi gunakan JSON path:

```java
assertThat(response.jsonPath().getString("internalAssessment")).isNull();
```

---

### 21.5 Deny-by-Default Test

```java
@Test
void unknownActionIsDenied() {
    AccessDecision decision = authorizationService.authorize(requestWithUnknownAction());
    assertTrue(decision instanceof AccessDecision.Deny);
}
```

---

### 21.6 Audit Test

Pastikan denial dan sensitive action terekam.

```java
@Test
void deniedApprovalIsAudited() {
    assertThrows(ForbiddenException.class, () -> useCase.approve(command, subject, context));

    verify(auditSink).record(argThat(event ->
            event.action().equals("case.approve")
                    && event.outcome().equals("DENIED")
                    && event.correlationId().equals(context.correlationId())
    ));
}
```

---

## 22. Observability and Debugging Angle

Security decision harus observable, tetapi tidak boleh membocorkan data sensitif.

Log yang baik:

```text
authorization_decision outcome=DENIED action=case.approve resourceType=CASE reason=DIFFERENT_AGENCY correlationId=abc tenant=t1
```

Log yang buruk:

```text
User John with email john@example.com failed to approve case because applicant SSN 123-45-6789 belongs to another agency
```

Metrics yang berguna:

```text
authorization_decisions_total{action,outcome,reason}
access_denied_total{resource_type,reason}
sensitive_export_total{actor_type,resource_type}
break_glass_access_total{reason}
```

Tracing:

```text
Span: authorize case.approve
Attributes:
  auth.action=case.approve
  auth.resource_type=CASE
  auth.outcome=DENIED
  auth.reason=DIFFERENT_AGENCY
```

Jangan taruh resource ID sensitif sembarangan di high-cardinality metrics.

---

## 23. Security Review Checklist

Gunakan checklist ini saat review use case Java.

### Identity and Context

```text
[ ] Apakah authenticated identity sudah divalidasi oleh trusted infrastructure?
[ ] Apakah raw token/claim diterjemahkan ke application subject?
[ ] Apakah subject membedakan human, service, batch, integration?
[ ] Apakah tenant/agency/channel/request time tersedia di AccessContext?
[ ] Apakah delegation/impersonation dimodelkan eksplisit?
```

### Authorization

```text
[ ] Apakah authorization memakai subject + action + resource + context?
[ ] Apakah object-level authorization dilakukan setelah resource minimum diload?
[ ] Apakah list/query endpoint punya visibility scope?
[ ] Apakah field-level authorization/masking diperlukan?
[ ] Apakah unknown action/policy default deny?
[ ] Apakah policy object bisa dites tanpa framework?
```

### Mutation and Transaction

```text
[ ] Apakah authorization terjadi sebelum mutation?
[ ] Apakah JPA managed entity tidak dimutasi sebelum check?
[ ] Apakah external call tidak dilakukan sebelum security/domain validation yang diperlukan?
[ ] Apakah command idempotency dipertimbangkan untuk operasi sensitif?
```

### Audit

```text
[ ] Apakah sensitive success diaudit?
[ ] Apakah denied sensitive attempt diaudit?
[ ] Apakah audit event structured?
[ ] Apakah audit menyimpan actor, action, resource, outcome, reason, correlation id?
[ ] Apakah audit tidak menyimpan PII berlebihan?
```

### Anti-Pattern Detection

```text
[ ] Ada scattered role check?
[ ] Ada UI-only authorization?
[ ] Ada trust terhadap userId/role dari request body?
[ ] Ada entity exposure sebagai response?
[ ] Ada repository direct access dari controller?
[ ] Ada service account yang melakukan action atas nama user tanpa original actor context?
[ ] Ada admin role terlalu luas tanpa break-glass control?
```

---

## 24. Common Staff-Level Discussion

### 24.1 “Kenapa tidak cukup pakai annotation seperti `@PreAuthorize`?”

Annotation berguna untuk coarse-grained gate. Tetapi untuk complex object-level authorization, annotation sering kurang karena resource belum diload, policy butuh context, reason perlu diaudit, dan logic menjadi string expression yang sulit direfactor.

Approach matang:

```text
Annotation untuk coarse gate.
Policy object untuk authoritative business/security decision.
Visibility scope untuk list query.
Presenter/view model untuk field-level security.
Audit event untuk evidence.
```

---

### 24.2 “Apakah role masih dibutuhkan?”

Ya. Role berguna untuk organisasi dan assignment. Tetapi role bukan policy lengkap.

```text
Role -> grouping responsibility.
Permission -> capability granular.
Policy -> decision rule berdasarkan subject/action/resource/context.
```

---

### 24.3 “Apakah policy harus di domain layer?”

Tergantung.

Security policy yang bergantung pada actor, channel, permission, tenant biasanya application/security layer.

Domain invariant yang berlaku untuk semua actor harus di domain.

Contoh:

```text
Only supervisor can approve case -> authorization policy.
Case can only be approved from SUBMITTED state -> domain invariant.
Creator cannot approve own case -> bisa authorization policy karena actor-dependent.
Approval requires completed review checklist -> domain/application invariant tergantung model.
```

---

### 24.4 “Bagaimana menghindari policy menjadi terlalu besar?”

Pecah berdasarkan resource/action family.

```text
CaseViewPolicy
CaseApprovalPolicy
CaseAssignmentPolicy
DocumentDownloadPolicy
ExportPolicy
```

Atau gunakan rule object untuk sub-rule yang reusable.

```java
public interface AuthorizationRule {
    Optional<AccessReason> denyReason(AuthorizationRequest request);
}
```

Namun jangan membuat rule engine generik terlalu cepat. Banyak sistem cukup dengan policy class eksplisit.

---

### 24.5 “Bagaimana cara audit tanpa membocorkan data?”

Gunakan reason code, resource type, resource id yang sesuai policy, dan metadata minimum.

Hindari menyimpan:

```text
full token
password/secret
raw request body
PII berlebihan
sensitive document content
```

Audit harus cukup untuk accountability, bukan menjadi data breach vector.

---

## 25. Case Study: Secure Document Download

### 25.1 Problem

Endpoint:

```text
GET /cases/{caseId}/documents/{documentId}/download
```

Naive implementation:

```java
public FileContent download(String caseId, String documentId, User user) {
    if (!user.hasRole("OFFICER")) {
        throw new ForbiddenException();
    }
    return documentRepository.loadContent(documentId);
}
```

Bug:

```text
User bisa mengganti documentId dari case lain.
Tidak cek document belongs to caseId.
Tidak cek agency.
Tidak cek sensitivity.
Tidak audit download.
Tidak cek external/internal channel.
```

---

### 25.2 Better Model

Resource:

```java
public record DocumentResource(
        DocumentId documentId,
        CaseId caseId,
        AgencyId agencyId,
        DocumentType documentType,
        Sensitivity sensitivity,
        boolean sealed
) {}
```

Policy:

```java
public final class DocumentDownloadPolicy {
    public AccessDecision authorize(
            AccessSubject subject,
            DocumentResource document,
            AccessContext context
    ) {
        List<AccessReason> denies = new ArrayList<>();

        if (!subject.permissions().contains(Permission.DOCUMENT_DOWNLOAD)) {
            denies.add(new AccessReason("MISSING_PERMISSION", "Missing document.download"));
        }
        if (!subject.agencies().contains(document.agencyId())) {
            denies.add(new AccessReason("DIFFERENT_AGENCY", "Different agency"));
        }
        if (document.sensitivity() == Sensitivity.HIGH
                && !subject.permissions().contains(Permission.DOCUMENT_DOWNLOAD_SENSITIVE)) {
            denies.add(new AccessReason("SENSITIVE_DOCUMENT", "Sensitive document permission required"));
        }
        if (document.sealed() && !subject.permissions().contains(Permission.DOCUMENT_DOWNLOAD_SEALED)) {
            denies.add(new AccessReason("SEALED_DOCUMENT", "Sealed document permission required"));
        }
        if (context.channel() == AccessChannel.EXTERNAL_PORTAL
                && document.documentType().internalOnly()) {
            denies.add(new AccessReason("INTERNAL_ONLY", "Internal document cannot be downloaded externally"));
        }

        if (!denies.isEmpty()) {
            return new AccessDecision.Deny(DenyCode.MISSING_PERMISSION, List.copyOf(denies));
        }

        return new AccessDecision.Permit(List.of(
                new AccessReason("DOCUMENT_DOWNLOAD_ALLOWED", "Download permitted")
        ));
    }
}
```

Use case:

```java
public FileContent download(
        DownloadDocumentCommand command,
        AccessSubject subject,
        AccessContext context
) {
    DocumentMetadata metadata = documentRepository.findMetadataRequired(command.documentId());

    if (!metadata.caseId().equals(command.caseId())) {
        // Avoid revealing whether document exists elsewhere.
        throw new NotFoundException();
    }

    DocumentResource resource = DocumentResource.from(metadata);
    AccessDecision decision = policy.authorize(subject, resource, context);

    if (decision instanceof AccessDecision.Deny deny) {
        auditSink.record(AuditEvent.denied(subject, resource, "document.download", deny, context));
        throw new ForbiddenException(deny.code());
    }

    FileContent content = documentRepository.loadContent(command.documentId());
    auditSink.record(AuditEvent.permitted(subject, resource, "document.download", (AccessDecision.Permit) decision, context));
    return content;
}
```

Security improvements:

```text
Object-level authorization.
Case-document relationship validation.
Sensitivity check.
Channel check.
Audit on success and denial.
No raw entity exposure.
No client-provided authority trusted.
```

---

## 26. Pattern Decision Record Template

Gunakan template ini untuk security pattern decision.

```md
# Security Pattern Decision: <Title>

## Context
What resource/action is being protected?
Who are the subjects?
What entry points exist?
What regulatory/audit constraints exist?

## Decision
We will use <Policy Object / Secure Facade / Visibility Scope / Capability / etc.>.

## Authorization Formula
subject + action + resource + context -> decision

## Enforcement Point
Where is the decision enforced?
Controller? Application service? Gateway? Repository query? Presenter?

## Default Behavior
What happens for unknown action/resource/context?

## Audit Behavior
What success/denial events are recorded?

## Failure Behavior
What is returned to caller?
What is logged?
What is not exposed?

## Alternatives Considered
Annotation-only
Role-only
Repository filter
External policy engine

## Consequences
Benefits
Costs
Testing requirements
Operational impact

## Review Checklist
Object-level auth
Field-level auth
Deny by default
No trust client input
Audit coverage
```

---

## 27. Summary

Security pattern yang matang di Java enterprise bukan hanya `@PreAuthorize`, JWT, atau role check.

Mental model utama:

```text
Authorization = subject + action + resource + context + policy
```

Pattern penting:

```text
Authorization Policy Object
Access Context Object
Authorization Service
Capability Object
Secure Facade
Resource Visibility Filter
Field-Level Authorization / Presenter
Audit Event Pattern
Deny by Default
Authorization Before Mutation
```

Anti-pattern utama:

```text
Scattered role check
Trust client input
UI-only authorization
Authorization after mutation
Repository as security bypass
God admin
Permission explosion
Annotation magic authorization
Audit as log string
Entity leakage
Confused deputy
```

Top engineer melihat security sebagai desain boundary dan evidence system:

```text
Bukan hanya apakah user boleh.
Tapi kenapa boleh, berdasarkan policy apa, terhadap object apa,
dalam context apa, dengan audit evidence apa, dan apa yang terjadi saat gagal.
```

---

## 28. Referensi Lanjut

1. OWASP Authorization Cheat Sheet — deny by default, least privilege, authorization testing.
2. OWASP API Security Top 10 2023 — Broken Object Level Authorization dan Broken Object Property Level Authorization.
3. OWASP Top 10 2021 A01 — Broken Access Control.
4. NIST SP 800-162 — Attribute Based Access Control.
5. RFC 8725 — JSON Web Token Best Current Practices.
6. Java SE 25 API documentation — records, sealed classes, pattern matching, `ScopedValue`, `Thread`, concurrency APIs.
7. Martin Fowler — patterns and enterprise application architecture concepts related to boundary, gateway, and policy-like separation.

---

## 29. Status Seri

```text
Part 26 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
27-observability-diagnostics-patterns-correlation-audit-telemetry.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./25-integration-gateway-adapter-outbox-inbox-saga-idempotency.md">⬅️ Part 25 — Integration Pattern: Gateway, Adapter, Outbox, Inbox, Saga, Idempotency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./27-observability-diagnostics-patterns-correlation-audit-telemetry.md">Part 27 — Observability and Diagnostics Patterns: Correlation, Audit, Telemetry, and Debuggability ➡️</a>
</div>

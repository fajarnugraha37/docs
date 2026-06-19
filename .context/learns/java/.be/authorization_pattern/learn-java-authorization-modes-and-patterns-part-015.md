# learn-java-authorization-modes-and-patterns-part-015

# Part 15 — Spring Domain Authorization Patterns

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: membangun authorization yang sadar domain, maintainable, testable, auditable, dan tidak berhenti di annotation seperti `@PreAuthorize("hasRole('ADMIN')")`.

---

## 0. Posisi Part Ini Dalam Seri

Sampai titik ini kita sudah membahas:

1. authorization sebagai decision system;
2. vocabulary dan invariant;
3. primitive authorization di Java platform;
4. PEP/PDP/PAP/PIP;
5. RBAC;
6. permission/capability modeling;
7. ABAC;
8. PBAC/policy-as-code;
9. ReBAC;
10. ACL;
11. ownership, tenancy, dan data boundary;
12. IDOR/BOLA/object-level authorization;
13. layered authorization;
14. Spring request authorization;
15. Spring method security.

Part ini masuk ke lapisan yang lebih penting untuk aplikasi enterprise nyata:

> **Bagaimana membuat authorization yang mengikuti bahasa domain, bukan mengikuti bentuk framework.**

Spring Security memberi primitive kuat seperti `AuthorizationManager`, `@PreAuthorize`, `PermissionEvaluator`, `GrantedAuthority`, filter chain, dan method interceptor. Tetapi authorization yang matang tidak boleh berhenti di primitive tersebut. Primitive framework harus menjadi adapter terhadap model domain authorization yang lebih eksplisit.

Dalam sistem kompleks seperti case management, enforcement lifecycle, regulatory platform, approval workflow, multi-tenant agency system, dispute/appeal handling, atau enterprise back office, pertanyaan authorization jarang sesederhana:

```java
hasRole("ADMIN")
```

Pertanyaan yang benar sering berbentuk:

```text
Can this officer return this case to the assigned investigator,
while the case is in PENDING_REVIEW,
if the officer belongs to the same agency,
is not the original submitter,
has active reviewer assignment,
and the case is not locked by escalation?
```

Itu bukan sekadar masalah Spring annotation. Itu adalah masalah domain policy.

---

## 1. Core Mental Model

### 1.1 Request Authorization vs Domain Authorization

Request authorization menjawab:

```text
Apakah caller boleh mengakses endpoint ini?
```

Contoh:

```http
POST /api/cases/123/approve
```

Dengan rule:

```java
.requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
.hasAuthority("case.approve")
```

Ini berguna, tetapi belum cukup. Rule tersebut hanya tahu:

1. path;
2. method;
3. authentication;
4. authority umum.

Rule tersebut belum tentu tahu:

1. apakah case `123` milik agency user;
2. apakah user assigned sebagai reviewer;
3. apakah case sedang dalam state yang bisa di-approve;
4. apakah user adalah submitter sendiri;
5. apakah approval membutuhkan dual control;
6. apakah case sedang locked;
7. apakah user sedang acting/delegated;
8. apakah policy berubah untuk case berisiko tinggi;
9. apakah approval harus disertai obligation tertentu.

Domain authorization menjawab:

```text
Apakah subjek boleh melakukan business action terhadap domain resource tertentu dalam state dan context tertentu?
```

Jadi request authorization adalah guard kasar di pintu depan. Domain authorization adalah guard semantik di business operation.

---

### 1.2 Domain Authorization Harus Berbicara Dalam Bahasa Bisnis

Authorization yang buruk:

```java
if (user.hasRole("ROLE_L3") || user.hasRole("ROLE_SUPER")) {
    approve(caseId);
}
```

Masalah:

1. `ROLE_L3` tidak menjelaskan aksi bisnis.
2. `ROLE_SUPER` terlalu luas.
3. Tidak ada resource-specific check.
4. Tidak ada state check.
5. Tidak ada separation of duty.
6. Tidak ada reason code.
7. Sulit diaudit.
8. Sulit dites sebagai policy.

Authorization yang lebih baik:

```java
PolicyDecision decision = caseAuthorization.canApprove(actor, caseAggregate, context);

if (decision.denied()) {
    throw new AccessDeniedException(decision.safeMessage());
}

caseWorkflow.approve(caseAggregate, command);
```

Lebih baik lagi bila command handler mengekspresikan invariant:

```java
caseCommandAuthorizer.authorizeApprove(actor, command, caseAggregate, context);
caseAggregate.approve(command, actor);
```

Di sini policy berbicara dalam bahasa domain:

```text
canApprove
canReturn
canAssign
canReopen
canEscalate
canWithdraw
canViewEvidence
canExportCaseBundle
```

Bukan sekadar:

```text
hasRole
hasAuthority
hasPermission
```

---

### 1.3 Authorization Bukan Hanya Boolean

Banyak sistem authorization gagal karena semua keputusan diringkas menjadi boolean:

```java
boolean allowed = canApprove(user, caseId);
```

Boolean ini kehilangan informasi penting:

1. mengapa ditolak;
2. rule apa yang menolak;
3. policy version apa yang dipakai;
4. attribute apa yang dipakai;
5. apakah ada obligation;
6. apakah ada masking;
7. apakah result boleh di-cache;
8. apakah denial boleh ditampilkan ke user;
9. apakah denial harus diaudit;
10. apakah decision partial untuk bulk operation.

Untuk sistem enterprise, authorization decision harus menjadi object.

Contoh:

```java
public final class AuthorizationDecisionResult {
    private final boolean allowed;
    private final DecisionCode code;
    private final String safeMessage;
    private final List<DecisionReason> reasons;
    private final List<AuthorizationObligation> obligations;
    private final DecisionEvidence evidence;
    private final boolean cacheable;

    private AuthorizationDecisionResult(
            boolean allowed,
            DecisionCode code,
            String safeMessage,
            List<DecisionReason> reasons,
            List<AuthorizationObligation> obligations,
            DecisionEvidence evidence,
            boolean cacheable
    ) {
        this.allowed = allowed;
        this.code = code;
        this.safeMessage = safeMessage;
        this.reasons = Collections.unmodifiableList(new ArrayList<>(reasons));
        this.obligations = Collections.unmodifiableList(new ArrayList<>(obligations));
        this.evidence = evidence;
        this.cacheable = cacheable;
    }

    public static AuthorizationDecisionResult allow(
            DecisionCode code,
            List<DecisionReason> reasons,
            List<AuthorizationObligation> obligations,
            DecisionEvidence evidence,
            boolean cacheable
    ) {
        return new AuthorizationDecisionResult(
                true,
                code,
                "Allowed",
                reasons,
                obligations,
                evidence,
                cacheable
        );
    }

    public static AuthorizationDecisionResult deny(
            DecisionCode code,
            String safeMessage,
            List<DecisionReason> reasons,
            DecisionEvidence evidence
    ) {
        return new AuthorizationDecisionResult(
                false,
                code,
                safeMessage,
                reasons,
                Collections.emptyList(),
                evidence,
                false
        );
    }

    public boolean allowed() {
        return allowed;
    }

    public boolean denied() {
        return !allowed;
    }

    public DecisionCode code() {
        return code;
    }

    public String safeMessage() {
        return safeMessage;
    }

    public List<DecisionReason> reasons() {
        return reasons;
    }

    public List<AuthorizationObligation> obligations() {
        return obligations;
    }

    public DecisionEvidence evidence() {
        return evidence;
    }

    public boolean cacheable() {
        return cacheable;
    }
}
```

Untuk Java 17+, versi `record` bisa dibuat lebih ringkas, tetapi jika target mencakup Java 8, bentuk class biasa seperti di atas lebih portable.

---

## 2. Kenapa Domain Authorization Diperlukan

### 2.1 Annotation Tidak Cukup Untuk Domain Kompleks

Annotation seperti ini berguna:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(Long caseId) {
    // ...
}
```

Tetapi ia hanya memvalidasi authority umum. Jika `case.approve` diberikan kepada semua reviewer, semua reviewer bisa mencoba approve semua case kecuali ada guard lain.

Versi yang lebih domain-aware:

```java
@PreAuthorize("@casePolicy.canApprove(authentication, #caseId)")
public void approveCase(Long caseId) {
    // ...
}
```

Ini lebih baik, tetapi tetap ada risiko:

1. SpEL menjadi bahasa policy tersembunyi.
2. Testing policy bisa tersebar.
3. Parameter binding bisa rapuh.
4. Policy cenderung bercampur dengan method signature.
5. Complex reason/evidence sulit dikembalikan.
6. Bulk decision sulit.
7. Reuse di non-Spring context sulit.

Untuk rule sederhana, annotation cukup. Untuk rule domain kompleks, annotation sebaiknya hanya memanggil policy service, bukan menjadi tempat logic utama.

---

### 2.2 Domain Authorization Mengurangi Semantic Drift

Semantic drift terjadi ketika arti permission berubah diam-diam.

Awalnya:

```text
case.approve = boleh approve case sederhana
```

Setelah beberapa CR:

```text
case.approve = boleh approve case sederhana,
tapi tidak untuk case high-risk,
kecuali user senior reviewer,
tapi tidak kalau user submitter,
kecuali emergency override,
tapi harus ada reason,
dan harus masuk audit khusus.
```

Jika logic ini tersebar di controller, service, repository, frontend, scheduled job, dan report module, sistem akan tidak konsisten.

Domain authorization mengumpulkan semantic rule di satu konsep:

```java
caseAuthorization.canApprove(actor, caseAggregate, context)
```

Dengan begitu perubahan policy punya satu titik desain utama.

---

### 2.3 Domain Authorization Memperjelas Review Arsitektur

Security review terhadap ini sulit:

```java
@PreAuthorize("hasAnyRole('L2','L3','ADMIN') and #dto.status != 'CLOSED'")
```

Security review terhadap ini lebih jelas:

```java
caseApprovalPolicy.evaluate(actor, caseAggregate, command, context)
```

Karena reviewer bisa menanyakan:

1. apa invariant approval;
2. apa input decision;
3. apa source of truth untuk actor assignment;
4. bagaimana deny reason dimodelkan;
5. bagaimana audit direkam;
6. bagaimana bulk operation dicegah dari partial bypass;
7. bagaimana policy dites.

---

## 3. Pola Utama Spring Domain Authorization

Ada beberapa pola yang umum dipakai. Tidak semua cocok untuk semua sistem.

---

## 4. Pattern 1 — Explicit Policy Service

### 4.1 Definisi

Policy service adalah service khusus yang mengevaluasi authorization untuk domain tertentu.

Contoh:

```java
public interface CaseAuthorizationPolicy {
    AuthorizationDecisionResult canView(
            Actor actor,
            CaseAggregate caseAggregate,
            AuthorizationContext context
    );

    AuthorizationDecisionResult canApprove(
            Actor actor,
            CaseAggregate caseAggregate,
            ApprovalCommand command,
            AuthorizationContext context
    );

    AuthorizationDecisionResult canAssign(
            Actor actor,
            CaseAggregate caseAggregate,
            AssignOfficerCommand command,
            AuthorizationContext context
    );

    AuthorizationDecisionResult canExportBundle(
            Actor actor,
            CaseAggregate caseAggregate,
            ExportBundleCommand command,
            AuthorizationContext context
    );
}
```

### 4.2 Kenapa Bagus

Policy service bagus karena:

1. logic authorization eksplisit;
2. mudah dites tanpa web layer;
3. bisa dipakai oleh REST, batch, message consumer, GraphQL, gRPC;
4. decision bisa kaya, bukan boolean;
5. bisa diaudit;
6. bisa diinstrumentasi;
7. bisa di-cache secara terkontrol;
8. tidak bergantung penuh pada SpEL;
9. mudah dimigrasikan ke external PDP nanti.

### 4.3 Contoh Implementasi Java 8-Compatible

```java
@Service
public class DefaultCaseAuthorizationPolicy implements CaseAuthorizationPolicy {

    private final PermissionResolver permissionResolver;
    private final AssignmentResolver assignmentResolver;
    private final OrganizationBoundaryService organizationBoundaryService;
    private final SeparationOfDutyService separationOfDutyService;

    public DefaultCaseAuthorizationPolicy(
            PermissionResolver permissionResolver,
            AssignmentResolver assignmentResolver,
            OrganizationBoundaryService organizationBoundaryService,
            SeparationOfDutyService separationOfDutyService
    ) {
        this.permissionResolver = permissionResolver;
        this.assignmentResolver = assignmentResolver;
        this.organizationBoundaryService = organizationBoundaryService;
        this.separationOfDutyService = separationOfDutyService;
    }

    @Override
    public AuthorizationDecisionResult canApprove(
            Actor actor,
            CaseAggregate caseAggregate,
            ApprovalCommand command,
            AuthorizationContext context
    ) {
        DecisionEvidence.Builder evidence = DecisionEvidence.builder()
                .subject(actor.id())
                .resource("case", caseAggregate.id())
                .action("case.approve")
                .context(context.requestId());

        if (!actor.active()) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.SUBJECT_INACTIVE,
                    "You are not allowed to approve this case.",
                    DecisionReason.single("Actor is inactive"),
                    evidence.put("actor.active", false).build()
            );
        }

        if (!permissionResolver.hasPermission(actor, "case.approve")) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.MISSING_PERMISSION,
                    "You are not allowed to approve this case.",
                    DecisionReason.single("Missing permission: case.approve"),
                    evidence.put("permission", "case.approve").build()
            );
        }

        if (!organizationBoundaryService.sameAgency(actor, caseAggregate)) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.CROSS_AGENCY_DENIED,
                    "The case is not accessible.",
                    DecisionReason.single("Actor and case belong to different agency boundary"),
                    evidence.put("actor.agency", actor.agencyId())
                            .put("case.agency", caseAggregate.agencyId())
                            .build()
            );
        }

        if (!assignmentResolver.isReviewer(actor, caseAggregate)) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.NOT_ASSIGNED_REVIEWER,
                    "You are not assigned to approve this case.",
                    DecisionReason.single("Actor is not assigned reviewer for this case"),
                    evidence.build()
            );
        }

        if (!caseAggregate.status().canBeApproved()) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.INVALID_CASE_STATE,
                    "This case cannot be approved in its current state.",
                    DecisionReason.single("Case state does not allow approval"),
                    evidence.put("case.status", caseAggregate.status().name()).build()
            );
        }

        if (separationOfDutyService.isOriginalSubmitter(actor, caseAggregate)) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.SEPARATION_OF_DUTY_VIOLATION,
                    "You cannot approve your own submission.",
                    DecisionReason.single("Actor is original submitter"),
                    evidence.put("submitter", caseAggregate.submittedBy()).build()
            );
        }

        List<AuthorizationObligation> obligations = new ArrayList<>();

        if (caseAggregate.highRisk()) {
            obligations.add(AuthorizationObligation.requireAuditReason("HIGH_RISK_APPROVAL"));
        }

        return AuthorizationDecisionResult.allow(
                DecisionCode.ALLOWED,
                DecisionReason.single("All approval rules passed"),
                obligations,
                evidence.put("highRisk", caseAggregate.highRisk()).build(),
                false
        );
    }

    @Override
    public AuthorizationDecisionResult canView(
            Actor actor,
            CaseAggregate caseAggregate,
            AuthorizationContext context
    ) {
        // Similar pattern.
        throw new UnsupportedOperationException("Example omitted");
    }

    @Override
    public AuthorizationDecisionResult canAssign(
            Actor actor,
            CaseAggregate caseAggregate,
            AssignOfficerCommand command,
            AuthorizationContext context
    ) {
        // Similar pattern.
        throw new UnsupportedOperationException("Example omitted");
    }

    @Override
    public AuthorizationDecisionResult canExportBundle(
            Actor actor,
            CaseAggregate caseAggregate,
            ExportBundleCommand command,
            AuthorizationContext context
    ) {
        // Similar pattern.
        throw new UnsupportedOperationException("Example omitted");
    }
}
```

### 4.4 Cara Menggunakan Di Application Service

```java
@Service
public class CaseApprovalService {

    private final CaseRepository caseRepository;
    private final ActorResolver actorResolver;
    private final AuthorizationContextResolver contextResolver;
    private final CaseAuthorizationPolicy caseAuthorizationPolicy;
    private final AuthorizationAuditPublisher auditPublisher;

    public CaseApprovalService(
            CaseRepository caseRepository,
            ActorResolver actorResolver,
            AuthorizationContextResolver contextResolver,
            CaseAuthorizationPolicy caseAuthorizationPolicy,
            AuthorizationAuditPublisher auditPublisher
    ) {
        this.caseRepository = caseRepository;
        this.actorResolver = actorResolver;
        this.contextResolver = contextResolver;
        this.caseAuthorizationPolicy = caseAuthorizationPolicy;
        this.auditPublisher = auditPublisher;
    }

    @Transactional
    public void approve(ApprovalCommand command) {
        Actor actor = actorResolver.currentActor();
        AuthorizationContext context = contextResolver.currentContext();

        CaseAggregate caseAggregate = caseRepository.findById(command.caseId())
                .orElseThrow(CaseNotFoundException::new);

        AuthorizationDecisionResult decision = caseAuthorizationPolicy.canApprove(
                actor,
                caseAggregate,
                command,
                context
        );

        auditPublisher.publish(decision);

        if (decision.denied()) {
            throw new AccessDeniedException(decision.safeMessage());
        }

        validateObligations(command, decision.obligations());

        caseAggregate.approve(actor.id(), command.reason());
        caseRepository.save(caseAggregate);
    }

    private void validateObligations(
            ApprovalCommand command,
            List<AuthorizationObligation> obligations
    ) {
        for (AuthorizationObligation obligation : obligations) {
            if (obligation.type() == AuthorizationObligationType.REQUIRE_AUDIT_REASON
                    && command.reason().trim().isEmpty()) {
                throw new IllegalArgumentException("Approval reason is required.");
            }
        }
    }
}
```

Important distinction:

```text
Authorization answers: boleh atau tidak?
Validation answers: command valid atau tidak?
State machine answers: transition legal atau tidak?
```

Namun untuk domain kompleks, ketiganya sering saling berdekatan. Jangan dicampur secara sembrono.

---

## 5. Pattern 2 — Domain-Specific Authorizer

### 5.1 Definisi

Authorizer adalah service yang tidak hanya return decision, tetapi juga melakukan enforcement.

```java
public interface CaseCommandAuthorizer {
    void authorizeApprove(Actor actor, CaseAggregate caseAggregate, ApprovalCommand command);
    void authorizeAssign(Actor actor, CaseAggregate caseAggregate, AssignOfficerCommand command);
    void authorizeReopen(Actor actor, CaseAggregate caseAggregate, ReopenCommand command);
}
```

Implementasi:

```java
@Service
public class DefaultCaseCommandAuthorizer implements CaseCommandAuthorizer {

    private final CaseAuthorizationPolicy policy;
    private final AuthorizationContextResolver contextResolver;
    private final AuthorizationAuditPublisher auditPublisher;

    public DefaultCaseCommandAuthorizer(
            CaseAuthorizationPolicy policy,
            AuthorizationContextResolver contextResolver,
            AuthorizationAuditPublisher auditPublisher
    ) {
        this.policy = policy;
        this.contextResolver = contextResolver;
        this.auditPublisher = auditPublisher;
    }

    @Override
    public void authorizeApprove(
            Actor actor,
            CaseAggregate caseAggregate,
            ApprovalCommand command
    ) {
        AuthorizationDecisionResult decision = policy.canApprove(
                actor,
                caseAggregate,
                command,
                contextResolver.currentContext()
        );

        auditPublisher.publish(decision);

        if (decision.denied()) {
            throw new AccessDeniedException(decision.safeMessage());
        }
    }

    @Override
    public void authorizeAssign(
            Actor actor,
            CaseAggregate caseAggregate,
            AssignOfficerCommand command
    ) {
        throw new UnsupportedOperationException("Example omitted");
    }

    @Override
    public void authorizeReopen(
            Actor actor,
            CaseAggregate caseAggregate,
            ReopenCommand command
    ) {
        throw new UnsupportedOperationException("Example omitted");
    }
}
```

### 5.2 Kapan Authorizer Cocok

Cocok jika:

1. caller tidak perlu inspect decision;
2. denied selalu exception;
3. audit harus otomatis;
4. service layer ingin sederhana;
5. command flow konsisten.

Kurang cocok jika:

1. UI perlu menampilkan disabled action dengan reason;
2. bulk decision diperlukan;
3. decision perlu dikirim ke client;
4. policy simulation diperlukan;
5. partial allow/deny diperlukan.

### 5.3 Top 1% Insight

Pisahkan dua API:

```java
policy.canApprove(...)      // decision/query API
authorizer.authorizeApprove(...) // enforcement API
```

Jangan hanya punya `void authorize()` karena nanti UI, report, audit simulation, bulk operation, dan explainability akan kesulitan.

---

## 6. Pattern 3 — Decision Object

### 6.1 Kenapa Decision Object Penting

Authorization decision di sistem matang harus bisa menjawab:

```text
allowed?
why?
based on what?
which policy version?
which subject/resource/action/context?
what obligation?
can cache?
should audit?
```

Minimal decision object:

```java
public final class PolicyDecision {
    private final Decision decision;
    private final DecisionCode code;
    private final String message;

    public enum Decision {
        ALLOW,
        DENY,
        NOT_APPLICABLE,
        INDETERMINATE
    }

    public PolicyDecision(Decision decision, DecisionCode code, String message) {
        this.decision = decision;
        this.code = code;
        this.message = message;
    }

    public boolean allowed() {
        return decision == Decision.ALLOW;
    }

    public boolean denied() {
        return decision == Decision.DENY || decision == Decision.INDETERMINATE;
    }
}
```

Lebih lengkap:

```java
public final class RichPolicyDecision {
    private final Decision decision;
    private final DecisionCode code;
    private final String safeUserMessage;
    private final String internalDiagnosticMessage;
    private final List<DecisionReason> reasons;
    private final List<AuthorizationObligation> obligations;
    private final DecisionEvidence evidence;
    private final String policyVersion;
    private final Instant decidedAt;
    private final boolean cacheable;
    private final Duration suggestedTtl;

    // Constructor/getters omitted.
}
```

### 6.2 Decision Enum Semantics

Gunakan lebih dari boolean:

```text
ALLOW          = policy explicitly allows
DENY           = policy explicitly denies
NOT_APPLICABLE = this policy does not apply to this request
INDETERMINATE  = policy cannot decide because required input/system unavailable
```

Combiner kemudian menentukan hasil akhir.

Contoh deny-overrides:

```java
public final class DenyOverridesCombiner {

    public PolicyDecision combine(List<PolicyDecision> decisions) {
        boolean hasAllow = false;
        boolean hasIndeterminate = false;

        for (PolicyDecision decision : decisions) {
            if (decision.decision() == PolicyDecision.Decision.DENY) {
                return decision;
            }
            if (decision.decision() == PolicyDecision.Decision.ALLOW) {
                hasAllow = true;
            }
            if (decision.decision() == PolicyDecision.Decision.INDETERMINATE) {
                hasIndeterminate = true;
            }
        }

        if (hasIndeterminate) {
            return PolicyDecision.indeterminate(DecisionCode.DECISION_INPUT_UNAVAILABLE);
        }

        if (hasAllow) {
            return PolicyDecision.allow(DecisionCode.ALLOWED);
        }

        return PolicyDecision.deny(DecisionCode.NO_APPLICABLE_POLICY);
    }
}
```

### 6.3 Kenapa `INDETERMINATE` Tidak Boleh Disamakan Dengan `ALLOW`

Jika assignment service down, organization service timeout, atau policy data corrupt, sistem tidak tahu apakah allow atau deny.

Dalam operasi sensitif, `INDETERMINATE` harus diperlakukan sebagai deny untuk enforcement.

```java
if (!decision.allowed()) {
    throw new AccessDeniedException(decision.safeUserMessage());
}
```

Jangan:

```java
if (decision.decision() != DENY) {
    proceed(); // dangerous: NOT_APPLICABLE/INDETERMINATE become allow
}
```

---

## 7. Pattern 4 — Domain Permission Evaluator Adapter

Spring Security punya `PermissionEvaluator` untuk expression-based access control dan juga ACL integration. Namun `PermissionEvaluator` sebaiknya tidak menjadi tempat semua domain logic. Ia lebih baik menjadi adapter.

### 7.1 Interface Spring

Secara konsep, `PermissionEvaluator` menjawab:

```text
hasPermission(authentication, targetDomainObject, permission)
hasPermission(authentication, targetId, targetType, permission)
```

### 7.2 Adapter ke Domain Policy

```java
@Component
public class DomainPermissionEvaluator implements PermissionEvaluator {

    private final ActorResolver actorResolver;
    private final CaseRepository caseRepository;
    private final CaseAuthorizationPolicy caseAuthorizationPolicy;
    private final AuthorizationContextResolver contextResolver;

    public DomainPermissionEvaluator(
            ActorResolver actorResolver,
            CaseRepository caseRepository,
            CaseAuthorizationPolicy caseAuthorizationPolicy,
            AuthorizationContextResolver contextResolver
    ) {
        this.actorResolver = actorResolver;
        this.caseRepository = caseRepository;
        this.caseAuthorizationPolicy = caseAuthorizationPolicy;
        this.contextResolver = contextResolver;
    }

    @Override
    public boolean hasPermission(
            Authentication authentication,
            Object targetDomainObject,
            Object permission
    ) {
        Actor actor = actorResolver.from(authentication);
        AuthorizationContext context = contextResolver.currentContext();
        String requestedPermission = String.valueOf(permission);

        if (targetDomainObject instanceof CaseAggregate) {
            CaseAggregate caseAggregate = (CaseAggregate) targetDomainObject;
            return evaluateCase(actor, caseAggregate, requestedPermission, context).allowed();
        }

        return false;
    }

    @Override
    public boolean hasPermission(
            Authentication authentication,
            Serializable targetId,
            String targetType,
            Object permission
    ) {
        Actor actor = actorResolver.from(authentication);
        AuthorizationContext context = contextResolver.currentContext();
        String requestedPermission = String.valueOf(permission);

        if ("Case".equals(targetType)) {
            CaseAggregate caseAggregate = caseRepository.findById(String.valueOf(targetId))
                    .orElse(null);

            if (caseAggregate == null) {
                return false;
            }

            return evaluateCase(actor, caseAggregate, requestedPermission, context).allowed();
        }

        return false;
    }

    private AuthorizationDecisionResult evaluateCase(
            Actor actor,
            CaseAggregate caseAggregate,
            String permission,
            AuthorizationContext context
    ) {
        if ("view".equals(permission) || "case.view".equals(permission)) {
            return caseAuthorizationPolicy.canView(actor, caseAggregate, context);
        }

        if ("approve".equals(permission) || "case.approve".equals(permission)) {
            ApprovalCommand command = ApprovalCommand.authorizationOnly(caseAggregate.id());
            return caseAuthorizationPolicy.canApprove(actor, caseAggregate, command, context);
        }

        return AuthorizationDecisionResult.deny(
                DecisionCode.UNKNOWN_PERMISSION,
                "Access denied.",
                DecisionReason.single("Unknown permission: " + permission),
                DecisionEvidence.empty()
        );
    }
}
```

Usage:

```java
@PreAuthorize("hasPermission(#caseId, 'Case', 'approve')")
public void approveCase(String caseId, ApprovalRequest request) {
    // business operation
}
```

### 7.3 Risiko Pattern Ini

Pattern ini bisa menyebabkan:

1. repository call dari SpEL authorization;
2. N+1 decision;
3. limited decision result karena return type boolean;
4. audit reason hilang;
5. sulit membedakan hidden resource vs forbidden;
6. performance surprise;
7. exception handling tidak rapi.

Karena itu, gunakan sebagai adapter, bukan authorization core.

---

## 8. Pattern 5 — Specification-Style Authorization

### 8.1 Ide Utama

Policy sering bisa dipecah menjadi beberapa specification:

```text
actor is active
actor has permission
actor belongs to same agency
actor is assigned reviewer
case is approvable
actor is not submitter
case is not locked
```

Masing-masing rule bisa menjadi object.

```java
public interface AuthorizationRule<C> {
    PolicyDecision evaluate(C context);
}
```

Context:

```java
public final class CaseApprovalAuthorizationContext {
    private final Actor actor;
    private final CaseAggregate caseAggregate;
    private final ApprovalCommand command;
    private final AuthorizationContext requestContext;

    public CaseApprovalAuthorizationContext(
            Actor actor,
            CaseAggregate caseAggregate,
            ApprovalCommand command,
            AuthorizationContext requestContext
    ) {
        this.actor = actor;
        this.caseAggregate = caseAggregate;
        this.command = command;
        this.requestContext = requestContext;
    }

    public Actor actor() {
        return actor;
    }

    public CaseAggregate caseAggregate() {
        return caseAggregate;
    }

    public ApprovalCommand command() {
        return command;
    }

    public AuthorizationContext requestContext() {
        return requestContext;
    }
}
```

Rule:

```java
public final class SameAgencyRule implements AuthorizationRule<CaseApprovalAuthorizationContext> {

    @Override
    public PolicyDecision evaluate(CaseApprovalAuthorizationContext context) {
        if (context.actor().agencyId().equals(context.caseAggregate().agencyId())) {
            return PolicyDecision.allow(DecisionCode.SAME_AGENCY);
        }

        return PolicyDecision.deny(DecisionCode.CROSS_AGENCY_DENIED);
    }
}
```

Rule lain:

```java
public final class NotOriginalSubmitterRule implements AuthorizationRule<CaseApprovalAuthorizationContext> {

    @Override
    public PolicyDecision evaluate(CaseApprovalAuthorizationContext context) {
        String actorId = context.actor().id();
        String submitterId = context.caseAggregate().submittedBy();

        if (!actorId.equals(submitterId)) {
            return PolicyDecision.allow(DecisionCode.NOT_ORIGINAL_SUBMITTER);
        }

        return PolicyDecision.deny(DecisionCode.SEPARATION_OF_DUTY_VIOLATION);
    }
}
```

Policy composition:

```java
public final class CaseApprovalPolicyEngine {

    private final List<AuthorizationRule<CaseApprovalAuthorizationContext>> rules;
    private final DecisionCombiner combiner;

    public CaseApprovalPolicyEngine(
            List<AuthorizationRule<CaseApprovalAuthorizationContext>> rules,
            DecisionCombiner combiner
    ) {
        this.rules = Collections.unmodifiableList(new ArrayList<>(rules));
        this.combiner = combiner;
    }

    public PolicyDecision evaluate(CaseApprovalAuthorizationContext context) {
        List<PolicyDecision> decisions = new ArrayList<>();

        for (AuthorizationRule<CaseApprovalAuthorizationContext> rule : rules) {
            decisions.add(rule.evaluate(context));
        }

        return combiner.combine(decisions);
    }
}
```

### 8.2 Kelebihan

1. Rule kecil dan testable.
2. Policy composition eksplisit.
3. Cocok untuk banyak rule.
4. Bisa menghasilkan evidence per rule.
5. Bisa dipindahkan ke external policy engine lebih mudah.

### 8.3 Kekurangan

1. Bisa over-engineered untuk aplikasi kecil.
2. Debugging butuh trace decision.
3. Rule ordering harus jelas.
4. Data loading bisa tersebar jika tidak hati-hati.
5. Bisa berubah menjadi mini policy engine tanpa governance.

### 8.4 Top 1% Guideline

Gunakan specification-style kalau:

1. rule lebih dari 5–7 dan sering berubah;
2. policy perlu diuji per rule;
3. ada decision explainability;
4. ada multiple domain actions dengan rule reusable;
5. ada rencana externalized policy.

Jangan gunakan kalau:

1. hanya ada 2 rule sederhana;
2. tim belum siap maintain abstraction;
3. rule membutuhkan banyak IO terpisah tanpa data-loading plan.

---

## 9. Pattern 6 — Authorization Facade

### 9.1 Masalah

Kalau setiap service memanggil resolver dan policy sendiri, kode bisa tersebar:

```java
Actor actor = actorResolver.currentActor();
AuthorizationContext context = contextResolver.currentContext();
CaseAggregate c = caseRepository.findById(id).orElseThrow(...);
PolicyDecision decision = policy.canApprove(actor, c, command, context);
...
```

Untuk aplikasi besar, kita bisa punya facade.

### 9.2 Contoh

```java
@Service
public class CaseAuthorizationFacade {

    private final ActorResolver actorResolver;
    private final AuthorizationContextResolver contextResolver;
    private final CaseRepository caseRepository;
    private final CaseAuthorizationPolicy policy;
    private final AuthorizationAuditPublisher auditPublisher;

    public CaseAuthorizationFacade(
            ActorResolver actorResolver,
            AuthorizationContextResolver contextResolver,
            CaseRepository caseRepository,
            CaseAuthorizationPolicy policy,
            AuthorizationAuditPublisher auditPublisher
    ) {
        this.actorResolver = actorResolver;
        this.contextResolver = contextResolver;
        this.caseRepository = caseRepository;
        this.policy = policy;
        this.auditPublisher = auditPublisher;
    }

    public AuthorizedResource<CaseAggregate> authorizeView(String caseId) {
        Actor actor = actorResolver.currentActor();
        AuthorizationContext context = contextResolver.currentContext();

        CaseAggregate caseAggregate = caseRepository.findById(caseId)
                .orElseThrow(CaseNotFoundException::new);

        AuthorizationDecisionResult decision = policy.canView(actor, caseAggregate, context);
        auditPublisher.publish(decision);

        if (decision.denied()) {
            throw new AccessDeniedException(decision.safeMessage());
        }

        return new AuthorizedResource<>(actor, caseAggregate, decision);
    }

    public AuthorizedResource<CaseAggregate> authorizeApprove(ApprovalCommand command) {
        Actor actor = actorResolver.currentActor();
        AuthorizationContext context = contextResolver.currentContext();

        CaseAggregate caseAggregate = caseRepository.findById(command.caseId())
                .orElseThrow(CaseNotFoundException::new);

        AuthorizationDecisionResult decision = policy.canApprove(actor, caseAggregate, command, context);
        auditPublisher.publish(decision);

        if (decision.denied()) {
            throw new AccessDeniedException(decision.safeMessage());
        }

        return new AuthorizedResource<>(actor, caseAggregate, decision);
    }
}
```

Authorized resource wrapper:

```java
public final class AuthorizedResource<T> {
    private final Actor actor;
    private final T resource;
    private final AuthorizationDecisionResult decision;

    public AuthorizedResource(Actor actor, T resource, AuthorizationDecisionResult decision) {
        this.actor = actor;
        this.resource = resource;
        this.decision = decision;
    }

    public Actor actor() {
        return actor;
    }

    public T resource() {
        return resource;
    }

    public AuthorizationDecisionResult decision() {
        return decision;
    }
}
```

Usage:

```java
@Transactional
public void approve(ApprovalCommand command) {
    AuthorizedResource<CaseAggregate> authorized = authorizationFacade.authorizeApprove(command);

    CaseAggregate caseAggregate = authorized.resource();
    caseAggregate.approve(authorized.actor().id(), command.reason());

    caseRepository.save(caseAggregate);
}
```

### 9.3 Kelebihan

1. Service layer lebih bersih.
2. Audit lebih konsisten.
3. Fetch + authorize pattern lebih seragam.
4. Mengurangi duplicate boilerplate.
5. Bisa enforce “no resource use before authorization”.

### 9.4 Risiko

1. Facade bisa menjadi god service.
2. Bisa menyembunyikan query scoping problem.
3. Bisa membuat semua action coupling ke satu class besar.

Mitigasi:

```text
Buat facade per bounded context/domain aggregate, bukan satu GlobalAuthorizationFacade.
```

---

## 10. Pattern 7 — Command Authorization

### 10.1 Kenapa Command Lebih Baik Dari CRUD

CRUD authorization sering terlalu kasar:

```text
case.create
case.read
case.update
case.delete
```

Dalam domain nyata, update punya banyak arti:

```text
case.assignOfficer
case.updatePriority
case.addEvidence
case.requestClarification
case.approve
case.reject
case.returnToApplicant
case.reopen
case.close
case.exportBundle
```

Masing-masing punya rule berbeda.

### 10.2 Command Object

```java
public final class AssignOfficerCommand {
    private final String caseId;
    private final String officerId;
    private final String reason;

    public AssignOfficerCommand(String caseId, String officerId, String reason) {
        this.caseId = requireNonBlank(caseId, "caseId");
        this.officerId = requireNonBlank(officerId, "officerId");
        this.reason = requireNonBlank(reason, "reason");
    }

    public String caseId() {
        return caseId;
    }

    public String officerId() {
        return officerId;
    }

    public String reason() {
        return reason;
    }

    private static String requireNonBlank(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value;
    }
}
```

Policy:

```java
public AuthorizationDecisionResult canAssign(
        Actor actor,
        CaseAggregate caseAggregate,
        AssignOfficerCommand command,
        AuthorizationContext context
) {
    if (!permissionResolver.hasPermission(actor, "case.assignOfficer")) {
        return denyMissingPermission("case.assignOfficer");
    }

    if (!caseAggregate.status().allowsAssignment()) {
        return denyInvalidState(caseAggregate.status());
    }

    if (!sameAgency(actor, caseAggregate)) {
        return denyCrossAgency();
    }

    if (!officerDirectory.isAssignableToCase(command.officerId(), caseAggregate.caseType())) {
        return denyOfficerNotAssignable();
    }

    return allow();
}
```

### 10.3 Top 1% Insight

Permission should usually map to **business capability**, not HTTP verb.

```text
Bad:  case.update
Good: case.assignOfficer
Good: case.approve
Good: case.exportBundle
Good: case.reopen
```

---

## 11. Pattern 8 — State-Based Authorization

### 11.1 State Is Part Of Authorization Context

Dalam workflow system, user mungkin boleh approve case hanya pada state tertentu.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_APPROVAL,
    APPROVED,
    REJECTED,
    CLOSED;

    public boolean canBeApproved() {
        return this == PENDING_APPROVAL;
    }

    public boolean canBeAssigned() {
        return this == SUBMITTED || this == UNDER_REVIEW;
    }

    public boolean canBeReopened() {
        return this == CLOSED || this == REJECTED;
    }
}
```

Authorization rule:

```java
if (!caseAggregate.status().canBeApproved()) {
    return AuthorizationDecisionResult.deny(
            DecisionCode.INVALID_CASE_STATE,
            "This case cannot be approved in its current state.",
            DecisionReason.single("Case state is " + caseAggregate.status()),
            evidence.build()
    );
}
```

### 11.2 Jangan Campur State Validity Dengan Actor Authorization Secara Buta

Ada dua pertanyaan berbeda:

```text
1. Apakah transition APPROVE valid dari state sekarang?
2. Apakah actor ini boleh menjalankan transition APPROVE?
```

Keduanya harus lulus.

```java
if (!caseAggregate.canTransitionTo(CaseTransition.APPROVE)) {
    throw new InvalidCaseTransitionException(...);
}

authorizer.authorizeApprove(actor, caseAggregate, command);
```

Atau, jika policy butuh state, policy bisa membaca state tetapi tetap jangan menjadikan authorization sebagai satu-satunya validator state machine.

### 11.3 State Transition Matrix

Contoh matrix:

| From State | Action | Required Capability | Additional Rule |
|---|---:|---:|---|
| SUBMITTED | assignOfficer | `case.assignOfficer` | same agency, supervisor |
| UNDER_REVIEW | requestClarification | `case.requestClarification` | assigned officer |
| PENDING_APPROVAL | approve | `case.approve` | reviewer, not submitter |
| PENDING_APPROVAL | reject | `case.reject` | reviewer, reason required |
| CLOSED | reopen | `case.reopen` | supervisor, within reopening window |

Matrix ini harus hidup sebagai artifact desain, bukan hanya tersembunyi di kode.

---

## 12. Pattern 9 — Cross-Aggregate Authorization

### 12.1 Masalah

Banyak action tidak hanya bergantung pada satu aggregate.

Contoh:

```text
Assign officer to case
```

Butuh:

1. actor;
2. case;
3. target officer;
4. target officer workload;
5. agency boundary;
6. role assignment;
7. conflict of interest record;
8. current delegation.

### 12.2 Jangan Load Cross-Aggregate Data Sembarangan Di Rule

Buruk:

```java
public PolicyDecision evaluate(Context ctx) {
    Officer officer = officerRepository.findById(ctx.command().officerId());
    List<Case> cases = caseRepository.findByOfficer(officer.id());
    ConflictCheck conflict = conflictService.check(officer, ctx.caseAggregate());
    ...
}
```

Masalah:

1. rule punya IO tersembunyi;
2. sulit dites;
3. lambat;
4. mudah menyebabkan N+1;
5. transaction boundary kabur;
6. cache sulit.

Lebih baik buat preloaded authorization input:

```java
public final class AssignOfficerAuthorizationInput {
    private final Actor actor;
    private final CaseAggregate caseAggregate;
    private final Officer targetOfficer;
    private final OfficerWorkloadSnapshot workloadSnapshot;
    private final ConflictCheckResult conflictCheckResult;
    private final AuthorizationContext context;

    // Constructor/getters omitted.
}
```

Policy menjadi pure-ish:

```java
public PolicyDecision canAssign(AssignOfficerAuthorizationInput input) {
    if (!input.actor().agencyId().equals(input.caseAggregate().agencyId())) {
        return denyCrossAgency();
    }

    if (!input.targetOfficer().agencyId().equals(input.caseAggregate().agencyId())) {
        return denyTargetOfficerOutsideAgency();
    }

    if (input.conflictCheckResult().hasConflict()) {
        return denyConflictOfInterest();
    }

    if (input.workloadSnapshot().exceedsLimit()) {
        return denyWorkloadExceeded();
    }

    return allow();
}
```

### 12.3 Top 1% Insight

Untuk cross-aggregate authorization, desain input decision secara eksplisit.

```text
Good authorization design is often good input-shaping design.
```

---

## 13. Pattern 10 — Bulk Decision API

### 13.1 Masalah N+1 Authorization

UI sering perlu menampilkan daftar case dengan action yang tersedia:

```text
Case 1: View, Assign
Case 2: View, Approve
Case 3: View only
Case 4: no access
```

Jika setiap row memanggil policy sendiri dan policy load DB sendiri, bisa terjadi N+1.

Buruk:

```java
for (CaseSummary row : rows) {
    row.setCanApprove(policy.canApprove(actor, loadCase(row.id()), context).allowed());
}
```

### 13.2 Bulk API

```java
public interface CaseBulkAuthorizationPolicy {
    Map<String, CaseActionSetDecision> decideAvailableActions(
            Actor actor,
            List<CaseSummary> cases,
            AuthorizationContext context
    );
}
```

Decision per case:

```java
public final class CaseActionSetDecision {
    private final String caseId;
    private final Map<String, AuthorizationDecisionResult> actionDecisions;

    public CaseActionSetDecision(
            String caseId,
            Map<String, AuthorizationDecisionResult> actionDecisions
    ) {
        this.caseId = caseId;
        this.actionDecisions = Collections.unmodifiableMap(new LinkedHashMap<>(actionDecisions));
    }

    public boolean can(String action) {
        AuthorizationDecisionResult decision = actionDecisions.get(action);
        return decision != null && decision.allowed();
    }

    public Map<String, AuthorizationDecisionResult> actionDecisions() {
        return actionDecisions;
    }
}
```

### 13.3 Bulk Evaluation Strategy

```java
@Service
public class DefaultCaseBulkAuthorizationPolicy implements CaseBulkAuthorizationPolicy {

    private final PermissionResolver permissionResolver;
    private final AssignmentRepository assignmentRepository;

    public DefaultCaseBulkAuthorizationPolicy(
            PermissionResolver permissionResolver,
            AssignmentRepository assignmentRepository
    ) {
        this.permissionResolver = permissionResolver;
        this.assignmentRepository = assignmentRepository;
    }

    @Override
    public Map<String, CaseActionSetDecision> decideAvailableActions(
            Actor actor,
            List<CaseSummary> cases,
            AuthorizationContext context
    ) {
        Set<String> caseIds = cases.stream()
                .map(CaseSummary::id)
                .collect(Collectors.toCollection(LinkedHashSet::new));

        Set<String> assignedReviewerCaseIds = assignmentRepository
                .findReviewerAssignments(actor.id(), caseIds);

        boolean canView = permissionResolver.hasPermission(actor, "case.view");
        boolean canApprove = permissionResolver.hasPermission(actor, "case.approve");
        boolean canAssign = permissionResolver.hasPermission(actor, "case.assignOfficer");

        Map<String, CaseActionSetDecision> result = new LinkedHashMap<>();

        for (CaseSummary caseSummary : cases) {
            Map<String, AuthorizationDecisionResult> actions = new LinkedHashMap<>();

            actions.put("view", decideView(actor, caseSummary, canView));
            actions.put("approve", decideApprove(actor, caseSummary, canApprove, assignedReviewerCaseIds));
            actions.put("assignOfficer", decideAssign(actor, caseSummary, canAssign));

            result.put(caseSummary.id(), new CaseActionSetDecision(caseSummary.id(), actions));
        }

        return result;
    }

    private AuthorizationDecisionResult decideView(
            Actor actor,
            CaseSummary caseSummary,
            boolean hasPermission
    ) {
        if (!hasPermission) {
            return SimpleDecisions.deny(DecisionCode.MISSING_PERMISSION);
        }
        if (!actor.agencyId().equals(caseSummary.agencyId())) {
            return SimpleDecisions.deny(DecisionCode.CROSS_AGENCY_DENIED);
        }
        return SimpleDecisions.allow();
    }

    private AuthorizationDecisionResult decideApprove(
            Actor actor,
            CaseSummary caseSummary,
            boolean hasPermission,
            Set<String> assignedReviewerCaseIds
    ) {
        if (!hasPermission) {
            return SimpleDecisions.deny(DecisionCode.MISSING_PERMISSION);
        }
        if (!actor.agencyId().equals(caseSummary.agencyId())) {
            return SimpleDecisions.deny(DecisionCode.CROSS_AGENCY_DENIED);
        }
        if (!assignedReviewerCaseIds.contains(caseSummary.id())) {
            return SimpleDecisions.deny(DecisionCode.NOT_ASSIGNED_REVIEWER);
        }
        if (!caseSummary.status().canBeApproved()) {
            return SimpleDecisions.deny(DecisionCode.INVALID_CASE_STATE);
        }
        return SimpleDecisions.allow();
    }

    private AuthorizationDecisionResult decideAssign(
            Actor actor,
            CaseSummary caseSummary,
            boolean hasPermission
    ) {
        if (!hasPermission) {
            return SimpleDecisions.deny(DecisionCode.MISSING_PERMISSION);
        }
        if (!actor.agencyId().equals(caseSummary.agencyId())) {
            return SimpleDecisions.deny(DecisionCode.CROSS_AGENCY_DENIED);
        }
        if (!caseSummary.status().canBeAssigned()) {
            return SimpleDecisions.deny(DecisionCode.INVALID_CASE_STATE);
        }
        return SimpleDecisions.allow();
    }
}
```

### 13.4 Jangan Jadikan Bulk Action Availability Sebagai Enforcement Utama

Bulk decision untuk UI action availability tidak menggantikan enforcement saat command dieksekusi.

```text
UI says button enabled != command is authorized
```

Saat user benar-benar klik approve, command handler tetap harus authorize ulang.

---

## 14. Pattern 11 — Query Specification Authorization

### 14.1 Masalah

Domain policy seperti `canView(actor, case)` berguna untuk satu object, tetapi list/search/report membutuhkan query scoping.

Buruk:

```java
List<Case> all = caseRepository.search(criteria);
return all.stream()
        .filter(c -> policy.canView(actor, c, context).allowed())
        .collect(toList());
```

Masalah:

1. data unauthorized sudah keluar dari DB;
2. pagination salah;
3. count salah;
4. performance buruk;
5. audit sulit;
6. row leakage via timing/total count;
7. bisa memory blow-up.

### 14.2 Authorization Query Scope

```java
public interface CaseAuthorizationQueryScopeFactory {
    CaseQueryScope viewableCases(Actor actor, AuthorizationContext context);
}
```

```java
public final class CaseQueryScope {
    private final String agencyId;
    private final Set<String> allowedCaseTypes;
    private final boolean includeAssignedOnly;
    private final String assignedOfficerId;

    // Constructor/getters omitted.
}
```

Repository:

```java
public interface CaseSearchRepository {
    Page<CaseSummary> searchAuthorized(
            CaseSearchCriteria criteria,
            CaseQueryScope scope,
            Pageable pageable
    );
}
```

Implementation idea:

```java
WHERE c.agency_id = :scopeAgencyId
  AND c.case_type IN (:allowedCaseTypes)
  AND (:assignedOnly = false OR c.assigned_officer_id = :actorId)
```

### 14.3 Spring Data Specification Example

```java
public final class CaseAuthorizationSpecifications {

    private CaseAuthorizationSpecifications() {
    }

    public static Specification<CaseEntity> viewableBy(Actor actor) {
        return new Specification<CaseEntity>() {
            @Override
            public Predicate toPredicate(
                    Root<CaseEntity> root,
                    CriteriaQuery<?> query,
                    CriteriaBuilder cb
            ) {
                List<Predicate> predicates = new ArrayList<>();

                predicates.add(cb.equal(root.get("agencyId"), actor.agencyId()));

                if (!actor.hasPermission("case.view.allInAgency")) {
                    predicates.add(cb.equal(root.get("assignedOfficerId"), actor.id()));
                }

                return cb.and(predicates.toArray(new Predicate[0]));
            }
        };
    }
}
```

Usage:

```java
Specification<CaseEntity> spec = Specification
        .where(CaseSearchSpecifications.byCriteria(criteria))
        .and(CaseAuthorizationSpecifications.viewableBy(actor));

return caseRepository.findAll(spec, pageable);
```

### 14.4 Top 1% Insight

Object authorization and query authorization are related but not identical.

```text
canView(actor, case) protects object use.
viewableBy(actor) protects data retrieval.
```

A mature system usually needs both.

---

## 15. Pattern 12 — Domain Authorization Metadata for UI

### 15.1 Problem

Frontend sering butuh tahu action apa yang tersedia.

Jangan hanya kirim role ke frontend lalu frontend menyimpulkan sendiri.

Buruk:

```json
{
  "roles": ["REVIEWER", "SUPERVISOR"]
}
```

Frontend kemudian:

```javascript
if (roles.includes('REVIEWER')) showApproveButton();
```

Masalah:

1. frontend menduplikasi policy;
2. state/resource/context tidak lengkap;
3. policy drift;
4. tombol bisa muncul salah;
5. security tetap harus di backend.

Lebih baik backend mengirim action metadata:

```json
{
  "caseId": "CASE-123",
  "status": "PENDING_APPROVAL",
  "actions": {
    "view": { "allowed": true },
    "approve": { "allowed": true, "requiresReason": true },
    "assignOfficer": { "allowed": false, "reasonCode": "INVALID_CASE_STATE" },
    "exportBundle": { "allowed": false, "reasonCode": "MISSING_PERMISSION" }
  }
}
```

### 15.2 Java DTO

```java
public final class ActionAvailabilityDto {
    private final boolean allowed;
    private final String reasonCode;
    private final Map<String, Object> obligations;

    public ActionAvailabilityDto(
            boolean allowed,
            String reasonCode,
            Map<String, Object> obligations
    ) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.obligations = obligations == null
                ? Collections.emptyMap()
                : Collections.unmodifiableMap(new LinkedHashMap<>(obligations));
    }

    public boolean isAllowed() {
        return allowed;
    }

    public String getReasonCode() {
        return reasonCode;
    }

    public Map<String, Object> getObligations() {
        return obligations;
    }
}
```

Mapper:

```java
public ActionAvailabilityDto toDto(AuthorizationDecisionResult decision) {
    Map<String, Object> obligations = new LinkedHashMap<>();

    for (AuthorizationObligation obligation : decision.obligations()) {
        obligations.put(obligation.type().name(), obligation.attributes());
    }

    return new ActionAvailabilityDto(
            decision.allowed(),
            decision.code().name(),
            obligations
    );
}
```

### 15.3 Caveat

UI metadata is advisory. Enforcement tetap di backend command handler.

---

## 16. Pattern 13 — Authorization Inside Aggregate?

### 16.1 Pertanyaan

Apakah aggregate boleh melakukan authorization sendiri?

Contoh:

```java
caseAggregate.approve(actor);
```

Di dalam aggregate:

```java
if (!actor.canApproveCase(this)) {
    throw new AccessDeniedException(...);
}
```

### 16.2 Kapan Bisa

Bisa jika rule authorization hanya membutuhkan state internal aggregate dan actor object sudah lengkap.

Contoh:

```java
public void approve(Actor actor, String reason) {
    if (!status.canBeApproved()) {
        throw new InvalidCaseTransitionException(...);
    }

    if (submittedBy.equals(actor.id())) {
        throw new AccessDeniedDomainException("Submitter cannot approve own case");
    }

    this.status = CaseStatus.APPROVED;
    this.approvedBy = actor.id();
    this.approvedAt = Instant.now();
}
```

### 16.3 Kapan Jangan

Jangan jika rule butuh:

1. role resolver;
2. permission resolver;
3. external directory;
4. org hierarchy service;
5. delegation record;
6. feature flag;
7. policy engine;
8. audit publisher;
9. request context;
10. database query tambahan.

Aggregate sebaiknya tidak punya dependency ke Spring Security, repository, atau HTTP context.

### 16.4 Hybrid Approach

Gunakan application/domain service untuk authorization lengkap:

```java
authorizer.authorizeApprove(actor, caseAggregate, command);
caseAggregate.approve(actor.id(), command.reason());
```

Aggregate tetap enforce invariant internal:

```java
public void approve(String actorId, String reason) {
    if (!status.canBeApproved()) {
        throw new InvalidCaseTransitionException(...);
    }
    if (submittedBy.equals(actorId)) {
        throw new IllegalStateException("Submitter cannot approve own case");
    }
    // mutate
}
```

Ini defense-in-depth di domain model.

---

## 17. Pattern 14 — Policy Registry

### 17.1 Masalah

Ketika domain action banyak, switch-case bisa membesar:

```java
switch (action) {
    case "case.view": ...
    case "case.approve": ...
    case "case.assign": ...
}
```

Policy registry membantu memetakan action ke evaluator.

### 17.2 Interface

```java
public interface DomainActionPolicy<I> {
    String action();
    AuthorizationDecisionResult evaluate(I input);
}
```

Registry:

```java
@Component
public class CasePolicyRegistry {

    private final Map<String, DomainActionPolicy<CaseAuthorizationInput>> policies;

    public CasePolicyRegistry(List<DomainActionPolicy<CaseAuthorizationInput>> policies) {
        Map<String, DomainActionPolicy<CaseAuthorizationInput>> map = new LinkedHashMap<>();
        for (DomainActionPolicy<CaseAuthorizationInput> policy : policies) {
            if (map.containsKey(policy.action())) {
                throw new IllegalStateException("Duplicate policy for action: " + policy.action());
            }
            map.put(policy.action(), policy);
        }
        this.policies = Collections.unmodifiableMap(map);
    }

    public AuthorizationDecisionResult evaluate(String action, CaseAuthorizationInput input) {
        DomainActionPolicy<CaseAuthorizationInput> policy = policies.get(action);
        if (policy == null) {
            return AuthorizationDecisionResult.deny(
                    DecisionCode.NO_APPLICABLE_POLICY,
                    "Access denied.",
                    DecisionReason.single("No policy registered for action " + action),
                    DecisionEvidence.empty()
            );
        }
        return policy.evaluate(input);
    }
}
```

### 17.3 Policy Implementation

```java
@Component
public class CaseApprovePolicy implements DomainActionPolicy<CaseAuthorizationInput> {

    @Override
    public String action() {
        return "case.approve";
    }

    @Override
    public AuthorizationDecisionResult evaluate(CaseAuthorizationInput input) {
        // approve-specific rule
        return SimpleDecisions.allow();
    }
}
```

### 17.4 Kapan Registry Cocok

Cocok untuk:

1. banyak action;
2. plugin-like policy;
3. modular domain;
4. action availability API;
5. policy inventory;
6. automated documentation.

Tidak perlu untuk domain kecil dengan beberapa method eksplisit.

---

## 18. Pattern 15 — Bridging Spring `AuthorizationManager` To Domain Policy

### 18.1 Kenapa Perlu

Spring Security modern memakai `AuthorizationManager` sebagai abstraction penting untuk pre-invocation dan post-invocation decision. Kita bisa membuat custom `AuthorizationManager` yang delegasi ke domain policy.

### 18.2 Request-Level Adapter

```java
public final class CaseRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final ActorResolver actorResolver;
    private final CaseRepository caseRepository;
    private final CaseAuthorizationPolicy policy;
    private final AuthorizationContextResolver contextResolver;

    public CaseRequestAuthorizationManager(
            ActorResolver actorResolver,
            CaseRepository caseRepository,
            CaseAuthorizationPolicy policy,
            AuthorizationContextResolver contextResolver
    ) {
        this.actorResolver = actorResolver;
        this.caseRepository = caseRepository;
        this.policy = policy;
        this.contextResolver = contextResolver;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext object
    ) {
        Authentication auth = authentication.get();
        Actor actor = actorResolver.from(auth);

        String caseId = object.getVariables().get("caseId");
        if (caseId == null) {
            return new AuthorizationDecision(false);
        }

        CaseAggregate caseAggregate = caseRepository.findById(caseId).orElse(null);
        if (caseAggregate == null) {
            return new AuthorizationDecision(false);
        }

        AuthorizationDecisionResult decision = policy.canView(
                actor,
                caseAggregate,
                contextResolver.currentContext()
        );

        return new AuthorizationDecision(decision.allowed());
    }
}
```

Configuration sketch:

```java
http.authorizeHttpRequests(authz -> authz
        .requestMatchers("/api/cases/{caseId}")
        .access(caseRequestAuthorizationManager)
        .anyRequest().authenticated()
);
```

### 18.3 Caveat

Request-level manager yang load domain object bisa mahal. Biasanya lebih aman:

1. request-level guard untuk coarse permission;
2. service-level domain policy untuk precise enforcement;
3. query-level scope untuk search/list.

---

## 19. Anti-Patterns

### 19.1 `hasRole('ADMIN')` As Domain Policy

```java
@PreAuthorize("hasRole('ADMIN')")
public void approveCase(String caseId) { ... }
```

Masalah:

1. role tidak menjelaskan business capability;
2. admin menjadi bypass semua rule;
3. no object check;
4. no state check;
5. no SoD;
6. no audit reason.

Better:

```java
caseAuthorizer.authorizeApprove(actor, caseAggregate, command);
```

---

### 19.2 Policy In Controller

Buruk:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable String id) {
    if (!currentUser.hasRole("REVIEWER")) return forbidden();
    Case c = repo.findById(id).get();
    if (!c.getAgencyId().equals(currentUser.getAgencyId())) return forbidden();
    if (!c.getStatus().equals("PENDING_APPROVAL")) return badRequest();
    service.approve(id);
    return ok();
}
```

Masalah:

1. tidak reusable;
2. batch/message/internal API bisa bypass;
3. test policy lewat MVC saja;
4. policy tersebar;
5. controller terlalu tahu domain rule.

---

### 19.3 Policy Hidden In Repository Only

```java
SELECT * FROM cases WHERE agency_id = :currentAgency
```

Ini bagus untuk scoping, tetapi tidak cukup untuk command seperti approve.

Repository scope menjawab:

```text
apa yang bisa dilihat/dicari?
```

Command policy menjawab:

```text
apa yang boleh dilakukan?
```

Butuh keduanya.

---

### 19.4 Boolean Blindness

```java
if (!policy.canApprove(user, c)) throw new AccessDeniedException("Denied");
```

Tidak ada reason, evidence, obligation, code, audit detail.

---

### 19.5 SpEL As Policy Language

```java
@PreAuthorize("hasAuthority('case.approve') and @org.same(authentication, #id) and @assignment.isReviewer(authentication, #id) and @caseState.canApprove(#id) and !@caseOwnership.isSubmitter(authentication, #id)")
```

Masalah:

1. logic panjang;
2. sulit refactor;
3. sulit test granular;
4. IO tersembunyi;
5. error runtime;
6. no rich decision.

Better:

```java
@PreAuthorize("@casePolicyExpression.canApprove(authentication, #id)")
```

Tetapi untuk domain serius, lebih baik service-level explicit authorizer.

---

### 19.6 Fetch Object Then Forget To Authorize

```java
CaseAggregate caseAggregate = caseRepository.findById(id).orElseThrow(...);
return mapper.toDto(caseAggregate);
```

Untuk mengurangi risiko, gunakan pattern:

```java
AuthorizedResource<CaseAggregate> authorized = authorizationFacade.authorizeView(id);
return mapper.toDto(authorized.resource());
```

---

### 19.7 Action Availability Treated As Enforcement

```text
Frontend disabled approve button, jadi backend tidak perlu check.
```

Salah. Frontend hanya advisory. Backend harus enforce.

---

### 19.8 Policy With Hidden Time Dependency

```java
if (Instant.now().isAfter(deadline)) deny();
```

Langsung pakai `Instant.now()` membuat test sulit dan decision tidak reproducible.

Better:

```java
AuthorizationContext context = new AuthorizationContext(requestId, actorIp, clock.instant());
```

Policy membaca `context.now()`.

---

## 20. Failure Modes

### 20.1 Missing Domain Check

Endpoint memiliki `hasAuthority('case.approve')`, tetapi service tidak cek object/state.

Dampak:

1. reviewer bisa approve case lain;
2. cross-agency approval;
3. violation of duty;
4. audit tidak defensible.

### 20.2 Wrong Resource

Policy mengecek case parent, tetapi action mengubah child evidence/document yang punya boundary berbeda.

Contoh:

```text
User boleh view case, tapi belum tentu boleh download sealed evidence.
```

### 20.3 Wrong Actor

System memakai service account sebagai actor, bukan original user.

Akibat:

```text
semua downstream action terlihat authorized sebagai service account
```

Need:

```text
effective actor + technical caller + delegation chain
```

### 20.4 Stale Decision

UI load action availability pukul 10:00. Assignment dicabut pukul 10:01. User klik approve pukul 10:02.

Backend harus authorize ulang saat command.

### 20.5 Incomplete Context

Policy butuh channel/network zone/risk level, tetapi resolver tidak menyediakannya. Jangan default allow.

### 20.6 Inconsistent Denial Mapping

Satu flow return 403, flow lain return 404, flow lain return 200 empty. Ini bisa menyebabkan enumeration atau UX buruk.

Tentukan policy:

```text
resource existence hidden for cross-boundary access
business denial shown for known accessible resource
```

### 20.7 Bulk Partial Bypass

Bulk approve menerima 100 IDs. Service mengecek permission global sekali, lalu approve semua.

Correct pattern:

```java
for each item:
    fetch scoped resource
    authorize command on that resource
    record per-item decision
```

Atau reject semua jika ada satu unauthorized, tergantung business semantics.

---

## 21. Testing Strategy

### 21.1 Unit Test Policy Service

```java
class DefaultCaseAuthorizationPolicyTest {

    private DefaultCaseAuthorizationPolicy policy;
    private FakePermissionResolver permissionResolver;
    private FakeAssignmentResolver assignmentResolver;
    private FakeOrganizationBoundaryService organizationBoundaryService;
    private FakeSeparationOfDutyService separationOfDutyService;

    @BeforeEach
    void setUp() {
        permissionResolver = new FakePermissionResolver();
        assignmentResolver = new FakeAssignmentResolver();
        organizationBoundaryService = new FakeOrganizationBoundaryService();
        separationOfDutyService = new FakeSeparationOfDutyService();

        policy = new DefaultCaseAuthorizationPolicy(
                permissionResolver,
                assignmentResolver,
                organizationBoundaryService,
                separationOfDutyService
        );
    }

    @Test
    void approveDeniedWhenMissingPermission() {
        Actor actor = Actors.activeReviewer("u1", "agency-a");
        CaseAggregate c = Cases.pendingApproval("c1", "agency-a");

        permissionResolver.deny("case.approve");

        AuthorizationDecisionResult decision = policy.canApprove(
                actor,
                c,
                ApprovalCommand.authorizationOnly("c1"),
                AuthorizationContext.test()
        );

        assertFalse(decision.allowed());
        assertEquals(DecisionCode.MISSING_PERMISSION, decision.code());
    }

    @Test
    void approveDeniedWhenDifferentAgency() {
        Actor actor = Actors.activeReviewer("u1", "agency-a");
        CaseAggregate c = Cases.pendingApproval("c1", "agency-b");

        permissionResolver.allow("case.approve");
        organizationBoundaryService.setSameAgency(false);

        AuthorizationDecisionResult decision = policy.canApprove(
                actor,
                c,
                ApprovalCommand.authorizationOnly("c1"),
                AuthorizationContext.test()
        );

        assertFalse(decision.allowed());
        assertEquals(DecisionCode.CROSS_AGENCY_DENIED, decision.code());
    }

    @Test
    void approveDeniedWhenSubmitterApprovesOwnCase() {
        Actor actor = Actors.activeReviewer("u1", "agency-a");
        CaseAggregate c = Cases.pendingApprovalSubmittedBy("c1", "agency-a", "u1");

        permissionResolver.allow("case.approve");
        organizationBoundaryService.setSameAgency(true);
        assignmentResolver.setReviewer(true);
        separationOfDutyService.setOriginalSubmitter(true);

        AuthorizationDecisionResult decision = policy.canApprove(
                actor,
                c,
                ApprovalCommand.authorizationOnly("c1"),
                AuthorizationContext.test()
        );

        assertFalse(decision.allowed());
        assertEquals(DecisionCode.SEPARATION_OF_DUTY_VIOLATION, decision.code());
    }
}
```

### 21.2 Matrix Test

Buat test matrix:

| Permission | Same Agency | Assigned Reviewer | State | Submitter? | Expected |
|---|---:|---:|---|---:|---|
| yes | yes | yes | PENDING_APPROVAL | no | allow |
| no | yes | yes | PENDING_APPROVAL | no | deny missing permission |
| yes | no | yes | PENDING_APPROVAL | no | deny cross agency |
| yes | yes | no | PENDING_APPROVAL | no | deny not assigned |
| yes | yes | yes | CLOSED | no | deny invalid state |
| yes | yes | yes | PENDING_APPROVAL | yes | deny SoD |

### 21.3 Integration Test Service Enforcement

Test bahwa service benar-benar memanggil authorizer.

```java
@Test
void approveDoesNotMutateWhenAuthorizationDenied() {
    // arrange unauthorized actor/case
    // call service.approve
    // assert AccessDeniedException
    // assert case status unchanged
    // assert audit denial published
}
```

### 21.4 Spring Method Security Adapter Test

Jika masih pakai `@PreAuthorize`, test adapter juga.

```java
@WithMockUser(authorities = "case.approve")
@Test
void methodSecurityCallsDomainPolicy() {
    // verify custom PermissionEvaluator/policy bean used
}
```

### 21.5 Property-Based Thinking

Invariants:

```text
No actor may approve own submission.
No actor may access another agency case unless cross-agency delegation exists.
No closed case may be approved.
No unknown action should allow.
No indeterminate decision should allow sensitive mutation.
```

Bahkan tanpa property-based testing library, buat randomized test kecil untuk combinations.

---

## 22. Observability and Audit

### 22.1 What To Log

Authorization audit event minimal:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decision": "DENY",
  "decisionCode": "CROSS_AGENCY_DENIED",
  "subjectId": "user-123",
  "effectiveActorId": "user-123",
  "action": "case.approve",
  "resourceType": "case",
  "resourceId": "CASE-123",
  "tenantId": "agency-a",
  "policyName": "CaseApprovalPolicy",
  "policyVersion": "2026-06-19.1",
  "requestId": "req-abc",
  "correlationId": "corr-xyz",
  "decidedAt": "2026-06-19T10:15:30Z"
}
```

### 22.2 Jangan Log Data Sensitif Berlebihan

Evidence internal bisa sensitif. Pisahkan:

1. safe reason for user;
2. internal diagnostic;
3. audit evidence;
4. security event.

### 22.3 Allow Audit vs Deny Audit

Deny audit penting untuk security. Allow audit penting untuk regulatory defensibility.

Untuk action sensitif:

```text
approve
reject
export
delete
assign
break-glass
impersonate
reopen
```

Audit allow dan deny.

---

## 23. Java 8–25 Design Notes

### 23.1 Java 8 Baseline

Gunakan:

1. class biasa untuk value object;
2. immutable collection manual;
3. `Optional` secara hati-hati;
4. interface composition;
5. enum untuk decision code;
6. explicit builder jika object kompleks.

### 23.2 Java 11+

Tidak banyak mengubah domain authorization, tetapi runtime modern membantu maintainability.

### 23.3 Java 17+

Bisa gunakan:

1. `record` untuk decision/input object;
2. sealed interface untuk decision hierarchy;
3. pattern matching secara terbatas sesuai versi;
4. text blocks untuk policy test fixture.

Contoh Java 17+:

```java
public record AuthorizationRequest(
        Actor actor,
        String action,
        ResourceRef resource,
        AuthorizationContext context
) {
}

public sealed interface AuthorizationResult
        permits AuthorizationResult.Allowed, AuthorizationResult.Denied {

    record Allowed(List<AuthorizationObligation> obligations) implements AuthorizationResult {
    }

    record Denied(DecisionCode code, String safeMessage) implements AuthorizationResult {
    }
}
```

### 23.4 Java 21/25

Virtual threads bisa membantu jika authorization melakukan IO ke PDP/attribute service, tetapi tidak memperbaiki model policy yang buruk.

Structured concurrency dapat membantu menyusun parallel attribute loading, tetapi harus hati-hati terhadap:

1. timeout;
2. cancellation;
3. partial failure;
4. fail-closed behavior;
5. audit evidence completeness.

Authorization correctness tetap lebih penting daripada concurrency cleverness.

---

## 24. Recommended Package Structure

Contoh struktur:

```text
com.example.caseapp.authorization
  ├── api
  │   ├── AuthorizationDecisionResult.java
  │   ├── DecisionCode.java
  │   ├── DecisionReason.java
  │   ├── AuthorizationObligation.java
  │   └── AuthorizationContext.java
  │
  ├── actor
  │   ├── Actor.java
  │   ├── ActorResolver.java
  │   └── SpringSecurityActorResolver.java
  │
  ├── casepolicy
  │   ├── CaseAuthorizationPolicy.java
  │   ├── DefaultCaseAuthorizationPolicy.java
  │   ├── CaseCommandAuthorizer.java
  │   ├── DefaultCaseCommandAuthorizer.java
  │   ├── CaseBulkAuthorizationPolicy.java
  │   └── DefaultCaseBulkAuthorizationPolicy.java
  │
  ├── rule
  │   ├── AuthorizationRule.java
  │   ├── SameAgencyRule.java
  │   ├── HasPermissionRule.java
  │   ├── AssignedReviewerRule.java
  │   └── NotOriginalSubmitterRule.java
  │
  ├── query
  │   ├── CaseAuthorizationQueryScopeFactory.java
  │   └── CaseAuthorizationSpecifications.java
  │
  ├── spring
  │   ├── DomainPermissionEvaluator.java
  │   ├── CaseRequestAuthorizationManager.java
  │   └── AuthorizationDeniedHandler.java
  │
  └── audit
      ├── AuthorizationAuditEvent.java
      └── AuthorizationAuditPublisher.java
```

Keep Spring-specific adapters in `authorization.spring`, not inside pure policy model.

---

## 25. Production Checklist

### 25.1 Design Checklist

- [ ] Does each sensitive business action have a named capability?
- [ ] Is authorization expressed in domain terms?
- [ ] Is request authorization separated from domain authorization?
- [ ] Is object-level authorization enforced?
- [ ] Is query/list/search authorization enforced before data leaves DB/search engine?
- [ ] Are state-based rules explicit?
- [ ] Are tenant/org/agency boundaries explicit?
- [ ] Are deny reasons coded and safe?
- [ ] Are obligations modeled?
- [ ] Is there a bulk decision API for UI/list use cases?
- [ ] Is service execution re-authorized even if UI action availability was checked?
- [ ] Are all sensitive allow/deny decisions audited?

### 25.2 Code Checklist

- [ ] No complex policy directly in SpEL.
- [ ] No `hasRole('ADMIN')` as domain rule.
- [ ] No controller-only enforcement.
- [ ] No repository-only enforcement for command action.
- [ ] No client-provided role/tenant trust.
- [ ] No default allow for unknown action.
- [ ] No default allow for indeterminate decision.
- [ ] No boolean-only decision for sensitive action.
- [ ] No hidden IO inside tiny rule object without design.
- [ ] No N+1 decision path for list pages.

### 25.3 Testing Checklist

- [ ] Policy unit tests per action.
- [ ] Negative tests for missing permission.
- [ ] Negative tests for cross-tenant/org access.
- [ ] Negative tests for invalid state.
- [ ] Negative tests for separation of duty.
- [ ] Negative tests for unassigned actor.
- [ ] Integration tests that denied command does not mutate state.
- [ ] Search/list tests with pagination and count.
- [ ] Bulk tests with mixed allowed/denied items.
- [ ] Audit tests for sensitive allow and deny.

### 25.4 Operational Checklist

- [ ] Denial rate dashboard.
- [ ] Authorization latency metric.
- [ ] Policy decision error metric.
- [ ] Missing attribute metric.
- [ ] Unknown action metric.
- [ ] Cross-boundary denial alert threshold.
- [ ] Break-glass/override audit alert.
- [ ] Permission change audit.
- [ ] Role assignment review.

---

## 26. How To Think Like A Top 1% Engineer

### 26.1 Start From Invariant, Not Framework

Bad starting point:

```text
How do I write @PreAuthorize?
```

Better starting point:

```text
What must never happen in this domain?
```

Examples:

```text
A submitter must not approve their own case.
An officer must not access another agency's case unless delegated.
A closed case must not be approved.
A user must not export documents they cannot individually view.
A service account must not erase the original actor context.
```

Framework annotation is only implementation detail.

---

### 26.2 Separate Decision From Enforcement

Decision:

```java
PolicyDecision decision = policy.canApprove(...);
```

Enforcement:

```java
if (decision.denied()) throw new AccessDeniedException(...);
```

This enables:

1. UI action metadata;
2. audit;
3. simulation;
4. policy testing;
5. bulk decisions;
6. explainability.

---

### 26.3 Treat Authorization As A Domain Subsystem

Authorization is not helper code. It is a subsystem with:

1. model;
2. API;
3. policy lifecycle;
4. tests;
5. audit;
6. observability;
7. migration strategy;
8. operational failure semantics.

---

### 26.4 Design For Bypass Resistance

Ask:

```text
Can this action be invoked through another endpoint?
Can it be invoked by batch job?
Can it be invoked by message consumer?
Can it be invoked by internal API?
Can it be invoked by report/export?
Can it be invoked by admin screen?
Can query filtering be bypassed?
Can cache leak data?
```

If yes, controller annotation is not enough.

---

### 26.5 Design For Change

Authorization changes often because organization policy changes.

Expect:

1. new roles;
2. new actions;
3. new case state;
4. new escalation path;
5. new delegation rule;
6. new high-risk category;
7. new audit requirement;
8. new cross-agency exception.

A good design localizes change.

---

## 27. Mini Capstone: Case Approval Authorization Flow

### 27.1 Flow

```text
HTTP request
  ↓
Spring Security request authorization
  - authenticated
  - has coarse authority case.approve
  ↓
Controller
  ↓
Application service
  ↓
Load actor
  ↓
Load case aggregate
  ↓
Load authorization context
  ↓
Domain policy canApprove(actor, case, command, context)
  ↓
Decision object
  ↓
Audit decision
  ↓
If denied → AccessDeniedException
  ↓
Validate obligations
  ↓
Aggregate transition approve
  ↓
Persist
  ↓
Publish domain event
```

### 27.2 Key Invariants

```text
- actor must be active
- actor must have case.approve capability
- actor and case must be within allowed org boundary
- actor must be assigned reviewer or have supervisor override
- actor must not be original submitter
- case must be PENDING_APPROVAL
- case must not be locked
- high-risk case requires reason and elevated audit
```

### 27.3 Why This Is Stronger Than Annotation-Only

Because it protects:

1. HTTP endpoint;
2. service invocation;
3. object-specific action;
4. state transition;
5. separation of duty;
6. audit defensibility;
7. future non-HTTP callers.

---

## 28. Summary

Spring Security gives excellent authorization primitives, but domain authorization requires a stronger model than annotations alone.

The central ideas of this part:

1. Request-level authorization is not domain authorization.
2. Domain policy should speak in business actions.
3. Decision should be object, not boolean.
4. Policy service is the core pattern for maintainable domain authorization.
5. Authorizer is enforcement wrapper, not replacement for decision API.
6. `PermissionEvaluator` and `AuthorizationManager` are useful adapters.
7. Specification-style rules help when policy is complex.
8. Command authorization is better than CRUD authorization.
9. State and workflow are part of authorization context.
10. Query authorization is different from object authorization.
11. Bulk decision API prevents N+1 and UI policy drift.
12. Audit and explainability must be designed from the start.
13. Framework should serve the domain model, not define it.

---

## 29. References

1. Spring Security Reference — Authorization Architecture  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

2. Spring Security Reference — Method Security  
   https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html

3. Spring Security API — `AuthorizationManager`  
   https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authorization/AuthorizationManager.html

4. Spring Security API — `AclPermissionEvaluator`  
   https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/acls/AclPermissionEvaluator.html

5. OWASP Authorization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

6. OWASP Top 10 2021 — A01 Broken Access Control  
   https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/

7. OWASP API Security 2023 — Broken Object Level Authorization  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

---

## 30. Status Seri

Selesai:

- [x] Part 0 — Authorization Mental Model: From “Role Check” to Decision System
- [x] Part 1 — Authorization Vocabulary, Semantics, and Invariants
- [x] Part 2 — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
- [x] Part 3 — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
- [x] Part 4 — RBAC Done Properly: Role-Based Access Control Beyond `ADMIN`
- [x] Part 5 — Permission and Capability Modeling
- [x] Part 6 — ABAC: Attribute-Based Authorization
- [x] Part 7 — PBAC and Policy-as-Code
- [x] Part 8 — ReBAC: Relationship-Based Authorization
- [x] Part 9 — ACL and Domain Object Security
- [x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
- [x] Part 11 — IDOR, BOLA, and Object-Level Authorization
- [x] Part 12 — Authorization in Layered Java Applications
- [x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
- [x] Part 14 — Spring Method Security: Service-Level Authorization
- [x] Part 15 — Spring Domain Authorization Patterns

Berikutnya:

- [ ] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-014.md">⬅️ Part 14 — Spring Method Security: Service-Level Authorization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-016.md">Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization ➡️</a>
</div>

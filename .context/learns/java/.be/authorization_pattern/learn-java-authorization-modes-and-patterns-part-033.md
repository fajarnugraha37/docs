# learn-java-authorization-modes-and-patterns-part-033

# Part 33 — Authorization Migration and Refactoring Legacy Systems

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **33 dari 34/35 rencana besar**  
> Fokus: mengubah authorization legacy yang tersebar, hardcoded, tidak konsisten, dan sulit diaudit menjadi authorization model yang eksplisit, aman, bertahap, terukur, dan rollback-able.

---

## 0. Posisi Bagian Ini Dalam Seri

Bagian sebelumnya sudah membangun banyak fondasi:

- mental model authorization sebagai decision system,
- vocabulary subject/action/resource/context/policy/evidence,
- RBAC, ABAC, PBAC, ReBAC, ACL,
- Spring Security request/method/domain authorization,
- Jakarta authorization,
- distributed authorization,
- token boundary,
- caching,
- failure semantics,
- auditability,
- testing,
- anti-pattern,
- authorization domain model,
- internal authorization service,
- external policy engine integration.

Bagian ini menjawab pertanyaan yang paling realistis di production:

> “Sistem kita sudah berjalan bertahun-tahun. Authorization ada di controller, service, SQL, JSP/Vue UI, stored procedure, batch job, export, report, token claim, dan beberapa `if (isAdmin())`. Bagaimana memperbaikinya tanpa rewrite total dan tanpa membuat production outage?”

Jawaban top-level-nya:

> **Jangan migrasi authorization dengan big bang. Migrasikan lewat inventory, abstraction, shadow decision, dual-run, decision diff, gradual enforcement, rollback plan, audit continuity, dan regression protection.**

Authorization migration bukan sekadar refactoring teknis. Ini adalah **security-critical behavioral migration**. Artinya:

1. perilaku lama harus dipahami,
2. perilaku target harus didefinisikan,
3. perbedaan harus diukur,
4. enforcement baru harus dinyalakan bertahap,
5. semua keputusan harus bisa dijelaskan,
6. rollback harus tersedia,
7. test harus mengunci privilege boundary agar tidak regresi.

---

## 1. Why Authorization Migration Is Harder Than Normal Refactoring

Refactoring biasa sering punya target sederhana:

- kurangi duplikasi,
- pecah class besar,
- ganti library,
- pindahkan code ke module baru,
- buat interface lebih bersih.

Authorization refactoring punya tambahan risiko:

1. **False allow**: user yang seharusnya tidak boleh malah mendapat akses.
2. **False deny**: user yang seharusnya boleh malah terblokir.
3. **Silent leakage**: data bocor lewat search/export/report tanpa error jelas.
4. **Business disruption**: operasi harian berhenti karena permission terlalu ketat.
5. **Audit discontinuity**: historical decision tidak bisa dijelaskan karena policy berubah tanpa versioning.
6. **Inconsistent behavior**: endpoint A memakai model baru, endpoint B masih memakai model lama.
7. **Rollback ambiguity**: setelah migrasi sebagian, tidak jelas cara balik ke behavior lama.

Karena itu authorization migration harus diperlakukan sebagai kombinasi dari:

- security migration,
- domain refactoring,
- data migration,
- behavioral compatibility project,
- production rollout project,
- audit/governance project.

---

## 2. Legacy Authorization Smell Inventory

Sebelum migrasi, kita perlu mengenali bentuk authorization legacy.

### 2.1 Hardcoded Role Checks

Contoh:

```java
if (user.hasRole("ADMIN")) {
    approve(applicationId);
}
```

Masalah:

- role terlalu luas,
- action tidak eksplisit,
- resource tidak dicek,
- tenant/agency tidak dicek,
- state workflow tidak dicek,
- audit reason tidak ada.

Versi lebih berbahaya:

```java
if (currentUser.getRole().equals("ADMIN") || currentUser.getRole().equals("MANAGER")) {
    return repository.findAll();
}
```

Ini biasanya menghasilkan data-level leakage karena `findAll()` tidak scoped.

---

### 2.2 UI-Only Authorization

Contoh:

```javascript
if (currentUser.roles.includes('APPROVER')) {
  showApproveButton();
}
```

UI hiding berguna untuk UX, tetapi bukan enforcement. Jika backend tidak mengecek ulang, user bisa memanggil API langsung.

Legacy systems sering punya pola:

- tombol disembunyikan,
- menu disembunyikan,
- route frontend dijaga,
- tetapi API tetap terbuka.

Migration goal:

> UI authorization menjadi presentation hint, sedangkan backend authorization menjadi source of enforcement.

---

### 2.3 Controller-Only Authorization

Contoh:

```java
@PreAuthorize("hasRole('CASE_OFFICER')")
@PostMapping("/cases/{id}/submit")
public void submit(@PathVariable Long id) {
    caseService.submit(id);
}
```

Masalah:

- service bisa dipanggil dari batch/job/internal endpoint tanpa check,
- object-level authorization belum tentu ada,
- state transition guard belum tentu ada,
- test service-level tidak menangkap authorization.

Migration goal:

> controller-level check boleh tetap ada sebagai coarse gate, tetapi business authorization harus berada dekat operation/service/domain.

---

### 2.4 SQL-Embedded Authorization

Contoh:

```sql
select *
from cases c
where c.assigned_user_id = :currentUserId
```

Ini bisa benar, tetapi problem muncul ketika rule tersebar:

- query listing punya filter,
- detail endpoint tidak punya filter,
- export query lupa filter,
- report query punya filter berbeda,
- native SQL dan ORM berbeda behavior.

Migration goal:

> ubah query authorization menjadi reusable query scope/predicate, bukan copy-paste WHERE clause.

---

### 2.5 Token-Claim-Only Authorization

Contoh:

```java
if (jwt.getClaimAsStringList("roles").contains("agency-admin")) {
    allow();
}
```

Masalah:

- token stale,
- role terlalu coarse,
- role mungkin berasal dari IdP bukan domain system,
- tenant/resource/state tidak dicek,
- revocation delay tidak jelas,
- role name di token menjadi contract eksternal yang susah diubah.

Migration goal:

> token claim dipakai sebagai evidence awal, bukan policy penuh.

---

### 2.6 “Temporary Admin” Legacy

Contoh:

```java
if (user.getUsername().equals("john") || user.hasRole("ADMIN")) {
    allow();
}
```

Atau:

```java
if (featureFlag.isEnabled("support.override")) {
    allow();
}
```

Masalah:

- emergency workaround menjadi permanent,
- tidak ada expiry,
- tidak ada approval,
- tidak ada audit reason,
- privilege abuse sulit dideteksi.

Migration goal:

> semua privilege exception menjadi time-bound, approval-bound, reason-bound, and audit-bound.

---

### 2.7 Inconsistent Permission Names

Contoh:

```text
CASE_VIEW
VIEW_CASE
case.read
case:view
READ_CASE
CAN_SEE_CASE
```

Masalah:

- sulit search,
- sulit test,
- mapping kacau,
- role-permission matrix tidak bisa dipercaya,
- audit log tidak konsisten.

Migration goal:

> buat canonical permission/action naming dan compatibility mapping selama transisi.

---

### 2.8 Authorization Mixed With Business Validation

Contoh:

```java
if (case.status != SUBMITTED) {
    throw new AccessDeniedException("Not allowed");
}
```

Kadang ini authorization, kadang business validation. Bedanya penting:

- authorization: “subjek ini boleh melakukan aksi ini?”
- validation: “aksi ini valid terhadap state object?”

Dalam workflow system, keduanya sering bertemu. Tetapi audit dan error semantics berbeda.

Migration goal:

> pisahkan decision reason: `DENIED_NOT_ASSIGNED`, `DENIED_MISSING_PERMISSION`, `INVALID_STATE`, `BUSINESS_RULE_FAILED`.

---

## 3. Migration Principle: Preserve Behavior Before Improving Behavior

Kesalahan umum:

> langsung mengganti semua check lama dengan model baru yang “lebih benar”.

Ini berisiko karena sistem lama mungkin punya behavior aneh yang ternyata dipakai user untuk operasi harian.

Prinsip yang lebih aman:

1. **Observe existing behavior.**
2. **Model existing behavior.**
3. **Reproduce existing behavior in a compatibility policy.**
4. **Compare old vs new decisions.**
5. **Only then enforce corrected behavior gradually.**

Authorization migration punya dua mode target:

### 3.1 Compatibility Migration

Tujuan: membuat authorization lebih centralized/observable tanpa mengubah business behavior dulu.

Cocok untuk fase awal.

### 3.2 Correctness Migration

Tujuan: memperbaiki behavior authorization yang salah.

Cocok setelah:

- legacy behavior sudah dipahami,
- business owner menyetujui behavior target,
- regression tests tersedia,
- rollout dan rollback siap.

Top 1% engineer tidak mencampur dua mode ini tanpa sadar.

---

## 4. Migration Map

Peta besar migrasi authorization:

```text
[1] Inventory
        |
        v
[2] Classify checks and resources
        |
        v
[3] Define canonical authorization vocabulary
        |
        v
[4] Build authorization abstraction layer
        |
        v
[5] Implement compatibility policy
        |
        v
[6] Shadow decision mode
        |
        v
[7] Decision diff and triage
        |
        v
[8] Dual-run with selected enforcement
        |
        v
[9] Gradual endpoint/action/resource rollout
        |
        v
[10] Remove legacy checks carefully
        |
        v
[11] Lock with tests, audit, governance
```

---

## 5. Step 1 — Authorization Inventory

Inventory adalah proses menemukan semua tempat authorization terjadi.

Tujuannya bukan langsung memperbaiki, tetapi membuat peta.

### 5.1 Source Code Search Terms

Cari pattern seperti:

```text
hasRole
hasAuthority
isUserInRole
@RolesAllowed
@PreAuthorize
@PostAuthorize
@Secured
AccessDeniedException
Forbidden
403
Permission
Privilege
Role
Authority
SecurityContext
Principal
Authentication
getCurrentUser
currentUser
userRole
admin
superuser
tenantId
agencyId
assignedUserId
ownerId
createdBy
```

Untuk SQL/native queries:

```text
assigned_user_id
owner_id
created_by
tenant_id
agency_id
department_id
role_code
permission_code
where .* user
where .* role
```

Untuk frontend:

```text
roles.includes
permissions.includes
canView
canEdit
showApprove
isAdmin
v-if
router.beforeEach
```

Untuk config:

```text
security.*
roles.*
permissions.*
menu.*
feature-flags.*
```

---

### 5.2 Runtime Inventory

Static search tidak cukup. Tambahkan runtime instrumentation.

Contoh temporary wrapper:

```java
public final class LegacyAuthorizationProbe {

    public void record(
            String location,
            String subjectId,
            String action,
            String resourceType,
            String resourceId,
            boolean allowed,
            String legacyRule
    ) {
        // send to structured log / audit shadow table / telemetry
    }
}
```

Data yang dikumpulkan:

- endpoint/method,
- subject id,
- role/authority snapshot,
- tenant/agency,
- resource type/id,
- action inferred,
- allowed/denied,
- legacy rule location,
- request correlation id.

Runtime inventory membantu menjawab:

- check mana yang sering dipakai,
- role mana yang benar-benar aktif,
- endpoint mana yang tidak pernah dipanggil,
- denial mana yang terjadi di production,
- privilege path mana yang sensitif.

---

### 5.3 Inventory Output Format

Buat tabel seperti:

| Location | Layer | Legacy Check | Subject | Action | Resource | Context | Risk | Replacement Candidate |
|---|---:|---|---|---|---|---|---:|---|
| `CaseController.approve` | Controller | `hasRole(APPROVER)` | user | `case.approve` | case | tenant, state | High | `AuthorizationService.authorize` |
| `CaseRepository.findVisible` | Query | `assigned_user_id = ?` | user | `case.search` | case list | assignment | High | Query scope predicate |
| `ReportExportService.export` | Service | none | user | `report.export` | report | tenant | Critical | add service + query scope |
| Vue menu | UI | `roles.includes` | user | view menu | module | none | Medium | UX hint only |

Risk categories:

- **Critical**: export, download, approve, payment, enforcement decision, legal action, PII.
- **High**: object detail, update, assignment, report.
- **Medium**: listing, dashboard, metadata.
- **Low**: UI hint, read-only non-sensitive config.

---

## 6. Step 2 — Classify Authorization Checks

Every check should be classified by intent.

### 6.1 Coarse Route Gate

Example:

```java
GET /admin/** requires admin area access
```

This is useful but insufficient.

### 6.2 Function-Level Authorization

Example:

```text
User can approve cases.
```

This answers: can subject perform action type?

### 6.3 Object-Level Authorization

Example:

```text
User can approve this specific case.
```

This answers: can subject perform action on this resource instance?

### 6.4 Data-Level Authorization

Example:

```text
User can search only cases within assigned agency.
```

This affects query predicates.

### 6.5 Transition Authorization

Example:

```text
User can move case from SUBMITTED to APPROVED only if not maker.
```

This is state-machine authorization.

### 6.6 Delegation/Acting Authorization

Example:

```text
User can act on behalf of officer X between Monday and Friday.
```

This needs explicit authority chain.

### 6.7 Break-Glass Authorization

Example:

```text
Support admin may access case only under approved emergency session.
```

This requires approval, expiry, reason, and audit.

---

## 7. Step 3 — Define Canonical Vocabulary

Migration fails if old checks are moved into a new service without a canonical language.

Define:

```text
Subject        = who/what is acting
Action         = what operation is requested
Resource       = what object/type is targeted
Context        = tenant, channel, time, request, state, delegation, risk
Decision       = allow/deny/error + reason + obligations + evidence
Policy Version = which policy decided
```

### 7.1 Canonical Permission Grammar

Example:

```text
<domain>.<resource>.<action>
```

Examples:

```text
case.case.read
case.case.search
case.case.update
case.case.submit
case.case.approve
case.case.reassign
case.case.export
appeal.appeal.submit
appeal.appeal.review
report.compliance.export
admin.user.assignRole
```

But avoid over-nesting if domain/resource duplicate is unnecessary. A cleaner model:

```text
case.read
case.search
case.update
case.submit
case.approve
case.reassign
case.export
appeal.submit
appeal.review
report.exportCompliance
user.assignRole
```

The important part is consistency.

### 7.2 Legacy Mapping Table

During migration, create mapping:

| Legacy Role/Check | Canonical Action | Resource | Condition |
|---|---|---|---|
| `ROLE_CASE_ADMIN` | `case.read`, `case.update`, `case.reassign` | Case | within tenant |
| `ROLE_APPROVER` | `case.approve` | Case | assigned reviewer, not maker |
| `isAdmin()` | varies | varies | temporary compatibility only |
| `agency_id = currentAgency` | query scope | Case | tenant/agency boundary |

### 7.3 Never Let Legacy Names Become Target Names Accidentally

Bad:

```text
ROLE_SUPER_ADMIN_TEMP_2021
```

becomes:

```text
permission: super.admin.temp.2021
```

Better:

```text
legacy ROLE_SUPER_ADMIN_TEMP_2021 maps to:
- support.breakGlassAccess
- user.manageEmergencySession
- case.readUnderEmergency
```

---

## 8. Step 4 — Build an Authorization Abstraction Layer

This is where branch-by-abstraction thinking helps: create an abstraction that allows old and new implementations to coexist.

### 8.1 Java 8-Compatible Interface

```java
public interface AuthorizationService {

    AuthorizationDecision authorize(AuthorizationRequest request);

    default boolean can(AuthorizationRequest request) {
        return authorize(request).isAllowed();
    }
}
```

```java
public final class AuthorizationRequest {
    private final SubjectRef subject;
    private final ActionRef action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    public AuthorizationRequest(
            SubjectRef subject,
            ActionRef action,
            ResourceRef resource,
            AuthorizationContext context
    ) {
        this.subject = subject;
        this.action = action;
        this.resource = resource;
        this.context = context;
    }

    public SubjectRef getSubject() { return subject; }
    public ActionRef getAction() { return action; }
    public ResourceRef getResource() { return resource; }
    public AuthorizationContext getContext() { return context; }
}
```

```java
public final class AuthorizationDecision {
    private final boolean allowed;
    private final String reasonCode;
    private final String policyVersion;
    private final Map<String, Object> evidence;

    private AuthorizationDecision(
            boolean allowed,
            String reasonCode,
            String policyVersion,
            Map<String, Object> evidence
    ) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.policyVersion = policyVersion;
        this.evidence = evidence == null
                ? Collections.<String, Object>emptyMap()
                : Collections.unmodifiableMap(new LinkedHashMap<String, Object>(evidence));
    }

    public static AuthorizationDecision allow(String reasonCode, String policyVersion, Map<String, Object> evidence) {
        return new AuthorizationDecision(true, reasonCode, policyVersion, evidence);
    }

    public static AuthorizationDecision deny(String reasonCode, String policyVersion, Map<String, Object> evidence) {
        return new AuthorizationDecision(false, reasonCode, policyVersion, evidence);
    }

    public boolean isAllowed() { return allowed; }
    public String getReasonCode() { return reasonCode; }
    public String getPolicyVersion() { return policyVersion; }
    public Map<String, Object> getEvidence() { return evidence; }
}
```

### 8.2 Java 17+ Variant

```java
public record AuthorizationRequest(
        SubjectRef subject,
        ActionRef action,
        ResourceRef resource,
        AuthorizationContext context
) {}

public sealed interface AuthorizationDecision permits AllowDecision, DenyDecision, ErrorDecision {
    String reasonCode();
    String policyVersion();
    Map<String, Object> evidence();
}

public record AllowDecision(
        String reasonCode,
        String policyVersion,
        Map<String, Object> evidence
) implements AuthorizationDecision {}

public record DenyDecision(
        String reasonCode,
        String policyVersion,
        Map<String, Object> evidence
) implements AuthorizationDecision {}

public record ErrorDecision(
        String reasonCode,
        String policyVersion,
        Map<String, Object> evidence,
        Throwable cause
) implements AuthorizationDecision {}
```

For migration compatibility, Java 8 design is safer as baseline. Java 17+ variant can be used in new modules if the platform allows it.

---

## 9. Step 5 — Implement Compatibility Policy

Compatibility policy reproduces legacy behavior intentionally.

Example:

```java
public final class LegacyCompatibilityAuthorizationService implements AuthorizationService {

    private final LegacyRoleService legacyRoleService;
    private final CaseRepository caseRepository;

    public LegacyCompatibilityAuthorizationService(
            LegacyRoleService legacyRoleService,
            CaseRepository caseRepository
    ) {
        this.legacyRoleService = legacyRoleService;
        this.caseRepository = caseRepository;
    }

    @Override
    public AuthorizationDecision authorize(AuthorizationRequest request) {
        String action = request.getAction().getValue();

        if ("case.approve".equals(action)) {
            return authorizeCaseApprove(request);
        }

        return AuthorizationDecision.deny(
                "NO_COMPATIBILITY_RULE",
                "legacy-compat-001",
                evidence("action", action)
        );
    }

    private AuthorizationDecision authorizeCaseApprove(AuthorizationRequest request) {
        String userId = request.getSubject().getSubjectId();
        boolean hasLegacyApproverRole = legacyRoleService.hasRole(userId, "ROLE_APPROVER");

        if (!hasLegacyApproverRole) {
            return AuthorizationDecision.deny(
                    "LEGACY_MISSING_ROLE_APPROVER",
                    "legacy-compat-001",
                    evidence("legacyRole", "ROLE_APPROVER")
            );
        }

        // Legacy behavior may only check role.
        return AuthorizationDecision.allow(
                "LEGACY_ROLE_APPROVER_ALLOWED",
                "legacy-compat-001",
                evidence("legacyRole", "ROLE_APPROVER")
        );
    }

    private static Map<String, Object> evidence(String key, Object value) {
        Map<String, Object> map = new LinkedHashMap<String, Object>();
        map.put(key, value);
        return map;
    }
}
```

This may feel wrong because it preserves flawed legacy behavior. But that is the point: first make behavior observable and centralized, then correct it with controlled rollout.

---

## 10. Step 6 — Shadow Decision Mode

Shadow mode means:

- legacy check still controls production behavior,
- new authorization service also makes a decision,
- decision is logged but not enforced,
- differences are analyzed.

### 10.1 Shadow Wrapper

```java
public final class ShadowAuthorizationService {

    private final AuthorizationService legacyService;
    private final AuthorizationService targetService;
    private final DecisionDiffLogger diffLogger;

    public ShadowAuthorizationService(
            AuthorizationService legacyService,
            AuthorizationService targetService,
            DecisionDiffLogger diffLogger
    ) {
        this.legacyService = legacyService;
        this.targetService = targetService;
        this.diffLogger = diffLogger;
    }

    public AuthorizationDecision authorizeUsingLegacyButShadowTarget(AuthorizationRequest request) {
        AuthorizationDecision legacyDecision = legacyService.authorize(request);
        AuthorizationDecision targetDecision;

        try {
            targetDecision = targetService.authorize(request);
        } catch (RuntimeException ex) {
            targetDecision = AuthorizationDecision.deny(
                    "TARGET_POLICY_ERROR",
                    "target-error",
                    Collections.<String, Object>singletonMap("error", ex.getClass().getName())
            );
        }

        if (legacyDecision.isAllowed() != targetDecision.isAllowed()) {
            diffLogger.logDifference(request, legacyDecision, targetDecision);
        }

        return legacyDecision;
    }
}
```

### 10.2 What to Log in Shadow Mode

Log enough to debug, not enough to leak secrets.

Recommended fields:

```json
{
  "eventType": "AUTHZ_SHADOW_DIFF",
  "correlationId": "...",
  "subjectIdHash": "...",
  "action": "case.approve",
  "resourceType": "CASE",
  "resourceIdHash": "...",
  "tenantId": "agency-a",
  "legacyDecision": "ALLOW",
  "legacyReason": "LEGACY_ROLE_APPROVER_ALLOWED",
  "legacyPolicyVersion": "legacy-compat-001",
  "targetDecision": "DENY",
  "targetReason": "DENIED_NOT_ASSIGNED_REVIEWER",
  "targetPolicyVersion": "case-policy-2026-06-20",
  "environment": "uat"
}
```

Avoid logging:

- raw PII,
- full token,
- full request body,
- sensitive case details,
- password/session data,
- private document content.

---

## 11. Step 7 — Decision Diff Triage

A decision diff is not automatically a bug. It is a signal.

### 11.1 Diff Types

| Legacy | Target | Meaning | Risk |
|---|---|---|---|
| Allow | Allow | compatible | low |
| Deny | Deny | compatible | low |
| Allow | Deny | target stricter | business disruption risk |
| Deny | Allow | target looser | security risk |
| Error | Allow/Deny | legacy unstable | investigate |
| Allow/Deny | Error | target unstable | cannot enforce |

### 11.2 Triage Questions

For each diff:

1. Is legacy behavior correct?
2. Is target behavior correct?
3. Is target missing legacy exception?
4. Is legacy allowing something dangerous?
5. Is target missing attribute/resource data?
6. Is there a stale role/permission mapping?
7. Is the request context incomplete?
8. Is policy too strict or too broad?
9. Does business owner agree with target?
10. Should rollout be blocked?

### 11.3 Diff Classification

```text
DIFF_EXPECTED_CORRECTION
DIFF_LEGACY_BUG
DIFF_TARGET_BUG
DIFF_MAPPING_GAP
DIFF_CONTEXT_MISSING
DIFF_DATA_QUALITY_ISSUE
DIFF_BUSINESS_RULE_UNCLEAR
DIFF_NEEDS_OWNER_APPROVAL
```

### 11.4 Decision Diff Dashboard

Useful metrics:

- diff rate by action,
- diff rate by endpoint,
- diff rate by role,
- diff rate by tenant/agency,
- false allow candidates,
- false deny candidates,
- top denial reasons,
- target policy error rate,
- missing attribute rate.

---

## 12. Step 8 — Dual-Run Authorization

Dual-run means both old and new systems participate more actively.

There are several modes.

### 12.1 Log-Only Shadow

```text
Production decision = legacy
Target decision = log only
```

Safest early mode.

### 12.2 Alert-Only Shadow

```text
Production decision = legacy
Target deny on sensitive action = alert security/operator
```

Good for detecting dangerous legacy allows.

### 12.3 Soft Enforcement

```text
Production decision = legacy
Target deny = warning banner / review queue / extra confirmation
```

Useful where business disruption must be minimized.

### 12.4 Strict Enforcement for Low-Risk Actions

```text
Production decision = target for selected actions
Legacy decision = log fallback comparison
```

Start with low-risk actions:

- non-sensitive read,
- UI menu access,
- low-impact update,
- internal admin page not heavily used.

Do not start with:

- legal approval,
- payment,
- enforcement decision,
- mass export,
- role administration,
- break-glass access.

### 12.5 Deny-Override Migration Mode

```text
allow only if legacy allows AND target allows
```

This reduces false allow but increases false deny.

Good for security-critical resources after diff rate is low.

### 12.6 Permit-Override Migration Mode

```text
allow if legacy allows OR target allows
```

This reduces false deny but increases false allow.

Usually dangerous for security. Use only for carefully scoped transitional compatibility, never for sensitive data/actions.

---

## 13. Step 9 — Gradual Enforcement Strategy

Rollout should be sliced by risk and domain.

### 13.1 Slice by Action

Example order:

1. `case.search`
2. `case.read`
3. `case.updateDraft`
4. `case.submit`
5. `case.reassign`
6. `case.approve`
7. `case.export`
8. `user.assignRole`
9. `support.breakGlassAccess`

### 13.2 Slice by Resource Type

Example:

1. non-sensitive configuration,
2. user profile view,
3. case metadata,
4. case detail,
5. case document,
6. enforcement decision,
7. audit log,
8. role management.

### 13.3 Slice by Tenant/Agency

Useful in multi-tenant systems:

- start with internal test tenant,
- then pilot agency,
- then low-volume agency,
- then all agencies.

### 13.4 Slice by Channel

Example:

1. backend internal API,
2. admin UI,
3. public/internet user flow,
4. batch/export,
5. integrations.

### 13.5 Slice by User Group

Example:

1. developers/testers,
2. internal support,
3. pilot business users,
4. all users.

### 13.6 Feature Flag Matrix

Example:

| Flag | Scope | Default | Rollback |
|---|---|---:|---|
| `authz.case.read.target.enforce` | action | false | off |
| `authz.case.approve.target.enforce` | action | false | off |
| `authz.report.export.target.enforce` | action | false | off |
| `authz.shadow.log.enabled` | global | true | off if noisy |
| `authz.diff.alert.enabled` | critical only | true | off if incident |

Feature flags must be:

- auditable,
- environment-specific,
- change-controlled for sensitive actions,
- visible in decision logs.

---

## 14. Step 10 — Removing Legacy Checks

Do not remove old checks just because the target policy is enabled.

Remove only when:

1. target enforcement has run for enough time,
2. diff rate is near zero or accepted,
3. business owner signed off,
4. regression tests exist,
5. audit logs show stable behavior,
6. rollback path is known,
7. no alternate path still depends on legacy check.

### 14.1 Legacy Check Removal Checklist

For each legacy check:

```text
[ ] Mapped to canonical action/resource/context
[ ] Covered by AuthorizationService
[ ] Covered by tests
[ ] Covered by shadow/diff data
[ ] Enforcement enabled in target path
[ ] No alternate caller bypass
[ ] Query/data-level equivalent exists if needed
[ ] Audit reason exists
[ ] Rollback strategy exists
[ ] Code owner approval obtained
```

### 14.2 Replace Inline Check With Named Policy Call

Before:

```java
if (!user.hasRole("APPROVER")) {
    throw new AccessDeniedException("Forbidden");
}
```

After:

```java
authorizationGuard.require(
        AuthorizationRequests.caseApprove(currentUser, caseId, requestContext)
);
```

The guard should throw consistent exception and publish decision audit.

```java
public final class AuthorizationGuard {

    private final AuthorizationService authorizationService;
    private final AuthorizationAuditPublisher auditPublisher;

    public AuthorizationGuard(
            AuthorizationService authorizationService,
            AuthorizationAuditPublisher auditPublisher
    ) {
        this.authorizationService = authorizationService;
        this.auditPublisher = auditPublisher;
    }

    public void require(AuthorizationRequest request) {
        AuthorizationDecision decision = authorizationService.authorize(request);
        auditPublisher.publish(request, decision);

        if (!decision.isAllowed()) {
            throw new AccessDeniedException(decision.getReasonCode());
        }
    }
}
```

---

## 15. Migrating Hardcoded Roles to Permission Model

### 15.1 Legacy

```java
if (user.hasRole("CASE_MANAGER")) {
    caseService.reassign(caseId, newOfficerId);
}
```

### 15.2 Transitional Mapping

```text
ROLE_CASE_MANAGER -> case.reassign
ROLE_CASE_MANAGER -> case.read
ROLE_CASE_MANAGER -> case.search
```

### 15.3 Target Policy

```text
allow case.reassign when:
- subject has permission case.reassign within tenant
- subject belongs to same agency as case
- case state is not CLOSED
- new officer belongs to same agency
- subject is not reassigning to invalid queue
```

### 15.4 Java Policy

```java
public final class CaseReassignPolicy implements AuthorizationPolicy {

    private final PermissionResolver permissionResolver;
    private final CaseAttributeRepository caseAttributeRepository;
    private final OfficerRepository officerRepository;

    @Override
    public AuthorizationDecision decide(AuthorizationRequest request) {
        String subjectId = request.getSubject().getSubjectId();
        String caseId = request.getResource().getResourceId();

        CaseAuthzAttributes c = caseAttributeRepository.getCaseAttributes(caseId);

        if (!permissionResolver.hasPermission(subjectId, "case.reassign", c.getTenantId())) {
            return deny("DENIED_MISSING_PERMISSION");
        }

        if (!sameTenant(request, c)) {
            return deny("DENIED_TENANT_MISMATCH");
        }

        if ("CLOSED".equals(c.getState())) {
            return deny("DENIED_CLOSED_CASE");
        }

        String newOfficerId = request.getContext().getString("newOfficerId");
        if (!officerRepository.belongsToTenant(newOfficerId, c.getTenantId())) {
            return deny("DENIED_INVALID_TARGET_OFFICER_TENANT");
        }

        return allow("ALLOWED_CASE_REASSIGN");
    }

    private boolean sameTenant(AuthorizationRequest request, CaseAuthzAttributes c) {
        return c.getTenantId().equals(request.getContext().getString("tenantId"));
    }

    private AuthorizationDecision deny(String reason) {
        return AuthorizationDecision.deny(reason, "case-policy-001", Collections.<String, Object>emptyMap());
    }

    private AuthorizationDecision allow(String reason) {
        return AuthorizationDecision.allow(reason, "case-policy-001", Collections.<String, Object>emptyMap());
    }
}
```

---

## 16. Migrating ACL Systems

ACL migrations are delicate because they often contain object-specific exceptions.

### 16.1 ACL Inventory

Collect:

- object type,
- object id,
- owner,
- ACE subject,
- ACE permission mask,
- inherited entries,
- granting flag,
- audit success/failure flag,
- stale entries,
- orphan subject references,
- orphan object references.

### 16.2 ACL Migration Options

#### Option A — Keep ACL, Wrap It

Keep existing ACL table, expose through new `AuthorizationService`.

Good when:

- ACL data is large,
- behavior must be preserved,
- migration risk is high.

#### Option B — Convert ACL to Relationship Tuples

Example:

```text
case:123#viewer@user:456
case:123#editor@group:case-team-a
case:123#owner@user:789
```

Good when:

- relationships are natural,
- hierarchy matters,
- access is graph-like.

#### Option C — Convert ACL to Policy Exceptions

Example:

```text
allow user:456 case.read case:123 because manual exception until 2026-12-31
```

Good for small number of exceptions.

#### Option D — Retire ACL Into ABAC/RBAC

Good when ACL was used as workaround for missing role/attribute model.

### 16.3 ACL Migration Pitfall

Do not flatten ACL into global permissions.

Bad:

```text
because user can read case:123, give user case.read globally
```

This causes privilege expansion.

Correct:

```text
user has relation viewer on case:123
or user has exception case.read on case:123
```

---

## 17. Migrating Data-Level Authorization

Data-level migration is often the most dangerous because list/search/report/export can leak many records at once.

### 17.1 Identify All Data Surfaces

- detail endpoint,
- list endpoint,
- search endpoint,
- dashboard count,
- report,
- export CSV/Excel/PDF,
- file download,
- async generated report,
- notification payload,
- search index,
- cache,
- data warehouse feed,
- audit viewer.

### 17.2 Replace Ad-Hoc Query Filters With Query Scope

Define:

```java
public interface AuthorizationQueryScope<T> {
    Specification<T> toSpecification(SubjectRef subject, ActionRef action, AuthorizationContext context);
}
```

Example Spring Data JPA:

```java
public final class CaseAuthorizationScope {

    public Specification<CaseEntity> visibleCases(SubjectRef subject, AuthorizationContext context) {
        return new Specification<CaseEntity>() {
            @Override
            public Predicate toPredicate(Root<CaseEntity> root, CriteriaQuery<?> query, CriteriaBuilder cb) {
                String tenantId = context.getString("tenantId");
                String subjectId = subject.getSubjectId();

                Predicate sameTenant = cb.equal(root.get("tenantId"), tenantId);
                Predicate assignedToMe = cb.equal(root.get("assignedUserId"), subjectId);
                Predicate createdByMe = cb.equal(root.get("createdBy"), subjectId);

                return cb.and(sameTenant, cb.or(assignedToMe, createdByMe));
            }
        };
    }
}
```

Use the same scope for:

- list,
- search,
- count,
- export,
- report,
- dashboard.

### 17.3 Migration Test for Query Scoping

For each data surface:

```text
Given user A in tenant T1
And records exist in T1 and T2
And records exist assigned/unassigned to user A
When user A searches/exports/reports
Then only authorized records appear
And count matches authorized records only
And no unauthorized IDs appear in response, metadata, link, or file
```

---

## 18. Migrating Method Security Annotations

Legacy Spring systems often have annotation sprawl.

Example:

```java
@PreAuthorize("hasRole('ADMIN') or hasRole('MANAGER')")
public CaseDto updateCase(Long id, UpdateCaseRequest request) { ... }
```

Target:

```java
@PreAuthorize("@authz.can(authentication, 'case.update', #id)")
public CaseDto updateCase(Long id, UpdateCaseRequest request) { ... }
```

Better long-term:

```java
public CaseDto updateCase(Long id, UpdateCaseRequest request) {
    authorizationGuard.require(CaseAuthorizationRequests.update(authenticationFacade.currentSubject(), id));
    ...
}
```

### 18.1 Migration Strategy

1. Keep annotation as coarse gate.
2. Add explicit domain authorization inside service.
3. Run shadow/diff.
4. Replace annotation expression with simple authenticated/role gate if needed.
5. Move complex logic out of SpEL.

### 18.2 Why Move Complex Logic Out of SpEL?

SpEL is useful but can become:

- hard to refactor,
- hard to test,
- hard to debug,
- stringly typed,
- dependent on parameter names,
- scattered across services.

Complex authorization belongs in named Java policy/service code or external policy.

---

## 19. Migrating from `hasRole` to `hasAuthority`/Permission

In Spring Security, role checks often add a `ROLE_` convention. During migration, be explicit.

Legacy:

```java
hasRole('ADMIN')
```

Equivalent authority check often means:

```java
hasAuthority('ROLE_ADMIN')
```

Target permission:

```java
hasAuthority('case.approve')
```

But do not blindly put every permission into `GrantedAuthority` if permissions are resource-scoped or context-sensitive. `GrantedAuthority` is best for coarse/static authority.

Bad:

```text
GrantedAuthority = case:123:approve
GrantedAuthority = case:124:approve
GrantedAuthority = case:125:approve
...
```

This causes token/session bloat and stale permissions.

Better:

```text
GrantedAuthority = case.approve.base
then object/context check in AuthorizationService
```

Or:

```text
GrantedAuthority = ROLE_CASE_REVIEWER
AuthorizationService checks assignment/state/tenant.
```

---

## 20. Migrating Admin/Superuser Access

Admin access is often the most overpowered part of legacy systems.

### 20.1 Split Admin Capabilities

Instead of:

```text
ADMIN
```

Split into:

```text
user.read
user.create
user.disable
user.assignRole
role.read
role.modify
permission.read
case.readAllWithinTenant
case.reassign
report.export
system.config.read
system.config.update
support.impersonate
support.breakGlassAccess
```

### 20.2 Add Scope

```text
role = AGENCY_ADMIN, scope = agency:CEA
role = SYSTEM_CONFIG_ADMIN, scope = environment:UAT
role = SUPPORT_OPERATOR, scope = ticket:INC12345, expiresAt = ...
```

### 20.3 Admin Migration Checklist

```text
[ ] Identify all admin-only endpoints
[ ] Split by actual capability
[ ] Identify tenant/global scope
[ ] Remove read-all unless explicitly needed
[ ] Require approval for sensitive admin action
[ ] Add audit reason for role assignment and break-glass
[ ] Add tests for least privilege
```

---

## 21. Migrating Reports and Exports

Reports and exports are frequent authorization bypasses.

### 21.1 Why They Are Dangerous

An endpoint that returns one unauthorized case is bad. An export that returns 50,000 unauthorized records is catastrophic.

### 21.2 Migration Rules

1. Report must use same data scope as UI listing unless explicitly approved.
2. Export must be separately authorized from view.
3. Aggregation must not leak unauthorized counts.
4. Generated files must be access-controlled at download time.
5. Async report job must capture subject/context snapshot.
6. Report audit must include filter and scope version.

### 21.3 Async Export Pattern

```text
User requests export
    -> authorize report.export
    -> capture subject/context/policy version
    -> create export job with authz snapshot
    -> worker generates using query scope
    -> file stored with owner/scope metadata
    -> download endpoint re-authorizes download
```

Never assume that because user was allowed to request export at time T, they can download file at time T+7 days. Decide your policy explicitly.

Options:

- allow download based on captured authorization,
- require re-authorization at download,
- expire file quickly,
- require both captured and current authorization.

For sensitive systems, prefer expiry + re-authorization.

---

## 22. Migrating Batch Jobs and System Actors

Legacy batch often bypasses user authorization.

### 22.1 Distinguish Actor Types

```text
Human user
Service account
Batch job
Scheduler
Integration partner
Support operator
Migration script
```

### 22.2 Service Account Authorization

A service account should have explicit capabilities:

```text
batch.case.autoClose
batch.notification.sendReminder
integration.payment.readStatus
migration.case.backfill
```

Not:

```text
SYSTEM_ADMIN
```

### 22.3 Batch Authorization Context

Batch jobs need context too:

```json
{
  "actorType": "BATCH_JOB",
  "jobName": "case-auto-close",
  "runId": "...",
  "trigger": "SCHEDULED",
  "environment": "PROD",
  "tenantScope": "ALL_OR_SPECIFIC",
  "changeTicket": "CHG-123"
}
```

### 22.4 Migration Rule

If batch modifies domain state, it needs authorization model, even if not a human flow.

---

## 23. Migrating Stored Procedures and Database Logic

Some legacy authorization lives in stored procedures.

### 23.1 Inventory DB Authorization

Search for:

- user id parameters,
- role tables,
- permission tables,
- tenant filters,
- `created_by`, `assigned_to`, `agency_id`,
- `raise_application_error` with forbidden-like messages,
- grants and views,
- row-level security policies.

### 23.2 Migration Options

#### Option A — Keep DB Enforcement as Defense-in-Depth

Useful for tenant boundary.

#### Option B — Move Business Authorization to Java

Useful when policy needs application context.

#### Option C — Hybrid

Common target:

- Java decides action/resource/context,
- DB enforces tenant/data boundary,
- stored procedure validates data integrity.

### 23.3 Warning

Do not remove DB guard until application guard is proven. Database-level constraints often accidentally protected old systems from app bugs.

---

## 24. Data Migration for Authorization

Authorization migration often requires data changes.

### 24.1 Data Objects to Migrate

- role table,
- permission table,
- role-permission mapping,
- user-role mapping,
- group membership,
- tenant membership,
- delegation records,
- ACL entries,
- policy versions,
- admin exceptions,
- break-glass sessions,
- audit reason codes.

### 24.2 Migration Script Requirements

Every migration script should be:

- idempotent,
- reversible if practical,
- environment-aware,
- audited,
- tested on production-like data,
- validated with before/after counts,
- checked for orphan records,
- reviewed by security/domain owner.

### 24.3 Example Validation Queries

```sql
-- Orphan user-role assignments
select ur.*
from user_role ur
left join users u on u.id = ur.user_id
where u.id is null;

-- Permissions assigned to no role
select p.*
from permission p
left join role_permission rp on rp.permission_id = p.id
where rp.permission_id is null;

-- Roles with broad dangerous permissions
select r.code, p.code
from role r
join role_permission rp on rp.role_id = r.id
join permission p on p.id = rp.permission_id
where p.code in ('user.assignRole', 'report.exportAll', 'support.breakGlassAccess');
```

### 24.4 Data Backfill Strategy

Use stages:

1. create new tables nullable/inactive,
2. backfill from legacy,
3. validate counts,
4. run shadow reads,
5. run dual writes if needed,
6. switch reads,
7. freeze legacy writes,
8. clean up later.

---

## 25. Permission Matrix From Existing Behavior

Many teams do not have a permission matrix. You may need to derive it.

### 25.1 Sources

- existing code checks,
- route config,
- UI menu config,
- role tables,
- production audit logs,
- business SOP,
- user stories,
- support tickets,
- incident history,
- test cases,
- interviews with business users.

### 25.2 Matrix Format

| Role/Subject Type | Scope | Action | Resource | Conditions | Legacy Source | Target Policy | Owner |
|---|---|---|---|---|---|---|---|
| Case Officer | agency | `case.read` | Case | assigned or team case | service check | ABAC/ReBAC | Case owner |
| Reviewer | agency | `case.approve` | Case | not maker, assigned reviewer, submitted | controller role | workflow guard | Case owner |
| Admin | tenant | `user.assignRole` | User | cannot assign higher privilege | admin UI | permission + SoD | IAM owner |

### 25.3 Matrix Anti-Pattern

Do not create matrix only by role vs endpoint.

Bad:

| Role | Endpoint |
|---|---|
| Admin | `/cases/**` |

Better:

| Subject | Action | Resource | Condition | Data Scope | Audit |
|---|---|---|---|---|---|
| Reviewer | `case.approve` | Case | assigned reviewer and not maker | same tenant | decision log |

---

## 26. Shadow Decision Data Model

For serious migration, store decision diff data in a structured table or event stream.

### 26.1 Table Example

```sql
create table authz_shadow_decision_log (
    id                  bigint generated always as identity primary key,
    occurred_at          timestamp not null,
    correlation_id       varchar(100),
    subject_hash         varchar(128) not null,
    subject_type         varchar(50) not null,
    action_code          varchar(200) not null,
    resource_type        varchar(100) not null,
    resource_hash        varchar(128),
    tenant_id            varchar(100),
    legacy_decision      varchar(20) not null,
    legacy_reason        varchar(200),
    legacy_policy_version varchar(100),
    target_decision      varchar(20) not null,
    target_reason        varchar(200),
    target_policy_version varchar(100),
    diff_type            varchar(100),
    endpoint             varchar(300),
    service_method       varchar(300),
    environment          varchar(50) not null
);
```

### 26.2 Diff Rate Query

```sql
select action_code,
       count(*) as total,
       sum(case when legacy_decision <> target_decision then 1 else 0 end) as diffs,
       round(100.0 * sum(case when legacy_decision <> target_decision then 1 else 0 end) / count(*), 2) as diff_pct
from authz_shadow_decision_log
where occurred_at >= current_timestamp - interval '7 days'
group by action_code
order by diff_pct desc;
```

---

## 27. Rollback Strategy

Authorization migration without rollback is reckless.

### 27.1 Rollback Levels

#### Level 1 — Disable Enforcement Flag

Target policy stops enforcing, shadow continues.

#### Level 2 — Disable Target Policy for Action

Specific action falls back to legacy.

#### Level 3 — Disable New Authorization Service Path

All target checks disabled.

#### Level 4 — Roll Back Data Mapping

Dangerous. Use only if data migration caused issue.

#### Level 5 — Roll Back Deployment

Application rollback.

### 27.2 Rollback Decision Table

| Symptom | Immediate Action | Longer Fix |
|---|---|---|
| sudden spike in false deny | disable action enforcement | fix policy/mapping |
| target PDP unavailable | fail closed for sensitive, fallback for low-risk if approved | improve resiliency |
| export leakage found | disable export | patch query scope and investigate |
| admin cannot assign role | temporary controlled break-glass | fix admin policy |
| diff logging too noisy | reduce sampling | tune log structure |

### 27.3 Rollback Must Be Audited

Changing authorization flag is itself security-sensitive.

Audit:

- who changed flag,
- when,
- why,
- ticket/change reference,
- before/after value,
- impacted action/resource,
- approval.

---

## 28. Audit Continuity During Migration

If legacy logs say:

```text
user X accessed case 123
```

and new logs say:

```text
subject hash abc action case.read resource hash def decision ALLOW policy case-policy-002
```

you need a bridge.

### 28.1 Audit Mapping

During migration, keep mapping:

```text
legacy event type -> new event type
legacy role -> canonical permission/action
legacy resource id -> new resource ref
legacy denial message -> new reason code
legacy module -> new domain/resource type
```

### 28.2 Policy Versioning

Every decision log should include:

- authorization service version,
- policy version,
- rule version if applicable,
- data mapping version,
- feature flag state.

Example:

```json
{
  "decision": "DENY",
  "reasonCode": "DENIED_NOT_ASSIGNED_REVIEWER",
  "policyVersion": "case-policy-2026-06-20.3",
  "mappingVersion": "legacy-role-map-005",
  "featureFlags": {
    "authz.case.approve.target.enforce": true
  }
}
```

---

## 29. Governance and Ownership

Authorization migration cannot be owned only by developers.

Required owners:

- engineering owner,
- security owner,
- business/domain owner,
- QA owner,
- operations owner,
- audit/compliance owner if regulated.

### 29.1 Policy Change Workflow

```text
Policy proposal
    -> technical review
    -> security review
    -> business review
    -> test matrix update
    -> shadow mode
    -> diff review
    -> staged enforcement
    -> post-release review
```

### 29.2 Authorization ADR Template

```md
# ADR: Migrate Case Approval Authorization to Policy Service

## Status
Proposed / Accepted / Deprecated

## Context
Current case approval uses ROLE_APPROVER at controller level only.
It does not enforce assignment, maker-checker, or case state.

## Decision
Use AuthorizationService for `case.approve`.
Policy requires:
- permission `case.approve`
- same tenant
- case state SUBMITTED
- assigned reviewer
- reviewer is not maker

## Migration Plan
- shadow mode for 2 weeks
- diff review with business owner
- enforce for pilot agency
- enforce globally

## Rollback
Disable `authz.case.approve.target.enforce`.

## Audit
Decision logs include policy version and reason code.

## Consequences
False denies possible if assignment data is wrong.
```

---

## 30. Testing Strategy for Migration

Migration testing differs from greenfield testing.

### 30.1 Characterization Tests

Characterization tests capture existing behavior.

Example:

```java
@Test
public void legacyApproverCanApproveAnyCase() {
    // This may be insecure, but documents legacy behavior.
}
```

Do not confuse characterization tests with target correctness tests. Name them clearly.

### 30.2 Target Policy Tests

```java
@Test
public void reviewerCannotApproveOwnSubmission() {
    // target intended behavior
}
```

### 30.3 Diff Tests

Test expected difference:

```java
@Test
public void targetDeniesLegacyAllowWhenReviewerIsMaker() {
    AuthorizationDecision legacy = legacyService.authorize(request);
    AuthorizationDecision target = targetService.authorize(request);

    assertTrue(legacy.isAllowed());
    assertFalse(target.isAllowed());
    assertEquals("DENIED_REVIEWER_IS_MAKER", target.getReasonCode());
}
```

### 30.4 Query Scope Regression Tests

For each resource listing/export:

```text
user from tenant A must never see tenant B record
user not assigned must never see restricted case
admin scoped to agency A must not see agency B
export count must equal authorized search count
```

### 30.5 Mutation Tests for Missing Guards

Mutation idea:

- remove guard,
- invert decision,
- remove tenant predicate,
- remove assignment predicate,
- remove state predicate,
- change AND to OR.

A good test suite should fail.

---

## 31. Example End-to-End Migration: Case Approval

### 31.1 Legacy State

```java
@PreAuthorize("hasRole('APPROVER')")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable Long id) {
    caseService.approve(id);
}
```

Problems:

- no same tenant check,
- no assignment check,
- no maker-checker check,
- no case state check,
- no policy version,
- no reason code,
- service callable elsewhere.

### 31.2 Target Rule

```text
Allow case.approve if:
- subject has permission case.approve in tenant
- case belongs to same tenant
- case state is SUBMITTED
- subject is assigned reviewer
- subject is not maker/submitter
- subject is not in suspended status
```

### 31.3 Migration Phase 1 — Add Service Guard in Shadow Mode

```java
public void approve(Long caseId) {
    AuthorizationRequest request = CaseAuthorizationRequests.approve(currentSubject(), caseId, currentContext());

    shadowAuthorizationService.authorizeUsingLegacyButShadowTarget(request);

    // legacy behavior still effectively controls via @PreAuthorize
    doApprove(caseId);
}
```

### 31.4 Migration Phase 2 — Deny-Override for Pilot

```java
public void approve(Long caseId) {
    AuthorizationRequest request = CaseAuthorizationRequests.approve(currentSubject(), caseId, currentContext());

    if (featureFlags.isEnabled("authz.case.approve.target.enforce")) {
        authorizationGuard.require(request);
    }

    doApprove(caseId);
}
```

Keep `@PreAuthorize` temporarily as coarse role gate.

### 31.5 Migration Phase 3 — Simplify Annotation

```java
@PreAuthorize("isAuthenticated()")
@PostMapping("/cases/{id}/approve")
public void approve(@PathVariable Long id) {
    caseService.approve(id);
}
```

Or retain coarse permission:

```java
@PreAuthorize("hasAuthority('case.approve.base')")
```

But the real decision remains in service policy.

### 31.6 Migration Phase 4 — Lock With Tests and Audit

Tests:

- missing role denied,
- wrong tenant denied,
- not assigned denied,
- maker denied,
- wrong state denied,
- valid reviewer allowed,
- batch/internal caller cannot bypass,
- audit event emitted,
- denial reason stable.

---

## 32. Example End-to-End Migration: Search and Export

### 32.1 Legacy State

```java
@GetMapping("/cases")
public Page<CaseDto> search(CaseSearchRequest request) {
    return caseRepository.search(request);
}

@GetMapping("/cases/export")
public File export(CaseSearchRequest request) {
    return caseExportService.export(request);
}
```

Maybe UI only shows menu to authorized users, but backend lacks data scope.

### 32.2 Target Rule

```text
case.search:
- same tenant
- assigned to me OR member of case team OR agency supervisor

case.export:
- must have case.export permission
- same data scope as search
- max rows / approval for large export
- audit reason required
```

### 32.3 Target Implementation

```java
public Page<CaseDto> search(CaseSearchRequest request) {
    SubjectRef subject = currentSubject();
    AuthorizationContext context = currentContext();

    authorizationGuard.require(CaseAuthorizationRequests.search(subject, context));

    Specification<CaseEntity> scope = caseAuthorizationScope.visibleCases(subject, context);
    Specification<CaseEntity> userFilter = caseSearchSpecification.from(request);

    return caseRepository.findAll(scope.and(userFilter), request.toPageable())
            .map(caseMapper::toDto);
}
```

Export:

```java
public ExportJobId requestExport(CaseSearchRequest request, String reason) {
    SubjectRef subject = currentSubject();
    AuthorizationContext context = currentContext().with("exportReason", reason);

    authorizationGuard.require(CaseAuthorizationRequests.export(subject, context));

    Specification<CaseEntity> scope = caseAuthorizationScope.visibleCases(subject, context);

    return exportJobService.createCaseExportJob(subject, context.snapshot(), request, scope, reason);
}
```

---

## 33. Common Migration Failure Modes

### 33.1 “We Centralized the Check, But Not the Data Scope”

Controller says allowed, repository still returns too much.

Fix:

- query scope,
- repository tests,
- export tests,
- count/aggregation tests.

### 33.2 “We Mapped Role to Permission Too Broadly”

Legacy `ADMIN` becomes `*`.

Fix:

- split capability,
- scope admin,
- add approval for sensitive permission,
- least privilege review.

### 33.3 “Shadow Mode Was Logged But Nobody Reviewed It”

Shadow without triage is theater.

Fix:

- define owner,
- weekly diff review,
- rollout gate based on diff rate,
- classify diffs.

### 33.4 “Target Policy Depends on Missing Attributes”

Policy denies because resource attributes are unavailable.

Fix:

- attribute readiness check,
- data quality dashboard,
- fallback rules explicit,
- no enforcement until missing attribute rate acceptable.

### 33.5 “Feature Flag Became Permanent”

Migration flag remains forever.

Fix:

- expiry date,
- owner,
- cleanup ticket,
- flag review.

### 33.6 “Rollback Opens Security Hole”

Rollback to legacy reopens known false allow.

Fix:

- separate rollback for false deny vs false allow,
- sensitive actions fail closed,
- emergency manual operation path,
- documented risk acceptance.

---

## 34. Production Readiness Checklist

Before enforcing target authorization:

```text
Inventory
[ ] all known authorization checks inventoried
[ ] all high-risk endpoints identified
[ ] report/export/download included
[ ] batch/internal APIs included

Vocabulary
[ ] canonical actions defined
[ ] resource types defined
[ ] context fields defined
[ ] reason codes defined

Mapping
[ ] legacy roles mapped
[ ] legacy permissions mapped
[ ] ACL/relationship exceptions mapped
[ ] admin/superuser split reviewed

Implementation
[ ] AuthorizationService integrated
[ ] query scopes implemented
[ ] audit publisher implemented
[ ] denial handling consistent
[ ] feature flags available

Shadow/Diff
[ ] shadow mode enabled
[ ] diff dashboard available
[ ] diff owner assigned
[ ] target policy error rate acceptable
[ ] high-risk diffs triaged

Testing
[ ] characterization tests exist
[ ] target policy tests exist
[ ] object-level tests exist
[ ] tenant isolation tests exist
[ ] query/export tests exist
[ ] negative tests exist
[ ] regression suite in CI

Operations
[ ] rollout plan approved
[ ] rollback plan tested
[ ] alerting configured
[ ] support playbook ready
[ ] audit continuity verified
```

---

## 35. Mental Model: Migration Is a Policy Behavior Change Pipeline

Think of authorization migration as a pipeline:

```text
Legacy behavior
    -> observed behavior
    -> characterized behavior
    -> compatibility policy
    -> target policy
    -> shadow comparison
    -> diff triage
    -> staged enforcement
    -> legacy removal
    -> governed policy lifecycle
```

A weak team says:

> “Replace `hasRole` with new policy service.”

A strong team says:

> “Define the authorization invariant, preserve legacy behavior temporarily, instrument differences, enforce target behavior gradually, and prove by tests/audit that no false allow or unacceptable false deny remains.”

---

## 36. Java 8–25 Notes

### Java 8

- Use final classes/value objects instead of records.
- Use interfaces and explicit constructors.
- Avoid relying on newer language features.
- Works for legacy enterprise systems.

### Java 11

- Better HTTP client available for external PDP integration.
- Still commonly used in enterprise migration.

### Java 17

- Records useful for request/decision models.
- Sealed classes useful for decision types.
- Strong baseline for modern Spring Boot 3/Jakarta EE 10+ systems.

### Java 21

- Virtual threads can help high-concurrency PDP calls, but do not remove need for timeouts/circuit breakers.
- Structured concurrency may help orchestrate attribute fetches if available in chosen runtime constraints.

### Java 25

- Treat as modern platform target where language/runtime improvements help implementation ergonomics.
- Authorization correctness still depends on model, policy, data, and tests—not on JDK version.

---

## 37. Top 1% Insights

1. **Authorization migration is not code cleanup; it is controlled behavior replacement.**
2. **Never start by deleting legacy checks. Start by observing them.**
3. **Compatibility policy and target policy are different artifacts.**
4. **Shadow mode without decision diff triage is useless.**
5. **False allow is a security incident candidate; false deny is an operational incident candidate. Both matter.**
6. **Data-level authorization must migrate with action-level authorization. Otherwise reports/search/export will bypass the new model.**
7. **Admin migration requires capability splitting, not just `ADMIN -> admin.*`.**
8. **Legacy ACL entries often encode real business exceptions. Do not flatten them into global permissions.**
9. **Policy version, mapping version, and feature flag state must appear in audit logs.**
10. **Rollback must not silently reintroduce known dangerous behavior.**
11. **A migration is complete only when old bypass paths are removed and regression tests protect the new invariant.**
12. **The safest migration architecture is abstraction + dual implementation + comparison + gradual switch.**
13. **Every authorization migration should produce a permission matrix, even if the original system never had one.**
14. **When business rules are unclear, do not encode guesses as policy. Mark as policy ambiguity and get ownership.**
15. **The best authorization systems are not just secure at runtime; they are explainable during audit and evolvable during change.**

---

## 38. Mini Capstone Exercise

Take a legacy endpoint:

```http
POST /cases/{caseId}/approve
```

Current behavior:

```java
@PreAuthorize("hasRole('APPROVER')")
```

Design migration artifacts:

1. inventory row,
2. canonical action/resource/context,
3. compatibility policy,
4. target policy,
5. shadow log format,
6. expected decision diffs,
7. rollout flag,
8. rollback plan,
9. tests,
10. audit event.

Expected target invariant:

```text
A case can be approved only by an assigned reviewer in the same tenant,
when the case is in SUBMITTED state,
and the reviewer is not the maker/submitter,
and the reviewer has active case.approve permission in the relevant scope.
```

If your design does not include query/data/report/export impact, it is incomplete.

---

## 39. References

- OWASP Authorization Cheat Sheet — deny-by-default, least privilege, validate permissions on every request, centralized authorization: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Top 10 2021 A01 Broken Access Control — server-side access control, deny-by-default, reusable access-control mechanisms: https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/
- Spring Security Authorization Architecture — `AuthorizationManager` as the component used by request-based, method-based, and message-based authorization: https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html
- Open Policy Agent Decision Logs — decision logs include policy query, input, bundle metadata, and related audit/debug information: https://openpolicyagent.org/docs/management-decision-logs
- Open Policy Agent Bundles — packaging and distributing policy/data bundles: https://openpolicyagent.org/docs/management-bundles
- Martin Fowler, Branch by Abstraction — abstraction layer for gradual replacement while system remains running: https://martinfowler.com/bliki/BranchByAbstraction.html
- Martin Fowler, Patterns of Legacy Displacement — evolutionary lower-risk legacy displacement patterns: https://martinfowler.com/articles/patterns-legacy-displacement/

---

## 40. Status Seri

Selesai:

```text
[x] Part 0  — Authorization Mental Model
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
[x] Part 11 — IDOR, BOLA, and Object-Level Authorization
[x] Part 12 — Authorization in Layered Java Applications
[x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
[x] Part 14 — Spring Method Security: Service-Level Authorization
[x] Part 15 — Spring Domain Authorization Patterns
[x] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
[x] Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
[x] Part 18 — Data-Level Authorization and Query Scoping
[x] Part 19 — Workflow, State Machine, and Case Management Authorization
[x] Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
[x] Part 21 — Hierarchical Organizations and Complex Role Resolution
[x] Part 22 — Temporal, Risk-Based, and Contextual Authorization
[x] Part 23 — Authorization for Microservices and Distributed Systems
[x] Part 24 — Token Scopes, Claims, and Authorization Boundaries
[x] Part 25 — Authorization Caching, Performance, and Scalability
[x] Part 26 — Authorization Failure Semantics and Error Handling
[x] Part 27 — Auditability, Explainability, and Regulatory Defensibility
[x] Part 28 — Secure Authorization Testing Strategy
[x] Part 29 — Authorization Anti-Patterns and Failure Modes
[x] Part 30 — Designing an Authorization Domain Model in Java
[x] Part 31 — Building an Internal Authorization Service
[x] Part 32 — External Policy Engine Integration from Java
[x] Part 33 — Authorization Migration and Refactoring Legacy Systems
```

Belum selesai:

```text
[ ] Part 34 — Top 1% Authorization Engineering Playbook
```

Seri belum mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-032.md">⬅️ Java Authorization Modes and Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-034.md">Part 34 — Top 1% Authorization Engineering Playbook ➡️</a>
</div>

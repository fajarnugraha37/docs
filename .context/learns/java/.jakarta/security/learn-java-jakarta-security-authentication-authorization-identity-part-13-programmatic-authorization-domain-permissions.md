# Part 13 — Programmatic Authorization and Domain Permission Design

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-13-programmatic-authorization-domain-permissions.md`  
> Target: Java 8–25, Java EE/Jakarta EE, Servlet, JAX-RS, CDI/EJB, Jakarta Security, Jakarta Authorization, enterprise/regulatory systems

---

## 0. Posisi Part Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas **declarative authorization**: security constraint, `@RolesAllowed`, `@PermitAll`, `@DenyAll`, role declaration, dan bagaimana container bisa melakukan enforcement berdasarkan metadata.

Bagian ini naik ke level yang jauh lebih penting untuk sistem nyata:

> Bagaimana aplikasi memutuskan apakah seseorang boleh melakukan aksi tertentu terhadap objek bisnis tertentu, dalam tenant tertentu, pada state tertentu, dengan relationship tertentu, pada waktu tertentu?

Inilah wilayah **programmatic authorization** dan **domain permission design**.

Declarative authorization menjawab pertanyaan seperti:

```text
Apakah caller punya role CASE_OFFICER untuk memanggil endpoint /cases/{id}/approve?
```

Programmatic/domain authorization menjawab pertanyaan seperti:

```text
Apakah caller Fajar, sebagai officer aktif di agency X,
boleh approve case C-2026-001,
yang sekarang berada di state PENDING_REVIEW,
yang sebelumnya dia sendiri draft,
yang nominal risikonya high,
yang membutuhkan maker-checker,
dan belum melewati SLA escalation?
```

Dua pertanyaan itu terlihat mirip, tetapi secara arsitektur sangat berbeda.

---

## 1. Mental Model Utama

Authorization yang matang bukan sekadar role check.

Authorization adalah keputusan terhadap tuple:

```text
(subject, action, resource, context) -> decision
```

Dalam sistem enterprise/case management, tuple itu biasanya harus diperluas menjadi:

```text
(subject, action, resource, tenant, state, relationship, time, risk, channel, delegation) -> decision
```

Contoh:

```text
Subject      : user 123, officer, agency A
Action       : APPROVE_CASE
Resource     : case 987
Tenant       : agency A
State        : PENDING_APPROVAL
Relationship : assigned reviewer, not creator
Time         : within business hours
Risk         : high risk case
Channel      : intranet
Delegation   : acting on behalf of supervisor? no
Decision     : allow / deny / require step-up / require second approval
```

Mental model ini penting karena banyak privilege escalation terjadi bukan karena authentication gagal, melainkan karena authorization terlalu dangkal.

---

## 2. Kenapa Role Check Tidak Cukup

Role check seperti ini sering ditemukan:

```java
if (securityContext.isCallerInRole("CASE_OFFICER")) {
    approveCase(caseId);
}
```

Kode ini terlihat benar, tetapi sebenarnya hanya menjawab:

```text
Apakah caller punya role CASE_OFFICER?
```

Kode ini tidak menjawab:

1. Apakah case itu milik tenant/agency caller?
2. Apakah case itu sedang berada di state yang bisa di-approve?
3. Apakah caller adalah maker dari case tersebut?
4. Apakah caller sedang assigned ke case itu?
5. Apakah role caller masih berlaku pada saat request diproses?
6. Apakah case high-risk membutuhkan dual approval?
7. Apakah caller sedang acting-on-behalf-of user lain?
8. Apakah approval ini melewati SLA escalation rule?
9. Apakah caller punya conflict of interest?
10. Apakah caller boleh approve melalui channel internet, atau hanya intranet?

Role adalah coarse-grained authorization primitive. Domain permission adalah business rule enforcement.

---

## 3. Declarative vs Programmatic Authorization

### 3.1 Declarative authorization

Declarative authorization berada di metadata:

```java
@RolesAllowed("CASE_OFFICER")
public Response approve(String caseId) {
    ...
}
```

Kelebihan:

- mudah dibaca,
- container-managed,
- cocok untuk endpoint/class/method boundary,
- bagus untuk coarse-grained protection,
- mudah menjadi default gate.

Keterbatasan:

- tidak tahu state objek bisnis,
- tidak tahu ownership,
- tidak tahu assignment,
- tidak tahu tenant kecuali dimodelkan manual,
- tidak tahu policy kompleks,
- sulit memberi denial reason yang domain-specific.

### 3.2 Programmatic authorization

Programmatic authorization berada di kode aplikasi:

```java
AuthorizationDecision decision = authorizationService.canApproveCase(actor, caseRecord);

if (decision.isDenied()) {
    throw new ForbiddenException(decision.safeMessage());
}
```

Kelebihan:

- bisa membaca state domain,
- bisa mengevaluasi tenant,
- bisa mengevaluasi relationship,
- bisa melakukan audit decision,
- bisa memberi denial reason,
- cocok untuk workflow dan case management.

Risiko:

- bisa tersebar di banyak tempat,
- bisa tidak konsisten,
- bisa lupa dipanggil,
- bisa race condition,
- bisa menghasilkan policy spaghetti.

Karena itu programmatic authorization harus didesain sebagai **domain authorization layer**, bukan sekadar `if` acak di service.

---

## 4. Layering Authorization yang Sehat

Model yang sehat biasanya berlapis:

```text
[1] Network / Gateway boundary
    - TLS
    - mTLS
    - gateway auth
    - trusted header protection

[2] Container/web boundary
    - Servlet security constraint
    - Jakarta Security authentication
    - JAX-RS / EJB method security
    - @RolesAllowed coarse gate

[3] Application service boundary
    - domain-specific permission check
    - tenant check
    - state check
    - ownership/assignment check

[4] Persistence/data boundary
    - query scoped by tenant
    - row-level restriction where available
    - optimistic locking
    - database constraints

[5] Audit/observability boundary
    - who attempted what
    - what was allowed/denied
    - based on which policy version
```

Poin penting:

> Declarative authorization adalah pagar depan. Domain authorization adalah pagar dalam.

Jangan memilih salah satu. Sistem enterprise yang kuat biasanya memakai keduanya.

---

## 5. Authorization Decision Model

Daripada mengembalikan boolean, gunakan model keputusan eksplisit.

### 5.1 Model minimal

```java
public enum DecisionEffect {
    ALLOW,
    DENY
}

public final class AuthorizationDecision {
    private final DecisionEffect effect;
    private final String reasonCode;
    private final String safeMessage;

    private AuthorizationDecision(DecisionEffect effect, String reasonCode, String safeMessage) {
        this.effect = effect;
        this.reasonCode = reasonCode;
        this.safeMessage = safeMessage;
    }

    public static AuthorizationDecision allow() {
        return new AuthorizationDecision(DecisionEffect.ALLOW, "ALLOW", "Allowed");
    }

    public static AuthorizationDecision deny(String reasonCode, String safeMessage) {
        return new AuthorizationDecision(DecisionEffect.DENY, reasonCode, safeMessage);
    }

    public boolean isAllowed() {
        return effect == DecisionEffect.ALLOW;
    }

    public boolean isDenied() {
        return effect == DecisionEffect.DENY;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public String safeMessage() {
        return safeMessage;
    }
}
```

### 5.2 Model lebih realistis

Dalam sistem enterprise, decision bisa lebih dari allow/deny:

```java
public enum DecisionEffect {
    ALLOW,
    DENY,
    REQUIRE_STEP_UP,
    REQUIRE_SECOND_APPROVAL,
    REQUIRE_SUPERVISOR_REVIEW,
    REQUIRE_REASSIGNMENT,
    NOT_APPLICABLE
}
```

Kenapa penting?

Karena tidak semua denial berarti forbidden permanen.

Contoh:

| Situation | Decision |
|---|---|
| User tidak login | authentication required |
| User login tapi tidak punya role | deny |
| User punya role tapi bukan assignee | deny |
| User punya role, assignee, tetapi case high-risk | require second approval |
| User punya role tetapi session terlalu lama | require step-up |
| Case sudah approved oleh proses lain | not applicable / conflict |

---

## 6. Subject / Actor Model

Jangan langsung memakai `Principal` atau `SecurityContext` sebagai domain actor.

`SecurityContext` adalah container-facing API. Domain authorization butuh actor yang stabil dan kaya konteks.

Contoh model:

```java
public final class Actor {
    private final String subjectId;
    private final String username;
    private final String displayName;
    private final Set<String> applicationRoles;
    private final Set<String> groups;
    private final Set<String> tenantIds;
    private final String activeTenantId;
    private final boolean serviceAccount;
    private final String actingOnBehalfOf;

    public Actor(
            String subjectId,
            String username,
            String displayName,
            Set<String> applicationRoles,
            Set<String> groups,
            Set<String> tenantIds,
            String activeTenantId,
            boolean serviceAccount,
            String actingOnBehalfOf
    ) {
        this.subjectId = subjectId;
        this.username = username;
        this.displayName = displayName;
        this.applicationRoles = Set.copyOf(applicationRoles);
        this.groups = Set.copyOf(groups);
        this.tenantIds = Set.copyOf(tenantIds);
        this.activeTenantId = activeTenantId;
        this.serviceAccount = serviceAccount;
        this.actingOnBehalfOf = actingOnBehalfOf;
    }

    public String subjectId() { return subjectId; }
    public String activeTenantId() { return activeTenantId; }
    public boolean hasRole(String role) { return applicationRoles.contains(role); }
    public boolean belongsToTenant(String tenantId) { return tenantIds.contains(tenantId); }
    public boolean isActingOnBehalf() { return actingOnBehalfOf != null; }
}
```

Mapping dari Jakarta Security:

```java
@RequestScoped
public class ActorProvider {

    @Inject
    SecurityContext securityContext;

    public Actor currentActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new NotAuthenticatedException("Caller is not authenticated");
        }

        // Dalam aplikasi nyata, enrich dari user directory, session, token claim,
        // tenant membership table, delegation context, dan role mapping service.
        return new Actor(
                principal.getName(),
                principal.getName(),
                principal.getName(),
                resolveApplicationRoles(),
                resolveGroups(),
                resolveTenantIds(),
                resolveActiveTenantId(),
                false,
                resolveActingOnBehalfOf()
        );
    }

    private Set<String> resolveApplicationRoles() {
        Set<String> roles = new HashSet<>();
        if (securityContext.isCallerInRole("CASE_OFFICER")) {
            roles.add("CASE_OFFICER");
        }
        if (securityContext.isCallerInRole("CASE_SUPERVISOR")) {
            roles.add("CASE_SUPERVISOR");
        }
        return roles;
    }

    private Set<String> resolveGroups() { return Set.of(); }
    private Set<String> resolveTenantIds() { return Set.of("agency-a"); }
    private String resolveActiveTenantId() { return "agency-a"; }
    private String resolveActingOnBehalfOf() { return null; }
}
```

Catatan desain:

- `Principal.getName()` bukan selalu stable immutable user id.
- Email bisa berubah.
- Username bisa berubah.
- Subject ID dari IdP lebih cocok sebagai stable identity.
- Display name tidak boleh dipakai untuk authorization.
- Group eksternal tidak boleh langsung dianggap permission domain.

---

## 7. Resource Model

Authorization butuh resource yang jelas.

Jangan membuat permission check terhadap `caseId` saja jika policy butuh state/tenant/assignment.

Buruk:

```java
boolean canApprove = authorizationService.canApproveCase(actor, caseId);
```

Lebih baik:

```java
CaseRecord caseRecord = caseRepository.findById(caseId)
        .orElseThrow(NotFoundException::new);

AuthorizationDecision decision = authorizationService.canApproveCase(actor, caseRecord);
```

Namun ini juga harus hati-hati: sebelum fetch detail, pastikan query tidak membocorkan data lintas tenant.

Lebih aman:

```java
CaseRecord caseRecord = caseRepository.findByIdWithinVisibleTenants(
        caseId,
        actor.tenantIds()
).orElseThrow(NotFoundException::new);
```

Resource untuk authorization sebaiknya membawa minimal field yang dibutuhkan:

```java
public final class CaseAuthorizationView {
    private final String caseId;
    private final String tenantId;
    private final String status;
    private final String createdBy;
    private final String assignedOfficerId;
    private final String assignedTeamId;
    private final boolean highRisk;
    private final boolean locked;
    private final long version;

    // constructor + getters
}
```

Kenapa bukan langsung entity penuh?

Karena authorization layer tidak selalu perlu seluruh aggregate. Model view bisa:

- mengurangi coupling,
- mengurangi accidental data exposure,
- membuat testing lebih mudah,
- membuat permission logic lebih eksplisit.

---

## 8. Action Model

Action harus dinamai berdasarkan capability bisnis, bukan endpoint teknis.

Buruk:

```text
POST_CASE_APPROVE_ENDPOINT
PUT_CASE_STATUS
CALL_APPROVE_API
```

Lebih baik:

```text
CASE_VIEW
CASE_EDIT_DRAFT
CASE_SUBMIT
CASE_REVIEW
CASE_APPROVE
CASE_REJECT
CASE_REASSIGN
CASE_CLOSE
CASE_REOPEN
CASE_ESCALATE
CASE_OVERRIDE
```

Action harus cukup stabil agar tidak berubah ketika URL berubah.

Contoh enum:

```java
public enum CaseAction {
    VIEW,
    CREATE,
    EDIT_DRAFT,
    SUBMIT,
    REVIEW,
    APPROVE,
    REJECT,
    REASSIGN,
    ESCALATE,
    CLOSE,
    REOPEN,
    OVERRIDE
}
```

---

## 9. Permission Naming

Permission naming yang baik harus:

1. stabil,
2. domain-oriented,
3. bisa diaudit,
4. tidak terlalu granular di awal,
5. tidak terlalu kasar sampai semua orang jadi admin.

Contoh naming:

```text
case:view
case:create
case:edit-draft
case:submit
case:review
case:approve
case:reject
case:reassign
case:close
case:reopen
case:override
```

Untuk multi-domain:

```text
case:approve
appeal:approve
inspection:schedule
inspection:complete
license:issue
license:suspend
user:assign-role
report:export-sensitive
```

Hindari permission seperti:

```text
button_123_visible
api_v2_case_post
admin_all
role_case_officer_screen_approve_enabled
```

Permission harus mewakili capability, bukan UI element atau endpoint implementation.

---

## 10. Role-to-Permission Mapping

Role adalah bundle permission.

Contoh:

| Role | Permissions |
|---|---|
| CASE_VIEWER | `case:view` |
| CASE_OFFICER | `case:view`, `case:create`, `case:edit-draft`, `case:submit`, `case:review` |
| CASE_SUPERVISOR | `case:view`, `case:review`, `case:approve`, `case:reject`, `case:reassign` |
| CASE_ADMIN | `case:view`, `case:reassign`, `case:override`, `case:reopen` |

Namun role-to-permission mapping tidak cukup karena domain constraint masih berlaku.

Contoh:

```text
CASE_SUPERVISOR has case:approve
```

Tetapi masih harus dicek:

```text
- same tenant?
- case state allows approval?
- not maker?
- assigned to supervisor's team?
- no conflict of interest?
- version not stale?
```

Jadi permission check sebaiknya terdiri dari dua tahap:

```text
[1] Capability check
    Does actor have case:approve?

[2] Constraint check
    Is actor allowed to approve this specific case right now?
```

---

## 11. Authorization Service Design

Contoh service:

```java
@ApplicationScoped
public class CaseAuthorizationService {

    public AuthorizationDecision canApprove(Actor actor, CaseAuthorizationView caze) {
        if (!actor.hasRole("CASE_SUPERVISOR")) {
            return AuthorizationDecision.deny(
                    "MISSING_ROLE",
                    "You are not allowed to approve this case."
            );
        }

        if (!actor.belongsToTenant(caze.tenantId())) {
            return AuthorizationDecision.deny(
                    "TENANT_MISMATCH",
                    "You are not allowed to access this case."
            );
        }

        if (!"PENDING_APPROVAL".equals(caze.status())) {
            return AuthorizationDecision.deny(
                    "INVALID_CASE_STATE",
                    "This case is not pending approval."
            );
        }

        if (actor.subjectId().equals(caze.createdBy())) {
            return AuthorizationDecision.deny(
                    "MAKER_CHECKER_VIOLATION",
                    "You cannot approve a case that you created."
            );
        }

        if (caze.locked()) {
            return AuthorizationDecision.deny(
                    "CASE_LOCKED",
                    "This case is currently locked."
            );
        }

        if (caze.highRisk() && !actor.hasRole("HIGH_RISK_APPROVER")) {
            return AuthorizationDecision.deny(
                    "HIGH_RISK_APPROVER_REQUIRED",
                    "This case requires high-risk approval."
            );
        }

        return AuthorizationDecision.allow();
    }
}
```

Ini masih sederhana. Tetapi sudah jauh lebih aman daripada hanya:

```java
@RolesAllowed("CASE_SUPERVISOR")
```

---

## 12. Enforcement Pattern di Application Service

Authorization harus terjadi dekat dengan action yang mengubah state.

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    ActorProvider actorProvider;

    @Inject
    CaseRepository caseRepository;

    @Inject
    CaseAuthorizationService authorizationService;

    @Inject
    AuditService auditService;

    @Transactional
    public void approve(String caseId, ApproveCaseCommand command) {
        Actor actor = actorProvider.currentActor();

        CaseAuthorizationView authView = caseRepository.getAuthorizationViewForUpdate(caseId)
                .orElseThrow(NotFoundException::new);

        AuthorizationDecision decision = authorizationService.canApprove(actor, authView);

        auditService.recordAuthorizationDecision(
                actor,
                "CASE_APPROVE",
                caseId,
                decision.reasonCode()
        );

        if (decision.isDenied()) {
            throw new ForbiddenException(decision.safeMessage());
        }

        CaseRecord caseRecord = caseRepository.getForUpdate(caseId)
                .orElseThrow(NotFoundException::new);

        caseRecord.approve(actor.subjectId(), command.comment());

        caseRepository.save(caseRecord);

        auditService.recordBusinessAction(actor, "CASE_APPROVED", caseId);
    }
}
```

Perhatikan beberapa hal:

1. Actor diambil dari security context.
2. Authorization view diambil dalam transactional boundary.
3. Jika perlu, record dikunci dengan `for update` atau optimistic lock.
4. Authorization decision diaudit.
5. Business action diaudit setelah sukses.
6. Authorization dicek sebelum perubahan state.

---

## 13. Race Condition Dalam Authorization

Authorization yang benar pada waktu T1 bisa salah pada waktu T2.

Contoh:

```text
T1: User membuka case status PENDING_APPROVAL.
T2: Sistem menampilkan tombol Approve.
T3: User lain approve case tersebut.
T4: User pertama klik Approve.
```

Jika backend hanya percaya tombol UI, maka terjadi double approval.

Backend harus mengecek ulang state dalam transaction.

```java
@Transactional
public void approve(String caseId) {
    Actor actor = actorProvider.currentActor();

    CaseRecord caseRecord = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(NotFoundException::new);

    AuthorizationDecision decision = authorizationService.canApprove(
            actor,
            CaseAuthorizationView.from(caseRecord)
    );

    if (decision.isDenied()) {
        throw new ForbiddenException(decision.safeMessage());
    }

    caseRecord.approve(actor.subjectId());
}
```

Invariant:

> Authorization untuk state-changing operation harus dievaluasi pada state terbaru yang akan diubah, bukan pada snapshot UI lama.

---

## 14. UI Authorization vs Backend Authorization

UI boleh menyembunyikan tombol.

Tetapi UI bukan enforcement boundary.

UI permission digunakan untuk:

- user experience,
- mengurangi error,
- menyederhanakan workflow,
- menampilkan action yang relevan.

Backend permission digunakan untuk:

- security,
- audit,
- consistency,
- regulatory defensibility.

Aturan:

```text
UI can hint.
Backend must enforce.
```

Contoh API untuk UI action availability:

```json
{
  "caseId": "C-2026-001",
  "status": "PENDING_APPROVAL",
  "allowedActions": [
    "VIEW",
    "REJECT",
    "APPROVE"
  ],
  "deniedActions": {
    "REASSIGN": "NOT_TEAM_SUPERVISOR",
    "OVERRIDE": "MISSING_OVERRIDE_ROLE"
  }
}
```

Hati-hati: denial reason ke UI harus aman. Jangan membocorkan rule internal sensitif seperti:

```text
Denied because this case belongs to secret investigation team X.
```

Gunakan safe reason untuk user dan detailed reason untuk audit internal.

---

## 15. Object-Level Authorization

Object-level authorization berarti keputusan bergantung pada objek tertentu.

Contoh:

```text
User A boleh view case 1 tetapi tidak case 2.
User B boleh edit draft case yang dia buat tetapi tidak draft user lain.
Supervisor boleh approve case team-nya tetapi tidak team lain.
```

Kode buruk:

```java
@RolesAllowed("CASE_VIEWER")
public CaseDto getCase(String caseId) {
    return caseRepository.findById(caseId);
}
```

Kode lebih baik:

```java
@RolesAllowed("CASE_VIEWER")
public CaseDto getCase(String caseId) {
    Actor actor = actorProvider.currentActor();

    CaseRecord caze = caseRepository.findVisibleCaseById(
            caseId,
            actor.activeTenantId(),
            actor.subjectId(),
            actor.applicationRoles()
    ).orElseThrow(NotFoundException::new);

    AuthorizationDecision decision = authorizationService.canView(actor, caze.toAuthorizationView());
    if (decision.isDenied()) {
        throw new ForbiddenException(decision.safeMessage());
    }

    return mapper.toDto(caze);
}
```

Catatan:

- Untuk read operation, sering lebih aman query langsung dengan visibility constraint.
- Untuk write operation, tetap lakukan explicit authorization check sebelum mutation.

---

## 16. Row-Level Authorization

Row-level authorization berarti data yang bisa dilihat dibatasi per row.

Contoh query:

```sql
SELECT *
FROM case_record c
WHERE c.case_id = :case_id
  AND c.tenant_id = :tenant_id
  AND (
      c.created_by = :actor_id
      OR c.assigned_officer_id = :actor_id
      OR c.assigned_team_id IN (:team_ids)
      OR :has_supervisor_role = 1
  )
```

Dalam Java repository:

```java
public Optional<CaseAuthorizationView> findVisibleAuthorizationView(
        String caseId,
        Actor actor
) {
    return jdbcTemplate.query(
            """
            SELECT case_id, tenant_id, status, created_by,
                   assigned_officer_id, assigned_team_id, high_risk, locked, version
            FROM case_record
            WHERE case_id = ?
              AND tenant_id = ?
              AND (
                    created_by = ?
                 OR assigned_officer_id = ?
                 OR assigned_team_id IN (SELECT team_id FROM team_member WHERE user_id = ?)
                 OR ? = 1
              )
            """,
            mapper,
            caseId,
            actor.activeTenantId(),
            actor.subjectId(),
            actor.subjectId(),
            actor.subjectId(),
            actor.hasRole("CASE_SUPERVISOR") ? 1 : 0
    ).stream().findFirst();
}
```

Keuntungan:

- mengurangi risiko object exposure,
- query list lebih natural,
- bisa scale untuk pagination/filtering.

Risiko:

- logic authorization tersebar ke SQL,
- sulit diaudit jika tidak distandardisasi,
- raw SQL bisa berbeda antar repository,
- role check di SQL bisa menjadi tidak konsisten.

Solusi:

- buat visibility specification,
- centralize query fragments,
- test permission matrix,
- audit critical action secara eksplisit.

---

## 17. Tenant-Level Authorization

Untuk multi-tenant system, tenant isolation adalah invariant, bukan optional filter.

Buruk:

```java
CaseRecord caze = caseRepository.findById(caseId);
if (!actor.belongsToTenant(caze.tenantId())) {
    throw new ForbiddenException();
}
```

Masalah:

- data sudah sempat dibaca,
- log/debug bisa membocorkan existence,
- developer bisa lupa check,
- list endpoint lebih berbahaya.

Lebih baik:

```java
CaseRecord caze = caseRepository.findByIdAndTenantId(caseId, actor.activeTenantId())
        .orElseThrow(NotFoundException::new);
```

Untuk sistem sensitif, gunakan `404 Not Found` untuk resource di tenant lain agar tidak membocorkan existence.

Policy:

```text
If actor cannot ever access resource due to tenant boundary,
return Not Found, not Forbidden.
```

Tetapi untuk resource dalam tenant yang sama namun action tidak allowed, gunakan `403 Forbidden`.

---

## 18. State-Machine-Aware Authorization

Dalam workflow system, action valid bergantung pada state.

Contoh:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> PENDING_APPROVAL -> APPROVED
                                      -> REJECTED
```

Permission matrix:

| State | Action | Allowed Role | Additional Constraint |
|---|---|---|---|
| DRAFT | EDIT | Creator | same tenant |
| DRAFT | SUBMIT | Creator | required fields complete |
| SUBMITTED | ASSIGN | Supervisor | same team |
| UNDER_REVIEW | REVIEW | Assigned Officer | not locked |
| PENDING_APPROVAL | APPROVE | Supervisor | not creator |
| PENDING_APPROVAL | REJECT | Supervisor | reason required |
| APPROVED | REOPEN | Admin | within reopen window |

Kode:

```java
public AuthorizationDecision canPerform(Actor actor, CaseAuthorizationView caze, CaseAction action) {
    return switch (action) {
        case VIEW -> canView(actor, caze);
        case EDIT_DRAFT -> canEditDraft(actor, caze);
        case SUBMIT -> canSubmit(actor, caze);
        case REVIEW -> canReview(actor, caze);
        case APPROVE -> canApprove(actor, caze);
        case REJECT -> canReject(actor, caze);
        case REASSIGN -> canReassign(actor, caze);
        case REOPEN -> canReopen(actor, caze);
        default -> AuthorizationDecision.deny("UNSUPPORTED_ACTION", "This action is not supported.");
    };
}
```

Untuk Java 8, `switch` expression belum tersedia. Gunakan classic switch:

```java
public AuthorizationDecision canPerform(Actor actor, CaseAuthorizationView caze, CaseAction action) {
    switch (action) {
        case VIEW:
            return canView(actor, caze);
        case EDIT_DRAFT:
            return canEditDraft(actor, caze);
        case SUBMIT:
            return canSubmit(actor, caze);
        case REVIEW:
            return canReview(actor, caze);
        case APPROVE:
            return canApprove(actor, caze);
        case REJECT:
            return canReject(actor, caze);
        case REASSIGN:
            return canReassign(actor, caze);
        case REOPEN:
            return canReopen(actor, caze);
        default:
            return AuthorizationDecision.deny("UNSUPPORTED_ACTION", "This action is not supported.");
    }
}
```

---

## 19. Ownership, Assignment, Delegation

Authorization sering bergantung pada relationship.

### 19.1 Ownership

```text
Creator can edit draft before submission.
```

```java
private boolean isCreator(Actor actor, CaseAuthorizationView caze) {
    return actor.subjectId().equals(caze.createdBy());
}
```

### 19.2 Assignment

```text
Assigned officer can review assigned case.
```

```java
private boolean isAssignedOfficer(Actor actor, CaseAuthorizationView caze) {
    return actor.subjectId().equals(caze.assignedOfficerId());
}
```

### 19.3 Team membership

```text
Supervisor can act on cases assigned to their team.
```

```java
private boolean isTeamSupervisor(Actor actor, CaseAuthorizationView caze) {
    return actor.hasRole("CASE_SUPERVISOR")
            && actor.teamIds().contains(caze.assignedTeamId());
}
```

### 19.4 Delegation

```text
User B can act on behalf of User A during approved delegation period.
```

Delegation harus membawa:

- delegator,
- delegate,
- scope,
- start time,
- end time,
- approved by,
- revocation status,
- audit trail.

```java
public final class DelegationContext {
    private final String delegatorId;
    private final String delegateId;
    private final Set<String> delegatedPermissions;
    private final Instant validFrom;
    private final Instant validUntil;
    private final boolean revoked;
}
```

Delegation tidak boleh menjadi “copy all roles forever”.

---

## 20. Maker-Checker / Four-Eyes Control

Maker-checker adalah invariant umum di sistem regulatory/financial/admin:

```text
The person who creates or changes a sensitive record cannot be the same person who approves it.
```

Kode:

```java
if (actor.subjectId().equals(caze.createdBy())) {
    return AuthorizationDecision.deny(
            "MAKER_CHECKER_VIOLATION",
            "You cannot approve your own submission."
    );
}
```

Namun maker-checker bisa lebih kompleks:

1. Same user cannot approve.
2. Same team cannot approve.
3. Same reporting line cannot approve.
4. Same delegated actor cannot approve.
5. Previous reviewer cannot be final approver.
6. High-risk case requires two independent approvers.

Contoh model:

```java
public AuthorizationDecision canApproveHighRiskCase(Actor actor, CaseAuthorizationView caze) {
    if (!actor.hasRole("HIGH_RISK_APPROVER")) {
        return deny("MISSING_HIGH_RISK_ROLE");
    }

    if (actor.subjectId().equals(caze.createdBy())) {
        return deny("MAKER_CHECKER_VIOLATION");
    }

    if (caze.previousApproverIds().contains(actor.subjectId())) {
        return deny("DUPLICATE_APPROVER");
    }

    if (sameReportingLine(actor.subjectId(), caze.createdBy())) {
        return deny("INDEPENDENCE_REQUIRED");
    }

    return allow();
}
```

---

## 21. Attribute-Based Authorization

Attribute-based access control menggunakan atribut subject, resource, action, dan environment.

Contoh atribut subject:

```text
role = CASE_SUPERVISOR
agency = A
clearance = HIGH
employmentStatus = ACTIVE
```

Contoh atribut resource:

```text
tenant = A
risk = HIGH
status = PENDING_APPROVAL
classification = RESTRICTED
```

Contoh atribut environment:

```text
channel = INTRANET
time = BUSINESS_HOURS
ipZone = GOVERNMENT_NETWORK
mfaLevel = PHISHING_RESISTANT
```

Policy:

```text
Allow APPROVE_CASE if:
- subject.role contains CASE_SUPERVISOR
- subject.agency == resource.agency
- resource.status == PENDING_APPROVAL
- subject.id != resource.createdBy
- resource.risk == HIGH implies subject.clearance == HIGH
- action.channel == INTRANET
```

Dalam Java sederhana:

```java
public AuthorizationDecision canApprove(Actor actor, CaseAuthorizationView caze, RequestEnvironment env) {
    if (!actor.hasRole("CASE_SUPERVISOR")) return deny("MISSING_ROLE");
    if (!actor.activeTenantId().equals(caze.tenantId())) return deny("TENANT_MISMATCH");
    if (!"PENDING_APPROVAL".equals(caze.status())) return deny("INVALID_STATE");
    if (actor.subjectId().equals(caze.createdBy())) return deny("MAKER_CHECKER");
    if (caze.highRisk() && !actor.hasClearance("HIGH")) return deny("INSUFFICIENT_CLEARANCE");
    if (caze.highRisk() && !env.isIntranet()) return deny("INTRANET_REQUIRED");
    return allow();
}
```

---

## 22. Policy Decision Point and Policy Enforcement Point

Gunakan konsep:

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
PIP = Policy Information Point
PAP = Policy Administration Point
```

Dalam aplikasi Jakarta:

```text
Controller/JAX-RS Resource  = PEP coarse boundary
Application Service         = PEP state-changing boundary
Authorization Service       = PDP
Repository/User Directory   = PIP
Admin Console/Config        = PAP
Audit Service               = Decision record
```

Contoh:

```text
JAX-RS endpoint receives approve request
        |
        v
Application service loads actor + case
        |
        v
Authorization service decides
        |
        v
Service enforces allow/deny
        |
        v
Audit service records decision
```

Penting:

> PDP boleh memberikan decision. PEP yang harus benar-benar menghentikan action.

Jangan punya PDP bagus tetapi PEP lupa memanggilnya.

---

## 23. Centralized vs Distributed Authorization

### 23.1 Centralized authorization

Semua policy penting berada di satu service/class/module.

Kelebihan:

- konsisten,
- mudah diaudit,
- mudah diuji,
- mudah review.

Kekurangan:

- bisa menjadi God service,
- coupling ke banyak domain,
- sulit scale organisasi.

### 23.2 Distributed authorization

Setiap bounded context punya policy sendiri.

Kelebihan:

- domain ownership jelas,
- lebih modular,
- policy dekat dengan domain.

Kekurangan:

- bisa tidak konsisten,
- sulit enforce cross-cutting invariant,
- audit lebih kompleks.

### 23.3 Rekomendasi praktis

Untuk monolith/modular monolith:

```text
One authorization module per bounded context,
plus shared primitives and audit contract.
```

Contoh:

```text
security-core
  - Actor
  - AuthorizationDecision
  - Permission
  - Audit contract

case-domain
  - CaseAuthorizationService

appeal-domain
  - AppealAuthorizationService

user-admin-domain
  - UserAdminAuthorizationService
```

Untuk microservices:

```text
Each service owns domain authorization for its resources.
Central IAM owns authentication and coarse role/claim mapping.
```

Jangan membuat satu IAM service eksternal menentukan semua object-level authorization jika ia tidak punya state domain terbaru.

---

## 24. Permission Explosion Problem

Permission explosion terjadi ketika permission terlalu granular.

Contoh buruk:

```text
case:view:own:draft:agency-a:internet
case:view:own:draft:agency-a:intranet
case:view:team:draft:agency-a:internet
case:view:team:draft:agency-a:intranet
case:approve:high-risk:agency-a:intranet:before-sla
...
```

Ini tidak scalable.

Solusi:

1. Permission sebagai capability dasar.
2. Constraint dievaluasi dengan atribut runtime.
3. Role mapping jangan memasukkan semua state/tenant/channel.

Lebih sehat:

```text
Permission: case:approve
Runtime constraints:
- tenant match
- state pending approval
- not maker
- high risk requires clearance
- channel must be intranet
```

Permission bukan tempat semua business rule dimasukkan.

---

## 25. Policy Cache

Authorization sering membutuhkan data:

- role mapping,
- group mapping,
- tenant membership,
- team membership,
- delegation,
- clearance,
- feature flag,
- policy version.

Caching bisa membantu, tetapi berbahaya.

### 25.1 Data yang relatif aman dicache

```text
- static permission catalog
- role-to-permission mapping versioned
- non-sensitive lookup labels
```

### 25.2 Data yang harus hati-hati dicache

```text
- tenant membership
- active role assignment
- delegation
- account status
- revoked privilege
- emergency suspension
```

### 25.3 Invariant cache

```text
Deny must become effective quickly.
```

Jika user role dicabut, jangan sampai privilege bertahan terlalu lama.

Strategi:

- short TTL,
- event-based invalidation,
- cache version,
- session refresh,
- re-check on sensitive action,
- forced logout for critical revocation.

---

## 26. Authorization and Transactions

Authorization yang membaca state domain harus konsisten dengan perubahan state.

Masalah:

```text
Check permission outside transaction.
Then mutate inside transaction.
State changes between check and mutation.
```

Lebih aman:

```java
@Transactional
public void approve(String caseId) {
    Actor actor = actorProvider.currentActor();
    CaseRecord caze = caseRepository.findByIdForUpdate(caseId).orElseThrow();

    AuthorizationDecision decision = authorizationService.canApprove(actor, caze.toAuthorizationView());
    if (decision.isDenied()) {
        throw new ForbiddenException();
    }

    caze.approve(actor.subjectId());
}
```

Gunakan:

- optimistic locking,
- pessimistic locking untuk critical approval,
- database constraint untuk invariant penting,
- idempotency key untuk repeated action.

---

## 27. Deny by Default

Default authorization stance:

```text
Unknown action -> deny
Unknown state -> deny
Unknown tenant -> deny
Missing actor -> deny/auth required
Missing policy -> deny
Ambiguous identity -> deny
Backend unavailable for critical policy -> fail closed
```

Contoh:

```java
public AuthorizationDecision canPerform(Actor actor, CaseAuthorizationView caze, CaseAction action) {
    if (actor == null) return deny("NO_ACTOR");
    if (caze == null) return deny("NO_RESOURCE");
    if (action == null) return deny("NO_ACTION");

    if (!actor.belongsToTenant(caze.tenantId())) {
        return deny("TENANT_MISMATCH");
    }

    switch (action) {
        case VIEW: return canView(actor, caze);
        case APPROVE: return canApprove(actor, caze);
        default: return deny("UNKNOWN_ACTION");
    }
}
```

---

## 28. 401, 403, 404, 409 Dalam Domain Authorization

Gunakan status dengan benar.

| Situation | HTTP |
|---|---:|
| Caller belum authenticated | 401 |
| Caller authenticated tetapi tidak boleh action | 403 |
| Resource tidak ada | 404 |
| Resource ada tetapi caller tidak boleh tahu existence lintas tenant | 404 |
| State berubah sehingga action tidak lagi valid | 409 |
| Request valid tapi membutuhkan step-up/MFA | 401/403 dengan challenge atau domain response |

Contoh:

```java
if (!authenticated) {
    throw new NotAuthenticatedException(); // 401
}

Optional<CaseRecord> caze = repository.findByIdAndTenant(caseId, actor.activeTenantId());
if (caze.isEmpty()) {
    throw new NotFoundException(); // 404, avoid tenant enumeration
}

AuthorizationDecision decision = authz.canApprove(actor, caze.get().toAuthorizationView());
if (decision.reasonCode().equals("INVALID_CASE_STATE")) {
    throw new ConflictException(decision.safeMessage()); // 409
}

if (decision.isDenied()) {
    throw new ForbiddenException(decision.safeMessage()); // 403
}
```

---

## 29. Auditability of Authorization

Authorization decision harus bisa dijelaskan.

Minimal audit event:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decision": "DENY",
  "reasonCode": "MAKER_CHECKER_VIOLATION",
  "subjectId": "user-123",
  "tenantId": "agency-a",
  "action": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "C-2026-001",
  "resourceState": "PENDING_APPROVAL",
  "policyVersion": "case-authz-v7",
  "correlationId": "req-abc",
  "timestamp": "2026-06-17T09:00:00Z"
}
```

Jangan log credential, token, atau data sensitif yang tidak perlu.

Bedakan:

```text
User-facing denial message:
    You cannot approve this case.

Internal audit reason:
    MAKER_CHECKER_VIOLATION: actor=user-123 createdBy=user-123
```

---

## 30. Testing Programmatic Authorization

Authorization harus diuji dengan matrix.

Contoh matrix:

| Actor Role | Tenant Match | State | Creator? | High Risk | Expected |
|---|---|---|---|---|---|
| CASE_SUPERVISOR | yes | PENDING_APPROVAL | no | no | ALLOW |
| CASE_SUPERVISOR | no | PENDING_APPROVAL | no | no | DENY |
| CASE_SUPERVISOR | yes | DRAFT | no | no | DENY |
| CASE_SUPERVISOR | yes | PENDING_APPROVAL | yes | no | DENY |
| CASE_SUPERVISOR | yes | PENDING_APPROVAL | no | yes | DENY unless high-risk role |
| CASE_OFFICER | yes | PENDING_APPROVAL | no | no | DENY |

JUnit example:

```java
class CaseAuthorizationServiceTest {

    private final CaseAuthorizationService service = new CaseAuthorizationService();

    @Test
    void supervisorCanApprovePendingCaseInSameTenantWhenNotCreator() {
        Actor actor = TestActors.supervisor("user-1", "agency-a");
        CaseAuthorizationView caze = TestCases.pendingApproval("case-1", "agency-a", "user-2");

        AuthorizationDecision decision = service.canApprove(actor, caze);

        assertTrue(decision.isAllowed());
    }

    @Test
    void creatorCannotApproveOwnCase() {
        Actor actor = TestActors.supervisor("user-1", "agency-a");
        CaseAuthorizationView caze = TestCases.pendingApproval("case-1", "agency-a", "user-1");

        AuthorizationDecision decision = service.canApprove(actor, caze);

        assertTrue(decision.isDenied());
        assertEquals("MAKER_CHECKER_VIOLATION", decision.reasonCode());
    }
}
```

Testing principles:

1. Test allow and deny.
2. Test cross-tenant.
3. Test wrong state.
4. Test missing role.
5. Test maker-checker.
6. Test stale version.
7. Test delegation.
8. Test policy cache invalidation.
9. Test service method actually enforces decision.
10. Test UI action availability does not replace backend enforcement.

---

## 31. Integration with Jakarta Security

Jakarta Security `SecurityContext` menyediakan programmatic API seperti role check dan access check terhadap web resource. Tetapi domain authorization tetap harus berada di aplikasi.

Contoh integration:

```java
@Path("/cases/{caseId}/approval")
@RequestScoped
public class CaseApprovalResource {

    @Inject
    CaseApprovalService approvalService;

    @POST
    @RolesAllowed("CASE_SUPERVISOR")
    public Response approve(@PathParam("caseId") String caseId, ApproveCaseRequest request) {
        approvalService.approve(caseId, new ApproveCaseCommand(request.comment()));
        return Response.noContent().build();
    }
}
```

Di sini:

```text
@RolesAllowed("CASE_SUPERVISOR")
```

adalah coarse gate.

Sedangkan:

```java
authorizationService.canApprove(actor, caseRecord)
```

adalah domain gate.

Keduanya saling melengkapi.

---

## 32. Integration with Jakarta Authorization / JACC

Jakarta Authorization/JACC berada di level container permission SPI. Ia penting untuk container authorization model.

Namun object-level domain authorization biasanya tetap di application/domain layer, karena:

- domain object state ada di database aplikasi,
- workflow state berubah runtime,
- tenant/assignment/relationship kompleks,
- denial reason butuh domain semantic,
- audit business action butuh konteks kaya.

Pola yang masuk akal:

```text
Jakarta Authorization:
    container-level permission enforcement
    URL/EJB/resource boundary

Domain Authorization Service:
    object-level/stateful/business authorization
```

Jangan mencoba memasukkan seluruh workflow permission ke container policy jika policy butuh state domain yang berubah terus.

---

## 33. Anti-Patterns

### 33.1 Role-only authorization

```java
if (securityContext.isCallerInRole("ADMIN")) {
    doAnything();
}
```

Masalah:

- terlalu coarse,
- audit buruk,
- privilege terlalu luas,
- sulit least privilege.

### 33.2 Authorization hanya di controller

```java
@Path("/cases")
public class CaseResource {
    @POST
    @RolesAllowed("CASE_SUPERVISOR")
    public Response approve(...) {
        caseService.approve(...); // service can be called elsewhere without authz
    }
}
```

Service bisa dipanggil dari batch, listener, GraphQL, internal API, atau test bypass.

Critical domain mutation harus enforce di service.

### 33.3 UI-only authorization

Tombol disembunyikan tetapi endpoint tetap bisa dipanggil.

### 33.4 Hardcoded external group

```java
if (jwt.groups().contains("AAD-GRP-PRD-ACEAS-CASE-SUPERVISOR-001"))
```

Masalah:

- coupling ke IdP,
- group rename memecahkan aplikasi,
- sulit migration,
- sulit multi-env.

Gunakan role mapping layer.

### 33.5 Permission string tersebar

```java
if (has("case:approve")) ...
if (has("CASE_APPROVE")) ...
if (has("approve_case")) ...
```

Gunakan enum/catalog.

### 33.6 Fail open saat policy backend error

```java
try {
    return policyService.allow(...);
} catch (Exception e) {
    return true;
}
```

Untuk critical authorization, fail closed.

### 33.7 Authorization after mutation

```java
caseRecord.approve();
if (!canApprove(actor, caseRecord)) throw Forbidden;
```

Terlambat.

### 33.8 Audit hanya action sukses

Denied attempt juga penting.

### 33.9 Tidak menguji negative cases

Security test yang hanya menguji happy path tidak cukup.

---

## 34. Design Heuristics untuk Top-Level Engineer

Gunakan pertanyaan ini saat design/review:

1. Apa subject yang melakukan action?
2. Apakah subject adalah human, service account, atau delegated actor?
3. Apa action bisnisnya?
4. Apa resource-nya?
5. Apa tenant boundary-nya?
6. Apa state resource saat ini?
7. Apa relationship subject terhadap resource?
8. Apakah role cukup sebagai coarse gate?
9. Permission apa yang merepresentasikan capability?
10. Constraint runtime apa yang harus dievaluasi?
11. Apakah authorization dicek dalam transaction yang sama dengan mutation?
12. Apa yang terjadi jika state berubah setelah UI menampilkan tombol?
13. Apa denial reason yang aman untuk user?
14. Apa denial reason detail untuk audit?
15. Apakah privilege revocation efektif cukup cepat?
16. Apakah policy bisa diuji dengan matrix?
17. Apakah backend tetap aman jika UI dimodifikasi?
18. Apakah service method bisa dipanggil dari jalur lain?
19. Apakah default untuk unknown action adalah deny?
20. Apakah cross-tenant access mengembalikan 404 atau 403?

---

## 35. Reference Architecture

```text
HTTP Request
    |
    v
Servlet/JAX-RS boundary
    - authentication already established
    - @RolesAllowed coarse gate
    |
    v
ActorProvider
    - principal -> actor
    - roles/groups -> app roles
    - session/token -> tenant/delegation context
    |
    v
Application Service
    - load resource authorization view
    - transaction/lock if mutation
    |
    v
Domain Authorization Service
    - capability check
    - tenant check
    - state check
    - relationship check
    - risk/channel/delegation check
    |
    v
Decision
    - allow
    - deny
    - require step-up
    - require second approval
    |
    v
Audit Decision
    |
    v
Mutate / Return Error
```

---

## 36. Practical Checklist

Sebelum production, pastikan:

```text
[ ] Semua endpoint sensitif punya coarse gate.
[ ] Semua state-changing service method punya domain authorization.
[ ] Tenant filtering dilakukan di query/repository layer.
[ ] Authorization decision bukan boolean saja untuk critical operation.
[ ] Denial reason punya code stabil.
[ ] Audit mencatat allow dan deny untuk action penting.
[ ] Policy diuji dengan matrix allow/deny.
[ ] UI permission tidak menjadi enforcement utama.
[ ] Unknown action/state fail closed.
[ ] Role mapping tidak hardcode external IdP group.
[ ] Maker-checker invariant diuji.
[ ] Cross-tenant access diuji.
[ ] Authorization dicek ulang dalam transaction.
[ ] Cache role/membership punya invalidation/TTL.
[ ] Privilege revocation punya SLA.
[ ] Service account dan human actor dibedakan.
[ ] Delegation punya scope, time window, revocation, audit.
[ ] 401/403/404/409 semantics konsisten.
```

---

## 37. Ringkasan Mental Model

Declarative authorization melindungi pintu masuk.

Programmatic authorization melindungi aksi bisnis.

Role menjawab:

```text
Apakah caller punya kategori akses umum?
```

Permission menjawab:

```text
Apakah caller punya capability tertentu?
```

Domain authorization menjawab:

```text
Apakah caller boleh melakukan action ini terhadap resource ini,
dalam tenant ini, pada state ini, dengan relationship ini,
pada waktu/channel/konteks ini?
```

Untuk sistem enterprise/regulatory, authorization yang defensible harus:

- eksplisit,
- diuji,
- diaudit,
- fail closed,
- dekat dengan domain mutation,
- aware terhadap tenant/state/relationship,
- tidak bergantung pada UI,
- tidak hanya role-based.

---

## 38. Hubungan ke Part Berikutnya

Part ini membangun pondasi domain authorization.

Part berikutnya akan membahas satu sumber kebingungan terbesar dalam sistem IAM enterprise:

```text
Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
```

Kita akan membedah bagaimana external IdP group, OIDC claim, OAuth scope, Jakarta role, Spring authority, application permission, dan domain entitlement sering tercampur, lalu bagaimana mendesain mapping layer yang stabil dan tidak rapuh terhadap perubahan IdP.

---

## 39. Status Seri

```text
Selesai:
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
Part 06 — Jakarta Security API Core
Part 07 — SecurityContext Deep Dive
Part 08 — IdentityStore Deep Dive
Part 09 — Credentials and Password Handling in Jakarta Applications
Part 10 — Jakarta Authentication / JASPIC Deep Dive
Part 11 — Jakarta Authorization / JACC Deep Dive
Part 12 — Declarative Authorization: URL, Method, Class, Role
Part 13 — Programmatic Authorization and Domain Permission Design

Belum selesai.

Berikutnya:
Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 12 — Declarative Authorization: URL, Method, Class, Role](./learn-java-jakarta-security-authentication-authorization-identity-part-12-declarative-authorization.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning](./learn-java-jakarta-security-authentication-authorization-identity-part-14-roles-groups-claims-scopes-authorities-mapping.md)

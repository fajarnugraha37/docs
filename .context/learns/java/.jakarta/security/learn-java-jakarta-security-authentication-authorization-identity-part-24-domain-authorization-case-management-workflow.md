# Part 24 — Domain Authorization for Case Management and Workflow Systems

> Series: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-24-domain-authorization-case-management-workflow.md`  
> Scope: Java 8–25, Java EE/Jakarta EE, Servlet/JAX-RS/CDI/EJB, Jakarta Security, Jakarta Authorization, enterprise workflow/case-management systems

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 23, kita sudah membangun fondasi:

1. apa itu identity, principal, role, group, permission;
2. bagaimana container Jakarta membentuk authenticated caller;
3. bagaimana declarative dan programmatic authorization bekerja;
4. bagaimana roles/groups/claims/scopes dipetakan;
5. bagaimana session/token/context/tenant boundary bekerja.

Part ini masuk ke area yang lebih dekat dengan real enterprise/regulatory system:

```text
authorization di sistem case management dan workflow
```

Di sistem seperti ini, pertanyaan authorization tidak cukup dijawab dengan:

```java
securityContext.isCallerInRole("OFFICER")
```

Pertanyaan nyata biasanya seperti:

```text
Apakah user ini boleh approve case ini, pada state ini, untuk agency ini,
setelah dia sebelumnya pernah membuat recommendation, dengan SLA sudah lewat,
dan case sedang dalam escalation route tertentu?
```

Atau:

```text
Apakah user ini boleh reassign case dari officer A ke officer B,
kalau case sudah masuk legal review dan user adalah supervisor dari unit berbeda?
```

Atau:

```text
Apakah user ini boleh melihat document internal pada appeal case,
kalau dia punya role case officer tetapi bukan assigned officer dan bukan delegated officer?
```

Inilah domain authorization.

---

## 1. Core Thesis

Untuk workflow/case-management system, authorization harus dipahami sebagai fungsi domain:

```text
can(actor, action, resource, context) -> decision
```

Bukan sekadar:

```text
user has role X
```

Dan bukan sekadar:

```text
token contains scope Y
```

Model yang lebih benar:

```text
Decision = f(
  actor identity,
  actor roles,
  actor organization,
  actor delegation,
  requested action,
  resource type,
  resource identity,
  resource owner,
  resource state,
  workflow transition,
  assignment,
  historical participation,
  tenant boundary,
  risk level,
  emergency override,
  time,
  policy version
)
```

Dalam sistem case management, authorization adalah bagian dari domain model, bukan hanya security plumbing.

---

## 2. Kenapa Workflow Authorization Berbeda Dari CRUD Authorization

CRUD authorization biasanya seperti:

```text
CREATE Application
READ Application
UPDATE Application
DELETE Application
```

Tetapi workflow authorization lebih kompleks:

```text
Submit Application
Withdraw Application
Screen Application
Assign Case
Request Clarification
Recommend Approval
Approve Recommendation
Reject Application
Escalate Case
Return Case
Reopen Case
Close Case
Archive Case
Generate Notice
Override SLA
Transfer Ownership
```

Perbedaannya:

| CRUD Authorization | Workflow Authorization |
|---|---|
| Berbasis operasi data generik | Berbasis tindakan bisnis |
| Biasanya role + resource | Role + resource + state + relationship |
| `UPDATE` terlalu luas | `recommend`, `approve`, `return`, `escalate` berbeda makna |
| Kurang auditable | Lebih mudah dijelaskan dalam bahasa bisnis |
| Sering menyebabkan over-permission | Bisa dibuat least privilege |

Kalau action hanya dimodelkan sebagai `UPDATE_CASE`, maka user yang boleh memperbaiki typo bisa saja secara tidak sengaja juga bisa approve, reject, atau close case.

Dalam sistem enterprise, ini berbahaya.

---

## 3. Vocabulary Domain Authorization

### 3.1 Actor

Actor adalah pihak yang melakukan tindakan.

Contoh:

```text
case officer
supervisor
legal officer
compliance officer
system scheduler
external applicant
agency administrator
delegated officer
break-glass admin
```

Actor tidak selalu sama dengan user login.

Dalam audit, sering perlu dibedakan:

```text
initiator = user yang memulai tindakan
executor  = service/job yang mengeksekusi tindakan
subject   = identity yang dipakai untuk authorization
onBehalfOf = pihak yang diwakili
```

Contoh:

```text
User A clicks "Approve".
Backend service emits event.
Workflow worker completes task.
Notification service sends letter.
```

Audit yang bagus tidak hanya menulis:

```text
SYSTEM approved case
```

Tapi:

```text
initiator=alice
executor=workflow-worker
businessAction=APPROVE_CASE
caseId=CASE-2026-001
```

---

### 3.2 Action

Action adalah tindakan bisnis, bukan HTTP method.

Contoh action buruk:

```text
POST /case/{id}/action
```

Contoh action bagus:

```text
CASE_VIEW
CASE_ASSIGN
CASE_REASSIGN
CASE_RECOMMEND_APPROVAL
CASE_APPROVE
CASE_REJECT
CASE_RETURN_FOR_CLARIFICATION
CASE_ESCALATE
CASE_REOPEN
CASE_CLOSE
CASE_OVERRIDE_SLA
```

Action harus cukup granular supaya bisa diaudit dan diuji.

---

### 3.3 Resource

Resource adalah objek bisnis yang menjadi target authorization.

Contoh:

```text
Application
Case
Appeal
Complaint
Inspection
Investigation
Notice
Document
Minute
Decision
Task
WorkflowTransition
```

Resource sebaiknya punya identity stabil:

```text
resourceType = CASE
resourceId = CASE-2026-000123
```

---

### 3.4 State

State adalah status workflow/resource saat decision dibuat.

Contoh:

```text
DRAFT
SUBMITTED
SCREENING
ASSIGNED
IN_REVIEW
PENDING_CLARIFICATION
RECOMMENDED_APPROVAL
PENDING_APPROVAL
APPROVED
REJECTED
CLOSED
REOPENED
ESCALATED
```

Dalam workflow system, state adalah security input.

Action yang boleh di state `DRAFT` belum tentu boleh di state `PENDING_APPROVAL`.

---

### 3.5 Relationship

Relationship menjelaskan hubungan actor dengan resource.

Contoh:

```text
actor is assigned officer
actor is supervisor of assigned officer
actor belongs to owning agency
actor is document creator
actor is applicant owner
actor is case participant
actor is delegated reviewer
actor previously recommended this decision
actor has conflict of interest
```

Relationship sering lebih penting daripada role.

User dengan role `CASE_OFFICER` belum tentu boleh membuka semua case.

---

### 3.6 Constraint

Constraint adalah rule tambahan.

Contoh:

```text
same user cannot recommend and approve
officer cannot approve own application
legal officer can view legal documents only after legal review starts
external applicant can only view own submission
case cannot be reassigned after closure
emergency override requires reason and second approval
```

Constraint membuat authorization menjadi defensible.

---

## 4. Formula Authorization Untuk Workflow

Gunakan mental model:

```text
can = subjectAllowed
  AND actionAllowed
  AND tenantAllowed
  AND resourceVisible
  AND stateAllowsAction
  AND relationshipAllowsAction
  AND constraintsSatisfied
  AND riskControlsSatisfied
```

Dalam bentuk lebih eksplisit:

```text
can(actor, action, case, ctx) =
    isAuthenticated(actor)
 && hasBaseCapability(actor, action)
 && belongsToTenant(actor, case.tenantId)
 && canSeeCase(actor, case)
 && workflowAllows(case.state, action)
 && relationshipAllows(actor, action, case)
 && separationOfDutySatisfied(actor, action, case)
 && delegationSatisfied(actor, action, case, ctx.now)
 && notRevoked(actor)
 && notLocked(case)
```

Authorization decision harus bisa dijelaskan:

```text
ALLOW because:
- actor has role CASE_SUPERVISOR
- actor belongs to tenant CEA
- case belongs to tenant CEA
- case state is PENDING_APPROVAL
- actor supervises assigned officer
- actor did not create recommendation
```

Atau:

```text
DENY because:
- actor recommended this case earlier
- same actor cannot approve own recommendation
```

---

## 5. Jakarta Layer vs Domain Layer

Jakarta Security memberi identity dan role primitives:

```java
securityContext.getCallerPrincipal();
securityContext.isCallerInRole("CASE_OFFICER");
```

Jakarta Authorization/JACC memberi container-level authorization model berbasis subject/permission.

Tetapi domain workflow authorization tetap perlu service aplikasi:

```java
authorizationService.assertCan(actor, CaseAction.APPROVE, caseRecord);
```

Layering yang sehat:

```text
HTTP/JAX-RS layer
  - authenticate caller
  - coarse endpoint protection
  - parse request

Application service layer
  - load resource
  - authorize action against resource/state/tenant
  - execute command transactionally

Domain layer
  - enforce invariants
  - validate state transition
  - generate domain events

Persistence layer
  - tenant-safe query
  - optimistic locking
  - audit persistence
```

Jangan menaruh semua authorization hanya di controller.

Kenapa?

Karena case bisa diubah dari banyak entry point:

```text
REST endpoint
admin console
batch job
message consumer
scheduled escalation
migration script
internal service call
```

Authorization/invariant penting harus berada di service/domain boundary yang sama dengan command execution.

---

## 6. State-Machine-Aware Authorization

Workflow punya state machine.

Contoh sederhana:

```text
SUBMITTED
  -> SCREENING
  -> ASSIGNED
  -> IN_REVIEW
  -> RECOMMENDED_APPROVAL
  -> PENDING_APPROVAL
  -> APPROVED
  -> CLOSED
```

Authorization harus selaras dengan transition.

Contoh policy:

| Current State | Action | Allowed Actor |
|---|---|---|
| SUBMITTED | SCREEN | Screening Officer |
| ASSIGNED | START_REVIEW | Assigned Officer |
| IN_REVIEW | RECOMMEND_APPROVAL | Assigned Officer |
| RECOMMENDED_APPROVAL | APPROVE | Supervisor, not recommender |
| PENDING_CLARIFICATION | RESPOND_CLARIFICATION | Applicant / External Party |
| APPROVED | CLOSE | System / Supervisor |
| CLOSED | REOPEN | Supervisor with reason |

Jangan hanya memeriksa role.

Buruk:

```java
if (!securityContext.isCallerInRole("SUPERVISOR")) {
    throw forbidden();
}
case.approve();
```

Lebih benar:

```java
authorization.assertCan(actor, CaseAction.APPROVE, caseRecord);
workflow.assertTransitionAllowed(caseRecord.status(), CaseTransition.APPROVE);
caseRecord.approve(actor.id(), clock.instant());
```

Security invariant:

```text
Tidak ada action workflow yang boleh dieksekusi tanpa state validation dan authorization validation terhadap state yang sama.
```

---

## 7. Assignment-Based Authorization

Banyak case system punya assignment.

Contoh:

```text
case.assignedOfficerId
case.assignedTeamId
case.assignedUnitId
case.assignedQueueId
```

Policy umum:

```text
assigned officer can review
team supervisor can reassign
agency admin can view all within agency
external applicant can view only own case
```

Kode konseptual:

```java
boolean canReview(Actor actor, CaseRecord c) {
    return actor.hasRole("CASE_OFFICER")
        && c.isAssignedTo(actor.userId())
        && c.status() == CaseStatus.IN_REVIEW;
}
```

Tapi di sistem nyata, assignment bisa lebih kompleks:

```text
assigned to user
assigned to team queue
assigned to role pool
assigned to unit
assigned temporarily due to leave coverage
assigned by escalation route
```

Maka hindari hardcode terlalu cepat.

Buat model relationship:

```java
public enum CaseRelationship {
    ASSIGNED_OFFICER,
    TEAM_MEMBER,
    TEAM_SUPERVISOR,
    AGENCY_ADMIN,
    APPLICANT_OWNER,
    DELEGATED_OFFICER,
    LEGAL_REVIEWER,
    READ_ONLY_OBSERVER
}
```

Kemudian policy bisa membaca relationship, bukan field mentah.

---

## 8. Maker-Checker / Four-Eyes Control

Maker-checker adalah pola di mana satu orang membuat/merekomendasikan, orang lain memeriksa/menyetujui.

Contoh:

```text
Officer A recommends approval.
Supervisor B approves.
Officer A must not approve own recommendation.
```

Security invariant:

```text
For sensitive decision, maker != checker.
```

Contoh Java:

```java
public Decision canApprove(Actor actor, CaseRecord c) {
    if (!actor.hasRole("CASE_SUPERVISOR")) {
        return Decision.deny("ROLE_REQUIRED", "Supervisor role required");
    }

    if (c.status() != CaseStatus.PENDING_APPROVAL) {
        return Decision.deny("INVALID_STATE", "Case is not pending approval");
    }

    if (actor.userId().equals(c.recommendedBy())) {
        return Decision.deny("MAKER_CHECKER_VIOLATION", "Recommender cannot approve own recommendation");
    }

    return Decision.allow("Supervisor may approve pending recommendation");
}
```

Maker-checker bukan UI rule.

Harus ada di backend.

Kalau hanya disembunyikan di UI, user masih bisa memanggil API langsung.

---

## 9. Separation of Duties

Separation of Duties atau SoD mencegah konflik peran atau konflik aktivitas.

Ada beberapa tipe:

### 9.1 Static Separation of Duties

User tidak boleh punya dua role yang konflik.

Contoh:

```text
A user cannot be both PAYMENT_PREPARER and PAYMENT_APPROVER.
```

### 9.2 Dynamic Separation of Duties

User boleh punya dua role, tetapi tidak boleh menjalankan dua aktivitas konflik pada objek yang sama.

Contoh:

```text
A supervisor may generally approve cases,
but cannot approve a case they personally recommended.
```

### 9.3 Object-Based Separation of Duties

Constraint berlaku per object/resource.

Contoh:

```text
User A can recommend Case 1 and approve Case 2,
but cannot recommend and approve Case 1.
```

Workflow system biasanya membutuhkan dynamic/object-based SoD, bukan hanya role assignment static.

---

## 10. Delegation

Delegation terjadi saat user memberikan kewenangan sementara kepada user lain.

Contoh:

```text
Officer A on leave delegates review tasks to Officer B from 2026-06-17 to 2026-06-21.
```

Delegation harus punya batas:

```text
delegator
delegatee
scope
tenant
resource type
action set
start time
end time
reason
approval status
revocation status
```

Model:

```java
public record Delegation(
    UserId delegator,
    UserId delegatee,
    TenantId tenantId,
    Set<CaseAction> actions,
    Instant validFrom,
    Instant validUntil,
    boolean revoked
) {}
```

Policy:

```java
boolean hasEffectiveAuthority(Actor actor, CaseAction action, CaseRecord c) {
    return actor.directlyAllowed(action, c)
        || delegationService.hasActiveDelegation(actor.userId(), action, c.tenantId(), clock.instant());
}
```

Audit harus mencatat:

```text
actor = delegatee
onBehalfOf = delegator
delegationId = DEL-123
```

Tanpa itu, forensic trail menjadi kabur.

---

## 11. Escalation

Escalation biasanya terjadi karena:

```text
SLA breach
risk score high
manual escalation
complaint received
legal issue detected
system exception
```

Escalation mengubah authorization.

Contoh:

```text
Before escalation:
  assigned officer can act

After escalation:
  only supervisor/legal reviewer can act
```

State dan escalation flag harus ikut decision.

Buruk:

```java
return actor.hasRole("CASE_OFFICER") && c.isAssignedTo(actor.userId());
```

Lebih benar:

```java
if (c.isEscalated()) {
    return actor.hasAnyRole("SUPERVISOR", "LEGAL_REVIEWER");
}

return actor.hasRole("CASE_OFFICER") && c.isAssignedTo(actor.userId());
```

Escalation juga harus diaudit sebagai state/security event.

---

## 12. Emergency Override / Break-Glass Access

Break-glass adalah akses darurat yang melampaui policy normal.

Contoh:

```text
A critical production case is stuck.
Senior admin uses emergency override to reassign it.
```

Break-glass bukan berarti bebas.

Minimal harus ada:

```text
explicit permission
strong authentication / step-up auth
mandatory reason
limited action scope
limited time window
automatic audit alert
post-action review
```

Model authorization:

```java
if (normalPolicy.allows(actor, action, c)) {
    return Decision.allow("NORMAL_POLICY");
}

if (breakGlassPolicy.allows(actor, action, c, request.reason())) {
    return Decision.allowWithObligation(
        "BREAK_GLASS",
        List.of("AUDIT_HIGH_RISK", "NOTIFY_SECURITY_ADMIN", "REVIEW_REQUIRED")
    );
}

return Decision.deny("POLICY_DENIED");
```

Break-glass harus menghasilkan obligation.

Obligation adalah hal yang wajib dilakukan jika decision allow.

Contoh obligation:

```text
write high-risk audit
notify supervisor
create review task
require second approval
mask sensitive data
```

---

## 13. Authorization Snapshot vs Live Authorization

Ada dua strategi:

### 13.1 Live Authorization

Setiap action memakai data terbaru.

Keuntungan:

```text
role removal langsung efektif
assignment update langsung efektif
case state terbaru dipakai
```

Kerugian:

```text
lebih mahal
bisa berubah di tengah proses panjang
lebih sulit menjelaskan historical decision kalau policy/data berubah
```

### 13.2 Authorization Snapshot

Decision disimpan pada saat tertentu.

Contoh:

```text
when task assigned, store eligible approver group snapshot
```

Keuntungan:

```text
deterministic untuk workflow lama
auditable
stabil saat policy berubah
```

Kerugian:

```text
bisa mempertahankan akses yang seharusnya sudah dicabut
perlu invalidation/revocation policy
```

Praktik umum:

```text
Use live authorization for high-risk actions.
Use snapshot for audit explanation and workflow assignment history.
```

Jangan snapshot permission sensitif tanpa expiry/revalidation.

---

## 14. Race Condition dan TOCTOU

TOCTOU = Time Of Check To Time Of Use.

Contoh bug:

```text
1. User A checks: can approve? yes, case is PENDING_APPROVAL.
2. User B approves the same case.
3. User A approval continues using stale state.
4. Case approved twice or overwritten.
```

Authorization harus dekat dengan mutation.

Buruk:

```java
CaseRecord c = caseRepository.find(id);
authorization.assertCan(actor, APPROVE, c);
// long processing
caseRepository.approve(id);
```

Lebih benar:

```java
@Transactional
public void approveCase(CaseId id, Actor actor, ApproveCommand cmd) {
    CaseRecord c = caseRepository.findForUpdate(id)
        .orElseThrow(NotFoundException::new);

    authorization.assertCan(actor, CaseAction.APPROVE, c);
    c.approve(actor.userId(), cmd.reason(), clock.instant());
    audit.record(actor, CaseAction.APPROVE, c);
}
```

Atau gunakan optimistic locking:

```java
UPDATE case_table
SET status = 'APPROVED', version = version + 1
WHERE id = ?
  AND status = 'PENDING_APPROVAL'
  AND version = ?
```

Invariant penting:

```text
The state used for authorization must be the same state being mutated.
```

---

## 15. Domain Authorization Service Pattern

Buat service khusus, bukan menyebar `if` di controller.

```java
public interface CaseAuthorizationService {
    Decision canView(Actor actor, CaseRecord c);
    Decision canAssign(Actor actor, CaseRecord c);
    Decision canRecommendApproval(Actor actor, CaseRecord c);
    Decision canApprove(Actor actor, CaseRecord c);
    Decision canReject(Actor actor, CaseRecord c);
    Decision canReopen(Actor actor, CaseRecord c);
}
```

Atau generic:

```java
public interface AuthorizationService {
    Decision decide(Actor actor, Action action, ResourceRef resource, AuthorizationContext ctx);
}
```

Untuk case management, biasanya lebih enak gabungan:

```text
Generic engine untuk shared concept.
Domain-specific service untuk readability.
```

Contoh:

```java
Decision decision = caseAuthorization.canApprove(actor, caseRecord);
if (decision.denied()) {
    throw new ForbiddenException(decision.publicMessage());
}
```

Decision jangan hanya boolean.

Gunakan rich decision.

```java
public record Decision(
    boolean allowed,
    String code,
    String publicMessage,
    String internalReason,
    List<String> obligations
) {
    public static Decision allow(String reason) {
        return new Decision(true, "ALLOW", "Allowed", reason, List.of());
    }

    public static Decision deny(String code, String reason) {
        return new Decision(false, code, "You are not allowed to perform this action", reason, List.of());
    }
}
```

Kenapa?

Karena production butuh:

```text
user-facing message
admin diagnostic
structured audit
policy debugging
metrics by denial reason
```

---

## 16. Actor Model Untuk Jakarta Application

Jangan langsung pakai `Principal` sebagai domain actor.

`Principal` biasanya hanya punya name.

Lebih baik map ke `Actor`:

```java
public record Actor(
    UserId userId,
    String username,
    TenantId activeTenant,
    Set<String> roles,
    Set<String> groups,
    Set<String> permissions,
    Set<OrganizationId> organizations,
    boolean systemActor
) {
    boolean hasRole(String role) {
        return roles.contains(role);
    }
}
```

Mapper:

```java
@RequestScoped
public class ActorProvider {
    @Inject SecurityContext securityContext;
    @Inject UserDirectory userDirectory;

    public Actor currentActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new NotAuthenticatedException();
        }
        return userDirectory.resolveActor(principal.getName());
    }
}
```

Ingat:

```text
SecurityContext establishes caller identity.
Domain Actor enriches identity with business-specific attributes.
```

---

## 17. Policy Matrix Untuk Workflow

Policy matrix membantu desain dan testing.

Contoh:

| Action | Required Role | State | Relationship | Constraint |
|---|---|---|---|---|
| VIEW_CASE | CASE_VIEWER | Any non-deleted | Same tenant or assigned | Sensitive document may need extra permission |
| ASSIGN_CASE | CASE_SUPERVISOR | SUBMITTED/SCREENED | Same team/unit | Cannot assign closed case |
| START_REVIEW | CASE_OFFICER | ASSIGNED | Assigned officer | Case not locked |
| RECOMMEND_APPROVAL | CASE_OFFICER | IN_REVIEW | Assigned officer | Required checks complete |
| APPROVE | CASE_SUPERVISOR | PENDING_APPROVAL | Same unit/tenant | Not recommender |
| REJECT | CASE_SUPERVISOR | PENDING_APPROVAL | Same unit/tenant | Not recommender |
| ESCALATE | CASE_OFFICER/SUPERVISOR | IN_REVIEW/PENDING | Assigned/supervisor | Reason required |
| REOPEN | CASE_SUPERVISOR | CLOSED | Same tenant | Reason + within allowed period |
| OVERRIDE_SLA | SENIOR_SUPERVISOR | SLA_BREACHED | Same tenant | Break-glass audit |

Matrix bukan hanya dokumentasi.

Matrix harus menjadi test source.

---

## 18. Permission Naming Strategy

Gunakan nama action yang stabil dan domain-friendly.

Buruk:

```text
POST_CASE_ACTION
UPDATE_CASE_STATUS
SAVE_FORM
```

Bagus:

```text
case.view
case.assign
case.reassign
case.review.start
case.recommend.approval
case.approve
case.reject
case.returnForClarification
case.escalate
case.reopen
case.close
case.overrideSla
case.document.view.internal
case.document.view.external
```

Saran:

```text
<domain>.<resource>.<action>[.<scope>]
```

Contoh:

```text
compliance.case.approve
appeal.case.reopen
application.document.view.internal
inspection.notice.issue
```

Jangan terlalu granular sampai permission tidak bisa dikelola.

Tapi jangan terlalu kasar sampai over-permission.

---

## 19. Relationship Resolver Pattern

Relationship sering perlu query kompleks.

Pisahkan dari policy.

```java
public interface CaseRelationshipResolver {
    Set<CaseRelationship> resolve(Actor actor, CaseRecord c);
}
```

Implementasi:

```java
public Set<CaseRelationship> resolve(Actor actor, CaseRecord c) {
    Set<CaseRelationship> rel = new HashSet<>();

    if (c.assignedOfficerId().equals(actor.userId())) {
        rel.add(CaseRelationship.ASSIGNED_OFFICER);
    }

    if (teamService.isSupervisorOf(actor.userId(), c.assignedOfficerId())) {
        rel.add(CaseRelationship.SUPERVISOR_OF_ASSIGNED_OFFICER);
    }

    if (c.tenantId().equals(actor.activeTenant())) {
        rel.add(CaseRelationship.SAME_TENANT);
    }

    if (delegationService.isDelegate(actor.userId(), c.id())) {
        rel.add(CaseRelationship.DELEGATED_OFFICER);
    }

    return rel;
}
```

Policy menjadi lebih readable:

```java
return actor.hasRole("CASE_SUPERVISOR")
    && rel.contains(SAME_TENANT)
    && rel.contains(SUPERVISOR_OF_ASSIGNED_OFFICER)
    && c.status() == PENDING_APPROVAL;
```

---

## 20. Data Visibility vs Action Authorization

Ada dua pertanyaan berbeda:

```text
Can actor see this case?
Can actor perform this action on this case?
```

Jangan dicampur.

Contoh:

```text
A supervisor may view all cases in the unit,
but can only approve cases pending approval.
```

Contoh:

```text
A legal officer may view legal notes,
but cannot approve business decision.
```

Model:

```java
canView(actor, case)
canViewInternalDocuments(actor, case)
canUpdate(actor, case)
canApprove(actor, case)
```

Untuk list endpoint, visibility harus diterapkan di query, bukan filter setelah fetch semua data.

Buruk:

```java
List<CaseRecord> all = caseRepository.findAll();
return all.stream().filter(c -> auth.canView(actor, c)).toList();
```

Lebih benar:

```java
CaseVisibilityScope scope = visibilityService.scopeFor(actor);
return caseRepository.searchWithinScope(scope, criteria);
```

---

## 21. Tenant + Workflow + Assignment Query Enforcement

Untuk search/list:

```sql
SELECT *
FROM cases c
WHERE c.tenant_id = :tenantId
  AND (
       c.assigned_officer_id = :userId
       OR c.assigned_team_id IN (:teamIds)
       OR :isSupervisor = true
  )
```

Tapi hati-hati dengan role boolean global.

Lebih baik scope object:

```java
public sealed interface CaseVisibilityScope {
    record OwnCases(UserId userId, TenantId tenantId) implements CaseVisibilityScope {}
    record TeamCases(Set<TeamId> teamIds, TenantId tenantId) implements CaseVisibilityScope {}
    record TenantCases(TenantId tenantId) implements CaseVisibilityScope {}
    record NoAccess() implements CaseVisibilityScope {}
}
```

Repository menerima scope:

```java
Page<CaseSummary> search(CaseVisibilityScope scope, CaseSearchCriteria criteria);
```

Ini mencegah query lupa tenant filter.

---

## 22. Workflow Action Command Pattern

Jangan expose endpoint generik:

```http
POST /cases/{id}/status
```

Karena ini membuat authorization ambigu.

Lebih baik action endpoint eksplisit:

```http
POST /cases/{id}/recommend-approval
POST /cases/{id}/approve
POST /cases/{id}/reject
POST /cases/{id}/return-for-clarification
POST /cases/{id}/escalate
POST /cases/{id}/reopen
```

Atau command body eksplisit:

```json
{
  "action": "APPROVE",
  "reason": "All checks completed"
}
```

Tetapi backend tetap harus dispatch ke command handler spesifik:

```java
approveCaseHandler.handle(actor, command);
```

Setiap command handler wajib:

```text
load aggregate
check authorization
check state transition
mutate
write audit
publish event
commit
```

---

## 23. Example: Approve Case Handler

```java
@ApplicationScoped
public class ApproveCaseHandler {

    @Inject CaseRepository caseRepository;
    @Inject CaseAuthorizationService authorization;
    @Inject AuditService audit;
    @Inject Clock clock;

    @Transactional
    public void handle(Actor actor, ApproveCaseCommand command) {
        CaseRecord caseRecord = caseRepository.findForUpdate(command.caseId())
            .orElseThrow(() -> new NotFoundException("Case not found"));

        Decision decision = authorization.canApprove(actor, caseRecord);
        if (!decision.allowed()) {
            audit.authorizationDenied(actor, CaseAction.APPROVE, caseRecord, decision);
            throw new ForbiddenException(decision.publicMessage());
        }

        caseRecord.approve(actor.userId(), command.reason(), clock.instant());

        audit.businessAction(actor, CaseAction.APPROVE, caseRecord, decision);
        caseRepository.save(caseRecord);
    }
}
```

Perhatikan urutannya:

```text
lock/load current state
authorize current state
mutate current state
write audit in same transaction or reliable outbox
```

---

## 24. Example: Authorization Service

```java
@ApplicationScoped
public class DefaultCaseAuthorizationService implements CaseAuthorizationService {

    @Inject CaseRelationshipResolver relationshipResolver;
    @Inject DelegationService delegationService;
    @Inject Clock clock;

    @Override
    public Decision canApprove(Actor actor, CaseRecord c) {
        if (!actor.authenticated()) {
            return Decision.deny("NOT_AUTHENTICATED", "Actor is not authenticated");
        }

        if (!actor.activeTenant().equals(c.tenantId())) {
            return Decision.deny("TENANT_MISMATCH", "Actor is outside case tenant");
        }

        if (c.status() != CaseStatus.PENDING_APPROVAL) {
            return Decision.deny("INVALID_STATE", "Case is not pending approval");
        }

        Set<CaseRelationship> rel = relationshipResolver.resolve(actor, c);

        boolean directSupervisor = actor.hasRole("CASE_SUPERVISOR")
            && rel.contains(CaseRelationship.SAME_TENANT)
            && rel.contains(CaseRelationship.SUPERVISOR_OF_ASSIGNED_OFFICER);

        boolean delegated = delegationService.hasActiveDelegation(
            actor.userId(),
            CaseAction.APPROVE,
            c.id(),
            clock.instant()
        );

        if (!directSupervisor && !delegated) {
            return Decision.deny("RELATIONSHIP_REQUIRED", "Actor is not eligible approver");
        }

        if (actor.userId().equals(c.recommendedBy())) {
            return Decision.deny("MAKER_CHECKER_VIOLATION", "Actor recommended this case");
        }

        if (c.hasConflictOfInterest(actor.userId())) {
            return Decision.deny("CONFLICT_OF_INTEREST", "Actor has conflict of interest");
        }

        return Decision.allow("Eligible supervisor may approve pending case");
    }
}
```

---

## 25. Deny Reason Design

Deny reason penting, tetapi harus hati-hati.

Untuk user:

```text
You are not allowed to perform this action.
```

Untuk audit/admin:

```text
DENY: MAKER_CHECKER_VIOLATION
actor=U123
case=CASE-001
recommendedBy=U123
state=PENDING_APPROVAL
```

Jangan bocorkan detail sensitif ke external user.

Contoh berbahaya:

```text
Denied because case belongs to tenant ABC and assigned to officer John.
```

Untuk attacker, itu information disclosure.

Gunakan dua message:

```java
public record Decision(
    boolean allowed,
    String code,
    String publicMessage,
    String internalReason
) {}
```

---

## 26. Audit Model Untuk Domain Authorization

Audit event minimal:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "decision": "DENY",
  "decisionCode": "MAKER_CHECKER_VIOLATION",
  "actorId": "U123",
  "tenantId": "CEA",
  "action": "CASE_APPROVE",
  "resourceType": "CASE",
  "resourceId": "CASE-2026-0001",
  "resourceState": "PENDING_APPROVAL",
  "relationship": ["SAME_TENANT", "SUPERVISOR_OF_ASSIGNED_OFFICER"],
  "policyVersion": "case-authz-v2026-06",
  "correlationId": "...",
  "occurredAt": "2026-06-17T10:15:30Z"
}
```

Business event audit:

```json
{
  "eventType": "CASE_APPROVED",
  "actorId": "U456",
  "action": "CASE_APPROVE",
  "caseId": "CASE-2026-0001",
  "previousState": "PENDING_APPROVAL",
  "newState": "APPROVED",
  "reason": "All checks completed",
  "policyDecisionCode": "ALLOW",
  "policyVersion": "case-authz-v2026-06"
}
```

Untuk regulatory defensibility, audit harus menjawab:

```text
Who did what?
On which resource?
Under what authority?
At what time?
Based on what state?
Was maker-checker satisfied?
Was delegation involved?
Was emergency override used?
What changed?
```

---

## 27. Policy Versioning

Policy berubah dari waktu ke waktu.

Contoh:

```text
Before June 2026:
  Supervisor can approve all same-unit cases.

After June 2026:
  Supervisor cannot approve cases where they participated in earlier review.
```

Audit harus menyimpan policy version.

```text
policyVersion = case-approval-policy-v3
```

Kenapa?

Karena 1 tahun kemudian, auditor bisa bertanya:

```text
Kenapa approval ini valid waktu itu?
```

Jika hanya memakai policy terbaru, jawabannya bisa salah.

---

## 28. Authorization Cache: Useful But Dangerous

Authorization sering mahal karena perlu:

```text
user roles
organization membership
assignment
workflow state
delegation
conflict data
policy
```

Cache boleh, tapi hati-hati.

Jangan cache decision terlalu lama untuk action sensitif.

Lebih aman cache input yang relatif stabil:

```text
user role mapping with short TTL
organization membership with short TTL
policy metadata
team hierarchy
```

Jangan cache tanpa invalidation:

```text
canApprove(caseId, userId) = true for 1 hour
```

Karena case state bisa berubah.

Rule:

```text
Cache identity attributes cautiously.
Do not cache final decision for stateful workflow mutation unless decision is bound to resource version.
```

Jika perlu cache decision:

```text
cache key = actorId + action + resourceId + resourceVersion + policyVersion
```

---

## 29. UI Authorization vs Backend Authorization

UI boleh menyembunyikan button.

Tapi UI tidak boleh menjadi enforcement.

UI rule:

```text
hide Approve button if user cannot approve
```

Backend rule:

```text
reject Approve command if user cannot approve
```

Keduanya harus konsisten.

Solusi:

Backend menyediakan action availability endpoint:

```http
GET /cases/{id}/available-actions
```

Response:

```json
{
  "caseId": "CASE-2026-0001",
  "state": "PENDING_APPROVAL",
  "actions": [
    { "action": "VIEW", "allowed": true },
    { "action": "APPROVE", "allowed": false, "code": "MAKER_CHECKER_VIOLATION" },
    { "action": "RETURN_FOR_CLARIFICATION", "allowed": true }
  ]
}
```

Tapi command endpoint tetap wajib melakukan check ulang.

---

## 30. Domain Authorization and Jakarta Annotations

Declarative annotations tetap berguna.

Contoh:

```java
@POST
@Path("/{id}/approve")
@RolesAllowed("CASE_SUPERVISOR")
public Response approve(@PathParam("id") String id, ApproveRequest request) {
    Actor actor = actorProvider.currentActor();
    approveCaseHandler.handle(actor, new ApproveCaseCommand(id, request.reason()));
    return Response.noContent().build();
}
```

`@RolesAllowed` di sini adalah coarse gate.

Domain authorization tetap di handler.

```text
@RolesAllowed checks broad capability.
Domain authorization checks actual resource/state/relationship.
```

Ini defense in depth.

---

## 31. Action Availability Pattern

Untuk workflow UI, user perlu tahu action apa yang tersedia.

Service:

```java
public List<ActionAvailability> availableActions(Actor actor, CaseRecord c) {
    return List.of(
        availability(CaseAction.VIEW, canView(actor, c)),
        availability(CaseAction.RECOMMEND_APPROVAL, canRecommendApproval(actor, c)),
        availability(CaseAction.APPROVE, canApprove(actor, c)),
        availability(CaseAction.REJECT, canReject(actor, c)),
        availability(CaseAction.REOPEN, canReopen(actor, c))
    );
}
```

Response untuk UI sebaiknya tidak terlalu bocor.

Untuk internal staff, reason bisa cukup detail.

Untuk external user, reason mungkin generic.

---

## 32. Document-Level Authorization Dalam Case

Case biasanya punya document.

Tidak semua orang yang bisa melihat case boleh melihat semua document.

Document categories:

```text
external submission
internal note
legal advice
investigation evidence
draft decision
final notice
personal data attachment
```

Policy:

```text
Applicant can see submitted documents and final notices.
Case officer can see case documents except legal privileged notes.
Legal reviewer can see legal notes.
Supervisor can see all within unit.
External agency can see shared documents only.
```

Jangan modelkan document visibility hanya sebagai:

```text
canViewCase == canViewAllDocuments
```

Itu overexposure.

---

## 33. Field-Level Authorization

Kadang user boleh melihat case, tapi tidak semua field.

Contoh:

```text
name, address, phone, email, investigation note, risk score, internal recommendation
```

Approach:

```text
resource-level filtering
field-level masking
view model per audience
```

Contoh DTO:

```java
public CaseDetailView toView(Actor actor, CaseRecord c) {
    return new CaseDetailView(
        c.id(),
        c.status(),
        c.applicantName(),
        canViewInternalNotes(actor, c) ? c.internalNotes() : null,
        canViewRiskScore(actor, c) ? c.riskScore() : null
    );
}
```

Tapi field masking harus konsisten dengan export/report/email.

Banyak leakage terjadi bukan dari screen utama, tapi dari:

```text
CSV export
PDF generation
notification template
search index
audit viewer
API response expansion
```

---

## 34. External User vs Internal Officer

Case system sering punya dua dunia:

```text
external portal
internal back office
```

External user:

```text
applicant
representative
licensee
agent
company admin
```

Internal user:

```text
officer
supervisor
legal
admin
system operator
```

Jangan campur role namespace.

Buruk:

```text
ADMIN
USER
OFFICER
```

Lebih baik:

```text
external.applicant
external.companyAdmin
internal.caseOfficer
internal.caseSupervisor
internal.legalReviewer
internal.systemAdmin
```

External dan internal punya trust model berbeda.

---

## 35. Workflow Locking and Authorization

Case bisa terkunci karena:

```text
being edited
pending external response
under legal hold
closed
archived
migration lock
system processing
```

Authorization harus mempertimbangkan lock.

Contoh:

```java
if (c.locked()) {
    return Decision.deny("CASE_LOCKED", "Case is locked");
}
```

Tetapi lock juga punya exception.

```text
system admin can unlock
supervisor can override with reason
system job can complete pending transition
```

Lock harus jelas:

```text
hard lock = no mutation except admin/system
soft lock = warning but allow certain actions
legal hold = no destructive action
```

---

## 36. Reopen / Reverse / Undo Actions

Reopen dan reverse sangat sensitif.

Contoh:

```text
approved case reopened
rejected case reversed
notice withdrawn
decision amended
```

Policy harus mencakup:

```text
who can reopen
allowed states
allowed time window
reason required
whether original approver can reopen
whether second approval required
audit requirements
notification impact
```

Jangan treat reopen sebagai simple update status.

Reopen bisa berdampak hukum/operasional.

---

## 37. Bulk Actions

Bulk action authorization tidak boleh hanya check role sekali.

Buruk:

```java
if (actor.hasRole("SUPERVISOR")) {
    caseRepository.bulkApprove(ids);
}
```

Benar:

```java
for (CaseRecord c : cases) {
    authorization.assertCan(actor, CaseAction.APPROVE, c);
}
```

Untuk performa, bisa optimize dengan batch relationship loading.

Tapi decision tetap per resource.

Response bulk harus menjelaskan partial result:

```json
{
  "approved": ["CASE-001", "CASE-002"],
  "denied": [
    { "caseId": "CASE-003", "code": "MAKER_CHECKER_VIOLATION" },
    { "caseId": "CASE-004", "code": "INVALID_STATE" }
  ]
}
```

---

## 38. Search, Export, Report Authorization

Banyak sistem kuat di detail screen, tapi lemah di export.

Endpoint berisiko:

```text
/cases/search
/cases/export
/reports/case-aging
/documents/download
/audit/search
/admin/user-activity
```

Export harus memakai scope yang sama dengan search.

Report harus jelas apakah aggregated atau row-level.

Contoh:

```text
Officer can see aggregate count for unit,
but not individual case outside assignment.
```

Authorization tidak hanya untuk command, tapi juga query.

CQRS mental model:

```text
Command authorization = can perform action
Query authorization = can see data
```

---

## 39. System Actors and Scheduled Jobs

Workflow punya system jobs:

```text
SLA escalation job
auto-close job
reminder job
sync job
archival job
notification job
```

System actor harus eksplisit.

```java
Actor systemActor = Actor.system("sla-escalation-job");
```

Jangan pakai admin user palsu.

Audit:

```text
actorType=SYSTEM
actorId=sla-escalation-job
trigger=SCHEDULED
```

Jika job menjalankan action karena user sebelumnya:

```text
initiator=userA
executor=systemJob
```

---

## 40. Event-Driven Workflow Authorization

Dalam event-driven system, command bisa melahirkan event.

Contoh:

```text
CaseApproved -> GenerateNotice -> SendEmail -> ArchiveDocument
```

Pertanyaan:

```text
Apakah setiap consumer perlu authorize ulang?
```

Jawaban:

Tergantung.

Gunakan distinction:

```text
business command = perlu authorization user/system
internal consequence = perlu validate event authenticity + allowed producer
```

Consumer harus memastikan event dipercaya:

```text
from trusted topic
valid schema
valid signature if needed
producer authorized
resource state still compatible
```

Jangan izinkan external event langsung mengubah workflow tanpa authorization boundary.

---

## 41. Idempotency and Authorization

Retry bisa terjadi.

Contoh:

```text
Approve request timeout.
Client retries.
```

Jika first request berhasil, second request mungkin melihat state `APPROVED` dan ditolak `INVALID_STATE`.

Untuk UX dan consistency, gunakan idempotency key.

```text
Idempotency-Key: approve-CASE-001-request-abc
```

Authorization tetap dicek pada first execution.

Untuk replay response, jangan re-execute authorization/mutation sembarangan.

Simpan result.

---

## 42. Testing Domain Authorization

Test harus berbasis matrix.

Contoh test dimensions:

```text
role
state
tenant
assignment
maker/checker
conflict
delegation
escalation
lock
resource version
```

Contoh:

```java
@Test
void supervisorCannotApproveCaseTheyRecommended() {
    Actor actor = fixtures.supervisor("U1");
    CaseRecord c = fixtures.caseRecord()
        .tenant(actor.activeTenant())
        .status(PENDING_APPROVAL)
        .recommendedBy(actor.userId())
        .build();

    Decision decision = authorization.canApprove(actor, c);

    assertThat(decision.allowed()).isFalse();
    assertThat(decision.code()).isEqualTo("MAKER_CHECKER_VIOLATION");
}
```

Test negative lebih penting daripada positive.

Harus ada test:

```text
wrong tenant denied
wrong state denied
unassigned officer denied
maker-checker violation denied
expired delegation denied
revoked delegation denied
closed case denied
locked case denied
bulk partial denied
```

---

## 43. Property-Based Thinking

Untuk authorization kompleks, gunakan invariant.

Contoh invariant:

```text
No actor can approve a case they recommended.
No actor outside tenant can mutate case.
Closed case cannot be mutated except reopen.
External user cannot see internal note.
Denied decision must not mutate resource.
Every sensitive mutation must have audit event.
```

Test invariant lebih tahan perubahan daripada test endpoint saja.

---

## 44. Observability

Metrics penting:

```text
authz_decision_total{action,decision,code}
authz_denied_total{action,code}
authz_break_glass_total{action}
authz_policy_latency_ms
authz_relationship_resolution_latency_ms
case_action_total{action,state,result}
```

Logs harus structured:

```text
correlationId
tenantId
actorId
action
resourceType
resourceId
state
decisionCode
policyVersion
```

Jangan log credential/token.

---

## 45. Common Failure Patterns

### 45.1 Role-Only Approval

```text
Any supervisor can approve any case.
```

Missing:

```text
tenant
assignment
state
maker-checker
conflict
```

### 45.2 UI-Only Button Hiding

Button hidden, API open.

### 45.3 State Transition Without Authorization

Background endpoint changes status directly.

### 45.4 Authorization Before Loading Resource

Cannot evaluate tenant/state/relationship if resource not loaded.

### 45.5 Authorization Uses Stale Resource

Decision based on stale object, mutation on new state.

### 45.6 Search Endpoint Leaks Cross-Tenant Data

Detail endpoint protected, list endpoint not scoped.

### 45.7 Export Ignores Visibility

CSV/report exposes hidden fields.

### 45.8 Delegation Without Audit

Impossible to know whether actor acted directly or on behalf of someone.

### 45.9 Break-Glass Becomes Permanent Admin Bypass

Emergency path has no review, no expiry, no alert.

### 45.10 System Job Uses Super Admin Identity

Audit says admin did it, but actually job did it.

---

## 46. Java 8–25 Considerations

### Java 8

Relevant in legacy Java EE 8 systems.

Concerns:

```text
javax namespace
older app servers
older security APIs
manual context propagation
limited modern language support
```

### Java 11/17

Common enterprise baseline.

Concerns:

```text
jakarta migration may be in progress
module/classpath dependency conflict
modern TLS defaults improved but still need config
```

### Java 21+

Virtual threads become relevant.

Concerns:

```text
ThreadLocal security context assumptions
context propagation
blocking authorization queries become cheaper but not free
```

### Java 25

As newer LTS-era/runtime target, design should avoid assumptions tied to old SecurityManager/Policy APIs.

Jakarta Authorization 3.0 already moves in the direction of replacing legacy `Policy`/`SecurityManager` assumptions.

---

## 47. Design Checklist

Before implementing a workflow action, answer:

```text
1. What is the exact business action?
2. What resource is targeted?
3. What state must the resource be in?
4. What actor role/capability is required?
5. What tenant/org boundary applies?
6. What relationship must actor have to resource?
7. Is maker-checker needed?
8. Is conflict-of-interest relevant?
9. Can delegation apply?
10. Can break-glass apply?
11. Is reason mandatory?
12. Is second approval mandatory?
13. What audit event is required?
14. What happens under concurrent requests?
15. What query/export/report paths expose the same resource?
16. What tests prove denial cases?
17. What policy version will be stored?
```

---

## 48. Reference Architecture

```text
[JAX-RS Resource / Servlet Controller]
        |
        | get current Actor from Jakarta Security identity
        v
[Command Handler / Application Service]
        |
        | load resource with tenant-safe repository
        v
[Domain Authorization Service]
        |
        | resolve role + relationship + state + delegation + conflict
        v
[Decision]
        |
        | allow/deny + reason + obligations
        v
[Workflow Aggregate / State Machine]
        |
        | enforce transition invariant
        v
[Repository + Audit + Outbox]
        |
        | persist mutation + audit + events
        v
[Notification / Workflow Engine / Downstream Consumers]
```

Important:

```text
Authorization decision and state transition should be close in the same transactional boundary.
```

---

## 49. Mental Model Final

Untuk case management/workflow system, jangan bertanya:

```text
Does user have role X?
```

Tanyakan:

```text
Is this actor allowed to perform this business action
on this resource
in this tenant
at this workflow state
under this relationship
without violating separation-of-duty, delegation, conflict, lock, or audit constraints?
```

Itulah perbedaan antara authorization biasa dan domain authorization.

Top-level engineer tidak hanya tahu annotation.

Top-level engineer bisa menjelaskan:

```text
where authorization is enforced,
what facts are used,
why decision is correct,
how decision is audited,
how race conditions are prevented,
how denial is tested,
and how system fails safely.
```

---

## 50. Ringkasan Part 24

Di Part 24 kita membahas:

1. authorization sebagai domain function;
2. perbedaan CRUD authorization dan workflow authorization;
3. actor/action/resource/state/relationship/constraint;
4. state-machine-aware authorization;
5. assignment-based authorization;
6. maker-checker;
7. separation of duties;
8. delegation;
9. escalation;
10. break-glass access;
11. live authorization vs snapshot;
12. race condition dan TOCTOU;
13. authorization service pattern;
14. relationship resolver;
15. visibility vs action authorization;
16. workflow command pattern;
17. audit model;
18. policy versioning;
19. cache risk;
20. UI/backend consistency;
21. document/field-level authorization;
22. system actor;
23. event-driven workflow;
24. testing matrix;
25. production failure patterns.

---

## 51. Koneksi Ke Part Berikutnya

Part berikutnya akan membahas:

```text
Part 25 — API Gateway, Reverse Proxy, and Container Boundary Security
```

Kenapa ini penting setelah domain authorization?

Karena banyak sistem enterprise tidak menerima request langsung dari browser ke container.

Biasanya ada:

```text
ALB / reverse proxy / API gateway / ingress / WAF / SSO gateway
```

Layer tersebut bisa:

```text
terminate TLS
validate token
inject identity header
rewrite path
route internal/external traffic
apply rate limit
```

Kalau boundary ini salah, domain authorization bisa menerima identity palsu atau context yang salah.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 23 — Multi-Tenancy, Organization Boundary, and Cross-Entity Authorization](./learn-java-jakarta-security-authentication-authorization-identity-part-23-multitenancy-organization-boundary.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 25 — API Gateway, Reverse Proxy, and Container Boundary Security](./learn-java-jakarta-security-authentication-authorization-identity-part-25-api-gateway-reverse-proxy-container-boundary.md)

# Learn Java Authorization Modes and Patterns — Part 19

## Workflow, State Machine, and Case Management Authorization

> Seri: `learn-java-authorization-modes-and-patterns`  
> Part: `019`  
> Target: Java 8 hingga Java 25  
> Fokus: authorization sebagai guard terhadap workflow, state transition, case management, maker-checker, escalation, assignment, segregation of duties, break-glass, SLA, dan audit defensibility.

---

## 1. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas authorization pada REST, GraphQL, gRPC, messaging, dan query/data-level authorization. Semua itu menjawab pertanyaan: **bagaimana mencegah user melakukan aksi atau membaca data yang tidak boleh diakses**.

Part ini naik satu level: authorization bukan hanya `can user call endpoint X?`, tetapi:

> **Apakah actor ini boleh menyebabkan transisi bisnis tertentu pada entity ini, dari state saat ini ke state berikutnya, dengan alasan, evidence, assignment, time window, dan constraint organisasi yang sah?**

Dalam sistem case management, regulatory enforcement, approval workflow, BPMN, complaint handling, permit/license processing, audit remediation, appeal, investigation, dan compliance review, authorization hampir selalu bergantung pada **state**.

Contoh sederhana:

```text
Case state: DRAFT
Allowed actions:
- submit: applicant
- edit: applicant
- delete: applicant, if not submitted

Case state: UNDER_REVIEW
Allowed actions:
- review: assigned officer
- request_clarification: assigned officer
- withdraw: applicant, if policy allows
- approve: reviewer with approval authority, not maker

Case state: APPROVED
Allowed actions:
- view: applicant, agency officers, auditors
- revoke: senior officer with specific authority
- amend: limited officer, within amendment window
```

Jika authorization tidak mengerti state, sistem akan jatuh ke pola rapuh:

```java
if (user.hasRole("OFFICER")) {
    caseService.approve(caseId);
}
```

Padahal pertanyaan sebenarnya jauh lebih kompleks:

```text
Apakah user ini officer yang sah?
Apakah officer ini assigned ke case tersebut?
Apakah case sedang dalam state yang bisa di-approve?
Apakah officer ini bukan pembuat/submitter/reviewer sebelumnya?
Apakah officer punya authority untuk case type ini?
Apakah approval masih dalam SLA/time window?
Apakah ada conflict of interest?
Apakah evidence mandatory sudah lengkap?
Apakah override sedang aktif?
Apakah action ini harus menghasilkan audit trail dan notification?
```

Inilah wilayah **workflow authorization**.

---

## 2. Mental Model Utama

### 2.1 Authorization sebagai Guard, Bukan Sekadar Gate

Pada API biasa, authorization sering dipikirkan sebagai gate:

```text
request datang -> check boleh/tidak -> lanjut/tolak
```

Pada workflow, authorization harus dipikirkan sebagai **guard**:

```text
current state + event + actor + resource + context + history + evidence
        -> evaluate transition guard
        -> allow transition / deny transition / require obligation
```

Gate hanya menjaga pintu masuk. Guard menjaga **validitas perubahan state**.

Contoh:

```text
Event: APPROVE_CASE
Current state: UNDER_REVIEW
Target state: APPROVED
Actor: officer A
Resource: case C
Context: agency, assignment, time, risk, SLA, previous actions
Decision: allow / deny / allow-with-obligation
```

Top 1% mental model:

> Authorization pada workflow adalah bagian dari correctness model, bukan hanya security layer.

Jika authorization salah, state machine bisa masuk ke state yang secara hukum/bisnis tidak sah.

---

### 2.2 State Transition Authorization Formula

Formula praktis:

```text
canTransition(actor, case, event, context)
= actorAuthority
  ∧ resourceBoundary
  ∧ currentStateAllowsEvent
  ∧ assignmentAllowsActor
  ∧ separationOfDutySatisfied
  ∧ businessPreconditionsSatisfied
  ∧ temporalConstraintsSatisfied
  ∧ riskConstraintsSatisfied
  ∧ evidenceRequirementsSatisfied
  ∧ noExplicitDeny
```

Dalam Java, jangan direduksi menjadi boolean kecil tanpa alasan:

```java
boolean canApprove(User user, Case c);
```

Lebih baik gunakan decision object:

```java
AuthorizationDecision decision = workflowAuthorizer.canTransition(
    subject,
    CaseAction.APPROVE,
    caseSnapshot,
    AuthorizationContext.current()
);
```

Decision harus bisa menyimpan:

```text
- allowed/denied
- reason code
- human-safe message
- internal diagnostic
- required obligations
- policy version
- evaluated constraints
- evidence snapshot
```

---

## 3. Mengapa Workflow Authorization Sulit

Workflow authorization sulit karena ia adalah gabungan dari banyak dimensi:

| Dimensi | Contoh |
|---|---|
| Identity | siapa actor-nya |
| Role | officer, reviewer, supervisor, auditor |
| Permission | `case.approve`, `case.reassign`, `case.escalate` |
| Resource | case tertentu, bukan semua case |
| State | draft, submitted, under review, approved, closed |
| Assignment | assigned officer/team/unit |
| History | siapa submitter, maker, reviewer sebelumnya |
| Organization | agency, department, branch, unit |
| Time | due date, SLA, appeal window, working day |
| Evidence | document complete, checklist fulfilled |
| Risk | sensitive case, high-value action, conflict of interest |
| Delegation | acting officer, substitute, temporary approval |
| Override | emergency/break-glass access |
| Audit | reconstructable decision |

Authorization yang hanya melihat role akan gagal.

---

## 4. Vocabulary Workflow Authorization

### 4.1 Actor

Actor adalah entity yang mencoba melakukan action. Bisa berupa:

```text
- human user
- system user
- scheduled job
- integration client
- workflow engine
- delegated user
- support operator
```

Jangan asumsikan semua actor adalah human user.

Contoh bug:

```java
String userId = SecurityContextHolder.getContext().getAuthentication().getName();
```

Kode ini gagal untuk:

```text
- batch job
- Kafka consumer
- system-to-system callback
- workflow engine command
- delegated acting user
```

Gunakan konsep `Subject` yang lebih luas.

---

### 4.2 Event

Event adalah intention bisnis untuk menyebabkan transisi.

Contoh:

```text
SUBMIT
ASSIGN
START_REVIEW
REQUEST_CLARIFICATION
RESPOND_CLARIFICATION
RECOMMEND_APPROVAL
APPROVE
REJECT
RETURN
WITHDRAW
REOPEN
CLOSE
ESCALATE
TRANSFER
REASSIGN
REVOKE_APPROVAL
```

Jangan pakai CRUD sebagai workflow event.

Buruk:

```text
UPDATE_CASE
```

Lebih baik:

```text
REQUEST_CLARIFICATION
APPROVE_CASE
REASSIGN_CASE
ESCALATE_CASE
WITHDRAW_APPLICATION
```

Kenapa? Karena authorization `update` terlalu luas.

---

### 4.3 State

State adalah posisi lifecycle resource.

Contoh:

```text
DRAFT
SUBMITTED
SCREENING
UNDER_REVIEW
PENDING_CLARIFICATION
RECOMMENDED_FOR_APPROVAL
APPROVED
REJECTED
WITHDRAWN
CLOSED
REOPENED
ESCALATED
```

State harus cukup eksplisit untuk authorization.

Jika state terlalu kasar:

```text
IN_PROGRESS
```

Maka authorization menjadi penuh `if` tersembunyi:

```java
if (case.status() == IN_PROGRESS && case.stage().equals("LEGAL") && case.pendingClarification()) {
    ...
}
```

Kadang lebih baik memodelkan state yang jelas.

---

### 4.4 Transition

Transition adalah perubahan dari state A ke state B oleh event tertentu.

```text
SUBMITTED --START_REVIEW--> UNDER_REVIEW
UNDER_REVIEW --REQUEST_CLARIFICATION--> PENDING_CLARIFICATION
PENDING_CLARIFICATION --RESPOND_CLARIFICATION--> UNDER_REVIEW
UNDER_REVIEW --APPROVE--> APPROVED
UNDER_REVIEW --REJECT--> REJECTED
APPROVED --REVOKE--> REVOKED
```

Authorization biasanya melekat pada transition, bukan hanya endpoint.

---

### 4.5 Guard

Guard adalah kondisi yang harus benar agar transition boleh terjadi.

Contoh guard:

```text
- actor has case.review permission
- actor is assigned officer
- actor belongs to same agency as case
- actor did not submit this case
- case has all mandatory documents
- review checklist complete
- action is within appeal window
```

Guard bukan action. Guard tidak boleh mengubah state.

Buruk:

```java
boolean canApprove(Case c) {
    c.setLastCheckedAt(now); // side effect dalam guard
    return true;
}
```

Guard harus pure sejauh mungkin.

---

### 4.6 Obligation

Obligation adalah syarat tambahan ketika decision diizinkan.

Contoh:

```text
ALLOW, but must capture approval reason
ALLOW, but must attach supervisor note
ALLOW, but must notify applicant
ALLOW, but must generate audit event
ALLOW, but must require second approval
ALLOW, but must mask sensitive fields
```

Dalam workflow, allow/deny tidak selalu cukup. Kadang keputusan adalah:

```text
ALLOW_WITH_OBLIGATIONS
```

---

## 5. Workflow Authorization vs Normal Authorization

| Normal Authorization | Workflow Authorization |
|---|---|
| `canRead(resource)` | `canTransition(resource, event)` |
| Focus ke access | Focus ke legal/business state change |
| Bisa stateless | Hampir selalu stateful |
| Role/permission cukup untuk sebagian kasus | Perlu state, assignment, history, evidence |
| Deny/allow sederhana | Deny/allow/obligation/escalation |
| Audit akses | Audit keputusan dan transisi |
| Lebih mudah cache | Sulit cache karena state cepat berubah |

---

## 6. Authorization Matrix untuk Workflow

Salah satu artifact paling penting adalah matrix:

```text
State x Action x Actor/Role x Constraint x Result
```

Contoh sederhana:

| State | Action | Actor | Constraint | Result |
|---|---|---|---|---|
| DRAFT | edit | Applicant | owner applicant | allow |
| DRAFT | submit | Applicant | mandatory fields complete | allow |
| SUBMITTED | assign | Supervisor | same agency | allow |
| UNDER_REVIEW | review | Officer | assigned officer | allow |
| UNDER_REVIEW | approve | Officer | not maker + has approval authority | allow |
| UNDER_REVIEW | approve | Submitter | same user as maker | deny |
| PENDING_CLARIFICATION | respond | Applicant | owner applicant | allow |
| APPROVED | revoke | Senior Officer | revocation reason required | allow with obligation |
| CLOSED | edit | Any | none | deny |

Matrix ini bukan dokumentasi kosmetik. Ini adalah sumber untuk:

```text
- implementation
- tests
- audit review
- user acceptance
- security review
- regulatory explanation
```

---

## 7. State Machine sebagai Authorization Boundary

### 7.1 Kenapa State Machine Penting

Tanpa state machine, workflow authorization sering tersebar:

```text
Controller A punya check sendiri
Service B punya check sendiri
Batch job C bypass
Admin screen D punya logic berbeda
Report E memakai interpretasi status berbeda
```

State machine memberikan struktur:

```text
state -> event -> guard -> action -> next state
```

Spring Statemachine sendiri menyediakan konsep state, transition, guard, action, hierarchical states, regions, dan listener. Untuk authorization, bagian yang paling relevan adalah **transition guard** dan event handling; tetapi jangan otomatis menyimpulkan semua workflow harus memakai library state machine. Library membantu struktur, bukan menggantikan desain policy.

---

### 7.2 State Machine Minimal untuk Authorization

Untuk banyak sistem enterprise, cukup punya model sendiri:

```java
public enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_CLARIFICATION,
    RECOMMENDED_FOR_APPROVAL,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    CLOSED
}
```

```java
public enum CaseAction {
    EDIT,
    SUBMIT,
    ASSIGN,
    START_REVIEW,
    REQUEST_CLARIFICATION,
    RESPOND_CLARIFICATION,
    RECOMMEND_APPROVAL,
    APPROVE,
    REJECT,
    WITHDRAW,
    REOPEN,
    CLOSE
}
```

```java
public final class TransitionKey {
    private final CaseState from;
    private final CaseAction action;

    public TransitionKey(CaseState from, CaseAction action) {
        this.from = Objects.requireNonNull(from);
        this.action = Objects.requireNonNull(action);
    }

    public CaseState from() {
        return from;
    }

    public CaseAction action() {
        return action;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TransitionKey)) return false;
        TransitionKey that = (TransitionKey) o;
        return from == that.from && action == that.action;
    }

    @Override
    public int hashCode() {
        return Objects.hash(from, action);
    }
}
```

Java 16+ bisa memakai `record`:

```java
public record TransitionKey(CaseState from, CaseAction action) {}
```

Tapi karena target Java 8–25, desain utama harus tetap bisa dibuat tanpa record.

---

### 7.3 Transition Definition

```java
public final class TransitionDefinition {
    private final CaseState from;
    private final CaseAction action;
    private final CaseState to;
    private final WorkflowGuard guard;

    public TransitionDefinition(
            CaseState from,
            CaseAction action,
            CaseState to,
            WorkflowGuard guard
    ) {
        this.from = Objects.requireNonNull(from);
        this.action = Objects.requireNonNull(action);
        this.to = Objects.requireNonNull(to);
        this.guard = Objects.requireNonNull(guard);
    }

    public CaseState from() {
        return from;
    }

    public CaseAction action() {
        return action;
    }

    public CaseState to() {
        return to;
    }

    public WorkflowGuard guard() {
        return guard;
    }
}
```

---

## 8. Decision Object untuk Workflow Authorization

Jangan return boolean polos.

```java
public enum DecisionOutcome {
    ALLOW,
    DENY,
    ALLOW_WITH_OBLIGATIONS
}
```

```java
public enum DenialReason {
    UNKNOWN_ACTION,
    INVALID_STATE,
    MISSING_PERMISSION,
    OUTSIDE_RESOURCE_BOUNDARY,
    NOT_ASSIGNED,
    SEPARATION_OF_DUTY_VIOLATION,
    MISSING_EVIDENCE,
    OUTSIDE_TIME_WINDOW,
    CASE_LOCKED,
    EXPLICIT_POLICY_DENY
}
```

```java
public final class WorkflowAuthorizationDecision {
    private final DecisionOutcome outcome;
    private final DenialReason denialReason;
    private final List<String> obligations;
    private final List<String> evidence;

    private WorkflowAuthorizationDecision(
            DecisionOutcome outcome,
            DenialReason denialReason,
            List<String> obligations,
            List<String> evidence
    ) {
        this.outcome = Objects.requireNonNull(outcome);
        this.denialReason = denialReason;
        this.obligations = Collections.unmodifiableList(new ArrayList<>(obligations));
        this.evidence = Collections.unmodifiableList(new ArrayList<>(evidence));
    }

    public static WorkflowAuthorizationDecision allow(String evidence) {
        return new WorkflowAuthorizationDecision(
                DecisionOutcome.ALLOW,
                null,
                Collections.emptyList(),
                Collections.singletonList(evidence)
        );
    }

    public static WorkflowAuthorizationDecision deny(DenialReason reason, String evidence) {
        return new WorkflowAuthorizationDecision(
                DecisionOutcome.DENY,
                reason,
                Collections.emptyList(),
                Collections.singletonList(evidence)
        );
    }

    public static WorkflowAuthorizationDecision allowWithObligations(
            List<String> obligations,
            List<String> evidence
    ) {
        return new WorkflowAuthorizationDecision(
                DecisionOutcome.ALLOW_WITH_OBLIGATIONS,
                null,
                obligations,
                evidence
        );
    }

    public boolean isAllowed() {
        return outcome == DecisionOutcome.ALLOW || outcome == DecisionOutcome.ALLOW_WITH_OBLIGATIONS;
    }

    public DecisionOutcome outcome() {
        return outcome;
    }

    public DenialReason denialReason() {
        return denialReason;
    }

    public List<String> obligations() {
        return obligations;
    }

    public List<String> evidence() {
        return evidence;
    }
}
```

Kenapa penting?

Karena workflow authorization sering harus menjawab:

```text
Kenapa user tidak bisa approve?
Kenapa case bisa di-reopen?
Siapa yang mengizinkan override?
Policy versi mana yang berlaku saat itu?
Evidence apa yang dipakai?
```

Boolean tidak cukup.

---

## 9. Guard Composition

### 9.1 Interface Guard

```java
public interface WorkflowGuard {
    WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input);
}
```

```java
public final class WorkflowAuthorizationInput {
    private final SubjectRef subject;
    private final CaseSnapshot caseSnapshot;
    private final CaseAction action;
    private final AuthorizationContext context;

    public WorkflowAuthorizationInput(
            SubjectRef subject,
            CaseSnapshot caseSnapshot,
            CaseAction action,
            AuthorizationContext context
    ) {
        this.subject = Objects.requireNonNull(subject);
        this.caseSnapshot = Objects.requireNonNull(caseSnapshot);
        this.action = Objects.requireNonNull(action);
        this.context = Objects.requireNonNull(context);
    }

    public SubjectRef subject() {
        return subject;
    }

    public CaseSnapshot caseSnapshot() {
        return caseSnapshot;
    }

    public CaseAction action() {
        return action;
    }

    public AuthorizationContext context() {
        return context;
    }
}
```

---

### 9.2 Composite Guard: All Must Pass

```java
public final class AllOfGuard implements WorkflowGuard {
    private final List<WorkflowGuard> guards;

    public AllOfGuard(List<WorkflowGuard> guards) {
        this.guards = Collections.unmodifiableList(new ArrayList<>(guards));
    }

    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        List<String> evidence = new ArrayList<>();
        List<String> obligations = new ArrayList<>();

        for (WorkflowGuard guard : guards) {
            WorkflowAuthorizationDecision decision = guard.evaluate(input);

            evidence.addAll(decision.evidence());

            if (!decision.isAllowed()) {
                return WorkflowAuthorizationDecision.deny(
                        decision.denialReason(),
                        "failed guard: " + guard.getClass().getSimpleName()
                );
            }

            obligations.addAll(decision.obligations());
        }

        if (!obligations.isEmpty()) {
            return WorkflowAuthorizationDecision.allowWithObligations(obligations, evidence);
        }

        return WorkflowAuthorizationDecision.allow("all guards passed");
    }
}
```

---

### 9.3 Example Guards

#### Permission Guard

```java
public final class HasPermissionGuard implements WorkflowGuard {
    private final String permission;

    public HasPermissionGuard(String permission) {
        this.permission = Objects.requireNonNull(permission);
    }

    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        if (input.subject().permissions().contains(permission)) {
            return WorkflowAuthorizationDecision.allow("subject has permission " + permission);
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.MISSING_PERMISSION,
                "subject missing permission " + permission
        );
    }
}
```

#### Assignment Guard

```java
public final class AssignedOfficerGuard implements WorkflowGuard {
    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        String assignedOfficerId = input.caseSnapshot().assignedOfficerId();
        String subjectId = input.subject().subjectId();

        if (Objects.equals(assignedOfficerId, subjectId)) {
            return WorkflowAuthorizationDecision.allow("subject is assigned officer");
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.NOT_ASSIGNED,
                "subject is not assigned officer"
        );
    }
}
```

#### Same Agency Guard

```java
public final class SameAgencyGuard implements WorkflowGuard {
    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        String caseAgency = input.caseSnapshot().agencyId();
        String subjectAgency = input.subject().agencyId();

        if (Objects.equals(caseAgency, subjectAgency)) {
            return WorkflowAuthorizationDecision.allow("subject belongs to case agency");
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.OUTSIDE_RESOURCE_BOUNDARY,
                "subject agency does not match case agency"
        );
    }
}
```

#### Maker-Checker Guard

```java
public final class NotMakerGuard implements WorkflowGuard {
    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        String makerId = input.caseSnapshot().createdBy();
        String subjectId = input.subject().subjectId();

        if (!Objects.equals(makerId, subjectId)) {
            return WorkflowAuthorizationDecision.allow("subject is not maker");
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.SEPARATION_OF_DUTY_VIOLATION,
                "subject is maker and cannot approve own submission"
        );
    }
}
```

#### Evidence Guard

```java
public final class MandatoryDocumentsCompleteGuard implements WorkflowGuard {
    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        if (input.caseSnapshot().mandatoryDocumentsComplete()) {
            return WorkflowAuthorizationDecision.allow("mandatory documents complete");
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.MISSING_EVIDENCE,
                "mandatory documents incomplete"
        );
    }
}
```

---

## 10. Workflow Authorizer

```java
public final class WorkflowAuthorizer {
    private final Map<TransitionKey, TransitionDefinition> transitions;

    public WorkflowAuthorizer(List<TransitionDefinition> definitions) {
        Map<TransitionKey, TransitionDefinition> map = new HashMap<>();
        for (TransitionDefinition definition : definitions) {
            TransitionKey key = new TransitionKey(definition.from(), definition.action());
            if (map.put(key, definition) != null) {
                throw new IllegalArgumentException("Duplicate transition: " + key);
            }
        }
        this.transitions = Collections.unmodifiableMap(map);
    }

    public WorkflowAuthorizationDecision canTransition(WorkflowAuthorizationInput input) {
        TransitionKey key = new TransitionKey(
                input.caseSnapshot().state(),
                input.action()
        );

        TransitionDefinition transition = transitions.get(key);

        if (transition == null) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.INVALID_STATE,
                    "no transition from state " + input.caseSnapshot().state()
                            + " using action " + input.action()
            );
        }

        return transition.guard().evaluate(input);
    }

    public CaseState nextState(CaseState currentState, CaseAction action) {
        TransitionDefinition transition = transitions.get(new TransitionKey(currentState, action));
        if (transition == null) {
            throw new IllegalArgumentException("No transition for " + currentState + " + " + action);
        }
        return transition.to();
    }
}
```

---

## 11. Defining Case Workflow Transitions

```java
public final class CaseWorkflowDefinitions {
    public static List<TransitionDefinition> definitions() {
        List<TransitionDefinition> transitions = new ArrayList<>();

        transitions.add(new TransitionDefinition(
                CaseState.DRAFT,
                CaseAction.SUBMIT,
                CaseState.SUBMITTED,
                new AllOfGuard(Arrays.asList(
                        new HasPermissionGuard("case.submit"),
                        new MandatoryDocumentsCompleteGuard()
                ))
        ));

        transitions.add(new TransitionDefinition(
                CaseState.SUBMITTED,
                CaseAction.ASSIGN,
                CaseState.UNDER_REVIEW,
                new AllOfGuard(Arrays.asList(
                        new HasPermissionGuard("case.assign"),
                        new SameAgencyGuard()
                ))
        ));

        transitions.add(new TransitionDefinition(
                CaseState.UNDER_REVIEW,
                CaseAction.APPROVE,
                CaseState.APPROVED,
                new AllOfGuard(Arrays.asList(
                        new HasPermissionGuard("case.approve"),
                        new SameAgencyGuard(),
                        new AssignedOfficerGuard(),
                        new NotMakerGuard(),
                        new MandatoryDocumentsCompleteGuard()
                ))
        ));

        transitions.add(new TransitionDefinition(
                CaseState.UNDER_REVIEW,
                CaseAction.REJECT,
                CaseState.REJECTED,
                new AllOfGuard(Arrays.asList(
                        new HasPermissionGuard("case.reject"),
                        new SameAgencyGuard(),
                        new AssignedOfficerGuard(),
                        new NotMakerGuard()
                ))
        ));

        return transitions;
    }
}
```

Ini masih sederhana, tetapi lebih baik daripada menaruh seluruh rule di controller.

---

## 12. State Transition Service Pattern

Authorization harus berada dekat dengan mutation.

Buruk:

```java
@PostMapping("/cases/{id}/approve")
public ResponseEntity<?> approve(@PathVariable String id) {
    if (!security.hasPermission("case.approve")) {
        return ResponseEntity.status(403).build();
    }
    caseService.approve(id);
    return ResponseEntity.ok().build();
}
```

Kenapa buruk?

```text
- service bisa dipanggil dari tempat lain tanpa check
- batch job bisa bypass
- internal API bisa bypass
- tidak mengecek state dan assignment
- tidak ada decision audit
```

Lebih baik:

```java
public final class CaseWorkflowService {
    private final CaseRepository caseRepository;
    private final WorkflowAuthorizer workflowAuthorizer;
    private final AuditPublisher auditPublisher;

    public CaseWorkflowService(
            CaseRepository caseRepository,
            WorkflowAuthorizer workflowAuthorizer,
            AuditPublisher auditPublisher
    ) {
        this.caseRepository = caseRepository;
        this.workflowAuthorizer = workflowAuthorizer;
        this.auditPublisher = auditPublisher;
    }

    public void approve(String caseId, SubjectRef subject, AuthorizationContext context) {
        CaseEntity entity = caseRepository.findForUpdate(caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));

        CaseSnapshot snapshot = CaseSnapshot.from(entity);

        WorkflowAuthorizationInput input = new WorkflowAuthorizationInput(
                subject,
                snapshot,
                CaseAction.APPROVE,
                context
        );

        WorkflowAuthorizationDecision decision = workflowAuthorizer.canTransition(input);

        auditPublisher.publishAuthorizationDecision(subject, snapshot, CaseAction.APPROVE, decision);

        if (!decision.isAllowed()) {
            throw new AccessDeniedException(decision.denialReason().name());
        }

        enforceObligations(decision);

        entity.approve(subject.subjectId(), context.now());
        caseRepository.save(entity);

        auditPublisher.publishStateTransition(
                subject,
                snapshot.caseId(),
                snapshot.state(),
                entity.state(),
                CaseAction.APPROVE
        );
    }

    private void enforceObligations(WorkflowAuthorizationDecision decision) {
        for (String obligation : decision.obligations()) {
            // Implement obligation enforcement or route to obligation handler.
        }
    }
}
```

Key point:

```text
Load locked entity -> snapshot -> authorize -> audit decision -> mutate -> audit transition.
```

---

## 13. TOCTOU dalam Workflow Authorization

TOCTOU: Time-of-check to time-of-use.

Contoh bug:

```text
1. User A check: case state UNDER_REVIEW, allowed approve.
2. User B reject case.
3. User A approve based on stale state.
```

Solusi:

```text
- authorize inside transaction
- lock row or use optimistic version
- re-check state before mutation
- include expected state/version in command
- reject stale command
```

### 13.1 Optimistic Lock Example

```java
public final class ApproveCaseCommand {
    private final String caseId;
    private final long expectedVersion;
    private final String reason;

    public ApproveCaseCommand(String caseId, long expectedVersion, String reason) {
        this.caseId = Objects.requireNonNull(caseId);
        this.expectedVersion = expectedVersion;
        this.reason = Objects.requireNonNull(reason);
    }

    public String caseId() {
        return caseId;
    }

    public long expectedVersion() {
        return expectedVersion;
    }

    public String reason() {
        return reason;
    }
}
```

```java
public void approve(ApproveCaseCommand command, SubjectRef subject, AuthorizationContext context) {
    CaseEntity entity = caseRepository.findById(command.caseId())
            .orElseThrow(() -> new NotFoundException("Case not found"));

    if (entity.version() != command.expectedVersion()) {
        throw new ConflictException("Case was modified. Please reload and retry.");
    }

    // Authorize against current entity state, not client-supplied state.
    WorkflowAuthorizationDecision decision = workflowAuthorizer.canTransition(
            new WorkflowAuthorizationInput(subject, CaseSnapshot.from(entity), CaseAction.APPROVE, context)
    );

    if (!decision.isAllowed()) {
        throw new AccessDeniedException(decision.denialReason().name());
    }

    entity.approve(subject.subjectId(), context.now());
}
```

### 13.2 Pessimistic Lock Example

```java
public interface CaseRepository {
    Optional<CaseEntity> findForUpdate(String caseId);
}
```

SQL concept:

```sql
SELECT *
FROM cases
WHERE case_id = ?
FOR UPDATE;
```

Use case:

```text
- high-value approval
- low throughput but high correctness
- strong state transition ordering needed
```

---

## 14. Maker-Checker Pattern

### 14.1 Mental Model

Maker-checker means:

```text
The actor who creates/prepares/submits a change cannot be the same actor who approves/finalizes it.
```

Ini bentuk separation of duties.

NIST RBAC model membahas constrained RBAC dengan separation of duty sebagai teknik untuk mengurangi fraud/error. Dalam workflow enterprise, SoD tidak cukup hanya role-level. Sering kali harus object-level:

```text
Officer A boleh approve case lain.
Officer A tidak boleh approve case yang ia buat sendiri.
```

---

### 14.2 Static vs Dynamic SoD

Static SoD:

```text
User yang punya role Maker tidak boleh punya role Checker.
```

Dynamic SoD:

```text
User bisa punya role Maker dan Checker,
tetapi tidak boleh menjadi checker untuk object/process instance yang sama ketika dia sudah menjadi maker.
```

Untuk workflow/case management, dynamic object-level SoD sering lebih realistis.

---

### 14.3 Maker-Checker Data Model

```sql
CREATE TABLE case_action_history (
    id                  BIGINT PRIMARY KEY,
    case_id              VARCHAR(64) NOT NULL,
    action_code          VARCHAR(64) NOT NULL,
    actor_id             VARCHAR(64) NOT NULL,
    actor_role_code      VARCHAR(64),
    from_state           VARCHAR(64),
    to_state             VARCHAR(64),
    action_timestamp     TIMESTAMP NOT NULL,
    reason_code          VARCHAR(64),
    comment_text         VARCHAR(4000)
);

CREATE INDEX idx_case_action_history_case_action
ON case_action_history(case_id, action_code);
```

Guard bisa mengecek history:

```java
public final class HasNotPerformedActionGuard implements WorkflowGuard {
    private final CaseAction prohibitedPriorAction;
    private final CaseActionHistoryRepository historyRepository;

    public HasNotPerformedActionGuard(
            CaseAction prohibitedPriorAction,
            CaseActionHistoryRepository historyRepository
    ) {
        this.prohibitedPriorAction = Objects.requireNonNull(prohibitedPriorAction);
        this.historyRepository = Objects.requireNonNull(historyRepository);
    }

    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        boolean performed = historyRepository.existsByCaseIdAndActionAndActor(
                input.caseSnapshot().caseId(),
                prohibitedPriorAction,
                input.subject().subjectId()
        );

        if (!performed) {
            return WorkflowAuthorizationDecision.allow(
                    "subject has not performed prohibited prior action " + prohibitedPriorAction
            );
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.SEPARATION_OF_DUTY_VIOLATION,
                "subject previously performed " + prohibitedPriorAction
        );
    }
}
```

---

## 15. Four-Eyes Principle

Four-eyes principle:

```text
At least two distinct authorized persons must participate in a sensitive decision.
```

Contoh:

```text
- officer recommends approval
- supervisor approves
```

Atau:

```text
- first reviewer checks evidence
- second reviewer finalizes decision
```

State model:

```text
UNDER_REVIEW
  --RECOMMEND_APPROVAL by Officer--> RECOMMENDED_FOR_APPROVAL
  --APPROVE by Supervisor, not recommender--> APPROVED
```

Guard:

```text
APPROVE requires:
- has permission case.approve.final
- same agency
- subject is supervisor or delegated approver
- subject != recommender
- recommendation exists
```

Ini lebih kuat daripada:

```text
UNDER_REVIEW --APPROVE--> APPROVED
```

Karena state `RECOMMENDED_FOR_APPROVAL` menyimpan checkpoint bisnis.

---

## 16. Assignment-Based Authorization

### 16.1 Assignment adalah Scope, Bukan Role

Role mengatakan capability umum:

```text
Officer can review cases.
```

Assignment mengatakan object scope:

```text
Officer A can review Case C because Case C is assigned to Officer A.
```

Jangan campur.

Buruk:

```text
ROLE_CASE_123_REVIEWER
```

Ini akan meledakkan role.

Lebih baik:

```text
role: CASE_OFFICER
assignment table: case_id -> officer_id/team_id
```

---

### 16.2 Assignment Model

```sql
CREATE TABLE case_assignment (
    case_id              VARCHAR(64) NOT NULL,
    assignee_type        VARCHAR(32) NOT NULL, -- USER, TEAM, UNIT
    assignee_id          VARCHAR(64) NOT NULL,
    assignment_role      VARCHAR(64) NOT NULL, -- REVIEWER, APPROVER, LEGAL, INSPECTOR
    assigned_by          VARCHAR(64) NOT NULL,
    assigned_at          TIMESTAMP NOT NULL,
    valid_from           TIMESTAMP NOT NULL,
    valid_until          TIMESTAMP,
    active_flag          CHAR(1) NOT NULL,
    PRIMARY KEY(case_id, assignee_type, assignee_id, assignment_role)
);
```

Authorization query:

```sql
SELECT 1
FROM case_assignment a
WHERE a.case_id = ?
  AND a.active_flag = 'Y'
  AND a.assignment_role = ?
  AND (
        (a.assignee_type = 'USER' AND a.assignee_id = ?)
        OR
        (a.assignee_type = 'TEAM' AND a.assignee_id IN (?))
        OR
        (a.assignee_type = 'UNIT' AND a.assignee_id IN (?))
      )
  AND a.valid_from <= ?
  AND (a.valid_until IS NULL OR a.valid_until > ?)
```

---

### 16.3 Team Queue vs Personal Assignment

Case systems often have two scopes:

```text
Team queue: anyone in team can pick/start.
Personal assignment: only assigned officer can act.
```

State transition example:

```text
SUBMITTED --CLAIM by team member--> UNDER_REVIEW assigned to user
UNDER_REVIEW --REVIEW by assigned user--> UNDER_REVIEW
UNDER_REVIEW --REASSIGN by supervisor--> UNDER_REVIEW assigned to another user
```

Authorization rule:

```text
CLAIM requires team membership.
REVIEW requires personal assignment.
REASSIGN requires supervisor authority.
```

Do not use the same permission for all three.

---

## 17. Reassignment Authorization

Reassignment is sensitive because it can be used to:

```text
- take over another officer's work
- route case to friendly approver
- bypass separation of duties
- hide backlog
- avoid SLA accountability
```

Therefore reassign must be explicitly authorized.

### 17.1 Reassignment Rules

Common constraints:

```text
- actor has case.reassign permission
- actor is supervisor of source/target unit
- target assignee is eligible
- target assignee has no conflict of interest
- reassignment reason is required
- reassignment is audited
- reassignment may not reset SLA unless policy says so
- reassignment cannot assign to original maker if approval stage
```

### 17.2 Reassignment Decision

```java
public final class ReassignmentPolicy {
    public WorkflowAuthorizationDecision canReassign(
            SubjectRef subject,
            CaseSnapshot caseSnapshot,
            String targetOfficerId,
            AuthorizationContext context
    ) {
        if (!subject.permissions().contains("case.reassign")) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.MISSING_PERMISSION,
                    "missing case.reassign"
            );
        }

        if (!Objects.equals(subject.agencyId(), caseSnapshot.agencyId())) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.OUTSIDE_RESOURCE_BOUNDARY,
                    "agency mismatch"
            );
        }

        if (Objects.equals(targetOfficerId, caseSnapshot.createdBy())) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.SEPARATION_OF_DUTY_VIOLATION,
                    "target officer is maker"
            );
        }

        return WorkflowAuthorizationDecision.allowWithObligations(
                Arrays.asList("REASSIGNMENT_REASON_REQUIRED", "AUDIT_REASSIGNMENT"),
                Arrays.asList("reassignment policy passed")
        );
    }
}
```

---

## 18. Escalation Authorization

Escalation is not just assignment change. It often changes authority level.

Examples:

```text
- officer escalates to supervisor
- system escalates overdue case
- user escalates complaint
- high-risk case escalated to special unit
- unresolved appeal escalated to legal team
```

Escalation can be:

```text
Manual escalation: initiated by actor
Automatic escalation: initiated by scheduler/workflow engine
Policy escalation: triggered by risk/SLA/state
```

### 18.1 Manual Escalation Guard

```text
Manual escalation requires:
- actor can view/work case
- actor has escalation permission or is assigned officer
- escalation reason provided
- case is in escalatable state
- target escalation path exists
```

### 18.2 Automatic Escalation Guard

Automatic jobs also need authorization semantics.

```text
Scheduled job actor: SYSTEM_ESCALATION_JOB
Allowed action: ESCALATE_OVERDUE_CASE
Constraint: only cases past SLA threshold
```

Never make system jobs omnipotent without constraints.

```java
public final class SystemSlaEscalationGuard implements WorkflowGuard {
    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        if (!input.subject().isSystemActor("SYSTEM_SLA_ESCALATION")) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.MISSING_PERMISSION,
                    "not SLA escalation system actor"
            );
        }

        if (!input.caseSnapshot().isPastSla(input.context().now())) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.OUTSIDE_TIME_WINDOW,
                    "case is not past SLA"
            );
        }

        return WorkflowAuthorizationDecision.allow("system SLA escalation allowed");
    }
}
```

Top 1% insight:

> System actor authorization should be narrower than human superadmin authorization, not broader.

---

## 19. Time Window and SLA-Based Authorization

Temporal authorization is common in workflow:

```text
- applicant can withdraw before review starts
- applicant can appeal within 14 days after rejection
- officer can amend decision within 24 hours
- system can auto-close after 30 days pending clarification
- supervisor can extend SLA before due date
```

### 19.1 Appeal Window Example

```java
public final class AppealWindowGuard implements WorkflowGuard {
    private final Duration appealWindow;

    public AppealWindowGuard(Duration appealWindow) {
        this.appealWindow = Objects.requireNonNull(appealWindow);
    }

    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        Instant rejectedAt = input.caseSnapshot().rejectedAt();
        if (rejectedAt == null) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.INVALID_STATE,
                    "case has no rejection timestamp"
            );
        }

        Instant deadline = rejectedAt.plus(appealWindow);
        if (!input.context().now().isAfter(deadline)) {
            return WorkflowAuthorizationDecision.allow("within appeal window");
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.OUTSIDE_TIME_WINDOW,
                "appeal window expired"
        );
    }
}
```

### 19.2 Java 8–25 Time API Note

Use `java.time` for Java 8+.

Avoid:

```java
new Date()
System.currentTimeMillis() scattered everywhere
```

Prefer injecting clock:

```java
public final class AuthorizationContext {
    private final Instant now;
    private final String correlationId;

    public AuthorizationContext(Instant now, String correlationId) {
        this.now = Objects.requireNonNull(now);
        this.correlationId = Objects.requireNonNull(correlationId);
    }

    public Instant now() {
        return now;
    }

    public String correlationId() {
        return correlationId;
    }
}
```

Testing becomes deterministic.

---

## 20. Withdraw, Reopen, Return, and Resubmit

These actions are deceptively complex.

### 20.1 Withdraw

Possible rules:

```text
Applicant can withdraw when:
- case is DRAFT, SUBMITTED, or PENDING_CLARIFICATION
- not after final decision
- no enforcement action has started
- user owns application
```

Officer withdrawal may be different:

```text
Officer can mark withdrawn only when applicant request is recorded.
```

### 20.2 Reopen

Reopen is dangerous because it can reverse finality.

Rules:

```text
- only closed/rejected/approved cases may be reopened depending on policy
- requires specific permission
- requires reason
- may require supervisor approval
- must preserve prior decision history
- must not delete old audit events
```

Bad:

```java
case.setStatus(UNDER_REVIEW);
```

Better:

```text
CLOSED --REOPEN_REQUEST--> REOPEN_PENDING_APPROVAL
REOPEN_PENDING_APPROVAL --APPROVE_REOPEN--> UNDER_REVIEW
```

### 20.3 Return

Return means one actor sends work back to previous actor/stage.

Rules:

```text
- return target must be valid previous stage
- return reason required
- return may or may not reset SLA
- return should preserve ownership/history
- return should not allow arbitrary state jump
```

### 20.4 Resubmit

Resubmit often allowed only after clarification or return.

```text
PENDING_CLARIFICATION --RESPOND_CLARIFICATION--> UNDER_REVIEW
RETURNED_TO_APPLICANT --RESUBMIT--> SUBMITTED
```

Do not implement as generic update.

---

## 21. Locking and Concurrent Work Authorization

Workflow systems often need locks:

```text
- case is being edited by officer A
- batch job is processing case
- decision is pending final approval
- legal review lock
- payment verification lock
```

Lock affects authorization.

```text
Can user edit?
= has permission
  ∧ case state allows edit
  ∧ user owns lock or lock expired
```

### 21.1 Soft Lock Model

```sql
CREATE TABLE case_lock (
    case_id          VARCHAR(64) PRIMARY KEY,
    locked_by        VARCHAR(64) NOT NULL,
    locked_at        TIMESTAMP NOT NULL,
    expires_at       TIMESTAMP NOT NULL,
    lock_reason      VARCHAR(128) NOT NULL
);
```

Guard:

```java
public final class CaseLockGuard implements WorkflowGuard {
    private final CaseLockRepository lockRepository;

    public CaseLockGuard(CaseLockRepository lockRepository) {
        this.lockRepository = Objects.requireNonNull(lockRepository);
    }

    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        Optional<CaseLock> lock = lockRepository.findActiveLock(
                input.caseSnapshot().caseId(),
                input.context().now()
        );

        if (!lock.isPresent()) {
            return WorkflowAuthorizationDecision.allow("case not locked");
        }

        if (Objects.equals(lock.get().lockedBy(), input.subject().subjectId())) {
            return WorkflowAuthorizationDecision.allow("case locked by subject");
        }

        return WorkflowAuthorizationDecision.deny(
                DenialReason.CASE_LOCKED,
                "case locked by another actor"
        );
    }
}
```

---

## 22. Break-Glass and Emergency Override

Break-glass means emergency access that bypasses normal restrictions under strict control.

It is not just `ROLE_SUPER_ADMIN`.

A proper break-glass design includes:

```text
- explicit activation
- reason required
- time-bound window
- limited scope
- visible audit trail
- notification to supervisor/security
- post-action review
- automatic expiry
- cannot silently bypass all controls
```

### 22.1 Break-Glass Context

```java
public final class BreakGlassContext {
    private final boolean active;
    private final String approvalId;
    private final String reason;
    private final Instant expiresAt;

    public BreakGlassContext(boolean active, String approvalId, String reason, Instant expiresAt) {
        this.active = active;
        this.approvalId = approvalId;
        this.reason = reason;
        this.expiresAt = expiresAt;
    }

    public boolean isActiveAt(Instant now) {
        return active && expiresAt != null && now.isBefore(expiresAt);
    }

    public String approvalId() {
        return approvalId;
    }

    public String reason() {
        return reason;
    }
}
```

### 22.2 Break-Glass Guard

```java
public final class BreakGlassGuard implements WorkflowGuard {
    @Override
    public WorkflowAuthorizationDecision evaluate(WorkflowAuthorizationInput input) {
        BreakGlassContext bg = input.context().breakGlassContext();

        if (bg == null || !bg.isActiveAt(input.context().now())) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.EXPLICIT_POLICY_DENY,
                    "break-glass not active"
            );
        }

        if (bg.reason() == null || bg.reason().trim().isEmpty()) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.MISSING_EVIDENCE,
                    "break-glass reason missing"
            );
        }

        return WorkflowAuthorizationDecision.allowWithObligations(
                Arrays.asList("AUDIT_BREAK_GLASS", "NOTIFY_SECURITY_REVIEW"),
                Arrays.asList("break-glass active approvalId=" + bg.approvalId())
        );
    }
}
```

Top 1% insight:

> Break-glass should be a separately modeled workflow, not an unbounded bypass flag.

---

## 23. Workflow Authorization and BPMN Engines

BPMN engines like Camunda provide task assignment, candidate users/groups, process definitions, and task lifecycle. But they do not automatically solve your domain authorization.

Common misconception:

```text
If task is assigned to user, authorization is solved.
```

Actually:

```text
Task visibility/assignment is one boundary.
Domain action authorization is another boundary.
```

A user may see a task but still not be allowed to approve if:

```text
- SoD violated
- evidence incomplete
- jurisdiction mismatch
- risk requires senior approval
- case state changed
- temporary delegation expired
```

### 23.1 BPMN User Task vs Domain Authorization

| BPMN Concept | Authorization Meaning | Limitation |
|---|---|---|
| Candidate group | Who may claim/see task | May not validate domain object constraints |
| Assignee | Who owns task | Does not automatically satisfy SoD |
| Task completion | Workflow event | Must still validate business guard |
| Process variable | Context | Can be stale or tampered if not controlled |
| Process definition permission | Engine-level access | Not equal to case-level permission |

### 23.2 Recommended Pattern

```text
User completes BPMN task
    -> application command handler receives intent
    -> load domain aggregate/case
    -> evaluate domain workflow authorization
    -> if allowed, complete engine task and mutate domain consistently
    -> audit both domain transition and engine task
```

Do not let UI complete workflow task directly without domain guard.

---

## 24. Workflow Authorization in Event-Driven Systems

In messaging systems, workflow transitions may be triggered by events:

```text
PaymentReceived
ClarificationSubmitted
ExternalInspectionCompleted
DeadlineExpired
AppealFiled
```

The question becomes:

```text
Is this event allowed to cause this state transition?
```

### 24.1 Event Source Authorization

For integration event:

```text
- Is producer trusted?
- Is event type allowed from this producer?
- Is event correlated to this case?
- Is event replayed?
- Is event stale?
- Does event match expected state?
```

Example:

```java
public final class IntegrationEventAuthorizer {
    public WorkflowAuthorizationDecision canApply(
            IntegrationEvent event,
            CaseSnapshot caseSnapshot,
            AuthorizationContext context
    ) {
        if (!event.trustedProducer()) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.EXPLICIT_POLICY_DENY,
                    "untrusted producer"
            );
        }

        if (!Objects.equals(event.caseId(), caseSnapshot.caseId())) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.OUTSIDE_RESOURCE_BOUNDARY,
                    "event case id mismatch"
            );
        }

        if (event.occurredAt().isBefore(caseSnapshot.lastTransitionAt())) {
            return WorkflowAuthorizationDecision.deny(
                    DenialReason.EXPLICIT_POLICY_DENY,
                    "stale event"
            );
        }

        return WorkflowAuthorizationDecision.allow("event can be applied");
    }
}
```

---

## 25. Domain State Must Be Server-Owned

Never trust client-supplied state for authorization.

Bad request:

```json
{
  "caseId": "C-123",
  "currentState": "UNDER_REVIEW",
  "action": "APPROVE"
}
```

Bad server logic:

```java
if (request.currentState().equals("UNDER_REVIEW")) {
    approve();
}
```

Correct:

```text
client supplies intent/action
server loads current state from trusted store
server evaluates transition
```

Command should look like:

```json
{
  "caseId": "C-123",
  "action": "APPROVE",
  "reason": "Evidence complete",
  "expectedVersion": 42
}
```

The state comes from database.

---

## 26. Audit Defensibility for Workflow Authorization

Workflow authorization audit should answer:

```text
Who attempted action?
What action?
On which resource?
In what state?
What target state?
Was it allowed?
Why?
Which policy/rule version?
Which attributes/evidence were used?
Was there delegation/override?
Was SoD evaluated?
Was assignment evaluated?
What correlation/request id?
```

### 26.1 Audit Event Shape

```json
{
  "eventType": "WORKFLOW_AUTHORIZATION_DECISION",
  "decisionId": "dec-2026-000001",
  "correlationId": "req-abc",
  "subjectId": "u-123",
  "subjectType": "HUMAN_USER",
  "resourceType": "CASE",
  "resourceId": "C-123",
  "fromState": "UNDER_REVIEW",
  "action": "APPROVE",
  "targetState": "APPROVED",
  "outcome": "DENY",
  "reasonCode": "SEPARATION_OF_DUTY_VIOLATION",
  "policyVersion": "case-workflow-authz:2026-06-19.1",
  "evaluatedAt": "2026-06-19T08:00:00Z",
  "evidence": {
    "assignedOfficerId": "u-123",
    "createdBy": "u-123",
    "agencyId": "agency-a"
  }
}
```

### 26.2 Audit Before and After Mutation

Two events are useful:

```text
1. Authorization decision audit
2. State transition audit
```

Why both?

```text
Decision audit shows why action was allowed/denied.
Transition audit shows what actually changed.
```

For denied actions, only decision audit exists.

For allowed actions, both exist.

---

## 27. Error Semantics

Workflow denial should not always expose exact reason to user.

Internal reason:

```text
SEPARATION_OF_DUTY_VIOLATION: user is maker
```

User-facing message:

```text
You are not allowed to approve this case.
```

Admin/debug message:

```text
Approval denied because current actor previously submitted this case.
```

API response:

```json
{
  "error": "ACCESS_DENIED",
  "message": "You are not allowed to perform this action.",
  "correlationId": "req-abc"
}
```

Do not leak:

```text
- hidden case exists
- another officer owns it
- specific sensitive workflow state
- protected agency relationship
```

---

## 28. Testing Workflow Authorization

### 28.1 Matrix-Based Tests

Test from matrix:

```text
state + action + actor + context -> expected decision
```

Example JUnit 5 parameterized test:

```java
@ParameterizedTest
@MethodSource("approvalCases")
void approveAuthorizationScenarios(
        CaseState state,
        SubjectRef subject,
        CaseSnapshot caseSnapshot,
        boolean expectedAllowed,
        DenialReason expectedReason
) {
    WorkflowAuthorizationInput input = new WorkflowAuthorizationInput(
            subject,
            caseSnapshot,
            CaseAction.APPROVE,
            testContext()
    );

    WorkflowAuthorizationDecision decision = authorizer.canTransition(input);

    assertEquals(expectedAllowed, decision.isAllowed());
    if (!expectedAllowed) {
        assertEquals(expectedReason, decision.denialReason());
    }
}
```

### 28.2 Important Test Categories

```text
- valid transition allowed
- invalid state denied
- missing permission denied
- wrong agency denied
- not assigned denied
- maker-checker violation denied
- expired delegation denied
- expired appeal window denied
- incomplete evidence denied
- break-glass allowed with obligations
- stale version rejected
- concurrent transition conflict
- batch/system actor constrained
```

### 28.3 Negative Tests Are More Important Than Positive Tests

For authorization:

```text
One allowed path is easy.
Twenty forbidden paths are where bugs hide.
```

---

## 29. Property-Based Thinking for Workflow Authorization

Even without property-based testing library, think in properties.

Examples:

```text
No actor may approve their own submission.
No case can move from CLOSED to APPROVED directly.
No user outside agency can mutate agency-owned case.
No denied decision may mutate state.
Every successful transition must produce audit event.
Every break-glass transition must include reason and expiry.
Every state transition must be valid in transition table.
```

These are stronger than scenario tests.

---

## 30. Workflow Authorization Anti-Patterns

### 30.1 Role-Only Approval

```java
if (hasRole("APPROVER")) approve(caseId);
```

Fails assignment, state, SoD, evidence, agency, time, and history.

---

### 30.2 Client-Supplied State

```java
if (request.state().equals("UNDER_REVIEW")) approve();
```

The client must never define authoritative workflow state.

---

### 30.3 Generic Update Endpoint

```http
PATCH /cases/{id}
{
  "status": "APPROVED"
}
```

This bypasses transition semantics.

Prefer command endpoints or command payloads:

```http
POST /cases/{id}/approval
POST /cases/{id}/rejection
POST /cases/{id}/clarification-request
```

---

### 30.4 State Change in Repository

```java
caseRepository.updateStatus(caseId, "APPROVED");
```

Without workflow service, it bypasses authorization and audit.

---

### 30.5 BPMN Task Completion as Authorization

```text
User can complete task -> therefore user can approve case.
```

False. Task authorization and domain authorization are different.

---

### 30.6 Superadmin Escape Hatch

```java
if (user.isAdmin()) return true;
```

This destroys SoD and audit defensibility.

If emergency access exists, model it as break-glass.

---

### 30.7 Missing Denied Audit

Only auditing successful actions loses evidence of attempted abuse or misconfiguration.

---

### 30.8 Filter-After-Transition

```java
case.approve();
if (!authorized) throw new AccessDeniedException();
```

Authorization must happen before mutation.

---

## 31. Database Design Considerations

### 31.1 Case Main Table

```sql
CREATE TABLE cases (
    case_id             VARCHAR(64) PRIMARY KEY,
    case_type           VARCHAR(64) NOT NULL,
    state_code          VARCHAR(64) NOT NULL,
    agency_id           VARCHAR(64) NOT NULL,
    created_by          VARCHAR(64) NOT NULL,
    assigned_officer_id VARCHAR(64),
    version_no          BIGINT NOT NULL,
    submitted_at        TIMESTAMP,
    rejected_at         TIMESTAMP,
    approved_at         TIMESTAMP,
    closed_at           TIMESTAMP,
    last_transition_at  TIMESTAMP NOT NULL
);
```

### 31.2 Transition History Table

```sql
CREATE TABLE case_transition_history (
    id                  BIGINT PRIMARY KEY,
    case_id              VARCHAR(64) NOT NULL,
    from_state           VARCHAR(64) NOT NULL,
    action_code          VARCHAR(64) NOT NULL,
    to_state             VARCHAR(64) NOT NULL,
    actor_id             VARCHAR(64) NOT NULL,
    actor_type           VARCHAR(32) NOT NULL,
    reason_code          VARCHAR(64),
    comment_text         VARCHAR(4000),
    correlation_id       VARCHAR(128) NOT NULL,
    occurred_at          TIMESTAMP NOT NULL
);

CREATE INDEX idx_case_transition_history_case
ON case_transition_history(case_id, occurred_at);
```

### 31.3 Decision Audit Table

```sql
CREATE TABLE authorization_decision_audit (
    decision_id          VARCHAR(128) PRIMARY KEY,
    correlation_id       VARCHAR(128) NOT NULL,
    subject_id           VARCHAR(64) NOT NULL,
    subject_type         VARCHAR(32) NOT NULL,
    resource_type        VARCHAR(64) NOT NULL,
    resource_id          VARCHAR(64) NOT NULL,
    action_code          VARCHAR(64) NOT NULL,
    from_state           VARCHAR(64),
    outcome_code         VARCHAR(32) NOT NULL,
    reason_code          VARCHAR(128),
    policy_version       VARCHAR(128),
    evidence_json        CLOB,
    decided_at           TIMESTAMP NOT NULL
);
```

For PostgreSQL use `jsonb`. For Oracle, CLOB or JSON type depending on version/platform.

---

## 32. Java 8–25 Design Notes

### Java 8

Use:

```text
- `java.time`
- immutable classes manually
- enums for actions/states
- interfaces for guards
- `CompletableFuture` only if async is truly needed
```

Avoid relying on records/sealed types.

### Java 11

Mostly runtime/library improvements. No major workflow authorization model change.

### Java 17

Useful:

```text
- records for value objects
- sealed classes for decision/result types
- switch expressions from earlier releases if available in target
```

But keep core model portable if library supports Java 8.

### Java 21

Virtual threads can help high-concurrency workflow services, especially when authorization loads many attributes. But they do not solve authorization correctness.

Be careful:

```text
- ThreadLocal security context propagation
- transaction context
- MDC/correlation id
- blocking calls to remote PDP/PIP
```

### Java 25

Treat Java 25 as newer runtime target; authorization model remains the same. Use newer language/runtime features only where they improve clarity and your deployment baseline permits them.

---

## 33. Spring Implementation Notes

### 33.1 Method Security + Domain Authorizer

You can combine coarse method security and domain guard:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approve(ApproveCaseCommand command) {
    // Still perform workflow/domain authorization inside.
}
```

But do not rely on annotation alone.

### 33.2 Domain Service as Final Enforcement Point

```text
Controller: parse request, map subject/context
Service: load entity, authorize transition, mutate
Repository: data access only, no hidden state mutation shortcut
```

### 33.3 Transaction Boundary

```java
@Transactional
public void approve(...) {
    load current entity
    authorize current entity
    mutate
    persist
    audit
}
```

For audit, decide whether audit must be in same transaction or durable even when mutation fails. Often:

```text
- denied authorization audit should persist even without business mutation
- successful transition audit should be transactionally consistent with mutation
```

This may require outbox pattern.

---

## 34. Outbox Pattern for Workflow Audit Events

For reliable audit/event publishing:

```sql
CREATE TABLE outbox_event (
    event_id        VARCHAR(128) PRIMARY KEY,
    aggregate_type  VARCHAR(64) NOT NULL,
    aggregate_id    VARCHAR(64) NOT NULL,
    event_type      VARCHAR(128) NOT NULL,
    payload_json    CLOB NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    published_at    TIMESTAMP,
    status_code     VARCHAR(32) NOT NULL
);
```

Inside transaction:

```text
- update case state
- insert transition history
- insert outbox event
```

Async publisher later publishes safely.

Authorization-specific caution:

```text
Denied decision audit may need separate durable write path because no business transaction may exist.
```

---

## 35. Workflow Authorization Checklist

Use this checklist before approving a workflow design.

### 35.1 State and Transition

```text
[ ] Are all states explicit?
[ ] Are all allowed transitions enumerated?
[ ] Are invalid transitions denied by default?
[ ] Is current state loaded from trusted server-side store?
[ ] Is target state derived server-side?
[ ] Are generic status updates forbidden?
```

### 35.2 Actor and Scope

```text
[ ] Does the model support human, system, delegated, and integration actors?
[ ] Are roles separated from assignments?
[ ] Are tenant/agency/org boundaries enforced?
[ ] Are support/admin paths explicitly modeled?
```

### 35.3 Separation of Duties

```text
[ ] Is maker-checker enforced object-level?
[ ] Is four-eyes principle modeled as state/stage?
[ ] Are previous actors recorded?
[ ] Are conflict-of-interest cases denied?
```

### 35.4 Temporal Rules

```text
[ ] Are appeal/withdraw/amend windows explicit?
[ ] Is time sourced from server-side clock?
[ ] Are deadlines tested deterministically?
[ ] Are SLA escalations constrained?
```

### 35.5 Evidence and Obligations

```text
[ ] Are mandatory documents/checklists validated before transition?
[ ] Are reasons required for sensitive actions?
[ ] Are notifications/audit obligations explicit?
[ ] Are break-glass obligations mandatory?
```

### 35.6 Concurrency

```text
[ ] Is transition checked inside transaction?
[ ] Is stale version detected?
[ ] Are concurrent approvals/rejections prevented?
[ ] Is lock behavior included in authorization?
```

### 35.7 Audit

```text
[ ] Are allowed and denied decisions audited?
[ ] Is policy version recorded?
[ ] Is evidence snapshot recorded?
[ ] Is correlation ID recorded?
[ ] Can historical decision be reconstructed?
```

---

## 36. Top 1% Engineering Heuristics

### Heuristic 1: Model the Verb, Not the CRUD

`approve`, `return`, `escalate`, `withdraw`, `reopen` are authorization-relevant. `update` is not precise enough.

### Heuristic 2: State Is Part of Authorization Input

A permission without state is incomplete for workflow.

### Heuristic 3: Assignment Is Not Role

Role gives capability. Assignment gives resource scope.

### Heuristic 4: History Matters

Maker-checker and SoD require remembering who did what before.

### Heuristic 5: Denied Decisions Are Evidence

Denied attempts can reveal abuse, confusion, or broken policy rollout.

### Heuristic 6: System Actors Need Narrow Policy

Batch jobs and workflow engines must have explicit constraints.

### Heuristic 7: Workflow Authorization Is a Legal/Business Invariant

In regulatory/case systems, an invalid transition can be more damaging than a failed request.

### Heuristic 8: Break-Glass Is a Workflow

Emergency access must have activation, reason, expiry, scope, notification, and review.

### Heuristic 9: Never Trust Client State

Client submits intent. Server owns state.

### Heuristic 10: Transition Table Is a Security Artifact

It should be reviewed like code, tested like policy, and audited like compliance evidence.

---

## 37. Practical Mini Architecture

Recommended high-level structure:

```text
com.example.caseapp.authorization
  SubjectRef
  AuthorizationContext
  WorkflowAuthorizationDecision
  DenialReason
  WorkflowGuard
  AllOfGuard

com.example.caseapp.caseworkflow
  CaseState
  CaseAction
  TransitionKey
  TransitionDefinition
  WorkflowAuthorizer
  CaseWorkflowDefinitions
  CaseWorkflowService

com.example.caseapp.caseworkflow.guard
  HasPermissionGuard
  SameAgencyGuard
  AssignedOfficerGuard
  NotMakerGuard
  MandatoryDocumentsCompleteGuard
  AppealWindowGuard
  CaseLockGuard
  BreakGlassGuard

com.example.caseapp.audit
  AuthorizationDecisionAudit
  StateTransitionAudit
  AuditPublisher
  OutboxEvent
```

Flow:

```text
Controller / Consumer / Job
    -> maps actor + command
    -> CaseWorkflowService
        -> load current case with version/lock
        -> build snapshot
        -> WorkflowAuthorizer.canTransition
        -> audit decision
        -> enforce obligations
        -> mutate state
        -> write transition history
        -> write outbox/audit
```

---

## 38. Summary

Workflow authorization is about controlling legitimate business state change.

The core question is not:

```text
Does user have role APPROVER?
```

The core question is:

```text
Can this actor, under this context, cause this specific resource to transition
from its current trusted state to the next state through this business event,
while satisfying permission, boundary, assignment, SoD, temporal, evidence,
risk, and audit constraints?
```

A strong design:

```text
- enumerates transitions
- places authorization inside mutation boundary
- uses decision objects, not booleans
- separates role from assignment
- treats state/history/time/evidence as authorization inputs
- audits both denied and allowed decisions
- handles concurrency and stale state
- models emergency override explicitly
```

This is one of the most important differences between ordinary authorization engineering and high-level enterprise/regulatory authorization engineering.

---

## 39. References

1. OWASP Authorization Cheat Sheet — deny by default, least privilege, centralized authorization, access control verification.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

2. OWASP Top 10 2021 A01 Broken Access Control — common broken access-control failures including least privilege and deny-by-default violations.  
   https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/

3. OWASP API Security 2023 API1 Broken Object Level Authorization — object-level authorization requirements for APIs.  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

4. Spring Statemachine Reference Documentation — state machine concepts including transitions, guards, actions, hierarchical states, regions, and listeners.  
   https://docs.spring.io/spring-statemachine/docs/current/reference/

5. NIST RBAC Model — includes constrained RBAC and separation of duty concepts.  
   https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=916402

6. Camunda 8 User Tasks Documentation — BPMN user task assignment and access concepts.  
   https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/

7. Camunda User Groups Documentation — user groups used for access management and task restrictions.  
   https://docs.camunda.io/docs/8.7/components/concepts/access-control/user-groups/

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
```

Belum selesai. Part berikutnya:

```text
[ ] Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-018.md">⬅️ Part 18 — Data-Level Authorization and Query Scoping</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-020.md">Java Authorization Modes and Patterns — Part 20 ➡️</a>
</div>

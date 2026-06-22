# learn-java-validation-jakarta-hibernate-validator-part-022

# Validation for Workflow, State Machines, and Regulatory Case Management

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `022`  
> Topik: Validation untuk workflow, state machine, dan regulatory case management  
> Target Java: 8 sampai 25  
> Target API: Bean Validation 2.0 `javax.validation`, Jakarta Validation 3.x `jakarta.validation`, Hibernate Validator 6.x sampai 9.x

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian-bagian sebelumnya kita sudah membahas validation dari sisi:

- constraint dasar,
- nullability,
- cascaded validation,
- container element constraints,
- validation groups,
- group sequence,
- custom constraint,
- class-level validation,
- executable validation,
- records/immutability,
- message interpolation,
- payload/error code,
- programmatic mapping,
- constraint composition,
- Hibernate Validator extensions,
- dependency injection,
- REST API,
- persistence,
- event-driven systems.

Bagian ini masuk ke wilayah yang lebih arsitektural: **bagaimana validation digunakan dalam sistem workflow, state machine, dan case management regulatori**.

Ini penting karena sistem enterprise/regulatory sering punya rule seperti:

- application hanya boleh disubmit jika dokumen wajib lengkap,
- appeal hanya boleh dibuat dalam N hari setelah decision,
- compliance action hanya boleh di-close jika enforcement note sudah diisi,
- officer tidak boleh approve case yang dia buat sendiri,
- case tidak boleh pindah dari `DRAFT` langsung ke `APPROVED`,
- supervisor override wajib memiliki reason,
- SLA warning berbeda dari validation error,
- transition tertentu hanya berlaku untuk channel, role, agency, atau jurisdiction tertentu,
- rejection reason harus explainable dan audit-safe.

Kesalahan umum adalah memaksakan semua rule ini ke Bean/Jakarta Validation annotation. Itu membuat sistem tampak rapi di awal, tetapi lama-lama rule menjadi tersembunyi, sulit ditest, sulit diaudit, dan sulit dievolusi.

Part ini akan memberi mental model kapan memakai:

- Jakarta Validation,
- custom `ConstraintValidator`,
- validation group,
- group sequence,
- domain validator,
- policy object,
- state transition guard,
- authorization check,
- database constraint,
- audit rule,
- workflow rule engine.

---

## 1. Core Thesis: Workflow Validation Bukan DTO Validation

### 1.1 DTO validation menjawab pertanyaan “apakah data ini berbentuk valid?”

Contoh:

```java
public record SubmitApplicationRequest(
        @NotBlank String applicationId,
        @NotBlank String applicantName,
        @NotNull ApplicationType type,
        @Valid List<@NotNull DocumentRequest> documents
) {}
```

Rule seperti ini menjawab:

- field wajib ada atau tidak,
- string kosong atau tidak,
- format email valid atau tidak,
- collection terlalu besar atau tidak,
- nested object valid atau tidak.

Ini adalah **shape validation** atau **local contract validation**.

### 1.2 Workflow validation menjawab pertanyaan “apakah aksi ini sah dilakukan saat ini?”

Contoh:

```text
Can officer A approve case C at 2026-06-16 10:00?
```

Pertanyaan ini tidak bisa dijawab hanya dari DTO karena perlu konteks:

- current case state,
- actor role,
- actor identity,
- maker-checker relationship,
- assignment ownership,
- previous action history,
- submitted documents,
- jurisdiction,
- SLA/deadline,
- lock/version,
- pending dependencies,
- regulatory rule version,
- agency/channel configuration.

Ini adalah **contextual validation** atau **transition eligibility validation**.

### 1.3 Domain invariant menjawab pertanyaan “apakah object ini bisa eksis secara valid?”

Contoh:

```java
public final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    public DateRange(LocalDate start, LocalDate end) {
        if (start == null || end == null) {
            throw new IllegalArgumentException("start and end are required");
        }
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
        this.start = start;
        this.end = end;
    }
}
```

Ini bukan sekadar input validation. Ini adalah invariant: object `DateRange` tidak boleh pernah ada dalam kondisi `end < start`.

### 1.4 Database constraint menjawab pertanyaan “apakah state final bisa disimpan secara konsisten?”

Contoh:

```sql
ALTER TABLE CASE_ACTION
ADD CONSTRAINT CK_CASE_ACTION_TYPE
CHECK (ACTION_TYPE IN ('SUBMIT', 'APPROVE', 'REJECT', 'CLOSE'));
```

Database constraint adalah garis pertahanan terakhir. Ia tidak menjelaskan UX, tetapi menjaga konsistensi final.

---

## 2. Validation Taxonomy untuk Workflow System

Di sistem workflow/case management, rule perlu diklasifikasikan. Tanpa klasifikasi, semua orang akan menyebut semua hal sebagai “validation”, lalu rule tersebar di DTO, controller, service, repository, frontend, database, dan scheduler.

Gunakan taxonomy berikut.

---

## 3. Syntactic Validation

Syntactic validation mengecek apakah input punya bentuk yang benar.

Contoh:

- case reference format,
- postal code format,
- email format,
- date format,
- string length,
- file extension,
- enum value,
- collection size.

Cocok untuk Jakarta Validation:

```java
public record SearchCaseRequest(
        @Pattern(regexp = "^CASE-[0-9]{8}$") String caseRef,
        @Size(max = 100) String keyword,
        @Min(0) int page,
        @Min(1) @Max(100) int size
) {}
```

Karakteristik:

- tidak butuh database,
- tidak butuh actor,
- tidak butuh state lama,
- deterministic,
- cheap,
- cocok untuk boundary layer.

---

## 4. Semantic Validation

Semantic validation mengecek apakah value masuk akal dalam domain lokal.

Contoh:

- `fromDate <= toDate`,
- amount tidak boleh negatif,
- applicant type `COMPANY` harus punya UEN/business identifier,
- reason wajib jika action `REJECT`,
- at least one supporting document harus diupload.

Sebagian cocok untuk class-level Jakarta Validation.

```java
@ValidDateRange(start = "fromDate", end = "toDate")
public record CaseSearchRequest(
        LocalDate fromDate,
        LocalDate toDate
) {}
```

Namun hati-hati: semantic validation hanya cocok di annotation jika rule masih **local to one object**.

Jika rule perlu current case state, actor, external config, atau data historis, jangan jadikan Bean Validation constraint biasa.

---

## 5. Business Rule Validation

Business rule validation mengecek apakah aksi sesuai aturan bisnis.

Contoh:

- renewal hanya boleh dibuat jika licence masih aktif atau baru expired kurang dari 30 hari,
- appeal hanya boleh diajukan dalam 14 hari setelah decision notice,
- compliance case hanya boleh close jika semua follow-up task selesai,
- supervisor override butuh reason minimal 20 karakter,
- high-risk case perlu second-level approval.

Rule ini biasanya tidak cocok untuk annotation field-level.

Lebih cocok dimodelkan sebagai:

- domain service,
- policy object,
- specification,
- workflow guard,
- rule evaluator.

Contoh:

```java
public interface CaseActionPolicy {
    ValidationDecision canSubmit(CaseRecord caseRecord, OfficerActor actor, Instant now);
}
```

---

## 6. Authorization Check

Authorization bukan validation, meskipun sering terlihat mirip.

Pertanyaan validation:

```text
Is this input structurally and semantically valid?
```

Pertanyaan authorization:

```text
Is this actor allowed to perform this action on this resource?
```

Contoh authorization:

- officer hanya boleh melihat case milik unitnya,
- maker tidak boleh checker untuk case yang sama,
- junior officer tidak boleh approve high-risk case,
- external user hanya boleh update own draft application,
- admin boleh override field tertentu.

Jangan menaruh authorization di `ConstraintValidator`.

Buruk:

```java
@CanApproveCase
public record ApproveCaseRequest(String caseId) {}
```

Kenapa buruk?

- validator butuh current user,
- validator butuh database,
- hasil failure bisa 403, bukan 400/422,
- behavior tergantung security context,
- sulit dites,
- risk leakage: unauthorized resource tampak invalid.

Lebih baik:

```java
public void approve(ApproveCaseCommand command, Actor actor) {
    validateCommandShape(command);
    authorizationService.assertCanApprove(actor, command.caseId());
    workflowService.approve(command, actor);
}
```

---

## 7. Workflow Guard

Workflow guard mengecek apakah transition boleh dilakukan.

Pertanyaan:

```text
Can current state S transition to target state T using event E under context C?
```

Contoh:

```text
DRAFT --SUBMIT--> SUBMITTED
SUBMITTED --ASSIGN--> UNDER_REVIEW
UNDER_REVIEW --REQUEST_INFO--> PENDING_INFO
PENDING_INFO --RECEIVE_INFO--> UNDER_REVIEW
UNDER_REVIEW --RECOMMEND_APPROVAL--> PENDING_APPROVAL
PENDING_APPROVAL --APPROVE--> APPROVED
PENDING_APPROVAL --REJECT--> REJECTED
APPROVED --CLOSE--> CLOSED
```

Guard contoh:

- `SUBMIT` hanya jika mandatory documents complete,
- `ASSIGN` hanya jika actor adalah supervisor,
- `APPROVE` hanya jika actor bukan maker,
- `REJECT` wajib punya rejection reason,
- `CLOSE` hanya jika all enforcement tasks completed.

Guard bukan sekadar field validation.

---

## 8. Consistency Check

Consistency check memastikan state yang akan disimpan tidak bertentangan dengan state lain.

Contoh:

- tidak boleh ada dua active licence untuk same regulated entity,
- tidak boleh ada duplicate active case untuk same offence and period,
- tidak boleh close parent case jika child case masih open,
- tidak boleh issue notice jika payment masih pending,
- tidak boleh final decision jika appeal window masih active, tergantung domain.

Sebagian consistency check butuh database dan concurrency control.

Bean Validation tidak cukup karena hasil validasi bisa obsolete sebelum commit.

Contoh race:

```text
T1: validate no active licence exists -> OK
T2: validate no active licence exists -> OK
T1: insert active licence -> OK
T2: insert active licence -> duplicate business state
```

Solusi akhir biasanya perlu:

- database unique constraint,
- pessimistic lock,
- optimistic locking,
- idempotency key,
- reservation table,
- transaction isolation decision,
- retry-safe command handler.

---

## 9. Auditability Rule

Dalam regulatory system, validasi tidak hanya benar; ia harus bisa dijelaskan.

Pertanyaan audit:

- rule apa yang menyebabkan action ditolak?
- rule versi berapa?
- input apa yang dipakai?
- case state saat rule dievaluasi apa?
- actor siapa?
- waktu evaluasi kapan?
- apakah rule blocking atau warning?
- apakah ada override?
- siapa yang override?
- apa reason override?
- apakah user menerima pesan yang sama?

Bean Validation `ConstraintViolation` memberi informasi field/path/message, tetapi biasanya belum cukup untuk regulatory audit.

Workflow validation perlu hasil lebih kaya.

```java
public record RuleViolation(
        String ruleId,
        String ruleVersion,
        Severity severity,
        boolean blocking,
        String target,
        String messageCode,
        Map<String, Object> evidence
) {}
```

---

## 10. Mental Model Layering

Gunakan layering berikut sebagai default.

```text
[ Client/UI ]
    - usability validation
    - immediate feedback
    - not trusted

[ Transport/API Boundary ]
    - JSON shape
    - type binding
    - DTO Bean/Jakarta Validation
    - no authorization-as-validation

[ Command Boundary ]
    - operation-specific requiredness
    - idempotency key
    - actor/channel/request context
    - command normalization

[ Authorization Layer ]
    - can actor perform action?
    - can actor access resource?
    - can actor override?

[ Workflow Guard Layer ]
    - can event transition current state?
    - are preconditions satisfied?
    - state machine invariant

[ Domain Policy Layer ]
    - business rules
    - deadline/grace period
    - risk/threshold/jurisdiction
    - explainable rule result

[ Persistence Layer ]
    - entity invariant
    - optimistic lock
    - unique/FK/check constraint
    - final consistency

[ Event Layer ]
    - inbound/outbound event contract
    - replay compatibility
    - DLQ/rejection classification

[ Audit/Observability ]
    - rule decision
    - actor/state/time/evidence
    - safe logs/metrics
```

Jakarta Validation paling cocok di:

- transport boundary,
- command local shape,
- local object invariant,
- method pre/post-condition yang pure,
- persistence entity simple invariant.

Jakarta Validation kurang cocok untuk:

- authorization,
- state transition rule,
- long-running workflow rule,
- DB-dependent uniqueness,
- external API dependent rule,
- policy with override/audit/evidence,
- rule needing temporal/historical context.

---

## 11. Case Management Example Domain

Kita gunakan contoh simplified regulatory case management.

### 11.1 States

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_INFO,
    PENDING_APPROVAL,
    APPROVED,
    REJECTED,
    CLOSED,
    WITHDRAWN
}
```

### 11.2 Actions

```java
public enum CaseAction {
    SUBMIT,
    ASSIGN,
    REQUEST_INFO,
    RECEIVE_INFO,
    RECOMMEND_APPROVAL,
    APPROVE,
    REJECT,
    CLOSE,
    WITHDRAW
}
```

### 11.3 Actor

```java
public record Actor(
        String userId,
        Set<String> roles,
        String agency,
        String unit
) {
    public boolean hasRole(String role) {
        return roles != null && roles.contains(role);
    }
}
```

### 11.4 Case aggregate snapshot

```java
public record CaseRecord(
        String caseId,
        CaseStatus status,
        String createdBy,
        String assignedOfficer,
        String assignedUnit,
        boolean mandatoryDocumentsComplete,
        boolean allReviewItemsCompleted,
        boolean allEnforcementTasksCompleted,
        boolean highRisk,
        Instant submittedAt,
        Instant decisionAt,
        long version
) {}
```

---

## 12. DTO Validation for Workflow Action

### 12.1 Submit request

```java
public record SubmitCaseRequest(
        @NotBlank String caseId,
        @Size(max = 1000) String submissionRemarks
) {}
```

This only checks request shape.

It does not answer:

- apakah case masih `DRAFT`,
- apakah mandatory documents complete,
- apakah actor owner case,
- apakah case locked oleh officer lain,
- apakah stale version.

### 12.2 Approval request

```java
public record ApproveCaseRequest(
        @NotBlank String caseId,
        @NotNull Long expectedVersion,
        @Size(max = 2000) String approvalRemarks
) {}
```

This checks local request shape.

Approval eligibility is separate.

---

## 13. Command Model Setelah DTO

DTO adalah transport shape. Command adalah application intent.

```java
public record ApproveCaseCommand(
        String caseId,
        long expectedVersion,
        String approvalRemarks,
        Actor actor,
        Instant requestedAt,
        String correlationId
) {}
```

Command membawa context yang tidak seharusnya datang dari client:

- actor,
- current time,
- correlation id,
- request source,
- trusted channel,
- expected version.

---

## 14. Command Handler Flow

```java
public final class ApproveCaseHandler {

    private final Validator validator;
    private final CaseRepository caseRepository;
    private final AuthorizationService authorizationService;
    private final WorkflowPolicy workflowPolicy;
    private final AuditService auditService;

    public ApproveCaseHandler(
            Validator validator,
            CaseRepository caseRepository,
            AuthorizationService authorizationService,
            WorkflowPolicy workflowPolicy,
            AuditService auditService
    ) {
        this.validator = validator;
        this.caseRepository = caseRepository;
        this.authorizationService = authorizationService;
        this.workflowPolicy = workflowPolicy;
        this.auditService = auditService;
    }

    public void handle(ApproveCaseRequest request, Actor actor, Instant now, String correlationId) {
        Set<ConstraintViolation<ApproveCaseRequest>> violations = validator.validate(request);
        if (!violations.isEmpty()) {
            throw ApiValidationException.from(violations);
        }

        CaseRecord caseRecord = caseRepository.getForUpdateOrOptimisticCheck(request.caseId());

        authorizationService.assertCanApprove(actor, caseRecord);

        ApproveCaseCommand command = new ApproveCaseCommand(
                request.caseId(),
                request.expectedVersion(),
                request.approvalRemarks(),
                actor,
                now,
                correlationId
        );

        PolicyDecision decision = workflowPolicy.canApprove(caseRecord, command);
        auditService.recordPolicyDecision(caseRecord.caseId(), "APPROVE", decision, correlationId);

        if (!decision.allowed()) {
            throw new WorkflowRuleViolationException(decision);
        }

        caseRepository.approve(command.caseId(), command.expectedVersion(), actor.userId(), now);
    }
}
```

Perhatikan separation:

1. DTO validation: request shape.
2. Load state.
3. Authorization.
4. Workflow/domain policy.
5. Audit decision.
6. Persistence with version check.

---

## 15. Workflow Policy Result Model

Jangan hanya return boolean.

Boolean kehilangan alasan.

Buruk:

```java
boolean canApprove(CaseRecord caseRecord, Actor actor);
```

Lebih baik:

```java
public record PolicyDecision(
        boolean allowed,
        List<PolicyViolation> violations,
        List<PolicyWarning> warnings
) {
    public static PolicyDecision allow() {
        return new PolicyDecision(true, List.of(), List.of());
    }

    public static PolicyDecision deny(List<PolicyViolation> violations) {
        return new PolicyDecision(false, List.copyOf(violations), List.of());
    }
}
```

```java
public record PolicyViolation(
        String ruleId,
        String ruleVersion,
        String messageCode,
        Severity severity,
        boolean blocking,
        String target,
        Map<String, Object> evidence
) {}
```

Alasan:

- API bisa memberi error code stabil,
- audit bisa merekam rule id,
- support bisa debug tanpa membaca source code,
- regulator/auditor bisa melihat justification,
- FE bisa menampilkan field/global error dengan benar.

---

## 16. Designing Workflow Guards

### 16.1 Transition table

Mulai dari transition matrix.

```java
public final class CaseTransitionMatrix {

    private static final Map<CaseStatus, Set<CaseAction>> ALLOWED = Map.of(
            CaseStatus.DRAFT, Set.of(CaseAction.SUBMIT, CaseAction.WITHDRAW),
            CaseStatus.SUBMITTED, Set.of(CaseAction.ASSIGN, CaseAction.WITHDRAW),
            CaseStatus.UNDER_REVIEW, Set.of(
                    CaseAction.REQUEST_INFO,
                    CaseAction.RECOMMEND_APPROVAL,
                    CaseAction.REJECT
            ),
            CaseStatus.PENDING_INFO, Set.of(CaseAction.RECEIVE_INFO, CaseAction.WITHDRAW),
            CaseStatus.PENDING_APPROVAL, Set.of(CaseAction.APPROVE, CaseAction.REJECT),
            CaseStatus.APPROVED, Set.of(CaseAction.CLOSE),
            CaseStatus.REJECTED, Set.of(CaseAction.CLOSE),
            CaseStatus.CLOSED, Set.of(),
            CaseStatus.WITHDRAWN, Set.of()
    );

    public boolean isActionAllowed(CaseStatus status, CaseAction action) {
        return ALLOWED.getOrDefault(status, Set.of()).contains(action);
    }
}
```

This handles structural workflow legality.

It does not handle contextual requirements like documents, maker-checker, SLA, risk, etc.

### 16.2 Guard composition

```java
public interface WorkflowGuard<C> {
    Optional<PolicyViolation> evaluate(C context);
}
```

```java
public record ApprovalContext(
        CaseRecord caseRecord,
        ApproveCaseCommand command
) {}
```

```java
public final class StatusAllowsApproveGuard implements WorkflowGuard<ApprovalContext> {
    @Override
    public Optional<PolicyViolation> evaluate(ApprovalContext ctx) {
        if (ctx.caseRecord().status() != CaseStatus.PENDING_APPROVAL) {
            return Optional.of(new PolicyViolation(
                    "CASE_APPROVE_STATUS_ALLOWED",
                    "2026.1",
                    "case.approve.status.invalid",
                    Severity.ERROR,
                    true,
                    "status",
                    Map.of("currentStatus", ctx.caseRecord().status().name())
            ));
        }
        return Optional.empty();
    }
}
```

```java
public final class MakerCheckerGuard implements WorkflowGuard<ApprovalContext> {
    @Override
    public Optional<PolicyViolation> evaluate(ApprovalContext ctx) {
        if (ctx.command().actor().userId().equals(ctx.caseRecord().createdBy())) {
            return Optional.of(new PolicyViolation(
                    "CASE_APPROVE_MAKER_CHECKER",
                    "2026.1",
                    "case.approve.makerChecker.violation",
                    Severity.ERROR,
                    true,
                    "actor",
                    Map.of(
                            "actorId", ctx.command().actor().userId(),
                            "createdBy", ctx.caseRecord().createdBy()
                    )
            ));
        }
        return Optional.empty();
    }
}
```

```java
public final class ReviewCompletedGuard implements WorkflowGuard<ApprovalContext> {
    @Override
    public Optional<PolicyViolation> evaluate(ApprovalContext ctx) {
        if (!ctx.caseRecord().allReviewItemsCompleted()) {
            return Optional.of(new PolicyViolation(
                    "CASE_APPROVE_REVIEW_COMPLETED",
                    "2026.1",
                    "case.approve.review.incomplete",
                    Severity.ERROR,
                    true,
                    "reviewItems",
                    Map.of("allReviewItemsCompleted", false)
            ));
        }
        return Optional.empty();
    }
}
```

### 16.3 Policy aggregator

```java
public final class ApprovalWorkflowPolicy {

    private final List<WorkflowGuard<ApprovalContext>> guards;

    public ApprovalWorkflowPolicy(List<WorkflowGuard<ApprovalContext>> guards) {
        this.guards = List.copyOf(guards);
    }

    public PolicyDecision canApprove(CaseRecord caseRecord, ApproveCaseCommand command) {
        ApprovalContext context = new ApprovalContext(caseRecord, command);

        List<PolicyViolation> violations = guards.stream()
                .map(guard -> guard.evaluate(context))
                .flatMap(Optional::stream)
                .toList();

        if (violations.isEmpty()) {
            return PolicyDecision.allow();
        }
        return PolicyDecision.deny(violations);
    }
}
```

This is more explainable than a giant `if` block hidden in a service.

---

## 17. Why Not Use Validation Groups for Workflow State?

Validation groups can model operation-specific input shape.

Example:

```java
public interface Submit {}
public interface Approve {}

public class CaseActionRequest {
    @NotBlank(groups = {Submit.class, Approve.class})
    private String caseId;

    @NotBlank(groups = Approve.class)
    private String approvalRemarks;
}
```

This is acceptable if it only means:

```text
For approve request, approvalRemarks is required.
```

But it becomes problematic if you use groups like:

```java
public interface DraftState {}
public interface SubmittedState {}
public interface PendingApprovalState {}
public interface HighRiskCase {}
public interface SupervisorOverride {}
public interface AppealWindowOpen {}
```

Why?

- groups become hidden workflow states,
- constraints are scattered across DTO fields,
- rule evaluation needs external context,
- order and reason are hard to understand,
- audit evidence is weak,
- changes require annotation edits across classes,
- runtime group selection becomes a mini rule engine,
- API error may imply 400 even when true failure is 409/403.

Good rule:

> Use validation groups for input contract variants. Do not use them as workflow state machine.

---

## 18. Workflow Rule vs HTTP Status

The same user-facing phrase “not allowed” can map to different technical categories.

| Situation | Category | Common HTTP Status |
|---|---:|---:|
| Missing required field | DTO validation | 400 or 422 |
| Invalid enum/date/format | DTO validation / binding | 400 |
| Actor lacks permission | Authorization | 403 |
| Not logged in | Authentication | 401 |
| Case state does not allow action | Workflow conflict | 409 or 422 |
| Expected version mismatch | Concurrency conflict | 409 |
| Duplicate active case | Consistency conflict | 409 |
| External dependency unavailable | Dependency failure | 503 / 502 / retry |
| Rule not met but can be fixed by user | Domain validation | 422 |
| Database unique constraint violation | Persistence conflict | 409 |

Use one consistent API contract.

Example:

```json
{
  "type": "https://api.example.gov/problems/workflow-rule-violation",
  "title": "Workflow rule violation",
  "status": 409,
  "traceId": "01JZ...",
  "violations": [
    {
      "code": "case.approve.status.invalid",
      "ruleId": "CASE_APPROVE_STATUS_ALLOWED",
      "target": "status",
      "message": "Case cannot be approved from the current status.",
      "metadata": {
        "currentStatus": "UNDER_REVIEW",
        "requiredStatus": "PENDING_APPROVAL"
      }
    }
  ]
}
```

Do not return a generic validation error for everything.

---

## 19. Maker-Checker Validation

Maker-checker is common in regulatory workflow.

Rule:

```text
The person who prepared/recommended a case cannot be the same person who approves it.
```

This is not a DTO constraint.

It needs:

- current actor,
- case history,
- created/recommended by,
- possibly delegation/acting role,
- override policy.

### 19.1 Naive implementation

```java
if (caseRecord.createdBy().equals(actor.userId())) {
    throw new IllegalStateException("Maker cannot approve");
}
```

Problems:

- no rule id,
- no severity,
- no audit evidence,
- no override logic,
- no stable API code,
- no distinction between permission vs workflow rule.

### 19.2 Better implementation

```java
public final class MakerCheckerPolicy {

    public Optional<PolicyViolation> check(CaseRecord caseRecord, Actor actor) {
        if (!actor.userId().equals(caseRecord.createdBy())) {
            return Optional.empty();
        }

        return Optional.of(new PolicyViolation(
                "MAKER_CHECKER_DIFFERENT_ACTOR",
                "2026.1",
                "case.makerChecker.sameActor",
                Severity.ERROR,
                true,
                "actor",
                Map.of(
                        "caseId", caseRecord.caseId(),
                        "actorId", actor.userId(),
                        "createdBy", caseRecord.createdBy()
                )
        ));
    }
}
```

### 19.3 Override-aware maker-checker

Some organizations allow emergency override.

```java
public record OverrideRequest(
        boolean requested,
        String reason
) {}
```

DTO validation:

```java
public record ApproveCaseRequest(
        @NotBlank String caseId,
        @NotNull Long expectedVersion,
        @Valid OverrideRequest override
) {}
```

Policy validation:

```java
public final class MakerCheckerPolicy {

    public Optional<PolicyViolation> check(
            CaseRecord caseRecord,
            Actor actor,
            OverrideRequest override
    ) {
        boolean sameActor = actor.userId().equals(caseRecord.createdBy());
        if (!sameActor) {
            return Optional.empty();
        }

        boolean canOverride = actor.hasRole("SUPERVISOR_OVERRIDE");
        boolean validOverride = override != null
                && override.requested()
                && override.reason() != null
                && override.reason().trim().length() >= 20;

        if (canOverride && validOverride) {
            return Optional.empty();
        }

        return Optional.of(new PolicyViolation(
                "MAKER_CHECKER_OVERRIDE_REQUIRED",
                "2026.1",
                "case.makerChecker.overrideRequired",
                Severity.ERROR,
                true,
                "override.reason",
                Map.of(
                        "sameActor", true,
                        "canOverride", canOverride,
                        "overrideProvided", override != null && override.requested()
                )
        ));
    }
}
```

Important nuance:

- `override.reason` shape can be validated by DTO/class-level validator.
- Whether override is permitted is authorization/policy.
- Whether override is auditable is governance.

---

## 20. Temporal Validation: Deadline, SLA, Grace Period

Temporal rules are tricky because “now” is context.

Examples:

- appeal must be filed within 14 calendar days after decision,
- renewal grace period is 30 days after expiry,
- response to request-for-info must be submitted before due date,
- escalation triggers after SLA breach,
- backdated action allowed only for supervisor.

### 20.1 Do not call `Instant.now()` inside random validators

Bad:

```java
public boolean isValid(LocalDate decisionDate, ConstraintValidatorContext context) {
    return decisionDate.plusDays(14).isAfter(LocalDate.now());
}
```

Problems:

- hard to test,
- timezone ambiguity,
- inconsistent within same request,
- replay/audit impossible,
- decision can differ by server region,
- batch processing not deterministic.

### 20.2 Inject clock or pass evaluation time

For local object validation, use `ClockProvider` when appropriate.

For workflow policy, pass explicit `Instant now`.

```java
public record AppealContext(
        CaseRecord caseRecord,
        Actor actor,
        Instant requestedAt
) {}
```

```java
public final class AppealWindowPolicy {

    private final Duration appealWindow;

    public AppealWindowPolicy(Duration appealWindow) {
        this.appealWindow = appealWindow;
    }

    public Optional<PolicyViolation> check(AppealContext ctx) {
        Instant decisionAt = ctx.caseRecord().decisionAt();
        if (decisionAt == null) {
            return Optional.of(new PolicyViolation(
                    "APPEAL_DECISION_REQUIRED",
                    "2026.1",
                    "appeal.decision.required",
                    Severity.ERROR,
                    true,
                    "decisionAt",
                    Map.of()
            ));
        }

        Instant deadline = decisionAt.plus(appealWindow);
        if (!ctx.requestedAt().isAfter(deadline)) {
            return Optional.empty();
        }

        return Optional.of(new PolicyViolation(
                "APPEAL_WINDOW_EXPIRED",
                "2026.1",
                "appeal.window.expired",
                Severity.ERROR,
                true,
                "submittedAt",
                Map.of(
                        "decisionAt", decisionAt.toString(),
                        "deadline", deadline.toString(),
                        "requestedAt", ctx.requestedAt().toString()
                )
        ));
    }
}
```

### 20.3 Calendar-day vs duration-day

Regulatory systems often care about calendar days, business days, public holidays, or agency-specific cutoff times.

Do not treat all deadline rules as `Duration.ofDays(n)`.

Possible models:

```java
public interface DeadlineCalculator {
    Instant calculateDeadline(Instant start, DeadlineRule rule, ZoneId zoneId);
}
```

```java
public record DeadlineRule(
        int days,
        DayCountingMethod countingMethod,
        boolean includeStartDate,
        boolean moveIfWeekendOrHoliday,
        LocalTime cutoffTime
) {}
```

```java
public enum DayCountingMethod {
    CALENDAR_DAYS,
    BUSINESS_DAYS,
    WORKING_DAYS_EXCLUDING_PUBLIC_HOLIDAYS
}
```

---

## 21. SLA Rule: Warning vs Blocking

SLA is often not a validation error.

Example:

- case is overdue by 2 days,
- action can still be performed,
- but system should show warning and trigger escalation.

Model as warning.

```java
public record PolicyWarning(
        String ruleId,
        String ruleVersion,
        String messageCode,
        String target,
        Map<String, Object> evidence
) {}
```

```java
public final class SlaWarningPolicy {

    public Optional<PolicyWarning> evaluate(CaseRecord caseRecord, Instant now) {
        Instant submittedAt = caseRecord.submittedAt();
        if (submittedAt == null) {
            return Optional.empty();
        }

        Instant slaDueAt = submittedAt.plus(Duration.ofDays(10));
        if (now.isAfter(slaDueAt)) {
            return Optional.of(new PolicyWarning(
                    "CASE_REVIEW_SLA_BREACHED",
                    "2026.1",
                    "case.review.slaBreached",
                    "sla",
                    Map.of(
                            "submittedAt", submittedAt.toString(),
                            "slaDueAt", slaDueAt.toString(),
                            "evaluatedAt", now.toString()
                    )
            ));
        }
        return Optional.empty();
    }
}
```

Do not block all user action just because SLA is breached unless the regulation explicitly says so.

---

## 22. State Machine Modeling

A state machine has:

- states,
- events/actions,
- transitions,
- guards,
- actions/effects,
- entry/exit hooks,
- persistence,
- observability.

Validation sits mostly in guards.

```text
Current State + Event + Context -> Guard Decision -> Transition or Rejection
```

### 22.1 Simple state machine abstraction

```java
public record TransitionKey(CaseStatus from, CaseAction action) {}

public record TransitionDefinition(
        CaseStatus from,
        CaseAction action,
        CaseStatus to,
        List<WorkflowGuard<TransitionContext>> guards
) {}

public record TransitionContext(
        CaseRecord caseRecord,
        CaseAction action,
        Actor actor,
        Instant requestedAt,
        Map<String, Object> input
) {}
```

```java
public final class CaseStateMachine {

    private final Map<TransitionKey, TransitionDefinition> transitions;

    public TransitionResult evaluate(TransitionContext context) {
        TransitionKey key = new TransitionKey(context.caseRecord().status(), context.action());
        TransitionDefinition definition = transitions.get(key);

        if (definition == null) {
            return TransitionResult.rejected(List.of(new PolicyViolation(
                    "CASE_TRANSITION_NOT_DEFINED",
                    "2026.1",
                    "case.transition.notDefined",
                    Severity.ERROR,
                    true,
                    "status",
                    Map.of(
                            "from", context.caseRecord().status().name(),
                            "action", context.action().name()
                    )
            )));
        }

        List<PolicyViolation> violations = definition.guards().stream()
                .map(guard -> guard.evaluate(context))
                .flatMap(Optional::stream)
                .toList();

        if (!violations.isEmpty()) {
            return TransitionResult.rejected(violations);
        }

        return TransitionResult.accepted(definition.to());
    }
}
```

```java
public record TransitionResult(
        boolean accepted,
        CaseStatus targetStatus,
        List<PolicyViolation> violations
) {
    public static TransitionResult accepted(CaseStatus targetStatus) {
        return new TransitionResult(true, targetStatus, List.of());
    }

    public static TransitionResult rejected(List<PolicyViolation> violations) {
        return new TransitionResult(false, null, List.copyOf(violations));
    }
}
```

This design makes transition validation explicit.

### 22.2 State machine frameworks

Frameworks such as Spring Statemachine can model guards/actions/transitions. A framework helps with structure, but does not remove the need to design rule result, audit, persistence, and error mapping.

A top-tier engineer should not equate “we use a state machine library” with “our workflow correctness is solved”.

You still need:

- rule ids,
- deterministic evaluation,
- audit evidence,
- actor context,
- transaction boundary,
- idempotency,
- failure mapping,
- concurrency control,
- test coverage.

---

## 23. Transition Validation vs Transition Execution

Separate check from mutation.

Bad:

```java
public void approve(String caseId) {
    CaseRecord c = repo.find(caseId);
    if (c.status() != PENDING_APPROVAL) throw ...;
    repo.updateStatus(caseId, APPROVED);
    emailService.sendApprovedEmail(caseId);
}
```

Better mental model:

```text
1. Load current state
2. Evaluate transition eligibility
3. Persist state change with concurrency guard
4. Record audit
5. Publish event/outbox
6. Execute side effects asynchronously
```

Pseudo-code:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseRecord c = repo.findById(command.caseId());

    TransitionResult result = stateMachine.evaluate(new TransitionContext(
            c,
            CaseAction.APPROVE,
            command.actor(),
            command.requestedAt(),
            Map.of("remarks", command.approvalRemarks())
    ));

    audit.recordTransitionDecision(c.caseId(), CaseAction.APPROVE, result, command.correlationId());

    if (!result.accepted()) {
        throw new WorkflowRuleViolationException(result.violations());
    }

    int updated = repo.transition(
            c.caseId(),
            c.version(),
            c.status(),
            result.targetStatus(),
            command.actor().userId(),
            command.requestedAt()
    );

    if (updated != 1) {
        throw new ConcurrencyConflictException("Case changed before approval could be committed");
    }

    outbox.enqueue(new CaseApprovedEvent(c.caseId(), command.actor().userId(), command.requestedAt()));
}
```

---

## 24. Concurrency: Validation Can Become Stale

Workflow validation is always a snapshot decision.

Between evaluation and commit, state may change.

Example:

```text
T1 loads case PENDING_APPROVAL version 7
T2 loads case PENDING_APPROVAL version 7
T1 approves -> APPROVED version 8
T2 rejects -> should fail because version changed
```

Use optimistic locking:

```sql
UPDATE CASE_RECORD
SET STATUS = ?, VERSION = VERSION + 1, UPDATED_BY = ?, UPDATED_AT = ?
WHERE CASE_ID = ?
  AND STATUS = ?
  AND VERSION = ?
```

If update count is 0, return conflict.

```java
if (updatedRows == 0) {
    throw new ConcurrencyConflictException("Case state changed. Please reload and try again.");
}
```

Do not assume validation result remains valid until commit.

---

## 25. Regulatory Defensibility

For regulatory systems, a rejection must be defensible.

Defensible means:

- rule is identifiable,
- rule source is known,
- rule version is known,
- decision inputs are known,
- actor and timestamp are known,
- decision can be reproduced or explained,
- override is explicit,
- evidence is safely stored,
- messages are not misleading,
- PII exposure is controlled.

### 25.1 Rule catalog

Maintain a rule catalog.

```yaml
- ruleId: CASE_APPROVE_STATUS_ALLOWED
  version: 2026.1
  category: WORKFLOW
  severity: ERROR
  blocking: true
  description: Case approval is allowed only from PENDING_APPROVAL status.
  target: status
  owner: case-management-team
  effectiveFrom: 2026-01-01

- ruleId: MAKER_CHECKER_DIFFERENT_ACTOR
  version: 2026.1
  category: GOVERNANCE
  severity: ERROR
  blocking: true
  description: Case creator/recommender cannot approve the same case unless override policy applies.
  target: actor
  owner: compliance-governance-team
  effectiveFrom: 2026-01-01
```

This can be a YAML, DB table, internal wiki, generated docs, or code-backed registry. The format is less important than consistency and traceability.

### 25.2 Audit decision record

```java
public record RuleDecisionAudit(
        String correlationId,
        String caseId,
        String action,
        String actorId,
        String fromStatus,
        String targetStatus,
        Instant evaluatedAt,
        List<PolicyViolation> violations,
        List<PolicyWarning> warnings,
        boolean allowed
) {}
```

Be careful not to store sensitive raw values unnecessarily.

---

## 26. Warning, Error, Override, and Enforcement Modes

Not every validation rule should immediately block.

Mature systems often need rule rollout modes.

```java
public enum EnforcementMode {
    DISABLED,
    OBSERVE_ONLY,
    WARN,
    BLOCK
}
```

Example:

- `OBSERVE_ONLY`: evaluate and log metrics, but do not show to user.
- `WARN`: show warning, allow action.
- `BLOCK`: reject action.
- `DISABLED`: do not evaluate.

```java
public record RuleConfiguration(
        String ruleId,
        String version,
        EnforcementMode enforcementMode
) {}
```

This helps when:

- rolling out new regulatory rule,
- tightening existing rule,
- migrating legacy invalid data,
- coordinating with frontend/client release,
- avoiding sudden production disruption.

But be careful: dynamic rule toggles themselves need governance and audit.

---

## 27. Validation and User Journey

Workflow validation should help users fix issues.

Bad error:

```text
Invalid case.
```

Better error:

```text
This case cannot be submitted because mandatory documents are incomplete.
```

Best structured result:

```json
{
  "code": "case.submit.documents.incomplete",
  "target": "documents",
  "message": "Upload all mandatory documents before submitting the case.",
  "metadata": {
    "missingDocumentTypes": ["IDENTITY_PROOF", "SUPPORTING_EVIDENCE"]
  }
}
```

For regulatory systems, consider:

- Can the user fix it?
- Is it an internal officer action?
- Should the error expose internal status?
- Is the actor unauthorized to know resource exists?
- Is it a field-level issue or case-level issue?
- Does it require a support/admin action?
- Should it create a task?
- Should it trigger escalation?

---

## 28. API Error Shape for Workflow Violations

Keep DTO validation errors and workflow violations related but distinct.

### 28.1 DTO validation error

```json
{
  "type": "https://api.example.gov/problems/request-validation-error",
  "title": "Request validation failed",
  "status": 400,
  "traceId": "01JZ...",
  "violations": [
    {
      "code": "jakarta.validation.NotBlank",
      "target": "caseId",
      "message": "caseId is required"
    }
  ]
}
```

### 28.2 Workflow violation

```json
{
  "type": "https://api.example.gov/problems/workflow-rule-violation",
  "title": "Action is not allowed in the current case state",
  "status": 409,
  "traceId": "01JZ...",
  "violations": [
    {
      "code": "case.approve.status.invalid",
      "ruleId": "CASE_APPROVE_STATUS_ALLOWED",
      "ruleVersion": "2026.1",
      "target": "status",
      "message": "Case can only be approved from Pending Approval status.",
      "metadata": {
        "currentStatus": "UNDER_REVIEW"
      }
    }
  ]
}
```

### 28.3 Authorization failure

```json
{
  "type": "https://api.example.gov/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "traceId": "01JZ..."
}
```

Do not expose detailed rule evidence to unauthorized users.

---

## 29. Frontend and UX Contract

Frontend should not duplicate all backend workflow logic, but it can consume eligibility information.

### 29.1 Eligibility endpoint

```http
GET /cases/{caseId}/available-actions
```

Response:

```json
{
  "caseId": "CASE-2026-00001234",
  "status": "UNDER_REVIEW",
  "actions": [
    {
      "action": "REQUEST_INFO",
      "available": true
    },
    {
      "action": "APPROVE",
      "available": false,
      "reasonCodes": ["case.approve.status.invalid"]
    }
  ]
}
```

This improves UX, but final enforcement must still happen in command handler.

Eligibility endpoint is advisory; command execution is authoritative.

### 29.2 Avoid frontend/backend drift

The FE may hide a button based on status, but BE must still reject invalid transition. Never rely on hidden buttons.

---

## 30. Validation in Long-Running Workflow

Long-running case workflows have special issues:

- rule changes while case is open,
- user saves draft under old rule,
- submit happens under new rule,
- case reopened after decision,
- historical event replay,
- appeal against old decision,
- partial migration data.

### 30.1 Rule effective date

A rule should often have:

- effective from,
- effective to,
- applies to channel,
- applies to case type,
- applies to jurisdiction,
- applies to action,
- applies to version.

```java
public record RuleApplicability(
        String ruleId,
        Instant effectiveFrom,
        Instant effectiveTo,
        Set<String> caseTypes,
        Set<String> channels,
        Set<String> jurisdictions
) {}
```

### 30.2 Validate against what time?

Possible evaluation time:

- current server time,
- submission time,
- decision time,
- event occurrence time,
- effective business date,
- backdated official action date.

Pick intentionally.

Do not accidentally use `now` when regulation means “date of application received”.

---

## 31. Validation and Drafts

Drafts are intentionally incomplete.

Do not use submit-level validation for save-draft.

Good pattern:

- draft save validates only basic shape and size/safety,
- submit validates mandatory completeness,
- approve validates workflow state and officer rules.

```java
public interface DraftSave {}
public interface Submit {}
```

```java
public class ApplicationFormDto {

    @NotBlank(groups = Submit.class)
    @Size(max = 200)
    private String applicantName;

    @NotNull(groups = Submit.class)
    private ApplicationType applicationType;

    @Size(max = 5000, groups = {DraftSave.class, Submit.class})
    private String remarks;
}
```

This is a valid use of groups because it models **operation-specific input completeness**, not full workflow state.

---

## 32. Validation and Partial Updates

PATCH is not submit.

PATCH should validate:

- patch operation shape,
- field permission,
- field-specific value,
- transition impact if status/action changes,
- invariant after applying patch.

Recommended flow:

```text
1. Validate patch request shape
2. Load current case/application
3. Check actor can patch target fields
4. Apply patch into candidate model
5. Validate candidate model for target operation/state
6. Persist with optimistic lock
7. Audit changed fields
```

Example:

```java
public record PatchCaseRequest(
        @NotBlank String caseId,
        @NotNull Long expectedVersion,
        @Valid List<@NotNull PatchOperation> operations
) {}
```

Then after applying patch:

```java
CaseDraft candidate = patchApplier.apply(existing, request.operations());
Set<ConstraintViolation<CaseDraft>> violations = validator.validate(candidate, DraftSave.class);
```

If patch is part of submit, validate `Submit.class` after applying.

---

## 33. Validation and Assignment

Assignment rules often blend workflow, authorization, workload, and organization structure.

Examples:

- only supervisor can assign,
- assigned officer must belong to same unit,
- officer must have capability for case type,
- high-risk case requires senior officer,
- officer cannot be assigned if on leave,
- reassignment after review requires reason.

Do not model all of this as `@ValidAssignee` on a field.

Instead:

```java
public final class AssignmentPolicy {

    public PolicyDecision canAssign(CaseRecord caseRecord, Actor assigner, Officer assignee, Instant now) {
        List<PolicyViolation> violations = new ArrayList<>();

        if (!assigner.hasRole("SUPERVISOR")) {
            violations.add(violation("CASE_ASSIGN_SUPERVISOR_REQUIRED", "actor"));
        }

        if (!Objects.equals(caseRecord.assignedUnit(), assignee.unit())) {
            violations.add(violation("CASE_ASSIGN_SAME_UNIT_REQUIRED", "assignee"));
        }

        if (caseRecord.highRisk() && !assignee.hasCapability("HIGH_RISK_REVIEW")) {
            violations.add(violation("CASE_ASSIGN_HIGH_RISK_CAPABILITY_REQUIRED", "assignee"));
        }

        return violations.isEmpty() ? PolicyDecision.allow() : PolicyDecision.deny(violations);
    }

    private PolicyViolation violation(String ruleId, String target) {
        return new PolicyViolation(ruleId, "2026.1", ruleId.toLowerCase(), Severity.ERROR, true, target, Map.of());
    }
}
```

---

## 34. Validation and Regulatory Evidence

Some transitions require evidence.

Example:

- enforcement close requires evidence documents,
- warning letter requires legal template version,
- inspection pass requires checklist completion,
- revocation requires approved recommendation memo.

DTO validation can check list not empty:

```java
public record CloseEnforcementCaseRequest(
        @NotBlank String caseId,
        @NotNull Long expectedVersion,
        @NotEmpty List<@NotBlank String> evidenceDocumentIds,
        @NotBlank @Size(max = 2000) String closingRemarks
) {}
```

But policy must check:

- evidence documents exist,
- they belong to this case,
- correct document type,
- approved/final status,
- not deleted,
- uploaded before close,
- visible to actor,
- retention classification.

This belongs in workflow/domain policy, not pure DTO annotation.

---

## 35. Validation and Evidence Snapshot

When a rule passes due to evidence, store enough to explain later.

Example:

```json
{
  "ruleId": "ENFORCEMENT_CLOSE_EVIDENCE_REQUIRED",
  "ruleVersion": "2026.1",
  "passed": true,
  "evidence": {
    "documentIds": ["DOC-1", "DOC-2"],
    "documentTypes": ["INSPECTION_REPORT", "NOTICE_ACKNOWLEDGEMENT"],
    "evaluatedAt": "2026-06-16T03:00:00Z"
  }
}
```

Do not store entire documents in rule audit. Store references/classification as appropriate.

---

## 36. Validation and Rule Versioning

Rule changes are inevitable.

Examples:

- appeal window changes from 14 to 21 days,
- high-risk threshold changes,
- required document list changes,
- maker-checker exception added,
- SLA calendar changes.

If you hardcode everything without rule ids/versions, debugging historical cases becomes painful.

### 36.1 Version in code

```java
public interface Rule {
    String id();
    String version();
}
```

```java
public final class AppealWindowRule implements Rule {
    @Override public String id() { return "APPEAL_WINDOW"; }
    @Override public String version() { return "2026.1"; }
}
```

### 36.2 Version in config

```yaml
appealWindow:
  ruleId: APPEAL_WINDOW
  version: 2026.1
  days: 14
  countingMethod: CALENDAR_DAYS
  enforcementMode: BLOCK
```

### 36.3 Version in audit

Audit must store evaluated rule version, not only latest version.

---

## 37. Validation and Batch Operations

Batch workflow actions are common:

- bulk assign cases,
- bulk close expired draft applications,
- bulk send reminders,
- bulk import regulatory records,
- bulk approve low-risk cases.

Batch validation should support partial failure.

```java
public record BatchActionResult(
        int total,
        int accepted,
        int rejected,
        List<ItemResult> items
) {}

public record ItemResult(
        String itemId,
        boolean accepted,
        List<PolicyViolation> violations
) {}
```

Do not fail entire batch unless operation requires atomic all-or-nothing.

### 37.1 Batch policy evaluation

```java
public BatchActionResult bulkClose(List<CloseCaseCommand> commands) {
    List<ItemResult> results = new ArrayList<>();

    for (CloseCaseCommand command : commands) {
        CaseRecord c = repo.find(command.caseId());
        PolicyDecision decision = closePolicy.canClose(c, command);
        results.add(new ItemResult(command.caseId(), decision.allowed(), decision.violations()));
    }

    return summarize(results);
}
```

### 37.2 Batch audit

Record:

- batch id,
- actor,
- item count,
- accepted count,
- rejected count,
- rule distribution,
- item-level rejection reason.

---

## 38. Validation and Scheduled Jobs

Scheduled jobs also perform workflow transitions.

Examples:

- auto-expire drafts,
- auto-escalate overdue cases,
- auto-close inactive applications,
- send reminder before deadline,
- mark SLA breached.

Do not bypass policy just because action is system-triggered.

Use a system actor:

```java
public final class SystemActors {
    public static Actor scheduler(String jobName) {
        return new Actor("system:" + jobName, Set.of("SYSTEM"), "SYSTEM", "SYSTEM");
    }
}
```

Then evaluate workflow policy with actor context.

---

## 39. Validation and Reopen/Reversal

Regulatory case systems often need reversal:

- reopen closed case,
- withdraw approval,
- amend decision,
- reverse mistaken closure,
- reopen appeal.

These are dangerous transitions.

Rules usually include:

- allowed only by supervisor/admin,
- reason required,
- cannot reopen after retention/archive boundary,
- cannot reopen if downstream action already taken,
- must create audit entry,
- may require dual approval.

Do not treat reopen as just setting `status = UNDER_REVIEW`.

Model as explicit transition with guards.

```text
CLOSED --REOPEN--> UNDER_REVIEW
```

with rule ids:

- `CASE_REOPEN_ROLE_REQUIRED`,
- `CASE_REOPEN_REASON_REQUIRED`,
- `CASE_REOPEN_NOT_ARCHIVED`,
- `CASE_REOPEN_DOWNSTREAM_IMPACT_ALLOWED`.

---

## 40. Validation and Cross-Entity Impact

Some workflow validations affect multiple entities.

Examples:

- closing parent case requires all child cases closed,
- approving licence affects profile eligibility,
- revocation affects active appointments,
- refund action affects revenue record,
- compliance decision affects enforcement schedule.

Bean Validation is not a good fit.

Use application service/policy with explicit dependency reads.

```java
public final class ParentCaseClosurePolicy {

    private final ChildCaseRepository childCaseRepository;

    public PolicyDecision canClose(CaseRecord parent, CloseCaseCommand command) {
        List<ChildCaseSummary> openChildren = childCaseRepository.findOpenChildren(parent.caseId());

        if (!openChildren.isEmpty()) {
            return PolicyDecision.deny(List.of(new PolicyViolation(
                    "PARENT_CASE_CLOSE_CHILDREN_OPEN",
                    "2026.1",
                    "case.close.childrenOpen",
                    Severity.ERROR,
                    true,
                    "childCases",
                    Map.of("openChildCaseIds", openChildren.stream().map(ChildCaseSummary::caseId).toList())
            )));
        }

        return PolicyDecision.allow();
    }
}
```

If consistency is critical, also enforce with transaction/locking/DB constraints where possible.

---

## 41. Validation and External Dependencies

Some rules depend on external systems:

- payment status,
- identity verification,
- company registry status,
- blacklist/sanction status,
- address validation,
- licence registry.

Be careful.

External dependency failure is not necessarily invalid input.

Classification:

| External Result | Meaning | Handling |
|---|---|---|
| Found invalid | business/domain violation | reject/warn |
| Not found | maybe invalid, maybe stale | domain-specific |
| Timeout | dependency failure | retry/503/pending |
| 429 | rate-limited | retry/backoff |
| 5xx | dependency failure | retry/fallback |
| stale cached data | risk decision | configurable |

Do not hide dependency failure as `@ValidExternalStatus` violation.

---

## 42. Validation and Idempotency

Workflow actions must often be idempotent.

Example: user double-clicks submit.

```text
First SUBMIT: DRAFT -> SUBMITTED
Second SUBMIT with same idempotency key: return same success
Second SUBMIT with different key: reject or conflict
```

Validation must account for repeated commands.

```java
public record SubmitCaseCommand(
        String caseId,
        String idempotencyKey,
        Actor actor,
        Instant requestedAt
) {}
```

Do not simply return “invalid state” on retry if the first command succeeded. That creates poor UX and unreliable integrations.

Idempotency policy can say:

- same key + same payload + already transitioned = return previous result,
- same key + different payload = conflict,
- no key + already submitted = conflict,
- duplicate message = ignore/ack.

---

## 43. Validation and Event Emission

After a transition, emit domain event only after commit, usually through outbox.

Bad:

```java
repo.updateStatus(caseId, APPROVED);
eventBus.publish(new CaseApprovedEvent(caseId));
```

If DB commit fails after event publish, downstream sees false approval.

Better:

```java
repo.updateStatus(caseId, APPROVED);
outbox.insert(new CaseApprovedEvent(caseId));
```

Validation result should be part of audit, not necessarily part of public event.

---

## 44. Validation and Backoffice Manual Override

Manual override is not “skip validation”.

Override is another workflow transition with its own rules.

It should record:

- who overrides,
- what rule is overridden,
- reason,
- approval chain,
- timestamp,
- evidence,
- scope,
- expiry if applicable.

```java
public record OverrideDecision(
        String overriddenRuleId,
        String approvedBy,
        String reason,
        Instant approvedAt
) {}
```

Rule result can include override requirement:

```java
public record PolicyViolation(
        String ruleId,
        String ruleVersion,
        String messageCode,
        Severity severity,
        boolean blocking,
        boolean overrideAllowed,
        String target,
        Map<String, Object> evidence
) {}
```

Do not silently suppress violations.

---

## 45. Validation and Data Migration

Legacy data often violates new rules.

Examples:

- old cases missing mandatory field,
- old statuses no longer valid,
- old document type removed,
- old actor id format invalid,
- old date ranges inconsistent.

Strategies:

1. Do not run new submit validation on historical closed case unless action requires it.
2. Use rule applicability/effective date.
3. Create remediation jobs.
4. Use warnings before blocking.
5. Keep legacy compatibility layer.
6. Separate “data quality issue” from “user input invalid”.

Migration validator result:

```java
public record DataQualityIssue(
        String entityType,
        String entityId,
        String issueCode,
        Severity severity,
        boolean blocksFutureAction,
        Map<String, Object> evidence
) {}
```

---

## 46. Validation and Observability

Track workflow validation metrics.

Examples:

- count of rejected transitions by action,
- top violated rule ids,
- violation rate by client/channel,
- average policy evaluation latency,
- external dependency failures during policy evaluation,
- override count by rule,
- warning count before enforcement,
- concurrency conflict rate,
- stale update rate,
- action eligibility mismatch between UI and command execution.

Metric examples:

```text
workflow_policy_evaluations_total{action="APPROVE", result="allowed"}
workflow_policy_evaluations_total{action="APPROVE", result="rejected", ruleId="MAKER_CHECKER_DIFFERENT_ACTOR"}
workflow_policy_latency_ms{action="SUBMIT"}
workflow_transition_conflicts_total{action="APPROVE"}
workflow_rule_overrides_total{ruleId="MAKER_CHECKER_DIFFERENT_ACTOR"}
```

Never label metrics with high-cardinality PII like case id or user id.

---

## 47. Logging

Log structured, safe data.

Good:

```json
{
  "event": "workflow_policy_rejected",
  "caseIdHash": "8f2a...",
  "action": "APPROVE",
  "actorIdHash": "9b11...",
  "fromStatus": "UNDER_REVIEW",
  "ruleIds": ["CASE_APPROVE_STATUS_ALLOWED"],
  "correlationId": "01JZ..."
}
```

Avoid:

- full applicant name,
- raw identity number,
- free-text remarks,
- document contents,
- sensitive evidence values.

---

## 48. Testing Workflow Validation

### 48.1 Unit test each guard

```java
@Test
void approveRejectedWhenCaseNotPendingApproval() {
    CaseRecord c = caseWithStatus(CaseStatus.UNDER_REVIEW);
    Actor actor = supervisor();
    ApproveCaseCommand cmd = approveCommand(actor);

    Optional<PolicyViolation> violation = new StatusAllowsApproveGuard()
            .evaluate(new ApprovalContext(c, cmd));

    assertThat(violation).isPresent();
    assertThat(violation.get().ruleId()).isEqualTo("CASE_APPROVE_STATUS_ALLOWED");
}
```

### 48.2 Policy aggregation test

Test multiple violations.

```java
@Test
void approveCollectsAllBlockingViolations() {
    CaseRecord c = caseWithStatus(CaseStatus.UNDER_REVIEW, createdBy("u1"));
    Actor actor = actor("u1");

    PolicyDecision decision = policy.canApprove(c, approveCommand(actor));

    assertThat(decision.allowed()).isFalse();
    assertThat(decision.violations())
            .extracting(PolicyViolation::ruleId)
            .contains(
                    "CASE_APPROVE_STATUS_ALLOWED",
                    "CASE_APPROVE_MAKER_CHECKER"
            );
}
```

### 48.3 Transition matrix test

```java
@Test
void closedCaseHasNoOutgoingActions() {
    assertThat(matrix.allowedActions(CaseStatus.CLOSED)).isEmpty();
}
```

### 48.4 Concurrency test

Test stale version update.

```java
@Test
void secondConcurrentTransitionFailsWithConflict() {
    String caseId = createPendingApprovalCase();

    approve(caseId, version(7));

    assertThrows(ConcurrencyConflictException.class,
            () -> reject(caseId, version(7)));
}
```

### 48.5 API contract test

Ensure workflow violation response is stable.

```java
mockMvc.perform(post("/cases/{id}/approve", caseId)
        .contentType(MediaType.APPLICATION_JSON)
        .content(json))
    .andExpect(status().isConflict())
    .andExpect(jsonPath("$.violations[0].ruleId").value("CASE_APPROVE_STATUS_ALLOWED"))
    .andExpect(jsonPath("$.violations[0].code").value("case.approve.status.invalid"));
```

### 48.6 Audit test

Verify rule decision is recorded.

```java
@Test
void rejectedTransitionIsAudited() {
    try {
        approveInvalidCase();
    } catch (WorkflowRuleViolationException ignored) {
    }

    RuleDecisionAudit audit = auditRepository.latestFor(caseId);
    assertThat(audit.allowed()).isFalse();
    assertThat(audit.violations())
            .extracting(PolicyViolation::ruleId)
            .contains("CASE_APPROVE_STATUS_ALLOWED");
}
```

---

## 49. Property-Based and Matrix Testing

Workflow transition matrix is ideal for table-driven tests.

```java
record TransitionExpectation(CaseStatus from, CaseAction action, boolean allowed) {}
```

```java
static Stream<TransitionExpectation> transitions() {
    return Stream.of(
            new TransitionExpectation(CaseStatus.DRAFT, CaseAction.SUBMIT, true),
            new TransitionExpectation(CaseStatus.DRAFT, CaseAction.APPROVE, false),
            new TransitionExpectation(CaseStatus.PENDING_APPROVAL, CaseAction.APPROVE, true),
            new TransitionExpectation(CaseStatus.CLOSED, CaseAction.REOPEN, false)
    );
}
```

```java
@ParameterizedTest
@MethodSource("transitions")
void transitionMatrixIsCorrect(TransitionExpectation e) {
    assertThat(matrix.isActionAllowed(e.from(), e.action())).isEqualTo(e.allowed());
}
```

For large state spaces, generate all state/action pairs and assert no accidental transitions.

---

## 50. Anti-Patterns

### 50.1 Putting workflow into annotation groups

```java
@NotNull(groups = PendingApproval.class)
private String approvalRemarks;
```

This is okay only if `PendingApproval` means input contract for approval. It is bad if it means current case state derived from DB.

### 50.2 DB call inside `ConstraintValidator` for workflow

```java
public boolean isValid(String caseId, ConstraintValidatorContext ctx) {
    CaseRecord c = repository.find(caseId);
    return c.status() == PENDING_APPROVAL;
}
```

Problems:

- hidden I/O,
- unclear HTTP status,
- no actor,
- no audit,
- race condition,
- bad performance,
- hard testing.

### 50.3 Boolean rule result

```java
if (!policy.canApprove(caseRecord)) throw new RuntimeException();
```

No rule id. No evidence. No supportability.

### 50.4 One mega service method

```java
if (...) throw ...;
if (...) throw ...;
if (...) throw ...;
if (...) throw ...;
```

Better to extract named policy/guard classes with rule ids.

### 50.5 Treating UI button visibility as security/validation

UI can improve experience, but backend must enforce.

### 50.6 Silent override

Do not bypass validation without audit.

### 50.7 Ignoring concurrency

Validation before update is not enough.

### 50.8 No distinction between warning and error

Over-blocking creates operational pain. Under-blocking creates compliance risk.

### 50.9 Leaking sensitive evidence

Do not expose internal rule evidence to external actors.

### 50.10 Rule without owner/version

If no one owns the rule, it will rot.

---

## 51. Java 8 to Java 25 Notes

### 51.1 Java 8

- Bean Validation 2.0 era uses `javax.validation`.
- No records/sealed classes.
- Use classes/builders/manual immutability.
- `Optional` exists but avoid as DTO fields unless intentionally modeled.
- Use explicit policy classes and interfaces.

### 51.2 Java 11

- Similar modeling to Java 8.
- Better runtime baseline for many enterprise apps.
- Still likely `javax.validation` if Spring Boot 2/Jakarta EE 8 stack.

### 51.3 Java 17

- Jakarta Validation 3.x/Hibernate Validator 8/9 era becomes common.
- Records available.
- Sealed classes available.
- Stronger modeling for command/result types.
- Spring Boot 3 uses `jakarta.validation` namespace.

### 51.4 Java 21

- Virtual threads are useful for request concurrency, but validation design must still avoid hidden blocking I/O in validators.
- Records/sealed classes/pattern matching style improve policy modeling.
- Keep validation deterministic and observable.

### 51.5 Java 25

- Treat modern Java as a strong modeling tool, not a reason to overcomplicate validation.
- Prefer explicit immutable command/context/result records.
- Keep policy rule engines transparent.
- Use pattern matching carefully for state/action branching, but do not hide rule ids.

---

## 52. `javax.validation` vs `jakarta.validation` Notes

The architecture recommendations are the same across namespaces.

Main differences:

- Java 8/11 legacy stacks often use `javax.validation` with Hibernate Validator 6.x.
- Spring Boot 3/Jakarta EE 10/11 use `jakarta.validation`.
- Hibernate Validator 9.x targets Jakarta Validation 3.1/Jakarta EE 11.
- Do not mix `javax.validation.Valid` with `jakarta.validation.Validator` accidentally.
- In migration, workflow policy classes are usually unaffected unless they directly import validation API.

Recommendation:

- keep Bean/Jakarta Validation imports localized to DTO/API/object validation,
- keep workflow policy result model independent from validation provider,
- do not expose `ConstraintViolation` as your internal workflow rule model.

---

## 53. Suggested Package Structure

Example:

```text
com.example.caseapp.caseworkflow
  ├── api
  │   ├── ApproveCaseRequest.java
  │   ├── SubmitCaseRequest.java
  │   └── CaseActionProblemMapper.java
  │
  ├── command
  │   ├── ApproveCaseCommand.java
  │   ├── SubmitCaseCommand.java
  │   └── CloseCaseCommand.java
  │
  ├── domain
  │   ├── CaseRecord.java
  │   ├── CaseStatus.java
  │   └── CaseAction.java
  │
  ├── policy
  │   ├── PolicyDecision.java
  │   ├── PolicyViolation.java
  │   ├── PolicyWarning.java
  │   ├── ApprovalWorkflowPolicy.java
  │   ├── SubmitWorkflowPolicy.java
  │   └── guards
  │       ├── StatusAllowsApproveGuard.java
  │       ├── MakerCheckerGuard.java
  │       ├── ReviewCompletedGuard.java
  │       └── MandatoryDocumentsCompleteGuard.java
  │
  ├── statemachine
  │   ├── CaseStateMachine.java
  │   ├── TransitionDefinition.java
  │   ├── TransitionContext.java
  │   └── TransitionResult.java
  │
  ├── audit
  │   ├── RuleDecisionAudit.java
  │   └── RuleDecisionAuditRepository.java
  │
  └── persistence
      ├── CaseRepository.java
      └── CaseEntity.java
```

This keeps transport validation separate from workflow validation.

---

## 54. Practical Decision Matrix

| Rule Type | Example | Best Location |
|---|---|---|
| Required field for request | `caseId` required | DTO Jakarta Validation |
| Field format | case ref pattern | DTO/custom constraint |
| Cross-field local consistency | `start <= end` | class-level constraint/value object |
| Operation-specific requiredness | approval remarks required for approve | DTO group or command-specific DTO |
| Current status allows action | only `PENDING_APPROVAL` can approve | workflow guard/state machine |
| Actor permission | officer can approve case | authorization service |
| Maker-checker | maker cannot approve own case | policy/guard, not DTO |
| Deadline/grace period | appeal within 14 days | domain policy with explicit clock |
| Duplicate active record | unique active licence | DB constraint + service handling |
| External status | payment completed | domain/application policy, dependency-aware |
| SLA warning | overdue review | policy warning/escalation, not blocking validation by default |
| Audit-required override | supervisor override reason | DTO shape + policy + audit |
| Legacy data issue | missing old field | data quality/remediation validator |

---

## 55. Production Checklist

Before implementing workflow validation, answer:

1. Is this rule local to one DTO/object, or does it need context?
2. Does it require actor/current user?
3. Does it require current case state from DB?
4. Does it require external service?
5. Is failure a 400, 403, 409, 422, or 503?
6. Is the rule blocking, warning, or observe-only?
7. Does the rule need override?
8. Does it require audit evidence?
9. Does it need rule id/version?
10. Is the result deterministic for a given time/context?
11. What happens under concurrency?
12. What happens for retry/idempotency?
13. What happens for historical/legacy data?
14. What does frontend need to show?
15. What metrics/logs are needed?
16. How will the rule be tested?
17. Who owns the rule?
18. How will the rule be migrated or retired?

---

## 56. Key Takeaways

1. **Jakarta Validation is excellent for local object contracts.**  
   Use it for DTO shape, local field constraints, class-level local consistency, method pre/postconditions, and simple entity invariants.

2. **Workflow validation needs context.**  
   It usually depends on actor, case state, history, deadline, assignment, risk, documents, external status, and rule version.

3. **Do not hide workflow rules inside annotations.**  
   A `ConstraintValidator` that calls DB/security context to check workflow state is usually a design smell.

4. **State machine guards should return explainable decisions.**  
   Do not return only boolean. Return rule id, message code, severity, target, evidence, and blocking/warning classification.

5. **Authorization is not validation.**  
   Keep permission checks separate from input validity and workflow conflict.

6. **Validation result can become stale.**  
   Always protect final persistence with version check, lock, or database constraint.

7. **Regulatory systems need defensibility.**  
   Rule ids, rule versions, evidence, actor, timestamp, and audit trail are not optional extras in serious case management.

8. **Soft validation matters.**  
   Warnings, observe-only mode, and staged enforcement help roll out new rules safely.

9. **Frontend eligibility is advisory.**  
   Backend command execution must remain authoritative.

10. **Top-tier engineering is classification.**  
    The hardest part is not writing `@NotNull`; it is knowing which rule belongs in which layer.

---

## 57. References

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation 3.1 Overview: https://jakarta.ee/specifications/bean-validation/3.1/
- Bean Validation 2.0 Specification: https://beanvalidation.org/2.0/spec/
- Hibernate Validator Reference Guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator Releases: https://hibernate.org/validator/releases/
- Spring Statemachine Reference Documentation: https://docs.spring.io/spring-statemachine/docs/current/reference/

---

## 58. Status Seri

Seri belum selesai.

Bagian berikutnya:

`learn-java-validation-jakarta-hibernate-validator-part-023.md` — **Advanced Domain Rule Modeling: Specification Pattern, Policy Objects, and Validators**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-021.md">⬅️ Validation in Event-Driven and Async Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-023.md">Advanced Domain Rule Modeling: Specification Pattern, Policy Objects, and Validators ➡️</a>
</div>

# 32 — Refactoring Toward Patterns and Away from Anti-Patterns

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 32 dari 35  
> Fokus: bagaimana bergerak dari code/design yang mulai membusuk menuju pattern yang tepat secara aman, incremental, terukur, dan defensible.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Melihat refactoring bukan sebagai aktivitas “membersihkan code”, tetapi sebagai **perubahan desain yang menjaga perilaku tetap sama**.
2. Mengenali kapan sebuah design smell membutuhkan pattern, dan kapan pattern justru menjadi overengineering.
3. Memahami bahwa pattern yang baik sering muncul dari refactoring bertahap, bukan dari desain awal yang terlalu spekulatif.
4. Membedakan:
   - code smell,
   - design smell,
   - architecture smell,
   - process smell.
5. Menentukan refactoring path yang aman untuk codebase Java enterprise besar.
6. Menggunakan test sebagai safety net sebelum melakukan refactoring struktural.
7. Menghindari big-bang rewrite.
8. Menghindari “pattern injection” tanpa masalah nyata.
9. Merancang sequence refactoring yang kecil, reversible, dan dapat direview.
10. Mengubah conditional logic menjadi Strategy, Specification, State Machine, Command Handler, atau Policy Object secara tepat.
11. Memecah God Service tanpa memecah sistem menjadi fragmen kecil yang tidak koheren.
12. Memindahkan boundary external API ke Adapter/Gateway/ACL.
13. Memutus cyclic dependency antar package/module.
14. Mempertahankan behavior, auditability, security, dan performance selama refactoring.
15. Membuat refactoring plan yang bisa diterima tim, QA, reviewer, dan stakeholder teknis.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Di codebase nyata, anti-pattern jarang muncul sebagai sesuatu yang jelas buruk sejak awal.

Biasanya ia muncul karena keputusan yang dulu rasional:

```text
Hari 1:
"Tambahkan satu if saja. Requirement kecil."

Bulan 3:
"Tambahkan exception untuk agency tertentu."

Bulan 8:
"Tambahkan status baru dan approval path baru."

Tahun 2:
"Kenapa method submitApplication() 900 baris dan semua orang takut menyentuhnya?"
```

Masalah utamanya bukan karena engineer tidak tahu pattern.

Masalahnya:

1. Code berubah lebih cepat daripada model desainnya.
2. Responsibility bergeser tanpa disadari.
3. Domain rule tersebar di banyak service.
4. Error semantics berubah menjadi string parsing.
5. Authorization logic tersebar.
6. Transaction boundary bercampur external call.
7. Event dipublish di tengah mutation.
8. Mapping external/internal bercampur.
9. Test hanya memvalidasi happy path.
10. Refactoring selalu ditunda karena “takut rusak”.

Akibatnya, tim masuk ke kondisi:

```text
Semakin banyak perubahan,
semakin mahal memahami dampaknya,
semakin takut refactor,
semakin banyak workaround,
semakin sulit berubah lagi.
```

Part ini membahas bagaimana keluar dari spiral tersebut.

---

## 3. Mental Model: Refactoring adalah Migrasi Desain, Bukan Rewrite

Refactoring bukan rewrite.

Rewrite berarti:

```text
Ganti implementasi besar-besaran.
Risiko behavior berubah tinggi.
Biasanya butuh freeze besar.
Sulit direview.
Sering gagal karena hidden requirement.
```

Refactoring berarti:

```text
Ubah struktur internal.
Pertahankan observable behavior.
Lakukan bertahap.
Setiap langkah kecil bisa dites.
Setiap langkah bisa direview.
Setiap langkah bisa dihentikan dengan sistem tetap jalan.
```

Mental model yang lebih tepat:

```text
Refactoring adalah memindahkan responsibility,
memperjelas boundary,
dan mengurangi coupling,
tanpa mengubah kontrak yang terlihat oleh user/client.
```

Pattern dalam refactoring bukan tujuan.

Pattern adalah **bentuk akhir yang muncul ketika force desain sudah dipahami**.

Contoh:

```text
Bukan:
"Saya ingin memakai Strategy Pattern."

Melainkan:
"Logic pemilihan eligibility berubah berdasarkan product, agency, dan date. Kita butuh behavior yang bisa dipilih, dites, dan ditambah tanpa mengubah flow utama. Strategy/Policy Object cocok."
```

---

## 4. Core Concept: Behavior Preservation

Prinsip paling penting refactoring:

```text
Ubah struktur, bukan perilaku eksternal.
```

Dalam Java enterprise, “perilaku eksternal” tidak hanya API response.

Termasuk:

1. HTTP status.
2. Response body.
3. Error code.
4. Database mutation.
5. Transaction behavior.
6. Event yang dipublish.
7. Audit trail.
8. Authorization result.
9. Logging penting.
10. Metrics penting.
11. Retry behavior.
12. Idempotency behavior.
13. Concurrency semantics.
14. Performance envelope.
15. Backward compatibility.

Refactoring yang mengubah salah satu dari ini tanpa disengaja bukan refactoring murni, tetapi behavior change.

Itu boleh saja, tetapi harus diklasifikasikan sebagai feature/fix, bukan refactoring.

---

## 5. Why Refactoring Toward Patterns Works

Pattern biasanya muncul karena ada bentuk perubahan tertentu.

| Smell | Force | Pattern yang Mungkin Cocok |
|---|---|---|
| Banyak `if` untuk variasi behavior | Behavior berubah per kondisi | Strategy, Policy Object, Specification |
| Status lifecycle kacau | Transition harus valid dan auditable | State Machine, State Pattern |
| Service method terlalu panjang | Use case bercampur detail | Command Handler, Application Service |
| External API model bocor | Domain tercemar vendor/legacy | Adapter, Gateway, ACL |
| Error handling tidak konsisten | Boundary butuh normalisasi failure | Exception Translation, Result, Problem Details |
| DTO/entity tercampur | Boundary model tidak jelas | DTO, Mapper, Assembler |
| Dependency package melingkar | Boundary tidak enforceable | Module Boundary, Ports and Adapters |
| Side effect publish event berantakan | Mutation dan integration tidak atomic | Outbox, Domain Event |
| Authz tersebar | Security rule tidak konsisten | Policy Object, Secure Facade |
| Query object bertambah liar | Read model punya variasi tinggi | Query Object, Specification Query |

Pattern membantu jika ia mengurangi force yang nyata.

Pattern merusak jika ia hanya menambah bentuk tanpa mengurangi masalah.

---

## 6. Refactoring Safety Layers

Sebelum melakukan refactoring besar, buat safety layer.

Urutan safety layer:

```text
1. Characterization test
2. Golden master snapshot jika perlu
3. Contract/API test
4. Integration test untuk DB/external boundary
5. Observability baseline
6. Feature flag atau branch-by-abstraction untuk perubahan besar
7. Small commits
8. Review checklist
```

### 6.1 Characterization Test

Characterization test menjawab:

```text
Apa perilaku sistem saat ini?
```

Bukan:

```text
Apa perilaku ideal sistem?
```

Saat code legacy sulit dipahami, test pertama bukan untuk membuktikan desain benar, tetapi untuk mengunci perilaku lama.

Contoh:

```java
class EligibilityServiceCharacterizationTest {

    private final EligibilityService service = new EligibilityService(
            fakeApplicantRepository(),
            fakeAgencyGateway(),
            fakeClock("2026-06-18T10:00:00Z")
    );

    @Test
    void currentBehavior_forSuspendedApplicant_returnsRejectedWithLegacyCode() {
        EligibilityRequest request = new EligibilityRequest(
                "APP-001",
                "AGENCY-A",
                List.of("DOCUMENT_MISSING")
        );

        EligibilityResult result = service.evaluate(request);

        assertEquals("REJECTED", result.status());
        assertEquals("E102", result.reasonCode());
        assertEquals("Applicant is not eligible", result.message());
    }
}
```

Mungkin message-nya jelek.

Mungkin reason code-nya warisan lama.

Tetap dikunci dulu.

Refactoring aman dimulai setelah perilaku lama terlihat.

### 6.2 Golden Master

Golden master cocok saat output kompleks dan banyak variasi.

Contoh:

1. Render template.
2. Generate report.
3. Compute rule result matrix.
4. Produce JSON response besar.
5. Generate correspondence letter.
6. Export CSV/Excel.

Modelnya:

```text
Input lama + output lama disimpan.
Setelah refactoring, output baru harus sama.
```

Contoh sederhana:

```java
@Test
void generatedDecisionLetter_matchesGoldenMaster() throws Exception {
    DecisionLetterInput input = TestFixtures.standardApprovedCase();

    String actual = renderer.render(input);

    String expected = Files.readString(Path.of("src/test/resources/golden/approved-case-letter.txt"));
    assertEquals(expected, actual);
}
```

Golden master tidak membuktikan desain benar.

Ia membuktikan refactoring tidak mengubah output lama.

### 6.3 Contract Test

Untuk API publik:

```text
Refactoring internal tidak boleh merusak client contract.
```

Contract test memvalidasi:

1. Request format.
2. Response schema.
3. Status code.
4. Error body.
5. Field nullability.
6. Enum value.
7. Pagination semantics.
8. Authorization response.
9. Idempotency response.

### 6.4 Observability Baseline

Sebelum refactor, catat baseline:

```text
Endpoint latency p50/p95/p99
Error rate
DB query count
External call count
Log/error fingerprint
Event publish count
Audit row count
CPU/memory allocation jika relevan
```

Refactoring buruk sering terlihat bukan dari test gagal, tetapi dari:

```text
Query bertambah 5x.
External call terjadi dalam loop.
Audit trail hilang.
Event duplicate.
Latency naik.
Retry storm.
```

---

## 7. Refactoring Workflow Umum

Gunakan workflow ini untuk hampir semua refactoring pattern-level.

```text
1. Identify symptom
2. Locate behavior boundary
3. Add characterization tests
4. Name responsibilities
5. Introduce seam
6. Move behavior gradually
7. Delete dead branch
8. Tighten API
9. Add design-level tests
10. Document decision
```

### Step 1 — Identify Symptom

Contoh symptom:

```text
Method 700 baris.
Switch status besar.
Service tahu terlalu banyak repository.
DTO dipakai dari controller sampai database.
External API response dipakai langsung di domain.
Test harus mock 15 dependency.
```

Jangan langsung memilih pattern.

Tulis dulu gejalanya.

### Step 2 — Locate Behavior Boundary

Tanya:

```text
Behavior apa yang harus tetap sama?
Siapa client-nya?
Apa input/output-nya?
Apa side effect-nya?
Apa failure mode-nya?
```

### Step 3 — Add Characterization Tests

Kunci behavior sebelum memindahkan code.

Minimal:

1. Happy path.
2. Main failure path.
3. Edge case yang pernah bug.
4. Permission edge case.
5. Transaction/event/audit side effect jika relevan.

### Step 4 — Name Responsibilities

Sebelum extract class, beri nama responsibility.

Buruk:

```text
ApplicationHelper
CaseUtil
CommonService
Processor
Manager
```

Lebih baik:

```text
EligibilityPolicy
ApprovalTransition
CaseSubmissionHandler
ExternalAddressGateway
DecisionReasonAssembler
```

Nama yang baik mengurangi kebutuhan komentar.

### Step 5 — Introduce Seam

Seam adalah titik tempat behavior bisa dipindahkan tanpa mengubah caller besar.

Contoh seam:

1. Interface.
2. Package-private method.
3. Extracted class.
4. Adapter wrapper.
5. Command object.
6. Result object.
7. Feature flag.
8. Branch by abstraction.

### Step 6 — Move Behavior Gradually

Jangan pindahkan semua sekaligus.

Pindahkan satu rule, satu branch, satu gateway, satu mapping, atau satu transition.

### Step 7 — Delete Dead Branch

Refactoring belum selesai sampai code lama dihapus.

Pattern buruk sering terjadi karena refactoring setengah jalan:

```text
Ada service lama.
Ada service baru.
Ada adapter baru.
Ada helper lama.
Semua masih dipakai sebagian.
```

### Step 8 — Tighten API

Setelah behavior pindah, kecilkan visibility:

```java
public -> package-private -> private
mutable -> immutable
String -> domain primitive
boolean flag -> enum/sealed type
nullable -> Optional/result/explicit state
```

### Step 9 — Add Design-Level Tests

Setelah struktur baru muncul, tambahkan test yang sesuai pattern.

Misal untuk policy:

```text
Each policy can be tested independently.
Policy result contains reason.
Policy does not mutate input.
Policy does not call external gateway.
```

### Step 10 — Document Decision

Gunakan Pattern Decision Record ringan:

```markdown
# PDR-014: Extract EligibilityPolicy from ApplicationService

## Context
ApplicationService contains 18 eligibility branches and changes monthly.

## Decision
Move eligibility decision into composable policy objects.

## Consequence
ApplicationService becomes orchestration-only.
Rules become independently testable.
Policy ordering must be explicit.

## Rejected Options
- Keep if-else and add comments
- Move to external rule engine now
```

---

## 8. Smell Catalog and Pattern Direction

### 8.1 Long Method

Symptom:

```java
public SubmissionResult submit(SubmitApplicationRequest request) {
    // validate input
    // load applicant
    // check permission
    // check eligibility
    // compute fee
    // save application
    // update status
    // call external API
    // send email
    // write audit
    // publish event
    // return response
}
```

Possible causes:

1. Use case orchestration belum dipisah.
2. Domain decision bercampur side effect.
3. Transaction boundary tidak jelas.
4. External integration bercampur mutation.

Refactoring direction:

```text
Application Service / Command Handler
Policy Object
Gateway
Outbox
Assembler
Audit Event
```

### 8.2 Large Conditional

Symptom:

```java
if (type.equals("NEW")) {
    ...
} else if (type.equals("RENEWAL")) {
    ...
} else if (type.equals("APPEAL")) {
    ...
}
```

Possible direction:

```text
Strategy
Policy Object
Specification
State Machine
Visitor / pattern matching switch
```

Decision:

| Conditional Type | Better Refactoring |
|---|---|
| Different algorithm | Strategy |
| Eligibility/validation rule | Specification/Policy |
| Status transition | State Machine |
| Type hierarchy operation | Visitor or sealed switch |
| Simple stable mapping | switch expression may be enough |

### 8.3 God Service

Symptom:

```text
CaseService depends on:
- 12 repositories
- 5 gateways
- 3 mappers
- 4 notification services
- audit service
- security context
- scheduler
- config provider
```

Possible problem:

```text
The service is not one responsibility.
It is a module disguised as a class.
```

Refactoring direction:

1. Split by use case.
2. Extract Command Handler.
3. Extract Domain Service only for domain logic.
4. Extract Gateway for external dependencies.
5. Extract Policy for decisions.
6. Extract Assembler/Presenter for response creation.

### 8.4 Primitive Obsession

Symptom:

```java
submit(String applicantId, String agencyCode, String caseType, String status, String userId)
```

Refactoring direction:

```java
record ApplicantId(String value) { }
record AgencyCode(String value) { }
record UserId(String value) { }

enum CaseType { NEW, RENEWAL, APPEAL }
```

But be careful.

Do not create domain primitive for every field immediately.

Prioritize fields with:

1. Security meaning.
2. Identity meaning.
3. Validation rule.
4. Cross-boundary ambiguity.
5. Frequent bugs.

### 8.5 Feature Envy

Symptom:

```java
if (application.getStatus().equals("SUBMITTED")
        && application.getSubmittedAt() != null
        && application.getDocuments().size() > 0) {
    ...
}
```

Possible refactoring:

```java
if (application.isReadyForAssessment()) {
    ...
}
```

But avoid dumping everything into entity.

If decision depends on repository/external API/current user, do not put it into entity.

Use Policy or Domain Service.

### 8.6 Shotgun Surgery

Symptom:

```text
Every new status requires modifying:
- controller
- service
- mapper
- repository query
- audit formatter
- UI response mapper
- scheduler
- report export
```

Possible direction:

1. Centralize transition model.
2. Use enum/sealed state model.
3. Introduce State Machine.
4. Introduce status metadata.
5. Add contract tests around status exposure.

### 8.7 Divergent Change

One class changes for many reasons:

```text
CaseService changes for:
- validation update
- fee calculation update
- external API update
- audit format update
- email template update
- transition rule update
```

Refactoring direction:

```text
Separate policy, gateway, assembler, audit event, notification command, transition model.
```

### 8.8 Cyclic Dependency

Symptom:

```text
application -> case -> common -> application
```

or:

```text
module-a imports module-b
module-b imports module-a
```

Refactoring direction:

1. Extract shared abstraction only if stable.
2. Move dependency to caller/application layer.
3. Introduce port interface in owning module.
4. Use event for cross-module notification.
5. Split read model if only query dependency.

---

## 9. Refactoring: Replace Conditional with Strategy

### 9.1 Starting Point

```java
public final class FeeCalculator {

    public BigDecimal calculate(Application application) {
        if (application.type() == ApplicationType.NEW) {
            return new BigDecimal("120.00");
        }
        if (application.type() == ApplicationType.RENEWAL) {
            return new BigDecimal("80.00");
        }
        if (application.type() == ApplicationType.APPEAL) {
            return BigDecimal.ZERO;
        }
        throw new IllegalArgumentException("Unsupported type: " + application.type());
    }
}
```

This is not automatically bad.

If stable and small, keep it.

Refactor only when:

1. Each branch grows.
2. Each branch has different dependencies.
3. New types are added frequently.
4. Branches need independent tests.
5. Fee logic becomes policy-owned.

### 9.2 Introduce Strategy Interface

```java
public interface FeePolicy {
    boolean supports(ApplicationType type);
    BigDecimal calculate(Application application);
}
```

### 9.3 Implement Strategies

```java
public final class NewApplicationFeePolicy implements FeePolicy {

    @Override
    public boolean supports(ApplicationType type) {
        return type == ApplicationType.NEW;
    }

    @Override
    public BigDecimal calculate(Application application) {
        return new BigDecimal("120.00");
    }
}
```

```java
public final class RenewalFeePolicy implements FeePolicy {

    @Override
    public boolean supports(ApplicationType type) {
        return type == ApplicationType.RENEWAL;
    }

    @Override
    public BigDecimal calculate(Application application) {
        return new BigDecimal("80.00");
    }
}
```

### 9.4 Add Explicit Resolver

Avoid hidden magic.

```java
public final class FeePolicyResolver {

    private final List<FeePolicy> policies;

    public FeePolicyResolver(List<FeePolicy> policies) {
        this.policies = List.copyOf(policies);
    }

    public FeePolicy resolve(ApplicationType type) {
        return policies.stream()
                .filter(policy -> policy.supports(type))
                .findFirst()
                .orElseThrow(() -> new UnsupportedFeeTypeException(type));
    }
}
```

### 9.5 Use It

```java
public final class FeeCalculator {

    private final FeePolicyResolver resolver;

    public FeeCalculator(FeePolicyResolver resolver) {
        this.resolver = resolver;
    }

    public BigDecimal calculate(Application application) {
        return resolver.resolve(application.type()).calculate(application);
    }
}
```

### 9.6 Avoid Strategy Theater

Bad refactoring:

```java
public final class FeeCalculator {

    private final NewApplicationFeePolicy newPolicy = new NewApplicationFeePolicy();
    private final RenewalFeePolicy renewalPolicy = new RenewalFeePolicy();

    public BigDecimal calculate(Application application) {
        if (application.type() == ApplicationType.NEW) {
            return newPolicy.calculate(application);
        }
        if (application.type() == ApplicationType.RENEWAL) {
            return renewalPolicy.calculate(application);
        }
        throw new IllegalArgumentException();
    }
}
```

This only moved code into classes.

It did not remove selection complexity.

---

## 10. Refactoring: Replace Conditional with Specification

### 10.1 Starting Point

```java
public boolean canSubmit(Application application) {
    return application.status() == Draft
            && application.ownerId().equals(currentUser.id())
            && application.documents().stream().allMatch(Document::isValid)
            && !application.hasOutstandingPayment()
            && application.applicant().isActive();
}
```

This method hides multiple reasons.

When it returns false, nobody knows why.

### 10.2 Create Result

```java
public record RuleViolation(String code, String message) { }

public record SpecificationResult(boolean satisfied, List<RuleViolation> violations) {

    public static SpecificationResult satisfied() {
        return new SpecificationResult(true, List.of());
    }

    public static SpecificationResult rejected(String code, String message) {
        return new SpecificationResult(false, List.of(new RuleViolation(code, message)));
    }
}
```

### 10.3 Create Specification

```java
public interface ApplicationSpecification {
    SpecificationResult evaluate(Application application, EvaluationContext context);
}
```

### 10.4 Extract Rules

```java
public final class DraftStatusSpecification implements ApplicationSpecification {

    @Override
    public SpecificationResult evaluate(Application application, EvaluationContext context) {
        if (application.status() == ApplicationStatus.DRAFT) {
            return SpecificationResult.satisfied();
        }
        return SpecificationResult.rejected(
                "APPLICATION_NOT_DRAFT",
                "Only draft application can be submitted"
        );
    }
}
```

```java
public final class OwnerSpecification implements ApplicationSpecification {

    @Override
    public SpecificationResult evaluate(Application application, EvaluationContext context) {
        if (application.ownerId().equals(context.userId())) {
            return SpecificationResult.satisfied();
        }
        return SpecificationResult.rejected(
                "NOT_OWNER",
                "Current user is not the owner of the application"
        );
    }
}
```

### 10.5 Compose

```java
public final class AllSpecifications implements ApplicationSpecification {

    private final List<ApplicationSpecification> specifications;

    public AllSpecifications(List<ApplicationSpecification> specifications) {
        this.specifications = List.copyOf(specifications);
    }

    @Override
    public SpecificationResult evaluate(Application application, EvaluationContext context) {
        List<RuleViolation> violations = new ArrayList<>();

        for (ApplicationSpecification specification : specifications) {
            SpecificationResult result = specification.evaluate(application, context);
            violations.addAll(result.violations());
        }

        return new SpecificationResult(violations.isEmpty(), List.copyOf(violations));
    }
}
```

### 10.6 Why This Is Better

Now you get:

1. Independent test per rule.
2. Explainable rejection.
3. Explicit ordering if needed.
4. Auditable rule result.
5. Easier addition/removal.

### 10.7 Failure Mode

Specification can become rule spaghetti if:

1. Rules call repositories unpredictably.
2. Rules mutate objects.
3. Rules depend on hidden global context.
4. Rule ordering is implicit.
5. Rule names are vague.

---

## 11. Refactoring: Replace Status Logic with State Machine

### 11.1 Starting Point

```java
public void approve(String caseId) {
    Case caze = repository.findById(caseId);

    if (caze.status() == CaseStatus.DRAFT) {
        throw new InvalidStateException();
    }
    if (caze.status() == CaseStatus.CLOSED) {
        throw new InvalidStateException();
    }
    if (caze.status() == CaseStatus.PENDING_REVIEW) {
        caze.setStatus(CaseStatus.APPROVED);
        repository.save(caze);
        audit.log("Approved");
        email.sendApproval(caze);
        return;
    }
    if (caze.status() == CaseStatus.PENDING_SUPERVISOR) {
        caze.setStatus(CaseStatus.APPROVED);
        repository.save(caze);
        audit.log("Approved by supervisor");
        email.sendApproval(caze);
        return;
    }
}
```

Problems:

1. Allowed transition is hidden.
2. Side effects are duplicated.
3. Audit reason differs randomly.
4. Invalid transition behavior inconsistent.
5. Adding status requires editing many services.

### 11.2 Introduce Transition Object

```java
public record Transition(
        CaseStatus from,
        CaseAction action,
        CaseStatus to
) { }
```

### 11.3 Define Transition Table

```java
public final class CaseTransitionTable {

    private static final Set<Transition> TRANSITIONS = Set.of(
            new Transition(CaseStatus.PENDING_REVIEW, CaseAction.APPROVE, CaseStatus.APPROVED),
            new Transition(CaseStatus.PENDING_SUPERVISOR, CaseAction.APPROVE, CaseStatus.APPROVED),
            new Transition(CaseStatus.PENDING_REVIEW, CaseAction.REJECT, CaseStatus.REJECTED)
    );

    public Optional<CaseStatus> next(CaseStatus current, CaseAction action) {
        return TRANSITIONS.stream()
                .filter(t -> t.from() == current && t.action() == action)
                .map(Transition::to)
                .findFirst();
    }
}
```

### 11.4 Create Workflow Service

```java
public final class CaseWorkflow {

    private final CaseTransitionTable transitionTable;

    public CaseWorkflow(CaseTransitionTable transitionTable) {
        this.transitionTable = transitionTable;
    }

    public TransitionResult transition(Case caze, CaseAction action) {
        CaseStatus from = caze.status();
        CaseStatus to = transitionTable.next(from, action)
                .orElseThrow(() -> new IllegalCaseTransitionException(from, action));

        caze.changeStatus(to);

        return new TransitionResult(from, action, to);
    }
}
```

### 11.5 Move Side Effects Out

```java
public final class ApproveCaseHandler {

    private final CaseRepository repository;
    private final CaseWorkflow workflow;
    private final AuditWriter auditWriter;
    private final Outbox outbox;

    public void handle(ApproveCaseCommand command) {
        Case caze = repository.getForUpdate(command.caseId());

        TransitionResult transition = workflow.transition(caze, CaseAction.APPROVE);

        repository.save(caze);
        auditWriter.write(CaseAuditEvent.from(transition, command.actor()));
        outbox.add(CaseApprovedEvent.from(caze, transition));
    }
}
```

### 11.6 Result

Now:

1. Workflow rules are explicit.
2. Transition testing is simple.
3. Handler orchestration is visible.
4. Audit event is structured.
5. Outbox avoids dual-write issue.

---

## 12. Refactoring: Extract Command Handler from God Service

### 12.1 Starting Point

```java
public final class CaseService {

    public void submit(...) { ... }
    public void approve(...) { ... }
    public void reject(...) { ... }
    public void withdraw(...) { ... }
    public void assignOfficer(...) { ... }
    public void requestDocument(...) { ... }
    public void uploadDocument(...) { ... }
    public void generateLetter(...) { ... }
    public void closeCase(...) { ... }
}
```

This class may not be one service.

It may be an entire bounded module.

### 12.2 Refactoring Path

Do not split by random nouns.

Split by use case:

```text
SubmitCaseHandler
ApproveCaseHandler
RejectCaseHandler
WithdrawCaseHandler
AssignOfficerHandler
RequestDocumentHandler
UploadDocumentHandler
CloseCaseHandler
```

### 12.3 Extract One Handler First

```java
public record ApproveCaseCommand(
        CaseId caseId,
        UserId actorId,
        String comment
) { }
```

```java
public final class ApproveCaseHandler {

    private final CaseRepository caseRepository;
    private final AuthorizationPolicy authorizationPolicy;
    private final CaseWorkflow workflow;
    private final AuditWriter auditWriter;
    private final Outbox outbox;

    public ApproveCaseHandler(
            CaseRepository caseRepository,
            AuthorizationPolicy authorizationPolicy,
            CaseWorkflow workflow,
            AuditWriter auditWriter,
            Outbox outbox
    ) {
        this.caseRepository = caseRepository;
        this.authorizationPolicy = authorizationPolicy;
        this.workflow = workflow;
        this.auditWriter = auditWriter;
        this.outbox = outbox;
    }

    public void handle(ApproveCaseCommand command) {
        Case caze = caseRepository.getForUpdate(command.caseId());

        authorizationPolicy.requireCanApprove(command.actorId(), caze);

        TransitionResult transition = workflow.transition(caze, CaseAction.APPROVE);

        caseRepository.save(caze);
        auditWriter.write(CaseAuditEvent.approved(caze.id(), command.actorId(), transition));
        outbox.add(CaseApprovedEvent.of(caze.id(), transition));
    }
}
```

### 12.4 Keep Old Service Temporarily

```java
public final class CaseService {

    private final ApproveCaseHandler approveCaseHandler;

    public void approve(String caseId, String userId, String comment) {
        approveCaseHandler.handle(new ApproveCaseCommand(
                new CaseId(caseId),
                new UserId(userId),
                comment
        ));
    }
}
```

This is branch-by-abstraction.

The old API remains, but implementation is moved.

### 12.5 Delete Old Method Later

When all callers move to command handler or application use case API, delete the forwarding method.

---

## 13. Refactoring: Encapsulate External API with Gateway/Adapter

### 13.1 Starting Point

```java
public void enrichAddress(Application application) {
    ExternalAddressResponse response = restTemplate.getForObject(
            "/address?postal=" + application.postalCode(),
            ExternalAddressResponse.class
    );

    application.setAddressLine1(response.getBlock() + " " + response.getStreet());
    application.setLatitude(response.getLat());
    application.setLongitude(response.getLng());
}
```

Problems:

1. External DTO leaks into service.
2. URL construction is mixed with domain logic.
3. Error mapping unclear.
4. Timeout/retry unclear.
5. Test has to know external response shape.

### 13.2 Introduce Domain-Oriented Port

```java
public interface AddressLookupGateway {
    AddressLookupResult lookup(PostalCode postalCode);
}
```

### 13.3 Define Internal Result

```java
public sealed interface AddressLookupResult {

    record Found(StandardizedAddress address) implements AddressLookupResult { }

    record NotFound(PostalCode postalCode) implements AddressLookupResult { }

    record TemporarilyUnavailable(String reason) implements AddressLookupResult { }
}
```

### 13.4 Implement Adapter

```java
public final class ExternalAddressApiGateway implements AddressLookupGateway {

    private final ExternalAddressClient client;
    private final ExternalAddressMapper mapper;

    @Override
    public AddressLookupResult lookup(PostalCode postalCode) {
        try {
            ExternalAddressResponse response = client.lookup(postalCode.value());

            if (response == null || response.notFound()) {
                return new AddressLookupResult.NotFound(postalCode);
            }

            return new AddressLookupResult.Found(mapper.toDomain(response));
        } catch (ExternalTimeoutException ex) {
            return new AddressLookupResult.TemporarilyUnavailable("ADDRESS_API_TIMEOUT");
        }
    }
}
```

### 13.5 Use Gateway in Use Case

```java
public void enrichAddress(Application application) {
    AddressLookupResult result = gateway.lookup(application.postalCode());

    switch (result) {
        case AddressLookupResult.Found found -> application.updateAddress(found.address());
        case AddressLookupResult.NotFound ignored -> application.markAddressUnverified();
        case AddressLookupResult.TemporarilyUnavailable unavailable -> throw new AddressUnavailableException(unavailable.reason());
    }
}
```

### 13.6 Refactoring Benefit

The domain now depends on:

```text
AddressLookupGateway
AddressLookupResult
StandardizedAddress
```

not:

```text
Vendor URL
Vendor DTO
Vendor error code
HTTP client
JSON schema
```

---

## 14. Refactoring: Break Cyclic Dependency

### 14.1 Starting Point

```text
case-module -> document-module
case-module -> notification-module
notification-module -> case-module
report-module -> case-module
case-module -> report-module
```

Cycle means architecture cannot be reasoned about cleanly.

### 14.2 Identify Type of Dependency

Ask:

```text
Is it command dependency?
Is it query dependency?
Is it event dependency?
Is it shared model dependency?
Is it utility dependency?
```

Different dependency types need different fixes.

### 14.3 Command Dependency

If module A asks module B to perform action:

```text
A -> B command/use case API
```

This may be okay if direction is intended.

If B also calls A, find orchestration layer.

```text
application-orchestrator -> A
application-orchestrator -> B
A no longer calls B and B no longer calls A
```

### 14.4 Query Dependency

If module A only reads data from B:

Options:

1. Expose query port from B.
2. Build read model.
3. Duplicate denormalized snapshot if acceptable.
4. Use event projection.

### 14.5 Event Dependency

If A only needs to inform B:

```text
A publishes event.
B subscribes.
```

But avoid event as synchronous RPC.

### 14.6 Shared Model Dependency

If both modules depend on same object:

Be suspicious.

Maybe it is:

1. True shared kernel.
2. Misplaced concept.
3. DTO being abused.
4. Common module dumping ground.

Shared kernel must be small, stable, and explicit.

### 14.7 Utility Dependency

If cycle exists because of utility/helper:

Move utility down to lower-level independent module or duplicate trivial logic.

Duplication is often better than wrong dependency.

---

## 15. Refactoring: Replace Inheritance with Composition

### 15.1 Starting Point

```java
public abstract class BaseProcessor {

    public final void process(Request request) {
        validate(request);
        authorize(request);
        execute(request);
        audit(request);
    }

    protected abstract void validate(Request request);
    protected abstract void authorize(Request request);
    protected abstract void execute(Request request);
    protected abstract void audit(Request request);
}
```

After years:

```text
Some subclass wants to skip audit.
Some subclass wants extra validation.
Some subclass wants execute before authorize for legacy reason.
Some subclass overrides protected helper unexpectedly.
```

Fragile base class.

### 15.2 Extract Steps as Collaborators

```java
public interface RequestValidator {
    void validate(Request request);
}

public interface RequestAuthorizer {
    void authorize(Request request);
}

public interface RequestExecutor {
    void execute(Request request);
}

public interface AuditRecorder {
    void record(Request request);
}
```

### 15.3 Compose Processor

```java
public final class RequestProcessor {

    private final RequestValidator validator;
    private final RequestAuthorizer authorizer;
    private final RequestExecutor executor;
    private final AuditRecorder auditRecorder;

    public void process(Request request) {
        validator.validate(request);
        authorizer.authorize(request);
        executor.execute(request);
        auditRecorder.record(request);
    }
}
```

### 15.4 Result

Composition makes variation explicit.

Inheritance hides variation in subclass override behavior.

Use inheritance when:

1. Algorithm skeleton is truly stable.
2. Hook points are few and controlled.
3. Subclasses are limited or sealed.
4. Invariants are protected by final methods.

Use composition when:

1. Steps vary independently.
2. Runtime composition is needed.
3. Testing individual step matters.
4. Framework lifecycle should not leak into domain.

---

## 16. Refactoring: Introduce Parameter Object

### 16.1 Starting Point

```java
public List<CaseSummary> search(
        String status,
        String agency,
        LocalDate fromDate,
        LocalDate toDate,
        String officerId,
        int page,
        int size,
        String sortBy,
        String sortDirection
) {
    ...
}
```

Problems:

1. Parameter order bugs.
2. Hard to evolve.
3. Validation scattered.
4. Unclear defaults.
5. Hard to log safely.

### 16.2 Introduce Query Object

```java
public record CaseSearchQuery(
        Optional<CaseStatus> status,
        Optional<AgencyCode> agency,
        Optional<DateRange> submittedDateRange,
        Optional<UserId> officerId,
        PageRequest pageRequest,
        Sort sort
) {
    public CaseSearchQuery {
        Objects.requireNonNull(status);
        Objects.requireNonNull(agency);
        Objects.requireNonNull(submittedDateRange);
        Objects.requireNonNull(officerId);
        Objects.requireNonNull(pageRequest);
        Objects.requireNonNull(sort);
    }
}
```

### 16.3 Benefit

Now query can own:

1. Validation.
2. Defaulting.
3. Logging redaction.
4. Conversion from API request.
5. Test fixtures.
6. Future fields.

---

## 17. Refactoring: Introduce Domain Primitive

### 17.1 Starting Point

```java
public void approve(String caseId, String userId) {
    ...
}
```

This allows:

```java
approve(userId, caseId); // compiles, wrong behavior
```

### 17.2 Introduce Types

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("caseId is required");
        }
    }
}

public record UserId(String value) {
    public UserId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("userId is required");
        }
    }
}
```

### 17.3 Use Them

```java
public void approve(CaseId caseId, UserId userId) {
    ...
}
```

### 17.4 But Avoid Excess

Do not create domain primitive for everything blindly.

Bad:

```java
record FirstLine(String value) { }
record SecondLine(String value) { }
record CommentText(String value) { }
record DescriptionText(String value) { }
```

Unless they have real invariant or ambiguity.

---

## 18. Refactoring: Normalize Error Handling

### 18.1 Starting Point

```java
try {
    external.call();
} catch (Exception e) {
    return "FAILED";
}
```

or:

```java
throw new RuntimeException("E102|Applicant not eligible");
```

Problems:

1. Error semantics hidden in string.
2. Retryability unclear.
3. Client response inconsistent.
4. Logs hard to correlate.
5. Security leakage possible.

### 18.2 Introduce Domain Error

```java
public sealed interface ApplicationError {
    String code();
    boolean retryable();

    record ApplicantNotEligible(String applicantId) implements ApplicationError {
        @Override public String code() { return "APPLICANT_NOT_ELIGIBLE"; }
        @Override public boolean retryable() { return false; }
    }

    record ExternalServiceUnavailable(String serviceName) implements ApplicationError {
        @Override public String code() { return "EXTERNAL_SERVICE_UNAVAILABLE"; }
        @Override public boolean retryable() { return true; }
    }
}
```

### 18.3 Translate at Boundary

```java
public final class ErrorResponseMapper {

    public ProblemDetailResponse toResponse(ApplicationError error) {
        return switch (error) {
            case ApplicationError.ApplicantNotEligible e ->
                    ProblemDetailResponse.unprocessable("Applicant is not eligible", e.code());
            case ApplicationError.ExternalServiceUnavailable e ->
                    ProblemDetailResponse.serviceUnavailable("External service temporarily unavailable", e.code());
        };
    }
}
```

### 18.4 Benefit

Now error handling has:

1. Stable code.
2. Retryability.
3. Boundary mapping.
4. Testability.
5. Observability.
6. Security-safe response.

---

## 19. Refactoring: Introduce Outbox Instead of Direct Publish

### 19.1 Starting Point

```java
@Transactional
public void approve(CaseId caseId) {
    Case caze = repository.get(caseId);
    caze.approve();
    repository.save(caze);
    eventPublisher.publish(new CaseApprovedEvent(caseId));
}
```

Problem:

```text
DB commit can succeed while publish fails.
Publish can succeed while DB rolls back.
```

### 19.2 Add Outbox Record

```java
public record OutboxMessage(
        UUID id,
        String aggregateType,
        String aggregateId,
        String eventType,
        String payload,
        Instant createdAt
) { }
```

### 19.3 Save Event in Same Transaction

```java
@Transactional
public void approve(CaseId caseId) {
    Case caze = repository.getForUpdate(caseId);
    caze.approve();

    repository.save(caze);
    outboxRepository.save(OutboxMessageFactory.caseApproved(caze));
}
```

### 19.4 Publish Asynchronously

```java
public final class OutboxPublisher {

    public void publishPending() {
        List<OutboxMessage> pending = outboxRepository.findPendingBatch(100);

        for (OutboxMessage message : pending) {
            publisher.publish(message.eventType(), message.payload());
            outboxRepository.markPublished(message.id());
        }
    }
}
```

### 19.5 Refactoring Notes

Outbox introduces new operational responsibility:

1. Publisher retry.
2. Idempotent consumers.
3. Monitoring pending messages.
4. Dead letter handling.
5. Payload versioning.

Pattern is justified only when event consistency matters.

---

## 20. Refactoring: Split Read and Write Model

### 20.1 Starting Point

```java
public Case getCaseDetail(String caseId) {
    return caseRepository.findById(caseId);
}
```

Then controller returns entity directly.

Problems:

1. Lazy loading leak.
2. Security exposure.
3. UI gets too much data.
4. ORM entity becomes API contract.
5. Query performance unpredictable.

### 20.2 Introduce Query Model

```java
public record CaseDetailView(
        CaseId caseId,
        String caseNumber,
        CaseStatus status,
        String applicantName,
        List<DocumentView> documents,
        List<AvailableActionView> availableActions
) { }
```

### 20.3 Dedicated Query

```java
public interface CaseDetailQuery {
    Optional<CaseDetailView> findCaseDetail(CaseId caseId, UserId viewer);
}
```

### 20.4 Benefit

Read side can optimize for:

1. Projection.
2. Joins.
3. Security filtering.
4. UI shape.
5. Pagination.
6. Caching.

Write model remains focused on invariant mutation.

---

## 21. Pattern Injection Anti-Pattern

Pattern injection happens when engineer adds pattern because pattern feels sophisticated, not because force requires it.

Example:

```text
A simple switch with 3 stable cases becomes:
- interface
- 3 implementation classes
- factory
- resolver
- registry
- annotation
- reflection scanner
```

This is not top 1% engineering.

This is abstraction inflation.

Ask before applying pattern:

```text
What change does this pattern make cheaper?
What behavior does it protect?
What coupling does it reduce?
What failure mode does it control?
What cost does it add?
```

If answers are vague, do not add pattern.

---

## 22. Big-Bang Rewrite Anti-Pattern

Big-bang rewrite is tempting when code feels hopeless.

But it often fails because:

1. Legacy behavior is undocumented.
2. Hidden client dependency exists.
3. Edge cases are discovered late.
4. New system misses operational constraints.
5. Team spends months without production feedback.
6. Business continues changing old system during rewrite.

Prefer:

```text
Strangler-style refactoring inside codebase
Branch by abstraction
Vertical slice extraction
Feature flag
Parallel run for critical computation
Contract tests
```

### 22.1 Safer Alternative

Instead of:

```text
Rewrite CaseService completely.
```

Do:

```text
Extract ApproveCaseHandler.
Extract SubmitCaseHandler.
Extract CaseWorkflow.
Extract EligibilityPolicy.
Move external API to Gateway.
Introduce Outbox.
Delete old branches one by one.
```

---

## 23. Refactor Mixed with Feature Work Anti-Pattern

Common trap:

```text
While adding new approval rule, also refactor the whole approval engine.
```

Risk:

1. Reviewer cannot tell what is behavior change.
2. QA cannot isolate regression.
3. Rollback becomes impossible.
4. Blame analysis becomes hard.

Better:

```text
Commit 1: characterization tests
Commit 2: pure refactoring, no behavior change
Commit 3: add new rule
Commit 4: delete obsolete code
```

This is boring but safe.

---

## 24. Branch by Abstraction

Branch by abstraction is useful when large migration cannot happen in one commit.

### 24.1 Example

Existing:

```java
class CaseService {
    void approve(CaseId id) {
        oldApproveLogic(id);
    }
}
```

Introduce abstraction:

```java
interface CaseApprovalUseCase {
    void approve(CaseId id);
}
```

Old implementation:

```java
final class LegacyCaseApprovalUseCase implements CaseApprovalUseCase {
    public void approve(CaseId id) {
        oldApproveLogic(id);
    }
}
```

New implementation:

```java
final class WorkflowCaseApprovalUseCase implements CaseApprovalUseCase {
    public void approve(CaseId id) {
        newApproveLogic(id);
    }
}
```

Router:

```java
final class RoutingCaseApprovalUseCase implements CaseApprovalUseCase {

    private final CaseApprovalUseCase legacy;
    private final CaseApprovalUseCase modern;
    private final FeatureFlags flags;

    public void approve(CaseId id) {
        if (flags.useModernApproval()) {
            modern.approve(id);
        } else {
            legacy.approve(id);
        }
    }
}
```

Use for:

1. High-risk behavior.
2. Incremental rollout.
3. Parallel comparison.
4. Runtime fallback.

But delete it after migration.

Permanent routing abstractions become complexity debt.

---

## 25. Parallel Run for Critical Logic

For critical rule engines or financial/regulatory calculation, use parallel run.

```java
public DecisionResult decide(DecisionInput input) {
    DecisionResult legacy = legacyEngine.decide(input);
    DecisionResult modern = modernEngine.decide(input);

    if (!legacy.equals(modern)) {
        discrepancyRecorder.record(input, legacy, modern);
    }

    return legacy; // until confidence is high
}
```

Later:

```java
return modern;
```

This reduces risk when behavior must be preserved exactly.

Important:

1. Do not produce double side effects.
2. Parallel-run pure computation only.
3. Log discrepancy safely.
4. Define acceptable differences.
5. Track coverage of real traffic scenarios.

---

## 26. Testing Strategy for Refactoring

### 26.1 Test Pyramid for Refactoring

For refactoring toward patterns:

```text
Fast unit tests for extracted policies/strategies/state transitions
Characterization tests around old behavior
Contract tests around API
Integration tests around persistence/external boundary
End-to-end tests for critical workflows only
```

### 26.2 Test What Can Break

If you refactor policy:

```text
Test rule result and reason.
```

If you refactor workflow:

```text
Test allowed/illegal transitions.
```

If you refactor repository:

```text
Test query semantics and transaction behavior.
```

If you refactor gateway:

```text
Test mapping, timeout, error translation.
```

If you refactor DTO boundary:

```text
Test API schema and sensitive field omission.
```

If you refactor event publication:

```text
Test outbox record, idempotency, consumer dedup.
```

### 26.3 Architecture Tests

Use architecture tests to enforce direction.

Example concept:

```text
domain package must not depend on spring package
application package may depend on domain and port
adapter package may depend on application port
controller must not access repository directly
```

Even without a library, you can add simple tests using reflection/classpath scanning.

Example pseudo-test:

```java
@Test
void domainMustNotDependOnSpring() {
    List<Class<?>> domainClasses = ClassScanner.find("com.acme.case.domain");

    for (Class<?> clazz : domainClasses) {
        assertFalse(importsPackage(clazz, "org.springframework"));
    }
}
```

---

## 27. Observability During Refactoring

During refactoring, observe:

1. Error rate.
2. Latency distribution.
3. DB query count.
4. External call count.
5. Event count.
6. Audit count.
7. Duplicate processing.
8. Queue lag.
9. Transaction duration.
10. Memory allocation.

Add explicit metrics for migrated path:

```text
approval.path=legacy|modern
approval.result=success|failure
approval.transition.from
approval.transition.to
approval.error.code
```

This helps compare old/new behavior in production.

---

## 28. Security During Refactoring

Refactoring often breaks security subtly.

Check:

1. Authorization still happens before mutation.
2. Field-level filtering still applies.
3. Audit still records actor/action/resource/time/result.
4. Sensitive data is not logged.
5. External input validation is not bypassed.
6. DTO does not expose new internal fields.
7. Admin-only operation remains protected.
8. Cached result is scoped by user/tenant/permission.
9. Error translation does not leak internal details.
10. Outbox payload does not include secrets or excessive PII.

Security regression can pass functional tests.

So write specific security tests.

---

## 29. Performance During Refactoring

Refactoring can accidentally degrade performance.

Common issues:

1. Extracted policy calls repository repeatedly.
2. Mapper triggers lazy loading loop.
3. Strategy resolver scans huge list per request.
4. Decorator adds excessive allocation.
5. Outbox publisher queries inefficiently.
6. DTO assembler creates N+1 queries.
7. Parallel stream introduced without reason.
8. Reflection-based registry slows hot path.
9. Logging serializes large object graph.
10. Specification composition reloads same data.

Mitigation:

1. Baseline before refactor.
2. Test query count.
3. Keep policy pure where possible.
4. Batch load dependencies.
5. Cache immutable metadata.
6. Use JFR/JMH only where needed.
7. Avoid micro-optimizing before design correctness.

---

## 30. Refactoring Commit Strategy

Good sequence:

```text
Commit 1: add tests around current behavior
Commit 2: rename variables/classes to reveal intent
Commit 3: extract value object/parameter object
Commit 4: extract pure policy/strategy
Commit 5: move orchestration into handler
Commit 6: introduce gateway boundary
Commit 7: normalize error model
Commit 8: remove old code path
Commit 9: add architecture test/documentation
```

Bad sequence:

```text
Commit 1: massive redesign + new feature + formatting + renamed everything
```

Reviewers cannot reason about it.

---

## 31. Design Review Checklist

Before refactoring:

```text
What behavior must remain unchanged?
What tests prove current behavior?
What contract must not change?
What side effects must remain?
What data migration is needed, if any?
What rollback path exists?
```

During refactoring:

```text
Is each step small?
Is behavior change separated from structure change?
Are names improving understanding?
Is old code deleted after migration?
Are boundaries more explicit?
```

After refactoring:

```text
Did coupling decrease?
Did testability improve?
Did observability remain or improve?
Did security remain intact?
Did performance stay acceptable?
Did the chosen pattern reduce a real force?
```

Pattern-specific review:

```text
Strategy: selection is explicit and testable?
Specification: reasons are explainable?
State Machine: illegal transitions are impossible or explicit?
Gateway: external model is isolated?
Command Handler: transaction boundary is clear?
Outbox: event consistency and idempotency are handled?
DTO/Mapper: boundary model does not leak internal entity?
Policy: authorization/eligibility decision is auditable?
```

---

## 32. Common Staff-Level Discussion

### 32.1 “Should we refactor this now?”

Good answer:

```text
Only if the expected change pressure justifies the cost and we have enough safety net.
```

Ask:

1. How often does this area change?
2. How risky is each change?
3. How many bugs come from this area?
4. Are tests enough?
5. Can we refactor incrementally?
6. Is there a near-term feature that will benefit?

### 32.2 “Should we introduce a pattern?”

Good answer:

```text
Only if the pattern reduces a concrete design force more than it adds cognitive/runtime cost.
```

### 32.3 “Should we rewrite?”

Good answer:

```text
Rewrite only when incremental refactoring cannot create safe seams, or when platform/runtime constraints make the old system structurally unfit. Otherwise, prefer strangler-style migration.
```

### 32.4 “How do we convince team/stakeholder?”

Do not sell refactoring as beauty.

Sell it as:

```text
Lower regression risk.
Faster future change.
Clearer ownership.
Better auditability.
Reduced incident risk.
Reduced onboarding cost.
```

---

## 33. Case Study: Refactoring Approval Logic

### 33.1 Starting Point

```text
ApprovalService.approve() has:
- input validation
- permission check
- status check
- eligibility rule
- fee rule
- external agency sync
- database mutation
- audit log
- email send
- event publish
- response mapping
```

Symptoms:

1. 800-line method.
2. 14 dependencies.
3. 20 branches.
4. Duplicate audit logic.
5. Direct external API call inside transaction.
6. Status transition hidden in if-else.
7. Email sometimes sent even when event publish fails.
8. Authorization scattered.

### 33.2 Refactoring Plan

Step 1: Add characterization tests.

```text
approve pending review -> approved
approve closed -> invalid state
approve without permission -> forbidden
approve with missing document -> rejected
external sync timeout -> expected error
```

Step 2: Extract command.

```java
record ApproveApplicationCommand(ApplicationId id, UserId actor, String comment) { }
```

Step 3: Extract handler.

```text
ApproveApplicationHandler
```

Step 4: Extract authorization policy.

```text
ApprovalAuthorizationPolicy
```

Step 5: Extract eligibility specifications.

```text
DocumentCompleteSpecification
ApplicantActiveSpecification
NoOutstandingPaymentSpecification
```

Step 6: Extract state machine.

```text
ApplicationWorkflow
ApplicationTransitionTable
```

Step 7: Extract external gateway.

```text
AgencySyncGateway
```

Step 8: Move publish to outbox.

```text
ApplicationApprovedEvent saved in outbox transactionally
```

Step 9: Extract response assembler.

```text
ApprovalResponseAssembler
```

Step 10: Delete old branches.

### 33.3 Target Structure

```text
application/
  approval/
    ApproveApplicationCommand.java
    ApproveApplicationHandler.java
    ApprovalResponse.java
    ApprovalResponseAssembler.java

domain/
  application/
    Application.java
    ApplicationId.java
    ApplicationStatus.java
    ApplicationWorkflow.java
    ApplicationTransition.java
  policy/
    ApprovalAuthorizationPolicy.java
    EligibilitySpecification.java
    DocumentCompleteSpecification.java
    ApplicantActiveSpecification.java

port/
  AgencySyncGateway.java
  Outbox.java

adapter/
  agency/
    HttpAgencySyncGateway.java
  persistence/
    JpaApplicationRepository.java
```

### 33.4 Result

Old:

```text
One method knows everything.
```

New:

```text
Handler orchestrates.
Domain enforces transition.
Policy explains decisions.
Gateway isolates external system.
Outbox protects integration consistency.
Assembler owns response shape.
```

---

## 34. Anti-Pattern Catalog

### 34.1 Refactor Without Tests

Symptom:

```text
Trust me, I only moved code.
```

Risk:

```text
Moved code changes behavior silently.
```

### 34.2 Big-Bang Rewrite

Symptom:

```text
Let's rebuild the module from scratch.
```

Risk:

```text
Hidden behavior lost.
Long delivery freeze.
High regression.
```

### 34.3 Pattern Injection

Symptom:

```text
Adding Factory, Strategy, Resolver, Registry for simple stable code.
```

Risk:

```text
Cognitive load increases without flexibility benefit.
```

### 34.4 Refactor Mixed with Feature

Symptom:

```text
New feature PR also renames/moves 70 files.
```

Risk:

```text
Review and rollback become hard.
```

### 34.5 Half-Migration

Symptom:

```text
Old and new pattern both exist forever.
```

Risk:

```text
System becomes more complex than before.
```

### 34.6 Utility Dumping Ground

Symptom:

```text
Move duplicated logic to CommonUtil.
```

Risk:

```text
Common module becomes dependency magnet.
```

### 34.7 Interface for Everything

Symptom:

```text
Every class has an interface with one implementation.
```

Risk:

```text
Navigation and understanding worsen.
```

Use interface when:

1. Multiple implementation expected.
2. Boundary inversion needed.
3. Testing seam needed and not otherwise available.
4. Plugin/extension point exists.
5. Stable contract matters.

### 34.8 Manager/Processor/Helper Explosion

Symptom:

```text
CaseManager
CaseProcessor
CaseHelper
CaseUtil
CaseCommonService
```

Risk:

```text
Names hide responsibility.
```

Rename by decision/action:

```text
CaseWorkflow
CaseEligibilityPolicy
CaseApprovalHandler
CaseAuditAssembler
CaseDocumentGateway
```

---

## 35. Practical Refactoring Playbook

Use this playbook when facing messy Java code.

### 35.1 Long Method Playbook

```text
1. Add characterization test.
2. Add comments naming sections.
3. Extract pure computation first.
4. Extract mapping second.
5. Extract policy third.
6. Extract side-effect boundary last.
7. Delete comments if method becomes readable.
```

### 35.2 Large Conditional Playbook

```text
1. Determine conditional axis.
2. If algorithm varies -> Strategy.
3. If eligibility varies -> Specification/Policy.
4. If state transition varies -> State Machine.
5. If type operation varies -> Visitor/sealed switch.
6. Keep switch if small and stable.
```

### 35.3 God Service Playbook

```text
1. List public methods.
2. Group by use case.
3. Extract one handler at a time.
4. Move dependencies with handler.
5. Keep old service as facade temporarily.
6. Delete forwarding methods after migration.
```

### 35.4 External API Leak Playbook

```text
1. Identify external DTO usage.
2. Create domain-oriented gateway interface.
3. Create internal result model.
4. Move HTTP/client code behind adapter.
5. Translate errors.
6. Add timeout/retry/resilience policy.
7. Test mapping and failure.
```

### 35.5 Cyclic Dependency Playbook

```text
1. Draw dependency graph.
2. Classify dependency type.
3. Move orchestration upward.
4. Extract port if needed.
5. Use event for notification dependency.
6. Avoid dumping into common module.
7. Add architecture test.
```

---

## 36. Final Mental Model

Refactoring toward patterns is not:

```text
Make code look like a pattern catalog.
```

It is:

```text
Expose the real design forces,
move responsibility to the right place,
make change cheaper,
make failure more contained,
and preserve behavior while evolving structure.
```

A top-level engineer does not ask first:

```text
Which pattern can I use?
```

They ask:

```text
What is changing?
What must stay invariant?
Where is coupling hurting us?
Where is behavior hidden?
What is the smallest safe step?
What test protects us?
What cost does the new abstraction add?
When can we delete the old path?
```

Pattern mastery is not knowing more names.

Pattern mastery is knowing which abstraction is worth its cost.

---

## 37. Summary

Di part ini kita membahas:

1. Refactoring sebagai behavior-preserving design migration.
2. Pattern sebagai hasil dari force desain, bukan tujuan awal.
3. Safety layers: characterization test, golden master, contract test, observability baseline.
4. Workflow umum refactoring.
5. Smell catalog dan pattern direction.
6. Replace conditional with Strategy.
7. Replace conditional with Specification.
8. Replace status logic with State Machine.
9. Extract Command Handler from God Service.
10. Encapsulate external API with Gateway/Adapter.
11. Break cyclic dependency.
12. Replace inheritance with composition.
13. Introduce Parameter Object.
14. Introduce Domain Primitive.
15. Normalize error handling.
16. Introduce Outbox.
17. Split read/write model.
18. Pattern Injection anti-pattern.
19. Big-Bang Rewrite anti-pattern.
20. Branch by Abstraction.
21. Parallel run.
22. Testing, observability, security, and performance during refactoring.
23. Refactoring playbooks.

---

## 38. Status Seri

```text
Part 32 dari 35 selesai.
Seri belum selesai.
```

Part berikutnya:

```text
33-pattern-selection-heuristics-decision-matrix.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./31-distributed-system-patterns-antipatterns-java-engineers.md">⬅️ Distributed System Patterns and Anti-Patterns for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./33-pattern-selection-heuristics-decision-matrix.md">Pattern Selection Heuristics: Decision Matrix for Senior Engineers ➡️</a>
</div>

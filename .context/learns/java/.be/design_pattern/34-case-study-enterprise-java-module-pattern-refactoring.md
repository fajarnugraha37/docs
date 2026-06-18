# 34 — Case Study: Refactoring a Complex Enterprise Java Module Pattern Refactoring

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 34 dari 35  
> Target: Java 8–25  
> Fokus: refactoring kompleks pada modul enterprise Java dengan pattern yang tepat, bukan pattern theater.

---

## 1. Tujuan Pembelajaran

Bagian ini adalah **case study integratif**. Setelah banyak part sebelumnya membahas pattern secara individual, bagian ini menjawab pertanyaan yang lebih dekat dengan pekerjaan senior/staff engineer:

> Bagaimana menerapkan design pattern pada codebase nyata yang sudah kompleks, penuh constraint, dan tidak bisa dirombak total?

Tujuan akhirnya bukan membuat desain terlihat “bersih” secara akademik, tetapi membuat sistem:

1. lebih mudah dipahami;
2. lebih aman diubah;
3. lebih mudah diuji;
4. lebih mudah diaudit;
5. lebih defensible secara regulatory/business;
6. lebih observable saat terjadi incident;
7. lebih sedikit menyembunyikan side effect;
8. lebih jelas boundary transaksi dan integrasinya;
9. lebih siap berkembang tanpa big-bang rewrite.

Kita akan memodelkan sebuah modul enterprise Java bernama:

```text
Case Enforcement Module
```

Modul ini menangani lifecycle kasus regulatory/enforcement, seperti:

```text
Draft -> Submitted -> Under Review -> Approved -> Enforcement Action -> Closed
```

Fitur utama:

1. submit case;
2. assign officer;
3. review evidence;
4. approve decision;
5. generate correspondence;
6. publish integration event;
7. update audit trail;
8. call external party profile API;
9. validate role and permission;
10. enforce workflow transition rule.

---

## 2. Starting Point: Modul Enterprise yang Mulai Membusuk

Anggap kita menemukan service seperti ini:

```java
public class EnforcementCaseService {

    private final EnforcementCaseRepository caseRepository;
    private final UserRepository userRepository;
    private final ProfileApiClient profileApiClient;
    private final EmailClient emailClient;
    private final AuditTrailRepository auditTrailRepository;
    private final EventPublisher eventPublisher;
    private final DocumentGenerator documentGenerator;

    public EnforcementCaseService(
            EnforcementCaseRepository caseRepository,
            UserRepository userRepository,
            ProfileApiClient profileApiClient,
            EmailClient emailClient,
            AuditTrailRepository auditTrailRepository,
            EventPublisher eventPublisher,
            DocumentGenerator documentGenerator) {
        this.caseRepository = caseRepository;
        this.userRepository = userRepository;
        this.profileApiClient = profileApiClient;
        this.emailClient = emailClient;
        this.auditTrailRepository = auditTrailRepository;
        this.eventPublisher = eventPublisher;
        this.documentGenerator = documentGenerator;
    }

    public void approveCase(String caseId,
                            String officerId,
                            String remarks,
                            boolean sendEmail,
                            boolean generateLetter,
                            boolean publishEvent) {

        EnforcementCase c = caseRepository.findById(caseId)
                .orElseThrow(() -> new RuntimeException("Case not found"));

        User officer = userRepository.findById(officerId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!officer.hasRole("APPROVER") && !officer.hasRole("SUPERVISOR")) {
            throw new RuntimeException("Unauthorized");
        }

        if (!"UNDER_REVIEW".equals(c.getStatus())) {
            throw new RuntimeException("Invalid status");
        }

        if (remarks == null || remarks.trim().isEmpty()) {
            throw new RuntimeException("Remarks required");
        }

        var profile = profileApiClient.getProfile(c.getPartyId());

        if (profile == null || profile.isBlocked()) {
            throw new RuntimeException("Invalid party profile");
        }

        c.setStatus("APPROVED");
        c.setApprovedBy(officerId);
        c.setApprovedAt(LocalDateTime.now());
        c.setRemarks(remarks);

        caseRepository.save(c);

        auditTrailRepository.save(new AuditTrail(
                caseId,
                "APPROVE_CASE",
                officerId,
                "Case approved with remarks: " + remarks
        ));

        if (generateLetter) {
            byte[] pdf = documentGenerator.generateApprovalLetter(c, profile);
            c.setApprovalLetter(pdf);
            caseRepository.save(c);
        }

        if (sendEmail) {
            emailClient.sendApprovalEmail(profile.getEmail(), caseId);
        }

        if (publishEvent) {
            eventPublisher.publish("CASE_APPROVED", caseId);
        }
    }
}
```

Kode seperti ini sering muncul karena awalnya requirement kecil. Lama-lama service menjadi tempat menaruh semua hal:

```text
validation
authorization
workflow transition
external API call
mutation
persistence
PDF generation
email sending
audit trail
event publishing
error mapping
feature flag
business rule
technical retry
```

Masalahnya bukan hanya method panjang. Masalah utamanya adalah **responsibility boundary tidak jelas**.

---

## 3. Gejala Desain yang Terlihat

### 3.1 God Service

`EnforcementCaseService` melakukan terlalu banyak hal.

Ia bukan hanya menjalankan use case, tetapi juga:

1. mengambil data;
2. memvalidasi input;
3. memeriksa role;
4. memutuskan state transition;
5. memanggil external API;
6. menulis audit;
7. generate document;
8. mengirim email;
9. publish event.

God Service biasanya terlihat “praktis” karena semua flow ada di satu tempat. Tetapi biaya jangka panjangnya tinggi:

```text
small change -> touch big method
new rule -> add another if
new output -> add another dependency
new integration -> add another side effect
new test -> setup everything
```

### 3.2 Scattered Validation

Validation ada di service method, kadang di controller, kadang di entity, kadang di database constraint.

Akibatnya:

1. rule sulit ditemukan;
2. rule sulit diuji terpisah;
3. rule bisa berbeda antar endpoint;
4. error message tidak konsisten;
5. audit tidak bisa menjelaskan rule mana yang gagal.

### 3.3 Duplicated Authorization

Role check seperti ini rawan:

```java
if (!officer.hasRole("APPROVER") && !officer.hasRole("SUPERVISOR")) {
    throw new RuntimeException("Unauthorized");
}
```

Masalah:

1. string role tersebar;
2. tidak mempertimbangkan ownership/resource scope;
3. tidak mempertimbangkan workflow state;
4. tidak mempertimbangkan delegation;
5. tidak ada explanation;
6. sulit diaudit.

### 3.4 Transaction Boundary Confusion

External API, persistence, audit, document generation, email, dan event publishing bercampur.

Pertanyaan penting:

```text
Apakah external profile call terjadi di dalam transaction?
Apakah PDF disimpan dalam transaction yang sama?
Apakah email dikirim sebelum commit?
Apa yang terjadi jika event publish gagal setelah DB commit?
Apa yang terjadi jika DB rollback setelah email terkirim?
```

Kode awal tidak menjawab pertanyaan ini.

### 3.5 External API Leakage

`ProfileApiClient` langsung dipakai di use case. External model `profile` ikut memengaruhi flow internal.

Jika external API berubah, domain ikut berubah.

### 3.6 Event Side Effects

```java
eventPublisher.publish("CASE_APPROVED", caseId);
```

Masalah:

1. event berupa string;
2. payload tidak jelas;
3. publish terjadi langsung;
4. tidak ada outbox;
5. tidak ada idempotency;
6. tidak ada correlation ID;
7. tidak ada retry semantics;
8. tidak jelas apakah event bagian dari transaction.

### 3.7 Error Semantics Lemah

Semua error memakai `RuntimeException`.

Akibatnya caller tidak tahu:

```text
not found?
unauthorized?
invalid transition?
external failure?
validation error?
retryable?
non-retryable?
conflict?
```

### 3.8 Audit Tidak Defensible

Audit message berupa string bebas:

```java
"Case approved with remarks: " + remarks
```

Masalah:

1. PII bisa bocor;
2. format tidak stabil;
3. tidak machine-readable;
4. tidak menyimpan before/after state;
5. tidak menyimpan rule/policy result;
6. tidak menyimpan correlation/causation;
7. sulit dipakai saat investigasi.

---

## 4. Prinsip Refactoring Case Study Ini

Kita tidak akan melakukan big-bang rewrite.

Kita akan refactor dengan prinsip:

```text
preserve behavior first
make hidden responsibility visible
introduce boundary gradually
move decision closer to owner
move side effect behind explicit port
separate decision from delivery
make failure semantics explicit
make audit/event observable and durable
```

Urutan refactoring:

1. buat characterization test;
2. petakan responsibility;
3. perjelas command/input model;
4. extract application service/use case handler;
5. extract authorization policy;
6. extract validation/specification;
7. introduce state transition model;
8. isolate external API via gateway/ACL;
9. normalize error model;
10. separate domain mutation from side effects;
11. introduce audit event;
12. introduce outbox event;
13. split document/email side effect;
14. improve package boundary;
15. add observability and design review checklist.

---

## 5. Step 0 — Characterization Test Sebelum Refactoring

Sebelum mengubah desain, kita perlu mengunci behavior yang ada.

Karakterisasi test tidak selalu ideal, tetapi sangat berguna untuk legacy refactoring.

Contoh test awal:

```java
class EnforcementCaseServiceCharacterizationTest {

    @Test
    void approveCase_shouldApproveWhenCaseUnderReviewAndOfficerIsApprover() {
        // arrange legacy fixtures
        // act
        // assert status changed, audit saved, email sent, event published
    }

    @Test
    void approveCase_shouldRejectWhenCaseNotUnderReview() {
        // assert current exception behavior
    }

    @Test
    void approveCase_shouldRejectWhenOfficerHasNoApproverRole() {
        // assert current exception behavior
    }

    @Test
    void approveCase_shouldRejectWhenRemarksBlank() {
        // assert current exception behavior
    }
}
```

Pada tahap ini, test boleh mengikuti behavior lama walaupun behavior lama belum ideal.

Tujuannya:

```text
agar refactoring tidak diam-diam mengubah behavior
```

Jika behavior lama salah, tandai sebagai expected legacy behavior dan ubah setelah ada keputusan product/business.

---

## 6. Step 1 — Map Responsibilities

Sebelum menulis pattern, kita petakan apa saja responsibility yang tersembunyi.

```text
approveCase
├── input validation
├── load case
├── load officer
├── authorization
├── workflow transition validation
├── remarks validation
├── external party profile validation
├── mutate case
├── persist case
├── audit trail
├── document generation
├── email notification
└── event publication
```

Kemudian klasifikasikan:

| Responsibility | Owner yang Lebih Tepat | Pattern Kandidat |
|---|---|---|
| Input shape | Command | Command Object |
| Use case orchestration | Application Service / Handler | Command Handler |
| Authorization | Policy Object | Authorization Policy |
| Workflow transition | State Machine / Workflow Object | State Pattern / Table-driven SM |
| Business validation | Specification / Rule Object | Specification |
| External party profile | Gateway / ACL | Gateway, Adapter |
| Mutation invariant | Domain Entity | Domain Method |
| Audit fact | Audit Event Builder | Audit Event Pattern |
| Integration event | Outbox Message | Outbox Pattern |
| Email delivery | Notification Handler | Event Listener |
| Document generation | Document Port | Gateway/Port |

Ini titik penting: pattern tidak dipilih karena ingin “memakai pattern”, tetapi karena responsibility punya force yang berbeda.

---

## 7. Step 2 — Introduce Command Object

Method lama punya banyak parameter:

```java
approveCase(String caseId,
            String officerId,
            String remarks,
            boolean sendEmail,
            boolean generateLetter,
            boolean publishEvent)
```

Ini smell:

1. boolean parameter API;
2. parameter order risk;
3. intent tidak eksplisit;
4. sulit evolve;
5. sulit validate sebagai satu unit.

Kita ubah menjadi command:

```java
public record ApproveCaseCommand(
        String caseId,
        String actorId,
        String remarks,
        ApprovalOptions options
) {
    public ApproveCaseCommand {
        if (caseId == null || caseId.isBlank()) {
            throw new IllegalArgumentException("caseId is required");
        }
        if (actorId == null || actorId.isBlank()) {
            throw new IllegalArgumentException("actorId is required");
        }
        if (remarks == null || remarks.isBlank()) {
            throw new IllegalArgumentException("remarks is required");
        }
        options = options == null ? ApprovalOptions.defaults() : options;
    }
}
```

Options object:

```java
public record ApprovalOptions(
        boolean generateLetter,
        boolean notifyParty
) {
    public static ApprovalOptions defaults() {
        return new ApprovalOptions(true, true);
    }
}
```

Perhatikan: kita hilangkan `publishEvent` dari input user.

Kenapa?

Karena publish event biasanya bukan pilihan caller. Jika case benar-benar approved, event seharusnya bagian dari system invariant, bukan boolean opsional dari UI/API.

Ini contoh design judgment:

```text
boolean generateLetter/notifyParty = use case option
boolean publishEvent = internal consistency mechanism
```

---

## 8. Step 3 — Create Application Service / Command Handler

Kita buat handler sebagai use case boundary:

```java
public final class ApproveCaseHandler {

    private final EnforcementCaseRepository caseRepository;
    private final UserRepository userRepository;
    private final ApprovalAuthorizationPolicy authorizationPolicy;
    private final ApprovalPolicy approvalPolicy;
    private final PartyProfileGateway partyProfileGateway;
    private final AuditTrailPort auditTrailPort;
    private final OutboxPort outboxPort;
    private final Clock clock;

    public ApproveCaseHandler(
            EnforcementCaseRepository caseRepository,
            UserRepository userRepository,
            ApprovalAuthorizationPolicy authorizationPolicy,
            ApprovalPolicy approvalPolicy,
            PartyProfileGateway partyProfileGateway,
            AuditTrailPort auditTrailPort,
            OutboxPort outboxPort,
            Clock clock) {
        this.caseRepository = caseRepository;
        this.userRepository = userRepository;
        this.authorizationPolicy = authorizationPolicy;
        this.approvalPolicy = approvalPolicy;
        this.partyProfileGateway = partyProfileGateway;
        this.auditTrailPort = auditTrailPort;
        this.outboxPort = outboxPort;
        this.clock = clock;
    }

    public ApproveCaseResult handle(ApproveCaseCommand command) {
        EnforcementCase c = caseRepository.findById(new CaseId(command.caseId()))
                .orElseThrow(() -> CaseError.notFound(command.caseId()));

        User actor = userRepository.findById(new UserId(command.actorId()))
                .orElseThrow(() -> CaseError.actorNotFound(command.actorId()));

        authorizationPolicy.checkCanApprove(actor, c);

        PartyProfile profile = partyProfileGateway.getPartyProfile(c.partyId());

        ApprovalDecision decision = approvalPolicy.evaluate(c, actor, profile, command.remarks());
        if (!decision.allowed()) {
            throw CaseError.approvalRejected(decision.reasons());
        }

        CaseTransition transition = c.approve(
                actor.id(),
                command.remarks(),
                clock.instant()
        );

        caseRepository.save(c);

        auditTrailPort.record(AuditEvent.caseApproved(c, actor, transition, decision));

        outboxPort.enqueue(CaseApprovedEvent.from(c, actor, transition));

        return new ApproveCaseResult(c.id().value(), c.status().name());
    }
}
```

Handler sekarang tetap mengorkestrasi, tetapi detail decision sudah dipindahkan ke boundary yang tepat.

---

## 9. Step 4 — Extract Authorization Policy

Sebelumnya authorization:

```java
if (!officer.hasRole("APPROVER") && !officer.hasRole("SUPERVISOR")) {
    throw new RuntimeException("Unauthorized");
}
```

Kita ubah menjadi policy object:

```java
public final class ApprovalAuthorizationPolicy {

    public void checkCanApprove(User actor, EnforcementCase c) {
        AuthorizationDecision decision = evaluate(actor, c);
        if (!decision.allowed()) {
            throw CaseError.unauthorized(decision.reasonCode());
        }
    }

    public AuthorizationDecision evaluate(User actor, EnforcementCase c) {
        if (!actor.isActive()) {
            return AuthorizationDecision.deny("ACTOR_INACTIVE");
        }

        if (!actor.hasAnyRole(Role.APPROVER, Role.SUPERVISOR)) {
            return AuthorizationDecision.deny("ROLE_NOT_ALLOWED");
        }

        if (!actor.canAccessAgency(c.agencyId())) {
            return AuthorizationDecision.deny("AGENCY_SCOPE_DENIED");
        }

        if (c.assignedOfficerId().equals(actor.id())) {
            return AuthorizationDecision.deny("SELF_APPROVAL_NOT_ALLOWED");
        }

        return AuthorizationDecision.allow();
    }
}
```

Decision object:

```java
public record AuthorizationDecision(
        boolean allowed,
        String reasonCode
) {
    public static AuthorizationDecision allow() {
        return new AuthorizationDecision(true, "ALLOWED");
    }

    public static AuthorizationDecision deny(String reasonCode) {
        return new AuthorizationDecision(false, reasonCode);
    }
}
```

Keuntungan:

1. rule authorization terkumpul;
2. bisa diuji tanpa database;
3. alasan deny eksplisit;
4. audit bisa menyimpan reason code;
5. role string tidak tersebar;
6. mendukung policy evolution.

---

## 10. Step 5 — Extract Business Rule / Specification

Approval bukan hanya authorization. Ada business rule.

Contoh:

1. case harus under review;
2. evidence harus lengkap;
3. party profile tidak blocked;
4. remarks wajib;
5. sanction recommendation harus ada untuk case tertentu;
6. high-risk case butuh supervisor approval.

Kita buat policy/rule object:

```java
public final class ApprovalPolicy {

    private final List<ApprovalRule> rules;

    public ApprovalPolicy(List<ApprovalRule> rules) {
        this.rules = List.copyOf(rules);
    }

    public ApprovalDecision evaluate(
            EnforcementCase c,
            User actor,
            PartyProfile profile,
            String remarks) {

        List<ApprovalRejection> rejections = new ArrayList<>();

        for (ApprovalRule rule : rules) {
            rule.evaluate(c, actor, profile, remarks)
                    .ifPresent(rejections::add);
        }

        if (rejections.isEmpty()) {
            return ApprovalDecision.allowed();
        }
        return ApprovalDecision.rejected(rejections);
    }
}
```

Rule interface:

```java
public interface ApprovalRule {
    Optional<ApprovalRejection> evaluate(
            EnforcementCase c,
            User actor,
            PartyProfile profile,
            String remarks
    );
}
```

Concrete rule:

```java
public final class EvidenceCompletenessRule implements ApprovalRule {

    @Override
    public Optional<ApprovalRejection> evaluate(
            EnforcementCase c,
            User actor,
            PartyProfile profile,
            String remarks) {

        if (!c.hasRequiredEvidence()) {
            return Optional.of(new ApprovalRejection(
                    "EVIDENCE_INCOMPLETE",
                    "Required evidence is incomplete"
            ));
        }

        return Optional.empty();
    }
}
```

Decision:

```java
public record ApprovalDecision(
        boolean allowed,
        List<ApprovalRejection> rejections
) {
    public static ApprovalDecision allowed() {
        return new ApprovalDecision(true, List.of());
    }

    public static ApprovalDecision rejected(List<ApprovalRejection> rejections) {
        return new ApprovalDecision(false, List.copyOf(rejections));
    }

    public List<String> reasons() {
        return rejections.stream()
                .map(ApprovalRejection::code)
                .toList();
    }
}
```

Keuntungan:

1. rule bisa dites satu per satu;
2. rejections bisa diakumulasi;
3. audit bisa menyimpan rule result;
4. policy lebih mudah dievolusi;
5. tidak perlu `if` besar di service;
6. cocok untuk regulatory defensibility.

---

## 11. Step 6 — Introduce State Transition Model

Status string:

```java
if (!"UNDER_REVIEW".equals(c.getStatus())) {
    throw new RuntimeException("Invalid status");
}
```

Kita ubah menjadi enum atau sealed type.

Minimal:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    ENFORCEMENT_ACTION,
    CLOSED
}
```

Domain method:

```java
public final class EnforcementCase {

    private CaseId id;
    private CaseStatus status;
    private UserId assignedOfficerId;
    private UserId approvedBy;
    private Instant approvedAt;
    private String approvalRemarks;

    public CaseTransition approve(UserId actorId, String remarks, Instant approvedAt) {
        if (status != CaseStatus.UNDER_REVIEW) {
            throw CaseError.invalidTransition(status, CaseStatus.APPROVED);
        }

        CaseStatus previous = this.status;
        this.status = CaseStatus.APPROVED;
        this.approvedBy = actorId;
        this.approvedAt = approvedAt;
        this.approvalRemarks = remarks;

        return new CaseTransition(previous, CaseStatus.APPROVED, actorId, approvedAt);
    }
}
```

Transition object:

```java
public record CaseTransition(
        CaseStatus from,
        CaseStatus to,
        UserId actorId,
        Instant occurredAt
) {}
```

Jika workflow semakin kompleks, gunakan table-driven state machine:

```java
public final class CaseWorkflow {

    private final Set<AllowedTransition> allowedTransitions = Set.of(
            new AllowedTransition(CaseStatus.SUBMITTED, CaseStatus.UNDER_REVIEW),
            new AllowedTransition(CaseStatus.UNDER_REVIEW, CaseStatus.APPROVED),
            new AllowedTransition(CaseStatus.APPROVED, CaseStatus.ENFORCEMENT_ACTION),
            new AllowedTransition(CaseStatus.ENFORCEMENT_ACTION, CaseStatus.CLOSED)
    );

    public void assertCanTransition(CaseStatus from, CaseStatus to) {
        if (!allowedTransitions.contains(new AllowedTransition(from, to))) {
            throw CaseError.invalidTransition(from, to);
        }
    }
}
```

Kapan rule ada di entity dan kapan di workflow object?

| Rule Type | Lokasi Lebih Cocok |
|---|---|
| Invariant sederhana entity | Entity method |
| Transition matrix besar | Workflow object |
| Guard bergantung actor/profile/external context | Policy/rule object |
| Regulatory rule yang butuh explanation | Rule object/specification |
| UI available action | Workflow query service |

---

## 12. Step 7 — Isolate External API via Gateway / Anti-Corruption Layer

Sebelumnya:

```java
var profile = profileApiClient.getProfile(c.getPartyId());

if (profile == null || profile.isBlocked()) {
    throw new RuntimeException("Invalid party profile");
}
```

Masalah:

1. external API model masuk use case;
2. null semantics tidak jelas;
3. external error tidak dibedakan;
4. retry/timeout tidak jelas;
5. blocked meaning mungkin external-specific.

Kita buat internal model:

```java
public record PartyProfile(
        PartyId partyId,
        String displayName,
        EmailAddress email,
        PartyStanding standing
) {
    public boolean isBlocked() {
        return standing == PartyStanding.BLOCKED;
    }
}
```

Gateway:

```java
public interface PartyProfileGateway {
    PartyProfile getPartyProfile(PartyId partyId);
}
```

Adapter:

```java
public final class ExternalPartyProfileGateway implements PartyProfileGateway {

    private final ExternalProfileClient client;
    private final ExternalProfileMapper mapper;

    public ExternalPartyProfileGateway(
            ExternalProfileClient client,
            ExternalProfileMapper mapper) {
        this.client = client;
        this.mapper = mapper;
    }

    @Override
    public PartyProfile getPartyProfile(PartyId partyId) {
        try {
            ExternalProfileResponse response = client.getProfile(partyId.value());
            return mapper.toDomain(response);
        } catch (ExternalProfileNotFoundException e) {
            throw CaseError.partyProfileNotFound(partyId.value());
        } catch (ExternalProfileTimeoutException e) {
            throw CaseError.partyProfileTemporarilyUnavailable(partyId.value(), e);
        }
    }
}
```

Mapper:

```java
public final class ExternalProfileMapper {

    public PartyProfile toDomain(ExternalProfileResponse response) {
        return new PartyProfile(
                new PartyId(response.partyId()),
                response.name(),
                new EmailAddress(response.email()),
                mapStanding(response.statusCode())
        );
    }

    private PartyStanding mapStanding(String externalStatusCode) {
        return switch (externalStatusCode) {
            case "A" -> PartyStanding.ACTIVE;
            case "B", "SUSP" -> PartyStanding.BLOCKED;
            default -> PartyStanding.UNKNOWN;
        };
    }
}
```

Sekarang external semantics berhenti di boundary.

---

## 13. Step 8 — Normalize Error Model

Alih-alih `RuntimeException`, kita buat taxonomy.

```java
public sealed class CaseError extends RuntimeException
        permits CaseNotFoundError,
                ActorNotFoundError,
                UnauthorizedCaseActionError,
                InvalidCaseTransitionError,
                ApprovalRejectedError,
                ExternalDependencyUnavailableError {

    private final String code;

    protected CaseError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static CaseError notFound(String caseId) {
        return new CaseNotFoundError(caseId);
    }

    public static CaseError unauthorized(String reasonCode) {
        return new UnauthorizedCaseActionError(reasonCode);
    }

    public static CaseError invalidTransition(CaseStatus from, CaseStatus to) {
        return new InvalidCaseTransitionError(from, to);
    }

    public static CaseError approvalRejected(List<String> reasons) {
        return new ApprovalRejectedError(reasons);
    }
}
```

Contoh subtype:

```java
public final class InvalidCaseTransitionError extends CaseError {

    private final CaseStatus from;
    private final CaseStatus to;

    public InvalidCaseTransitionError(CaseStatus from, CaseStatus to) {
        super("CASE_INVALID_TRANSITION", "Invalid case transition from " + from + " to " + to);
        this.from = from;
        this.to = to;
    }

    public CaseStatus from() {
        return from;
    }

    public CaseStatus to() {
        return to;
    }
}
```

API layer bisa map ke Problem Details:

```java
public final class CaseErrorMapper {

    public ProblemDetail toProblem(CaseError error) {
        return switch (error) {
            case CaseNotFoundError e -> ProblemDetail.notFound(e.code(), e.getMessage());
            case UnauthorizedCaseActionError e -> ProblemDetail.forbidden(e.code(), e.getMessage());
            case InvalidCaseTransitionError e -> ProblemDetail.conflict(e.code(), e.getMessage());
            case ApprovalRejectedError e -> ProblemDetail.unprocessable(e.code(), e.getMessage());
            case ExternalDependencyUnavailableError e -> ProblemDetail.serviceUnavailable(e.code(), e.getMessage());
        };
    }
}
```

Manfaat:

1. error semantics jelas;
2. HTTP mapping konsisten;
3. retryability bisa dibedakan;
4. audit bisa simpan error code;
5. observability lebih baik;
6. client tidak parsing string.

---

## 14. Step 9 — Separate Domain Mutation from Side Effects

Kode awal melakukan ini dalam satu method:

```text
mutate case
save case
save audit
generate letter
send email
publish event
```

Masalah besar: side effect tidak atomic bersama DB transaction.

Refactoring:

1. domain mutation dan DB save berada dalam transaction;
2. audit event disimpan dalam transaction;
3. outbox event disimpan dalam transaction;
4. email/document generation diproses async setelah commit;
5. event publishing dari outbox worker.

Use case transaction:

```java
public ApproveCaseResult handle(ApproveCaseCommand command) {
    // load, authorize, evaluate

    CaseTransition transition = c.approve(actor.id(), command.remarks(), clock.instant());

    caseRepository.save(c);

    auditTrailPort.record(AuditEvent.caseApproved(c, actor, transition, decision));

    outboxPort.enqueue(CaseApprovedEvent.from(c, actor, transition));

    if (command.options().generateLetter()) {
        outboxPort.enqueue(ApprovalLetterRequestedEvent.from(c, actor));
    }

    if (command.options().notifyParty()) {
        outboxPort.enqueue(PartyNotificationRequestedEvent.approval(c, actor));
    }

    return new ApproveCaseResult(c.id().value(), c.status().name());
}
```

Sekarang side effect menjadi event-driven, bukan random call di tengah transaction.

---

## 15. Step 10 — Introduce Audit Event Pattern

Audit lama:

```java
auditTrailRepository.save(new AuditTrail(
        caseId,
        "APPROVE_CASE",
        officerId,
        "Case approved with remarks: " + remarks
));
```

Audit baru:

```java
public record AuditEvent(
        String eventId,
        String eventType,
        String actorId,
        String resourceType,
        String resourceId,
        Instant occurredAt,
        String correlationId,
        Map<String, Object> attributes
) {
    public static AuditEvent caseApproved(
            EnforcementCase c,
            User actor,
            CaseTransition transition,
            ApprovalDecision decision) {

        return new AuditEvent(
                UUID.randomUUID().toString(),
                "CASE_APPROVED",
                actor.id().value(),
                "ENFORCEMENT_CASE",
                c.id().value(),
                transition.occurredAt(),
                Correlation.currentId(),
                Map.of(
                        "fromStatus", transition.from().name(),
                        "toStatus", transition.to().name(),
                        "approvalRuleResult", decision.reasons(),
                        "actorRoles", actor.roleNames()
                )
        );
    }
}
```

Audit yang baik harus:

1. structured;
2. stable;
3. machine-readable;
4. minim PII;
5. menyimpan actor/resource/action/time;
6. menyimpan before/after state;
7. menyimpan reason code;
8. menyimpan correlation ID;
9. durable;
10. queryable.

---

## 16. Step 11 — Introduce Outbox Event Pattern

Event langsung:

```java
eventPublisher.publish("CASE_APPROVED", caseId);
```

Diganti menjadi:

```java
public record CaseApprovedEvent(
        String eventId,
        String caseId,
        String approvedBy,
        Instant approvedAt,
        String fromStatus,
        String toStatus,
        String correlationId
) {
    public static CaseApprovedEvent from(
            EnforcementCase c,
            User actor,
            CaseTransition transition) {

        return new CaseApprovedEvent(
                UUID.randomUUID().toString(),
                c.id().value(),
                actor.id().value(),
                transition.occurredAt(),
                transition.from().name(),
                transition.to().name(),
                Correlation.currentId()
        );
    }
}
```

Outbox port:

```java
public interface OutboxPort {
    void enqueue(Object event);
}
```

Outbox entity:

```java
public final class OutboxMessage {
    private String id;
    private String aggregateType;
    private String aggregateId;
    private String eventType;
    private String payloadJson;
    private Instant createdAt;
    private OutboxStatus status;
    private int attemptCount;
}
```

Worker:

```java
public final class OutboxPublisher {

    private final OutboxRepository outboxRepository;
    private final MessageBroker broker;

    public void publishPending() {
        List<OutboxMessage> messages = outboxRepository.lockPendingBatch(100);

        for (OutboxMessage message : messages) {
            try {
                broker.publish(message.eventType(), message.payloadJson());
                message.markPublished();
            } catch (Exception e) {
                message.markFailedAttempt(e.getMessage());
            }
        }
    }
}
```

Outbox menyelesaikan dual-write problem antara DB dan broker.

---

## 17. Step 12 — Move Notification and Document Generation to Event Handlers

Email lama langsung di use case:

```java
emailClient.sendApprovalEmail(profile.getEmail(), caseId);
```

Dokumen lama langsung di use case:

```java
byte[] pdf = documentGenerator.generateApprovalLetter(c, profile);
c.setApprovalLetter(pdf);
caseRepository.save(c);
```

Refactoring:

```java
public final class ApprovalLetterRequestedHandler {

    private final EnforcementCaseRepository caseRepository;
    private final PartyProfileGateway partyProfileGateway;
    private final DocumentGenerator documentGenerator;
    private final DocumentRepository documentRepository;

    public void handle(ApprovalLetterRequestedEvent event) {
        EnforcementCase c = caseRepository.findById(new CaseId(event.caseId()))
                .orElseThrow();

        PartyProfile profile = partyProfileGateway.getPartyProfile(c.partyId());

        byte[] pdf = documentGenerator.generateApprovalLetter(c, profile);

        documentRepository.save(Document.approvalLetter(c.id(), pdf));
    }
}
```

Notification handler:

```java
public final class PartyNotificationRequestedHandler {

    private final PartyProfileGateway partyProfileGateway;
    private final EmailGateway emailGateway;

    public void handle(PartyNotificationRequestedEvent event) {
        PartyProfile profile = partyProfileGateway.getPartyProfile(new PartyId(event.partyId()));
        emailGateway.sendApprovalNotification(profile.email(), event.caseId());
    }
}
```

Kelebihan:

1. approval tidak gagal hanya karena email down;
2. side effect bisa retry;
3. delivery bisa observed;
4. responsibility lebih jelas;
5. document/email bisa diskalakan terpisah.

Tetapi ada trade-off:

1. eventual consistency;
2. UI harus tahu status letter/email;
3. event handler harus idempotent;
4. operational monitoring harus kuat.

---

## 18. Step 13 — Final Package Structure

Sebelum:

```text
com.company.enforcement
├── EnforcementCaseService.java
├── EnforcementCaseRepository.java
├── ProfileApiClient.java
├── EmailClient.java
├── EventPublisher.java
├── DocumentGenerator.java
└── AuditTrailRepository.java
```

Sesudah:

```text
com.company.enforcement.caseapproval
├── application
│   ├── ApproveCaseCommand.java
│   ├── ApprovalOptions.java
│   ├── ApproveCaseHandler.java
│   └── ApproveCaseResult.java
│
├── domain
│   ├── EnforcementCase.java
│   ├── CaseId.java
│   ├── PartyId.java
│   ├── CaseStatus.java
│   ├── CaseTransition.java
│   ├── ApprovalDecision.java
│   ├── ApprovalRejection.java
│   ├── ApprovalPolicy.java
│   ├── ApprovalRule.java
│   └── rules
│       ├── EvidenceCompletenessRule.java
│       ├── PartyStandingRule.java
│       └── HighRiskSupervisorRule.java
│
├── authorization
│   ├── ApprovalAuthorizationPolicy.java
│   └── AuthorizationDecision.java
│
├── port
│   ├── EnforcementCaseRepository.java
│   ├── UserRepository.java
│   ├── PartyProfileGateway.java
│   ├── AuditTrailPort.java
│   └── OutboxPort.java
│
├── adapter
│   ├── persistence
│   │   ├── JpaEnforcementCaseRepository.java
│   │   └── EnforcementCaseJpaEntity.java
│   ├── profile
│   │   ├── ExternalPartyProfileGateway.java
│   │   └── ExternalProfileMapper.java
│   ├── audit
│   │   └── DatabaseAuditTrailAdapter.java
│   └── outbox
│       └── DatabaseOutboxAdapter.java
│
├── event
│   ├── CaseApprovedEvent.java
│   ├── ApprovalLetterRequestedEvent.java
│   └── PartyNotificationRequestedEvent.java
│
└── error
    ├── CaseError.java
    ├── CaseNotFoundError.java
    ├── UnauthorizedCaseActionError.java
    ├── InvalidCaseTransitionError.java
    └── ApprovalRejectedError.java
```

Catatan penting: package structure bukan kosmetik. Package harus mencerminkan dependency direction.

```text
application -> domain, port, authorization
domain -> no adapter/framework dependency
adapter -> port/domain
api/controller -> application
```

---

## 19. Before/After Sequence Flow

### 19.1 Before

```text
Controller
  -> EnforcementCaseService.approveCase
      -> load case
      -> load user
      -> if role
      -> if status
      -> call profile API
      -> mutate case
      -> save case
      -> save audit
      -> generate PDF
      -> save case again
      -> send email
      -> publish event
```

Semua terjadi dalam satu mental block.

### 19.2 After

```text
Controller
  -> ApproveCaseHandler.handle(command)
      -> load case
      -> load actor
      -> authorizationPolicy.evaluate
      -> partyProfileGateway.getPartyProfile
      -> approvalPolicy.evaluate
      -> case.approve
      -> caseRepository.save
      -> auditTrailPort.record
      -> outboxPort.enqueue(CaseApprovedEvent)
      -> outboxPort.enqueue(ApprovalLetterRequestedEvent)
      -> outboxPort.enqueue(PartyNotificationRequestedEvent)

OutboxPublisher
  -> publish pending events

ApprovalLetterRequestedHandler
  -> generate document idempotently

PartyNotificationRequestedHandler
  -> send notification idempotently
```

---

## 20. Pattern yang Dipakai dan Alasannya

| Problem | Pattern | Kenapa |
|---|---|---|
| parameter use case berantakan | Command Object | intent eksplisit |
| use case orchestration | Command Handler / Application Service | transaction boundary jelas |
| role check tersebar | Policy Object | authz rule terkumpul |
| business rule banyak | Specification / Rule Object | rule bisa diuji dan dijelaskan |
| status transition raw string | State Machine / Domain Method | invariant workflow jelas |
| external API merembes | Gateway / ACL | semantic translation |
| event langsung | Outbox | durable event after DB commit |
| email/PDF side effect | Event Handler | async, retryable, isolated |
| error generic | Exception Translation / Error Taxonomy | contract jelas |
| audit string bebas | Audit Event Pattern | defensible dan queryable |
| package campur | Hexagonal/Modular Boundary | dependency direction jelas |

---

## 21. Pattern yang Sengaja Tidak Dipakai

Senior engineer juga harus tahu pattern yang tidak dipakai.

### 21.1 Tidak Memakai Full Rule Engine

Kenapa?

Karena rule masih bisa dikelola sebagai code-level policy/rule object.

Rule engine mungkin cocok jika:

1. rule sering diubah non-developer;
2. rule butuh versioning declarative;
3. rule sangat banyak;
4. business ingin simulation environment;
5. rule execution perlu explanation graph kompleks.

Jika belum, rule engine bisa menjadi overengineering.

### 21.2 Tidak Memakai Microservice Baru

Modul approval tidak otomatis harus dipisah menjadi service baru.

Jika boundary belum matang, memecah service hanya memindahkan coupling dari method call ke network call.

### 21.3 Tidak Memakai Event Sourcing

Event sourcing kuat, tetapi mahal.

Untuk case ini, audit trail + state transition + outbox cukup.

Gunakan event sourcing jika source of truth memang event history, bukan current state table.

### 21.4 Tidak Memakai Generic Repository

Repository dibuat berdasarkan aggregate/use case, bukan CRUD generic.

Generic repository sering menyembunyikan query cost dan domain boundary.

---

## 22. Testing Strategy Setelah Refactoring

### 22.1 Domain Unit Test

```java
class EnforcementCaseTest {

    @Test
    void approve_shouldMoveUnderReviewCaseToApproved() {
        EnforcementCase c = Fixtures.caseUnderReview();

        CaseTransition transition = c.approve(
                new UserId("u-1"),
                "Approved",
                Instant.parse("2026-01-01T00:00:00Z")
        );

        assertEquals(CaseStatus.APPROVED, c.status());
        assertEquals(CaseStatus.UNDER_REVIEW, transition.from());
        assertEquals(CaseStatus.APPROVED, transition.to());
    }

    @Test
    void approve_shouldRejectInvalidTransition() {
        EnforcementCase c = Fixtures.draftCase();

        assertThrows(InvalidCaseTransitionError.class, () ->
                c.approve(new UserId("u-1"), "Approved", Instant.now())
        );
    }
}
```

### 22.2 Policy Test

```java
class ApprovalAuthorizationPolicyTest {

    @Test
    void evaluate_shouldDenySelfApproval() {
        User actor = Fixtures.approver("u-1");
        EnforcementCase c = Fixtures.caseAssignedTo("u-1");

        AuthorizationDecision decision = new ApprovalAuthorizationPolicy().evaluate(actor, c);

        assertFalse(decision.allowed());
        assertEquals("SELF_APPROVAL_NOT_ALLOWED", decision.reasonCode());
    }
}
```

### 22.3 Rule Test

```java
class EvidenceCompletenessRuleTest {

    @Test
    void evaluate_shouldRejectWhenEvidenceIncomplete() {
        ApprovalRule rule = new EvidenceCompletenessRule();

        Optional<ApprovalRejection> rejection = rule.evaluate(
                Fixtures.caseWithIncompleteEvidence(),
                Fixtures.approver(),
                Fixtures.activePartyProfile(),
                "ok"
        );

        assertTrue(rejection.isPresent());
        assertEquals("EVIDENCE_INCOMPLETE", rejection.get().code());
    }
}
```

### 22.4 Handler Test

Handler test memastikan orchestration:

1. load case;
2. authorize;
3. evaluate policy;
4. mutate case;
5. save;
6. record audit;
7. enqueue events.

Gunakan fake/in-memory adapter, bukan mocking berlebihan.

### 22.5 Contract Test untuk Gateway

Gateway harus diuji terhadap contract external API.

Test mapper untuk:

1. active status;
2. blocked status;
3. unknown status;
4. missing email;
5. timeout;
6. not found;
7. malformed response.

### 22.6 Outbox Test

Pastikan:

1. event tersimpan saat transaction sukses;
2. event tidak tersimpan saat rollback;
3. worker retry failed message;
4. duplicate publish ditangani downstream;
5. message memiliki correlation ID.

---

## 23. Observability Setelah Refactoring

Minimal log structured di handler:

```json
{
  "event": "case.approval.started",
  "caseId": "C-123",
  "actorId": "U-9",
  "correlationId": "corr-abc"
}
```

Saat policy reject:

```json
{
  "event": "case.approval.rejected",
  "caseId": "C-123",
  "actorId": "U-9",
  "reasonCodes": ["EVIDENCE_INCOMPLETE"],
  "correlationId": "corr-abc"
}
```

Saat success:

```json
{
  "event": "case.approval.completed",
  "caseId": "C-123",
  "fromStatus": "UNDER_REVIEW",
  "toStatus": "APPROVED",
  "outboxMessages": 3,
  "correlationId": "corr-abc"
}
```

Metrics:

```text
case_approval_attempt_total{result="success|rejected|error"}
case_approval_duration_seconds
case_approval_policy_rejection_total{reason="..."}
outbox_pending_messages_total
outbox_publish_failure_total{eventType="..."}
external_profile_latency_seconds
external_profile_error_total{type="timeout|not_found|invalid"}
```

Trace spans:

```text
ApproveCaseHandler.handle
├── CaseRepository.findById
├── UserRepository.findById
├── ApprovalAuthorizationPolicy.evaluate
├── PartyProfileGateway.getPartyProfile
├── ApprovalPolicy.evaluate
├── EnforcementCase.approve
├── CaseRepository.save
├── AuditTrailPort.record
└── OutboxPort.enqueue
```

---

## 24. Security Improvement Setelah Refactoring

Perubahan keamanan:

1. authorization sebelum mutation;
2. policy terpusat;
3. deny reason code eksplisit;
4. no scattered string role;
5. resource scope dicek;
6. self-approval dicek;
7. audit menyimpan actor/resource/action;
8. audit tidak menyimpan remarks mentah jika mengandung PII;
9. external profile response tidak langsung dipercaya;
10. event payload tidak bocor data sensitif.

Anti-pattern yang dihindari:

```text
authorization after mutation
role check in controller only
trusting frontend permission
trusting external response blindly
logging sensitive remarks
publishing full aggregate as event
```

---

## 25. Performance and Operational Trade-Off

Desain baru bukan gratis.

### 25.1 Biaya Tambahan

1. class lebih banyak;
2. event/outbox lebih kompleks;
3. eventual consistency;
4. perlu worker monitoring;
5. perlu idempotency;
6. package boundary butuh disiplin;
7. tracing/logging harus konsisten.

### 25.2 Benefit

1. use case lebih stabil;
2. rule lebih mudah diuji;
3. side effect lebih retryable;
4. audit lebih kuat;
5. incident lebih mudah dianalisis;
6. external API change tidak merusak domain;
7. workflow invariant jelas;
8. error contract lebih baik;
9. future change lebih murah.

### 25.3 Kapan Refactoring Ini Terlalu Berat?

Jika modul hanya CRUD internal sederhana, pola ini mungkin overengineering.

Gunakan pendekatan ini jika ada kombinasi:

1. lifecycle state penting;
2. authorization kompleks;
3. audit penting;
4. external integration;
5. side effect email/event/document;
6. rule berubah berkala;
7. regulatory defensibility;
8. high cost of wrong decision;
9. banyak caller;
10. production incident sulit dianalisis.

---

## 26. Refactoring Plan yang Aman untuk Tim

Jangan refactor semuanya dalam satu PR.

Rencana incremental:

### PR 1 — Characterization Test

1. test approval success;
2. test invalid status;
3. test unauthorized;
4. test profile blocked;
5. test side effects.

### PR 2 — Introduce Command Object

1. tambah `ApproveCaseCommand`;
2. service lama delegate ke command;
3. behavior tetap sama.

### PR 3 — Extract Authorization Policy

1. pindahkan role check;
2. tambah test policy;
3. hasil error tetap kompatibel.

### PR 4 — Extract Approval Policy / Rules

1. pindahkan validation business;
2. tambah reason code;
3. jaga response compatibility dulu.

### PR 5 — Introduce Domain Method for Transition

1. tambah `CaseStatus` enum;
2. tambah `approve()` di entity/domain model;
3. pindahkan mutation.

### PR 6 — Introduce Gateway for Profile API

1. buat internal `PartyProfile`;
2. buat mapper;
3. ganti direct client usage.

### PR 7 — Normalize Errors

1. tambah error taxonomy;
2. tambah mapper API;
3. jaga status code yang sudah dipakai client.

### PR 8 — Structured Audit

1. tambah `AuditEvent`;
2. simpan structured field;
3. pertahankan legacy audit text jika perlu backward compatibility.

### PR 9 — Outbox

1. simpan event ke outbox;
2. worker publish;
3. monitor pending/failure.

### PR 10 — Move Email/PDF to Event Handlers

1. tambah handler async;
2. buat idempotency;
3. expose delivery/document status.

---

## 27. Design Review Checklist

Gunakan checklist ini saat review hasil refactoring.

### Responsibility

```text
[ ] Apakah use case handler hanya orchestration?
[ ] Apakah domain invariant berada dekat dengan domain model?
[ ] Apakah business rule bisa diuji terpisah?
[ ] Apakah authorization tidak tersebar?
[ ] Apakah external API tidak bocor ke domain?
```

### Transaction

```text
[ ] Apakah transaction boundary jelas?
[ ] Apakah external call tidak dilakukan sembarangan di dalam transaction panjang?
[ ] Apakah event publishing tidak dual-write?
[ ] Apakah side effect setelah commit retryable?
```

### Error

```text
[ ] Apakah error code stabil?
[ ] Apakah retryable/non-retryable dibedakan?
[ ] Apakah invalid transition menjadi conflict, bukan generic 500?
[ ] Apakah validation error bisa aggregate?
```

### Audit/Observability

```text
[ ] Apakah audit structured?
[ ] Apakah audit punya actor/action/resource/time?
[ ] Apakah before/after status terekam?
[ ] Apakah correlation ID terbawa ke audit/event/log?
[ ] Apakah rejection reason bisa dilihat di log/metric?
```

### Security

```text
[ ] Apakah authorization dilakukan sebelum mutation?
[ ] Apakah object-level authorization dicek?
[ ] Apakah role string tidak tersebar?
[ ] Apakah event/audit tidak bocor data sensitif?
```

### Evolution

```text
[ ] Jika approval rule baru ditambah, area mana yang berubah?
[ ] Jika external profile API berubah, domain ikut berubah atau tidak?
[ ] Jika notification channel berubah, approval use case ikut berubah atau tidak?
[ ] Jika workflow state baru ditambah, transition graph terlihat jelas atau tidak?
```

---

## 28. Common Staff-Level Discussion

### 28.1 “Bukankah terlalu banyak class?”

Bisa jadi iya, jika domain sederhana.

Tetapi di domain dengan regulatory lifecycle, audit, side effect, authorization, dan integration, class tambahan bukan otomatis overengineering. Class tambahan berguna jika masing-masing mewakili decision boundary yang nyata.

Pertanyaan yang lebih baik:

```text
Apakah class ini mengurangi coupling atau hanya memindahkan kode?
Apakah class ini punya alasan berubah sendiri?
Apakah class ini membuat invariant lebih jelas?
Apakah class ini membuat testing lebih mudah?
```

### 28.2 “Kenapa tidak tetap satu service saja?”

Satu service bisa diterima jika:

1. rule sederhana;
2. lifecycle pendek;
3. side effect minimal;
4. audit tidak critical;
5. change frequency rendah.

Tetapi saat use case menjadi pusat banyak perubahan, satu service besar menjadi bottleneck dan risk amplifier.

### 28.3 “Kenapa email/document lewat event? Bukankah user ingin langsung selesai?”

Karena approval state dan delivery side effect punya reliability model berbeda.

Approval harus konsisten dengan DB.

Email/document bisa retry, delay, atau gagal terpisah.

Jika business butuh synchronous document generation sebelum approval dianggap sukses, maka jadikan itu explicit requirement, bukan kebetulan karena kode lama melakukannya dalam satu method.

### 28.4 “Kenapa pakai outbox?”

Karena DB commit dan broker publish bukan satu atomic transaction.

Tanpa outbox, ada risiko:

```text
DB committed, event failed
```

atau:

```text
event published, DB rolled back
```

Outbox membuat event menjadi bagian dari DB transaction, lalu publishing dilakukan reliable secara terpisah.

### 28.5 “Apakah ini Clean Architecture?”

Lebih penting daripada label adalah dependency direction.

Jika domain bebas dari framework/external API/persistence detail, dan adapter bergantung ke port/domain, maka desain sudah bergerak ke arah boundary yang sehat.

---

## 29. Anti-Pattern yang Dihilangkan

### 29.1 God Service

Dihilangkan dengan handler + policy + rule + gateway + outbox.

### 29.2 Stringly Typed Status and Event

Dihilangkan dengan enum/typed event.

### 29.3 Role Check Scattering

Dihilangkan dengan authorization policy.

### 29.4 External Model Infection

Dihilangkan dengan gateway/ACL.

### 29.5 Dual Write

Dihilangkan dengan outbox.

### 29.6 Audit as Log String

Dihilangkan dengan structured audit event.

### 29.7 Exception Soup

Dihilangkan dengan error taxonomy.

### 29.8 Boolean Parameter API

Dihilangkan dengan command/options object.

### 29.9 Hidden Side Effect

Dihilangkan dengan explicit outbox event dan event handler.

---

## 30. Final Mental Model

Refactoring enterprise module bukan proses memasang pattern satu per satu.

Refactoring yang matang dimulai dari pertanyaan:

```text
Apa decision yang sedang disembunyikan?
Apa invariant yang belum punya owner?
Apa side effect yang tidak punya reliability boundary?
Apa external detail yang merembes ke domain?
Apa rule yang sulit dijelaskan?
Apa error yang tidak punya semantics?
Apa audit yang tidak defensible?
Apa coupling yang membuat perubahan kecil menjadi risiko besar?
```

Pattern hanya alat untuk menjawab force tersebut.

Dalam case study ini:

```text
Command Object            -> membuat intent eksplisit
Command Handler           -> membuat use case boundary jelas
Policy Object             -> mengisolasi authorization decision
Rule/Specification        -> membuat business rule testable dan explainable
State Transition          -> menjaga lifecycle invariant
Gateway/ACL               -> melindungi domain dari external semantics
Error Taxonomy            -> membuat failure contract jelas
Audit Event               -> membuat regulatory trace defensible
Outbox                    -> membuat integration event durable
Event Handler             -> mengisolasi side effect async/retryable
Package Boundary          -> menjaga dependency direction
```

Seorang engineer top tidak bertanya:

```text
Pattern apa yang bisa saya pakai di sini?
```

Ia bertanya:

```text
Force apa yang sedang bekerja?
Apa risiko jika desain dibiarkan seperti ini?
Boundary mana yang harus dibuat eksplisit?
Pattern apa yang paling murah untuk mengendalikan risiko itu?
```

---

## 31. Summary

Pada bagian ini, kita membedah satu modul enterprise Java yang awalnya memiliki:

1. god service;
2. scattered validation;
3. duplicated authorization;
4. transaction confusion;
5. external API leakage;
6. event side effects;
7. weak error semantics;
8. non-defensible audit.

Kemudian kita refactor secara incremental menggunakan:

1. characterization test;
2. command object;
3. command handler/application service;
4. authorization policy;
5. approval rule/specification;
6. state transition/domain method;
7. gateway/anti-corruption layer;
8. error taxonomy;
9. audit event pattern;
10. outbox pattern;
11. async event handler;
12. modular package boundary.

Hasil akhirnya bukan sekadar kode lebih “rapi”. Hasil akhirnya adalah sistem yang lebih bisa dijelaskan, diuji, diaudit, diobservasi, dan dievolusi.

---

## 32. Latihan Mandiri

Ambil satu service method besar dari codebase nyata atau project latihan.

Petakan:

```text
[ ] input validation
[ ] authorization
[ ] domain decision
[ ] workflow transition
[ ] persistence
[ ] external call
[ ] side effect
[ ] audit
[ ] event
[ ] error mapping
```

Lalu jawab:

1. Responsibility mana yang sebenarnya punya alasan berubah sendiri?
2. Invariant mana yang belum punya owner?
3. Side effect mana yang tidak boleh terjadi sebelum commit?
4. External model mana yang bocor ke domain?
5. Error mana yang masih generic?
6. Audit mana yang tidak machine-readable?
7. Pattern apa yang paling murah untuk memperbaiki satu masalah paling berisiko?

Jangan refactor semua sekaligus. Pilih satu seam, tambahkan test, lalu ubah secara incremental.

---

## 33. Status Seri

```text
Part 34 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
35-top-1-percent-pattern-mastery-engineering-judgment.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./33-pattern-selection-heuristics-decision-matrix.md">⬅️ Pattern Selection Heuristics: Decision Matrix for Senior Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./35-top-1-percent-pattern-mastery-engineering-judgment.md">Top 1% Engineer Pattern Mastery: Taste, Judgment, and System Evolution ➡️</a>
</div>

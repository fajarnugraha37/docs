# learn-java-validation-jakarta-hibernate-validator-part-030

# Capstone: Designing a Production-Grade Validation Framework for a Case Management Platform

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `030`  
> Topik: Capstone / end-to-end validation architecture  
> Target: Java 8 sampai Java 25, `javax.validation`, `jakarta.validation`, Hibernate Validator, REST API, persistence, workflow, event-driven system, observability, auditability, dan regulatory-grade case management.

---

## 0. Tujuan Part Ini

Part ini adalah capstone. Semua konsep dari part sebelumnya disatukan menjadi satu rancangan utuh: bagaimana membangun validation framework yang bukan hanya benar secara teknis, tetapi juga:

1. konsisten antar layer,
2. aman untuk sistem besar,
3. mudah diobservasi,
4. bisa diaudit,
5. tidak mencampuradukkan validation dengan authorization/workflow/database,
6. kompatibel untuk evolusi API dan migration `javax.validation` ke `jakarta.validation`,
7. cukup eksplisit untuk case management atau regulatory system yang membutuhkan defensibility.

Kita akan memakai contoh domain case management, tetapi pola ini berlaku untuk banyak sistem enterprise:

- application submission,
- licensing,
- appeal,
- compliance case,
- enforcement action,
- investigation,
- approval workflow,
- maker-checker process,
- document review,
- scheduled enforcement deadline,
- external integration/event ingestion.

Inti dari part ini:

> Validation framework yang mature bukan kumpulan annotation. Ia adalah sistem kontrak yang menjelaskan apa yang boleh masuk, apa yang boleh berubah, siapa yang boleh melakukan aksi, kapan state boleh berpindah, bagaimana error dikomunikasikan, bagaimana rule berubah, dan bagaimana keputusan bisa dipertanggungjawabkan.

---

## 1. Prinsip Besar: Validation Bukan Satu Layer

Dalam sistem kecil, validation sering dianggap cukup dengan ini:

```java
public record SubmitApplicationRequest(
        @NotBlank String applicantName,
        @Email String email,
        @NotNull ApplicationType type
) {}
```

Itu benar, tetapi hanya sebagian kecil.

Dalam sistem case management production-grade, validasi tersebar secara konseptual ke beberapa layer. Namun “tersebar” tidak boleh berarti kacau. Ia harus memiliki boundary yang jelas.

### 1.1 Layer Validation yang Ideal

```text
Client / FE
  |
  |  1. UX validation / client-side guidance
  v
REST / Transport Boundary
  |
  |  2. DTO shape validation: Jakarta Validation
  v
Normalization / Canonicalization
  |
  |  3. normalize whitespace, casing, identifier format, etc.
  v
Command Construction
  |
  |  4. command invariant: operation-specific requiredness
  v
Application Service / Use Case
  |
  |  5. contextual validation: reference, ownership, business context
  v
Domain Model / Aggregate
  |
  |  6. domain invariant: always true inside aggregate
  v
Workflow / State Machine
  |
  |  7. transition guard: state/action/actor/time/document completeness
  v
Persistence Boundary
  |
  |  8. DB constraint: final consistency under concurrency
  v
Outbox / Event / Integration
  |
  |  9. outbound contract validation and versioning
  v
Observability / Audit / Governance
     10. rule id, error code, metrics, audit, rollout
```

Masing-masing layer menjawab pertanyaan berbeda.

| Layer | Pertanyaan | Contoh |
|---|---|---|
| DTO validation | Bentuk input valid? | `email` tidak kosong dan format email masuk akal |
| Command validation | Operasi ini punya data minimum? | Submit butuh `declarationAccepted=true` |
| Domain invariant | Object ini masuk akal secara domain? | `approvalDate` tidak boleh sebelum `submissionDate` |
| Workflow guard | Aksi ini boleh terjadi pada state ini? | Case `DRAFT` boleh submit; case `APPROVED` tidak boleh submit ulang |
| Authorization policy | Actor boleh melakukan aksi? | Maker tidak boleh approve case yang ia buat sendiri |
| Cross-entity rule | Konsisten dengan data lain? | Applicant tidak sedang suspended |
| DB constraint | Tetap benar saat race condition? | Unique active licence number |
| Event validation | Event contract valid? | Outbound `CaseSubmitted` memiliki schema version dan correlation id |
| Observability | Bisa dipantau dan diaudit? | Rule `SUBMIT_004` menolak 200 request/hari |

### 1.2 Kesalahan Fatal: Semua Rule Dipaksa Masuk Annotation

Annotation bagus untuk rule lokal, stabil, dan dekat dengan struktur data.

Annotation buruk untuk rule yang butuh:

- actor,
- time window,
- current workflow state,
- database snapshot,
- external service,
- concurrency decision,
- rule versioning,
- non-blocking warning,
- audit evidence,
- feature flag,
- tenant-specific policy,
- jurisdiction-specific policy.

Contoh buruk:

```java
@CanSubmitApplication
public class SubmitApplicationRequest {
    ...
}
```

Masalahnya: “can submit” tidak hanya tergantung field request. Ia tergantung state case, role user, deadline, outstanding document, duplicate submission, pending appeal, maybe external registry, dan policy version. Ini bukan DTO validation. Ini workflow/application policy.

---

## 2. Target Architecture

Kita akan membangun framework dengan komponen berikut:

```text
validation/
  api/
    ApiViolation.java
    ApiValidationError.java
    ProblemDetailFactory.java
    ViolationPathNormalizer.java
    RejectedValueSanitizer.java

  bean/
    ValidatorProvider.java
    BeanValidationService.java
    ValidationGroupRegistry.java

  command/
    CommandValidator.java
    CommandValidationResult.java
    CommandViolation.java

  domain/
    DomainRule.java
    DomainRuleResult.java
    RuleViolation.java
    RuleSeverity.java
    RuleDecision.java
    RuleEvidence.java

  workflow/
    WorkflowGuard.java
    TransitionPolicy.java
    TransitionDecision.java
    TransitionViolation.java

  catalog/
    RuleCatalog.java
    RuleDefinition.java
    RuleVersion.java
    RuleOwner.java
    RuleEnforcementMode.java

  persistence/
    DbConstraintTranslator.java
    PersistenceViolationMapper.java

  event/
    EventValidationService.java
    EventRejection.java
    EventRejectionClassifier.java

  observability/
    ValidationMetrics.java
    ValidationAuditWriter.java
    ValidationLogSanitizer.java
```

Ini bukan berarti semua project harus punya package persis seperti ini. Yang penting adalah separation of responsibility.

---

## 3. Domain Contoh: Regulatory Case Management

Kita pakai contoh sederhana tetapi realistis.

### 3.1 Core Entities

```text
Application
  - id
  - referenceNo
  - applicant
  - type
  - status
  - submittedAt
  - assignedOfficerId
  - documents
  - declarations
  - riskScore
  - decision
  - version

Applicant
  - id
  - name
  - identifier
  - email
  - mobileNo
  - status

Document
  - id
  - documentType
  - fileId
  - uploadedAt
  - verificationStatus

Decision
  - outcome
  - reasonCodes
  - decidedBy
  - decidedAt
```

### 3.2 Workflow State

```text
DRAFT
  -> SUBMITTED
  -> UNDER_REVIEW
  -> PENDING_CLARIFICATION
  -> UNDER_REVIEW
  -> APPROVED
  -> REJECTED
  -> APPEALED
  -> CLOSED
```

### 3.3 Actions

```text
SAVE_DRAFT
SUBMIT
ASSIGN_OFFICER
REQUEST_CLARIFICATION
RESPOND_CLARIFICATION
RECOMMEND_APPROVAL
RECOMMEND_REJECTION
APPROVE
REJECT
LODGE_APPEAL
CLOSE
```

### 3.4 Validation Questions

Untuk action `SUBMIT`, sistem perlu menjawab:

1. Apakah request JSON syntactically valid?
2. Apakah DTO memiliki required fields?
3. Apakah applicant identifier valid secara format?
4. Apakah mandatory document sudah ada?
5. Apakah case masih di state `DRAFT`?
6. Apakah actor adalah pemilik draft atau authorized agent?
7. Apakah applicant tidak sedang suspended?
8. Apakah tidak ada duplicate active application?
9. Apakah declaration sudah disetujui?
10. Apakah submit masih dalam allowed application window?
11. Apakah database tetap konsisten saat dua submit bersamaan?
12. Apakah event `ApplicationSubmitted` valid sebelum dipublish?
13. Apakah rejection/warning punya rule id dan audit evidence?

Tidak ada satu annotation yang seharusnya memikul semua itu.

---

## 4. Layer 1: Transport DTO Validation

Transport DTO validation adalah validasi bentuk request.

### 4.1 DTO Create/Submit Request

Untuk Java 17+:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record SubmitApplicationRequest(
        @NotBlank(message = "{application.applicantName.required}")
        @Size(max = 200, message = "{application.applicantName.tooLong}")
        String applicantName,

        @NotBlank(message = "{application.applicantIdentifier.required}")
        @Size(max = 50, message = "{application.applicantIdentifier.tooLong}")
        String applicantIdentifier,

        @NotBlank(message = "{application.email.required}")
        @Email(message = "{application.email.invalid}")
        @Size(max = 320, message = "{application.email.tooLong}")
        String email,

        @NotNull(message = "{application.type.required}")
        ApplicationType applicationType,

        @NotEmpty(message = "{application.documents.required}")
        List<@Valid SubmitDocumentRequest> documents,

        @AssertTrue(message = "{application.declaration.mustBeAccepted}")
        boolean declarationAccepted
) {}
```

```java
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SubmitDocumentRequest(
        @NotNull(message = "{document.type.required}")
        DocumentType documentType,

        @NotBlank(message = "{document.fileId.required}")
        @Size(max = 100, message = "{document.fileId.tooLong}")
        String fileId
) {}
```

Untuk Java 8 legacy:

```java
import javax.validation.Valid;
import javax.validation.constraints.AssertTrue;
import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import java.util.List;

public class SubmitApplicationRequest {

    @NotBlank(message = "{application.applicantName.required}")
    @Size(max = 200, message = "{application.applicantName.tooLong}")
    private String applicantName;

    @NotBlank(message = "{application.applicantIdentifier.required}")
    @Size(max = 50, message = "{application.applicantIdentifier.tooLong}")
    private String applicantIdentifier;

    @NotBlank(message = "{application.email.required}")
    @Email(message = "{application.email.invalid}")
    @Size(max = 320, message = "{application.email.tooLong}")
    private String email;

    @NotNull(message = "{application.type.required}")
    private ApplicationType applicationType;

    @NotEmpty(message = "{application.documents.required}")
    private List<@Valid SubmitDocumentRequest> documents;

    @AssertTrue(message = "{application.declaration.mustBeAccepted}")
    private boolean declarationAccepted;

    // getters/setters omitted
}
```

### 4.2 Apa yang Boleh Ada di DTO Validation

DTO validation cocok untuk:

- requiredness yang benar-benar berlaku untuk endpoint itu,
- size limit,
- simple format,
- simple enum presence,
- nested request shape,
- collection size,
- field-level constraints,
- simple class-level consistency.

DTO validation tidak cocok untuk:

- applicant suspended check,
- duplicate application check,
- actor boleh submit atau tidak,
- state transition validity,
- approval authority,
- DB uniqueness,
- external registry status,
- rule yang butuh current date dengan complex calendar,
- warning/non-blocking rule.

---

## 5. Layer 2: Normalization and Canonicalization

Validation harus jelas urutannya terhadap normalization.

### 5.1 Normalization Contoh

```java
public final class SubmitApplicationNormalizer {

    public NormalizedSubmitApplication normalize(SubmitApplicationRequest request) {
        return new NormalizedSubmitApplication(
                trimToNull(request.applicantName()),
                normalizeIdentifier(request.applicantIdentifier()),
                lowerTrim(request.email()),
                request.applicationType(),
                request.documents(),
                request.declarationAccepted()
        );
    }

    private String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private String lowerTrim(String value) {
        if (value == null) return null;
        return value.trim().toLowerCase(java.util.Locale.ROOT);
    }

    private String normalizeIdentifier(String value) {
        if (value == null) return null;
        return value.trim().replace("-", "").toUpperCase(java.util.Locale.ROOT);
    }
}
```

### 5.2 Urutan: Normalize Dulu atau Validate Dulu?

Tidak ada jawaban universal. Ada dua model.

#### Model A: Validate Raw Input Dulu

Cocok jika:

- ingin mendeteksi input persis seperti dikirim client,
- tidak ingin silently memperbaiki data,
- perlu audit raw invalid input,
- strict public API.

#### Model B: Normalize Dulu, Lalu Validate Canonical Value

Cocok jika:

- trimming whitespace dianggap user-friendly,
- email casing ingin distabilkan,
- identifier punya format canonical,
- UI/API client historis mengirim format bervariasi.

#### Practical Recommendation

Untuk enterprise API:

```text
1. Parse/deserialization validation: JSON valid, type valid.
2. Minimal raw safety validation: max payload, max field length, no control chars when needed.
3. Normalize/canonicalize safe fields.
4. Jakarta Validation on normalized DTO/command.
5. Domain/workflow/policy validation.
```

Jangan normalize sesuatu yang mengubah makna legal/regulatory tanpa rule eksplisit.

---

## 6. Layer 3: API Error Contract

Top-tier validation framework wajib menghasilkan error contract yang stabil.

### 6.1 Problem Details Envelope

RFC 9457 mendefinisikan format “problem detail” untuk membawa detail error machine-readable pada HTTP API. Ia menggantikan RFC 7807.

Contoh response:

```json
{
  "type": "https://api.example.gov/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request contains invalid fields.",
  "instance": "/applications/submit",
  "correlationId": "01HRX7V7KQ2P2N9W3F0G6X6N8B",
  "violations": [
    {
      "code": "APPLICATION_EMAIL_INVALID",
      "ruleId": "APP_SUBMIT_003",
      "field": "email",
      "message": "Email address is invalid.",
      "severity": "ERROR",
      "rejectedValuePresent": true
    },
    {
      "code": "APPLICATION_DOCUMENT_REQUIRED",
      "ruleId": "APP_SUBMIT_010",
      "field": "documents",
      "message": "At least one supporting document is required.",
      "severity": "ERROR",
      "rejectedValuePresent": false
    }
  ]
}
```

### 6.2 Internal Violation Model

```java
public record ApiViolation(
        String code,
        String ruleId,
        String ruleVersion,
        String field,
        String message,
        Severity severity,
        boolean rejectedValuePresent,
        Object safeRejectedValue,
        Map<String, Object> attributes
) {}
```

```java
public enum Severity {
    INFO,
    WARNING,
    ERROR,
    FATAL
}
```

### 6.3 Mapping ConstraintViolation ke ApiViolation

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.metadata.ConstraintDescriptor;

import java.util.Map;

public final class ConstraintViolationMapper {

    private final ViolationPathNormalizer pathNormalizer;
    private final RejectedValueSanitizer rejectedValueSanitizer;
    private final ConstraintCodeResolver codeResolver;

    public ConstraintViolationMapper(
            ViolationPathNormalizer pathNormalizer,
            RejectedValueSanitizer rejectedValueSanitizer,
            ConstraintCodeResolver codeResolver
    ) {
        this.pathNormalizer = pathNormalizer;
        this.rejectedValueSanitizer = rejectedValueSanitizer;
        this.codeResolver = codeResolver;
    }

    public ApiViolation map(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();
        Map<String, Object> attributes = descriptor.getAttributes();

        return new ApiViolation(
                codeResolver.resolve(violation),
                resolveRuleId(descriptor),
                resolveRuleVersion(descriptor),
                pathNormalizer.normalize(violation.getPropertyPath()),
                violation.getMessage(),
                resolveSeverity(descriptor),
                violation.getInvalidValue() != null,
                rejectedValueSanitizer.sanitize(
                        violation.getPropertyPath(),
                        violation.getInvalidValue()
                ),
                safeAttributes(attributes)
        );
    }

    private String resolveRuleId(ConstraintDescriptor<?> descriptor) {
        Object ruleId = descriptor.getAttributes().get("ruleId");
        return ruleId == null ? null : String.valueOf(ruleId);
    }

    private String resolveRuleVersion(ConstraintDescriptor<?> descriptor) {
        Object version = descriptor.getAttributes().get("ruleVersion");
        return version == null ? null : String.valueOf(version);
    }

    private Severity resolveSeverity(ConstraintDescriptor<?> descriptor) {
        // Could inspect payload classes or custom attributes.
        return Severity.ERROR;
    }

    private Map<String, Object> safeAttributes(Map<String, Object> attributes) {
        // Remove message/groups/payload and any sensitive custom attribute.
        return Map.of();
    }
}
```

### 6.4 Jangan Parse Human Message

Buruk:

```java
if (violation.getMessage().contains("must not be null")) {
    code = "REQUIRED";
}
```

Baik:

- code berasal dari constraint metadata,
- custom annotation attribute,
- mapping table,
- rule catalog,
- payload marker,
- endpoint-specific resolver.

Human message boleh berubah karena i18n. Error code tidak boleh berubah sembarangan.

---

## 7. Layer 4: Command Object

DTO adalah bentuk transport. Command adalah intensi use case.

### 7.1 Command

```java
public record SubmitApplicationCommand(
        Actor actor,
        ApplicationId applicationId,
        ApplicantSnapshot applicant,
        ApplicationType applicationType,
        List<SubmittedDocument> documents,
        boolean declarationAccepted,
        Instant requestedAt,
        String correlationId
) {}
```

Command biasanya tidak langsung diberi banyak Jakarta Validation annotation. Command adalah model use case internal, dan sering divalidasi lewat command validator/policy.

### 7.2 Kenapa Command Perlu Terpisah dari DTO

DTO bicara bahasa API:

```text
field, json, request body, query param, path param
```

Command bicara bahasa use case:

```text
actor wants to submit application X at time T using applicant snapshot S
```

Keuntungan:

- API v1/v2 bisa map ke command yang sama,
- command bisa dipakai dari REST, batch, scheduler, dan event,
- validation lebih dekat dengan use case,
- audit lebih mudah,
- rule tidak bocor ke transport layer.

---

## 8. Layer 5: Domain Rule Result Model

Jakarta Validation menghasilkan `ConstraintViolation`. Domain/workflow rule sebaiknya menghasilkan result yang lebih kaya.

### 8.1 Rule Result

```java
public record RuleViolation(
        String ruleId,
        String ruleVersion,
        String code,
        String messageKey,
        Severity severity,
        EnforcementMode enforcementMode,
        String target,
        Map<String, Object> safeEvidence,
        String remediationKey
) {}
```

```java
public enum EnforcementMode {
    OBSERVE_ONLY,
    WARNING,
    BLOCKING
}
```

```java
public enum RuleDecision {
    ALLOW,
    ALLOW_WITH_WARNINGS,
    DENY
}
```

```java
public record RuleEvaluationResult(
        RuleDecision decision,
        List<RuleViolation> violations
) {
    public boolean isAllowed() {
        return decision == RuleDecision.ALLOW || decision == RuleDecision.ALLOW_WITH_WARNINGS;
    }
}
```

### 8.2 Why Rich Result Matters

Untuk case management, “invalid” saja tidak cukup. Kita butuh:

- rule mana yang gagal,
- versi rule,
- apakah blocking atau warning,
- evidence apa yang dipakai,
- apakah evidence aman disimpan,
- siapa owner rule,
- kapan rule mulai enforced,
- bagaimana user memperbaiki,
- apakah bisa override,
- apakah perlu audit.

---

## 9. Layer 6: Rule Catalog

Rule catalog adalah pusat governance.

### 9.1 Rule Definition

```java
public record RuleDefinition(
        String ruleId,
        String version,
        String code,
        String name,
        String description,
        String owner,
        Severity severity,
        EnforcementMode enforcementMode,
        Instant effectiveFrom,
        Instant effectiveTo,
        boolean auditRequired
) {}
```

### 9.2 Example Rule Catalog

| Rule ID | Code | Description | Layer | Mode |
|---|---|---|---|---|
| `APP_DTO_001` | `APPLICATION_EMAIL_INVALID` | Email format invalid | DTO | BLOCKING |
| `APP_SUBMIT_001` | `APPLICATION_NOT_DRAFT` | Only draft application can be submitted | Workflow | BLOCKING |
| `APP_SUBMIT_002` | `APPLICATION_DECLARATION_REQUIRED` | Declaration must be accepted | Command | BLOCKING |
| `APP_SUBMIT_003` | `APPLICANT_SUSPENDED` | Suspended applicant cannot submit | Domain Policy | BLOCKING |
| `APP_SUBMIT_004` | `MANDATORY_DOCUMENT_MISSING` | Mandatory document missing | Domain Policy | BLOCKING |
| `APP_SUBMIT_005` | `DUPLICATE_ACTIVE_APPLICATION` | Duplicate active application exists | Cross-Entity | BLOCKING |
| `APP_SUBMIT_006` | `SUBMISSION_WINDOW_CLOSED` | Submission outside allowed period | Temporal Policy | BLOCKING |
| `APP_SUBMIT_007` | `RISK_SCORE_HIGH` | High risk application requires manual review | Policy | WARNING |
| `APP_DB_001` | `UNIQUE_REFERENCE_CONFLICT` | Duplicate reference at database level | Persistence | BLOCKING |
| `APP_EVT_001` | `OUTBOUND_EVENT_INVALID` | Outbound event violates contract | Event | BLOCKING |

### 9.3 Catalog Storage Options

| Option | Strength | Risk |
|---|---|---|
| Java enum/static class | simple, compile-time safety | deploy required for changes |
| YAML/JSON config | easier review/diff | runtime consistency risk |
| DB table | operational flexibility | governance complexity |
| Policy service | centralized | network dependency, availability |
| Hybrid | balanced | more moving parts |

Recommendation untuk kebanyakan sistem enterprise:

```text
Start with versioned code-backed rule catalog.
Add external config only for enforcement mode, effective date, and message text.
Avoid arbitrary runtime logic unless governance is mature.
```

---

## 10. Layer 7: Workflow Guard

Workflow guard menentukan apakah action boleh dilakukan dari state tertentu dengan context tertentu.

### 10.1 Transition Policy Interface

```java
public interface TransitionPolicy<C> {
    RuleEvaluationResult evaluate(C context);
}
```

```java
public record SubmitApplicationContext(
        Actor actor,
        Application application,
        ApplicantSnapshot applicant,
        Instant now,
        List<Document> documents,
        SubmissionWindow submissionWindow,
        DuplicateApplicationSnapshot duplicateSnapshot
) {}
```

### 10.2 Submit Policy

```java
public final class SubmitApplicationPolicy
        implements TransitionPolicy<SubmitApplicationContext> {

    private final List<DomainRule<SubmitApplicationContext>> rules;

    public SubmitApplicationPolicy(List<DomainRule<SubmitApplicationContext>> rules) {
        this.rules = List.copyOf(rules);
    }

    @Override
    public RuleEvaluationResult evaluate(SubmitApplicationContext context) {
        List<RuleViolation> violations = new ArrayList<>();

        for (DomainRule<SubmitApplicationContext> rule : rules) {
            rule.evaluate(context).ifPresent(violations::add);
        }

        boolean hasBlocking = violations.stream()
                .anyMatch(v -> v.enforcementMode() == EnforcementMode.BLOCKING);
        boolean hasWarning = violations.stream()
                .anyMatch(v -> v.enforcementMode() == EnforcementMode.WARNING);

        RuleDecision decision = hasBlocking
                ? RuleDecision.DENY
                : hasWarning ? RuleDecision.ALLOW_WITH_WARNINGS : RuleDecision.ALLOW;

        return new RuleEvaluationResult(decision, violations);
    }
}
```

### 10.3 Example Rules

```java
public interface DomainRule<C> {
    Optional<RuleViolation> evaluate(C context);
}
```

```java
public final class ApplicationMustBeDraftRule
        implements DomainRule<SubmitApplicationContext> {

    @Override
    public Optional<RuleViolation> evaluate(SubmitApplicationContext context) {
        if (context.application().status() == ApplicationStatus.DRAFT) {
            return Optional.empty();
        }

        return Optional.of(new RuleViolation(
                "APP_SUBMIT_001",
                "1.0.0",
                "APPLICATION_NOT_DRAFT",
                "application.submit.notDraft",
                Severity.ERROR,
                EnforcementMode.BLOCKING,
                "application.status",
                Map.of("currentStatus", context.application().status().name()),
                "application.submit.remediation.returnToDraftNotAllowed"
        ));
    }
}
```

```java
public final class ApplicantMustNotBeSuspendedRule
        implements DomainRule<SubmitApplicationContext> {

    @Override
    public Optional<RuleViolation> evaluate(SubmitApplicationContext context) {
        if (!context.applicant().isSuspended()) {
            return Optional.empty();
        }

        return Optional.of(new RuleViolation(
                "APP_SUBMIT_003",
                "1.0.0",
                "APPLICANT_SUSPENDED",
                "application.submit.applicantSuspended",
                Severity.ERROR,
                EnforcementMode.BLOCKING,
                "applicant",
                Map.of("applicantStatus", context.applicant().statusCode()),
                "application.submit.remediation.contactAgency"
        ));
    }
}
```

### 10.4 Why Not Validation Groups?

Buruk:

```java
validator.validate(request, SubmitGroup.class);
```

Lalu `SubmitGroup` memicu semua rule submit, termasuk state, actor, database, dan deadline.

Masalah:

- actor tidak terlihat,
- state tidak terlihat,
- external dependency tersembunyi,
- audit sulit,
- rule ordering sulit,
- non-blocking warning sulit,
- concurrency sulit,
- test readability buruk.

Validation group cocok untuk shape berbeda per operation. Workflow guard cocok untuk action decision.

---

## 11. Layer 8: Application Service Flow

Application service mengorkestrasi semua layer.

```java
public final class SubmitApplicationUseCase {

    private final BeanValidationService beanValidationService;
    private final SubmitApplicationMapper mapper;
    private final ApplicationRepository applicationRepository;
    private final ApplicantReadService applicantReadService;
    private final DocumentReadService documentReadService;
    private final DuplicateApplicationChecker duplicateApplicationChecker;
    private final SubmissionWindowService submissionWindowService;
    private final SubmitApplicationPolicy submitPolicy;
    private final ApplicationEventPublisher eventPublisher;
    private final ValidationAuditWriter auditWriter;

    public SubmitApplicationResult submit(SubmitApplicationRequest request, Actor actor) {
        // 1. DTO shape validation
        BeanValidationResult dtoResult = beanValidationService.validate(request);
        if (!dtoResult.isValid()) {
            return SubmitApplicationResult.invalid(dtoResult.toApiViolations());
        }

        // 2. Map to command / load state
        SubmitApplicationCommand command = mapper.toCommand(request, actor);

        Application application = applicationRepository.findByIdForUpdate(command.applicationId())
                .orElseThrow(() -> new ApplicationNotFoundException(command.applicationId()));

        ApplicantSnapshot applicant = applicantReadService.getSnapshot(application.applicantId());
        List<Document> documents = documentReadService.findByApplicationId(application.id());
        DuplicateApplicationSnapshot duplicateSnapshot = duplicateApplicationChecker.check(application);
        SubmissionWindow window = submissionWindowService.currentWindow(application.type());

        // 3. Workflow/domain policy validation
        SubmitApplicationContext context = new SubmitApplicationContext(
                actor,
                application,
                applicant,
                command.requestedAt(),
                documents,
                window,
                duplicateSnapshot
        );

        RuleEvaluationResult policyResult = submitPolicy.evaluate(context);
        auditWriter.writePolicyEvaluation("SUBMIT", application.id(), actor, policyResult);

        if (!policyResult.isAllowed()) {
            return SubmitApplicationResult.denied(policyResult.violations());
        }

        // 4. State mutation through aggregate method
        application.submit(actor.id(), command.requestedAt());

        // 5. Persistence; DB constraints remain final guard
        try {
            applicationRepository.save(application);
        } catch (DatabaseConstraintViolationException ex) {
            return SubmitApplicationResult.conflict(mapDbConstraint(ex));
        }

        // 6. Event contract validation before publish
        ApplicationSubmittedEvent event = ApplicationSubmittedEvent.from(application);
        eventPublisher.publish(event);

        return SubmitApplicationResult.success(application.referenceNo(), policyResult.violations());
    }
}
```

### 11.1 Important Notes

1. DTO validation happens before loading expensive data.
2. Workflow/domain policy happens after loading contextual snapshot.
3. DB constraint is still necessary because application-level checks are race-prone.
4. Audit is written for policy decision, especially denials.
5. Warning can return success with warnings.
6. Event validation happens before publish.

---

## 12. Layer 9: Domain Aggregate Invariant

Domain aggregate should protect invariants that must always hold.

```java
public final class Application {

    private ApplicationStatus status;
    private Instant submittedAt;
    private OfficerId submittedBy;
    private long version;

    public void submit(OfficerId actorId, Instant now) {
        if (status != ApplicationStatus.DRAFT) {
            throw new DomainInvariantViolationException(
                    "Application can only be submitted from DRAFT state."
            );
        }
        this.status = ApplicationStatus.SUBMITTED;
        this.submittedAt = Objects.requireNonNull(now, "now");
        this.submittedBy = Objects.requireNonNull(actorId, "actorId");
    }
}
```

Kenapa masih perlu check `status != DRAFT` padahal policy sudah cek?

Karena domain aggregate adalah final in-memory guard. Application service bisa salah, future developer bisa memanggil method langsung, race condition bisa membuat state berubah, dan invariant harus dekat dengan mutation.

Tapi domain aggregate tidak perlu tahu semua contextual policy seperti applicant suspended, mandatory document type, atau submission window. Itu policy/use-case layer.

---

## 13. Layer 10: Persistence and DB Constraint Mapping

### 13.1 DB Constraint Tetap Wajib

Aplikasi bisa mengecek duplicate application, tetapi dua request paralel tetap bisa lolos check sebelum insert/update.

Solusi final harus di database:

```sql
CREATE UNIQUE INDEX uq_active_application
ON application (applicant_id, application_type)
WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'PENDING_CLARIFICATION');
```

Untuk database yang tidak mendukung partial index, bisa pakai strategi lain seperti computed column, constraint table, atau transaction/lock strategy.

### 13.2 Translate DB Error

```java
public final class DbConstraintTranslator {

    public Optional<RuleViolation> translate(Throwable throwable) {
        String constraintName = extractConstraintName(throwable);

        if ("UQ_ACTIVE_APPLICATION".equalsIgnoreCase(constraintName)) {
            return Optional.of(new RuleViolation(
                    "APP_DB_001",
                    "1.0.0",
                    "DUPLICATE_ACTIVE_APPLICATION",
                    "application.submit.duplicateActiveApplication",
                    Severity.ERROR,
                    EnforcementMode.BLOCKING,
                    "application",
                    Map.of(),
                    "application.submit.remediation.checkExistingApplication"
            ));
        }

        return Optional.empty();
    }
}
```

### 13.3 DB Constraint Name adalah Contract Internal

Gunakan naming convention:

```text
UK_<TABLE>__<BUSINESS_MEANING>
CK_<TABLE>__<BUSINESS_MEANING>
FK_<TABLE>__<REF_TABLE>
NN_<TABLE>__<COLUMN>
```

Contoh:

```text
UK_APPLICATION__ACTIVE_BY_APPLICANT_AND_TYPE
CK_APPLICATION__SUBMITTED_AT_REQUIRED_WHEN_SUBMITTED
FK_APPLICATION__APPLICANT
```

Tanpa constraint naming, error mapping akan rapuh.

---

## 14. Layer 11: Event Validation

### 14.1 Outbound Event

```java
public record ApplicationSubmittedEvent(
        @NotBlank String eventId,
        @NotBlank String correlationId,
        @NotBlank String applicationId,
        @NotBlank String referenceNo,
        @NotNull ApplicationType applicationType,
        @NotNull Instant submittedAt,
        @NotBlank String schemaVersion
) {}
```

Before publish:

```java
public final class ValidatingEventPublisher {

    private final Validator validator;
    private final EventPublisher delegate;

    public void publish(Object event) {
        Set<ConstraintViolation<Object>> violations = validator.validate(event);
        if (!violations.isEmpty()) {
            throw new InvalidOutboundEventException(violations);
        }
        delegate.publish(event);
    }
}
```

### 14.2 Inbound Event

Inbound event validation pipeline:

```text
1. Envelope parse
2. Schema version check
3. Payload deserialization
4. Basic Jakarta Validation
5. Idempotency check
6. Reference resolution
7. Business/policy validation
8. Process or reject/DLQ
```

### 14.3 DLQ Classification

| Failure | Retry? | Destination |
|---|---:|---|
| Invalid JSON | No | DLQ / rejected event store |
| Unsupported schema version | No | DLQ with contract error |
| Missing required payload field | No | DLQ |
| Reference temporarily unavailable | Yes | retry |
| External dependency timeout | Yes | retry |
| Business rule rejection | Usually no | rejected event store |
| Duplicate event | No | idempotent ignore |

---

## 15. Layer 12: API Adapter Example

### 15.1 Spring Controller

```java
@RestController
@RequestMapping("/applications")
public class ApplicationController {

    private final SubmitApplicationUseCase submitApplicationUseCase;

    @PostMapping("/{id}/submit")
    public ResponseEntity<?> submit(
            @PathVariable String id,
            @Valid @RequestBody SubmitApplicationRequest request,
            Authentication authentication
    ) {
        Actor actor = Actor.from(authentication);
        SubmitApplicationResult result = submitApplicationUseCase.submit(request, actor);

        return switch (result.status()) {
            case SUCCESS -> ResponseEntity.ok(result.body());
            case INVALID_INPUT -> ResponseEntity.unprocessableEntity().body(result.problemDetail());
            case DENIED_BY_POLICY -> ResponseEntity.status(409).body(result.problemDetail());
            case CONFLICT -> ResponseEntity.status(409).body(result.problemDetail());
        };
    }
}
```

### 15.2 Central Exception Handler

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    private final ProblemDetailFactory problemDetailFactory;

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleInvalidBody(MethodArgumentNotValidException ex) {
        return ResponseEntity
                .unprocessableEntity()
                .body(problemDetailFactory.fromMethodArgumentNotValid(ex));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ProblemDetail> handleConstraintViolation(ConstraintViolationException ex) {
        return ResponseEntity
                .badRequest()
                .body(problemDetailFactory.fromConstraintViolations(ex.getConstraintViolations()));
    }

    @ExceptionHandler(PolicyDeniedException.class)
    public ResponseEntity<ProblemDetail> handlePolicyDenied(PolicyDeniedException ex) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(problemDetailFactory.fromRuleViolations(ex.violations()));
    }
}
```

### 15.3 JAX-RS/Jakarta REST Equivalent

```java
@Provider
public class ConstraintViolationExceptionMapper
        implements ExceptionMapper<ConstraintViolationException> {

    private final ProblemResponseFactory problemResponseFactory;

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        ProblemResponse response = problemResponseFactory.from(exception.getConstraintViolations());
        return Response.status(422)
                .entity(response)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .build();
    }
}
```

---

## 16. HTTP Status Decision Model

| Situation | Status | Reason |
|---|---:|---|
| Malformed JSON | 400 | request cannot be parsed |
| Wrong type in JSON | 400 | binding/deserialization error |
| DTO shape invalid | 422 or 400 | semantically invalid request body |
| Query/path param invalid | 400 | invalid request parameter |
| Unauthenticated | 401 | no valid identity |
| Authenticated but forbidden | 403 | actor not allowed |
| Workflow state conflict | 409 | current resource state conflicts with action |
| Duplicate active application | 409 | resource conflict |
| Business rule invalid but no state conflict | 422 | valid syntax but invalid semantics |
| DB unique constraint conflict | 409 | final consistency conflict |
| External validation dependency unavailable | 503 | dependency failure, not input invalid |

Pilih satu convention dan dokumentasikan. Konsistensi lebih penting daripada debat 400 vs 422 di setiap endpoint.

---

## 17. Validation Groups in Capstone Architecture

Validation groups tetap berguna, tetapi perannya terbatas.

### 17.1 Good Use

```java
public interface DraftSave {}
public interface Submit {}
```

```java
public class ApplicationFormRequest {

    @NotBlank(groups = Submit.class)
    private String applicantName;

    @NotBlank(groups = Submit.class)
    @Email(groups = {DraftSave.class, Submit.class})
    private String email;

    @Size(max = 100, groups = {DraftSave.class, Submit.class})
    private String remarks;
}
```

Cocok untuk:

- draft vs submit input shape,
- create vs update,
- import vs manual entry,
- internal API vs public API.

### 17.2 Bad Use

```java
validator.validate(request, OfficerApprovalGroup.class);
```

Jika `OfficerApprovalGroup` menyembunyikan:

- actor role,
- maker-checker,
- case state,
- approval limit,
- pending documents,
- SLA rule,
- conflict check,

maka group sudah menjadi workflow engine tersembunyi.

---

## 18. Custom Constraint in Capstone Architecture

Custom constraint sebaiknya dipakai untuk rule lokal yang reusable.

### 18.1 Good Custom Constraint

```java
@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, PARAMETER, RECORD_COMPONENT, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidCaseReference {
    String message() default "{caseReference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Rule ini cocok karena format case reference lokal dan pure.

### 18.2 Bad Custom Constraint

```java
@ApplicantMustBeEligibleToSubmit
private String applicantId;
```

Kalau validator memanggil database dan external registry, rule ini sebaiknya jadi domain/application policy, bukan field constraint.

---

## 19. Validation for PATCH

PATCH adalah salah satu area paling sering salah.

### 19.1 Problem

```json
{
  "email": null
}
```

Berbeda dengan:

```json
{}
```

Yang pertama berarti explicit clear/null. Yang kedua berarti field absent/no change.

### 19.2 Presence-Aware Field

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> present(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() { return present; }
    public T value() { return value; }
}
```

### 19.3 PATCH Validation Strategy

```text
1. Validate payload size and allowed fields.
2. Decode each field into PatchField.
3. Validate present fields only.
4. Validate command-level consistency.
5. Apply to aggregate through explicit methods.
6. Persist with DB constraints.
```

Do not use `@NotNull` on PATCH DTO unless null is never allowed even when present.

---

## 20. Batch Import Validation

Batch import berbeda dari REST single request.

### 20.1 Requirements

Batch validation usually needs:

- row number,
- column name,
- original value,
- normalized value,
- severity,
- error code,
- continue-on-error,
- partial success,
- reject file threshold,
- duplicate detection inside file,
- duplicate detection against DB,
- audit/report export.

### 20.2 Batch Violation Model

```java
public record BatchViolation(
        int rowNumber,
        String columnName,
        String code,
        String ruleId,
        Severity severity,
        String message,
        Object safeRejectedValue
) {}
```

### 20.3 Batch Flow

```text
1. File-level validation: type, size, encoding.
2. Header validation: expected columns.
3. Row parse.
4. Row DTO validation.
5. Row normalization.
6. Cross-row validation: duplicates inside file.
7. Cross-DB validation: existing active records.
8. Policy validation.
9. Persist valid rows or reject all depending mode.
10. Generate validation report.
```

---

## 21. Security Design

Validation framework harus abuse-resistant.

### 21.1 Mandatory Controls

- max payload size,
- max field length,
- max collection size,
- max nested depth,
- regex timeout/careful patterns,
- no DB call in annotation validator on hot path,
- no external API call in annotation validator,
- rejected value redaction,
- log forging prevention,
- safe Unicode handling,
- no PII in error message,
- no authorization decision as validation message.

### 21.2 Rejected Value Redaction

```java
public final class RejectedValueSanitizer {

    public Object sanitize(Path path, Object value) {
        String field = path == null ? "" : path.toString().toLowerCase(Locale.ROOT);

        if (value == null) return null;
        if (field.contains("password")) return "***";
        if (field.contains("token")) return "***";
        if (field.contains("email")) return maskEmail(String.valueOf(value));
        if (field.contains("identifier")) return maskIdentifier(String.valueOf(value));

        if (value instanceof String s) {
            return s.length() > 100 ? s.substring(0, 100) + "..." : s;
        }

        return null; // default deny for unknown objects
    }

    private String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) return "***";
        return email.charAt(0) + "***" + email.substring(at);
    }

    private String maskIdentifier(String identifier) {
        if (identifier.length() <= 4) return "***";
        return "***" + identifier.substring(identifier.length() - 4);
    }
}
```

---

## 22. Observability and Metrics

### 22.1 Metrics

Track:

```text
validation_requests_total{endpoint,operation,result}
validation_violations_total{code,rule_id,operation,severity}
validation_latency_seconds{operation,layer}
validation_policy_denials_total{action,state,code}
validation_warnings_total{rule_id,operation}
db_constraint_violations_total{constraint_name,mapped_code}
event_rejections_total{event_type,schema_version,reason}
```

Avoid high cardinality:

Do not tag metrics with:

- user id,
- application id,
- raw field value,
- correlation id,
- full path with arbitrary map key,
- message text.

### 22.2 Structured Log

```json
{
  "event": "validation.denied",
  "correlationId": "01HRX7...",
  "operation": "SUBMIT_APPLICATION",
  "caseId": "APP-2026-00001",
  "actorType": "OFFICER",
  "state": "DRAFT",
  "violations": [
    {
      "ruleId": "APP_SUBMIT_003",
      "code": "APPLICANT_SUSPENDED",
      "severity": "ERROR",
      "mode": "BLOCKING"
    }
  ]
}
```

No raw PII.

---

## 23. Audit Trail Design

For regulatory systems, audit is not just logging.

### 23.1 Audit Record

```java
public record ValidationAuditRecord(
        String auditId,
        String correlationId,
        String operation,
        String resourceType,
        String resourceId,
        String actorId,
        String actorRole,
        Instant evaluatedAt,
        String ruleId,
        String ruleVersion,
        String code,
        EnforcementMode enforcementMode,
        RuleDecision decision,
        Map<String, Object> safeEvidence
) {}
```

### 23.2 What to Audit

Audit blocking policy decisions when:

- workflow transition denied,
- approval rejected by maker-checker rule,
- applicant eligibility failed,
- deadline/SLA rule blocked action,
- override is used,
- rule enforcement mode changes,
- DB constraint conflict maps to business rule.

Do not audit every `@NotBlank` failure forever unless needed. Basic input errors can be metrics/log only, depending policy.

---

## 24. Rule Rollout Strategy

New validation rules can break clients. Use controlled rollout.

### 24.1 Enforcement Lifecycle

```text
DRAFT
  -> OBSERVE_ONLY
  -> WARNING
  -> BLOCKING
  -> DEPRECATED
  -> REMOVED
```

### 24.2 Observe-Only

Rule is evaluated but does not block.

Use for:

- measuring blast radius,
- understanding real data quality,
- preparing client migration,
- proving rule correctness.

### 24.3 Warning

Rule returns warning to FE/API client but still allows operation.

Use for:

- client adaptation,
- progressive tightening,
- regulatory grace period.

### 24.4 Blocking

Rule blocks operation.

Before blocking, ensure:

- rule has owner,
- error message is understandable,
- remediation exists,
- support team knows it,
- dashboard exists,
- rollback/feature flag exists,
- backward compatibility is considered.

---

## 25. Testing Strategy

### 25.1 Test Pyramid

```text
Many:
  - custom constraint unit tests
  - DTO validation tests
  - rule object tests
  - path normalization tests
  - error code resolver tests

Some:
  - REST validation integration tests
  - persistence constraint translation tests
  - workflow policy integration tests
  - event validation tests

Few:
  - end-to-end submit/approve/reject journey
  - migration regression suite
  - performance/load tests
```

### 25.2 DTO Validation Test

```java
class SubmitApplicationRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void rejectsBlankEmail() {
        SubmitApplicationRequest request = validRequestWithEmail(" ");

        Set<ConstraintViolation<SubmitApplicationRequest>> violations = validator.validate(request);

        assertThat(violations)
                .anyMatch(v -> v.getPropertyPath().toString().equals("email"));
    }
}
```

### 25.3 Rule Test

```java
class ApplicationMustBeDraftRuleTest {

    private final ApplicationMustBeDraftRule rule = new ApplicationMustBeDraftRule();

    @Test
    void allowsDraft() {
        SubmitApplicationContext context = contextWithStatus(ApplicationStatus.DRAFT);
        assertThat(rule.evaluate(context)).isEmpty();
    }

    @Test
    void rejectsSubmitted() {
        SubmitApplicationContext context = contextWithStatus(ApplicationStatus.SUBMITTED);
        Optional<RuleViolation> violation = rule.evaluate(context);

        assertThat(violation).isPresent();
        assertThat(violation.get().code()).isEqualTo("APPLICATION_NOT_DRAFT");
        assertThat(violation.get().ruleId()).isEqualTo("APP_SUBMIT_001");
    }
}
```

### 25.4 API Contract Test

Test exact shape:

```json
{
  "type": "https://api.example.gov/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "violations": [
    {
      "code": "APPLICATION_EMAIL_INVALID",
      "field": "email"
    }
  ]
}
```

API error shape is a contract. Treat changes as breaking unless versioned.

---

## 26. Performance Strategy

### 26.1 Cost Control

| Cost Source | Control |
|---|---|
| ValidatorFactory bootstrap | create once |
| metadata scanning | warm up at startup |
| graph traversal | avoid `@Valid` on large entity graph |
| regex | simple anchored patterns; avoid catastrophic backtracking |
| message interpolation | avoid heavy EL; cache where possible |
| DB calls | keep out of annotation validators |
| external service calls | policy layer with timeout/circuit breaker |
| batch validation | chunk, aggregate errors, avoid per-row factory creation |

### 26.2 Warm-up

At startup:

```java
@PostConstruct
public void warmUpValidation() {
    validator.getConstraintsForClass(SubmitApplicationRequest.class);
    validator.getConstraintsForClass(SubmitDocumentRequest.class);
    validator.getConstraintsForClass(ApplicationSubmittedEvent.class);
}
```

Do not build `ValidatorFactory` per request.

---

## 27. Migration Strategy Java 8 to 25

### 27.1 Java 8 Legacy Stack

Likely:

```text
Java 8
javax.validation
Bean Validation 2.0 / JSR 380
Hibernate Validator 6.x
Spring Boot 2.x or Jakarta EE 8 / Java EE stack
```

### 27.2 Modern Stack

Likely:

```text
Java 17/21/25
jakarta.validation
Jakarta Validation 3.0/3.1
Hibernate Validator 8.x/9.x
Spring Boot 3.x / Spring Framework 6/7 / Jakarta EE 10/11
```

### 27.3 Migration Rule

Do not mix `javax.validation` and `jakarta.validation` in one model expecting same provider to validate both.

Migration should cover:

- imports,
- dependencies,
- generated code,
- custom constraints,
- XML config,
- message bundles,
- framework integration,
- exception handling,
- tests,
- OpenAPI generation,
- documentation,
- shared libraries.

---

## 28. End-to-End Submit Scenario

### 28.1 Request

```http
POST /applications/APP-123/submit
Content-Type: application/json
X-Correlation-Id: 01HRX7V7KQ2P2N9W3F0G6X6N8B
```

```json
{
  "applicantName": "Acme Pte Ltd",
  "applicantIdentifier": "201912345Z",
  "email": "contact@acme.example",
  "applicationType": "LICENCE_NEW",
  "documents": [
    {
      "documentType": "BUSINESS_PROFILE",
      "fileId": "file_123"
    }
  ],
  "declarationAccepted": true
}
```

### 28.2 Processing

```text
1. JSON parsed.
2. DTO validated.
3. Input normalized.
4. Command created.
5. Application loaded with lock/version.
6. Applicant snapshot loaded.
7. Documents loaded.
8. Duplicate application checked.
9. Submission window checked.
10. Policy evaluated.
11. Aggregate mutates state.
12. DB commit ensures final consistency.
13. Outbox event created.
14. Event validated.
15. Response returned.
16. Metrics/audit emitted.
```

### 28.3 Failure Example: Applicant Suspended

```json
{
  "type": "https://api.example.gov/problems/policy-denied",
  "title": "Action cannot be completed",
  "status": 409,
  "detail": "Application cannot be submitted in its current context.",
  "correlationId": "01HRX7V7KQ2P2N9W3F0G6X6N8B",
  "violations": [
    {
      "code": "APPLICANT_SUSPENDED",
      "ruleId": "APP_SUBMIT_003",
      "ruleVersion": "1.0.0",
      "field": "applicant",
      "message": "Applicant is currently suspended and cannot submit a new application.",
      "severity": "ERROR"
    }
  ]
}
```

---

## 29. Production Checklist

### 29.1 DTO / Jakarta Validation

- [ ] Constraints are operation-appropriate.
- [ ] `@NotNull` is not used blindly.
- [ ] PATCH distinguishes absent vs explicit null.
- [ ] Container element constraints are used where needed.
- [ ] `@Valid` does not traverse huge entity graphs.
- [ ] Custom constraints are pure and thread-safe.
- [ ] Message keys are used instead of raw hardcoded strings.
- [ ] Error code does not depend on human message parsing.

### 29.2 API Error Contract

- [ ] Stable error envelope exists.
- [ ] Violations have `code`, `field`, `message`, `severity`.
- [ ] Rule-level violations have `ruleId` and `ruleVersion`.
- [ ] Rejected value is redacted or omitted.
- [ ] i18n is separated from machine code.
- [ ] Error shape is contract-tested.

### 29.3 Domain / Workflow

- [ ] Workflow rules are explicit policy objects.
- [ ] Authorization is not hidden inside Bean Validation.
- [ ] State transition guard is separate from DTO validation.
- [ ] Maker-checker rules are explicit.
- [ ] Temporal rules use injected `Clock`.
- [ ] Rule results contain safe evidence.
- [ ] Rule catalog has owner and version.

### 29.4 Persistence

- [ ] Critical invariants have DB constraints.
- [ ] DB constraints have stable names.
- [ ] DB errors are translated to domain/API errors.
- [ ] Race condition is considered.
- [ ] Bulk update bypass risk is known.

### 29.5 Events

- [ ] Inbound events validate envelope and payload.
- [ ] Outbound events are validated before publish.
- [ ] Schema version is explicit.
- [ ] DLQ reasons are classified.
- [ ] Rejected events are auditable.

### 29.6 Operations

- [ ] Validation metrics exist.
- [ ] Logs are PII-safe.
- [ ] Rule rollout supports observe/warn/block.
- [ ] Alerts detect rejection spikes.
- [ ] Support team can map error codes to remediation.
- [ ] Rule changes are reviewed and tested.

---

## 30. Anti-Patterns Final

### 30.1 Annotation God Object

One giant class-level annotation tries to validate entire use case.

Problem:

- hidden dependency,
- bad testability,
- poor auditability,
- hard migration,
- unclear ownership.

### 30.2 Entity as Public API DTO

JPA entity exposed directly in REST.

Problem:

- lazy loading,
- over-posting,
- leaking internal fields,
- validation confusion,
- persistence constraint mixed with API contract.

### 30.3 Database Call Inside Field Validator

Problem:

- latency,
- race condition,
- transaction ambiguity,
- hard testing,
- bad failure semantics.

### 30.4 Human Message as Machine Contract

Problem:

- i18n breaks clients,
- text changes become breaking changes,
- impossible to govern.

### 30.5 Workflow Hidden in Groups

Problem:

- group explosion,
- unreadable behavior,
- no evidence,
- no versioning,
- no audit.

### 30.6 No DB Final Guard

Problem:

- application-level validation can lose under concurrency.

### 30.7 No Observability

Problem:

- validation can silently break clients,
- no blast radius measurement,
- no operational confidence.

---

## 31. Mental Model Final

A mature validation architecture follows this model:

```text
Shape is validated at the boundary.
Meaning is validated in the command/use case.
Truth is protected by the domain model.
State transitions are guarded by workflow policy.
Final consistency is enforced by the database.
External contracts are validated at integration boundaries.
Every important rejection is observable, explainable, and auditable.
```

Do not ask, “Where do I put this annotation?”

Ask:

```text
What kind of invalidity is this?
Who owns the rule?
What context does the rule need?
Is it local or cross-entity?
Is it deterministic?
Is it blocking or warning?
Can it race?
Does it need audit?
Does it need a stable error code?
Will this rule evolve?
```

That is the difference between basic validation and production-grade validation engineering.

---

## 32. How This Maps to Jakarta Validation and Hibernate Validator

Jakarta Validation is the right tool for:

- object field constraints,
- class-level local consistency,
- container element constraints,
- cascaded object graph validation,
- method/constructor parameter validation,
- return value validation,
- metadata-driven introspection.

Hibernate Validator extends this with:

- reference implementation behavior,
- provider-specific constraints,
- fail-fast,
- programmatic mapping,
- custom value extractors,
- dynamic group sequence,
- additional integration features.

But neither Jakarta Validation nor Hibernate Validator should become the entire policy engine for large regulatory workflows.

Use them where they shine. Build explicit domain/workflow policy where context and audit matter.

---

## 33. Reference Notes

This series is aligned with the following official references and ecosystem facts:

- Jakarta Validation provides a specification/API for constraint declaration, object graph validation, method/constructor validation, metadata, and violation reporting.
- Jakarta Validation 3.1 is part of Jakarta EE 11 and can also be used in Java SE.
- Bean Validation 2.0 introduced modern Java 8-era features including container element constraints, support for `Optional`, Java time support, and custom container validation via value extractors.
- Hibernate Validator is the reference implementation of Jakarta Validation; Hibernate Validator 9.x implements Jakarta Validation 3.1 and targets Jakarta EE 11.
- Spring Framework supports `ProblemDetail`/`ErrorResponse` for RFC 9457-style error responses.
- RFC 9457 defines Problem Details for HTTP APIs and obsoletes RFC 7807.

---

## 34. Final Summary

A production-grade validation framework for a case management platform should not be designed as a bag of annotations. It should be designed as an explicit, layered correctness system.

The target architecture is:

```text
DTO constraints
  + normalized command
  + domain invariant
  + workflow guard
  + authorization policy
  + cross-entity checks
  + DB constraints
  + event validation
  + structured API errors
  + rule catalog
  + audit trail
  + observability
  + safe rollout
```

The best engineers do not merely know `@NotNull`, `@Valid`, `@GroupSequence`, or `ConstraintValidator`.

They know where validation belongs, where it does not belong, how it fails under concurrency, how it evolves without breaking clients, how it is observed in production, and how a rejection can be defended months later when someone asks: “Why did the system block this action?”

That is the standard this series is aiming for.

---

## 35. Series Completion Status

This is `part-030`, the capstone and planned final part of the series `learn-java-validation-jakarta-hibernate-validator`.

Status: **seri selesai / mencapai bagian terakhir**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-029](./learn-java-validation-jakarta-hibernate-validator-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Part 000 — Orientasi dan Mental Model Java hingga Java 25](../../learn-java-part-000.md)

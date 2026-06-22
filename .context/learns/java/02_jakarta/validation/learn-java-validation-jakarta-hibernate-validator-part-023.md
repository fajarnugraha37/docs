# learn-java-validation-jakarta-hibernate-validator-part-023

# Advanced Domain Rule Modeling: Specification Pattern, Policy Objects, and Validators

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: 023  
> Topik: Advanced Domain Rule Modeling  
> Scope Java: Java 8 sampai Java 25  
> Fokus: kapan aturan cukup dimodelkan sebagai Jakarta Validation constraint, kapan harus naik menjadi specification, policy object, rule evaluator, workflow guard, atau consistency enforcement di persistence/database.

---

## 1. Tujuan Bagian Ini

Bagian-bagian sebelumnya sudah membahas validation dari sisi:

- built-in constraints,
- nullability,
- cascaded validation,
- container element constraints,
- validation groups,
- group sequence,
- custom constraint,
- executable validation,
- records/immutability,
- message interpolation,
- payload/error code,
- programmatic mapping,
- Hibernate Validator extension,
- dependency injection,
- REST API,
- persistence,
- event-driven system,
- workflow/state machine/regulatory case management.

Bagian ini naik satu level: **bagaimana memodelkan rule bisnis dan domain rule secara eksplisit agar tidak semuanya dipaksa masuk ke annotation validation**.

Jakarta Validation sangat kuat untuk object-level constraint declaration, metadata, object graph validation, method/constructor validation, dan violation reporting. Spesifikasinya memang mendefinisikan API dan metadata model untuk JavaBean serta method validation, bukan full business-rule engine atau workflow engine. Karena itu, untuk rule yang membutuhkan konteks, actor, waktu, state, cross-entity snapshot, external reference, atau rule version, kita butuh model rule yang lebih eksplisit.

Mental model utama bagian ini:

```text
Annotation validation answers:
  "Is this object locally valid according to declared constraints?"

Domain rule modeling answers:
  "Is this action allowed in this business context, and why?"
```

Keduanya mirip, tetapi tidak sama.

---

## 2. Masalah Utama: Semua Rule Dipaksa Jadi Annotation

Banyak codebase enterprise mengalami pola seperti ini:

```java
@NotNull(groups = Submit.class)
private String applicantName;

@ValidDateRange(groups = Submit.class)
private LocalDate startDate;

@ValidApplicantEligibility(groups = Submit.class)
private String applicantId;

@AllowedForCurrentOfficer(groups = Approve.class)
private String caseId;

@NoOutstandingComplianceCase(groups = Submit.class)
private String businessId;
```

Awalnya terlihat rapi. Tetapi lama-lama annotation menjadi tempat tersembunyi untuk:

- lookup database,
- authorization,
- role-specific policy,
- workflow transition,
- SLA/deadline check,
- cross-module consistency,
- external API call,
- duplicate detection,
- maker-checker rule,
- temporal cut-off,
- jurisdiction rule,
- tenant-specific behavior,
- regulatory rule version.

Hasilnya:

```text
DTO annotation becomes an invisible business process engine.
```

Gejalanya:

- rule sulit ditemukan,
- test sulit dibaca,
- error semantics kacau,
- validasi tiba-tiba lambat,
- validator butuh banyak dependency,
- API mengembalikan 400 padahal seharusnya 403/409/422,
- rule berubah tapi tidak ada versioning,
- audit trail tidak bisa menjelaskan rule mana yang dilanggar,
- FE tidak bisa menampilkan eligibility reason sebelum submit,
- batch/import tidak bisa membedakan invalid data vs blocked by policy,
- retry logic di event consumer salah karena semua dianggap invalid payload.

Bagian ini membahas cara membangun model rule yang lebih eksplisit.

---

## 3. Taxonomy Rule: Jangan Semua Disebut "Validation"

Sebelum memilih pattern, bedakan jenis rule-nya.

| Jenis Rule | Pertanyaan | Contoh | Tempat Umum |
|---|---|---|---|
| Shape validation | Apakah input punya bentuk benar? | field wajib, length, format email | DTO/Jakarta Validation |
| Local invariant | Apakah object konsisten secara lokal? | `start <= end`, amount positive | constructor/value object/class-level constraint |
| Semantic validation | Apakah nilai bermakna dalam domain? | postal code valid format negara tertentu | custom constraint/value object |
| Contextual rule | Apakah rule valid dalam konteks operasi? | submit butuh applicant aktif | command validator/policy |
| Authorization | Apakah actor boleh melakukan aksi? | officer boleh approve case ini | security/policy layer |
| Workflow guard | Apakah transisi state boleh? | Draft → Submitted | state machine/transition guard |
| Consistency check | Apakah sistem masih konsisten? | unique active license | DB constraint + service policy |
| External dependency check | Apakah referensi eksternal valid? | external registry active | integration policy/cache/service |
| Temporal rule | Apakah waktu aksi valid? | appeal max 14 hari | policy with clock |
| Risk/scoring rule | Apakah perlu escalation? | high risk applicant | rule evaluator/scoring engine |
| Advisory/warning rule | Apakah user perlu diberi warning? | incomplete optional evidence | soft validation/policy |

Kesalahan terbesar adalah membuat semua baris di atas menjadi `@Something` di DTO.

---

## 4. Layering Rule yang Sehat

Gunakan peta berikut.

```text
┌──────────────────────────────────────────────────────────────┐
│ Client/FE                                                     │
│ - UX validation                                               │
│ - immediate feedback                                          │
│ - not authoritative                                           │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Transport/API Boundary                                        │
│ - JSON parse/binding                                          │
│ - DTO Jakarta Validation                                      │
│ - request shape                                               │
│ - cheap deterministic checks                                  │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Application Command Boundary                                  │
│ - operation-specific validation                               │
│ - actor/channel/context-aware rules                           │
│ - command validator                                           │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Domain Model / Aggregate                                      │
│ - local invariants                                            │
│ - state transition methods                                    │
│ - value object consistency                                    │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Domain Policy / Specification / Rule Evaluator                │
│ - contextual business rules                                   │
│ - cross-entity snapshot                                       │
│ - temporal/role/jurisdiction/versioned policy                 │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Persistence / Database                                        │
│ - final integrity enforcement                                 │
│ - unique, FK, NOT NULL, CHECK                                 │
│ - optimistic locking                                          │
└──────────────────────────────────────────────────────────────┘
```

Jakarta Validation cocok di dua tempat utama:

1. transport/API boundary untuk shape validation,
2. local object invariant untuk object yang memang bisa dinilai tanpa konteks besar.

Specification/policy object cocok ketika pertanyaannya berubah menjadi:

```text
Given actor + action + current state + related data + clock + policy version,
is this operation allowed, warning, or blocked?
```

---

## 5. Specification Pattern: Mental Model

Specification pattern memodelkan satu rule sebagai object yang bisa menjawab apakah kandidat memenuhi kriteria tertentu.

Bentuk paling sederhana:

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);
}
```

Contoh:

```java
public final class ActiveApplicantSpecification implements Specification<Applicant> {
    @Override
    public boolean isSatisfiedBy(Applicant applicant) {
        return applicant != null && applicant.status() == ApplicantStatus.ACTIVE;
    }
}
```

Tetapi untuk production-grade validation, `boolean` terlalu miskin.

Kita butuh tahu:

- rule mana yang gagal,
- severity,
- message/error code,
- field/action/state target,
- evidence,
- remediation,
- apakah blocking atau warning,
- rule version,
- apakah failure retryable,
- apakah perlu audit.

Karena itu model top-tier biasanya bukan `boolean`, tetapi `RuleResult`.

---

## 6. Dari Boolean Specification ke Rich Rule Result

### 6.1 Boolean terlalu miskin

```java
boolean allowed = canSubmitSpec.isSatisfiedBy(caseAggregate);
```

Masalah:

- Kenapa gagal?
- Rule mana yang gagal?
- Apakah user bisa memperbaiki?
- Apakah perlu admin override?
- Apakah gagal karena data invalid atau dependency down?
- Bagaimana audit?
- Bagaimana FE menampilkan alasan?
- Bagaimana monitoring top failed rule?

### 6.2 Rich result model

```java
public enum RuleSeverity {
    INFO,
    WARNING,
    ERROR,
    FATAL
}

public enum RuleDecision {
    PASS,
    WARN,
    BLOCK,
    NOT_APPLICABLE
}

public final class RuleViolation {
    private final String ruleId;
    private final String ruleVersion;
    private final RuleSeverity severity;
    private final RuleDecision decision;
    private final String code;
    private final String messageKey;
    private final String target;
    private final Map<String, Object> evidence;
    private final String remediationKey;

    public RuleViolation(
            String ruleId,
            String ruleVersion,
            RuleSeverity severity,
            RuleDecision decision,
            String code,
            String messageKey,
            String target,
            Map<String, Object> evidence,
            String remediationKey
    ) {
        this.ruleId = ruleId;
        this.ruleVersion = ruleVersion;
        this.severity = severity;
        this.decision = decision;
        this.code = code;
        this.messageKey = messageKey;
        this.target = target;
        this.evidence = evidence == null ? Collections.emptyMap() : Collections.unmodifiableMap(new LinkedHashMap<>(evidence));
        this.remediationKey = remediationKey;
    }

    public String ruleId() { return ruleId; }
    public String ruleVersion() { return ruleVersion; }
    public RuleSeverity severity() { return severity; }
    public RuleDecision decision() { return decision; }
    public String code() { return code; }
    public String messageKey() { return messageKey; }
    public String target() { return target; }
    public Map<String, Object> evidence() { return evidence; }
    public String remediationKey() { return remediationKey; }
}
```

```java
public final class RuleResult {
    private static final RuleResult PASS = new RuleResult(Collections.emptyList());

    private final List<RuleViolation> violations;

    private RuleResult(List<RuleViolation> violations) {
        this.violations = Collections.unmodifiableList(new ArrayList<>(violations));
    }

    public static RuleResult pass() {
        return PASS;
    }

    public static RuleResult of(RuleViolation violation) {
        return new RuleResult(Collections.singletonList(violation));
    }

    public static RuleResult combine(Collection<RuleResult> results) {
        List<RuleViolation> all = new ArrayList<>();
        for (RuleResult result : results) {
            all.addAll(result.violations);
        }
        return new RuleResult(all);
    }

    public boolean isPassed() {
        return violations.isEmpty();
    }

    public boolean hasBlockingViolation() {
        for (RuleViolation violation : violations) {
            if (violation.decision() == RuleDecision.BLOCK) {
                return true;
            }
        }
        return false;
    }

    public List<RuleViolation> violations() {
        return violations;
    }
}
```

Dengan model ini, rule bukan hanya memberi jawaban, tetapi juga memberi **alasan terstruktur**.

---

## 7. Rule Interface yang Lebih Production-Grade

Alih-alih:

```java
boolean isSatisfiedBy(T candidate);
```

Gunakan:

```java
public interface DomainRule<C> {
    RuleResult evaluate(C context);
}
```

`C` bukan selalu entity. Dalam rule bisnis, context biasanya gabungan beberapa hal.

```java
public final class SubmitCaseContext {
    private final CaseAggregate caseAggregate;
    private final ApplicantSnapshot applicant;
    private final OfficerActor actor;
    private final LocalDate today;
    private final Channel channel;
    private final Jurisdiction jurisdiction;
    private final PolicyVersion policyVersion;

    public SubmitCaseContext(
            CaseAggregate caseAggregate,
            ApplicantSnapshot applicant,
            OfficerActor actor,
            LocalDate today,
            Channel channel,
            Jurisdiction jurisdiction,
            PolicyVersion policyVersion
    ) {
        this.caseAggregate = Objects.requireNonNull(caseAggregate);
        this.applicant = Objects.requireNonNull(applicant);
        this.actor = Objects.requireNonNull(actor);
        this.today = Objects.requireNonNull(today);
        this.channel = Objects.requireNonNull(channel);
        this.jurisdiction = Objects.requireNonNull(jurisdiction);
        this.policyVersion = Objects.requireNonNull(policyVersion);
    }

    public CaseAggregate caseAggregate() { return caseAggregate; }
    public ApplicantSnapshot applicant() { return applicant; }
    public OfficerActor actor() { return actor; }
    public LocalDate today() { return today; }
    public Channel channel() { return channel; }
    public Jurisdiction jurisdiction() { return jurisdiction; }
    public PolicyVersion policyVersion() { return policyVersion; }
}
```

Context object membuat rule eksplisit tentang input yang dibutuhkan. Ini lebih baik daripada `ConstraintValidator` yang diam-diam inject 5 service dan query database.

---

## 8. Contoh: Rule Submit Case

### 8.1 Rule: case harus dalam state Draft

```java
public final class CaseMustBeDraftRule implements DomainRule<SubmitCaseContext> {
    @Override
    public RuleResult evaluate(SubmitCaseContext context) {
        if (context.caseAggregate().status() == CaseStatus.DRAFT) {
            return RuleResult.pass();
        }

        RuleViolation violation = new RuleViolation(
                "CASE_SUBMIT_001",
                context.policyVersion().value(),
                RuleSeverity.ERROR,
                RuleDecision.BLOCK,
                "case.submit.invalidStatus",
                "validation.case.submit.invalidStatus",
                "case.status",
                mapOf(
                        "currentStatus", context.caseAggregate().status().name(),
                        "expectedStatus", CaseStatus.DRAFT.name(),
                        "caseId", context.caseAggregate().id().value()
                ),
                "remediation.case.returnToDraftOrRefresh"
        );

        return RuleResult.of(violation);
    }

    private static Map<String, Object> mapOf(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) {
            map.put(String.valueOf(values[i]), values[i + 1]);
        }
        return map;
    }
}
```

### 8.2 Rule: applicant harus aktif

```java
public final class ApplicantMustBeActiveRule implements DomainRule<SubmitCaseContext> {
    @Override
    public RuleResult evaluate(SubmitCaseContext context) {
        if (context.applicant().status() == ApplicantStatus.ACTIVE) {
            return RuleResult.pass();
        }

        RuleViolation violation = new RuleViolation(
                "CASE_SUBMIT_002",
                context.policyVersion().value(),
                RuleSeverity.ERROR,
                RuleDecision.BLOCK,
                "case.submit.inactiveApplicant",
                "validation.case.submit.inactiveApplicant",
                "applicant.status",
                mapOf(
                        "applicantStatus", context.applicant().status().name(),
                        "applicantId", context.applicant().id().masked()
                ),
                "remediation.applicant.reactivateOrSelectAnother"
        );

        return RuleResult.of(violation);
    }

    private static Map<String, Object> mapOf(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) {
            map.put(String.valueOf(values[i]), values[i + 1]);
        }
        return map;
    }
}
```

### 8.3 Rule: warning jika evidence belum lengkap

```java
public final class EvidenceCompletenessWarningRule implements DomainRule<SubmitCaseContext> {
    @Override
    public RuleResult evaluate(SubmitCaseContext context) {
        int missingCount = context.caseAggregate().missingRecommendedEvidenceCount();
        if (missingCount == 0) {
            return RuleResult.pass();
        }

        RuleViolation warning = new RuleViolation(
                "CASE_SUBMIT_010",
                context.policyVersion().value(),
                RuleSeverity.WARNING,
                RuleDecision.WARN,
                "case.submit.recommendedEvidenceMissing",
                "validation.case.submit.recommendedEvidenceMissing",
                "case.evidence",
                Collections.singletonMap("missingRecommendedEvidenceCount", missingCount),
                "remediation.case.uploadRecommendedEvidence"
        );

        return RuleResult.of(warning);
    }
}
```

Perhatikan: warning tidak harus memblokir submit. Ini sulit dimodelkan dengan `ConstraintViolation` biasa karena Bean Validation secara default berorientasi pada pass/fail constraint violation.

---

## 9. Rule Set / Policy Object

Satu operasi biasanya memiliki banyak rule. Jangan panggil rule satu per satu secara acak di service method. Buat policy object.

```java
public final class SubmitCasePolicy {
    private final List<DomainRule<SubmitCaseContext>> rules;

    public SubmitCasePolicy(List<DomainRule<SubmitCaseContext>> rules) {
        this.rules = Collections.unmodifiableList(new ArrayList<>(rules));
    }

    public RuleResult evaluate(SubmitCaseContext context) {
        List<RuleResult> results = new ArrayList<>();

        for (DomainRule<SubmitCaseContext> rule : rules) {
            results.add(rule.evaluate(context));
        }

        return RuleResult.combine(results);
    }
}
```

Composition root:

```java
SubmitCasePolicy policy = new SubmitCasePolicy(Arrays.asList(
        new CaseMustBeDraftRule(),
        new ApplicantMustBeActiveRule(),
        new EvidenceCompletenessWarningRule()
));
```

Application service:

```java
public final class SubmitCaseService {
    private final CaseRepository caseRepository;
    private final ApplicantSnapshotRepository applicantRepository;
    private final SubmitCasePolicy submitCasePolicy;
    private final Clock clock;

    public SubmitCaseService(
            CaseRepository caseRepository,
            ApplicantSnapshotRepository applicantRepository,
            SubmitCasePolicy submitCasePolicy,
            Clock clock
    ) {
        this.caseRepository = caseRepository;
        this.applicantRepository = applicantRepository;
        this.submitCasePolicy = submitCasePolicy;
        this.clock = clock;
    }

    public SubmitCaseResult submit(SubmitCaseCommand command, OfficerActor actor) {
        CaseAggregate caseAggregate = caseRepository.getById(command.caseId());
        ApplicantSnapshot applicant = applicantRepository.getSnapshot(caseAggregate.applicantId());

        SubmitCaseContext context = new SubmitCaseContext(
                caseAggregate,
                applicant,
                actor,
                LocalDate.now(clock),
                command.channel(),
                caseAggregate.jurisdiction(),
                PolicyVersion.current()
        );

        RuleResult ruleResult = submitCasePolicy.evaluate(context);

        if (ruleResult.hasBlockingViolation()) {
            return SubmitCaseResult.blocked(ruleResult);
        }

        caseAggregate.submit(actor, LocalDateTime.now(clock));
        caseRepository.save(caseAggregate);

        return SubmitCaseResult.submitted(caseAggregate.id(), ruleResult);
    }
}
```

Ini jauh lebih jelas daripada memasukkan semua rule ke DTO annotation.

---

## 10. Specification Composition: AND, OR, NOT

Specification pattern sering menyediakan composition.

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) && other.isSatisfiedBy(candidate);
    }

    default Specification<T> or(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) || other.isSatisfiedBy(candidate);
    }

    default Specification<T> not() {
        return candidate -> !this.isSatisfiedBy(candidate);
    }
}
```

Tetapi untuk rich result, composition perlu lebih hati-hati.

### 10.1 AND composition

AND berarti semua rule dievaluasi, atau berhenti saat blocking? Dua-duanya valid tergantung use case.

- **Accumulate-all mode**: cocok untuk form/API agar user tahu semua masalah sekaligus.
- **Fail-fast mode**: cocok untuk expensive rule atau dependency-heavy validation.

```java
public final class AllRules<C> implements DomainRule<C> {
    private final List<DomainRule<C>> rules;

    public AllRules(List<DomainRule<C>> rules) {
        this.rules = Collections.unmodifiableList(new ArrayList<>(rules));
    }

    @Override
    public RuleResult evaluate(C context) {
        List<RuleResult> results = new ArrayList<>();
        for (DomainRule<C> rule : rules) {
            results.add(rule.evaluate(context));
        }
        return RuleResult.combine(results);
    }
}
```

### 10.2 Fail-fast composition

```java
public final class FailFastRules<C> implements DomainRule<C> {
    private final List<DomainRule<C>> rules;

    public FailFastRules(List<DomainRule<C>> rules) {
        this.rules = Collections.unmodifiableList(new ArrayList<>(rules));
    }

    @Override
    public RuleResult evaluate(C context) {
        List<RuleResult> results = new ArrayList<>();

        for (DomainRule<C> rule : rules) {
            RuleResult result = rule.evaluate(context);
            results.add(result);
            if (result.hasBlockingViolation()) {
                break;
            }
        }

        return RuleResult.combine(results);
    }
}
```

### 10.3 OR composition

OR tricky untuk error reporting.

Contoh rule:

```text
Applicant may submit if:
  A. applicant is licensed, OR
  B. applicant is exempted by regulation, OR
  C. applicant has temporary approval.
```

Jika semua gagal, error harus menjelaskan alternatif yang gagal, bukan hanya satu pesan generik.

```java
public final class AnyRule<C> implements DomainRule<C> {
    private final String ruleId;
    private final List<DomainRule<C>> alternatives;

    public AnyRule(String ruleId, List<DomainRule<C>> alternatives) {
        this.ruleId = ruleId;
        this.alternatives = Collections.unmodifiableList(new ArrayList<>(alternatives));
    }

    @Override
    public RuleResult evaluate(C context) {
        List<RuleResult> failedAlternatives = new ArrayList<>();

        for (DomainRule<C> alternative : alternatives) {
            RuleResult result = alternative.evaluate(context);
            if (!result.hasBlockingViolation()) {
                return RuleResult.pass();
            }
            failedAlternatives.add(result);
        }

        return RuleResult.combine(failedAlternatives);
    }
}
```

OR composition perlu didesain agar tidak membingungkan user.

---

## 11. Rule Result vs Jakarta `ConstraintViolation`

Jakarta Validation menghasilkan `ConstraintViolation<T>`. Domain policy menghasilkan `RuleViolation`. Keduanya bisa dimapping ke API error envelope yang sama, tetapi jangan dipaksa menjadi object yang sama di dalam domain.

| Aspek | `ConstraintViolation` | `RuleViolation` |
|---|---|---|
| Sumber | Jakarta Validation engine | domain/application policy |
| Scope | object/method constraints | operation/context/action |
| Path | property/method/parameter path | field, action, state, entity, relationship |
| Message | interpolated validation message | message key/code/remediation |
| Metadata | constraint descriptor | rule id/version/evidence/severity |
| Cocok untuk | input shape/local invariant | business decision/workflow/policy |

Di API boundary, keduanya bisa disatukan:

```json
{
  "type": "https://api.example.com/problems/validation-or-policy-error",
  "title": "Request cannot be processed",
  "status": 422,
  "traceId": "6e2f...",
  "violations": [
    {
      "source": "jakarta-validation",
      "code": "request.field.notBlank",
      "target": "applicant.name",
      "message": "Applicant name is required"
    },
    {
      "source": "domain-policy",
      "ruleId": "CASE_SUBMIT_002",
      "ruleVersion": "2026.06",
      "code": "case.submit.inactiveApplicant",
      "target": "applicant.status",
      "severity": "ERROR",
      "decision": "BLOCK",
      "message": "Applicant is not active"
    }
  ]
}
```

---

## 12. Policy Object vs Specification vs Validator

Istilah sering tumpang tindih. Gunakan perbedaan praktis berikut.

### 12.1 Specification

Specification menjawab apakah suatu object/kandidat memenuhi kriteria.

Cocok untuk:

- reusable domain predicate,
- filtering,
- eligibility,
- composable criteria,
- local/domain business rule.

Contoh:

```java
public final class ActiveLicenceSpecification implements Specification<Licence> {
    public boolean isSatisfiedBy(Licence licence) {
        return licence.status() == LicenceStatus.ACTIVE
                && !licence.expiryDate().isBefore(LocalDate.now());
    }
}
```

### 12.2 Validator object

Validator biasanya mengevaluasi input/object dan mengembalikan daftar error.

Cocok untuk:

- command validation,
- form-level validation,
- batch row validation,
- import validation,
- multi-error accumulation.

```java
public interface CommandValidator<C> {
    ValidationResult validate(C command);
}
```

### 12.3 Policy object

Policy object mengevaluasi apakah operasi/action boleh dilakukan dalam konteks tertentu.

Cocok untuk:

- workflow transition,
- role/channel/jurisdiction rule,
- deadline/SLA rule,
- maker-checker rule,
- override rule,
- rule versioning.

```java
public interface Policy<C> {
    PolicyDecision decide(C context);
}
```

### 12.4 Rule engine

Rule engine cocok jika rule:

- sangat banyak,
- sering berubah tanpa deploy,
- dikelola business analyst/rule owner,
- perlu explainability formal,
- memiliki priority/agenda/conflict resolution,
- perlu rule versioning dan simulation.

Tetapi rule engine juga membawa kompleksitas besar. Jangan memakai rule engine hanya karena ada beberapa `if`.

---

## 13. Decision Model: Jangan Hanya Valid/Invalid

Untuk domain policy, keputusan lebih kaya dari valid/invalid.

```java
public enum PolicyDecisionType {
    ALLOW,
    ALLOW_WITH_WARNING,
    BLOCK,
    REQUIRE_OVERRIDE,
    REQUIRE_ADDITIONAL_EVIDENCE,
    ESCALATE,
    NOT_APPLICABLE
}
```

Contoh:

```java
public final class PolicyDecision {
    private final PolicyDecisionType type;
    private final RuleResult ruleResult;

    private PolicyDecision(PolicyDecisionType type, RuleResult ruleResult) {
        this.type = type;
        this.ruleResult = ruleResult;
    }

    public static PolicyDecision allow(RuleResult warnings) {
        return new PolicyDecision(
                warnings.isPassed() ? PolicyDecisionType.ALLOW : PolicyDecisionType.ALLOW_WITH_WARNING,
                warnings
        );
    }

    public static PolicyDecision block(RuleResult violations) {
        return new PolicyDecision(PolicyDecisionType.BLOCK, violations);
    }

    public PolicyDecisionType type() { return type; }
    public RuleResult ruleResult() { return ruleResult; }
}
```

Ini penting untuk sistem enterprise/regulatory karena tidak semua rule failure berarti `400 Bad Request`.

---

## 14. Severity dan Enforcement Mode

Rule sering berubah dari observasi menjadi warning lalu blocking.

```java
public enum EnforcementMode {
    OBSERVE_ONLY,
    WARN,
    BLOCK
}
```

Contoh lifecycle:

```text
Phase 1: OBSERVE_ONLY
  - collect metrics
  - no user impact
  - audit predicted failure

Phase 2: WARN
  - show warning to user
  - allow submit
  - measure readiness

Phase 3: BLOCK
  - enforce rule
  - reject operation
  - audit rejection
```

Model ini jauh lebih mudah dengan policy object daripada annotation constraint biasa.

```java
public final class EnforcedRule<C> implements DomainRule<C> {
    private final DomainRule<C> delegate;
    private final EnforcementMode mode;

    public EnforcedRule(DomainRule<C> delegate, EnforcementMode mode) {
        this.delegate = delegate;
        this.mode = mode;
    }

    @Override
    public RuleResult evaluate(C context) {
        RuleResult result = delegate.evaluate(context);
        if (result.isPassed()) {
            return result;
        }

        if (mode == EnforcementMode.OBSERVE_ONLY) {
            // In real implementation, convert to telemetry-only result or publish metric.
            return RuleResult.pass();
        }

        if (mode == EnforcementMode.WARN) {
            // In real implementation, downgrade BLOCK to WARN.
            return downgradeToWarning(result);
        }

        return result;
    }

    private RuleResult downgradeToWarning(RuleResult original) {
        List<RuleViolation> downgraded = new ArrayList<>();
        for (RuleViolation v : original.violations()) {
            downgraded.add(new RuleViolation(
                    v.ruleId(),
                    v.ruleVersion(),
                    RuleSeverity.WARNING,
                    RuleDecision.WARN,
                    v.code(),
                    v.messageKey(),
                    v.target(),
                    v.evidence(),
                    v.remediationKey()
            ));
        }
        return RuleResult.combine(Collections.singletonList(new RuleResultAccessor(downgraded).result()));
    }

    private static final class RuleResultAccessor {
        private final List<RuleViolation> violations;

        private RuleResultAccessor(List<RuleViolation> violations) {
            this.violations = violations;
        }

        private RuleResult result() {
            List<RuleResult> results = new ArrayList<>();
            for (RuleViolation violation : violations) {
                results.add(RuleResult.of(violation));
            }
            return RuleResult.combine(results);
        }
    }
}
```

Catatan: contoh di atas sengaja verbose agar compatible dengan Java 8. Dalam Java 16+ record dan helper factory bisa membuatnya jauh lebih ringkas.

---

## 15. Evidence: Bagian yang Sering Dilupakan

Rule bisnis yang baik harus bisa menjelaskan bukti.

Contoh buruk:

```json
{
  "code": "case.submit.notAllowed",
  "message": "Case cannot be submitted"
}
```

Contoh lebih baik:

```json
{
  "ruleId": "CASE_SUBMIT_004",
  "ruleVersion": "2026.06",
  "code": "case.submit.outstandingComplianceCase",
  "target": "applicant",
  "decision": "BLOCK",
  "evidence": {
    "activeComplianceCaseCount": 2,
    "oldestComplianceCaseAgeDays": 61,
    "sourceSnapshotTime": "2026-06-16T09:10:23Z"
  },
  "remediation": "Resolve outstanding compliance cases before submission."
}
```

Evidence berguna untuk:

- audit,
- support/debugging,
- user explanation,
- appeal handling,
- management reporting,
- rule calibration,
- dispute resolution,
- regression test expected result.

Tetapi evidence harus aman:

- jangan bocorkan PII,
- jangan tampilkan raw sensitive value,
- jangan expose internal table name,
- jangan expose full external API payload,
- jangan log rejected secret/token/credential,
- gunakan masked value/snapshot classification.

---

## 16. Rule Versioning

Rule bisnis berubah. Annotation validation sering tidak punya konsep versioning eksplisit.

Untuk sistem sederhana, ini tidak masalah. Untuk sistem regulatory, versioning penting.

Pertanyaan yang harus bisa dijawab:

- Rule apa yang berlaku saat user submit?
- Apakah rule saat ini sama dengan rule saat case dibuat?
- Jika case di-reopen, rule lama atau rule baru yang dipakai?
- Jika appeal diajukan, apakah rule submit lama menjadi evidence?
- Bagaimana audit menjelaskan rejection lama setelah rule berubah?
- Apakah rule change berlaku retroaktif?

Model sederhana:

```java
public final class PolicyVersion {
    private final String value;

    private PolicyVersion(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("policy version is required");
        }
        this.value = value;
    }

    public static PolicyVersion of(String value) {
        return new PolicyVersion(value);
    }

    public static PolicyVersion current() {
        return new PolicyVersion("2026.06");
    }

    public String value() {
        return value;
    }
}
```

Dalam production:

- policy version bisa berasal dari config,
- rule catalog,
- database,
- release version,
- effective date,
- jurisdiction.

Rule result harus menyimpan rule version.

---

## 17. Rule Catalog

Untuk sistem besar, buat katalog rule.

Contoh format markdown/YAML/DB table:

```yaml
- ruleId: CASE_SUBMIT_001
  version: 2026.06
  name: Case must be in Draft state before submit
  owner: Case Management Team
  severity: ERROR
  enforcement: BLOCK
  target: case.status
  messageKey: validation.case.submit.invalidStatus
  remediationKey: remediation.case.returnToDraftOrRefresh
  effectiveFrom: 2026-06-01
  appliesTo:
    jurisdictions: [DEFAULT]
    channels: [PORTAL, BACKOFFICE]
  auditRequired: true
```

Katalog rule membantu:

- governance,
- BA/QA review,
- test coverage mapping,
- audit,
- release note,
- frontend message mapping,
- monitoring dashboard,
- impact analysis.

Tanpa katalog rule, rule tersebar di annotation, service, repository, SQL, frontend, scheduler, dan event consumer.

---

## 18. Dependency Graph antar Rule

Tidak semua rule independen.

Contoh:

```text
R1: case exists
R2: case state is Draft
R3: applicant exists
R4: applicant active
R5: no outstanding compliance case
R6: submit deadline not passed
```

R2 bergantung pada R1. R4 bergantung pada R3.

Jangan menjalankan semua rule tanpa dependency awareness jika bisa menyebabkan:

- NullPointerException,
- pesan error berisik,
- DB call tidak perlu,
- external call tidak perlu,
- user mendapat 10 error turunan padahal root error cuma satu.

Pendekatan sederhana:

```text
Stage 1: existence and cheap local checks
Stage 2: state/actor checks
Stage 3: cross-entity checks
Stage 4: expensive/external checks
Stage 5: warning/advisory checks
```

Ini mirip group sequence, tetapi eksplisit di policy layer dan punya semantics domain.

---

## 19. Staged Policy Evaluation

```java
public final class StagedPolicy<C> {
    private final List<List<DomainRule<C>>> stages;

    public StagedPolicy(List<List<DomainRule<C>>> stages) {
        List<List<DomainRule<C>>> copy = new ArrayList<>();
        for (List<DomainRule<C>> stage : stages) {
            copy.add(Collections.unmodifiableList(new ArrayList<>(stage)));
        }
        this.stages = Collections.unmodifiableList(copy);
    }

    public RuleResult evaluate(C context) {
        List<RuleResult> allResults = new ArrayList<>();

        for (List<DomainRule<C>> stage : stages) {
            RuleResult stageResult = evaluateStage(stage, context);
            allResults.add(stageResult);

            if (stageResult.hasBlockingViolation()) {
                break;
            }
        }

        return RuleResult.combine(allResults);
    }

    private RuleResult evaluateStage(List<DomainRule<C>> stage, C context) {
        List<RuleResult> results = new ArrayList<>();
        for (DomainRule<C> rule : stage) {
            results.add(rule.evaluate(context));
        }
        return RuleResult.combine(results);
    }
}
```

Contoh stage untuk submit:

```java
StagedPolicy<SubmitCaseContext> submitPolicy = new StagedPolicy<>(Arrays.asList(
        Arrays.asList(
                new CaseMustExistRule(),
                new ApplicantMustExistRule()
        ),
        Arrays.asList(
                new CaseMustBeDraftRule(),
                new ActorMustBeAssignedOfficerRule()
        ),
        Arrays.asList(
                new ApplicantMustBeActiveRule(),
                new NoOutstandingComplianceCaseRule()
        ),
        Arrays.asList(
                new EvidenceCompletenessWarningRule()
        )
));
```

Ini jauh lebih eksplisit daripada memanfaatkan group sequence untuk rule yang sebenarnya bukan Bean Validation problem.

---

## 20. Policy Decision dan HTTP/API Mapping

Rule result harus dimapping ke status/error semantics yang benar.

| Failure | Contoh | Status Umum |
|---|---|---|
| JSON invalid | malformed body | 400 |
| DTO shape invalid | missing required field | 400 atau 422 tergantung API convention |
| Domain semantic invalid | date range impossible | 422 |
| Unauthorized | token invalid | 401 |
| Forbidden | actor tidak boleh approve | 403 |
| State conflict | case sudah submitted oleh user lain | 409 |
| Business rule block | applicant inactive | 422 atau 409, tergantung semantics |
| Dependency unavailable | registry timeout | 503/424/custom retryable result |
| DB uniqueness conflict | duplicate active reference | 409 |

Jangan semua rule failure dijadikan `400 Bad Request`. Itu menyulitkan client, observability, dan audit.

---

## 21. Command Validator vs Policy Object

Ada dua jenis validasi command:

### 21.1 Command shape/semantic validator

Memastikan command itu sendiri masuk akal.

```java
public final class SubmitCaseCommandValidator {
    public ValidationResult validate(SubmitCaseCommand command) {
        ValidationResult result = ValidationResult.empty();

        if (command.caseId() == null) {
            result.add("caseId", "command.caseId.required");
        }

        if (command.channel() == null) {
            result.add("channel", "command.channel.required");
        }

        return result;
    }
}
```

Ini bisa sebagian besar digantikan oleh Jakarta Validation pada DTO/command.

### 21.2 Policy object

Menilai apakah operasi boleh dilakukan pada kondisi sistem saat ini.

```java
PolicyDecision decision = submitCasePolicy.decide(context);
```

Policy object butuh:

- aggregate snapshot,
- actor,
- clock,
- role,
- jurisdiction,
- related entity,
- config/rule version.

Jangan gabungkan semuanya ke DTO validator.

---

## 22. Domain Entity Method sebagai Invariant Enforcer

Policy object bukan berarti aggregate menjadi anemic. Aggregate tetap harus menjaga invariant intinya.

```java
public final class CaseAggregate {
    private final CaseId id;
    private CaseStatus status;
    private OfficerId assignedOfficerId;

    public void submit(OfficerActor actor, LocalDateTime submittedAt) {
        if (status != CaseStatus.DRAFT) {
            throw new DomainInvariantViolation("case.status.mustBeDraft");
        }

        if (!actor.id().equals(assignedOfficerId)) {
            throw new DomainInvariantViolation("case.actor.mustBeAssignedOfficer");
        }

        this.status = CaseStatus.SUBMITTED;
        // record domain event, submittedAt, etc.
    }
}
```

Mengapa tetap perlu guard di aggregate jika policy sudah cek?

Karena:

- defense in depth,
- policy bisa dipanggil lupa,
- concurrent state berubah,
- test domain tetap kuat,
- invariant inti tidak boleh bergantung pada API flow.

Tetapi aggregate method biasanya tidak cocok untuk semua rule eksternal. Misalnya `NoOutstandingComplianceCaseRule` mungkin membutuhkan repository/query eksternal. Itu lebih cocok di policy/application layer.

---

## 23. Cross-Entity Rule: Snapshot, Bukan Random Lazy Graph

Cross-entity validation sering berbahaya jika dilakukan dengan navigasi entity graph:

```java
case.getApplicant().getComplianceCases().stream()
    .anyMatch(c -> c.status() == ACTIVE);
```

Risiko:

- lazy loading storm,
- N+1 query,
- stale data,
- transaction boundary kabur,
- rule sulit dioptimalkan,
- entity relationship menjadi rule API,
- audit tidak punya snapshot jelas.

Lebih baik ambil explicit snapshot:

```java
public final class ApplicantComplianceSnapshot {
    private final ApplicantId applicantId;
    private final int activeComplianceCaseCount;
    private final LocalDate oldestActiveCaseCreatedDate;
    private final Instant snapshotAt;

    // constructor/getters
}
```

Rule:

```java
public final class NoOutstandingComplianceCaseRule implements DomainRule<SubmitCaseContext> {
    @Override
    public RuleResult evaluate(SubmitCaseContext context) {
        ApplicantComplianceSnapshot snapshot = context.caseAggregate().complianceSnapshot();

        if (snapshot.activeComplianceCaseCount() == 0) {
            return RuleResult.pass();
        }

        RuleViolation violation = new RuleViolation(
                "CASE_SUBMIT_004",
                context.policyVersion().value(),
                RuleSeverity.ERROR,
                RuleDecision.BLOCK,
                "case.submit.outstandingComplianceCase",
                "validation.case.submit.outstandingComplianceCase",
                "applicant.compliance",
                mapOf(
                        "activeComplianceCaseCount", snapshot.activeComplianceCaseCount(),
                        "snapshotAt", snapshot.snapshotAt().toString()
                ),
                "remediation.compliance.resolveOutstandingCases"
        );

        return RuleResult.of(violation);
    }

    private static Map<String, Object> mapOf(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) {
            map.put(String.valueOf(values[i]), values[i + 1]);
        }
        return map;
    }
}
```

Snapshot membuat rule lebih:

- testable,
- auditable,
- deterministic,
- optimizable,
- cacheable,
- explainable.

---

## 24. Temporal Rule: Selalu Inject Clock

Rule temporal sering menyebabkan bug karena memakai `LocalDate.now()` langsung.

Contoh buruk:

```java
if (appealDeadline.isBefore(LocalDate.now())) {
    // block
}
```

Masalah:

- sulit dites,
- timezone tidak jelas,
- batch/replay tidak deterministic,
- production dan test berbeda,
- cut-off jam/hari bisa ambigu.

Lebih baik:

```java
public final class AppealDeadlineRule implements DomainRule<AppealSubmissionContext> {
    @Override
    public RuleResult evaluate(AppealSubmissionContext context) {
        LocalDate today = context.today();
        LocalDate deadline = context.caseAggregate().appealDeadline();

        if (!today.isAfter(deadline)) {
            return RuleResult.pass();
        }

        return RuleResult.of(new RuleViolation(
                "APPEAL_SUBMIT_003",
                context.policyVersion().value(),
                RuleSeverity.ERROR,
                RuleDecision.BLOCK,
                "appeal.submit.deadlinePassed",
                "validation.appeal.submit.deadlinePassed",
                "appeal.deadline",
                mapOf(
                        "today", today.toString(),
                        "deadline", deadline.toString(),
                        "timezone", context.zoneId().toString()
                ),
                "remediation.appeal.requestLateSubmissionApproval"
        ));
    }

    private static Map<String, Object> mapOf(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) {
            map.put(String.valueOf(values[i]), values[i + 1]);
        }
        return map;
    }
}
```

Context harus membawa:

- business date,
- timezone,
- cut-off policy,
- holiday calendar jika relevan,
- policy version.

---

## 25. Authorization Bukan Validation, Tapi Bisa Masuk Policy Decision

Authorization menjawab:

```text
Who may perform what action on which resource under which condition?
```

Jangan sembunyikan authorization dalam `@ValidAssignedOfficer` pada DTO.

Lebih sehat:

```java
public final class ActorMustBeAssignedOfficerRule implements DomainRule<SubmitCaseContext> {
    @Override
    public RuleResult evaluate(SubmitCaseContext context) {
        if (context.caseAggregate().isAssignedTo(context.actor().id())) {
            return RuleResult.pass();
        }

        return RuleResult.of(new RuleViolation(
                "CASE_SUBMIT_AUTH_001",
                context.policyVersion().value(),
                RuleSeverity.ERROR,
                RuleDecision.BLOCK,
                "case.submit.actorNotAssigned",
                "authorization.case.submit.actorNotAssigned",
                "actor",
                Collections.singletonMap("actorRole", context.actor().role().name()),
                "remediation.case.assignOfficerOrRequestPermission"
        ));
    }
}
```

Namun API mapping-nya mungkin `403 Forbidden`, bukan `422`.

Karena itu `RuleViolation` perlu punya source/category, atau policy decision harus mengklasifikasikan failure.

---

## 26. Rule Category

Tambahkan kategori.

```java
public enum RuleCategory {
    INPUT_SHAPE,
    DOMAIN_INVARIANT,
    AUTHORIZATION,
    WORKFLOW_STATE,
    TEMPORAL,
    CROSS_ENTITY_CONSISTENCY,
    EXTERNAL_DEPENDENCY,
    ADVISORY,
    SECURITY
}
```

Kategori membantu:

- HTTP mapping,
- logging,
- dashboard,
- audit,
- alerting,
- remediation,
- support playbook.

Rule `AUTHORIZATION` tidak boleh diperlakukan sama dengan `INPUT_SHAPE`.

---

## 27. Avoiding Database Calls Inside Jakarta Constraint Validators

Bagian 018 sudah membahas dependency injection dalam validator. Di sini kita tarik keputusan arsitekturalnya.

### Jangan begini untuk rule business-critical:

```java
public class UniqueCaseReferenceValidator implements ConstraintValidator<UniqueCaseReference, String> {
    @Autowired
    private CaseRepository repository;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return !repository.existsByReference(value);
    }
}
```

Masalah:

- race condition,
- validator latency,
- error status biasanya salah,
- tidak ada rule version,
- tidak ada evidence,
- sulit batched,
- transaction boundary tidak jelas,
- DB tetap harus punya unique constraint.

Lebih baik:

1. Jakarta Validation cek format case reference.
2. Application service/policy cek conflict jika perlu.
3. Database unique constraint menjadi final authority.
4. DB conflict diterjemahkan menjadi `409 Conflict` dengan stable error code.

---

## 28. Rule Evaluation untuk Batch Import

Batch import butuh multi-error result per row.

```java
public final class ImportRowRuleContext {
    private final int rowNumber;
    private final ImportApplicantRow row;
    private final ReferenceDataSnapshot referenceData;
    private final PolicyVersion policyVersion;

    // constructor/getters
}
```

Rule result harus bisa membawa row target:

```json
{
  "row": 42,
  "target": "postalCode",
  "ruleId": "IMPORT_APPLICANT_007",
  "code": "import.postalCode.unknown",
  "decision": "BLOCK"
}
```

Batch mode biasanya butuh:

- accumulate all errors,
- limit max errors agar response tidak terlalu besar,
- classify warning/error,
- avoid per-row DB call,
- preload reference data snapshot,
- deterministic run id,
- resumable import.

Annotation validation tetap berguna untuk row DTO shape. Tetapi cross-row duplicate, reference existence, dan policy rule lebih cocok di batch validator/policy layer.

---

## 29. Rule Evaluation untuk Event Consumer

Event consumer tidak punya user yang langsung memperbaiki input.

Decision model harus membedakan:

- invalid event permanently rejected,
- unsupported version,
- missing reference maybe retryable,
- out-of-order event should be parked,
- duplicate event should be ignored,
- transient dependency failure should retry.

```java
public enum EventRuleDecision {
    ACCEPT,
    REJECT_PERMANENTLY,
    RETRY_LATER,
    PARK_UNTIL_DEPENDENCY_ARRIVES,
    IGNORE_DUPLICATE,
    DEAD_LETTER
}
```

Jangan semua violation masuk DLQ. Domain rule result harus memberi klasifikasi operasional.

---

## 30. Pure Rule vs Stateful Rule

Rule idealnya pure:

```text
same input context -> same rule result
```

Pure rule:

- mudah dites,
- deterministic,
- bisa direplay,
- mudah diaudit,
- bisa di-cache,
- aman untuk concurrency.

Stateful rule yang query DB/external API sebaiknya dipisah menjadi dua langkah:

```text
1. Build context/snapshot using repositories/services.
2. Evaluate pure rules against the snapshot.
```

Contoh:

```java
SubmitCaseContext context = submitCaseContextFactory.build(command, actor);
RuleResult result = submitCasePolicy.evaluate(context);
```

Context factory boleh query DB. Rule evaluator sebaiknya pure.

---

## 31. Context Factory Pattern

```java
public final class SubmitCaseContextFactory {
    private final CaseRepository caseRepository;
    private final ApplicantRepository applicantRepository;
    private final ComplianceQueryService complianceQueryService;
    private final Clock clock;

    public SubmitCaseContextFactory(
            CaseRepository caseRepository,
            ApplicantRepository applicantRepository,
            ComplianceQueryService complianceQueryService,
            Clock clock
    ) {
        this.caseRepository = caseRepository;
        this.applicantRepository = applicantRepository;
        this.complianceQueryService = complianceQueryService;
        this.clock = clock;
    }

    public SubmitCaseContext build(SubmitCaseCommand command, OfficerActor actor) {
        CaseAggregate caseAggregate = caseRepository.getById(command.caseId());
        ApplicantSnapshot applicant = applicantRepository.snapshotOf(caseAggregate.applicantId());
        ApplicantComplianceSnapshot compliance = complianceQueryService.snapshotOf(caseAggregate.applicantId());

        CaseAggregate enrichedCase = caseAggregate.withComplianceSnapshot(compliance);

        return new SubmitCaseContext(
                enrichedCase,
                applicant,
                actor,
                LocalDate.now(clock),
                command.channel(),
                enrichedCase.jurisdiction(),
                PolicyVersion.current()
        );
    }
}
```

Dengan ini:

- query terpusat,
- rule tetap pure,
- snapshot bisa diaudit,
- test bisa membuat context manual,
- performance bisa dioptimalkan.

---

## 32. Rule Engine: Kapan Layak?

Jangan terlalu cepat memakai rule engine. Tetapi jangan juga menolak jika problem memang sudah membutuhkannya.

### 32.1 Cukup pakai code/specification jika:

- rule tidak terlalu banyak,
- rule berubah bersama release cycle,
- engineer mengelola rule,
- compile-time safety penting,
- rule bisa diuji dengan unit/integration tests,
- domain butuh explicit code review.

### 32.2 Pertimbangkan rule engine/config-driven rule jika:

- rule sangat banyak,
- rule sering berubah tanpa deploy,
- rule dikelola non-engineer,
- rule punya effective date,
- rule berbeda per jurisdiction/tenant,
- perlu simulation/what-if,
- perlu explainability formal,
- perlu approval workflow untuk rule change,
- perlu audit rule version jangka panjang.

### 32.3 Risiko rule engine:

- debugging lebih sulit,
- type-safety menurun,
- performance unpredictable,
- rule conflict/priority kompleks,
- test matrix meledak,
- business logic tersebar di luar code,
- deployment/config governance berat.

Top-tier engineer tidak anti-rule-engine, tetapi menuntut governance sebelum rule engine dipakai.

---

## 33. Externalized Rule without Chaos

Jika rule externalized ke config/DB, jangan hanya simpan expression bebas.

Hindari:

```text
rule_expression = "applicant.age > 18 && case.amount < 100000"
```

Kecuali governance sangat matang.

Lebih baik typed config:

```yaml
ruleId: CASE_SUBMIT_AGE_001
version: 2026.06
type: MINIMUM_AGE
parameters:
  minimumAge: 18
enforcement: BLOCK
effectiveFrom: 2026-06-01
```

Lalu code evaluator tetap typed:

```java
public final class MinimumAgeRule implements DomainRule<ApplicantEligibilityContext> {
    private final int minimumAge;

    public MinimumAgeRule(int minimumAge) {
        this.minimumAge = minimumAge;
    }

    @Override
    public RuleResult evaluate(ApplicantEligibilityContext context) {
        if (context.applicantAge() >= minimumAge) {
            return RuleResult.pass();
        }

        return RuleResult.of(/* violation */);
    }
}
```

Typed config menjaga:

- validation config,
- testability,
- explainability,
- limited blast radius,
- no arbitrary code execution,
- safer approval process.

---

## 34. Rule Result as First-Class Domain Artifact

Jangan treat rule result hanya sebagai exception message.

Rule result bisa dipakai untuk:

- API response,
- FE eligibility endpoint,
- audit trail,
- analytics,
- dashboard,
- case note,
- business report,
- appeal pack,
- rule tuning,
- regression test,
- automated remediation.

Contoh eligibility endpoint:

```http
GET /cases/{caseId}/actions/submit/eligibility
```

Response:

```json
{
  "action": "SUBMIT",
  "eligible": false,
  "decision": "BLOCK",
  "policyVersion": "2026.06",
  "blockingRules": [
    {
      "ruleId": "CASE_SUBMIT_002",
      "code": "case.submit.inactiveApplicant",
      "target": "applicant.status",
      "message": "Applicant is not active"
    }
  ],
  "warnings": [
    {
      "ruleId": "CASE_SUBMIT_010",
      "code": "case.submit.recommendedEvidenceMissing",
      "target": "case.evidence",
      "message": "Some recommended evidence is missing"
    }
  ]
}
```

Ini jauh lebih user-friendly daripada user menekan submit lalu mendapat error generik.

---

## 35. Exception vs Result Object

Untuk validation/rule evaluation, biasanya result object lebih baik daripada exception.

Gunakan result object untuk expected business rejection:

```java
RuleResult result = policy.evaluate(context);
if (result.hasBlockingViolation()) {
    return SubmitCaseResult.blocked(result);
}
```

Gunakan exception untuk unexpected failure:

- database down,
- external dependency unavailable,
- invariant corrupt,
- programming error,
- invalid system configuration.

Jangan gunakan exception sebagai control flow untuk setiap rule failure jika rule failure adalah outcome normal bisnis.

---

## 36. Integrasi dengan Jakarta Validation

Bagaimana menggabungkan Jakarta Validation dan domain policy dengan bersih?

### 36.1 Flow REST command

```text
1. Parse JSON
2. Bind DTO
3. Jakarta Validation DTO
4. Map DTO -> command
5. Optional command validation
6. Load aggregate/snapshots
7. Evaluate domain policy
8. If blocked -> return policy error
9. Execute aggregate method
10. Save with DB constraints as final authority
11. Emit event
```

### 36.2 Sample orchestrator

```java
public final class SubmitCaseApplicationService {
    private final Validator jakartaValidator;
    private final SubmitCaseContextFactory contextFactory;
    private final SubmitCasePolicy policy;
    private final CaseRepository caseRepository;

    public SubmitCaseApplicationService(
            Validator jakartaValidator,
            SubmitCaseContextFactory contextFactory,
            SubmitCasePolicy policy,
            CaseRepository caseRepository
    ) {
        this.jakartaValidator = jakartaValidator;
        this.contextFactory = contextFactory;
        this.policy = policy;
        this.caseRepository = caseRepository;
    }

    public SubmitCaseResponse submit(SubmitCaseRequest request, OfficerActor actor) {
        Set<ConstraintViolation<SubmitCaseRequest>> violations = jakartaValidator.validate(request);
        if (!violations.isEmpty()) {
            return SubmitCaseResponse.invalidRequest(violations);
        }

        SubmitCaseCommand command = request.toCommand();
        SubmitCaseContext context = contextFactory.build(command, actor);
        RuleResult policyResult = policy.evaluate(context);

        if (policyResult.hasBlockingViolation()) {
            return SubmitCaseResponse.blocked(policyResult);
        }

        CaseAggregate aggregate = context.caseAggregate();
        aggregate.submit(actor, LocalDateTime.now());
        caseRepository.save(aggregate);

        return SubmitCaseResponse.success(aggregate.id(), policyResult);
    }
}
```

Catatan: dalam production, `LocalDateTime.now()` sebaiknya tetap lewat `Clock`.

---

## 37. Testing Strategy

### 37.1 Unit test rule individu

```java
@Test
public void shouldBlockWhenCaseIsNotDraft() {
    SubmitCaseContext context = TestContexts.submitCase()
            .withCaseStatus(CaseStatus.SUBMITTED)
            .build();

    RuleResult result = new CaseMustBeDraftRule().evaluate(context);

    assertTrue(result.hasBlockingViolation());
    assertEquals("CASE_SUBMIT_001", result.violations().get(0).ruleId());
}
```

### 37.2 Test policy composition

```java
@Test
public void shouldAccumulateWarningsButBlockOnApplicantInactive() {
    SubmitCaseContext context = TestContexts.submitCase()
            .withApplicantStatus(ApplicantStatus.INACTIVE)
            .withMissingRecommendedEvidenceCount(2)
            .build();

    RuleResult result = submitPolicy.evaluate(context);

    assertTrue(result.hasBlockingViolation());
    assertContainsRule(result, "CASE_SUBMIT_002");
    assertContainsRule(result, "CASE_SUBMIT_010");
}
```

### 37.3 Golden file test API response

Pastikan error response stabil.

```text
src/test/resources/golden/submit-case-inactive-applicant-response.json
```

### 37.4 Rule catalog coverage test

Pastikan setiap rule di catalog punya test.

```java
@Test
public void everyRuleInCatalogShouldHaveTestCoverage() {
    Set<String> catalogRuleIds = ruleCatalog.ruleIds();
    Set<String> testedRuleIds = ruleTestRegistry.testedRuleIds();

    assertEquals(catalogRuleIds, testedRuleIds);
}
```

Implementation bisa sederhana: convention test class name, annotation `@CoversRule`, atau metadata manual.

### 37.5 Property-based testing

Untuk rule numerik/temporal:

- deadline,
- amount threshold,
- age,
- grace period,
- SLA,
- date range.

Property-based testing bisa menemukan edge case:

- boundary date,
- leap day,
- timezone shift,
- inclusive/exclusive bug,
- integer overflow,
- rounding bug.

---

## 38. Observability untuk Domain Rule

Metrics yang berguna:

```text
rule_evaluations_total{ruleId,version,decision}
rule_failures_total{ruleId,version,severity,action}
policy_decision_total{policy,decision}
policy_evaluation_latency_ms{policy}
rule_evaluation_latency_ms{ruleId}
rule_warning_total{ruleId}
rule_block_total{ruleId}
```

Logging harus aman:

```json
{
  "event": "policy_decision",
  "policy": "SubmitCasePolicy",
  "policyVersion": "2026.06",
  "decision": "BLOCK",
  "ruleIds": ["CASE_SUBMIT_002"],
  "caseId": "CASE-2026-0001",
  "actorIdHash": "...",
  "traceId": "..."
}
```

Jangan log:

- full NRIC/NIK/passport,
- raw address,
- full document text,
- secrets,
- raw external API payload,
- unmasked rejected value.

---

## 39. Performance Model

Policy evaluation cost bisa besar jika rule:

- query database,
- call external API,
- traverse large object graph,
- evaluate complex regex,
- load reference data per request,
- evaluate redundant rules,
- run all expensive checks meski cheap check sudah block.

Guideline:

1. Put cheap deterministic checks first.
2. Build snapshots in bulk.
3. Avoid per-rule repository call.
4. Avoid per-row DB call in batch import.
5. Cache stable reference data.
6. Separate fail-fast blocking stage from warning/advisory stage.
7. Measure rule latency per rule id.
8. Keep rule pure where possible.

---

## 40. Java 8 sampai Java 25 Modeling Notes

### Java 8

- Gunakan final class biasa.
- Gunakan immutable object manual.
- Gunakan `Optional` hati-hati, terutama bukan sebagai field DTO default.
- Functional interface bisa membantu specification composition.

### Java 11

- Tidak banyak perubahan modeling fundamental.
- Library ecosystem lebih stabil.

### Java 17

- Records tersedia dan cocok untuk context/result object.
- Sealed classes bisa memodelkan decision/result variants.
- Jakarta Validation 3.1/Hibernate Validator 9 menargetkan Java 17+ pada stack modern.

### Java 21

- Pattern matching dan sealed hierarchy membuat result modeling lebih expressive.
- Virtual threads tidak mengubah semantics rule, tetapi latency blocking rule harus tetap diukur.

### Java 25

- Treat modern Java sebagai baseline untuk desain baru jika platform memungkinkan.
- Namun library enterprise mungkin masih mengikuti Java 17 LTS baseline.
- Desain rule sebaiknya tidak bergantung pada fitur preview agar stabil untuk production.

Contoh Java 17+ record:

```java
public record RuleViolationRecord(
        String ruleId,
        String ruleVersion,
        RuleSeverity severity,
        RuleDecision decision,
        String code,
        String messageKey,
        String target,
        Map<String, Object> evidence,
        String remediationKey
) {
    public RuleViolationRecord {
        Objects.requireNonNull(ruleId);
        Objects.requireNonNull(ruleVersion);
        Objects.requireNonNull(severity);
        Objects.requireNonNull(decision);
        evidence = evidence == null ? Map.of() : Map.copyOf(evidence);
    }
}
```

---

## 41. Migration dari Annotation-heavy System

Jika codebase sudah penuh annotation business rule, jangan langsung rewrite semua.

### Step 1: Inventory

Cari custom constraints yang:

- inject repository/service,
- call database,
- call external API,
- depend on current user,
- depend on workflow status,
- depend on time,
- depend on other aggregate,
- have complex conditional logic.

### Step 2: Classify

Kelompokkan:

```text
A. tetap Jakarta Validation
B. pindah ke class-level constraint
C. pindah ke command validator
D. pindah ke domain policy
E. pindah ke database constraint
F. pindah ke authorization layer
G. pindah ke workflow guard
```

### Step 3: Preserve API contract

Jangan ubah error response tanpa versioning.

### Step 4: Introduce policy object behind same service

Mulai dari satu operation paling kompleks.

### Step 5: Add rule id/version

Bahkan sebelum semua rule dipindah, mulai tambahkan metadata.

### Step 6: Add tests

Golden response test + rule-level tests.

### Step 7: Remove dependency-heavy validators

Pindahkan DB/external check ke context factory + policy.

---

## 42. Anti-Patterns

### 42.1 Annotation as business process engine

DTO penuh dengan group dan custom validators yang menentukan workflow.

### 42.2 Boolean rule result

Rule hanya return true/false tanpa evidence.

### 42.3 Service method with 500 lines of `if`

Tidak lebih baik dari annotation chaos. Rule tetap perlu object/model.

### 42.4 Rule without owner

Tidak ada yang tahu siapa pemilik rule.

### 42.5 Rule without version

Audit tidak bisa menjelaskan keputusan lama.

### 42.6 Rule hidden in SQL only

Rule hanya ada di query repository, tidak terlihat sebagai policy.

### 42.7 External call inside validator/rule without classification

Timeout dianggap invalid input.

### 42.8 No distinction between warning and blocking

Semua gagal dianggap sama.

### 42.9 FE-only eligibility

Backend tetap harus authoritative.

### 42.10 No test per rule

Rule berubah tanpa regression safety.

---

## 43. Production Checklist

Sebelum membuat rule domain baru, jawab:

1. Apakah ini shape validation atau domain policy?
2. Apakah rule bisa dinilai dari satu object saja?
3. Apakah butuh actor/current user?
4. Apakah butuh workflow state?
5. Apakah butuh external data?
6. Apakah butuh database consistency?
7. Apakah failure harus 400, 403, 409, 422, atau 503?
8. Apakah rule blocking, warning, observe-only, atau escalation?
9. Apakah butuh rule id?
10. Apakah butuh rule version?
11. Apakah evidence perlu disimpan?
12. Apakah evidence aman dari PII leakage?
13. Apakah rule bisa dites secara pure?
14. Apakah rule punya owner?
15. Apakah rule perlu effective date?
16. Apakah rule berlaku per jurisdiction/tenant/channel?
17. Apakah rule bisa berubah tanpa deploy?
18. Apakah rule punya metrics?
19. Apakah ada DB constraint sebagai final authority jika menyangkut uniqueness/integrity?
20. Apakah FE perlu eligibility endpoint?

---

## 44. Mental Model Akhir

Gunakan rumus ini:

```text
Jakarta Validation:
  local, declarative, mostly context-free, object/method contract.

Custom Constraint:
  reusable local semantic rule, still deterministic and cheap.

Class-level Constraint:
  consistency inside one object.

Command Validator:
  operation-specific request/command sanity.

Specification:
  reusable domain predicate/rule.

Policy Object:
  action-context decision with actor/state/time/version/evidence.

Workflow Guard:
  transition-specific state machine protection.

Database Constraint:
  final integrity authority.

Rule Engine:
  externalized high-change rule set with governance.
```

Top-tier engineer tidak bertanya: “bisa tidak rule ini dibuat annotation?”

Pertanyaan yang lebih benar:

```text
Di layer mana rule ini paling jujur, paling terlihat, paling testable,
paling defensible, dan paling aman ketika sistem berubah?
```

---

## 45. Ringkasan

Bagian ini membahas bahwa advanced validation tidak berhenti di `@NotNull`, `@Valid`, group, atau custom constraint.

Untuk sistem besar, terutama case management/regulatory system, kita butuh rule modeling eksplisit:

- specification untuk reusable criteria,
- policy object untuk action-context decision,
- rule result untuk structured explainability,
- severity dan enforcement mode,
- evidence untuk audit,
- rule version untuk defensibility,
- staged evaluation untuk dependency/cost control,
- context factory untuk memisahkan data loading dari pure rule evaluation,
- clear API mapping untuk membedakan invalid input, forbidden action, conflict, policy block, dan dependency failure.

Jakarta Validation tetap sangat penting, tetapi sebaiknya digunakan sesuai fit-nya: object-level/method-level constraint declaration, metadata, graph validation, dan local correctness. Business policy yang membutuhkan context harus dimodelkan sebagai policy/rule layer eksplisit.

---

## 46. Referensi

- Jakarta Validation 3.1 Specification — mendefinisikan object-level constraint declaration, metadata repository/query API, serta method/constructor validation.
- Bean Validation / Jakarta Validation official site — menjelaskan capability utama Jakarta Validation: constraints pada object model, custom constraints, object graph validation, method/constructor parameter dan return value validation, serta localized violation reporting.
- Hibernate Validator Reference Guide 9.x — reference implementation untuk Jakarta Validation 3.1 dan dokumentasi fitur provider-specific.
- Hibernate Validator 9.0 release notes — menjelaskan target Jakarta EE 11, Jakarta Validation 3.1, dan minimum Java 17 pada stack tersebut.
- Martin Fowler, Specification pattern/contextual validation writings — basis konseptual untuk memisahkan contextual business rule dari object-local validation.

---

## 47. Status Seri

Seri **belum selesai**.

Bagian ini adalah:

```text
023 - Advanced Domain Rule Modeling: Specification Pattern, Policy Objects, and Validators
```

Bagian berikutnya:

```text
024 - Performance Engineering: Cost Model, Fail Fast, Caching, Reflection, Hot Paths
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-022.md">⬅️ Validation for Workflow, State Machines, and Regulatory Case Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-024.md">Performance Engineering: Cost Model, Fail Fast, Caching, Reflection, Hot Paths ➡️</a>
</div>

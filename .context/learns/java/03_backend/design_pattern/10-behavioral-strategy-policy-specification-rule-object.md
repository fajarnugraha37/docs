# Part 10 — Behavioral Pattern I: Strategy, Policy, Specification, Rule Object

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `10-behavioral-strategy-policy-specification-rule-object.md`  
> Target: Java 8–25  
> Level: Advanced / Staff Engineer / Architecture Judgment

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi structural pattern: bagaimana membentuk boundary, membungkus dependency eksternal, menyederhanakan API internal, dan menahan coupling. Mulai part ini kita masuk ke **behavioral patterns**, yaitu pattern yang mengatur **bagaimana perilaku dipilih, digabungkan, dieksekusi, dan dievolusi**.

Part ini fokus pada empat pattern yang sering muncul di sistem enterprise Java:

1. **Strategy** — memilih algoritma/perilaku yang dapat dipertukarkan.
2. **Policy** — merepresentasikan aturan keputusan yang memiliki konsekuensi bisnis.
3. **Specification** — merepresentasikan predicate/domain rule yang dapat dinamai, diuji, dan dikomposisi.
4. **Rule Object** — menjadikan rule sebagai objek eksplisit yang memiliki identity, priority, reason, applicability, dan evaluation result.

Ini adalah pattern yang sangat penting untuk sistem regulatory, enforcement, eligibility, approval, workflow, risk scoring, fee calculation, validation, authorization, notification routing, dan case lifecycle.

Pattern ini terlihat sederhana, tetapi salah penerapannya bisa menghasilkan beberapa anti-pattern berbahaya:

- `if-else` raksasa yang tidak bisa diaudit.
- `switch` panjang berbasis string/status/type.
- rule tersebar di controller, service, repository, mapper, dan frontend.
- rule yang berubah tanpa traceability.
- rule yang benar secara teknis tetapi tidak defensible secara bisnis.
- over-engineered rule engine padahal rule masih stabil dan sedikit.
- enum strategy yang berubah menjadi god object.
- lambda strategy yang ringkas tetapi tidak observable.

Tujuan part ini bukan membuat semua hal menjadi pattern, tetapi membangun judgment:

> Kapan decision logic cukup ditulis langsung, kapan perlu Strategy, kapan perlu Specification, kapan perlu Policy, kapan perlu Rule Object, dan kapan perlu rule engine?

---

## 1. Tujuan Pembelajaran

Setelah mempelajari part ini, Anda diharapkan mampu:

1. Memahami Strategy sebagai mekanisme memilih behavior, bukan sekadar mengganti `if-else`.
2. Membedakan Strategy, Policy, Specification, Rule Object, Validator, dan Rule Engine.
3. Mendesain rule bisnis yang eksplisit, testable, composable, dan audit-friendly.
4. Menghindari overengineering ketika rule masih sederhana.
5. Menghindari underengineering ketika rule sudah menjadi decision system yang kompleks.
6. Memahami dampak Java 8–25 terhadap penerapan behavioral pattern.
7. Menggunakan lambda, functional interface, enum, sealed interface, record, dan pattern matching secara tepat.
8. Mendesain evaluation result yang membawa reason, evidence, dan severity.
9. Mengelola rule priority, short-circuiting, aggregation, conflict, dan override.
10. Menentukan refactoring path dari procedural decision logic menuju rule model yang sehat.
11. Menguji rule secara granular, combinatorial, property-based, dan scenario-based.
12. Membuat decision logic yang dapat dijelaskan kepada developer, QA, BA, auditor, dan stakeholder domain.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan service Java berikut:

```java
public Decision approve(Application app, User user) {
    if (!user.hasRole("OFFICER")) {
        return Decision.reject("User is not officer");
    }

    if (app.getStatus().equals("SUBMITTED")) {
        if (app.getApplicant().isBlacklisted()) {
            return Decision.reject("Applicant blacklisted");
        }

        if (app.getAmount().compareTo(new BigDecimal("50000")) > 0) {
            if (!user.hasRole("SENIOR_OFFICER")) {
                return Decision.escalate("High amount needs senior officer");
            }
        }

        if (app.getDocuments().isEmpty()) {
            return Decision.reject("Missing documents");
        }

        return Decision.approve();
    }

    if (app.getStatus().equals("RESUBMITTED")) {
        if (app.getPreviousRejectionReason() != null) {
            if (!app.hasAddressChanged() && app.getDocuments().isEmpty()) {
                return Decision.reject("No material change");
            }
        }
        return Decision.approve();
    }

    return Decision.reject("Unsupported status");
}
```

Kode ini mungkin awalnya masuk akal. Tetapi setelah 6 bulan:

- Ada exception rule untuk agency tertentu.
- Ada rule baru untuk high-risk profile.
- Ada rule berbeda untuk individual dan corporate applicant.
- Ada threshold yang berubah berdasarkan effective date.
- Ada override oleh supervisor.
- Ada audit reason yang harus disimpan.
- Ada dashboard yang ingin tahu rule mana yang paling sering gagal.
- Ada QA yang minta trace kenapa aplikasi A ditolak.
- Ada production issue karena rule lama masih jalan untuk status baru.

Masalahnya bukan hanya kode panjang. Masalah sebenarnya adalah **decision logic tidak memiliki bentuk desain yang eksplisit**.

Rule bisnis berubah menjadi campuran:

- authorization,
- status transition,
- validation,
- risk scoring,
- routing,
- escalation,
- domain decision,
- technical guard,
- presentation message.

Ketika semua itu ditulis sebagai conditional flow di satu method, sistem kehilangan kemampuan untuk menjawab pertanyaan penting:

```text
Rule apa saja yang berlaku?
Rule mana yang gagal?
Kenapa rule itu gagal?
Apakah semua rule dievaluasi atau berhenti di rule pertama?
Siapa pemilik rule?
Apakah rule ini domain rule, authorization rule, atau workflow guard?
Apakah rule ini berlaku untuk semua case atau hanya subset?
Apa efek rule terhadap state transition?
Bagaimana menguji kombinasi rule?
Bagaimana mengubah rule tanpa merusak rule lain?
```

Pattern dalam part ini menyelesaikan masalah tersebut dengan cara bertahap.

---

## 3. Mental Model Utama

### 3.1 Behavior Selection vs Decision Explanation

Banyak engineer menyamakan semua rule pattern dengan “menghilangkan if-else”. Itu kurang tepat.

Ada dua problem berbeda:

```text
Behavior Selection:
    Sistem perlu memilih satu algoritma/perilaku dari beberapa opsi.
    Cocok untuk Strategy.

Decision Explanation:
    Sistem perlu mengevaluasi aturan, menghasilkan alasan, evidence, dan konsekuensi.
    Cocok untuk Policy, Specification, Rule Object.
```

Contoh behavior selection:

```text
Gunakan pricing algorithm A untuk normal customer.
Gunakan pricing algorithm B untuk premium customer.
Gunakan pricing algorithm C untuk government customer.
```

Contoh decision explanation:

```text
Application rejected karena:
- applicant masuk blacklist,
- dokumen mandatory tidak lengkap,
- profile risk level HIGH membutuhkan escalation.
```

Strategy cukup menjawab:

```text
Perilaku mana yang dipakai?
```

Policy/Specification/Rule Object harus menjawab:

```text
Keputusan apa yang diambil?
Kenapa?
Berdasarkan rule mana?
Dengan evidence apa?
Apakah rule itu mandatory, advisory, blocking, atau escalation?
```

### 3.2 Rule bukan hanya predicate

Predicate seperti ini terlihat menggoda:

```java
Predicate<Application> completeDocuments = app -> !app.documents().isEmpty();
```

Tetapi untuk enterprise decision, predicate sering tidak cukup. Kita butuh:

- nama rule,
- deskripsi rule,
- reason ketika gagal,
- severity,
- category,
- owner,
- effective date,
- evidence,
- remediation hint,
- audit code,
- applicability condition,
- conflict behavior.

Maka rule yang matang biasanya bukan hanya:

```java
boolean test(Application app);
```

Melainkan:

```java
RuleEvaluation evaluate(Application app, DecisionContext context);
```

### 3.3 Pattern sebagai tahapan evolusi

Jangan langsung lompat ke rule engine. Evolusi yang sehat biasanya seperti ini:

```text
Step 1: Simple conditional
Step 2: Extract method with clear name
Step 3: Strategy when behavior varies by type/context
Step 4: Specification when predicate/domain rule must be named and composed
Step 5: Policy when rule set represents business decision boundary
Step 6: Rule Object when rule needs metadata, reason, priority, audit, lifecycle
Step 7: Rule Engine only when rule authoring/effective dating/dynamic configuration truly needed
```

Top engineer tidak berpikir:

```text
Ada if-else, berarti harus pakai pattern.
```

Top engineer berpikir:

```text
Apa volatility axis-nya?
Apakah rule berubah sering?
Apakah rule harus diaudit?
Apakah rule harus dikomposisi?
Apakah rule perlu dijalankan sebagian atau seluruhnya?
Apakah stakeholder non-engineer perlu memahami rule?
Apakah runtime configurability benar-benar dibutuhkan?
```

---

## 4. Pattern 1 — Strategy

### 4.1 Intent

Strategy adalah behavioral pattern yang mendefinisikan satu family of algorithms, mengenkapsulasi setiap algoritma, lalu membuat algoritma tersebut interchangeable di dalam context.

Dalam bahasa sederhana:

> Strategy digunakan ketika objek perlu melakukan satu pekerjaan, tetapi cara melakukan pekerjaan itu bisa berbeda-beda.

Contoh:

- menghitung fee,
- memilih notification channel,
- memilih retry policy,
- memilih export format,
- memilih sorting algorithm,
- memilih document rendering method,
- memilih routing algorithm,
- memilih risk scoring algorithm.

### 4.2 Struktur Dasar

```java
public interface FeeStrategy {
    Money calculate(FeeInput input);
}

public final class StandardFeeStrategy implements FeeStrategy {
    @Override
    public Money calculate(FeeInput input) {
        return input.baseAmount().multiply("0.02");
    }
}

public final class PremiumFeeStrategy implements FeeStrategy {
    @Override
    public Money calculate(FeeInput input) {
        return input.baseAmount().multiply("0.01");
    }
}
```

Context:

```java
public final class FeeCalculator {
    private final FeeStrategy strategy;

    public FeeCalculator(FeeStrategy strategy) {
        this.strategy = Objects.requireNonNull(strategy);
    }

    public Money calculate(FeeInput input) {
        return strategy.calculate(input);
    }
}
```

Selector:

```java
public final class FeeStrategySelector {
    private final Map<CustomerType, FeeStrategy> strategies;

    public FeeStrategySelector(Map<CustomerType, FeeStrategy> strategies) {
        this.strategies = Map.copyOf(strategies);
    }

    public FeeStrategy select(CustomerType type) {
        FeeStrategy strategy = strategies.get(type);
        if (strategy == null) {
            throw new UnsupportedOperationException("No fee strategy for " + type);
        }
        return strategy;
    }
}
```

Usage:

```java
FeeStrategy strategy = selector.select(customer.type());
Money fee = strategy.calculate(input);
```

### 4.3 Kapan Strategy Cocok

Gunakan Strategy ketika:

1. Ada beberapa algoritma yang melakukan tujuan sama.
2. Caller tidak perlu tahu detail algoritma.
3. Algoritma bisa berubah tanpa mengubah context.
4. Algoritma memiliki lifecycle/dependency sendiri.
5. Algoritma perlu diuji terpisah.
6. Pemilihan algoritma bisa didasarkan pada context, configuration, tenant, product type, atau status.

Contoh bagus:

```text
ExportStrategy:
- CsvExportStrategy
- PdfExportStrategy
- XlsxExportStrategy

NotificationStrategy:
- EmailNotificationStrategy
- SmsNotificationStrategy
- PushNotificationStrategy

AddressResolutionStrategy:
- PostalCodeLookupStrategy
- ManualAddressStrategy
- ExternalMapApiStrategy
```

### 4.4 Kapan Strategy Tidak Cocok

Jangan gunakan Strategy jika:

1. Variasinya hanya satu baris trivial dan tidak punya nama domain.
2. Algoritma tidak akan berubah.
3. Pemilihan strategy justru lebih kompleks dari algoritmanya.
4. Strategy hanya memindahkan `if-else` ke class berbeda tanpa mengurangi coupling.
5. Setiap strategy tetap membaca banyak global state.
6. Strategy tidak interchangeable karena contract-nya tidak benar-benar sama.

Anti-contoh:

```java
interface BooleanStrategy {
    boolean apply(User user);
}

class IsAdminStrategy implements BooleanStrategy {
    public boolean apply(User user) {
        return user.role().equals("ADMIN");
    }
}
```

Kalau hanya ini, method biasa mungkin lebih jelas:

```java
user.isAdmin()
```

### 4.5 Strategy dengan Java 8 Lambda

Java 8 membuat Strategy jauh lebih ringan karena functional interface.

```java
@FunctionalInterface
public interface DiscountStrategy {
    Money apply(Order order);
}
```

Implementasi:

```java
DiscountStrategy noDiscount = order -> Money.zero(order.currency());

DiscountStrategy percentage10 = order ->
        order.total().multiply("0.10");
```

Selector:

```java
public final class DiscountStrategies {
    private final Map<CustomerSegment, DiscountStrategy> strategies;

    public DiscountStrategies() {
        this.strategies = Map.of(
                CustomerSegment.REGULAR, order -> Money.zero(order.currency()),
                CustomerSegment.PREMIUM, order -> order.total().multiply("0.10"),
                CustomerSegment.VIP, order -> order.total().multiply("0.20")
        );
    }

    public DiscountStrategy forSegment(CustomerSegment segment) {
        return strategies.getOrDefault(segment, strategies.get(CustomerSegment.REGULAR));
    }
}
```

Lambda bagus ketika behavior:

- kecil,
- stateless,
- tidak butuh dependency kompleks,
- tidak butuh metadata,
- tidak butuh observability khusus.

Lambda buruk ketika behavior:

- panjang,
- punya dependency banyak,
- perlu nama domain jelas,
- perlu logging/metrics/audit sendiri,
- perlu debugging stack trace yang jelas,
- perlu reuse luas.

Rule praktis:

```text
Lambda untuk behavior kecil.
Class untuk behavior penting.
Record untuk behavior dengan parameter tetap.
Sealed hierarchy untuk closed set of behavior.
```

### 4.6 Strategy dengan Enum

Enum strategy sering dipakai untuk variasi kecil yang closed set.

```java
public enum FeeMode {
    STANDARD {
        @Override
        Money calculate(FeeInput input) {
            return input.amount().multiply("0.02");
        }
    },
    PREMIUM {
        @Override
        Money calculate(FeeInput input) {
            return input.amount().multiply("0.01");
        }
    };

    abstract Money calculate(FeeInput input);
}
```

Ini ringkas, tetapi ada risiko:

- enum menjadi god object,
- sulit inject dependency,
- sulit test dengan mock dependency,
- sulit extend dari module lain,
- rawan bercampur dengan persistence/API enum.

Enum strategy cocok untuk:

- variasi kecil,
- stateless,
- closed set,
- logic sederhana,
- tidak butuh dependency eksternal.

Enum strategy tidak cocok untuk:

- rule enterprise kompleks,
- dependency ke repository/API,
- tenant-specific behavior,
- runtime extensibility,
- behavior yang berubah sering.

### 4.7 Strategy dengan Sealed Interface

Java modern memungkinkan closed strategy hierarchy dengan sealed interface.

```java
public sealed interface RiskScoringStrategy
        permits IndividualRiskScoring, CorporateRiskScoring {

    RiskScore score(RiskInput input);
}

public final class IndividualRiskScoring implements RiskScoringStrategy {
    public RiskScore score(RiskInput input) {
        return RiskScore.from(input.identityRisk(), input.transactionRisk());
    }
}

public final class CorporateRiskScoring implements RiskScoringStrategy {
    public RiskScore score(RiskInput input) {
        return RiskScore.from(input.companyRisk(), input.directorRisk());
    }
}
```

Sealed hierarchy berguna ketika:

- variasi known/closed,
- compile-time exhaustiveness penting,
- domain alternatives jelas,
- ingin mencegah subclass liar.

Tetapi jika strategy perlu plugin eksternal, sealed interface bisa terlalu membatasi.

---

## 5. Pattern 2 — Policy

### 5.1 Apa itu Policy?

Policy adalah objek yang merepresentasikan aturan keputusan pada level domain/application.

Policy biasanya menjawab:

```text
Apakah aksi ini boleh?
Apakah case ini perlu escalation?
Apakah application ini eligible?
Apakah sanction ini applicable?
Apakah renewal ini allowed?
```

Policy berbeda dari Strategy.

Strategy memilih **cara melakukan sesuatu**.

Policy menentukan **boleh/tidak, wajib/tidak, perlu/tidak, valid/tidak, escalate/tidak**.

Contoh policy:

```java
public interface ApprovalPolicy {
    ApprovalDecision evaluate(Application application, Officer officer);
}
```

### 5.2 Policy Output Tidak Sebaiknya Boolean Saja

Policy yang hanya mengembalikan boolean sering kehilangan informasi penting.

Kurang baik:

```java
boolean canApprove(Application app, User user);
```

Lebih baik:

```java
public record ApprovalDecision(
        DecisionOutcome outcome,
        List<DecisionReason> reasons
) {
    public boolean approved() {
        return outcome == DecisionOutcome.APPROVED;
    }
}

public enum DecisionOutcome {
    APPROVED,
    REJECTED,
    ESCALATED,
    NEEDS_MORE_INFORMATION
}

public record DecisionReason(
        String code,
        String message,
        Severity severity,
        Map<String, Object> evidence
) {}
```

Mengapa?

Karena di sistem enterprise, keputusan harus bisa dijelaskan.

```text
Boolean menjawab apa.
Decision object menjawab apa + kenapa + berdasarkan evidence apa.
```

### 5.3 Policy Sebagai Boundary

Policy harus berada di tempat yang tepat.

Contoh buruk:

```java
@RestController
public class ApprovalController {
    @PostMapping("/approve")
    public ResponseEntity<?> approve(@RequestBody ApprovalRequest request) {
        if (request.amount() > 50000 && !currentUser.hasRole("SENIOR")) {
            return ResponseEntity.status(403).build();
        }
        // ...
    }
}
```

Rule domain/application bocor ke controller.

Lebih baik:

```java
public final class ApprovalApplicationService {
    private final ApprovalPolicy approvalPolicy;
    private final ApplicationRepository applications;

    public ApprovalResult approve(ApproveApplicationCommand command) {
        Application app = applications.get(command.applicationId());
        Officer officer = command.officer();

        ApprovalDecision decision = approvalPolicy.evaluate(app, officer);
        if (!decision.approved()) {
            return ApprovalResult.denied(decision.reasons());
        }

        app.approveBy(officer);
        applications.save(app);
        return ApprovalResult.approved(app.id());
    }
}
```

Policy menjadi decision boundary yang jelas.

### 5.4 Policy vs Authorization

Authorization policy dan domain policy sering bercampur.

Contoh:

```text
User boleh approve karena punya role SENIOR_OFFICER.
Application boleh di-approve karena dokumen lengkap.
Application perlu escalate karena amount tinggi.
```

Ini tiga hal berbeda:

1. **Authorization** — apakah user punya hak melakukan action?
2. **Domain validity** — apakah aggregate dalam kondisi yang valid untuk action?
3. **Business decision** — apakah hasilnya approve, reject, atau escalate?

Jangan campur semua ke satu policy raksasa tanpa kategori.

Lebih baik:

```java
public final class ApprovalUseCasePolicy {
    private final AuthorizationPolicy authorizationPolicy;
    private final ApplicationEligibilityPolicy eligibilityPolicy;
    private final EscalationPolicy escalationPolicy;

    public ApprovalDecision evaluate(Application app, Officer officer) {
        DecisionCollector collector = new DecisionCollector();

        collector.add(authorizationPolicy.evaluate(officer, "APPROVE_APPLICATION"));
        collector.add(eligibilityPolicy.evaluate(app));
        collector.add(escalationPolicy.evaluate(app, officer));

        return collector.toDecision();
    }
}
```

### 5.5 Policy dan Effective Date

Di regulatory system, rule sering berubah berdasarkan tanggal berlaku.

Jangan hardcode seperti ini:

```java
if (LocalDate.now().isAfter(LocalDate.of(2026, 1, 1))) {
    threshold = new BigDecimal("100000");
} else {
    threshold = new BigDecimal("50000");
}
```

Masalah:

- sulit test,
- bergantung system clock,
- tidak jelas tanggal evaluasi,
- tidak audit-friendly.

Lebih baik:

```java
public record DecisionContext(
        LocalDate evaluationDate,
        String agencyCode,
        String tenantId,
        String correlationId
) {}
```

Policy:

```java
public final class HighAmountEscalationPolicy {
    private final ThresholdSchedule thresholds;

    public RuleEvaluation evaluate(Application app, Officer officer, DecisionContext context) {
        Money threshold = thresholds.thresholdFor(context.evaluationDate(), app.applicationType());

        if (app.amount().isGreaterThan(threshold) && !officer.isSenior()) {
            return RuleEvaluation.failed(
                    "HIGH_AMOUNT_NEEDS_SENIOR",
                    "Application amount exceeds senior approval threshold",
                    Map.of(
                            "amount", app.amount(),
                            "threshold", threshold,
                            "evaluationDate", context.evaluationDate()
                    )
            );
        }

        return RuleEvaluation.passed("HIGH_AMOUNT_NEEDS_SENIOR");
    }
}
```

---

## 6. Pattern 3 — Specification

### 6.1 Intent

Specification pattern merepresentasikan domain predicate sebagai objek yang dapat:

- diberi nama,
- diuji terpisah,
- digunakan ulang,
- dikomposisi dengan AND/OR/NOT,
- diterjemahkan ke query jika diperlukan,
- membawa makna domain.

Contoh sederhana:

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate)
                && other.isSatisfiedBy(candidate);
    }

    default Specification<T> or(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate)
                || other.isSatisfiedBy(candidate);
    }

    default Specification<T> not() {
        return candidate -> !this.isSatisfiedBy(candidate);
    }
}
```

Contoh:

```java
public final class SubmittedApplicationSpec implements Specification<Application> {
    @Override
    public boolean isSatisfiedBy(Application app) {
        return app.status() == ApplicationStatus.SUBMITTED;
    }
}

public final class CompleteDocumentsSpec implements Specification<Application> {
    @Override
    public boolean isSatisfiedBy(Application app) {
        return app.documents().hasAllMandatoryDocuments();
    }
}
```

Composition:

```java
Specification<Application> approvable =
        new SubmittedApplicationSpec()
                .and(new CompleteDocumentsSpec())
                .and(new NotBlacklistedApplicantSpec());

boolean ok = approvable.isSatisfiedBy(app);
```

### 6.2 Specification sebagai Bahasa Domain

Specification bagus ketika nama rule memiliki makna domain:

```text
SubmittedApplicationSpec
CompleteMandatoryDocumentsSpec
NotBlacklistedApplicantSpec
WithinRenewalWindowSpec
EligibleForFastTrackSpec
RequiresSeniorOfficerSpec
HasMaterialChangeSinceRejectionSpec
```

Nama seperti ini membantu komunikasi dengan BA/QA/domain expert.

Bandingkan dengan:

```java
if (app.getStatus().equals("SUBMITTED") &&
    app.getDocuments().size() > 0 &&
    !app.getApplicant().isBlacklisted()) {
    // ...
}
```

Kode kedua mungkin benar, tetapi tidak menyimpan bahasa domain secara eksplisit.

### 6.3 Specification vs Validation

Specification dan validation mirip, tetapi tidak sama.

Validation biasanya menjawab:

```text
Apakah input/model valid?
```

Specification menjawab:

```text
Apakah objek memenuhi kondisi domain tertentu?
```

Contoh validation:

```text
postalCode tidak boleh kosong.
email harus format valid.
amount harus positif.
```

Contoh specification:

```text
Application eligible for renewal.
Case requires enforcement review.
Officer can approve high-risk application.
Applicant has material change after rejection.
```

Validation sering lebih dekat ke input integrity.
Specification lebih dekat ke domain decision.

### 6.4 Specification dengan Reason

Boolean specification sering tidak cukup. Kita bisa memperkaya output.

```java
public interface ExplainingSpecification<T> {
    RuleEvaluation evaluate(T candidate);
}
```

```java
public final class CompleteMandatoryDocumentsRule
        implements ExplainingSpecification<Application> {

    @Override
    public RuleEvaluation evaluate(Application app) {
        List<DocumentType> missing = app.documents().missingMandatoryDocuments();

        if (!missing.isEmpty()) {
            return RuleEvaluation.failed(
                    "MISSING_MANDATORY_DOCUMENTS",
                    "Mandatory documents are missing",
                    Map.of("missingDocuments", missing)
            );
        }

        return RuleEvaluation.passed("MISSING_MANDATORY_DOCUMENTS");
    }
}
```

Ini mulai bergerak dari Specification menuju Rule Object.

### 6.5 Composite Specification dengan Reason Aggregation

```java
public final class AndSpecification<T> implements ExplainingSpecification<T> {
    private final List<ExplainingSpecification<T>> specifications;

    public AndSpecification(List<ExplainingSpecification<T>> specifications) {
        this.specifications = List.copyOf(specifications);
    }

    @Override
    public RuleEvaluation evaluate(T candidate) {
        List<RuleEvaluation> evaluations = specifications.stream()
                .map(spec -> spec.evaluate(candidate))
                .toList();

        List<DecisionReason> failures = evaluations.stream()
                .filter(RuleEvaluation::failed)
                .flatMap(e -> e.reasons().stream())
                .toList();

        if (!failures.isEmpty()) {
            return RuleEvaluation.failed(
                    "COMPOSITE_AND_FAILED",
                    "One or more required specifications failed",
                    failures
            );
        }

        return RuleEvaluation.passed("COMPOSITE_AND_PASSED");
    }
}
```

Hal penting: AND specification bisa dievaluasi dengan dua mode:

1. **Short-circuit** — berhenti saat satu gagal.
2. **Collect-all** — evaluasi semua untuk mendapatkan semua reason.

Untuk user-facing validation, collect-all biasanya lebih baik.
Untuk expensive rule atau security-sensitive rule, short-circuit mungkin lebih tepat.

### 6.6 Specification dan Query

Salah satu tantangan specification adalah apakah bisa dipakai untuk query database.

In-memory specification:

```java
boolean isSatisfiedBy(Application app);
```

Query specification:

```java
Predicate toJpaPredicate(Root<ApplicationEntity> root, CriteriaBuilder cb);
```

Hati-hati: memaksa satu object untuk selalu bisa in-memory dan database bisa membuat specification terlalu rumit.

Alternatif:

```java
public interface ApplicationSpecification {
    boolean isSatisfiedBy(Application app);
}

public interface ApplicationQuerySpecification {
    Predicate toPredicate(Root<ApplicationEntity> root, CriteriaBuilder cb);
}
```

Atau pisahkan:

```text
Domain Specification: untuk decision.
Query Object: untuk persistence filtering.
```

Jangan memaksa domain rule kompleks yang membutuhkan aggregate behavior diterjemahkan ke SQL jika domain model dan persistence model berbeda.

---

## 7. Pattern 4 — Rule Object

### 7.1 Apa itu Rule Object?

Rule Object adalah object yang merepresentasikan rule sebagai first-class citizen.

Ia biasanya punya:

- id/code,
- name,
- description,
- category,
- severity,
- priority,
- applicability,
- evaluation logic,
- result,
- evidence,
- effective date,
- owner,
- remediation hint.

Contoh interface:

```java
public interface Rule<T> {
    RuleMetadata metadata();

    boolean appliesTo(T target, DecisionContext context);

    RuleEvaluation evaluate(T target, DecisionContext context);
}
```

Metadata:

```java
public record RuleMetadata(
        String code,
        String name,
        RuleCategory category,
        RuleSeverity severity,
        int priority,
        String owner
) {}
```

Evaluation:

```java
public record RuleEvaluation(
        String ruleCode,
        RuleOutcome outcome,
        List<DecisionReason> reasons,
        Map<String, Object> evidence
) {
    public static RuleEvaluation passed(String ruleCode) {
        return new RuleEvaluation(ruleCode, RuleOutcome.PASSED, List.of(), Map.of());
    }

    public static RuleEvaluation failed(String ruleCode, String message, Map<String, Object> evidence) {
        return new RuleEvaluation(
                ruleCode,
                RuleOutcome.FAILED,
                List.of(new DecisionReason(ruleCode, message, RuleSeverity.BLOCKING, evidence)),
                Map.copyOf(evidence)
        );
    }

    public boolean failed() {
        return outcome == RuleOutcome.FAILED;
    }
}
```

Enums:

```java
public enum RuleOutcome {
    PASSED,
    FAILED,
    SKIPPED,
    WARNING
}

public enum RuleCategory {
    ELIGIBILITY,
    AUTHORIZATION,
    ESCALATION,
    VALIDATION,
    COMPLIANCE,
    RISK
}

public enum RuleSeverity {
    INFO,
    WARNING,
    BLOCKING,
    ESCALATION
}
```

### 7.2 Contoh Rule Object

```java
public final class NotBlacklistedApplicantRule implements Rule<Application> {

    @Override
    public RuleMetadata metadata() {
        return new RuleMetadata(
                "APP-ELIG-001",
                "Applicant must not be blacklisted",
                RuleCategory.ELIGIBILITY,
                RuleSeverity.BLOCKING,
                100,
                "Licensing Policy"
        );
    }

    @Override
    public boolean appliesTo(Application app, DecisionContext context) {
        return app.applicant() != null;
    }

    @Override
    public RuleEvaluation evaluate(Application app, DecisionContext context) {
        if (app.applicant().isBlacklisted()) {
            return RuleEvaluation.failed(
                    metadata().code(),
                    "Applicant is blacklisted",
                    Map.of(
                            "applicantId", app.applicant().id().value(),
                            "blacklistSource", app.applicant().blacklistSource(),
                            "evaluationDate", context.evaluationDate()
                    )
            );
        }

        return RuleEvaluation.passed(metadata().code());
    }
}
```

### 7.3 Rule Set / Policy Engine Ringan

Kita bisa membuat lightweight rule evaluator tanpa langsung memakai external rule engine.

```java
public final class RuleSet<T> {
    private final List<Rule<T>> rules;
    private final EvaluationMode mode;

    public RuleSet(List<Rule<T>> rules, EvaluationMode mode) {
        this.rules = rules.stream()
                .sorted(Comparator.comparingInt(rule -> rule.metadata().priority()))
                .toList();
        this.mode = mode;
    }

    public RuleSetEvaluation evaluate(T target, DecisionContext context) {
        List<RuleEvaluation> evaluations = new ArrayList<>();

        for (Rule<T> rule : rules) {
            if (!rule.appliesTo(target, context)) {
                evaluations.add(new RuleEvaluation(
                        rule.metadata().code(),
                        RuleOutcome.SKIPPED,
                        List.of(),
                        Map.of("reason", "Rule not applicable")
                ));
                continue;
            }

            RuleEvaluation evaluation = rule.evaluate(target, context);
            evaluations.add(evaluation);

            if (mode == EvaluationMode.STOP_ON_FIRST_BLOCKING_FAILURE
                    && evaluation.failed()) {
                break;
            }
        }

        return RuleSetEvaluation.from(evaluations);
    }
}
```

Mode:

```java
public enum EvaluationMode {
    EVALUATE_ALL,
    STOP_ON_FIRST_FAILURE,
    STOP_ON_FIRST_BLOCKING_FAILURE
}
```

Aggregated result:

```java
public record RuleSetEvaluation(
        List<RuleEvaluation> evaluations,
        RuleSetOutcome outcome
) {
    public static RuleSetEvaluation from(List<RuleEvaluation> evaluations) {
        boolean hasFailure = evaluations.stream().anyMatch(RuleEvaluation::failed);
        RuleSetOutcome outcome = hasFailure
                ? RuleSetOutcome.FAILED
                : RuleSetOutcome.PASSED;
        return new RuleSetEvaluation(List.copyOf(evaluations), outcome);
    }
}

public enum RuleSetOutcome {
    PASSED,
    FAILED
}
```

### 7.4 Kenapa Rule Object Penting di Enterprise

Rule Object memberi kemampuan:

1. **Traceability** — rule mana yang dievaluasi.
2. **Auditability** — alasan dan evidence bisa disimpan.
3. **Testability** — rule bisa diuji satu per satu.
4. **Configurability terbatas** — rule set bisa diatur tanpa mengubah flow utama.
5. **Observability** — rule failure rate bisa dimonitor.
6. **Ownership** — rule punya owner/domain category.
7. **Documentation** — rule metadata bisa diekspor sebagai katalog.
8. **Change control** — perubahan rule bisa dilacak.

### 7.5 Rule Object vs Rule Engine

Rule Object bukan rule engine.

Rule Object:

- rule ditulis dalam Java,
- compile-time safe,
- mudah refactor,
- mudah debug,
- cocok untuk team engineering,
- cocok untuk logic yang tidak perlu diedit non-developer.

Rule Engine:

- rule bisa externalized,
- bisa diubah lebih dinamis,
- mungkin dipahami business user,
- cocok untuk rule sangat banyak/sering berubah,
- tetapi lebih sulit debug, test, version, dan integrate.

Gunakan rule engine hanya jika benar-benar ada kebutuhan:

```text
Business user harus mengubah rule tanpa deploy.
Rule sangat banyak dan sering berubah.
Rule punya effective date/versioning kompleks.
Rule membutuhkan conflict resolution dinamis.
Rule membutuhkan decision table eksplisit.
Rule governance sudah matang.
```

Jangan gunakan rule engine hanya karena `if-else` terasa jelek.

---

## 8. Decision Model: Strategy vs Policy vs Specification vs Rule Object

| Aspek | Strategy | Policy | Specification | Rule Object |
|---|---|---|---|---|
| Pertanyaan utama | Cara mana yang dipakai? | Keputusan apa yang benar? | Apakah kondisi terpenuhi? | Rule mana berlaku dan apa hasilnya? |
| Output umum | Result dari algoritma | Decision | Boolean / evaluation | Evaluation with metadata |
| Fokus | Behavior variation | Decision boundary | Domain predicate | Auditable rule |
| Komposisi | Selector/map/context | Aggregation | AND/OR/NOT | Rule set / priority |
| Cocok untuk | Algorithm variants | Approval/eligibility | Predicate domain | Compliance/regulatory rules |
| Risiko | Strategy explosion | God policy | Predicate tanpa reason | Mini rule engine berlebihan |
| Java modern | Lambda, enum, sealed | record decision | functional interface | record metadata/result |

Heuristik cepat:

```text
Jika variasi adalah algoritma -> Strategy.
Jika variasi adalah keputusan bisnis -> Policy.
Jika rule adalah predicate yang dapat dikomposisi -> Specification.
Jika rule perlu metadata/reason/audit/priority -> Rule Object.
Jika rule harus diedit dinamis oleh non-dev -> pertimbangkan Rule Engine.
```

---

## 9. Step-by-Step Refactoring dari If-Else ke Pattern

### 9.1 Starting Point

```java
public ApprovalResult approve(Application app, Officer officer) {
    if (!officer.hasPermission("APPROVE")) {
        return ApprovalResult.rejected("No permission");
    }

    if (app.status() != ApplicationStatus.SUBMITTED) {
        return ApprovalResult.rejected("Invalid status");
    }

    if (app.applicant().isBlacklisted()) {
        return ApprovalResult.rejected("Blacklisted applicant");
    }

    if (app.amount().isGreaterThan(Money.sgd("50000")) && !officer.isSenior()) {
        return ApprovalResult.escalated("Senior officer required");
    }

    if (!app.documents().hasAllMandatoryDocuments()) {
        return ApprovalResult.rejected("Missing documents");
    }

    app.approve(officer);
    return ApprovalResult.approved(app.id());
}
```

### 9.2 Step 1 — Beri Nama Kondisi

```java
private boolean officerCanApprove(Officer officer) {
    return officer.hasPermission("APPROVE");
}

private boolean applicationIsSubmitted(Application app) {
    return app.status() == ApplicationStatus.SUBMITTED;
}

private boolean applicantIsNotBlacklisted(Application app) {
    return !app.applicant().isBlacklisted();
}
```

Ini belum pattern, tetapi memperjelas bahasa.

### 9.3 Step 2 — Extract Specification

```java
public final class SubmittedApplicationSpec implements Specification<Application> {
    public boolean isSatisfiedBy(Application app) {
        return app.status() == ApplicationStatus.SUBMITTED;
    }
}

public final class NotBlacklistedApplicantSpec implements Specification<Application> {
    public boolean isSatisfiedBy(Application app) {
        return !app.applicant().isBlacklisted();
    }
}
```

### 9.4 Step 3 — Ubah Boolean ke Evaluation

```java
public interface ApplicationRule {
    RuleEvaluation evaluate(Application app, DecisionContext context);
}
```

### 9.5 Step 4 — Pisahkan Rule Category

```java
List<Rule<Application>> eligibilityRules = List.of(
        new SubmittedApplicationRule(),
        new NotBlacklistedApplicantRule(),
        new CompleteMandatoryDocumentsRule()
);

List<Rule<ApprovalRequest>> authorizationRules = List.of(
        new OfficerHasApprovalPermissionRule(),
        new SeniorOfficerForHighAmountRule()
);
```

### 9.6 Step 5 — Bentuk Policy

```java
public final class ApprovalPolicy {
    private final RuleSet<Application> eligibilityRules;
    private final RuleSet<ApprovalRequest> authorizationRules;

    public ApprovalDecision evaluate(Application app, Officer officer, DecisionContext context) {
        ApprovalRequest request = new ApprovalRequest(app, officer);

        RuleSetEvaluation authorization = authorizationRules.evaluate(request, context);
        RuleSetEvaluation eligibility = eligibilityRules.evaluate(app, context);

        return ApprovalDecision.from(authorization, eligibility);
    }
}
```

### 9.7 Step 6 — Application Service Menjadi Orchestrator

```java
public final class ApprovalApplicationService {
    private final ApprovalPolicy approvalPolicy;
    private final ApplicationRepository applications;

    public ApprovalResult approve(ApproveApplicationCommand command) {
        Application app = applications.get(command.applicationId());
        DecisionContext context = DecisionContext.from(command);

        ApprovalDecision decision = approvalPolicy.evaluate(app, command.officer(), context);

        if (!decision.canApprove()) {
            return ApprovalResult.denied(decision.reasons());
        }

        app.approve(command.officer());
        applications.save(app);

        return ApprovalResult.approved(app.id(), decision.auditTrail());
    }
}
```

Hasilnya:

- service lebih pendek,
- rule eksplisit,
- rule bisa diuji,
- decision bisa diaudit,
- perubahan rule lebih terlokalisasi,
- error semantics lebih jelas.

---

## 10. Java 8–25 Perspective

### 10.1 Java 8: Functional Interface dan Lambda

Java 8 membuat Strategy dan Specification lebih ringan.

```java
@FunctionalInterface
public interface Specification<T> {
    boolean isSatisfiedBy(T value);
}
```

```java
Specification<Application> submitted =
        app -> app.status() == ApplicationStatus.SUBMITTED;
```

Namun, semakin penting rule tersebut, semakin besar alasan untuk memberinya class bernama.

```text
Lambda bagus untuk local behavior.
Class bagus untuk domain concept.
```

### 10.2 Java 8: Predicate Composition

```java
Predicate<Application> submitted = app -> app.status() == SUBMITTED;
Predicate<Application> complete = app -> app.documents().complete();

Predicate<Application> approvable = submitted.and(complete);
```

Ini berguna, tetapi `Predicate` kehilangan domain metadata.

Gunakan `Predicate` untuk filtering teknis atau rule kecil.
Gunakan Specification/Rule untuk decision penting.

### 10.3 Java 14–17: Records

Record cocok untuk:

- input rule,
- output decision,
- metadata,
- evidence,
- context.

```java
public record DecisionContext(
        LocalDate evaluationDate,
        String actorId,
        String agencyCode,
        String correlationId
) {}

public record DecisionReason(
        String code,
        String message,
        RuleSeverity severity,
        Map<String, Object> evidence
) {}
```

Record membuat decision model lebih eksplisit dan immutable.

### 10.4 Java 17+: Sealed Types

Sealed types cocok untuk closed decision result.

```java
public sealed interface ApprovalOutcome
        permits Approved, Rejected, Escalated, NeedsMoreInformation {}

public record Approved(String applicationId) implements ApprovalOutcome {}
public record Rejected(List<DecisionReason> reasons) implements ApprovalOutcome {}
public record Escalated(List<DecisionReason> reasons) implements ApprovalOutcome {}
public record NeedsMoreInformation(List<String> requiredItems) implements ApprovalOutcome {}
```

Ini membantu compiler memahami semua kemungkinan outcome.

### 10.5 Pattern Matching Switch

Dengan sealed outcome, switch menjadi lebih aman.

```java
String message = switch (outcome) {
    case Approved approved -> "Approved: " + approved.applicationId();
    case Rejected rejected -> "Rejected: " + rejected.reasons();
    case Escalated escalated -> "Escalated: " + escalated.reasons();
    case NeedsMoreInformation more -> "Need: " + more.requiredItems();
};
```

Gunakan ini untuk presentation/translation layer, bukan untuk mengubur ulang business rule ke switch raksasa.

### 10.6 Java 21–25: Virtual Threads dan Rule Evaluation

Virtual threads tidak mengubah pattern secara konseptual, tetapi mengubah cost model untuk rule yang melakukan blocking I/O.

Namun rule sebaiknya tetap tidak sembarangan melakukan I/O.

Lebih baik:

```text
Application Service loads required facts.
Policy evaluates decision using facts.
Rule does deterministic evaluation.
```

Jika rule harus call external service, pertimbangkan memisahkan:

```text
Fact gathering phase
Decision evaluation phase
Action phase
```

Ini membuat evaluation lebih deterministic dan testable.

### 10.7 Scoped Context

Untuk context seperti correlation id, actor, tenant, atau evaluation date, hindari global static access di rule.

Buruk:

```java
String userId = SecurityContextHolder.getCurrentUserId();
```

Lebih baik:

```java
rule.evaluate(target, decisionContext);
```

Context eksplisit lebih mudah diuji dan diaudit.

---

## 11. Anti-Pattern Catalog

### 11.1 If-Else Rule Blob

Gejala:

- satu method berisi puluhan conditional,
- status/type/role bercampur,
- setiap CR menambah nested branch,
- sulit tahu rule mana yang berlaku,
- sulit test rule individual.

Contoh:

```java
if (type.equals("A")) {
    if (status.equals("X")) {
        if (role.equals("ADMIN")) {
            // ...
        }
    }
}
```

Refactoring:

- extract named predicates,
- group by rule category,
- introduce specification,
- introduce policy,
- introduce rule object jika butuh reason/audit.

### 11.2 Strategy Theater

Gejala:

- banyak class strategy kecil tetapi tidak ada real variation,
- strategy tetap dipilih dengan if-else panjang,
- strategy contract tidak stabil,
- strategy membuat navigasi kode lebih sulit.

Contoh:

```java
if (type == A) return new AStrategy().execute(x);
if (type == B) return new BStrategy().execute(x);
if (type == C) return new CStrategy().execute(x);
```

Jika selector lebih kompleks daripada strategy, pattern belum menyelesaikan masalah.

Refactoring:

- gunakan map registry,
- gunakan enum jika closed/simple,
- gunakan direct method jika variasi tidak signifikan,
- gunakan sealed hierarchy jika closed domain alternatives.

### 11.3 Enum God Strategy

Gejala:

```java
public enum ApplicationType {
    NEW {
        validate() {}
        calculateFee() {}
        approve() {}
        generateLetter() {}
    },
    RENEWAL {
        validate() {}
        calculateFee() {}
        approve() {}
        generateLetter() {}
    }
}
```

Enum berubah menjadi dumping ground untuk semua behavior.

Refactoring:

- pisahkan strategy per axis,
- jangan gabungkan validation, fee, approval, rendering ke enum yang sama,
- gunakan policy/service/rule set per use case.

### 11.4 Rule Spaghetti

Gejala:

- rule saling memanggil rule lain tanpa struktur,
- ada hidden priority,
- ada side effect dalam evaluation,
- hasil tergantung urutan yang tidak terdokumentasi.

Contoh buruk:

```java
public boolean evaluate(Application app) {
    if (otherRule.evaluate(app)) {
        app.markHighRisk();
        return thirdRule.evaluate(app);
    }
    return false;
}
```

Rule evaluation sebaiknya tidak mutate domain object kecuali pattern-nya memang command/action rule yang eksplisit.

Refactoring:

- pisahkan evaluation dan action,
- buat explicit priority,
- buat RuleSetEvaluation,
- larang side effect di rule predicate,
- tulis test untuk ordering.

### 11.5 Hidden Priority Rule

Gejala:

```java
List<Rule> rules = List.of(ruleA, ruleB, ruleC);
```

Urutan menentukan hasil, tetapi tidak ada metadata priority.

Refactoring:

```java
rule.metadata().priority()
```

Atau jika order bukan domain concern, jangan biarkan order memengaruhi hasil.

### 11.6 Rule with I/O Side Effects

Gejala:

```java
public RuleEvaluation evaluate(Application app) {
    ExternalResponse response = externalClient.check(app.id());
    repository.saveAudit(...);
    return response.ok() ? passed() : failed();
}
```

Masalah:

- rule tidak deterministic,
- lambat,
- sulit test,
- retry/circuit breaker bercampur dengan decision,
- partial failure membingungkan.

Refactoring:

```text
Fact Provider fetches external facts.
Rule evaluates facts.
Application Service persists audit.
```

### 11.7 Universal Rule Engine

Gejala:

- semua rule, termasuk simple null check, dimasukkan ke rule engine,
- developer sulit debug,
- versioning rule tidak jelas,
- deployment rule dan deployment code tidak sinkron,
- business user tetap tidak bisa mengubah rule karena rule terlalu teknis.

Refactoring:

- gunakan Java rule object untuk rule engineering-owned,
- gunakan decision table hanya untuk rule tabular/stable,
- gunakan rule engine hanya untuk dynamic governance yang matang.

### 11.8 Boolean Trap

Gejala:

```java
if (!policy.canApprove(app)) {
    return rejected();
}
```

Tidak ada reason.

Refactoring:

```java
ApprovalDecision decision = policy.evaluate(app, officer, context);
if (!decision.canApprove()) {
    return denied(decision.reasons());
}
```

### 11.9 Mixed Rule Semantics

Gejala:

Satu list rule berisi:

- authorization,
- validation,
- escalation,
- warning,
- mutation,
- notification.

Semua memakai interface yang sama:

```java
boolean execute(Object o);
```

Refactoring:

- pisahkan kategori,
- pisahkan evaluation vs action,
- pisahkan blocking vs warning,
- pisahkan domain rule vs technical guard.

---

## 12. Design Forces dan Trade-Off

### 12.1 Flexibility vs Simplicity

Pattern menambah flexibility, tetapi juga menambah indirection.

Gunakan pattern jika flexibility-nya nyata:

```text
Rule sering berubah.
Rule punya banyak variasi.
Rule perlu diuji terpisah.
Rule perlu audit/reason.
Rule dipakai ulang.
Rule punya owner domain.
```

Jangan gunakan pattern jika hanya membuat kode terlihat “enterprise”.

### 12.2 Explicitness vs Boilerplate

Rule Object lebih verbose daripada if-else.

Tetapi verbosity bisa bernilai jika menghasilkan:

- traceability,
- testability,
- auditability,
- ownership,
- safer change.

Di sistem kecil, boilerplate bisa overkill.
Di sistem regulatory, boilerplate sering menjadi dokumentasi executable.

### 12.3 Runtime Selection vs Compile-Time Safety

Map registry memberi runtime flexibility:

```java
Map<Type, Strategy>
```

Sealed class memberi compile-time safety:

```java
sealed interface Strategy permits A, B, C
```

Pilih berdasarkan volatility:

```text
Closed and stable -> sealed/switch/enum.
Open and pluggable -> registry/DI.
```

### 12.4 Short-Circuit vs Full Evaluation

Short-circuit:

- lebih cepat,
- cocok untuk security/expensive check,
- menghasilkan satu reason.

Full evaluation:

- lebih informatif,
- cocok untuk validation/eligibility,
- menghasilkan semua reason.

Decision ini harus eksplisit.

### 12.5 Rule Evaluation vs Rule Execution

Rule evaluation sebaiknya menjawab:

```text
Apa hasil rule?
```

Rule execution/action menjawab:

```text
Apa yang harus dilakukan akibat hasil rule?
```

Jangan campur kecuali memang pattern-nya command/rule action.

---

## 13. Testing Strategy

### 13.1 Unit Test per Rule

```java
class NotBlacklistedApplicantRuleTest {

    @Test
    void failsWhenApplicantIsBlacklisted() {
        Application app = ApplicationFixture.submitted()
                .withBlacklistedApplicant()
                .build();

        RuleEvaluation evaluation = new NotBlacklistedApplicantRule()
                .evaluate(app, TestDecisionContext.today());

        assertEquals(RuleOutcome.FAILED, evaluation.outcome());
        assertEquals("APP-ELIG-001", evaluation.ruleCode());
    }

    @Test
    void passesWhenApplicantIsNotBlacklisted() {
        Application app = ApplicationFixture.submitted()
                .withCleanApplicant()
                .build();

        RuleEvaluation evaluation = new NotBlacklistedApplicantRule()
                .evaluate(app, TestDecisionContext.today());

        assertEquals(RuleOutcome.PASSED, evaluation.outcome());
    }
}
```

### 13.2 Rule Set Test

Test rule ordering dan aggregation.

```java
@Test
void evaluatesRulesByPriority() {
    RuleSet<Application> ruleSet = new RuleSet<>(
            List.of(rulePriority200, rulePriority100),
            EvaluationMode.EVALUATE_ALL
    );

    RuleSetEvaluation result = ruleSet.evaluate(app, context);

    assertEquals(List.of("RULE-100", "RULE-200"), result.ruleCodes());
}
```

### 13.3 Scenario-Based Test

```java
@Test
void highAmountApplicationByJuniorOfficerIsEscalated() {
    Application app = submittedApplication().withAmount("75000").build();
    Officer officer = juniorOfficer();

    ApprovalDecision decision = approvalPolicy.evaluate(app, officer, context);

    assertEquals(DecisionOutcome.ESCALATED, decision.outcome());
    assertThat(decision.reasonCodes()).contains("HIGH_AMOUNT_NEEDS_SENIOR");
}
```

### 13.4 Boundary Table Test

Untuk threshold/date-based rules:

```text
amount     threshold   officer   expected
49999      50000       junior    pass
50000      50000       junior    pass or fail? define clearly
50001      50000       junior    escalate
50001      50000       senior    pass
```

Boundary test sering menemukan ambiguity requirement.

### 13.5 Property-Based Test

Untuk rule matematis/scoring:

```text
If risk score increases while all other fields same,
risk category must not decrease.
```

Ini menguji invariant, bukan hanya contoh.

### 13.6 Golden Master untuk Legacy Refactoring

Jika rule lama kompleks dan belum dipahami, buat characterization test.

```text
Input set besar -> output lama direkam -> refactor -> output harus sama.
```

Setelah itu baru improve model.

---

## 14. Observability dan Auditability

Rule system harus bisa diamati.

### 14.1 Log Rule Evaluation Secara Structured

```json
{
  "event": "rule_evaluated",
  "correlationId": "abc-123",
  "applicationId": "APP-1001",
  "ruleCode": "APP-ELIG-001",
  "outcome": "FAILED",
  "severity": "BLOCKING",
  "durationMs": 3,
  "evaluationDate": "2026-06-18"
}
```

Jangan log PII atau data sensitif tanpa masking.

### 14.2 Metrics

Useful metrics:

```text
rule_evaluation_total{ruleCode,outcome}
rule_evaluation_duration_ms{ruleCode}
policy_decision_total{policy,outcome}
rule_failure_top_n
rule_skipped_total{ruleCode}
```

Metrics membantu menjawab:

- rule mana paling sering gagal,
- rule mana lambat,
- policy mana sering reject,
- apakah perubahan rule menyebabkan spike rejection.

### 14.3 Audit Trail

Untuk regulatory case, simpan:

```text
policy version
rule codes evaluated
rule outcomes
decision outcome
actor
evaluation date
evidence snapshot atau reference
correlation id
```

Audit harus cukup menjelaskan keputusan, tetapi tidak menyimpan data sensitif secara sembarangan.

### 14.4 Debugging Angle

Ketika production issue terjadi, engineer harus bisa bertanya:

```text
Rule mana yang mengevaluasi case ini?
Apa input facts-nya?
Rule mana yang failed/skipped?
Apakah rule version benar?
Apakah evaluation date benar?
Apakah actor context benar?
Apakah ordering benar?
Apakah ada missing fact?
```

Jika desain tidak bisa menjawab pertanyaan itu, decision logic belum observable.

---

## 15. Performance Consideration

Pattern ini biasanya bukan bottleneck utama, tetapi beberapa risiko muncul:

1. Terlalu banyak rule melakukan DB/API call.
2. Rule evaluation melakukan stream/filter berulang pada collection besar.
3. Evidence map menyimpan object besar.
4. Rule set dievaluasi berkali-kali dalam satu request.
5. Reflection-based rule registry terlalu sering discan.
6. Dynamic scripting/rule engine overhead tidak diukur.

Guideline:

```text
Keep rule evaluation mostly pure.
Preload required facts.
Avoid I/O inside rule.
Cache stable reference data.
Measure slow rules.
Use short-circuit for expensive blocking checks.
Do not optimize before clarity unless hot path proven.
```

---

## 16. Security Consideration

Rule/policy sering berhubungan dengan authorization.

Risiko umum:

1. Authorization rule dianggap sama dengan UI visibility.
2. Rule dijalankan setelah mutation.
3. Client mengirim decision flag.
4. User role dicek sebagai string tersebar.
5. Override tidak diaudit.
6. Rule failure message membocorkan data sensitif.

Prinsip:

```text
Server owns decision.
Authorization before mutation.
Domain decision separate from UI hint.
Override must be explicit and audited.
Decision reason for internal audit can differ from public error message.
```

Contoh:

```java
DecisionReason internal = new DecisionReason(
        "BLACKLISTED_APPLICANT",
        "Applicant exists in compliance blacklist source X",
        RuleSeverity.BLOCKING,
        evidence
);

String publicMessage = "Application cannot be approved based on eligibility checks.";
```

---

## 17. Case Study — Regulatory Application Approval

### 17.1 Requirement

Sebuah application bisa di-approve jika:

1. Officer punya permission approve.
2. Application status `SUBMITTED`.
3. Applicant tidak blacklisted.
4. Mandatory documents lengkap.
5. Jika amount > 50,000, junior officer tidak boleh approve; harus escalation.
6. Jika risk level HIGH, butuh senior review.
7. Semua keputusan harus menyimpan reason code.

### 17.2 Model

```java
public record ApprovalRequest(
        Application application,
        Officer officer
) {}
```

```java
public final class ApprovalPolicy {
    private final RuleSet<ApprovalRequest> rules;

    public ApprovalPolicy(List<Rule<ApprovalRequest>> rules) {
        this.rules = new RuleSet<>(rules, EvaluationMode.EVALUATE_ALL);
    }

    public ApprovalDecision evaluate(ApprovalRequest request, DecisionContext context) {
        RuleSetEvaluation evaluation = rules.evaluate(request, context);
        return ApprovalDecision.from(evaluation);
    }
}
```

### 17.3 Rule: Officer Permission

```java
public final class OfficerCanApproveRule implements Rule<ApprovalRequest> {
    @Override
    public RuleMetadata metadata() {
        return new RuleMetadata(
                "AUTH-APPROVE-001",
                "Officer must have approval permission",
                RuleCategory.AUTHORIZATION,
                RuleSeverity.BLOCKING,
                10,
                "Access Control"
        );
    }

    @Override
    public boolean appliesTo(ApprovalRequest request, DecisionContext context) {
        return true;
    }

    @Override
    public RuleEvaluation evaluate(ApprovalRequest request, DecisionContext context) {
        if (!request.officer().hasPermission(Permission.APPROVE_APPLICATION)) {
            return RuleEvaluation.failed(
                    metadata().code(),
                    "Officer does not have approval permission",
                    Map.of("officerId", request.officer().id().value())
            );
        }
        return RuleEvaluation.passed(metadata().code());
    }
}
```

### 17.4 Rule: Submitted Status

```java
public final class ApplicationSubmittedRule implements Rule<ApprovalRequest> {
    @Override
    public RuleMetadata metadata() {
        return new RuleMetadata(
                "APP-STATUS-001",
                "Application must be submitted",
                RuleCategory.ELIGIBILITY,
                RuleSeverity.BLOCKING,
                20,
                "Application Policy"
        );
    }

    @Override
    public boolean appliesTo(ApprovalRequest request, DecisionContext context) {
        return true;
    }

    @Override
    public RuleEvaluation evaluate(ApprovalRequest request, DecisionContext context) {
        ApplicationStatus status = request.application().status();
        if (status != ApplicationStatus.SUBMITTED) {
            return RuleEvaluation.failed(
                    metadata().code(),
                    "Application is not in submitted status",
                    Map.of("actualStatus", status)
            );
        }
        return RuleEvaluation.passed(metadata().code());
    }
}
```

### 17.5 Rule: High Amount Escalation

```java
public final class HighAmountRequiresSeniorRule implements Rule<ApprovalRequest> {
    private final Money threshold;

    public HighAmountRequiresSeniorRule(Money threshold) {
        this.threshold = threshold;
    }

    @Override
    public RuleMetadata metadata() {
        return new RuleMetadata(
                "APP-ESC-001",
                "High amount application requires senior officer",
                RuleCategory.ESCALATION,
                RuleSeverity.ESCALATION,
                50,
                "Approval Policy"
        );
    }

    @Override
    public boolean appliesTo(ApprovalRequest request, DecisionContext context) {
        return request.application().amount().isGreaterThan(threshold);
    }

    @Override
    public RuleEvaluation evaluate(ApprovalRequest request, DecisionContext context) {
        if (!request.officer().isSenior()) {
            return RuleEvaluation.failed(
                    metadata().code(),
                    "High amount application requires senior officer",
                    Map.of(
                            "amount", request.application().amount(),
                            "threshold", threshold,
                            "officerId", request.officer().id().value()
                    )
            );
        }
        return RuleEvaluation.passed(metadata().code());
    }
}
```

### 17.6 Decision Aggregation

```java
public record ApprovalDecision(
        DecisionOutcome outcome,
        List<DecisionReason> reasons,
        List<RuleEvaluation> evaluations
) {
    public static ApprovalDecision from(RuleSetEvaluation evaluation) {
        List<DecisionReason> blocking = evaluation.evaluations().stream()
                .flatMap(e -> e.reasons().stream())
                .filter(reason -> reason.severity() == RuleSeverity.BLOCKING)
                .toList();

        List<DecisionReason> escalations = evaluation.evaluations().stream()
                .flatMap(e -> e.reasons().stream())
                .filter(reason -> reason.severity() == RuleSeverity.ESCALATION)
                .toList();

        if (!blocking.isEmpty()) {
            return new ApprovalDecision(DecisionOutcome.REJECTED, blocking, evaluation.evaluations());
        }
        if (!escalations.isEmpty()) {
            return new ApprovalDecision(DecisionOutcome.ESCALATED, escalations, evaluation.evaluations());
        }
        return new ApprovalDecision(DecisionOutcome.APPROVED, List.of(), evaluation.evaluations());
    }

    public boolean canApprove() {
        return outcome == DecisionOutcome.APPROVED;
    }
}
```

### 17.7 Result

Application service sekarang tidak lagi memegang detail semua rule.

Ia hanya:

1. load aggregate,
2. build context,
3. ask policy,
4. mutate aggregate jika allowed,
5. persist result,
6. publish/audit decision.

Itu separation of concerns yang sehat.

---

## 18. Design Review Checklist

Gunakan checklist ini ketika mereview design rule/policy/strategy.

### 18.1 Strategy Checklist

```text
[ ] Apakah benar ada family of algorithms?
[ ] Apakah semua strategy memiliki contract yang sama?
[ ] Apakah strategy selection eksplisit?
[ ] Apakah fallback/default strategy aman?
[ ] Apakah strategy terlalu kecil/trivial?
[ ] Apakah strategy butuh dependency? Jika ya, bagaimana lifecycle-nya?
[ ] Apakah strategy observable jika gagal?
[ ] Apakah enum/lambda/class choice tepat?
```

### 18.2 Policy Checklist

```text
[ ] Policy menjawab decision apa?
[ ] Output policy membawa reason?
[ ] Policy mencampur authorization, validation, dan domain decision?
[ ] Evaluation context eksplisit?
[ ] Effective date jelas?
[ ] Owner rule jelas?
[ ] Override path jelas?
[ ] Audit output cukup?
```

### 18.3 Specification Checklist

```text
[ ] Specification memiliki nama domain yang jelas?
[ ] Specification hanya predicate atau butuh reason?
[ ] Composition AND/OR/NOT mudah dibaca?
[ ] Short-circuit vs evaluate-all jelas?
[ ] Specification digunakan untuk domain decision atau persistence query?
[ ] Jika untuk query, apakah mapping ke SQL aman?
[ ] Apakah specification terlalu banyak dan membingungkan?
```

### 18.4 Rule Object Checklist

```text
[ ] Rule punya code unik?
[ ] Rule punya metadata?
[ ] Rule punya severity/category/priority?
[ ] appliesTo dan evaluate dipisah?
[ ] Rule evaluation bebas side effect?
[ ] Evidence tidak mengandung PII berlebihan?
[ ] Rule result bisa diaudit?
[ ] Rule ordering eksplisit?
[ ] Rule set punya evaluation mode?
[ ] Rule bisa diuji sendiri?
```

### 18.5 Anti-Pattern Warning

```text
[ ] Banyak if-else berbasis status/type/role?
[ ] Rule tersebar di controller/service/repository/frontend?
[ ] Boolean decision tanpa reason?
[ ] Rule melakukan DB/API call sendiri?
[ ] Urutan rule tersembunyi?
[ ] Enum menjadi tempat semua behavior?
[ ] Rule engine dipakai tanpa governance?
[ ] Strategy hanya memindahkan if-else ke class kecil?
```

---

## 19. Staff-Level Discussion Points

Pertanyaan yang sering muncul di diskusi senior/staff:

### 19.1 “Apakah semua if harus diganti Strategy?”

Tidak. `if` adalah struktur bahasa yang valid. Pattern diperlukan ketika conditional merepresentasikan variasi behavior/domain rule yang berubah, perlu diuji, perlu dijelaskan, atau perlu dikomposisi.

### 19.2 “Apakah Specification hanya Predicate?”

Pada bentuk paling sederhana, iya. Tetapi di sistem enterprise, specification sering perlu explanation. Jika reason/audit/metadata penting, naikkan menjadi ExplainingSpecification atau Rule Object.

### 19.3 “Apakah rule harus pure?”

Sebisa mungkin evaluation rule pure/deterministic. Jika butuh external facts, lakukan fact gathering sebelum evaluation. Ini membuat rule lebih testable dan audit-friendly.

### 19.4 “Kapan pakai rule engine?”

Gunakan ketika rule memang harus externalized, versioned, effective-dated, dan dikelola dengan governance yang jelas. Jangan gunakan hanya untuk menghindari if-else.

### 19.5 “Bagaimana dengan performance?”

Rule object overhead biasanya kecil dibanding DB/API. Masalah performance muncul jika rule melakukan I/O, query berulang, atau evaluation tidak di-cache untuk facts yang sama.

### 19.6 “Bagaimana menjaga rule tidak menjadi chaos?”

Dengan metadata, category, priority, evaluation mode, ownership, test suite, audit trail, dan rule catalog.

---

## 20. Practical Heuristics

### 20.1 Dari Simple ke Complex

```text
1 rule sederhana dan stabil:
    direct if / named method

Beberapa variasi algoritma:
    Strategy

Predicate domain reusable:
    Specification

Decision boundary dengan reason:
    Policy

Rule butuh metadata/audit/priority:
    Rule Object

Rule dinamis, banyak, business-authored:
    Rule Engine / Decision Table
```

### 20.2 Naming Heuristic

Gunakan nama yang bisa dibaca domain expert:

Baik:

```text
ApplicationMustBeSubmittedRule
ApplicantMustNotBeBlacklistedRule
HighAmountRequiresSeniorOfficerRule
RenewalMustBeWithinAllowedWindowSpec
```

Buruk:

```text
CheckRule1
ValidationStrategyImpl
CommonRuleProcessor
ApplicationUtil
RuleHelper
```

### 20.3 Package Heuristic

Contoh package structure:

```text
application/
  approval/
    ApprovalApplicationService.java
    ApprovalPolicy.java
    ApprovalDecision.java
    ApprovalRequest.java
    rules/
      OfficerCanApproveRule.java
      ApplicationSubmittedRule.java
      NotBlacklistedApplicantRule.java
      HighAmountRequiresSeniorRule.java
    RuleSet.java
    RuleEvaluation.java
    RuleMetadata.java
```

Jangan taruh semua rule di package `common.rules` jika rule tersebut punya konteks use case/domain spesifik.

### 20.4 Refactoring Heuristic

Jika method mulai seperti ini:

```text
approve()
  validate role
  validate status
  validate applicant
  validate documents
  decide escalation
  calculate fee
  call external API
  mutate state
  send notification
  write audit
```

Pisahkan menjadi:

```text
AuthorizationPolicy
EligibilityPolicy
EscalationPolicy
FeeStrategy
ExternalGateway
Domain mutation
Event/Audit publisher
```

---

## 21. Common Mistakes in Java Codebase

### 21.1 Memakai Spring Bean Map tanpa Contract yang Jelas

```java
@Autowired
Map<String, PaymentStrategy> strategies;
```

Masalah:

- key berdasarkan bean name,
- rename bean bisa break,
- tidak ada supported type eksplisit.

Lebih baik:

```java
public interface PaymentStrategy {
    PaymentMethod supports();
    PaymentResult pay(PaymentRequest request);
}
```

Registry:

```java
public final class PaymentStrategyRegistry {
    private final Map<PaymentMethod, PaymentStrategy> strategies;

    public PaymentStrategyRegistry(List<PaymentStrategy> strategies) {
        this.strategies = strategies.stream()
                .collect(Collectors.toUnmodifiableMap(
                        PaymentStrategy::supports,
                        Function.identity()
                ));
    }
}
```

### 21.2 Strategy Mengembalikan Object Terlalu Umum

Buruk:

```java
Object execute(Object input);
```

Lebih baik:

```java
RiskScore score(RiskInput input);
```

Contract spesifik membuat pattern aman.

### 21.3 Rule Menggunakan String Code Sembarangan

Buruk:

```java
return failed("ERR01");
```

Lebih baik:

```java
public static final String BLACKLISTED_APPLICANT = "APP-ELIG-001";
```

Atau rule metadata menjadi source of truth.

### 21.4 Rule Message sebagai Logic

Buruk:

```java
if (errorMessage.contains("blacklist")) { ... }
```

Gunakan code, bukan message.

```java
if (reason.code().equals("APP-ELIG-001")) { ... }
```

### 21.5 Rule Mengubah State Saat Mengecek

Buruk:

```java
if (rule.evaluate(app)) {
    app.markEligible();
}
```

Lebih baik:

```java
Decision decision = policy.evaluate(app, context);
if (decision.approved()) {
    app.approve(actor);
}
```

---

## 22. Mini Pattern Language untuk Decision Logic

Gunakan vocabulary ini dalam code review:

```text
Strategy:
    “Bagaimana cara melakukan X?”

Policy:
    “Apakah X boleh/harus/ditolak/dieskalasi?”

Specification:
    “Apakah object memenuhi kondisi domain Y?”

Rule Object:
    “Rule Y dievaluasi, dengan hasil Z, alasan A, evidence B.”

Rule Set:
    “Kumpulan rule yang dievaluasi dengan mode dan ordering eksplisit.”

Decision Context:
    “Fakta runtime yang memengaruhi evaluasi, seperti actor/date/tenant/correlation.”

Decision Reason:
    “Alasan eksplisit yang bisa ditampilkan, diuji, disimpan, atau diaudit.”

Evidence:
    “Data pendukung yang menjelaskan kenapa rule menghasilkan outcome tertentu.”
```

---

## 23. Ringkasan Mental Model

Part ini dapat diringkas menjadi beberapa prinsip:

1. **Strategy memilih behavior.**
2. **Policy mengambil keputusan.**
3. **Specification menamai kondisi domain.**
4. **Rule Object membuat rule menjadi eksplisit, traceable, dan auditable.**
5. **Boolean sering terlalu miskin untuk enterprise decision.**
6. **Reason code lebih stabil daripada message.**
7. **Evaluation context harus eksplisit.**
8. **Rule evaluation sebaiknya bebas side effect.**
9. **Ordering dan short-circuiting harus menjadi design decision, bukan kebetulan list order.**
10. **Rule engine bukan tujuan akhir; ia hanya cocok jika governance dan kebutuhan runtime configurability nyata.**
11. **Java 8 membuat pattern lebih ringan, Java modern membuat decision model lebih expressive melalui record, sealed type, dan pattern matching.**
12. **Top engineer tidak hanya menghapus if-else; mereka membuat decision logic menjadi dapat dipahami, diuji, diubah, dan dipertanggungjawabkan.**

---

## 24. Latihan Praktis

### Latihan 1 — Refactor If-Else

Ambil method service yang memiliki minimal 8 conditional. Klasifikasikan setiap conditional sebagai:

```text
technical guard
input validation
authorization
domain eligibility
escalation
routing
side effect trigger
```

Lalu refactor minimal dua kategori menjadi policy/specification/rule object.

### Latihan 2 — Buat Rule Evaluation Model

Desain record berikut:

```text
RuleMetadata
RuleEvaluation
DecisionReason
DecisionContext
RuleSetEvaluation
```

Pastikan mendukung:

- passed,
- failed,
- skipped,
- warning,
- blocking,
- escalation,
- evidence.

### Latihan 3 — Strategy vs Policy

Ambil contoh fee calculation. Pisahkan:

```text
FeeCalculationStrategy
FeeWaiverPolicy
FeeEligibilitySpecification
```

Jelaskan kenapa masing-masing berbeda.

### Latihan 4 — Rule Observability

Tambahkan structured log dan metric untuk rule evaluation.

Pastikan tidak membocorkan PII.

### Latihan 5 — Rule Catalog

Buat markdown/table otomatis/manual yang mencatat:

```text
rule code
rule name
category
severity
priority
owner
description
```

Ini melatih governance rule.

---

## 25. Referensi Konseptual

Materi ini berdiri di atas beberapa konsep mapan:

1. GoF Strategy pattern sebagai family of interchangeable algorithms.
2. Specification pattern dari tradisi Domain-Driven Design, terutama sebagai cara mengekspresikan domain predicate yang reusable dan composable.
3. Java functional interface/lambda sebagai mekanisme modern untuk membuat behavior object lebih ringan.
4. Refactoring practice: extract method, replace conditional with polymorphism, introduce parameter object, introduce domain object.
5. Enterprise decision modeling: reason code, rule metadata, effective date, evidence, audit trail.

Referensi eksternal yang berguna untuk pendalaman:

- Refactoring Guru — Strategy Pattern.
- Martin Fowler / Eric Evans — Specification pattern.
- Martin Fowler — Specification by Example.
- Oracle Java Tutorials — Lambda Expressions dan Functional Interfaces.
- Domain-Driven Design tactical patterns untuk Specification, Policy, Repository, dan domain model.

---

## 26. Penutup

Strategy, Policy, Specification, dan Rule Object adalah pattern yang sering menjadi pembeda antara engineer yang hanya bisa membuat fitur berjalan dan engineer yang mampu membangun decision system yang tahan perubahan.

Dalam sistem sederhana, `if` yang jelas lebih baik daripada pattern yang berlebihan.

Tetapi dalam sistem enterprise yang memiliki rule kompleks, audit, traceability, compliance, escalation, dan ownership lintas tim, conditional logic yang tersembunyi di service method adalah liability.

Pattern yang tepat membuat rule menjadi:

```text
visible,
nameable,
testable,
composable,
observable,
auditable,
changeable,
defensible.
```

Itulah kualitas yang membuat design bukan hanya “clean code”, tetapi bagian dari engineering system yang dapat dipercaya.

---

## Status Seri

```text
Part 10 dari 35 selesai.
Seri belum selesai.
```

Part berikutnya:

```text
11-behavioral-command-handler-chain-of-responsibility.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./09-structural-composite-bridge-flyweight-module-boundary.md">⬅️ Structural Pattern III: Composite, Bridge, Flyweight, Module Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./11-behavioral-command-handler-chain-of-responsibility.md">Behavioral Pattern II: Command, Handler, Chain of Responsibility ➡️</a>
</div>

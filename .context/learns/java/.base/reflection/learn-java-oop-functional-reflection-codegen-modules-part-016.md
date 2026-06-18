# learn-java-oop-functional-reflection-codegen-modules-part-016

# Functional Interfaces and Higher-Order API Design

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Part: **016 / 030**  
> Topik: **Functional interface sebagai contract, extension point, callback, policy, dan building block API design**

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membedah lambda dari sisi semantics dan runtime: target typing, SAM conversion, capture, `this`, method reference, `invokedynamic`, dan `LambdaMetafactory`.

Part ini naik satu level ke desain API:

> Setelah kita tahu lambda bekerja, bagaimana kita mendesain API Java yang menerima, menyusun, membatasi, mendokumentasikan, dan mengoperasikan function secara benar?

Di sinilah functional interface menjadi penting.

Functional interface bukan hanya “interface dengan satu method”. Dalam desain sistem yang serius, ia bisa menjadi:

1. **policy injection**;
2. **callback boundary**;
3. **extension point**;
4. **domain rule**;
5. **validator**;
6. **mapper**;
7. **factory**;
8. **lazy computation**;
9. **side-effect port**;
10. **higher-order API contract**.

Namun, functional interface juga bisa merusak desain jika dipakai sembarangan:

```java
void process(Function<Object, Object> fn);
```

API seperti ini terlalu generik, miskin makna, sulit dites, sulit dilacak, dan berbahaya untuk domain logic.

Tujuan part ini adalah membangun mental model agar kita bisa membedakan:

- kapan memakai standard functional interface;
- kapan membuat custom functional interface;
- kapan memakai interface biasa;
- kapan memakai class/polymorphism;
- kapan lambda membuat API lebih jelas;
- kapan lambda membuat API menjadi opaque dan fragile.

---

## 1. Mental Model Utama

Functional interface adalah **contract perilaku kecil** yang dapat direpresentasikan oleh lambda, method reference, constructor reference, atau class biasa.

Contoh:

```java
Predicate<Application> isSubmitted = app -> app.status() == Status.SUBMITTED;
```

`Predicate<Application>` bukan sekadar “function”. Ia adalah contract:

```java
boolean test(Application value);
```

Artinya:

> Berikan satu `Application`, hasilkan keputusan boolean.

Bandingkan dengan:

```java
Function<Application, Boolean> isSubmitted = app -> app.status() == Status.SUBMITTED;
```

Secara teknis bisa. Secara desain kurang kuat.

Karena `Predicate<T>` mengatakan intent yang lebih spesifik:

- output adalah boolean decision;
- method bernama `test`, bukan `apply`;
- ia mendukung komposisi `and`, `or`, `negate`;
- pembaca langsung memahami shape perilakunya.

Functional interface yang baik harus menjawab:

1. **Input-nya apa?**
2. **Output-nya apa?**
3. **Apakah ada side effect?**
4. **Apakah boleh throw exception?**
5. **Apakah boleh return null?**
6. **Apakah harus deterministic?**
7. **Apakah boleh melakukan I/O?**
8. **Apakah dipanggil sekali, berkali-kali, lazy, async, atau paralel?**
9. **Apakah harus thread-safe?**
10. **Apakah contract-nya domain-specific atau generic?**

Tanpa jawaban ini, API berbasis lambda sering tampak elegan tetapi rapuh.

---

## 2. Apa Itu Functional Interface?

Functional interface adalah interface yang memiliki tepat satu abstract method secara konseptual. Ia dapat diberi annotation `@FunctionalInterface` agar compiler memvalidasi intent tersebut.

Contoh:

```java
@FunctionalInterface
public interface EligibilityRule {
    boolean isEligible(Application application);
}
```

Ia dapat diimplementasikan dengan lambda:

```java
EligibilityRule hasValidLicence = application -> application.licence().isValid();
```

Atau dengan method reference:

```java
EligibilityRule submitted = ApplicationRules::isSubmitted;
```

Atau dengan class biasa:

```java
public final class ActiveLicenceRule implements EligibilityRule {
    @Override
    public boolean isEligible(Application application) {
        return application.licence().isValid();
    }
}
```

Ini penting: **functional interface tidak berarti implementasinya harus lambda**.

Lambda hanyalah salah satu cara membuat instance-nya.

---

## 3. Kenapa `@FunctionalInterface` Penting?

Annotation ini bukan wajib secara bahasa, tetapi sangat disarankan untuk interface yang memang dimaksudkan sebagai target lambda.

Tanpa annotation:

```java
public interface Rule {
    boolean test(Application application);
}
```

Kodenya tetap functional interface.

Namun jika nanti seseorang menambah abstract method:

```java
public interface Rule {
    boolean test(Application application);
    String description();
}
```

Maka semua lambda implementation akan rusak.

Dengan `@FunctionalInterface`:

```java
@FunctionalInterface
public interface Rule {
    boolean test(Application application);
    String description(); // compile error
}
```

Compiler menjaga contract desain.

### 3.1 Default Method Tidak Merusak Functional Interface

```java
@FunctionalInterface
public interface Rule {
    boolean test(Application application);

    default Rule and(Rule other) {
        return application -> this.test(application) && other.test(application);
    }
}
```

Masih valid karena hanya ada satu abstract method.

### 3.2 Static Method Juga Tidak Merusak

```java
@FunctionalInterface
public interface Rule {
    boolean test(Application application);

    static Rule alwaysTrue() {
        return application -> true;
    }
}
```

Static method bukan abstract instance method.

### 3.3 Method dari `Object` Tidak Dihitung

Interface ini tetap functional:

```java
@FunctionalInterface
public interface NamedPredicate<T> {
    boolean test(T value);

    String toString();
}
```

Karena `toString()` berasal dari `Object`. Namun secara desain, ini jarang bagus karena lambda tidak memberikan nama `toString` yang meaningful.

---

## 4. Taxonomy Standard Functional Interfaces

Package `java.util.function` menyediakan standard function shapes. Engineer kuat tidak menghafal semuanya secara membabi buta, tetapi memahami kategorinya.

### 4.1 Supplier: No Input, Produces Output

```java
Supplier<UUID> idGenerator = UUID::randomUUID;
```

Shape:

```java
() -> T
```

Interface:

```java
T get();
```

Gunakan ketika:

- lazy value;
- factory ringan;
- deferred computation;
- injectable source;
- test seam untuk time/id/random/config.

Contoh domain:

```java
public final class CaseFactory {
    private final Supplier<UUID> idGenerator;
    private final Supplier<Instant> clock;

    public CaseFactory(Supplier<UUID> idGenerator, Supplier<Instant> clock) {
        this.idGenerator = Objects.requireNonNull(idGenerator);
        this.clock = Objects.requireNonNull(clock);
    }

    public Case open(String referenceNo) {
        return new Case(idGenerator.get(), referenceNo, clock.get(), CaseStatus.OPEN);
    }
}
```

Namun perhatikan: `Supplier<Instant>` kurang semantik dibanding `Clock` atau `TimeProvider`. Untuk API publik besar, custom type sering lebih jelas.

### 4.2 Consumer: Input, No Return, Expected Side Effect

```java
Consumer<AuditEvent> auditSink = event -> auditRepository.save(event);
```

Shape:

```java
T -> void
```

Interface:

```java
void accept(T value);
```

Gunakan ketika:

- menyimpan event;
- menulis log;
- mengirim notification;
- callback side effect;
- visitor-like operation.

Consumer harus dicurigai karena return `void` biasanya berarti side effect.

Contoh:

```java
public void publish(AuditEvent event, Consumer<AuditEvent> sink) {
    sink.accept(event);
}
```

Pertanyaan desain:

- Apakah `sink` boleh throw?
- Apakah `sink` dipanggil tepat sekali?
- Apakah jika gagal harus retry?
- Apakah ordering penting?
- Apakah sink harus idempotent?

Tanpa menjawab ini, `Consumer` terlalu lemah sebagai boundary produksi.

### 4.3 Function: Input to Output

```java
Function<Application, Decision> evaluator = application -> Decision.approved(application.id());
```

Shape:

```java
T -> R
```

Interface:

```java
R apply(T value);
```

Gunakan ketika:

- mapping;
- transformation;
- calculation;
- enrichment;
- resolver;
- conversion.

Contoh:

```java
Function<ApplicationDto, ApplicationCommand> toCommand = dto -> new ApplicationCommand(
    dto.applicationId(),
    dto.submittedBy(),
    dto.payload()
);
```

`Function` cocok bila operation benar-benar generic transformation. Jika transformation punya makna domain kuat, custom interface bisa lebih baik.

### 4.4 Predicate: Input to Boolean

```java
Predicate<Application> requiresManualReview = application ->
    application.riskScore() >= 80 || application.hasConflictingDeclarations();
```

Shape:

```java
T -> boolean
```

Interface:

```java
boolean test(T value);
```

Gunakan ketika:

- filter;
- rule;
- condition;
- guard;
- validation boolean sederhana.

Predicate punya default combinator:

```java
Predicate<Application> highRisk = app -> app.riskScore() >= 80;
Predicate<Application> submitted = app -> app.status() == Status.SUBMITTED;

Predicate<Application> candidate = submitted.and(highRisk);
```

Namun predicate yang mengembalikan `false` tidak menjelaskan alasan. Untuk validation produksi, sering lebih baik result type.

### 4.5 UnaryOperator: T to T

```java
UnaryOperator<String> normalize = value -> value.trim().toUpperCase(Locale.ROOT);
```

Shape:

```java
T -> T
```

`UnaryOperator<T>` adalah special case dari `Function<T, T>`.

Gunakan ketika:

- normalization;
- transformation yang mempertahankan type;
- immutable update;
- pipeline step.

Contoh:

```java
UnaryOperator<ApplicationDraft> normalizeDraft = draft -> draft
    .withApplicantName(draft.applicantName().trim())
    .withPostalCode(draft.postalCode().replace(" ", ""));
```

### 4.6 BinaryOperator: T, T to T

```java
BinaryOperator<BigDecimal> sum = BigDecimal::add;
```

Shape:

```java
(T, T) -> T
```

Gunakan ketika:

- reduce;
- merge;
- combine;
- conflict resolution.

Contoh:

```java
BinaryOperator<CasePriority> highestPriority = (a, b) ->
    a.level() >= b.level() ? a : b;
```

Perhatikan associativity jika dipakai untuk parallel reduction.

### 4.7 BiFunction, BiConsumer, BiPredicate

Untuk dua input:

```java
BiFunction<Application, Officer, Assignment> assign = Assignment::new;
BiPredicate<Application, Officer> canHandle = (app, officer) -> officer.canHandle(app.type());
BiConsumer<CaseFile, AuditEvent> appendAudit = CaseFile::appendAudit;
```

Gunakan ketika dua input memang koheren.

Jika parameter mulai tiga atau empat, jangan buru-buru membuat `TriFunction`. Sering lebih baik membuat object parameter:

```java
record AssignmentContext(Application application, Officer officer, WorkloadSnapshot workload) {}

Function<AssignmentContext, AssignmentDecision> decideAssignment = context -> ...;
```

Object parameter memberi nama, invariant, dan ruang evolusi.

---

## 5. Primitive Specializations

`java.util.function` menyediakan primitive specializations untuk menghindari boxing/unboxing.

Contoh:

```java
IntPredicate positive = value -> value > 0;
IntUnaryOperator increment = value -> value + 1;
LongSupplier sequence = () -> sequenceGenerator.next();
ToLongFunction<Application> ageInDays = app -> ChronoUnit.DAYS.between(app.submittedAt(), Instant.now());
```

Mengapa penting?

```java
Predicate<Integer> p = value -> value > 0;
```

Ini melibatkan `Integer`, bukan primitive `int` secara murni. Dalam loop panas atau data volume besar, boxing bisa menjadi overhead.

Primitive families mencakup bentuk seperti:

- `IntPredicate`, `LongPredicate`, `DoublePredicate`;
- `IntFunction<R>`, `LongFunction<R>`, `DoubleFunction<R>`;
- `ToIntFunction<T>`, `ToLongFunction<T>`, `ToDoubleFunction<T>`;
- `IntConsumer`, `LongConsumer`, `DoubleConsumer`;
- `IntSupplier`, `LongSupplier`, `DoubleSupplier`, `BooleanSupplier`;
- `IntUnaryOperator`, `LongUnaryOperator`, `DoubleUnaryOperator`;
- `IntBinaryOperator`, `LongBinaryOperator`, `DoubleBinaryOperator`.

Rule praktis:

> Untuk API domain biasa, readability lebih penting. Untuk tight loop, parsing, metrics, codecs, ranking, scoring, dan high-throughput path, pertimbangkan primitive specialization.

---

## 6. Standard vs Custom Functional Interface

Ini keputusan penting.

### 6.1 Gunakan Standard Interface Jika Shape Sudah Cukup Jelas

```java
public List<Application> findMatching(Predicate<Application> filter) {
    return applications.stream()
        .filter(filter)
        .toList();
}
```

Ini jelas: caller memberi predicate untuk filter.

```java
public <T, R> List<R> map(List<T> values, Function<T, R> mapper) {
    return values.stream().map(mapper).toList();
}
```

Ini generic utility; `Function` cocok.

### 6.2 Buat Custom Interface Jika Contract Domain Lebih Penting daripada Shape

Kurang kuat:

```java
public Decision decide(Application application, Function<Application, Decision> rule) {
    return rule.apply(application);
}
```

Lebih baik:

```java
@FunctionalInterface
public interface DecisionRule {
    Decision decide(Application application);
}

public Decision decide(Application application, DecisionRule rule) {
    return rule.decide(application);
}
```

Manfaat custom interface:

1. method name lebih bermakna;
2. documentation bisa domain-specific;
3. bisa tambah default combinator domain;
4. bisa validasi null/precondition;
5. bisa menjadi SPI publik;
6. bisa diberi annotation;
7. lebih mudah dicari di codebase;
8. stack trace/design intent lebih jelas;
9. API lebih stabil;
10. dapat membawa semantic rule seperti idempotency, determinism, dan exception policy.

### 6.3 Contoh Custom Interface dengan Domain Combinator

```java
@FunctionalInterface
public interface EligibilityRule {
    boolean isSatisfiedBy(Application application);

    default EligibilityRule and(EligibilityRule other) {
        Objects.requireNonNull(other, "other");
        return application -> this.isSatisfiedBy(application) && other.isSatisfiedBy(application);
    }

    default EligibilityRule or(EligibilityRule other) {
        Objects.requireNonNull(other, "other");
        return application -> this.isSatisfiedBy(application) || other.isSatisfiedBy(application);
    }

    default EligibilityRule negate() {
        return application -> !this.isSatisfiedBy(application);
    }

    static EligibilityRule alwaysTrue() {
        return application -> true;
    }
}
```

Ini lebih domain-centric daripada `Predicate<Application>` jika rule tersebut menjadi bahasa domain.

### 6.4 Jangan Membuat Custom Interface Jika Hanya Mengganti Nama Tanpa Nilai

```java
@FunctionalInterface
public interface StringFunction {
    String apply(String value);
}
```

Ini tidak banyak memberi nilai dibanding:

```java
UnaryOperator<String>
```

Kecuali ada semantic khusus seperti:

```java
@FunctionalInterface
public interface PostalCodeNormalizer {
    PostalCode normalize(String rawPostalCode);
}
```

---

## 7. Naming Functional Parameters

Nama parameter functional sangat mempengaruhi readability.

Buruk:

```java
public Result handle(Application application, Function<Application, Result> function) {
    return function.apply(application);
}
```

Lebih baik:

```java
public Result handle(Application application, Function<Application, Result> evaluator) {
    return evaluator.apply(application);
}
```

Lebih domain-specific:

```java
public Decision handle(Application application, DecisionRule decisionRule) {
    return decisionRule.decide(application);
}
```

Guideline nama:

| Shape | Nama parameter bagus | Nama buruk |
|---|---|---|
| `Predicate<T>` | `filter`, `condition`, `guard`, `rule`, `matcher` | `predicate`, `p`, `func` |
| `Function<T,R>` | `mapper`, `resolver`, `converter`, `projector`, `evaluator` | `function`, `fn` |
| `Consumer<T>` | `sink`, `handler`, `listener`, `observer`, `writer` | `consumer`, `c` |
| `Supplier<T>` | `factory`, `provider`, `loader`, `source`, `clock` | `supplier`, `s` |
| `UnaryOperator<T>` | `normalizer`, `sanitizer`, `transformer` | `op`, `operator` |
| `BinaryOperator<T>` | `merger`, `combiner`, `resolver` | `bo`, `binop` |

Nama `fn` boleh untuk kode lokal singkat, bukan API publik.

---

## 8. Higher-Order Function di Java

Higher-order function adalah function yang menerima function lain atau mengembalikan function.

### 8.1 Function Menerima Function

```java
public static <T> List<T> filter(List<T> values, Predicate<T> predicate) {
    return values.stream()
        .filter(predicate)
        .toList();
}
```

### 8.2 Function Mengembalikan Function

```java
public static Predicate<Application> statusIs(Status status) {
    return application -> application.status() == status;
}
```

Pemakaian:

```java
Predicate<Application> submitted = statusIs(Status.SUBMITTED);
```

### 8.3 Function yang Mengubah Function

```java
public static <T> Predicate<T> not(Predicate<T> predicate) {
    Objects.requireNonNull(predicate, "predicate");
    return predicate.negate();
}
```

### 8.4 Domain Higher-Order API

```java
public static EligibilityRule require(String reason, EligibilityRule rule) {
    Objects.requireNonNull(reason, "reason");
    Objects.requireNonNull(rule, "rule");

    return application -> {
        boolean passed = rule.isSatisfiedBy(application);
        if (!passed) {
            // could record reason in diagnostic context in a richer design
        }
        return passed;
    };
}
```

Namun perhatikan: jika alasan kegagalan penting, boolean rule tidak cukup. Gunakan result object.

---

## 9. Composition of Functions

### 9.1 Function Composition

`Function` menyediakan:

```java
compose
andThen
identity
```

Contoh:

```java
Function<String, String> trim = String::trim;
Function<String, String> upper = value -> value.toUpperCase(Locale.ROOT);
Function<String, PostalCode> toPostalCode = PostalCode::new;

Function<String, PostalCode> normalizePostalCode = trim
    .andThen(upper)
    .andThen(toPostalCode);
```

Urutan penting:

```java
f.andThen(g)  // g(f(x))
f.compose(g) // f(g(x))
```

### 9.2 Predicate Composition

```java
Predicate<Application> submitted = app -> app.status() == Status.SUBMITTED;
Predicate<Application> highRisk = app -> app.riskScore() >= 80;
Predicate<Application> manualReview = submitted.and(highRisk);
```

### 9.3 Consumer Composition

```java
Consumer<AuditEvent> log = event -> logger.info("{}", event);
Consumer<AuditEvent> save = auditRepository::save;

Consumer<AuditEvent> audit = log.andThen(save);
```

Perhatikan failure behavior:

```java
audit.accept(event);
```

Jika `log` throw, `save` tidak jalan. Ini harus jelas dalam contract.

### 9.4 Operator Composition

```java
UnaryOperator<String> normalize = ((UnaryOperator<String>) String::trim)
    .andThen(value -> value.toUpperCase(Locale.ROOT))::apply;
```

Kadang eksplisit lebih jelas:

```java
UnaryOperator<String> normalize = value -> value.trim().toUpperCase(Locale.ROOT);
```

Jangan memaksa composition jika imperative code lebih readable.

---

## 10. Callback vs Strategy vs Policy vs Event Handler

Banyak API menerima function. Tapi tidak semua function punya makna sama.

### 10.1 Callback

Callback adalah function yang dipanggil oleh framework/API pada saat tertentu.

```java
public void withTransaction(Consumer<TransactionContext> work) {
    TransactionContext tx = begin();
    try {
        work.accept(tx);
        commit(tx);
    } catch (RuntimeException e) {
        rollback(tx);
        throw e;
    }
}
```

Pertanyaan wajib:

- Kapan dipanggil?
- Berapa kali dipanggil?
- Dalam thread apa?
- Dalam transaction apa?
- Kalau throw, apa yang terjadi?
- Boleh menyimpan reference context keluar scope?

### 10.2 Strategy

Strategy adalah perilaku yang dipilih dan digunakan untuk mencapai tujuan.

```java
@FunctionalInterface
public interface AssignmentStrategy {
    Officer assign(Application application, List<Officer> candidates);
}
```

Strategy biasanya lebih stabil jika dibuat custom interface daripada `BiFunction`.

### 10.3 Policy

Policy adalah aturan konfiguratif yang mengendalikan keputusan.

```java
@FunctionalInterface
public interface EscalationPolicy {
    EscalationDecision evaluate(CaseFile caseFile, Instant now);
}
```

Policy sering harus deterministic dan auditable.

### 10.4 Event Handler

```java
@FunctionalInterface
public interface DomainEventHandler<E extends DomainEvent> {
    void handle(E event);
}
```

Handler biasanya side-effecting. Contract harus jelas:

- at-least-once atau exactly-once?
- idempotent?
- retryable?
- ordered?
- transactional?

Menggunakan `Consumer<E>` mungkin terlalu miskin jika semantics penting.

---

## 11. Functional Interface sebagai Extension Point

API bisa dibuat extensible tanpa inheritance berat.

### 11.1 Simple Extension Point

```java
public final class ValidationPipeline<T> {
    private final List<Validator<T>> validators;

    public ValidationPipeline(List<Validator<T>> validators) {
        this.validators = List.copyOf(validators);
    }

    public ValidationResult validate(T value) {
        List<Violation> violations = new ArrayList<>();
        for (Validator<T> validator : validators) {
            violations.addAll(validator.validate(value).violations());
        }
        return ValidationResult.of(violations);
    }
}

@FunctionalInterface
public interface Validator<T> {
    ValidationResult validate(T value);
}
```

Pemakaian:

```java
Validator<Application> applicantRequired = application ->
    application.applicant() == null
        ? ValidationResult.invalid("applicant.required")
        : ValidationResult.valid();
```

### 11.2 Extension Point dengan Metadata

Functional interface tidak bisa menyimpan metadata jika implementasinya lambda biasa.

Jika butuh metadata:

```java
public interface NamedValidator<T> {
    String code();
    ValidationResult validate(T value);
}
```

Ini bukan functional interface karena punya dua abstract methods.

Solusi 1: pakai record wrapper.

```java
public record ValidationRule<T>(
    String code,
    Validator<T> validator
) {
    public ValidationResult validate(T value) {
        return validator.validate(value);
    }
}
```

Solusi 2: default metadata, tapi hati-hati.

```java
@FunctionalInterface
public interface Validator<T> {
    ValidationResult validate(T value);

    default String code() {
        return getClass().getName();
    }
}
```

Untuk lambda, `getClass().getName()` biasanya tidak meaningful untuk business audit.

---

## 12. Exception Policy dalam Functional Interfaces

Standard functional interfaces tidak mendeklarasikan checked exception.

Contoh gagal compile:

```java
Function<Path, String> read = path -> Files.readString(path); // IOException
```

Karena `Function.apply` tidak `throws IOException`.

### 12.1 Option 1: Tangkap dan Bungkus

```java
Function<Path, String> read = path -> {
    try {
        return Files.readString(path);
    } catch (IOException e) {
        throw new UncheckedIOException(e);
    }
};
```

Cocok jika boundary memang ingin mengubah checked exception menjadi unchecked.

### 12.2 Option 2: Custom Throwing Functional Interface

```java
@FunctionalInterface
public interface ThrowingFunction<T, R, E extends Exception> {
    R apply(T value) throws E;
}
```

Pemakaian:

```java
ThrowingFunction<Path, String, IOException> read = Files::readString;
```

### 12.3 Option 3: Result Type

```java
@FunctionalInterface
public interface SafeFunction<T, R> {
    Result<R> apply(T value);
}
```

Ini cocok jika failure adalah bagian domain flow, bukan exceptional flow.

### 12.4 Anti-Pattern: Sneaky Throws Tanpa Boundary Jelas

```java
@SuppressWarnings("unchecked")
static <E extends Throwable> void sneakyThrow(Throwable t) throws E {
    throw (E) t;
}
```

Secara teknik bisa, tapi sering menghancurkan readability dan contract. Gunakan hanya jika benar-benar memahami boundary-nya.

---

## 13. Null Policy

Functional interface harus punya null policy.

### 13.1 Null Input

```java
Predicate<String> nonBlank = value -> !value.isBlank();
```

Jika `value == null`, NPE.

Bisa dibuat eksplisit:

```java
Predicate<String> nonBlank = value -> value != null && !value.isBlank();
```

Namun ini mengubah semantics: null dianggap false.

### 13.2 Null Output

```java
Function<String, PostalCode> parse = value -> value == null ? null : new PostalCode(value);
```

Ini buruk jika caller tidak tahu output bisa null.

Lebih jelas:

```java
Function<String, Optional<PostalCode>> parse = value ->
    value == null ? Optional.empty() : Optional.of(new PostalCode(value));
```

Atau domain result:

```java
PostalCodeParseResult parse(String raw);
```

### 13.3 API Boundary Rule

Untuk API publik:

- dokumentasikan apakah function boleh null;
- dokumentasikan apakah input ke function bisa null;
- dokumentasikan apakah output function boleh null;
- gunakan `Objects.requireNonNull` untuk callback yang wajib ada;
- jangan diam-diam menerima null kecuali itu bagian explicit contract.

Contoh:

```java
public <T, R> List<R> mapNonNull(List<T> values, Function<T, R> mapper) {
    Objects.requireNonNull(values, "values");
    Objects.requireNonNull(mapper, "mapper");

    List<R> result = new ArrayList<>(values.size());
    for (T value : values) {
        R mapped = Objects.requireNonNull(mapper.apply(value), "mapper returned null");
        result.add(mapped);
    }
    return List.copyOf(result);
}
```

---

## 14. Determinism, Idempotency, and Side Effects

Dua lambda dengan shape sama bisa punya sifat operasional berbeda.

```java
Function<Application, RiskScore> pure = app -> RiskScore.calculate(app.answers());
```

vs

```java
Function<Application, RiskScore> impure = app -> riskEngineClient.calculate(app);
```

Shape sama: `Application -> RiskScore`.

Semantics berbeda:

| Concern | Pure Function | Impure Function |
|---|---|---|
| Deterministic | biasanya ya | belum tentu |
| I/O | tidak | mungkin ya |
| Retry safe | biasanya ya | tergantung |
| Testability | tinggi | perlu mock/fake |
| Latency | CPU/memory lokal | network/DB/external |
| Failure | input/domain issue | timeout/network/rate limit |
| Observability | simple | butuh trace/log/metric |

Jadi jangan hanya melihat type signature.

Functional API serius perlu menjelaskan effect expectation.

Contoh custom interface:

```java
@FunctionalInterface
public interface PureRiskRule {
    RiskScore evaluate(ApplicationSnapshot snapshot);
}
```

Nama `PureRiskRule` mungkin terlalu eksplisit untuk production, tapi dokumentasinya harus menyatakan tidak boleh I/O.

---

## 15. Laziness and Evaluation Timing

`Supplier<T>` sering dipakai untuk lazy evaluation.

### 15.1 Logging Lazy Message

```java
public void debug(Supplier<String> messageSupplier) {
    if (isDebugEnabled()) {
        log(messageSupplier.get());
    }
}
```

Pemakaian:

```java
debug(() -> expensiveDiagnostic(application));
```

`expensiveDiagnostic` hanya jalan jika debug enabled.

### 15.2 Default Value Lazy

Buruk:

```java
String value = optional.orElse(expensiveDefault());
```

`expensiveDefault()` dievaluasi walaupun optional berisi value.

Lebih baik:

```java
String value = optional.orElseGet(() -> expensiveDefault());
```

### 15.3 Supplier Bisa Dipanggil Lebih dari Sekali

```java
Supplier<UUID> id = UUID::randomUUID;

UUID a = id.get();
UUID b = id.get();
```

`a` dan `b` berbeda.

Jadi contract harus jelas: supplier menghasilkan value baru setiap pemanggilan atau lazy memoized value?

### 15.4 Memoization

```java
public static <T> Supplier<T> memoize(Supplier<T> supplier) {
    Objects.requireNonNull(supplier, "supplier");

    final class MemoizedSupplier implements Supplier<T> {
        private volatile boolean initialized;
        private T value;

        @Override
        public T get() {
            if (!initialized) {
                synchronized (this) {
                    if (!initialized) {
                        value = supplier.get();
                        initialized = true;
                    }
                }
            }
            return value;
        }
    }

    return new MemoizedSupplier();
}
```

Ini contoh sederhana. Untuk production, perhatikan:

- null value;
- exception caching;
- memory visibility;
- invalidation;
- lifecycle;
- concurrency contention.

---

## 16. Currying and Partial Application in Java

Java tidak punya currying native seperti bahasa functional murni, tapi bisa dimodelkan.

### 16.1 Partial Application

```java
static Function<Application, Decision> withOfficer(Officer officer) {
    return application -> DecisionService.decide(application, officer);
}
```

Pemakaian:

```java
Function<Application, Decision> decideForAlice = withOfficer(alice);
Decision decision = decideForAlice.apply(application);
```

### 16.2 Curried Function

```java
Function<Officer, Function<Application, Decision>> decide =
    officer -> application -> DecisionService.decide(application, officer);
```

Pemakaian:

```java
Decision decision = decide
    .apply(alice)
    .apply(application);
```

Ini bisa powerful, tetapi sering kurang idiomatik untuk tim enterprise Java.

### 16.3 Kapan Cocok?

Cocok untuk:

- rule factory;
- reusable predicate builder;
- query specification builder;
- authorization guard builder;
- validation builder.

Contoh:

```java
static Predicate<Application> submittedBefore(Instant deadline) {
    return application -> application.submittedAt().isBefore(deadline);
}
```

Ini lebih readable daripada curried style eksplisit.

---

## 17. Designing Fluent Functional APIs

Functional interfaces sering dipakai untuk fluent API.

Contoh builder validation:

```java
public final class RuleSet<T> {
    private final List<Validator<T>> validators;

    private RuleSet(List<Validator<T>> validators) {
        this.validators = List.copyOf(validators);
    }

    public static <T> RuleSet<T> empty() {
        return new RuleSet<>(List.of());
    }

    public RuleSet<T> add(Validator<T> validator) {
        Objects.requireNonNull(validator, "validator");
        List<Validator<T>> next = new ArrayList<>(validators);
        next.add(validator);
        return new RuleSet<>(next);
    }

    public ValidationResult validate(T value) {
        List<Violation> violations = new ArrayList<>();
        for (Validator<T> validator : validators) {
            violations.addAll(validator.validate(value).violations());
        }
        return ValidationResult.of(violations);
    }
}
```

Pemakaian:

```java
RuleSet<Application> rules = RuleSet.<Application>empty()
    .add(app -> required(app.applicant(), "applicant"))
    .add(app -> required(app.submissionDate(), "submissionDate"))
    .add(app -> validPostalCode(app.postalCode()));
```

Masalah: lambda pendek bagus; lambda panjang membuat fluent chain sulit dibaca.

Rule praktis:

> Jika lambda lebih dari 5-7 baris atau punya branching kompleks, beri nama sebagai method/class.

---

## 18. Function Composition vs Object Composition

Functional composition:

```java
Function<RawApplication, ApplicationCommand> pipeline = parse
    .andThen(validate)
    .andThen(normalize)
    .andThen(toCommand);
```

Object composition:

```java
public final class ApplicationCommandAssembler {
    private final Parser parser;
    private final Validator validator;
    private final Normalizer normalizer;

    public ApplicationCommand assemble(RawApplication raw) {
        ParsedApplication parsed = parser.parse(raw);
        validator.validate(parsed).throwIfInvalid();
        NormalizedApplication normalized = normalizer.normalize(parsed);
        return toCommand(normalized);
    }
}
```

Functional composition cocok jika:

- step benar-benar linear;
- semua step pure atau failure model seragam;
- type transition jelas;
- observability tidak rumit;
- tidak ada transaction boundary rumit.

Object composition cocok jika:

- ada banyak dependencies;
- step butuh logging/tracing/metrics;
- ada branching kompleks;
- ada transaction/external boundary;
- behavior perlu diberi nama dan diuji terpisah;
- lifecycle object penting.

Top engineer tidak fanatik. Ia memilih bentuk yang membuat invariant dan failure lebih jelas.

---

## 19. Lambda as Dependency Injection Boundary

Kadang kita tidak perlu interface/class besar untuk dependency sederhana.

### 19.1 Clock/ID Provider

```java
public final class SubmissionService {
    private final Supplier<Instant> now;
    private final Supplier<UUID> idGenerator;

    public SubmissionService(Supplier<Instant> now, Supplier<UUID> idGenerator) {
        this.now = Objects.requireNonNull(now);
        this.idGenerator = Objects.requireNonNull(idGenerator);
    }

    public Submission submit(ApplicationDraft draft) {
        return new Submission(idGenerator.get(), draft, now.get());
    }
}
```

Test:

```java
SubmissionService service = new SubmissionService(
    () -> Instant.parse("2026-01-01T00:00:00Z"),
    () -> UUID.fromString("00000000-0000-0000-0000-000000000001")
);
```

Ini sederhana dan bagus.

### 19.2 Tapi Jangan Ganti Semua Dependency Jadi Function

Buruk:

```java
public final class CaseService {
    private final Function<String, CaseFile> findCase;
    private final Consumer<CaseFile> saveCase;
    private final Function<CaseFile, Decision> decide;
    private final Consumer<AuditEvent> audit;
}
```

Ini kehilangan domain vocabulary dan lifecycle.

Lebih baik:

```java
public final class CaseService {
    private final CaseRepository caseRepository;
    private final DecisionEngine decisionEngine;
    private final AuditPublisher auditPublisher;
}
```

Gunakan lambda dependency untuk seam kecil dan jelas, bukan mengganti seluruh architecture.

---

## 20. Functional Interface and Thread Safety

Lambda bisa capture mutable object.

```java
List<String> buffer = new ArrayList<>();
Consumer<String> collector = value -> buffer.add(value);
```

Jika dipakai di parallel/asynchronous context, ini tidak thread-safe.

```java
values.parallelStream().forEach(collector); // dangerous
```

Functional interface tidak otomatis pure/thread-safe.

API yang menerima function harus mendokumentasikan concurrency behavior:

```java
/**
 * The mapper may be invoked concurrently from multiple threads.
 * Implementations must be thread-safe and must not rely on invocation order.
 */
public <T, R> List<R> parallelMap(List<T> values, Function<T, R> mapper) {
    return values.parallelStream().map(mapper).toList();
}
```

Jika function dipanggil sequentially, katakan juga jika penting.

---

## 21. Ordering and Invocation Count

Apakah callback dipanggil:

- zero times?
- one time?
- at least once?
- at most once?
- exactly once?
- once per element?
- until predicate true?
- lazily?
- eagerly?
- after transaction commit?
- before persist?
- in registration order?

Contoh ambiguous:

```java
void register(Consumer<Event> handler);
```

Lebih jelas:

```java
/**
 * Registers a handler invoked once for each committed domain event.
 * Handlers are invoked after the database transaction commits.
 * A handler failure is logged and does not roll back the transaction.
 * Handlers must be idempotent because event delivery may be retried.
 */
void registerPostCommitHandler(EventHandler handler);
```

Ini terlihat panjang, tapi contract seperti ini menyelamatkan production system.

---

## 22. Functional Interfaces in Public API

Public API punya beban kompatibilitas.

### 22.1 Mengganti Parameter Type Bisa Breaking

```java
void validate(Predicate<Application> rule);
```

Mengubah menjadi:

```java
void validate(EligibilityRule rule);
```

Bisa breaking untuk caller.

Karena itu, tentukan dari awal apakah semantic domain perlu custom interface.

### 22.2 Menambah Abstract Method Breaking

```java
@FunctionalInterface
interface Rule {
    boolean test(Application application);
}
```

Menambah abstract method:

```java
String name();
```

Breaking.

Solusi:

- tambah default method;
- buat interface baru;
- wrap rule dengan metadata object;
- gunakan record/class untuk metadata.

### 22.3 Menambah Default Method Biasanya Lebih Aman, Tapi Tidak Selalu

Default method dapat konflik jika implementation class sudah punya method dengan signature tertentu atau jika multiple inheritance interface memunculkan ambiguity.

Untuk API publik, default method tetap harus direview.

---

## 23. Functional Interface and Binary Compatibility

Functional interface tetap interface biasa pada level binary. Lambda call site dikompilasi terhadap target interface dan method descriptor.

Risiko perubahan:

| Perubahan | Risiko |
|---|---|
| Rename abstract method | breaking |
| Ubah parameter method | breaking |
| Ubah return type | breaking kecuali covariant dalam batas tertentu |
| Tambah abstract method | breaking untuk lambda/source compatibility |
| Tambah default method | relatif aman tapi perlu konflik check |
| Hapus default method | breaking jika caller pakai |
| Ubah generic signature | bisa source/binary/behavioral risk |
| Ubah exception contract | source compatibility risk |

Untuk library internal enterprise, treat functional interface sebagai public contract jika dipakai lintas module/service/team.

---

## 24. Functional Interfaces and Reflection

Lambda-generated classes tidak didesain sebagai stable reflection target.

Contoh:

```java
Predicate<String> p = value -> value.length() > 3;
System.out.println(p.getClass());
```

Class name internal tidak boleh dijadikan contract.

Jangan lakukan:

```java
String className = p.getClass().getName();
// persist as rule identity
```

Buruk untuk audit/configuration.

Jika rule perlu identity:

```java
public record NamedRule<T>(
    String code,
    Predicate<T> predicate
) {
    public boolean test(T value) {
        return predicate.test(value);
    }
}
```

Atau:

```java
public interface Rule<T> {
    String code();
    RuleResult evaluate(T value);
}
```

---

## 25. Functional Interfaces and Code Generation

Code generator sering menghasilkan mapper/validator/client yang memakai functional interface.

Contoh generator menghasilkan registry:

```java
public final class GeneratedApplicationMappers {
    public static final Function<ApplicationEntity, ApplicationDto> TO_DTO = entity ->
        new ApplicationDto(entity.id(), entity.status(), entity.submittedAt());

    private GeneratedApplicationMappers() {}
}
```

Ini simple tapi punya trade-off:

- stack trace mungkin kurang jelas;
- lambdas sulit diberi breakpoint granular;
- reflection identity tidak stable;
- generated code update bisa mengubah binary behavior;
- null policy harus jelas.

Alternatif generated class:

```java
public final class ApplicationEntityToDtoMapper
        implements Function<ApplicationEntity, ApplicationDto> {

    @Override
    public ApplicationDto apply(ApplicationEntity entity) {
        Objects.requireNonNull(entity, "entity");
        return new ApplicationDto(entity.id(), entity.status(), entity.submittedAt());
    }
}
```

Lebih verbose, tapi lebih mudah debug dan punya class identity stabil.

---

## 26. Functional Interfaces and Modules / JPMS

Functional interface sebagai public API module harus diekspor.

```java
module com.example.caseapi {
    exports com.example.caseapi.rules;
}
```

Jika interface berada di package internal yang tidak diekspor, module lain tidak bisa menggunakannya secara normal.

Perhatikan juga service provider:

```java
module com.example.caseapi {
    exports com.example.caseapi.spi;
    uses com.example.caseapi.spi.CaseRuleProvider;
}
```

```java
module com.example.rules.highrisk {
    requires com.example.caseapi;
    provides com.example.caseapi.spi.CaseRuleProvider
        with com.example.rules.highrisk.HighRiskRuleProvider;
}
```

Apakah provider interface functional?

```java
@FunctionalInterface
public interface CaseRuleProvider {
    List<CaseRule> rules();
}
```

Bisa, tapi `ServiceLoader` biasanya instantiate provider class via no-arg constructor/provider method mechanism. Lambda tidak langsung menjadi service provider lintas module descriptor. Untuk plugin architecture, class provider sering lebih tepat.

---

## 27. Functional Interface vs SPI

SPI sering butuh:

- lifecycle;
- metadata;
- configuration;
- versioning;
- capability negotiation;
- multiple methods;
- initialization;
- shutdown;
- diagnostics.

Functional interface cocok untuk SPI kecil:

```java
@FunctionalInterface
public interface PostalCodeNormalizer {
    PostalCode normalize(String raw);
}
```

Tidak cocok untuk SPI kaya:

```java
public interface PaymentGatewayProvider {
    String providerCode();
    void initialize(GatewayConfig config);
    PaymentResult pay(PaymentRequest request);
    RefundResult refund(RefundRequest request);
    HealthStatus health();
    void shutdown();
}
```

Jangan memaksakan semua extension point menjadi lambda.

---

## 28. Designing Throwing Functional Utilities

Kadang kita ingin adapter dari throwing function ke standard function.

```java
@FunctionalInterface
public interface ThrowingFunction<T, R> {
    R apply(T value) throws Exception;

    static <T, R> Function<T, R> unchecked(ThrowingFunction<T, R> function) {
        Objects.requireNonNull(function, "function");
        return value -> {
            try {
                return function.apply(value);
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
    }
}
```

Pemakaian:

```java
Function<Path, String> read = ThrowingFunction.unchecked(Files::readString);
```

Namun untuk library production, lebih baik exception wrapper spesifik:

```java
throw new FileReadFailureException(path, e);
```

Generic `RuntimeException` kehilangan context.

---

## 29. Designing Diagnostic Functional Interfaces

Boolean predicate sering kurang cukup.

Buruk untuk validation serius:

```java
Predicate<Application> valid = app -> app.applicant() != null;
```

Caller hanya tahu true/false.

Lebih baik:

```java
@FunctionalInterface
public interface ValidationRule<T> {
    ValidationResult validate(T value);
}
```

```java
public record ValidationResult(List<Violation> violations) {
    public boolean isValid() {
        return violations.isEmpty();
    }

    public static ValidationResult valid() {
        return new ValidationResult(List.of());
    }

    public static ValidationResult invalid(String code, String message) {
        return new ValidationResult(List.of(new Violation(code, message)));
    }
}
```

Sekarang rule menghasilkan diagnostic.

Untuk regulatory/case-management systems, ini jauh lebih defensible karena alasan keputusan bisa diaudit.

---

## 30. Rule Engine Lite dengan Functional Interfaces

Contoh domain sederhana.

```java
public record Application(
    String id,
    Status status,
    int riskScore,
    boolean hasConflict,
    boolean licenceValid
) {}

enum Status {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}

public record Decision(
    boolean approved,
    List<String> reasons
) {
    public static Decision approve() {
        return new Decision(true, List.of());
    }

    public static Decision reject(List<String> reasons) {
        return new Decision(false, List.copyOf(reasons));
    }
}
```

Rule:

```java
@FunctionalInterface
public interface DecisionRule {
    Optional<String> rejectReason(Application application);

    default DecisionRule and(DecisionRule other) {
        Objects.requireNonNull(other, "other");
        return application -> {
            Optional<String> first = this.rejectReason(application);
            return first.isPresent() ? first : other.rejectReason(application);
        };
    }
}
```

Rules:

```java
DecisionRule mustBeSubmitted = application ->
    application.status() == Status.SUBMITTED
        ? Optional.empty()
        : Optional.of("application.not.submitted");

DecisionRule licenceMustBeValid = application ->
    application.licenceValid()
        ? Optional.empty()
        : Optional.of("licence.invalid");

DecisionRule noConflict = application ->
    !application.hasConflict()
        ? Optional.empty()
        : Optional.of("application.conflict.detected");
```

Evaluator:

```java
public final class DecisionEvaluator {
    private final List<DecisionRule> rules;

    public DecisionEvaluator(List<DecisionRule> rules) {
        this.rules = List.copyOf(rules);
    }

    public Decision evaluate(Application application) {
        Objects.requireNonNull(application, "application");

        List<String> reasons = new ArrayList<>();
        for (DecisionRule rule : rules) {
            rule.rejectReason(application).ifPresent(reasons::add);
        }

        return reasons.isEmpty()
            ? Decision.approve()
            : Decision.reject(reasons);
    }
}
```

Pemakaian:

```java
DecisionEvaluator evaluator = new DecisionEvaluator(List.of(
    mustBeSubmitted,
    licenceMustBeValid,
    noConflict
));
```

Ini bukan full rule engine, tapi cukup untuk banyak domain kecil jika:

- rule count manageable;
- dependency kecil;
- failure model sederhana;
- audit reason jelas;
- rule order documented.

Jika rule perlu versioning, effective date, authoring UI, dynamic reload, conflict resolution, dan explainability mendalam, gunakan model rule yang lebih eksplisit.

---

## 31. Anti-Patterns

### 31.1 `Function<Object, Object>` Everywhere

```java
Map<String, Function<Object, Object>> handlers;
```

Ini menghapus type safety dan domain clarity.

Lebih baik:

```java
Map<CommandType, CommandHandler<? extends Command, ? extends Result>> handlers;
```

Atau registry typed dengan boundary jelas.

### 31.2 Lambda Terlalu Panjang

```java
Function<Application, Decision> decide = application -> {
    // 80 lines
};
```

Lebih baik extract method/class.

### 31.3 Side Effect Tersembunyi di `map`

```java
applications.stream()
    .map(app -> {
        auditRepository.save(AuditEvent.forApplication(app));
        return transform(app);
    })
    .toList();
```

`map` seharusnya transformasi, bukan tempat side effect utama.

### 31.4 Predicate dengan Exception sebagai Control Flow

```java
Predicate<Application> valid = app -> {
    if (app.applicant() == null) {
        throw new IllegalArgumentException("missing applicant");
    }
    return true;
};
```

Jika validation failure normal, return validation result.

### 31.5 Capturing Mutable State

```java
int[] count = {0};
Consumer<Event> handler = event -> count[0]++;
```

Ini hack untuk mengakali effectively final dan rawan concurrency/clarity issue.

### 31.6 Custom Interface Tanpa Nilai Semantik

```java
@FunctionalInterface
interface MyFunction<T, R> {
    R apply(T value);
}
```

Tidak memberi nilai dibanding `Function<T,R>` kecuali ada contract tambahan.

### 31.7 Overloaded Methods with Similar Functional Shapes

```java
void process(Function<String, String> mapper) {}
void process(UnaryOperator<String> operator) {}
```

Ambiguous untuk lambda tertentu.

### 31.8 Ignoring Invocation Semantics

```java
void retry(Supplier<Result> operation) { ... }
```

Supplier mungkin dipanggil berkali-kali. Jika operation tidak idempotent, berbahaya.

---

## 32. Decision Matrix

| Kebutuhan | Pilihan yang Cocok | Hindari |
|---|---|---|
| Filter sederhana | `Predicate<T>` | custom interface tanpa nilai |
| Mapping generic | `Function<T,R>` | mapper class berlebihan |
| Side-effect callback sederhana | `Consumer<T>` | `Function<T, Void>` |
| Lazy value | `Supplier<T>` | eager computation |
| Domain rule penting | custom functional interface | `Predicate<T>` jika butuh audit/semantic |
| Validation dengan reason | `ValidationRule<T>` return result | `Predicate<T>` boolean only |
| Extension point kecil | functional interface | inheritance hierarchy berat |
| SPI kaya/lifecycle | normal interface/class | functional interface dipaksa |
| Hot primitive path | primitive specialization | boxing-heavy `Function<Integer,...>` |
| Checked exception boundary | custom throwing interface/result | sneaky throws tanpa policy |
| Need metadata | wrapper record/class | lambda reflection identity |
| Public API stable | custom semantic interface jika perlu | `Function<Object,Object>` |

---

## 33. Checklist Mendesain API dengan Functional Interface

Sebelum menulis parameter function, jawab:

1. Apakah standard functional interface cukup jelas?
2. Apakah method name `apply/test/accept/get` cukup menyampaikan intent?
3. Apakah domain butuh nama seperti `decide`, `validate`, `normalize`, `authorize`?
4. Apakah function boleh null?
5. Apakah input bisa null?
6. Apakah output bisa null?
7. Apakah function boleh throw?
8. Kalau throw, apakah retry/rollback/logging?
9. Apakah function dipanggil sekali atau berkali-kali?
10. Apakah function lazy atau eager?
11. Apakah function dipanggil concurrent?
12. Apakah function harus pure?
13. Apakah side effect diperbolehkan?
14. Apakah ordering penting?
15. Apakah output harus deterministic?
16. Apakah function perlu metadata?
17. Apakah function perlu audit trail?
18. Apakah function perlu versioning?
19. Apakah API publik lintas module?
20. Apakah akan dipakai oleh generated code?
21. Apakah debugging stack trace masih masuk akal?
22. Apakah composition membuat code lebih jelas atau lebih opaque?
23. Apakah lambda pendek atau harus diextract?
24. Apakah primitive specialization dibutuhkan?
25. Apakah future evolution aman?

---

## 34. Practical Coding Standard

### 34.1 Standard Functional Interface

Gunakan:

```java
Predicate<T>
Function<T, R>
Consumer<T>
Supplier<T>
UnaryOperator<T>
BinaryOperator<T>
```

untuk utility/generic behavior.

### 34.2 Custom Functional Interface

Gunakan custom interface jika:

- domain semantics penting;
- method name harus jelas;
- documentation contract penting;
- ada combinator domain;
- public API perlu stabil;
- audit/failure/null/threading contract perlu ditulis;
- standard name `apply/test/accept/get` terlalu miskin.

### 34.3 Jangan Pakai Lambda untuk Logic Besar

Lambda ideal:

```java
application -> application.status() == Status.SUBMITTED
```

Bukan:

```java
application -> {
    // complex orchestration, DB access, audit, transaction, branching
}
```

### 34.4 Jangan Sembunyikan I/O dalam Function yang Tampak Pure

Buruk:

```java
Function<Application, RiskScore> score = riskClient::score;
```

Bisa diterima jika nama parameter jelas:

```java
Function<Application, RiskScore> remoteRiskScorer = riskClient::score;
```

Lebih baik untuk boundary serius:

```java
RiskScoringClient riskScoringClient;
```

### 34.5 Dokumentasikan Invocation Contract

Untuk API yang menerima callback:

```java
/**
 * Invokes handler once for every event in encounter order.
 * If handler throws, processing stops and the exception is propagated.
 */
public void forEachEvent(Consumer<Event> handler) { ... }
```

---

## 35. Studi Kasus: Escalation Policy API

Misal kita butuh API untuk menentukan apakah case harus dieskalasi.

### 35.1 Versi Terlalu Generic

```java
Function<CaseFile, Boolean> escalationRule;
```

Masalah:

- `Boolean` bisa null;
- tidak ada reason;
- method `apply` tidak domain-specific;
- tidak jelas pure/impure;
- tidak jelas audit;
- tidak jelas effective date/version.

### 35.2 Versi Predicate

```java
Predicate<CaseFile> shouldEscalate;
```

Lebih baik, tapi masih tidak ada reason.

### 35.3 Versi Domain Functional Interface

```java
@FunctionalInterface
public interface EscalationPolicy {
    EscalationDecision evaluate(EscalationContext context);
}
```

```java
public record EscalationContext(
    CaseFile caseFile,
    Instant now,
    WorkloadSnapshot workload
) {}
```

```java
public sealed interface EscalationDecision {
    record Escalate(String reasonCode, Priority priority) implements EscalationDecision {}
    record DoNotEscalate(String reasonCode) implements EscalationDecision {}
}
```

Implementasi:

```java
EscalationPolicy overdueHighRisk = context -> {
    CaseFile caseFile = context.caseFile();
    boolean overdue = caseFile.dueAt().isBefore(context.now());
    boolean highRisk = caseFile.riskScore() >= 80;

    if (overdue && highRisk) {
        return new EscalationDecision.Escalate("overdue.high_risk", Priority.HIGH);
    }
    return new EscalationDecision.DoNotEscalate("condition.not_met");
};
```

Ini jauh lebih production-grade:

- input context eksplisit;
- output decision kaya;
- reason auditable;
- priority typed;
- sealed decision exhaustive;
- policy masih bisa lambda;
- API tetap domain-centric.

---

## 36. Ringkasan Mental Model

Functional interface adalah alat kecil tapi sangat kuat.

Namun kekuatannya bukan karena membuat code lebih pendek. Kekuatannya muncul saat ia dipakai untuk menyatakan **perilaku yang dapat dipasang, disusun, diuji, dan dikontrol boundary-nya**.

Ringkasnya:

1. `Supplier<T>`: tidak ada input, menghasilkan value.
2. `Consumer<T>`: menerima input, melakukan side effect.
3. `Function<T,R>`: transformasi input ke output.
4. `Predicate<T>`: keputusan boolean.
5. `UnaryOperator<T>`: transformasi `T` ke `T`.
6. `BinaryOperator<T>`: menggabungkan dua `T` menjadi `T`.
7. Primitive specialization mengurangi boxing di hot path.
8. Standard interface cocok untuk generic shape.
9. Custom functional interface cocok untuk domain contract.
10. Higher-order API perlu contract invocation yang jelas.
11. Lambda tidak otomatis pure, deterministic, safe, atau thread-safe.
12. Boolean predicate sering kurang untuk validation/audit.
13. API publik berbasis functional interface tetap punya compatibility burden.
14. Reflection identity lambda tidak stabil untuk business metadata.
15. Generated code boleh memakai functional interface, tapi debug/identity/null policy harus jelas.

Top engineer tidak bertanya “bisa pakai lambda atau tidak?”.

Ia bertanya:

> Apakah perilaku ini cukup kecil, cukup jelas, cukup stabil, cukup aman, dan cukup terkontrak untuk direpresentasikan sebagai functional interface?

---

## 37. Latihan

### Latihan 1 — Pilih Interface yang Tepat

Untuk masing-masing kebutuhan, pilih standard atau custom functional interface:

1. generate UUID;
2. normalize postal code;
3. decide case escalation dengan reason;
4. filter submitted application;
5. send audit event;
6. parse string ke `Money` dengan kemungkinan gagal;
7. merge duplicate applicant records;
8. validate application dengan multiple violation.

Jawab bukan hanya nama interface, tapi alasan semantic-nya.

### Latihan 2 — Refactor Boolean Predicate

Ubah kode ini:

```java
Predicate<Application> valid = app ->
    app.applicant() != null &&
    app.submittedAt() != null &&
    app.status() == Status.SUBMITTED;
```

menjadi validation rule yang mengembalikan violation list.

### Latihan 3 — Define Invocation Contract

Desain API:

```java
void onCaseClosed(Consumer<CaseClosedEvent> handler);
```

Tulis dokumentasi contract untuk:

- kapan handler dipanggil;
- berapa kali;
- thread/transaction context;
- failure handling;
- idempotency expectation.

### Latihan 4 — Custom Functional Interface

Buat `AuthorizationRule` yang menerima `UserContext` dan `ActionContext`, lalu mengembalikan `AuthorizationDecision` dengan reason.

### Latihan 5 — Avoid Over-Functional Design

Ambil service yang semua dependency-nya berupa `Function`, `Consumer`, dan `Supplier`. Refactor menjadi dependency domain yang lebih jelas.

---

## 38. Referensi Resmi

- Java SE 25 API — `java.util.function`
- Java SE 25 API — `Function`, `Consumer`, `Supplier`, `Predicate`, `UnaryOperator`, `BinaryOperator`
- Java SE 25 API — `FunctionalInterface`
- Java Language Specification Java SE 25 — Functional Interfaces, Lambda Expressions, Method References, Target Typing
- Oracle Java Tutorials — Lambda Expressions and Standard Functional Interfaces

---

## 39. Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-017.md
```

Topik berikutnya:

```text
Optional, Nullability, Result Modeling, and Error Channels
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Lambdas Under the Hood: Capture, Target Typing, `invokedynamic`, and SAM](./learn-java-oop-functional-reflection-codegen-modules-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Optional, Nullability, Result Modeling, and Error Channels](./learn-java-oop-functional-reflection-codegen-modules-part-017.md)

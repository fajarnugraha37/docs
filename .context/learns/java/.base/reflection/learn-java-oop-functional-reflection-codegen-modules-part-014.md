# learn-java-oop-functional-reflection-codegen-modules-part-014

# Functional Java Mental Model: Functions, Effects, and Referential Transparency

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `014`  
> Topik: Functional Java Mental Model  
> Fokus: function, effect, purity, referential transparency, functional core, imperative shell, domain transformation, dan enterprise design.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas sisi object-oriented Java sampai composition dan object collaboration.

Pada bagian ini kita berpindah ke sisi lain yang sama pentingnya: **functional programming di Java**.

Namun penting untuk jelas sejak awal:

> Functional Java bukan berarti “semua harus pakai Stream”.

Stream hanya salah satu API.

Functional programming adalah cara berpikir tentang:

- data transformation,
- fungsi sebagai nilai,
- efek samping,
- determinisme,
- error channel,
- state mutation,
- composability,
- boundary antara pure logic dan dunia luar.

Dalam sistem enterprise, functional style paling kuat bukan ketika dipakai untuk membuat kode terlihat “pintar”, tetapi ketika dipakai untuk membuat **business logic lebih bisa diuji, lebih mudah diprediksi, lebih minim hidden state, dan lebih aman terhadap perubahan**.

---

## 1. Problem yang Sering Terjadi di Java Enterprise Code

Banyak codebase Java enterprise terlihat object-oriented, tetapi sebenarnya hanya procedural code yang dibungkus class.

Contoh umum:

```java
public class CaseService {
    public void escalate(Long caseId) {
        CaseEntity c = caseRepository.findById(caseId).orElseThrow();

        if (c.getStatus().equals("OPEN") && c.getDueDate().isBefore(LocalDate.now())) {
            c.setStatus("ESCALATED");
            c.setEscalatedAt(LocalDateTime.now());
            c.setEscalatedBy(SecurityContext.getCurrentUser());
            caseRepository.save(c);
            emailService.sendEscalationEmail(c);
            auditService.log("ESCALATED", c);
        }
    }
}
```

Kode ini terlihat sederhana, tetapi logic-nya bercampur dengan banyak hal:

- read database,
- current date/time,
- current user,
- mutation entity,
- persistence,
- email,
- audit,
- business decision,
- exception handling,
- string status,
- hidden global context.

Akibatnya:

- sulit unit test tanpa mock banyak dependency,
- sulit tahu rule bisnis sebenarnya apa,
- sulit replay decision,
- sulit memastikan idempotency,
- sulit melakukan simulation,
- sulit dipakai ulang di batch/job/event consumer,
- sulit membedakan pure decision dan side effect.

Functional mental model membantu memisahkan pertanyaan:

> “Apa keputusan bisnisnya?”  
> dari  
> “Bagaimana keputusan itu dibaca, disimpan, dikirim, dan diaudit?”

---

## 2. Functional Programming di Java: Definisi Praktis

Dalam konteks Java, functional programming bukan berarti Java berubah menjadi Haskell, Scala, Clojure, atau F#.

Java tetap:

- nominally typed,
- class-based,
- object-oriented,
- mutable by default,
- exception-based,
- null-permissive,
- side-effect-capable.

Functional programming di Java berarti menggunakan subset prinsip functional untuk membuat kode lebih:

- deterministic,
- composable,
- testable,
- explicit,
- local in reasoning,
- low in accidental state coupling.

Definisi kerja:

> Functional Java adalah gaya desain yang memprioritaskan transformasi nilai dengan fungsi eksplisit, meminimalkan hidden mutation dan hidden effects, serta memindahkan efek samping ke boundary yang jelas.

---

## 3. Function as Value

Salah satu perubahan besar sejak Java 8 adalah Java memungkinkan behavior dikirim sebagai value melalui lambda expression, method reference, dan functional interface.

Contoh:

```java
Predicate<CaseFile> overdue = c -> c.dueDate().isBefore(LocalDate.now());
Function<CaseFile, EscalationDecision> decide = c -> ...;
Consumer<EscalationDecision> audit = d -> ...;
```

Di Java, lambda tidak memiliki “function type” independen seperti beberapa bahasa functional. Lambda harus punya **target type**, biasanya functional interface.

Contoh:

```java
Predicate<String> nonBlank = s -> !s.isBlank();
```

`Predicate<String>` adalah target type.

Lambda `s -> !s.isBlank()` tidak berdiri sendiri tanpa context type.

Ini penting karena Java functional style selalu berhubungan dengan:

- interface,
- generic type,
- method overload resolution,
- type inference,
- target typing.

---

## 4. Functional Interface sebagai Carrier Behavior

Functional interface adalah interface yang memiliki satu abstract method.

Contoh dari JDK:

```java
@FunctionalInterface
public interface Predicate<T> {
    boolean test(T t);
}
```

Contoh lain:

```java
Function<T, R>      // T -> R
Consumer<T>         // T -> void, usually side effect
Supplier<T>         // () -> T
Predicate<T>        // T -> boolean
UnaryOperator<T>    // T -> T
BinaryOperator<T>   // (T, T) -> T
```

Mental model sederhana:

| Interface | Model | Bias Semantik |
|---|---:|---|
| `Function<T, R>` | `T -> R` | transformasi |
| `Predicate<T>` | `T -> boolean` | rule/filter/condition |
| `Supplier<T>` | `() -> T` | lazy value/provider |
| `Consumer<T>` | `T -> void` | effect/sink |
| `UnaryOperator<T>` | `T -> T` | transformasi same-type |
| `BinaryOperator<T>` | `(T, T) -> T` | combine/reduce |

Perhatikan: `Consumer` adalah sinyal bahwa operasi kemungkinan punya side effect, karena tidak menghasilkan return value.

---

## 5. Functional Java Bukan Anti-OOP

Salah satu asumsi lemah yang perlu dibongkar:

> “Functional programming dan OOP saling bertentangan.”

Di Java modern, keduanya bisa saling menguatkan.

OOP bagus untuk:

- identity,
- lifecycle,
- encapsulated state,
- polymorphic behavior,
- module/service boundary,
- dependency inversion,
- framework integration.

Functional style bagus untuk:

- transformation,
- validation,
- decision logic,
- rule composition,
- mapping,
- deterministic calculation,
- pipeline processing,
- idempotent domain operation.

Kombinasi yang kuat:

> Gunakan OOP untuk membentuk boundary dan collaboration.  
> Gunakan functional style untuk membuat logic di dalam boundary lebih eksplisit dan deterministik.

---

## 6. Pure Function

Pure function adalah function yang memenuhi dua properti:

1. Untuk input yang sama, selalu menghasilkan output yang sama.
2. Tidak memiliki observable side effect.

Contoh pure:

```java
static BigDecimal calculatePenalty(BigDecimal amount, BigDecimal rate) {
    return amount.multiply(rate);
}
```

Input sama menghasilkan output sama.

Tidak membaca database.
Tidak membaca clock.
Tidak menulis log.
Tidak mutate parameter.
Tidak mengirim email.
Tidak membaca global state.

Contoh tidak pure:

```java
static BigDecimal calculatePenalty(BigDecimal amount) {
    BigDecimal rate = configRepository.getPenaltyRate();
    auditService.log("PENALTY_CALCULATED");
    return amount.multiply(rate);
}
```

Masalah:

- membaca repository,
- logging,
- dependency tersembunyi,
- hasil bisa berubah walau input sama.

Pure function tidak selalu wajib, tetapi semakin banyak pure core logic, semakin mudah sistem diuji dan direasoning.

---

## 7. Referential Transparency

Referential transparency berarti expression bisa diganti dengan value hasilnya tanpa mengubah behavior program.

Contoh:

```java
int x = add(2, 3);
int y = add(2, 3) * 10;
```

Kalau `add(2, 3)` selalu `5` dan tidak punya efek samping, maka bisa diganti:

```java
int x = 5;
int y = 5 * 10;
```

Tidak ada behavior yang berubah.

Contoh tidak referentially transparent:

```java
LocalDateTime now = LocalDateTime.now();
```

`LocalDateTime.now()` tidak bisa diganti dengan satu value tetap tanpa mengubah behavior karena hasilnya bergantung waktu.

Contoh lain:

```java
UUID id = UUID.randomUUID();
```

Tidak referentially transparent karena setiap evaluasi bisa menghasilkan value berbeda.

Contoh side effect:

```java
auditService.log("X");
```

Tidak bisa dihapus/diganti tanpa mengubah efek observasi sistem.

Referential transparency bukan dogma akademik. Dalam production Java, ini membantu menjawab:

- apakah function bisa di-cache?
- apakah function bisa di-retry?
- apakah function bisa di-parallelize?
- apakah function bisa di-test tanpa mock?
- apakah function bisa direplay dari event?
- apakah function aman dipanggil dua kali?

---

## 8. Side Effect

Side effect adalah perubahan atau observasi terhadap dunia luar selain return value.

Contoh side effect:

- write database,
- update object mutable,
- send email,
- publish Kafka/RabbitMQ event,
- call HTTP API,
- read current time,
- generate random value,
- read environment variable,
- mutate collection parameter,
- log output,
- throw exception,
- acquire lock,
- sleep/thread scheduling.

Catatan penting:

> Side effect bukan selalu buruk. Sistem bisnis justru ada untuk menghasilkan side effect yang benar.

Yang buruk adalah **side effect tersembunyi, bercampur, tidak terkendali, dan tidak bisa diuji**.

Functional mindset bukan menghapus side effect, tetapi mengisolasi side effect.

---

## 9. Effect Boundary

Effect boundary adalah batas eksplisit antara pure logic dan operasi dunia luar.

Contoh struktur buruk:

```java
public void process(ApplicationId id) {
    Application app = repository.find(id);
    if (app.isComplete()) {
        app.approve();
        repository.save(app);
        email.sendApproved(app);
        audit.log(app);
    }
}
```

Business decision dan effects bercampur.

Struktur lebih baik:

```java
public ProcessingResult process(ApplicationSnapshot snapshot, ProcessingContext context) {
    Decision decision = decide(snapshot, context);
    return toResult(snapshot.id(), decision);
}
```

Lalu shell melakukan effect:

```java
public void process(ApplicationId id) {
    ApplicationSnapshot snapshot = repository.loadSnapshot(id);
    ProcessingContext context = contextProvider.currentContext();

    ProcessingResult result = decisionEngine.process(snapshot, context);

    transaction.execute(() -> {
        repository.apply(result.stateChange());
        outbox.saveAll(result.events());
        audit.saveAll(result.auditEntries());
    });
}
```

Di sini:

- `decisionEngine.process` pure atau hampir pure,
- repository/context/outbox/audit ada di boundary,
- effect bisa dikendalikan,
- decision bisa dites tanpa database.

---

## 10. Functional Core, Imperative Shell

Ini salah satu pattern paling praktis untuk Java enterprise.

> Functional core: business decision dan transformation dibuat pure atau deterministic.  
> Imperative shell: I/O, transaction, persistence, messaging, logging, security context, clock, random, dan framework integration.

Diagram:

```text
+--------------------------------------------------+
| Imperative Shell                                 |
|                                                  |
|  - HTTP controller / message listener / job      |
|  - transaction boundary                          |
|  - repository                                    |
|  - external API                                  |
|  - clock/user/config provider                    |
|  - email/event/audit                             |
|                                                  |
|       calls                                      |
|         v                                        |
|  +--------------------------------------------+  |
|  | Functional Core                            |  |
|  |                                            |  |
|  | - pure decision                            |  |
|  | - validation                               |  |
|  | - transformation                           |  |
|  | - state transition                         |  |
|  | - derived command/event                    |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+
```

Prinsip:

- Shell boleh impure.
- Core harus sebisa mungkin pure.
- Shell mengumpulkan input.
- Core mengambil keputusan.
- Shell mengeksekusi output decision.

---

## 11. Contoh: Escalation Logic dengan Functional Core

### 11.1 Versi Campur Aduk

```java
public void escalateIfOverdue(Long caseId) {
    CaseEntity entity = repository.findById(caseId).orElseThrow();

    if (!entity.getStatus().equals("OPEN")) {
        return;
    }

    if (!entity.getDueDate().isBefore(LocalDate.now())) {
        return;
    }

    entity.setStatus("ESCALATED");
    entity.setEscalatedAt(LocalDateTime.now());
    entity.setEscalatedBy(SecurityContextHolder.getContext().getAuthentication().getName());

    repository.save(entity);
    emailService.sendEscalationEmail(entity);
    auditService.log("CASE_ESCALATED", entity.getId());
}
```

Masalah:

- time hardcoded,
- current user hardcoded,
- mutation langsung,
- repository dan email bercampur rule,
- output decision tidak eksplisit,
- test butuh mock banyak hal.

### 11.2 Buat Snapshot Input

```java
public record CaseSnapshot(
    CaseId id,
    CaseStatus status,
    LocalDate dueDate,
    int escalationLevel
) {}
```

### 11.3 Buat Context Eksplisit

```java
public record EscalationContext(
    LocalDate today,
    UserId actor
) {}
```

### 11.4 Buat Decision Output

```java
public sealed interface EscalationDecision permits
    EscalationDecision.NoAction,
    EscalationDecision.Escalate {

    record NoAction(String reason) implements EscalationDecision {}

    record Escalate(
        CaseId caseId,
        CaseStatus newStatus,
        int newEscalationLevel,
        UserId actor,
        LocalDate decisionDate
    ) implements EscalationDecision {}
}
```

### 11.5 Pure Decision Function

```java
public final class EscalationRules {

    private EscalationRules() {}

    public static EscalationDecision decide(
        CaseSnapshot c,
        EscalationContext ctx
    ) {
        if (c.status() != CaseStatus.OPEN) {
            return new EscalationDecision.NoAction("case is not open");
        }

        if (!c.dueDate().isBefore(ctx.today())) {
            return new EscalationDecision.NoAction("case is not overdue");
        }

        return new EscalationDecision.Escalate(
            c.id(),
            CaseStatus.ESCALATED,
            c.escalationLevel() + 1,
            ctx.actor(),
            ctx.today()
        );
    }
}
```

Kelebihan:

- tidak ada database,
- tidak ada `LocalDate.now()` tersembunyi,
- tidak ada `SecurityContextHolder`,
- tidak ada mutation entity,
- tidak ada email,
- output decision eksplisit,
- mudah test matrix.

### 11.6 Imperative Shell

```java
public void escalateIfOverdue(CaseId id) {
    CaseSnapshot snapshot = repository.loadSnapshot(id);
    EscalationContext context = new EscalationContext(
        clock.today(),
        currentUserProvider.currentUserId()
    );

    EscalationDecision decision = EscalationRules.decide(snapshot, context);

    switch (decision) {
        case EscalationDecision.NoAction ignored -> {
            // optionally record no-op metric, but avoid noisy audit if not required
        }
        case EscalationDecision.Escalate e -> {
            transaction.execute(() -> {
                repository.markEscalated(
                    e.caseId(),
                    e.newStatus(),
                    e.newEscalationLevel(),
                    e.actor(),
                    e.decisionDate()
                );
                outbox.save(CaseEscalatedEvent.from(e));
                audit.save(AuditEntry.caseEscalated(e));
            });
        }
    }
}
```

Shell tetap imperative. Itu tidak masalah.

Yang penting: decision core bersih.

---

## 12. Determinism sebagai Engineering Property

Dalam sistem bisnis kompleks, deterministic logic sangat berharga.

Function deterministic:

```java
Decision decide(Input input, Context context)
```

Maka kita bisa:

- test semua kombinasi input,
- replay decision dari snapshot lama,
- compare old rule vs new rule,
- menjalankan simulation,
- membuat audit explanation,
- menjalankan batch repair,
- melakukan dry-run migration,
- memeriksa regression.

Jika logic tersebar di service yang membaca waktu/user/config/database secara langsung, determinism hilang.

Contoh buruk:

```java
if (LocalDate.now().isAfter(entity.getDeadline())) { ... }
```

Lebih baik:

```java
if (context.today().isAfter(snapshot.deadline())) { ... }
```

Contoh buruk:

```java
String actor = SecurityContextHolder.getContext().getAuthentication().getName();
```

Lebih baik:

```java
UserId actor = context.actor();
```

Functional style sering kali bukan soal lambda. Ini soal membuat dependency menjadi parameter eksplisit.

---

## 13. Total Function vs Partial Function

Total function adalah function yang valid untuk semua input dalam domain-nya.

Contoh total:

```java
int length(String s) {
    return s.length();
}
```

Tetapi di Java, ini sebenarnya bukan total jika `s` bisa `null`.

Lebih jujur:

```java
int length(NonBlankString s) {
    return s.value().length();
}
```

Partial function hanya valid untuk sebagian input.

Contoh:

```java
BigDecimal divide(BigDecimal a, BigDecimal b) {
    return a.divide(b);
}
```

Tidak valid jika `b` adalah zero atau division menghasilkan non-terminating decimal tanpa rounding mode.

Partial function bisa gagal lewat:

- exception,
- null,
- Optional empty,
- Result error,
- undefined behavior secara domain.

Dalam API design, partiality harus terlihat.

Buruk:

```java
CaseOfficer assignOfficer(CaseFile file)
```

Apa yang terjadi jika tidak ada officer available?

Lebih eksplisit:

```java
Optional<CaseOfficer> findAssignableOfficer(CaseFile file)
```

Atau jika perlu reason:

```java
AssignmentResult assignOfficer(CaseFile file)
```

Dengan sealed result:

```java
sealed interface AssignmentResult permits AssignmentResult.Assigned, AssignmentResult.Rejected {
    record Assigned(CaseOfficer officer) implements AssignmentResult {}
    record Rejected(String reason) implements AssignmentResult {}
}
```

---

## 14. Null sebagai Effect Channel Tersembunyi

`null` sering dipakai sebagai “tidak ada value”. Masalahnya, type signature tidak menjelaskan itu.

```java
Officer findOfficer(CaseFile file)
```

Apakah return bisa null?

Tidak terlihat.

Functional mindset mendorong explicit absence:

```java
Optional<Officer> findOfficer(CaseFile file)
```

Tetapi `Optional` juga bukan silver bullet.

Baik:

```java
Optional<Officer> findOfficer(OfficerId id)
```

Kurang baik:

```java
void assign(Optional<Officer> officer)
```

Biasanya parameter `Optional` membuat caller dan callee sama-sama bingung. Untuk parameter, lebih baik gunakan overload, domain type, atau sealed input.

Buruk sebagai field DTO/entity:

```java
public record CaseDto(Optional<String> remarks) {}
```

Lebih baik:

```java
public record CaseDto(String remarks) {}
```

Dengan nullability policy jelas di boundary serialization.

Atau:

```java
public record CaseRemarks(String value) {}
```

Jika remarks punya invariant.

---

## 15. Exception sebagai Effect Channel

Exception adalah mekanisme imperative untuk keluar dari normal control flow.

Contoh:

```java
Decision decide(CaseFile file) {
    if (file.status() == CLOSED) {
        throw new IllegalStateException("closed case cannot be escalated");
    }
    ...
}
```

Exception tidak selalu salah.

Exception tepat untuk:

- programmer error,
- invariant violation,
- impossible state,
- infrastructure failure,
- operation yang memang gagal abnormal.

Tetapi untuk expected domain outcome, exception sering buruk.

Expected domain outcome:

- case not eligible,
- duplicate submission,
- missing document,
- officer unavailable,
- transition rejected,
- validation failed.

Lebih baik dimodelkan sebagai value:

```java
sealed interface TransitionResult permits TransitionResult.Accepted, TransitionResult.Rejected {
    record Accepted(CaseStatus nextStatus) implements TransitionResult {}
    record Rejected(List<String> reasons) implements TransitionResult {}
}
```

Keuntungan:

- caller wajib menangani result,
- mudah test,
- mudah audit,
- mudah display reason ke user,
- tidak mencampur domain rejection dengan system failure.

---

## 16. Mutability sebagai Hidden Coupling

Mutable object membuat function yang terlihat pure bisa menjadi tidak pure.

Contoh:

```java
public static List<CaseFile> sortByDueDate(List<CaseFile> cases) {
    cases.sort(Comparator.comparing(CaseFile::dueDate));
    return cases;
}
```

Function ini mutate input.

Caller mungkin tidak sadar.

Lebih aman:

```java
public static List<CaseFile> sortedByDueDate(List<CaseFile> cases) {
    return cases.stream()
        .sorted(Comparator.comparing(CaseFile::dueDate))
        .toList();
}
```

Namun perhatikan: `toList()` membuat list unmodifiable dalam Stream API modern, tetapi object di dalamnya bisa saja mutable.

Mutable nested object tetap berisiko.

Contoh:

```java
public record ApplicationSnapshot(List<Document> documents) {}
```

Jika `Document` mutable, snapshot tidak benar-benar immutable.

Gunakan defensive copy:

```java
public record ApplicationSnapshot(List<DocumentSnapshot> documents) {
    public ApplicationSnapshot {
        documents = List.copyOf(documents);
    }
}
```

Dan pastikan `DocumentSnapshot` sendiri immutable.

---

## 17. Immutability dan Functional Design

Functional style sangat terbantu oleh immutability.

Immutable object:

- lebih aman sebagai value,
- lebih mudah dipakai di cache,
- lebih mudah dipakai di multi-threaded context,
- lebih mudah dipakai sebagai input pure function,
- lebih mudah diaudit,
- lebih aman dari accidental mutation.

Record membantu, tetapi hanya shallow.

```java
public record RuleInput(
    CaseStatus status,
    LocalDate dueDate,
    List<String> documents
) {
    public RuleInput {
        documents = List.copyOf(documents);
    }
}
```

Ingat:

- `final` reference bukan berarti object immutable.
- `record` bukan berarti nested state immutable.
- `List.copyOf` bukan deep copy.
- immutable collection bukan berarti element immutable.

---

## 18. Function Composition

Function composition adalah membangun function besar dari function kecil.

Contoh:

```java
Function<Application, Application> normalize = app -> app.normalizeNames();
Function<Application, ValidationResult> validate = app -> validator.validate(app);

Function<Application, ValidationResult> pipeline = normalize.andThen(validate);
```

Namun di Java enterprise, jangan terlalu cepat membuat semuanya `Function<T, R>` jika nama domain lebih jelas.

Kadang ini terlalu generik:

```java
Function<Application, Application> step1;
Function<Application, Application> step2;
```

Lebih baik:

```java
interface ApplicationNormalizer {
    ApplicationSnapshot normalize(ApplicationSnapshot input);
}

interface ApplicationEligibilityChecker {
    EligibilityResult check(ApplicationSnapshot input);
}
```

Functional style bukan berarti menghapus bahasa domain.

Rule:

> Gunakan `Function`, `Predicate`, `Supplier`, `Consumer` ketika semantiknya sederhana dan lokal.  
> Gunakan named interface/class ketika behavior adalah domain concept yang penting.

---

## 19. Predicate Composition untuk Rule Design

Predicate cocok untuk rule boolean sederhana.

Contoh:

```java
Predicate<CaseSnapshot> isOpen = c -> c.status() == CaseStatus.OPEN;
Predicate<CaseSnapshot> hasOfficer = c -> c.assignedOfficerId() != null;
Predicate<CaseSnapshot> isHighPriority = c -> c.priority() == Priority.HIGH;

Predicate<CaseSnapshot> eligibleForFastTrack =
    isOpen.and(hasOfficer).and(isHighPriority);
```

Kelebihan:

- rule kecil reusable,
- composition eksplisit,
- testable.

Tapi ada batas.

Jika perlu reason, `Predicate` tidak cukup.

Buruk:

```java
if (!eligibleForFastTrack.test(c)) {
    return "not eligible";
}
```

Reason hilang.

Lebih baik:

```java
interface EligibilityRule {
    Optional<RejectionReason> evaluate(CaseSnapshot c);
}
```

Atau:

```java
record RuleResult(boolean accepted, Optional<String> reason) {}
```

Untuk validasi banyak rule:

```java
public static ValidationResult validate(CaseSnapshot c, List<ValidationRule> rules) {
    List<Violation> violations = rules.stream()
        .map(rule -> rule.validate(c))
        .flatMap(Optional::stream)
        .toList();

    return violations.isEmpty()
        ? ValidationResult.valid()
        : ValidationResult.invalid(violations);
}
```

---

## 20. Supplier sebagai Lazy Boundary

`Supplier<T>` berarti “beri saya T saat diperlukan”.

Contoh use case:

```java
public final class ReportGenerator {
    private final Supplier<LocalDate> todaySupplier;

    public ReportGenerator(Supplier<LocalDate> todaySupplier) {
        this.todaySupplier = todaySupplier;
    }

    public Report generate(Input input) {
        LocalDate today = todaySupplier.get();
        ...
    }
}
```

Namun untuk domain clarity, lebih baik sering menggunakan abstraction bernama:

```java
interface BusinessClock {
    LocalDate today();
}
```

`Supplier` cocok untuk utility/local abstraction.

Named interface cocok untuk domain/infrastructure boundary.

Supplier juga bisa menyembunyikan expensive operation.

```java
Supplier<CustomerProfile> profile = () -> customerClient.loadProfile(customerId);
```

Jika dipanggil berkali-kali, request bisa terjadi berkali-kali.

Perlu memoization jika benar-benar dimaksud sekali.

```java
final class MemoizedSupplier<T> implements Supplier<T> {
    private final Supplier<T> delegate;
    private volatile boolean initialized;
    private T value;

    MemoizedSupplier(Supplier<T> delegate) {
        this.delegate = Objects.requireNonNull(delegate);
    }

    @Override
    public T get() {
        if (!initialized) {
            synchronized (this) {
                if (!initialized) {
                    value = delegate.get();
                    initialized = true;
                }
            }
        }
        return value;
    }
}
```

Tetapi hati-hati: memoization punya state. Itu bukan pure jika delegate tidak pure.

---

## 21. Consumer sebagai Effect Marker

`Consumer<T>` menerima input dan tidak mengembalikan result.

```java
Consumer<AuditEntry> sink = auditRepository::save;
```

Karena tidak ada return value, biasanya `Consumer` berarti effect.

Contoh pipeline yang kurang jelas:

```java
items.forEach(item -> process(item));
```

Apa efeknya?

- mutate item?
- save database?
- publish event?
- call external API?

Lebih eksplisit:

```java
items.forEach(notificationSender::send);
```

Atau untuk error handling:

```java
for (Notification notification : notifications) {
    notificationSender.send(notification);
}
```

Kadang loop imperative lebih jelas daripada `forEach`, terutama jika ada:

- checked exception,
- retry,
- transaction,
- break/continue,
- metrics,
- rate limit,
- partial failure handling.

Functional style bukan berarti semua loop harus diganti lambda.

---

## 22. Functional Style dan Streams: Gunakan untuk Transformasi, Bukan Drama

Stream paling cocok untuk:

- map,
- filter,
- flatMap,
- grouping,
- collecting,
- transformation pipeline,
- data reshaping.

Contoh baik:

```java
List<CaseSummary> summaries = cases.stream()
    .filter(CaseFile::isOpen)
    .sorted(Comparator.comparing(CaseFile::dueDate))
    .map(CaseSummary::from)
    .toList();
```

Contoh buruk:

```java
cases.stream()
    .peek(c -> audit.log(c))
    .filter(c -> {
        repository.save(c);
        return c.isOpen();
    })
    .map(c -> {
        email.send(c);
        return c;
    })
    .toList();
```

Masalah:

- side effect tersebar,
- pipeline tidak lagi sekadar transformasi,
- evaluation semantics membingungkan,
- error handling sulit,
- debugging sulit.

Rule praktis:

> Stream pipeline sebaiknya pure atau hampir pure.  
> Side effect besar lebih baik ada di shell eksplisit.

---

## 23. `map`, `flatMap`, dan Mental Model Transformasi

`map` berarti transformasi satu value menjadi satu value lain.

```java
List<CaseId> ids = cases.stream()
    .map(CaseFile::id)
    .toList();
```

`flatMap` berarti transformasi satu value menjadi banyak value, lalu diratakan.

```java
List<Document> documents = applications.stream()
    .flatMap(app -> app.documents().stream())
    .toList();
```

Dalam domain:

```java
List<Violation> violations = rules.stream()
    .flatMap(rule -> rule.validate(application).stream())
    .toList();
```

`Optional.stream()` membuat `Optional<T>` bisa masuk pipeline sebagai 0 atau 1 element.

Ini useful untuk validation/filtering:

```java
List<RejectionReason> reasons = checks.stream()
    .map(check -> check.evaluate(input))
    .flatMap(Optional::stream)
    .toList();
```

---

## 24. Jangan Mengorbankan Readability Demi Chaining

Functional chain yang terlalu panjang sering menjadi anti-pattern.

Contoh:

```java
return applications.stream()
    .filter(a -> a.status() == SUBMITTED)
    .filter(a -> a.documents().stream().anyMatch(d -> d.type() == IDENTITY))
    .collect(groupingBy(Application::agency))
    .entrySet().stream()
    .map(e -> Map.entry(e.getKey(), e.getValue().stream()
        .sorted(comparing(Application::submittedAt))
        .map(ApplicationSummary::from)
        .toList()))
    .collect(toMap(Map.Entry::getKey, Map.Entry::getValue));
```

Bisa jadi benar, tetapi sulit dibaca.

Lebih baik pecah menjadi named function:

```java
public Map<Agency, List<ApplicationSummary>> summarizeSubmittedApplications(
    List<Application> applications
) {
    Map<Agency, List<Application>> byAgency = applications.stream()
        .filter(ApplicationRules::isSubmitted)
        .filter(ApplicationRules::hasIdentityDocument)
        .collect(Collectors.groupingBy(Application::agency));

    return byAgency.entrySet().stream()
        .collect(Collectors.toMap(
            Map.Entry::getKey,
            entry -> summarizeBySubmittedTime(entry.getValue())
        ));
}

private static List<ApplicationSummary> summarizeBySubmittedTime(List<Application> applications) {
    return applications.stream()
        .sorted(Comparator.comparing(Application::submittedAt))
        .map(ApplicationSummary::from)
        .toList();
}
```

Functional style yang baik tetap memakai nama domain.

---

## 25. Domain Transformation Pipeline

Banyak business process bisa dimodelkan sebagai pipeline:

```text
Raw Input
  -> Normalize
  -> Validate
  -> Enrich
  -> Decide
  -> Produce State Change + Events + Audit Entries
```

Contoh type:

```java
public record SubmissionInput(...) {}
public record NormalizedSubmission(...) {}
public record ValidationResult(...) {}
public record EnrichedSubmission(...) {}
public record SubmissionDecision(...) {}
public record SubmissionEffects(...) {}
```

Pipeline:

```java
public SubmissionOutcome process(SubmissionInput input, ProcessingContext ctx) {
    NormalizedSubmission normalized = normalizer.normalize(input);
    ValidationResult validation = validator.validate(normalized);

    if (validation.isInvalid()) {
        return SubmissionOutcome.rejected(validation.violations());
    }

    EnrichedSubmission enriched = enricher.enrich(normalized, ctx.referenceData());
    SubmissionDecision decision = decisionEngine.decide(enriched, ctx);

    return outcomeMapper.toOutcome(decision);
}
```

Tidak semua harus chained dengan `Function.andThen`.

Yang penting:

- input/output tiap tahap jelas,
- tiap tahap punya invariant,
- efek samping tidak menyusup ke tengah,
- setiap tahap bisa dites.

---

## 26. Validation: Fail Fast vs Accumulate Errors

Imperative style sering fail fast:

```java
if (name == null) throw new ValidationException("name required");
if (email == null) throw new ValidationException("email required");
if (!validEmail(email)) throw new ValidationException("email invalid");
```

Untuk API/user input, sering lebih baik accumulate errors:

```java
public ValidationResult validate(ApplicationForm form) {
    List<Violation> violations = new ArrayList<>();

    if (isBlank(form.name())) {
        violations.add(new Violation("name", "required"));
    }

    if (isBlank(form.email())) {
        violations.add(new Violation("email", "required"));
    } else if (!isValidEmail(form.email())) {
        violations.add(new Violation("email", "invalid"));
    }

    return violations.isEmpty()
        ? ValidationResult.valid()
        : ValidationResult.invalid(violations);
}
```

Functional-style validation:

```java
@FunctionalInterface
public interface FormRule {
    Optional<Violation> validate(ApplicationForm form);
}

public static ValidationResult validate(ApplicationForm form, List<FormRule> rules) {
    List<Violation> violations = rules.stream()
        .map(rule -> rule.validate(form))
        .flatMap(Optional::stream)
        .toList();

    return ValidationResult.from(violations);
}
```

Tetapi hati-hati jika rules punya dependency atau order penting.

Jika order penting, modelkan order secara eksplisit.

---

## 27. Command/Event Generation sebagai Pure Output

Dalam enterprise systems, business decision sering menghasilkan:

- state change,
- domain event,
- audit entry,
- notification command,
- integration command,
- task assignment command.

Functional core bisa menghasilkan semua itu sebagai value.

```java
public record CaseProcessingOutput(
    List<StateChange> stateChanges,
    List<DomainEvent> events,
    List<AuditEntry> auditEntries,
    List<NotificationCommand> notifications
) {}
```

Core:

```java
public CaseProcessingOutput decide(CaseSnapshot c, ProcessingContext ctx) {
    if (!eligible(c)) {
        return CaseProcessingOutput.empty();
    }

    return new CaseProcessingOutput(
        List.of(StateChange.status(c.id(), CaseStatus.APPROVED)),
        List.of(new CaseApprovedEvent(c.id(), ctx.now())),
        List.of(AuditEntry.approved(c.id(), ctx.actor(), ctx.now())),
        List.of(NotificationCommand.caseApproved(c.id()))
    );
}
```

Shell:

```java
transaction.execute(() -> {
    stateChangeApplier.applyAll(output.stateChanges());
    outbox.saveAll(output.events());
    auditRepository.saveAll(output.auditEntries());
    notificationQueue.enqueueAll(output.notifications());
});
```

Keuntungan:

- decision bisa dry-run,
- output bisa diaudit,
- event generation deterministic,
- side effect bisa transactional,
- retry bisa lebih aman.

---

## 28. State Transition as Function

State machine cocok sekali dengan functional thinking.

Daripada:

```java
caseEntity.approve(currentUser);
repository.save(caseEntity);
```

Buat transition sebagai function:

```java
TransitionResult transition(
    CaseState current,
    CaseCommand command,
    TransitionContext context
)
```

Contoh:

```java
public sealed interface TransitionResult permits TransitionResult.Accepted, TransitionResult.Rejected {
    record Accepted(CaseState nextState, List<DomainEvent> events) implements TransitionResult {}
    record Rejected(List<RejectionReason> reasons) implements TransitionResult {}
}
```

Transition:

```java
public TransitionResult transition(
    CaseState current,
    CaseCommand command,
    TransitionContext ctx
) {
    return switch (command) {
        case CaseCommand.Approve approve -> approve(current, approve, ctx);
        case CaseCommand.Reject reject -> reject(current, reject, ctx);
        case CaseCommand.Escalate escalate -> escalate(current, escalate, ctx);
    };
}
```

Ini membuat transition:

- eksplisit,
- testable,
- replayable,
- auditable,
- compatible dengan event-driven processing.

---

## 29. Idempotency dan Functional Design

Pure function secara alami idempotent jika output hanya bergantung input.

Tetapi shell belum tentu idempotent.

Contoh tidak idempotent:

```java
emailService.send(email);
```

Jika dipanggil dua kali, email terkirim dua kali.

Functional core bisa membantu dengan menghasilkan command yang punya idempotency key.

```java
public record NotificationCommand(
    NotificationId id,
    CaseId caseId,
    String templateCode,
    Map<String, String> parameters
) {}
```

`NotificationId` bisa derived deterministic:

```java
NotificationId id = NotificationId.of("case-approved", caseId.value());
```

Shell menyimpan command dengan unique key.

```java
notificationOutbox.saveIfAbsent(command);
```

Functional design tidak otomatis menyelesaikan idempotency, tetapi membuat output effect lebih mudah dikendalikan.

---

## 30. Retry Safety

Jika function pure:

```java
Decision d = decide(input, context);
```

Retry aman karena tidak ada effect.

Jika function impure:

```java
Decision d = decideAndSendEmail(input);
```

Retry bisa mengirim email dua kali.

Rule:

> Semua operasi yang mungkin di-retry sebaiknya memisahkan decision dari effect.

Pattern:

```text
1. Load stable input
2. Compute deterministic decision
3. Persist decision/effects atomically
4. Execute external effects from outbox/idempotent worker
```

Ini bukan hanya functional style; ini reliability architecture.

---

## 31. Functional Style dan Transaction Boundary

Jangan menyembunyikan transaksi di dalam lambda tanpa kejelasan.

Buruk:

```java
cases.forEach(c -> transactionTemplate.executeWithoutResult(tx -> {
    repository.save(process(c));
}));
```

Pertanyaan:

- transaksi per case atau batch?
- partial failure bagaimana?
- retry unit apa?
- audit konsisten tidak?
- event outbox ikut transaksi tidak?

Lebih eksplisit:

```java
for (CaseSnapshot snapshot : snapshots) {
    CaseProcessingOutput output = processor.process(snapshot, context);

    transactionTemplate.executeWithoutResult(tx -> {
        stateChangeRepository.saveAll(output.stateChanges());
        outboxRepository.saveAll(output.events());
        auditRepository.saveAll(output.auditEntries());
    });
}
```

Atau batch transaction:

```java
List<CaseProcessingOutput> outputs = snapshots.stream()
    .map(snapshot -> processor.process(snapshot, context))
    .toList();

transactionTemplate.executeWithoutResult(tx -> {
    outputs.forEach(output -> {
        stateChangeRepository.saveAll(output.stateChanges());
        outboxRepository.saveAll(output.events());
        auditRepository.saveAll(output.auditEntries());
    });
});
```

Transaction boundary harus menjadi keputusan arsitektural, bukan efek samping tersembunyi di stream.

---

## 32. Functional Style dan Performance

Ada asumsi lemah lain:

> “Functional Java pasti lebih lambat.”

Tidak selalu.

Banyak lambda/stream cukup efisien untuk business code biasa. Tetapi ada trade-off.

Potensi cost:

- allocation intermediate object,
- boxing/unboxing,
- lambda capture object,
- virtual dispatch,
- stream overhead untuk collection kecil,
- debugging overhead,
- accidental repeated computation,
- poor locality jika terlalu abstrak.

Namun performance bottleneck enterprise sering bukan lambda, melainkan:

- database query,
- N+1 calls,
- network latency,
- serialization,
- lock contention,
- inefficient indexes,
- large object graph,
- excessive logging,
- remote API.

Rule praktis:

- Untuk hot loop numeric/performance-critical, benchmark.
- Untuk business transformation, readability dan correctness lebih penting.
- Hindari boxing jika processing sangat besar.
- Jangan pakai parallel stream sembarangan.
- Jangan optimize berdasarkan feeling.

---

## 33. Functional Style dan Debugging

Stream/lambda bisa lebih sulit di-debug jika terlalu padat.

Buruk:

```java
return input.stream().filter(...).map(...).flatMap(...).collect(...);
```

Lebih debug-friendly:

```java
List<Application> submitted = filterSubmitted(input);
List<Application> complete = filterComplete(submitted);
List<ApplicationSummary> summaries = summarize(complete);
return groupByAgency(summaries);
```

Named steps membuat:

- breakpoint lebih mudah,
- log lebih jelas,
- unit test per tahap,
- profiling lebih mudah,
- domain explanation lebih baik.

Functional style tidak harus chaining panjang.

---

## 34. Functional Style dan Observability

Pure core tidak seharusnya logging terlalu banyak.

Kenapa?

Karena logging adalah side effect.

Tapi sistem production perlu observability.

Solusi:

- core menghasilkan explanation value,
- shell melakukan logging/metrics/tracing.

Contoh:

```java
public record DecisionExplanation(
    String ruleCode,
    String outcome,
    Map<String, String> facts
) {}

public record Decision(
    DecisionType type,
    List<DecisionExplanation> explanations
) {}
```

Core:

```java
return new Decision(
    DecisionType.REJECTED,
    List.of(new DecisionExplanation(
        "CASE_NOT_OVERDUE",
        "rejected",
        Map.of("dueDate", c.dueDate().toString(), "today", ctx.today().toString())
    ))
);
```

Shell:

```java
decision.explanations().forEach(explanation ->
    auditLogger.logDecision(caseId, explanation)
);
```

Ini lebih baik daripada core langsung memanggil logger.

---

## 35. Functional Style dan Security Context

Security context sering menjadi hidden global dependency.

Buruk:

```java
public Decision decide(CaseFile c) {
    String role = SecurityContextHolder.getContext()
        .getAuthentication()
        .getAuthorities()
        .iterator()
        .next()
        .getAuthority();
    ...
}
```

Lebih baik:

```java
public record ActorContext(
    UserId userId,
    Set<Role> roles,
    Set<Permission> permissions
) {}

public Decision decide(CaseFile c, ActorContext actor) {
    if (!actor.permissions().contains(Permission.APPROVE_CASE)) {
        return Decision.rejected("actor lacks permission");
    }
    ...
}
```

Security framework tetap di shell.

Domain logic menerima actor fact yang sudah dinormalisasi.

Ini membuat:

- test lebih mudah,
- audit lebih jelas,
- rule lebih eksplisit,
- coupling ke Spring Security lebih rendah.

---

## 36. Functional Style dan Configuration

Config juga sering menjadi hidden dependency.

Buruk:

```java
if (amount.compareTo(config.getAutoApprovalLimit()) <= 0) { ... }
```

Jika dipanggil di core, hasil bergantung config runtime.

Lebih baik:

```java
public record ApprovalPolicy(
    BigDecimal autoApprovalLimit,
    Set<ApplicationType> eligibleTypes
) {}

public Decision decide(ApplicationSnapshot app, ApprovalPolicy policy) {
    if (app.amount().compareTo(policy.autoApprovalLimit()) <= 0) { ... }
}
```

Shell load config:

```java
ApprovalPolicy policy = policyProvider.currentPolicy();
Decision decision = engine.decide(snapshot, policy);
```

Dengan ini, decision bisa direplay dengan policy versi tertentu.

Untuk regulatory/decision systems, ini sangat penting.

---

## 37. Functional Style dan Time

Time adalah salah satu sumber nondeterminism terbesar.

Buruk:

```java
boolean overdue(CaseFile c) {
    return c.dueDate().isBefore(LocalDate.now());
}
```

Lebih baik:

```java
boolean overdue(CaseFile c, LocalDate today) {
    return c.dueDate().isBefore(today);
}
```

Atau:

```java
public record BusinessDate(LocalDate value) {}
```

Jika perlu timezone:

```java
public record BusinessClock(ZoneId zoneId, LocalDate today, Instant now) {}
```

Jangan sembunyikan timezone decision di dalam `now()`.

Untuk sistem lintas wilayah, “today” bukan fakta universal.

---

## 38. Functional Style dan Randomness/ID Generation

Randomness juga nondeterministic.

Buruk:

```java
ApplicationId id = ApplicationId.of(UUID.randomUUID());
```

di tengah pure decision.

Lebih baik:

```java
ApplicationId id = idGenerator.nextApplicationId();
```

Shell menghasilkan ID lalu masuk ke core:

```java
ApplicationId id = idGenerator.nextApplicationId();
Decision decision = engine.decide(input, context.withApplicationId(id));
```

Atau core menghasilkan request:

```java
record RequiredIds(int applicationIds, int taskIds) {}
```

Tapi biasanya lebih praktis shell menyediakan ID.

---

## 39. Functional Style dan Framework

Framework Java enterprise sering mendorong style impure:

- dependency injection,
- transactional methods,
- lazy proxy,
- repository methods,
- validation annotations,
- entity mutation,
- event listener,
- security context,
- scheduler,
- async listener.

Bukan berarti framework buruk.

Masalah muncul jika framework concepts bocor ke core business logic.

Contoh buruk:

```java
@Entity
public class CaseEntity {
    @Autowired
    private AuditService auditService;

    public void approve() {
        this.status = APPROVED;
        auditService.log(...);
    }
}
```

Lebih baik:

- entity/persistence model di shell atau adapter,
- snapshot/value model untuk core,
- core menghasilkan state transition/event,
- shell menyimpan perubahan.

Atau jika tetap domain entity mutable, minimal jangan inject infrastructure service ke entity.

---

## 40. Functional Style dengan Records dan Sealed Types

Modern Java memberi building blocks bagus untuk functional-ish design:

- record untuk immutable-ish value carrier,
- sealed interface untuk closed result hierarchy,
- pattern matching untuk dispatch by shape,
- switch expression untuk total/exhaustive decision,
- functional interface untuk behavior as value,
- `Optional` untuk absence,
- immutable collection factory/copy methods.

Contoh result modeling:

```java
public sealed interface EligibilityResult permits EligibilityResult.Eligible, EligibilityResult.Ineligible {
    record Eligible(ApprovalRoute route) implements EligibilityResult {}
    record Ineligible(List<Reason> reasons) implements EligibilityResult {
        public Ineligible {
            reasons = List.copyOf(reasons);
        }
    }
}
```

Usage:

```java
return switch (eligibility) {
    case EligibilityResult.Eligible e -> approve(e.route());
    case EligibilityResult.Ineligible i -> reject(i.reasons());
};
```

Ini membuat domain decision lebih eksplisit daripada:

```java
return null;
```

atau:

```java
throw new BusinessException("not eligible");
```

untuk expected outcome.

---

## 41. Functional Style dan Object Collaboration

Dari Part 013, kita tahu object collaboration penting.

Functional style tidak menghapus collaborator. Ia mengubah bentuk collaborator.

Contoh OOP collaborator:

```java
interface ApprovalPolicy {
    Decision decide(ApplicationSnapshot app, ActorContext actor);
}
```

Ini tetap object-oriented, tetapi method-nya bisa pure.

Functional style:

```java
BiFunction<ApplicationSnapshot, ActorContext, Decision> approvalPolicy;
```

Mana lebih baik?

Gunakan named interface jika:

- behavior adalah domain concept,
- perlu banyak implementation,
- perlu dokumentasi contract,
- perlu dependency injection,
- perlu testing seam,
- perlu stable API.

Gunakan `Function`/`Predicate` jika:

- behavior kecil,
- lokal,
- composition internal,
- tidak perlu nama domain besar.

---

## 42. Functional Style dan Code Generation

Code generation sering digunakan untuk mapper, DTO, schema model, client, validator, atau query DSL.

Functional mental model membantu menilai generated code:

- apakah generated mapper pure?
- apakah generated validator mengakumulasi error atau throw?
- apakah generated client melakukan I/O di tengah transformation?
- apakah generated code mutate input?
- apakah generated code menyembunyikan null policy?
- apakah generated code stabil terhadap API evolution?

Contoh mapper ideal:

```java
CaseSnapshot toSnapshot(CaseEntity entity)
```

Harusnya pure-ish:

- membaca field entity,
- membuat snapshot,
- tidak save DB,
- tidak call API,
- tidak update entity.

Generated code sebaiknya berada di boundary jelas:

```text
Persistence Entity -> Generated Mapper -> Core Snapshot -> Decision Engine
```

Jangan biarkan generated code menjadi tempat business rule tersembunyi kecuali generator memang didesain sebagai compiler rule formal.

---

## 43. Functional Style dan Reflection

Reflection sering membuat side effect dan dependency tidak terlihat oleh compiler.

Contoh:

```java
Object value = field.get(target);
field.set(target, newValue);
```

Dalam functional core, reflection biasanya sebaiknya dihindari.

Reflection lebih cocok di:

- framework boundary,
- serialization/deserialization,
- mapping adapter,
- test utility,
- metadata scanner,
- annotation processor/runtime processor.

Jika reflection dipakai untuk business decision, risiko:

- rule tersembunyi,
- rename field break runtime,
- access issue di JPMS,
- performance/caching issue,
- sulit trace,
- sulit refactor.

Functional style mendorong explicit model daripada reflective model.

---

## 44. Functional Style dan JPMS/Module Boundary

JPMS membantu memisahkan API publik dan internal implementation.

Functional core idealnya ada di module/package yang minim dependency.

Contoh:

```text
com.example.case.domain
  exports com.example.case.domain.api
  exports com.example.case.domain.model

com.example.case.application
  requires com.example.case.domain
  requires com.example.case.persistence
  requires com.example.case.messaging
```

Core domain module sebaiknya tidak require:

- Spring,
- Jakarta persistence,
- HTTP client,
- messaging client,
- database driver,
- framework-heavy module.

Jika core module bersih, functional reasoning lebih mudah.

---

## 45. Naming: Functional Code Harus Tetap Punya Bahasa Domain

Nama buruk:

```java
Function<A, B> f1;
Predicate<X> p2;
Consumer<Y> c3;
```

Nama baik:

```java
Function<ApplicationForm, NormalizedApplication> normalizeApplication;
Predicate<CaseSnapshot> isEligibleForEscalation;
Consumer<AuditEntry> auditSink;
```

Lebih baik jika domain penting:

```java
interface ApplicationNormalizer {
    NormalizedApplication normalize(ApplicationForm form);
}

interface EscalationEligibilityRule {
    EligibilityResult evaluate(CaseSnapshot snapshot, EscalationContext context);
}
```

Functional style tanpa nama domain menjadi puzzle.

Top engineer tidak hanya membuat kode pendek; mereka membuat kode yang mempertahankan meaning.

---

## 46. Anti-Pattern: Clever Functional Code

Contoh:

```java
return Optional.ofNullable(req)
    .map(Request::payload)
    .filter(p -> p.type().equals("X"))
    .map(p -> service.enrich(p))
    .map(p -> repository.save(p))
    .map(p -> notifier.notify(p))
    .orElseThrow();
```

Masalah:

- `Optional` dipakai sebagai control-flow pipeline terlalu jauh,
- side effect di dalam `map`,
- `repository.save` dan `notifier.notify` bukan transformasi biasa,
- error semantics tidak jelas,
- debugging sulit.

Lebih jelas:

```java
if (req == null || req.payload() == null) {
    throw new InvalidRequestException("payload is required");
}

Payload payload = req.payload();
if (!payload.type().equals("X")) {
    throw new InvalidRequestException("unsupported payload type");
}

EnrichedPayload enriched = service.enrich(payload);
SavedPayload saved = repository.save(enriched);
notifier.notify(saved);
return saved;
```

Imperative code bisa lebih baik jika process memang effect-heavy.

Functional style bukan lomba chaining.

---

## 47. Anti-Pattern: Side Effects in `map`

`map` seharusnya transformasi.

Buruk:

```java
users.stream()
    .map(user -> {
        audit.log(user);
        return user.toDto();
    })
    .toList();
```

Lebih baik:

```java
List<UserDto> dtos = users.stream()
    .map(UserDto::from)
    .toList();

audit.logUserExport(users);
```

Jika audit per user memang diperlukan:

```java
for (User user : users) {
    audit.log(user);
}

List<UserDto> dtos = users.stream()
    .map(UserDto::from)
    .toList();
```

Atau buat command:

```java
List<AuditEntry> auditEntries = users.stream()
    .map(AuditEntry::userExported)
    .toList();
```

Kemudian shell menyimpan audit entries.

---

## 48. Anti-Pattern: `peek` untuk Business Logic

`peek` sering disalahgunakan.

Buruk:

```java
orders.stream()
    .peek(order -> order.setStatus(PROCESSED))
    .peek(order -> repository.save(order))
    .toList();
```

`peek` terutama berguna untuk debugging/observability ringan, bukan business operation utama.

Lebih baik:

```java
List<OrderUpdate> updates = orders.stream()
    .map(OrderRules::markProcessed)
    .toList();

repository.saveAll(updates);
```

---

## 49. Anti-Pattern: Parallel Stream untuk I/O

Buruk:

```java
ids.parallelStream()
    .map(externalClient::fetch)
    .toList();
```

Risiko:

- pakai common ForkJoinPool,
- rate limit external API,
- timeout massal,
- thread starvation,
- observability sulit,
- retry tidak terkendali,
- transaction/security context tidak otomatis aman.

Untuk I/O concurrency, lebih baik gunakan concurrency model yang eksplisit dan sudah dibahas di seri concurrency/reliability sebelumnya.

Dalam seri ini cukup pegang rule:

> Parallel stream bukan general-purpose async I/O abstraction.

---

## 50. Anti-Pattern: Over-Abstraction dengan Function Everywhere

Buruk:

```java
class Processor<A, B, C, D> {
    private final Function<A, B> f1;
    private final Function<B, C> f2;
    private final Function<C, D> f3;
}
```

Tanpa nama domain, ini abstrak tetapi miskin meaning.

Lebih baik:

```java
class ApplicationSubmissionProcessor {
    private final ApplicationNormalizer normalizer;
    private final ApplicationValidator validator;
    private final ApplicationDecisionEngine decisionEngine;
}
```

Functional style harus mendukung domain model, bukan menggantikannya dengan algebra generik yang tidak terbaca.

---

## 51. Testing Functional Core

Pure function sangat mudah dites.

```java
@Test
void escalates_open_overdue_case() {
    CaseSnapshot snapshot = new CaseSnapshot(
        CaseId.of("C-1"),
        CaseStatus.OPEN,
        LocalDate.of(2026, 1, 10),
        0
    );

    EscalationContext context = new EscalationContext(
        LocalDate.of(2026, 1, 11),
        UserId.of("u-1")
    );

    EscalationDecision decision = EscalationRules.decide(snapshot, context);

    assertEquals(
        new EscalationDecision.Escalate(
            CaseId.of("C-1"),
            CaseStatus.ESCALATED,
            1,
            UserId.of("u-1"),
            LocalDate.of(2026, 1, 11)
        ),
        decision
    );
}
```

Tidak perlu mock repository.
Tidak perlu Spring context.
Tidak perlu clock mock.
Tidak perlu database.
Tidak perlu security context.

Test matrix juga mudah:

| Status | Due Date | Expected |
|---|---:|---|
| OPEN | yesterday | escalate |
| OPEN | today | no action |
| OPEN | tomorrow | no action |
| CLOSED | yesterday | no action |
| ESCALATED | yesterday | no action |

---

## 52. Property-Like Testing Mindset

Functional core memungkinkan test berbasis property.

Contoh invariant:

- escalation level tidak boleh turun,
- closed case tidak boleh menjadi open tanpa reopen command,
- rejected transition tidak boleh menghasilkan state change,
- approved decision harus menghasilkan audit entry,
- every generated event must contain aggregate id,
- due date comparison must be based on business date.

Contoh test:

```java
@Test
void rejected_transition_produces_no_state_change() {
    TransitionResult result = transitionEngine.transition(
        closedCaseState(),
        new CaseCommand.Approve(...),
        context()
    );

    assertInstanceOf(TransitionResult.Rejected.class, result);
}
```

Untuk property-based testing, bisa dibuat generator input, tetapi inti mental model-nya:

> Pure deterministic functions bisa diuji dengan banyak kombinasi tanpa biaya integration test besar.

---

## 53. Refactoring Legacy Service ke Functional Core

Langkah bertahap:

### Step 1 — Identifikasi Decision Logic

Cari bagian `if`, `switch`, rule, status transition, validation.

```java
if (case.status() == OPEN && case.dueDate().isBefore(LocalDate.now())) { ... }
```

### Step 2 — Buat Input Snapshot

```java
record CaseSnapshot(CaseStatus status, LocalDate dueDate, int escalationLevel) {}
```

### Step 3 — Buat Context Eksplisit

```java
record RuleContext(LocalDate today, UserId actor) {}
```

### Step 4 — Buat Output Decision

```java
sealed interface Decision permits Decision.Accept, Decision.Reject {}
```

### Step 5 — Extract Pure Function

```java
Decision decide(CaseSnapshot snapshot, RuleContext context)
```

### Step 6 — Shell Tetap Memanggil Repository/Email/Audit

Jangan refactor semuanya sekaligus.

### Step 7 — Tambahkan Unit Test Core

Test rule matrix.

### Step 8 — Kurangi Mock-heavy Test

Integration test tetap ada, tetapi tidak semua rule diuji lewat Spring/database.

---

## 54. Decision Table: Kapan Pakai Functional Style

| Situasi | Functional Style Cocok? | Catatan |
|---|---:|---|
| data transformation | Ya | map/filter/collect jelas |
| validation rule | Ya | terutama jika accumulate errors |
| state transition | Ya | input state + command -> result |
| pricing/penalty calculation | Ya | deterministic calculation |
| eligibility decision | Ya | output reason/result |
| persistence-heavy CRUD | Sebagian | core bisa pure, shell imperative |
| external API orchestration | Sebagian | efek harus eksplisit |
| streaming large data hot path | Tergantung | perhatikan performance/memory |
| complex transaction workflow | Hati-hati | transaction boundary harus jelas |
| highly stateful object lifecycle | Tidak selalu | OOP mungkin lebih natural |
| framework glue code | Tidak perlu dipaksa | imperative sering lebih jelas |

---

## 55. Practical Heuristics

Gunakan pertanyaan ini saat review code:

1. Apakah method ini membaca waktu/current user/config/global state secara tersembunyi?
2. Apakah return value cukup menjelaskan outcome?
3. Apakah expected business rejection dilempar sebagai exception?
4. Apakah method mutate input tanpa terlihat dari nama/signature?
5. Apakah Stream pipeline berisi side effect besar?
6. Apakah `Optional` dipakai untuk control flow yang terlalu panjang?
7. Apakah function bisa dites tanpa mock?
8. Apakah decision bisa direplay dengan input yang sama?
9. Apakah output effect dapat dipersist sebelum dieksekusi?
10. Apakah domain concept hilang karena semua diganti `Function<T, R>`?

---

## 56. Production Checklist

Untuk core business logic:

- [ ] Input berupa value/snapshot eksplisit.
- [ ] Context eksplisit: time, actor, policy, config, reference data.
- [ ] Tidak membaca DB langsung.
- [ ] Tidak call external API langsung.
- [ ] Tidak membaca static global context.
- [ ] Tidak mutate input.
- [ ] Output berupa decision/result/state change/event command.
- [ ] Expected rejection dimodelkan sebagai value.
- [ ] Exception dipakai untuk invalid/impossible/infrastructure failure.
- [ ] Collection input/output dicopy jika perlu immutability.
- [ ] Rule bisa dites tanpa framework.
- [ ] Nama function/interface memakai bahasa domain.
- [ ] Side effect dieksekusi di shell yang jelas.
- [ ] Transaction boundary eksplisit.
- [ ] Idempotency key dipikirkan untuk external effect.

---

## 57. Mental Model Ringkas

Pikirkan sistem Java enterprise sebagai dua layer konseptual:

```text
Imperative Shell
  - gather input
  - load state
  - read time/user/config
  - call core
  - persist output
  - publish event
  - send notification
  - audit/log/metric

Functional Core
  - normalize
  - validate
  - calculate
  - decide
  - transition
  - produce output values
```

Function yang baik:

```text
explicit input + explicit context -> explicit output
```

Function yang buruk:

```text
some input + hidden global state + mutation + I/O + exception side-channel -> unclear outcome
```

---

## 58. Hubungan dengan Part Berikutnya

Part ini membangun mental model functional programming di Java secara arsitektural.

Part berikutnya akan turun lebih teknis ke:

- lambda expression,
- target typing,
- variable capture,
- effectively final,
- method reference,
- constructor reference,
- lambda vs anonymous class,
- runtime model,
- `invokedynamic`,
- serialization/debugging concerns.

Dengan kata lain:

- Part 014 menjawab: **kapan dan mengapa functional style berguna?**
- Part 015 menjawab: **bagaimana lambda Java sebenarnya bekerja?**

---

# Referensi

- Oracle Java SE 25 API, `java.util.function` package.
- Oracle Java SE 25 API, `java.lang.FunctionalInterface`.
- Oracle Java SE 25 API, `java.util.Optional`.
- Java Language Specification Java SE 25, lambda expressions, method references, target typing, and functional interfaces.
- Oracle Java Tutorials, Lambda Expressions and Functional Interfaces.

---

# Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Mental Model Besar Java Program Structure
- Part 001 — Java Type System Deep Dive
- Part 002 — Class Anatomy
- Part 003 — Object Identity, Equality, Hashing, Immutability
- Part 004 — Encapsulation Beyond `private`
- Part 005 — Inheritance Deep Dive
- Part 006 — Interfaces Deep Dive
- Part 007 — Sealed Classes and Controlled Hierarchies
- Part 008 — Records Deep Dive
- Part 009 — Enums as Type-Safe State, Strategy, Registry, and Domain Model
- Part 010 — Nested, Inner, Local, and Anonymous Classes
- Part 011 — Generics for API Designers
- Part 012 — Advanced Polymorphism
- Part 013 — Composition, Delegation, Mixins, and Object Collaboration Design
- Part 014 — Functional Java Mental Model

Bagian berikutnya:

- Part 015 — Lambdas Under the Hood: Capture, Target Typing, Invokedynamic, and SAM

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Composition, Delegation, Mixins, and Object Collaboration Design](./learn-java-oop-functional-reflection-codegen-modules-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Lambdas Under the Hood: Capture, Target Typing, `invokedynamic`, and SAM](./learn-java-oop-functional-reflection-codegen-modules-part-015.md)

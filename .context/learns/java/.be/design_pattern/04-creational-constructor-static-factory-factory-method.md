# 04 — Creational Pattern I: Constructor, Static Factory, Factory Method

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: `04-creational-constructor-static-factory-factory-method.md`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Senior / Staff Engineering

---

## 0. Posisi Materi Ini Dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

1. pattern thinking,
2. design force,
3. trade-off,
4. object responsibility,
5. coupling dan cohesion,
6. SOLID sebagai failure-control model.

Sekarang kita mulai masuk ke kelompok pattern klasik pertama: **creational pattern**.

Namun pendekatannya bukan:

> “Ini contoh Factory Method, hafalkan UML-nya.”

Pendekatan yang lebih senior adalah:

> “Object creation adalah titik desain yang menentukan dependency, invariant, lifecycle, testability, extensibility, dan failure semantics.”

Banyak codebase Java enterprise rusak bukan karena algoritmanya buruk, tetapi karena object diciptakan secara sembarangan:

- constructor terlalu banyak parameter,
- object invalid bisa tercipta,
- service membuat dependency sendiri,
- factory tersembunyi memanggil database,
- string digunakan sebagai selector tipe,
- reflection dipakai sebagai shortcut,
- dependency injection disalahpahami sebagai pengganti desain,
- object creation bercampur dengan orchestration,
- domain invariant tersebar di service layer,
- error saat pembuatan object tidak punya makna domain.

Part ini fokus pada tiga teknik utama:

1. **Constructor**
2. **Static Factory Method**
3. **Factory Method Pattern**

Kita akan melihat kapan masing-masing tepat, kapan salah, dan bagaimana memigrasikan codebase dari constructor chaos menuju creation boundary yang lebih sehat.

---

# 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami object creation sebagai **design boundary**, bukan sekadar sintaks `new`.
2. Membedakan constructor, static factory method, factory method pattern, abstract factory, builder, dan DI container.
3. Mendesain constructor yang menjaga invariant tanpa menjadi terlalu berat.
4. Menggunakan static factory method untuk memberi nama intent, menyembunyikan representasi, melakukan validasi, caching, atau memilih subtype.
5. Menggunakan Factory Method ketika subclass, plugin, policy, atau framework perlu mengontrol tipe object yang dibuat.
6. Mengenali kapan factory adalah solusi tepat dan kapan hanya menambah accidental complexity.
7. Menghindari anti-pattern:
   - constructor doing work,
   - hidden dependency factory,
   - stringly typed factory,
   - reflection factory abuse,
   - factory that is actually a service,
   - factory that hides I/O,
   - factory explosion,
   - generic factory without domain meaning.
8. Melakukan refactoring bertahap dari object creation yang kacau menuju creation boundary yang eksplisit.
9. Mendesain creation error yang jelas:
   - invalid input,
   - unsupported type,
   - unavailable dependency,
   - inconsistent state,
   - authorization/context issue.
10. Mengaitkan pattern ini dengan Java 8–25:
    - records,
    - sealed classes,
    - switch expressions,
    - pattern matching,
    - Optional,
    - functional interfaces,
    - modules,
    - virtual-thread era object lifecycle.

---

# 2. Mental Model: Object Creation Adalah Boundary

Dalam Java, ekspresi paling sederhana untuk membuat object adalah:

```java
var user = new User("Fajar", "ADMIN");
```

Secara sintaks ini terlihat netral.

Tetapi secara desain, baris itu menjawab banyak pertanyaan:

1. Siapa yang berhak membuat `User`?
2. Apakah semua kombinasi `name` dan `role` valid?
3. Apakah `role` string bebas atau enum/domain type?
4. Apakah object `User` sudah valid setelah constructor selesai?
5. Apakah `User` butuh dependency eksternal?
6. Apakah object creation ini murah?
7. Apakah object creation ini deterministic?
8. Apakah creation bisa gagal?
9. Kalau gagal, error-nya teknis atau domain?
10. Apakah implementasi `User` boleh berubah tanpa memengaruhi caller?
11. Apakah caller perlu tahu concrete class?
12. Apakah nanti ada subtype?
13. Apakah object ini value object, entity, service, strategy, command, event, atau DTO?

Top engineer tidak melihat `new` sebagai detail kecil. Ia melihat `new` sebagai **coupling statement**.

Setiap kali sebuah class menulis:

```java
new ConcreteDependency()
```

class tersebut sedang berkata:

> “Aku tidak hanya bergantung pada behavior dependency ini, tetapi juga pada cara dependency ini dibuat.”

Itulah kenapa object creation sering perlu diatur.

---

# 3. Object Creation: Apa yang Sebenarnya Sedang Kita Desain?

Saat membuat object, kita sebenarnya sedang mendesain minimal delapan hal.

## 3.1 Invariant

Invariant adalah kondisi yang harus selalu benar setelah object tercipta.

Contoh:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        if (amount == null) {
            throw new IllegalArgumentException("amount must not be null");
        }
        if (currency == null) {
            throw new IllegalArgumentException("currency must not be null");
        }
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("amount scale exceeds currency fraction digits");
        }
        this.amount = amount;
        this.currency = currency;
    }
}
```

Constructor di atas menjaga invariant:

- amount tidak null,
- currency tidak null,
- scale amount sesuai currency.

Object yang keluar dari constructor adalah object valid.

Ini desain yang sehat.

Masalah muncul saat constructor menerima parameter yang secara sintaks valid tetapi secara domain tidak jelas.

```java
new Case("APPROVED", "REJECTED", true, false, null);
```

Di sini sulit menjawab:

- status mana yang sebenarnya berlaku?
- boolean pertama apa?
- boolean kedua apa?
- null itu optional atau bug?
- apakah kombinasi ini valid?

Constructor menjadi pintu masuk invalid state.

## 3.2 Intent

Constructor tidak punya nama selain nama class.

```java
new AuditTrail(userId, action, timestamp, metadata);
```

Mungkin ini audit untuk:

- create,
- update,
- delete,
- login,
- authorization failure,
- system sync,
- scheduled job.

Constructor tidak bisa memberi nama intent.

Static factory bisa:

```java
AuditTrail.recordUserAction(userId, action, metadata);
AuditTrail.recordSystemAction(jobName, action, metadata);
AuditTrail.recordAuthorizationFailure(userId, resource, reason);
```

Nama factory method menjadi bagian dari desain.

## 3.3 Representation Hiding

Caller yang memanggil constructor tahu concrete class.

```java
new ArrayList<>()
```

Terkadang ini baik.

Tetapi jika caller hanya butuh `List`, static factory dapat menyembunyikan representasi.

```java
List<String> names = List.of("A", "B", "C");
```

Caller tidak peduli implementasi list-nya.

Dalam domain:

```java
DecisionPath path = DecisionPath.of(steps);
```

Kita bisa mengganti internal representation tanpa mengubah caller.

## 3.4 Subtype Selection

Object creation kadang perlu memilih subtype.

```java
NotificationChannel channel = NotificationChannelFactory.create(type);
```

Atau dengan static factory pada interface/sealed hierarchy:

```java
PaymentMethod method = PaymentMethod.card(cardNumber, expiry);
PaymentMethod method = PaymentMethod.bankTransfer(accountNo);
```

Caller tidak perlu tahu:

```java
new CardPaymentMethod(...)
new BankTransferPaymentMethod(...)
```

## 3.5 Lifecycle

Beberapa object murah dan stateless.

```java
new EmailAddress("a@b.com")
```

Beberapa object mahal:

```java
new HttpClient(...)
new ObjectMapper()
new ValidatorFactory()
new DatabaseConnection(...)
```

Creation pattern harus mempertimbangkan:

- object boleh dibuat berkali-kali atau harus reuse?
- object thread-safe atau tidak?
- object punya resource eksternal?
- object perlu close?
- object managed by container?
- object punya cache internal?

## 3.6 Dependency Direction

Jika domain object membuat infrastructure object, dependency direction rusak.

Contoh buruk:

```java
public class CaseDecision {
    public void approve() {
        EmailClient emailClient = new SmtpEmailClient("host", 25);
        emailClient.send(...);
    }
}
```

Domain object sekarang tergantung SMTP.

Ini bukan hanya masalah testability. Ini masalah boundary.

## 3.7 Failure Semantics

Object creation bisa gagal karena:

1. input invalid,
2. combination invalid,
3. unsupported type,
4. missing dependency,
5. external resource unavailable,
6. authorization context tidak ada,
7. configuration corrupt.

Tidak semua failure harus ditangani sama.

Constructor biasanya cocok untuk input invalid yang deterministic.

Factory bisa lebih cocok untuk creation yang butuh selection, lookup, fallback, atau error taxonomy.

## 3.8 Evolution Surface

Constructor adalah public API yang sulit diubah.

Jika public constructor punya 8 parameter:

```java
public ReportRequest(
    String module,
    String status,
    LocalDate from,
    LocalDate to,
    String userId,
    boolean includeDraft,
    boolean includeArchived,
    boolean includeSensitive
)
```

Nanti saat butuh parameter baru, caller banyak yang pecah.

Builder atau static factory intent-specific bisa lebih stabil.

Namun builder akan dibahas di Part 5. Di Part ini kita fokus dulu pada constructor dan factory.

---

# 4. Constructor: Tool Paling Dasar, Tapi Tidak Selalu Sederhana

Constructor adalah mekanisme fundamental untuk membuat instance.

Constructor cocok ketika:

1. object punya representasi jelas,
2. parameter sedikit,
3. invariant bisa dicek lokal,
4. tidak butuh subtype selection,
5. tidak butuh dependency eksternal,
6. tidak melakukan I/O,
7. tidak perlu nama intent tambahan,
8. caller memang perlu concrete type.

Contoh sehat:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email format");
        }
        this.value = value.toLowerCase(Locale.ROOT);
    }

    public String value() {
        return value;
    }
}
```

Ini cukup baik karena:

- parameter hanya satu,
- invariant lokal,
- creation deterministic,
- tidak ada dependency eksternal,
- tidak ada I/O,
- hasilnya immutable,
- failure jelas.

## 4.1 Constructor Harus Menghasilkan Object Valid

Rule penting:

> Setelah constructor selesai, object harus berada dalam state valid.

Buruk:

```java
public class CaseFile {
    private String caseNo;
    private String status;

    public CaseFile() {
    }

    public void setCaseNo(String caseNo) {
        this.caseNo = caseNo;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
```

Masalah:

- object bisa ada tanpa `caseNo`,
- object bisa ada tanpa `status`,
- caller harus tahu urutan setter,
- invariant tidak dijaga,
- bug muncul jauh setelah object dibuat.

Lebih baik:

```java
public final class CaseFile {
    private final CaseNumber caseNumber;
    private final CaseStatus status;

    public CaseFile(CaseNumber caseNumber, CaseStatus status) {
        this.caseNumber = Objects.requireNonNull(caseNumber);
        this.status = Objects.requireNonNull(status);
    }
}
```

Namun tidak semua object harus immutable. Entity persistence kadang butuh lifecycle dan mutasi. Tetapi bahkan entity pun sebaiknya punya creation path valid.

## 4.2 Constructor dan Validation: Seberapa Banyak?

Constructor boleh melakukan validasi lokal.

Boleh:

```java
if (amount.signum() < 0) {
    throw new IllegalArgumentException("amount must not be negative");
}
```

Hati-hati:

```java
if (!userRepository.exists(userId)) {
    throw new IllegalArgumentException("user does not exist");
}
```

Constructor yang mengecek database mulai mencampur object creation dengan I/O.

Rule:

> Constructor menjaga invariant internal, bukan melakukan orchestration eksternal.

Validasi yang cocok di constructor:

- null check,
- range check,
- format check,
- consistency antar-field lokal,
- normalization ringan,
- defensive copy,
- type conversion deterministic.

Validasi yang tidak cocok:

- database lookup,
- HTTP call,
- file read,
- permission check terhadap current user,
- distributed lock,
- message publishing,
- cache warming,
- configuration reload,
- long-running computation.

## 4.3 Constructor Overloading Smell

Contoh:

```java
public class ReportRequest {
    public ReportRequest(String module) { ... }

    public ReportRequest(String module, String status) { ... }

    public ReportRequest(String module, String status, LocalDate from) { ... }

    public ReportRequest(String module, String status, LocalDate from, LocalDate to) { ... }

    public ReportRequest(String module, String status, LocalDate from, LocalDate to, boolean includeDraft) { ... }
}
```

Overloading tidak selalu salah. Tetapi jika overload mulai mewakili banyak skenario bisnis, constructor menjadi tidak ekspresif.

Masalah:

- caller sulit tahu overload mana yang benar,
- null sering dipakai untuk melewati parameter,
- boolean flag membuat intent kabur,
- kombinasi invalid mudah tercipta,
- perubahan requirement menambah overload baru.

Alternatif:

```java
ReportRequest.forModule(module);
ReportRequest.forStatus(module, status);
ReportRequest.forPeriod(module, from, to);
ReportRequest.forDraftReview(module, from, to);
```

Ini static factory method yang memberi nama use case.

## 4.4 Telescoping Constructor

Telescoping constructor terjadi ketika constructor makin panjang karena parameter optional.

```java
public Notification(
    String recipient,
    String subject,
    String body,
    String cc,
    String bcc,
    String templateId,
    Map<String, Object> variables,
    boolean highPriority,
    boolean trackOpen,
    boolean retryable
) { ... }
```

Masalah:

- urutan parameter rawan salah,
- boolean tidak jelas,
- null merajalela,
- caller sulit dibaca,
- constructor berubah menjadi schema mini.

Solusi bisa:

1. static factory intent-specific,
2. parameter object,
3. builder,
4. separate command object,
5. distinct types.

Untuk Part 4, static factory intent-specific sudah cukup untuk banyak kasus:

```java
Notification.simple(recipient, subject, body);
Notification.fromTemplate(recipient, templateId, variables);
Notification.highPriority(recipient, subject, body);
```

Jika variasinya sangat banyak, Builder lebih tepat dan akan dibahas pada Part 5.

## 4.5 Constructor dan Boolean Parameter

Boolean parameter sering menjadi smell.

```java
new ReportRequest(module, true);
```

Apa arti `true`?

Lebih buruk:

```java
new ReportRequest(module, true, false, true);
```

Alternatif:

```java
ReportRequest.includeDrafts(module);
ReportRequest.excludeDrafts(module);
```

Atau gunakan enum/domain type:

```java
new ReportRequest(module, DraftVisibility.INCLUDE);
```

Boolean boleh digunakan jika:

- sangat lokal,
- nama parameter terlihat jelas dalam context,
- tidak membingungkan,
- tidak akan bertambah,
- bukan menggambarkan mode bisnis besar.

Namun untuk public API Java, boolean parameter sering menjadi long-term readability debt.

## 4.6 Constructor dan Defensive Copy

Jika constructor menerima mutable object, lakukan defensive copy.

Buruk:

```java
public final class ApprovalPath {
    private final List<ApprovalStep> steps;

    public ApprovalPath(List<ApprovalStep> steps) {
        this.steps = steps;
    }
}
```

Caller bisa mengubah list setelah object dibuat.

Lebih baik:

```java
public final class ApprovalPath {
    private final List<ApprovalStep> steps;

    public ApprovalPath(List<ApprovalStep> steps) {
        if (steps == null || steps.isEmpty()) {
            throw new IllegalArgumentException("steps must not be empty");
        }
        this.steps = List.copyOf(steps);
    }

    public List<ApprovalStep> steps() {
        return steps;
    }
}
```

Untuk Java 8, bisa:

```java
this.steps = Collections.unmodifiableList(new ArrayList<>(steps));
```

Untuk Java 10+, `List.copyOf` lebih ringkas.

---

# 5. Static Factory Method

Static factory method adalah static method yang mengembalikan instance.

Contoh:

```java
public static Money of(BigDecimal amount, Currency currency) {
    return new Money(amount, currency);
}
```

Static factory method bukan GoF Factory Method. Ini idiom Java yang sangat kuat.

## 5.1 Kenapa Static Factory Method Berguna?

Constructor hanya punya nama class.

Static factory bisa punya nama intent.

```java
LocalDate.of(2026, 6, 18);
Instant.now();
UUID.randomUUID();
List.of("A", "B");
BigInteger.valueOf(10);
```

Dalam domain:

```java
CaseDecision.approvedBy(userId, reason);
CaseDecision.rejectedBy(userId, reason);
CaseDecision.escalatedTo(unitId, reason);
```

Ini lebih kaya daripada:

```java
new CaseDecision("APPROVED", userId, reason, null);
```

## 5.2 Kelebihan Static Factory Method

Joshua Bloch mempopulerkan banyak kelebihan static factory method dalam Effective Java. Dalam konteks design pattern, kelebihan terpenting adalah:

1. punya nama,
2. tidak harus membuat object baru setiap dipanggil,
3. bisa mengembalikan subtype,
4. bisa menyembunyikan concrete class,
5. bisa mengurangi duplicate validation,
6. bisa menjaga invariant,
7. bisa memberi creation semantics yang eksplisit,
8. bisa mendukung caching,
9. bisa mendukung normalization,
10. bisa menjadi migration point saat representasi internal berubah.

Mari kita bahas satu per satu.

---

## 5.3 Static Factory Memberi Nama Intent

Constructor:

```java
new AuditEvent(userId, "LOGIN_FAILED", reason);
```

Static factory:

```java
AuditEvent.loginFailed(userId, reason);
AuditEvent.passwordChanged(userId);
AuditEvent.permissionDenied(userId, resource, action);
```

Perbedaannya bukan kosmetik.

Nama method membuat domain intent eksplisit.

Saat membaca code review, reviewer bisa langsung memahami:

```java
auditTrail.record(AuditEvent.permissionDenied(userId, resource, action));
```

Tanpa harus melihat urutan parameter.

## 5.4 Static Factory Bisa Mengembalikan Subtype

Misalnya:

```java
public sealed interface Notification permits EmailNotification, SmsNotification, InAppNotification {

    static Notification email(EmailAddress recipient, String subject, String body) {
        return new EmailNotification(recipient, subject, body);
    }

    static Notification sms(PhoneNumber recipient, String body) {
        return new SmsNotification(recipient, body);
    }

    static Notification inApp(UserId userId, String message) {
        return new InAppNotification(userId, message);
    }
}
```

Caller menggunakan abstraction:

```java
Notification notification = Notification.email(email, subject, body);
```

Keuntungan:

- concrete implementation tersembunyi,
- sealed hierarchy membatasi subtype,
- creation intent jelas,
- compiler membantu exhaustiveness pada switch pattern matching.

Di Java 8, sealed class belum ada, tetapi konsepnya bisa dibuat dengan package-private implementation:

```java
public interface Notification {
    static Notification email(EmailAddress recipient, String subject, String body) {
        return new EmailNotification(recipient, subject, body);
    }
}

final class EmailNotification implements Notification {
    ...
}
```

Jika implementation class package-private, caller tidak bisa langsung `new EmailNotification`.

## 5.5 Static Factory Bisa Mengontrol Instance

Contoh value cache:

```java
public final class Priority {
    private static final Priority LOW = new Priority("LOW");
    private static final Priority MEDIUM = new Priority("MEDIUM");
    private static final Priority HIGH = new Priority("HIGH");

    private final String value;

    private Priority(String value) {
        this.value = value;
    }

    public static Priority low() {
        return LOW;
    }

    public static Priority medium() {
        return MEDIUM;
    }

    public static Priority high() {
        return HIGH;
    }
}
```

Ini bukan selalu perlu. Enum sering lebih tepat:

```java
public enum Priority {
    LOW, MEDIUM, HIGH
}
```

Tetapi static factory bisa berguna jika:

- value set controlled,
- butuh object dengan behavior,
- tidak ingin expose constructor,
- ada caching,
- ada normalization,
- ada compatibility dengan external value.

## 5.6 Static Factory Bisa Melakukan Normalization

Contoh:

```java
public final class CaseNumber {
    private final String value;

    private CaseNumber(String value) {
        this.value = value;
    }

    public static CaseNumber of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("case number must not be blank");
        }

        String normalized = raw.trim().toUpperCase(Locale.ROOT);

        if (!normalized.matches("CASE-[0-9]{6}")) {
            throw new IllegalArgumentException("invalid case number: " + raw);
        }

        return new CaseNumber(normalized);
    }

    public String value() {
        return value;
    }
}
```

Constructor private, factory menjadi satu-satunya entry point.

Keuntungan:

- semua `CaseNumber` pasti normalized,
- caller tidak mengulang trim/uppercase,
- validation centralized,
- representasi internal aman.

## 5.7 Static Factory Bisa Menawarkan Alternative Creation Path

```java
public final class TimeRange {
    private final Instant start;
    private final Instant end;

    private TimeRange(Instant start, Instant end) {
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("start must be before end");
        }
        this.start = start;
        this.end = end;
    }

    public static TimeRange between(Instant start, Instant end) {
        return new TimeRange(start, end);
    }

    public static TimeRange startingAtFor(Instant start, Duration duration) {
        return new TimeRange(start, start.plus(duration));
    }

    public static TimeRange endingAtFor(Instant end, Duration duration) {
        return new TimeRange(end.minus(duration), end);
    }
}
```

Constructor tidak bisa menyampaikan semua intent ini dengan jelas.

## 5.8 Static Factory dan Records

Record punya canonical constructor otomatis:

```java
public record Money(BigDecimal amount, Currency currency) {
}
```

Tetapi jika butuh invariant:

```java
public record Money(BigDecimal amount, Currency currency) {

    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);

        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("scale exceeds currency precision");
        }
    }

    public static Money of(String amount, String currencyCode) {
        return new Money(new BigDecimal(amount), Currency.getInstance(currencyCode));
    }

    public static Money zero(Currency currency) {
        return new Money(BigDecimal.ZERO, currency);
    }
}
```

Static factory tetap berguna pada record untuk:

- parsing,
- normalization,
- alternative input,
- predefined value,
- semantic naming.

Namun hati-hati: record cocok untuk data carrier immutable. Jangan memaksa record menjadi entity mutable atau service.

---

# 6. Factory Method Pattern

Sekarang kita masuk ke **Factory Method** sebagai design pattern.

Dalam GoF, Factory Method menyediakan interface untuk membuat object, tetapi membiarkan subclass menentukan class mana yang diinstansiasi.

Simplified structure:

```java
abstract class DocumentProcessor {
    public final void process(Path path) {
        Document document = load(path);
        Parser parser = createParser();
        ParsedDocument parsed = parser.parse(document);
        store(parsed);
    }

    protected abstract Parser createParser();
}
```

Subclass:

```java
final class PdfDocumentProcessor extends DocumentProcessor {
    @Override
    protected Parser createParser() {
        return new PdfParser();
    }
}

final class WordDocumentProcessor extends DocumentProcessor {
    @Override
    protected Parser createParser() {
        return new WordParser();
    }
}
```

Template method `process` stabil. Creation step `createParser` bervariasi.

Factory Method sering muncul bersama Template Method.

## 6.1 Problem yang Diselesaikan Factory Method

Factory Method berguna saat:

1. superclass punya workflow umum,
2. beberapa step butuh object spesifik,
3. superclass tidak boleh tahu concrete class,
4. subclass/plugin/framework perlu mengontrol object creation,
5. creation logic bervariasi sesuai subtype,
6. algoritma utama harus tetap stabil.

Contoh domain:

```java
public abstract class CaseImportJob {

    public final ImportResult run(Path file) {
        ImportReader reader = createReader(file);
        List<ImportedRow> rows = reader.read(file);

        ImportValidator validator = createValidator();
        ValidationResult result = validator.validate(rows);

        if (!result.isValid()) {
            return ImportResult.failed(result.errors());
        }

        return persist(rows);
    }

    protected abstract ImportReader createReader(Path file);

    protected abstract ImportValidator createValidator();

    protected abstract ImportResult persist(List<ImportedRow> rows);
}
```

Subclass:

```java
public final class SalespersonImportJob extends CaseImportJob {
    @Override
    protected ImportReader createReader(Path file) {
        return new CsvImportReader();
    }

    @Override
    protected ImportValidator createValidator() {
        return new SalespersonImportValidator();
    }

    @Override
    protected ImportResult persist(List<ImportedRow> rows) {
        ...
    }
}
```

Ini berguna jika inheritance memang merepresentasikan variasi workflow.

Tetapi hati-hati: inheritance-heavy design bisa menjadi fragile base class. Part 13 akan membahas Template Method lebih dalam.

## 6.2 Factory Method vs Static Factory Method

Static factory:

```java
Money.of(amount, currency);
```

Factory Method pattern:

```java
protected abstract Parser createParser();
```

Perbedaannya:

| Aspek | Static Factory Method | Factory Method Pattern |
|---|---|---|
| Bentuk | static method | overridable method |
| Tujuan | named creation / hide constructor / subtype selection | subclass controls creation |
| Polymorphic? | tidak melalui override | iya |
| Cocok untuk | value object, domain object, sealed hierarchy | framework, plugin, algorithm variation |
| Risiko | static coupling, too many factories | inheritance coupling, fragile base class |

Static factory bukan “lebih rendah”. Ia sering lebih cocok untuk Java modern.

## 6.3 Factory Method vs Dependency Injection

Factory Method:

```java
protected abstract Parser createParser();
```

DI:

```java
public final class DocumentProcessor {
    private final Parser parser;

    public DocumentProcessor(Parser parser) {
        this.parser = parser;
    }
}
```

Pertanyaannya:

> Apakah variasi creation adalah bagian dari inheritance hierarchy, atau dependency sebaiknya diinjeksi dari luar?

Gunakan DI jika:

- dependency bisa dipilih saat konfigurasi,
- behavior lebih baik dikomposisikan daripada diwariskan,
- object lifecycle dikelola container,
- test perlu mudah mengganti dependency,
- variasi tidak cocok menjadi subclass.

Gunakan Factory Method jika:

- superclass framework punya algorithm skeleton,
- subclass memang extension point,
- creation adalah step yang sengaja dioverride,
- dependency harus dibuat per operasi,
- subclass perlu menyesuaikan beberapa factory step sekaligus.

Dalam Java modern dan Spring-heavy systems, banyak kasus Factory Method klasik tergantikan oleh DI + Strategy.

Namun Factory Method tetap relevan untuk:

- framework extension,
- plugin runtime,
- SDK,
- template algorithm,
- object yang harus dibuat fresh per call,
- subtype-specific helper creation.

## 6.4 Factory Method dengan Functional Interface

Java 8 membuat banyak factory method bisa diganti dengan `Supplier`.

```java
public final class RetryExecutor {
    private final Supplier<RetryPolicy> retryPolicyFactory;

    public RetryExecutor(Supplier<RetryPolicy> retryPolicyFactory) {
        this.retryPolicyFactory = retryPolicyFactory;
    }

    public <T> T execute(Callable<T> task) throws Exception {
        RetryPolicy policy = retryPolicyFactory.get();
        return policy.execute(task);
    }
}
```

Ini bukan GoF Factory Method klasik, tetapi secara design force mirip:

- caller tidak tahu concrete creation,
- factory bisa diganti,
- creation bisa fresh per call,
- test mudah.

Untuk factory dengan input, gunakan `Function`:

```java
Function<CaseType, CaseValidator> validatorFactory;
```

Namun hati-hati: generic functional interface bisa menghilangkan domain meaning.

Lebih baik jika domain penting:

```java
@FunctionalInterface
public interface CaseValidatorFactory {
    CaseValidator createFor(CaseType caseType);
}
```

Ini lebih ekspresif daripada:

```java
Function<CaseType, CaseValidator>
```

Terutama di sistem enterprise yang perlu readability dan traceability.

---

# 7. Constructor vs Static Factory vs Factory Method: Decision Matrix

## 7.1 Gunakan Constructor Jika

Gunakan constructor jika:

1. object sederhana,
2. parameter sedikit,
3. invariant lokal,
4. concrete class memang bagian dari API,
5. tidak butuh nama intent,
6. tidak butuh subtype selection,
7. tidak butuh caching,
8. tidak butuh lifecycle management,
9. creation tidak bisa gagal kecuali invalid argument.

Contoh:

```java
new EmailAddress("fajar@example.com");
new Money(amount, currency);
new PageRequest(page, size);
```

Namun untuk public API, static factory tetap sering lebih readable.

## 7.2 Gunakan Static Factory Jika

Gunakan static factory jika:

1. ingin memberi nama intent,
2. constructor parameter ambigu,
3. ada alternative creation path,
4. ada normalization,
5. ada validation central,
6. ingin menyembunyikan concrete class,
7. ingin mengembalikan subtype,
8. ingin mengontrol instance,
9. ingin menjaga compatibility,
10. ingin private constructor.

Contoh:

```java
CaseDecision.approvedBy(userId, reason);
TimeRange.between(start, end);
TimeRange.startingAtFor(start, duration);
CaseNumber.of(raw);
Notification.email(to, subject, body);
```

## 7.3 Gunakan Factory Method Pattern Jika

Gunakan Factory Method pattern jika:

1. ada superclass/framework algorithm,
2. subclass harus menentukan object yang dibuat,
3. creation adalah extension point,
4. object created per operation,
5. variasi creation terkait erat dengan variasi subclass,
6. ingin menghindari superclass bergantung concrete type.

Contoh:

```java
protected abstract Parser createParser();
protected abstract Validator createValidator();
protected abstract ExportWriter createWriter();
```

## 7.4 Jangan Gunakan Factory Jika

Jangan buat factory hanya karena:

1. semua object harus punya factory,
2. ingin terlihat enterprise,
3. takut menggunakan `new`,
4. ingin menyembunyikan design yang sebenarnya sederhana,
5. ingin mengganti dependency tapi tidak ada real variasi,
6. hanya satu implementation dan tidak ada reason untuk abstraction,
7. factory hanya pass-through ke constructor tanpa memberi value.

Buruk:

```java
public class UserFactory {
    public User create(String name) {
        return new User(name);
    }
}
```

Jika tidak ada invariant, naming, subtype selection, caching, lifecycle, atau abstraction benefit, factory ini hanya noise.

---

# 8. Object Creation as Dependency Boundary

Mari lihat contoh service buruk:

```java
public class CaseApprovalService {

    public void approve(String caseId, String userId, String reason) {
        CaseRepository repository = new OracleCaseRepository();
        EmailClient emailClient = new SmtpEmailClient();
        AuditLogger auditLogger = new DatabaseAuditLogger();

        CaseFile caseFile = repository.findById(caseId);
        caseFile.approve(userId, reason);

        repository.save(caseFile);
        emailClient.sendApprovalNotification(caseFile);
        auditLogger.logApproval(caseFile, userId);
    }
}
```

Masalah:

1. `CaseApprovalService` tergantung concrete repository.
2. Ia tahu SMTP.
3. Ia tahu audit database logger.
4. Sulit ditest.
5. Sulit mengganti infra.
6. Object creation bercampur dengan use case.
7. Lifecycle resource tidak jelas.
8. Transaction boundary tidak jelas.
9. Configuration tersembunyi.
10. Failure mode sulit dikontrol.

Lebih baik:

```java
public final class CaseApprovalService {
    private final CaseRepository repository;
    private final NotificationGateway notificationGateway;
    private final AuditTrail auditTrail;

    public CaseApprovalService(
            CaseRepository repository,
            NotificationGateway notificationGateway,
            AuditTrail auditTrail
    ) {
        this.repository = Objects.requireNonNull(repository);
        this.notificationGateway = Objects.requireNonNull(notificationGateway);
        this.auditTrail = Objects.requireNonNull(auditTrail);
    }

    public void approve(CaseId caseId, UserId userId, ApprovalReason reason) {
        CaseFile caseFile = repository.getRequired(caseId);

        caseFile.approve(userId, reason);

        repository.save(caseFile);
        notificationGateway.caseApproved(caseFile);
        auditTrail.record(AuditEvent.caseApproved(caseId, userId, reason));
    }
}
```

Object creation dependency dipindahkan keluar.

Di Spring/CDI, container bisa membuat service. Tetapi domain object creation tetap harus didesain, bukan diserahkan semua ke container.

---

# 9. Factory sebagai Policy Selector

Salah satu penggunaan factory yang sehat adalah memilih policy.

Contoh:

```java
public interface EscalationPolicy {
    EscalationDecision evaluate(CaseFile caseFile);
}
```

Implementasi:

```java
public final class StandardEscalationPolicy implements EscalationPolicy {
    public EscalationDecision evaluate(CaseFile caseFile) {
        ...
    }
}

public final class HighRiskEscalationPolicy implements EscalationPolicy {
    public EscalationDecision evaluate(CaseFile caseFile) {
        ...
    }
}

public final class ComplianceEscalationPolicy implements EscalationPolicy {
    public EscalationDecision evaluate(CaseFile caseFile) {
        ...
    }
}
```

Factory:

```java
public final class EscalationPolicyFactory {
    private final StandardEscalationPolicy standard;
    private final HighRiskEscalationPolicy highRisk;
    private final ComplianceEscalationPolicy compliance;

    public EscalationPolicyFactory(
            StandardEscalationPolicy standard,
            HighRiskEscalationPolicy highRisk,
            ComplianceEscalationPolicy compliance
    ) {
        this.standard = standard;
        this.highRisk = highRisk;
        this.compliance = compliance;
    }

    public EscalationPolicy forCase(CaseFile caseFile) {
        if (caseFile.isHighRisk()) {
            return highRisk;
        }
        if (caseFile.isComplianceRelated()) {
            return compliance;
        }
        return standard;
    }
}
```

Ini masih cukup jelas.

Namun jika selection logic makin kompleks, mungkin lebih cocok menjadi rule/specification atau decision table.

Factory tidak boleh menjadi tempat menyembunyikan semua bisnis rule tanpa struktur.

---

# 10. Factory dengan Enum: Baik atau Buruk?

Enum sering dipakai sebagai key factory.

```java
public enum ReportType {
    SUMMARY,
    DETAIL,
    AUDIT
}
```

Factory:

```java
public ReportGenerator create(ReportType type) {
    return switch (type) {
        case SUMMARY -> new SummaryReportGenerator();
        case DETAIL -> new DetailReportGenerator();
        case AUDIT -> new AuditReportGenerator();
    };
}
```

Di Java 14+, switch expression membuat ini lebih aman dan readable.

## 10.1 Kapan Ini Baik?

Baik jika:

1. set tipe terbatas,
2. semua tipe diketahui saat compile time,
3. tidak butuh plugin eksternal,
4. exhaustive switch membantu maintainability,
5. mapping sederhana,
6. perubahan jarang.

## 10.2 Kapan Ini Buruk?

Buruk jika:

1. tipe sering berubah oleh configuration,
2. plugin runtime perlu menambah tipe,
3. enum dipakai untuk menggantikan polymorphism,
4. switch tersebar di banyak tempat,
5. enum menjadi god enum dengan banyak behavior,
6. mapping bergantung external system string yang tidak stabil.

Buruk:

```java
if (type.equals("SUMMARY")) { ... }
else if (type.equals("DETAIL")) { ... }
else if (type.equals("AUDIT")) { ... }
```

Lebih buruk jika string literal tersebar.

Solusi:

- parse external string di boundary,
- convert ke domain enum,
- gunakan switch expression atau registry,
- jangan biarkan string eksternal masuk ke core domain.

---

# 11. Stringly Typed Factory Anti-Pattern

Stringly typed factory:

```java
public Object create(String type) {
    if ("email".equals(type)) {
        return new EmailNotification();
    }
    if ("sms".equals(type)) {
        return new SmsNotification();
    }
    if ("push".equals(type)) {
        return new PushNotification();
    }
    throw new IllegalArgumentException("Unknown type: " + type);
}
```

Masalah:

1. typo baru ketahuan runtime,
2. caller tidak tahu allowed values,
3. return type sering terlalu umum,
4. compiler tidak membantu,
5. rename sulit,
6. behavior tersebar,
7. external value dan domain concept tercampur.

Lebih baik:

```java
public enum NotificationChannel {
    EMAIL,
    SMS,
    PUSH
}
```

```java
public NotificationSender create(NotificationChannel channel) {
    return switch (channel) {
        case EMAIL -> emailSender;
        case SMS -> smsSender;
        case PUSH -> pushSender;
    };
}
```

Jika input berasal dari external string:

```java
public static NotificationChannel fromExternalCode(String raw) {
    return switch (raw) {
        case "email" -> EMAIL;
        case "sms" -> SMS;
        case "push" -> PUSH;
        default -> throw new UnsupportedNotificationChannelException(raw);
    };
}
```

Boundary parsing terpisah dari domain logic.

## 11.1 Exception yang Lebih Bermakna

Jangan hanya:

```java
throw new IllegalArgumentException("Unknown type");
```

Gunakan domain-specific exception jika error perlu ditangani:

```java
public final class UnsupportedNotificationChannelException extends RuntimeException {
    private final String rawChannel;

    public UnsupportedNotificationChannelException(String rawChannel) {
        super("Unsupported notification channel: " + rawChannel);
        this.rawChannel = rawChannel;
    }

    public String rawChannel() {
        return rawChannel;
    }
}
```

Atau return `Optional` jika absence adalah expected:

```java
public Optional<NotificationChannel> tryParse(String raw) {
    ...
}
```

Tapi hati-hati: `Optional` untuk error yang perlu alasan detail bisa kurang informatif.

---

# 12. Hidden Dependency Factory Anti-Pattern

Factory buruk:

```java
public final class ReportGeneratorFactory {

    public ReportGenerator create(ReportType type) {
        DatabaseConnection connection = Database.connect("prod-url");
        TemplateRepository templateRepository = new OracleTemplateRepository(connection);

        return switch (type) {
            case SUMMARY -> new SummaryReportGenerator(templateRepository);
            case DETAIL -> new DetailReportGenerator(templateRepository);
            case AUDIT -> new AuditReportGenerator(templateRepository);
        };
    }
}
```

Masalah:

1. factory diam-diam membuka database connection,
2. configuration hardcoded,
3. resource lifecycle tidak jelas,
4. test sulit,
5. production dependency bisa terpanggil saat unit test,
6. factory creation bisa lambat,
7. error create bercampur dengan infra failure,
8. naming “factory” menyembunyikan service locator.

Lebih baik:

```java
public final class ReportGeneratorFactory {
    private final TemplateRepository templateRepository;

    public ReportGeneratorFactory(TemplateRepository templateRepository) {
        this.templateRepository = Objects.requireNonNull(templateRepository);
    }

    public ReportGenerator create(ReportType type) {
        return switch (type) {
            case SUMMARY -> new SummaryReportGenerator(templateRepository);
            case DETAIL -> new DetailReportGenerator(templateRepository);
            case AUDIT -> new AuditReportGenerator(templateRepository);
        };
    }
}
```

Dependency eksplisit.

Jika menggunakan DI container:

```java
@Component
public final class ReportGeneratorFactory {
    private final SummaryReportGenerator summary;
    private final DetailReportGenerator detail;
    private final AuditReportGenerator audit;

    public ReportGeneratorFactory(
            SummaryReportGenerator summary,
            DetailReportGenerator detail,
            AuditReportGenerator audit
    ) {
        this.summary = summary;
        this.detail = detail;
        this.audit = audit;
    }

    public ReportGenerator create(ReportType type) {
        return switch (type) {
            case SUMMARY -> summary;
            case DETAIL -> detail;
            case AUDIT -> audit;
        };
    }
}
```

Jika generator stateful per request, gunakan provider/supplier, bukan singleton instance.

---

# 13. Constructor Doing Work Anti-Pattern

Constructor doing work adalah constructor yang melakukan terlalu banyak hal.

Contoh buruk:

```java
public final class ReportExporter {
    private final Template template;
    private final Connection connection;

    public ReportExporter(String templateName) {
        this.connection = DriverManager.getConnection("jdbc:oracle:thin:@...");
        this.template = loadTemplateFromDatabase(templateName);
        warmUpCache();
        publishStartupMetric();
    }
}
```

Masalah:

1. constructor melakukan I/O,
2. object creation lambat,
3. exception teknis muncul saat `new`,
4. sulit membuat object di test,
5. resource lifecycle tidak jelas,
6. constructor punya side effect,
7. object partially constructed risk,
8. observability sulit,
9. retry/circuit breaker tidak bisa diterapkan dengan jelas,
10. membuat object tidak deterministic.

Lebih baik pisahkan:

```java
public final class ReportExporter {
    private final Template template;
    private final ReportWriter writer;

    public ReportExporter(Template template, ReportWriter writer) {
        this.template = Objects.requireNonNull(template);
        this.writer = Objects.requireNonNull(writer);
    }

    public ExportResult export(ReportData data) {
        return writer.write(template.render(data));
    }
}
```

Loading template:

```java
public final class ReportExporterFactory {
    private final TemplateRepository templateRepository;
    private final ReportWriter writer;

    public ReportExporterFactory(TemplateRepository templateRepository, ReportWriter writer) {
        this.templateRepository = templateRepository;
        this.writer = writer;
    }

    public ReportExporter create(String templateName) {
        Template template = templateRepository.getRequired(templateName);
        return new ReportExporter(template, writer);
    }
}
```

Sekarang I/O terlihat di factory/service boundary. Constructor tetap ringan.

Namun factory yang melakukan I/O pun perlu diberi nama jelas. Kadang lebih baik disebut `ReportExporterLoader` atau `ReportExporterProvider` daripada factory biasa.

---

# 14. Reflection Factory Abuse

Reflection factory sering muncul dalam framework, plugin, mapper, serializer, atau dynamic module.

Contoh:

```java
public Object create(String className) {
    try {
        Class<?> clazz = Class.forName(className);
        return clazz.getDeclaredConstructor().newInstance();
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

Masalah:

1. compiler tidak membantu,
2. constructor requirement tersembunyi,
3. security risk,
4. module boundary bisa rusak,
5. refactoring class name pecah runtime,
6. error sulit dipahami,
7. native image / AOT bisa bermasalah,
8. performance overhead,
9. object lifecycle tidak jelas,
10. dependency tidak eksplisit.

Reflection boleh dipakai jika:

- sedang membangun framework,
- ada plugin system,
- class discovery memang requirement,
- security boundary jelas,
- allowed classes dibatasi,
- constructor contract jelas,
- error model jelas,
- ada test coverage,
- module opens/exports dipahami,
- runtime target mendukungnya.

Lebih aman gunakan registry eksplisit:

```java
public final class HandlerRegistry {
    private final Map<CommandType, CommandHandler<?>> handlers;

    public HandlerRegistry(List<CommandHandler<?>> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        CommandHandler::commandType,
                        Function.identity()
                ));
    }

    public CommandHandler<?> get(CommandType type) {
        CommandHandler<?> handler = handlers.get(type);
        if (handler == null) {
            throw new UnsupportedCommandTypeException(type);
        }
        return handler;
    }
}
```

Jika benar-benar butuh SPI, gunakan `ServiceLoader` dengan contract eksplisit.

```java
ServiceLoader<PaymentProvider> loader = ServiceLoader.load(PaymentProvider.class);
```

Namun SPI akan dibahas lebih dalam di Part 29.

---

# 15. Factory That Is Actually a Service

Factory seharusnya membuat object. Service menjalankan use case atau behavior.

Buruk:

```java
public final class InvoiceFactory {

    public Invoice createAndSendInvoice(Order order) {
        Invoice invoice = new Invoice(order);
        invoiceRepository.save(invoice);
        emailClient.send(invoice);
        auditLogger.log(invoice);
        return invoice;
    }
}
```

Nama `Factory` menipu. Ini application service.

Lebih baik:

```java
public final class InvoiceFactory {
    public Invoice createFrom(Order order) {
        return Invoice.from(order);
    }
}
```

Dan:

```java
public final class InvoiceApplicationService {
    private final InvoiceFactory invoiceFactory;
    private final InvoiceRepository invoiceRepository;
    private final EmailGateway emailGateway;
    private final AuditTrail auditTrail;

    public InvoiceApplicationService(
            InvoiceFactory invoiceFactory,
            InvoiceRepository invoiceRepository,
            EmailGateway emailGateway,
            AuditTrail auditTrail
    ) {
        this.invoiceFactory = invoiceFactory;
        this.invoiceRepository = invoiceRepository;
        this.emailGateway = emailGateway;
        this.auditTrail = auditTrail;
    }

    public InvoiceId issueInvoice(OrderId orderId) {
        Order order = ...;
        Invoice invoice = invoiceFactory.createFrom(order);

        invoiceRepository.save(invoice);
        emailGateway.sendInvoice(invoice);
        auditTrail.record(AuditEvent.invoiceIssued(invoice.id()));

        return invoice.id();
    }
}
```

Rule sederhana:

> Jika method melakukan orchestration, persistence, notification, audit, atau transaction, kemungkinan itu service, bukan factory.

---

# 16. Factory Return Type: Jangan Terlalu Umum

Buruk:

```java
public Object create(String type) {
    ...
}
```

Caller harus cast:

```java
EmailSender sender = (EmailSender) factory.create("email");
```

Ini menghancurkan type safety.

Lebih baik:

```java
public NotificationSender create(NotificationChannel channel) {
    ...
}
```

Atau jika tipe berbeda secara fundamental, mungkin factory-nya salah.

Buruk:

```java
public Object create(String type) {
    if (type.equals("report")) return new Report();
    if (type.equals("email")) return new EmailSender();
    if (type.equals("case")) return new CaseFile();
}
```

Ini bukan factory desain. Ini object vending machine.

Factory harus punya product family yang masuk akal.

---

# 17. Factory dan Generics

Factory generik bisa berguna, tetapi mudah menjadi abstraksi kosong.

Contoh:

```java
public interface Factory<T> {
    T create();
}
```

Ini terlalu umum jika dipakai di domain code tanpa konteks.

Lebih baik:

```java
public interface CaseNumberFactory {
    CaseNumber next();
}
```

Atau:

```java
public interface NotificationFactory {
    Notification create(NotificationRequest request);
}
```

Generics berguna untuk framework/helper:

```java
public interface ObjectFactory<T> {
    T create();
}
```

Tetapi untuk domain, nama spesifik lebih baik.

## 17.1 Factory dengan Type Token

Kadang factory memakai `Class<T>`:

```java
public <T extends ReportGenerator> T create(Class<T> type) {
    ...
}
```

Risiko:

- reflection temptation,
- caller bergantung concrete class,
- compile-time tidak sepenuhnya menjamin availability,
- error runtime.

Alternatif sering lebih baik:

```java
public ReportGenerator create(ReportType type)
```

Atau registry typed:

```java
public interface ReportGenerator {
    ReportType type();
}
```

```java
public final class ReportGeneratorRegistry {
    private final Map<ReportType, ReportGenerator> generators;

    public ReportGeneratorRegistry(List<ReportGenerator> generators) {
        this.generators = generators.stream()
                .collect(Collectors.toMap(ReportGenerator::type, Function.identity()));
    }

    public ReportGenerator get(ReportType type) {
        ReportGenerator generator = generators.get(type);
        if (generator == null) {
            throw new UnsupportedReportTypeException(type);
        }
        return generator;
    }
}
```

---

# 18. Factory dengan Sealed Classes dan Pattern Matching

Java modern membuat factory lebih ekspresif.

```java
public sealed interface DecisionCommand
        permits ApproveCommand, RejectCommand, EscalateCommand {
}

public record ApproveCommand(CaseId caseId, UserId userId, ApprovalReason reason)
        implements DecisionCommand {
}

public record RejectCommand(CaseId caseId, UserId userId, RejectionReason reason)
        implements DecisionCommand {
}

public record EscalateCommand(CaseId caseId, UserId userId, UnitId targetUnit)
        implements DecisionCommand {
}
```

Factory dari request eksternal:

```java
public final class DecisionCommandFactory {

    public DecisionCommand from(RequestDto dto) {
        return switch (dto.action()) {
            case "APPROVE" -> new ApproveCommand(
                    CaseId.of(dto.caseId()),
                    UserId.of(dto.userId()),
                    ApprovalReason.of(dto.reason())
            );
            case "REJECT" -> new RejectCommand(
                    CaseId.of(dto.caseId()),
                    UserId.of(dto.userId()),
                    RejectionReason.of(dto.reason())
            );
            case "ESCALATE" -> new EscalateCommand(
                    CaseId.of(dto.caseId()),
                    UserId.of(dto.userId()),
                    UnitId.of(dto.targetUnit())
            );
            default -> throw new UnsupportedDecisionActionException(dto.action());
        };
    }
}
```

Lebih baik lagi, parsing action ke enum dulu:

```java
public enum DecisionAction {
    APPROVE,
    REJECT,
    ESCALATE;

    public static DecisionAction fromExternal(String raw) {
        try {
            return DecisionAction.valueOf(raw);
        } catch (IllegalArgumentException e) {
            throw new UnsupportedDecisionActionException(raw);
        }
    }
}
```

Kemudian:

```java
public DecisionCommand from(RequestDto dto) {
    DecisionAction action = DecisionAction.fromExternal(dto.action());

    return switch (action) {
        case APPROVE -> ...
        case REJECT -> ...
        case ESCALATE -> ...
    };
}
```

Keuntungan:

- boundary external string jelas,
- domain action typed,
- switch exhaustive,
- command hierarchy sealed,
- handler bisa pattern matching.

---

# 19. Static Factory pada Interface: Power dan Risiko

Java 8 memungkinkan static method pada interface.

```java
public interface CaseFilter {
    boolean matches(CaseFile caseFile);

    static CaseFilter byStatus(CaseStatus status) {
        return caseFile -> caseFile.status() == status;
    }

    static CaseFilter highRisk() {
        return CaseFile::isHighRisk;
    }

    static CaseFilter and(CaseFilter left, CaseFilter right) {
        return caseFile -> left.matches(caseFile) && right.matches(caseFile);
    }
}
```

Ini bagus untuk composable small object.

Namun jangan letakkan terlalu banyak creation logic di interface jika:

- interface menjadi god utility,
- static methods tidak cohesive,
- implementasi butuh dependency eksternal,
- testing/mocking jadi membingungkan,
- domain boundary kabur.

Static method di interface cocok untuk:

- simple factory,
- composition helper,
- constants-free utility,
- domain DSL ringan.

Tidak cocok untuk:

- application service creation,
- infrastructure creation,
- dependency-heavy object creation.

---

# 20. Named Constructors: Pattern Praktis untuk Java

Java tidak punya named constructor seperti beberapa bahasa lain. Static factory method adalah substitusinya.

Contoh:

```java
public final class Deadline {
    private final Instant dueAt;

    private Deadline(Instant dueAt) {
        this.dueAt = Objects.requireNonNull(dueAt);
    }

    public static Deadline at(Instant dueAt) {
        return new Deadline(dueAt);
    }

    public static Deadline after(Duration duration, Clock clock) {
        return new Deadline(clock.instant().plus(duration));
    }

    public static Deadline endOfDay(LocalDate date, ZoneId zoneId) {
        return new Deadline(date.plusDays(1).atStartOfDay(zoneId).toInstant());
    }
}
```

Perhatikan penggunaan `Clock`.

Buruk:

```java
public static Deadline after(Duration duration) {
    return new Deadline(Instant.now().plus(duration));
}
```

Ini membuat test sulit karena waktu tersembunyi.

Lebih baik:

```java
public static Deadline after(Duration duration, Clock clock) {
    return new Deadline(clock.instant().plus(duration));
}
```

Jika ini terlalu verbose di semua caller, dependency `Clock` bisa disediakan di application service.

---

# 21. Creation Error Design

Object creation error harus jelas.

## 21.1 Invalid Argument

Untuk value object lokal:

```java
throw new IllegalArgumentException("amount must not be negative");
```

Cukup.

## 21.2 Unsupported Type

Untuk factory selection:

```java
throw new UnsupportedReportTypeException(type);
```

Lebih baik daripada generic `IllegalArgumentException` jika caller perlu map ke HTTP 400, audit event, atau user-facing error.

## 21.3 Missing Configuration

Jika factory butuh configuration:

```java
throw new MissingNotificationProviderConfigurationException(channel);
```

Ini bukan domain validation. Ini deployment/configuration error.

## 21.4 External Resource Unavailable

Jika creation melibatkan external resource, pikirkan ulang:

- apakah factory seharusnya melakukan I/O?
- apakah ini provider/loader/service?
- apakah perlu retry/timeout?
- apakah failure bisa ditangani?

Contoh:

```java
public ReportTemplate loadTemplate(TemplateId id) {
    ...
}
```

Nama `load` lebih jujur daripada `create`.

## 21.5 Return Null Jangan Dipakai

Buruk:

```java
public ReportGenerator create(ReportType type) {
    if (unknown) return null;
}
```

Caller akan NPE.

Lebih baik:

```java
public Optional<ReportGenerator> find(ReportType type)
```

atau:

```java
public ReportGenerator getRequired(ReportType type)
```

Gunakan nama method untuk membedakan expected absence vs exceptional absence.

---

# 22. Refactoring Path: Dari Constructor Chaos ke Creation Boundary

Misalnya kita punya kode awal:

```java
CaseDecision decision = new CaseDecision(
        caseId,
        "APPROVE",
        userId,
        reason,
        LocalDateTime.now(),
        true,
        null
);
```

Masalah:

- action string,
- timestamp tersembunyi,
- boolean tidak jelas,
- null parameter,
- constructor terlalu banyak,
- invariant tidak terlihat.

## Step 1: Introduce Domain Types

```java
CaseId caseId = CaseId.of(rawCaseId);
UserId userId = UserId.of(rawUserId);
ApprovalReason reason = ApprovalReason.of(rawReason);
```

## Step 2: Replace String with Enum

```java
public enum DecisionType {
    APPROVE,
    REJECT,
    ESCALATE
}
```

## Step 3: Add Static Factory

```java
public final class CaseDecision {
    private final CaseId caseId;
    private final DecisionType type;
    private final UserId decidedBy;
    private final String reason;
    private final Instant decidedAt;

    private CaseDecision(
            CaseId caseId,
            DecisionType type,
            UserId decidedBy,
            String reason,
            Instant decidedAt
    ) {
        this.caseId = Objects.requireNonNull(caseId);
        this.type = Objects.requireNonNull(type);
        this.decidedBy = Objects.requireNonNull(decidedBy);
        this.reason = Objects.requireNonNull(reason);
        this.decidedAt = Objects.requireNonNull(decidedAt);
    }

    public static CaseDecision approvedBy(
            CaseId caseId,
            UserId userId,
            ApprovalReason reason,
            Clock clock
    ) {
        return new CaseDecision(
                caseId,
                DecisionType.APPROVE,
                userId,
                reason.value(),
                clock.instant()
        );
    }
}
```

## Step 4: Remove Boolean Flag

Jika boolean `notifyApplicant` sebelumnya ada, jangan simpan sebagai boolean tidak jelas.

Bisa gunakan:

```java
public enum NotificationRequirement {
    REQUIRED,
    NOT_REQUIRED
}
```

Atau pisahkan responsibility: decision object tidak perlu tahu notification.

## Step 5: Separate Creation from Side Effect

Buruk:

```java
CaseDecision decision = CaseDecision.approvedBy(...);
decision.sendEmail();
```

Lebih baik:

```java
CaseDecision decision = CaseDecision.approvedBy(...);

caseDecisionRepository.save(decision);
notificationGateway.caseApproved(decision);
auditTrail.record(AuditEvent.caseApproved(decision));
```

## Step 6: Add Tests Around Factory

```java
@Test
void approvedDecisionHasApproveTypeAndTimestampFromClock() {
    Clock fixedClock = Clock.fixed(Instant.parse("2026-06-18T00:00:00Z"), ZoneOffset.UTC);

    CaseDecision decision = CaseDecision.approvedBy(caseId, userId, reason, fixedClock);

    assertEquals(DecisionType.APPROVE, decision.type());
    assertEquals(Instant.parse("2026-06-18T00:00:00Z"), decision.decidedAt());
}
```

---

# 23. Testing Strategy for Creation Patterns

## 23.1 Constructor Tests

Test constructor untuk:

1. null rejection,
2. invalid range,
3. normalization,
4. defensive copy,
5. equality if value object,
6. immutable behavior.

Example:

```java
@Test
void rejectsBlankCaseNumber() {
    assertThrows(IllegalArgumentException.class, () -> CaseNumber.of(" "));
}
```

## 23.2 Static Factory Tests

Test:

1. factory name maps to correct semantic state,
2. subtype returned when relevant,
3. invalid input rejected,
4. normalization applied,
5. cached instance if promised,
6. no side effect if factory should be pure.

```java
@Test
void createsEmailNotification() {
    Notification notification = Notification.email(email, "Subject", "Body");

    assertInstanceOf(EmailNotification.class, notification);
}
```

Namun hati-hati: test concrete class hanya jika subtype selection adalah contract. Jika bukan, test behavior.

## 23.3 Factory Method Tests

Test superclass workflow dengan test subclass.

```java
final class TestProcessor extends DocumentProcessor {
    boolean parserCreated;

    @Override
    protected Parser createParser() {
        parserCreated = true;
        return new FakeParser();
    }
}
```

Namun jika terlalu sulit ditest, mungkin design inheritance terlalu kuat.

## 23.4 Factory with Registry Tests

Test:

1. all registered handlers are discoverable,
2. duplicate type rejected,
3. unsupported type rejected,
4. correct handler selected.

```java
@Test
void rejectsDuplicateHandlerType() {
    List<ReportGenerator> generators = List.of(
            new SummaryReportGenerator(),
            new AnotherSummaryReportGenerator()
    );

    assertThrows(DuplicateReportGeneratorException.class,
            () -> new ReportGeneratorRegistry(generators));
}
```

---

# 24. Observability and Debuggability Angle

Creation bugs sering terlihat sebagai:

- NPE setelah object dibuat,
- invalid state jauh di downstream,
- unsupported type saat runtime,
- wrong subtype selected,
- dependency null,
- slow startup,
- random failure saat constructor,
- flaky tests,
- missing configuration,
- class not found,
- circular dependency,
- memory leak karena factory cache.

Untuk object creation yang penting secara operasional, log/metric bisa berguna.

Namun jangan log dalam setiap value object constructor.

Log creation di boundary:

```java
log.info("Registered report generators: {}", registry.supportedTypes());
```

Metric:

```java
factory.creation.failure.count{type="AUDIT", reason="unsupported"}
```

Audit:

```java
auditTrail.record(AuditEvent.decisionCreated(decision.id(), decision.type()));
```

Perbedaan penting:

- observability untuk infrastructure creation,
- audit untuk domain-significant creation,
- debug log untuk registry/configuration,
- jangan mencemari domain constructor dengan logger.

---

# 25. Performance Considerations

## 25.1 Object Creation Bias

Banyak developer terlalu takut membuat object.

Di JVM modern, object allocation sering murah jika:

- object short-lived,
- tidak escape,
- GC tuned,
- allocation simple,
- tidak membawa resource eksternal.

Jangan membuat factory/cache hanya karena takut `new`.

## 25.2 Kapan Creation Mahal?

Creation mahal jika:

- membuka connection,
- membaca file,
- parsing template besar,
- membangun regex kompleks berulang,
- membangun ObjectMapper/ValidatorFactory berulang,
- melakukan network call,
- melakukan reflection scanning,
- membuat thread/executor,
- memuat model ML/rule besar.

Object mahal perlu lifecycle management.

## 25.3 Object Pooling Anti-Pattern

Object pooling sering tidak perlu untuk ordinary Java objects.

Pooling cocok untuk:

- database connection,
- thread/executor,
- buffer tertentu,
- expensive native resource,
- limited external resource.

Pooling tidak cocok untuk:

- DTO,
- small value object,
- command,
- event,
- request model,
- simple domain object.

Premature pooling bisa menyebabkan:

- stale state,
- thread-safety bug,
- memory leak,
- complex lifecycle,
- debugging sulit.

---

# 26. Java 8–25 Perspective

## 26.1 Java 8

Java 8 membawa:

- lambda,
- functional interface,
- method reference,
- default/static interface methods,
- Optional,
- Stream.

Dampaknya:

- Strategy bisa ringan,
- Factory bisa berupa `Supplier<T>`,
- Factory with input bisa `Function<I, O>`,
- static method interface bisa menjadi named factory,
- builder/fluent API makin umum.

Namun jangan mengganti domain-specific interface dengan `Function` jika readability turun.

## 26.2 Java 9

Java 9 module system membuat factory berkaitan dengan boundary.

Kita bisa expose interface dan static factory, sementara implementation class tetap internal package/module.

Design idea:

```java
module com.example.notification {
    exports com.example.notification.api;
}
```

Implementation tidak diexport.

Factory di API memilih implementation internal.

Ini memperkuat representation hiding.

## 26.3 Java 10 `var`

`var` bisa membuat factory lebih readable jika method name jelas.

Baik:

```java
var decision = CaseDecision.approvedBy(caseId, userId, reason, clock);
```

Buruk:

```java
var x = factory.create(type);
```

Jika factory return type tidak jelas, `var` memperburuk readability.

## 26.4 Java 14+ Switch Expression

Factory berbasis enum menjadi lebih ringkas:

```java
return switch (type) {
    case SUMMARY -> summary;
    case DETAIL -> detail;
    case AUDIT -> audit;
};
```

Keuntungan:

- expression-oriented,
- exhaustive untuk enum,
- mengurangi accidental fallthrough,
- lebih cocok untuk simple selection factory.

## 26.5 Java 16+ Records

Records bagus untuk:

- command,
- DTO,
- value object sederhana,
- event,
- query parameter,
- immutable data carrier.

Static factory tetap berguna untuk:

- parsing,
- normalization,
- semantic construction,
- alternative creation path.

## 26.6 Java 17+ Sealed Classes

Sealed classes membantu factory untuk closed product family.

```java
public sealed interface PaymentMethod permits CardPayment, BankTransfer {
    static PaymentMethod card(...) { ... }
    static PaymentMethod bankTransfer(...) { ... }
}
```

Ini mengurangi kebutuhan string-based factory dan membantu exhaustive pattern matching.

## 26.7 Java 21+ Virtual Threads

Virtual threads mengurangi biaya thread per task, tetapi tidak menghapus pentingnya lifecycle object.

Anti-pattern baru:

```java
public RequestHandler() {
    this.executor = Executors.newVirtualThreadPerTaskExecutor();
}
```

Jika setiap handler membuat executor sendiri, resource lifecycle kacau.

Factory/lifecycle boundary tetap penting.

## 26.8 Java 25 Direction

Dengan structured concurrency dan scoped values semakin matang di Java modern, context creation harus lebih eksplisit.

Jangan menyembunyikan context dalam static global factory.

Buruk:

```java
UserContext current = UserContextHolder.get();
Decision decision = DecisionFactory.create(caseId);
```

Lebih baik:

```java
Decision decision = Decision.approvedBy(caseId, currentUser, reason, clock);
```

Atau context dikelola di application boundary, bukan domain static global.

---

# 27. Code Example: Full Mini Case

## 27.1 Problem

Kita punya request untuk membuat notification berdasarkan channel:

```json
{
  "channel": "email",
  "recipient": "fajar@example.com",
  "subject": "Case approved",
  "body": "Your case has been approved"
}
```

Naive code:

```java
public Object create(Map<String, String> request) {
    String channel = request.get("channel");

    if (channel.equals("email")) {
        return new EmailNotification(
                request.get("recipient"),
                request.get("subject"),
                request.get("body")
        );
    }

    if (channel.equals("sms")) {
        return new SmsNotification(
                request.get("recipient"),
                request.get("body")
        );
    }

    return null;
}
```

Masalah:

- stringly typed,
- Map raw,
- Object return,
- null return,
- no validation,
- external representation masuk core,
- constructor menerima raw string,
- subtype selection tidak aman.

## 27.2 Better Design

### Domain Types

```java
public record EmailAddress(String value) {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
        value = value.trim().toLowerCase(Locale.ROOT);
    }

    public static EmailAddress of(String raw) {
        return new EmailAddress(raw);
    }
}
```

```java
public record PhoneNumber(String value) {
    public PhoneNumber {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("phone number must not be blank");
        }
        value = value.trim();
    }

    public static PhoneNumber of(String raw) {
        return new PhoneNumber(raw);
    }
}
```

### Channel Enum

```java
public enum NotificationChannel {
    EMAIL,
    SMS;

    public static NotificationChannel fromExternal(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new UnsupportedNotificationChannelException(raw);
        }

        return switch (raw.trim().toLowerCase(Locale.ROOT)) {
            case "email" -> EMAIL;
            case "sms" -> SMS;
            default -> throw new UnsupportedNotificationChannelException(raw);
        };
    }
}
```

### Sealed Product Family

```java
public sealed interface Notification
        permits EmailNotification, SmsNotification {

    static Notification email(EmailAddress recipient, String subject, String body) {
        return new EmailNotification(recipient, subject, body);
    }

    static Notification sms(PhoneNumber recipient, String body) {
        return new SmsNotification(recipient, body);
    }
}
```

```java
public record EmailNotification(
        EmailAddress recipient,
        String subject,
        String body
) implements Notification {
    public EmailNotification {
        Objects.requireNonNull(recipient);

        if (subject == null || subject.isBlank()) {
            throw new IllegalArgumentException("subject must not be blank");
        }
        if (body == null || body.isBlank()) {
            throw new IllegalArgumentException("body must not be blank");
        }
    }
}
```

```java
public record SmsNotification(
        PhoneNumber recipient,
        String body
) implements Notification {
    public SmsNotification {
        Objects.requireNonNull(recipient);

        if (body == null || body.isBlank()) {
            throw new IllegalArgumentException("body must not be blank");
        }
    }
}
```

### Request DTO

```java
public record NotificationRequestDto(
        String channel,
        String recipient,
        String subject,
        String body
) {
}
```

### Factory

```java
public final class NotificationFactory {

    public Notification from(NotificationRequestDto dto) {
        Objects.requireNonNull(dto);

        NotificationChannel channel = NotificationChannel.fromExternal(dto.channel());

        return switch (channel) {
            case EMAIL -> Notification.email(
                    EmailAddress.of(dto.recipient()),
                    dto.subject(),
                    dto.body()
            );
            case SMS -> Notification.sms(
                    PhoneNumber.of(dto.recipient()),
                    dto.body()
            );
        };
    }
}
```

### Exception

```java
public final class UnsupportedNotificationChannelException extends RuntimeException {
    private final String rawChannel;

    public UnsupportedNotificationChannelException(String rawChannel) {
        super("Unsupported notification channel: " + rawChannel);
        this.rawChannel = rawChannel;
    }

    public String rawChannel() {
        return rawChannel;
    }
}
```

## 27.3 What Improved?

1. External string parsed at boundary.
2. Domain channel is enum.
3. Factory return type is `Notification`, not `Object`.
4. No null return.
5. Product family is sealed.
6. Constructors/records enforce invariant.
7. Static factory on interface gives intent.
8. Error type is meaningful.
9. Switch is exhaustive.
10. Caller code becomes simple.

Caller:

```java
Notification notification = notificationFactory.from(dto);
```

This is not “pattern for pattern’s sake”. It is failure control.

---

# 28. Common Misconceptions

## 28.1 “Factory Always Improves Design”

False.

Factory improves design only if it reduces real coupling or clarifies creation semantics.

Useless factory:

```java
public User createUser(String name) {
    return new User(name);
}
```

## 28.2 “Using new Is Bad”

False.

`new` is fine when concrete creation is part of local responsibility.

```java
return new Money(amount, currency);
```

Bad when `new` creates infrastructure dependency inside policy/domain/use case.

## 28.3 “DI Container Solves Creation”

False.

DI container wires object graph. It does not automatically solve domain object creation.

You still need to design:

- constructors,
- factories,
- invariants,
- value objects,
- commands,
- events,
- policy selection,
- lifecycle.

## 28.4 “Static Factory Is Not Testable”

Not necessarily.

Static factory for pure value creation is fine.

Problematic static methods are those that hide:

- time,
- random,
- I/O,
- global state,
- current user,
- environment,
- database,
- network.

Pure static factory:

```java
CaseNumber.of(raw)
```

Good.

Hidden global static factory:

```java
CaseDecision.createFromCurrentUser(caseId)
```

Dangerous.

## 28.5 “Reflection Makes Factory Flexible”

It makes it dynamic, not necessarily flexible.

True flexibility requires:

- explicit contract,
- clear lifecycle,
- safe extension,
- good error model,
- observability,
- compatibility.

Reflection without contract is runtime roulette.

---

# 29. Design Review Checklist

Gunakan checklist ini saat melihat constructor/factory di code review.

## 29.1 Constructor Checklist

1. Apakah object valid setelah constructor selesai?
2. Apakah parameter terlalu banyak?
3. Apakah ada boolean flag yang tidak jelas?
4. Apakah ada null sebagai mode?
5. Apakah constructor melakukan I/O?
6. Apakah constructor melakukan lookup database/cache/network?
7. Apakah constructor melakukan side effect?
8. Apakah mutable input di-defensive copy?
9. Apakah invariant dijaga di satu tempat?
10. Apakah error message cukup jelas?
11. Apakah constructor public memang perlu public?
12. Apakah record compact constructor cukup?

## 29.2 Static Factory Checklist

1. Apakah factory method memberi nama intent?
2. Apakah ia menyembunyikan constructor dengan alasan jelas?
3. Apakah ia melakukan normalization?
4. Apakah ia memilih subtype?
5. Apakah ia mengontrol instance/cache?
6. Apakah ia pure atau punya side effect?
7. Apakah dependency tersembunyi?
8. Apakah method name jujur?
9. Apakah error semantics jelas?
10. Apakah return type terlalu umum?
11. Apakah factory terlalu banyak responsibility?
12. Apakah builder lebih cocok?

## 29.3 Factory Method Checklist

1. Apakah inheritance memang model yang tepat?
2. Apakah superclass algorithm stabil?
3. Apakah creation step wajar dijadikan extension point?
4. Apakah subclass hanya mengganti creation atau terlalu banyak override?
5. Apakah factory method punya nama jelas?
6. Apakah object dibuat fresh per operation?
7. Apakah DI lebih sederhana?
8. Apakah test mudah?
9. Apakah protected method membuka invariant?
10. Apakah ada fragile base class risk?

## 29.4 Anti-Pattern Checklist

Waspadai:

1. `FactoryFactory`,
2. `Object create(String type)`,
3. `return null`,
4. `Class.forName`,
5. `new DatabaseConnection()` di factory,
6. constructor dengan network call,
7. constructor dengan 8 parameter,
8. boolean flag berulang,
9. factory yang save/send/audit,
10. factory yang hanya pass-through tanpa value,
11. static factory membaca global current user,
12. factory selection logic duplikat di banyak tempat.

---

# 30. Staff-Level Discussion: Pertanyaan yang Harus Bisa Dijawab

Saat mendesain creation boundary, engineer senior harus bisa menjawab:

1. Kenapa caller boleh/tidak boleh tahu concrete class?
2. Invariant apa yang dijamin setelah object dibuat?
3. Apakah creation deterministic?
4. Apakah creation bisa gagal? Jika ya, gagal karena apa?
5. Apakah failure ini domain, validation, configuration, atau infrastructure?
6. Apakah factory melakukan side effect?
7. Apakah object ini murah atau mahal?
8. Siapa yang memiliki lifecycle object ini?
9. Apakah object thread-safe?
10. Apakah object boleh di-cache?
11. Apakah future subtype mungkin muncul?
12. Apakah enum switch cukup atau perlu registry/plugin?
13. Apakah static factory menyembunyikan dependency?
14. Apakah DI container seharusnya membuat object ini?
15. Apakah test bisa membuat object tanpa environment production?
16. Apakah external string masuk terlalu jauh ke domain?
17. Apakah design ini bisa dijelaskan ke engineer lain dengan mudah?
18. Apa refactoring path jika requirement berubah?

Top engineer tidak hanya berkata:

> “Pakai factory.”

Ia berkata:

> “Kita butuh factory di boundary ini karena subtype selection bergantung pada domain enum yang berasal dari external channel. Kita parse external string sekali, lalu gunakan sealed product family agar compiler membantu exhaustiveness. Factory tetap pure, tidak melakukan I/O, dan error unsupported channel dimodelkan eksplisit agar bisa dimap ke 400 dan audit event.”

Itulah level reasoning yang dicari.

---

# 31. Pattern Decision Record Example

```markdown
# Pattern Decision Record: Notification Creation Boundary

## Context

Notification dapat dikirim melalui EMAIL dan SMS. Input channel berasal dari external API sebagai string. Sistem perlu menolak channel tidak dikenal dengan error yang jelas.

## Problem

Jika string channel dipakai langsung di service, selection logic akan tersebar, raw string masuk ke domain, dan typo baru ketahuan runtime di tempat yang jauh.

## Decision

Gunakan:
- `NotificationChannel` enum untuk domain channel,
- `NotificationChannel.fromExternal(raw)` untuk parsing boundary,
- sealed interface `Notification`,
- static factory `Notification.email(...)` dan `Notification.sms(...)`,
- `NotificationFactory.from(dto)` untuk mapping request DTO ke domain notification.

## Consequences

Positive:
- selection terpusat,
- compiler membantu exhaustive switch,
- domain tidak bergantung raw string,
- error unsupported channel eksplisit,
- product family tertutup.

Negative:
- setiap channel baru perlu update enum, sealed permits, factory, dan tests,
- tidak cocok jika channel harus plugin-based runtime.

## Revisit When

- channel dikonfigurasi runtime,
- third-party provider bisa ditambah tanpa release,
- notification behavior makin kompleks,
- delivery lifecycle perlu persistence/outbox.
```

---

# 32. Practical Heuristics

## 32.1 Constructor Heuristic

Jika constructor butuh komentar untuk menjelaskan parameter, pertimbangkan static factory atau parameter object.

Buruk:

```java
new ReportRequest("CASE", true, false); // include draft, exclude archived
```

Lebih baik:

```java
ReportRequest.forDraftCases();
```

## 32.2 Factory Heuristic

Jika factory hanya memanggil `new` dan tidak memberi semantic value, hapus factory.

```java
new User(name)
```

lebih baik daripada:

```java
userFactory.create(name)
```

jika factory tidak menambah apa pun.

## 32.3 Boundary Heuristic

External input harus dikonversi secepat mungkin.

```java
String rawStatus
```

jangan masuk jauh ke domain.

Ubah menjadi:

```java
CaseStatus status = CaseStatus.fromExternal(rawStatus);
```

## 32.4 Lifecycle Heuristic

Jika object punya `close`, connection, thread, executor, file handle, socket, atau cache besar, jangan dibuat sembarangan di constructor/domain factory.

## 32.5 Side Effect Heuristic

Factory yang pure lebih mudah dipahami.

Jika factory punya side effect, namanya harus jujur:

- `load`,
- `fetch`,
- `register`,
- `initialize`,
- `open`,
- `connect`.

Jangan menyebut semua sebagai `create`.

---

# 33. Anti-Pattern Catalog Ringkas

## 33.1 Constructor Doing Work

Symptom:

```java
new Service() // suddenly connects to DB
```

Fix:

- inject dependency,
- move I/O to provider/loader/service,
- make lifecycle explicit.

## 33.2 Hidden Dependency Factory

Symptom:

```java
factory.create() // internally reads env, opens connection, calls API
```

Fix:

- inject dependency into factory,
- make config explicit,
- rename to provider/loader if needed.

## 33.3 Stringly Typed Factory

Symptom:

```java
factory.create("APPROVE")
```

Fix:

- enum/domain type,
- external parser,
- sealed hierarchy,
- registry.

## 33.4 Reflection Factory Abuse

Symptom:

```java
Class.forName(type).newInstance()
```

Fix:

- explicit registry,
- SPI with contract,
- whitelist,
- module-aware design.

## 33.5 Factory as God Service

Symptom:

```java
factory.createSaveSendAndAudit()
```

Fix:

- separate factory from application service,
- keep creation separate from orchestration.

## 33.6 Factory Explosion

Symptom:

```java
UserFactory
UserFactoryImpl
UserFactoryProvider
UserFactoryBuilder
```

Fix:

- collapse unnecessary abstraction,
- use constructor/static factory,
- introduce factory only where force exists.

## 33.7 Generic Object Vending Machine

Symptom:

```java
Object create(String type)
```

Fix:

- product-specific factory,
- typed return,
- distinct bounded contexts.

---

# 34. Summary

Creational pattern bukan tentang membuat object dengan cara lebih rumit.

Creational pattern adalah tentang mengendalikan:

1. invariant,
2. intent,
3. representation,
4. subtype,
5. dependency,
6. lifecycle,
7. failure,
8. evolution.

Constructor cocok untuk object sederhana dengan invariant lokal.

Static factory cocok ketika creation butuh nama, normalization, subtype selection, cached instance, hidden implementation, atau alternative construction.

Factory Method pattern cocok ketika superclass/framework memiliki workflow stabil dan subclass perlu mengontrol object creation sebagai extension point.

Factory menjadi anti-pattern ketika:

- menyembunyikan dependency,
- melakukan I/O diam-diam,
- memakai string sebagai type system,
- return `Object`,
- melakukan orchestration,
- hanya pass-through tanpa value,
- memakai reflection tanpa contract,
- membuat desain lebih sulit tanpa mengurangi risk.

Pertanyaan utama bukan:

> “Apakah harus pakai factory?”

Tetapi:

> “Creation force apa yang sedang kita kendalikan?”

Jika tidak ada force, gunakan constructor sederhana.

Jika ada intent ambiguity, gunakan static factory.

Jika ada subtype selection, gunakan static factory, enum switch, sealed hierarchy, atau registry.

Jika ada framework extension, gunakan Factory Method.

Jika ada banyak optional parameter, lanjut ke Builder di Part 5.

---

# 35. Latihan

## Latihan 1: Constructor Smell

Refactor kode berikut:

```java
new CaseSearchRequest(
    "ENFORCEMENT",
    "OPEN",
    null,
    null,
    true,
    false,
    0,
    50
);
```

Tugas:

1. Identifikasi smell.
2. Buat domain type yang relevan.
3. Buat static factory intent-specific.
4. Tentukan apakah Builder lebih cocok.
5. Jelaskan trade-off.

## Latihan 2: Stringly Typed Factory

Refactor:

```java
public Handler create(String action) {
    if (action.equals("approve")) return new ApproveHandler();
    if (action.equals("reject")) return new RejectHandler();
    if (action.equals("escalate")) return new EscalateHandler();
    return null;
}
```

Tugas:

1. Ganti string dengan enum.
2. Hilangkan null.
3. Buat exception yang jelas.
4. Tambahkan test unsupported action.
5. Jelaskan kapan registry lebih cocok daripada switch.

## Latihan 3: Hidden Dependency

Refactor:

```java
public ReportExporter create(String templateName) {
    Template template = DatabaseTemplateRepository.connect().find(templateName);
    return new ReportExporter(template);
}
```

Tugas:

1. Identifikasi hidden dependency.
2. Pisahkan repository dependency.
3. Tentukan apakah nama `create` masih jujur.
4. Tambahkan error model.
5. Buat test dengan fake repository.

## Latihan 4: Factory Method vs DI

Diberikan superclass:

```java
abstract class ImportJob {
    public final void run(Path path) {
        Reader reader = createReader();
        Validator validator = createValidator();
        ...
    }

    protected abstract Reader createReader();
    protected abstract Validator createValidator();
}
```

Tugas:

1. Jelaskan kapan design ini tepat.
2. Jelaskan kapan lebih baik memakai DI + Strategy.
3. Identifikasi fragile base class risk.
4. Buat alternatif composition-based design.

---

# 36. Koneksi ke Part Berikutnya

Part ini membahas constructor, static factory, dan factory method.

Namun ada satu masalah creation yang belum diselesaikan secara penuh:

> Bagaimana membuat object kompleks dengan banyak optional parameter, kombinasi valid, staged creation, immutable result, test fixture, dan readable caller?

Itulah topik Part 5:

```text
05-creational-abstract-factory-builder-prototype-object-mother.md
```

Di sana kita akan membahas:

- Abstract Factory,
- Builder,
- staged builder,
- test data builder,
- Prototype,
- copy constructor,
- Object Mother anti-pattern,
- fixture explosion,
- creation pattern untuk test dan enterprise object graph.

---

## Status Seri

```text
Part 4 dari 35 selesai.
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./03-solid-revisited-failure-control-design-judgment.md">⬅️ SOLID Revisited: Failure Control and Design Judgment</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./05-creational-abstract-factory-builder-prototype-object-mother.md">Part 5 — Creational Pattern II: Abstract Factory, Builder, Prototype, Object Mother ➡️</a>
</div>

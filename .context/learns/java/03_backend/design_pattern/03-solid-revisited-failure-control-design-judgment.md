# 03 — SOLID Revisited: Failure Control and Design Judgment

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: `03-solid-revisited-failure-control-design-judgment.md`  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Staff-level engineering foundation

---

## 0. Posisi Materi Ini dalam Seri

SOLID sering diajarkan sebagai lima slogan:

```text
S — Single Responsibility Principle
O — Open/Closed Principle
L — Liskov Substitution Principle
I — Interface Segregation Principle
D — Dependency Inversion Principle
```

Masalahnya, banyak engineer berhenti di hafalan. Akibatnya SOLID dipakai seperti checklist mekanis:

```text
Class harus kecil.
Harus banyak interface.
Harus dependency injection.
Harus strategy pattern.
Harus abstract supaya extensible.
Harus avoid inheritance.
```

Pendekatan seperti itu sering menghasilkan codebase yang terlihat “enterprise”, tetapi sulit dipahami, sulit ditest, sulit diubah, dan penuh indirection.

Di level senior/staff, SOLID bukan dogma. SOLID adalah **model pengendalian kegagalan desain**.

Artinya, pertanyaan utamanya bukan:

```text
Apakah kode ini SOLID?
```

Tetapi:

```text
Perubahan apa yang ingin kita isolasi?
Failure apa yang ingin kita cegah?
Invariant apa yang ingin kita lindungi?
Dependency mana yang harus stabil?
Extension point mana yang benar-benar dibutuhkan?
Biaya abstraksi ini lebih kecil atau lebih besar daripada masalah yang dicegah?
```

Bagian ini membahas SOLID sebagai alat judgment, bukan ritual.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami SOLID sebagai mekanisme mengontrol perubahan, bukan sekadar aturan OOP.
2. Membedakan responsibility berdasarkan alasan perubahan, bukan berdasarkan jumlah method.
3. Mendesain extension point yang stabil tanpa overengineering.
4. Mengenali pelanggaran LSP yang tersembunyi di inheritance, interface, generics, dan exception contract.
5. Mencegah interface pollution dan fat interface di Java enterprise system.
6. Mengarahkan dependency dari policy-level code ke detail-level code, bukan sebaliknya.
7. Menggunakan Java 8–25 features untuk menerapkan SOLID lebih sederhana.
8. Menilai kapan SOLID perlu dilonggarkan demi simplicity, performance, atau delivery risk.
9. Mengenali anti-pattern yang sering disalahartikan sebagai SOLID.
10. Melakukan design review berbasis failure mode dan trade-off.

---

## 2. Mental Model Utama

SOLID bisa dipahami sebagai lima cara mengendalikan kerusakan saat sistem berubah.

```text
SRP  → batasi alasan perubahan dalam satu unit desain
OCP  → izinkan variasi tanpa mengubah bagian stabil
LSP  → pastikan substitusi tidak merusak kontrak
ISP  → jangan paksa client bergantung pada hal yang tidak dipakai
DIP  → arahkan dependency ke policy yang stabil, bukan detail yang volatile
```

Dalam sistem kecil, pelanggaran SOLID mungkin tidak terasa. Dalam sistem besar, pelanggaran SOLID biasanya muncul sebagai:

- perubahan kecil menyentuh banyak file;
- bug muncul di area yang tidak terlihat berhubungan;
- test sulit dibuat karena dependency terlalu konkret;
- subclass tampak compatible tetapi runtime behavior berbeda;
- interface menjadi terlalu gemuk;
- domain logic bergantung pada framework;
- service layer menjadi tempat semua keputusan;
- feature baru selalu menambah `if` baru;
- class mudah dipakai salah;
- requirement baru mengubah struktur besar-besaran.

SOLID bukan untuk membuat semua desain abstrak. SOLID adalah cara bertanya:

```text
Apa yang akan berubah?
Apa yang harus tetap stabil?
Apa yang boleh depend ke apa?
Apa yang terjadi kalau assumption ini salah?
```

---

## 3. SOLID dalam Bahasa Design Force

Setiap prinsip SOLID muncul karena ada tekanan desain tertentu.

| Prinsip | Design Force | Failure yang Dicegah |
|---|---|---|
| SRP | Banyak alasan perubahan bercampur | perubahan kecil merusak behavior lain |
| OCP | Variasi behavior terus bertambah | `if/else` menyebar dan regression tinggi |
| LSP | Subtype tidak benar-benar kompatibel | polymorphism menghasilkan bug tersembunyi |
| ISP | Client dipaksa tahu terlalu banyak | dependency melebar dan implementasi palsu |
| DIP | Policy bergantung pada detail | domain/application logic sulit ditest dan diganti |

Cara membaca SOLID yang lebih kuat:

```text
SOLID bukan melarang sesuatu.
SOLID membuat biaya perubahan lebih predictable.
```

---

# 4. S — Single Responsibility Principle

## 4.1 Definisi yang Lebih Akurat

SRP sering disederhanakan menjadi:

```text
Satu class hanya boleh punya satu tugas.
```

Ini kurang tepat. Definisi yang lebih kuat:

```text
Satu module/class harus punya satu alasan utama untuk berubah.
```

“Responsibility” bukan berarti jumlah method. Responsibility berarti **reason to change**.

Contoh class dengan banyak method tetapi satu alasan perubahan:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money add(Money other) { ... }
    public Money subtract(Money other) { ... }
    public Money multiply(BigDecimal multiplier) { ... }
    public boolean isPositive() { ... }
    public boolean isZero() { ... }
}
```

Class ini punya banyak behavior, tetapi satu responsibility: menjaga operasi uang.

Contoh class dengan sedikit method tetapi banyak alasan perubahan:

```java
public class CaseApprovalService {
    public void approve(Long caseId, String remarks) {
        CaseEntity c = caseRepository.findById(caseId);

        if (!securityContext.currentUser().hasRole("APPROVER")) {
            throw new ForbiddenException();
        }

        if (!c.getStatus().equals("PENDING_REVIEW")) {
            throw new InvalidStatusException();
        }

        if (remarks.length() > 500) {
            throw new ValidationException();
        }

        c.setStatus("APPROVED");
        caseRepository.save(c);

        auditRepository.insert("CASE_APPROVED", c.getId());
        emailClient.sendApprovalNotification(c.getApplicantEmail());
        externalGateway.notifyCaseApproved(c.getReferenceNo());
    }
}
```

Satu method, tetapi banyak alasan perubahan:

- authorization policy berubah;
- workflow transition berubah;
- validation rule berubah;
- persistence schema berubah;
- audit format berubah;
- email template berubah;
- external API contract berubah;
- transaction semantics berubah.

Jumlah method tidak menentukan SRP. Jumlah **axis of change** menentukan SRP.

---

## 4.2 SRP sebagai Change Isolation

SRP bertanya:

```text
Jika requirement X berubah, file mana yang harus berubah?
Apakah perubahan itu masuk akal secara domain?
Apakah class ini berubah karena alasan bisnis, teknis, framework, UI, persistence, security, atau integration?
```

Class yang buruk biasanya menjadi meeting point dari banyak stakeholder:

```text
Business analyst  → ubah workflow rule
Security team     → ubah permission
DBA               → ubah schema/query
Ops               → ubah timeout/retry
QA                → ubah validation message
External vendor   → ubah payload
Frontend          → ubah response shape
```

Jika semuanya mengubah class yang sama, class itu punya terlalu banyak responsibility.

---

## 4.3 Responsibility Bukan Selalu “Pisah Class”

Kesalahan umum: setiap responsibility langsung dipisah menjadi class baru.

Contoh overengineering:

```java
class CaseStatusValidator { ... }
class CaseRemarksValidator { ... }
class CaseApprovalPermissionChecker { ... }
class CaseApprovalAuditWriter { ... }
class CaseApprovalEmailSender { ... }
class CaseApprovalExternalNotifier { ... }
class CaseApprovalTimestampAssigner { ... }
```

Kadang ini benar. Kadang ini membuat navigasi code menjadi buruk.

SRP tidak selalu berarti “lebih banyak class”. SRP berarti **boundary perubahan jelas**.

Alternatif yang lebih seimbang:

```java
public final class ApproveCaseUseCase {
    private final CaseRepository cases;
    private final ApprovalPolicy approvalPolicy;
    private final CaseApprovalWorkflow workflow;
    private final CaseApprovalEffects effects;

    public void approve(ApproveCaseCommand command) {
        CaseRecord c = cases.get(command.caseId());
        approvalPolicy.check(command.actor(), c);
        CaseRecord approved = workflow.approve(c, command.remarks());
        cases.save(approved);
        effects.afterApproval(approved, command.actor());
    }
}
```

Di sini responsibility dibagi berdasarkan axis yang stabil:

- use case orchestration;
- approval policy;
- workflow transition;
- post-commit/side effects.

Bukan setiap baris menjadi class.

---

## 4.4 SRP dan Cohesion

Class yang cohesive punya method yang saling mendukung satu konsep.

Cohesion rendah:

```java
public class CaseUtil {
    public boolean isValidStatus(String status) { ... }
    public String formatDate(LocalDate date) { ... }
    public void sendEmail(String to, String body) { ... }
    public byte[] generatePdf(Object data) { ... }
    public boolean hasRole(User user, String role) { ... }
}
```

Class ini tidak punya pusat makna.

Cohesion tinggi:

```java
public final class CaseStatusTransitionPolicy {
    public boolean canApprove(CaseStatus current) { ... }
    public boolean canReject(CaseStatus current) { ... }
    public boolean canReopen(CaseStatus current) { ... }
    public CaseStatus approve(CaseStatus current) { ... }
}
```

Semua method berhubungan dengan transition policy.

---

## 4.5 SRP Anti-Patterns

### 4.5.1 God Service

Ciri:

```text
Satu service tahu semua: validation, authorization, workflow, persistence, notification, audit, mapping, external API.
```

Biasanya muncul karena “lebih cepat taruh di service”.

Failure mode:

- sulit ditest;
- sulit direview;
- regression tinggi;
- merge conflict sering;
- perubahan kecil menyentuh service besar;
- domain rule tidak reusable;
- side effect tersembunyi.

### 4.5.2 Helper Dumping Ground

Nama class:

```text
CommonUtil
CaseHelper
GeneralService
ApplicationUtils
ValidationHelper
```

Masalahnya bukan nama “helper”, tetapi tidak ada ownership domain.

### 4.5.3 Artificial SRP

Terlalu memecah tanpa design force.

```text
One method = one class
One line = one abstraction
Every if = strategy
Every object = interface
```

Failure mode:

- navigasi buruk;
- debug sulit;
- stack trace panjang;
- cognitive load tinggi;
- tidak jelas flow utamanya.

---

## 4.6 SRP Design Review Questions

Gunakan pertanyaan ini:

```text
1. Class ini berubah karena alasan apa saja?
2. Apakah alasan perubahan itu berasal dari stakeholder berbeda?
3. Apakah class ini mencampur domain, persistence, API, security, dan integration?
4. Apakah nama class menjelaskan responsibility sebenarnya?
5. Apakah method-methodnya saling mendukung satu konsep?
6. Apakah perubahan rule bisnis memaksa perubahan detail teknis?
7. Apakah perubahan format external API memaksa perubahan domain object?
8. Apakah test class ini perlu mock terlalu banyak dependency?
9. Apakah class ini menjadi tempat default untuk semua perubahan?
```

---

# 5. O — Open/Closed Principle

## 5.1 Definisi

OCP sering dinyatakan:

```text
Software entities should be open for extension, but closed for modification.
```

Makna praktisnya:

```text
Bagian yang stabil tidak perlu diubah setiap kali variasi baru ditambahkan.
```

OCP bukan berarti kode tidak boleh diubah. Itu mustahil. OCP berarti kita memilih bagian tertentu sebagai **stable core**, lalu menyediakan extension mechanism di sekitar variasi yang memang sering berubah.

---

## 5.2 Masalah yang Diselesaikan OCP

Contoh awal:

```java
public BigDecimal calculateFee(ApplicationType type, BigDecimal amount) {
    if (type == ApplicationType.NEW_LICENSE) {
        return amount.multiply(new BigDecimal("0.10"));
    }
    if (type == ApplicationType.RENEWAL) {
        return amount.multiply(new BigDecimal("0.05"));
    }
    if (type == ApplicationType.APPEAL) {
        return BigDecimal.ZERO;
    }
    throw new IllegalArgumentException("Unsupported type");
}
```

Ketika application type bertambah, method ini terus diubah. Jika logic fee tersebar di beberapa tempat, risk meningkat.

Refactor dengan Strategy:

```java
public interface FeePolicy {
    ApplicationType supports();
    BigDecimal calculate(BigDecimal amount);
}

public final class NewLicenseFeePolicy implements FeePolicy {
    @Override
    public ApplicationType supports() {
        return ApplicationType.NEW_LICENSE;
    }

    @Override
    public BigDecimal calculate(BigDecimal amount) {
        return amount.multiply(new BigDecimal("0.10"));
    }
}

public final class FeeCalculator {
    private final Map<ApplicationType, FeePolicy> policies;

    public FeeCalculator(List<FeePolicy> policies) {
        this.policies = policies.stream()
                .collect(Collectors.toUnmodifiableMap(FeePolicy::supports, Function.identity()));
    }

    public BigDecimal calculate(ApplicationType type, BigDecimal amount) {
        FeePolicy policy = policies.get(type);
        if (policy == null) {
            throw new UnsupportedApplicationTypeException(type);
        }
        return policy.calculate(amount);
    }
}
```

Sekarang variasi baru bisa ditambahkan dengan class baru.

Tetapi ini belum otomatis lebih baik. OCP hanya worth it jika variasi memang cukup stabil sebagai axis.

---

## 5.3 OCP vs YAGNI

OCP sering disalahgunakan untuk membuat extension point yang belum dibutuhkan.

Bad example:

```java
public interface CaseNumberGenerationStrategyFactoryProviderResolver {
    CaseNumberGenerationStrategy resolve(CaseNumberGenerationContext context);
}
```

Padahal saat ini hanya ada satu format case number dan belum ada evidence variasi.

Better:

```java
public final class CaseNumberGenerator {
    public CaseNumber generate(CaseType type, Year year, Sequence sequence) {
        return new CaseNumber(type.code() + "-" + year + "-" + sequence.padded());
    }
}
```

Tambahkan strategy saat variasi nyata muncul.

Rule praktis:

```text
Jangan membuat extension point untuk perubahan yang hanya mungkin.
Buat extension point untuk perubahan yang probable, recurring, costly, atau already observed.
```

---

## 5.4 OCP dan Stable Abstraction

OCP membutuhkan stable abstraction. Jika abstraction belum stabil, OCP justru menciptakan lock-in buruk.

Interface buruk:

```java
public interface ApplicationProcessor {
    void process(Object input);
}
```

Terlalu umum. Tidak ada kontrak yang jelas.

Interface lebih baik:

```java
public interface ApplicationEligibilityPolicy {
    EligibilityResult evaluate(Application application, ApplicantProfile profile);
}
```

Kontrak domain jelas:

- input jelas;
- output jelas;
- responsibility jelas;
- variasi policy mudah ditambahkan;
- stable karena konsep eligibility memang domain-level.

---

## 5.5 OCP dengan Java 8 Lambda

Sebelum Java 8, Strategy sering butuh banyak class.

Dengan Java 8:

```java
@FunctionalInterface
public interface EligibilityRule {
    EligibilityResult evaluate(Application application);
}
```

Usage:

```java
EligibilityRule noOutstandingPenalty = app ->
        app.applicant().hasOutstandingPenalty()
                ? EligibilityResult.rejected("Outstanding penalty")
                : EligibilityResult.approved();
```

Composition:

```java
public final class CompositeEligibilityRule implements EligibilityRule {
    private final List<EligibilityRule> rules;

    public CompositeEligibilityRule(List<EligibilityRule> rules) {
        this.rules = List.copyOf(rules);
    }

    @Override
    public EligibilityResult evaluate(Application application) {
        for (EligibilityRule rule : rules) {
            EligibilityResult result = rule.evaluate(application);
            if (result.isRejected()) {
                return result;
            }
        }
        return EligibilityResult.approved();
    }
}
```

Java 8 membuat OCP lebih ringan. Tetapi hati-hati: lambda anonim bisa menghilangkan nama domain.

Buruk:

```java
rules.add(app -> app.x() && app.y() && !app.z() ? ok() : reject());
```

Lebih baik:

```java
rules.add(EligibilityRules.noOutstandingPenalty());
rules.add(EligibilityRules.hasRequiredQualification());
rules.add(EligibilityRules.noActiveSanction());
```

Nama rule adalah dokumentasi domain.

---

## 5.6 OCP dengan Sealed Classes

OCP tidak selalu berarti terbuka untuk subtype eksternal. Kadang sistem butuh closed set yang eksplisit.

Contoh Java 17+:

```java
public sealed interface Decision permits Approved, Rejected, PendingClarification {
}

public record Approved(String approvedBy) implements Decision {}
public record Rejected(String reason) implements Decision {}
public record PendingClarification(String requestedInfo) implements Decision {}
```

Dengan sealed hierarchy, kita sengaja **closed for extension** di luar daftar permitted subtype. Ini terlihat bertentangan dengan OCP, tetapi sebenarnya tidak.

OCP bukan selalu “semua bisa extend”. Untuk domain yang closed, perubahan subtype harus eksplisit karena memengaruhi semua decision handling.

```java
String display(Decision decision) {
    return switch (decision) {
        case Approved a -> "Approved by " + a.approvedBy();
        case Rejected r -> "Rejected: " + r.reason();
        case PendingClarification p -> "Pending: " + p.requestedInfo();
    };
}
```

Jika subtype baru ditambahkan, compiler membantu menunjukkan semua tempat yang perlu dipikirkan.

Mental model:

```text
OCP untuk axis yang sering bertambah secara plugin-like.
Sealed hierarchy untuk domain alternative yang harus exhaustive dan controlled.
```

---

## 5.7 OCP Anti-Patterns

### 5.7.1 Strategy Theater

Engineer membuat Strategy, tetapi decision logic tetap hardcoded di factory besar:

```java
public FeePolicy getPolicy(ApplicationType type) {
    if (type == NEW_LICENSE) return new NewLicenseFeePolicy();
    if (type == RENEWAL) return new RenewalFeePolicy();
    if (type == APPEAL) return new AppealFeePolicy();
    ...
}
```

Ini mungkin masih OK jika factory adalah single composition root. Tetapi jika `if` tersebar, OCP gagal.

### 5.7.2 Abstract Everything

```java
public interface UserNameProviderResolverFactoryStrategy { ... }
```

Indirection tanpa variasi nyata.

### 5.7.3 Plugin Illusion

Sistem terlihat extensible, tetapi setiap plugin baru tetap butuh perubahan database, API, UI, workflow, deployment, dan config manual.

Pertanyaan penting:

```text
Extension point ini benar-benar mengurangi modification, atau hanya memindahkan modification ke tempat lain?
```

---

## 5.8 OCP Design Review Questions

```text
1. Axis variasi apa yang sedang distabilkan?
2. Apakah variasi ini sudah terbukti sering berubah?
3. Apakah abstraction punya kontrak domain yang jelas?
4. Apakah extension baru bisa ditambahkan tanpa menyentuh stable core?
5. Apakah extension mechanism mudah ditest?
6. Apakah extension ordering penting?
7. Apakah ada fallback untuk unsupported variation?
8. Apakah sealed hierarchy lebih cocok daripada open polymorphism?
9. Apakah extension point ini mengurangi risiko atau menambah accidental complexity?
```

---

# 6. L — Liskov Substitution Principle

## 6.1 Definisi Praktis

LSP berarti:

```text
Object dari subtype harus bisa menggantikan object dari supertype tanpa merusak correctness program.
```

Bukan hanya “compile”. Tetapi behavior harus tetap sesuai kontrak.

Jika kode ini valid:

```java
void process(PaymentMethod method) {
    method.authorize();
    method.capture();
}
```

Maka semua subtype `PaymentMethod` harus aman dipakai di situ.

---

## 6.2 LSP Bukan Hanya Inheritance

LSP berlaku untuk:

- class inheritance;
- interface implementation;
- generic type usage;
- mock/stub behavior;
- framework proxy;
- subclass entity ORM;
- collection subtype;
- exception contract;
- nullability contract;
- immutability expectation.

Contoh pelanggaran interface:

```java
public interface DocumentStore {
    void save(Document document);
    Document get(DocumentId id);
    void delete(DocumentId id);
}

public final class ReadOnlyDocumentStore implements DocumentStore {
    @Override
    public void save(Document document) {
        throw new UnsupportedOperationException("Read only");
    }

    @Override
    public Document get(DocumentId id) { ... }

    @Override
    public void delete(DocumentId id) {
        throw new UnsupportedOperationException("Read only");
    }
}
```

Secara compile OK. Secara LSP buruk. `ReadOnlyDocumentStore` tidak memenuhi kontrak `DocumentStore`.

Solusi ISP + contract split:

```java
public interface DocumentReader {
    Document get(DocumentId id);
}

public interface DocumentWriter {
    void save(Document document);
    void delete(DocumentId id);
}
```

---

## 6.3 Contract dalam LSP

Subtype tidak boleh:

1. memperkuat precondition;
2. memperlemah postcondition;
3. melanggar invariant supertype;
4. melempar exception yang tidak sesuai ekspektasi;
5. mengubah side effect secara mengejutkan;
6. mengubah mutability expectation;
7. mengubah concurrency safety expectation.

### Precondition

Supertype:

```java
interface ReportExporter {
    ExportedFile export(Report report);
}
```

Subtype buruk:

```java
final class PdfReportExporter implements ReportExporter {
    public ExportedFile export(Report report) {
        if (!report.hasAllSections()) {
            throw new IllegalArgumentException("PDF requires all sections");
        }
        ...
    }
}
```

Subtype memperkuat precondition. Caller yang hanya tahu `ReportExporter` tidak tahu bahwa PDF butuh all sections.

Better:

```java
interface ReportExporter {
    boolean supports(Report report);
    ExportedFile export(Report report);
}
```

Atau pisahkan command validation di luar.

### Postcondition

Supertype menjanjikan file tersimpan:

```java
interface FilePublisher {
    PublishedFile publish(FileContent content);
}
```

Subtype buruk hanya mengirim ke queue dan belum published, tetapi return `PublishedFile` seolah sudah published.

### Invariant

Superclass menjamin `balance >= 0`. Subclass tidak boleh membuat state negatif tanpa aturan eksplisit.

---

## 6.4 Classic Rectangle-Square Problem dalam Bahasa Enterprise

Contoh textbook: Square subtype dari Rectangle bermasalah karena setter width/height punya behavior berbeda.

Versi enterprise:

```java
interface CaseAction {
    void execute(CaseRecord c);
}

final class ApproveAction implements CaseAction {
    public void execute(CaseRecord c) {
        c.approve();
    }
}

final class NotifyOnlyApproveAction implements CaseAction {
    public void execute(CaseRecord c) {
        email.send(...);
    }
}
```

Nama `NotifyOnlyApproveAction` menipu. Caller mengira semua `CaseAction` mengubah case sesuai action. Tapi subtype ini hanya notify.

LSP violation sering muncul dari nama abstraction yang terlalu luas.

---

## 6.5 LSP dan Java Collections

Contoh terkenal:

```java
List<String> list = List.of("a", "b");
list.add("c"); // UnsupportedOperationException
```

Apakah ini LSP violation? Tergantung kontrak. Java `List` memang mengizinkan optional operation. Tetapi secara desain API, optional operation membuat caller harus waspada.

Pelajaran:

```text
Jika interface punya operation opsional, caller burden meningkat.
```

Untuk domain sendiri, hindari optional operation jika bisa. Lebih baik split interface.

---

## 6.6 LSP dan Exception

Buruk:

```java
interface NotificationSender {
    void send(Notification notification);
}

final class EmailNotificationSender implements NotificationSender {
    public void send(Notification notification) {
        throw new SmtpRuntimeException("SMTP down");
    }
}

final class SmsNotificationSender implements NotificationSender {
    public void send(Notification notification) {
        throw new IllegalStateException("SMS quota missing");
    }
}
```

Semua implementasi punya exception semantics berbeda. Caller sulit membuat handling yang benar.

Better:

```java
interface NotificationSender {
    SendResult send(Notification notification);
}

sealed interface SendResult permits SendResult.Sent, SendResult.TemporaryFailure, SendResult.PermanentFailure {
    record Sent(MessageId id) implements SendResult {}
    record TemporaryFailure(String reason) implements SendResult {}
    record PermanentFailure(String reason) implements SendResult {}
}
```

Atau gunakan exception translation:

```java
throw new NotificationDeliveryException(channel, retryable, cause);
```

---

## 6.7 LSP dan Mutability

Jika interface menyiratkan immutable return, subtype tidak boleh mengembalikan mutable internal state.

Buruk:

```java
public interface OfficerRoles {
    List<String> roles();
}

public final class MutableOfficerRoles implements OfficerRoles {
    private final List<String> roles = new ArrayList<>();

    @Override
    public List<String> roles() {
        return roles; // leak
    }
}
```

Caller bisa mengubah invariant.

Better:

```java
@Override
public List<String> roles() {
    return List.copyOf(roles);
}
```

Atau return domain object:

```java
public final class RoleSet {
    private final Set<Role> roles;

    public boolean contains(Role role) { ... }
}
```

---

## 6.8 LSP dan Framework Proxy

Di Java enterprise, object yang kamu panggil sering bukan object asli:

- Spring proxy;
- CDI proxy;
- JDK dynamic proxy;
- Hibernate proxy;
- ByteBuddy/CGLIB proxy;
- remote client proxy;
- transactional proxy;
- security proxy.

LSP issue muncul ketika proxy tidak benar-benar behave seperti target.

Contoh:

```java
if (service.getClass() == CaseService.class) { ... }
```

Ini bisa gagal karena runtime class adalah proxy.

Better:

```java
if (service instanceof CaseService) { ... }
```

Atau lebih baik jangan branch berdasarkan concrete class.

Hibernate proxy issue:

```java
entity.getClass().equals(CaseEntity.class)
```

Bisa salah karena proxy subclass.

Equality design harus hati-hati.

---

## 6.9 LSP Anti-Patterns

### 6.9.1 UnsupportedOperation Implementation

Implementasi interface tetapi method dilempar `UnsupportedOperationException`.

Kadang acceptable untuk JDK collection optional ops, tapi untuk domain sendiri biasanya smell.

### 6.9.2 Subclass With Surprise

Subclass mengubah behavior fundamental superclass.

### 6.9.3 Boolean Capability Trap

```java
if (store.supportsDelete()) {
    store.delete(id);
}
```

Jika capability matrix makin banyak, interface mungkin salah desain.

### 6.9.4 Mock Violates Real Contract

Unit test mock return value yang tidak mungkin terjadi di production. Ini membuat test lulus tetapi design contract palsu.

---

## 6.10 LSP Design Review Questions

```text
1. Apakah semua implementasi benar-benar memenuhi kontrak interface?
2. Apakah ada method yang dilempar UnsupportedOperationException?
3. Apakah subtype memperkuat precondition?
4. Apakah subtype memperlemah postcondition?
5. Apakah exception semantics konsisten?
6. Apakah mutability expectation konsisten?
7. Apakah caller perlu tahu concrete type?
8. Apakah proxy/framework object tetap valid untuk contract ini?
9. Apakah mock di test mewakili behavior production?
```

---

# 7. I — Interface Segregation Principle

## 7.1 Definisi

ISP berarti:

```text
Client tidak boleh dipaksa bergantung pada method yang tidak digunakan.
```

Lebih praktis:

```text
Interface harus dibentuk dari kebutuhan client, bukan dari kemampuan implementor.
```

Fat interface membuat semua client tahu terlalu banyak.

---

## 7.2 Fat Interface Example

Buruk:

```java
public interface CaseService {
    CaseDetail getDetail(CaseId id);
    List<CaseSummary> search(CaseSearchCriteria criteria);
    void approve(CaseId id, Remarks remarks);
    void reject(CaseId id, Reason reason);
    void reopen(CaseId id, Reason reason);
    void assign(CaseId id, OfficerId officerId);
    void uploadDocument(CaseId id, Document document);
    void deleteDocument(CaseId id, DocumentId documentId);
    void exportPdf(CaseId id);
    void sendReminder(CaseId id);
}
```

Masalah:

- read client depend ke write method;
- approval client depend ke document method;
- test mock harus implement banyak method;
- permission model kabur;
- transaction boundary kabur;
- interface berubah terus;
- implementasi remote jadi terlalu luas.

Lebih baik split berdasarkan client/use case:

```java
public interface CaseQueryService {
    CaseDetail getDetail(CaseId id);
    List<CaseSummary> search(CaseSearchCriteria criteria);
}

public interface CaseApprovalUseCase {
    void approve(ApproveCaseCommand command);
    void reject(RejectCaseCommand command);
}

public interface CaseAssignmentUseCase {
    void assign(AssignCaseCommand command);
}

public interface CaseDocumentUseCase {
    void upload(UploadCaseDocumentCommand command);
    void delete(DeleteCaseDocumentCommand command);
}
```

---

## 7.3 Interface dari Perspektif Client

Bad design dimulai dari implementor:

```text
CaseServiceImpl bisa melakukan 20 hal.
Maka interface CaseService punya 20 method.
```

Better design dimulai dari client:

```text
Approval screen butuh approve/reject.
Search screen butuh search/get detail.
Document screen butuh upload/delete document.
Batch job butuh read pending cases.
External API butuh submit case.
```

Setiap client punya dependency surface yang minimum.

---

## 7.4 ISP dan Security

Fat interface memperbesar security risk.

Jika controller hanya butuh read:

```java
public final class CaseInquiryController {
    private final CaseQueryService cases;
}
```

Maka secara dependency, controller tidak punya akses ke mutation use case.

Jika controller inject `CaseService` besar, mistake lebih mudah:

```java
cases.approve(id, remarks); // accidentally available
```

ISP membantu principle of least privilege di level code.

---

## 7.5 ISP dan Testing

Fat interface membuat test noisy:

```java
class FakeCaseService implements CaseService {
    public CaseDetail getDetail(CaseId id) { ... }
    public List<CaseSummary> search(CaseSearchCriteria criteria) { throw new UnsupportedOperationException(); }
    public void approve(CaseId id, Remarks remarks) { throw new UnsupportedOperationException(); }
    ...
}
```

Ini tanda interface terlalu gemuk.

Dengan small interface:

```java
class FakeCaseQueryService implements CaseQueryService {
    public CaseDetail getDetail(CaseId id) { ... }
    public List<CaseSummary> search(CaseSearchCriteria criteria) { ... }
}
```

Test lebih fokus.

---

## 7.6 ISP dan Java Default Methods

Default method bisa membantu evolusi interface, tetapi bisa juga menyembunyikan interface bloat.

Contoh acceptable:

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) && other.isSatisfiedBy(candidate);
    }

    default Specification<T> or(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) || other.isSatisfiedBy(candidate);
    }
}
```

Default method mendukung konsep inti.

Contoh buruk:

```java
public interface CaseRepository {
    Case get(CaseId id);

    default void approve(CaseId id) {
        throw new UnsupportedOperationException();
    }

    default void exportPdf(CaseId id) {
        throw new UnsupportedOperationException();
    }
}
```

Default method dipakai untuk menutupi interface yang salah.

---

## 7.7 ISP dan Role Interface

Role interface adalah interface kecil yang mewakili peran object dalam context tertentu.

```java
public interface ApproverLookup {
    Officer getApprover(OfficerId id);
}

public interface CaseForApprovalRepository {
    CaseForApproval get(CaseId id);
    void save(CaseForApproval c);
}
```

Ini bukan berarti setiap method harus interface. Tetapi untuk boundary penting, role interface memperjelas dependency.

---

## 7.8 ISP Anti-Patterns

### 7.8.1 One Interface Per Implementation

```java
public interface CaseApprovalServiceInterface { ... }
public class CaseApprovalService implements CaseApprovalServiceInterface { ... }
```

Jika interface hanya mirror implementation dan tidak memberi boundary, itu noise.

Interface berguna jika:

- ada multiple implementation;
- ada boundary architectural;
- ada test seam yang penting;
- ada stable contract;
- ada dependency inversion;
- ada external API/port.

### 7.8.2 Fat Service Contract

Satu interface untuk semua use case module.

### 7.8.3 Marker Interface Abuse

```java
public interface Auditable {}
public interface Validatable {}
public interface Processable {}
```

Marker interface tanpa behavior bisa berguna dalam kasus tertentu, tetapi sering menjadi metadata palsu yang lebih baik diekspresikan dengan annotation, type hierarchy, atau explicit policy.

### 7.8.4 Generic CRUD Interface Everywhere

```java
interface CrudService<T, ID> {
    T create(T t);
    T update(ID id, T t);
    void delete(ID id);
    T get(ID id);
    List<T> list();
}
```

Semua domain dipaksa mengikuti CRUD, padahal workflow domain sering tidak CRUD.

---

## 7.9 ISP Design Review Questions

```text
1. Siapa client interface ini?
2. Apakah semua client memakai semua method?
3. Apakah implementasi harus throw UnsupportedOperationException?
4. Apakah read dan write dipisah?
5. Apakah command use case dan query use case tercampur?
6. Apakah interface dibentuk oleh implementor atau client?
7. Apakah default method menambah konsep inti atau menutupi bloat?
8. Apakah interface ini membuat test lebih mudah atau lebih noisy?
9. Apakah dependency surface terlalu besar untuk permission/security boundary?
```

---

# 8. D — Dependency Inversion Principle

## 8.1 Definisi

DIP biasanya dinyatakan:

```text
High-level modules should not depend on low-level modules.
Both should depend on abstractions.
Abstractions should not depend on details.
Details should depend on abstractions.
```

Makna praktis:

```text
Policy-level code tidak boleh dikendalikan oleh detail-level code.
```

High-level module:

- domain rule;
- use case;
- workflow;
- policy;
- decision logic;
- invariant;
- business capability.

Low-level module:

- database;
- HTTP client;
- message broker;
- framework;
- file system;
- email server;
- external API;
- UI transport;
- serialization format.

DIP mengarahkan dependency dari yang volatile ke yang stable.

---

## 8.2 Bad Dependency Direction

Buruk:

```java
public final class CaseApprovalService {
    private final JdbcTemplate jdbcTemplate;
    private final RestTemplate restTemplate;
    private final JavaMailSender mailSender;

    public void approve(Long caseId) {
        Map<String, Object> row = jdbcTemplate.queryForMap("select * from cases where id = ?", caseId);
        String status = (String) row.get("status");

        if (!"PENDING".equals(status)) {
            throw new IllegalStateException();
        }

        jdbcTemplate.update("update cases set status = 'APPROVED' where id = ?", caseId);
        restTemplate.postForEntity("https://vendor/api/case-approved", row, Void.class);
        mailSender.send(...);
    }
}
```

Use case bergantung langsung pada:

- SQL detail;
- table schema;
- HTTP endpoint;
- email infrastructure;
- framework classes.

Perubahan detail teknis memaksa perubahan use case.

---

## 8.3 Better Dependency Direction

```java
public interface CaseRepository {
    CaseForApproval getForApproval(CaseId id);
    void save(CaseForApproval c);
}

public interface CaseApprovalNotifier {
    void caseApproved(CaseApproved event);
}

public final class ApproveCaseUseCase {
    private final CaseRepository cases;
    private final ApprovalPolicy policy;
    private final CaseApprovalNotifier notifier;

    public void approve(ApproveCaseCommand command) {
        CaseForApproval c = cases.getForApproval(command.caseId());
        policy.check(command.actor(), c);
        CaseApproved event = c.approve(command.remarks(), command.clock());
        cases.save(c);
        notifier.caseApproved(event);
    }
}
```

Infrastructure implements abstraction:

```java
public final class JdbcCaseRepository implements CaseRepository { ... }
public final class HttpCaseApprovalNotifier implements CaseApprovalNotifier { ... }
```

Dependency direction:

```text
Application use case → port/interface
Infrastructure adapter → port/interface
Composition root wires them
```

---

## 8.4 DIP Bukan Sekadar Dependency Injection

DI adalah mekanisme memberi dependency. DIP adalah prinsip arah dependency.

Kode ini memakai constructor injection tetapi belum tentu DIP:

```java
public final class ApproveCaseUseCase {
    private final JdbcCaseRepository repository;

    public ApproveCaseUseCase(JdbcCaseRepository repository) {
        this.repository = repository;
    }
}
```

Use case tetap depend ke concrete infrastructure.

DIP:

```java
public final class ApproveCaseUseCase {
    private final CaseRepository repository;

    public ApproveCaseUseCase(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Tetapi jangan otomatis membuat interface untuk semua class. Interface berguna saat memisahkan policy dari detail volatile.

---

## 8.5 DIP dan Package Direction

DIP bukan hanya type-level. Package dependency juga penting.

Buruk:

```text
com.example.case.domain
  depends on com.example.case.persistence.jpa
  depends on org.springframework.transaction
  depends on jakarta.persistence
```

Domain bergantung pada persistence/framework.

Lebih baik:

```text
com.example.case.domain
  Case
  CaseStatus
  ApprovalPolicy

com.example.case.application
  ApproveCaseUseCase
  CaseRepository port

com.example.case.infrastructure.persistence
  JpaCaseRepository implements CaseRepository
  CaseJpaEntity
```

Dependency:

```text
infrastructure → application/domain
application → domain
application → ports
ports tidak tahu infrastructure
```

---

## 8.6 DIP dan Spring/CDI

Dalam Spring-heavy codebase, mudah terjadi container-dependent design.

Buruk:

```java
@Service
public class CaseDomainService {
    @Autowired
    private ApplicationEventPublisher events;

    @Transactional
    public void approve(CaseEntity entity) { ... }
}
```

Domain service bergantung ke Spring event dan transaction.

Lebih bersih:

```java
public final class CaseApprovalWorkflow {
    public CaseApproved approve(CaseForApproval c, Remarks remarks, Clock clock) {
        return c.approve(remarks, clock);
    }
}
```

Spring wiring hanya di application/infrastructure layer:

```java
@Service
public class SpringApproveCaseHandler {
    private final ApproveCaseUseCase useCase;

    @Transactional
    public void approve(ApproveCaseRequest request) {
        useCase.approve(map(request));
    }
}
```

Framework adalah detail. Bukan core design.

---

## 8.7 DIP dan Configuration

Abstraction bisa bocor lewat config.

Buruk:

```java
public final class EligibilityPolicy {
    @Value("${eligibility.max-age}")
    private int maxAge;
}
```

Domain policy tergantung framework config injection.

Better:

```java
public record EligibilityPolicyConfig(int maxAge, Set<LicenseType> allowedTypes) {}

public final class EligibilityPolicy {
    private final EligibilityPolicyConfig config;

    public EligibilityPolicy(EligibilityPolicyConfig config) {
        this.config = config;
    }
}
```

Infrastructure membaca config, domain menerima value object.

---

## 8.8 DIP Anti-Patterns

### 8.8.1 Interface Everywhere

```text
Every service has an interface only because “DIP”.
```

Jika interface tidak melindungi dari detail volatile, mungkin hanya noise.

### 8.8.2 Framework Leakage

Domain/application penuh annotation framework:

```java
@Entity
@Service
@Transactional
@Cacheable
@Async
@Scheduled
```

Tidak semua annotation buruk. Tetapi jika core logic tidak bisa dipahami tanpa framework lifecycle, DIP lemah.

### 8.8.3 Abstraction Depends on Detail

```java
public interface CaseRepository {
    Page<CaseEntity> find(Pageable pageable);
}
```

Jika `Pageable` adalah Spring Data dan `CaseEntity` adalah JPA entity, port bocor.

Better:

```java
public interface CaseRepository {
    PagedResult<CaseSummary> search(CaseSearchQuery query, PageRequest page);
}
```

### 8.8.4 Service Locator Masquerading as DIP

```java
public class UseCase {
    public void execute() {
        EmailClient email = ServiceLocator.get(EmailClient.class);
    }
}
```

Dependency tersembunyi. Testability buruk.

---

## 8.9 DIP Design Review Questions

```text
1. Module mana yang high-level policy?
2. Module mana yang low-level detail?
3. Apakah policy bergantung pada database/framework/HTTP/message broker?
4. Apakah abstraction berada di sisi pemilik policy atau sisi infrastructure?
5. Apakah interface memakai type dari framework/detail?
6. Apakah dependency eksplisit lewat constructor?
7. Apakah test use case bisa berjalan tanpa container?
8. Apakah package dependency searah?
9. Apakah ada service locator atau static global dependency?
```

---

# 9. SOLID dalam Java 8–25

## 9.1 Java 8: Lambda dan Functional Interface

Java 8 membuat beberapa pattern lebih ringan.

Strategy:

```java
@FunctionalInterface
interface FeeRule {
    BigDecimal apply(Application app);
}
```

Policy composition:

```java
List<EligibilityRule> rules = List.of(
        EligibilityRules.noOutstandingPenalty(),
        EligibilityRules.hasRequiredQualification(),
        EligibilityRules.noActiveSanction()
);
```

Dampak terhadap SOLID:

- OCP bisa dicapai tanpa class explosion;
- ISP lebih mudah dengan single-method interfaces;
- SRP lebih jelas jika lambda diberi nama melalui factory method;
- risiko: lambda inline terlalu panjang dan kehilangan domain name.

---

## 9.2 Java 9: Modules

Java modules membuat boundary lebih eksplisit.

```java
module com.example.case.application {
    exports com.example.case.application.api;
    requires com.example.case.domain;
}
```

Manfaat SOLID:

- DIP bisa ditegakkan di module boundary;
- internal package bisa disembunyikan;
- API surface lebih kecil;
- cyclic dependency lebih mudah dideteksi.

Risiko:

- module terlalu granular;
- framework reflection butuh `opens`;
- modularity palsu jika semua di-export.

---

## 9.3 Java 10: `var`

`var` tidak langsung berkaitan dengan SOLID, tetapi memengaruhi readability.

Baik:

```java
var approvedCase = workflow.approve(caseForApproval, remarks, clock);
```

Buruk:

```java
var result = service.process(data);
```

Jika nama method/type tidak jelas, `var` mengurangi contract visibility.

---

## 9.4 Java 14–17: Records

Records membantu immutable data carrier.

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        Remarks remarks
) {}
```

Dampak SOLID:

- SRP: command hanya membawa intent;
- ISP: use case menerima input spesifik;
- DIP: boundary model bisa bebas framework;
- OCP: record baik untuk stable data contract;
- risiko: record dipakai sebagai universal DTO.

---

## 9.5 Java 17+: Sealed Classes

Sealed classes membantu closed polymorphism.

```java
public sealed interface ApprovalResult
        permits ApprovalResult.Approved, ApprovalResult.Rejected {

    record Approved(CaseId caseId) implements ApprovalResult {}
    record Rejected(String reason) implements ApprovalResult {}
}
```

Dampak SOLID:

- LSP lebih mudah karena subtype controlled;
- OCP tidak selalu open-ended;
- exhaustive switch mengurangi missed case;
- cocok untuk domain alternative yang closed.

---

## 9.6 Java 21–25: Virtual Threads, Scoped Values, Structured Concurrency

Modern concurrency mengubah beberapa design assumption.

Sebelum virtual threads, banyak abstraction dibuat untuk async/reactive karena thread mahal.

Dengan virtual threads:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<ApplicantProfile> profile = executor.submit(() -> profileClient.get(id));
    Future<List<Penalty>> penalties = executor.submit(() -> penaltyClient.findByApplicant(id));

    return eligibilityPolicy.evaluate(profile.get(), penalties.get());
}
```

Design implication:

- tidak semua async callback abstraction masih perlu;
- readability procedural bisa kembali menjadi acceptable;
- DIP tetap penting untuk external clients;
- cancellation/timeout harus tetap explicit;
- ThreadLocal design harus dievaluasi ulang.

Structured concurrency dan scoped values membuat context propagation lebih eksplisit, tetapi jangan membuat domain logic bergantung pada runtime context global.

---

# 10. SOLID dan Design Pattern

SOLID sering menjadi alasan pattern muncul.

| Problem | SOLID Pressure | Pattern yang Mungkin Muncul |
|---|---|---|
| Banyak variasi algorithm | OCP | Strategy, Policy, Specification |
| Object creation kompleks | SRP/OCP | Factory, Builder |
| External API bocor | DIP/SRP | Adapter, Gateway, ACL |
| Banyak client butuh subset API | ISP | Role Interface, Facade |
| Subtype tidak aman | LSP | Composition, Sealed Hierarchy |
| Use case terlalu besar | SRP/DIP | Application Service, Command Handler |
| Workflow status kacau | SRP/OCP/LSP | State, State Machine |
| Side effect tersebar | SRP/DIP | Domain Event, Outbox |

Tetapi pattern bukan bukti SOLID. Pattern bisa juga menjadi anti-pattern jika force-nya tidak ada.

---

# 11. SOLID dalam Enterprise Java Codebase

## 11.1 Controller Layer

Buruk:

```java
@RestController
public class CaseController {
    @PostMapping("/cases/{id}/approve")
    public ResponseEntity<?> approve(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        // parse
        // validate
        // auth
        // load entity
        // change status
        // save
        // audit
        // notify
        return ResponseEntity.ok().build();
    }
}
```

Pelanggaran:

- SRP: controller melakukan banyak hal;
- DIP: controller tahu persistence/workflow detail;
- OCP: variasi approval mengubah controller;
- ISP: request model tidak eksplisit;
- LSP: response/error contract sering tidak stabil.

Better:

```java
@RestController
public class CaseApprovalController {
    private final ApproveCaseUseCase approveCase;

    @PostMapping("/cases/{id}/approve")
    public ResponseEntity<ApproveCaseResponse> approve(
            @PathVariable Long id,
            @RequestBody ApproveCaseHttpRequest request
    ) {
        var command = new ApproveCaseCommand(
                new CaseId(id),
                currentActorId(),
                Remarks.of(request.remarks())
        );

        var result = approveCase.approve(command);
        return ResponseEntity.ok(ApproveCaseResponse.from(result));
    }
}
```

Controller responsibility:

- HTTP mapping;
- request parsing;
- response mapping;
- delegate use case.

---

## 11.2 Service Layer

Bad service:

```java
public class CaseService {
    public void approve(...) { ... }
    public void reject(...) { ... }
    public void assign(...) { ... }
    public void search(...) { ... }
    public void export(...) { ... }
    public void sendReminder(...) { ... }
}
```

Better use case split:

```java
public final class ApproveCaseUseCase { ... }
public final class RejectCaseUseCase { ... }
public final class AssignCaseUseCase { ... }
public final class SearchCasesQuery { ... }
public final class ExportCaseReportUseCase { ... }
```

Namun jangan blindly membuat one class per endpoint. Ukur berdasarkan responsibility dan lifecycle.

---

## 11.3 Repository Layer

Bad repository:

```java
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {
    List<CaseEntity> findByStatus(String status);
    List<CaseEntity> findPendingApprovalForOfficer(...);
    List<CaseEntity> findForDashboard(...);
    List<CaseEntity> findForExport(...);
    List<CaseEntity> findForBatchReminder(...);
}
```

Semua query masuk satu repository. Bisa acceptable untuk kecil, tetapi di module besar menjadi dumping ground.

Better split by read model/use case:

```java
public interface CaseForApprovalRepository {
    CaseForApproval get(CaseId id);
    void save(CaseForApproval c);
}

public interface CaseDashboardQuery {
    PagedResult<CaseDashboardRow> search(CaseDashboardFilter filter, PageRequest page);
}

public interface CaseReminderQuery {
    List<CaseReminderCandidate> dueForReminder(LocalDate date);
}
```

---

## 11.4 External Integration

Bad:

```java
public class EligibilityService {
    private final RestTemplate restTemplate;

    public boolean eligible(String nric) {
        Map response = restTemplate.getForObject(url + nric, Map.class);
        return "Y".equals(response.get("eligible"));
    }
}
```

Better:

```java
public interface ApplicantEligibilityGateway {
    ApplicantEligibility check(ApplicantId applicantId);
}

public final class HttpApplicantEligibilityGateway implements ApplicantEligibilityGateway {
    private final HttpClient client;
    private final EligibilityResponseMapper mapper;

    public ApplicantEligibility check(ApplicantId applicantId) {
        var response = client.get(...);
        return mapper.toDomain(response);
    }
}
```

Use case depends on gateway abstraction, not HTTP detail.

---

# 12. When Violating SOLID Is Rational

Top engineers tidak menerapkan prinsip secara buta. Mereka tahu kapan trade-off berubah.

## 12.1 Small, Stable, Local Code

Jika logic kecil, stabil, dan tidak reusable, abstraction bisa lebih mahal.

```java
if (status == PENDING && actor.isApprover()) {
    approve();
}
```

Tidak selalu perlu Strategy.

## 12.2 Performance-Critical Hot Path

Kadang polymorphism, allocation, indirection, atau abstraction menambah overhead. Jangan premature optimize, tapi untuk hot path yang terbukti, simplicity runtime bisa menang.

## 12.3 Framework Constraint

Framework kadang butuh shape tertentu:

- JPA entity mutable;
- no-args constructor;
- proxyable class;
- annotation placement;
- serialization requirement.

Solusinya bukan menolak framework, tetapi isolasi framework di boundary.

## 12.4 Prototype / Spike

Untuk discovery, design boleh kasar. Tetapi jangan biarkan prototype menjadi production core tanpa refactoring.

## 12.5 One-Off Migration Script

Migration script sekali jalan tidak perlu architecture berlapis. Tetapi tetap perlu safety, logging, idempotency, dan rollback thinking.

---

# 13. SOLID Smell Catalog

## 13.1 SRP Smells

```text
- class > 1000 lines dan banyak dependency
- method melakukan validate + authorize + persist + notify
- nama class Manager/Helper/Util terlalu umum
- test butuh setup banyak hal tidak relevan
- perubahan UI mengubah domain class
- perubahan DB mengubah business rule
```

## 13.2 OCP Smells

```text
- switch/if berdasarkan type tersebar
- setiap variasi baru ubah banyak tempat
- enum ditambah tapi handler lupa
- extension point ada tetapi tetap edit core
- strategy dibuat tetapi factory besar terus berubah
```

## 13.3 LSP Smells

```text
- UnsupportedOperationException dalam implementasi
- caller check concrete type
- subtype mengubah semantic method
- mock return value impossible
- exception berbeda-beda tanpa taxonomy
```

## 13.4 ISP Smells

```text
- interface punya method yang tidak dipakai mayoritas client
- fake implementation throw unsupported
- CRUD interface dipakai untuk workflow domain
- read client depend ke write operation
- default method terlalu banyak
```

## 13.5 DIP Smells

```text
- domain import Spring/JPA/HTTP classes
- application service memakai JdbcTemplate langsung
- abstraction memakai DTO external vendor
- dependency diambil dari static locator
- package dependency cyclic
```

---

# 14. Refactoring Path: Dari Service Berantakan ke SOLID

## 14.1 Starting Point

```java
public class CaseService {
    public void approve(Long caseId, String officerId, String remarks) {
        CaseEntity entity = caseRepository.findById(caseId).orElseThrow();

        if (!entity.getStatus().equals("PENDING_REVIEW")) {
            throw new RuntimeException("Invalid status");
        }

        OfficerEntity officer = officerRepository.findById(officerId).orElseThrow();

        if (!officer.getRoles().contains("APPROVER")) {
            throw new RuntimeException("Forbidden");
        }

        if (remarks == null || remarks.length() > 500) {
            throw new RuntimeException("Invalid remarks");
        }

        entity.setStatus("APPROVED");
        entity.setApprovedBy(officerId);
        entity.setApprovedAt(LocalDateTime.now());
        entity.setRemarks(remarks);

        caseRepository.save(entity);
        auditRepository.save(new AuditEntity("APPROVED", caseId, officerId));
        emailClient.send(entity.getApplicantEmail(), "Approved");
        vendorClient.notifyApproved(entity.getReferenceNo());
    }
}
```

## 14.2 Step 1 — Introduce Command

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        Remarks remarks
) {}
```

Benefit:

- input explicit;
- validation can move to value objects;
- method signature stable;
- easier test fixture.

## 14.3 Step 2 — Extract Value Objects

```java
public record Remarks(String value) {
    public Remarks {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Remarks is required");
        }
        if (value.length() > 500) {
            throw new IllegalArgumentException("Remarks must not exceed 500 characters");
        }
    }
}
```

## 14.4 Step 3 — Extract Policy

```java
public final class ApprovalPolicy {
    public void check(Officer officer, CaseForApproval c) {
        if (!officer.canApprove()) {
            throw new ForbiddenApprovalException(officer.id());
        }
        if (!c.canBeApproved()) {
            throw new InvalidCaseTransitionException(c.id(), c.status(), CaseStatus.APPROVED);
        }
    }
}
```

## 14.5 Step 4 — Move Workflow Behavior

```java
public final class CaseForApproval {
    private final CaseId id;
    private CaseStatus status;
    private ApprovalInfo approvalInfo;

    public CaseApproved approve(OfficerId actorId, Remarks remarks, Instant now) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new InvalidCaseTransitionException(id, status, CaseStatus.APPROVED);
        }
        this.status = CaseStatus.APPROVED;
        this.approvalInfo = new ApprovalInfo(actorId, remarks, now);
        return new CaseApproved(id, actorId, now);
    }
}
```

## 14.6 Step 5 — Introduce Ports

```java
public interface CaseForApprovalRepository {
    CaseForApproval get(CaseId id);
    void save(CaseForApproval c);
}

public interface OfficerDirectory {
    Officer get(OfficerId id);
}

public interface CaseApprovalPublisher {
    void publish(CaseApproved event);
}
```

## 14.7 Step 6 — Use Case Orchestration

```java
public final class ApproveCaseUseCase {
    private final CaseForApprovalRepository cases;
    private final OfficerDirectory officers;
    private final ApprovalPolicy policy;
    private final CaseApprovalPublisher publisher;
    private final Clock clock;

    public void approve(ApproveCaseCommand command) {
        CaseForApproval c = cases.get(command.caseId());
        Officer officer = officers.get(command.actorId());

        policy.check(officer, c);
        CaseApproved event = c.approve(command.actorId(), command.remarks(), clock.instant());

        cases.save(c);
        publisher.publish(event);
    }
}
```

## 14.8 Result

Sekarang:

- SRP: use case orchestration terpisah dari policy, workflow, infra;
- OCP: approval policy bisa divariasikan lebih mudah;
- LSP: ports punya contract jelas;
- ISP: repository/gateway kecil berdasarkan use case;
- DIP: use case depend ke abstraction, bukan infrastructure;
- testing lebih mudah;
- audit/event bisa dikembangkan tanpa mengotori workflow;
- domain invariant lebih eksplisit.

---

# 15. Testing Strategy untuk SOLID Design

## 15.1 SRP Testing

Jika class punya satu responsibility, test-nya fokus.

```java
class ApprovalPolicyTest {
    @Test
    void rejectsOfficerWithoutApproverRole() { ... }

    @Test
    void rejectsCaseNotPendingReview() { ... }
}
```

Jika test harus setup DB, HTTP, email, security, dan clock hanya untuk validasi status, SRP buruk.

## 15.2 OCP Testing

Test stable core sekali, test extension per variasi.

```java
class FeeCalculatorTest {
    @Test
    void delegatesToPolicyMatchingApplicationType() { ... }
}

class RenewalFeePolicyTest {
    @Test
    void calculatesRenewalFee() { ... }
}
```

## 15.3 LSP Contract Test

Buat contract test untuk semua implementasi.

```java
interface DocumentStoreContractTest {
    DocumentStore store();

    @Test
    default void savedDocumentCanBeRead() {
        var doc = new Document(...);
        store().save(doc);
        assertEquals(doc, store().get(doc.id()));
    }
}
```

Setiap implementation menjalankan contract yang sama.

## 15.4 ISP Testing

Jika fake implementation harus throw banyak unsupported, interface terlalu besar.

## 15.5 DIP Testing

Use case test harus bisa jalan tanpa Spring container.

```java
class ApproveCaseUseCaseTest {
    private final InMemoryCaseRepository cases = new InMemoryCaseRepository();
    private final InMemoryOfficerDirectory officers = new InMemoryOfficerDirectory();
    private final RecordingApprovalPublisher publisher = new RecordingApprovalPublisher();

    @Test
    void approvesPendingCase() { ... }
}
```

---

# 16. Observability dan Debugging Angle

SOLID memengaruhi observability.

## 16.1 SRP dan Logging

Jika satu method melakukan semua hal, log menjadi kacau:

```text
approve started
validation failed
email failed
vendor failed
save failed
```

Sulit tahu tahap mana bagian business decision vs technical side effect.

Dengan responsibility jelas:

```text
ApprovalPolicy rejected case
CaseApprovalWorkflow transitioned PENDING_REVIEW -> APPROVED
CaseApprovalPublisher published CaseApproved
HttpVendorNotifier failed retryable=true
```

## 16.2 OCP dan Metrics

Jika variasi behavior berupa policy object, metrics bisa diberi label policy:

```text
eligibility_rule_evaluation_total{rule="noOutstandingPenalty", result="rejected"}
```

## 16.3 LSP dan Error Taxonomy

Contract exception yang konsisten membuat alert lebih bermakna.

## 16.4 ISP dan Trace Boundary

Interface kecil membantu trace span lebih spesifik:

```text
CaseQueryService.search
ApproveCaseUseCase.approve
CaseDocumentUseCase.upload
```

## 16.5 DIP dan Adapter Observability

External API log sebaiknya berada di adapter, bukan domain.

```text
ApplicantEligibilityGateway.check latency=320ms result=temporary_failure
```

---

# 17. SOLID dan Anti-Pattern yang Sering Menyamar Sebagai Best Practice

## 17.1 “Semua Harus Interface”

Bukan SOLID jika interface hanya mirror class.

```java
interface CaseService {}
class CaseServiceImpl implements CaseService {}
```

Gunakan interface untuk boundary, bukan ritual.

## 17.2 “Semua If Harus Strategy”

Tidak semua conditional buruk.

Conditional buruk jika:

- variasi sering bertambah;
- logic tersebar;
- tiap branch kompleks;
- branch punya ownership berbeda;
- test matrix membesar.

Conditional acceptable jika:

- variasi kecil dan closed;
- logic lokal;
- branch jelas;
- sealed/switch exhaustive;
- tidak ada duplication.

## 17.3 “Domain Tidak Boleh Punya Logic”

Ini menghasilkan anemic domain model. Domain object hanya getter/setter, semua rule pindah ke service besar.

## 17.4 “SOLID Berarti Banyak Layer”

Layer bukan tujuan. Boundary adalah tujuan.

## 17.5 “Abstraction Selalu Lebih Baik”

Abstraction punya biaya:

- naming cost;
- navigation cost;
- debugging cost;
- testing cost;
- runtime indirection;
- onboarding cost;
- wrong abstraction lock-in.

---

# 18. Decision Framework: Kapan Menerapkan SOLID Lebih Kuat

Gunakan matrix ini.

| Kondisi | Perlu SOLID Lebih Kuat? | Alasan |
|---|---:|---|
| Logic domain critical | Tinggi | correctness dan auditability penting |
| Banyak variasi rule | Tinggi | OCP/Strategy/Specification berguna |
| External integration volatile | Tinggi | DIP/Adapter/Gateway melindungi core |
| Module kecil dan stabil | Rendah/Sedang | abstraction bisa mahal |
| Prototype cepat | Rendah | discovery lebih penting |
| Public API/library | Tinggi | contract stability penting |
| Hot path performance | Selektif | abstraction harus diukur |
| Banyak tim bekerja paralel | Tinggi | boundary mengurangi conflict |
| Regulatory/audit system | Tinggi | invariant dan traceability penting |
| One-off script | Rendah/Sedang | safety > architecture purity |

---

# 19. Practical Checklist: SOLID Design Review

## 19.1 SRP Checklist

```text
[ ] Class punya satu alasan utama untuk berubah.
[ ] Nama class menjelaskan responsibility.
[ ] Business rule tidak bercampur dengan transport/persistence detail.
[ ] Side effect tidak tersembunyi di tengah decision logic.
[ ] Test class tidak butuh setup banyak dependency tidak relevan.
```

## 19.2 OCP Checklist

```text
[ ] Axis variasi jelas.
[ ] Extension point dibuat karena variasi nyata/probable.
[ ] Stable core tidak berubah untuk setiap variasi baru.
[ ] Unsupported variation ditangani eksplisit.
[ ] Abstraction tidak terlalu generic.
```

## 19.3 LSP Checklist

```text
[ ] Semua subtype memenuhi kontrak supertype.
[ ] Tidak ada unsupported operation tanpa alasan kuat.
[ ] Exception semantics konsisten.
[ ] Mutability expectation konsisten.
[ ] Caller tidak perlu tahu concrete type.
```

## 19.4 ISP Checklist

```text
[ ] Interface dibentuk berdasarkan kebutuhan client.
[ ] Client tidak bergantung pada method yang tidak dipakai.
[ ] Read/write dipisah jika lifecycle berbeda.
[ ] Fake implementation tidak penuh unsupported method.
[ ] Interface tidak sekadar mirror implementation.
```

## 19.5 DIP Checklist

```text
[ ] Policy tidak depend ke detail volatile.
[ ] Domain/application tidak import infrastructure/framework type tanpa alasan kuat.
[ ] Port berada di sisi pemilik policy.
[ ] Adapter bergantung ke port, bukan sebaliknya.
[ ] Use case bisa ditest tanpa container.
```

---

# 20. Staff-Level Discussion Questions

Pertanyaan yang sering membedakan engineer biasa dan engineer senior:

```text
1. Apa alasan perubahan utama class ini?
2. Apakah abstraction ini melindungi perubahan nyata atau hanya spekulasi?
3. Apa kontrak behavioral interface ini?
4. Bagaimana kita tahu semua implementasi memenuhi kontrak itu?
5. Apakah dependency direction mengikuti business policy?
6. Jika external API berubah, bagian mana yang terdampak?
7. Jika rule baru ditambahkan, apakah kita mengubah core atau menambah extension?
8. Jika feature ini gagal di production, apakah observability-nya membantu?
9. Apakah design ini mudah dijelaskan ke engineer baru?
10. Apakah code ini lebih mudah diubah setelah pattern ditambahkan?
```

---

# 21. Common Mistakes Saat Belajar SOLID

## 21.1 Mengira SRP = Class Harus Kecil

Class kecil bisa tetap punya banyak responsibility. Class besar bisa cohesive jika domain concept memang kaya.

## 21.2 Mengira OCP = Tidak Boleh Edit Kode

OCP bukan melarang edit. OCP memilih bagian mana yang stabil dan mana yang extensible.

## 21.3 Mengira LSP = Inheritance Saja

LSP berlaku untuk semua bentuk substitusi: interface, proxy, mock, generic, collection, adapter.

## 21.4 Mengira ISP = Banyak Interface Kecil Tanpa Tujuan

ISP berbasis client need, bukan mechanical splitting.

## 21.5 Mengira DIP = Pakai DI Container

Dependency injection bukan dependency inversion. Container hanya alat wiring.

---

# 22. Worked Example: Eligibility Rules

## 22.1 Procedural Version

```java
public class EligibilityService {
    public EligibilityResult check(Application app) {
        if (app.getApplicantAge() < 18) {
            return EligibilityResult.rejected("Applicant is underage");
        }
        if (app.hasOutstandingPenalty()) {
            return EligibilityResult.rejected("Outstanding penalty");
        }
        if (!app.hasRequiredQualification()) {
            return EligibilityResult.rejected("Missing qualification");
        }
        if (app.getLicenseType().equals("SPECIAL") && !app.hasSpecialApproval()) {
            return EligibilityResult.rejected("Special approval required");
        }
        return EligibilityResult.approved();
    }
}
```

Acceptable jika rule sedikit dan stabil.

Tapi jika rule bertambah terus dan dipakai di banyak flow, OCP/SRP pressure muncul.

## 22.2 Specification Version

```java
@FunctionalInterface
public interface EligibilityRule {
    EligibilityResult evaluate(Application app);
}
```

```java
public final class MinimumAgeRule implements EligibilityRule {
    @Override
    public EligibilityResult evaluate(Application app) {
        return app.applicantAge() >= 18
                ? EligibilityResult.approved()
                : EligibilityResult.rejected("Applicant is underage");
    }
}
```

```java
public final class EligibilityPolicy {
    private final List<EligibilityRule> rules;

    public EligibilityPolicy(List<EligibilityRule> rules) {
        this.rules = List.copyOf(rules);
    }

    public EligibilityResult evaluate(Application app) {
        for (EligibilityRule rule : rules) {
            EligibilityResult result = rule.evaluate(app);
            if (result.isRejected()) {
                return result;
            }
        }
        return EligibilityResult.approved();
    }
}
```

## 22.3 Trade-Off

Manfaat:

- rule mudah ditambah;
- test per rule kecil;
- ordering eksplisit;
- metrics per rule bisa ditambahkan;
- variasi policy bisa dikomposisi.

Biaya:

- lebih banyak class;
- debugging butuh melihat list composition;
- ordering bisa menjadi bug;
- rule terlalu kecil bisa fragmentasi;
- jika rule jarang berubah, ini overengineering.

Decision:

```text
Gunakan rule object jika rule banyak, berubah, reusable, perlu audit, atau perlu observability per rule.
Gunakan conditional biasa jika rule sedikit, lokal, dan stabil.
```

---

# 23. Worked Example: Notification Sender and LSP/ISP

## 23.1 Bad Interface

```java
public interface NotificationSender {
    void sendEmail(EmailMessage message);
    void sendSms(SmsMessage message);
    void sendPush(PushMessage message);
}
```

Email-only implementation:

```java
public final class EmailOnlySender implements NotificationSender {
    public void sendEmail(EmailMessage message) { ... }
    public void sendSms(SmsMessage message) { throw new UnsupportedOperationException(); }
    public void sendPush(PushMessage message) { throw new UnsupportedOperationException(); }
}
```

Pelanggaran:

- ISP: client dipaksa depend ke semua channel;
- LSP: implementation tidak substitutable.

## 23.2 Better Split

```java
public interface EmailSender {
    SendResult send(EmailMessage message);
}

public interface SmsSender {
    SendResult send(SmsMessage message);
}

public interface PushSender {
    SendResult send(PushMessage message);
}
```

Atau generic channel jika contract benar-benar sama:

```java
public interface NotificationChannel<T extends NotificationMessage> {
    SendResult send(T message);
}
```

Hati-hati generic abstraction jika tiap channel punya semantics berbeda.

---

# 24. Worked Example: Repository and DIP

## 24.1 Leaky Repository

```java
public interface CaseRepository {
    Page<CaseEntity> findByStatus(String status, Pageable pageable);
}
```

Masalah:

- `Page`/`Pageable` dari Spring Data bocor;
- `CaseEntity` JPA bocor;
- status string primitive obsession;
- application layer tergantung persistence detail.

## 24.2 Cleaner Port

```java
public interface CaseSearchQuery {
    PagedResult<CaseSummary> search(CaseSearchCriteria criteria, PageRequest page);
}
```

```java
public record PageRequest(int page, int size) {
    public PageRequest {
        if (page < 0) throw new IllegalArgumentException("page must be >= 0");
        if (size <= 0 || size > 200) throw new IllegalArgumentException("invalid size");
    }
}
```

Infrastructure can adapt:

```java
public final class SpringDataCaseSearchQuery implements CaseSearchQuery {
    private final SpringDataCaseJpaRepository repository;

    @Override
    public PagedResult<CaseSummary> search(CaseSearchCriteria criteria, PageRequest page) {
        Pageable pageable = org.springframework.data.domain.PageRequest.of(page.page(), page.size());
        Page<CaseEntity> result = repository.search(criteria.status().name(), pageable);
        return mapper.toPagedResult(result);
    }
}
```

---

# 25. SOLID and Regulatory/Case Management Systems

Untuk sistem regulatory, enforcement, compliance, atau case management, SOLID bukan cosmetic. Ia membantu menjaga:

- auditability;
- explainability;
- defensibility;
- traceability;
- segregation of duty;
- lifecycle correctness;
- rule evolution;
- external integration safety;
- error accountability.

Contoh mapping:

| Concern | SOLID Relevance |
|---|---|
| Approval workflow | SRP, OCP, State Pattern |
| Authorization | SRP, DIP, Policy Object |
| Audit trail | SRP, DIP, Observer/Event |
| External agency API | DIP, Adapter, ACL |
| Eligibility rules | OCP, Specification |
| Case status transition | LSP, State, sealed domain model |
| Officer roles | ISP, security boundary |
| Reporting query | ISP, CQRS-style separation |
| Document handling | SRP, boundary-specific service |

Sistem regulatory sering rusak bukan karena algorithm sulit, tetapi karena rule, status, permission, side effect, dan external dependency bercampur.

---

# 26. Summary Mental Model

SOLID tingkat lanjut bisa diringkas seperti ini:

```text
SRP:
Pisahkan alasan perubahan yang berbeda.
Jangan campur decision, data access, transport, integration, dan side effect tanpa alasan kuat.

OCP:
Buat extension point hanya pada axis variasi yang nyata.
Stable core harus terlindungi dari variasi berulang.

LSP:
Subtype/implementation/proxy/mock harus memenuhi kontrak behavioral.
Compile-time compatibility tidak cukup.

ISP:
Interface dibentuk dari kebutuhan client.
Jangan membuat client tahu operation yang tidak relevan.

DIP:
Policy bergantung pada abstraction yang ia miliki.
Detail bergantung pada policy, bukan policy pada detail.
```

SOLID bukan tujuan akhir. Tujuan akhirnya adalah codebase yang:

- mudah berubah secara aman;
- mudah diuji;
- mudah dijelaskan;
- dependency-nya terkendali;
- invariant-nya jelas;
- failure mode-nya bisa diprediksi;
- extensibility-nya muncul di tempat yang memang berubah;
- tidak tenggelam dalam abstraction palsu.

---

# 27. Final Checklist untuk Part 3

Sebelum lanjut ke creational patterns, pastikan kamu bisa menjawab:

```text
1. Apa perbedaan responsibility dan method count?
2. Kapan class besar masih bisa SRP?
3. Kapan OCP layak diterapkan?
4. Kapan sealed class lebih baik daripada open polymorphism?
5. Apa contoh LSP violation selain inheritance?
6. Kenapa UnsupportedOperationException sering menjadi design smell?
7. Bagaimana membentuk interface dari perspektif client?
8. Apa bedanya DI dan DIP?
9. Kenapa framework annotation bisa melemahkan dependency boundary?
10. Kapan melanggar SOLID bisa menjadi keputusan yang benar?
```

Jika jawabanmu sudah bukan slogan, tetapi berbasis **change, contract, boundary, dependency, dan consequence**, maka kamu sudah memahami SOLID di level yang lebih dekat ke senior/staff engineering.

---

# 28. Hubungan ke Bagian Berikutnya

Bagian berikutnya mulai masuk ke creational pattern:

```text
04-creational-constructor-static-factory-factory-method.md
```

Koneksi dengan Part 3:

- Factory membantu SRP dengan memisahkan construction logic.
- Static factory membantu named creation dan invariant enforcement.
- Factory Method membantu OCP saat variasi creation bertambah.
- Creational pattern bisa menjadi anti-pattern jika hanya menyembunyikan constructor sederhana.

Di Part 4 kita akan membahas object creation sebagai boundary desain, bukan sekadar cara membuat object.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./02-object-design-coupling-cohesion-identity-boundary.md">⬅️ Object Design Fundamentals: Coupling, Cohesion, Identity, and Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./04-creational-constructor-static-factory-factory-method.md">Creational Pattern I: Constructor, Static Factory, Factory Method ➡️</a>
</div>

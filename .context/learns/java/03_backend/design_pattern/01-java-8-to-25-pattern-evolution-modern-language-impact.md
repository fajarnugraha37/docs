# 01 — Java 8 to 25 Pattern Evolution: Modern Language Impact

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `01-java-8-to-25-pattern-evolution-modern-language-impact.md`  
> Level: Advanced / Staff Engineer Track  
> Fokus: bagaimana evolusi Java 8 sampai Java 25 mengubah cara kita memilih, menyederhanakan, mengganti, atau bahkan membuang design pattern klasik.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, targetnya bukan sekadar tahu fitur Java versi baru, tetapi mampu menjawab pertanyaan desain seperti ini:

1. Kapan pattern klasik masih relevan di Java modern?
2. Kapan pattern klasik menjadi boilerplate yang tidak perlu?
3. Bagaimana lambda, records, sealed classes, pattern matching, virtual threads, scoped values, dan structured concurrency mengubah bentuk desain Java?
4. Bagaimana membedakan “modern Java” yang meningkatkan clarity dari “modern Java” yang hanya terlihat keren?
5. Bagaimana membuat keputusan desain yang kompatibel dari Java 8 sampai Java 25?
6. Bagaimana membaca codebase lama dan memutuskan refactor mana yang aman, bernilai, dan tidak sekadar mengikuti tren?

Bagian ini adalah jembatan antara seri Java sebelumnya dengan seri design pattern. Banyak pattern yang dulu lahir karena keterbatasan bahasa. Ketika bahasa berubah, pattern ikut berubah.

---

## 1. Core Thesis

Design pattern bukan fosil. Pattern adalah respons terhadap tekanan desain.

Kalau tekanan desain berubah, bentuk pattern juga berubah.

Di Java 5–7, banyak pattern perlu class eksplisit, interface eksplisit, anonymous class, inheritance, dan factory verbose.

Di Java 8+, beberapa pattern bisa diekspresikan lebih ringan melalui lambda, functional interface, method reference, stream, dan default method.

Di Java 14–17+, records dan sealed classes mulai mengubah cara kita memodelkan data, value, dan hierarchy.

Di Java 21+, virtual threads mengubah asumsi lama tentang blocking, thread pool, callback, dan asynchronous complexity.

Di Java 25, structured concurrency dan scoped values semakin mendorong desain concurrency yang lebih terstruktur, lebih observable, dan lebih mudah dibatalkan secara benar.

Artinya:

```text
Pattern mastery = memahami invariant + force + consequence,
bukan menghafal UML diagram.
```

---

## 2. Kenapa Part Ini Penting

Banyak engineer belajar design pattern dari buku klasik, lalu mengaplikasikannya secara literal:

- setiap algoritma dibuat `Strategy` class;
- setiap object creation dibuat `Factory`;
- setiap variasi dibuat inheritance;
- setiap workflow dibuat abstract base class;
- setiap reusable step dibuat template method;
- setiap cross-cutting concern dibuat annotation;
- setiap async problem dibuat `CompletableFuture` chain;
- setiap context propagation dibuat `ThreadLocal`.

Masalahnya, Java berubah.

Yang dulu perlu pattern besar, sekarang mungkin cukup lambda.

Yang dulu perlu visitor, sekarang mungkin bisa sealed hierarchy + pattern matching.

Yang dulu butuh callback-style async, sekarang mungkin lebih bersih dengan virtual thread dan structured concurrency.

Yang dulu menggunakan `ThreadLocal`, sekarang perlu dievaluasi ulang karena virtual threads dan scoped values mengubah cost model dan reasoning model.

Jadi, pertanyaan senior bukan:

```text
Pattern apa yang bisa saya pakai di sini?
```

Tetapi:

```text
Tekanan desain apa yang sedang terjadi?
Abstraksi apa yang paling murah tetapi cukup kuat?
Fitur Java mana yang membuat pattern ini lebih sederhana?
Fitur Java mana yang justru membuat pattern ini berbahaya bila dipakai sembarangan?
```

---

## 3. Peta Evolusi Java 8 sampai 25 terhadap Pattern

Berikut peta ringkasnya.

| Era | Fitur Penting | Dampak terhadap Pattern |
|---|---|---|
| Java 8 | Lambda, functional interface, stream, default method, Optional | Strategy, Command, Predicate, Callback, Template Method menjadi lebih ringan |
| Java 9 | Module system, private interface methods | Boundary, encapsulation, SPI, API surface lebih eksplisit |
| Java 10 | `var` local variable inference | Readability trade-off dalam fluent/builder/stream-heavy design |
| Java 14–16 | Records | DTO, Value Object, immutable carrier, result object menjadi lebih ringkas |
| Java 15–17 | Sealed classes | Closed polymorphism, state/event/result hierarchy lebih aman |
| Java 16+ | Pattern matching for `instanceof` | Mengurangi casting boilerplate, memengaruhi Visitor/Type Inspection |
| Java 21 | Virtual threads, pattern matching switch, record patterns, sequenced collections | Concurrency design, data-oriented modeling, exhaustive branching |
| Java 25 | Scoped values, structured concurrency preview, primitive patterns preview, stable values preview | Context propagation, concurrent task grouping, cancellation, startup/lazy initialization design |

Catatan penting: tidak semua fitur Java 25 bersifat final. Beberapa masih preview/incubator/experimental. Dalam sistem enterprise, status fitur memengaruhi risk adoption.

---

## 4. Java 8: Lambda Mengubah Strategy, Command, Callback, dan Template Method

### 4.1 Sebelum Java 8: Behavior Butuh Object Verbose

Sebelum Java 8, variasi behavior sering ditulis dengan class eksplisit atau anonymous class.

Contoh Strategy lama:

```java
public interface DiscountPolicy {
    Money apply(Order order);
}

public final class MemberDiscountPolicy implements DiscountPolicy {
    @Override
    public Money apply(Order order) {
        return order.total().multiply(0.10);
    }
}

public final class SeasonalDiscountPolicy implements DiscountPolicy {
    @Override
    public Money apply(Order order) {
        return order.total().multiply(0.15);
    }
}
```

Pemanggil:

```java
DiscountPolicy policy = new MemberDiscountPolicy();
Money discount = policy.apply(order);
```

Ini tetap valid jika behavior memiliki:

- nama domain penting;
- banyak dependency;
- lifecycle;
- state;
- testing khusus;
- observability khusus;
- evolusi terpisah.

Tetapi untuk variasi sederhana, bentuk ini terlalu berat.

---

### 4.2 Setelah Java 8: Strategy Bisa Jadi Functional Interface

```java
@FunctionalInterface
public interface DiscountPolicy {
    Money apply(Order order);
}
```

Usage:

```java
DiscountPolicy memberDiscount = order -> order.total().multiply(0.10);
DiscountPolicy seasonalDiscount = order -> order.total().multiply(0.15);
```

Atau langsung memakai built-in functional interface bila cocok:

```java
Function<Order, Money> discountPolicy = order -> order.total().multiply(0.10);
```

Namun untuk domain penting, custom interface tetap lebih jelas:

```java
@FunctionalInterface
public interface EligibilityRule {
    boolean isSatisfiedBy(Application application);
}
```

Ini lebih komunikatif daripada:

```java
Predicate<Application> rule;
```

Keduanya benar secara teknis, tetapi berbeda secara semantic clarity.

---

### 4.3 Rule of Thumb: Built-in Functional Interface vs Domain Functional Interface

Gunakan built-in interface seperti `Function`, `Predicate`, `Consumer`, `Supplier`, `BiFunction` bila:

- logic bersifat lokal;
- semantic domain tidak terlalu penting;
- tidak perlu nama bisnis eksplisit;
- digunakan untuk operasi generik;
- tidak diekspos sebagai API domain besar.

Gunakan custom functional interface bila:

- nama behavior punya makna domain;
- error contract perlu spesifik;
- perlu dokumentasi invariant;
- akan sering dipakai lintas modul;
- ingin code review bisa membaca maksud bisnis;
- ingin menghindari parameter generic yang terlalu abstrak.

Contoh:

```java
@FunctionalInterface
public interface SanctionEligibilityPolicy {
    boolean canIssueSanction(CaseFile caseFile, OfficerContext officerContext);
}
```

Ini jauh lebih jelas daripada:

```java
BiPredicate<CaseFile, OfficerContext> policy;
```

---

## 5. Lambda dan Anti-Pattern Baru

Lambda menyederhanakan pattern, tetapi juga menciptakan anti-pattern baru.

### 5.1 Anonymous Logic Hidden in Pipeline

Contoh buruk:

```java
cases.stream()
    .filter(c -> c.status() != null && !c.status().equals("CLOSED") &&
                 c.createdAt().isBefore(now.minusDays(30)) &&
                 c.assignedOfficer() != null &&
                 c.priority() >= 3)
    .map(c -> enrich(c, user, config, auditContext))
    .forEach(c -> notify(c, template, smtpClient, retryPolicy));
```

Masalah:

- business rule tersembunyi dalam lambda;
- sulit diberi nama;
- sulit dites terpisah;
- sulit diaudit;
- sulit dijelaskan ke BA/domain expert;
- sulit diobservasi.

Refactor:

```java
EligibilityRule overdueHighPriorityOpenCase = CaseRules.overdueHighPriorityOpenCase(now);

cases.stream()
    .filter(overdueHighPriorityOpenCase::isSatisfiedBy)
    .map(caseEnricher::enrich)
    .forEach(notificationService::notifyOfficer);
```

Dengan rule bernama:

```java
public final class CaseRules {
    public static EligibilityRule overdueHighPriorityOpenCase(Instant now) {
        return caseFile -> !caseFile.isClosed()
            && caseFile.createdAt().isBefore(now.minus(30, ChronoUnit.DAYS))
            && caseFile.hasAssignedOfficer()
            && caseFile.priority().isAtLeast(Priority.HIGH);
    }
}
```

Lebih baik lagi jika rule penting secara audit:

```java
public final class OverdueHighPriorityOpenCaseRule implements EligibilityRule {
    private final Clock clock;

    public OverdueHighPriorityOpenCaseRule(Clock clock) {
        this.clock = clock;
    }

    @Override
    public boolean isSatisfiedBy(CaseFile caseFile) {
        Instant now = clock.instant();
        return !caseFile.isClosed()
            && caseFile.createdAt().isBefore(now.minus(30, ChronoUnit.DAYS))
            && caseFile.hasAssignedOfficer()
            && caseFile.priority().isAtLeast(Priority.HIGH);
    }
}
```

Kenapa class eksplisit kadang lebih baik?

Karena nama class adalah design artifact.

Dalam sistem regulasi, nama rule sering sama pentingnya dengan implementasi rule.

---

### 5.2 Lambda as Hidden Dependency Carrier

Contoh:

```java
CommandHandler handler = command -> {
    userRepository.find(command.userId());
    auditService.record(command);
    emailService.send(command);
};
```

Kelihatannya ringkas, tetapi dependency tersembunyi dari konstruksi object. Sulit melihat dependency graph.

Untuk logic production yang punya dependency serius, lebih baik eksplisit:

```java
public final class ApproveApplicationHandler implements CommandHandler<ApproveApplicationCommand> {
    private final ApplicationRepository applicationRepository;
    private final AuthorizationPolicy authorizationPolicy;
    private final AuditTrail auditTrail;
    private final DomainEventPublisher eventPublisher;

    public ApproveApplicationHandler(
        ApplicationRepository applicationRepository,
        AuthorizationPolicy authorizationPolicy,
        AuditTrail auditTrail,
        DomainEventPublisher eventPublisher
    ) {
        this.applicationRepository = applicationRepository;
        this.authorizationPolicy = authorizationPolicy;
        this.auditTrail = auditTrail;
        this.eventPublisher = eventPublisher;
    }

    @Override
    public void handle(ApproveApplicationCommand command) {
        Application application = applicationRepository.get(command.applicationId());
        authorizationPolicy.ensureCanApprove(command.actor(), application);
        application.approve(command.reason());
        applicationRepository.save(application);
        auditTrail.recordApproval(command.actor(), application);
        eventPublisher.publish(ApplicationApproved.from(application));
    }
}
```

Lambda cocok untuk behavior kecil. Class cocok untuk responsibility yang punya lifecycle, dependency, dan auditability.

---

### 5.3 Lambda and Exception Semantics

Built-in functional interfaces tidak mendukung checked exception secara natural.

Akibatnya sering muncul wrapper seperti:

```java
list.forEach(item -> {
    try {
        externalClient.send(item);
    } catch (IOException e) {
        throw new RuntimeException(e);
    }
});
```

Ini bisa menjadi anti-pattern jika:

- semua error dijadikan `RuntimeException` tanpa taxonomy;
- retryability hilang;
- business failure dan technical failure bercampur;
- caller tidak tahu error contract.

Alternatif:

```java
public interface ExternalDeliveryAction {
    DeliveryResult deliver(DeliveryRequest request);
}
```

Atau:

```java
public final class DeliveryService {
    public DeliveryResult deliver(DeliveryRequest request) {
        try {
            externalClient.send(request);
            return DeliveryResult.success(request.id());
        } catch (SocketTimeoutException e) {
            return DeliveryResult.retryableFailure(request.id(), e);
        } catch (IOException e) {
            return DeliveryResult.technicalFailure(request.id(), e);
        }
    }
}
```

Design lesson:

```text
Lambda mengurangi boilerplate, tetapi tidak boleh menghapus semantic contract.
```

---

## 6. Default Methods: Extension Point atau Trap?

Java 8 memperkenalkan default method di interface. Ini berguna untuk backward-compatible API evolution.

Contoh:

```java
public interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);

    default CaseFile getRequired(CaseId id) {
        return findById(id).orElseThrow(() -> new CaseNotFoundException(id));
    }
}
```

Manfaat:

- bisa menambah method tanpa memaksa semua implementasi berubah;
- bisa menaruh behavior kecil yang benar-benar universal;
- bisa menjaga API ergonomics.

Tetapi default method bisa menjadi trap.

Contoh buruk:

```java
public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);

    default PaymentResult chargeWithRetry(PaymentRequest request) {
        for (int i = 0; i < 3; i++) {
            PaymentResult result = charge(request);
            if (result.success()) return result;
        }
        return PaymentResult.failed();
    }
}
```

Masalah:

- retry policy tersembunyi di interface;
- tidak ada backoff;
- tidak tahu idempotent atau tidak;
- semua gateway dipaksa memakai policy sama;
- observability lemah.

Lebih baik:

```java
public final class RetryingPaymentGateway implements PaymentGateway {
    private final PaymentGateway delegate;
    private final RetryPolicy retryPolicy;

    public RetryingPaymentGateway(PaymentGateway delegate, RetryPolicy retryPolicy) {
        this.delegate = delegate;
        this.retryPolicy = retryPolicy;
    }

    @Override
    public PaymentResult charge(PaymentRequest request) {
        return retryPolicy.execute(() -> delegate.charge(request));
    }
}
```

Design lesson:

```text
Default method baik untuk universal convenience.
Default method buruk untuk policy yang punya risk, dependency, atau environment-specific behavior.
```

---

## 7. Optional: Boundary Pattern, Bukan Field Modeling Default

`Optional<T>` sering disalahgunakan.

Good usage:

```java
Optional<User> findById(UserId id);
```

Ini menyatakan query bisa tidak menemukan data.

Bad usage:

```java
public class User {
    private Optional<String> middleName;
}
```

Kenapa bermasalah?

- `Optional` dirancang terutama sebagai return type;
- field Optional menambah noise;
- serialization/persistence bisa bermasalah;
- domain semantics kurang eksplisit.

Untuk domain penting, lebih baik pakai model eksplisit.

```java
public record PersonName(
    String firstName,
    String middleName,
    String lastName
) {
    public boolean hasMiddleName() {
        return middleName != null && !middleName.isBlank();
    }
}
```

Atau jika absence punya makna domain:

```java
sealed interface MiddleName permits MiddleName.Present, MiddleName.Absent {
    record Present(String value) implements MiddleName {}
    enum Absent implements MiddleName { INSTANCE }
}
```

Jangan gunakan `Optional` sebagai pengganti domain modeling.

---

## 8. Stream: Behavioral Pipeline atau Obscurity Engine?

Stream adalah fitur kuat, tetapi sering disalahgunakan.

### 8.1 Stream Cocok Untuk Transformasi Data yang Linear

```java
List<CaseSummary> summaries = cases.stream()
    .filter(CaseFile::isOpen)
    .sorted(comparing(CaseFile::createdAt).reversed())
    .map(CaseSummary::from)
    .toList();
```

Ini jelas karena pipeline-nya linear:

```text
filter -> sort -> map -> collect
```

### 8.2 Stream Buruk Untuk Workflow Mutatif

```java
cases.stream()
    .filter(CaseFile::isOpen)
    .peek(caseFile -> auditTrail.recordViewed(caseFile))
    .peek(caseFile -> caseFile.assignTo(officer))
    .peek(caseFile -> repository.save(caseFile))
    .forEach(caseFile -> notificationService.notifyAssigned(caseFile));
```

Masalah:

- `peek` disalahgunakan;
- side effect tersebar;
- transaction boundary tidak jelas;
- error handling tidak eksplisit;
- urutan efek samping tersembunyi.

Lebih baik:

```java
for (CaseFile caseFile : cases) {
    if (!caseFile.isOpen()) {
        continue;
    }

    assignmentService.assign(caseFile, officer);
}
```

Atau:

```java
List<CaseFile> openCases = cases.stream()
    .filter(CaseFile::isOpen)
    .toList();

assignmentService.assignAll(openCases, officer);
```

Design lesson:

```text
Stream bagus untuk data transformation.
Workflow dengan side effect sering lebih jelas dengan explicit control flow.
```

---

## 9. Java 9 Modules: Boundary Bukan Hanya Package Convention

Sebelum module system, Java boundary sering hanya convention:

```text
com.company.case.domain
com.company.case.application
com.company.case.infrastructure
```

Tetapi semua `public` class tetap bisa diakses oleh module lain dalam classpath yang sama.

Java Platform Module System memperkenalkan `module-info.java`:

```java
module com.company.case.management {
    exports com.company.case.api;
    exports com.company.case.application;

    requires com.company.common;
    requires java.sql;
}
```

Boundary menjadi lebih eksplisit:

- package yang tidak di-export tidak bisa dipakai dari luar module;
- dependency module dinyatakan jelas;
- API surface lebih terkendali;
- internal implementation lebih terlindungi.

Pattern impact:

1. Facade menjadi lebih formal.
2. API package menjadi kontrak nyata.
3. Internal adapter bisa disembunyikan.
4. SPI bisa dimodelkan dengan `uses` dan `provides`.
5. Architecture enforcement bisa dilakukan oleh compiler, bukan hanya code review.

Contoh SPI:

```java
module com.company.notification.api {
    exports com.company.notification;
    uses com.company.notification.NotificationProvider;
}
```

Provider:

```java
module com.company.notification.smtp {
    requires com.company.notification.api;
    provides com.company.notification.NotificationProvider
        with com.company.notification.smtp.SmtpNotificationProvider;
}
```

Design lesson:

```text
Package memberi organisasi.
Module memberi enforceable boundary.
```

Namun module system tidak otomatis membuat desain baik. Jika boundary salah, module hanya membuat salahnya lebih kaku.

---

## 10. Java 10 `var`: Readability Trade-Off

`var` bukan dynamic typing. Type tetap statis, hanya di-infer oleh compiler.

Good:

```java
var summaries = caseRepository.findOpenCases().stream()
    .map(CaseSummary::from)
    .toList();
```

Bad:

```java
var result = service.process(input);
```

Jika `process` tidak jelas, `var` menurunkan readability.

Lebih buruk:

```java
var x = factory.create(config);
```

Apa tipe `x`? Apa contract-nya? Apa lifecycle-nya?

Guideline:

Gunakan `var` ketika RHS jelas:

```java
var now = Instant.now(clock);
var caseId = CaseId.from(rawId);
var request = new CreateCaseRequest(...);
```

Hindari `var` ketika RHS abstrak:

```java
var handler = registry.resolve(command.type());
var result = client.execute(request);
var strategy = policyFactory.create(context);
```

Pada design pattern, nama type sering merupakan bagian dari komunikasi desain. Jangan sembunyikan type jika type tersebut membawa makna arsitektural.

---

## 11. Records: DTO, Value Object, Result Object, dan Data-Oriented Modeling

Records mengurangi boilerplate untuk immutable data carrier.

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
    }
}
```

Record memberikan:

- final fields;
- canonical constructor;
- accessor;
- `equals`;
- `hashCode`;
- `toString`;
- structural representation.

### 11.1 Record as DTO

```java
public record CaseSummaryResponse(
    String caseId,
    String status,
    String assignedOfficer,
    Instant createdAt
) {}
```

Bagus untuk output boundary.

### 11.2 Record as Command

```java
public record ApproveApplicationCommand(
    ApplicationId applicationId,
    OfficerId officerId,
    String reason
) {
    public ApproveApplicationCommand {
        Objects.requireNonNull(applicationId);
        Objects.requireNonNull(officerId);
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("Approval reason is required");
        }
    }
}
```

Bagus jika command immutable dan simple.

### 11.3 Record as Value Object

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        amount = amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
    }
}
```

Record bisa memiliki behavior. Record bukan hanya DTO.

---

### 11.4 Record Anti-Pattern: Careless Data Dump

```java
public record CaseRecord(
    String id,
    String status,
    String type,
    String createdBy,
    String updatedBy,
    String payload,
    String metadata,
    String remarks,
    String internalFlag,
    String externalFlag
) {}
```

Ini mungkin hanya memindahkan anemic model ke syntax baru.

Pertanyaan review:

- Apakah field punya invariant?
- Apakah string harus menjadi domain primitive?
- Apakah status harus enum/sealed type?
- Apakah payload harus model eksplisit?
- Apakah record ini crossing boundary atau domain concept?
- Apakah semua field perlu diketahui caller?

Modern syntax tidak otomatis membuat desain modern.

---

## 12. Sealed Classes: Closed Hierarchy dan Exhaustiveness

Sealed classes/interfaces memungkinkan kita membatasi implementasi.

```java
public sealed interface ApplicationDecision
    permits ApplicationDecision.Approved,
            ApplicationDecision.Rejected,
            ApplicationDecision.PendingClarification {

    record Approved(OfficerId approvedBy, Instant approvedAt) implements ApplicationDecision {}
    record Rejected(OfficerId rejectedBy, String reason) implements ApplicationDecision {}
    record PendingClarification(String question) implements ApplicationDecision {}
}
```

Manfaat:

- hierarchy tertutup;
- semua alternatif diketahui;
- lebih cocok untuk domain outcome;
- mendukung exhaustive switch;
- mengurangi invalid subclass;
- meningkatkan maintainability.

### 12.1 Sealed Hierarchy untuk Result

```java
public sealed interface SubmitResult permits SubmitResult.Accepted, SubmitResult.Rejected, SubmitResult.Duplicate {
    record Accepted(ApplicationId id) implements SubmitResult {}
    record Rejected(List<ValidationError> errors) implements SubmitResult {}
    record Duplicate(ApplicationId existingId) implements SubmitResult {}
}
```

Consumer:

```java
String message = switch (result) {
    case SubmitResult.Accepted accepted -> "Accepted: " + accepted.id();
    case SubmitResult.Rejected rejected -> "Rejected: " + rejected.errors();
    case SubmitResult.Duplicate duplicate -> "Duplicate: " + duplicate.existingId();
};
```

Jika nanti menambah `RequiresManualReview`, compiler bisa membantu menemukan switch yang belum lengkap.

---

### 12.2 Sealed vs Enum

Gunakan enum jika setiap state tidak membawa data khusus:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Gunakan sealed hierarchy jika alternatif membawa data berbeda:

```java
public sealed interface ReviewOutcome {
    record Approved(OfficerId officerId, Instant approvedAt) implements ReviewOutcome {}
    record Rejected(OfficerId officerId, RejectionReason reason) implements ReviewOutcome {}
    record NeedClarification(List<Question> questions) implements ReviewOutcome {}
}
```

Enum menjawab:

```text
Apa label statusnya?
```

Sealed hierarchy menjawab:

```text
Apa bentuk valid dari outcome ini dan data wajib setiap bentuknya?
```

---

### 12.3 Sealed Anti-Pattern: Closing What Must Be Open

Sealed hierarchy buruk jika extension harus dilakukan oleh pihak luar.

Contoh buruk:

```java
public sealed interface PaymentProvider permits VisaProvider, MasterCardProvider {}
```

Jika sistem harus mendukung plugin provider baru dari module lain, sealed malah menghambat.

Gunakan sealed untuk domain alternatives yang memang bounded dan dikontrol pemilik domain.

Gunakan interface biasa atau SPI untuk extension eksternal.

---

## 13. Pattern Matching: Mengurangi Boilerplate, Tapi Bukan Izin Membuat Type Switch Everywhere

Pattern matching for `instanceof` menghapus casting manual:

Sebelum:

```java
if (event instanceof ApplicationApproved) {
    ApplicationApproved approved = (ApplicationApproved) event;
    handleApproved(approved);
}
```

Sesudah:

```java
if (event instanceof ApplicationApproved approved) {
    handleApproved(approved);
}
```

Pattern matching switch lebih kuat:

```java
return switch (event) {
    case ApplicationApproved approved -> handleApproved(approved);
    case ApplicationRejected rejected -> handleRejected(rejected);
    case ApplicationSubmitted submitted -> handleSubmitted(submitted);
};
```

### 13.1 Visitor vs Pattern Matching

Visitor klasik cocok ketika:

- object structure stabil;
- operasi baru sering ditambahkan;
- ingin double dispatch;
- ingin behavior eksternal tanpa mengubah object.

Pattern matching cocok ketika:

- hierarchy sealed/tertutup;
- operasi tidak terlalu banyak;
- branching lebih jelas daripada visitor boilerplate;
- data-oriented modeling lebih natural.

Contoh sealed + switch:

```java
public sealed interface NotificationCommand {
    record SendEmail(String to, String subject, String body) implements NotificationCommand {}
    record SendSms(String phoneNumber, String message) implements NotificationCommand {}
    record SendInbox(UserId userId, String message) implements NotificationCommand {}
}

public final class NotificationDispatcher {
    public void dispatch(NotificationCommand command) {
        switch (command) {
            case NotificationCommand.SendEmail email -> emailClient.send(email.to(), email.subject(), email.body());
            case NotificationCommand.SendSms sms -> smsClient.send(sms.phoneNumber(), sms.message());
            case NotificationCommand.SendInbox inbox -> inboxService.create(inbox.userId(), inbox.message());
        }
    }
}
```

Ini lebih sederhana daripada visitor untuk kasus kecil.

Tetapi jika dispatch logic tersebar di banyak tempat, hati-hati.

Anti-pattern:

```java
switch (command) { ... } // di dispatcher
switch (command) { ... } // di validator
switch (command) { ... } // di auditor
switch (command) { ... } // di serializer
switch (command) { ... } // di permission checker
```

Jika banyak switch paralel, mungkin behavior harus dipindah ke object, visitor, atau handler registry.

---

## 14. Switch Expression: Decision Table Ringan

Switch expression membuat branching lebih ekspresif.

```java
public Duration slaFor(CasePriority priority) {
    return switch (priority) {
        case LOW -> Duration.ofDays(14);
        case MEDIUM -> Duration.ofDays(7);
        case HIGH -> Duration.ofDays(3);
        case CRITICAL -> Duration.ofHours(24);
    };
}
```

Bagus untuk mapping stabil.

Tetapi buruk untuk rule kompleks:

```java
return switch (caseFile.status()) {
    case SUBMITTED -> {
        if (caseFile.hasMissingDocuments()) yield Action.REQUEST_DOCUMENTS;
        if (caseFile.isHighRisk()) yield Action.ESCALATE;
        yield Action.ASSIGN_REVIEWER;
    }
    case UNDER_REVIEW -> {
        if (caseFile.isOverdue()) yield Action.ESCALATE;
        yield Action.CONTINUE_REVIEW;
    }
    default -> Action.NONE;
};
```

Jika logic mulai bercabang berdasarkan banyak dimensi, pertimbangkan:

- Specification;
- Rule Object;
- State Machine;
- Policy;
- Decision Table eksplisit;
- Workflow model.

Switch expression bukan pengganti domain model.

---

## 15. Data-Oriented Programming in Java Modern

Java modern membuka gaya desain yang lebih data-oriented:

- records untuk data immutable;
- sealed interfaces untuk alternatif tertutup;
- pattern matching untuk deconstruction/branching;
- switch expression untuk exhaustive handling.

Contoh:

```java
public sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase {}

public record SubmitCase(CaseId caseId, OfficerId submittedBy) implements CaseCommand {}
public record ApproveCase(CaseId caseId, OfficerId approvedBy, String reason) implements CaseCommand {}
public record RejectCase(CaseId caseId, OfficerId rejectedBy, String reason) implements CaseCommand {}
```

Handler:

```java
public void handle(CaseCommand command) {
    switch (command) {
        case SubmitCase submit -> submit(submit);
        case ApproveCase approve -> approve(approve);
        case RejectCase reject -> reject(reject);
    }
}
```

Ini berbeda dari classic OO di mana masing-masing command mungkin punya method `execute()`.

Classic OO:

```java
public interface CaseCommand {
    void execute(CaseContext context);
}
```

Data-oriented:

```java
public sealed interface CaseCommand permits SubmitCase, ApproveCase, RejectCase {}
```

Kapan data-oriented bagus?

- command/event/result hanya data intent;
- handler butuh dependency eksternal;
- ingin separation antara intent dan execution;
- ingin serialization mudah;
- ingin exhaustive handling.

Kapan classic OO bagus?

- behavior memang milik object;
- invariant harus dijaga dekat data;
- polymorphism mengurangi switch paralel;
- object punya lifecycle dan state transition.

Top engineer tidak fanatik OO atau data-oriented. Ia memilih berdasarkan ownership behavior.

---

## 16. Virtual Threads: Mengubah Cost Model Concurrency Pattern

Java 21 memperkenalkan virtual threads sebagai fitur final. Virtual threads adalah lightweight threads yang menurunkan effort untuk menulis, memelihara, dan men-debug aplikasi concurrent high-throughput.

Sebelum virtual threads, server Java sering menghindari blocking karena OS thread mahal.

Akibatnya muncul banyak desain:

- callback chain;
- reactive pipeline;
- event loop;
- async client everywhere;
- `CompletableFuture` composition;
- custom thread pool tuning;
- backpressure framework complexity.

Virtual threads mengubah sebagian asumsi itu.

### 16.1 Old Mental Model

```text
Blocking call = mahal
Thread per request = tidak scalable
Async callback = perlu untuk throughput tinggi
```

### 16.2 New Mental Model

```text
Blocking style bisa scalable jika thread-nya virtual dan blocking operation compatible.
Thread per task/request menjadi masuk akal untuk banyak workload IO-bound.
Concurrency tetap butuh limit, timeout, cancellation, dan resource control.
```

Contoh:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<UserProfile> profile = executor.submit(() -> userClient.fetchProfile(userId));
    Future<List<Order>> orders = executor.submit(() -> orderClient.fetchOrders(userId));

    return new UserDashboard(profile.get(), orders.get());
}
```

Ini lebih mudah dibaca daripada nested callback.

Namun jangan salah paham: virtual threads bukan pengganti resilience pattern.

Tetap perlu:

- timeout;
- bounded external resource;
- connection pool sizing;
- rate limit;
- cancellation;
- observability;
- bulkhead;
- idempotency.

Virtual threads membuat thread murah. Mereka tidak membuat database connection, remote API quota, memory, dan downstream capacity menjadi murah.

---

## 17. Virtual Threads dan Pattern yang Berubah

### 17.1 Thread Pool Pattern

Sebelum:

```java
ExecutorService executor = Executors.newFixedThreadPool(100);
```

Banyak tuning dilakukan karena platform thread mahal.

Dengan virtual threads:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

Tapi jangan unlimited concurrency ke dependency eksternal.

Buruk:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request request : requests) {
        executor.submit(() -> externalApi.call(request));
    }
}
```

Jika `requests` berisi 100.000 item, external API bisa kolaps.

Lebih baik:

```java
Semaphore limit = new Semaphore(100);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request request : requests) {
        executor.submit(() -> {
            limit.acquire();
            try {
                return externalApi.call(request);
            } finally {
                limit.release();
            }
        });
    }
}
```

Atau gunakan bulkhead/rate limiter abstraction.

Design lesson:

```text
Virtual thread solves thread scarcity, not dependency capacity.
```

---

### 17.2 Async Pattern Reassessment

Sebelum:

```java
CompletableFuture<User> userFuture = userClient.fetchUserAsync(id);
CompletableFuture<Account> accountFuture = accountClient.fetchAccountAsync(id);

return userFuture.thenCombine(accountFuture, Dashboard::new)
    .orTimeout(2, TimeUnit.SECONDS);
```

Dengan virtual thread, sering lebih jelas:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var userFuture = executor.submit(() -> userClient.fetchUser(id));
    var accountFuture = executor.submit(() -> accountClient.fetchAccount(id));

    return new Dashboard(userFuture.get(), accountFuture.get());
}
```

Tetapi ini belum sempurna karena cancellation/error propagation manual masih perlu hati-hati. Di sinilah structured concurrency relevan.

---

## 18. Structured Concurrency: Concurrency sebagai Scope, Bukan Thread Tersebar

Structured concurrency memperlakukan beberapa task concurrent yang saling terkait sebagai satu unit kerja. Tujuannya:

- error handling lebih rapi;
- cancellation lebih jelas;
- reliability meningkat;
- observability lebih baik;
- child task tidak “bocor” setelah parent selesai.

Mental model:

```text
Jika sebuah request mem-fork beberapa subtask,
semua subtask harus selesai, gagal, atau dibatalkan dalam scope request itu.
```

Tanpa structured concurrency, mudah terjadi orphan task.

Contoh anti-pattern:

```java
public Dashboard dashboard(UserId userId) {
    executor.submit(() -> auditService.recordAccess(userId));
    executor.submit(() -> recommendationService.refresh(userId));
    return dashboardRepository.load(userId);
}
```

Masalah:

- task bisa tetap berjalan setelah request gagal;
- error hilang;
- cancellation tidak ada;
- observability terpecah;
- tidak jelas siapa owner task.

Structured concurrency membuat task ownership eksplisit.

Pseudo-style:

```java
try (var scope = StructuredTaskScope.open()) {
    var user = scope.fork(() -> userClient.fetch(userId));
    var orders = scope.fork(() -> orderClient.fetch(userId));
    var risk = scope.fork(() -> riskClient.assess(userId));

    scope.join();

    return new Dashboard(user.get(), orders.get(), risk.get());
}
```

Catatan: API structured concurrency di Java 25 masih preview, sehingga production adoption perlu memperhatikan flag preview, vendor support, dan lifecycle API.

Design impact:

- mengurangi `CompletableFuture` spaghetti;
- membuat fan-out/fan-in lebih eksplisit;
- cancellation menjadi bagian desain;
- scope menjadi boundary observability;
- request context bisa lebih aman jika dipadukan dengan scoped values.

---

## 19. Scoped Values: Context Propagation yang Lebih Terstruktur

ThreadLocal sering dipakai untuk request context:

```java
public final class RequestContextHolder {
    private static final ThreadLocal<RequestContext> CURRENT = new ThreadLocal<>();

    public static void set(RequestContext context) {
        CURRENT.set(context);
    }

    public static RequestContext get() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Masalah ThreadLocal:

- mudah lupa `remove()`;
- context bisa bocor antar request dalam thread pool;
- sulit reasoning dalam async flow;
- mutable context berbahaya;
- virtual threads mengubah cost dan usage pattern;
- inheritance propagation sering membingungkan.

Scoped values memungkinkan sharing immutable data dalam scope tertentu ke callees dan child threads.

Conceptual style:

```java
private static final ScopedValue<RequestContext> REQUEST_CONTEXT = ScopedValue.newInstance();

public Response handle(Request request) {
    RequestContext context = RequestContext.from(request);

    return ScopedValue.where(REQUEST_CONTEXT, context)
        .call(() -> applicationService.handle(request));
}
```

Callee:

```java
public void recordAudit(AuditEvent event) {
    RequestContext context = REQUEST_CONTEXT.get();
    auditSink.write(event.withCorrelationId(context.correlationId()));
}
```

Design benefit:

- context immutable;
- lifetime bounded by lexical scope;
- lebih mudah reason daripada ThreadLocal;
- cocok dengan virtual threads dan structured concurrency;
- mengurangi leak risk.

Tetapi jangan menjadikan scoped values sebagai global dependency baru.

Anti-pattern:

```java
public final class BusinessRules {
    public boolean canApprove(Application application) {
        OfficerContext officer = OFFICER_CONTEXT.get();
        return officer.hasRole("APPROVER") && application.isSubmitted();
    }
}
```

Jika authorization context adalah dependency utama rule, lebih baik eksplisit:

```java
public boolean canApprove(OfficerContext officer, Application application) {
    return officer.hasRole(Role.APPROVER) && application.isSubmitted();
}
```

Scoped values cocok untuk ambient technical context:

- correlation id;
- trace context;
- tenant id jika benar-benar request-bound;
- locale;
- request deadline;
- security subject pada framework boundary dengan hati-hati.

Tidak cocok untuk menyembunyikan dependency domain penting.

---

## 20. Stable Values dan Lazy Initialization Pattern

Java 25 memperkenalkan Stable Values sebagai preview feature. Secara konseptual, stable values ditujukan untuk object yang diinisialisasi paling banyak sekali dan diperlakukan sebagai stable setelah itu.

Ini beririsan dengan pattern lama:

- lazy initialization;
- singleton holder;
- memoization;
- supplier caching;
- double-checked locking;
- initialization-on-demand holder idiom.

Pattern lama:

```java
public final class ExpensiveResourceHolder {
    private volatile ExpensiveResource resource;

    public ExpensiveResource get() {
        ExpensiveResource current = resource;
        if (current == null) {
            synchronized (this) {
                current = resource;
                if (current == null) {
                    current = new ExpensiveResource();
                    resource = current;
                }
            }
        }
        return current;
    }
}
```

Masalah:

- mudah salah;
- volatile/synchronized reasoning sulit;
- error handling initialization kompleks;
- lifecycle unclear.

Di Java modern, jangan otomatis membuat lazy initialization manual. Pertimbangkan:

1. Apakah resource benar-benar mahal?
2. Apakah eager initialization cukup baik?
3. Apakah DI container sudah mengelola lifecycle?
4. Apakah initialization failure harus fail-fast?
5. Apakah lazy justru menyembunyikan error sampai runtime kritis?
6. Apakah preview feature boleh dipakai di environment production?

Design lesson:

```text
Lazy initialization adalah lifecycle pattern, bukan sekadar performance trick.
```

---

## 21. Pattern yang Menjadi Lebih Ringan di Java Modern

### 21.1 Strategy

Dulu:

```java
public final class HighRiskPolicy implements RiskPolicy {
    @Override
    public RiskLevel assess(Application app) { ... }
}
```

Sekarang bisa:

```java
RiskPolicy policy = app -> app.score() > 80 ? RiskLevel.HIGH : RiskLevel.NORMAL;
```

Tetapi class eksplisit tetap unggul jika policy penting.

---

### 21.2 Command

Dulu command sering punya `execute()`:

```java
interface Command {
    void execute();
}
```

Modern enterprise sering lebih baik memisahkan intent dan handler:

```java
public record ApproveCaseCommand(CaseId caseId, OfficerId officerId, String reason) {}

public final class ApproveCaseHandler {
    public void handle(ApproveCaseCommand command) { ... }
}
```

Kenapa?

- command immutable;
- handler punya dependency;
- command serializable;
- command bisa divalidasi;
- command bisa diaudit;
- command bisa masuk queue.

---

### 21.3 DTO

Dulu:

```java
public class CaseSummaryDto {
    private String id;
    private String status;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
```

Modern:

```java
public record CaseSummaryDto(String id, String status) {}
```

Lebih ringkas, immutable, dan jelas.

---

### 21.4 Visitor

Untuk hierarchy kecil dan tertutup, visitor bisa diganti sealed + switch.

Dulu:

```java
interface DecisionVisitor<R> {
    R visit(Approved approved);
    R visit(Rejected rejected);
}
```

Modern:

```java
return switch (decision) {
    case Approved approved -> renderApproved(approved);
    case Rejected rejected -> renderRejected(rejected);
};
```

Tetapi visitor masih relevan jika operasi sering ditambah dan object structure stabil.

---

### 21.5 Builder

Record mengurangi kebutuhan builder untuk object kecil.

Tidak perlu:

```java
UserRequest request = UserRequest.builder()
    .id(id)
    .name(name)
    .email(email)
    .build();
```

Jika cukup:

```java
UserRequest request = new UserRequest(id, name, email);
```

Builder tetap relevan jika:

- banyak optional parameter;
- ada staged construction;
- object construction butuh readability tinggi;
- ada validation kompleks;
- ingin fluent API;
- ingin kompatibilitas API.

---

## 22. Pattern yang Tetap Relevan

Beberapa pattern tidak hilang karena mereka menyelesaikan design force fundamental.

### 22.1 Adapter

Selama ada boundary antara model internal dan eksternal, Adapter tetap relevan.

```java
public final class OneMapAddressLookupAdapter implements AddressLookupGateway {
    private final OneMapClient client;

    @Override
    public Address lookup(PostalCode postalCode) {
        OneMapResponse response = client.search(postalCode.value());
        return toDomainAddress(response);
    }
}
```

Lambda tidak menggantikan boundary translation.

---

### 22.2 Facade

Selama subsystem kompleks perlu disederhanakan untuk caller, Facade tetap relevan.

```java
public final class CaseSubmissionFacade {
    public SubmitResult submit(SubmitCaseCommand command) {
        // orchestrates validation, authorization, persistence, audit, event publication
    }
}
```

---

### 22.3 Specification

Rule domain tetap butuh nama, komposisi, dan testability.

```java
Specification<Application> eligibleForFastTrack =
    submitted()
        .and(lowRisk())
        .and(noOutstandingDocuments());
```

---

### 22.4 State Machine

Records dan sealed classes membantu modeling, tetapi tidak menggantikan state transition rules.

```java
stateMachine.transition(caseFile, Event.APPROVE, actor);
```

Invariant transition tetap perlu desain eksplisit.

---

### 22.5 Outbox, Inbox, Saga, Idempotency

Fitur bahasa tidak menghilangkan distributed system failure.

Virtual threads tidak membuat dual-write aman.

Records tidak membuat event delivery exactly once.

Sealed classes tidak menggantikan idempotency key.

---

## 23. Pattern yang Sering Menjadi Obsolete atau Berkurang Nilainya

### 23.1 Verbose Strategy Class untuk Logic Satu Baris

Jika variasinya kecil, lambda cukup.

Buruk:

```java
public final class SortByCreatedDateDescending implements Comparator<CaseFile> {
    @Override
    public int compare(CaseFile a, CaseFile b) {
        return b.createdAt().compareTo(a.createdAt());
    }
}
```

Lebih baik:

```java
Comparator<CaseFile> byCreatedDateDescending =
    comparing(CaseFile::createdAt).reversed();
```

---

### 23.2 DTO Boilerplate Class

Records menggantikan banyak DTO mutable.

---

### 23.3 Utility Class for Simple Function Composition

Buruk:

```java
public final class StringTransformers {
    public static String normalize(String input) { ... }
    public static String clean(String input) { ... }
    public static String sanitize(String input) { ... }
}
```

Kadang cukup:

```java
UnaryOperator<String> normalize = input -> input.trim().toLowerCase(Locale.ROOT);
```

Namun jika domain penting, tetap beri nama type/method eksplisit.

---

### 23.4 Callback Hell untuk IO-bound Concurrency

Virtual threads dan structured concurrency membuat banyak callback-style async menjadi tidak perlu untuk server-side IO orchestration.

---

### 23.5 Manual Type Hierarchy Boilerplate

Sealed + records bisa menggantikan banyak class hierarchy verbose.

---

## 24. Compatibility Strategy: Library, Product, Enterprise App

Tidak semua codebase bisa langsung memakai Java 25.

Pertimbangkan matrix berikut.

| Context | Baseline Java | Strategy |
|---|---:|---|
| Legacy enterprise app | 8/11 | Gunakan pattern klasik, functional interface secara hati-hati, hindari fitur baru |
| Modern Spring Boot service | 17/21 | Records, sealed classes, switch expression, virtual threads bisa dipertimbangkan |
| Internal platform library | 17+ | Jaga API compatibility, hindari preview feature untuk public API |
| Experimental service | 25 | Bisa eksplor scoped values/structured concurrency dengan risk control |
| Regulated system | 17/21 LTS umum | Utamakan stability, auditability, testability, operational maturity |

Design rule:

```text
Fitur bahasa yang bagus secara teknis belum tentu cocok sebagai public contract.
```

Contoh: memakai preview feature di public API dapat menciptakan migration risk.

---

## 25. Decision Framework: Memilih Pattern di Java Modern

Gunakan pertanyaan berikut.

### 25.1 Apakah variasi behavior penting secara domain?

Jika ya:

- beri nama eksplisit;
- gunakan Strategy/Policy/Specification class;
- test secara terpisah;
- dokumentasikan invariant.

Jika tidak:

- lambda/method reference cukup.

---

### 25.2 Apakah object membawa identity atau hanya value?

Jika hanya value:

- pertimbangkan record;
- pastikan invariant di compact constructor;
- hindari mutable setter.

Jika identity/lifecycle:

- gunakan class biasa;
- desain behavior dan invariant;
- hati-hati dengan equality.

---

### 25.3 Apakah hierarchy terbuka atau tertutup?

Jika tertutup:

- sealed interface/class cocok;
- switch bisa exhaustive;
- result/event/outcome bisa lebih aman.

Jika terbuka:

- interface biasa;
- SPI;
- plugin architecture;
- registry.

---

### 25.4 Apakah concurrency adalah parallel subtasks dalam satu request?

Jika ya:

- structured concurrency cocok;
- virtual threads dapat menyederhanakan blocking IO;
- cancellation dan timeout harus eksplisit.

Jika background processing independen:

- job queue;
- scheduler;
- message broker;
- worker lifecycle.

Jangan gunakan request-scoped structured concurrency untuk pekerjaan yang seharusnya durable asynchronous.

---

### 25.5 Apakah context benar-benar ambient?

Jika context hanya technical request metadata:

- scoped values bisa cocok.

Jika context adalah dependency domain:

- passing eksplisit lebih baik.

---

## 26. Refactoring Playbook: Dari Java Lama ke Java Modern

### 26.1 Anonymous Class ke Lambda

Before:

```java
Collections.sort(cases, new Comparator<CaseFile>() {
    @Override
    public int compare(CaseFile a, CaseFile b) {
        return a.createdAt().compareTo(b.createdAt());
    }
});
```

After:

```java
cases.sort(comparing(CaseFile::createdAt));
```

Risk rendah jika logic simple.

---

### 26.2 Mutable DTO ke Record

Before:

```java
public class CaseSummary {
    private String id;
    private String status;

    public CaseSummary(String id, String status) {
        this.id = id;
        this.status = status;
    }

    public String getId() { return id; }
    public String getStatus() { return status; }
}
```

After:

```java
public record CaseSummary(String id, String status) {}
```

Check:

- serialization compatibility;
- framework support;
- property naming;
- reflection usage;
- equals/hashCode semantics;
- mutability expectation.

---

### 26.3 Status Enum + Scattered Data ke Sealed Outcome

Before:

```java
public class Decision {
    private DecisionStatus status;
    private String rejectionReason;
    private Instant approvedAt;
    private OfficerId approvedBy;
}
```

Masalah:

- field invalid combination mungkin terjadi;
- `rejectionReason` ada meskipun approved;
- `approvedAt` null saat rejected;
- invariant tersebar.

After:

```java
public sealed interface Decision permits Approved, Rejected, PendingClarification {}

public record Approved(OfficerId approvedBy, Instant approvedAt) implements Decision {}
public record Rejected(OfficerId rejectedBy, String reason) implements Decision {}
public record PendingClarification(List<Question> questions) implements Decision {}
```

Manfaat:

- invalid state lebih sulit dibuat;
- setiap outcome membawa data wajibnya sendiri;
- switch exhaustive.

---

### 26.4 CompletableFuture Spaghetti ke Structured Scope

Before:

```java
return userClient.fetchAsync(userId)
    .thenCompose(user ->
        orderClient.fetchAsync(userId)
            .thenApply(orders -> new Dashboard(user, orders)))
    .exceptionally(ex -> fallbackDashboard(userId));
```

Problem:

- error handling global;
- cancellation tidak jelas;
- nested composition;
- timeout sering terlupakan;
- stack trace sulit.

After conceptual:

```java
try (var scope = StructuredTaskScope.open()) {
    var user = scope.fork(() -> userClient.fetch(userId));
    var orders = scope.fork(() -> orderClient.fetch(userId));

    scope.join();
    return new Dashboard(user.get(), orders.get());
}
```

Catatan: sesuaikan dengan status API dan policy production.

---

## 27. Anti-Pattern Modern Java

### 27.1 Record Everywhere

Tidak semua class harus record.

Record buruk untuk:

- entity dengan identity kompleks;
- mutable lifecycle object;
- object dengan invariant yang berubah sepanjang waktu;
- object yang equality-nya bukan structural;
- JPA entity tradisional;
- framework proxy yang butuh no-arg constructor/mutability.

---

### 27.2 Lambda Everything

Lambda buruk jika:

- behavior penting tidak punya nama;
- dependency tersembunyi;
- error contract kabur;
- testability turun;
- auditability turun.

---

### 27.3 Stream Everything

Stream buruk untuk:

- workflow mutatif;
- complex branching;
- checked exception heavy logic;
- debugging step-by-step yang penting;
- performance-sensitive hot path tanpa profiling.

---

### 27.4 Sealed Everything

Sealed buruk jika:

- extension harus terbuka;
- plugin provider eksternal dibutuhkan;
- module ownership tidak jelas;
- hierarchy sering berubah oleh tim berbeda.

---

### 27.5 Virtual Thread as Infinite Concurrency

Virtual thread bukan lisensi membuat concurrency tak terbatas.

Tetap batasi:

- DB connections;
- HTTP client pool;
- downstream API rate;
- memory;
- CPU-bound task;
- queue size.

---

### 27.6 Scoped Value as New Global State

Scoped value lebih aman dari ThreadLocal untuk banyak kasus, tetapi masih bisa menjadi dependency tersembunyi bila digunakan sembarangan.

---

## 28. Enterprise Design Examples

### 28.1 Authorization Policy

Poor modern code:

```java
Predicate<Application> canApprove = app ->
    CurrentUser.get().roles().contains("APPROVER") && app.status().equals("SUBMITTED");
```

Masalah:

- role string;
- global context;
- rule tidak bernama;
- status string;
- sulit audit.

Better:

```java
public final class ApprovalAuthorizationPolicy {
    public void ensureCanApprove(Officer officer, Application application) {
        if (!officer.hasPermission(Permission.APPROVE_APPLICATION)) {
            throw new AccessDeniedException("Officer cannot approve application");
        }
        if (!application.isSubmitted()) {
            throw new InvalidApplicationStateException(application.id(), application.status());
        }
    }
}
```

Modern Java can improve model:

```java
public sealed interface ApplicationState {
    record Draft() implements ApplicationState {}
    record Submitted(Instant submittedAt) implements ApplicationState {}
    record Approved(OfficerId approvedBy, Instant approvedAt) implements ApplicationState {}
    record Rejected(OfficerId rejectedBy, String reason) implements ApplicationState {}
}
```

But policy tetap explicit.

---

### 28.2 Result Modeling

Poor:

```java
public class SubmitResponse {
    public boolean success;
    public String errorCode;
    public String applicationId;
}
```

Invalid combinations:

- `success=true` but `errorCode != null`;
- `success=false` but `applicationId != null`;
- `success=false` without reason.

Better:

```java
public sealed interface SubmitApplicationResult {
    record Accepted(ApplicationId applicationId) implements SubmitApplicationResult {}
    record ValidationFailed(List<ValidationError> errors) implements SubmitApplicationResult {}
    record DuplicateSubmission(ApplicationId existingApplicationId) implements SubmitApplicationResult {}
}
```

Consumer:

```java
return switch (result) {
    case Accepted accepted -> Response.accepted(accepted.applicationId());
    case ValidationFailed failed -> Response.badRequest(failed.errors());
    case DuplicateSubmission duplicate -> Response.conflict(duplicate.existingApplicationId());
};
```

---

### 28.3 External API Integration

Poor:

```java
public Address lookup(String postalCode) {
    OneMapResponse response = restTemplate.getForObject(url + postalCode, OneMapResponse.class);
    return new Address(response.getBlkNo(), response.getRoadName(), response.getPostal());
}
```

Better design:

```java
public interface AddressLookupGateway {
    AddressLookupResult lookup(PostalCode postalCode);
}

public final class OneMapAddressLookupGateway implements AddressLookupGateway {
    private final OneMapClient client;
    private final OneMapResponseMapper mapper;
    private final RetryPolicy retryPolicy;

    @Override
    public AddressLookupResult lookup(PostalCode postalCode) {
        return retryPolicy.execute(() -> {
            OneMapResponse response = client.search(postalCode.value());
            return mapper.toResult(response);
        });
    }
}
```

Records/sealed help result modeling:

```java
public sealed interface AddressLookupResult {
    record Found(Address address) implements AddressLookupResult {}
    record NotFound(PostalCode postalCode) implements AddressLookupResult {}
    record TemporarilyUnavailable(String reason) implements AddressLookupResult {}
}
```

---

## 29. Staff-Level Review Questions

Gunakan pertanyaan ini saat melihat desain Java modern.

### 29.1 Untuk Lambda/Functional Interface

1. Apakah behavior ini cukup kecil untuk lambda?
2. Apakah nama domain hilang jika memakai `Function`/`Predicate`?
3. Apakah dependency tersembunyi dalam closure?
4. Apakah error contract masih jelas?
5. Apakah test akan lebih mudah atau lebih sulit?
6. Apakah logic ini perlu audit/explanation?

### 29.2 Untuk Record

1. Apakah object ini benar-benar value/data carrier?
2. Apakah structural equality benar?
3. Apakah invariant dijaga di constructor?
4. Apakah field primitive/string seharusnya domain primitive?
5. Apakah framework mendukung record?
6. Apakah record dipakai sebagai entity padahal lifecycle-nya kompleks?

### 29.3 Untuk Sealed Class

1. Apakah hierarchy memang closed?
2. Siapa owner semua permitted subclasses?
3. Apakah extension eksternal diperlukan?
4. Apakah exhaustive switch memberi manfaat?
5. Apakah sealed justru mengunci desain terlalu dini?

### 29.4 Untuk Pattern Matching

1. Apakah switch lebih jelas daripada polymorphism?
2. Apakah ada switch paralel di banyak tempat?
3. Apakah branching berdasarkan type adalah domain reality atau smell?
4. Apakah operation lebih sering berubah daripada type?
5. Apakah visitor masih lebih tepat?

### 29.5 Untuk Virtual Threads

1. Apakah workload IO-bound?
2. Apakah blocking operation compatible?
3. Apakah downstream capacity dibatasi?
4. Apakah timeout/cancellation jelas?
5. Apakah context propagation aman?
6. Apakah CPU-bound task salah ditempatkan di virtual thread flood?

### 29.6 Untuk Scoped Values

1. Apakah context immutable?
2. Apakah context request-scoped?
3. Apakah dependency domain disembunyikan?
4. Apakah scope lifetime jelas?
5. Apakah cocok dengan structured concurrency?

---

## 30. Migration Strategy by Java Baseline

### 30.1 Jika Codebase Masih Java 8

Prioritas:

1. Gunakan lambda untuk mengurangi anonymous class.
2. Gunakan functional interface untuk Strategy kecil.
3. Gunakan `Optional` hanya sebagai return boundary.
4. Hindari stream kompleks dengan side effect.
5. Perkuat domain class dan package boundary.
6. Jangan memaksakan modern pattern yang butuh records/sealed.

### 30.2 Jika Codebase Java 11

Prioritas:

1. Manfaatkan `var` secara selektif.
2. Rapikan module/package boundary meskipun belum memakai JPMS penuh.
3. Siapkan migration DTO ke record saat naik Java 17+.
4. Kurangi reflection magic yang akan menyulitkan strong encapsulation.

### 30.3 Jika Codebase Java 17

Prioritas:

1. Records untuk DTO/value object.
2. Sealed classes untuk result/outcome/state hierarchy.
3. Pattern matching `instanceof` untuk mengurangi casting.
4. Switch expression untuk mapping stabil.
5. Evaluasi ulang visitor/DTO/builder boilerplate.

### 30.4 Jika Codebase Java 21

Prioritas:

1. Virtual threads untuk IO-bound request handling dengan guardrails.
2. Pattern matching switch untuk sealed hierarchy.
3. Record patterns untuk data decomposition jika cocok.
4. Sequenced collections untuk API yang butuh first/last semantics.
5. Evaluasi async complexity yang bisa disederhanakan.

### 30.5 Jika Codebase Java 25

Prioritas:

1. Scoped values untuk request-scoped immutable context.
2. Structured concurrency untuk fan-out/fan-in request task.
3. Stable values untuk lazy initialization setelah risk assessment.
4. Hindari preview feature di public API kecuali ada governance kuat.
5. Dokumentasikan adoption decision.

---

## 31. Pattern Decision Record Template

Gunakan template ini saat mengadopsi fitur Java modern untuk mengganti pattern lama.

```markdown
# Pattern Decision Record: [Judul]

## Context
Apa masalah desain yang sedang terjadi?

## Existing Design
Bagaimana implementasi saat ini?

## Design Forces
- Change frequency:
- Runtime cost:
- Testability:
- Compatibility:
- Team familiarity:
- Operational risk:
- Auditability:

## Options
1. Tetap pattern lama
2. Refactor ke fitur Java modern
3. Hybrid

## Decision
Pilihan yang diambil.

## Consequences
Apa manfaat dan biaya desain ini?

## Failure Modes
Bagaimana desain ini bisa rusak?

## Migration Plan
Langkah aman refactoring.

## Rollback Plan
Bagaimana kembali jika bermasalah?
```

---

## 32. Deep Mental Model: Pattern is Compression

Pattern adalah compression dari pengalaman desain.

Misalnya “Strategy” mengompresi ide:

```text
Ada behavior yang berubah,
tetapi caller ingin stabil.
Maka behavior dijadikan object/interface.
```

Java 8 membuat compression itu lebih kecil:

```java
Predicate<Application> rule
```

Tetapi compression yang terlalu tinggi bisa kehilangan makna:

```java
Function<A, B> f
```

Top engineer tahu kapan code perlu eksplisit.

Kadang class 40 baris lebih baik daripada lambda 1 baris, jika class itu membawa nama, invariant, dependency, audit trail, dan ownership.

Kadang lambda 1 baris lebih baik daripada 5 class strategy, jika variasinya lokal dan tidak punya makna domain besar.

---

## 33. Deep Mental Model: Syntax Changes Cost, Not Reality

Fitur bahasa mengubah biaya ekspresi.

Contoh:

- Lambda menurunkan biaya behavior injection.
- Records menurunkan biaya immutable carrier.
- Sealed classes menurunkan biaya closed hierarchy.
- Pattern matching menurunkan biaya safe type branching.
- Virtual threads menurunkan biaya blocking concurrency.
- Scoped values menurunkan biaya scoped context propagation.
- Structured concurrency menurunkan biaya task ownership/cancellation.

Tetapi fitur bahasa tidak mengubah realitas berikut:

- external systems fail;
- requirements berubah;
- domain invariant tetap harus dijaga;
- auditability tetap perlu desain;
- observability tidak muncul otomatis;
- distributed transaction tetap sulit;
- database connection tetap terbatas;
- team cognitive load tetap nyata.

Maka rumusnya:

```text
Modern Java lowers expression cost.
It does not eliminate design responsibility.
```

---

## 34. Common Misconceptions

### 34.1 “Lambda makes Strategy obsolete.”

Salah. Lambda membuat Strategy ringan. Strategy tetap konsep penting.

### 34.2 “Records are only DTO.”

Salah. Records bisa menjadi value object dengan invariant dan behavior.

### 34.3 “Sealed classes replace enums.”

Salah. Enum tetap cocok untuk constant set tanpa data berbeda.

### 34.4 “Pattern matching replaces polymorphism.”

Salah. Pattern matching dan polymorphism menyelesaikan masalah berbeda.

### 34.5 “Virtual threads mean reactive is dead.”

Salah. Reactive masih relevan untuk stream processing, backpressure-heavy systems, event-driven pipelines, dan ekosistem tertentu. Virtual threads mengurangi kebutuhan async callback untuk banyak server-side IO orchestration.

### 34.6 “Scoped values replace all ThreadLocal.”

Salah. Scoped values cocok untuk immutable scoped context. ThreadLocal masih punya tempat, tetapi harus dipakai lebih hati-hati.

### 34.7 “Modern syntax equals better design.”

Salah. Modern syntax bisa membuat bad design terlihat elegan.

---

## 35. Summary

Java 8 sampai Java 25 mengubah cara design pattern diekspresikan, tetapi tidak menghapus kebutuhan berpikir desain.

Hal paling penting:

1. Lambda membuat Strategy, Command, Callback, dan small Policy lebih ringan.
2. Functional interface harus dipilih berdasarkan semantic clarity, bukan hanya ringkas.
3. Default method cocok untuk universal convenience, bukan hidden policy.
4. Optional cocok sebagai boundary return type, bukan default field modeling.
5. Stream cocok untuk data transformation, bukan workflow mutatif kompleks.
6. Java modules membuat boundary lebih enforceable.
7. `var` harus digunakan tanpa mengorbankan design readability.
8. Records mengurangi boilerplate DTO/value object, tetapi bukan pengganti domain modeling.
9. Sealed classes cocok untuk closed alternatives seperti result, event, decision, outcome, dan state.
10. Pattern matching mengurangi boilerplate branching, tetapi tidak boleh menjadi type-switch abuse.
11. Virtual threads menyederhanakan banyak IO-bound concurrency, tetapi tidak menghapus capacity planning.
12. Structured concurrency membuat concurrent subtask ownership lebih jelas.
13. Scoped values memberi model context propagation yang lebih terstruktur daripada ThreadLocal untuk banyak kasus.
14. Pattern klasik tetap relevan jika design force-nya tetap ada.
15. Top engineer memahami kapan fitur Java modern mengurangi ceremony, dan kapan ceremony justru diperlukan untuk clarity, auditability, dan correctness.

---

## 36. Practical Checklist

Sebelum memakai fitur Java modern untuk mengganti pattern klasik, tanyakan:

```text
[ ] Apakah fitur ini mengurangi boilerplate tanpa mengurangi semantic clarity?
[ ] Apakah invariant tetap eksplisit?
[ ] Apakah error contract tetap jelas?
[ ] Apakah behavior penting masih punya nama?
[ ] Apakah boundary lebih kuat atau malah bocor?
[ ] Apakah testing menjadi lebih mudah?
[ ] Apakah observability tetap tersedia?
[ ] Apakah team memahami fitur ini?
[ ] Apakah runtime dan framework mendukungnya?
[ ] Apakah fitur ini final, preview, incubator, atau experimental?
[ ] Apakah public API akan terikat pada fitur yang belum stabil?
[ ] Apakah refactoring bisa dilakukan bertahap?
```

---

## 37. References

Sumber resmi dan rujukan teknis yang relevan:

1. Oracle Java Tutorials — Lambda Expressions and Functional Interfaces  
   `https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html`
2. Oracle Technical Article — Java 8 Lambdas  
   `https://www.oracle.com/technical-resources/articles/java/architect-lambdas-part1.html`
3. Oracle Java SE 21 Documentation — Virtual Threads  
   `https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html`
4. Oracle Java SE 21 Documentation — Language Changes  
   `https://docs.oracle.com/en/java/javase/21/language/java-language-changes.html`
5. Oracle Java SE 25 Documentation — Significant Changes in JDK 25  
   `https://docs.oracle.com/en/java/javase/25/migrate/significant-changes-jdk-25.html`
6. Oracle Java SE 25 Documentation — Structured Concurrency  
   `https://docs.oracle.com/en/java/javase/25/core/structured-concurrency.html`
7. OpenJDK JDK 25 Project Page  
   `https://openjdk.org/projects/jdk/25/`
8. OpenJDK JEP 505 — Structured Concurrency, Fifth Preview  
   `https://openjdk.org/jeps/505`
9. OpenJDK JEP 506 — Scoped Values  
   `https://openjdk.org/jeps/506`

---

## 38. Closing Note

Bagian ini adalah fondasi untuk membaca ulang semua pattern klasik dengan lensa Java modern.

Mulai Part 2, kita masuk ke object design fundamental: coupling, cohesion, identity, boundary, mutability, collaboration graph, connascence, dan cara melihat desain object bukan sebagai class diagram, tetapi sebagai sistem responsibility yang hidup.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./00-pattern-thinking-design-force-tradeoff-mental-model.md">⬅️ 0. Executive Summary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./02-object-design-coupling-cohesion-identity-boundary.md">Object Design Fundamentals: Coupling, Cohesion, Identity, and Boundaries ➡️</a>
</div>

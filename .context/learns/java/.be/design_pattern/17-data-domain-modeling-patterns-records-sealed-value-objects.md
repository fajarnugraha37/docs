# 17 — Data and Domain Modeling Patterns with Modern Java

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: 17 dari 35  
> File: `17-data-domain-modeling-patterns-records-sealed-value-objects.md`  
> Target: Java 8 sampai Java 25  
> Fokus: entity, value object, records, sealed hierarchy, null object, Optional boundary, domain primitive, type-safe ID, dan anti-pattern data modeling

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan **entity**, **value object**, **DTO**, **domain primitive**, **identifier**, dan **domain event payload** secara tajam.
2. Menentukan kapan sebuah konsep domain harus dimodelkan sebagai primitive, value object, record, class mutable, entity, enum, sealed hierarchy, atau polymorphic type.
3. Menggunakan fitur Java modern seperti `record`, `sealed interface`, `sealed class`, `pattern matching`, dan `switch expression` untuk membuat model domain yang lebih eksplisit.
4. Menghindari anti-pattern seperti **primitive obsession**, **stringly typed domain**, **anemic domain object**, **record-as-careless-DTO**, **entity leaking persistence concern**, dan **universal model**.
5. Mendesain model domain yang aman untuk validation, authorization, auditability, persistence, API compatibility, dan evolusi requirement.
6. Membaca codebase Java enterprise dan menemukan masalah modeling yang menyebabkan bug, duplicated validation, hidden coupling, dan invalid state.
7. Membuat model yang cukup fleksibel tanpa jatuh ke overengineering.

---

## 2. Kenapa Data Modeling Ini Sangat Penting?

Banyak engineer mengira design pattern adalah tentang class diagram seperti:

```text
Strategy
Factory
Observer
Visitor
Decorator
```

Padahal di sistem enterprise nyata, banyak kerusakan desain justru berasal dari **model data/domain yang salah**.

Contoh sederhana:

```java
public void approve(String caseId, String status, String officerId, String reason) {
    if (caseId == null || caseId.isBlank()) throw new IllegalArgumentException();
    if (status == null || status.isBlank()) throw new IllegalArgumentException();
    if (officerId == null || officerId.isBlank()) throw new IllegalArgumentException();
    // ...
}
```

Kode seperti ini terlihat normal, tetapi menyimpan banyak masalah:

1. `caseId`, `officerId`, dan `reason` sama-sama `String`, padahal maknanya berbeda.
2. Compiler tidak bisa mencegah parameter tertukar.
3. Validation tersebar di banyak method.
4. Status hanya string, sehingga status ilegal baru ketahuan saat runtime.
5. Reason tidak punya semantic constraint.
6. Tidak jelas mana data input, mana state domain, mana audit metadata.
7. Tidak jelas invariant apa yang harus selalu benar.

Bug serius sering bukan karena algoritma rumit, tetapi karena model mengizinkan state yang tidak seharusnya ada.

Model buruk membuat invalid state mudah dibuat.

Model baik membuat invalid state sulit atau mustahil dibuat.

Itu inti dari domain modeling.

---

## 3. Mental Model Utama

### 3.1 Model Bukan Sekadar Struktur Data

Model domain bukan hanya tempat menyimpan field.

Model domain adalah **kontrak semantik**.

Sebuah model menjawab:

```text
Apa konsep ini?
Apa identitasnya?
Apa invariant-nya?
Apa yang boleh berubah?
Apa yang tidak boleh berubah?
Apa boundary penggunaannya?
Apa konsekuensi jika data ini salah?
```

Contoh:

```java
String amount;
```

Ini bukan model. Ini hanya storage.

Lebih baik:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > 2) {
            throw new IllegalArgumentException("Money scale must not exceed 2");
        }
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("Money must not be negative");
        }
    }
}
```

Sekarang konsep `Money` punya makna:

1. Harus punya amount.
2. Harus punya currency.
3. Tidak boleh negatif.
4. Precision dibatasi.
5. Tidak bisa tertukar dengan `String`, `BigDecimal`, atau `Integer` biasa.

### 3.2 Model Adalah Mesin Pembatas Kemungkinan

Design yang baik bukan membuat semua hal mungkin.

Design yang baik membuat hal yang benar menjadi mudah, dan hal yang salah menjadi sulit.

Contoh buruk:

```java
caseRecord.setStatus("APROVED"); // typo
```

Contoh lebih baik:

```java
caseRecord.transitionTo(CaseStatus.APPROVED);
```

Contoh lebih kuat:

```java
caseRecord.approve(ApprovalDecision.by(officerId, reason));
```

Contoh paling defensible:

```java
ApprovalResult result = caseWorkflow.approve(
    CaseId.of("CASE-2026-0001"),
    OfficerId.of("OFF-001"),
    ApprovalReason.of("All eligibility checks passed")
);
```

Bukan berarti semua sistem harus se-ekspresif itu. Tetapi semakin tinggi risiko domain, semakin besar manfaat model yang eksplisit.

### 3.3 Primitive Adalah Detail Teknis, Domain Primitive Adalah Konsep

`String`, `long`, `int`, `BigDecimal`, `LocalDate` adalah primitive/convenience type di level bahasa/library.

Tetapi domain tidak bicara dalam bahasa:

```text
String
BigDecimal
LocalDate
Integer
UUID
```

Domain bicara dalam bahasa:

```text
CaseId
OfficerId
PostalCode
Money
ApplicationNumber
ViolationCode
LicenceNumber
EffectiveDate
ExpiryDate
AssessmentScore
RiskLevel
```

Top engineer melihat perbedaan ini dengan cepat.

---

## 4. Entity vs Value Object

### 4.1 Entity

Entity adalah object yang dikenali dari **identity**, bukan hanya atributnya.

Contoh:

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private final ApplicantId applicantId;
    private final List<CaseNote> notes;

    public CaseFile(CaseId id, ApplicantId applicantId) {
        this.id = Objects.requireNonNull(id);
        this.applicantId = Objects.requireNonNull(applicantId);
        this.status = CaseStatus.DRAFT;
        this.notes = new ArrayList<>();
    }

    public CaseId id() {
        return id;
    }

    public CaseStatus status() {
        return status;
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        this.status = CaseStatus.SUBMITTED;
    }
}
```

Dua `CaseFile` dengan `id` sama dianggap merepresentasikan case yang sama, walaupun field lain berubah.

Entity punya karakteristik:

1. Memiliki identity stabil.
2. Bisa berubah sepanjang lifecycle.
3. Punya behavior yang menjaga invariant.
4. Biasanya punya persistence representation.
5. Biasanya punya audit/history.
6. Tidak seharusnya dibandingkan hanya berdasarkan semua field.

### 4.2 Value Object

Value object dikenali dari **nilai**, bukan identity.

Contoh:

```java
public record PostalCode(String value) {
    public PostalCode {
        Objects.requireNonNull(value);
        if (!value.matches("\\d{6}")) {
            throw new IllegalArgumentException("Postal code must be exactly 6 digits");
        }
    }
}
```

Dua `PostalCode("123456")` adalah sama karena nilainya sama.

Value object punya karakteristik:

1. Tidak punya identity domain sendiri.
2. Immutable.
3. Equality berdasarkan value.
4. Aman dibagikan.
5. Cocok untuk konsep seperti Money, EmailAddress, PostalCode, DateRange, CasePeriod.
6. Bisa memuat validation dan small behavior.

### 4.3 Kesalahan Umum

Kesalahan umum adalah menjadikan semua hal sebagai entity karena memakai database table.

Contoh:

```java
@Entity
public class Address {
    @Id
    private Long id;
    private String line1;
    private String postalCode;
}
```

Apakah `Address` entity? Belum tentu.

Pertanyaannya:

```text
Apakah address punya lifecycle sendiri?
Apakah address punya identity yang penting secara domain?
Apakah address berubah secara independen?
Apakah dua address dengan field sama harus dianggap sama atau berbeda?
Apakah address perlu diaudit sendiri?
```

Jika tidak, address mungkin lebih cocok sebagai value object/embeddable.

---

## 5. DTO vs Domain Model vs Persistence Model

### 5.1 Jangan Campur Semua Model

Di codebase enterprise, sering muncul satu class yang dipakai untuk semuanya:

```java
public class CaseDto {
    public String id;
    public String status;
    public String applicantName;
    public String createdBy;
    public String createdDate;
    public String updatedBy;
    public String updatedDate;
    public String approvalReason;
    public String internalRemark;
    public String externalReference;
}
```

Lalu class ini dipakai untuk:

1. Request API.
2. Response API.
3. Persistence mapping.
4. Domain logic.
5. Excel export.
6. Audit log.
7. Event payload.
8. UI form.

Ini biasanya menjadi **universal model anti-pattern**.

Masalahnya:

1. Field menjadi nullable karena semua use case berbeda.
2. Validation menjadi conditional chaos.
3. Sensitive field mudah bocor ke API.
4. Persistence concern bocor ke UI.
5. UI change memecahkan domain.
6. Domain change memecahkan API compatibility.
7. Test sulit karena object terlalu besar.

### 5.2 Pisahkan Berdasarkan Boundary

Model berbeda punya alasan berubah berbeda.

Contoh:

```text
API Request Model       -> berubah karena client contract
API Response Model      -> berubah karena presentation need
Domain Model            -> berubah karena business rule
Persistence Model       -> berubah karena schema/storage
Event Model             -> berubah karena integration contract
Audit Model             -> berubah karena compliance traceability
```

Jangan otomatis membuat semuanya berbeda jika sistem kecil. Tetapi pada sistem besar, pemisahan ini sering menyelamatkan evolusi.

### 5.3 Contoh Boundary Model

```java
public record SubmitCaseRequest(
    String applicantId,
    String applicationType,
    String declarationText
) {}
```

```java
public record SubmitCaseCommand(
    ApplicantId applicantId,
    ApplicationType applicationType,
    Declaration declaration
) {}
```

```java
public final class CaseFile {
    private final CaseId id;
    private final ApplicantId applicantId;
    private CaseStatus status;

    public void submit(Declaration declaration) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        declaration.ensureAccepted();
        this.status = CaseStatus.SUBMITTED;
    }
}
```

```java
@Entity
@Table(name = "CASE_FILE")
class CaseFileJpaEntity {
    @Id
    private String id;
    private String applicantId;
    private String status;
}
```

```java
public record CaseSubmittedEvent(
    String eventId,
    String caseId,
    String applicantId,
    Instant occurredAt
) {}
```

Perhatikan:

1. Request model boleh pakai `String`, karena berada di boundary input mentah.
2. Command model memakai domain primitive.
3. Domain model menjaga invariant.
4. JPA entity mengikuti storage mapping.
5. Event model mengikuti integration compatibility.

---

## 6. Records sebagai Value Carrier Modern

### 6.1 Apa yang Record Berikan

`record` cocok untuk immutable data carrier dengan equality berbasis component.

Contoh:

```java
public record OfficerId(String value) {
    public OfficerId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("OfficerId must not be blank");
        }
    }
}
```

Record memberikan:

1. Constructor canonical.
2. Accessor untuk component.
3. `equals`.
4. `hashCode`.
5. `toString`.
6. Immutability referential untuk field final.

Tetapi record tidak otomatis membuat object benar secara domain.

### 6.2 Record Bukan Magic Immutability

Contoh berbahaya:

```java
public record CaseSummary(List<String> tags) {}
```

Field `tags` final, tetapi list-nya masih mutable.

```java
List<String> tags = new ArrayList<>();
CaseSummary summary = new CaseSummary(tags);
tags.add("MUTATED");
```

Lebih aman:

```java
public record CaseSummary(List<String> tags) {
    public CaseSummary {
        tags = List.copyOf(Objects.requireNonNull(tags));
    }
}
```

### 6.3 Record Cocok Untuk

Record cocok untuk:

1. Value object sederhana.
2. Domain primitive.
3. Command immutable.
4. Query parameter.
5. Result object.
6. Event payload internal.
7. Small projection.
8. Composite key.
9. Snapshot data.
10. API DTO sederhana.

Contoh:

```java
public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("End date must not be before start date");
        }
    }

    public boolean contains(LocalDate date) {
        return !date.isBefore(start) && !date.isAfter(end);
    }
}
```

### 6.4 Record Tidak Selalu Cocok Untuk

Record kurang cocok untuk:

1. Entity dengan identity dan mutable lifecycle.
2. Object dengan complex encapsulated mutation.
3. Object dengan lazy-loaded state.
4. Object dengan lifecycle hooks kompleks.
5. JPA entity tradisional.
6. Object yang harus menyembunyikan representation internal secara kuat.

Contoh buruk:

```java
public record CaseFile(
    String id,
    String status,
    List<String> notes
) {}
```

Jika `CaseFile` punya lifecycle `draft -> submitted -> reviewed -> approved`, record seperti ini terlalu pasif.

Lebih baik entity biasa:

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private final List<CaseNote> notes = new ArrayList<>();

    public void submit() { ... }
    public void approve(OfficerId officerId, ApprovalReason reason) { ... }
}
```

### 6.5 Compact Constructor untuk Invariant

```java
public record Percentage(int value) {
    public Percentage {
        if (value < 0 || value > 100) {
            throw new IllegalArgumentException("Percentage must be between 0 and 100");
        }
    }
}
```

Ini membuat invalid percentage tidak bisa dibuat.

Bandingkan dengan:

```java
int percentage;
```

Compiler tidak membantu apa pun.

---

## 7. Sealed Hierarchy untuk Domain Alternatives

### 7.1 Masalah Domain Alternatives

Banyak domain punya bentuk alternatif yang tertutup.

Contoh decision result:

```text
Approved
Rejected
NeedMoreInformation
Escalated
```

Model buruk:

```java
public class DecisionResult {
    public String status;
    public String rejectionReason;
    public String infoRequestMessage;
    public String escalationTeam;
}
```

Masalah:

1. Field yang tidak relevan bisa terisi.
2. Kombinasi ilegal bisa terjadi.
3. Consumer harus tahu aturan nullable field.
4. Compiler tidak membantu saat variant baru ditambahkan.

### 7.2 Sealed Interface sebagai Sum Type

Java tidak punya algebraic data type sekuat beberapa bahasa functional, tetapi sealed hierarchy + record memberi pendekatan yang cukup kuat.

```java
public sealed interface DecisionResult
    permits DecisionResult.Approved,
            DecisionResult.Rejected,
            DecisionResult.NeedMoreInformation,
            DecisionResult.Escalated {

    record Approved(OfficerId approvedBy, Instant approvedAt) implements DecisionResult {}

    record Rejected(OfficerId rejectedBy, RejectionReason reason) implements DecisionResult {}

    record NeedMoreInformation(InfoRequestMessage message) implements DecisionResult {}

    record Escalated(EscalationTeam team, EscalationReason reason) implements DecisionResult {}
}
```

Sekarang setiap variant membawa data yang relevan saja.

### 7.3 Pattern Matching Switch

```java
public String renderDecision(DecisionResult result) {
    return switch (result) {
        case DecisionResult.Approved approved ->
            "Approved by " + approved.approvedBy().value();
        case DecisionResult.Rejected rejected ->
            "Rejected: " + rejected.reason().value();
        case DecisionResult.NeedMoreInformation request ->
            "Need more info: " + request.message().value();
        case DecisionResult.Escalated escalated ->
            "Escalated to " + escalated.team().name();
    };
}
```

Manfaat:

1. Variant eksplisit.
2. Field relevan per variant.
3. Tidak ada nullable field chaos.
4. `switch` bisa exhaustive untuk sealed hierarchy.
5. Penambahan variant baru memaksa consumer penting diperbarui.

### 7.4 Kapan Sealed Cocok

Sealed cocok saat:

1. Set variant diketahui dan dikontrol oleh module/library.
2. Domain membutuhkan exhaustiveness.
3. Consumer harus menangani semua kemungkinan.
4. Variant punya data berbeda.
5. Kamu ingin menghindari status string + nullable fields.

### 7.5 Kapan Sealed Tidak Cocok

Sealed kurang cocok saat:

1. Variant harus bisa ditambahkan plugin eksternal.
2. Library harus open-ended.
3. Kamu tidak mengontrol semua implementasi.
4. Domain memang extensible by third party.
5. Compatibility binary/source menjadi isu besar.

Untuk extensibility eksternal, interface biasa + registry/strategy mungkin lebih cocok.

---

## 8. Enum vs Sealed Type

### 8.1 Enum Cocok untuk Constant Set Sederhana

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Enum cocok jika:

1. Variant tidak membawa data berbeda.
2. Behavior kecil dan stabil.
3. Set pilihan tertutup.
4. Tidak perlu struktur data per variant.

### 8.2 Enum Mulai Bau Jika Membawa Terlalu Banyak Behavior

```java
public enum CaseStatus {
    DRAFT {
        @Override boolean canApprove() { return false; }
        @Override boolean canSubmit() { return true; }
    },
    SUBMITTED {
        @Override boolean canApprove() { return true; }
        @Override boolean canSubmit() { return false; }
    };

    abstract boolean canApprove();
    abstract boolean canSubmit();
}
```

Ini masih bisa diterima untuk logic kecil.

Tetapi jika enum mulai berisi:

1. Database query.
2. External API call.
3. Authorization logic.
4. Notification logic.
5. Workflow transition kompleks.

Maka enum berubah menjadi god enum.

### 8.3 Sealed Type Lebih Cocok Jika Variant Punya Data

Buruk:

```java
public record PaymentResult(
    PaymentStatus status,
    String transactionId,
    String failureCode,
    String failureMessage
) {}
```

Lebih baik:

```java
public sealed interface PaymentResult permits PaymentResult.Success, PaymentResult.Failed {
    record Success(TransactionId transactionId) implements PaymentResult {}
    record Failed(FailureCode code, FailureMessage message) implements PaymentResult {}
}
```

---

## 9. Domain Primitive Pattern

### 9.1 Apa Itu Domain Primitive?

Domain primitive adalah wrapper kecil untuk primitive/library type yang membawa makna domain dan invariant.

Contoh:

```java
public record LicenceNumber(String value) {
    public LicenceNumber {
        Objects.requireNonNull(value);
        if (!value.matches("LIC-[0-9]{8}")) {
            throw new IllegalArgumentException("Invalid licence number");
        }
    }
}
```

### 9.2 Kenapa Domain Primitive Penting?

Tanpa domain primitive:

```java
public void assign(String caseId, String officerId, String licenceNumber) { ... }
```

Bug ini compile:

```java
assign(officerId, caseId, licenceNumber);
```

Dengan domain primitive:

```java
public void assign(CaseId caseId, OfficerId officerId, LicenceNumber licenceNumber) { ... }
```

Bug tertangkap compiler.

### 9.3 Domain Primitive Mengurangi Validasi Duplikat

Buruk:

```java
if (email == null || !email.contains("@")) throw ...;
```

Muncul di controller, service, mapper, repository, batch job.

Lebih baik:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value);
        if (!value.matches("^[^@]+@[^@]+\\.[^@]+$")) {
            throw new IllegalArgumentException("Invalid email address");
        }
    }
}
```

Sekarang setiap `EmailAddress` valid by construction.

### 9.4 Domain Primitive Bukan Selalu Perlu

Jangan membuat wrapper untuk semua hal tanpa alasan.

Pertanyaan praktis:

```text
Apakah nilai ini sering tertukar dengan nilai lain?
Apakah validasinya penting?
Apakah ada invariant domain?
Apakah tipe ini muncul di banyak boundary?
Apakah kesalahan tipe ini mahal?
Apakah konsep ini punya behavior kecil?
```

Jika ya, domain primitive layak.

Jika field hanya internal temporary variable, primitive biasa cukup.

---

## 10. Type-Safe ID

### 10.1 Masalah ID String/Long

```java
public CaseFile find(String id) { ... }
public Officer findOfficer(String id) { ... }
public Applicant findApplicant(String id) { ... }
```

Semua `id` sama-sama `String`.

Bug ini compile:

```java
CaseFile caseFile = caseRepository.find(officerId);
```

### 10.2 Record-Based ID

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value);
        if (value.isBlank()) {
            throw new IllegalArgumentException("CaseId must not be blank");
        }
    }

    public static CaseId of(String value) {
        return new CaseId(value);
    }
}
```

```java
public record OfficerId(String value) {
    public OfficerId {
        Objects.requireNonNull(value);
        if (value.isBlank()) {
            throw new IllegalArgumentException("OfficerId must not be blank");
        }
    }
}
```

Repository menjadi:

```java
public interface CaseRepository {
    Optional<CaseFile> findById(CaseId id);
    void save(CaseFile caseFile);
}
```

### 10.3 Generic ID: Hati-hati

Kadang engineer membuat:

```java
public record Id<T>(String value) {}
```

Lalu:

```java
Id<CaseFile> caseId;
Id<Officer> officerId;
```

Ini bisa berguna, tetapi punya trade-off:

1. Error message kurang domain-specific.
2. JSON serialization lebih rumit.
3. JPA converter lebih rumit.
4. Generic type hilang saat runtime karena type erasure.
5. Tidak bisa mudah memberi validation berbeda per ID.

Untuk domain penting, explicit ID sering lebih jelas.

```java
CaseId
OfficerId
ApplicantId
LicenceId
```

### 10.4 ID Sebagai Opaque Type

Jangan terlalu sering parse struktur ID di seluruh codebase.

Buruk:

```java
if (caseId.value().startsWith("APP-")) { ... }
```

Jika format ID berubah, semua code rusak.

Lebih baik:

```java
caseId.isApplicationCase()
```

Atau lebih baik lagi, tipe berbeda:

```java
ApplicationCaseId
EnforcementCaseId
```

Tergantung kebutuhan domain.

---

## 11. Null Object Pattern

### 11.1 Masalah Null

Null sering punya beberapa arti:

```text
Tidak ada
Belum dimuat
Tidak berlaku
Tidak diketahui
User tidak punya akses
Data corrupt
Field optional
```

Satu `null` dipakai untuk semua arti ini sangat berbahaya.

### 11.2 Null Object

Null Object adalah object yang merepresentasikan kondisi kosong dengan behavior aman.

Contoh:

```java
public interface NotificationPreference {
    boolean allowsEmail();
    boolean allowsSms();
}

public final class RealNotificationPreference implements NotificationPreference {
    private final boolean email;
    private final boolean sms;

    public RealNotificationPreference(boolean email, boolean sms) {
        this.email = email;
        this.sms = sms;
    }

    @Override
    public boolean allowsEmail() { return email; }

    @Override
    public boolean allowsSms() { return sms; }
}

public enum NoNotificationPreference implements NotificationPreference {
    INSTANCE;

    @Override
    public boolean allowsEmail() { return false; }

    @Override
    public boolean allowsSms() { return false; }
}
```

Pemakaian:

```java
NotificationPreference preference = repository.findPreference(userId)
    .orElse(NoNotificationPreference.INSTANCE);

if (preference.allowsEmail()) {
    emailSender.send(...);
}
```

### 11.3 Kapan Null Object Cocok

Cocok jika:

1. Ada default behavior yang jelas.
2. Empty object tidak menyembunyikan error.
3. Caller memang tidak perlu membedakan absent reason.
4. Behavior kosong aman.

### 11.4 Kapan Null Object Berbahaya

Berbahaya jika absence harus eksplisit.

Contoh:

```text
No authorization context
No approval reason
No payment record
No applicant identity
```

Jika ini disembunyikan dengan Null Object, sistem bisa melanjutkan proses yang seharusnya gagal.

Untuk domain kritis, absence sering lebih baik dimodelkan sebagai:

```java
Optional<T>
```

atau:

```java
sealed interface LookupResult<T> {
    record Found<T>(T value) implements LookupResult<T> {}
    record NotFound<T>() implements LookupResult<T> {}
    record Forbidden<T>() implements LookupResult<T> {}
}
```

---

## 12. Optional Boundary

### 12.1 Optional untuk Return Value

`Optional<T>` paling cocok untuk return value yang mungkin tidak ada.

```java
public Optional<CaseFile> findById(CaseId id) { ... }
```

Ini lebih jelas daripada:

```java
public CaseFile findById(CaseId id) { ... } // returns null sometimes
```

### 12.2 Optional Bukan Untuk Semua Tempat

Hindari:

```java
public record CaseFile(Optional<String> approvalReason) {}
```

Sering kali lebih baik:

```java
public sealed interface ApprovalState {
    record NotApproved() implements ApprovalState {}
    record Approved(ApprovalReason reason) implements ApprovalState {}
}
```

Atau jika benar-benar optional simple field:

```java
private ApprovalReason approvalReason; // internal nullable, controlled by methods
```

Dengan accessor:

```java
public Optional<ApprovalReason> approvalReason() {
    return Optional.ofNullable(approvalReason);
}
```

### 12.3 Optional Parameter Smell

Buruk:

```java
public void search(Optional<CaseStatus> status, Optional<OfficerId> officerId) { ... }
```

Lebih baik:

```java
public record CaseSearchCriteria(
    Optional<CaseStatus> status,
    Optional<OfficerId> officerId
) {}
```

Atau jika terlalu banyak kombinasi:

```java
public final class CaseSearchCriteriaBuilder { ... }
```

### 12.4 Optional dan Serialization

Hati-hati memakai `Optional` sebagai field DTO/persistence. Banyak framework bisa mendukung, tetapi contract-nya sering kurang jelas.

Untuk API JSON, biasanya lebih jelas memakai nullable field di DTO boundary, lalu map ke domain model yang eksplisit.

---

## 13. Money, Quantity, Period, Identifier

### 13.1 Money

Buruk:

```java
BigDecimal amount;
String currency;
```

Lebih baik:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Invalid money scale for currency");
        }
    }

    public Money add(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("Cannot add money with different currency");
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

### 13.2 Quantity

```java
public record Quantity(int value) {
    public Quantity {
        if (value < 0) {
            throw new IllegalArgumentException("Quantity must not be negative");
        }
    }

    public boolean isZero() {
        return value == 0;
    }
}
```

### 13.3 Date Range / Period

```java
public record EffectivePeriod(LocalDate start, LocalDate end) {
    public EffectivePeriod {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (end.isBefore(start)) {
            throw new IllegalArgumentException("End must not be before start");
        }
    }

    public boolean isActiveOn(LocalDate date) {
        return !date.isBefore(start) && !date.isAfter(end);
    }
}
```

### 13.4 Identifier

```java
public record ApplicationNumber(String value) {
    public ApplicationNumber {
        Objects.requireNonNull(value);
        if (!value.matches("APP-[0-9]{4}-[0-9]{6}")) {
            throw new IllegalArgumentException("Invalid application number");
        }
    }
}
```

---

## 14. Modeling Lifecycle Without Boolean Explosion

### 14.1 Boolean Explosion

Buruk:

```java
public class CaseFile {
    private boolean submitted;
    private boolean approved;
    private boolean rejected;
    private boolean escalated;
    private boolean closed;
}
```

Masalah:

1. Bisa `approved=true` dan `rejected=true` bersamaan.
2. Tidak jelas urutan transisi.
3. Tidak jelas state legal.
4. Tidak jelas action yang tersedia.
5. Query logic menjadi rumit.

### 14.2 Gunakan State Eksplisit

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Ini lebih baik, tetapi belum cukup jika transition rule kompleks.

### 14.3 Gunakan State Object atau Workflow Model

```java
public sealed interface CaseLifecycleState
    permits DraftState, SubmittedState, UnderReviewState, ApprovedState, RejectedState, ClosedState {

    CaseStatus status();
    Set<CaseAction> availableActions();
}
```

Atau table-driven transition seperti Part 14.

Poin penting di Part 17: jangan representasikan lifecycle kompleks dengan banyak boolean.

---

## 15. Modeling Decision Result

### 15.1 Buruk: Status + Nullable Detail

```java
public record EligibilityResult(
    boolean eligible,
    String rejectionCode,
    String rejectionMessage,
    String warningMessage
) {}
```

Masalah:

1. Jika `eligible=true`, apakah rejectionCode harus null?
2. Jika `eligible=false`, apakah warning boleh ada?
3. Jika rejectionCode ada tetapi message null, legal atau tidak?
4. Tidak ada compile-time protection.

### 15.2 Lebih Baik: Sealed Result

```java
public sealed interface EligibilityResult
    permits EligibilityResult.Eligible,
            EligibilityResult.NotEligible,
            EligibilityResult.EligibleWithWarning {

    record Eligible() implements EligibilityResult {}

    record NotEligible(RejectionCode code, RejectionMessage message)
        implements EligibilityResult {}

    record EligibleWithWarning(WarningMessage warning)
        implements EligibilityResult {}
}
```

### 15.3 Consumer Lebih Aman

```java
public String toDisplayMessage(EligibilityResult result) {
    return switch (result) {
        case EligibilityResult.Eligible ignored -> "Eligible";
        case EligibilityResult.NotEligible notEligible ->
            "Not eligible: " + notEligible.message().value();
        case EligibilityResult.EligibleWithWarning warning ->
            "Eligible with warning: " + warning.warning().value();
    };
}
```

---

## 16. Entity Leaking Persistence Concern

### 16.1 Masalah

Di Java enterprise, domain entity sering tercampur dengan JPA entity.

```java
@Entity
public class CaseFile {
    @Id
    private String id;

    @OneToMany(fetch = FetchType.LAZY)
    private List<CaseDocument> documents;

    public void approve() {
        // domain logic
    }
}
```

Ini tidak selalu salah. Untuk banyak aplikasi CRUD, domain entity dan JPA entity digabung bisa produktif.

Tetapi pada domain kompleks, ada risiko:

1. Lazy loading terjadi di domain method.
2. Transaction boundary tersembunyi.
3. Persistence annotation mengarahkan design domain.
4. Domain object sulit dites tanpa persistence provider.
5. Invariant bisa dilanggar oleh ORM reflection/proxy.
6. Collection mutable karena kebutuhan ORM.
7. Equality/hashCode sulit.

### 16.2 Opsi Desain

Ada beberapa opsi:

#### Opsi A — JPA Entity sebagai Domain Entity

Cocok jika:

1. Domain relatif sederhana.
2. Team butuh produktivitas.
3. Invariant tidak terlalu kompleks.
4. JPA lifecycle dipahami.

Risiko:

1. Domain tergantung persistence.
2. Lazy loading surprises.
3. Proxy/equality issue.

#### Opsi B — Domain Model Terpisah dari Persistence Entity

Cocok jika:

1. Domain kompleks.
2. Invariant penting.
3. Persistence schema berbeda dari domain model.
4. Butuh test domain murni.
5. Ada multi-source persistence.

Risiko:

1. Mapping overhead.
2. Lebih banyak class.
3. Sinkronisasi model perlu disiplin.

#### Opsi C — Hybrid

Gunakan JPA entity untuk aggregate sederhana, domain object terpisah untuk logic kompleks.

Ini sering realistis di enterprise.

### 16.3 Decision Heuristic

```text
Jika entity hanya CRUD sederhana -> JPA entity as domain mungkin cukup.
Jika entity punya lifecycle rule, auditability, transition, policy, dan banyak invariant -> pertimbangkan domain model terpisah.
```

---

## 17. Equality dan Identity

### 17.1 Value Object Equality

Record memberi equality berdasarkan semua component.

```java
public record PostalCode(String value) {}
```

```java
new PostalCode("123456").equals(new PostalCode("123456")); // true
```

Bagus untuk value object.

### 17.2 Entity Equality

Entity lebih rumit.

```java
public final class CaseFile {
    private final CaseId id;

    @Override
    public boolean equals(Object other) {
        return other instanceof CaseFile that && this.id.equals(that.id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }
}
```

Tetapi hati-hati jika ID baru dibuat setelah persistence insert.

Jika entity belum punya ID sebelum disimpan, equality bisa berubah setelah persist. Ini berbahaya jika object sudah ada di `HashSet`.

Lebih baik gunakan application-generated ID sebelum entity dibuat.

```java
CaseFile caseFile = new CaseFile(CaseId.newId(), applicantId);
```

### 17.3 JPA Proxy Problem

Jika memakai JPA proxy, `getClass()` dalam equals bisa bermasalah karena proxy subclass.

Itu sebabnya equality JPA entity butuh perhatian khusus. Jangan copy-paste equals/hashCode dari IDE tanpa memahami lifecycle ID.

---

## 18. Mutability Boundary

### 18.1 Internal Mutability, External Immutability

Entity bisa mutable internal, tetapi jangan expose mutable collection.

Buruk:

```java
public List<CaseNote> notes() {
    return notes;
}
```

Caller bisa:

```java
caseFile.notes().clear();
```

Lebih baik:

```java
public List<CaseNote> notes() {
    return List.copyOf(notes);
}
```

Atau:

```java
public void addNote(CaseNote note) {
    notes.add(Objects.requireNonNull(note));
}
```

### 18.2 Controlled Mutation

Buruk:

```java
caseFile.setStatus(CaseStatus.APPROVED);
```

Lebih baik:

```java
caseFile.approve(officerId, reason);
```

Setter mengubah data.

Behavior method menjalankan domain operation.

Perbedaannya besar.

---

## 19. Validation Placement

### 19.1 Boundary Validation

Controller/API boundary memvalidasi input mentah:

```text
required field
format dasar
JSON shape
length limit
malicious payload
```

### 19.2 Domain Primitive Validation

Domain primitive memvalidasi invariant lokal:

```text
email format
postal code format
money scale
date range order
identifier format
```

### 19.3 Entity/Service Validation

Entity/domain service memvalidasi rule yang membutuhkan konteks:

```text
case can only be approved if submitted
officer cannot approve own application
licence cannot renew after expiry threshold
appeal must be submitted within N days
```

### 19.4 Anti-Pattern: Semua Validasi di Service

Buruk:

```java
public void submit(String postalCode, String email, BigDecimal amount, String status) {
    validatePostalCode(postalCode);
    validateEmail(email);
    validateAmount(amount);
    validateStatus(status);
    // business logic
}
```

Masalah:

1. Validation lokal berulang.
2. Invalid object bisa beredar sebelum validasi.
3. Method service membengkak.
4. Test sulit fokus.

Lebih baik validasi lokal dimiliki tipe lokal.

---

## 20. Anti-Pattern Catalog

### 20.1 Primitive Obsession

Gejala:

```java
String caseId;
String officerId;
String postalCode;
String status;
String amount;
```

Masalah:

1. Makna hilang.
2. Parameter mudah tertukar.
3. Validation tersebar.
4. Refactoring sulit.

Solusi:

```java
CaseId
OfficerId
PostalCode
CaseStatus
Money
```

### 20.2 Stringly Typed Domain

Gejala:

```java
if (status.equals("APPROVED")) { ... }
```

Masalah:

1. Typo runtime.
2. Tidak ada exhaustiveness.
3. Tidak ada central semantic.
4. Sulit mencari semua status legal.

Solusi:

```java
CaseStatus.APPROVED
```

atau sealed hierarchy untuk variant kompleks.

### 20.3 Record as Careless DTO

Gejala:

```java
public record CaseRecord(String id, String status, String amount, List<String> tags) {}
```

Masalah:

1. Tidak ada invariant.
2. Mutable field masih bocor.
3. Semua field string.
4. Terlihat modern tetapi miskin domain.

Solusi:

```java
public record CaseSummary(CaseId id, CaseStatus status, Money amount, List<Tag> tags) {
    public CaseSummary {
        tags = List.copyOf(tags);
    }
}
```

### 20.4 Entity Exposed as API

Gejala:

```java
@GetMapping("/cases/{id}")
public CaseFileJpaEntity get(@PathVariable String id) { ... }
```

Masalah:

1. API bocor schema internal.
2. Lazy loading serialization issue.
3. Sensitive field bisa keluar.
4. Perubahan DB memecahkan API.

Solusi:

```java
public CaseDetailResponse get(...) { ... }
```

### 20.5 Universal Model

Satu model untuk request, response, domain, DB, event, export.

Masalah:

1. Nullable chaos.
2. Security leak.
3. Coupling lintas boundary.
4. Evolution sulit.

Solusi:

Boundary-specific model.

### 20.6 Boolean State Explosion

Gejala:

```java
boolean approved;
boolean rejected;
boolean closed;
boolean escalated;
```

Solusi:

```java
CaseStatus
```

atau state machine.

### 20.7 Anemic Domain Model

Gejala:

```java
caseFile.setStatus(APPROVED);
caseFile.setApprovedBy(officerId);
caseFile.setApprovedAt(now);
caseFile.setReason(reason);
```

Semua rule ada di service.

Solusi:

```java
caseFile.approve(officerId, reason, clock);
```

### 20.8 Getter/Setter Driven Design

Gejala:

```java
object.setA(...);
object.setB(...);
object.setC(...);
```

Masalah:

1. Object bisa berada di state setengah jadi.
2. Tidak jelas operation domain.
3. Invariant tersebar di caller.

Solusi:

Constructor/factory valid + behavior method.

### 20.9 Enum God Object

Gejala:

```java
enum CaseType {
    A { ... 200 lines ... },
    B { ... 300 lines ... }
}
```

Solusi:

Strategy/Policy/Rule Object.

### 20.10 Nullable Field Protocol

Gejala:

```java
// if status == REJECTED then rejectionReason must be non-null
// if status == APPROVED then approvedAt must be non-null
```

Rule hidup di komentar.

Solusi:

Sealed variant atau state-specific object.

---

## 21. Refactoring Path

### 21.1 Dari Primitive ke Domain Primitive

Sebelum:

```java
public void assign(String caseId, String officerId) { ... }
```

Langkah:

1. Buat `CaseId` dan `OfficerId`.
2. Tambahkan factory `of(String)`.
3. Ubah internal service method dulu.
4. Mapper dari API tetap menerima string.
5. Tambahkan test validation.
6. Migrasi repository signature.
7. Hapus overload lama.

Sesudah:

```java
public void assign(CaseId caseId, OfficerId officerId) { ... }
```

### 21.2 Dari Status String ke Enum

Sebelum:

```java
String status;
```

Langkah:

1. Inventaris semua status legal dari DB/code.
2. Buat enum.
3. Buat parser toleran untuk data lama.
4. Normalisasi mapping persistence.
5. Ganti comparison string.
6. Tambahkan test untuk unknown value.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED;

    public static CaseStatus parse(String value) {
        try {
            return CaseStatus.valueOf(value);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Unknown case status: " + value, e);
        }
    }
}
```

### 21.3 Dari Nullable Result ke Sealed Result

Sebelum:

```java
record ValidationResult(boolean valid, String code, String message) {}
```

Langkah:

1. Identifikasi kombinasi legal.
2. Buat sealed interface.
3. Mapping dari result lama ke result baru.
4. Update consumer dengan switch.
5. Tambahkan exhaustive tests.
6. Hapus nullable protocol.

Sesudah:

```java
sealed interface ValidationResult {
    record Valid() implements ValidationResult {}
    record Invalid(ErrorCode code, ErrorMessage message) implements ValidationResult {}
}
```

### 21.4 Dari Entity Setter ke Behavior Method

Sebelum:

```java
caseFile.setStatus(APPROVED);
caseFile.setApprovedBy(officerId);
caseFile.setApprovedAt(now);
```

Langkah:

1. Buat method `approve` di entity/domain object.
2. Pindahkan invariant ke method tersebut.
3. Deprecate setter.
4. Ganti caller satu per satu.
5. Tambahkan test illegal transition.
6. Jadikan setter private/protected jika memungkinkan.

Sesudah:

```java
caseFile.approve(officerId, reason, clock);
```

---

## 22. Testing Strategy

### 22.1 Test Domain Primitive

```java
class PostalCodeTest {
    @Test
    void rejectsNonSixDigitValue() {
        assertThrows(IllegalArgumentException.class, () -> new PostalCode("123"));
    }

    @Test
    void acceptsSixDigitValue() {
        PostalCode code = new PostalCode("123456");
        assertEquals("123456", code.value());
    }
}
```

### 22.2 Test Value Object Equality

```java
@Test
void postalCodesWithSameValueAreEqual() {
    assertEquals(new PostalCode("123456"), new PostalCode("123456"));
}
```

### 22.3 Test Entity Behavior

```java
@Test
void draftCaseCanBeSubmitted() {
    CaseFile caseFile = CaseFile.draft(CaseId.of("CASE-1"), ApplicantId.of("APP-1"));

    caseFile.submit();

    assertEquals(CaseStatus.SUBMITTED, caseFile.status());
}
```

### 22.4 Test Illegal Transition

```java
@Test
void approvedCaseCannotBeSubmittedAgain() {
    CaseFile caseFile = approvedCase();

    assertThrows(IllegalStateException.class, caseFile::submit);
}
```

### 22.5 Test Sealed Result Exhaustiveness Indirectly

Compiler membantu exhaustiveness, tetapi test tetap perlu memastikan semantics.

```java
@Test
void rejectedEligibilityContainsReason() {
    EligibilityResult result = new EligibilityResult.NotEligible(
        new RejectionCode("AGE"),
        new RejectionMessage("Applicant is under minimum age")
    );

    String message = renderer.render(result);

    assertTrue(message.contains("minimum age"));
}
```

### 22.6 Property-Like Test untuk Value Object

Tanpa property-based testing library pun, kita bisa test banyak input.

```java
@Test
void percentageAcceptsOnlyZeroToHundred() {
    for (int i = 0; i <= 100; i++) {
        assertDoesNotThrow(() -> new Percentage(i));
    }

    assertThrows(IllegalArgumentException.class, () -> new Percentage(-1));
    assertThrows(IllegalArgumentException.class, () -> new Percentage(101));
}
```

---

## 23. Observability dan Debugging Angle

Domain model juga berpengaruh pada observability.

### 23.1 Structured Logging dengan Domain Primitive

Buruk:

```java
log.info("Approved {}", id);
```

Lebih jelas:

```java
log.info("case approved caseId={} officerId={}", caseId.value(), officerId.value());
```

### 23.2 Jangan Bocorkan Sensitive Value di `toString`

Record otomatis membuat `toString` dari semua component.

Berbahaya:

```java
public record NationalId(String value) {}
```

Log:

```text
NationalId[value=S1234567D]
```

Untuk data sensitif, override `toString`.

```java
public record NationalId(String value) {
    @Override
    public String toString() {
        return "NationalId[masked=****]";
    }
}
```

### 23.3 Error Message Harus Domain-Specific

Buruk:

```text
Invalid string
```

Lebih baik:

```text
Invalid postal code: must be exactly 6 digits
```

Tetapi jangan masukkan PII mentah ke error message/log.

### 23.4 Auditability

Domain operation lebih mudah diaudit daripada setter.

Buruk:

```java
caseFile.setStatus(APPROVED);
```

Sulit tahu intent.

Lebih baik:

```java
caseFile.approve(officerId, reason, clock);
```

Audit event bisa dibuat dari operation:

```java
new CaseApprovedAuditEvent(caseId, officerId, reason, clock.instant())
```

---

## 24. Security and Compliance Angle

### 24.1 Model Sensitive Data Secara Eksplisit

Jangan semua data pribadi hanya `String`.

```java
public record MaskedEmail(String value) {}
public record RawEmailAddress(String value) {}
```

Atau:

```java
public final class EmailAddress {
    private final String value;

    public String masked() { ... }
    public String rawForDeliveryOnly() { ... }
}
```

Tujuannya bukan paranoid, tetapi membuat penggunaan sensitive data lebih eksplisit.

### 24.2 Jangan Jadikan DTO Internal Sebagai API Response

Jika entity punya field:

```java
internalRemark
investigationNote
riskScore
screeningReason
```

Jangan otomatis expose ke API.

Gunakan response model eksplisit:

```java
public record CasePublicResponse(
    String caseId,
    String status,
    String submittedAt
) {}
```

### 24.3 Authorization State Bukan Boolean Sederhana

Buruk:

```java
boolean canApprove;
boolean canReject;
```

Lebih baik:

```java
public sealed interface PermissionDecision {
    record Allowed() implements PermissionDecision {}
    record Denied(DenialReason reason) implements PermissionDecision {}
}
```

Ini membuat denial reason dapat diaudit.

---

## 25. Performance Consideration

### 25.1 Domain Primitive Overhead

Ya, wrapper object menambah allocation.

Tetapi jangan langsung takut.

Pertimbangkan:

1. Untuk request/use-case/domain layer, overhead biasanya kecil dibanding I/O, DB, network.
2. Untuk hot path jutaan object per detik, domain primitive perlu lebih hati-hati.
3. JIT escape analysis bisa menghilangkan sebagian allocation dalam kasus tertentu.
4. Readability dan correctness sering lebih bernilai di enterprise domain.

### 25.2 Di Hot Path

Jika domain primitive dipakai di hot path seperti parser high-throughput atau storage engine:

1. Gunakan primitive internal representation.
2. Validasi di boundary.
3. Hindari wrapping berulang.
4. Gunakan specialized structure.
5. Measure dengan JMH.

Contoh kompromi:

```java
public record CaseId(String value) {}
```

Dipakai di service/application layer.

Tetapi repository batch internal bisa memakai raw `String` setelah boundary validation, jika memang terbukti bottleneck.

### 25.3 Jangan Pakai Performance sebagai Alasan Prematur

Anti-pattern umum:

```text
Kita pakai String saja karena object wrapper mahal.
```

Lalu sistem penuh bug karena ID tertukar dan validation tersebar.

Performance harus diukur, bukan diasumsikan.

---

## 26. Java 8–25 Perspective

### 26.1 Java 8

Java 8 belum punya record/sealed, tetapi tetap bisa domain modeling baik:

```java
public final class CaseId {
    private final String value;

    private CaseId(String value) {
        this.value = Objects.requireNonNull(value);
        if (value.isBlank()) throw new IllegalArgumentException();
    }

    public static CaseId of(String value) {
        return new CaseId(value);
    }

    public String value() { return value; }

    @Override public boolean equals(Object o) { ... }
    @Override public int hashCode() { ... }
    @Override public String toString() { ... }
}
```

Lebih verbose, tetapi konsep sama.

### 26.2 Java 16+

Record mengurangi boilerplate value object.

```java
public record CaseId(String value) { ... }
```

### 26.3 Java 17+

Sealed classes/interfaces membuat closed domain alternatives lebih eksplisit.

```java
public sealed interface Decision permits Approved, Rejected {}
```

### 26.4 Java 21+

Pattern matching switch membuat sealed result lebih ergonomis.

```java
return switch (decision) { ... };
```

### 26.5 Java 25

Di Java 25, kombinasi record, sealed hierarchy, dan pattern matching semakin menjadi gaya natural untuk data-oriented modeling. Namun prinsipnya tetap sama: fitur bahasa membantu mengekspresikan model, tetapi tidak menggantikan design judgment.

Fitur modern tidak otomatis menghasilkan model yang baik.

Record buruk tetap buruk.

Sealed hierarchy buruk tetap buruk.

Pattern matching buruk tetap bisa menjadi `switch` besar yang memindahkan god logic ke tempat lain.

---

## 27. Case Study: Regulatory Case Decision Model

### 27.1 Starting Point Buruk

```java
public class CaseDecisionDto {
    public String caseId;
    public String decision;
    public String officerId;
    public String reason;
    public String escalationTeam;
    public String requestedInfo;
    public String createdAt;
}
```

Consumer harus tahu protocol:

```text
if decision == APPROVED -> reason optional
if decision == REJECTED -> reason required
if decision == ESCALATED -> escalationTeam required
if decision == NEED_INFO -> requestedInfo required
```

Ini rawan.

### 27.2 Domain Primitive

```java
public record CaseId(String value) {
    public CaseId {
        Objects.requireNonNull(value);
        if (value.isBlank()) throw new IllegalArgumentException("CaseId must not be blank");
    }
}

public record OfficerId(String value) {
    public OfficerId {
        Objects.requireNonNull(value);
        if (value.isBlank()) throw new IllegalArgumentException("OfficerId must not be blank");
    }
}

public record DecisionReason(String value) {
    public DecisionReason {
        Objects.requireNonNull(value);
        if (value.isBlank()) throw new IllegalArgumentException("Decision reason must not be blank");
        if (value.length() > 1000) throw new IllegalArgumentException("Decision reason too long");
    }
}
```

### 27.3 Sealed Decision

```java
public sealed interface CaseDecision
    permits CaseDecision.Approved,
            CaseDecision.Rejected,
            CaseDecision.NeedMoreInformation,
            CaseDecision.Escalated {

    CaseId caseId();
    OfficerId decidedBy();
    Instant decidedAt();

    record Approved(
        CaseId caseId,
        OfficerId decidedBy,
        Instant decidedAt,
        DecisionReason reason
    ) implements CaseDecision {}

    record Rejected(
        CaseId caseId,
        OfficerId decidedBy,
        Instant decidedAt,
        DecisionReason reason
    ) implements CaseDecision {}

    record NeedMoreInformation(
        CaseId caseId,
        OfficerId decidedBy,
        Instant decidedAt,
        InformationRequest request
    ) implements CaseDecision {}

    record Escalated(
        CaseId caseId,
        OfficerId decidedBy,
        Instant decidedAt,
        EscalationTeam team,
        DecisionReason reason
    ) implements CaseDecision {}
}
```

### 27.4 Renderer

```java
public final class CaseDecisionRenderer {
    public String render(CaseDecision decision) {
        return switch (decision) {
            case CaseDecision.Approved approved ->
                "Approved: " + approved.reason().value();
            case CaseDecision.Rejected rejected ->
                "Rejected: " + rejected.reason().value();
            case CaseDecision.NeedMoreInformation needInfo ->
                "Need more information: " + needInfo.request().message();
            case CaseDecision.Escalated escalated ->
                "Escalated to " + escalated.team().name();
        };
    }
}
```

### 27.5 Audit Mapping

```java
public record CaseDecisionAuditEvent(
    String caseId,
    String decisionType,
    String officerId,
    String occurredAt,
    Map<String, String> details
) {}
```

Mapping:

```java
public CaseDecisionAuditEvent toAuditEvent(CaseDecision decision) {
    return switch (decision) {
        case CaseDecision.Approved approved -> new CaseDecisionAuditEvent(
            approved.caseId().value(),
            "APPROVED",
            approved.decidedBy().value(),
            approved.decidedAt().toString(),
            Map.of("reason", approved.reason().value())
        );
        case CaseDecision.Rejected rejected -> new CaseDecisionAuditEvent(
            rejected.caseId().value(),
            "REJECTED",
            rejected.decidedBy().value(),
            rejected.decidedAt().toString(),
            Map.of("reason", rejected.reason().value())
        );
        case CaseDecision.NeedMoreInformation needInfo -> new CaseDecisionAuditEvent(
            needInfo.caseId().value(),
            "NEED_MORE_INFORMATION",
            needInfo.decidedBy().value(),
            needInfo.decidedAt().toString(),
            Map.of("request", needInfo.request().message())
        );
        case CaseDecision.Escalated escalated -> new CaseDecisionAuditEvent(
            escalated.caseId().value(),
            "ESCALATED",
            escalated.decidedBy().value(),
            escalated.decidedAt().toString(),
            Map.of("team", escalated.team().name(), "reason", escalated.reason().value())
        );
    };
}
```

Sekarang audit mapping eksplisit per variant.

---

## 28. Design Review Checklist

Gunakan checklist ini saat membaca model Java:

```text
Identity
[ ] Apakah object ini entity atau value object?
[ ] Apakah equality-nya sesuai identity/value?
[ ] Apakah ID dibuat sebelum entity masuk collection/persistence?

Invariant
[ ] Apakah invalid state bisa dibuat?
[ ] Apakah validation tersebar atau terpusat di tipe yang tepat?
[ ] Apakah constructor/factory menjaga invariant minimum?

Mutability
[ ] Apakah value object immutable?
[ ] Apakah mutable collection bocor keluar?
[ ] Apakah entity mutation dilakukan via behavior method, bukan setter bebas?

Boundary
[ ] Apakah API model terpisah dari domain model jika perlu?
[ ] Apakah persistence concern bocor ke domain?
[ ] Apakah event model punya compatibility contract sendiri?

Type Safety
[ ] Apakah banyak String/Long yang sebenarnya konsep domain?
[ ] Apakah parameter raw primitive mudah tertukar?
[ ] Apakah status dimodelkan sebagai string?

Alternatives
[ ] Apakah nullable field protocol bisa diganti sealed hierarchy?
[ ] Apakah enum cukup, atau variant butuh data berbeda?
[ ] Apakah sealed hierarchy terlalu menutup extensibility?

Security
[ ] Apakah sensitive data punya model eksplisit?
[ ] Apakah record toString membocorkan PII?
[ ] Apakah response model bisa membocorkan internal field?

Operational
[ ] Apakah error message cukup domain-specific?
[ ] Apakah audit event dapat diturunkan dari operation/model?
[ ] Apakah log memakai domain identifier yang jelas?

Performance
[ ] Apakah wrapper object ada di hot path?
[ ] Apakah performance concern sudah diukur?
[ ] Apakah correctness dikorbankan tanpa bukti bottleneck?
```

---

## 29. Staff-Level Discussion Questions

Pertanyaan yang sering membedakan engineer biasa dan engineer senior/staff:

1. Kenapa field ini `String`, bukan domain primitive?
2. Apakah object ini entity atau value object? Apa konsekuensinya terhadap equality?
3. Apakah model ini mengizinkan invalid state?
4. Apakah null di field ini berarti absent, unknown, forbidden, not loaded, atau not applicable?
5. Apakah status + nullable fields harus diganti sealed hierarchy?
6. Apakah enum ini mulai menjadi god enum?
7. Apakah record ini benar-benar immutable?
8. Apakah `toString` record ini aman untuk log?
9. Apakah JPA entity boleh menjadi domain entity di konteks ini?
10. Apakah model API dan domain perlu dipisah?
11. Apakah value object ini terlalu granular atau justru mencegah bug mahal?
12. Bagaimana model ini berevolusi jika ada variant baru?
13. Bagaimana model ini memengaruhi auditability?
14. Bagaimana model ini memengaruhi authorization?
15. Bagaimana kita migrate dari model lama tanpa big bang rewrite?

---

## 30. Summary

Data/domain modeling adalah salah satu fondasi terpenting dalam design pattern mastery.

Pattern seperti Strategy, State, Visitor, Command, Repository, dan Adapter akan jauh lebih bersih jika model domainnya benar.

Inti bagian ini:

1. Entity dikenali dari identity, value object dikenali dari value.
2. Record sangat berguna untuk value object, command, result, dan projection, tetapi bukan magic domain modeling.
3. Sealed hierarchy sangat kuat untuk domain alternatives yang tertutup dan butuh exhaustiveness.
4. Domain primitive mengurangi primitive obsession, validation duplication, dan parameter mix-up.
5. Type-safe ID membuat compiler membantu mencegah bug.
6. Null Object berguna hanya jika empty behavior benar-benar aman.
7. Optional cocok terutama untuk return value, bukan solusi universal.
8. Boolean explosion harus diganti state/status/workflow model.
9. DTO, domain model, persistence model, event model, dan audit model punya alasan berubah berbeda.
10. Model yang baik membuat invalid state sulit dibuat.

Prinsip praktis:

```text
Jangan mulai dari field.
Mulai dari konsep.

Jangan tanya: tipe datanya apa?
Tanya: makna domainnya apa?

Jangan hanya validasi input.
Buat tipe yang tidak bisa berada dalam state invalid.
```

---

## 31. Latihan Praktis

Ambil module enterprise yang kamu kenal, lalu cari:

1. 10 field `String` yang sebenarnya domain primitive.
2. 5 field `boolean` yang sebenarnya state/lifecycle.
3. 3 DTO yang dipakai lintas boundary terlalu banyak.
4. 3 nullable field protocol.
5. 2 enum yang mulai menjadi god enum.
6. 1 entity yang terlalu banyak setter.
7. 1 response API yang berpotensi membocorkan internal field.

Lalu buat refactoring plan bertahap:

```text
Step 1: Introduce domain primitive
Step 2: Add mapper boundary
Step 3: Replace string status with enum
Step 4: Replace nullable result with sealed result
Step 5: Move lifecycle mutation into behavior method
Step 6: Add tests for invalid state
Step 7: Add audit/event mapping explicitly
```

---

## 32. Referensi Lanjutan

Untuk memperdalam bagian ini, pelajari:

1. Domain-Driven Design — Eric Evans.
2. Implementing Domain-Driven Design — Vaughn Vernon.
3. Effective Java — Joshua Bloch, khususnya item tentang static factory, immutability, equals/hashCode, dan value types.
4. Java Language Specification terkait records, sealed classes, dan pattern matching.
5. Java SE documentation untuk `record`, `Optional`, `List.copyOf`, dan pattern matching switch.
6. Refactoring — Martin Fowler, terutama smell seperti Primitive Obsession, Data Class, Feature Envy, dan Shotgun Surgery.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./16-behavioral-iterator-stream-collector-fluent-api.md">⬅️ Part 16 — Behavioral Pattern VII: Iterator, Stream, Collector, Fluent API</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./18-service-layer-application-service-domain-service-transaction-script.md">Part 18 — Service Layer, Application Service, Domain Service, Transaction Script ➡️</a>
</div>

# learn-java-validation-jakarta-hibernate-validator-part-008

# Group Sequence and Dynamic Group Sequence: Ordered Validation and Short-Circuiting

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `008`  
> Topik: validation groups yang dieksekusi berurutan, short-circuiting, default group override, dynamic group sequence, dan batas aman penggunaannya dalam sistem besar.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kita ingin memiliki mental model yang kuat tentang:

1. Kenapa validation group biasa kadang tidak cukup.
2. Apa bedanya group biasa dengan group sequence.
3. Bagaimana `@GroupSequence` mengubah urutan validasi.
4. Bagaimana short-circuiting bekerja.
5. Bagaimana overriding `Default` group bekerja pada class.
6. Kenapa default group override harus dipakai dengan sangat hati-hati.
7. Apa itu dynamic group sequence pada Hibernate Validator.
8. Bagaimana dynamic sequence membantu state-dependent validation.
9. Kenapa group sequence bukan workflow engine.
10. Bagaimana mendesain ordered validation yang explainable, testable, dan tidak rapuh.

Bagian ini sangat penting untuk engineer senior karena group sequence sering digunakan ketika sistem mulai memiliki kebutuhan seperti:

- validasi murah dulu sebelum validasi mahal,
- validasi structural dulu sebelum semantic validation,
- validasi field dasar dulu sebelum cross-field validation,
- validasi bentuk input dulu sebelum business-ish validation,
- validasi berbeda berdasarkan state object.

Tetapi justru di titik ini Bean/Jakarta Validation sering mulai disalahgunakan.

---

## 2. Problem Dasar: Tidak Semua Constraint Pantas Dijalankan Bersamaan

Pada validation groups biasa, kita memilih satu atau lebih group lalu provider akan mengevaluasi constraint yang termasuk dalam group tersebut.

Contoh sederhana:

```java
interface BasicChecks {}
interface BusinessChecks {}

public class RegisterUserCommand {
    @NotBlank(groups = BasicChecks.class)
    private String email;

    @Email(groups = BasicChecks.class)
    private String emailFormat;

    @UniqueEmail(groups = BusinessChecks.class)
    private String emailForUniqueness;
}
```

Lalu:

```java
Set<ConstraintViolation<RegisterUserCommand>> violations =
        validator.validate(command, BasicChecks.class, BusinessChecks.class);
```

Masalahnya: jika `email` kosong, apakah kita masih ingin menjalankan `@UniqueEmail`?

Biasanya tidak.

Kenapa?

Karena uniqueness check mungkin:

- query database,
- memanggil service,
- mahal,
- menghasilkan error sekunder yang tidak penting,
- bahkan error-nya misleading jika basic input belum valid.

Maka kita butuh model:

1. Jalankan constraint dasar dulu.
2. Jika ada failure, berhenti.
3. Jika lulus, lanjut ke constraint tahap berikutnya.

Inilah kegunaan group sequence.

---

## 3. Mental Model Group Sequence

Group sequence adalah **ordered validation pipeline**.

Bukan:

> Jalankan semua group ini.

Melainkan:

> Jalankan group pertama. Jika group pertama bersih, lanjut group kedua. Jika group kedua bersih, lanjut group ketiga. Jika salah satu group gagal, hentikan sequence.

Secara mental:

```text
GroupSequence = [G1, G2, G3]

validate(G1)
if violations in G1 -> stop

validate(G2)
if violations in G2 -> stop

validate(G3)
if violations in G3 -> stop

return all violations from first failing group, or empty
```

Konsekuensinya sangat besar:

- user tidak melihat semua error sekaligus,
- hanya error dari group pertama yang gagal,
- expensive validation bisa ditunda,
- error bisa lebih fokus,
- tetapi debugging bisa lebih sulit karena constraint group belakang tidak muncul sampai group depan lulus.

---

## 4. Syntax Dasar `@GroupSequence`

```java
import jakarta.validation.GroupSequence;

public interface ValidationGroups {
    interface Basic {}
    interface Semantic {}
    interface External {}

    @GroupSequence({Basic.class, Semantic.class, External.class})
    interface OrderedChecks {}
}
```

Penggunaan:

```java
Set<ConstraintViolation<ApplicationSubmitCommand>> violations =
        validator.validate(command, ValidationGroups.OrderedChecks.class);
```

Contoh object:

```java
public class ApplicationSubmitCommand {

    @NotBlank(groups = ValidationGroups.Basic.class)
    private String applicantName;

    @NotBlank(groups = ValidationGroups.Basic.class)
    private String postalCode;

    @Pattern(regexp = "\\d{6}", groups = ValidationGroups.Semantic.class)
    private String postalCode;

    @KnownPostalCode(groups = ValidationGroups.External.class)
    private String postalCode;
}
```

Execution behavior:

1. `Basic` dijalankan.
2. Jika `applicantName` kosong atau `postalCode` kosong, berhenti.
3. Jika `Basic` lulus, `Semantic` dijalankan.
4. Jika postal code bukan 6 digit, berhenti.
5. Jika `Semantic` lulus, `External` dijalankan.
6. Baru cek apakah postal code dikenal.

Ini jauh lebih masuk akal daripada langsung cek external postal code ketika input masih kosong atau format masih salah.

---

## 5. Contoh: Validasi Bertahap untuk Submit Application

Misalkan ada command:

```java
public final class SubmitApplicationCommand {
    private String applicantName;
    private String applicantEmail;
    private String postalCode;
    private LocalDate startDate;
    private LocalDate endDate;
    private List<SupportingDocumentDto> documents;

    // getters
}
```

Kita definisikan group:

```java
public interface SubmitValidation {
    interface Shape {}
    interface Format {}
    interface Consistency {}
    interface Expensive {}

    @GroupSequence({Shape.class, Format.class, Consistency.class, Expensive.class})
    interface Ordered {}
}
```

DTO:

```java
public final class SubmitApplicationCommand {

    @NotBlank(groups = SubmitValidation.Shape.class)
    private String applicantName;

    @NotBlank(groups = SubmitValidation.Shape.class)
    @Email(groups = SubmitValidation.Format.class)
    private String applicantEmail;

    @NotBlank(groups = SubmitValidation.Shape.class)
    @Pattern(regexp = "\\d{6}", groups = SubmitValidation.Format.class)
    @KnownPostalCode(groups = SubmitValidation.Expensive.class)
    private String postalCode;

    @NotNull(groups = SubmitValidation.Shape.class)
    private LocalDate startDate;

    @NotNull(groups = SubmitValidation.Shape.class)
    private LocalDate endDate;

    @ValidDateRange(groups = SubmitValidation.Consistency.class)
    private SubmitApplicationCommand self;

    @NotEmpty(groups = SubmitValidation.Shape.class)
    private List<@Valid SupportingDocumentDto> documents;
}
```

Catatan: contoh `self` di atas bukan desain yang direkomendasikan. Class-level constraint lebih tepat.

Lebih baik:

```java
@ValidApplicationPeriod(groups = SubmitValidation.Consistency.class)
public final class SubmitApplicationCommand {

    @NotBlank(groups = SubmitValidation.Shape.class)
    private String applicantName;

    @NotBlank(groups = SubmitValidation.Shape.class)
    @Email(groups = SubmitValidation.Format.class)
    private String applicantEmail;

    @NotBlank(groups = SubmitValidation.Shape.class)
    @Pattern(regexp = "\\d{6}", groups = SubmitValidation.Format.class)
    @KnownPostalCode(groups = SubmitValidation.Expensive.class)
    private String postalCode;

    @NotNull(groups = SubmitValidation.Shape.class)
    private LocalDate startDate;

    @NotNull(groups = SubmitValidation.Shape.class)
    private LocalDate endDate;

    @NotEmpty(groups = SubmitValidation.Shape.class)
    private List<@Valid SupportingDocumentDto> documents;
}
```

Dengan sequence:

```java
validator.validate(command, SubmitValidation.Ordered.class);
```

Mental model:

```text
Shape:
  - required fields exist
  - collection not empty

Format:
  - email format
  - postal code format

Consistency:
  - start date <= end date
  - class-level internal consistency

Expensive:
  - reference lookup
  - external service-ish checks
```

Ini pattern yang baik jika setiap tahap punya alasan jelas.

---

## 6. Kenapa Short-Circuiting Penting

Short-circuiting berarti group berikutnya tidak dijalankan jika group sebelumnya menghasilkan violation.

Manfaat:

### 6.1 Menghindari Error Noise

Jika field kosong, error “must not be blank” lebih berguna daripada:

- “must be valid email”,
- “email domain not supported”,
- “email already registered”,
- “cannot verify MX record”.

Terlalu banyak error untuk satu root cause membuat UX buruk.

### 6.2 Menghemat Resource

Validasi mahal bisa ditunda.

Contoh mahal:

- regex kompleks,
- database lookup,
- cache miss,
- remote service,
- deep graph traversal,
- uniqueness approximation,
- cryptographic or checksum validation,
- large file metadata validation.

### 6.3 Mengurangi False/Misleading Error

Jika `startDate == null`, maka class-level date range validator mungkin tidak bisa memberi error yang meaningful.

Bisa saja validator ditulis null-tolerant, tapi tetap lebih bersih jika:

1. requiredness lulus dulu,
2. baru consistency rule dijalankan.

### 6.4 Membuat Validation Pipeline Lebih Explainable

Untuk sistem enterprise/regulatory, kita sering perlu menjelaskan:

> Kenapa request ditolak?

Pipeline berurutan membantu:

```text
Request rejected at validation stage: FORMAT
Rule: POSTAL_CODE_FORMAT
Reason: postalCode must be exactly 6 digits
```

Ini lebih defendable daripada ratusan violation campur aduk.

---

## 7. Bahaya Short-Circuiting

Short-circuiting juga punya biaya.

### 7.1 User Tidak Melihat Semua Error Sekaligus

Jika `Shape` gagal, `Format` tidak dievaluasi.

Akibatnya user mungkin memperbaiki satu batch error, submit lagi, lalu baru melihat batch error berikutnya.

Ini bisa menyebalkan untuk form panjang.

Strategi:

- untuk interactive form, tampilkan sebanyak mungkin error murah,
- untuk backend command critical, ordered validation lebih masuk akal,
- untuk batch import, mungkin perlu mode “collect all cheap errors, skip expensive checks”.

### 7.2 Hidden Constraint

Constraint di group belakang tidak terlihat sampai group depan lulus.

Developer baru bisa bingung:

> Kenapa `@KnownPostalCode` tidak jalan?

Jawabannya mungkin:

> Karena `Format` group gagal dulu.

Karena itu group sequence harus didokumentasikan.

### 7.3 Test Coverage Lebih Sulit

Harus mengetes:

- failure di group pertama,
- success group pertama tetapi failure group kedua,
- success group pertama-kedua tetapi failure group ketiga,
- full success.

Tanpa ini, banyak rule tidak pernah benar-benar dites.

### 7.4 Bisa Menjadi Workflow Engine Gelap

Ini bahaya terbesar.

Jika group sequence mulai seperti ini:

```java
@GroupSequence({
    DraftChecks.class,
    SubmittedChecks.class,
    OfficerReviewChecks.class,
    ManagerApprovalChecks.class,
    DirectorApprovalChecks.class,
    EnforcementChecks.class,
    ClosureChecks.class
})
interface CaseWorkflowChecks {}
```

Maka kemungkinan desain sudah salah.

Workflow stage bukan sekadar validation group. Workflow punya:

- actor,
- permission,
- transition,
- state,
- guard,
- side effect,
- audit trail,
- SLA,
- escalation,
- evidence,
- rule version.

Group sequence tidak cukup untuk memodelkan itu.

---

## 8. Group Sequence vs Fail-Fast Mode

Group sequence dan fail-fast berbeda.

### Group Sequence

Berhenti antar group.

```text
Validate all constraints in Basic.
If Basic has any violation, stop before Format.
```

Dalam group yang sama, provider masih bisa mengumpulkan banyak violation.

### Fail-Fast

Berhenti pada violation pertama yang ditemukan.

```text
Validate until first violation anywhere, then stop.
```

Hibernate Validator mendukung fail-fast mode sebagai provider-specific feature.

Perbandingan:

| Aspek | Group Sequence | Fail-Fast |
|---|---|---|
| Standard spec | Ya | Provider-specific di Hibernate Validator |
| Berhenti di mana | antar group | violation pertama |
| UX | masih bisa banyak error per tahap | hanya satu error |
| Use case | staged validation | latency-sensitive validation |
| Determinisme error pertama | lebih baik jika group jelas | bisa bergantung urutan internal |
| Cocok untuk form panjang | kadang | jarang |
| Cocok untuk hot path | bisa | bisa |

Rule praktis:

- gunakan group sequence untuk **semantic ordering**,
- gunakan fail-fast untuk **cost/latency optimization** yang benar-benar diperlukan,
- jangan gunakan fail-fast sebagai default API UX kecuali memang hanya perlu satu error.

---

## 9. Group Sequence Biasa: Pattern yang Baik

Pattern yang cukup aman:

```java
public interface OrderedValidation {
    interface Shape {}
    interface Format {}
    interface LocalConsistency {}
    interface Reference {}

    @GroupSequence({
        Shape.class,
        Format.class,
        LocalConsistency.class,
        Reference.class
    })
    interface Complete {}
}
```

Makna:

```text
Shape:
  Apakah data minimal ada?

Format:
  Apakah representasi field valid?

LocalConsistency:
  Apakah field-field dalam object konsisten satu sama lain?

Reference:
  Apakah data menunjuk ke referensi yang dikenal?
```

Ini masih validation-ish.

Bukan:

```text
Draft -> Submitted -> Approved -> Rejected -> Closed
```

Itu workflow-ish.

---

## 10. Default Group Override

Sekarang bagian yang sering membingungkan.

Biasanya constraint tanpa explicit group masuk ke `Default` group.

```java
public class Person {
    @NotBlank
    private String name;
}
```

Sama seperti:

```java
public class Person {
    @NotBlank(groups = Default.class)
    private String name;
}
```

Kita bisa override `Default` group sequence untuk sebuah class:

```java
@GroupSequence({Person.class, Person.HighLevelChecks.class})
public class Person {

    public interface HighLevelChecks {}

    @NotBlank
    private String name;

    @ValidPersonName(groups = HighLevelChecks.class)
    private String name;
}
```

Hal penting:

Dalam class-level `@GroupSequence`, class itu sendiri mewakili default constraints milik class tersebut.

Jadi ini:

```java
@GroupSequence({Person.class, Person.HighLevelChecks.class})
```

artinya:

1. validasi default constraints pada `Person`,
2. jika lulus, validasi `HighLevelChecks`.

Bukan:

```java
@GroupSequence({Default.class, Person.HighLevelChecks.class})
```

Untuk default group override pada class, sequence harus menyertakan class itu sendiri.

---

## 11. Contoh Default Group Override

```java
@GroupSequence({SubmitApplicationCommand.class, SubmitApplicationCommand.Consistency.class})
public class SubmitApplicationCommand {

    public interface Consistency {}

    @NotBlank
    private String applicantName;

    @NotNull
    private LocalDate startDate;

    @NotNull
    private LocalDate endDate;

    @ValidApplicationPeriod(groups = Consistency.class)
    public SubmitApplicationCommand getSelf() {
        return this;
    }
}
```

Desain di atas kurang ideal karena class-level constraint lebih baik:

```java
@ValidApplicationPeriod(groups = SubmitApplicationCommand.Consistency.class)
@GroupSequence({SubmitApplicationCommand.class, SubmitApplicationCommand.Consistency.class})
public class SubmitApplicationCommand {

    public interface Consistency {}

    @NotBlank
    private String applicantName;

    @NotNull
    private LocalDate startDate;

    @NotNull
    private LocalDate endDate;
}
```

Ketika code memanggil:

```java
validator.validate(command);
```

Provider tidak hanya menjalankan constraints default biasa. Ia menjalankan default sequence yang sudah di-override:

```text
SubmitApplicationCommand.class -> Consistency.class
```

Maka class-level period check baru berjalan setelah field default lulus.

---

## 12. Kapan Default Group Override Cocok

Cocok ketika:

1. Class punya natural validation order.
2. Urutan itu selalu berlaku saat class divalidasi default.
3. Constraint tahap belakang bergantung pada tahap depan.
4. Class itu bukan reusable DTO dengan banyak operasi berbeda.
5. Tim bisa memahami behavior tanpa kejutan.

Contoh masuk akal:

```text
MoneyTransferCommand
  Default: required fields
  Consistency: amount/currency/account relation within same object
```

Atau:

```text
DateRange
  Default: start and end not null
  Consistency: start <= end
```

---

## 13. Kapan Default Group Override Berbahaya

Berbahaya ketika:

### 13.1 Class Dipakai Banyak Operation

Jika satu DTO dipakai untuk create, update, submit, approve, import, dan admin override, default group override bisa menjadi jebakan.

Orang memanggil:

```java
validator.validate(dto);
```

Tapi rule yang jalan ternyata tidak sederhana.

### 13.2 Ada Cascaded Validation

Default group override bersifat local pada class.

Ketika object A cascade ke object B, group conversion dan default group behavior bisa membuat flow sulit dipahami.

### 13.3 Dipakai untuk Menyembunyikan Workflow

Jika default group override tergantung state seperti:

```text
if status = DRAFT -> draft checks
if status = SUBMITTED -> submitted checks
if status = APPROVED -> approved checks
```

Lebih baik pertimbangkan dynamic group sequence atau domain policy. Bahkan dynamic group sequence pun belum tentu tepat jika ini sebenarnya workflow guard.

### 13.4 Mengejutkan Framework Integration

Framework seperti Spring MVC/JAX-RS bisa memanggil default validation secara otomatis. Jika default group sudah diubah, endpoint mungkin menjalankan rule yang tidak diharapkan.

---

## 14. Group Sequence dan Cascaded Validation

Misalkan:

```java
public interface OrderChecks {
    interface Shape {}
    interface Consistency {}

    @GroupSequence({Shape.class, Consistency.class})
    interface Ordered {}
}

public class OrderRequest {
    @NotEmpty(groups = OrderChecks.Shape.class)
    private List<@Valid OrderLineRequest> lines;
}

public class OrderLineRequest {
    @NotBlank(groups = OrderChecks.Shape.class)
    private String productCode;

    @Positive(groups = OrderChecks.Shape.class)
    private int quantity;

    @ValidOrderLineConsistency(groups = OrderChecks.Consistency.class)
    private String consistencyMarker;
}
```

Saat:

```java
validator.validate(order, OrderChecks.Ordered.class);
```

Group sequence akan berlaku terhadap graph traversal juga.

Mental model:

```text
Stage Shape:
  validate OrderRequest Shape constraints
  cascade into OrderLineRequest Shape constraints

If any Shape violation exists anywhere in graph:
  stop

Stage Consistency:
  validate OrderRequest Consistency constraints
  cascade into OrderLineRequest Consistency constraints
```

Ini berguna, tetapi bisa mahal pada graph besar.

---

## 15. Group Conversion dalam Sequence

Group conversion memungkinkan saat cascading, group yang datang dari parent diubah menjadi group lain pada child.

Contoh:

```java
public class SubmitApplicationCommand {

    @Valid
    @ConvertGroup(from = SubmitChecks.Shape.class, to = ApplicantChecks.Basic.class)
    private ApplicantDto applicant;
}
```

Use case:

- parent punya taxonomy group sendiri,
- child punya taxonomy group sendiri,
- kita ingin memetakan “Submit Shape” ke “Applicant Basic”.

Dengan sequence, ini makin kompleks.

Contoh:

```text
SubmitChecks.Ordered = [SubmitChecks.Shape, SubmitChecks.Consistency]

When cascading to ApplicantDto:
  SubmitChecks.Shape -> ApplicantChecks.Basic
```

Guideline:

- gunakan group conversion hanya pada aggregate/DTO boundary yang jelas,
- dokumentasikan mapping,
- jangan buat conversion chain terlalu panjang,
- test mapping parent-child secara eksplisit.

Jika tidak, debugging violation path bisa sulit.

---

## 16. Dynamic Group Sequence: Masalah yang Ingin Diselesaikan

Static group sequence cocok jika urutannya selalu sama.

Tetapi kadang group yang perlu dijalankan tergantung isi object.

Contoh:

```text
ApplicationCommand.type = INDIVIDUAL
  -> run IndividualChecks

ApplicationCommand.type = COMPANY
  -> run CompanyChecks
```

Atau:

```text
Case.status = DRAFT
  -> run DraftCompletenessChecks

Case.status = SUBMITTED
  -> run SubmittedIntegrityChecks
```

Hibernate Validator menyediakan mekanisme dynamic default group sequence melalui provider-specific extension.

Konsepnya:

> Default group sequence untuk object dihitung saat runtime berdasarkan state object.

Ini bukan bagian netral yang sepenuhnya portable lintas provider. Ini Hibernate Validator-specific.

---

## 17. Dynamic Group Sequence dengan Hibernate Validator

Secara konseptual, kita membuat provider yang menentukan sequence berdasarkan object instance.

Contoh gaya Hibernate Validator:

```java
@GroupSequenceProvider(ApplicationCommandGroupSequenceProvider.class)
public class ApplicationCommand {

    public interface IndividualChecks {}
    public interface CompanyChecks {}

    private ApplicantType applicantType;

    @NotBlank
    private String applicantName;

    @NotBlank(groups = IndividualChecks.class)
    private String nric;

    @NotBlank(groups = CompanyChecks.class)
    private String uen;

    public ApplicantType getApplicantType() {
        return applicantType;
    }
}
```

Provider:

```java
public class ApplicationCommandGroupSequenceProvider
        implements DefaultGroupSequenceProvider<ApplicationCommand> {

    @Override
    public List<Class<?>> getValidationGroups(ApplicationCommand value) {
        List<Class<?>> sequence = new ArrayList<>();
        sequence.add(ApplicationCommand.class);

        if (value == null) {
            return sequence;
        }

        if (value.getApplicantType() == ApplicantType.INDIVIDUAL) {
            sequence.add(ApplicationCommand.IndividualChecks.class);
        } else if (value.getApplicantType() == ApplicantType.COMPANY) {
            sequence.add(ApplicationCommand.CompanyChecks.class);
        }

        return sequence;
    }
}
```

Mental model:

```text
Default validation of ApplicationCommand:
  Always run default constraints first.
  Then, depending on applicantType:
    INDIVIDUAL -> IndividualChecks
    COMPANY    -> CompanyChecks
```

---

## 18. Dynamic Group Sequence: Kapan Cocok

Cocok untuk object yang punya **local structural variation**.

Contoh bagus:

### 18.1 Discriminated DTO

```text
Applicant type:
  INDIVIDUAL requires nric
  COMPANY requires uen
```

### 18.2 Payment Method Shape

```text
Payment method:
  CARD requires card token
  BANK_TRANSFER requires bank account reference
  PAYNOW requires mobile/uen proxy
```

### 18.3 Case Party Type

```text
Party type:
  PERSON requires identity fields
  ORGANIZATION requires registration fields
```

### 18.4 Import Row Type

```text
Row action:
  CREATE requires all mandatory create fields
  UPDATE requires id and changed fields
  DELETE requires id and reason
```

Syaratnya:

- variasi rule masih lokal pada object,
- tidak membutuhkan actor permission,
- tidak membutuhkan database state kompleks,
- tidak menghasilkan side effect,
- tidak merepresentasikan transition workflow penuh.

---

## 19. Dynamic Group Sequence: Kapan Tidak Cocok

Tidak cocok untuk:

### 19.1 Authorization

```text
If user is admin -> allow field
If user is officer -> disallow field
```

Validator sebaiknya tidak mengambil current user kecuali ada alasan sangat kuat. Authorization belongs elsewhere.

### 19.2 Workflow Transition Guard

```text
DRAFT -> SUBMITTED
SUBMITTED -> APPROVED
APPROVED -> CLOSED
```

Ini bukan sekadar validation group. Ini state machine/policy.

### 19.3 Cross-Aggregate Business Rule

```text
Can approve if no active enforcement case exists
```

Ini perlu query/domain policy. Bean Validation annotation bukan tempat ideal.

### 19.4 Rule dengan External Dependency

```text
If external registry says company is active, allow submit
```

Ini sebaiknya application/domain service dengan retry, timeout, fallback, audit, dan observability.

### 19.5 Regulatory Decision Rule

Jika rule perlu evidence, rule version, explanation, maker-checker, override, dan audit trail, jangan sembunyikan di group sequence provider.

---

## 20. Static vs Dynamic Group Sequence

| Kriteria | Static Group Sequence | Dynamic Group Sequence |
|---|---|---|
| Urutan tetap | Ya | Tidak selalu |
| Berdasarkan state object | Tidak | Ya |
| Standard portability | Ya | Hibernate-specific |
| Mudah dipahami | Lebih mudah | Lebih sulit |
| Cocok untuk staged validation | Ya | Ya, jika variasi lokal |
| Cocok untuk workflow | Tidak | Tetap tidak ideal |
| Test complexity | Medium | High |
| Documentation need | Medium | High |

Rule praktis:

- pilih static sequence jika bisa,
- pilih dynamic sequence hanya jika variasi benar-benar melekat pada object shape,
- gunakan domain policy jika variasinya sudah business/workflow/regulatory.

---

## 21. Ordered Validation Layering yang Sehat

Untuk sistem besar, saya biasanya membedakan validation menjadi beberapa lapisan:

```text
Transport boundary validation
  - JSON parseable?
  - required request fields?
  - type/format constraints?

Command validation
  - operation-specific shape
  - local consistency
  - cheap semantic validation

Domain policy validation
  - state transition
  - actor/role
  - case/business rule
  - regulatory rule

Persistence validation
  - DB final constraints
  - unique/check/fk/not-null

Integration validation
  - external system contract
  - event schema
  - version compatibility
```

Group sequence paling cocok di:

```text
Transport boundary validation
Command validation
```

Kadang cocok di domain value object untuk invariant lokal.

Kurang cocok di:

```text
Domain policy validation
Workflow validation
Persistence consistency
Authorization
```

---

## 22. Contoh Desain Buruk: Workflow Disembunyikan di Group Sequence

```java
public interface CaseGroups {
    interface Draft {}
    interface Submitted {}
    interface OfficerReview {}
    interface ManagerApproval {}
    interface Closure {}

    @GroupSequence({
        Draft.class,
        Submitted.class,
        OfficerReview.class,
        ManagerApproval.class,
        Closure.class
    })
    interface FullLifecycle {}
}
```

Masalah:

1. Workflow tidak linear untuk semua case.
2. Ada conditional branch.
3. Ada actor permission.
4. Ada concurrent modification.
5. Ada audit trail.
6. Ada SLA.
7. Ada override.
8. Ada external dependencies.
9. Ada rule versioning.
10. Ada legal/regulatory explanation.

Group sequence tidak punya model eksplisit untuk semua itu.

Lebih baik:

```java
public final class SubmitCasePolicy {

    public PolicyResult evaluate(SubmitCaseCommand command, CaseAggregate existingCase, Actor actor, Clock clock) {
        PolicyResult result = PolicyResult.empty();

        result.addIf(existingCase.isClosed(), "CASE_ALREADY_CLOSED");
        result.addIf(!actor.canSubmit(existingCase), "ACTOR_NOT_ALLOWED_TO_SUBMIT");
        result.addIf(existingCase.hasMissingMandatoryDocuments(), "MISSING_DOCUMENTS");
        result.addIf(existingCase.isPastSubmissionDeadline(clock), "SUBMISSION_DEADLINE_EXPIRED");

        return result;
    }
}
```

Bean Validation tetap dipakai untuk command shape:

```java
public final class SubmitCaseCommand {
    @NotNull
    private UUID caseId;

    @NotBlank
    private String submissionRemarks;

    @NotEmpty
    private List<@Valid DocumentReference> documents;
}
```

Dengan demikian:

- shape validation jelas,
- workflow policy eksplisit,
- audit bisa dilakukan,
- rule code stabil,
- test lebih terarah.

---

## 23. Contoh Desain Baik: Staged Command Validation

```java
public interface CreateApplicationChecks {
    interface Required {}
    interface Format {}
    interface LocalConsistency {}

    @GroupSequence({Required.class, Format.class, LocalConsistency.class})
    interface Ordered {}
}

@ValidApplicationPeriod(groups = CreateApplicationChecks.LocalConsistency.class)
public final class CreateApplicationCommand {

    @NotBlank(groups = CreateApplicationChecks.Required.class)
    private String applicantName;

    @NotBlank(groups = CreateApplicationChecks.Required.class)
    @Email(groups = CreateApplicationChecks.Format.class)
    private String applicantEmail;

    @NotNull(groups = CreateApplicationChecks.Required.class)
    private LocalDate startDate;

    @NotNull(groups = CreateApplicationChecks.Required.class)
    private LocalDate endDate;
}
```

Application service:

```java
public ApplicationId create(CreateApplicationCommand command) {
    validateOrThrow(command, CreateApplicationChecks.Ordered.class);

    // domain policy / persistence / side effects happen after input is structurally sound
    Application application = Application.create(command);
    repository.save(application);
    return application.id();
}
```

Kenapa bagus?

- `Required` mengecek presence.
- `Format` mengecek representasi.
- `LocalConsistency` mengecek hubungan antar field.
- Tidak ada authorization di annotation.
- Tidak ada workflow transition di group sequence.
- Tidak ada DB dependency di validator.

---

## 24. Menggunakan Group Sequence di Spring

Dalam Spring, biasanya kita memakai `@Validated` untuk memilih group.

```java
@PostMapping("/applications")
public ResponseEntity<?> create(
        @Validated(CreateApplicationChecks.Ordered.class)
        @RequestBody CreateApplicationCommand command
) {
    ApplicationId id = service.create(command);
    return ResponseEntity.ok(id);
}
```

Perbedaan penting:

```java
@Valid
```

biasanya menjalankan default validation.

```java
@Validated(SomeGroup.class)
```

memungkinkan group tertentu.

Jika memakai group sequence interface:

```java
@Validated(CreateApplicationChecks.Ordered.class)
```

maka sequence dipakai.

Pitfall:

- jika lupa `@Validated`, group-specific constraint mungkin tidak jalan,
- jika hanya `@Valid`, hanya default group yang jalan,
- jika default group override dipakai, behavior `@Valid` bisa lebih kompleks,
- exception mapping harus tetap menghasilkan error response yang konsisten.

---

## 25. Menggunakan Group Sequence di JAX-RS / Jakarta REST

Jakarta REST integration dapat menjalankan Bean/Jakarta Validation untuk resource methods, entity parameters, path/query params, dan return values tergantung implementasi/container.

Namun pemilihan group sering lebih eksplisit jika framework/container mendukung annotation group atau custom validation layer.

Pattern aman:

```java
@Path("/applications")
public class ApplicationResource {

    private final Validator validator;
    private final ApplicationService service;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response create(CreateApplicationCommand command) {
        Set<ConstraintViolation<CreateApplicationCommand>> violations =
                validator.validate(command, CreateApplicationChecks.Ordered.class);

        if (!violations.isEmpty()) {
            throw new ValidationApiException(violations);
        }

        ApplicationId id = service.create(command);
        return Response.ok(id).build();
    }
}
```

Untuk sistem besar, explicit validation di application boundary kadang lebih mudah dikendalikan daripada terlalu bergantung pada magic integration.

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Auto validation framework | ringkas, deklaratif | group/exception mapping bisa tersembunyi |
| Explicit validator call | jelas, mudah audit | boilerplate lebih banyak |
| Custom request pipeline | konsisten enterprise-wide | perlu framework internal |

---

## 26. Error Response untuk Group Sequence

Karena group sequence berhenti di group pertama yang gagal, response bisa menyertakan stage.

Contoh response:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "validationStage": "FORMAT",
  "violations": [
    {
      "path": "applicantEmail",
      "code": "EMAIL_INVALID_FORMAT",
      "message": "Applicant email must be a valid email address."
    }
  ]
}
```

Tetapi Jakarta Validation `ConstraintViolation` tidak otomatis memberi tahu “stage” secara langsung.

Cara mendapatkan stage:

1. Dari group yang sedang divalidasi jika kita menjalankan stage manual.
2. Dari `ConstraintDescriptor#getGroups()` dengan hati-hati.
3. Dari taxonomy error code sendiri.
4. Dari custom validation pipeline.

Jika stage penting untuk API/audit, jangan hanya mengandalkan implicit group sequence. Pertimbangkan staged validation manual.

---

## 27. Manual Staged Validation: Alternatif yang Lebih Transparan

Kadang lebih baik tidak memakai `@GroupSequence`, tetapi menjalankan group satu per satu sendiri.

```java
public final class StagedValidator {
    private final Validator validator;

    public <T> StagedValidationResult<T> validate(T target, List<ValidationStage> stages) {
        for (ValidationStage stage : stages) {
            Set<ConstraintViolation<T>> violations = validator.validate(target, stage.group());
            if (!violations.isEmpty()) {
                return StagedValidationResult.failed(stage.name(), violations);
            }
        }
        return StagedValidationResult.passed();
    }
}
```

Stage model:

```java
public record ValidationStage(String name, Class<?> group) {}
```

Usage:

```java
List<ValidationStage> stages = List.of(
        new ValidationStage("REQUIRED", CreateApplicationChecks.Required.class),
        new ValidationStage("FORMAT", CreateApplicationChecks.Format.class),
        new ValidationStage("CONSISTENCY", CreateApplicationChecks.LocalConsistency.class)
);

StagedValidationResult<CreateApplicationCommand> result =
        stagedValidator.validate(command, stages);
```

Kelebihan:

- stage eksplisit,
- response bisa menyertakan stage,
- observability lebih mudah,
- metrics per stage mudah,
- debugging lebih mudah,
- tidak bergantung pada implicit behavior.

Kekurangan:

- sedikit lebih verbose,
- harus menjaga stage definition,
- harus hati-hati dengan cascaded validation semantics.

Untuk sistem regulatory/case management, staged validation manual sering lebih defendable.

---

## 28. Performance Cost Model

Group sequence sering dipakai untuk performance.

Tetapi jangan optimasi tanpa mental model.

### 28.1 Murah

Biasanya murah:

- `@NotNull`,
- `@NotBlank`,
- `@Size`,
- simple numeric bound,
- simple local date bound,
- small local class-level check.

### 28.2 Medium

Bisa medium:

- regex,
- large collection traversal,
- nested object graph,
- message interpolation banyak,
- container element validation besar.

### 28.3 Mahal

Biasanya mahal:

- DB lookup,
- external service,
- remote registry,
- uniqueness check,
- large file inspection,
- deep recursive graph,
- script-based validation.

Group sequence ideal untuk memastikan cheap checks lulus sebelum expensive checks.

Namun prinsip penting:

> Validator sebaiknya pure dan local. Jika validasi butuh I/O, pikir ulang layer-nya.

---

## 29. Database/External Checks dalam Group Belakang

Contoh:

```java
@KnownPostalCode(groups = ReferenceChecks.class)
private String postalCode;
```

Ini terlihat nyaman.

Tapi ada bahaya:

1. Validator menjadi tidak pure.
2. Latency validasi naik.
3. Error handling network/database harus diputuskan.
4. Retry di validator bisa buruk.
5. Timeout bisa memblokir request.
6. Race condition tetap mungkin terjadi.
7. Unit test makin berat.

Alternatif yang sering lebih baik:

```java
validateOrThrow(command, CreateApplicationChecks.Ordered.class);
referencePolicy.validatePostalCode(command.postalCode());
```

Dengan hasil policy:

```java
PolicyResult result = postalCodePolicy.evaluate(command.postalCode());
if (result.failed()) {
    throw new BusinessRuleViolationException(result);
}
```

Perbedaan penting:

- Bean Validation menangani shape/local consistency,
- policy menangani contextual/reference/business check,
- observability dan error handling lebih baik.

---

## 30. Group Sequence dengan Records

Java records cocok untuk DTO immutable.

```java
@ValidPeriod(groups = CreateApplicationChecks.LocalConsistency.class)
public record CreateApplicationCommand(
        @NotBlank(groups = CreateApplicationChecks.Required.class)
        String applicantName,

        @NotBlank(groups = CreateApplicationChecks.Required.class)
        @Email(groups = CreateApplicationChecks.Format.class)
        String applicantEmail,

        @NotNull(groups = CreateApplicationChecks.Required.class)
        LocalDate startDate,

        @NotNull(groups = CreateApplicationChecks.Required.class)
        LocalDate endDate
) {}
```

Validation:

```java
validator.validate(command, CreateApplicationChecks.Ordered.class);
```

Records membuat object lebih eksplisit, tetapi tidak otomatis melakukan validation saat construction.

```java
new CreateApplicationCommand("", "bad", null, null);
```

Tetap bisa dibuat kecuali constructor melakukan validasi sendiri.

Strategi:

- untuk request DTO, validate after deserialization,
- untuk domain value object, enforce invariant di constructor/factory,
- jangan menganggap annotation berarti object mustahil invalid.

---

## 31. Group Sequence dan Constructor Validation

Jika menggunakan executable validation pada constructor:

```java
public final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    public DateRange(
            @NotNull(groups = RangeChecks.Required.class) LocalDate start,
            @NotNull(groups = RangeChecks.Required.class) LocalDate end
    ) {
        this.start = start;
        this.end = end;
    }
}
```

Secara teori executable validation bisa memvalidasi parameter constructor, tetapi dalam praktik:

- constructor validation perlu integration/proxy/manual invocation,
- object invariant sering lebih baik langsung di constructor,
- Bean Validation tidak menggantikan defensive construction untuk domain value object.

Untuk value object:

```java
public DateRange(LocalDate start, LocalDate end) {
    this.start = Objects.requireNonNull(start, "start");
    this.end = Objects.requireNonNull(end, "end");

    if (start.isAfter(end)) {
        throw new IllegalArgumentException("start must not be after end");
    }
}
```

Bean Validation bisa tetap dipakai di DTO boundary, tetapi domain object sebaiknya tidak bergantung penuh pada external validator call.

---

## 32. Group Sequence dan API Compatibility

Menambah constraint di group awal lebih breaking daripada di group belakang.

Contoh sequence:

```text
Required -> Format -> Consistency -> Reference
```

Jika kita menambah `@NotBlank` di `Required`, banyak request yang dulu sampai ke `Format` sekarang berhenti lebih awal.

Dampak:

- error response berubah,
- client mungkin menerima error code berbeda,
- batch import report berubah,
- support documentation perlu update.

Dalam API publik/internal enterprise, validation sequence adalah bagian dari behavioral contract.

Versioning strategy:

1. Tambahkan rule sebagai warning dulu.
2. Observasi rejection rate.
3. Komunikasikan ke client.
4. Enforce setelah periode transisi.
5. Stabilkan error code.

---

## 33. Error Code Design untuk Group Sequence

Jangan mengandalkan message string.

Buruk:

```java
@NotBlank(message = "Applicant name must not be blank")
private String applicantName;
```

Lalu FE parsing string.

Lebih baik:

```java
@NotBlank(message = "{application.applicantName.required}")
private String applicantName;
```

Message bundle:

```properties
application.applicantName.required=Applicant name is required.
application.email.invalid=Applicant email must be valid.
application.period.invalid=Start date must not be after end date.
```

API mapper dapat mengubah template key menjadi stable code:

```text
application.applicantName.required -> APPLICATION_APPLICANT_NAME_REQUIRED
```

Untuk staged validation, code bisa menyiratkan stage:

```text
REQUIRED_APPLICANT_NAME
FORMAT_APPLICANT_EMAIL
CONSISTENCY_APPLICATION_PERIOD
```

Tetapi jangan membuat code terlalu bergantung pada implementasi internal sequence jika sequence mungkin berubah.

---

## 34. Observability untuk Ordered Validation

Dalam production system, validation bukan hanya throw exception.

Minimal metric:

```text
validation.failures.total{endpoint, operation, stage, code}
validation.duration{endpoint, operation, stage}
validation.stage.failed{operation, stage}
```

Logging aman:

```json
{
  "event": "validation_failed",
  "operation": "CreateApplication",
  "stage": "FORMAT",
  "codes": ["APPLICATION_EMAIL_INVALID"],
  "correlationId": "...",
  "actorType": "PUBLIC_USER",
  "requestId": "..."
}
```

Hindari:

```json
{
  "rejectedValue": "actual@email.com"
}
```

Karena rejected value bisa PII.

Untuk regulatory/audit-sensitive system, simpan:

- rule code,
- rule version,
- operation,
- actor/channel,
- timestamp,
- stage,
- non-sensitive value classification.

Bukan raw sensitive payload.

---

## 35. Testing Strategy untuk Group Sequence

Testing group sequence tidak cukup hanya “invalid object should fail”.

Harus test behavior urutan.

### 35.1 Test Group Pertama Gagal

```java
@Test
void shouldStopAtRequiredStage() {
    CreateApplicationCommand command = new CreateApplicationCommand(
            "",
            "not-an-email",
            null,
            null
    );

    Set<ConstraintViolation<CreateApplicationCommand>> violations =
            validator.validate(command, CreateApplicationChecks.Ordered.class);

    assertThat(codes(violations))
            .contains("APPLICATION_APPLICANT_NAME_REQUIRED")
            .doesNotContain("APPLICATION_EMAIL_INVALID")
            .doesNotContain("APPLICATION_PERIOD_INVALID");
}
```

### 35.2 Test Group Kedua Gagal Setelah Pertama Lulus

```java
@Test
void shouldRunFormatAfterRequiredPasses() {
    CreateApplicationCommand command = new CreateApplicationCommand(
            "Alice",
            "not-an-email",
            LocalDate.of(2026, 1, 1),
            LocalDate.of(2026, 1, 2)
    );

    Set<ConstraintViolation<CreateApplicationCommand>> violations =
            validator.validate(command, CreateApplicationChecks.Ordered.class);

    assertThat(codes(violations))
            .contains("APPLICATION_EMAIL_INVALID")
            .doesNotContain("APPLICATION_PERIOD_INVALID");
}
```

### 35.3 Test Group Ketiga Gagal Setelah Sebelumnya Lulus

```java
@Test
void shouldRunConsistencyAfterFormatPasses() {
    CreateApplicationCommand command = new CreateApplicationCommand(
            "Alice",
            "alice@example.com",
            LocalDate.of(2026, 1, 10),
            LocalDate.of(2026, 1, 1)
    );

    Set<ConstraintViolation<CreateApplicationCommand>> violations =
            validator.validate(command, CreateApplicationChecks.Ordered.class);

    assertThat(codes(violations))
            .contains("APPLICATION_PERIOD_INVALID");
}
```

### 35.4 Test Full Success

```java
@Test
void shouldPassAllStages() {
    CreateApplicationCommand command = new CreateApplicationCommand(
            "Alice",
            "alice@example.com",
            LocalDate.of(2026, 1, 1),
            LocalDate.of(2026, 1, 10)
    );

    Set<ConstraintViolation<CreateApplicationCommand>> violations =
            validator.validate(command, CreateApplicationChecks.Ordered.class);

    assertThat(violations).isEmpty();
}
```

---

## 36. Testing Dynamic Group Sequence

Dynamic group sequence harus dites per branch.

Contoh:

```java
@Test
void individualApplicantShouldRequireNric() {
    ApplicationCommand command = new ApplicationCommand();
    command.setApplicantType(ApplicantType.INDIVIDUAL);
    command.setApplicantName("Alice");
    command.setNric(null);
    command.setUen(null);

    Set<ConstraintViolation<ApplicationCommand>> violations = validator.validate(command);

    assertThat(codes(violations))
            .contains("APPLICANT_NRIC_REQUIRED")
            .doesNotContain("APPLICANT_UEN_REQUIRED");
}
```

```java
@Test
void companyApplicantShouldRequireUen() {
    ApplicationCommand command = new ApplicationCommand();
    command.setApplicantType(ApplicantType.COMPANY);
    command.setApplicantName("Example Pte Ltd");
    command.setNric(null);
    command.setUen(null);

    Set<ConstraintViolation<ApplicationCommand>> violations = validator.validate(command);

    assertThat(codes(violations))
            .contains("APPLICANT_UEN_REQUIRED")
            .doesNotContain("APPLICANT_NRIC_REQUIRED");
}
```

Also test null object behavior in provider:

```java
@Test
void groupSequenceProviderShouldHandleNullValue() {
    ApplicationCommandGroupSequenceProvider provider =
            new ApplicationCommandGroupSequenceProvider();

    List<Class<?>> groups = provider.getValidationGroups(null);

    assertThat(groups).containsExactly(ApplicationCommand.class);
}
```

Provider harus null-safe karena provider bisa dipanggil dalam kondisi object null tergantung lifecycle/provider internals.

---

## 37. Common Anti-Patterns

### 37.1 Group Sequence untuk Semua Hal

Buruk:

```text
Required -> Format -> DB -> External -> Workflow -> Authorization -> Audit
```

Ini terlalu banyak.

Pisahkan:

```text
Bean Validation:
  Required -> Format -> LocalConsistency

Application policy:
  DB/reference/business/workflow/authorization
```

### 37.2 Group Sequence Tanpa Naming yang Jelas

Buruk:

```java
interface Step1 {}
interface Step2 {}
interface Step3 {}
```

Lebih baik:

```java
interface Required {}
interface Format {}
interface LocalConsistency {}
interface Reference {}
```

### 37.3 Default Group Override Tanpa Dokumentasi

Jika class punya:

```java
@GroupSequence({SomeDto.class, ExtraChecks.class})
```

Developer harus tahu bahwa `validator.validate(dto)` tidak lagi sesederhana default biasa.

Tambahkan komentar/javadoc.

### 37.4 Dynamic Sequence Berdasarkan External State

Buruk:

```java
if (databaseService.isPremiumCustomer(value.customerId())) {
    sequence.add(PremiumChecks.class);
}
```

Dynamic group sequence provider seharusnya tidak melakukan I/O.

### 37.5 Menaruh Current User di Validator

Buruk:

```java
if (securityContext.currentUser().isAdmin()) {
    sequence.add(AdminChecks.class);
}
```

Ini authorization/policy, bukan object validation.

### 37.6 Group Explosion

```text
CreateBasic
CreateFormat
CreateOfficer
CreateAdmin
CreateAdminOverride
CreateAdminOverrideV2
SubmitBasic
SubmitOfficer
SubmitManager
UpdateBasic
PatchBasic
PatchAdmin
PatchAdminV2
```

Jika group taxonomy sulit dipahami, mungkin DTO/command/policy boundaries salah.

---

## 38. Design Heuristics

Gunakan group sequence jika:

1. Ada urutan natural.
2. Tahap belakang bergantung pada tahap depan.
3. Tahap awal lebih murah.
4. Error tahap awal lebih fundamental.
5. Semua rule masih local/structural/semantic terhadap object.
6. Behavior bisa dites dengan jelas.

Jangan gunakan group sequence jika:

1. Rule butuh actor/current user.
2. Rule butuh workflow state transition.
3. Rule butuh database/external service berat.
4. Rule perlu audit/evidence/rule version mendalam.
5. Rule berbeda per endpoint secara ekstrem.
6. Group taxonomy mulai membengkak.

---

## 39. Recommended Group Taxonomy

Untuk sistem besar, gunakan nama group berdasarkan jenis validasi, bukan berdasarkan endpoint random.

Contoh cukup stabil:

```java
public interface ValidationStages {
    interface Required {}
    interface Format {}
    interface LocalConsistency {}
    interface Reference {}

    @GroupSequence({Required.class, Format.class, LocalConsistency.class, Reference.class})
    interface Ordered {}
}
```

Namun jangan jadikan global untuk semua domain jika semantics berbeda.

Lebih baik scoped:

```java
public interface CreateApplicationValidation {
    interface Required {}
    interface Format {}
    interface LocalConsistency {}

    @GroupSequence({Required.class, Format.class, LocalConsistency.class})
    interface Ordered {}
}
```

Atau per bounded context:

```java
public interface ApplicationValidationStages { ... }
public interface CaseValidationStages { ... }
public interface AppealValidationStages { ... }
```

---

## 40. Case Management Example: Submission Validation

Bayangkan sistem case/application management.

Submit application harus memastikan:

1. Field wajib ada.
2. Format field valid.
3. Tanggal dan dokumen konsisten.
4. Applicant type sesuai field identitas.
5. Actor boleh submit.
6. Case masih dalam state draft.
7. Tidak melewati deadline.
8. Referensi external masih valid.
9. Submit event bisa dipublish.

Jangan masukkan semua ke Bean Validation.

Desain lebih sehat:

```text
Bean Validation Ordered:
  Required
  Format
  LocalConsistency

Domain Policy:
  actor may submit
  case state allows submit
  deadline not exceeded
  mandatory evidence complete

Reference Policy:
  external identifiers valid
  registry status acceptable

Persistence:
  unique constraints
  FK constraints
  optimistic locking

Event Contract:
  outbound event schema valid
```

Code sketch:

```java
public SubmitResult submit(SubmitApplicationCommand command, Actor actor) {
    beanValidation.validateOrThrow(command, SubmitApplicationValidation.Ordered.class);

    Application application = repository.findById(command.applicationId())
            .orElseThrow(ApplicationNotFoundException::new);

    PolicyResult policy = submitPolicy.evaluate(command, application, actor, clock);
    if (policy.failed()) {
        throw new PolicyViolationException(policy);
    }

    application.submit(command, actor, clock);
    repository.save(application);
    eventPublisher.publish(ApplicationSubmittedEvent.from(application));

    return SubmitResult.success(application.id());
}
```

Ini jelas, auditable, dan defendable.

---

## 41. Java 8 sampai Java 25 Notes

### Java 8

- Bean Validation 2.0 relevant.
- Type-use constraints mulai penting.
- `Optional` support tersedia di Bean Validation 2.0 provider seperti Hibernate Validator 6.x.
- Banyak legacy masih `javax.validation`.

### Java 11

- Banyak enterprise system stabil di Java 11 dengan Spring Boot 2.x.
- Biasanya masih `javax.validation`.
- Migration planning penting.

### Java 17

- Baseline modern untuk Jakarta EE 11/Hibernate Validator 9.x.
- Records dan sealed classes mulai mature untuk modeling.
- Spring Boot 3 sudah `jakarta.validation`.

### Java 21

- LTS modern.
- Records semakin umum sebagai DTO.
- Virtual threads tidak mengubah semantics validation, tetapi membuat blocking validator yang melakukan I/O tetap harus diawasi; virtual thread bukan alasan untuk memasukkan remote call sembarangan ke validator.

### Java 25

- Target modern non-LTS/current generation tergantung adoption organisasi.
- Prinsip validation tetap sama.
- Fokus pada maintainability, observability, dan compatibility dengan Jakarta/Hibernate Validator stack yang digunakan.

---

## 42. Migration Notes: `javax.validation` ke `jakarta.validation`

Group sequence concept sama, tetapi package berubah.

Legacy:

```java
import javax.validation.GroupSequence;
```

Modern:

```java
import jakarta.validation.GroupSequence;
```

Legacy:

```java
import javax.validation.groups.Default;
```

Modern:

```java
import jakarta.validation.groups.Default;
```

Yang harus diperhatikan:

1. Jangan campur `javax.validation.GroupSequence` dengan `jakarta.validation` constraints.
2. Jangan campur Hibernate Validator version yang salah dengan API namespace yang salah.
3. Spring Boot 2 umumnya `javax`.
4. Spring Boot 3 memakai `jakarta`.
5. Jakarta EE 9+ memakai `jakarta`.
6. Library internal harus jelas mendukung namespace mana.

Mixed namespace bisa membuat constraint tampak benar secara source code tetapi tidak dikenali runtime.

---

## 43. Review Checklist untuk PR

Saat melihat PR yang memakai group sequence, tanyakan:

1. Apa alasan urutan group ini?
2. Apakah tahap depan lebih fundamental/murah?
3. Apakah tahap belakang bergantung pada tahap depan?
4. Apakah short-circuiting memang diinginkan?
5. Apakah user/client perlu melihat semua error sekaligus?
6. Apakah group sequence dipakai untuk workflow?
7. Apakah ada DB/external call di validator?
8. Apakah default group override akan mengejutkan pemanggil?
9. Apakah dynamic group sequence benar-benar perlu?
10. Apakah semua branch dynamic sequence dites?
11. Apakah error code stabil?
12. Apakah violation path konsisten?
13. Apakah PII tidak bocor di log/error?
14. Apakah migration `javax`/`jakarta` aman?
15. Apakah documentation cukup untuk developer baru?

---

## 44. Summary Mental Model

Group sequence adalah alat untuk **ordered validation**.

Ia berguna ketika:

- validation punya tahap natural,
- tahap awal lebih murah/fundamental,
- tahap berikutnya hanya meaningful jika tahap sebelumnya lulus,
- kita ingin short-circuit antar tahap.

Namun group sequence bukan:

- workflow engine,
- authorization model,
- policy engine,
- database consistency guarantee,
- external integration validator,
- audit framework.

Mental model paling aman:

```text
Use group sequence for staged object validation.
Use domain policy for contextual business decision.
Use workflow engine/state machine for lifecycle transition.
Use database constraints for final consistency.
Use observability/audit model for defensibility.
```

Jika validation mulai membutuhkan actor, state transition, external data, legal reasoning, atau audit explanation, itu tanda kuat bahwa rule harus naik ke application/domain policy layer.

---

## 45. Penutup

Part ini membahas bagaimana validation bisa dijalankan secara bertahap dengan `@GroupSequence`, bagaimana short-circuiting bekerja, kapan default group override masuk akal, dan kapan dynamic group sequence Hibernate Validator berguna.

Hal paling penting: **ordered validation adalah mekanisme clarity dan cost control, bukan tempat menyembunyikan lifecycle bisnis**.

Di sistem kecil, group sequence sering hanya membantu mengurutkan field checks. Di sistem besar, group sequence menjadi bagian dari contract behavior. Karena itu harus dirancang, dites, dan didokumentasikan seperti API contract.

---

# Status Seri

Seri **belum selesai**.

Kita baru menyelesaikan:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence
- Part 005 — Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control
- Part 006 — Container Element Constraints: Lists, Maps, Optional, Custom Containers
- Part 007 — Validation Groups: Operation-Specific Contracts without DTO Explosion
- Part 008 — Group Sequence and Dynamic Group Sequence: Ordered Validation and Short-Circuiting

Bagian berikutnya:

**Part 009 — Custom Constraint Design: Annotation, Validator, Message, Target, Repeatable**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-007](./learn-java-validation-jakarta-hibernate-validator-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-009](./learn-java-validation-jakarta-hibernate-validator-part-009.md)

# learn-java-validation-jakarta-hibernate-validator-part-004

# Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `004`  
> Target: Java 8 sampai Java 25  
> Fokus: strategi nullability production-grade untuk Java Validation, Jakarta/Javax Validation, dan Hibernate Validator  
> Prasyarat: sudah memahami orientasi validation, landscape `javax` vs `jakarta`, core API, dan built-in constraints dari part sebelumnya.

---

## 1. Tujuan Bagian Ini

Bagian ini membahas salah satu area yang kelihatannya sederhana tetapi sangat sering menjadi sumber bug serius di sistem nyata: **nullability**.

Banyak engineer memakai `@NotNull` sebagai jawaban default setiap kali ada field yang “harus ada”. Itu tidak selalu salah, tetapi sering terlalu dangkal. Dalam sistem produksi, terutama sistem enterprise, regulatory, workflow, dan case management, nilai `null` bisa berarti banyak hal:

- belum dikirim oleh client,
- sengaja dikirim untuk menghapus nilai,
- tidak berlaku untuk tipe entity tertentu,
- belum dihitung oleh sistem,
- belum dimuat dari database,
- tidak diketahui,
- default akan diisi di layer lain,
- disembunyikan karena permission,
- kosong karena migration data lama,
- optional secara business,
- required hanya pada state tertentu.

Jika semua itu disederhanakan menjadi `@NotNull`, sistem akan menjadi rapuh.

Target pemahaman setelah bagian ini:

1. Mampu membedakan **absence**, **null**, **empty**, **blank**, **default**, dan **unknown**.
2. Mampu menentukan kapan `@NotNull` tepat, kapan salah, dan kapan perlu strategi lain.
3. Mampu mendesain DTO, command, domain object, patch model, dan persistence model dengan nullability yang eksplisit.
4. Mampu menghindari bug klasik pada PUT/PATCH, partial update, workflow-specific requiredness, dan backward compatibility API.
5. Mampu membuat validation contract yang jelas untuk Java 8 hingga Java 25.

---

## 2. Mental Model Utama: `null` Bukan Satu Makna

Dalam bahasa Java, `null` hanyalah satu representasi teknis: reference tidak menunjuk object apa pun.

Tetapi secara domain, `null` bisa membawa banyak makna.

### 2.1 Makna-Makna `null`

| Makna | Contoh | Risiko Jika Disalahartikan |
|---|---|---|
| Absent | Field tidak dikirim di request PATCH | Bisa dianggap user ingin menghapus nilai |
| Explicit clear | Field dikirim `null` untuk menghapus | Bisa diabaikan dan update tidak terjadi |
| Unknown | Data belum diketahui | Bisa dianggap tidak berlaku |
| Not applicable | Field hanya untuk company, bukan individual | Bisa dipaksa required secara salah |
| Not loaded | Lazy field belum dimuat | Bisa memicu NPE atau lazy loading tidak sengaja |
| To be defaulted | Nilai akan diisi sistem | Bisa ditolak terlalu awal |
| Legacy missing | Data lama belum punya value | Bisa gagal saat migration atau read/update |
| Permission-hidden | User tidak boleh melihat field | Bisa dianggap field kosong |
| Computed later | Field diisi setelah proses async | Bisa gagal validasi sebelum waktunya |

Top-tier engineer tidak bertanya “field ini boleh null atau tidak?” saja.

Pertanyaan yang lebih benar:

> Pada operasi apa, oleh aktor siapa, di state apa, di boundary mana, nilai ini boleh absent, explicit null, defaulted, unknown, atau wajib ada?

---

## 3. `@NotNull`: Constraint Sederhana dengan Konsekuensi Besar

Di Jakarta Validation, `@NotNull` berarti elemen yang dianotasi **tidak boleh bernilai null**. Constraint ini menerima semua type dan dapat dipakai pada field, method, constructor, parameter, dan type-use tergantung versi API modern.

```java
public class CreateApplicantRequest {
    @NotNull
    private String name;
}
```

Secara teknis, ini mudah.

Secara arsitektural, pertanyaan pentingnya adalah:

- Apakah `name` wajib untuk semua operasi?
- Apakah wajib saat create saja?
- Apakah wajib saat submit, tetapi tidak saat draft?
- Apakah boleh null saat data dimigrasi?
- Apakah field ini diisi user atau sistem?
- Apakah validasi dilakukan sebelum atau sesudah enrichment?
- Apakah ini DTO input, entity persistence, atau domain aggregate?

Jika tidak dijawab, `@NotNull` bisa menjadi rule yang salah lokasi.

---

## 4. Null Validity Convention dalam Bean/Jakarta Validation

Salah satu prinsip penting dalam Bean Validation/Jakarta Validation:

> Banyak constraint menganggap `null` sebagai valid, kecuali constraint tersebut secara eksplisit melarang null seperti `@NotNull`, `@NotEmpty`, atau `@NotBlank`.

Contoh:

```java
public class PersonRequest {
    @Email
    private String email;
}
```

Jika `email == null`, maka `@Email` biasanya tidak gagal.

Artinya:

```java
@Email
private String email;
```

berarti:

> Jika email ada, formatnya harus valid.

Bukan:

> Email wajib ada dan formatnya harus valid.

Untuk menyatakan wajib ada dan formatnya valid:

```java
@NotBlank
@Email
private String email;
```

atau jika blank punya semantics berbeda:

```java
@NotNull
@Email
private String email;
```

Tapi hati-hati: `@NotNull @Email` masih mengizinkan empty string jika `@Email` provider menganggap empty valid/tidak valid tergantung implementasi dan spesifikasi detail. Untuk input manusia, `@NotBlank @Email` biasanya lebih masuk akal.

---

## 5. Requiredness Bukan Properti Field, Tapi Properti Operasi

Kesalahan umum:

```java
public class ApplicationDto {
    @NotNull
    private String applicantName;

    @NotNull
    private String licenseType;

    @NotNull
    private LocalDate effectiveDate;
}
```

Ini terlihat benar, tetapi hanya benar jika field tersebut wajib pada **semua konteks** yang memakai DTO ini.

Dalam sistem nyata, DTO yang sama sering dipakai untuk:

- save draft,
- submit application,
- resubmit after amendment,
- admin correction,
- migration import,
- internal enrichment,
- read model projection,
- external system sync.

Requiredness bisa berbeda untuk setiap operasi.

### 5.1 Contoh: Draft vs Submit

Untuk draft:

```json
{
  "applicantName": "Acme Pte Ltd"
}
```

boleh valid karena user belum selesai mengisi form.

Untuk submit:

```json
{
  "applicantName": "Acme Pte Ltd",
  "licenseType": "EA",
  "effectiveDate": "2026-07-01"
}
```

wajib lengkap.

Jika DTO diberi `@NotNull` langsung, save draft akan gagal.

### 5.2 Strategi yang Lebih Baik

Ada beberapa opsi.

#### Opsi A: DTO Terpisah per Operasi

```java
public class SaveDraftApplicationRequest {
    private String applicantName;
    private String licenseType;
    private LocalDate effectiveDate;
}
```

```java
public class SubmitApplicationRequest {
    @NotBlank
    private String applicantName;

    @NotBlank
    private String licenseType;

    @NotNull
    private LocalDate effectiveDate;
}
```

Kelebihan:

- kontrak eksplisit,
- mudah dibaca,
- mudah dites,
- cocok untuk API public,
- tidak perlu group kompleks.

Kekurangan:

- lebih banyak class,
- mapping bertambah,
- perlu disiplin naming.

#### Opsi B: Validation Groups

```java
public interface DraftChecks {}
public interface SubmitChecks {}
```

```java
public class ApplicationRequest {
    @NotBlank(groups = SubmitChecks.class)
    private String applicantName;

    @NotBlank(groups = SubmitChecks.class)
    private String licenseType;

    @NotNull(groups = SubmitChecks.class)
    private LocalDate effectiveDate;
}
```

Kelebihan:

- satu model,
- bisa reuse constraint,
- cocok untuk perbedaan kecil antar operasi.

Kekurangan:

- requiredness tersembunyi di group,
- mudah group explosion,
- sulit dibaca jika banyak state/role/channel,
- bisa berubah menjadi pseudo-workflow engine.

#### Opsi C: Bean Validation untuk Shape, Domain Policy untuk Submit

```java
public class ApplicationRequest {
    private String applicantName;
    private String licenseType;
    private LocalDate effectiveDate;
}
```

```java
public final class ApplicationSubmissionPolicy {
    public ValidationResult validateForSubmission(ApplicationDraft draft) {
        ValidationResult result = ValidationResult.empty();

        if (isBlank(draft.applicantName())) {
            result.add("APPLICANT_NAME_REQUIRED", "Applicant name is required for submission.");
        }

        if (isBlank(draft.licenseType())) {
            result.add("LICENSE_TYPE_REQUIRED", "License type is required for submission.");
        }

        if (draft.effectiveDate() == null) {
            result.add("EFFECTIVE_DATE_REQUIRED", "Effective date is required for submission.");
        }

        return result;
    }
}
```

Kelebihan:

- lebih cocok untuk workflow/stateful rule,
- bisa menambahkan evidence, severity, remediation, rule version,
- tidak memaksa semua business rule menjadi annotation.

Kekurangan:

- perlu desain result model,
- perlu governance rule,
- tidak otomatis terintegrasi dengan framework validation.

---

## 6. `null`, Empty, Blank: Jangan Disamakan

Dalam validation, setidaknya ada empat kondisi berbeda untuk string:

```java
String value = null;     // null
String value = "";       // empty
String value = "   ";    // blank ASCII spaces
String value = "\t\n";   // blank whitespace
```

Constraint umum:

| Constraint | Melarang null | Melarang empty | Melarang blank |
|---|---:|---:|---:|
| `@NotNull` | Ya | Tidak | Tidak |
| `@NotEmpty` | Ya | Ya | Tidak selalu |
| `@NotBlank` | Ya | Ya | Ya |

Contoh:

```java
@NotNull
private String name;
```

Menerima:

```java
""
"   "
```

Jika input berasal dari manusia, biasanya `@NotBlank` lebih tepat:

```java
@NotBlank
private String name;
```

Namun untuk field tertentu, empty string bisa valid.

Contoh:

- free text remarks boleh empty,
- optional middle name boleh empty setelah normalisasi,
- search keyword kosong berarti “no filter”,
- comment kosong tidak boleh karena action membutuhkan reason.

Jadi jangan otomatis mengganti semua `@NotNull String` menjadi `@NotBlank`. Pahami semantics.

---

## 7. Absence vs Explicit Null pada JSON

Di Java object biasa, setelah deserialization, field yang tidak dikirim dan field yang dikirim sebagai `null` bisa terlihat sama:

```json
{}
```

```json
{
  "phoneNumber": null
}
```

Keduanya bisa menjadi:

```java
request.getPhoneNumber() == null
```

Padahal semantics-nya berbeda:

| JSON | Makna Potensial |
|---|---|
| field absent | jangan ubah field tersebut |
| field null | hapus nilai field tersebut |
| field empty string | set menjadi empty string atau invalid |

Ini sangat penting untuk PATCH.

---

## 8. PUT vs PATCH: Nullability Contract yang Berbeda

### 8.1 PUT: Replace Resource

PUT biasanya berarti mengganti representasi resource secara penuh.

Contoh:

```http
PUT /applications/123/contact
Content-Type: application/json

{
  "email": "user@example.com",
  "phoneNumber": "+6512345678"
}
```

Jika `phoneNumber` tidak dikirim dalam PUT, tergantung contract API, bisa berarti:

- request invalid karena full representation tidak lengkap,
- field dianggap null/default,
- field tidak berubah, meskipun ini lebih mirip PATCH.

Untuk PUT yang benar-benar full replace, `@NotNull`/`@NotBlank` pada required field lebih masuk akal.

### 8.2 PATCH: Partial Modification

PATCH biasanya berarti hanya field yang dikirim yang diubah.

Contoh:

```http
PATCH /applications/123/contact
Content-Type: application/json

{
  "email": "new@example.com"
}
```

`phoneNumber` absent berarti tidak berubah.

Tapi:

```json
{
  "phoneNumber": null
}
```

bisa berarti hapus phone number.

Jika patch DTO seperti ini:

```java
public class UpdateContactPatchRequest {
    private String email;
    private String phoneNumber;
}
```

Java object tidak bisa membedakan absent vs explicit null kecuali deserialization layer menyimpan presence information.

---

## 9. Patch Model yang Benar: Presence-Aware Field

Untuk PATCH, sering dibutuhkan model yang bisa membedakan:

1. field tidak dikirim,
2. field dikirim dengan null,
3. field dikirim dengan value.

### 9.1 Tri-State Wrapper

Contoh konsep:

```java
public sealed interface PatchField<T> permits PatchField.Absent, PatchField.Present {

    record Absent<T>() implements PatchField<T> {}

    record Present<T>(T value) implements PatchField<T> {}

    static <T> PatchField<T> absent() {
        return new Absent<>();
    }

    static <T> PatchField<T> present(T value) {
        return new Present<>(value);
    }
}
```

Untuk Java 8, bisa memakai class biasa:

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

    public boolean isPresent() {
        return present;
    }

    public T getValue() {
        return value;
    }
}
```

Pemakaian:

```java
public class UpdateContactPatchRequest {
    private PatchField<String> email = PatchField.absent();
    private PatchField<String> phoneNumber = PatchField.absent();
}
```

Semantics:

| State | Meaning |
|---|---|
| `PatchField.absent()` | client tidak mengirim field |
| `PatchField.present(null)` | client mengirim null |
| `PatchField.present("abc")` | client mengirim value |

Dengan model seperti ini, validation bisa dibuat jauh lebih akurat.

### 9.2 Constraint pada Value, Bukan Wrapper

Untuk Jakarta Validation type-use constraint, idealnya:

```java
private PatchField<@Email String> email;
```

Tetapi agar ini bekerja, provider perlu tahu cara mengekstrak value dari `PatchField<T>`. Di Jakarta/Bean Validation, mekanisme ini disebut **ValueExtractor**.

Konsep ini akan dibahas detail pada part container element constraints. Untuk part ini, cukup pahami bahwa wrapper PATCH membutuhkan integrasi khusus jika ingin otomatis divalidasi oleh Bean Validation.

---

## 10. Optional: Bukan Jawaban Universal untuk Nullability

`java.util.Optional<T>` sering disalahgunakan sebagai field DTO/entity.

Contoh yang biasanya tidak ideal:

```java
public class ApplicantRequest {
    private Optional<String> email;
}
```

Masalah:

1. Banyak serializer/deserializer memperlakukan `Optional` dengan perilaku khusus.
2. Field `Optional` sendiri masih bisa null.
3. `Optional.empty()` tidak selalu membedakan absent vs explicit null dari JSON.
4. Entity dengan field `Optional` biasanya tidak natural untuk ORM.
5. `Optional` dirancang terutama sebagai return type, bukan field storage universal.

### 10.1 Optional sebagai Return Type

Baik:

```java
public Optional<EmailAddress> findEmailAddress() {
    return Optional.ofNullable(emailAddress);
}
```

Kurang baik:

```java
private Optional<EmailAddress> emailAddress;
```

### 10.2 Optional dalam Validation

Bean Validation 2.0 memperkenalkan dukungan container element constraints, sehingga konsep seperti ini dimungkinkan:

```java
private Optional<@Email String> email;
```

Maknanya:

> Jika Optional berisi value, value tersebut harus email valid.

Tetapi ini tidak otomatis berarti field `email` sendiri tidak boleh null.

Perlu dibedakan:

```java
@NotNull
private Optional<@Email String> email;
```

Artinya:

- field `email` tidak boleh null,
- tetapi boleh `Optional.empty()`,
- jika present, isinya harus email valid.

Ini subtle dan sering membingungkan reviewer.

### 10.3 Optional Tidak Mengganti Domain Modeling

Jika domain memiliki konsep “email belum diberikan”, mungkin lebih baik:

```java
public final class ContactInfo {
    private final EmailAddress emailAddress; // nullable internally, or represented by explicit type

    public Optional<EmailAddress> emailAddress() {
        return Optional.ofNullable(emailAddress);
    }
}
```

Atau explicit absence type:

```java
public sealed interface ContactEmailStatus {
    record NotProvided() implements ContactEmailStatus {}
    record Provided(EmailAddress value) implements ContactEmailStatus {}
    record NotApplicable(String reason) implements ContactEmailStatus {}
}
```

Untuk Java 8, gunakan interface + final classes.

---

## 11. Defaults: Default Value Bisa Menipu Validation

Default value sering digunakan untuk menghindari null.

```java
public class SearchRequest {
    private Integer page = 1;
    private Integer size = 20;
}
```

Ini bisa baik.

Tetapi default value bisa menyembunyikan input yang invalid atau absent.

### 11.1 Default di Field Initializer

```java
public class CreateUserRequest {
    private String role = "USER";
}
```

Jika client tidak mengirim role, role menjadi USER.

Pertanyaan:

- Apakah default role memang contract API?
- Apakah role default harus diberikan di backend, bukan DTO?
- Apakah client boleh mengirim null?
- Apakah null berarti gunakan default atau invalid?
- Apakah default bergantung tenant/agency/channel?

### 11.2 Default di Deserialization Layer

Jackson atau framework lain bisa memberi default secara implisit.

Risiko:

- validation tidak tahu field absent,
- audit tidak tahu client mengirim apa,
- business rule tidak bisa membedakan input user vs default sistem.

### 11.3 Default di Domain Factory

Sering lebih eksplisit:

```java
public final class UserRegistrationCommand {
    private final String username;
    private final Role role;

    private UserRegistrationCommand(String username, Role role) {
        this.username = username;
        this.role = role;
    }

    public static UserRegistrationCommand fromRequest(CreateUserRequest request) {
        Role role = request.getRole() == null ? Role.USER : Role.from(request.getRole());
        return new UserRegistrationCommand(request.getUsername(), role);
    }
}
```

Di sini defaulting menjadi keputusan aplikasi, bukan efek samping field initializer.

---

## 12. Requiredness Berdasarkan Actor, Channel, dan Workflow State

Dalam sistem sederhana, field required bersifat global.

Dalam sistem kompleks, field required bisa bergantung pada:

- action,
- role,
- channel,
- state,
- tenant,
- jurisdiction,
- feature flag,
- data source,
- migration batch,
- policy version.

Contoh:

| Field | Required When | Not Required When |
|---|---|---|
| `rejectionReason` | officer rejects application | officer approves application |
| `appealGround` | applicant submits appeal | draft appeal not submitted |
| `companyUen` | applicant type is company | applicant type is individual |
| `supportingDocument` | high-risk case | low-risk case |
| `effectiveDate` | final approval | draft assessment |
| `overrideReason` | admin override used | normal path |

Jika semua dipaksa menjadi field-level `@NotNull`, model akan penuh conditional hack.

---

## 13. Conditional Requiredness: Pilihan Desain

### 13.1 Class-Level Constraint

```java
@ValidCompanyApplicant
public class ApplicantRequest {
    private ApplicantType applicantType;
    private String companyUen;
    private String individualId;
}
```

Validator:

```java
public class ValidCompanyApplicantValidator
        implements ConstraintValidator<ValidCompanyApplicant, ApplicantRequest> {

    @Override
    public boolean isValid(ApplicantRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        if (value.getApplicantType() == ApplicantType.COMPANY) {
            return value.getCompanyUen() != null && !value.getCompanyUen().isBlank();
        }

        return true;
    }
}
```

Kelebihan:

- rule dekat dengan DTO,
- cocok untuk consistency dalam satu object,
- bisa menghasilkan violation ke field tertentu.

Kekurangan:

- bisa tumbuh menjadi validator besar,
- rawan mencampur workflow rule,
- sulit jika rule butuh database/context.

### 13.2 DTO Polymorphism

```java
public sealed interface ApplicantRequest permits CompanyApplicantRequest, IndividualApplicantRequest {
}

public record CompanyApplicantRequest(
        @NotBlank String companyName,
        @NotBlank String companyUen
) implements ApplicantRequest {
}

public record IndividualApplicantRequest(
        @NotBlank String fullName,
        @NotBlank String identityNumber
) implements ApplicantRequest {
}
```

Untuk Java 8:

```java
public interface ApplicantRequest {
}

public final class CompanyApplicantRequest implements ApplicantRequest {
    @NotBlank
    private String companyName;

    @NotBlank
    private String companyUen;
}

public final class IndividualApplicantRequest implements ApplicantRequest {
    @NotBlank
    private String fullName;

    @NotBlank
    private String identityNumber;
}
```

Kelebihan:

- shape contract eksplisit,
- requiredness melekat pada subtype,
- lebih mudah dipahami.

Kekurangan:

- membutuhkan discriminator/deserialization strategy,
- API schema lebih kompleks,
- mapping perlu lebih matang.

### 13.3 Domain Policy

```java
public final class ApplicantPolicy {
    public ValidationResult validate(Applicant applicant) {
        if (applicant.isCompany() && applicant.companyUenMissing()) {
            return ValidationResult.error("COMPANY_UEN_REQUIRED");
        }
        return ValidationResult.ok();
    }
}
```

Kelebihan:

- cocok untuk business rule,
- bisa versioned,
- bisa auditable,
- bisa menghasilkan explanation.

Kekurangan:

- tidak otomatis dieksekusi framework,
- perlu orchestration eksplisit.

---

## 14. Domain Absence: Ketika `null` Terlalu Miskin Makna

Dalam domain penting, absence sering perlu dimodelkan secara eksplisit.

Contoh buruk:

```java
public class Assessment {
    private LocalDate dueDate; // null means what?
}
```

Apa arti `dueDate == null`?

- Belum dihitung?
- Tidak ada deadline?
- Case exempted?
- Data corrupt?
- Belum dimigrasi?
- User tidak punya permission?

Model lebih baik:

```java
public sealed interface DueDateStatus {
    record NotCalculated() implements DueDateStatus {}
    record NotApplicable(String reason) implements DueDateStatus {}
    record Available(LocalDate dueDate) implements DueDateStatus {}
}
```

Java 8 style:

```java
public interface DueDateStatus {
}

public final class NotCalculated implements DueDateStatus {
}

public final class NotApplicable implements DueDateStatus {
    private final String reason;

    public NotApplicable(String reason) {
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}

public final class AvailableDueDate implements DueDateStatus {
    private final LocalDate dueDate;

    public AvailableDueDate(LocalDate dueDate) {
        if (dueDate == null) {
            throw new IllegalArgumentException("dueDate must not be null");
        }
        this.dueDate = dueDate;
    }

    public LocalDate dueDate() {
        return dueDate;
    }
}
```

Validation menjadi lebih meaningful:

```java
public final class AvailableDueDate implements DueDateStatus {
    @NotNull
    private final LocalDate dueDate;
}
```

Di sini `@NotNull` benar karena `AvailableDueDate` tanpa `dueDate` tidak masuk akal.

---

## 15. DTO Nullability vs Domain Nullability vs Database Nullability

Jangan samakan tiga layer ini.

### 15.1 DTO Nullability

DTO merepresentasikan input/output contract.

Field DTO boleh nullable jika:

- optional dari perspektif API,
- absent diperbolehkan,
- field hanya required pada operasi lain,
- field diisi sistem setelah request,
- patch semantics membutuhkan absent.

### 15.2 Domain Nullability

Domain object seharusnya lebih kuat.

Jika object sudah berada dalam state `SubmittedApplication`, maka field yang wajib untuk submitted state idealnya tidak nullable.

```java
public final class SubmittedApplication {
    private final ApplicantName applicantName;
    private final LicenseType licenseType;
    private final LocalDate submittedAt;

    public SubmittedApplication(
            ApplicantName applicantName,
            LicenseType licenseType,
            LocalDate submittedAt
    ) {
        this.applicantName = Objects.requireNonNull(applicantName);
        this.licenseType = Objects.requireNonNull(licenseType);
        this.submittedAt = Objects.requireNonNull(submittedAt);
    }
}
```

DTO bisa longgar, domain submitted state harus ketat.

### 15.3 Database Nullability

Database constraint adalah final consistency guard.

Tetapi database nullable bisa berbeda karena:

- single table menyimpan banyak states,
- legacy data,
- staged migration,
- polymorphic data,
- optional relationship,
- soft delete,
- draft vs submitted dalam satu table.

Contoh:

```sql
APPLICATION.EFFECTIVE_DATE nullable
```

bukan berarti domain submitted application boleh tanpa effective date.

Bisa saja database nullable karena draft application belum punya value.

Solusi:

- gunakan state-specific domain object,
- gunakan DB check constraint jika memungkinkan,
- gunakan partial constraint/index jika database mendukung,
- gunakan application-level workflow guard.

---

## 16. Java 8 sampai Java 25: Evolusi Modeling Nullability

### 16.1 Java 8

Fitur relevan:

- `Optional`,
- type annotations,
- Bean Validation 2.0 later supports type-use/container element constraints,
- belum ada records,
- belum ada sealed classes.

Modeling biasanya memakai:

- POJO DTO,
- immutable class manual,
- builder,
- marker interface,
- explicit wrapper class.

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        this.value = value;
    }
}
```

### 16.2 Java 11

Tidak banyak perubahan spesifik nullability, tetapi ecosystem mulai stabil untuk:

- Bean Validation 2.0,
- Spring Boot 2.x,
- Hibernate Validator 6.x,
- Java 8 date/time API validation.

### 16.3 Java 17

Java 17 penting karena:

- baseline banyak framework modern,
- sealed classes available,
- records stable,
- Jakarta EE 11/Jakarta Validation 3.1 minimum Java 17.

Modeling absence menjadi lebih ekspresif:

```java
public sealed interface DocumentRequirement permits Required, OptionalRequirement, NotApplicable {
}

public record Required(String documentType) implements DocumentRequirement {
    public Required {
        Objects.requireNonNull(documentType);
    }
}

public record OptionalRequirement(String documentType) implements DocumentRequirement {
}

public record NotApplicable(String reason) implements DocumentRequirement {
}
```

### 16.4 Java 21

Java 21 sebagai LTS modern sering menjadi target production.

Dengan records, sealed types, pattern matching, dan virtual threads, strategi validation bisa lebih jelas:

- request DTO tetap bisa records,
- domain state bisa sealed hierarchy,
- nullability bisa dipersempit di domain boundary,
- validation tidak perlu blocking I/O dalam constraint validator, apalagi di hot path.

### 16.5 Java 25

Java 25 sebagai target terbaru perlu diperlakukan dengan prinsip yang sama:

- gunakan type system lebih kuat,
- jangan membawa null ambiguity ke domain core,
- validation tetap boundary contract,
- `@NotNull` tetap bukan pengganti modeling.

---

## 17. Pattern: Boundary DTO Longgar, Domain Command Ketat

Pattern yang sering sehat:

1. API menerima DTO yang sesuai contract transport.
2. DTO divalidasi untuk shape minimal.
3. DTO diubah menjadi command.
4. Command melakukan normalization/defaulting.
5. Command/domain policy memvalidasi semantic rule.
6. Domain object menjaga invariant ketat.

### 17.1 Contoh

Transport DTO:

```java
public class SaveDraftApplicationRequest {
    private String applicantName;
    private String licenseType;
    private String effectiveDate;
}
```

Submit DTO:

```java
public class SubmitApplicationRequest {
    @NotBlank
    private String applicantName;

    @NotBlank
    private String licenseType;

    @NotNull
    private LocalDate effectiveDate;
}
```

Command:

```java
public final class SubmitApplicationCommand {
    private final ApplicantName applicantName;
    private final LicenseType licenseType;
    private final LocalDate effectiveDate;

    public SubmitApplicationCommand(
            ApplicantName applicantName,
            LicenseType licenseType,
            LocalDate effectiveDate
    ) {
        this.applicantName = Objects.requireNonNull(applicantName);
        this.licenseType = Objects.requireNonNull(licenseType);
        this.effectiveDate = Objects.requireNonNull(effectiveDate);
    }
}
```

Domain:

```java
public final class SubmittedApplication {
    private final ApplicationId id;
    private final ApplicantName applicantName;
    private final LicenseType licenseType;
    private final LocalDate effectiveDate;

    public SubmittedApplication(
            ApplicationId id,
            ApplicantName applicantName,
            LicenseType licenseType,
            LocalDate effectiveDate
    ) {
        this.id = Objects.requireNonNull(id);
        this.applicantName = Objects.requireNonNull(applicantName);
        this.licenseType = Objects.requireNonNull(licenseType);
        this.effectiveDate = Objects.requireNonNull(effectiveDate);
    }
}
```

Kuncinya:

> Semakin masuk ke domain core, semakin sedikit ambiguity yang boleh tersisa.

---

## 18. Pattern: State-Specific Type untuk Menghindari Nullable State Explosion

Buruk:

```java
public class Application {
    private String status;
    private String applicantName;
    private String licenseType;
    private LocalDate submittedAt;
    private LocalDate approvedAt;
    private String rejectionReason;
}
```

Masalah:

- Jika `status = DRAFT`, field apa yang boleh null?
- Jika `status = SUBMITTED`, field apa yang wajib non-null?
- Jika `status = REJECTED`, `approvedAt` null valid atau tidak?
- Jika `rejectionReason` null, apakah bug?

Lebih baik:

```java
public sealed interface ApplicationState permits DraftApplication, SubmittedApplication, ApprovedApplication, RejectedApplication {
}

public record DraftApplication(
        ApplicationId id,
        Optional<ApplicantName> applicantName
) implements ApplicationState {
}

public record SubmittedApplication(
        ApplicationId id,
        ApplicantName applicantName,
        LicenseType licenseType,
        LocalDate submittedAt
) implements ApplicationState {
}

public record ApprovedApplication(
        ApplicationId id,
        ApplicantName applicantName,
        LicenseType licenseType,
        LocalDate submittedAt,
        LocalDate approvedAt
) implements ApplicationState {
}

public record RejectedApplication(
        ApplicationId id,
        ApplicantName applicantName,
        LicenseType licenseType,
        LocalDate submittedAt,
        String rejectionReason
) implements ApplicationState {
}
```

Dalam Java 8, gunakan interface + final classes.

Bean Validation bisa digunakan di tiap subtype:

```java
public record RejectedApplication(
        @NotNull ApplicationId id,
        @NotNull ApplicantName applicantName,
        @NotNull LicenseType licenseType,
        @NotNull LocalDate submittedAt,
        @NotBlank String rejectionReason
) implements ApplicationState {
}
```

Rule menjadi jelas:

- `RejectedApplication` tanpa `rejectionReason` invalid.
- `ApprovedApplication` tanpa `approvedAt` invalid.
- `DraftApplication` boleh belum lengkap.

Ini jauh lebih kuat daripada satu class besar dengan banyak nullable fields.

---

## 19. Validation Groups untuk Nullability: Gunakan Secukupnya

Validation groups cocok jika variasi requiredness kecil dan stabil.

Contoh:

```java
public interface OnCreate {}
public interface OnSubmit {}
```

```java
public class ApplicationRequest {
    @NotBlank(groups = OnSubmit.class)
    private String applicantName;

    @NotBlank(groups = OnSubmit.class)
    private String licenseType;

    @NotNull(groups = OnSubmit.class)
    private LocalDate effectiveDate;
}
```

Eksekusi:

```java
Set<ConstraintViolation<ApplicationRequest>> violations =
        validator.validate(request, OnSubmit.class);
```

Tetapi hindari group seperti ini:

```java
interface Draft {}
interface Submitted {}
interface Approved {}
interface Rejected {}
interface Officer {}
interface Admin {}
interface Appeal {}
interface Renewal {}
interface HighRisk {}
interface LowRisk {}
interface ManualOverride {}
interface Imported {}
```

Jika sudah begini, group menjadi sulit diprediksi.

### 19.1 Heuristic

Gunakan group jika:

- variasi rule sedikit,
- operasi jelas,
- rule tetap field/object shape,
- tidak butuh database/context,
- tidak butuh audit/evidence kompleks.

Jangan gunakan group jika:

- rule adalah workflow transition,
- rule berubah berdasarkan role/channel/state kompleks,
- rule butuh data eksternal,
- rule perlu versioning/audit,
- rule punya severity/remediation.

---

## 20. `@NotNull` pada Primitive vs Wrapper

Java primitive tidak bisa null.

```java
private int age;
```

`age` default-nya `0`.

Jika `0` bukan value valid, constraint harus menyatakan boundary:

```java
@Positive
private int age;
```

Tetapi untuk input API, primitive bisa berbahaya:

```java
public class CreatePersonRequest {
    private int age;
}
```

Jika client tidak mengirim `age`, deserializer bisa menghasilkan `0`.

Maka sistem tidak bisa membedakan:

- client mengirim `0`,
- client tidak mengirim age.

Untuk request DTO, sering lebih baik memakai wrapper:

```java
public class CreatePersonRequest {
    @NotNull
    @Positive
    private Integer age;
}
```

Ini memungkinkan validation membedakan missing/null dari angka invalid.

Rule:

> Untuk input DTO, gunakan wrapper type jika absence perlu dideteksi.

---

## 21. `@NotNull` pada Collection

```java
@NotNull
private List<String> tags;
```

Artinya list tidak boleh null.

Tapi list kosong valid.

Jika list wajib berisi minimal satu element:

```java
@NotEmpty
private List<String> tags;
```

Jika setiap element wajib tidak blank:

```java
@NotEmpty
private List<@NotBlank String> tags;
```

Jika list boleh absent tetapi jika ada tidak boleh kosong:

```java
@Size(min = 1)
private List<@NotBlank String> tags;
```

Karena banyak constraint menganggap null valid, `@Size(min = 1)` saja biasanya berarti:

- null valid,
- empty invalid,
- non-empty valid jika element constraints lolos.

Ini subtle tetapi sangat berguna.

---

## 22. `@NotNull` pada Map Key dan Value

Dengan container element constraints:

```java
private Map<@NotBlank String, @NotNull Object> attributes;
```

Makna:

- key map tidak boleh blank,
- value tidak boleh null.

Jika map itu sendiri wajib ada:

```java
@NotNull
private Map<@NotBlank String, @NotNull Object> attributes;
```

Jika map wajib tidak kosong:

```java
@NotEmpty
private Map<@NotBlank String, @NotNull Object> attributes;
```

Perhatikan bahwa constraint pada map dan constraint pada element adalah dua hal berbeda.

---

## 23. Normalization Sebelum atau Sesudah Validation?

Contoh input:

```json
{
  "name": "   Acme Pte Ltd   "
}
```

Apakah validasi dilakukan sebelum trim atau sesudah trim?

Jika sebelum:

```java
@NotBlank
private String name;
```

valid.

Jika sesudah trim, value menjadi:

```java
"Acme Pte Ltd"
```

juga valid.

Tapi untuk:

```json
{
  "name": "   "
}
```

`@NotBlank` akan gagal bahkan sebelum trim.

### 23.1 Prinsip

Pisahkan:

1. parsing,
2. normalization aman,
3. validation,
4. transformation ke domain.

Contoh normalization aman:

- trim leading/trailing space untuk field tertentu,
- convert empty string to null untuk optional field tertentu,
- normalize Unicode form jika dibutuhkan,
- uppercase code field,
- remove formatting dash dari identifier jika contract mengizinkan.

Tetapi jangan melakukan normalization yang mengubah makna tanpa audit.

Contoh berbahaya:

- silently truncating long input,
- replacing invalid character tanpa memberi tahu user,
- defaulting role dari ADMIN ke USER,
- menghapus unknown fields tanpa policy.

---

## 24. Empty String to Null: Berguna tapi Berbahaya

Banyak sistem melakukan:

```java
if (value != null && value.trim().isEmpty()) {
    value = null;
}
```

Ini bisa menyederhanakan domain.

Tetapi hati-hati.

Untuk beberapa field, empty string berbeda dari null:

- search keyword empty = no filter,
- remarks empty = user intentionally leaves blank,
- optional description empty = allowed,
- password empty = invalid,
- patch field empty = set to empty or clear?

Rule:

> Jangan punya global “empty string to null” tanpa field-level semantics.

Lebih baik buat normalizer eksplisit:

```java
public final class InputNormalizer {
    public static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static String trimPreserveEmpty(String value) {
        return value == null ? null : value.trim();
    }
}
```

Lalu gunakan sesuai field contract.

---

## 25. API Error Contract untuk Nullability

Error untuk nullability harus machine-readable.

Buruk:

```json
{
  "message": "must not be null"
}
```

Lebih baik:

```json
{
  "errors": [
    {
      "path": "effectiveDate",
      "code": "EFFECTIVE_DATE_REQUIRED",
      "constraint": "NotNull",
      "message": "Effective date is required.",
      "rejectedValue": null
    }
  ]
}
```

Untuk PATCH, error harus lebih spesifik:

```json
{
  "errors": [
    {
      "path": "phoneNumber",
      "code": "PHONE_NUMBER_CANNOT_BE_CLEARED",
      "message": "Phone number cannot be removed after submission."
    }
  ]
}
```

Perhatikan: error kedua bukan sekadar `@NotNull`. Itu workflow/state rule.

---

## 26. PII dan Nullability Error

Jangan asal mengembalikan rejected value.

Contoh berbahaya:

```json
{
  "path": "identityNumber",
  "code": "INVALID_IDENTITY_NUMBER",
  "rejectedValue": "S1234567D"
}
```

Untuk nullability, rejected value biasanya null dan aman. Tapi pipeline error yang sama bisa dipakai untuk field sensitif lain.

Strategi:

- whitelist rejected value hanya untuk field aman,
- mask field sensitif,
- jangan log full request payload,
- gunakan correlation id,
- simpan error code dan path,
- hindari message yang membocorkan policy internal.

---

## 27. Database Constraint dan Nullability Race

Application-level `@NotNull` bukan pengganti database `NOT NULL`.

Jika column benar-benar wajib secara persistence, database harus ikut menjaga:

```sql
ALTER TABLE application
MODIFY applicant_name NOT NULL;
```

Tetapi jangan asal menjadikan semua column `NOT NULL` jika table menyimpan multi-state lifecycle.

Contoh:

```sql
application(
  id,
  status,
  applicant_name,
  submitted_at,
  approved_at,
  rejection_reason
)
```

`approved_at` hanya wajib jika status `APPROVED`.

`rejection_reason` hanya wajib jika status `REJECTED`.

Jika database mendukung check constraint:

```sql
CHECK (
  status <> 'REJECTED'
  OR rejection_reason IS NOT NULL
)
```

Ini jauh lebih tepat daripada menjadikan `rejection_reason NOT NULL` global.

Namun perlu dipertimbangkan:

- legacy data,
- migration strategy,
- partial rollout,
- application compatibility,
- data repair.

---

## 28. Nullability dan Backward Compatibility API

Mengubah field dari optional menjadi required adalah breaking change.

Contoh v1:

```json
{
  "name": "Acme"
}
```

v2 tiba-tiba mewajibkan:

```json
{
  "name": "Acme",
  "industryCode": "6201"
}
```

Client lama akan gagal.

Strategi rollout:

1. Tambahkan field sebagai optional.
2. Observasi adoption.
3. Beri warning jika field missing.
4. Dokumentasikan enforcement date.
5. Mulai hard validation untuk client/version tertentu.
6. Setelah semua client comply, jadikan required secara umum.

Validation bukan hanya code change, tapi contract change.

---

## 29. Nullability dan Migration Data Lama

Menambahkan `@NotNull` ke entity yang sudah punya data lama bisa menimbulkan failure mendadak.

Contoh:

```java
@Entity
public class ApplicationEntity {
    @NotNull
    private String applicantName;
}
```

Jika ada row lama dengan `applicant_name = null`, maka update entity tersebut bisa gagal meskipun user tidak menyentuh field itu.

Strategi:

- data profiling sebelum constraint,
- backfill,
- soft validation dulu,
- DB constraint setelah data bersih,
- migration script dengan report,
- exception handling untuk legacy record.

Jangan menambahkan `@NotNull` ke entity produksi tanpa memahami data existing.

---

## 30. Nullability dan Lazy Loading

Pada entity ORM, nullability bisa bercampur dengan lazy loading.

```java
@ManyToOne(fetch = FetchType.LAZY)
@NotNull
private Applicant applicant;
```

Pertanyaan:

- Apakah validation akan memicu proxy initialization?
- Apakah association wajib secara DB?
- Apakah validasi entity dilakukan saat persist/update?
- Apakah object graph cascade akan memvalidasi applicant penuh?

Untuk association, sering lebih baik menjaga wajibnya relasi di DB FK/NOT NULL dan domain constructor, bukan mengandalkan cascade validation entity graph.

Part persistence nanti akan membahas ini lebih dalam.

---

## 31. Nullability dan Records

Java records membuat DTO immutable lebih ringkas.

```java
public record CreateUserRequest(
        @NotBlank String username,
        @NotBlank String email
) {
}
```

Constraint ditempelkan pada record component.

Tetapi record constructor tidak otomatis memanggil Bean Validation.

Artinya:

```java
new CreateUserRequest(null, null)
```

akan tetap membuat object kecuali:

- validation framework dipanggil,
- constructor melakukan manual check,
- framework integration memvalidasi request.

Jika domain record harus selalu valid bahkan saat dibuat langsung, gunakan compact constructor:

```java
public record EmailAddress(String value) {
    public EmailAddress {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
    }
}
```

Bean Validation cocok untuk boundary validation. Constructor guard cocok untuk domain invariant yang tidak boleh dilanggar kapan pun.

---

## 32. Nullability dan Builder

Builder sering menciptakan object partially initialized.

```java
User user = User.builder()
        .username("fajar")
        .build();
```

Apakah email required?

Jika required, kapan gagal?

- saat `build()`,
- saat Bean Validation dipanggil,
- saat persist,
- saat domain method dipanggil?

Untuk domain object, lebih baik `build()` menjaga invariant:

```java
public User build() {
    if (username == null || username.isBlank()) {
        throw new IllegalStateException("username is required");
    }
    if (email == null) {
        throw new IllegalStateException("email is required");
    }
    return new User(username, email);
}
```

Untuk DTO, builder boleh lebih longgar jika validation dilakukan setelah deserialization.

---

## 33. Nullability Decision Matrix

Gunakan matriks ini saat review desain.

| Pertanyaan | Jika Ya | Implikasi |
|---|---|---|
| Field wajib untuk semua operasi? | Ya | `@NotNull`/`@NotBlank` di DTO mungkin tepat |
| Field hanya wajib saat submit? | Ya | gunakan submit DTO, group, atau policy |
| Field boleh tidak dikirim saat PATCH? | Ya | jangan pakai field nullable biasa tanpa presence tracking |
| Null berarti clear value? | Ya | perlu explicit semantics dan authorization |
| Empty string valid? | Ya | jangan pakai `@NotBlank` |
| Empty string harus dianggap null? | Ya | normalizer field-specific |
| Field diisi sistem? | Ya | validasi setelah enrichment atau domain factory |
| Field bergantung state? | Ya | state-specific type atau workflow guard |
| Field bergantung role/channel? | Ya | policy validator, bukan sekadar annotation |
| Field sensitif? | Ya | jangan expose rejected value |
| Field punya legacy null data? | Ya | migration/backfill sebelum hard constraint |
| Field wajib di DB? | Ya | tambahkan DB constraint juga jika sesuai |

---

## 34. Review Checklist untuk `@NotNull`

Sebelum menerima PR yang menambahkan `@NotNull`, tanyakan:

1. Di operasi apa field ini wajib?
2. Apakah DTO dipakai untuk lebih dari satu operasi?
3. Apakah field boleh absent pada PATCH?
4. Apakah null berarti clear, unknown, not applicable, atau invalid?
5. Apakah ada default value?
6. Apakah default diberikan sebelum atau sesudah validation?
7. Apakah data lama punya null?
8. Apakah database constraint sudah sesuai?
9. Apakah error code stabil?
10. Apakah perubahan ini breaking change untuk client?
11. Apakah field sensitif akan bocor di error response/log?
12. Apakah rule ini sebenarnya workflow/business rule?
13. Apakah `@NotBlank` lebih tepat dari `@NotNull`?
14. Apakah wrapper primitive lebih tepat dari primitive?
15. Apakah state-specific type lebih tepat dari nullable field?

---

## 35. Anti-Patterns

### 35.1 One DTO for Everything

```java
public class ApplicationDto {
    @NotNull
    private String applicantName;
    @NotNull
    private String rejectionReason;
    @NotNull
    private LocalDate approvedAt;
}
```

Dipakai untuk draft, submit, approve, reject, read response, import, dan admin edit.

Ini hampir pasti salah.

### 35.2 `@NotNull` untuk Business Workflow

```java
@NotNull(groups = Rejected.class)
private String rejectionReason;
```

Bisa benar untuk shape, tetapi jika rejection reason bergantung role, override, case type, dan policy version, lebih baik workflow guard/policy object.

### 35.3 Primitive pada Request DTO

```java
private int priority;
```

Missing input menjadi `0`.

Gunakan:

```java
@NotNull
@Min(1)
private Integer priority;
```

### 35.4 Optional Field sebagai Entity Field

```java
@Entity
public class UserEntity {
    private Optional<String> email;
}
```

Biasanya buruk untuk ORM/persistence.

### 35.5 Global Empty String to Null

Semua empty string diubah jadi null tanpa field semantics.

Ini bisa menghancurkan PATCH semantics dan auditability.

### 35.6 Treating Database Nullable as Domain Optional

Column nullable tidak selalu berarti domain optional. Bisa saja nullable karena draft/migration/polymorphism.

### 35.7 Treating Domain Required as DTO Required

Domain submitted object wajib lengkap, tetapi draft DTO belum tentu.

---

## 36. Practical Design Examples

### 36.1 Create Request

```java
public class CreateApplicationRequest {
    @NotBlank
    private String applicantName;

    @NotBlank
    private String licenseType;

    private String remarks;
}
```

Makna:

- `applicantName` wajib dan tidak blank,
- `licenseType` wajib dan tidak blank,
- `remarks` optional.

### 36.2 Save Draft Request

```java
public class SaveApplicationDraftRequest {
    private String applicantName;
    private String licenseType;
    private LocalDate intendedStartDate;
}
```

Makna:

- semua field boleh belum ada,
- rule completeness dilakukan saat submit.

### 36.3 Submit Request

```java
public class SubmitApplicationRequest {
    @NotBlank
    private String applicantName;

    @NotBlank
    private String licenseType;

    @NotNull
    private LocalDate intendedStartDate;
}
```

Makna:

- submit butuh data lengkap.

### 36.4 Patch Request dengan Presence Tracking

```java
public class PatchApplicationRequest {
    private PatchField<String> applicantName = PatchField.absent();
    private PatchField<String> remarks = PatchField.absent();
}
```

Makna:

- absent = tidak berubah,
- present null = clear jika allowed,
- present value = update.

### 36.5 Domain Object

```java
public final class SubmittedApplication {
    private final ApplicantName applicantName;
    private final LicenseType licenseType;
    private final LocalDate intendedStartDate;

    public SubmittedApplication(
            ApplicantName applicantName,
            LicenseType licenseType,
            LocalDate intendedStartDate
    ) {
        this.applicantName = Objects.requireNonNull(applicantName);
        this.licenseType = Objects.requireNonNull(licenseType);
        this.intendedStartDate = Objects.requireNonNull(intendedStartDate);
    }
}
```

Makna:

- setelah menjadi submitted, tidak ada lagi ambiguity.

---

## 37. Production Rule: Validation Boundary Harus Jelas

Untuk nullability, tentukan boundary:

| Boundary | Nullability Strategy |
|---|---|
| HTTP JSON request | distinguish missing/null if needed |
| DTO | reflect API contract |
| Command | normalize/default/parse |
| Domain object | minimize null, enforce invariant |
| Workflow guard | validate state/role/action requiredness |
| Persistence | DB constraints for final consistency |
| Event payload | version-aware optional/required fields |
| API response | avoid ambiguous missing/null fields |

Jangan biarkan nullability “mengalir begitu saja” dari JSON sampai database.

Setiap boundary harus secara sadar memutuskan:

- value ini absent atau null?
- null boleh lewat atau ditolak?
- null akan di-default atau tetap null?
- null berarti apa di domain?
- null disimpan atau tidak?

---

## 38. Advanced Insight: `@NotNull` adalah Local Invariant, Bukan Contextual Truth

`@NotNull` paling cocok untuk local invariant:

```java
public record Money(
        @NotNull BigDecimal amount,
        @NotNull Currency currency
) {
}
```

`Money` tanpa amount/currency tidak masuk akal.

Tetapi `@NotNull` kurang cocok untuk contextual truth:

```java
public class Application {
    @NotNull
    private LocalDate approvedAt;
}
```

Karena `approvedAt` hanya wajib jika application sudah approved.

Maka desain lebih baik:

```java
public record ApprovedApplication(
        @NotNull LocalDate approvedAt
) {
}
```

atau workflow guard:

```java
if (application.status() == APPROVED && application.approvedAt() == null) {
    result.add("APPROVED_AT_REQUIRED");
}
```

Rule ringkas:

> Gunakan `@NotNull` ketika non-null adalah kebenaran lokal dari type tersebut. Gunakan policy/workflow ketika non-null bergantung konteks.

---

## 39. What Top 1% Engineers Do Differently

Engineer biasa:

```java
@NotNull
private String field;
```

Engineer kuat bertanya:

- Field ini wajib di boundary mana?
- Apakah request bisa partial?
- Apakah null dan absent berbeda?
- Apakah blank valid?
- Apakah empty harus dinormalisasi?
- Apakah domain type bisa menghilangkan null?
- Apakah state-specific type lebih tepat?
- Apakah validation group cukup atau akan menjadi workflow tersembunyi?
- Apakah database constraint sesuai?
- Apakah error code stabil?
- Apakah perubahan ini breaking untuk client?
- Apakah data lama aman?
- Apakah rule ini butuh audit/evidence?

Top-tier validation design bukan tentang menambahkan annotation sebanyak mungkin.

Top-tier validation design adalah membuat **meaning explicit**, **boundary clear**, dan **invalid state sulit terbentuk**.

---

## 40. Ringkasan

Hal-hal paling penting dari part ini:

1. `null` punya banyak makna domain; jangan disederhanakan terlalu cepat.
2. `@NotNull` hanya berarti value tidak boleh null, bukan “field ini selalu required dalam semua konteks business”.
3. Banyak constraint menganggap null valid; kombinasikan dengan `@NotNull`, `@NotBlank`, atau `@NotEmpty` jika required.
4. Requiredness sering bergantung operasi, bukan field global.
5. PUT dan PATCH membutuhkan nullability contract yang berbeda.
6. PATCH sering butuh presence-aware model untuk membedakan absent vs explicit null.
7. `Optional` bukan solusi universal untuk field nullability.
8. Primitive di request DTO bisa menyembunyikan missing input.
9. Domain object sebaiknya mengurangi ambiguity dan menjaga invariant ketat.
10. Database nullability, DTO nullability, dan domain nullability tidak selalu sama.
11. Conditional requiredness lebih cocok ditangani oleh class-level constraint, polymorphic DTO, state-specific type, atau policy object tergantung kompleksitas.
12. Mengubah optional menjadi required adalah API breaking change.
13. Nullability harus dipikirkan bersama migration, observability, API error contract, dan auditability.

---

## 41. Checklist Praktis Sebelum Mendesain Field Baru

Untuk setiap field baru, jawab:

```text
1. Field ini berasal dari user, sistem, database, atau external system?
2. Apakah field boleh tidak dikirim?
3. Apakah field boleh dikirim null?
4. Apakah null berarti clear, unknown, not applicable, atau invalid?
5. Apakah empty string valid?
6. Apakah blank string valid?
7. Apakah ada default?
8. Siapa yang memberi default?
9. Kapan default diberikan?
10. Apakah field wajib di semua operasi?
11. Apakah field wajib hanya di state/action tertentu?
12. Apakah field perlu presence tracking untuk PATCH?
13. Apakah field perlu domain wrapper/value object?
14. Apakah field perlu database constraint?
15. Apakah ada data lama yang melanggar rule baru?
16. Apakah perubahan ini breaking untuk client?
17. Apa stable error code untuk violation field ini?
18. Apakah rejected value aman ditampilkan/log?
```

Jika belum bisa menjawab ini, jangan buru-buru menambahkan `@NotNull`.

---

## 42. Referensi Resmi

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Jakarta Validation API 3.1 `jakarta.validation.constraints`: https://jakarta.ee/specifications/bean-validation/3.1/apidocs/jakarta/validation/constraints/package-summary
- Jakarta Validation API 3.1 `@NotNull`: https://jakarta.ee/specifications/bean-validation/3.1/apidocs/jakarta/validation/constraints/notnull
- Bean Validation 2.0 Specification: https://beanvalidation.org/2.0/spec/
- Bean Validation 2.0 release notes: https://beanvalidation.org/news/2017/08/07/bean-validation-2-0-is-a-spec/
- Hibernate Validator stable reference guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator project: https://hibernate.org/validator/

---

## 43. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence

Part berikutnya:

- Part 005 — Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-003.md">⬅️ in Constraints Deep Dive: Semantics, Edge Cases, and Misuse</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-005.md">Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control ➡️</a>
</div>

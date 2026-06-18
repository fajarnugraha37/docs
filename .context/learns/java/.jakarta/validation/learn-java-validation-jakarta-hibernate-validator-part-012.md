# learn-java-validation-jakarta-hibernate-validator-part-012

# Records, Immutability, Builders, Lombok, and Modern Java Modeling

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `012`  
> Fokus: bagaimana Jakarta/Bean Validation ditempatkan secara benar pada model Java modern: records, immutable DTO, constructor invariants, builders, Lombok, sealed hierarchy, dan strategi lintas Java 8 sampai Java 25.

---

## 0. Posisi Bagian Ini

Bagian sebelumnya membahas executable validation: method, constructor, parameter, return value, dan cross-parameter constraint. Bagian ini membahas pertanyaan desain yang lebih fundamental:

> Jika object sekarang bisa dibuat immutable dengan record, builder, value object, dan sealed hierarchy, apakah validation masih cukup dengan annotation?

Jawaban singkatnya: **tidak selalu**.

Jakarta Validation sangat kuat sebagai contract declaration dan boundary validation. Tetapi domain correctness yang serius membutuhkan desain object lifecycle: kapan object boleh invalid sementara, kapan invalid object tidak boleh pernah eksis, dan kapan rule harus diekspresikan sebagai policy/workflow guard, bukan annotation.

---

## 1. Baseline Versi dan Fakta Spesifikasi

Jakarta Validation 3.1 adalah release untuk Jakarta EE 11. Spesifikasi ini mendefinisikan metadata model dan API untuk JavaBean dan method validation, serta menyebut klarifikasi dukungan Java Records. Java Records sendiri diperkenalkan final di Java melalui JEP 395. Jakarta Validation 3.1 juga menaikkan minimum Java version menjadi 17. Hibernate Validator 9.x mengimplementasikan Jakarta Validation 3.1 dan menargetkan Jakarta EE 11.

Implikasi praktis:

| Target | Umum Dipakai | Namespace | Catatan |
|---|---|---|---|
| Java 8 | Bean Validation 2.0, Hibernate Validator 6.x | `javax.validation` | Ada container element constraints, belum ada records |
| Java 11 | BV 2.0 / Jakarta Validation 3.0 tergantung stack | `javax` atau `jakarta` | Masa transisi banyak enterprise |
| Java 17 | Jakarta Validation 3.0/3.1, HV 8/9 | `jakarta.validation` | Records dan sealed classes realistis |
| Java 21 | Jakarta stack modern | `jakarta.validation` | Records/sealed/pattern matching matang untuk enterprise |
| Java 25 | Modern Java | `jakarta.validation` | Prinsip sama: immutable modeling + explicit invariant |

---

## 2. Mental Model: Empat Jenis Object yang Tidak Boleh Dicampur

Banyak desain validation buruk muncul karena satu class dipaksa menjadi semuanya: request DTO, command, domain model, entity, dan response.

Model yang lebih sehat:

```text
Inbound payload / DTO
    ↓ validate shape and input contract
Command object
    ↓ validate operation intent
Domain object / value object
    ↓ enforce invariant
Persistence entity / projection
    ↓ preserve database mapping and storage lifecycle
```

### 2.1 Inbound DTO

DTO mewakili input eksternal. DTO boleh sementara invalid setelah deserialization karena tugasnya adalah menangkap input user, lalu menghasilkan daftar violation yang bisa dikembalikan ke client.

```java
public record CreateApplicantRequest(
        @NotBlank String name,
        @Email String email,
        @NotBlank String postalCode
) {}
```

DTO cocok memakai Jakarta Validation karena:

- error bisa dikumpulkan sekaligus,
- path error bisa dipetakan ke field UI,
- constraint menjadi bagian dari API contract,
- framework seperti Spring/JAX-RS dapat memanggil validator otomatis.

### 2.2 Command Object

Command merepresentasikan intensi operasi setelah input lebih bersih.

```java
public record SubmitApplicationCommand(
        ApplicationId applicationId,
        OfficerId submittedBy,
        SubmissionChannel channel,
        Instant submittedAt
) {}
```

Command biasanya sudah tidak berisi raw string sebebas DTO. ID sudah diparse, actor sudah diketahui, channel sudah explicit, dan timestamp biasanya dari server.

### 2.3 Domain Object / Value Object

Domain object harus melindungi invariant-nya sendiri. Invalid domain object sebaiknya tidak bisa dibuat.

```java
public record PostalCode(String value) {
    public PostalCode {
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("postal code must be exactly 6 digits");
        }
    }
}
```

Annotation saja tidak cukup untuk domain invariant karena object tetap bisa dibuat tanpa pernah divalidasi.

### 2.4 Persistence Entity

Persistence entity mengikuti lifecycle ORM/database. Ia tidak selalu cocok menjadi domain object murni.

```java
@Entity
@Table(name = "APPLICATION")
public class ApplicationEntity {
    @Id
    private Long id;

    @Column(nullable = false)
    private String status;

    protected ApplicationEntity() {}
}
```

Entity sering membutuhkan no-arg constructor, mutability, proxying, lazy loading, dan mapping concern. Jangan memaksa semua entity menjadi record atau semua record menjadi entity.

---

## 3. Fakta Penting: Annotation Validation Biasanya Terjadi Setelah Object Ada

Bean/Jakarta Validation memvalidasi object yang sudah dibuat.

```java
CreateApplicantRequest request = new CreateApplicantRequest("", "not-email", "123");
Set<ConstraintViolation<CreateApplicantRequest>> violations = validator.validate(request);
```

Object `request` sudah eksis walaupun invalid.

Untuk DTO, ini normal.

Untuk domain object, ini bahaya jika object invalid dapat tersebar ke service, cache, event, atau persistence.

### 3.1 Weak Domain Model

```java
public record CasePeriod(LocalDate startDate, LocalDate endDate) {}
```

Kalau invariant hanya dicek dengan validator eksternal, caller bisa lupa memanggil validator.

### 3.2 Strong Domain Model

```java
public record CasePeriod(LocalDate startDate, LocalDate endDate) {
    public CasePeriod {
        Objects.requireNonNull(startDate, "startDate must not be null");
        Objects.requireNonNull(endDate, "endDate must not be null");
        if (endDate.isBefore(startDate)) {
            throw new IllegalArgumentException("endDate must not be before startDate");
        }
    }
}
```

Di sini object valid by construction.

Rule utama:

```text
DTO:
    boleh invalid sementara, lalu divalidasi untuk menghasilkan user-facing errors.

Domain object:
    sebaiknya valid by construction.
```

---

## 4. Records sebagai DTO

Record sangat cocok untuk DTO immutable.

```java
public record CreateCaseRequest(
        @NotBlank(message = "case.title.required")
        @Size(max = 200, message = "case.title.tooLong")
        String title,

        @NotNull(message = "case.type.required")
        CaseType type,

        @NotNull(message = "case.applicant.required")
        @Valid
        ApplicantDto applicant,

        @Size(max = 20, message = "case.tags.tooMany")
        List<@NotBlank(message = "case.tags.element.required") String> tags
) {}
```

Keuntungan:

- immutable setelah dibuat,
- shape request jelas,
- annotation dekat dengan field contract,
- tidak ada setter mutation setelah validation,
- cocok dengan container element constraints.

Hal yang tetap perlu diperhatikan:

- `@Valid` tidak berarti field non-null; pakai `@NotNull @Valid` jika nested object wajib.
- `List<@NotBlank String>` tidak membuat list wajib non-null; pakai `@NotNull` pada list jika wajib.
- Default `toString()` record bisa membocorkan data sensitif.
- Compact constructor yang melakukan normalization bisa mengubah nilai sebelum error reporting.

---

## 5. Records sebagai Value Object

Record juga cocok untuk value object kecil.

```java
public record CaseReferenceNumber(String value) {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{8}");

    public CaseReferenceNumber {
        Objects.requireNonNull(value, "case reference number must not be null");
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid case reference number");
        }
    }
}
```

Boleh menambahkan annotation untuk metadata/API validation:

```java
public record CaseReferenceNumber(
        @NotBlank
        @Pattern(regexp = "CASE-[0-9]{8}")
        String value
) {
    private static final Pattern PATTERN = Pattern.compile("CASE-[0-9]{8}");

    public CaseReferenceNumber {
        Objects.requireNonNull(value);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid case reference number");
        }
    }
}
```

Ini tampak duplikatif, tetapi tujuannya berbeda:

- annotation: contract, metadata, framework validation, user-facing errors,
- constructor: invariant, domain safety, impossible invalid object.

Jika takut rule drift, ekstrak rule ke helper/policy yang dipakai annotation validator dan constructor.

---

## 6. Compact Constructor: Normalization dan Invariant

Compact constructor bisa menormalisasi parameter sebelum field record diassign.

```java
public record Username(String value) {
    public Username {
        value = value == null ? null : value.trim().toLowerCase(Locale.ROOT);
        if (value == null || value.length() < 3 || value.length() > 64) {
            throw new IllegalArgumentException("invalid username");
        }
    }
}
```

Untuk value object, ini baik.

Untuk DTO inbound, hati-hati. Normalization bisa menghilangkan perbedaan penting:

```text
field tidak dikirim
field dikirim null
field dikirim blank
field dikirim dengan whitespace ekstra
```

Jika API perlu membedakan kondisi tersebut, jangan normalisasi terlalu awal. Validasi dulu raw input, lalu normalisasi saat mapping ke command/domain.

---

## 7. Immutability dan Stabilitas Validation

Pada object mutable, validation hanya benar pada saat validator dijalankan.

```java
public class ApplicantRequest {
    @NotBlank
    private String name;

    public void setName(String name) {
        this.name = name;
    }
}
```

Alur buruk:

```text
object dibuat
    ↓
validated OK
    ↓
field dimutasi
    ↓
object menjadi invalid
    ↓
service memproses object invalid
```

Pada immutable DTO/record, setelah validasi berhasil, state tidak berubah.

Tetapi immutability bukan validitas. Ada tiga level:

```text
Mutable + validation:
    valid hanya pada timestamp validasi.

Immutable + validation:
    valid selama object value tidak diganti.

Immutable + constructor invariant:
    valid by construction.
```

Target domain model yang kuat adalah level ketiga.

---

## 8. Builder Pattern: Produktif tetapi Berisiko

Builder memudahkan object dengan banyak field.

```java
public final class CaseSubmission {
    private final String title;
    private final String description;
    private final LocalDate submittedDate;

    private CaseSubmission(Builder builder) {
        this.title = builder.title;
        this.description = builder.description;
        this.submittedDate = builder.submittedDate;
    }

    public static class Builder {
        private String title;
        private String description;
        private LocalDate submittedDate;

        public Builder title(String title) {
            this.title = title;
            return this;
        }

        public Builder description(String description) {
            this.description = description;
            return this;
        }

        public Builder submittedDate(LocalDate submittedDate) {
            this.submittedDate = submittedDate;
            return this;
        }

        public CaseSubmission build() {
            if (title == null || title.isBlank()) {
                throw new IllegalStateException("title is required");
            }
            if (submittedDate == null) {
                throw new IllegalStateException("submittedDate is required");
            }
            return new CaseSubmission(this);
        }
    }
}
```

Builder tanpa guard bisa membuat invalid object. Untuk domain object, `build()` harus menjaga invariant atau memanggil factory yang menjaga invariant.

### 8.1 Jakarta Validator di Builder?

Bisa, tetapi tidak selalu ideal.

```java
public CaseSubmission build(Validator validator) {
    CaseSubmission object = new CaseSubmission(this);
    Set<ConstraintViolation<CaseSubmission>> violations = validator.validate(object);
    if (!violations.isEmpty()) {
        throw new ConstraintViolationException(violations);
    }
    return object;
}
```

Trade-off:

- builder bergantung pada validation provider,
- domain module menjadi tergantung infrastructure,
- `Validator` lifecycle harus dikelola,
- exception menjadi framework-ish.

Untuk domain, lebih bersih menggunakan constructor/factory invariant. Untuk DTO/test fixture, validator di builder masih bisa diterima jika eksplisit.

### 8.2 Step Builder

Step builder mencegah required field terlupa secara compile-time.

```java
public interface TitleStep {
    SubmittedDateStep title(String title);
}

public interface SubmittedDateStep {
    OptionalStep submittedDate(LocalDate date);
}

public interface OptionalStep {
    OptionalStep description(String description);
    CaseSubmission build();
}
```

Kelebihan: required field lebih aman. Kekurangan: verbose dan tetap tidak menggantikan semantic validation.

---

## 9. Lombok: Gunakan dengan Sadar

Lombok membantu mengurangi boilerplate, terutama di Java 8/11. Tetapi annotation Lombok bisa menyembunyikan object lifecycle.

### 9.1 `@Data`

```java
@Data
public class CreateCaseRequest {
    @NotBlank
    private String title;
}
```

Risiko:

- mutable,
- setter dapat mengubah object setelah validation,
- generated `toString()` bisa membocorkan data,
- generated `equals/hashCode` pada object mutable bisa berbahaya.

`@Data` masih bisa diterima untuk DTO inbound yang hidup singkat di boundary layer. Jangan jadikan default untuk domain object.

### 9.2 `@Value`

```java
@Value
public class CreateCaseRequest {
    @NotBlank
    String title;
}
```

Lebih aman karena immutable, tetapi framework deserialization perlu constructor support.

### 9.3 `@Builder`

```java
@Value
@Builder
public class CaseSubmission {
    @NotBlank
    String title;

    @NotNull
    LocalDate submittedDate;
}
```

Masalah:

```java
CaseSubmission.builder().build();
```

Object invalid bisa dibuat jika tidak ada guard.

Guideline:

- hindari `@Builder` langsung pada aggregate/domain object kritikal tanpa invariant,
- gunakan static factory eksplisit,
- tulis custom builder jika perlu,
- test bahwa builder tidak bypass required fields,
- override `toString()` atau exclude sensitive field jika diperlukan.

---

## 10. Sealed Classes dan Polymorphic Validation

Sealed hierarchy bisa mengurangi conditional validation pada mega DTO.

Daripada:

```java
public record ApplicantDto(
        ApplicantType type,
        String fullName,
        String identificationNumber,
        String companyName,
        String uen
) {}
```

Gunakan subtype jika variasinya benar-benar berbeda:

```java
public sealed interface ApplicantRequest
        permits IndividualApplicantRequest, CompanyApplicantRequest {
}

public record IndividualApplicantRequest(
        @NotBlank String fullName,
        @NotBlank String identificationNumber
) implements ApplicantRequest {}

public record CompanyApplicantRequest(
        @NotBlank String companyName,
        @NotBlank String uen
) implements ApplicantRequest {}
```

Keuntungan:

- constraint subtype lebih jelas,
- invalid combination lebih sulit terjadi,
- class-level validator raksasa bisa dihindari,
- pattern matching lebih natural pada Java modern.

Tantangan:

- JSON polymorphism butuh discriminator,
- framework harus deserialize subtype yang benar,
- API documentation lebih kompleks,
- jangan gunakan sealed hierarchy jika variasi hanya beda kecil.

---

## 11. PATCH dan Presence Problem

Records tidak otomatis menyelesaikan partial update.

```java
public record PatchApplicantRequest(String name, String email) {}
```

Jika `name == null`, artinya apa?

- field tidak dikirim?
- field dikirim null untuk clear?
- field dikirim null karena client bug?

Untuk PATCH, gunakan model presence-aware.

```java
public record PatchField<T>(boolean present, T value) {
    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> of(T value) {
        return new PatchField<>(true, value);
    }
}
```

Request:

```java
public record PatchApplicantRequest(
        PatchField<@NotBlank String> name,
        PatchField<@Email String> email
) {}
```

Dengan custom `ValueExtractor`, validasi element dapat diterapkan hanya ketika field present. Ini lebih eksplisit daripada memakai `Optional` sebagai field request.

---

## 12. Optional dalam DTO

`Optional` sebagai return type bagus. Sebagai field DTO, perlu hati-hati.

```java
public record SearchRequest(Optional<@Size(min = 3, max = 100) String> keyword) {}
```

Bean Validation 2.0+ mendukung container element constraint pada `Optional`, tetapi request DTO dengan `Optional` sering membuat semantic ambiguity:

- absent vs explicit null,
- framework deserialization berbeda-beda,
- PATCH tri-state tidak terwakili penuh,
- rule API kurang eksplisit.

Guideline:

- return type internal: `Optional<T>` baik,
- request DTO biasa: nullable field + validation contract sering lebih sederhana,
- PATCH: gunakan presence wrapper,
- domain: gunakan explicit type yang merepresentasikan konsep bisnis.

---

## 13. Records dan Sensitive Data

Record menghasilkan `toString()` otomatis.

```java
public record LoginRequest(String username, String password) {}
```

Default `toString()` dapat membocorkan password ke log.

Lebih aman:

```java
public record LoginRequest(
        @NotBlank String username,
        @NotBlank String password
) {
    @Override
    public String toString() {
        return "LoginRequest[username=" + username + ", password=<redacted>]";
    }
}
```

Juga jangan kembalikan rejected value sensitif di API error.

Buruk:

```json
{
  "path": "password",
  "rejectedValue": "secret123",
  "message": "password too weak"
}
```

Lebih aman:

```json
{
  "path": "password",
  "code": "PASSWORD_TOO_WEAK",
  "message": "password does not meet policy"
}
```

---

## 14. Java 8 sampai Java 25: Strategi Modeling

### 14.1 Java 8

Tidak ada records. Gunakan:

- JavaBean DTO untuk framework legacy,
- immutable class manual untuk value object,
- Lombok dengan disiplin,
- Bean Validation 2.0 `javax.validation`.

```java
public final class ApplicationId {
    private final UUID value;

    public ApplicationId(UUID value) {
        this.value = Objects.requireNonNull(value);
    }

    public UUID value() {
        return value;
    }
}
```

### 14.2 Java 11

Strategi mirip Java 8, tetapi library/framework lebih matang. Immutable class atau Lombok `@Value` sering menjadi pilihan.

### 14.3 Java 17

Records dan sealed classes sudah layak untuk enterprise. Jakarta Validation 3.1 minimum Java 17, sehingga ini baseline penting untuk stack modern.

### 14.4 Java 21

Java 21 LTS membuat records/sealed/pattern matching semakin natural. Gunakan immutable command, domain event, DTO record, dan sealed subtype untuk variasi payload yang nyata.

### 14.5 Java 25

Di Java 25, prinsipnya tetap sama: gunakan modern language feature untuk memperjelas model, tetapi jangan mengganti invariant domain dengan annotation-only validation.

---

## 15. Decision Matrix

| Situasi | Strategi yang Direkomendasikan |
|---|---|
| Inbound REST request | Record/class DTO + Jakarta Validation |
| Perlu semua error dikembalikan sekaligus | Jakarta Validation pada DTO |
| Value object domain | Constructor/factory invariant |
| Aggregate transition | Domain method guard + policy |
| Workflow rule contextual | Policy object/workflow guard, bukan annotation saja |
| Persistence final consistency | Database constraint + error translation |
| Partial update | Presence-aware patch model |
| Sensitive input | Hindari default record `toString()` di log |
| Banyak field optional | Builder dengan guard atau command-specific DTO |
| Subtype request sangat berbeda | Sealed hierarchy atau explicit command variant |
| Java 8 legacy | JavaBean DTO + immutable manual domain object |
| Java 17+ modern | Record DTO/value object + explicit invariant |

---

## 16. Anti-Patterns

### 16.1 Annotation-Only Domain Value Object

```java
public record Age(@Min(0) int value) {}
```

Masalah:

```java
new Age(-1);
```

Object invalid tetap bisa dibuat.

Lebih baik:

```java
public record Age(int value) {
    public Age {
        if (value < 0) {
            throw new IllegalArgumentException("age must not be negative");
        }
    }
}
```

### 16.2 Mega DTO dengan Banyak Conditional Fields

Jika satu DTO punya banyak field yang hanya valid untuk tipe tertentu, pertimbangkan subtype, command-specific DTO, atau class-level constraint kecil yang jelas. Jangan membuat validator raksasa yang menjadi rule engine tersembunyi.

### 16.3 Lombok Builder Tanpa Guard

Builder yang dapat membuat object invalid harus dianggap bug pada domain model.

### 16.4 Entity sebagai DTO dan Domain Object Sekaligus

Entity yang dipakai langsung sebagai request DTO akan mencampur API rule, persistence rule, dan domain rule. Ini membuat validation sulit dipahami, sulit dites, dan rawan lazy-loading/cascade problem.

### 16.5 Normalization yang Menghapus Informasi Validasi

Mengubah `null` menjadi empty string, atau blank menjadi default value, bisa menyembunyikan invalid input. Defaulting harus eksplisit dan sesuai contract.

---

## 17. Production Pattern: Layered Validation Flow

Contoh flow production-grade:

```text
JSON request
    ↓
DTO record
    ↓ Jakarta Validation: shape/basic contract
Mapper
    ↓ parse raw value into value object
Command
    ↓ complete operation intent
Use case/service
    ↓ load aggregate
Domain policy
    ↓ contextual business rule
Aggregate method
    ↓ state transition guard
Repository/database
    ↓ final consistency constraint
```

Contoh DTO:

```java
public record SubmitApplicationRequest(
        @NotBlank(message = "application.reference.required")
        @Pattern(regexp = "APP-[0-9]{8}", message = "application.reference.invalid")
        String applicationReference,

        @NotNull(message = "submission.channel.required")
        SubmissionChannel channel,

        @NotNull(message = "submission.confirmation.required")
        @AssertTrue(message = "submission.confirmation.mustBeTrue")
        Boolean confirmed
) {}
```

Value object:

```java
public record ApplicationReference(String value) {
    private static final Pattern PATTERN = Pattern.compile("APP-[0-9]{8}");

    public ApplicationReference {
        Objects.requireNonNull(value);
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid application reference");
        }
    }
}
```

Command:

```java
public record SubmitApplicationCommand(
        ApplicationReference applicationReference,
        SubmissionChannel channel,
        OfficerId actor,
        Instant submittedAt
) {
    public SubmitApplicationCommand {
        Objects.requireNonNull(applicationReference);
        Objects.requireNonNull(channel);
        Objects.requireNonNull(actor);
        Objects.requireNonNull(submittedAt);
    }
}
```

Policy result:

```java
public record RuleViolation(String code, String message, Severity severity) {}

public record PolicyResult(List<RuleViolation> violations) {
    public boolean passed() {
        return violations.isEmpty();
    }
}
```

Service:

```java
public SubmitApplicationResult submit(SubmitApplicationRequest request, OfficerId actor) {
    SubmitApplicationCommand command = new SubmitApplicationCommand(
            new ApplicationReference(request.applicationReference()),
            request.channel(),
            actor,
            clock.instant()
    );

    Application application = repository.findByReference(command.applicationReference())
            .orElseThrow(ApplicationNotFoundException::new);

    PolicyResult policyResult = submitPolicy.validate(application, actor, command.submittedAt());
    if (!policyResult.passed()) {
        return SubmitApplicationResult.rejected(policyResult.violations());
    }

    application.submit(actor, command.submittedAt());
    repository.save(application);

    return SubmitApplicationResult.accepted(application.id());
}
```

---

## 18. Testing Strategy

### 18.1 DTO Validation Test

```java
class SubmitApplicationRequestValidationTest {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void shouldRejectBlankReference() {
        var request = new SubmitApplicationRequest("", SubmissionChannel.PORTAL, true);

        var violations = validator.validate(request);

        assertThat(violations)
                .anyMatch(v -> v.getPropertyPath().toString().equals("applicationReference"));
    }
}
```

### 18.2 Value Object Test

```java
class ApplicationReferenceTest {
    @Test
    void shouldRejectInvalidReference() {
        assertThrows(IllegalArgumentException.class, () -> new ApplicationReference("bad"));
    }
}
```

### 18.3 Builder Test

```java
class BuilderTest {
    @Test
    void shouldNotBuildInvalidDomainObject() {
        assertThrows(IllegalStateException.class, () ->
                CaseSubmission.builder().submittedDate(LocalDate.now()).build()
        );
    }
}
```

### 18.4 Mapping Test

```java
class MapperTest {
    @Test
    void shouldMapValidatedDtoToCommand() {
        var request = new SubmitApplicationRequest("APP-20250101", SubmissionChannel.PORTAL, true);

        var command = mapper.toCommand(request, officerId);

        assertThat(command.applicationReference().value()).isEqualTo("APP-20250101");
    }
}
```

---

## 19. Review Checklist

### DTO / API Model

- Apakah DTO hanya memodelkan API contract?
- Apakah requiredness sesuai operation?
- Apakah `@NotNull` tidak dipakai terlalu global?
- Apakah nested object wajib memakai `@NotNull @Valid`?
- Apakah list/map element memakai container element constraints?
- Apakah sensitive field aman dari logging dan `toString()`?

### Record

- Apakah record cocok dengan lifecycle object?
- Apakah compact constructor tidak menghancurkan informasi validasi?
- Apakah record tidak dipaksa menjadi JPA entity?
- Apakah perubahan component mempertimbangkan compatibility?

### Domain

- Apakah invariant ditegakkan di constructor/factory/method?
- Apakah invalid object tidak bisa dibuat?
- Apakah contextual business rule tidak dipaksa masuk annotation sederhana?

### Builder/Lombok

- Apakah builder bisa membuat object invalid?
- Apakah `@Data` tidak dipakai pada domain object penting?
- Apakah generated `toString()` aman?

### Polymorphism

- Apakah subtype lebih tepat daripada conditional mega DTO?
- Apakah discriminator API jelas?
- Apakah setiap subtype tervalidasi?

---

## 20. Ringkasan Mental Model

Gunakan validation sebagai sistem berlapis:

```text
1. DTO annotation validation
   Menolak payload yang bentuknya salah.

2. Mapping/parsing
   Mengubah raw value menjadi typed value.

3. Constructor/factory invariant
   Mencegah domain object invalid eksis.

4. Domain policy
   Mengevaluasi business rule contextual.

5. Aggregate method guard
   Melindungi state transition.

6. Database constraint
   Menjadi final consistency boundary.
```

Records dan immutability membuat validation lebih stabil, tetapi bukan pengganti invariant.

Lombok dan builders meningkatkan produktivitas, tetapi dapat membuka jalan invalid object jika tidak dijaga.

Sealed classes mengurangi conditional validation jika variasi model memang nyata.

Jakarta Validation tetap sangat kuat untuk boundary contract, metadata, dan error aggregation, tetapi correctness domain tidak boleh bergantung pada caller yang ingat menjalankan validator.

---

## 21. Apa yang Harus Dikuasai Setelah Bagian Ini

Setelah bagian ini, Anda seharusnya mampu:

1. membedakan DTO validation dan domain invariant,
2. menjelaskan kenapa annotation-only domain model lemah,
3. memakai record sebagai DTO immutable dengan benar,
4. memakai compact constructor untuk value object invariant,
5. menghindari misuse Lombok `@Data` dan `@Builder`,
6. mendesain builder yang tidak membuat invalid object,
7. memilih antara mega DTO, validation group, dan sealed subtype,
8. memahami PATCH presence problem,
9. menjaga sensitive field dari `toString()` dan error leakage,
10. membuat layered validation architecture untuk sistem besar.

---

## 22. Referensi

- Jakarta Validation 3.1 specification and release page: metadata model/API for JavaBean and method validation, Jakarta EE 11 target, record support clarification.
- Bean Validation 2.0 specification: object-level constraint declaration, metadata repository/query API, method/constructor validation, Java 8 support.
- Hibernate Validator reference guide and release notes: reference implementation behavior and version compatibility.
- OpenJDK JEP 395: Java Records.

---

## 23. Status Seri

Seri **belum selesai**.

Bagian ini adalah:

```text
learn-java-validation-jakarta-hibernate-validator-part-012.md
```

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-013.md
```

Judul berikutnya:

```text
Message Interpolation: i18n, EL, Security, and Error Message Governance
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-011.md">⬅️ Parameter and Executable Validation: Methods, Constructors, Return Values</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-013.md">Message Interpolation: i18n, EL, Security, and Error Message Governance ➡️</a>
</div>

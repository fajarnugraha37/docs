# Part 27 — Mapping Validation Boundary: Bean Validation, Invariants, and Normalization

> Seri: `learn-java-data-mapper-json-xml-jackson-mapstruct-lombok-transformation-engineering`  
> File: `27-mapping-validation-boundary-bean-validation-invariants-normalization.md`  
> Status: Part 27 dari 35  
> Scope Java: Java 8 sampai Java 25  
> Fokus: boundary antara deserialization, mapping, validation, normalization, invariant domain, dan auditability.

---

## 1. Masalah Utama: Banyak Sistem Menganggap Mapping = Validation

Di aplikasi enterprise, terutama sistem case management, regulatory workflow, approval, enforcement, licensing, payment, dan integration, data biasanya melewati beberapa bentuk:

```text
External JSON/XML/Form
        |
        v
Raw request payload
        |
        v
Deserialization / binding
        |
        v
Request DTO
        |
        v
Validation
        |
        v
Normalization / canonicalization
        |
        v
Command / application input model
        |
        v
Domain invariant check
        |
        v
Entity / aggregate / event / audit record
```

Masalah muncul saat semua tahap di atas dicampur menjadi satu method seperti ini:

```java
public ApplicationEntity toEntity(ApplicationRequest request) {
    ApplicationEntity entity = new ApplicationEntity();
    entity.setName(request.getName().trim().toUpperCase());
    entity.setStatus(request.getStatus() == null ? Status.DRAFT : request.getStatus());
    entity.setAmount(new BigDecimal(request.getAmount()));
    entity.setApplicantId(Long.valueOf(request.getApplicantId()));
    entity.setApproved(false);
    return entity;
}
```

Sekilas ini terlihat produktif. Tetapi secara engineering, method ini mencampur banyak tanggung jawab:

1. mapping struktur,
2. type conversion,
3. normalization,
4. defaulting,
5. business policy,
6. domain invariant,
7. persistence initialization,
8. security decision.

Akibatnya, bug menjadi sulit dilacak. Ketika ada data salah, kita tidak tahu apakah salahnya berasal dari payload, deserialization, validation, normalization, mapper, atau domain rule.

Mental model utama bagian ini:

> Mapping menjawab: “data ini dipindahkan menjadi bentuk apa?”  
> Validation menjawab: “data ini boleh diterima atau tidak?”  
> Normalization menjawab: “representasi canonical apa yang akan kita simpan/proses?”  
> Invariant menjawab: “state domain ini tetap benar atau tidak?”

Keempatnya berhubungan, tetapi tidak identik.

---

## 2. Definisi yang Harus Dipisahkan

### 2.1 Deserialization / Binding

Deserialization adalah proses mengubah bytes/string JSON/XML menjadi object Java.

Contoh:

```json
{
  "applicantName": "  Fajar  ",
  "postalCode": "012345",
  "declaredAmount": "1000.00"
}
```

menjadi:

```java
public record SubmitApplicationRequest(
        String applicantName,
        String postalCode,
        String declaredAmount
) {}
```

Deserialization sebaiknya hanya bertanggung jawab pada:

- apakah payload valid secara syntax JSON/XML,
- apakah field bisa di-bind ke Java type,
- apakah format dasar bisa dibaca,
- apakah unknown/missing/null field ditangani sesuai policy.

Deserialization tidak seharusnya diam-diam menerapkan keputusan domain seperti:

- status default menjadi `APPROVED`,
- role default menjadi `ADMIN`,
- amount negatif diubah menjadi nol,
- missing consent dianggap `true`,
- external code tidak dikenal dianggap `OTHER` tanpa audit.

### 2.2 Mapping

Mapping adalah proses mengubah satu object model menjadi object model lain.

Contoh:

```java
SubmitApplicationCommand command = mapper.toCommand(request);
```

Mapping yang sehat bersifat eksplisit:

```text
Request DTO -> Command
Entity      -> Response DTO
Aggregate   -> Domain Event
External DTO -> Internal Canonical DTO
```

Mapping boleh melakukan conversion teknis yang jelas:

- `String` ke `LocalDate`,
- `String` ke `BigDecimal`,
- external enum code ke internal enum,
- nested object ke flattened response,
- collection mapping.

Tetapi mapper harus hati-hati ketika mulai melakukan:

- permission check,
- workflow transition,
- persistence lookup,
- external API call,
- rule evaluation,
- status derivation kompleks,
- mutation domain yang punya konsekuensi bisnis.

Itu biasanya bukan mapping lagi; itu application/domain service.

### 2.3 Validation

Validation adalah proses memutuskan apakah input memenuhi constraint.

Contoh:

```java
public record SubmitApplicationRequest(
        @NotBlank
        @Size(max = 200)
        String applicantName,

        @Pattern(regexp = "\\d{6}")
        String postalCode,

        @NotNull
        @DecimalMin("0.00")
        BigDecimal declaredAmount
) {}
```

Validation menjawab:

```text
Apakah data ini boleh masuk ke tahap berikutnya?
```

Validation tidak selalu sama dengan domain invariant.

Contoh request validation:

```text
postalCode harus 6 digit.
```

Contoh domain invariant:

```text
Application tidak boleh submit jika applicant belum punya active licence.
```

Yang pertama bisa dicek di DTO. Yang kedua membutuhkan state domain/database/rule engine.

### 2.4 Normalization

Normalization adalah proses mengubah input valid menjadi representasi canonical.

Contoh:

```text
"  fajar abdi  " -> "fajar abdi"
"S1234567A"    -> "S1234567A" setelah uppercase dan remove spaces
"+65 9123 4567" -> "+6591234567"
"01/02/2026"   -> LocalDate sesuai locale eksplisit
```

Normalization tidak selalu aman. Ada field yang boleh dinormalisasi, ada yang tidak.

Aman dinormalisasi:

- trimming whitespace pada name,
- uppercase country code,
- canonical phone number,
- lowercase email local policy tertentu,
- normalize postal code spacing jika format jelas.

Berbahaya dinormalisasi:

- ID legal yang case-sensitive,
- free-text statement untuk audit/regulatory evidence,
- signed XML/JSON payload,
- password/passphrase,
- cryptographic token,
- legal declaration text,
- address text jika harus preserve original submission.

### 2.5 Domain Invariant

Invariant adalah aturan yang harus selalu benar pada domain object.

Contoh:

```text
A submitted case must have at least one applicant.
A closed enforcement case cannot be reopened without a reopen reason.
An approved licence must have an effective date.
A payment cannot be marked as settled unless settlement reference exists.
A workflow transition must follow allowed state machine transition.
```

Invariant bukan sekadar input validation. Ia menjaga kebenaran state domain sepanjang lifecycle object.

Request DTO boleh valid, tetapi command tetap bisa ditolak oleh invariant domain.

```text
Request valid secara format:
- applicationId ada
- comment tidak kosong
- action = APPROVE

Tetapi domain menolak:
- current state = WITHDRAWN
- user bukan approver
- required supporting document belum lengkap
```

---

## 3. Boundary Pipeline yang Disarankan

Untuk aplikasi serius, gunakan pipeline mental seperti ini:

```text
1. Parse
   Payload harus bisa dibaca.

2. Bind
   Payload menjadi DTO dengan strict/lenient policy yang eksplisit.

3. Syntactic validation
   Required field, length, pattern, range, format.

4. Normalization
   Ubah representasi menjadi canonical jika aman.

5. Semantic validation
   Validasi yang membutuhkan lebih dari satu field atau reference data.

6. Map to command
   DTO yang sudah validated/normalized menjadi application command.

7. Domain invariant
   Aggregate/service memastikan aturan domain tidak rusak.

8. Map to persistence/event/response
   Bentuk output sesuai boundary berikutnya.
```

Dalam code:

```java
public SubmitApplicationResponse submit(SubmitApplicationRequest request) {
    // 1-2 handled by framework/Jackson before this method

    // 3. syntactic validation usually handled by @Valid
    //    but explicit validation can exist for non-framework entrypoints

    NormalizedSubmitApplication normalized = normalizer.normalize(request);

    SemanticValidationResult semantic = semanticValidator.validate(normalized);
    if (!semantic.isValid()) {
        throw new ValidationException(semantic.errors());
    }

    SubmitApplicationCommand command = mapper.toCommand(normalized);

    Application application = applicationService.submit(command);

    return responseMapper.toResponse(application);
}
```

Pemisahan ini membuat failure mudah diklasifikasikan:

```text
400 Bad Request      -> parse/binding error
422 Unprocessable    -> validation/semantic input error
409 Conflict         -> state/invariant conflict
403 Forbidden        -> authorization rule
500 Internal Error   -> bug/infrastructure
```

Catatan: kode status HTTP adalah desain API. Dalam beberapa organisasi, semua validation error dikembalikan sebagai 400. Yang penting bukan angka statusnya, tetapi failure taxonomy internal harus jelas.

---

## 4. Kenapa Urutan Validation dan Normalization Tidak Selalu Sama

Pertanyaan penting:

```text
Apakah kita validate dulu lalu normalize, atau normalize dulu lalu validate?
```

Jawabannya: tergantung jenis field dan risiko audit.

### 4.1 Normalize Before Validate

Cocok ketika input variasi representasi boleh diterima.

Contoh:

```text
Input: "  abc@example.com  "
Normalize: trim
Validate: valid email
```

Atau:

```text
Input: "s1234567a"
Normalize: uppercase
Validate: pattern NRIC/FIN
```

Pipeline:

```text
raw -> safe normalization -> validation -> canonical value
```

Contoh Java:

```java
public record NormalizedApplicantInput(
        String email,
        String idNumber
) {
    public static NormalizedApplicantInput from(ApplicantRequest request) {
        return new NormalizedApplicantInput(
                normalizeEmail(request.email()),
                normalizeId(request.idNumber())
        );
    }

    private static String normalizeEmail(String value) {
        return value == null ? null : value.trim();
    }

    private static String normalizeId(String value) {
        return value == null ? null : value.trim().toUpperCase(Locale.ROOT);
    }
}
```

### 4.2 Validate Before Normalize

Cocok ketika normalization bisa menyembunyikan input berbahaya.

Contoh:

```text
Input: "1,000.00"
```

Apakah ini seribu? Dalam locale tertentu, comma adalah decimal separator. Kalau sistem langsung remove comma, bisa salah.

Contoh lain:

```text
Input: "abc\u0000def"
```

Kalau null char dihapus diam-diam, evidence asli hilang.

Pipeline:

```text
raw -> reject invalid dangerous form -> normalization -> canonical value
```

### 4.3 Validate Raw and Normalized

Untuk sistem regulatory/audit, sering perlu dua tahap:

```text
raw input validation       -> input tidak mengandung bentuk berbahaya
normalization             -> canonical form
canonical value validation -> hasil akhir memenuhi constraint bisnis
```

Contoh:

```text
Raw postal code: " 012345 "
Raw validation: no control char, max raw length reasonable
Normalize: trim
Canonical validation: exactly 6 digits
```

---

## 5. Raw Value vs Canonical Value

Salah satu keputusan arsitektur penting:

```text
Apakah sistem menyimpan raw input, canonical input, atau keduanya?
```

Untuk sistem biasa, canonical value sering cukup.

Untuk sistem audit/regulatory, menyimpan raw dan canonical sering lebih defensible.

Contoh:

```java
public record SubmittedAddress(
        String rawPostalCode,
        String canonicalPostalCode,
        String rawAddressLine,
        String canonicalAddressLine
) {}
```

Manfaat menyimpan raw:

- bisa membuktikan apa yang user kirim,
- bisa replay parsing/normalization saat rule berubah,
- bisa debug mismatch dengan external system,
- bisa audit perubahan pipeline,
- bisa mendukung dispute resolution.

Risiko menyimpan raw:

- PII bertambah,
- retention policy lebih rumit,
- masking/redaction wajib,
- search/reporting harus memakai canonical field,
- raw field tidak boleh dipakai sembarangan sebagai source of truth.

Rule of thumb:

```text
Canonical value dipakai untuk decision dan query.
Raw value dipakai untuk audit, evidence, dan troubleshooting terbatas.
```

---

## 6. Bean Validation: Kapan Dipakai dan Kapan Tidak Cukup

Jakarta Validation menyediakan model metadata dan API untuk validasi JavaBean dan method validation. Jakarta Validation 3.1 adalah bagian dari Jakarta EE 11 dan mengklarifikasi dukungan Java Records. Hibernate Validator adalah reference implementation yang umum digunakan di ekosistem Java enterprise.

Bean Validation sangat bagus untuk:

- required field,
- length,
- range,
- pattern,
- email-ish format,
- decimal min/max,
- nested object validation,
- collection element validation,
- class-level cross-field constraint sederhana,
- validation group untuk scenario berbeda.

Contoh:

```java
public record CreateLicenceRequest(
        @NotBlank
        @Size(max = 200)
        String applicantName,

        @NotBlank
        @Pattern(regexp = "\\d{6}")
        String postalCode,

        @NotNull
        @DecimalMin(value = "0.00", inclusive = false)
        BigDecimal declaredRevenue,

        @Valid
        List<@Valid SupportingDocumentRequest> documents
) {}
```

Bean Validation tidak ideal sebagai tempat:

- query database kompleks,
- workflow transition,
- authorization,
- expensive external API call,
- mutation,
- enrichment,
- normalization yang mengubah object,
- business decision yang butuh aggregate state.

Salah:

```java
public class ApplicantMustBeEligibleValidator
        implements ConstraintValidator<ApplicantMustBeEligible, String> {

    @Autowired
    private ExternalEligibilityClient client;

    @Override
    public boolean isValid(String applicantId, ConstraintValidatorContext context) {
        return client.checkEligibility(applicantId); // bad boundary
    }
}
```

Masalah:

- validation jadi network-dependent,
- latency unpredictable,
- retry/error handling tidak jelas,
- hasil bisa berubah antar invocation,
- unit test menjadi berat,
- validation error dan integration error tercampur.

Lebih baik:

```java
public final class SubmitApplicationSemanticValidator {
    private final ApplicantRepository applicantRepository;
    private final EligibilityPolicy eligibilityPolicy;

    public SemanticValidationResult validate(SubmitApplicationCommand command) {
        Applicant applicant = applicantRepository.findById(command.applicantId())
                .orElseThrow(() -> new ReferenceNotFoundException("applicantId"));

        if (!eligibilityPolicy.canSubmit(applicant, command.applicationType())) {
            return SemanticValidationResult.invalid("applicantId", "Applicant is not eligible");
        }

        return SemanticValidationResult.valid();
    }
}
```

---

## 7. Validation Groups: Powerful but Easy to Abuse

Validation groups bisa membantu ketika DTO sama dipakai di beberapa operation.

Contoh:

```java
public interface Create {}
public interface Update {}
public interface Submit {}

public record ApplicationRequest(
        @Null(groups = Create.class)
        @NotNull(groups = Update.class)
        Long id,

        @NotBlank(groups = {Create.class, Submit.class})
        String applicantName,

        @NotNull(groups = Submit.class)
        BigDecimal declaredAmount
) {}
```

Tetapi group sering menjadi tanda DTO mulai dipakai terlalu luas.

Jika DTO punya group seperti ini:

```text
Create
Update
Patch
Submit
Approve
Reject
AdminEdit
ExternalSync
Migration
BulkUpload
```

itu tanda bahwa satu DTO memikul terlalu banyak boundary.

Lebih baik gunakan DTO/command berbeda:

```java
public record CreateApplicationRequest(...) {}
public record UpdateApplicationRequest(...) {}
public record SubmitApplicationRequest(...) {}
public record ApproveApplicationRequest(...) {}
public record BulkUploadApplicationRow(...) {}
```

Validation groups cocok untuk variasi kecil. Untuk operation dengan semantic berbeda, buat model berbeda.

---

## 8. Cross-Field Validation

Tidak semua validation bisa ditempel di field.

Contoh:

```text
Jika isForeignApplicant = true, passportNumber wajib.
Jika paymentMethod = GIRO, bankAccountNumber wajib.
Jika action = REJECT, rejectionReason wajib.
Jika applicationType = RENEWAL, previousLicenceId wajib.
```

Gunakan class-level constraint untuk rule sederhana dan pure.

```java
@Target(TYPE)
@Retention(RUNTIME)
@Constraint(validatedBy = RejectReasonRequiredValidator.class)
public @interface RejectReasonRequired {
    String message() default "rejectionReason is required when action is REJECT";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

```java
@RejectReasonRequired
public record DecisionRequest(
        DecisionAction action,
        String approvalComment,
        String rejectionReason
) {}
```

```java
public final class RejectReasonRequiredValidator
        implements ConstraintValidator<RejectReasonRequired, DecisionRequest> {

    @Override
    public boolean isValid(DecisionRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        if (value.action() == DecisionAction.REJECT
                && (value.rejectionReason() == null || value.rejectionReason().isBlank())) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate("rejectionReason is required when action is REJECT")
                    .addPropertyNode("rejectionReason")
                    .addConstraintViolation();
            return false;
        }

        return true;
    }
}
```

Tetapi jangan letakkan rule yang membutuhkan state domain berat di class-level Bean Validation.

Pure cross-field validation:

```text
endDate >= startDate
reject reason required when action = REJECT
at least one contact channel present
```

Semantic/domain validation:

```text
user can approve this case
case can transition from current state to next state
licence is active
payment already settled
document belongs to applicant
```

---

## 9. Null, Missing, Empty, Blank, and Default: Jangan Disamakan

Mapping/validation boundary harus membedakan lima keadaan:

```text
missing  -> field tidak dikirim
null     -> field dikirim dengan nilai null
empty    -> "" atau []
blank    -> "   "
default  -> sistem mengisi nilai karena tidak ada input
```

Contoh JSON:

```json
{}
```

berbeda dengan:

```json
{"middleName": null}
```

berbeda dengan:

```json
{"middleName": ""}
```

Dalam PUT, PATCH, dan Merge Patch, perbedaan ini sangat penting.

Contoh PATCH:

```json
{
  "email": null
}
```

Bisa berarti:

```text
clear email
```

Sedangkan missing field berarti:

```text
do not change email
```

Jika DTO biasa tidak bisa membedakan missing dan null, gunakan explicit wrapper.

```java
public sealed interface PatchField<T> permits PatchField.Missing, PatchField.Present {
    record Missing<T>() implements PatchField<T> {}
    record Present<T>(T value) implements PatchField<T> {}
}
```

Atau gunakan JsonNode untuk patch boundary lalu map secara eksplisit.

```java
public UpdateApplicantCommand toCommand(JsonNode patch) {
    PatchField<String> email = patch.has("email")
            ? new PatchField.Present<>(patch.get("email").isNull() ? null : patch.get("email").asText())
            : new PatchField.Missing<>();

    return new UpdateApplicantCommand(email);
}
```

Rule penting:

> Default value harus eksplisit dan audit-friendly. Jangan biarkan default Java primitive (`false`, `0`) menjadi business decision diam-diam.

Buruk:

```java
public record CreateUserRequest(
        boolean admin
) {}
```

Jika field missing, `admin` bisa menjadi `false`. Untuk security, ini mungkin aman. Tetapi untuk decision penting, missing harus diketahui.

Lebih eksplisit:

```java
public record CreateUserRequest(
        Boolean admin
) {}
```

Lalu validasi:

```java
if (request.admin() == null) {
    throw validationError("admin", "must be explicitly provided");
}
```

Atau lebih baik jangan izinkan client mengirim `admin` sama sekali; role assignment harus melalui policy terpisah.

---

## 10. Normalization Patterns

### 10.1 Trim Normalization

Gunakan untuk field yang memang tidak sensitif terhadap leading/trailing whitespace.

```java
static String trimToNull(String value) {
    if (value == null) return null;
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
}
```

Namun `String.trim()` hanya menangani subset whitespace lama. Untuk Java 11+, `strip()` lebih Unicode-aware.

```java
static String stripToNull(String value) {
    if (value == null) return null;
    String stripped = value.strip();
    return stripped.isEmpty() ? null : stripped;
}
```

Untuk Java 8 compatibility, `trim()` masih umum, tetapi pahami batasannya.

### 10.2 Case Normalization

Gunakan `Locale.ROOT` untuk menghindari bug locale seperti Turkish-I.

```java
static String uppercaseCode(String value) {
    return value == null ? null : value.strip().toUpperCase(Locale.ROOT);
}
```

Salah:

```java
value.toUpperCase(); // depends on default locale
```

### 10.3 Numeric Normalization

Untuk monetary/decimal value, jangan normalize dengan `double`.

Salah:

```java
BigDecimal amount = BigDecimal.valueOf(Double.parseDouble(input));
```

Lebih aman:

```java
BigDecimal amount = new BigDecimal(input.strip());
```

Tetapi tetap harus jelas format input yang diterima.

Jika external system mengirim string angka dengan comma/group separator, buat parser eksplisit per source system, bukan global parser.

```java
public BigDecimal parseExternalAmount(String sourceSystem, String raw) {
    return switch (sourceSystem) {
        case "SYSTEM_A" -> parseSystemAAmount(raw);
        case "SYSTEM_B" -> parseSystemBAmount(raw);
        default -> throw new UnsupportedSourceSystemException(sourceSystem);
    };
}
```

### 10.4 Date/Time Normalization

Tanggal adalah area rawan.

Pertanyaan yang wajib dijawab:

```text
Apakah input merepresentasikan date-only atau instant?
Timezone siapa yang dipakai?
Apakah end date inclusive atau exclusive?
Apakah offset wajib?
Apakah local date boleh tergantung user locale?
```

Contoh:

```java
public record LicencePeriod(
        LocalDate effectiveDate,
        LocalDate expiryDate
) {
    public LicencePeriod {
        if (expiryDate.isBefore(effectiveDate)) {
            throw new IllegalArgumentException("expiryDate must not be before effectiveDate");
        }
    }
}
```

Untuk event timestamp:

```java
public record SubmittedEvent(
        Instant submittedAt
) {}
```

Hindari menyimpan `LocalDateTime` untuk instant lintas sistem kecuali timezone/context sangat jelas.

### 10.5 Identifier Normalization

ID bisa case-sensitive atau tidak. Jangan asumsi.

Contoh:

```text
User-facing code: mungkin uppercase canonical.
Database UUID: lowercase string boleh.
External ID: harus preserve exact string.
Signed ID: tidak boleh diubah.
```

Rule:

> Jangan normalize identifier sampai contract menyatakan normalization legal.

---

## 11. Mapping Error vs Validation Error

Penting membedakan dua jenis kegagalan:

### 11.1 Validation Error

Data user tidak memenuhi constraint.

Contoh:

```text
postalCode must be 6 digits
amount must be greater than 0
rejectionReason is required
```

Ini biasanya bisa dikembalikan ke user/API consumer.

### 11.2 Mapping Error

Sistem tidak bisa mengubah bentuk data karena mapping rule tidak lengkap atau tidak konsisten.

Contoh:

```text
Unknown external status code: "PENDING_REVIEW_2"
No mapper registered for document type: "FOREIGN_CERT"
External payload version unsupported: "v7"
Currency code cannot be mapped: "XTS"
```

Mapping error bisa jadi:

- client error jika external payload tidak sesuai contract,
- integration error jika upstream mengirim code baru tanpa koordinasi,
- internal bug jika mapper tidak di-update.

Jangan semua mapping error dibungkus menjadi “invalid input”. Untuk operational visibility, bedakan.

Contoh desain:

```java
public final class MappingException extends RuntimeException {
    private final String sourcePath;
    private final String sourceValue;
    private final String targetType;

    public MappingException(String sourcePath, String sourceValue, String targetType, String message) {
        super(message);
        this.sourcePath = sourcePath;
        this.sourceValue = sourceValue;
        this.targetType = targetType;
    }
}
```

Namun hati-hati logging PII. Jangan selalu log raw value.

---

## 12. Invariant di Domain Model

Domain invariant sebaiknya berada di domain object, aggregate, atau domain service, bukan mapper.

Buruk:

```java
public CaseEntity toEntity(CaseSubmitRequest request) {
    CaseEntity entity = repository.findById(request.caseId()).orElseThrow();

    if (entity.getStatus() != CaseStatus.DRAFT) {
        throw new IllegalStateException("Only draft can be submitted");
    }

    entity.setStatus(CaseStatus.SUBMITTED);
    return entity;
}
```

Mapper tiba-tiba menjadi workflow service.

Lebih baik:

```java
public final class RegulatoryCase {
    private CaseStatus status;
    private final List<Document> documents;

    public void submit(SubmissionCommand command) {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidCaseTransitionException(status, CaseStatus.SUBMITTED);
        }
        if (!hasRequiredDocuments()) {
            throw new DomainInvariantViolation("Required documents are incomplete");
        }
        this.status = CaseStatus.SUBMITTED;
    }
}
```

Mapper hanya membuat command:

```java
SubmissionCommand command = requestMapper.toCommand(request);
caseAggregate.submit(command);
```

Dengan cara ini:

- invariant tidak bisa dilewati oleh caller lain,
- mapping tetap deterministic,
- domain logic testable tanpa Jackson/MapStruct,
- error taxonomy lebih bersih.

---

## 13. Where to Put Normalizer?

Ada beberapa opsi.

### 13.1 DTO Constructor / Record Compact Constructor

Cocok untuk canonical DTO internal, bukan raw request DTO.

```java
public record ApplicantName(String value) {
    public ApplicantName {
        value = value == null ? null : value.strip();
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Applicant name is required");
        }
        if (value.length() > 200) {
            throw new IllegalArgumentException("Applicant name too long");
        }
    }
}
```

Kelebihan:

- invariant/value rule dekat dengan value,
- object selalu canonical.

Kekurangan:

- error handling framework bisa kurang rapi,
- raw value hilang jika tidak disimpan,
- kurang cocok untuk external request DTO yang ingin preserve input.

### 13.2 Dedicated Normalizer Class

Cocok untuk boundary yang butuh audit/replay.

```java
public final class SubmitApplicationNormalizer {
    public NormalizedSubmitApplication normalize(SubmitApplicationRequest request) {
        return new NormalizedSubmitApplication(
                request.applicantName(),
                stripToNull(request.applicantName()),
                request.postalCode(),
                normalizePostalCode(request.postalCode())
        );
    }
}
```

Kelebihan:

- eksplisit,
- bisa menyimpan raw + canonical,
- mudah dites,
- cocok untuk regulatory system.

Kekurangan:

- lebih banyak class,
- perlu discipline agar tidak berubah menjadi business service.

### 13.3 Mapper-Level Normalization

Boleh untuk conversion sederhana.

Contoh MapStruct:

```java
@Mapper
public interface ApplicantMapper {
    @Mapping(target = "name", expression = "java(stripToNull(request.name()))")
    ApplicantCommand toCommand(ApplicantRequest request);

    default String stripToNull(String value) {
        if (value == null) return null;
        String stripped = value.strip();
        return stripped.isEmpty() ? null : stripped;
    }
}
```

Tetapi jika normalization punya policy besar, lebih baik pisahkan.

Rule praktis:

```text
1-2 line pure transformation -> boleh di mapper.
Policy-rich canonicalization -> dedicated normalizer.
Domain-sensitive transformation -> domain/value object.
```

---

## 14. Value Object as Validation + Normalization Boundary

Value object adalah cara kuat untuk mencegah primitive obsession.

Buruk:

```java
public record SubmitApplicationCommand(
        String applicantId,
        String postalCode,
        String email,
        BigDecimal amount
) {}
```

Lebih kuat:

```java
public record SubmitApplicationCommand(
        ApplicantId applicantId,
        PostalCode postalCode,
        EmailAddress email,
        Money amount
) {}
```

Contoh:

```java
public record PostalCode(String value) {
    public PostalCode {
        value = value == null ? null : value.strip();
        if (value == null || !value.matches("\\d{6}")) {
            throw new IllegalArgumentException("postalCode must be 6 digits");
        }
    }
}
```

Value object membantu:

- canonical representation,
- validation lokal,
- domain type safety,
- mengurangi salah parameter,
- menjaga invariant kecil.

Namun jangan paksa semua field menjadi value object. Gunakan untuk field yang:

- punya format penting,
- sering dipakai lintas boundary,
- punya business meaning,
- sering salah tertukar,
- butuh normalization konsisten.

---

## 15. Anti-Pattern: Mapper yang “Memperbaiki” Data Diam-Diam

Contoh buruk:

```java
public BigDecimal normalizeAmount(BigDecimal amount) {
    if (amount == null) return BigDecimal.ZERO;
    if (amount.signum() < 0) return BigDecimal.ZERO;
    return amount;
}
```

Masalah:

- nilai negatif bisa jadi sinyal fraud/error,
- user tidak tahu input ditolak atau diubah,
- audit misleading,
- downstream melihat data “valid” padahal berasal dari input invalid,
- bug upstream disembunyikan.

Lebih baik:

```java
if (amount == null) {
    errors.add("declaredAmount", "is required");
} else if (amount.signum() < 0) {
    errors.add("declaredAmount", "must not be negative");
}
```

Atau jika business memang mengharuskan clamping:

```java
public NormalizedAmount normalize(BigDecimal raw) {
    if (raw.compareTo(MAX_ALLOWED) > 0) {
        return new NormalizedAmount(raw, MAX_ALLOWED, NormalizationReason.CAPPED_BY_POLICY);
    }
    return new NormalizedAmount(raw, raw, NormalizationReason.UNCHANGED);
}
```

Dengan begitu, perubahan tercatat.

---

## 16. Anti-Pattern: Validation di Setter

```java
public class ApplicationRequest {
    private String name;

    public void setName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name required");
        }
        this.name = name.trim();
    }
}
```

Masalah:

- Jackson/deserializer bisa gagal dengan exception kurang rapi,
- error collection sulit,
- setter order bisa memengaruhi cross-field validation,
- object partial sulit direpresentasikan,
- raw value hilang.

Setter validation boleh untuk entity/domain object tertentu, tetapi untuk request DTO lebih baik gunakan Bean Validation + explicit normalization pipeline.

---

## 17. Anti-Pattern: Entity Annotation Dipakai sebagai API Validation

Buruk:

```java
@Entity
public class ApplicationEntity {
    @NotBlank
    @Column(nullable = false)
    private String applicantName;

    @NotNull
    private BigDecimal amount;
}
```

Lalu controller menerima entity langsung:

```java
@PostMapping("/applications")
public ApplicationEntity create(@Valid @RequestBody ApplicationEntity entity) {
    return repository.save(entity);
}
```

Risiko:

- over-posting,
- field internal bisa diisi client,
- persistence concern bocor ke API,
- validation API dan DB constraint tercampur,
- lifecycle create/update/patch sulit dibedakan,
- entity relationship bisa di-bind dari payload,
- lazy/proxy/cycle serialization issue.

Lebih baik:

```java
@PostMapping("/applications")
public ApplicationResponse create(@Valid @RequestBody CreateApplicationRequest request) {
    CreateApplicationCommand command = mapper.toCommand(normalizer.normalize(request));
    Application application = service.create(command);
    return responseMapper.toResponse(application);
}
```

---

## 18. Error Response Design

Validation/mapping boundary harus menghasilkan error yang bisa dipakai client, QA, support, dan developer.

Contoh format:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "correlationId": "0f1c2a...",
  "errors": [
    {
      "path": "applicant.name",
      "code": "REQUIRED",
      "message": "Applicant name is required"
    },
    {
      "path": "declaredAmount",
      "code": "MIN_VALUE",
      "message": "Declared amount must be greater than 0"
    }
  ]
}
```

Untuk mapping error internal/integration:

```json
{
  "errorCode": "PAYLOAD_MAPPING_FAILED",
  "message": "Unable to map external payload",
  "correlationId": "0f1c2a...",
  "details": [
    {
      "path": "$.application.statusCode",
      "code": "UNKNOWN_EXTERNAL_CODE"
    }
  ]
}
```

Jangan expose:

- stack trace,
- class internal,
- SQL,
- full raw PII payload,
- secret/token,
- exact internal enum jika confidential.

Tetapi log internal harus cukup untuk debugging dengan masking.

---

## 19. Validation and Mapping in Batch/Import Systems

Batch import punya kebutuhan berbeda dari API request tunggal.

Dalam batch, kita sering tidak mau fail-fast pada row pertama. Kita ingin mengumpulkan semua error.

Pipeline:

```text
CSV/XML/JSON file
    -> parse rows
    -> bind raw row DTO
    -> validate each row syntactically
    -> normalize row
    -> semantic validation with reference data
    -> map valid rows to commands
    -> process valid rows
    -> generate rejection report for invalid rows
```

Row-level error model:

```java
public record RowValidationError(
        int rowNumber,
        String columnName,
        String rawValue,
        String code,
        String message
) {}
```

Batch normalizer sebaiknya tidak melempar exception untuk setiap error kecil. Lebih baik return result:

```java
public sealed interface RowNormalizationResult permits RowNormalizationResult.Valid, RowNormalizationResult.Invalid {
    record Valid(NormalizedRow row) implements RowNormalizationResult {}
    record Invalid(List<RowValidationError> errors) implements RowNormalizationResult {}
}
```

Hal ini penting untuk UX dan operations:

- user dapat daftar semua error,
- tidak perlu upload ulang berkali-kali,
- QA bisa melihat pattern error,
- support bisa menindaklanjuti row tertentu,
- audit batch lebih jelas.

---

## 20. Regulatory/Audit Perspective

Dalam sistem regulatory, mapping dan validation harus defensible.

Pertanyaan audit:

```text
Apa yang user submit?
Apa yang sistem ubah?
Kenapa sistem mengubahnya?
Kapan validasi dilakukan?
Rule versi berapa yang dipakai?
Siapa/komponen apa yang memutuskan data valid?
Apakah input invalid ditolak atau diperbaiki?
Apakah decision memakai raw atau canonical value?
Bisakah decision direkonstruksi?
```

Desain yang lebih defensible:

```java
public record NormalizationAuditEntry(
        String fieldPath,
        String rawValueMasked,
        String canonicalValueMasked,
        String ruleCode,
        String ruleVersion,
        NormalizationAction action
) {}
```

Contoh:

```json
{
  "fieldPath": "applicant.email",
  "rawValueMasked": "  f***@example.com  ",
  "canonicalValueMasked": "f***@example.com",
  "ruleCode": "EMAIL_TRIM",
  "ruleVersion": "2026-01",
  "action": "TRIMMED"
}
```

Tidak semua normalization perlu diaudit satu per satu. Tetapi field yang memengaruhi decision, eligibility, enforcement, payment, legal identity, dan external submission sebaiknya punya traceability.

---

## 21. Java 8 sampai Java 25: Design Evolution

### 21.1 Java 8 Style

Umum:

```java
public class CreateApplicationRequest {
    @NotBlank
    private String applicantName;

    public String getApplicantName() { return applicantName; }
    public void setApplicantName(String applicantName) { this.applicantName = applicantName; }
}
```

Kelebihan:

- kompatibel luas,
- mudah untuk framework lama,
- cocok dengan JavaBean tools.

Kekurangan:

- mutable,
- default constructor membuat partial object mudah ada,
- setter bisa dipanggil dari banyak tempat,
- missing/null/default ambiguity.

### 21.2 Java 16+ Records

```java
public record CreateApplicationRequest(
        @NotBlank String applicantName,
        @Pattern(regexp = "\\d{6}") String postalCode
) {}
```

Kelebihan:

- immutable shallow,
- constructor eksplisit,
- concise,
- cocok untuk DTO,
- lebih jelas sebagai data carrier.

Kekurangan:

- collection di dalam tetap mutable jika tidak dicopy,
- backward compatibility dengan framework lama perlu dicek,
- compact constructor yang melakukan normalization bisa menghilangkan raw value,
- tidak semua DTO cocok menjadi record jika butuh builder kompleks.

### 21.3 Modern Java Value-Oriented DTO Strategy

Untuk Java 21/25 style:

```text
External request DTO       -> record, minimal logic, preserve input
Normalized internal DTO    -> record/value object, canonical
Command                    -> record dengan domain-specific value object
Domain aggregate           -> class dengan invariant behavior
Response DTO               -> record/projection
Patch DTO                  -> explicit missing/null wrapper atau JsonNode boundary
```

---

## 22. Practical Architecture Pattern

Untuk aplikasi enterprise, pattern berikut cukup sehat:

```text
controller
  receives raw request DTO

request DTO
  syntactic constraints only

normalizer
  produces normalized input

semantic validator
  validates reference/cross-boundary rules

mapper
  normalized input -> command

application service
  loads aggregate, checks authorization, invokes domain behavior

domain
  enforces invariant

response mapper
  domain/read model -> response DTO
```

Contoh struktur package:

```text
application/
  api/
    dto/
      CreateCaseRequest.java
      CreateCaseResponse.java
    validation/
      CreateCaseRequestValidator.java
    normalizer/
      CreateCaseNormalizer.java
    mapper/
      CreateCaseApiMapper.java
  command/
    CreateCaseCommand.java
  service/
    CreateCaseService.java

domain/
  model/
    RegulatoryCase.java
    CaseStatus.java
    ApplicantId.java
  policy/
    CaseSubmissionPolicy.java

infrastructure/
  persistence/
    CaseEntity.java
    CasePersistenceMapper.java
  integration/
    ExternalAgencyPayload.java
    ExternalAgencyMapper.java
```

---

## 23. Decision Matrix

| Concern | Best Location | Why |
|---|---|---|
| JSON syntax valid | Jackson/parser | Payload-level concern |
| Unknown JSON field | ObjectMapper/profile | Contract strictness |
| Required API field | Request DTO validation | Input contract |
| Field length/pattern | Bean Validation | Declarative syntactic rule |
| Trim safe whitespace | Normalizer or value object | Canonical representation |
| Uppercase code | Normalizer or value object | Source-specific canonicalization |
| Cross-field pure rule | Class-level validation | Still input-local |
| Reference data check | Semantic validator/service | Needs external state |
| Authorization | Application service/security layer | Principal/resource relation |
| Workflow transition | Domain aggregate/policy | State invariant |
| Entity default status | Domain factory | Business initialization |
| Response masking | Response mapper/serializer | Output boundary |
| Audit raw value | Boundary/audit component | Evidence preservation |
| External code translation | Anti-corruption mapper | Integration boundary |

---

## 24. Checklist: Healthy Mapping/Validation Boundary

Gunakan checklist ini saat review code.

### 24.1 DTO Review

- Apakah DTO spesifik untuk operation/boundary?
- Apakah DTO tidak mengekspos entity internal?
- Apakah required/nullability jelas?
- Apakah primitive boolean/int tidak menyembunyikan missing field?
- Apakah DTO patch bisa membedakan missing vs null?
- Apakah validation annotation hanya untuk syntactic/input-local rule?

### 24.2 Normalization Review

- Apakah field boleh dinormalisasi secara legal/contractual?
- Apakah raw value perlu disimpan?
- Apakah normalization memakai locale eksplisit?
- Apakah normalization bisa menyembunyikan input invalid?
- Apakah normalization reason perlu diaudit?
- Apakah signed/legal/evidence text tidak diubah diam-diam?

### 24.3 Mapper Review

- Apakah mapper hanya melakukan transformation?
- Apakah mapper tidak query database tanpa alasan kuat?
- Apakah mapper tidak call external API?
- Apakah mapper tidak melakukan authorization?
- Apakah mapper tidak mengubah workflow state?
- Apakah mapping error dibedakan dari validation error?

### 24.4 Domain Review

- Apakah invariant ada di domain, bukan controller/mapper?
- Apakah aggregate tidak bisa masuk state invalid lewat public method?
- Apakah transition dicek terhadap current state?
- Apakah default business value dibuat di factory/domain service?
- Apakah audit event mencatat decision penting?

### 24.5 Test Review

- Ada test missing vs null vs empty vs blank?
- Ada test invalid raw sebelum normalization?
- Ada test canonical output setelah normalization?
- Ada test cross-field validation?
- Ada test semantic validation?
- Ada test invariant domain?
- Ada test mapping error unknown enum/code?
- Ada test audit trace untuk field penting?

---

## 25. Worked Example: Submit Enforcement Case

### 25.1 External Request

```json
{
  "caseType": " warning ",
  "respondentId": " a-001 ",
  "incidentDate": "2026-06-17",
  "remarks": "  Late submission detected.  ",
  "documents": [
    {"type": "NOTICE", "documentId": "D-100"}
  ]
}
```

### 25.2 Raw Request DTO

```java
public record SubmitEnforcementCaseRequest(
        @NotBlank String caseType,
        @NotBlank String respondentId,
        @NotNull LocalDate incidentDate,
        @Size(max = 4000) String remarks,
        @NotEmpty List<@Valid DocumentRequest> documents
) {}

public record DocumentRequest(
        @NotBlank String type,
        @NotBlank String documentId
) {}
```

This DTO validates basic shape only.

### 25.3 Normalized DTO

```java
public record NormalizedSubmitEnforcementCase(
        String rawCaseType,
        CaseType caseType,
        String rawRespondentId,
        RespondentId respondentId,
        LocalDate incidentDate,
        String rawRemarks,
        String canonicalRemarks,
        List<NormalizedDocument> documents
) {}
```

### 25.4 Normalizer

```java
public final class SubmitEnforcementCaseNormalizer {
    public NormalizedSubmitEnforcementCase normalize(SubmitEnforcementCaseRequest request) {
        String caseTypeCode = request.caseType().strip().toUpperCase(Locale.ROOT);
        String respondentCode = request.respondentId().strip().toUpperCase(Locale.ROOT);

        return new NormalizedSubmitEnforcementCase(
                request.caseType(),
                CaseType.fromCode(caseTypeCode),
                request.respondentId(),
                new RespondentId(respondentCode),
                request.incidentDate(),
                request.remarks(),
                normalizeRemarks(request.remarks()),
                request.documents().stream().map(this::normalizeDocument).toList()
        );
    }

    private String normalizeRemarks(String value) {
        if (value == null) return null;
        return value.strip();
    }

    private NormalizedDocument normalizeDocument(DocumentRequest document) {
        return new NormalizedDocument(
                document.type(),
                DocumentType.fromCode(document.type().strip().toUpperCase(Locale.ROOT)),
                document.documentId(),
                document.documentId().strip()
        );
    }
}
```

### 25.5 Semantic Validator

```java
public final class SubmitEnforcementCaseSemanticValidator {
    private final RespondentRepository respondentRepository;
    private final DocumentRepository documentRepository;

    public void validate(NormalizedSubmitEnforcementCase input) {
        if (!respondentRepository.existsById(input.respondentId())) {
            throw new SemanticValidationException("respondentId", "Respondent does not exist");
        }

        for (NormalizedDocument document : input.documents()) {
            if (!documentRepository.belongsToRespondent(document.documentId(), input.respondentId())) {
                throw new SemanticValidationException("documents", "Document does not belong to respondent");
            }
        }
    }
}
```

### 25.6 Mapper to Command

```java
public record SubmitEnforcementCaseCommand(
        CaseType caseType,
        RespondentId respondentId,
        LocalDate incidentDate,
        String remarks,
        List<DocumentRef> documents
) {}
```

```java
@Mapper
public interface SubmitEnforcementCaseMapper {
    SubmitEnforcementCaseCommand toCommand(NormalizedSubmitEnforcementCase input);
}
```

### 25.7 Domain Invariant

```java
public final class EnforcementCase {
    private CaseStatus status;
    private final List<DocumentRef> documents = new ArrayList<>();

    public void submit(SubmitEnforcementCaseCommand command) {
        if (status != CaseStatus.DRAFT) {
            throw new InvalidCaseTransitionException(status, CaseStatus.SUBMITTED);
        }
        if (command.documents().isEmpty()) {
            throw new DomainInvariantViolation("At least one document is required");
        }
        this.documents.addAll(command.documents());
        this.status = CaseStatus.SUBMITTED;
    }
}
```

Notice:

- request DTO validates syntax,
- normalizer canonicalizes safe fields,
- semantic validator checks reference ownership,
- mapper creates command,
- domain enforces state transition.

No single layer does everything.

---

## 26. Testing Strategy for This Boundary

### 26.1 Request Validation Test

```java
@Test
void rejectBlankCaseType() {
    SubmitEnforcementCaseRequest request = new SubmitEnforcementCaseRequest(
            "   ",
            "A-001",
            LocalDate.now(),
            "remarks",
            List.of(new DocumentRequest("NOTICE", "D-100"))
    );

    Set<ConstraintViolation<SubmitEnforcementCaseRequest>> violations = validator.validate(request);

    assertThat(violations).anyMatch(v -> v.getPropertyPath().toString().equals("caseType"));
}
```

### 26.2 Normalization Test

```java
@Test
void normalizeCaseTypeAndRespondentId() {
    SubmitEnforcementCaseRequest request = validRequest(" warning ", " a-001 ");

    NormalizedSubmitEnforcementCase normalized = normalizer.normalize(request);

    assertThat(normalized.rawCaseType()).isEqualTo(" warning ");
    assertThat(normalized.caseType()).isEqualTo(CaseType.WARNING);
    assertThat(normalized.rawRespondentId()).isEqualTo(" a-001 ");
    assertThat(normalized.respondentId()).isEqualTo(new RespondentId("A-001"));
}
```

### 26.3 Semantic Validation Test

```java
@Test
void rejectDocumentThatDoesNotBelongToRespondent() {
    when(documentRepository.belongsToRespondent(new DocumentId("D-100"), new RespondentId("A-001")))
            .thenReturn(false);

    assertThatThrownBy(() -> semanticValidator.validate(normalizedInput()))
            .isInstanceOf(SemanticValidationException.class);
}
```

### 26.4 Domain Invariant Test

```java
@Test
void cannotSubmitClosedCase() {
    EnforcementCase enforcementCase = closedCase();

    assertThatThrownBy(() -> enforcementCase.submit(validCommand()))
            .isInstanceOf(InvalidCaseTransitionException.class);
}
```

### 26.5 Missing vs Null Test

Untuk PATCH endpoint, wajib punya test ini:

```java
@Test
void missingEmailMeansNoChangeButNullMeansClear() {
    JsonNode missingEmail = objectMapper.readTree("{}");
    JsonNode nullEmail = objectMapper.readTree("{\"email\": null}");

    UpdateApplicantCommand missingCommand = patchMapper.toCommand(missingEmail);
    UpdateApplicantCommand nullCommand = patchMapper.toCommand(nullEmail);

    assertThat(missingCommand.email()).isInstanceOf(PatchField.Missing.class);
    assertThat(nullCommand.email()).isInstanceOf(PatchField.Present.class);
    assertThat(((PatchField.Present<?>) nullCommand.email()).value()).isNull();
}
```

---

## 27. Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana cara validate DTO ini?
```

Engineer senior bertanya:

```text
Boundary mana yang menerima data ini?
Apakah data ini raw, normalized, canonical, atau domain-safe?
Apakah missing dan null punya arti berbeda?
Apakah normalization legal untuk field ini?
Apakah kita perlu menyimpan raw untuk audit?
Apakah rule ini syntactic, semantic, authorization, atau invariant?
Apakah mapper sedang menyembunyikan business decision?
Apakah default value berasal dari Java, framework, atau policy eksplisit?
Apakah error ini harus terlihat sebagai validation error, conflict, atau mapping failure?
Apakah rule ini akan berubah per version, per source system, atau per operation?
```

Itulah perbedaan utama.

Mapping, validation, normalization, dan invariant adalah empat lapisan yang saling menyentuh, tetapi masing-masing punya tanggung jawab sendiri. Sistem yang matang tidak hanya “berhasil mengubah JSON menjadi object”; sistem yang matang tahu **kapan data masih mentah, kapan data sudah canonical, kapan data boleh dipercaya, dan siapa yang bertanggung jawab jika data berubah bentuk**.

---

## 28. Ringkasan

Di bagian ini kita membangun boundary mental model:

1. Deserialization mengubah payload menjadi object.
2. Mapping mengubah satu object model menjadi model lain.
3. Validation memutuskan apakah data boleh diterima.
4. Normalization membuat representasi canonical.
5. Domain invariant menjaga state domain tetap benar.
6. Missing, null, empty, blank, dan default harus dibedakan.
7. Mapper tidak boleh diam-diam menjadi validator, normalizer policy, authorization layer, atau workflow service.
8. Bean Validation cocok untuk syntactic/input-local constraint, bukan rule domain berat.
9. Value object berguna untuk type safety dan canonical representation.
10. Regulatory/audit system sering perlu raw + canonical value.
11. Error taxonomy harus membedakan parse, binding, validation, mapping, semantic, invariant, authorization, dan infrastructure failure.

Part berikutnya akan membahas **Error Handling and Diagnostics in Mapping Pipelines**, yaitu bagaimana membuat mapping failure bisa ditelusuri dengan field path, JSON pointer/XML location, correlation id, safe logging, replayability, dan dead-letter strategy.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./26-records-builders-modern-java-dto-strategy.md">⬅️ Part 26 — Records, Builders, and Modern Java DTO Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./28-error-handling-diagnostics-mapping-pipelines.md">Part 28 — Error Handling and Diagnostics in Mapping Pipelines ➡️</a>
</div>

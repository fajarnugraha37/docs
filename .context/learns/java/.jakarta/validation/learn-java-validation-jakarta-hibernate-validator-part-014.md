# learn-java-validation-jakarta-hibernate-validator-part-014

# Payload, Severity, Error Codes, and Machine-Readable Violations

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `014`  
> Topik: Payload, severity, error code, violation model, dan machine-readable validation result  
> Target: Java 8 sampai Java 25, Bean Validation 2.0, Jakarta Validation 3.x, Hibernate Validator 6 sampai 9

---

## 1. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas **message interpolation**: bagaimana pesan error dibuat, dilokalisasi, dan diamankan. Tetapi ada batas penting:

> **Human message bukan contract yang stabil.**

Di sistem production, terutama API, workflow, regulatory system, case management, batch import, mobile app, dan integrasi antar-service, validation result tidak boleh hanya berupa string seperti:

```text
must not be null
size must be between 3 and 50
invalid postal code
```

String seperti itu cocok untuk manusia, tetapi buruk sebagai kontrak mesin karena:

1. bisa berubah karena i18n;
2. bisa berubah karena wording diperbaiki;
3. bisa berbeda antar provider/version;
4. sulit dipakai frontend untuk mapping UI;
5. sulit dipakai client API untuk automated handling;
6. sulit dipakai audit dan analytics;
7. sulit dibedakan antara error, warning, soft violation, hard violation;
8. sulit dipakai untuk regulatory explanation.

Maka bagian ini membahas bagaimana mengubah Bean/Jakarta Validation dari sekadar "menghasilkan pesan" menjadi **structured validation error contract**.

Kita akan membahas:

- `payload` pada constraint annotation;
- metadata pada `ConstraintDescriptor`;
- severity marker;
- stable error code;
- mapping `ConstraintViolation` menjadi API error;
- error code taxonomy;
- machine-readable violation model;
- warning vs error;
- soft validation vs hard validation;
- frontend mapping;
- auditability;
- observability;
- anti-pattern;
- production checklist.

---

## 2. Mental Model: Validation Result Adalah Data, Bukan Teks

Validation result punya dua audience:

| Audience | Butuh Apa? | Bentuk yang Tepat |
|---|---|---|
| End user | pesan yang mudah dipahami | localized message |
| Frontend | field mapping dan display behavior | path, code, severity |
| API client | programmatic decision | stable error code |
| Backend service | routing/error handling | typed violation data |
| QA | reproducible failure | code, field, rejected category |
| Support | explanation | message + context |
| Auditor | rule traceability | rule id, version, severity |
| Product owner | metrics | violation distribution |
| Security | leakage control | no raw sensitive value |

Jadi `ConstraintViolation#getMessage()` hanya salah satu output. Ia bukan keseluruhan contract.

Top-tier design melihat validation error sebagai struktur:

```json
{
  "code": "APPLICATION.APPLICANT.EMAIL.INVALID_FORMAT",
  "message": "Email address is not valid.",
  "field": "applicant.email",
  "severity": "ERROR",
  "constraint": "Email",
  "rejectedValuePresent": true,
  "rejectedValueDisplayable": false,
  "context": {
    "min": null,
    "max": null
  }
}
```

Bukan hanya:

```json
{
  "error": "must be a well-formed email address"
}
```

---

## 3. Apa Itu `payload` di Bean/Jakarta Validation?

Setiap constraint annotation wajib memiliki elemen berikut:

```java
String message() default "{...}";
Class<?>[] groups() default {};
Class<? extends Payload>[] payload() default {};
```

Contoh custom constraint:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE_USE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = PostalCodeValidator.class)
@Target({ FIELD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidPostalCode {
    String message() default "{application.postalCode.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

`payload` adalah metadata tambahan yang bisa ditempelkan pada deklarasi constraint.

Contoh penggunaan:

```java
public final class Severity {
    private Severity() {}

    public interface Info extends Payload {}
    public interface Warning extends Payload {}
    public interface Error extends Payload {}
    public interface Fatal extends Payload {}
}
```

Lalu:

```java
public class CreateApplicantRequest {

    @NotBlank(
        message = "{applicant.name.required}",
        payload = Severity.Error.class
    )
    private String name;

    @Email(
        message = "{applicant.email.invalid}",
        payload = Severity.Warning.class
    )
    private String email;
}
```

Kemudian saat violation terjadi, payload bisa dibaca dari metadata:

```java
Set<ConstraintViolation<CreateApplicantRequest>> violations = validator.validate(request);

for (ConstraintViolation<CreateApplicantRequest> violation : violations) {
    Set<Class<? extends Payload>> payloads =
        violation.getConstraintDescriptor().getPayload();

    boolean warning = payloads.contains(Severity.Warning.class);
}
```

### Intinya

`payload` tidak memengaruhi valid atau tidaknya object. Ia adalah **metadata**. Validasi tetap gagal jika constraint gagal. Tetapi payload bisa digunakan untuk mengklasifikasikan hasil validasi.

---

## 4. Kenapa `payload` Jarang Dipakai?

Ada beberapa alasan:

1. Banyak tutorial berhenti di `@NotNull` dan `@Valid`.
2. Banyak aplikasi cukup dengan HTTP 400 sederhana.
3. `payload` tidak otomatis muncul di response API.
4. Framework seperti Spring/JAX-RS biasanya expose message/path, bukan payload secara eksplisit.
5. Banyak tim tidak punya error code taxonomy.
6. Banyak rule sebenarnya lebih cocok menjadi domain validation, bukan Bean Validation.

Namun di sistem besar, payload berguna ketika kita butuh:

- severity;
- classification;
- frontend rendering hint;
- migration phase;
- soft validation;
- audit tag;
- internal routing;
- rule metadata.

Tetapi perlu hati-hati: payload bukan tempat ideal untuk menyimpan data dinamis seperti `caseId`, `userId`, `maxLimit` runtime, atau hasil query database. Payload adalah class metadata statis.

---

## 5. `payload` vs `groups` vs `message`

Ketiganya sering tertukar.

| Mekanisme | Fungsi Utama | Contoh | Jangan Dipakai Untuk |
|---|---|---|---|
| `message` | human-readable text/template | `{email.invalid}` | machine logic |
| `groups` | memilih constraint mana yang dijalankan | `Create`, `Update` | severity/error type |
| `payload` | metadata tambahan pada constraint | `Severity.Error` | menentukan kapan constraint aktif |

Contoh salah:

```java
public interface WarningGroup {}
public interface ErrorGroup {}

@Email(groups = WarningGroup.class)
private String email;
```

Ini membingungkan karena group dipakai sebagai severity. Group seharusnya menjawab:

> "Constraint ini aktif pada skenario validasi apa?"

Payload menjawab:

> "Jika constraint ini gagal, failure ini diklasifikasikan sebagai apa?"

---

## 6. Severity: Error, Warning, Info, Fatal

Severity membantu membedakan dampak violation.

Contoh taxonomy sederhana:

```java
public final class ValidationSeverity {
    private ValidationSeverity() {}

    public interface Info extends Payload {}
    public interface Warning extends Payload {}
    public interface Error extends Payload {}
    public interface Fatal extends Payload {}
}
```

Makna:

| Severity | Makna | Biasanya Blocking? |
|---|---|---|
| `INFO` | informasi kualitas data | tidak |
| `WARNING` | data mencurigakan/tidak ideal | kadang tidak |
| `ERROR` | request invalid | ya |
| `FATAL` | invalid secara serius/security/domain critical | ya |

Contoh:

```java
public class ApplicationDraftRequest {

    @Size(
        max = 500,
        message = "{application.remarks.tooLong}",
        payload = ValidationSeverity.Error.class
    )
    private String remarks;

    @Pattern(
        regexp = "^[A-Z0-9-]+$",
        message = "{application.reference.format.warning}",
        payload = ValidationSeverity.Warning.class
    )
    private String externalReference;
}
```

Tapi ada masalah besar:

> Bean Validation secara default hanya menghasilkan violation. Ia tidak membedakan blocking vs non-blocking secara otomatis.

Jika `@Pattern` gagal, object dianggap tidak valid. Walaupun payload-nya `Warning`, constraint tetap violation.

Maka jika ingin warning tidak blocking, ada beberapa desain:

1. jalankan warning validation dalam group terpisah;
2. gunakan custom validation pipeline;
3. jangan gunakan Bean Validation untuk warning;
4. pisahkan `HardValidation` dan `AdvisoryValidation`.

---

## 7. Hard Validation vs Soft Validation

### Hard Validation

Hard validation menolak request.

Contoh:

- required field missing;
- invalid enum;
- invalid date range;
- invalid amount;
- unauthorized transition;
- duplicate reference final check di database.

Output biasanya HTTP 400/422 atau domain rejection.

### Soft Validation

Soft validation memberi peringatan tetapi masih boleh lanjut.

Contoh:

- nama tampak terlalu pendek;
- alamat tidak ditemukan di reference data, tetapi user boleh override;
- dokumen hampir expired;
- submission melewati business hours tapi masih diterima;
- data imported dari legacy source tidak lengkap tetapi masuk quarantine.

Bean Validation cocok untuk hard validation. Untuk soft validation, Bean Validation bisa dipakai, tetapi perlu pipeline eksplisit.

Contoh group:

```java
public interface HardChecks {}
public interface SoftChecks {}
```

DTO:

```java
public class SubmitApplicationRequest {

    @NotBlank(
        message = "{application.applicantName.required}",
        groups = HardChecks.class,
        payload = ValidationSeverity.Error.class
    )
    private String applicantName;

    @Size(
        min = 10,
        message = "{application.remarks.tooShort}",
        groups = SoftChecks.class,
        payload = ValidationSeverity.Warning.class
    )
    private String remarks;
}
```

Pipeline:

```java
Set<ConstraintViolation<SubmitApplicationRequest>> hardViolations =
    validator.validate(request, HardChecks.class);

if (!hardViolations.isEmpty()) {
    throw new ValidationException(toErrors(hardViolations));
}

Set<ConstraintViolation<SubmitApplicationRequest>> warnings =
    validator.validate(request, SoftChecks.class);

return new ValidationOutcome(
    List.of(),
    toWarnings(warnings)
);
```

Ini lebih eksplisit daripada mengandalkan payload saja.

---

## 8. Stable Error Code: Contract yang Sebenarnya

Message boleh berubah. Code jangan mudah berubah.

Contoh buruk:

```json
{
  "message": "must not be blank"
}
```

Contoh lebih baik:

```json
{
  "code": "APPLICANT.NAME.REQUIRED",
  "message": "Applicant name is required.",
  "field": "applicant.name"
}
```

Error code adalah contract antara:

- backend dan frontend;
- backend dan mobile app;
- backend dan API consumer;
- backend dan support tooling;
- backend dan analytics;
- backend dan audit report.

### Desain Error Code

Beberapa pola:

#### Pattern 1 — Domain Field Based

```text
APPLICANT.NAME.REQUIRED
APPLICANT.EMAIL.INVALID_FORMAT
APPLICATION.SUBMISSION_DATE.PAST_NOT_ALLOWED
```

Kelebihan:

- mudah dipahami;
- cocok untuk FE mapping;
- cocok untuk user-facing API.

Kekurangan:

- bisa berubah jika domain rename;
- bisa terlalu banyak.

#### Pattern 2 — Generic Constraint Based

```text
VALIDATION.NOT_NULL
VALIDATION.NOT_BLANK
VALIDATION.EMAIL
VALIDATION.SIZE_MAX
```

Kelebihan:

- sedikit;
- reusable.

Kekurangan:

- kurang expressive;
- frontend tetap perlu field mapping;
- sulit untuk domain-specific copywriting.

#### Pattern 3 — Hybrid

```text
VALIDATION.APPLICANT.NAME.REQUIRED
VALIDATION.APPLICANT.EMAIL.INVALID_FORMAT
VALIDATION.APPLICATION.DOCUMENTS.MIN_REQUIRED
```

Biasanya paling seimbang.

#### Pattern 4 — Rule ID Based

```text
RULE-APP-001
RULE-APP-002
RULE-CASE-017
```

Kelebihan:

- sangat cocok untuk audit/regulatory;
- stabil walaupun wording berubah;
- bisa dihubungkan ke rule catalog.

Kekurangan:

- tidak self-explanatory;
- perlu registry/catalog.

Untuk sistem regulatori/case management, pattern terbaik sering berupa kombinasi:

```json
{
  "code": "APPLICATION.APPLICANT.EMAIL.INVALID_FORMAT",
  "ruleId": "APP-VAL-EMAIL-001",
  "message": "Applicant email address is invalid."
}
```

---

## 9. Di Mana Error Code Didefinisikan?

Ada beberapa opsi.

### Opsi A — Message Key sebagai Error Code

```java
@NotBlank(message = "{applicant.name.required}")
private String name;
```

Mapper:

```java
String template = violation.getMessageTemplate();
// returns something like "{applicant.name.required}"
String code = normalizeTemplateToCode(template);
```

Misalnya:

```java
private static String normalizeTemplateToCode(String template) {
    if (template == null) {
        return "VALIDATION.UNKNOWN";
    }
    if (template.startsWith("{") && template.endsWith("}")) {
        return template.substring(1, template.length() - 1)
                .toUpperCase(Locale.ROOT)
                .replace('.', '_');
    }
    return "VALIDATION.UNKNOWN";
}
```

Kelebihan:

- tidak perlu custom annotation;
- mudah diadopsi;
- message key sudah ada.

Kekurangan:

- mencampur i18n key dan error code;
- jika message key berubah, code ikut berubah;
- tidak semua constraint memakai key custom.

### Opsi B — Custom Payload sebagai Code Marker

```java
public interface ErrorCodePayload extends Payload {
    String code(); // tidak bisa begini karena interface class marker tidak membawa value runtime
}
```

Payload di Jakarta Validation adalah class marker, bukan object instance. Jadi payload tidak ideal untuk menyimpan string code dinamis.

Namun bisa dibuat marker class:

```java
public final class ErrorCodes {
    private ErrorCodes() {}

    public interface ApplicantNameRequired extends Payload {}
    public interface ApplicantEmailInvalid extends Payload {}
}
```

Penggunaan:

```java
@NotBlank(
    message = "{applicant.name.required}",
    payload = ErrorCodes.ApplicantNameRequired.class
)
private String name;
```

Mapper:

```java
Map<Class<? extends Payload>, String> codeRegistry = Map.of(
    ErrorCodes.ApplicantNameRequired.class, "APPLICANT.NAME.REQUIRED",
    ErrorCodes.ApplicantEmailInvalid.class, "APPLICANT.EMAIL.INVALID_FORMAT"
);
```

Kelebihan:

- code tidak tergantung message;
- compile-time reference;
- bisa dikombinasikan dengan severity.

Kekurangan:

- banyak marker class;
- registry harus dijaga;
- kurang ergonomis.

### Opsi C — Custom Constraint Attribute

Custom constraint bisa punya attribute code:

```java
@Documented
@Constraint(validatedBy = ValidPostalCodeValidator.class)
@Target({ FIELD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidPostalCode {
    String message() default "{postalCode.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String code() default "ADDRESS.POSTAL_CODE.INVALID";
}
```

Saat mapping:

```java
Map<String, Object> attributes =
    violation.getConstraintDescriptor().getAttributes();

Object code = attributes.get("code");
```

Kelebihan:

- sangat jelas;
- code dekat dengan rule;
- mudah dibaca dari `ConstraintDescriptor`.

Kekurangan:

- hanya berlaku untuk custom constraint;
- built-in constraints tidak punya `code` attribute;
- perlu convention tambahan.

### Opsi D — External Registry Berdasarkan Field + Constraint

```yaml
CreateApplicantRequest:
  name:
    NotBlank: APPLICANT.NAME.REQUIRED
  email:
    Email: APPLICANT.EMAIL.INVALID_FORMAT
```

Kelebihan:

- tidak perlu mengubah annotation;
- cocok untuk generated model;
- bisa dikelola sebagai rule catalog.

Kekurangan:

- rawan drift;
- refactor field bisa memutus mapping;
- perlu test coverage.

### Opsi E — Dedicated Domain Validation Result

Untuk rule kompleks, jangan paksa Bean Validation menghasilkan semua code.

```java
public record RuleViolation(
    String code,
    String ruleId,
    String path,
    Severity severity,
    String messageKey,
    Map<String, Object> parameters
) {}
```

Ini cocok untuk workflow/domain policy.

---

## 10. Rekomendasi Praktis Error Code Strategy

Untuk large production system:

1. Built-in constraints boleh memakai message template key sebagai fallback code.
2. Custom constraints sebaiknya punya explicit `code` attribute jika rule-nya domain-specific.
3. Domain/workflow validation sebaiknya memakai explicit `RuleViolation`, bukan `ConstraintViolation` mentah.
4. Payload dipakai untuk severity/classification, bukan primary code storage.
5. Semua public API response harus punya stable `code`.
6. Human message tidak boleh dipakai client untuk branching logic.

Contoh policy:

```text
Rule:
- Every validation error returned by public API must include a stable machine-readable code.
- The code must not be derived from localized message.
- If no domain-specific code exists, use VALIDATION.<CONSTRAINT_SIMPLE_NAME> as fallback.
- Frontend must branch on code, not message.
- Support/audit tools must store code and ruleId, not only message.
```

---

## 11. Machine-Readable Violation Model

Contoh Java model:

```java
public enum ViolationSeverity {
    INFO,
    WARNING,
    ERROR,
    FATAL
}
```

```java
public record ValidationError(
    String code,
    String message,
    String messageTemplate,
    String path,
    String objectName,
    String constraint,
    ViolationSeverity severity,
    Object rejectedValue,
    boolean rejectedValueIncluded,
    Map<String, Object> attributes
) {}
```

Untuk Java 8:

```java
public final class ValidationError {
    private final String code;
    private final String message;
    private final String messageTemplate;
    private final String path;
    private final String objectName;
    private final String constraint;
    private final ViolationSeverity severity;
    private final Object rejectedValue;
    private final boolean rejectedValueIncluded;
    private final Map<String, Object> attributes;

    public ValidationError(
            String code,
            String message,
            String messageTemplate,
            String path,
            String objectName,
            String constraint,
            ViolationSeverity severity,
            Object rejectedValue,
            boolean rejectedValueIncluded,
            Map<String, Object> attributes) {
        this.code = code;
        this.message = message;
        this.messageTemplate = messageTemplate;
        this.path = path;
        this.objectName = objectName;
        this.constraint = constraint;
        this.severity = severity;
        this.rejectedValue = rejectedValue;
        this.rejectedValueIncluded = rejectedValueIncluded;
        this.attributes = attributes == null
                ? Collections.emptyMap()
                : Collections.unmodifiableMap(new LinkedHashMap<>(attributes));
    }

    public String getCode() { return code; }
    public String getMessage() { return message; }
    public String getMessageTemplate() { return messageTemplate; }
    public String getPath() { return path; }
    public String getObjectName() { return objectName; }
    public String getConstraint() { return constraint; }
    public ViolationSeverity getSeverity() { return severity; }
    public Object getRejectedValue() { return rejectedValue; }
    public boolean isRejectedValueIncluded() { return rejectedValueIncluded; }
    public Map<String, Object> getAttributes() { return attributes; }
}
```

Response wrapper:

```java
public record ValidationErrorResponse(
    String type,
    String title,
    int status,
    String detail,
    String traceId,
    List<ValidationError> errors
) {}
```

Contoh JSON:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request contains invalid fields.",
  "traceId": "01J9Z6V7EK8P9R2Y1A5C3D4E5F",
  "errors": [
    {
      "code": "APPLICANT.NAME.REQUIRED",
      "message": "Applicant name is required.",
      "messageTemplate": "{applicant.name.required}",
      "path": "applicant.name",
      "objectName": "CreateApplicationRequest",
      "constraint": "NotBlank",
      "severity": "ERROR",
      "rejectedValueIncluded": false,
      "attributes": {}
    },
    {
      "code": "APPLICANT.EMAIL.INVALID_FORMAT",
      "message": "Applicant email address is invalid.",
      "messageTemplate": "{applicant.email.invalid}",
      "path": "applicant.email",
      "objectName": "CreateApplicationRequest",
      "constraint": "Email",
      "severity": "ERROR",
      "rejectedValueIncluded": false,
      "attributes": {}
    }
  ]
}
```

---

## 12. Mapping `ConstraintViolation` ke `ValidationError`

Mapper dasar:

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Payload;
import jakarta.validation.metadata.ConstraintDescriptor;

import java.lang.annotation.Annotation;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class ConstraintViolationMapper {

    public ValidationError toError(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();

        String constraint = resolveConstraintName(descriptor);
        String path = violation.getPropertyPath().toString();
        String messageTemplate = violation.getMessageTemplate();
        String code = resolveCode(violation, descriptor);
        ViolationSeverity severity = resolveSeverity(descriptor.getPayload());

        Object rejectedValue = sanitizeRejectedValue(path, violation.getInvalidValue());
        boolean includeRejectedValue = rejectedValue != null;

        return new ValidationError(
                code,
                violation.getMessage(),
                messageTemplate,
                path,
                violation.getRootBeanClass().getSimpleName(),
                constraint,
                severity,
                rejectedValue,
                includeRejectedValue,
                safeAttributes(descriptor)
        );
    }

    private String resolveConstraintName(ConstraintDescriptor<?> descriptor) {
        Annotation annotation = descriptor.getAnnotation();
        return annotation.annotationType().getSimpleName();
    }

    private String resolveCode(
            ConstraintViolation<?> violation,
            ConstraintDescriptor<?> descriptor) {

        Map<String, Object> attributes = descriptor.getAttributes();
        Object explicitCode = attributes.get("code");
        if (explicitCode instanceof String code && !code.isBlank()) {
            return code;
        }

        String template = violation.getMessageTemplate();
        if (template != null && template.startsWith("{") && template.endsWith("}")) {
            return template.substring(1, template.length() - 1)
                    .toUpperCase(Locale.ROOT)
                    .replace('.', '_')
                    .replace('-', '_');
        }

        return "VALIDATION." + resolveConstraintName(descriptor).toUpperCase(Locale.ROOT);
    }

    private ViolationSeverity resolveSeverity(Set<Class<? extends Payload>> payloads) {
        if (payloads.contains(ValidationSeverityPayload.Fatal.class)) {
            return ViolationSeverity.FATAL;
        }
        if (payloads.contains(ValidationSeverityPayload.Warning.class)) {
            return ViolationSeverity.WARNING;
        }
        if (payloads.contains(ValidationSeverityPayload.Info.class)) {
            return ViolationSeverity.INFO;
        }
        return ViolationSeverity.ERROR;
    }

    private Object sanitizeRejectedValue(String path, Object invalidValue) {
        if (invalidValue == null) {
            return null;
        }

        if (isSensitive(path)) {
            return null;
        }

        if (invalidValue instanceof CharSequence value) {
            if (value.length() > 128) {
                return value.subSequence(0, 128).toString() + "...";
            }
            return value.toString();
        }

        if (invalidValue instanceof Number || invalidValue instanceof Boolean) {
            return invalidValue;
        }

        return null;
    }

    private boolean isSensitive(String path) {
        String normalized = path == null ? "" : path.toLowerCase(Locale.ROOT);
        return normalized.contains("password")
                || normalized.contains("token")
                || normalized.contains("secret")
                || normalized.contains("credential")
                || normalized.contains("nric")
                || normalized.contains("identity")
                || normalized.contains("passport")
                || normalized.contains("email")
                || normalized.contains("phone");
    }

    private Map<String, Object> safeAttributes(ConstraintDescriptor<?> descriptor) {
        Map<String, Object> result = new LinkedHashMap<>();

        for (Map.Entry<String, Object> entry : descriptor.getAttributes().entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();

            if ("message".equals(key) || "groups".equals(key) || "payload".equals(key)) {
                continue;
            }

            if (isSafeAttributeValue(value)) {
                result.put(key, value);
            }
        }

        return result;
    }

    private boolean isSafeAttributeValue(Object value) {
        return value == null
                || value instanceof String
                || value instanceof Number
                || value instanceof Boolean
                || value instanceof Enum<?>;
    }
}
```

Payload marker:

```java
import jakarta.validation.Payload;

public final class ValidationSeverityPayload {
    private ValidationSeverityPayload() {}

    public interface Info extends Payload {}
    public interface Warning extends Payload {}
    public interface Error extends Payload {}
    public interface Fatal extends Payload {}
}
```

Catatan untuk Java 8: ganti pattern matching `instanceof` dengan casting manual.

---

## 13. Jangan Bocorkan `rejectedValue` Sembarangan

`ConstraintViolation#getInvalidValue()` sangat berguna untuk debug, tetapi berbahaya di response/log.

Contoh data yang tidak boleh dibocorkan:

- password;
- token;
- OTP;
- API key;
- NRIC/NIK/passport;
- email/phone tergantung policy;
- address;
- document number;
- free-text remarks yang mungkin berisi PII;
- uploaded filename jika mengandung data pribadi;
- entire object graph.

Lebih aman:

```json
{
  "code": "PASSWORD.TOO_SHORT",
  "path": "password",
  "message": "Password does not meet the minimum length.",
  "rejectedValueIncluded": false
}
```

Daripada:

```json
{
  "path": "password",
  "rejectedValue": "abc123"
}
```

Prinsip:

> Default jangan include rejected value. Allowlist hanya untuk field non-sensitive dan nilai kecil seperti number boundary atau enum code.

---

## 14. Attribute Extraction: `min`, `max`, `regexp`, `value`

`ConstraintDescriptor#getAttributes()` dapat menyediakan metadata dari annotation.

Contoh `@Size(min = 3, max = 50)`:

```java
Map<String, Object> attributes = descriptor.getAttributes();
Object min = attributes.get("min");
Object max = attributes.get("max");
```

Response:

```json
{
  "code": "APPLICANT.NAME.SIZE",
  "path": "applicant.name",
  "constraint": "Size",
  "attributes": {
    "min": 3,
    "max": 50
  }
}
```

Ini membantu frontend membuat pesan sendiri atau menampilkan helper text.

Namun hati-hati dengan:

- `regexp` pada `@Pattern`: bisa panjang atau mengungkap rule internal;
- custom attributes yang berisi class/object;
- enum internal;
- payload/groups/message;
- script/expression.

Sebaiknya filter attribute.

---

## 15. Severity via Payload: Implementasi Lengkap

DTO:

```java
public class CreateCaseRequest {

    @NotBlank(
        message = "{case.title.required}",
        payload = ValidationSeverityPayload.Error.class
    )
    private String title;

    @Size(
        max = 1000,
        message = "{case.description.tooLong}",
        payload = ValidationSeverityPayload.Error.class
    )
    private String description;

    @Pattern(
        regexp = "^[A-Z0-9-]+$",
        message = "{case.externalReference.formatWarning}",
        payload = ValidationSeverityPayload.Warning.class
    )
    private String externalReference;
}
```

Mapping severity:

```java
private ViolationSeverity resolveSeverity(Set<Class<? extends Payload>> payloads) {
    if (payloads.contains(ValidationSeverityPayload.Fatal.class)) {
        return ViolationSeverity.FATAL;
    }
    if (payloads.contains(ValidationSeverityPayload.Warning.class)) {
        return ViolationSeverity.WARNING;
    }
    if (payloads.contains(ValidationSeverityPayload.Info.class)) {
        return ViolationSeverity.INFO;
    }
    return ViolationSeverity.ERROR;
}
```

Tetapi ingat:

> Jika constraint gagal, Bean Validation tetap menganggapnya violation. Payload hanya memberi label.

Untuk warning non-blocking, jalankan group berbeda.

---

## 16. Warning Non-Blocking dengan Group Terpisah

Marker:

```java
public interface BlockingValidation {}
public interface AdvisoryValidation {}
```

DTO:

```java
public class SubmitCaseRequest {

    @NotBlank(
        groups = BlockingValidation.class,
        message = "{case.title.required}",
        payload = ValidationSeverityPayload.Error.class
    )
    private String title;

    @Size(
        min = 20,
        groups = AdvisoryValidation.class,
        message = "{case.description.shortWarning}",
        payload = ValidationSeverityPayload.Warning.class
    )
    private String description;
}
```

Pipeline:

```java
public ValidationOutcome validateForSubmit(SubmitCaseRequest request) {
    Set<ConstraintViolation<SubmitCaseRequest>> blocking =
            validator.validate(request, BlockingValidation.class);

    if (!blocking.isEmpty()) {
        return ValidationOutcome.rejected(map(blocking));
    }

    Set<ConstraintViolation<SubmitCaseRequest>> advisory =
            validator.validate(request, AdvisoryValidation.class);

    return ValidationOutcome.acceptedWithWarnings(map(advisory));
}
```

Outcome:

```java
public record ValidationOutcome(
    boolean accepted,
    List<ValidationError> errors,
    List<ValidationError> warnings
) {
    public static ValidationOutcome rejected(List<ValidationError> errors) {
        return new ValidationOutcome(false, errors, List.of());
    }

    public static ValidationOutcome acceptedWithWarnings(List<ValidationError> warnings) {
        return new ValidationOutcome(true, List.of(), warnings);
    }
}
```

Untuk Java 8, gunakan class biasa.

---

## 17. Error Code dari Custom Constraint Attribute

Custom annotation:

```java
@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidCaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String code() default "CASE.REFERENCE.INVALID";
}
```

Validator:

```java
public final class CaseReferenceValidator
        implements ConstraintValidator<ValidCaseReference, String> {

    private static final Pattern PATTERN =
            Pattern.compile("^CASE-[0-9]{4}-[0-9]{6}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return PATTERN.matcher(value).matches();
    }
}
```

Usage:

```java
@ValidCaseReference(
    code = "APPLICATION.RELATED_CASE_REFERENCE.INVALID_FORMAT",
    message = "{application.relatedCaseReference.invalidFormat}",
    payload = ValidationSeverityPayload.Error.class
)
private String relatedCaseReference;
```

Mapper:

```java
Object explicitCode = descriptor.getAttributes().get("code");
if (explicitCode instanceof String code && !code.isBlank()) {
    return code;
}
```

Ini clean untuk domain-specific reusable constraints.

---

## 18. Error Code untuk Built-in Constraints

Built-in constraints tidak punya `code` attribute. Beberapa opsi:

### Opsi 1 — Message Template Key

```java
@NotBlank(message = "{application.applicant.name.required}")
private String applicantName;
```

Code derived:

```text
APPLICATION_APPLICANT_NAME_REQUIRED
```

Lebih baik jika code didefinisikan langsung sebagai message key:

```text
APPLICATION.APPLICANT.NAME.REQUIRED
```

Lalu properties:

```properties
APPLICATION.APPLICANT.NAME.REQUIRED=Applicant name is required.
```

### Opsi 2 — Wrapper Custom Constraint

Daripada:

```java
@NotBlank(message = "{application.applicant.name.required}")
```

Buat:

```java
@Documented
@NotBlank
@Constraint(validatedBy = {})
@Target({ FIELD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface RequiredApplicantName {
    String message() default "{APPLICATION.APPLICANT.NAME.REQUIRED}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Kelebihan:

- domain-specific;
- reusable;
- stable message key.

Kekurangan:

- bisa terlalu banyak annotation;
- overengineering jika field sedikit.

### Opsi 3 — External Mapping

```java
@NotBlank
private String applicantName;
```

Mapping:

```yaml
CreateApplicationRequest.applicantName.NotBlank: APPLICATION.APPLICANT.NAME.REQUIRED
```

Cocok untuk generated DTO tetapi perlu governance ketat.

---

## 19. Problem Details Style Response

Untuk REST API modern, validation error sering dibungkus dalam format mirip Problem Details.

Contoh:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more request fields are invalid.",
  "instance": "/applications",
  "traceId": "01J9Z6V7EK8P9R2Y1A5C3D4E5F",
  "errors": [
    {
      "code": "APPLICATION.APPLICANT.NAME.REQUIRED",
      "path": "applicant.name",
      "message": "Applicant name is required.",
      "severity": "ERROR"
    }
  ]
}
```

Jangan campur semua validation error menjadi satu string:

```json
{
  "message": "name must not be blank, email must be valid, date must be future"
}
```

Itu buruk untuk FE, client, support, audit, dan observability.

---

## 20. HTTP Status: 400 vs 422 vs 409

Tidak ada satu jawaban universal, tetapi model umum:

| Kondisi | Status Umum | Catatan |
|---|---:|---|
| JSON malformed | 400 | request tidak bisa diparse |
| field type mismatch | 400 | misalnya string untuk number |
| Bean Validation gagal pada input | 400 atau 422 | tergantung API convention |
| semantic domain rule gagal | 422 | request syntactically valid, semantically invalid |
| duplicate karena unique constraint | 409 | conflict dengan state resource |
| optimistic locking conflict | 409 | stale version |
| unauthorized action | 403 | bukan validation biasa |
| unauthenticated | 401 | bukan validation |

Yang penting:

> Konsisten dan terdokumentasi.

Untuk sistem internal enterprise, sering cukup:

- `400` untuk request validation;
- `409` untuk conflict state;
- `403` untuk permission;
- `422` jika API style memang membedakan semantic validation.

---

## 21. Field Path Normalization

`ConstraintViolation#getPropertyPath().toString()` bisa menghasilkan path seperti:

```text
applicant.addresses[0].postalCode
submit.arg0.applicantName
createApplication.request.applicant.email
addresses<K>[home].postalCode
addresses[home].postalCode
```

Tergantung konteks:

- bean validation;
- method validation;
- parameter names tersedia atau tidak;
- map key/value;
- container element;
- framework wrapper.

Untuk public API, path perlu dinormalisasi.

Contoh target format:

```text
applicant.addresses[0].postalCode
addresses[home].postalCode
request.applicant.name
```

Hindari membocorkan internal method name:

```text
submitApplication.arg0.applicant.name
```

Mapper path sebaiknya punya aturan:

1. hapus method root jika response untuk request body;
2. ganti `arg0` dengan `request` jika parameter name tidak tersedia;
3. preserve index list;
4. preserve map key jika aman;
5. jangan expose class/internal field name jika beda dari JSON property.

Jika memakai Jackson naming strategy, field Java `applicantName` bisa menjadi JSON `applicant_name`. Maka path mapping perlu sadar serialization naming.

---

## 22. Constraint Name sebagai Diagnostic, Bukan Contract Utama

`constraint` seperti `NotBlank`, `Size`, `Email`, `ValidPostalCode` berguna, tetapi jangan jadikan public contract utama.

Kenapa?

1. Constraint bisa diganti tanpa perubahan makna bisnis.
2. Custom constraint bisa di-refactor.
3. Provider/package berubah `javax` ke `jakarta`.
4. Built-in constraint semantics mungkin tidak cukup domain-specific.

Gunakan:

```json
{
  "code": "APPLICANT.NAME.REQUIRED",
  "constraint": "NotBlank"
}
```

Bukan hanya:

```json
{
  "constraint": "NotBlank"
}
```

---

## 23. Rule ID dan Rule Version untuk Regulatory Systems

Untuk sistem regulatori, error code saja kadang belum cukup. Perlu rule identity yang stabil.

Contoh:

```json
{
  "code": "APPLICATION.SUBMISSION.DECLARATION.REQUIRED",
  "ruleId": "APP-SUBMIT-DECL-001",
  "ruleVersion": "2026.01",
  "path": "declaration.accepted",
  "message": "Declaration must be accepted before submission.",
  "severity": "ERROR"
}
```

Manfaat:

- audit bisa melihat rule mana yang menolak submission;
- support bisa lookup rule catalog;
- perubahan rule bisa dilacak;
- migration bisa membedakan rule lama vs rule baru;
- dispute handling lebih defensible.

Untuk Bean Validation, `ruleId` bisa dikelola lewat:

1. custom annotation attribute;
2. external registry;
3. mapping dari error code ke rule catalog;
4. domain validation layer terpisah.

Contoh custom annotation:

```java
public @interface AcceptedDeclaration {
    String message() default "{APPLICATION.SUBMISSION.DECLARATION.REQUIRED}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String code() default "APPLICATION.SUBMISSION.DECLARATION.REQUIRED";
    String ruleId() default "APP-SUBMIT-DECL-001";
    String ruleVersion() default "2026.01";
}
```

Tetapi hati-hati: jika rule version sering berubah runtime, external registry lebih baik daripada compile-time annotation.

---

## 24. Validation Error Catalog

Top-tier system biasanya punya catalog:

| Code | Rule ID | Severity | HTTP | Message Key | Owner | Since | Notes |
|---|---|---|---:|---|---|---|---|
| `APPLICANT.NAME.REQUIRED` | `APP-001` | ERROR | 400 | same | Application Team | 1.0 | Required on create/submit |
| `APPLICANT.EMAIL.INVALID_FORMAT` | `APP-002` | ERROR | 400 | same | Application Team | 1.0 | Format only, not deliverability |
| `CASE.STATUS.TRANSITION.INVALID` | `CASE-017` | ERROR | 409/422 | same | Case Team | 2.1 | Workflow guard |
| `DOCUMENT.EXPIRY.WARNING` | `DOC-011` | WARNING | 200 | same | Document Team | 2.3 | Non-blocking warning |

Catalog bisa disimpan sebagai:

- markdown;
- YAML;
- database reference table;
- OpenAPI extension;
- code enum;
- generated static class.

Yang penting:

- code stabil;
- owner jelas;
- severity jelas;
- deprecation policy ada;
- frontend tahu mapping;
- support bisa search.

---

## 25. Enum Error Code: Pro dan Kontra

Contoh:

```java
public enum ValidationErrorCode {
    APPLICANT_NAME_REQUIRED("APPLICANT.NAME.REQUIRED"),
    APPLICANT_EMAIL_INVALID_FORMAT("APPLICANT.EMAIL.INVALID_FORMAT");

    private final String code;

    ValidationErrorCode(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Kelebihan:

- compile-time safety;
- discoverable;
- bisa attach metadata;
- mudah dites.

Kekurangan:

- bisa menjadi giant enum;
- cross-module coupling;
- sulit untuk plugin/dynamic rule;
- setiap perubahan perlu deploy.

Untuk modular monolith, enum per bounded context lebih sehat:

```java
ApplicationValidationCodes
CaseValidationCodes
DocumentValidationCodes
ComplianceValidationCodes
```

Untuk microservices, masing-masing service punya namespace code sendiri.

---

## 26. Error Code Namespace Design

Gunakan namespace yang mencerminkan ownership, bukan struktur teknis sementara.

Contoh baik:

```text
APPLICATION.APPLICANT.NAME.REQUIRED
CASE.TRANSITION.INVALID
DOCUMENT.FILE.SIZE_EXCEEDED
PAYMENT.AMOUNT.NEGATIVE
```

Contoh buruk:

```text
DTO001
REQ_ERR_12
ValidationErrorX
ControllerBadRequest1
createRequest.name.notblank
```

Kenapa buruk?

- tidak menjelaskan domain;
- sulit dicari;
- rawan berubah karena refactor teknis;
- tidak membantu support.

Pattern rekomendasi:

```text
<DOMAIN>.<SUBJECT>.<FIELD_OR_RULE>.<REASON>
```

Contoh:

```text
APPLICATION.APPLICANT.EMAIL.INVALID_FORMAT
APPLICATION.DOCUMENT.MINIMUM_REQUIRED.NOT_MET
CASE.ASSIGNMENT.OFFICER.REQUIRED
CASE.TRANSITION.FROM_STATUS.NOT_ALLOWED
```

---

## 27. Frontend Contract

Frontend biasanya butuh:

1. path untuk menempelkan error ke field;
2. code untuk custom rendering;
3. message untuk display default;
4. severity untuk warna/icon/blocking;
5. attributes untuk dynamic message;
6. global errors untuk object-level violation.

Contoh field error:

```json
{
  "code": "APPLICANT.EMAIL.INVALID_FORMAT",
  "path": "applicant.email",
  "message": "Email address is invalid.",
  "severity": "ERROR"
}
```

Contoh global error:

```json
{
  "code": "APPLICATION.DATE_RANGE.INVALID",
  "path": "",
  "message": "Application start date must be before end date.",
  "severity": "ERROR"
}
```

Atau:

```json
{
  "code": "APPLICATION.DATE_RANGE.INVALID",
  "path": "$",
  "message": "Application start date must be before end date.",
  "severity": "ERROR"
}
```

Untuk class-level violation yang ditempelkan ke field tertentu, gunakan custom property path seperti dibahas di part 010.

---

## 28. API Client Contract

API client tidak boleh parsing message.

Buruk:

```javascript
if (error.message.includes("email")) {
  highlightEmail();
}
```

Baik:

```javascript
if (error.code === "APPLICANT.EMAIL.INVALID_FORMAT") {
  highlightEmail();
}
```

Contract rule:

```text
- `code` is stable across locales.
- `message` is not stable and must not be used for programmatic branching.
- `path` follows JSON request field naming, not Java internal naming.
- Unknown codes must be handled gracefully.
```

---

## 29. Validation and OpenAPI

Bean Validation annotation bisa membantu generate OpenAPI schema, misalnya:

- `@NotNull` → required;
- `@Size(max = 50)` → maxLength;
- `@Min(1)` → minimum;
- `@Pattern` → pattern.

Tetapi OpenAPI schema tidak selalu bisa menangkap:

- validation group;
- conditional requiredness;
- class-level rule;
- workflow state rule;
- soft warning;
- custom payload severity;
- dynamic group sequence;
- DB-backed consistency;
- authorization-dependent validation.

Maka error code catalog perlu melengkapi OpenAPI.

Contoh extension:

```yaml
x-error-codes:
  - APPLICATION.APPLICANT.NAME.REQUIRED
  - APPLICATION.APPLICANT.EMAIL.INVALID_FORMAT
  - APPLICATION.DATE_RANGE.INVALID
```

Atau per endpoint:

```yaml
paths:
  /applications:
    post:
      x-validation-errors:
        - code: APPLICATION.APPLICANT.NAME.REQUIRED
          path: applicant.name
          severity: ERROR
        - code: APPLICATION.DATE_RANGE.INVALID
          path: $
          severity: ERROR
```

---

## 30. Spring Boot Mapping Example

Spring Boot biasanya menghasilkan `MethodArgumentNotValidException` untuk request body validation dan `ConstraintViolationException` untuk method/path/query validation, tergantung setup.

Contoh handler konseptual:

```java
@RestControllerAdvice
public class ValidationExceptionHandler {

    private final ConstraintViolationMapper violationMapper;

    public ValidationExceptionHandler(ConstraintViolationMapper violationMapper) {
        this.violationMapper = violationMapper;
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ValidationErrorResponse> handleConstraintViolation(
            ConstraintViolationException exception,
            HttpServletRequest request) {

        List<ValidationError> errors = exception.getConstraintViolations()
                .stream()
                .map(violationMapper::toError)
                .toList();

        ValidationErrorResponse body = new ValidationErrorResponse(
                "https://api.example.com/problems/validation-error",
                "Validation failed",
                400,
                "One or more request values are invalid.",
                traceId(),
                errors
        );

        return ResponseEntity.badRequest().body(body);
    }
}
```

Untuk `MethodArgumentNotValidException`, Spring expose `FieldError` dan `ObjectError`, bukan selalu raw `ConstraintViolation`. Mapping-nya berbeda dan perlu mengambil codes/arguments dari Spring binding result atau normalize lewat strategi terpisah.

Prinsipnya tetap sama:

- stable code;
- path;
- message;
- severity;
- safe rejected value policy.

---

## 31. JAX-RS / Jakarta REST Mapping Example

Di Jakarta REST, Bean Validation integration bisa melempar `ConstraintViolationException` atau framework-specific validation exception tergantung runtime.

Mapper konseptual:

```java
@Provider
public class ConstraintViolationExceptionMapper
        implements ExceptionMapper<ConstraintViolationException> {

    private final ConstraintViolationMapper mapper = new ConstraintViolationMapper();

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        List<ValidationError> errors = exception.getConstraintViolations()
                .stream()
                .map(mapper::toError)
                .collect(Collectors.toList());

        ValidationErrorResponse response = new ValidationErrorResponse(
                "https://api.example.com/problems/validation-error",
                "Validation failed",
                400,
                "One or more request values are invalid.",
                currentTraceId(),
                errors
        );

        return Response.status(Response.Status.BAD_REQUEST)
                .entity(response)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .build();
    }
}
```

Yang perlu diperhatikan:

- parameter path bisa mengandung method name;
- path/query/header violation perlu path format berbeda;
- return value violation mungkin berarti server bug, bukan client error;
- jangan semua `ConstraintViolationException` otomatis HTTP 400.

---

## 32. Caller Fault vs Provider Fault

Tidak semua violation berarti request user salah.

| Violation Location | Biasanya Salah Siapa? | Response |
|---|---|---|
| request body field | client/user | 400/422 |
| path/query/header parameter | client/user | 400 |
| service method input internal | caller internal | 400/500 tergantung boundary |
| method return value | provider/server | 500 atau bug alert |
| repository return value | server/data integrity | 500 |
| event consumer inbound payload | producer/client | DLQ/reject |
| outbound event validation | server bug | alert/block publish |

Jika return value validation gagal, jangan balas user dengan "email invalid" seolah input salah. Itu bisa berarti backend menghasilkan data yang melanggar kontrak.

---

## 33. Violation Result untuk Batch Import

Batch import tidak bisa selalu reject seluruh file hanya karena satu row invalid.

Model:

```json
{
  "accepted": false,
  "summary": {
    "totalRows": 1000,
    "validRows": 940,
    "invalidRows": 60,
    "warnings": 120
  },
  "rowErrors": [
    {
      "row": 12,
      "errors": [
        {
          "code": "APPLICANT.EMAIL.INVALID_FORMAT",
          "path": "email",
          "message": "Email address is invalid.",
          "severity": "ERROR"
        }
      ]
    }
  ]
}
```

Untuk batch, tambahkan:

- row number;
- sheet name;
- column name;
- original column header;
- severity;
- code;
- remediation hint;
- whether row is accepted/quarantined/rejected.

Bean Validation bisa memvalidasi row DTO, tetapi batch outcome model harus dibuat sendiri.

---

## 34. Validation Result untuk Event-Driven System

Inbound event validation membutuhkan metadata tambahan:

```json
{
  "eventId": "evt-001",
  "eventType": "ApplicationSubmitted",
  "eventVersion": "2.0",
  "producer": "application-service",
  "validationStatus": "REJECTED",
  "errors": [
    {
      "code": "EVENT.APPLICATION_ID.REQUIRED",
      "path": "applicationId",
      "severity": "ERROR"
    }
  ]
}
```

Classification:

| Category | Meaning | Action |
|---|---|---|
| invalid schema | payload shape invalid | reject/DLQ |
| unsupported version | consumer cannot process | DLQ/park |
| missing reference | maybe eventual consistency | retry or park |
| domain invalid | producer bug or stale event | reject/alert |
| transient dependency | not validation failure | retry |

Jangan campur transient dependency failure dengan validation error.

---

## 35. Observability: Metrics dari Error Code

Jika validation error punya stable code, kita bisa membuat metrics:

```text
validation_failures_total{code="APPLICANT.EMAIL.INVALID_FORMAT", endpoint="POST /applications"} 123
validation_failures_total{code="APPLICANT.NAME.REQUIRED", endpoint="POST /applications"} 456
```

Insight yang bisa diambil:

- field mana paling sering gagal;
- client mana yang sering mengirim invalid request;
- apakah release frontend baru memperbanyak error;
- apakah rule baru terlalu ketat;
- apakah user journey membingungkan;
- apakah integrasi eksternal rusak;
- apakah ada abuse attempt.

Tetapi jangan pakai high-cardinality label seperti raw path dengan index besar, user id, request id, rejected value.

Baik:

```text
code="APPLICANT.EMAIL.INVALID_FORMAT"
endpoint="POST /applications"
client="mobile-app"
```

Buruk:

```text
rejectedValue="fajar@example.com"
traceId="..."
path="documents[837].name"
```

---

## 36. Logging Validation Error

Log internal boleh lebih detail daripada response, tapi tetap aman.

Contoh log event:

```json
{
  "event": "validation_failed",
  "traceId": "01J9Z6V7EK8P9R2Y1A5C3D4E5F",
  "endpoint": "POST /applications",
  "actorType": "PUBLIC_USER",
  "clientId": "web-portal",
  "errorCodes": [
    "APPLICANT.NAME.REQUIRED",
    "APPLICANT.EMAIL.INVALID_FORMAT"
  ],
  "errorCount": 2
}
```

Jangan log:

```json
{
  "password": "abc123",
  "nric": "S1234567D",
  "fullPayload": { ... }
}
```

Policy:

```text
- Log code, path, severity, count, endpoint, traceId.
- Do not log raw rejected values by default.
- Do not log full request body for validation failure.
- Redact known sensitive fields.
- Use sampling for noisy validation failure.
```

---

## 37. Audit Trail: Validation Failure sebagai Evidence

Di sistem regulatori, beberapa validation failure perlu masuk audit trail, tetapi tidak semuanya.

Contoh yang mungkin perlu audit:

- submission ditolak karena declaration belum diterima;
- approval gagal karena maker-checker violation;
- transition ditolak karena status tidak valid;
- document rejected karena expired;
- user mencoba action di luar authority.

Contoh yang biasanya tidak perlu audit detail:

- typo email pada draft;
- blank optional remarks;
- UI form validation biasa.

Audit model:

```json
{
  "action": "SUBMIT_APPLICATION_REJECTED",
  "caseId": "APP-2026-000123",
  "actorId": "user-001",
  "timestamp": "2026-06-16T10:15:30Z",
  "validationFailures": [
    {
      "code": "APPLICATION.DECLARATION.REQUIRED",
      "ruleId": "APP-SUBMIT-DECL-001",
      "ruleVersion": "2026.01",
      "severity": "ERROR",
      "path": "declaration.accepted"
    }
  ]
}
```

Audit harus menyimpan:

- code;
- rule id;
- rule version;
- actor;
- action;
- timestamp;
- target entity;
- no unnecessary PII.

---

## 38. Soft Rollout of New Validation Rules

Dalam sistem besar, rule baru jangan langsung hard-fail semua client tanpa observasi.

Rollout pattern:

1. **Observe-only**: rule dievaluasi, tetapi tidak dikembalikan ke user.
2. **Warn**: rule dikembalikan sebagai warning, tidak blocking.
3. **Block for new clients**: rule blocking untuk client versi baru.
4. **Block for all**: rule menjadi hard validation.
5. **Tighten**: threshold diperketat jika data sudah bersih.

Output saat warn:

```json
{
  "accepted": true,
  "warnings": [
    {
      "code": "DOCUMENT.EXPIRY.NEAR",
      "message": "The document will expire soon.",
      "severity": "WARNING"
    }
  ]
}
```

Ini sulit dilakukan jika validation hanya berupa exception. Maka perlu validation outcome model.

---

## 39. ConstraintViolation Tidak Selalu Cukup

`ConstraintViolation` bagus untuk Bean/Jakarta Validation. Tetapi untuk domain validation, kadang kurang.

Misalnya:

- rule butuh evidence;
- rule butuh remediation instruction;
- rule punya owner;
- rule punya version;
- rule punya legal basis;
- rule punya severity yang bisa berubah runtime;
- rule bisa warning atau blocking tergantung state;
- rule butuh explainability.

Maka buat model domain:

```java
public record DomainRuleViolation(
    String code,
    String ruleId,
    String ruleVersion,
    String path,
    ViolationSeverity severity,
    String messageKey,
    Map<String, Object> parameters,
    String remediationKey,
    boolean blocking
) {}
```

Lalu unify output:

```java
public record ValidationIssue(
    String source,
    String code,
    String ruleId,
    String path,
    ViolationSeverity severity,
    String message,
    boolean blocking
) {}
```

Sources:

```text
BEAN_VALIDATION
DOMAIN_POLICY
WORKFLOW_GUARD
DATABASE_CONSTRAINT
EXTERNAL_REFERENCE
```

Ini memberi arsitektur yang lebih jujur.

---

## 40. Database Constraint Error Mapping

Validation tidak berhenti di Bean Validation. Database bisa menolak:

- `NOT NULL`;
- `UNIQUE`;
- `CHECK`;
- `FOREIGN KEY`;
- trigger;
- exclusion constraint;
- optimistic lock.

Jika database error langsung dikembalikan mentah, hasilnya buruk:

```text
ORA-00001: unique constraint violated SYS_C0012345
```

Harus dimapping:

```json
{
  "code": "APPLICATION.REFERENCE.ALREADY_EXISTS",
  "message": "Application reference already exists.",
  "severity": "ERROR"
}
```

Buat registry:

```yaml
databaseConstraints:
  UK_APPLICATION_REFERENCE:
    code: APPLICATION.REFERENCE.ALREADY_EXISTS
    httpStatus: 409
    messageKey: APPLICATION.REFERENCE.ALREADY_EXISTS
```

Prinsip:

> Database constraint adalah final consistency guard. Ia juga harus masuk error code taxonomy.

---

## 41. Security Classification dengan Payload

Payload bisa dipakai untuk klasifikasi security.

```java
public final class ValidationClassification {
    private ValidationClassification() {}

    public interface UserCorrectable extends Payload {}
    public interface SuspiciousInput extends Payload {}
    public interface SecurityRelevant extends Payload {}
    public interface InternalInvariant extends Payload {}
}
```

Penggunaan:

```java
@Pattern(
    regexp = "^[a-zA-Z0-9_-]+$",
    message = "{username.invalidCharacters}",
    payload = {
        ValidationSeverityPayload.Error.class,
        ValidationClassification.SuspiciousInput.class
    }
)
private String username;
```

Mapper bisa menandai:

```java
boolean securityRelevant = payloads.contains(
    ValidationClassification.SecurityRelevant.class
);
```

Namun jangan overuse. Jika semua input invalid dianggap suspicious, signal menjadi noise.

---

## 42. Combining Multiple Payloads

Payload array bisa berisi banyak marker:

```java
@NotBlank(
    message = "{application.nric.required}",
    payload = {
        ValidationSeverityPayload.Error.class,
        ValidationClassification.SecurityRelevant.class,
        ValidationAudience.PublicApi.class
    }
)
private String nric;
```

Contoh marker:

```java
public final class ValidationAudience {
    private ValidationAudience() {}

    public interface PublicApi extends Payload {}
    public interface InternalApi extends Payload {}
    public interface BatchImport extends Payload {}
}
```

Tapi ada batas: payload marker terlalu banyak membuat annotation sulit dibaca.

Kalau metadata makin kompleks, gunakan registry atau domain rule catalog.

---

## 43. Jangan Jadikan Payload Sebagai Rule Engine

Anti-pattern:

```java
@NotBlank(payload = {
    Error.class,
    PublicApi.class,
    SubmitStep.class,
    OfficerRole.class,
    SingaporeJurisdiction.class,
    HighRiskCase.class,
    RequiresAudit.class
})
private String field;
```

Ini sulit dibaca dan sulit dirawat.

Payload cocok untuk metadata kecil dan statis:

- severity;
- classification;
- audience;
- high-level category.

Payload tidak cocok untuk:

- workflow state;
- role-based requiredness;
- runtime jurisdiction;
- tenant policy;
- dynamic threshold;
- external reference condition;
- database result.

---

## 44. Constraint Attribute sebagai Context Parameters

Custom constraint bisa expose attribute yang berguna untuk response.

```java
public @interface MaxFileSize {
    String message() default "{file.size.exceeded}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    long bytes();
    String code() default "FILE.SIZE.EXCEEDED";
}
```

Response:

```json
{
  "code": "FILE.SIZE.EXCEEDED",
  "path": "documents[0].file",
  "message": "File size exceeds the maximum allowed size.",
  "attributes": {
    "bytes": 10485760
  }
}
```

Frontend bisa menampilkan:

```text
Maximum file size is 10 MB.
```

Tetapi jangan expose attribute internal seperti:

- SQL query;
- regex kompleks;
- internal class;
- secret threshold;
- tenant policy not meant for client.

---

## 45. Validation Result Ordering

`Set<ConstraintViolation<?>>` tidak menjamin urutan yang berarti untuk user.

Untuk API response, sort hasilnya.

Contoh sorting:

1. severity descending: fatal, error, warning, info;
2. path lexicographic;
3. code lexicographic;
4. original order if available.

```java
errors.sort(
    Comparator.comparing(ValidationError::severity, severityComparator())
            .thenComparing(ValidationError::path, Comparator.nullsFirst(String::compareTo))
            .thenComparing(ValidationError::code)
);
```

Kenapa penting?

- snapshot test stabil;
- frontend rendering stabil;
- user experience lebih rapi;
- diff regression lebih mudah.

---

## 46. Deduplication

Kadang satu field menghasilkan beberapa error:

```java
@NotBlank
@Size(min = 3, max = 50)
private String name;
```

Jika input `""`, bisa muncul:

- `NotBlank`;
- `Size` min.

Apakah dua-duanya perlu dikirim? Tergantung UX.

Pilihan:

1. kirim semua;
2. kirim satu per field;
3. gunakan group sequence untuk stop setelah requiredness gagal;
4. frontend hanya tampilkan error pertama per field;
5. severity/rule priority menentukan error utama.

Untuk API publik, kirim semua sering lebih transparan. Untuk UI form, satu error per field sering lebih nyaman.

Group sequence bisa membantu:

```java
public interface BasicChecks {}
public interface DetailedChecks {}

@GroupSequence({ BasicChecks.class, DetailedChecks.class })
public interface OrderedChecks {}
```

Requiredness masuk `BasicChecks`, size/format masuk `DetailedChecks`.

---

## 47. Machine-Readable Violation untuk Container Element

Contoh DTO:

```java
public record CreateRequest(
    List<@NotBlank(message = "{tag.required}") String> tags
) {}
```

Violation path bisa:

```text
tags[2].<list element>
```

API path sebaiknya dinormalisasi:

```text
tags[2]
```

Contoh response:

```json
{
  "code": "TAG.REQUIRED",
  "path": "tags[2]",
  "message": "Tag is required.",
  "constraint": "NotBlank"
}
```

Map:

```java
Map<@NotBlank String, @Valid Address> addresses
```

Potential path:

```text
addresses<K>[].<map key>
addresses[home].postalCode
```

Normalize dengan hati-hati agar FE bisa menempelkan error ke field yang benar.

---

## 48. Machine-Readable Violation untuk Method Validation

Contoh:

```java
public Application create(
    @NotNull(message = "{application.command.required}") CreateApplicationCommand command
) { ... }
```

Raw path mungkin:

```text
create.command
```

Atau jika parameter name tidak tersedia:

```text
create.arg0
```

Untuk public API, path harus diarahkan ke request body atau parameter.

```json
{
  "code": "APPLICATION.COMMAND.REQUIRED",
  "path": "$",
  "message": "Request body is required."
}
```

Untuk internal service validation, path internal boleh dipakai di log, tetapi response publik jangan bocorkan method structure.

---

## 49. Machine-Readable Violation untuk Class-Level Constraint

Contoh:

```java
@ValidDateRange(
    start = "startDate",
    end = "endDate",
    message = "{application.dateRange.invalid}",
    code = "APPLICATION.DATE_RANGE.INVALID"
)
public class ApplicationPeriodRequest {
    private LocalDate startDate;
    private LocalDate endDate;
}
```

Jika validator tidak membuat custom path, path bisa kosong/object-level.

Response:

```json
{
  "code": "APPLICATION.DATE_RANGE.INVALID",
  "path": "$",
  "message": "Start date must be before end date."
}
```

Jika ingin tempel ke `endDate`:

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
        .addPropertyNode("endDate")
        .addConstraintViolation();
```

Response:

```json
{
  "code": "APPLICATION.DATE_RANGE.INVALID",
  "path": "endDate",
  "message": "End date must be after start date."
}
```

---

## 50. Versioning Error Codes

Error code sebaiknya stabil. Jangan version code kecuali perlu.

Buruk:

```text
APPLICANT.NAME.REQUIRED.V1
APPLICANT.NAME.REQUIRED.V2
```

Lebih baik:

```text
APPLICANT.NAME.REQUIRED
```

Jika rule semantics berubah signifikan, gunakan rule version terpisah:

```json
{
  "code": "APPLICANT.NAME.REQUIRED",
  "ruleId": "APP-001",
  "ruleVersion": "2026.02"
}
```

Code berubah jika meaning berubah secara incompatible, misalnya:

```text
DOCUMENT.EXPIRY.WARNING
DOCUMENT.EXPIRY.BLOCKING
```

Atau:

```text
APPLICATION.SUBMISSION.DEADLINE_MISSED
APPLICATION.SUBMISSION.DEADLINE_GRACE_PERIOD_EXPIRED
```

---

## 51. Backward Compatibility

Untuk public API:

- jangan hapus code tanpa deprecation;
- jangan ubah semantic code diam-diam;
- jangan ubah path format tanpa versioning;
- jangan ubah severity dari warning ke error tanpa rollout;
- jangan ubah HTTP status sembarangan;
- jangan ubah `message` kalau client salah mengandalkan message, tetapi tetap edukasi client agar pindah ke code.

Compatibility policy:

```text
Compatible:
- Adding a new validation error code for a new optional field.
- Adding attributes to an existing error object.
- Improving human-readable message without changing code.

Potentially breaking:
- Changing code value.
- Changing path naming convention.
- Changing warning to blocking error.
- Changing HTTP status.
- Removing an error code.
```

---

## 52. Internationalization with Stable Code

Code stabil lintas locale:

```json
{
  "code": "APPLICANT.NAME.REQUIRED",
  "message": "Applicant name is required."
}
```

Dalam Bahasa Indonesia:

```json
{
  "code": "APPLICANT.NAME.REQUIRED",
  "message": "Nama pemohon wajib diisi."
}
```

Frontend atau backend boleh melakukan localization. Tetapi code tetap sama.

Message key bisa sama dengan code:

```properties
APPLICANT.NAME.REQUIRED=Applicant name is required.
```

```properties
APPLICANT.NAME.REQUIRED=Nama pemohon wajib diisi.
```

Ini pattern yang sederhana dan kuat.

---

## 53. Machine-Readable Remediation

Untuk complex domain, violation sebaiknya tidak hanya bilang "invalid", tetapi memberi remediation hint.

Contoh:

```json
{
  "code": "DOCUMENT.EXPIRED",
  "message": "The uploaded document has expired.",
  "remediationCode": "UPLOAD_NEW_DOCUMENT",
  "remediationMessage": "Upload a document with a valid expiry date."
}
```

Atau:

```json
{
  "code": "CASE.TRANSITION.NOT_ALLOWED",
  "message": "Case cannot be approved from Draft status.",
  "remediationCode": "SUBMIT_CASE_FIRST"
}
```

Bean Validation payload tidak ideal untuk dynamic remediation. Gunakan rule catalog/domain validation model.

---

## 54. Validation Issue Aggregation Across Layers

Dalam satu request, issue bisa datang dari beberapa layer:

1. request DTO Bean Validation;
2. command validation;
3. domain policy;
4. workflow guard;
5. persistence constraint;
6. external reference validation.

Jangan paksa semuanya menjadi `ConstraintViolation`. Buat unified output:

```java
public record ValidationIssue(
    String source,
    String code,
    String ruleId,
    String path,
    ViolationSeverity severity,
    String message,
    boolean blocking,
    Map<String, Object> attributes
) {}
```

Layer mapper:

```java
List<ValidationIssue> issues = new ArrayList<>();
issues.addAll(beanValidationAdapter.validate(request));
issues.addAll(domainPolicy.validate(command));
issues.addAll(workflowGuard.validateTransition(caseEntity, action));
```

Then decide:

```java
boolean hasBlocking = issues.stream().anyMatch(ValidationIssue::blocking);
```

Ini membuat sistem validasi lebih jujur dan extensible.

---

## 55. Case Management Example

Misalnya endpoint:

```http
POST /applications/{applicationId}/submit
```

Validation layers:

### DTO Bean Validation

```java
public record SubmitApplicationRequest(
    @AssertTrue(
        message = "{APPLICATION.DECLARATION.REQUIRED}",
        payload = ValidationSeverityPayload.Error.class
    )
    boolean declarationAccepted,

    @Size(
        max = 1000,
        message = "{APPLICATION.SUBMISSION.REMARKS.TOO_LONG}",
        payload = ValidationSeverityPayload.Error.class
    )
    String remarks
) {}
```

### Domain Policy

```java
public List<DomainRuleViolation> validateSubmission(Application application) {
    List<DomainRuleViolation> violations = new ArrayList<>();

    if (application.hasNoApplicant()) {
        violations.add(new DomainRuleViolation(
                "APPLICATION.APPLICANT.REQUIRED_BEFORE_SUBMIT",
                "APP-SUBMIT-001",
                "2026.01",
                "applicant",
                ViolationSeverity.ERROR,
                "APPLICATION.APPLICANT.REQUIRED_BEFORE_SUBMIT",
                Map.of(),
                "ADD_APPLICANT",
                true
        ));
    }

    if (application.hasExpiringDocument()) {
        violations.add(new DomainRuleViolation(
                "APPLICATION.DOCUMENT.EXPIRY.WARNING",
                "APP-SUBMIT-009",
                "2026.01",
                "documents",
                ViolationSeverity.WARNING,
                "APPLICATION.DOCUMENT.EXPIRY.WARNING",
                Map.of("days", 7),
                "REVIEW_DOCUMENT",
                false
        ));
    }

    return violations;
}
```

### Unified Response

```json
{
  "accepted": false,
  "errors": [
    {
      "source": "BEAN_VALIDATION",
      "code": "APPLICATION.DECLARATION.REQUIRED",
      "path": "declarationAccepted",
      "severity": "ERROR",
      "blocking": true,
      "message": "Declaration must be accepted before submission."
    },
    {
      "source": "DOMAIN_POLICY",
      "code": "APPLICATION.APPLICANT.REQUIRED_BEFORE_SUBMIT",
      "ruleId": "APP-SUBMIT-001",
      "ruleVersion": "2026.01",
      "path": "applicant",
      "severity": "ERROR",
      "blocking": true,
      "message": "Applicant details must be completed before submission."
    }
  ],
  "warnings": [
    {
      "source": "DOMAIN_POLICY",
      "code": "APPLICATION.DOCUMENT.EXPIRY.WARNING",
      "ruleId": "APP-SUBMIT-009",
      "path": "documents",
      "severity": "WARNING",
      "blocking": false,
      "message": "One or more documents will expire soon."
    }
  ]
}
```

---

## 56. Testing Strategy

### Test 1 — Code Is Stable

```java
@Test
void nameBlankProducesStableCode() {
    CreateApplicantRequest request = new CreateApplicantRequest("", "valid@example.com");

    Set<ConstraintViolation<CreateApplicantRequest>> violations = validator.validate(request);

    List<ValidationError> errors = violations.stream()
            .map(mapper::toError)
            .toList();

    assertThat(errors)
            .extracting(ValidationError::code)
            .contains("APPLICANT.NAME.REQUIRED");
}
```

### Test 2 — Message Is Localized but Code Same

```java
@Test
void codeDoesNotChangeWhenLocaleChanges() {
    ValidationError en = validateWithLocale(Locale.ENGLISH);
    ValidationError id = validateWithLocale(Locale.forLanguageTag("id-ID"));

    assertThat(en.code()).isEqualTo(id.code());
    assertThat(en.message()).isNotEqualTo(id.message());
}
```

### Test 3 — Sensitive Rejected Value Not Exposed

```java
@Test
void passwordRejectedValueIsNotIncluded() {
    RegistrationRequest request = new RegistrationRequest("abc");

    ValidationError error = validateFirst(request);

    assertThat(error.path()).isEqualTo("password");
    assertThat(error.rejectedValueIncluded()).isFalse();
    assertThat(error.rejectedValue()).isNull();
}
```

### Test 4 — Severity from Payload

```java
@Test
void payloadMapsToWarningSeverity() {
    Set<Class<? extends Payload>> payloads = Set.of(ValidationSeverityPayload.Warning.class);

    ViolationSeverity severity = mapper.resolveSeverity(payloads);

    assertThat(severity).isEqualTo(ViolationSeverity.WARNING);
}
```

### Test 5 — Attributes Are Safe

```java
@Test
void sizeAttributesAreIncluded() {
    ValidationError error = validateFirst(new Request("ab"));

    assertThat(error.attributes()).containsEntry("min", 3);
    assertThat(error.attributes()).containsEntry("max", 50);
}
```

---

## 57. Anti-Patterns

### Anti-Pattern 1 — Client Branching on Message

```javascript
if (message === "must not be null") { ... }
```

Message bukan contract.

### Anti-Pattern 2 — No Error Code

```json
{
  "message": "Validation failed"
}
```

Tidak actionable.

### Anti-Pattern 3 — One Big Error String

```json
{
  "message": "name required, email invalid, age must be positive"
}
```

Tidak machine-readable.

### Anti-Pattern 4 — Exposing Raw Rejected Values

```json
{
  "path": "password",
  "rejectedValue": "abc123"
}
```

Security issue.

### Anti-Pattern 5 — Using Groups as Severity

```java
@Email(groups = Warning.class)
```

Groups are activation contexts, not severity metadata.

### Anti-Pattern 6 — Payload as Dynamic Business State

```java
payload = HighRiskCase.class
```

Jika high-risk runtime state, jangan hardcode di annotation payload.

### Anti-Pattern 7 — Every Error Code Is Generic

```text
VALIDATION.ERROR
VALIDATION.INVALID
```

Tidak berguna untuk frontend/support/audit.

### Anti-Pattern 8 — Error Code Tied to Java Class Name

```text
CREATE_APPLICATION_REQUEST_APPLICANT_NAME_NOT_BLANK
```

Refactor DTO akan merusak contract.

### Anti-Pattern 9 — Constraint Name as Public Code

```text
NotBlank
Size
Email
```

Terlalu teknis dan kurang domain-specific.

### Anti-Pattern 10 — No Compatibility Policy

Mengubah code/path/status tanpa komunikasi bisa merusak client.

---

## 58. Review Checklist

Gunakan checklist ini saat review validation error design:

### Error Code

- Apakah setiap public validation error punya stable code?
- Apakah code tidak bergantung pada localized message?
- Apakah namespace code mencerminkan domain ownership?
- Apakah code cukup spesifik untuk frontend/support?
- Apakah ada deprecation/versioning policy?

### Message

- Apakah message cocok untuk manusia?
- Apakah message bisa dilokalisasi?
- Apakah message tidak membocorkan data sensitif?
- Apakah client tidak bergantung pada message?

### Path

- Apakah path sesuai JSON/API contract, bukan internal Java detail?
- Apakah list/map index ditangani?
- Apakah class-level violation punya path yang jelas?
- Apakah method validation path dinormalisasi?

### Severity

- Apakah severity jelas?
- Apakah warning benar-benar non-blocking jika dimaksudkan begitu?
- Apakah payload tidak dipakai sebagai workflow engine?

### Security

- Apakah rejected value disembunyikan default?
- Apakah sensitive field di-redact?
- Apakah logs aman?
- Apakah regex/attributes tidak membocorkan internal rule berbahaya?

### Observability

- Apakah code bisa jadi metric label low-cardinality?
- Apakah validation failure bisa dikorelasikan dengan traceId?
- Apakah top failing code bisa dianalisis?

### Audit

- Apakah regulatory-important rejection punya rule id/version?
- Apakah audit trail menyimpan code, bukan hanya message?
- Apakah audit tidak menyimpan PII berlebihan?

---

## 59. Design Decision Matrix

| Kebutuhan | Mekanisme yang Cocok |
|---|---|
| Human message | `message` + resource bundle |
| Operation-specific activation | `groups` |
| Severity statis | `payload` |
| Built-in constraint error code | message key atau external mapping |
| Custom constraint error code | custom annotation attribute `code` |
| Dynamic business rule result | domain `RuleViolation` |
| Warning non-blocking | separate group atau domain validation outcome |
| Audit rule identity | `ruleId`/catalog/domain rule |
| API field mapping | normalized path |
| Security classification | payload atau registry |
| Runtime tenant policy | external rule system/domain validator |

---

## 60. Practical Architecture Recommendation

Untuk sistem production besar, gunakan layered model berikut:

```text
Bean/Jakarta Validation
  -> catches local shape and simple invariant
  -> outputs ConstraintViolation
  -> mapped to ValidationIssue

Domain Policy Validation
  -> catches contextual business rules
  -> outputs DomainRuleViolation
  -> mapped to ValidationIssue

Workflow Guard
  -> catches state transition rules
  -> outputs WorkflowViolation
  -> mapped to ValidationIssue

Database Constraint Mapping
  -> catches final consistency conflicts
  -> outputs PersistenceViolation
  -> mapped to ValidationIssue

API Error Contract
  -> stable code
  -> localized message
  -> normalized path
  -> severity
  -> traceId
  -> safe attributes
```

Do not let any layer leak raw provider-specific error directly to public API.

---

## 61. Summary Mental Model

Bagian ini bisa diringkas menjadi beberapa prinsip:

1. **Message is for humans. Code is for machines.**
2. **Payload is metadata, not validation logic.**
3. **Groups decide when constraints run. Payload classifies what failure means.**
4. **Warning requires explicit pipeline; Bean Validation violation is blocking by default.**
5. **Never rely on localized message for client branching.**
6. **Do not expose rejected value by default.**
7. **Normalize paths to public API shape.**
8. **Use rule id/version for audit-heavy systems.**
9. **Unify validation issues across Bean Validation, domain policy, workflow guard, and database constraint.**
10. **Treat validation error design as an API contract.**

---

## 62. Latihan

### Latihan 1 — Error Code Mapping

Ambil DTO yang punya:

```java
@NotBlank
@Email
@Size
```

Buat mapper yang menghasilkan:

```json
{
  "code": "...",
  "path": "...",
  "message": "...",
  "constraint": "...",
  "severity": "..."
}
```

Pastikan message bisa berubah locale tetapi code tetap sama.

### Latihan 2 — Severity Payload

Buat payload marker:

```java
Info
Warning
Error
Fatal
```

Tempelkan ke constraint berbeda dan test mapping-nya.

### Latihan 3 — Sensitive Rejected Value

Buat field:

```java
password
email
nric
remarks
amount
```

Tentukan mana yang boleh/tidak boleh muncul sebagai rejected value.

### Latihan 4 — Warning Non-Blocking

Buat dua group:

```java
BlockingValidation
AdvisoryValidation
```

Jalankan blocking dulu, lalu advisory. Buat response yang accepted dengan warnings.

### Latihan 5 — Rule Catalog

Buat YAML/markdown catalog untuk 10 validation error code dalam domain application/case management.

---

## 63. Referensi

- Jakarta Validation 3.1 Specification — metadata model dan API untuk JavaBean/method validation.
- Jakarta Validation 3.1 API — `ConstraintViolation`, `ConstraintDescriptor`, `Payload`, dan built-in constraints.
- Bean Validation 2.0 Specification — constraint annotation contract, `payload`, container element constraints.
- Hibernate Validator Reference Guide — provider behavior, metadata, custom constraints, severity payload examples, dan extension points.
- Hibernate Validator 9.x documentation — Jakarta Validation 3.1.x support dan Jakarta EE 11 alignment.

---

## 64. Status Seri

Seri **belum selesai**.

Kita baru menyelesaikan:

```text
part-014: Payload, Severity, Error Codes, and Machine-Readable Violations
```

Bagian berikutnya:

```text
part-015: Programmatic Constraint Mapping and Runtime Metadata
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-013](./learn-java-validation-jakarta-hibernate-validator-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-015.md](./learn-java-validation-jakarta-hibernate-validator-part-015.md)

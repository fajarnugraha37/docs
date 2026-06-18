# learn-java-validation-jakarta-hibernate-validator-part-013

# Message Interpolation: i18n, EL, Security, and Error Message Governance

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: 013 / 030  
> Topik: Message interpolation, internationalization, Expression Language, keamanan pesan error, stable error code, dan governance error contract  
> Target pembaca: Java engineer senior/lead yang ingin memahami validation bukan hanya sebagai annotation, tetapi sebagai sistem kontrak yang aman, bisa dioperasikan, bisa diaudit, dan stabil untuk API/client.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa **message validation bukan sekadar string error**, tetapi bagian dari API contract, UX, security, observability, dan auditability.
2. Menjelaskan bagaimana Bean/Jakarta Validation melakukan **message interpolation**.
3. Memahami peran:
   - message template,
   - resource bundle,
   - locale,
   - annotation attribute interpolation,
   - Expression Language,
   - custom message interpolator.
4. Mendesain error response yang memisahkan:
   - machine-readable code,
   - human-readable message,
   - localized message,
   - developer/debug context,
   - rejected value handling.
5. Menghindari kesalahan produksi seperti:
   - parsing message string sebagai business logic,
   - membocorkan PII/secrets dalam validation error,
   - menggunakan EL secara tidak terkendali,
   - membuat pesan error yang tidak stabil untuk frontend,
   - mencampur localization dengan domain rule identity.
6. Membuat strategi governance error message untuk sistem besar.

---

## 1. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- built-in constraints,
- nullability,
- cascaded validation,
- container element constraints,
- validation groups,
- group sequence,
- custom constraint,
- class-level/cross-field constraint,
- executable validation,
- records/immutability/builders.

Semua itu menghasilkan satu output utama ketika validation gagal: **constraint violation**.

Namun output violation tidak boleh dipahami hanya sebagai:

```text
name must not be blank
```

Dalam sistem serius, validation failure adalah data struktural yang menjawab:

```text
Rule apa yang gagal?
Di field/path mana?
Untuk operasi apa?
Apakah blocking atau warning?
Pesan apa yang aman ditampilkan ke user?
Pesan apa yang stabil untuk frontend?
Pesan apa yang boleh masuk log?
Apakah rejected value boleh diekspos?
Apakah message perlu dilokalisasi?
Apakah rule ini punya kode audit?
```

Topik part ini adalah jembatan antara **validation engine** dan **human/API-facing error contract**.

---

## 2. Referensi Resmi yang Relevan

Beberapa sumber resmi/primer yang relevan:

1. Jakarta Validation 3.1 specification  
   <https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html>

2. Jakarta Validation 3.1 overview  
   <https://jakarta.ee/specifications/bean-validation/3.1/>

3. Bean Validation 2.0 specification  
   <https://beanvalidation.org/2.0/spec/>

4. Hibernate Validator Reference Guide, stable version  
   <https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/>

5. Hibernate Validator documentation index  
   <https://hibernate.org/validator/documentation/>

6. Jakarta Validation API JavaDoc 3.1  
   <https://jakarta.ee/specifications/bean-validation/3.1/apidocs/>

Catatan versi:

- Bean Validation 2.0 adalah era `javax.validation` dan Java 8-oriented.
- Jakarta Validation 3.x memakai namespace `jakarta.validation`.
- Jakarta Validation 3.1 menargetkan Jakarta EE 11, mengklarifikasi support Java Records, dan minimum Java-nya adalah Java 17.
- Hibernate Validator 9.x adalah generasi provider untuk Jakarta Validation 3.1/Jakarta EE 11.
- Java 8 sampai Java 25 dapat terlibat dalam landscape ini tergantung kombinasi framework/provider yang digunakan.

---

## 3. Mental Model: Message Bukan Rule

Kesalahan paling umum adalah menganggap message sebagai identitas rule.

Contoh buruk:

```java
if (violation.getMessage().equals("must not be blank")) {
    // handle required error
}
```

Ini rapuh karena message bisa berubah akibat:

- locale,
- resource bundle,
- provider version,
- custom message interpolation,
- perubahan wording UX,
- migration `javax` ke `jakarta`,
- upgrade Hibernate Validator,
- perubahan annotation,
- custom constraint,
- FE copywriting.

Mental model yang lebih benar:

```text
Constraint violation = structured failure event.
Message = salah satu rendering manusia dari failure event.
```

Artinya, violation minimal punya beberapa lapisan:

```text
1. identity layer
   - rule code
   - constraint type
   - domain rule id

2. location layer
   - property path
   - parameter path
   - container index/key

3. context layer
   - operation
   - group
   - module
   - entity/DTO type

4. severity layer
   - error/warning/info

5. human layer
   - localized message
   - display label

6. diagnostic layer
   - rejected value classification
   - safe debug info
   - correlation id
```

Bean/Jakarta Validation menyediakan sebagian data ini melalui `ConstraintViolation`, `Path`, `ConstraintDescriptor`, annotation attributes, `payload`, dan message interpolation. Namun desain error contract produksi tetap tanggung jawab aplikasi.

---

## 4. Apa Itu Message Interpolation?

Message interpolation adalah proses mengubah message template menjadi pesan akhir.

Contoh constraint:

```java
public record CreateUserRequest(
    @Size(min = 3, max = 50, message = "username must be between {min} and {max} characters")
    String username
) {}
```

Template:

```text
username must be between {min} and {max} characters
```

Pesan akhir:

```text
username must be between 3 and 50 characters
```

`{min}` dan `{max}` diambil dari attribute annotation `@Size(min = 3, max = 50)`.

Contoh built-in default:

```java
@NotBlank
private String name;
```

Message default biasanya tidak ditulis langsung di kode aplikasi, tetapi berasal dari provider/resource bundle.

Secara konseptual:

```text
constraint annotation
    -> message template
        -> resource bundle lookup
            -> annotation attribute interpolation
                -> optional EL evaluation
                    -> final localized message
```

---

## 5. Message Template: Literal vs Bundle Key

Dalam Bean/Jakarta Validation, `message` pada constraint bisa berupa literal string atau bundle key.

### 5.1 Literal Message

```java
@NotBlank(message = "Name is required")
private String name;
```

Kelebihan:

- mudah dibaca,
- cepat dibuat,
- cocok untuk prototype/test kecil.

Kekurangan:

- sulit i18n,
- wording tersebar,
- sulit governance,
- sulit audit,
- sulit memastikan konsistensi lintas API,
- perubahan wording perlu ubah kode dan redeploy.

### 5.2 Bundle Key

```java
@NotBlank(message = "{user.name.required}")
private String name;
```

Lalu di `ValidationMessages.properties`:

```properties
user.name.required=Name is required
```

Dan di `ValidationMessages_id.properties`:

```properties
user.name.required=Nama wajib diisi
```

Kelebihan:

- mendukung localization,
- wording terpusat,
- lebih mudah diaudit,
- mudah diselaraskan dengan UX writer/frontend,
- bisa dibuat sebagai bagian dari message catalog.

Kekurangan:

- key harus dikelola,
- refactor lebih hati-hati,
- missing key bisa menghasilkan pesan aneh,
- butuh convention.

Untuk sistem besar, **bundle key hampir selalu lebih baik** daripada literal message.

---

## 6. `ValidationMessages.properties`

Secara default, Bean/Jakarta Validation mencari message di resource bundle bernama:

```text
ValidationMessages.properties
```

Contoh struktur:

```text
src/main/resources/
  ValidationMessages.properties
  ValidationMessages_id.properties
  ValidationMessages_en.properties
```

Contoh isi:

```properties
case.reference.required=Case reference is required
case.reference.invalidFormat=Case reference format is invalid
case.period.invalid=Start date must be before or equal to end date
applicant.email.invalid=Applicant email address is invalid
```

Bahasa Indonesia:

```properties
case.reference.required=Nomor referensi kasus wajib diisi
case.reference.invalidFormat=Format nomor referensi kasus tidak valid
case.period.invalid=Tanggal mulai harus sebelum atau sama dengan tanggal akhir
applicant.email.invalid=Alamat email pemohon tidak valid
```

Constraint:

```java
public record CaseSearchRequest(
    @NotBlank(message = "{case.reference.required}")
    @Pattern(
        regexp = "^[A-Z]{3}-\\d{6}$",
        message = "{case.reference.invalidFormat}"
    )
    String caseReference
) {}
```

---

## 7. Interpolation Annotation Attribute

Annotation attributes dapat disisipkan dalam message menggunakan `{attributeName}`.

Contoh:

```java
@Size(min = 8, max = 64, message = "Password length must be between {min} and {max}")
private String password;
```

Hasil:

```text
Password length must be between 8 and 64
```

Custom constraint:

```java
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = CaseReferenceValidator.class)
public @interface CaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String prefix() default "CASE";
    int digits() default 8;
}
```

Bundle:

```properties
case.reference.invalid=Case reference must start with {prefix} and contain {digits} digits
```

Pemakaian:

```java
@CaseReference(prefix = "ACE", digits = 10)
String caseReference;
```

Hasil:

```text
Case reference must start with ACE and contain 10 digits
```

Catatan penting:

- `{min}`, `{max}`, `{regexp}`, `{prefix}` adalah attribute dari annotation.
- Jangan memasukkan nilai sensitif sebagai annotation attribute jika akan muncul dalam message.
- Untuk `regexp`, hati-hati: menampilkan regex internal ke user biasanya buruk untuk UX dan bisa membocorkan detail validasi.

---

## 8. Expression Language dalam Message

Bean Validation 1.1 memperkenalkan message interpolation berbasis Unified Expression Language untuk membuat pesan lebih fleksibel.

Contoh konseptual:

```java
@DecimalMin(value = "1.00", message = "Amount must be at least ${formatter.format('%1$.2f', validatedValue)}")
BigDecimal amount;
```

Dalam praktik, gunakan EL dengan sangat hati-hati.

EL dapat memberi fleksibilitas seperti:

- formatting angka,
- conditional message,
- access ke `validatedValue`,
- access ke variables yang disediakan provider/context tertentu.

Namun EL juga membawa risiko:

- message menjadi sulit dibaca,
- message menjadi logic tersembunyi,
- potensi security issue jika template tidak terkendali,
- perbedaan behavior antar provider/version,
- dependency ke implementation detail,
- cost tambahan.

Untuk sistem besar, gunakan prinsip:

```text
Gunakan EL untuk formatting sederhana yang aman.
Jangan gunakan EL sebagai rule engine.
Jangan simpan business branching kompleks dalam message.
Jangan izinkan message template dinamis dari user/admin tanpa kontrol ketat.
```

---

## 9. Curly Braces vs Dollar Expression

Secara umum ada dua gaya interpolasi yang sering terlihat:

```text
{min}
${validatedValue}
```

Secara mental:

```text
{...}  -> bundle key / annotation attribute interpolation
${...} -> Expression Language expression
```

Contoh:

```java
@Size(
    min = 3,
    max = 20,
    message = "Length must be between {min} and {max}. Current value: ${validatedValue}"
)
private String username;
```

Namun menampilkan `validatedValue` dalam API response sering berbahaya.

Contoh risiko:

```text
Password must be at least 12 chars. Current value: hunter2
```

Atau:

```text
Invalid token: eyJhbGciOiJIUzI1NiIs...
```

Atau:

```text
Invalid NRIC: S1234567A
```

Untuk production, default policy yang aman:

```text
Jangan tampilkan rejected value dalam human-facing validation message.
Jangan log rejected value mentah kecuali sudah diklasifikasi aman.
```

---

## 10. `validatedValue`: Berguna tetapi Berbahaya

`validatedValue` dapat berguna untuk:

- internal diagnostic,
- local CLI tools,
- test output,
- non-sensitive numeric formatting,
- admin-only troubleshooting dengan masking.

Namun dalam API umum, `validatedValue` bisa membocorkan:

- password,
- token,
- session id,
- email,
- phone number,
- government id,
- financial data,
- address,
- health data,
- free-text notes,
- uploaded filename/path,
- SQL-like input,
- malicious payload.

Contoh buruk:

```properties
email.invalid=Email '${validatedValue}' is invalid
```

Lebih aman:

```properties
email.invalid=Email address format is invalid
```

Jika perlu membantu user:

```json
{
  "code": "USER_EMAIL_INVALID_FORMAT",
  "field": "email",
  "message": "Email address format is invalid"
}
```

Bukan:

```json
{
  "message": "Email 'john.sensitive@example.com' is invalid"
}
```

---

## 11. Message Interpolation dan Locale

Dalam aplikasi multi-bahasa, pesan validation perlu mengikuti locale.

Sumber locale bisa berasal dari:

- `Accept-Language` header,
- user profile preference,
- tenant configuration,
- admin console setting,
- default application locale.

Contoh request:

```http
POST /applications
Accept-Language: id-ID
Content-Type: application/json
```

Response:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Permintaan tidak valid",
  "status": 400,
  "errors": [
    {
      "code": "APPLICANT_NAME_REQUIRED",
      "field": "applicant.name",
      "message": "Nama pemohon wajib diisi"
    }
  ]
}
```

Request lain:

```http
Accept-Language: en-SG
```

Response:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Invalid request",
  "status": 400,
  "errors": [
    {
      "code": "APPLICANT_NAME_REQUIRED",
      "field": "applicant.name",
      "message": "Applicant name is required"
    }
  ]
}
```

Yang harus stabil:

```text
code = APPLICANT_NAME_REQUIRED
field = applicant.name
```

Yang boleh berubah tergantung locale:

```text
message
```

---

## 12. Jangan Jadikan Human Message sebagai API Contract Utama

Frontend sering tergoda melakukan ini:

```ts
if (error.message === 'must not be blank') {
  showRequiredMarker(field);
}
```

Ini buruk.

Yang benar:

```ts
if (error.code === 'APPLICANT_NAME_REQUIRED') {
  showRequiredMarker(field);
}
```

Atau:

```ts
switch (error.constraint) {
  case 'NotBlank':
    showRequiredMarker(error.field);
    break;
}
```

Namun lebih stabil lagi memakai application-level error code, bukan nama constraint generic.

Kenapa?

Karena `@NotBlank` bisa berarti banyak hal:

```text
APPLICANT_NAME_REQUIRED
CASE_REFERENCE_REQUIRED
APPROVAL_REASON_REQUIRED
REJECTION_COMMENT_REQUIRED
```

Mereka sama-sama `NotBlank`, tetapi meaning, UX, dan remediation-nya bisa berbeda.

---

## 13. Error Code Design

Sistem besar membutuhkan error code yang stabil.

Contoh struktur:

```text
<DOMAIN>_<FIELD/RULE>_<FAILURE>
```

Contoh:

```text
APPLICANT_NAME_REQUIRED
APPLICANT_EMAIL_INVALID_FORMAT
CASE_REFERENCE_INVALID_FORMAT
APPLICATION_PERIOD_INVALID_RANGE
DOCUMENT_FILE_SIZE_EXCEEDED
CORRESPONDENCE_RECIPIENT_REQUIRED
```

Atau memakai namespace dotted:

```text
applicant.name.required
applicant.email.invalid_format
case.reference.invalid_format
application.period.invalid_range
```

Keduanya valid. Pilih satu convention.

### 13.1 Error Code Jangan Terlalu Generic

Terlalu generic:

```text
NOT_BLANK
INVALID_FORMAT
SIZE_EXCEEDED
```

Masalah:

- sulit untuk analytics,
- sulit untuk FE custom UX,
- sulit untuk support/audit,
- banyak field share code yang sama.

Lebih baik:

```text
APPLICANT_NAME_REQUIRED
DOCUMENT_TITLE_REQUIRED
CASE_STATUS_INVALID
```

### 13.2 Error Code Jangan Terlalu Volatile

Terlalu volatile:

```text
CREATE_APPLICATION_DTO_APPLICANT_NAME_NOT_BLANK_V2
```

Masalah:

- berubah saat class rename,
- berubah saat DTO refactor,
- berubah saat endpoint versioning,
- bocor implementasi internal.

Lebih baik:

```text
APPLICANT_NAME_REQUIRED
```

---

## 14. Cara Mendapatkan Error Code dari Constraint

Ada beberapa strategi.

### 14.1 Message Key sebagai Error Code

Constraint:

```java
@NotBlank(message = "{applicant.name.required}")
String name;
```

Resource bundle:

```properties
applicant.name.required=Applicant name is required
```

Error code bisa diambil dari message template:

```java
String template = violation.getMessageTemplate();
// "{applicant.name.required}"
```

Lalu normalize:

```java
static String codeFromTemplate(String template) {
    if (template == null) return "VALIDATION_ERROR";
    if (template.startsWith("{") && template.endsWith("}")) {
        return template.substring(1, template.length() - 1);
    }
    return "VALIDATION_ERROR";
}
```

Kelebihan:

- sederhana,
- message key dan error code konsisten,
- mudah untuk API.

Kekurangan:

- semua constraint harus disiplin pakai bundle key,
- built-in default message seperti `{jakarta.validation.constraints.NotBlank.message}` terlalu generic,
- key UX message dan error identity menjadi satu.

### 14.2 Custom Annotation Attribute `code`

Custom constraint:

```java
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = CaseReferenceValidator.class)
public @interface ValidCaseReference {
    String message() default "{case.reference.invalid}";
    String code() default "CASE_REFERENCE_INVALID";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Mapper:

```java
ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();
Object code = descriptor.getAttributes().get("code");
```

Kelebihan:

- code explicit,
- message key bisa berbeda dari code,
- cocok untuk custom domain constraints.

Kekurangan:

- built-in constraints tidak punya `code`,
- perlu convention,
- perlu fallback.

### 14.3 Payload-Based Severity/Code Marker

Bean Validation menyediakan `payload` pada constraint annotation.

Contoh:

```java
public interface Severity {
    interface Error extends Payload {}
    interface Warning extends Payload {}
}
```

Pemakaian:

```java
@NotBlank(
    message = "{applicant.name.required}",
    payload = Severity.Error.class
)
String name;
```

Payload bisa diambil:

```java
Set<Class<? extends Payload>> payload =
    violation.getConstraintDescriptor().getPayload();
```

Namun payload lebih cocok untuk metadata seperti severity/category, bukan selalu error code detail.

### 14.4 Registry/Rule Catalog

Untuk sistem besar:

```yaml
validationRules:
  applicant.name.required:
    code: APPLICANT_NAME_REQUIRED
    severity: ERROR
    owner: ApplicationManagement
    defaultHttpStatus: 400
    piiSafe: true
    messageKey: applicant.name.required
    remediation: Provide applicant legal name.
```

Kelebihan:

- governance kuat,
- audit-friendly,
- rule ownership jelas,
- bisa dipakai FE/documentation/analytics.

Kekurangan:

- butuh disiplin dan tooling,
- overhead untuk sistem kecil.

---

## 15. Recommended Error Response Model

Untuk API modern, hindari response seperti ini:

```json
{
  "error": "name must not be blank"
}
```

Lebih baik:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Invalid request",
  "status": 400,
  "traceId": "01HT...",
  "errors": [
    {
      "code": "APPLICANT_NAME_REQUIRED",
      "path": "applicant.name",
      "message": "Applicant name is required",
      "constraint": "NotBlank",
      "severity": "ERROR"
    },
    {
      "code": "DOCUMENTS_TOO_MANY",
      "path": "documents",
      "message": "Maximum 10 documents are allowed",
      "constraint": "Size",
      "severity": "ERROR",
      "attributes": {
        "max": 10
      }
    }
  ]
}
```

Untuk production, pertimbangkan field berikut:

```json
{
  "code": "...",
  "path": "...",
  "message": "...",
  "constraint": "...",
  "severity": "...",
  "attributes": {},
  "rejectedValuePresent": true,
  "rejectedValueMasked": "...",
  "source": "REQUEST_BODY"
}
```

Namun hati-hati: tidak semua response perlu expose semua field.

Recommended public API minimal:

```json
{
  "code": "APPLICANT_EMAIL_INVALID_FORMAT",
  "path": "applicant.email",
  "message": "Applicant email address is invalid"
}
```

Recommended internal log event:

```json
{
  "event": "VALIDATION_FAILED",
  "traceId": "01HT...",
  "endpoint": "POST /applications",
  "operation": "CREATE_APPLICATION",
  "principalId": "user-123",
  "violations": [
    {
      "code": "APPLICANT_EMAIL_INVALID_FORMAT",
      "path": "applicant.email",
      "constraint": "Email",
      "rejectedValueClass": "String",
      "rejectedValueLength": 245,
      "rejectedValueMasked": null
    }
  ]
}
```

---

## 16. Mapping `ConstraintViolation` ke API Error

Contoh mapper sederhana:

```java
public final class ValidationErrorMapper {

    public List<ApiValidationError> map(Set<? extends ConstraintViolation<?>> violations) {
        return violations.stream()
            .map(this::mapOne)
            .sorted(Comparator
                .comparing(ApiValidationError::path)
                .thenComparing(ApiValidationError::code))
            .toList();
    }

    private ApiValidationError mapOne(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();

        String code = resolveCode(violation, descriptor);
        String path = normalizePath(violation.getPropertyPath());
        String constraint = descriptor.getAnnotation().annotationType().getSimpleName();

        return new ApiValidationError(
            code,
            path,
            violation.getMessage(),
            constraint,
            resolveSeverity(descriptor)
        );
    }

    private String resolveCode(
            ConstraintViolation<?> violation,
            ConstraintDescriptor<?> descriptor
    ) {
        Object explicitCode = descriptor.getAttributes().get("code");
        if (explicitCode instanceof String s && !s.isBlank()) {
            return s;
        }

        String template = violation.getMessageTemplate();
        if (template != null && template.startsWith("{") && template.endsWith("}")) {
            String key = template.substring(1, template.length() - 1);

            if (!key.startsWith("jakarta.validation.constraints.")) {
                return key.toUpperCase(Locale.ROOT).replace('.', '_');
            }
        }

        return descriptor.getAnnotation().annotationType().getSimpleName().toUpperCase(Locale.ROOT);
    }

    private String normalizePath(Path path) {
        return path == null ? "" : path.toString();
    }

    private String resolveSeverity(ConstraintDescriptor<?> descriptor) {
        Set<Class<? extends Payload>> payload = descriptor.getPayload();
        if (payload.stream().anyMatch(p -> p.getSimpleName().equals("Warning"))) {
            return "WARNING";
        }
        return "ERROR";
    }
}
```

DTO:

```java
public record ApiValidationError(
    String code,
    String path,
    String message,
    String constraint,
    String severity
) {}
```

Catatan:

- Ini contoh minimal.
- Untuk production, jangan selalu expose `constraint` jika dianggap internal.
- Jangan expose annotation attributes mentah tanpa filtering.
- Jangan expose `invalidValue` mentah.

---

## 17. Message untuk Field-Level Constraint

Contoh DTO:

```java
public record ApplicantRequest(
    @NotBlank(message = "{applicant.name.required}")
    @Size(max = 120, message = "{applicant.name.tooLong}")
    String name,

    @Email(message = "{applicant.email.invalid}")
    String email
) {}
```

Bundle:

```properties
applicant.name.required=Applicant name is required
applicant.name.tooLong=Applicant name must not exceed {max} characters
applicant.email.invalid=Applicant email address is invalid
```

Potential response:

```json
{
  "errors": [
    {
      "code": "APPLICANT_NAME_REQUIRED",
      "path": "name",
      "message": "Applicant name is required"
    },
    {
      "code": "APPLICANT_EMAIL_INVALID",
      "path": "email",
      "message": "Applicant email address is invalid"
    }
  ]
}
```

---

## 18. Message untuk Class-Level Constraint

Class-level constraint sering lebih sulit karena violation bisa ditempel ke object atau field tertentu.

Contoh:

```java
@ValidApplicationPeriod
public record ApplicationPeriodRequest(
    LocalDate startDate,
    LocalDate endDate
) {}
```

Annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ApplicationPeriodValidator.class)
public @interface ValidApplicationPeriod {
    String message() default "{application.period.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class ApplicationPeriodValidator
        implements ConstraintValidator<ValidApplicationPeriod, ApplicationPeriodRequest> {

    @Override
    public boolean isValid(ApplicationPeriodRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        LocalDate start = value.startDate();
        LocalDate end = value.endDate();

        if (start == null || end == null) {
            return true;
        }

        if (!start.isAfter(end)) {
            return true;
        }

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate("{application.period.invalid}")
            .addPropertyNode("endDate")
            .addConstraintViolation();

        return false;
    }
}
```

Bundle:

```properties
application.period.invalid=End date must be on or after start date
```

Response:

```json
{
  "errors": [
    {
      "code": "APPLICATION_PERIOD_INVALID",
      "path": "endDate",
      "message": "End date must be on or after start date"
    }
  ]
}
```

Kenapa ditempel ke `endDate`?

Karena user biasanya perlu tahu field mana yang harus diperbaiki. Namun untuk rule yang benar-benar object-level, path kosong/object path juga sah.

---

## 19. Multiple Violations dari Satu Validator

Kadang satu class-level validator ingin menghasilkan beberapa error.

Contoh:

```java
context.disableDefaultConstraintViolation();

context.buildConstraintViolationWithTemplate("{company.uen.required}")
    .addPropertyNode("uen")
    .addConstraintViolation();

context.buildConstraintViolationWithTemplate("{company.registeredName.required}")
    .addPropertyNode("registeredName")
    .addConstraintViolation();

return false;
```

Ini berguna untuk:

- conditional requiredness,
- multi-field completeness,
- wizard forms,
- import validation,
- frontend field highlighting.

Namun jangan berlebihan sampai satu validator menjadi rule engine besar.

---

## 20. Message dan Validation Groups

Validation group bisa membuat constraint yang sama punya pesan berbeda tergantung operasi.

Contoh:

```java
public interface Draft {}
public interface Submit {}

public record ApplicationRequest(
    @NotBlank(
        groups = Submit.class,
        message = "{application.title.requiredForSubmit}"
    )
    String title
) {}
```

Bundle:

```properties
application.title.requiredForSubmit=Application title is required before submission
```

Ini masuk akal jika pesan memang menjelaskan operasi.

Namun hati-hati:

```java
@NotBlank(groups = Approve.class, message = "{approval.allowed.only.manager}")
```

Itu bukan validation input shape. Itu authorization/workflow policy. Jangan disembunyikan di Bean Validation message.

---

## 21. Message dan Group Sequence

Group sequence sering dipakai agar pesan lebih masuk akal.

Misal:

```text
Phase 1: basic shape
- required
- format
- size

Phase 2: semantic consistency
- date range
- dependent fields

Phase 3: expensive/domain check
- reference existence
- eligibility
```

Jika Phase 1 gagal, Phase 2/3 tidak perlu dijalankan.

Efek pada message:

- user tidak dibanjiri error turunan,
- expensive validation tidak terjadi ketika input basic invalid,
- pesan lebih fokus.

Namun jangan gunakan group sequence untuk membuat hidden workflow seperti:

```text
Draft -> Submit -> Approve -> Reject -> Appeal -> Close
```

Itu domain workflow, bukan message interpolation concern.

---

## 22. Message dan `@ReportAsSingleViolation`

Constraint composition dapat menggabungkan beberapa constraint menjadi satu pesan.

Contoh:

```java
@NotBlank
@Size(min = 8, max = 64)
@Pattern(regexp = "...")
@ReportAsSingleViolation
@Constraint(validatedBy = {})
@Target({ FIELD, PARAMETER, RECORD_COMPONENT })
@Retention(RUNTIME)
public @interface StrongPassword {
    String message() default "{password.weak}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Kelebihan:

- user melihat satu pesan sederhana:

```text
Password does not meet security requirements
```

Kekurangan:

- user tidak tahu detail mana yang gagal,
- FE sulit memberi checklist,
- audit kurang detail.

Untuk password, sering justru lebih baik memberikan checklist UX, tetapi jangan membocorkan terlalu banyak logic keamanan secara berlebihan.

---

## 23. Message Severity: Error vs Warning

Tidak semua validation failure harus blocking.

Contoh:

```text
ERROR:
- mandatory field missing
- invalid case reference
- end date before start date

WARNING:
- selected date is near SLA deadline
- address is valid but outside preferred service area
- document title is unusually long but acceptable

INFO:
- optional field ignored for this application type
```

Bean Validation secara native menghasilkan constraint violation sebagai failure. Namun `payload` bisa dipakai untuk metadata severity.

```java
public final class ValidationSeverity {
    private ValidationSeverity() {}

    public interface Error extends Payload {}
    public interface Warning extends Payload {}
    public interface Info extends Payload {}
}
```

Pemakaian:

```java
@Size(
    max = 120,
    message = "{document.title.long}",
    payload = ValidationSeverity.Warning.class
)
String title;
```

Namun perlu dicatat:

```text
Bean Validation tetap menganggap violation sebagai violation.
Jika warning tidak boleh blocking, kamu butuh pipeline terpisah atau interpretation layer.
```

Untuk production, lebih bersih:

```text
Hard validation -> Bean/Jakarta Validation
Soft validation -> domain advisory rule engine / policy evaluator
```

Atau minimal, mapper bisa memisahkan warning dan error.

---

## 24. Security: Validation Message Bukan Tempat Data Sensitif

Pesan error sering masuk ke:

- browser,
- mobile app,
- logs,
- monitoring,
- analytics,
- audit trail,
- support tools,
- screenshots,
- email/notification,
- third-party APM.

Karena itu message tidak boleh sembarangan memuat data mentah.

### 24.1 Jangan Tampilkan Secret

Buruk:

```properties
auth.token.invalid=Token {validatedValue} is invalid
```

Baik:

```properties
auth.token.invalid=Authentication token is invalid
```

### 24.2 Jangan Tampilkan PII

Buruk:

```properties
nric.invalid=NRIC ${validatedValue} is invalid
```

Baik:

```properties
nric.invalid=Identification number format is invalid
```

### 24.3 Jangan Tampilkan Internal Regex

Buruk:

```properties
case.reference.invalid=Case reference must match {regexp}
```

Baik:

```properties
case.reference.invalid=Case reference format is invalid
```

### 24.4 Jangan Tampilkan Internal State Machine Detail

Buruk:

```properties
case.transition.invalid=Cannot transition from INTERNAL_QA_REJECTED_WAITING_LEGAL_REVIEW to CLOSED_BY_SUPERVISOR
```

Lebih aman:

```properties
case.transition.invalid=This case cannot be closed from its current state
```

Untuk admin/internal audit, detail state bisa dicatat dalam log/audit dengan akses terbatas.

---

## 25. EL Security dan Dynamic Templates

Bahaya terbesar bukan EL yang dipakai secara statis di source code yang kamu kontrol. Bahaya terbesar adalah jika message template bisa berasal dari input eksternal atau konfigurasi admin tanpa kontrol.

Contoh situasi berbahaya:

```text
Admin UI memungkinkan user mengisi validation message template:
"${someExpression}"
```

Lalu template itu dievaluasi sebagai Expression Language.

Risiko:

- data exposure,
- method/property access tidak diinginkan,
- provider-specific behavior,
- denial-of-service melalui expression kompleks,
- unexpected interpolation.

Prinsip aman:

```text
1. Treat message templates as code-like configuration.
2. Do not accept arbitrary EL templates from untrusted users.
3. Prefer static bundle keys.
4. Keep EL feature level restrictive where provider/framework supports it.
5. Escape user-provided text before placing into message variables.
6. Avoid putting raw user input into message templates.
```

Hibernate Validator memiliki konfigurasi terkait Expression Language feature level pada versi modern. Untuk aplikasi yang sangat sensitif, pertimbangkan pembatasan fitur EL sesuai dokumentasi provider/framework yang digunakan.

---

## 26. Custom Message Interpolator

Bean/Jakarta Validation memungkinkan custom `MessageInterpolator`.

Interface konseptual:

```java
public interface MessageInterpolator {
    String interpolate(String messageTemplate, Context context);
    String interpolate(String messageTemplate, Context context, Locale locale);
}
```

Custom interpolator berguna untuk:

- integrasi message catalog internal,
- tenant-specific message,
- runtime locale policy,
- fallback chain custom,
- masking/sanitization,
- structured code mapping,
- observability.

Contoh wrapper interpolator:

```java
public final class SafeMessageInterpolator implements MessageInterpolator {

    private final MessageInterpolator delegate;

    public SafeMessageInterpolator(MessageInterpolator delegate) {
        this.delegate = Objects.requireNonNull(delegate);
    }

    @Override
    public String interpolate(String messageTemplate, Context context) {
        String interpolated = delegate.interpolate(messageTemplate, context);
        return sanitize(interpolated);
    }

    @Override
    public String interpolate(String messageTemplate, Context context, Locale locale) {
        String interpolated = delegate.interpolate(messageTemplate, context, locale);
        return sanitize(interpolated);
    }

    private String sanitize(String message) {
        if (message == null) {
            return null;
        }
        return message.length() > 500 ? message.substring(0, 500) : message;
    }
}
```

Bootstrap:

```java
ValidatorFactory factory = Validation.byDefaultProvider()
    .configure()
    .messageInterpolator(
        new SafeMessageInterpolator(
            Validation.byDefaultProvider()
                .configure()
                .getDefaultMessageInterpolator()
        )
    )
    .buildValidatorFactory();
```

Catatan:

- Jangan membuat interpolator mahal per request.
- Perhatikan thread-safety.
- Jangan memasukkan database lookup berat ke interpolation hot path.
- Jangan menjadikan interpolator sebagai business rule resolver.

---

## 27. Locale-Aware Validation secara Manual

Jika kamu memakai `Validator` manual, kamu bisa mengontrol locale lewat custom interpolator atau context/framework.

Contoh sederhana dengan `LocaleContextHolder` di Spring biasanya ditangani oleh framework. Namun dalam Java SE/manual setup, kamu bisa membungkus message interpolator agar membaca locale dari context aplikasi.

Contoh konseptual:

```java
public final class RequestLocaleMessageInterpolator implements MessageInterpolator {

    private final MessageInterpolator delegate;
    private final Supplier<Locale> localeSupplier;

    public RequestLocaleMessageInterpolator(
        MessageInterpolator delegate,
        Supplier<Locale> localeSupplier
    ) {
        this.delegate = Objects.requireNonNull(delegate);
        this.localeSupplier = Objects.requireNonNull(localeSupplier);
    }

    @Override
    public String interpolate(String messageTemplate, Context context) {
        return delegate.interpolate(messageTemplate, context, localeSupplier.get());
    }

    @Override
    public String interpolate(String messageTemplate, Context context, Locale locale) {
        return delegate.interpolate(messageTemplate, context, locale);
    }
}
```

Namun di aplikasi server modern, hindari `ThreadLocal` yang tidak jelas jika memakai async/reactive/virtual-thread context propagation. Lebih baik locale resolution jelas di boundary framework.

---

## 28. Spring Boot Integration Notes

Di Spring Boot, validation biasanya terhubung dengan `MessageSource` aplikasi.

Pola umum:

```text
messages.properties
messages_id.properties
ValidationMessages.properties
```

Spring dapat mengintegrasikan validation messages dengan `MessageSource` tergantung konfigurasi.

Hal yang perlu diperhatikan:

- `@Valid` adalah Jakarta/Bean Validation trigger.
- `@Validated` adalah Spring annotation yang juga mendukung validation groups.
- Error dari request body biasanya muncul sebagai `MethodArgumentNotValidException`.
- Error dari method validation dapat muncul sebagai exception lain tergantung versi Spring.
- Pesan final sudah localized jika locale resolver/message source dikonfigurasi benar.

Spring-style global handler biasanya memetakan validation exception ke API error contract:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handle(MethodArgumentNotValidException ex) {
        // map field errors and object errors
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ProblemDetail> handle(ConstraintViolationException ex) {
        // map method/query/path parameter violations
    }
}
```

Prinsip penting:

```text
Jangan biarkan default framework error shape bocor langsung ke public API jika kamu butuh contract stabil.
```

---

## 29. JAX-RS / Jakarta REST Integration Notes

Dalam Jakarta REST/JAX-RS, validation dapat diterapkan pada:

- entity body,
- path parameter,
- query parameter,
- header parameter,
- resource method return value.

Contoh:

```java
@POST
@Path("/applications")
public Response create(@Valid CreateApplicationRequest request) {
    ...
}
```

Atau:

```java
@GET
@Path("/{caseReference}")
public Response getCase(
    @PathParam("caseReference")
    @NotBlank(message = "{case.reference.required}")
    @Pattern(regexp = "^[A-Z]{3}-\\d{6}$", message = "{case.reference.invalidFormat}")
    String caseReference
) {
    ...
}
```

Di sistem produksi, tetap buat exception mapper:

```java
@Provider
public class ConstraintViolationExceptionMapper
        implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        // map to stable validation problem response
    }
}
```

Prinsip sama:

```text
Provider/framework boleh menghasilkan violation.
Aplikasi tetap bertanggung jawab terhadap response contract.
```

---

## 30. Message dalam Batch/Import Validation

Batch/import berbeda dari API single request.

Single request:

```json
{
  "field": "email",
  "message": "Email address is invalid"
}
```

Batch import butuh lokasi tambahan:

```json
{
  "row": 128,
  "column": "Email",
  "code": "APPLICANT_EMAIL_INVALID_FORMAT",
  "path": "applicant.email",
  "message": "Email address format is invalid"
}
```

Untuk file import, error message harus:

- cukup jelas untuk user memperbaiki file,
- tidak membocorkan data sensitif di export error report,
- memiliki code stabil,
- memiliki row/column reference,
- bisa dilokalisasi jika file report user-facing.

Contoh CSV error report:

```csv
row,column,code,message
128,Email,APPLICANT_EMAIL_INVALID_FORMAT,Email address format is invalid
129,Applicant Name,APPLICANT_NAME_REQUIRED,Applicant name is required
```

Jangan menulis:

```csv
128,Email,INVALID,"john.secret@example.com is invalid"
```

---

## 31. Message dalam Workflow/Case Management

Untuk sistem case management/regulatory, validation message sering punya implikasi hukum/operasional.

Contoh buruk:

```text
Cannot approve case
```

Terlalu tidak jelas.

Contoh lebih baik:

```text
Case cannot be approved because mandatory assessment outcome is missing
```

Namun API response publik mungkin:

```json
{
  "code": "ASSESSMENT_OUTCOME_REQUIRED_FOR_APPROVAL",
  "message": "Assessment outcome is required before approval"
}
```

Audit trail internal bisa menyimpan:

```json
{
  "ruleId": "CASE_APPROVAL_PRECHECK_003",
  "ruleVersion": "2026-03-01",
  "code": "ASSESSMENT_OUTCOME_REQUIRED_FOR_APPROVAL",
  "state": "PENDING_APPROVAL",
  "actorRole": "SENIOR_OFFICER",
  "blocking": true
}
```

Pesan user-facing tidak harus memuat semua detail audit. Pisahkan:

```text
User message != audit evidence != debug detail
```

---

## 32. Message Governance untuk Sistem Besar

Untuk sistem besar, buat message catalog.

Contoh YAML:

```yaml
APPLICANT_NAME_REQUIRED:
  messageKey: applicant.name.required
  defaultMessage: Applicant name is required
  severity: ERROR
  owner: ApplicationManagement
  public: true
  piiSafe: true
  remediation: Provide applicant legal name.

CASE_REFERENCE_INVALID_FORMAT:
  messageKey: case.reference.invalidFormat
  defaultMessage: Case reference format is invalid
  severity: ERROR
  owner: CaseManagement
  public: true
  piiSafe: true
  remediation: Use the official case reference format.

CASE_APPROVAL_PRECHECK_MISSING_ASSESSMENT:
  messageKey: case.approval.assessment.required
  defaultMessage: Assessment outcome is required before approval
  severity: ERROR
  owner: CaseWorkflow
  public: false
  piiSafe: true
  remediation: Complete assessment outcome before approval.
```

Field penting:

```text
code
messageKey
defaultMessage
severity
owner
module
public/private
piiSafe
remediation
ruleVersion
introducedIn
deprecatedIn
replacementCode
```

Manfaat:

- FE tidak menebak-nebak,
- support punya referensi,
- BA/QA bisa menulis test case,
- auditor dapat melihat rule identity,
- analytics bisa menghitung top validation failure,
- migration lebih aman.

---

## 33. Naming Convention untuk Message Key

Beberapa opsi:

### 33.1 Domain Field Failure

```text
applicant.name.required
applicant.email.invalidFormat
case.reference.invalidFormat
document.file.maxSizeExceeded
```

Kelebihan:

- mudah dibaca,
- cocok untuk app-level validation.

### 33.2 Module Domain Rule

```text
application.applicant.name.required
case.search.reference.invalidFormat
compliance.action.reason.required
```

Kelebihan:

- lebih jelas ownership module,
- cocok untuk monolith modular/large domain.

### 33.3 Constraint-Oriented

```text
validation.notBlank
validation.email
validation.size.max
```

Kelebihan:

- reusable.

Kekurangan:

- terlalu generic untuk API contract.

Rekomendasi:

```text
Gunakan domain-oriented key untuk public API.
Gunakan generic key hanya untuk low-level/shared fallback.
```

---

## 34. Fallback Strategy

Apa yang terjadi jika key tidak ditemukan?

Contoh salah:

```json
{
  "message": "{applicant.name.required}"
}
```

Ini membocorkan implementation detail dan buruk untuk UX.

Fallback yang lebih baik:

```json
{
  "code": "APPLICANT_NAME_REQUIRED",
  "message": "Invalid request field"
}
```

Atau internal:

```text
message key missing: applicant.name.required
```

Fallback policy:

```text
1. API response user-facing pakai safe generic message.
2. Log internal mencatat missing message key.
3. CI/test harus gagal jika ada message key yang missing.
4. Message catalog harus divalidasi saat build.
```

---

## 35. Testing Message Interpolation

Testing validation tidak cukup hanya memeriksa jumlah violation.

Minimal test:

```java
@Test
void shouldReturnLocalizedMessageForIndonesianLocale() {
    Validator validator = validatorForLocale(Locale.forLanguageTag("id-ID"));

    var request = new ApplicantRequest("", "bad-email");

    Set<ConstraintViolation<ApplicantRequest>> violations = validator.validate(request);

    assertThat(violations)
        .extracting(ConstraintViolation::getMessage)
        .contains("Nama pemohon wajib diisi");
}
```

Test yang lebih stabil:

```java
@Test
void shouldExposeStableMessageTemplate() {
    var request = new ApplicantRequest("", "bad-email");

    Set<ConstraintViolation<ApplicantRequest>> violations = validator.validate(request);

    assertThat(violations)
        .extracting(ConstraintViolation::getMessageTemplate)
        .contains("{applicant.name.required}");
}
```

Untuk API contract:

```java
@Test
void shouldMapViolationToStableApiErrorCode() {
    var response = postJson("/applications", "{... invalid ...}");

    assertThat(response.jsonPath("$.errors[0].code"))
        .isEqualTo("APPLICANT_NAME_REQUIRED");
}
```

Test categories:

```text
1. message key exists
2. locale fallback works
3. API code stable
4. no rejected value leak
5. field path correct
6. class-level path correct
7. container index/key path correct
8. Spring/JAX-RS exception mapping correct
9. group-specific message correct
10. custom constraint message correct
```

---

## 36. Preventing PII Leakage in Tests

Tambahkan test khusus:

```java
@Test
void validationResponseMustNotLeakPassword() {
    var request = new ChangePasswordRequest("short", "secret-token-123");

    var response = postJson("/password/change", request);

    assertThat(response.body()).doesNotContain("short");
    assertThat(response.body()).doesNotContain("secret-token-123");
}
```

Untuk email/phone/ID:

```java
@Test
void validationResponseMustNotLeakNric() {
    var response = postJson("/applicants", Map.of("nric", "S1234567A"));

    assertThat(response.body()).doesNotContain("S1234567A");
}
```

Sistem besar sebaiknya punya automated rule:

```text
No validation API response may include fields classified as SECRET, TOKEN, PASSWORD, GOV_ID, HEALTH_DATA, FINANCIAL_ACCOUNT.
```

---

## 37. Observability: Metrics dari Message/Code

Validation errors sangat berguna untuk observability.

Metrics:

```text
validation.failure.count{code="APPLICANT_NAME_REQUIRED", endpoint="POST /applications"}
validation.failure.count{code="CASE_REFERENCE_INVALID_FORMAT", client="portal"}
validation.failure.rate{apiVersion="v2"}
validation.failure.topFields
validation.failure.byLocale
```

Gunakan code, bukan message:

Buruk:

```text
validation.failure.count{message="Applicant name is required"}
```

Baik:

```text
validation.failure.count{code="APPLICANT_NAME_REQUIRED"}
```

Kenapa?

- message berubah tergantung locale,
- message bisa terlalu high-cardinality,
- message bisa berisi PII jika salah desain,
- code lebih stabil.

---

## 38. Logging: Apa yang Aman?

Saat validation gagal, log jangan memuat payload lengkap.

Buruk:

```java
log.warn("Validation failed: request={}, violations={}", request, violations);
```

Masalah:

- request bisa berisi PII,
- `toString()` record/Lombok bisa expose semua field,
- violations bisa mengandung invalid value,
- log masuk APM/third party.

Lebih baik:

```java
log.warn(
    "Validation failed: traceId={}, operation={}, errorCodes={}, paths={}",
    traceId,
    operation,
    errors.stream().map(ApiValidationError::code).toList(),
    errors.stream().map(ApiValidationError::path).toList()
);
```

Jika perlu rejected value:

```text
Use classification, not raw value:
- type: String
- length: 245
- present: true
- masked: jo***@example.com if explicitly safe
```

---

## 39. Versioning Error Messages

Error messages bisa berubah tanpa breaking API jika client tidak bergantung pada message.

Stabil:

```text
code
path
schema shape
status
```

Boleh berubah:

```text
message wording
localized translation
capitalization
punctuation
```

Perubahan yang potentially breaking:

```text
code rename
path rename
field moved
constraint split/merge
status code change
error array structure change
```

Jika perlu rename code:

```yaml
OLD_APPLICANT_EMAIL_INVALID:
  deprecated: true
  replacement: APPLICANT_EMAIL_INVALID_FORMAT
  removeAfter: 2027-01-01
```

---

## 40. Message untuk Public API vs Internal UI

Public API:

```json
{
  "code": "CASE_REFERENCE_INVALID_FORMAT",
  "message": "Case reference format is invalid"
}
```

Internal officer UI:

```json
{
  "code": "CASE_REFERENCE_INVALID_FORMAT",
  "message": "Case reference must use format ABC-123456"
}
```

Support console:

```json
{
  "code": "CASE_REFERENCE_INVALID_FORMAT",
  "message": "Case reference format is invalid",
  "ruleId": "CASE-REF-001",
  "ruleVersion": "2026-01-15",
  "remediation": "Verify the official generated reference from Case Registry"
}
```

Audit:

```json
{
  "ruleId": "CASE-REF-001",
  "code": "CASE_REFERENCE_INVALID_FORMAT",
  "actor": "user-123",
  "channel": "PORTAL",
  "timestamp": "2026-06-16T10:00:00Z",
  "payloadClassification": "PII_REDACTED"
}
```

Satu validation failure dapat punya beberapa representation tergantung audience.

---

## 41. Message dan Frontend UX

Frontend biasanya membutuhkan lebih dari satu string.

Contoh response:

```json
{
  "errors": [
    {
      "code": "DOCUMENT_FILE_SIZE_EXCEEDED",
      "path": "documents[2].file",
      "message": "File size must not exceed 10 MB",
      "params": {
        "maxBytes": 10485760
      }
    }
  ]
}
```

Frontend bisa:

- highlight field,
- scroll ke field,
- tampilkan localized message,
- tampilkan max file size,
- disable submit,
- render checklist.

Namun `params` harus disanitasi.

Aman:

```json
{
  "maxBytes": 10485760,
  "allowedExtensions": ["pdf", "jpg"]
}
```

Hati-hati:

```json
{
  "regexp": "^internal-sensitive-pattern$"
}
```

---

## 42. Message Interpolation dan Container Element Path

Container element constraints menghasilkan path lebih kompleks.

DTO:

```java
public record NotificationRequest(
    List<@Email(message = "{recipient.email.invalid}") String> recipients
) {}
```

Input:

```json
{
  "recipients": ["valid@example.com", "bad-email"]
}
```

Path bisa menjadi:

```text
recipients[1].<list element>
```

API public mungkin ingin normalize menjadi:

```text
recipients[1]
```

Mapper path perlu memahami:

- property node,
- container element node,
- index,
- map key,
- parameter node,
- return value node.

Jangan mengandalkan `path.toString()` mentah jika kamu butuh contract sangat stabil lintas provider/version. Buat path normalizer sendiri.

---

## 43. Message untuk Map Key/Value

DTO:

```java
public record MetadataRequest(
    Map<
        @NotBlank(message = "{metadata.key.required}") String,
        @Size(max = 100, message = "{metadata.value.tooLong}") String
    > metadata
) {}
```

Violation pada key:

```text
metadata<K>[].<map key>
```

Violation pada value:

```text
metadata[foo].<map value>
```

Public API mungkin ingin:

```json
{
  "code": "METADATA_KEY_REQUIRED",
  "path": "metadata.<key>",
  "message": "Metadata key is required"
}
```

Atau:

```json
{
  "code": "METADATA_VALUE_TOO_LONG",
  "path": "metadata['foo']",
  "message": "Metadata value must not exceed 100 characters"
}
```

Jika map key mengandung PII, jangan expose key mentah.

---

## 44. Avoiding Message Duplication

Banyak codebase punya duplikasi seperti:

```java
@NotBlank(message = "Name is required")
private String applicantName;

@NotBlank(message = "Name is required")
private String officerName;

@NotBlank(message = "Name is required")
private String companyName;
```

Masalah:

- konteks hilang,
- FE sulit membedakan,
- audit/analytics generic,
- perubahan wording harus banyak tempat.

Lebih baik:

```java
@NotBlank(message = "{applicant.name.required}")
private String applicantName;

@NotBlank(message = "{officer.name.required}")
private String officerName;

@NotBlank(message = "{company.name.required}")
private String companyName;
```

Jika pesan display sama, tetap key/code bisa berbeda.

---

## 45. Anti-Pattern: Message Mengandung Business Decision

Buruk:

```java
@NotBlank(message = "Application cannot be submitted because user is not eligible")
private String applicantName;
```

Masalah:

- field-level constraint memuat eligibility logic,
- message tidak sesuai constraint,
- debugging misleading,
- audit salah.

Lebih benar:

```java
@NotBlank(message = "{applicant.name.required}")
private String applicantName;
```

Eligibility rule diproses oleh domain policy:

```java
EligibilityResult result = eligibilityPolicy.evaluate(command);
```

Dengan error:

```json
{
  "code": "APPLICANT_NOT_ELIGIBLE",
  "message": "Applicant is not eligible for this application type"
}
```

---

## 46. Anti-Pattern: Message Terlalu Teknis

Buruk:

```properties
application.period.invalid=startDate must be <= endDate due to LocalDate.compareTo returning positive value
```

Baik:

```properties
application.period.invalid=End date must be on or after start date
```

Internal debug bisa mencatat detail teknis, tapi user message harus berorientasi pada perbaikan.

---

## 47. Anti-Pattern: Message Terlalu Kabur

Buruk:

```properties
validation.error=Invalid value
```

Terlalu umum.

Lebih baik:

```properties
applicant.email.invalid=Applicant email address is invalid
application.period.invalid=End date must be on or after start date
case.reference.invalidFormat=Case reference format is invalid
```

Pesan baik menjawab:

```text
Apa yang salah?
Di mana?
Bagaimana memperbaikinya?
```

Namun tanpa membocorkan data sensitif.

---

## 48. Anti-Pattern: Message Tidak Sesuai Constraint

Contoh buruk:

```java
@Size(max = 100, message = "Name is required")
String name;
```

Jika `name` berisi 200 karakter, response:

```text
Name is required
```

Ini membingungkan.

Pastikan message sesuai dengan failure.

```java
@NotBlank(message = "{applicant.name.required}")
@Size(max = 100, message = "{applicant.name.tooLong}")
String name;
```

---

## 49. Anti-Pattern: Satu Message untuk Banyak Failure

Buruk:

```java
@NotBlank(message = "{user.invalid}")
@Email(message = "{user.invalid}")
@Size(max = 100, message = "{user.invalid}")
String email;
```

Response selalu:

```text
User is invalid
```

Lebih baik:

```java
@NotBlank(message = "{user.email.required}")
@Email(message = "{user.email.invalidFormat}")
@Size(max = 100, message = "{user.email.tooLong}")
String email;
```

---

## 50. Anti-Pattern: Reusing Built-in Default Messages untuk Public API

Default messages seperti:

```text
must not be blank
must be a well-formed email address
size must be between 1 and 10
```

Cukup untuk internal/dev, tetapi sering kurang untuk public API:

- tidak ada domain context,
- sulit dilokalisasi sesuai product tone,
- code terlalu generic,
- provider wording bisa berubah,
- FE tidak punya stable code.

Untuk API besar, override message dengan domain key:

```java
@NotBlank(message = "{case.reference.required}")
String caseReference;
```

---

## 51. Message dan Java Version Notes

### Java 8

- Bean Validation 2.0 umum digunakan.
- Namespace biasanya `javax.validation`.
- Container element constraints sudah tersedia sejak BV 2.0.
- Records belum ada.
- Banyak project menggunakan Hibernate Validator 6.x.

### Java 11

- Banyak enterprise apps masih di Spring Boot 2.x / Java EE/Jakarta EE 8 style.
- Message strategy sama, tetapi migration ke Jakarta perlu direncanakan.

### Java 17

- Minimum penting untuk banyak stack modern.
- Jakarta Validation 3.1 menetapkan Java 17 sebagai minimum.
- Spring Boot 3.x juga Java 17 baseline.

### Java 21

- Records semakin umum untuk request/response DTO.
- Virtual threads tidak mengubah message interpolation semantics, tetapi context propagation locale/logging perlu hati-hati.

### Java 25

- Treat as modern target untuk codebase baru.
- Gunakan records/sealed/value-oriented modeling bila sesuai.
- Hindari desain message yang bergantung pada mutable DTO/toString behavior.

---

## 52. `javax.validation` vs `jakarta.validation` untuk Message

Secara konsep, message interpolation tetap serupa.

Perubahan utama:

```text
javax.validation.* -> jakarta.validation.*
```

Namun hati-hati dengan default message key.

Contoh built-in default key bisa berada di namespace:

```text
javax.validation.constraints.NotNull.message
```

atau:

```text
jakarta.validation.constraints.NotNull.message
```

Jika aplikasi kamu mengandalkan override default built-in message, migration bisa memerlukan perubahan key.

Legacy:

```properties
javax.validation.constraints.NotNull.message=must not be null
```

Jakarta:

```properties
jakarta.validation.constraints.NotNull.message=must not be null
```

Rekomendasi:

```text
Untuk domain API, jangan bergantung pada default built-in key.
Gunakan domain-specific message key.
```

Contoh:

```java
@NotNull(message = "{application.submissionDate.required}")
LocalDate submissionDate;
```

---

## 53. Practical Design: Validation Message Stack

Untuk sistem production-grade, pisahkan stack menjadi beberapa layer:

```text
Constraint Annotation
    -> messageKey / domain code
        -> validation engine interpolation
            -> ConstraintViolation
                -> application mapper
                    -> API error model
                        -> frontend display
                            -> logs/metrics/audit
```

Jangan langsung:

```text
ConstraintViolation.getMessage() -> raw API response everywhere
```

Karena itu membuat aplikasi bergantung pada string provider/framework.

---

## 54. Example: End-to-End Design

DTO:

```java
public record SubmitApplicationRequest(
    @NotBlank(message = "{application.reference.required}")
    @Pattern(
        regexp = "^[A-Z]{3}-\\d{6}$",
        message = "{application.reference.invalidFormat}"
    )
    String applicationReference,

    @Valid
    @NotNull(message = "{applicant.required}")
    ApplicantDto applicant,

    @Size(max = 10, message = "{documents.tooMany}")
    List<@Valid DocumentDto> documents
) {}

public record ApplicantDto(
    @NotBlank(message = "{applicant.name.required}")
    @Size(max = 120, message = "{applicant.name.tooLong}")
    String name,

    @Email(message = "{applicant.email.invalidFormat}")
    String email
) {}

public record DocumentDto(
    @NotBlank(message = "{document.name.required}")
    String name,

    @NotNull(message = "{document.type.required}")
    DocumentType type
) {}
```

Messages:

```properties
application.reference.required=Application reference is required
application.reference.invalidFormat=Application reference format is invalid
applicant.required=Applicant information is required
applicant.name.required=Applicant name is required
applicant.name.tooLong=Applicant name must not exceed {max} characters
applicant.email.invalidFormat=Applicant email address format is invalid
documents.tooMany=Maximum {max} documents are allowed
document.name.required=Document name is required
document.type.required=Document type is required
```

API response:

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Invalid request",
  "status": 400,
  "traceId": "01HTXYZ",
  "errors": [
    {
      "code": "APPLICATION_REFERENCE_INVALID_FORMAT",
      "path": "applicationReference",
      "message": "Application reference format is invalid"
    },
    {
      "code": "APPLICANT_NAME_REQUIRED",
      "path": "applicant.name",
      "message": "Applicant name is required"
    },
    {
      "code": "DOCUMENT_TYPE_REQUIRED",
      "path": "documents[2].type",
      "message": "Document type is required"
    }
  ]
}
```

Log:

```json
{
  "event": "VALIDATION_FAILED",
  "traceId": "01HTXYZ",
  "operation": "SUBMIT_APPLICATION",
  "codes": [
    "APPLICATION_REFERENCE_INVALID_FORMAT",
    "APPLICANT_NAME_REQUIRED",
    "DOCUMENT_TYPE_REQUIRED"
  ],
  "paths": [
    "applicationReference",
    "applicant.name",
    "documents[2].type"
  ]
}
```

Metrics:

```text
validation.failure.count{code="APPLICANT_NAME_REQUIRED",operation="SUBMIT_APPLICATION"} 1
validation.failure.count{code="DOCUMENT_TYPE_REQUIRED",operation="SUBMIT_APPLICATION"} 1
```

---

## 55. Checklist Desain Pesan Validation

Gunakan checklist ini saat review PR.

### 55.1 Constraint Message

- [ ] Apakah message memakai domain-specific bundle key?
- [ ] Apakah message sesuai dengan constraint yang gagal?
- [ ] Apakah message tidak terlalu generic?
- [ ] Apakah message tidak terlalu teknis?
- [ ] Apakah message menjelaskan remediation secara aman?
- [ ] Apakah annotation attribute yang disisipkan aman diekspos?

### 55.2 Security

- [ ] Apakah message tidak memuat password/token/secret?
- [ ] Apakah message tidak memuat PII mentah?
- [ ] Apakah rejected value tidak diekspos di API/log?
- [ ] Apakah regex/internal rule tidak bocor?
- [ ] Apakah EL digunakan secara aman dan terkendali?

### 55.3 API Contract

- [ ] Apakah response punya stable error code?
- [ ] Apakah frontend tidak perlu parsing human message?
- [ ] Apakah path stabil dan jelas?
- [ ] Apakah class-level/container path dinormalisasi?
- [ ] Apakah response shape konsisten lintas endpoint?

### 55.4 i18n

- [ ] Apakah semua key tersedia untuk locale yang didukung?
- [ ] Apakah fallback aman?
- [ ] Apakah test locale tersedia?
- [ ] Apakah message tidak hardcoded di banyak tempat?

### 55.5 Operations

- [ ] Apakah code bisa dipakai metrics?
- [ ] Apakah log tidak mengandung data sensitif?
- [ ] Apakah trace/correlation id tersedia?
- [ ] Apakah rule owner jelas?
- [ ] Apakah message catalog terdokumentasi?

---

## 56. Common Failure Modes

### 56.1 Missing Bundle Key

Symptom:

```text
{applicant.name.required}
```

muncul ke user.

Penyebab:

- file `ValidationMessages.properties` tidak ada,
- key typo,
- resource tidak masuk classpath,
- locale file tidak lengkap,
- custom message source salah konfigurasi.

Fix:

- test all keys,
- validate catalog at build time,
- fallback safe message,
- log missing key.

### 56.2 Locale Selalu Default

Penyebab:

- locale resolver tidak dikonfigurasi,
- `Accept-Language` diabaikan,
- manual validator tidak diberi locale,
- async context kehilangan locale,
- thread-local tidak propagate.

Fix:

- tentukan locale source resmi,
- test request dengan beberapa locale,
- hindari asumsi thread-local di async path.

### 56.3 Message Bocor ke Log

Penyebab:

- log full request,
- log full violation,
- `toString()` record/Lombok expose field,
- EL memakai `validatedValue`.

Fix:

- structured safe logging,
- classification/masking,
- prohibit raw invalid value in message.

### 56.4 FE Bergantung pada Message

Penyebab:

- API tidak punya error code,
- message dianggap stable,
- frontend butuh conditional behavior.

Fix:

- tambahkan code,
- version API error shape,
- dokumentasikan code catalog.

### 56.5 Constraint Message Jadi Business Logic

Penyebab:

- rule domain diselipkan ke annotation,
- tidak ada policy layer,
- validation group disalahgunakan.

Fix:

- pindahkan ke domain service/policy/transition guard,
- gunakan Bean Validation hanya untuk local shape/invariant.

---

## 57. Advanced Governance: Message Catalog as Artifact

Untuk organisasi besar, message catalog sebaiknya menjadi artifact yang:

- versioned di Git,
- direview BA/QA/UX/security,
- bisa diexport untuk FE,
- punya owner module,
- punya compatibility rule,
- punya deprecation lifecycle.

Contoh struktur repository:

```text
validation/
  catalog/
    application-management.yaml
    case-management.yaml
    compliance.yaml
  messages/
    ValidationMessages.properties
    ValidationMessages_id.properties
    ValidationMessages_en.properties
  tests/
    MessageCatalogConsistencyTest.java
```

Consistency test:

```text
1. every message key in code exists in all required locales
2. every catalog code maps to message key
3. no unused public code unless deprecated
4. no message contains forbidden token patterns
5. no message uses ${validatedValue} for sensitive fields
6. no public message exceeds max length
```

---

## 58. Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana cara mengganti pesan @NotNull?
```

Engineer senior bertanya:

```text
Apakah pesan ini dilokalisasi?
Apakah frontend bergantung pada string?
Apakah error code stabil?
Apakah rejected value aman?
Apakah path stabil untuk nested/container object?
Apakah rule ini punya owner?
Apakah violation bisa dimonitor?
Apakah message bisa berubah tanpa breaking API?
Apakah audit membutuhkan rule version?
```

Engineer top-tier melihat validation message sebagai bagian dari:

```text
contract design
security boundary
user experience
i18n strategy
observability signal
audit evidence
rule governance
```

---

## 59. Ringkasan

Message interpolation dalam Jakarta/Bean Validation adalah proses mengubah template menjadi pesan akhir dengan dukungan resource bundle, annotation attribute, locale, dan Expression Language.

Namun di production, yang lebih penting dari sekadar interpolation adalah desain error contract.

Prinsip utama:

1. Human message bukan identitas rule.
2. Gunakan stable error code.
3. Gunakan domain-specific message key.
4. Jangan expose rejected value mentah.
5. Jangan parsing message di frontend/backend.
6. Pisahkan public message, internal debug, audit evidence, dan metrics.
7. Gunakan i18n secara terstruktur.
8. Batasi penggunaan EL.
9. Buat message catalog untuk sistem besar.
10. Test message, code, path, localization, dan PII leakage.

---

## 60. Latihan

### Latihan 1 — Refactor Message Literal

Ubah DTO berikut agar production-grade:

```java
public record RegisterUserRequest(
    @NotBlank(message = "Name required")
    String name,

    @Email(message = "Bad email: ${validatedValue}")
    String email,

    @Size(min = 8, message = "Password too short: ${validatedValue}")
    String password
) {}
```

Target:

- pakai message key,
- jangan leak rejected value,
- pisahkan error code,
- siapkan bundle English dan Indonesian.

### Latihan 2 — API Error Mapper

Buat mapper dari `ConstraintViolation<?>` ke:

```java
public record ApiValidationError(
    String code,
    String path,
    String message,
    String constraint
) {}
```

Requirement:

- code berasal dari message template jika format `{...}`,
- path dinormalisasi,
- rejected value tidak diekspos,
- fallback code aman.

### Latihan 3 — Message Catalog Consistency Test

Buat test yang memastikan semua key di `ValidationMessages.properties` juga ada di `ValidationMessages_id.properties`.

### Latihan 4 — PII Leakage Test

Buat test API yang memastikan response validation untuk password/email/token tidak mengandung raw input.

### Latihan 5 — Workflow Message Design

Rancang error response untuk rule:

```text
Case cannot be approved if assessment outcome is missing.
```

Pisahkan:

- public API response,
- internal UI message,
- audit event,
- metrics label.

---

## 61. Referensi

- Jakarta Validation 3.1 Specification: <https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html>
- Jakarta Validation 3.1 Overview: <https://jakarta.ee/specifications/bean-validation/3.1/>
- Bean Validation 2.0 Specification: <https://beanvalidation.org/2.0/spec/>
- Hibernate Validator Stable Reference Guide: <https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/>
- Hibernate Validator Documentation: <https://hibernate.org/validator/documentation/>
- Jakarta Validation API 3.1 JavaDoc: <https://jakarta.ee/specifications/bean-validation/3.1/apidocs/>

---

## 62. Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, Metadata
- Part 003 — Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
- Part 004 — Nullability Strategy: `@NotNull`, Optional, Defaults, and Domain Absence
- Part 005 — Cascaded Validation: `@Valid`, Object Graphs, Aggregates, and Boundary Control
- Part 006 — Container Element Constraints: Lists, Maps, Optional, Custom Containers
- Part 007 — Validation Groups: Operation-Specific Contracts without DTO Explosion
- Part 008 — Group Sequence and Dynamic Group Sequence: Ordered Validation and Short-Circuiting
- Part 009 — Custom Constraint Design: Annotation, Validator, Message, Target, Repeatable
- Part 010 — Class-Level and Cross-Field Validation: Consistency inside One Object
- Part 011 — Cross-Parameter and Executable Validation: Methods, Constructors, Return Values
- Part 012 — Records, Immutability, Builders, Lombok, and Modern Java Modeling
- Part 013 — Message Interpolation: i18n, EL, Security, and Error Message Governance

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-014.md
```

Topik berikutnya:

```text
Payload, Severity, Error Codes, and Machine-Readable Violations
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-012.md">⬅️ Records, Immutability, Builders, Lombok, and Modern Java Modeling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-014.md">Payload, Severity, Error Codes, and Machine-Readable Violations ➡️</a>
</div>

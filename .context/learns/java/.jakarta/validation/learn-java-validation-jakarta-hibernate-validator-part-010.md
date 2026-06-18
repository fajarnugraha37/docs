# learn-java-validation-jakarta-hibernate-validator-part-010

# Class-Level and Cross-Field Validation: Consistency inside One Object

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `010`  
> Topik: Class-level constraint, cross-field validation, conditional requiredness, consistency rule, custom violation path  
> Target: Java 8 sampai Java 25, `javax.validation` dan `jakarta.validation`, Hibernate Validator

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas custom constraint pada level field/type. Sekarang kita naik satu level: validasi yang tidak bisa diputuskan dari satu field saja.

Contoh sederhana:

```java
public final class PeriodRequest {
    private LocalDate startDate;
    private LocalDate endDate;
}
```

`startDate` boleh valid sendiri. `endDate` juga boleh valid sendiri. Tetapi objeknya bisa tetap invalid jika:

```text
startDate > endDate
```

Inilah wilayah **class-level validation** atau **cross-field validation**.

Target utama bagian ini:

1. Memahami kapan validasi field-level tidak cukup.
2. Mendesain class-level constraint yang tetap kecil, jelas, testable, dan tidak berubah menjadi workflow engine.
3. Menghasilkan `ConstraintViolation` yang path-nya usable oleh frontend/API consumer.
4. Membedakan cross-field consistency, business policy, authorization, workflow guard, dan database consistency.
5. Membuat mental model production-grade untuk conditional requiredness.

Referensi resmi penting:

- Jakarta Validation 3.1 mendefinisikan model metadata dan API untuk JavaBean dan method validation, termasuk constraint pada bean/class dan method. Jakarta Validation 3.1 menargetkan Jakarta EE 11. [Jakarta Validation 3.1](https://jakarta.ee/specifications/bean-validation/3.1/)
- Spesifikasi Jakarta Validation 3.1 menjelaskan model constraint annotation, `ConstraintValidator`, dan `ConstraintValidatorContext`. [Jakarta Validation 3.1 Specification](https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html)
- Hibernate Validator reference guide menjelaskan bahwa bean constraint dapat berupa field constraints, property constraints, container element constraints, dan class constraints. [Hibernate Validator Reference Guide](https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/)

---

## 2. Problem yang Diselesaikan Cross-Field Validation

Field-level validation menjawab pertanyaan seperti:

```text
Apakah field ini null?
Apakah string ini kosong?
Apakah angka ini positif?
Apakah tanggal ini di masa depan?
Apakah list ini maksimal 10 item?
```

Cross-field validation menjawab pertanyaan seperti:

```text
Apakah kombinasi field ini masuk akal?
Apakah field A required jika field B bernilai tertentu?
Apakah minimal salah satu dari field A/B/C terisi?
Apakah startDate tidak melewati endDate?
Apakah selectedOption kompatibel dengan selectedCategory?
Apakah dua identitas saling konsisten?
Apakah requestedAmount tidak melebihi approvedAmount?
```

Perhatikan perbedaan mental model-nya:

| Jenis Rule | Pertanyaan | Biasanya Cocok di |
|---|---|---|
| Field rule | Apakah satu value valid? | Field/type-use constraint |
| Cross-field rule | Apakah beberapa value dalam satu object konsisten? | Class-level constraint |
| Operation rule | Apakah object ini valid untuk operasi tertentu? | Validation group, command DTO, service validator |
| Workflow rule | Apakah transisi state ini boleh? | State machine guard / domain policy |
| Authorization rule | Apakah actor boleh melakukan tindakan ini? | Security layer / policy service |
| Persistence rule | Apakah data final konsisten secara concurrent? | Database constraint / transaction boundary |

Class-level validation idealnya hanya menjawab:

```text
Apakah object ini secara internal konsisten?
```

Bukan:

```text
Apakah user ini boleh approve case ini?
Apakah case ini boleh pindah state?
Apakah value ini unique di database?
Apakah SLA masih valid menurut konfigurasi tenant?
```

Itu boundary penting.

---

## 3. Mental Model: Object Consistency vs Field Correctness

Bayangkan DTO sebagai satu dokumen kecil.

Field-level validation memastikan setiap kolom dokumen ditulis dengan format benar.

Class-level validation memastikan isi antar kolom tidak saling bertentangan.

Contoh:

```json
{
  "applicantType": "COMPANY",
  "nric": "S1234567D",
  "uen": null
}
```

Field `applicantType` valid. Field `nric` bisa valid. Field `uen` boleh null jika dilihat sendiri. Tetapi kombinasi ini invalid jika aturan sistem adalah:

```text
Jika applicantType = COMPANY, maka uen wajib diisi dan nric tidak boleh dipakai sebagai primary identifier.
```

Itulah object consistency.

### 3.1 Formula dasar cross-field validation

Secara mental, class-level validator melakukan:

```text
object -> extract relevant fields -> evaluate consistency rule -> emit structured violation(s)
```

Bukan:

```text
object -> call many services -> mutate state -> save to DB -> emit random exception
```

Validator yang baik:

- pure atau hampir pure,
- deterministic,
- tidak mengubah object,
- tidak melakukan I/O berat,
- mudah dites,
- menghasilkan violation yang stabil,
- tidak menyembunyikan workflow logic.

---

## 4. Contoh Paling Sederhana: Date Range

Kita mulai dengan rule:

```text
startDate harus <= endDate
```

DTO:

```java
@ValidDateRange(
    start = "startDate",
    end = "endDate",
    message = "startDate must be before or equal to endDate"
)
public final class DateRangeRequest {

    @NotNull
    private LocalDate startDate;

    @NotNull
    private LocalDate endDate;

    public LocalDate getStartDate() {
        return startDate;
    }

    public LocalDate getEndDate() {
        return endDate;
    }
}
```

Constraint annotation:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Documented
@Constraint(validatedBy = DateRangeValidator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidDateRange {

    String message() default "invalid date range";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    String start();

    String end();

    boolean allowEqual() default true;
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.beans.IntrospectionException;
import java.beans.Introspector;
import java.beans.PropertyDescriptor;
import java.lang.reflect.InvocationTargetException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

public final class DateRangeValidator implements ConstraintValidator<ValidDateRange, Object> {

    private String startProperty;
    private String endProperty;
    private boolean allowEqual;

    @Override
    public void initialize(ValidDateRange annotation) {
        this.startProperty = annotation.start();
        this.endProperty = annotation.end();
        this.allowEqual = annotation.allowEqual();
    }

    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        LocalDate start = readLocalDate(value, startProperty);
        LocalDate end = readLocalDate(value, endProperty);

        // Let @NotNull on each property handle missing values.
        // This validator only checks consistency when both values are present.
        if (start == null || end == null) {
            return true;
        }

        boolean valid = allowEqual
                ? !start.isAfter(end)
                : start.isBefore(end);

        if (valid) {
            return true;
        }

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
                .addPropertyNode(endProperty)
                .addConstraintViolation();

        return false;
    }

    private static LocalDate readLocalDate(Object bean, String propertyName) {
        Object raw = readProperty(bean, propertyName);
        if (raw == null) {
            return null;
        }
        if (!(raw instanceof LocalDate)) {
            throw new IllegalStateException(
                    "Property '" + propertyName + "' must be LocalDate but was " + raw.getClass().getName()
            );
        }
        return (LocalDate) raw;
    }

    private static Object readProperty(Object bean, String propertyName) {
        try {
            Map<String, PropertyDescriptor> descriptors = Arrays.stream(
                    Introspector.getBeanInfo(bean.getClass()).getPropertyDescriptors()
            ).collect(Collectors.toMap(PropertyDescriptor::getName, Function.identity()));

            PropertyDescriptor descriptor = descriptors.get(propertyName);
            if (descriptor == null || descriptor.getReadMethod() == null) {
                throw new IllegalStateException(
                        "No readable bean property '" + propertyName + "' on " + bean.getClass().getName()
                );
            }
            return descriptor.getReadMethod().invoke(bean);
        } catch (IntrospectionException | IllegalAccessException | InvocationTargetException e) {
            throw new IllegalStateException(
                    "Failed to read bean property '" + propertyName + "' on " + bean.getClass().getName(),
                    e
            );
        }
    }
}
```

Contoh violation path yang dihasilkan:

```text
endDate: startDate must be before or equal to endDate
```

Bukan hanya:

```text
DateRangeRequest: startDate must be before or equal to endDate
```

Mengapa ditempelkan ke `endDate`? Karena dari perspektif user, biasanya field yang perlu diperbaiki adalah `endDate`. Tetapi ini keputusan desain. Pada rule tertentu, error lebih tepat ditempelkan ke object-level.

---

## 5. Jangan Terlalu Cepat Membuat Generic Reflection Validator

Contoh di atas memakai property name string agar annotation reusable:

```java
@ValidDateRange(start = "startDate", end = "endDate")
```

Ini fleksibel, tetapi ada trade-off:

| Pendekatan | Kelebihan | Risiko |
|---|---|---|
| Generic reflection validator | Reusable, sedikit class | typo property baru ketahuan runtime, refactor tidak aman |
| Specific validator per DTO | Type-safe, jelas, mudah debug | lebih banyak class |
| Domain method `isDateRangeValid()` | Sangat explicit | bisa bocor ke DTO/domain jika terlalu banyak |
| External command validator | Cocok untuk rule kompleks | bukan Bean Validation murni |

Untuk sistem besar, jangan otomatis memilih generic reflection validator. Pilih berdasarkan stabilitas rule.

Jika rule-nya sangat umum seperti date range, generic validator masuk akal.

Jika rule-nya spesifik domain seperti:

```text
Jika applicantType = COMPANY dan representativeMode = THIRD_PARTY,
maka representativeAuthorizationDocument wajib ada,
kecuali channel = SYSTEM_MIGRATION.
```

Jangan paksakan menjadi annotation generic dengan 12 attribute. Lebih baik gunakan command validator/domain policy.

---

## 6. Cross-Field Validation Pattern 1: Date/Time Range

### 6.1 Rule umum

```text
start <= end
```

Variasi:

```text
start < end
startDate <= endDate
startDateTime <= endDateTime
effectiveFrom <= effectiveTo
validFrom <= validUntil
submissionWindowStart <= submissionWindowEnd
```

### 6.2 Edge case penting

Date range terlihat sederhana, tetapi production case sering rumit:

| Edge Case | Pertanyaan |
|---|---|
| Inclusive/exclusive | Apakah start dan end boleh sama? |
| Null | Jika salah satu null, apakah cross-field validator gagal atau field-level yang menangani? |
| Timezone | Apakah memakai `LocalDate`, `Instant`, `ZonedDateTime`, atau `OffsetDateTime`? |
| Business day | Apakah weekend/holiday boleh? |
| Open-ended range | Apakah end null berarti “until further notice”? |
| Clock | Apakah dibandingkan terhadap system clock atau request-specific clock? |
| Precision | Apakah inclusive sampai tanggal atau sampai detik? |

### 6.3 Guideline

Untuk class-level validator date range:

- jangan validasi `@NotNull` ulang kecuali memang rule-nya membutuhkan;
- jangan memanggil kalender holiday external di Bean Validator;
- jangan mengubah timezone secara diam-diam;
- buat nama annotation yang jujur:
  - `@ValidDateRange`,
  - `@ChronologicalRange`,
  - `@ValidEffectivePeriod`.

Jika rule sudah menyentuh holiday, SLA, working day, tenant setting, atau policy date, itu biasanya bukan lagi simple class-level validation.

---

## 7. Cross-Field Validation Pattern 2: Conditional Requiredness

Rule:

```text
Jika applicantType = COMPANY, maka uen wajib diisi.
Jika applicantType = INDIVIDUAL, maka nric wajib diisi.
```

DTO:

```java
@ValidApplicantIdentifier
public final class ApplicantRequest {

    @NotNull
    private ApplicantType applicantType;

    private String nric;

    private String uen;

    public ApplicantType getApplicantType() {
        return applicantType;
    }

    public String getNric() {
        return nric;
    }

    public String getUen() {
        return uen;
    }
}
```

Annotation:

```java
@Documented
@Constraint(validatedBy = ApplicantIdentifierValidator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidApplicantIdentifier {

    String message() default "invalid applicant identifier";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class ApplicantIdentifierValidator
        implements ConstraintValidator<ValidApplicantIdentifier, ApplicantRequest> {

    @Override
    public boolean isValid(ApplicantRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        ApplicantType type = value.getApplicantType();
        if (type == null) {
            return true; // Let @NotNull handle applicantType.
        }

        switch (type) {
            case COMPANY:
                if (isBlank(value.getUen())) {
                    addViolation(context, "uen", "uen is required for company applicant");
                    return false;
                }
                return true;

            case INDIVIDUAL:
                if (isBlank(value.getNric())) {
                    addViolation(context, "nric", "nric is required for individual applicant");
                    return false;
                }
                return true;

            default:
                return true;
        }
    }

    private static void addViolation(
            ConstraintValidatorContext context,
            String property,
            String message
    ) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message)
                .addPropertyNode(property)
                .addConstraintViolation();
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
```

### 7.1 Masalah dengan conditional requiredness

Conditional requiredness sering terlihat seperti validation, tetapi bisa cepat berubah menjadi workflow logic.

Contoh yang masih cocok:

```text
Jika applicantType = COMPANY, uen wajib.
```

Karena rule ini adalah internal consistency dari satu object.

Contoh yang mulai tidak cocok:

```text
Jika applicantType = COMPANY, uen wajib hanya untuk submission,
tetapi tidak wajib untuk draft,
kecuali officer sedang melakukan migration correction,
dan agencyCode tertentu masih memakai legacy format.
```

Ini bukan lagi simple cross-field validation. Ini sudah operation/workflow/context-specific policy.

Solusi lebih baik:

- DTO berbeda untuk draft dan submit; atau
- validation groups untuk operasi sederhana; atau
- command validator/domain policy untuk rule contextual; atau
- workflow guard untuk state transition.

---

## 8. Cross-Field Validation Pattern 3: At Least One Field Required

Rule:

```text
Minimal salah satu dari email atau mobileNumber wajib diisi.
```

DTO:

```java
@AtLeastOneContactMethod
public final class ContactRequest {

    @Email
    private String email;

    @Pattern(regexp = "^[0-9]{8,15}$")
    private String mobileNumber;

    public String getEmail() {
        return email;
    }

    public String getMobileNumber() {
        return mobileNumber;
    }
}
```

Validator:

```java
public final class AtLeastOneContactMethodValidator
        implements ConstraintValidator<AtLeastOneContactMethod, ContactRequest> {

    @Override
    public boolean isValid(ContactRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }

        boolean hasEmail = !isBlank(value.getEmail());
        boolean hasMobile = !isBlank(value.getMobileNumber());

        if (hasEmail || hasMobile) {
            return true;
        }

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate("email or mobileNumber is required")
                .addBeanNode()
                .addConstraintViolation();

        return false;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
```

Di sini violation ditempelkan ke bean node, bukan field tertentu, karena tidak ada satu field yang jelas salah. User bisa memperbaiki dengan mengisi salah satu.

Alternatif API error:

```json
{
  "code": "CONTACT_METHOD_REQUIRED",
  "path": "$",
  "message": "Either email or mobileNumber is required",
  "fields": ["email", "mobileNumber"]
}
```

Bean Validation `ConstraintViolation` tidak selalu cukup untuk mengekspresikan multi-field UX. Karena itu mapping layer API boleh memperkaya violation menjadi response model yang lebih eksplisit.

---

## 9. Cross-Field Validation Pattern 4: Mutually Exclusive Fields

Rule:

```text
exactly one of documentId or uploadedFile must be provided
```

Ini umum pada request yang menerima reference existing document atau upload baru.

```java
@ExactlyOneDocumentSource
public final class AttachmentRequest {

    private UUID existingDocumentId;

    private UploadedFile uploadedFile;

    public UUID getExistingDocumentId() {
        return existingDocumentId;
    }

    public UploadedFile getUploadedFile() {
        return uploadedFile;
    }
}
```

Validator logic:

```java
boolean hasExisting = value.getExistingDocumentId() != null;
boolean hasUpload = value.getUploadedFile() != null;

boolean valid = hasExisting ^ hasUpload;
```

Truth table:

| existingDocumentId | uploadedFile | Valid? | Meaning |
|---|---:|---:|---|
| null | null | No | No source |
| present | null | Yes | Use existing document |
| null | present | Yes | Upload new document |
| present | present | No | Ambiguous source |

This kind of rule is a good class-level validation candidate because it checks the internal shape of one request object.

---

## 10. Cross-Field Validation Pattern 5: Dependent Numeric Values

Rule:

```text
approvedAmount <= requestedAmount
```

DTO:

```java
@ValidApprovalAmount
public final class ApprovalRequest {

    @NotNull
    @Positive
    private BigDecimal requestedAmount;

    @NotNull
    @PositiveOrZero
    private BigDecimal approvedAmount;
}
```

Important caveat:

```java
requestedAmount.compareTo(approvedAmount) >= 0
```

Use `compareTo`, not `equals`, because `BigDecimal.equals()` is scale-sensitive:

```java
new BigDecimal("10.0").equals(new BigDecimal("10.00")) // false
new BigDecimal("10.0").compareTo(new BigDecimal("10.00")) // 0
```

For financial validation, also separate:

- amount positivity,
- decimal scale,
- currency compatibility,
- max allowed amount,
- approval policy,
- authorization limit,
- budget availability,
- database consistency.

Only some of these belong in Bean Validation.

---

## 11. Cross-Field Validation Pattern 6: Field Compatibility

Rule:

```text
country = SG implies postalCode must be 6 digits.
country != SG implies postalCode may follow different format.
```

This looks tempting:

```java
@ValidPostalCodeForCountry
public final class AddressRequest {
    private String countryCode;
    private String postalCode;
}
```

This can be valid class-level validation if the format rule is local and stable.

But be careful. If validation requires external data:

```text
postal code must exist in authoritative postal directory
postal code must map to selected district
postal code must be serviceable by agency branch
postal code must be valid according to vendor API
```

That rule is no longer a pure class-level consistency check. It is a reference/policy/integration rule.

Better layering:

```text
DTO Bean Validation:
  countryCode not blank
  postalCode not blank
  if countryCode = SG, postalCode has 6 digits

Application/domain policy:
  postalCode exists in reference dataset
  postalCode belongs to serviceable district

Database/integration:
  reference data consistency
  transactional enforcement if needed
```

---

## 12. How to Build Custom Property Paths

One of the most important skills for class-level validation is not only detecting invalid state, but attaching the violation to the right path.

### 12.1 Object-level violation

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("invalid period")
        .addBeanNode()
        .addConstraintViolation();
```

Result conceptually:

```text
$: invalid period
```

Use object-level when:

- no single field is wrong;
- user can fix one of multiple fields;
- the error represents combination-level inconsistency.

Example:

```text
Either email or mobileNumber is required.
```

### 12.2 Field-level violation from class-level validator

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("endDate must not be before startDate")
        .addPropertyNode("endDate")
        .addConstraintViolation();
```

Result:

```text
endDate: endDate must not be before startDate
```

Use field-level when one field is naturally the correction target.

### 12.3 Multiple field violations

```java
context.disableDefaultConstraintViolation();

context.buildConstraintViolationWithTemplate("uen is required for company applicant")
        .addPropertyNode("uen")
        .addConstraintViolation();

context.buildConstraintViolationWithTemplate("nric must not be supplied for company applicant")
        .addPropertyNode("nric")
        .addConstraintViolation();

return false;
```

This produces two violations from one class-level validator.

Good when both fields independently need correction.

### 12.4 Nested property violation

Suppose:

```java
public final class CaseSubmissionRequest {
    private ApplicantRequest applicant;
}
```

Class-level validator on `CaseSubmissionRequest` can build:

```java
context.buildConstraintViolationWithTemplate("uen is required")
        .addPropertyNode("applicant")
        .addPropertyNode("uen")
        .addConstraintViolation();
```

Path:

```text
applicant.uen
```

Use sparingly. If nested object owns the rule, put validator on nested object instead.

---

## 13. Disable Default Constraint Violation Correctly

Common bug:

```java
context.buildConstraintViolationWithTemplate("custom message")
        .addPropertyNode("endDate")
        .addConstraintViolation();
return false;
```

This may emit both:

```text
object-level default violation
field-level custom violation
```

Correct:

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("custom message")
        .addPropertyNode("endDate")
        .addConstraintViolation();
return false;
```

Rule:

```text
If you add custom violations, usually disable the default one.
```

Exception: If you intentionally want both object-level and field-level violations. That is rare and usually noisy for API clients.

---

## 14. Null Handling in Cross-Field Validators

Recommended convention:

```java
if (value == null) {
    return true;
}

if (fieldA == null || fieldB == null) {
    return true;
}
```

Why?

Because:

- `@NotNull` should own requiredness;
- class-level validator should own consistency;
- duplicate violations confuse users;
- group sequencing can control when consistency checks run.

Example:

```java
@ValidDateRange
public final class DateRangeRequest {
    @NotNull
    private LocalDate startDate;

    @NotNull
    private LocalDate endDate;
}
```

If both are null, preferred error:

```text
startDate: must not be null
endDate: must not be null
```

Not additionally:

```text
endDate: must be after startDate
```

Because date range comparison does not make sense until both dates exist.

---

## 15. Use Group Sequence for Dependent Validation

Sometimes cross-field validation should only run after basic field validation passes.

Example:

```java
public interface BasicChecks {}
public interface ConsistencyChecks {}

@GroupSequence({BasicChecks.class, ConsistencyChecks.class, SubmitChecks.class})
public interface SubmitValidationSequence {}
```

DTO:

```java
@ValidDateRange(groups = ConsistencyChecks.class)
public final class SubmissionPeriodRequest {

    @NotNull(groups = BasicChecks.class)
    private LocalDate startDate;

    @NotNull(groups = BasicChecks.class)
    private LocalDate endDate;
}
```

Validation:

```java
Set<ConstraintViolation<SubmissionPeriodRequest>> violations = validator.validate(
        request,
        SubmitValidationSequence.class
);
```

Effect:

1. Run basic field checks.
2. If basic checks pass, run consistency checks.
3. If consistency checks pass, run submit checks.

This avoids confusing secondary errors.

But do not overuse group sequence. For complex workflow, use explicit staged validation in application code.

---

## 16. Class-Level Constraint vs Validation Group

These solve different problems.

Class-level constraint answers:

```text
Is this object internally consistent?
```

Validation group answers:

```text
Which subset of constraints should apply for this operation?
```

They can combine:

```java
@ValidApplicantIdentifier(groups = Submit.class)
public final class ApplicantDraftRequest {
    private ApplicantType applicantType;
    private String nric;
    private String uen;
}
```

Meaning:

```text
Applicant identifier consistency is enforced only during Submit validation.
```

This may be acceptable if draft is intentionally incomplete.

But if there are many operation-specific variants, prefer separate DTOs or command validators.

---

## 17. Class-Level Constraint vs Command Validator

A class-level constraint is declarative and framework-friendly.

A command validator is explicit and context-friendly.

### 17.1 Class-level constraint example

```java
@ValidDateRange
public final class SearchRequest {
    private LocalDate from;
    private LocalDate to;
}
```

Good because:

- rule is local;
- no external dependency;
- stable;
- tied to object shape.

### 17.2 Command validator example

```java
public final class SubmitCaseCommandValidator {

    public ValidationResult validate(SubmitCaseCommand command, Actor actor, CaseSnapshot snapshot) {
        ValidationResult result = new ValidationResult();

        if (!actor.canSubmit(snapshot)) {
            result.reject("ACTOR_NOT_ALLOWED_TO_SUBMIT");
        }

        if (!snapshot.isInDraftState()) {
            result.reject("CASE_NOT_IN_DRAFT_STATE");
        }

        if (!snapshot.hasRequiredDocuments()) {
            result.reject("REQUIRED_DOCUMENT_MISSING");
        }

        return result;
    }
}
```

Good because:

- needs actor;
- needs current case state;
- needs persisted snapshot;
- may need policy version;
- belongs to workflow/domain context.

### 17.3 Decision rule

Use class-level constraint when:

```text
The object contains all information needed to decide the rule.
```

Use command/domain validator when:

```text
The rule needs actor, state, database, reference data, workflow, policy version, or external service.
```

---

## 18. Class-Level Constraint vs Database Constraint

Consider:

```text
start_date <= end_date
```

This can be enforced both in Bean Validation and DB CHECK constraint.

Bean Validation gives early feedback:

```text
400 Bad Request: endDate must not be before startDate
```

DB constraint gives final consistency:

```text
Transaction cannot persist invalid row even if service bug exists.
```

For important invariants, do both when possible.

| Rule | Bean Validation | DB Constraint |
|---|---:|---:|
| `startDate <= endDate` | Yes | CHECK |
| non-null field | Yes | NOT NULL |
| unique identifier | Maybe pre-check, but not enough | UNIQUE |
| foreign key exists | Maybe reference validation | FK |
| status transition allowed | Usually no | Sometimes trigger, but usually domain/workflow |
| role allowed to approve | No | No, authorization/policy |

Production mindset:

```text
Bean Validation improves feedback.
Database constraints protect final truth.
Domain policy protects business correctness.
```

---

## 19. Class-Level Constraint vs Authorization

Bad:

```java
@UserCanApproveCase
public final class ApproveCaseRequest {
    private UUID caseId;
    private UUID approverId;
}
```

Why bad?

Because authorization depends on:

- authenticated actor;
- roles;
- permissions;
- ownership;
- delegation;
- organizational unit;
- current case state;
- policy;
- time;
- sometimes tenant/agency.

This is not object consistency. This is access control.

Better:

```java
authorizationService.assertCanApprove(actor, caseSnapshot);
```

Bean Validation can still validate shape:

```java
public final class ApproveCaseRequest {
    @NotNull
    private UUID caseId;

    @Size(max = 4000)
    private String remarks;
}
```

---

## 20. Class-Level Constraint vs Workflow Guard

Bad:

```java
@CanTransitionFromDraftToSubmitted
public final class SubmitCaseRequest {
    private UUID caseId;
}
```

Why bad?

Because object alone does not contain the current case state, pending tasks, missing documents, actor, locks, concurrent update state, etc.

Better:

```java
workflowGuard.assertCanTransition(
        caseSnapshot,
        CaseAction.SUBMIT,
        actor,
        commandContext
);
```

Bean Validation remains useful before workflow guard:

```java
public final class SubmitCaseRequest {
    @NotNull
    private UUID caseId;

    @NotNull
    private Boolean declarationAccepted;
}
```

And class-level constraint might still check:

```text
if submissionMode = REPRESENTATIVE, representativeDeclarationAccepted must be true
```

Only if all required information is inside request object.

---

## 21. Designing Error Codes for Class-Level Rules

Human message is not enough.

Bad API response:

```json
{
  "message": "invalid applicant identifier"
}
```

Better:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "violations": [
    {
      "path": "uen",
      "code": "APPLICANT_UEN_REQUIRED_FOR_COMPANY",
      "message": "UEN is required for company applicant",
      "constraint": "ValidApplicantIdentifier"
    }
  ]
}
```

For class-level rule, stable code matters even more because the annotation name is often too generic.

Example:

```java
@ValidApplicantIdentifier
```

can emit:

```text
APPLICANT_UEN_REQUIRED_FOR_COMPANY
APPLICANT_NRIC_REQUIRED_FOR_INDIVIDUAL
APPLICANT_IDENTIFIER_CONFLICT
```

One annotation can produce multiple machine-readable reasons.

Bean Validation `message` can hold a message key:

```java
String message() default "{applicant.identifier.invalid}";
```

But for multiple error codes, you may need:

- message templates per branch;
- custom payload metadata;
- annotation-specific mapping in API error mapper;
- explicit custom validator result model outside Bean Validation for complex rules.

---

## 22. Message Template Strategy

Instead of:

```java
context.buildConstraintViolationWithTemplate("UEN is required for company applicant")
```

Prefer:

```java
context.buildConstraintViolationWithTemplate("{applicant.uen.requiredForCompany}")
```

Then in `ValidationMessages.properties`:

```properties
applicant.uen.requiredForCompany=UEN is required for company applicant.
applicant.nric.requiredForIndividual=NRIC is required for individual applicant.
period.endDate.beforeStartDate=End date must not be before start date.
```

Benefits:

- localization;
- consistent wording;
- easier UI mapping;
- less duplication;
- less risk of leaking internal detail.

But do not confuse message key with stable error code. A message key is often presentation-oriented. A code is contract-oriented.

Recommended response model:

```json
{
  "path": "endDate",
  "code": "PERIOD_END_BEFORE_START",
  "message": "End date must not be before start date.",
  "messageKey": "period.endDate.beforeStartDate",
  "constraint": "ValidDateRange"
}
```

---

## 23. Cross-Field Validator Should Not Mutate Object

Bad:

```java
@Override
public boolean isValid(ApplicantRequest value, ConstraintValidatorContext context) {
    if (value.getApplicantType() == ApplicantType.COMPANY) {
        value.setNric(null); // bad
    }
    return true;
}
```

Why bad?

- validation becomes hidden normalization;
- order-dependent behavior;
- hard to test;
- surprises calling code;
- thread-safety risk if object reused;
- violates expectation that validation only observes.

Better:

- normalize before validation in explicit mapper;
- reject ambiguous object;
- transform command into domain object after validation.

Correct flow:

```text
raw request
  -> parse/deserialization
  -> normalization/sanitization where explicit
  -> Bean Validation
  -> command/domain validation
  -> domain construction
  -> persistence
```

---

## 24. Cross-Field Validator Should Usually Not Call Database

Tempting example:

```text
If countryCode and postalCode are present, verify combination exists in DB.
```

Validator:

```java
public final class ValidPostalCodeCountryValidator
        implements ConstraintValidator<ValidPostalCodeCountry, AddressRequest> {

    private final PostalCodeRepository repository;

    @Override
    public boolean isValid(AddressRequest value, ConstraintValidatorContext context) {
        return repository.exists(value.getCountryCode(), value.getPostalCode());
    }
}
```

This can work technically with Spring/CDI injection, but architecturally risky.

Problems:

- validation now does I/O;
- performance unpredictable;
- batch validation becomes N+1 query;
- validator result can be stale;
- race condition still possible;
- transaction context may be unclear;
- error handling is awkward;
- validator becomes hard to reuse in Java SE/test context.

Better layering:

```text
Bean Validation:
  countryCode format
  postalCode format
  local consistency

Application validation:
  postal code exists in reference data
  country/postal mapping is recognized

Database/integration:
  FK/reference constraint if persisted
```

Exception: For some enterprise apps, injected validators are acceptable for read-only reference checks. If used, apply strict rules:

- read-only only;
- timeout-aware;
- cached/reference data preferred;
- no mutation;
- no remote service call if avoidable;
- batch-aware;
- deterministic error mapping;
- measured latency.

---

## 25. Type-Specific Validator vs Object Validator

For generic class-level annotation:

```java
@ValidDateRange(start = "from", end = "to")
```

validator type is often:

```java
ConstraintValidator<ValidDateRange, Object>
```

For domain-specific annotation:

```java
@ValidApplicantIdentifier
```

validator type should be:

```java
ConstraintValidator<ValidApplicantIdentifier, ApplicantRequest>
```

Prefer type-specific validators when possible.

Benefits:

- compile-time safety;
- no reflection;
- clearer code;
- easier tests;
- safer refactoring;
- better IDE support.

Use generic `Object` validators only for stable reusable rules where field names are annotation attributes.

---

## 26. Records and Class-Level Constraints

Java records work well with class-level constraints.

Example:

```java
@ValidDateRange(start = "startDate", end = "endDate")
public record PeriodRequest(
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate
) {}
```

Type-specific validator:

```java
public final class PeriodRequestValidator
        implements ConstraintValidator<ValidPeriodRequest, PeriodRequest> {

    @Override
    public boolean isValid(PeriodRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        if (value.startDate() == null || value.endDate() == null) {
            return true;
        }
        return !value.startDate().isAfter(value.endDate());
    }
}
```

Records make invalid state harder to mutate after construction, but they do not automatically prevent invalid construction.

You still choose validation location:

1. Validate DTO after deserialization.
2. Validate inside compact constructor manually.
3. Convert validated DTO into domain value object.
4. Use domain constructor invariant for true business object.

Important distinction:

```text
Bean Validation is normally invoked by framework/runtime.
Record constructor validation is explicit/manual unless framework supports executable validation during construction.
```

---

## 27. Sealed Classes and Polymorphic Cross-Field Validation

Modern Java can model state-specific shape better than many conditional validators.

Instead of:

```java
public final class ApplicantRequest {
    private ApplicantType type;
    private String nric;
    private String uen;
}
```

Java 17+ domain model:

```java
public sealed interface Applicant permits IndividualApplicant, CompanyApplicant {
}

public record IndividualApplicant(
        @NotBlank String nric
) implements Applicant {
}

public record CompanyApplicant(
        @NotBlank String uen
) implements Applicant {
}
```

This removes conditional requiredness from the model.

Now invalid combinations are structurally impossible:

```text
CompanyApplicant cannot forget uen without violating its own constructor/validation.
IndividualApplicant does not even have uen.
```

For API DTO, you may still need polymorphic deserialization:

```json
{
  "type": "COMPANY",
  "uen": "202012345A"
}
```

But downstream domain can become cleaner.

Top-tier design principle:

```text
Prefer type design that makes invalid states unrepresentable.
Use validation when invalid states are still representable at boundaries.
```

---

## 28. Builder Pattern and Cross-Field Validation

Builder can hide invalid intermediate state.

```java
Period period = Period.builder()
        .startDate(LocalDate.of(2026, 1, 10))
        .endDate(LocalDate.of(2026, 1, 1))
        .build();
```

Options:

### 28.1 Validate in `build()` manually

```java
public Period build() {
    Period period = new Period(startDate, endDate);
    if (period.startDate.isAfter(period.endDate)) {
        throw new IllegalArgumentException("startDate must not be after endDate");
    }
    return period;
}
```

### 28.2 Use Bean Validation in `build()`

```java
public Period build() {
    Period period = new Period(startDate, endDate);
    Set<ConstraintViolation<Period>> violations = validator.validate(period);
    if (!violations.isEmpty()) {
        throw new ConstraintViolationException(violations);
    }
    return period;
}
```

Be careful injecting global `Validator` into domain builders. Usually manual invariant check is simpler for domain values.

### 28.3 Use separate DTO validation before domain construction

```text
Request DTO -> Bean Validation -> Domain factory -> Domain object
```

This is usually best for API boundaries.

---

## 29. Cross-Field Validation in REST APIs

Class-level validation result must become useful API errors.

Problem:

```java
@ValidApplicantIdentifier
public class ApplicantRequest { ... }
```

Default violation path might be object-level:

```text
applicantRequest: invalid applicant identifier
```

Frontend cannot easily map that to a field.

Better validator attaches to field:

```java
.addPropertyNode("uen")
```

Then API response:

```json
{
  "violations": [
    {
      "path": "applicant.uen",
      "code": "APPLICANT_UEN_REQUIRED_FOR_COMPANY",
      "message": "UEN is required for company applicant."
    }
  ]
}
```

For multi-field rule, include affected fields:

```json
{
  "path": "$",
  "code": "CONTACT_METHOD_REQUIRED",
  "message": "Either email or mobileNumber is required.",
  "fields": ["email", "mobileNumber"]
}
```

Do not force every class-level violation to pretend one field is wrong. That produces misleading UX.

---

## 30. Class-Level Validation in JPA Entities

Technically possible:

```java
@ValidDateRange(start = "validFrom", end = "validTo")
@Entity
public class LicenseEntity {
    private LocalDate validFrom;
    private LocalDate validTo;
}
```

But be careful.

Entity validation can occur during lifecycle events depending on JPA integration. Risks:

- lazy-loaded associations accidentally traversed;
- persistence operation fails late;
- error response less friendly;
- entity has persistence concerns, not API concerns;
- cross-field rule may differ between draft/update/submit.

Good entity-level candidates:

- stable invariant that must always hold;
- no external dependency;
- no actor/context;
- no operation-specific variation.

Examples:

```text
validFrom <= validTo
amount >= 0
currency not null
```

Poor candidates:

```text
field required only during submit
current user can approve
case can transition
external reference exists
```

---

## 31. Cross-Field Validation and Partial Update/PATCH

PATCH is a trap.

Suppose existing entity:

```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-01-31"
}
```

PATCH request:

```json
{
  "startDate": "2026-02-01"
}
```

If DTO only contains `startDate`, class-level validation cannot know new effective end date unless you merge with existing state first.

Two strategies:

### 31.1 Validate patch shape only

```java
public final class PatchPeriodRequest {
    private PatchField<LocalDate> startDate;
    private PatchField<LocalDate> endDate;
}
```

Bean Validation checks only patch syntax.

Then service merges:

```text
existing + patch -> candidate aggregate -> validate candidate invariant
```

### 31.2 Merge then validate full command

```java
PeriodCandidate candidate = patchApplier.apply(existing, patch);
validator.validate(candidate);
```

This is often cleaner.

Important principle:

```text
Cross-field validation requires a complete enough object snapshot.
PATCH DTO is often not complete enough.
```

---

## 32. Cross-Field Validation and Import/Batch Processing

In batch import, class-level validation must produce row-aware errors.

Example CSV:

```csv
row,applicantType,nric,uen
1,COMPANY,,202012345A
2,COMPANY,S1234567D,
3,INDIVIDUAL,,
```

Bean Validation can validate row DTO:

```java
@ValidApplicantIdentifier
public final class ApplicantImportRow {
    private int rowNumber;
    private ApplicantType applicantType;
    private String nric;
    private String uen;
}
```

But API/report layer must add row context:

```json
{
  "row": 2,
  "path": "uen",
  "code": "APPLICANT_UEN_REQUIRED_FOR_COMPANY"
}
```

Do not put `rowNumber` into the violation message inside the constraint. Keep validator generic and let import error mapper enrich with row metadata.

---

## 33. Cross-Field Validation and Frontend Forms

Frontend often wants to know:

```text
Which field should show red border?
Which message appears under which field?
Which fields are jointly invalid?
```

Backend class-level validation should support this by emitting stable path/code.

Examples:

| Rule | Suggested Path | Affected Fields |
|---|---|---|
| end before start | `endDate` | `startDate`, `endDate` |
| at least one contact | `$` | `email`, `mobileNumber` |
| UEN required for company | `uen` | `applicantType`, `uen` |
| mutually exclusive document source | `$` or one offending field | `existingDocumentId`, `uploadedFile` |
| approved > requested | `approvedAmount` | `requestedAmount`, `approvedAmount` |

A strong API error model might include both:

```json
{
  "path": "approvedAmount",
  "code": "APPROVED_AMOUNT_EXCEEDS_REQUESTED_AMOUNT",
  "message": "Approved amount must not exceed requested amount.",
  "affectedFields": ["requestedAmount", "approvedAmount"]
}
```

---

## 34. Anti-Pattern: One Mega Class-Level Validator

Bad:

```java
@ValidCaseSubmission
public final class CaseSubmissionRequest {
    // 80 fields
}
```

Validator:

```java
public boolean isValid(CaseSubmissionRequest value, ConstraintValidatorContext context) {
    // 700 lines of if/else
}
```

Problems:

- impossible to reason about;
- hard to test;
- poor error governance;
- hidden workflow;
- merge conflicts;
- no rule ownership;
- no rule versioning;
- impossible to selectively enforce;
- poor observability.

Better:

- smaller constraints for stable structural consistency;
- command validator for operation-specific rules;
- domain policy for business decisions;
- workflow guard for state transitions;
- rule catalog for regulatory defensibility.

Example decomposition:

```java
@ValidApplicantIdentifier
@ValidRepresentativeInformation
@ValidDocumentSource
@ValidSubmissionPeriod
public final class CaseSubmissionRequest {
    ...
}
```

Then higher-level submit policy:

```java
SubmitCasePolicy.evaluate(command, actor, caseSnapshot, ruleVersion);
```

---

## 35. Anti-Pattern: Encoding Business Process in Annotation Attributes

Bad:

```java
@ValidConditionalRequired(
    whenField = "caseType",
    whenValue = "COMPLIANCE",
    requiredField = "inspectionReport",
    exceptWhenField = "channel",
    exceptWhenValue = "MIGRATION",
    onlyForStatus = "PENDING_APPROVAL",
    onlyForRole = "SENIOR_OFFICER"
)
```

This is not elegant. It is a mini rule engine hidden inside an annotation.

Problems:

- stringly typed;
- hard to refactor;
- hard to test;
- hard to explain;
- poor IDE support;
- no audit trail;
- no rule versioning;
- no dependency modeling.

Better:

```java
CaseSubmissionPolicy policy = policyRegistry.get(CaseType.COMPLIANCE, ruleVersion);
ValidationResult result = policy.evaluate(command, actor, caseSnapshot);
```

Use Bean Validation for stable local shape. Use policy objects for contextual rules.

---

## 36. Anti-Pattern: Returning False Without Custom Path

Bad:

```java
@Override
public boolean isValid(ApplicantRequest value, ConstraintValidatorContext context) {
    return value.getUen() != null;
}
```

Result:

```text
ApplicantRequest: invalid applicant identifier
```

Frontend cannot map it.

Better:

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("{applicant.uen.requiredForCompany}")
        .addPropertyNode("uen")
        .addConstraintViolation();
return false;
```

Production validator must think about the consumer of error output.

---

## 37. Anti-Pattern: Duplicating Field-Level Errors

Bad:

```java
if (value.getStartDate() == null) {
    addViolation(context, "startDate", "startDate required");
    return false;
}
```

If field already has:

```java
@NotNull
private LocalDate startDate;
```

Then you get duplicate responsibility.

Better:

```java
if (value.getStartDate() == null || value.getEndDate() == null) {
    return true;
}
```

Let field-level constraints report missing values.

---

## 38. Anti-Pattern: Checking Format Again in Class-Level Validator

Bad:

```java
if (!value.getUen().matches("...")) {
    addViolation(context, "uen", "invalid UEN format");
}
```

If `uen` already has:

```java
@ValidUen
private String uen;
```

Do not duplicate format check inside class-level validator.

Class-level validator should check relationship, not field format.

Correct split:

```java
@ValidApplicantIdentifier
public final class ApplicantRequest {

    @ValidUen
    private String uen;

    @ValidNric
    private String nric;
}
```

`@ValidApplicantIdentifier` checks which identifier should exist.

`@ValidUen` checks UEN syntax.

`@ValidNric` checks NRIC syntax.

---

## 39. Testing Class-Level Validators

Test at two levels:

1. Direct validator unit test.
2. Jakarta Validation integration test.

### 39.1 Integration test example

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

final class DateRangeRequestValidationTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    @Test
    void shouldRejectEndDateBeforeStartDate() {
        DateRangeRequest request = new DateRangeRequest(
                LocalDate.of(2026, 1, 10),
                LocalDate.of(2026, 1, 1)
        );

        Set<ConstraintViolation<DateRangeRequest>> violations = validator.validate(request);

        assertThat(violations).anySatisfy(violation -> {
            assertThat(violation.getPropertyPath().toString()).isEqualTo("endDate");
            assertThat(violation.getMessage()).contains("startDate");
        });
    }
}
```

### 39.2 Test matrix for date range

| start | end | Expected |
|---|---|---|
| null | null | field-level errors only if `@NotNull` present |
| null | date | start required if `@NotNull` |
| date | null | end required if `@NotNull` |
| 2026-01-01 | 2026-01-01 | valid if equal allowed |
| 2026-01-01 | 2026-01-02 | valid |
| 2026-01-02 | 2026-01-01 | invalid |

### 39.3 Test matrix for conditional requiredness

| applicantType | nric | uen | Expected |
|---|---|---|---|
| null | null | null | applicantType field-level error |
| COMPANY | null | null | uen required |
| COMPANY | present | null | uen required, maybe nric conflict depending rule |
| COMPANY | null | present | valid |
| INDIVIDUAL | null | null | nric required |
| INDIVIDUAL | present | null | valid |
| INDIVIDUAL | present | present | maybe conflict depending rule |

Test not only pass/fail. Test:

- property path;
- message key;
- number of violations;
- group behavior;
- null behavior;
- multiple violation behavior.

---

## 40. Property-Based Testing for Cross-Field Rules

For date range, property-based testing can generate random dates.

Invariant:

```text
If start <= end, validation should pass.
If start > end, validation should fail.
```

Pseudo-code:

```java
@Property
void dateRangeInvariant(@ForAll LocalDate start, @ForAll LocalDate end) {
    DateRangeRequest request = new DateRangeRequest(start, end);
    boolean valid = validator.validate(request).isEmpty();

    assertThat(valid).isEqualTo(!start.isAfter(end));
}
```

Useful for:

- numeric boundaries;
- date ranges;
- conditional combinations;
- mutually exclusive fields;
- at-least-one fields.

Property-based testing is especially valuable when a validator has many branch combinations.

---

## 41. Performance Considerations

Class-level validators can become expensive if careless.

Cost drivers:

- reflection property access;
- regex inside cross-field validator;
- multiple violations allocation;
- nested path building;
- DB/service calls;
- large object graphs;
- repeated validation in hot path;
- validation per row in batch import.

Guidelines:

1. Prefer type-specific validator for hot paths.
2. Avoid reflection if called heavily.
3. Do not call external services.
4. Cache immutable parsed annotation config in `initialize()`.
5. Avoid compiling regex on every `isValid()` call.
6. Use group sequence to avoid expensive consistency checks after basic failure.
7. Measure validation latency if used in bulk import or high-throughput API.

Example:

```java
private Pattern pattern;

@Override
public void initialize(MyConstraint annotation) {
    this.pattern = Pattern.compile(annotation.regexp());
}
```

Not:

```java
Pattern.compile(annotation.regexp()).matcher(value).matches();
```

inside every `isValid()`.

---

## 42. Thread-Safety Considerations

`ConstraintValidator` instances may be reused by provider.

Therefore:

- treat validator fields as immutable after `initialize()`;
- do not store per-request state in validator fields;
- do not store last invalid object;
- do not keep mutable buffers shared across calls;
- dependency injected services must be thread-safe or used safely.

Bad:

```java
private String lastInvalidProperty;

@Override
public boolean isValid(Request value, ConstraintValidatorContext context) {
    this.lastInvalidProperty = "endDate";
    return false;
}
```

Good:

```java
@Override
public boolean isValid(Request value, ConstraintValidatorContext context) {
    String invalidProperty = "endDate";
    addViolation(context, invalidProperty);
    return false;
}
```

---

## 43. Java 8 to Java 25 Notes

### Java 8

- Bean Validation 2.0 aligns well with Java 8 features.
- `java.time` types are supported by built-in temporal constraints.
- Type-use constraints and container element constraints become important.
- No records/sealed classes; DTOs are class-based.

### Java 11

- Similar validation model.
- Often used with Spring Boot 2.x and `javax.validation`.
- Migration planning toward Jakarta must be explicit.

### Java 17

- Baseline for many modern Jakarta stacks.
- Records and sealed classes become viable modeling tools.
- Jakarta Validation 3.1 minimum Java version is 17 according to the Bean Validation/Jakarta Validation project announcement.

### Java 21

- Common modern LTS target.
- Records, sealed classes, pattern matching style, and virtual threads change application architecture but not the core validation API.
- Validation should remain CPU-local and avoid blocking I/O in validators, especially in virtual-thread-heavy systems where blocking becomes easy to hide.

### Java 25

- Modern target for new systems.
- Prefer stronger type modeling for domain object construction.
- Use validation mostly at boundaries and integration points.
- Avoid carrying legacy `javax.validation` into modern `jakarta.validation` stacks.

---

## 44. `javax.validation` vs `jakarta.validation` Code Variants

For Java 8 / Bean Validation 2.0 / older Spring Boot 2:

```java
import javax.validation.Constraint;
import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import javax.validation.Payload;
```

For Jakarta Validation 3.x / Spring Boot 3 / Jakarta EE 10/11:

```java
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
```

Do not mix both namespaces in the same runtime model.

Common migration failure:

```java
// DTO annotation from javax.validation
import javax.validation.constraints.NotNull;

// Runtime validator from jakarta.validation
import jakarta.validation.Validator;
```

The Jakarta runtime will not treat `javax.validation.constraints.NotNull` as the same annotation. Mixed namespace can silently break validation coverage.

---

## 45. Design Checklist for Class-Level Constraint

Before creating a class-level constraint, ask:

1. Does this rule need more than one field?
2. Does the object itself contain all data needed?
3. Is the rule stable across operations?
4. Is the rule free from actor/role/permission context?
5. Is the rule free from workflow state?
6. Is the rule free from database/external service lookup?
7. Can the violation be mapped to a clear path/code?
8. Does it duplicate field-level validation?
9. Is the annotation name domain-clear?
10. Is the validator small enough to test easily?

If many answers are “no”, use command/domain/workflow validation instead.

---

## 46. PR Review Checklist

When reviewing class-level validation code, check:

- [ ] Annotation target includes `ElementType.TYPE`.
- [ ] Annotation has `message`, `groups`, `payload`.
- [ ] Validator returns `true` for null bean unless intentionally different.
- [ ] Validator does not duplicate `@NotNull`/field-level errors.
- [ ] Validator does not mutate object.
- [ ] Validator does not call DB/remote service unless explicitly justified.
- [ ] Validator uses custom property path when field mapping is needed.
- [ ] `disableDefaultConstraintViolation()` is used when adding custom violations.
- [ ] Multiple violations are intentional and tested.
- [ ] Error messages use message keys where appropriate.
- [ ] API error mapper produces stable codes.
- [ ] Tests assert property path, not only violation count.
- [ ] Migration namespace is consistent: all `javax` or all `jakarta`.
- [ ] Rule does not hide authorization/workflow logic.

---

## 47. Production Pattern Summary

Recommended split:

```text
Field-level constraints:
  Single-value shape and format

Class-level constraints:
  Local object consistency

Validation groups:
  Operation-specific subset of validation

Command validators:
  Contextual operation rules

Domain policies:
  Business decisions requiring domain state

Workflow guards:
  State transition legality

Database constraints:
  Final transactional consistency

API error mapper:
  Stable machine-readable contract
```

Class-level validation is powerful because it lets you express object consistency declaratively. But it is dangerous when it becomes a hidden procedural rule engine.

---

## 48. Mini Case Study: Case Submission Request

Suppose we have this request:

```java
@ValidApplicantIdentifier(groups = Submit.class)
@ValidSubmissionPeriod(groups = Submit.class)
@ExactlyOnePrimaryDocument(groups = Submit.class)
public final class SubmitApplicationRequest {

    @NotNull(groups = Submit.class)
    private ApplicantType applicantType;

    private String nric;

    private String uen;

    @NotNull(groups = Submit.class)
    private LocalDate requestedStartDate;

    @NotNull(groups = Submit.class)
    private LocalDate requestedEndDate;

    private UUID existingDocumentId;

    private FileUpload newDocument;
}
```

Bean Validation handles:

```text
- applicantType required
- if company, uen required
- if individual, nric required
- requestedStartDate <= requestedEndDate
- exactly one document source
```

But it should not handle:

```text
- actor can submit this application
- case is in DRAFT state
- applicant has no duplicate active case
- document is virus-scanned
- requested period does not violate agency policy
- officer assignment is valid
- SLA timer transition is allowed
```

Those belong to application service, workflow guard, domain policy, database, or integration layer.

This separation makes validation explainable, testable, and defensible.

---

## 49. Common Interview-Level Distinction

A strong engineer says:

```text
I use class-level Bean Validation for stable intra-object invariants,
not for contextual business decisions.
```

A weaker implementation often says:

```text
We put all submit rules into one @ValidSubmission annotation.
```

The second approach might work initially, but it decays quickly as rules grow.

Top-tier validation architecture is not about using annotations everywhere. It is about placing each rule at the layer where it has enough information, correct ownership, and enforceable guarantees.

---

## 50. Key Takeaways

1. Field-level validation checks one value; class-level validation checks object consistency.
2. Class-level constraints are ideal for date ranges, conditional requiredness, mutually exclusive fields, and local compatibility rules.
3. Use custom property paths so API/FE consumers can map errors correctly.
4. Let field-level constraints handle null/format; let class-level constraints handle relationships.
5. Do not mutate objects inside validators.
6. Avoid database and remote service calls inside validators unless carefully justified.
7. Do not encode authorization or workflow transitions in Bean Validation annotations.
8. For complex contextual rules, use command validators, domain policies, workflow guards, and database constraints.
9. Test property path, message/code, null behavior, group behavior, and edge combinations.
10. Prefer stronger type modeling in Java 17+ when it can make invalid states unrepresentable.

---

## 51. Latihan

### Latihan 1 — Date Range

Buat annotation:

```java
@ValidPeriod(start = "from", end = "to", allowEqual = false)
```

Requirements:

- works on class-level;
- supports `LocalDate`;
- if either field null, return valid;
- if invalid, attach violation to end field;
- test equal allowed vs not allowed.

### Latihan 2 — Conditional Requiredness

Buat validator untuk:

```text
If paymentMode = BANK_TRANSFER, bankAccountNumber is required.
If paymentMode = CHEQUE, chequePayeeName is required.
If paymentMode = CASH, neither bankAccountNumber nor chequePayeeName should be supplied.
```

Pastikan menghasilkan path yang benar.

### Latihan 3 — Exactly One Field

Buat annotation:

```java
@ExactlyOneOf({"existingDocumentId", "newFile"})
```

Kemudian evaluasi apakah generic reflection validator lebih baik daripada type-specific validator untuk kasus ini.

### Latihan 4 — Refactor Mega Validator

Ambil satu contoh validator besar imajiner:

```java
@ValidCaseSubmission
```

Pecah menjadi:

- field constraints;
- class-level constraints;
- command validator;
- workflow guard;
- DB constraint.

Tuliskan alasan pemindahan rule per layer.

---

## 52. Penutup

Class-level validation adalah alat yang sangat berguna untuk menjaga konsistensi object di boundary sistem. Namun kekuatannya juga menjadi sumber masalah jika dipakai untuk menampung semua rule yang “tidak muat” di field-level constraint.

Prinsip paling penting:

```text
Gunakan class-level validation untuk rule yang bisa diputuskan dari satu object snapshot.
Jika rule membutuhkan actor, workflow state, database, policy version, atau external system,
rule tersebut bukan lagi sekadar class-level validation.
```

Dengan pemisahan ini, sistem validation menjadi lebih jelas, lebih mudah dites, lebih aman dimigrasikan, dan lebih defensible saat rule bisnis berubah.

---

## Status Seri

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

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-011.md
```

Topik berikutnya:

```text
Cross-Parameter and Executable Validation: Methods, Constructors, Return Values
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-009](./learn-java-validation-jakarta-hibernate-validator-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-011](./learn-java-validation-jakarta-hibernate-validator-part-011.md)

</div>
# learn-java-validation-jakarta-hibernate-validator-part-009

# Custom Constraint Design: Annotation, Validator, Message, Target, Repeatable

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `009`  
> Topik: Custom constraint design pada Java Validation, Jakarta Validation, dan Hibernate Validator  
> Target Java: Java 8 sampai Java 25  
> Namespace: `javax.validation` untuk legacy Bean Validation 2.0 dan `jakarta.validation` untuk Jakarta Validation 3.x  

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

1. validation sebagai contract dan boundary defense;
2. landscape spesifikasi Bean Validation/Jakarta Validation;
3. API inti seperti `ValidatorFactory`, `Validator`, `ConstraintViolation`, `Path`, dan metadata;
4. built-in constraints;
5. nullability strategy;
6. cascaded validation;
7. container element constraints;
8. validation groups dan group sequence.

Part ini mulai masuk ke area yang biasanya membedakan engineer yang sekadar memakai annotation dengan engineer yang mampu membangun validation system yang rapi, reusable, testable, dan defensible.

Kita akan membahas **custom constraint**.

Custom constraint adalah cara membuat annotation validasi sendiri, misalnya:

```java
@SingaporePostalCode
private String postalCode;

@ValidCaseReference
private String caseReferenceNumber;

@ValidDateRange
private DateRange period;

@AllowedTransition(from = DRAFT, to = SUBMITTED)
private CaseTransition transition;
```

Namun custom constraint adalah pisau bermata dua.

Ia bisa membuat model lebih ekspresif, tetapi juga bisa menjadi tempat tersembunyi bagi business rule yang terlalu kompleks, query database yang lambat, workflow logic yang susah dilacak, dan error contract yang rapuh.

Tujuan part ini bukan hanya agar kamu bisa menulis `@Constraint(validatedBy = ...)`, tetapi agar kamu punya mental model untuk menjawab:

- rule ini pantas menjadi annotation atau tidak?
- constraint ini sebaiknya field-level, class-level, cross-parameter, atau domain policy biasa?
- validator ini harus pure atau boleh inject dependency?
- violation harus ditempelkan ke field mana?
- bagaimana menjaga validator thread-safe?
- bagaimana membuat custom constraint tetap kompatibel Java 8 sampai Java 25?
- bagaimana membuat error response yang machine-readable, bukan cuma string?

---

## 1. Mental Model: Custom Constraint adalah Declarative Contract, Bukan Mini Service Layer

Custom constraint sebaiknya dianggap sebagai **declarative contract**.

Artinya annotation menyatakan fakta tentang bentuk, format, atau invariant lokal dari suatu nilai/object.

Contoh bagus:

```java
@CaseReferenceNumber
private String referenceNo;
```

Maknanya jelas:

> Nilai ini harus berbentuk nomor referensi case yang valid menurut format sistem.

Contoh yang mulai berbahaya:

```java
@CanSubmitApplication
private Application application;
```

Masalahnya, “can submit” biasanya tergantung pada:

- status workflow;
- role actor;
- outstanding document;
- SLA;
- payment;
- lock state;
- feature flag;
- agency policy;
- approval hierarchy;
- data dari sistem lain.

Itu bukan invariant lokal. Itu contextual business decision.

Custom constraint cocok untuk:

- syntactic rule;
- local semantic rule;
- intra-object consistency;
- reusable domain value validation;
- stable rule yang jarang berubah;
- rule yang bisa dijelaskan tanpa melihat banyak external state.

Custom constraint kurang cocok untuk:

- authorization;
- workflow transition;
- external system check;
- database uniqueness final decision;
- rule yang sering berubah per tenant/channel/agency;
- rule yang butuh audit/evidence kompleks;
- rule yang butuh transaction consistency.

Rule of thumb:

> Jika rule bisa dijelaskan dari nilai yang sedang divalidasi dan sedikit configuration statis, custom constraint mungkin cocok. Jika rule butuh konteks runtime besar, actor, database, workflow state, atau policy version, pertimbangkan domain validator/policy object, bukan annotation.

---

## 2. Anatomy Custom Constraint

Custom constraint biasanya terdiri dari tiga bagian:

1. annotation;
2. validator implementation;
3. message/template/error code strategy.

Contoh minimal:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.ANNOTATION_TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = CaseReferenceNumberValidator.class)
@Target({ FIELD, METHOD, PARAMETER, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface CaseReferenceNumber {

    String message() default "{validation.caseReferenceNumber.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.regex.Pattern;

public final class CaseReferenceNumberValidator
        implements ConstraintValidator<CaseReferenceNumber, String> {

    private static final Pattern PATTERN =
            Pattern.compile("^[A-Z]{3}-\\d{4}-\\d{6}$");

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
public class CaseLookupRequest {

    @CaseReferenceNumber
    private String referenceNo;
}
```

Kalau required:

```java
public class CaseLookupRequest {

    @NotNull
    @CaseReferenceNumber
    private String referenceNo;
}
```

Kenapa `null` dianggap valid oleh custom constraint di atas?

Karena convention Bean/Jakarta Validation adalah constraint format biasanya tidak menentukan requiredness. Requiredness dinyatakan eksplisit dengan `@NotNull`, `@NotBlank`, atau constraint khusus required. Ini membuat constraints composable.

---

## 3. Mandatory Annotation Members: `message`, `groups`, `payload`

Setiap custom constraint yang mengikuti spesifikasi harus menyediakan tiga member ini:

```java
String message() default "...";

Class<?>[] groups() default {};

Class<? extends Payload>[] payload() default {};
```

### 3.1 `message`

`message` adalah template pesan default.

Contoh:

```java
String message() default "{validation.caseReferenceNumber.invalid}";
```

Lebih baik memakai key daripada hardcoded text:

```java
"{validation.caseReferenceNumber.invalid}"
```

daripada:

```java
"Case reference number is invalid"
```

Alasannya:

- mendukung i18n;
- message bisa diganti tanpa compile ulang;
- error code bisa distabilkan;
- API response bisa memisahkan machine code dan human message;
- governance lebih mudah.

### 3.2 `groups`

`groups` memungkinkan constraint hanya aktif pada validation group tertentu.

Contoh:

```java
@CaseReferenceNumber(groups = Search.class)
private String referenceNo;
```

Namun jangan membuat custom constraint yang terlalu bergantung pada banyak group. Jika annotation hanya valid dalam satu operasi tertentu, kadang DTO/command type terpisah lebih jelas.

### 3.3 `payload`

`payload` jarang dipakai, tetapi berguna untuk metadata tambahan.

Contoh severity:

```java
public final class Severity {
    private Severity() {}

    public interface Warning extends Payload {}
    public interface Error extends Payload {}
}
```

Usage:

```java
@CaseReferenceNumber(payload = Severity.Error.class)
private String referenceNo;
```

Payload dapat dibaca dari `ConstraintDescriptor` pada `ConstraintViolation`.

Namun payload bukan tempat menaruh runtime data. Payload adalah type-level metadata, bukan context object.

---

## 4. `@Constraint(validatedBy = ...)`

Annotation `@Constraint` menghubungkan constraint annotation ke validator class.

```java
@Constraint(validatedBy = CaseReferenceNumberValidator.class)
```

Bisa satu validator:

```java
@Constraint(validatedBy = SingaporePostalCodeValidator.class)
```

Bisa banyak validator untuk type berbeda:

```java
@Constraint(validatedBy = {
    UenStringValidator.class,
    UenValueObjectValidator.class
})
```

Contoh:

```java
public final class UenStringValidator
        implements ConstraintValidator<ValidUen, String> {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return UenFormat.isValid(value);
    }
}
```

```java
public final class UenValueObjectValidator
        implements ConstraintValidator<ValidUen, Uen> {
    @Override
    public boolean isValid(Uen value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return UenFormat.isValid(value.value());
    }
}
```

Provider akan memilih validator berdasarkan type nilai yang divalidasi.

Design caution:

- jangan membuat terlalu banyak validator untuk type yang ambigu;
- pastikan generic type tepat;
- hindari validator terlalu generic seperti `Object` kecuali benar-benar perlu;
- test semua target type.

---

## 5. `@Target`: Constraint Bisa Dipasang di Mana?

Annotation Java membutuhkan `@Target`.

Target menentukan tempat annotation boleh dipasang.

Umum untuk field/property/parameter:

```java
@Target({ FIELD, METHOD, PARAMETER, ANNOTATION_TYPE })
```

Untuk class-level constraint:

```java
@Target({ TYPE, ANNOTATION_TYPE })
```

Untuk constructor:

```java
@Target({ CONSTRUCTOR })
```

Untuk method return value:

```java
@Target({ METHOD })
```

Untuk type-use constraints:

```java
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
```

Contoh type-use:

```java
List<@CaseReferenceNumber String> caseReferences;
```

Kalau ingin constraint bisa dipakai pada type argument seperti `List<@MyConstraint String>`, target harus menyertakan `TYPE_USE`.

Untuk Java 8+, `TYPE_USE` sangat penting karena Bean Validation 2.0 memperkenalkan container element constraints.

---

## 6. `@Retention(RUNTIME)` Wajib

Constraint annotation harus tersedia saat runtime.

```java
@Retention(RUNTIME)
```

Tanpa ini, validation provider tidak bisa membaca annotation.

Kesalahan umum:

```java
@Retention(CLASS)
```

atau lupa `@Retention`.

Akibatnya constraint tidak jalan, dan debugging-nya bisa membuang waktu.

---

## 7. `@Documented`

`@Documented` bukan syarat teknis utama, tetapi bagus untuk API documentation.

```java
@Documented
```

Dengan ini, constraint muncul pada Javadoc element yang dianotasi.

Dalam enterprise codebase, ini membantu reviewer, maintainer, dan generator dokumentasi.

---

## 8. `ConstraintValidator<A, T>`

Interface utama validator:

```java
public interface ConstraintValidator<A extends Annotation, T> {
    default void initialize(A constraintAnnotation) {}
    boolean isValid(T value, ConstraintValidatorContext context);
}
```

Parameter generic:

- `A`: annotation type;
- `T`: value type yang divalidasi.

Contoh:

```java
public final class SingaporePostalCodeValidator
        implements ConstraintValidator<SingaporePostalCode, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return value.matches("^\\d{6}$");
    }
}
```

Namun untuk production, hindari `String.matches()` pada setiap call karena compile regex berulang.

Lebih baik:

```java
public final class SingaporePostalCodeValidator
        implements ConstraintValidator<SingaporePostalCode, String> {

    private static final Pattern POSTAL_CODE = Pattern.compile("^\\d{6}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return POSTAL_CODE.matcher(value).matches();
    }
}
```

---

## 9. `initialize()`: Membaca Attribute Annotation

Annotation bisa punya attribute.

Contoh:

```java
@ValidCaseReference(prefix = "ACE", yearDigits = 4)
private String referenceNo;
```

Annotation:

```java
@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface ValidCaseReference {

    String message() default "{validation.caseReference.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    String prefix();

    int yearDigits() default 4;
}
```

Validator:

```java
public final class CaseReferenceValidator
        implements ConstraintValidator<ValidCaseReference, String> {

    private Pattern pattern;

    @Override
    public void initialize(ValidCaseReference annotation) {
        String prefix = Pattern.quote(annotation.prefix());
        int yearDigits = annotation.yearDigits();

        this.pattern = Pattern.compile("^" + prefix + "-\\d{" + yearDigits + "}-\\d{6}$");
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return pattern.matcher(value).matches();
    }
}
```

`initialize()` cocok untuk:

- membaca annotation attribute;
- precompute regex;
- precompute static set;
- validate annotation configuration.

`initialize()` tidak cocok untuk:

- query database;
- membaca request context;
- memanggil remote service;
- menyimpan mutable per-request state.

---

## 10. Thread-Safety dan Lifecycle Validator

Validation provider boleh cache validator instance.

Artinya satu instance validator dapat dipakai berkali-kali dan mungkin oleh banyak thread.

Maka validator harus:

- thread-safe;
- tidak menyimpan per-request mutable state;
- tidak menyimpan value terakhir;
- tidak menyimpan `ConstraintValidatorContext`;
- tidak mengubah shared object tanpa sinkronisasi;
- dependency yang di-inject juga harus aman atau scoped dengan benar.

Salah:

```java
public final class BadValidator implements ConstraintValidator<MyConstraint, String> {

    private String lastValue;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        this.lastValue = value;
        return value != null;
    }
}
```

Benar:

```java
public final class GoodValidator implements ConstraintValidator<MyConstraint, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || !value.isBlank();
    }
}
```

State yang aman:

```java
private Pattern pattern;
```

Jika diset sekali di `initialize()` lalu hanya dibaca, itu aman secara desain selama object tidak dimutasi lagi.

---

## 11. Null Handling Convention

Custom constraint umumnya harus menganggap `null` valid.

Contoh:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null) {
        return true;
    }
    return isValidFormat(value);
}
```

Requiredness ditambahkan terpisah:

```java
@NotBlank
@CaseReferenceNumber
private String referenceNo;
```

Kenapa begitu?

Karena ini memungkinkan kombinasi:

```java
@CaseReferenceNumber
private String optionalReferenceNo;
```

untuk field optional tetapi jika ada harus valid.

Jika custom constraint juga menolak null, ia menjadi tidak composable.

Kapan boleh menolak null di custom constraint?

- constraint memang bernama required, misalnya `@RequiredCaseReference`;
- constraint mewakili invariant domain yang tidak boleh absent;
- desain tim secara eksplisit menetapkan constraint ini mencakup requiredness.

Namun default yang lebih aman:

> Format/semantic constraint menerima null. Requiredness constraint menolak null.

---

## 12. Naming Constraint: Nama Harus Mengungkap Semantik, Bukan Implementasi

Nama buruk:

```java
@RegexCheck
@StringFormat
@CheckValid
@ValidateField
@MyValidator
```

Nama baik:

```java
@CaseReferenceNumber
@SingaporePostalCode
@ValidDateRange
@BusinessRegistrationNumber
@AllowedDocumentType
@ValidPercentage
@ValidCurrencyAmount
```

Nama constraint sebaiknya menjawab:

- apa konsep domainnya?
- rule apa yang ingin dijaga?
- apakah ini format, invariant, atau relationship?

Bandingkan:

```java
@Pattern(regexp = "^[A-Z]{3}-\\d{4}-\\d{6}$")
private String referenceNo;
```

vs

```java
@CaseReferenceNumber
private String referenceNo;
```

Yang kedua lebih kuat karena:

- intention revealing;
- reusable;
- bisa diubah internal formatnya;
- message/error code lebih stabil;
- dokumentasi domain lebih jelas.

---

## 13. Attribute Design pada Constraint Annotation

Custom constraint bisa memiliki attribute.

Contoh:

```java
@AllowedValues({"DRAFT", "SUBMITTED", "APPROVED"})
private String status;
```

Annotation:

```java
@Documented
@Constraint(validatedBy = AllowedValuesValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface AllowedValues {

    String message() default "{validation.allowedValues.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    String[] value();

    boolean ignoreCase() default false;
}
```

Validator:

```java
public final class AllowedValuesValidator
        implements ConstraintValidator<AllowedValues, String> {

    private Set<String> allowed;
    private boolean ignoreCase;

    @Override
    public void initialize(AllowedValues annotation) {
        this.ignoreCase = annotation.ignoreCase();
        this.allowed = Arrays.stream(annotation.value())
                .map(v -> ignoreCase ? v.toLowerCase(Locale.ROOT) : v)
                .collect(Collectors.toUnmodifiableSet());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        String candidate = ignoreCase ? value.toLowerCase(Locale.ROOT) : value;
        return allowed.contains(candidate);
    }
}
```

Untuk Java 8, tidak ada `Collectors.toUnmodifiableSet()`.

Versi Java 8-compatible:

```java
@Override
public void initialize(AllowedValues annotation) {
    this.ignoreCase = annotation.ignoreCase();

    Set<String> values = Arrays.stream(annotation.value())
            .map(v -> ignoreCase ? v.toLowerCase(Locale.ROOT) : v)
            .collect(Collectors.toSet());

    this.allowed = Collections.unmodifiableSet(values);
}
```

Attribute design guideline:

- gunakan type sederhana: `String`, `int`, `boolean`, enum, class literal;
- hindari attribute yang terlalu kompleks;
- jangan taruh JSON/config besar di annotation;
- gunakan default yang aman;
- validasi konfigurasi annotation di `initialize()` bila perlu;
- jangan membuat annotation menjadi mini DSL yang sulit dipahami.

---

## 14. Repeatable Constraint

Kadang constraint yang sama perlu dipasang lebih dari sekali dengan parameter berbeda.

Contoh:

```java
@AllowedByChannel(channel = Channel.INTERNET, values = {"DRAFT", "SUBMITTED"})
@AllowedByChannel(channel = Channel.INTRANET, values = {"DRAFT", "SUBMITTED", "APPROVED"})
private String status;
```

Untuk Java 8+, bisa gunakan `@Repeatable`.

Annotation:

```java
@Documented
@Constraint(validatedBy = AllowedByChannelValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
@Repeatable(AllowedByChannel.List.class)
public @interface AllowedByChannel {

    String message() default "{validation.allowedByChannel.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    Channel channel();

    String[] values();

    @Documented
    @Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
    @Retention(RUNTIME)
    @interface List {
        AllowedByChannel[] value();
    }
}
```

Namun hati-hati: repeatable constraints mudah membuat rule tersebar dan susah dibaca.

Jika repeatable constraint mulai terlihat seperti matrix business policy, pertimbangkan policy object atau configuration-driven validator di service layer.

---

## 15. Field-Level Constraint

Field-level constraint memvalidasi satu field.

Contoh:

```java
@SingaporePostalCode
private String postalCode;
```

Cocok untuk:

- format;
- range;
- enum-like allowed value;
- local semantic value;
- wrapper value object.

Tidak cocok untuk:

- membandingkan dua field;
- rule yang bergantung ke object lain;
- workflow transition;
- authorization.

---

## 16. Property-Level Constraint

Property-level constraint ditempatkan pada getter.

```java
@SingaporePostalCode
public String getPostalCode() {
    return postalCode;
}
```

Ini berguna bila:

- JavaBean property dihitung;
- field tidak langsung merepresentasikan property;
- framework menggunakan getter-based access;
- kamu ingin menghindari validasi field internal.

Namun jangan mencampur field-level dan getter-level constraints sembarangan pada class yang sama. Itu dapat membuat rules sulit diprediksi.

Guideline:

- DTO sederhana: field-level sering lebih jelas;
- entity/property model: pilih satu convention per codebase;
- computed property: property-level bisa masuk akal.

---

## 17. Class-Level Constraint

Class-level constraint memvalidasi konsistensi satu object.

Contoh:

```java
@ValidDateRange
public class DateRangeDto {
    private LocalDate startDate;
    private LocalDate endDate;
}
```

Annotation:

```java
@Documented
@Constraint(validatedBy = DateRangeValidator.class)
@Target({ TYPE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface ValidDateRange {

    String message() default "{validation.dateRange.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    String start() default "startDate";

    String end() default "endDate";
}
```

Validator:

```java
public final class DateRangeValidator
        implements ConstraintValidator<ValidDateRange, DateRangeDto> {

    @Override
    public boolean isValid(DateRangeDto value, ConstraintValidatorContext context) {
        if (value == null) return true;

        LocalDate start = value.getStartDate();
        LocalDate end = value.getEndDate();

        if (start == null || end == null) {
            return true;
        }

        return !start.isAfter(end);
    }
}
```

Ini sederhana, tapi error akan ditempelkan ke object-level path, bukan field tertentu.

Untuk API, sering lebih baik menempelkan violation ke field yang relevan.

---

## 18. Custom Violation Path

Dengan `ConstraintValidatorContext`, kamu bisa disable default violation lalu membuat violation baru.

```java
public final class DateRangeValidator
        implements ConstraintValidator<ValidDateRange, DateRangeDto> {

    @Override
    public boolean isValid(DateRangeDto value, ConstraintValidatorContext context) {
        if (value == null) return true;

        LocalDate start = value.getStartDate();
        LocalDate end = value.getEndDate();

        if (start == null || end == null) return true;

        if (!start.isAfter(end)) return true;

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate("{validation.dateRange.endBeforeStart}")
                .addPropertyNode("endDate")
                .addConstraintViolation();

        return false;
    }
}
```

Hasilnya error path lebih actionable:

```json
{
  "field": "endDate",
  "code": "validation.dateRange.endBeforeStart",
  "message": "End date must not be before start date"
}
```

Daripada:

```json
{
  "field": "",
  "code": "validation.dateRange.invalid"
}
```

Prinsip:

> Class-level constraint boleh digunakan, tetapi violation harus diarahkan ke path yang bisa dipahami client/user bila memungkinkan.

---

## 19. Multiple Violations dari Satu Validator

Satu class-level validator bisa menghasilkan beberapa violation.

Contoh conditional requiredness:

```java
@ValidCompanyApplicant
public class ApplicantDto {
    private ApplicantType type;
    private String companyName;
    private String uen;
}
```

Validator:

```java
public final class CompanyApplicantValidator
        implements ConstraintValidator<ValidCompanyApplicant, ApplicantDto> {

    @Override
    public boolean isValid(ApplicantDto value, ConstraintValidatorContext context) {
        if (value == null) return true;

        if (value.getType() != ApplicantType.COMPANY) {
            return true;
        }

        boolean valid = true;
        context.disableDefaultConstraintViolation();

        if (isBlank(value.getCompanyName())) {
            context.buildConstraintViolationWithTemplate("{validation.companyName.required}")
                    .addPropertyNode("companyName")
                    .addConstraintViolation();
            valid = false;
        }

        if (isBlank(value.getUen())) {
            context.buildConstraintViolationWithTemplate("{validation.uen.required}")
                    .addPropertyNode("uen")
                    .addConstraintViolation();
            valid = false;
        }

        return valid;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
```

Caution:

- jangan membuat validator class-level terlalu besar;
- jika sudah puluhan field dan rule, pindahkan ke domain policy/rule object;
- pastikan semua violation punya stable code.

---

## 20. Cross-Parameter Constraint Preview

Cross-parameter constraint memvalidasi parameter method/constructor secara bersama-sama.

Contoh:

```java
@ValidTransferPeriod
public void transfer(LocalDate from, LocalDate to) {
    ...
}
```

Target annotation:

```java
@Target({ METHOD, CONSTRUCTOR, ANNOTATION_TYPE })
```

Validator type biasanya `Object[]`:

```java
public final class TransferPeriodValidator
        implements ConstraintValidator<ValidTransferPeriod, Object[]> {

    @Override
    public boolean isValid(Object[] value, ConstraintValidatorContext context) {
        if (value == null || value.length < 2) return true;

        LocalDate from = (LocalDate) value[0];
        LocalDate to = (LocalDate) value[1];

        if (from == null || to == null) return true;
        return !from.isAfter(to);
    }
}
```

Kita akan bahas ini lebih dalam di part executable validation.

Untuk sekarang cukup pahami:

- cross-parameter lebih advanced;
- lebih mudah salah;
- parameter index rapuh;
- butuh dokumentasi jelas;
- sering lebih baik memakai command object dengan class-level validation.

Daripada:

```java
submit(String applicationId, LocalDate startDate, LocalDate endDate, String actorId)
```

sering lebih baik:

```java
submit(@Valid SubmitApplicationCommand command)
```

Lalu validasi command object.

---

## 21. Generic Constraint vs Cross-Parameter Constraint

Jakarta Validation membedakan:

- generic constraint: memvalidasi annotated element;
- cross-parameter constraint: memvalidasi parameter array method/constructor.

Jika constraint mendukung keduanya, annotation perlu menyediakan `validationAppliesTo()`.

Contoh pattern:

```java
ConstraintTarget validationAppliesTo() default ConstraintTarget.IMPLICIT;
```

Namun untuk sebagian besar custom constraints, jangan buru-buru mendukung keduanya.

Guideline:

- buat constraint kecil dan jelas;
- pisahkan generic dan cross-parameter jika semantics berbeda;
- hindari annotation yang terlalu pintar.

---

## 22. Constraint untuk Enum dan Allowed Values

Sering ada kebutuhan memvalidasi string terhadap enum.

Contoh request API menerima string:

```java
@EnumName(enumClass = CaseStatus.class)
private String status;
```

Annotation:

```java
@Documented
@Constraint(validatedBy = EnumNameValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface EnumName {

    String message() default "{validation.enumName.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    Class<? extends Enum<?>> enumClass();

    boolean ignoreCase() default false;
}
```

Validator:

```java
public final class EnumNameValidator
        implements ConstraintValidator<EnumName, String> {

    private Set<String> accepted;
    private boolean ignoreCase;

    @Override
    public void initialize(EnumName annotation) {
        this.ignoreCase = annotation.ignoreCase();
        Set<String> names = new HashSet<>();
        for (Enum<?> constant : annotation.enumClass().getEnumConstants()) {
            String name = constant.name();
            names.add(ignoreCase ? name.toLowerCase(Locale.ROOT) : name);
        }
        this.accepted = Collections.unmodifiableSet(names);
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        String candidate = ignoreCase ? value.toLowerCase(Locale.ROOT) : value;
        return accepted.contains(candidate);
    }
}
```

Tetapi pertimbangkan alternatif:

- biarkan JSON mapper bind ke enum dan handle invalid enum;
- gunakan dedicated DTO enum type;
- gunakan string jika butuh backward compatibility/open values.

Jangan memakai enum validation untuk rule seperti:

> status ini boleh dipilih oleh role X saat case ada di state Y.

Itu workflow/authorization policy, bukan enum format validation.

---

## 23. Constraint untuk Value Object

Custom constraint lebih kuat jika dipakai bersama value object.

Contoh value object:

```java
public final class CaseReference {

    private static final Pattern PATTERN =
            Pattern.compile("^[A-Z]{3}-\\d{4}-\\d{6}$");

    private final String value;

    private CaseReference(String value) {
        this.value = value;
    }

    public static CaseReference of(String value) {
        if (value == null || !PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid case reference");
        }
        return new CaseReference(value);
    }

    public String value() {
        return value;
    }
}
```

DTO:

```java
public class CaseLookupRequest {
    @NotBlank
    @CaseReferenceNumber
    private String referenceNo;
}
```

Application layer:

```java
CaseReference reference = CaseReference.of(request.getReferenceNo());
```

Pertanyaan: kalau value object sudah validasi, kenapa masih perlu annotation?

Karena:

- annotation memberi error response yang user-friendly pada boundary;
- value object menjaga invariant internal;
- boundary validation menghindari exception-driven control flow;
- domain invariant tetap aman jika object dibuat dari jalur lain.

Layering yang baik:

```text
API DTO validation     -> user-facing rejection
Value object invariant -> domain correctness
DB constraint          -> final storage consistency
```

---

## 24. Constraint untuk Records

Java records membuat DTO immutable dan ringkas.

Contoh:

```java
public record CaseLookupRequest(
        @NotBlank
        @CaseReferenceNumber
        String referenceNo
) {}
```

Custom constraint field/type-use tetap bisa dipakai pada record component.

Class-level constraint pada record:

```java
@ValidDateRange
public record DateRangeRequest(
        LocalDate startDate,
        LocalDate endDate
) {}
```

Validator:

```java
public final class DateRangeRecordValidator
        implements ConstraintValidator<ValidDateRange, DateRangeRequest> {

    @Override
    public boolean isValid(DateRangeRequest value, ConstraintValidatorContext context) {
        if (value == null) return true;
        if (value.startDate() == null || value.endDate() == null) return true;
        return !value.startDate().isAfter(value.endDate());
    }
}
```

Java 8 tidak memiliki records, jadi untuk library yang harus mendukung Java 8, jangan menjadikan record sebagai API publik utama.

Untuk Java 17/21/25 codebase, records sangat cocok untuk request/command immutable, terutama jika validation dipakai di boundary.

---

## 25. Constraint Composition Preview

Custom constraint bisa disusun dari constraint lain.

Contoh:

```java
@NotBlank
@Pattern(regexp = "^[A-Z]{3}-\\d{4}-\\d{6}$")
@Constraint(validatedBy = {})
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface CaseReferenceNumber {

    String message() default "{validation.caseReferenceNumber.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Ini disebut composed constraint.

Keuntungan:

- tidak perlu validator class;
- reuse built-in constraints;
- annotation lebih ekspresif.

Namun ada caveat:

- multiple violations bisa muncul;
- message bisa tersebar;
- `@ReportAsSingleViolation` mungkin diperlukan;
- composition detail bisa tersembunyi.

Kita akan bahas constraint composition secara khusus di part 016.

---

## 26. Message Strategy: Jangan Hardcode untuk Production API

Pesan default:

```java
String message() default "Invalid case reference number";
```

Boleh untuk demo, kurang bagus untuk production.

Lebih baik:

```java
String message() default "{validation.caseReferenceNumber.invalid}";
```

`ValidationMessages.properties`:

```properties
validation.caseReferenceNumber.invalid=Case reference number is invalid.
validation.dateRange.endBeforeStart=End date must not be before start date.
validation.uen.invalid=Business registration number is invalid.
```

Namun untuk API, message saja belum cukup.

Better response model:

```json
{
  "type": "https://example.gov/errors/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "errors": [
    {
      "path": "referenceNo",
      "code": "validation.caseReferenceNumber.invalid",
      "message": "Case reference number is invalid.",
      "constraint": "CaseReferenceNumber"
    }
  ]
}
```

Machine-readable code harus stabil.

Human message boleh berubah.

---

## 27. Membaca Annotation Attribute dalam Message

Annotation attribute bisa dipakai dalam message interpolation.

Annotation:

```java
@MaxLengthByCharset(maxBytes = 100, charset = "UTF-8")
private String description;
```

Message:

```properties
validation.maxLengthByCharset=Must not exceed {maxBytes} bytes in {charset}.
```

Annotation:

```java
public @interface MaxLengthByCharset {
    String message() default "{validation.maxLengthByCharset}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    int maxBytes();
    String charset() default "UTF-8";
}
```

Jangan memasukkan value sensitif ke message.

Buruk:

```properties
validation.secret.invalid=Secret value ${validatedValue} is invalid.
```

Untuk PII atau credential, jangan echo rejected value.

---

## 28. Custom Constraint dan Error Code

Bean/Jakarta Validation secara default menghasilkan `message`, bukan `code` terpisah.

Namun kamu bisa menggunakan message template sebagai code.

Misalnya `ConstraintViolation#getMessageTemplate()` menghasilkan:

```text
{validation.caseReferenceNumber.invalid}
```

Lalu API layer normalize menjadi:

```java
private static String toCode(ConstraintViolation<?> violation) {
    String template = violation.getMessageTemplate();
    if (template.startsWith("{") && template.endsWith("}")) {
        return template.substring(1, template.length() - 1);
    }
    return "validation.unknown";
}
```

Mapping:

```json
{
  "code": "validation.caseReferenceNumber.invalid",
  "message": "Case reference number is invalid."
}
```

Dengan ini, frontend tidak perlu parse human message.

---

## 29. Custom Constraint untuk Byte Length, Bukan Character Length

Sering di enterprise/database ada batas byte, bukan karakter.

`@Size(max = 100)` menghitung panjang string sebagai character sequence length, bukan byte encoded length.

Jika database column atau external system membatasi byte, buat custom constraint.

Annotation:

```java
@Documented
@Constraint(validatedBy = MaxUtf8BytesValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface MaxUtf8Bytes {

    String message() default "{validation.maxUtf8Bytes.exceeded}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    int value();
}
```

Validator:

```java
public final class MaxUtf8BytesValidator
        implements ConstraintValidator<MaxUtf8Bytes, String> {

    private int maxBytes;

    @Override
    public void initialize(MaxUtf8Bytes annotation) {
        if (annotation.value() < 0) {
            throw new IllegalArgumentException("max bytes must be non-negative");
        }
        this.maxBytes = annotation.value();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return value.getBytes(StandardCharsets.UTF_8).length <= maxBytes;
    }
}
```

Use case:

```java
@MaxUtf8Bytes(4000)
private String remarks;
```

Ini penting untuk sistem yang banyak menerima:

- emoji;
- multilingual text;
- nama orang dengan karakter non-ASCII;
- data dari external agency;
- field yang akan masuk database dengan byte limit.

---

## 30. Custom Constraint dan Regex ReDoS

Regex validator mudah dibuat tetapi bisa menjadi vulnerability.

Buruk:

```java
private static final Pattern PATTERN = Pattern.compile("^(a+)+$");
```

Input tertentu dapat menyebabkan catastrophic backtracking.

Guideline:

- gunakan regex sederhana;
- anchoring jelas `^...$`;
- hindari nested quantifier berbahaya;
- precompile pattern;
- batasi input length dengan `@Size` atau explicit check;
- test adversarial input;
- gunakan parser/manual validation jika regex kompleks.

Contoh aman untuk postal code:

```java
private static final Pattern POSTAL_CODE = Pattern.compile("^\\d{6}$");
```

Contoh validasi manual:

```java
private static boolean isSixDigits(String value) {
    if (value.length() != 6) return false;
    for (int i = 0; i < value.length(); i++) {
        if (!Character.isDigit(value.charAt(i))) return false;
    }
    return true;
}
```

Namun `Character.isDigit()` menerima digit Unicode, bukan hanya ASCII. Jika butuh ASCII digit:

```java
private static boolean isSixAsciiDigits(String value) {
    if (value.length() != 6) return false;
    for (int i = 0; i < value.length(); i++) {
        char c = value.charAt(i);
        if (c < '0' || c > '9') return false;
    }
    return true;
}
```

Ini contoh detail yang sering luput.

---

## 31. Custom Constraint untuk Conditional Requiredness

Conditional requiredness sering muncul:

> Jika applicant type adalah COMPANY, maka company name dan UEN wajib.

Bisa dibuat class-level constraint, tetapi hati-hati.

Annotation:

```java
@Documented
@Constraint(validatedBy = CompanyApplicantValidator.class)
@Target({ TYPE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface ValidCompanyApplicant {

    String message() default "{validation.companyApplicant.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

DTO:

```java
@ValidCompanyApplicant
public class ApplicantDto {
    private ApplicantType type;
    private String companyName;
    private String uen;
}
```

Ini acceptable jika rule bersifat shape consistency.

Namun jika rule berubah berdasarkan:

- role;
- agency;
- feature flag;
- workflow state;
- submission channel;
- previous application history;

maka class-level Bean Validation mulai tidak cocok.

Lebih baik gunakan:

```java
ApplicantPolicy.validateForSubmission(command, actor, caseState, policyVersion);
```

---

## 32. Custom Constraint dengan Dependency Injection

Kadang validator butuh service.

Contoh:

```java
@ExistingDocumentType
private String documentType;
```

Validator mungkin ingin mengecek reference table.

Dalam Spring/CDI, injection bisa dilakukan melalui provider-specific integration.

Namun dependency injection di validator harus dipakai hati-hati.

Masalah:

- validator bisa dipanggil di banyak boundary;
- validator lifecycle diatur provider;
- dependency bisa null jika factory tidak terintegrasi dengan DI container;
- database call membuat validation lambat;
- race condition tetap mungkin;
- validator tidak lagi pure;
- test jadi lebih berat;
- error handling lebih kompleks.

Contoh acceptable:

- lookup static reference data dari in-memory cache;
- validator memakai service pure/deterministic;
- service tidak melakukan mutation;
- latency rendah;
- failure mode jelas.

Contoh berbahaya:

```java
@UniqueEmail
private String email;
```

Jika validator query DB:

1. validator cek email belum ada;
2. request lain insert email sama;
3. transaksi pertama insert;
4. DB unique constraint gagal.

Jadi uniqueness tetap harus dijamin DB unique constraint.

Validator boleh memberi early user-friendly error, tetapi bukan final consistency guarantee.

---

## 33. ConstraintValidatorFactory

Jika butuh kontrol creation validator, ada `ConstraintValidatorFactory`.

Use case:

- mengintegrasikan DI container;
- custom lifecycle;
- test factory;
- provider integration.

Conceptual example:

```java
public final class MyConstraintValidatorFactory implements ConstraintValidatorFactory {

    @Override
    public <T extends ConstraintValidator<?, ?>> T getInstance(Class<T> key) {
        return createOrResolveFromContainer(key);
    }

    @Override
    public void releaseInstance(ConstraintValidator<?, ?> instance) {
        // release if needed
    }
}
```

Namun di Spring Boot/Jakarta EE/Quarkus, biasanya framework sudah menyediakan integration.

Jangan membuat factory custom kecuali memang perlu.

---

## 34. Custom Constraint pada Type Use

Agar constraint bisa dipakai seperti ini:

```java
private List<@CaseReferenceNumber String> references;
```

annotation harus punya target `TYPE_USE`:

```java
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
```

Ini sangat berguna untuk:

```java
Map<@NotBlank String, @CaseReferenceNumber String> referenceByKey;
Optional<@Email String> contactEmail;
List<@ValidUen String> uens;
```

Tanpa `TYPE_USE`, annotation hanya bisa ditempel di field/list-nya, bukan element-nya.

Buruk:

```java
@CaseReferenceNumber
private List<String> references;
```

Ini salah secara type, karena validator `String` tidak cocok untuk `List<String>`.

Benar:

```java
private List<@CaseReferenceNumber String> references;
```

---

## 35. Custom Constraint untuk Container Wrapper

Misalnya kamu punya patch wrapper:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    // constructors/getters
}
```

Kamu ingin:

```java
private PatchField<@Email String> email;
```

Agar validator bisa mengekstrak value dari `PatchField<T>`, butuh `ValueExtractor`.

Kita sudah preview di part container constraints, dan akan detailkan lagi di bagian integration/advanced.

Prinsipnya:

- constraint pada wrapper memvalidasi wrapper;
- constraint pada type argument memvalidasi isi wrapper;
- provider butuh cara mengekstrak isi wrapper.

---

## 36. Designing a Production-Grade Custom Constraint Library

Jika tim membuat banyak custom constraints, sebaiknya dibuat struktur package jelas.

Contoh:

```text
com.example.validation
  ├── constraints
  │   ├── CaseReferenceNumber.java
  │   ├── SingaporePostalCode.java
  │   ├── Uen.java
  │   └── MaxUtf8Bytes.java
  ├── validators
  │   ├── CaseReferenceNumberValidator.java
  │   ├── SingaporePostalCodeValidator.java
  │   ├── UenValidator.java
  │   └── MaxUtf8BytesValidator.java
  ├── message
  │   └── ValidationMessageKeys.java
  └── support
      ├── Regexes.java
      ├── ConstraintViolationPaths.java
      └── ValidationCodes.java
```

Namun banyak tim memilih menaruh validator berdekatan dengan annotation:

```text
com.example.validation.constraints
  ├── CaseReferenceNumber.java
  ├── CaseReferenceNumberValidator.java
```

Keduanya bisa benar.

Yang penting:

- ownership jelas;
- naming konsisten;
- tests wajib;
- error code stabil;
- dependency minimal;
- tidak ada service-layer logic bocor.

---

## 37. Example: `@SingaporePostalCode`

Annotation:

```java
@Documented
@Constraint(validatedBy = SingaporePostalCodeValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface SingaporePostalCode {

    String message() default "{validation.singaporePostalCode.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class SingaporePostalCodeValidator
        implements ConstraintValidator<SingaporePostalCode, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        if (value.length() != 6) return false;

        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < '0' || c > '9') {
                return false;
            }
        }

        return true;
    }
}
```

Usage:

```java
public record AddressRequest(
        @NotBlank
        @SingaporePostalCode
        String postalCode
) {}
```

Why manual char check?

Karena rule-nya sangat sederhana, cepat, dan tidak perlu regex.

---

## 38. Example: `@ValidDateRange` dengan Property Path

DTO:

```java
@ValidDateRange
public record SearchPeriodRequest(
        LocalDate fromDate,
        LocalDate toDate
) {}
```

Annotation:

```java
@Documented
@Constraint(validatedBy = SearchPeriodValidator.class)
@Target({ TYPE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface ValidDateRange {

    String message() default "{validation.dateRange.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class SearchPeriodValidator
        implements ConstraintValidator<ValidDateRange, SearchPeriodRequest> {

    @Override
    public boolean isValid(SearchPeriodRequest value, ConstraintValidatorContext context) {
        if (value == null) return true;
        if (value.fromDate() == null || value.toDate() == null) return true;

        if (!value.fromDate().isAfter(value.toDate())) {
            return true;
        }

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate("{validation.dateRange.toDateBeforeFromDate}")
                .addPropertyNode("toDate")
                .addConstraintViolation();

        return false;
    }
}
```

Testing expectation:

```text
path: toDate
messageTemplate: {validation.dateRange.toDateBeforeFromDate}
```

---

## 39. Example: `@MaxUtf8Bytes`

Annotation:

```java
@Documented
@Constraint(validatedBy = MaxUtf8BytesValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface MaxUtf8Bytes {

    String message() default "{validation.maxUtf8Bytes.exceeded}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    int value();
}
```

Validator:

```java
public final class MaxUtf8BytesValidator
        implements ConstraintValidator<MaxUtf8Bytes, CharSequence> {

    private int maxBytes;

    @Override
    public void initialize(MaxUtf8Bytes annotation) {
        if (annotation.value() < 0) {
            throw new IllegalArgumentException("Max UTF-8 bytes must be >= 0");
        }
        this.maxBytes = annotation.value();
    }

    @Override
    public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return value.toString().getBytes(StandardCharsets.UTF_8).length <= maxBytes;
    }
}
```

Kenapa `CharSequence`, bukan `String`?

Agar bisa dipakai pada type seperti:

- `String`;
- `StringBuilder`;
- custom CharSequence.

Namun jangan terlalu generic jika tidak perlu. `CharSequence` masih cukup aman untuk text constraint.

---

## 40. Example: `@ValidPercentage`

Persentase kadang memakai `BigDecimal`.

Rule:

- optional by default;
- harus `0 <= value <= 100`;
- maksimal scale 2.

Annotation:

```java
@Documented
@Constraint(validatedBy = PercentageValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface ValidPercentage {

    String message() default "{validation.percentage.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    int maxScale() default 2;
}
```

Validator:

```java
public final class PercentageValidator
        implements ConstraintValidator<ValidPercentage, BigDecimal> {

    private int maxScale;

    @Override
    public void initialize(ValidPercentage annotation) {
        this.maxScale = annotation.maxScale();
        if (maxScale < 0) {
            throw new IllegalArgumentException("maxScale must be non-negative");
        }
    }

    @Override
    public boolean isValid(BigDecimal value, ConstraintValidatorContext context) {
        if (value == null) return true;

        if (value.compareTo(BigDecimal.ZERO) < 0) return false;
        if (value.compareTo(BigDecimal.valueOf(100)) > 0) return false;

        return value.scale() <= maxScale;
    }
}
```

Kenapa tidak hanya:

```java
@DecimalMin("0")
@DecimalMax("100")
@Digits(integer = 3, fraction = 2)
```

Itu bisa, dan sering lebih baik. Custom constraint masuk akal jika:

- ingin domain name `@ValidPercentage`;
- ingin single stable error code;
- ingin semantics reusable;
- ingin policy scale configurable.

---

## 41. Testing Custom Constraint

Testing minimal harus mencakup:

- null accepted atau rejected sesuai design;
- valid values;
- invalid values;
- boundary values;
- Unicode edge cases;
- whitespace;
- annotation attributes;
- message template;
- violation path;
- group behavior;
- container element usage jika target `TYPE_USE`.

Example JUnit test:

```java
class SingaporePostalCodeValidatorTest {

    private static Validator validator;

    @BeforeAll
    static void setUp() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @Test
    void shouldRejectNonSixDigitPostalCode() {
        AddressRequest request = new AddressRequest("12345A");

        Set<ConstraintViolation<AddressRequest>> violations = validator.validate(request);

        assertThat(violations).hasSize(1);
        ConstraintViolation<AddressRequest> violation = violations.iterator().next();
        assertThat(violation.getPropertyPath().toString()).isEqualTo("postalCode");
        assertThat(violation.getMessageTemplate())
                .isEqualTo("{validation.singaporePostalCode.invalid}");
    }
}
```

For Java 8 tanpa record:

```java
public class AddressRequest {
    @SingaporePostalCode
    private String postalCode;

    public AddressRequest(String postalCode) {
        this.postalCode = postalCode;
    }

    public String getPostalCode() {
        return postalCode;
    }
}
```

---

## 42. Testing Validator Class Langsung vs Melalui `Validator`

Testing langsung:

```java
SingaporePostalCodeValidator validator = new SingaporePostalCodeValidator();
assertTrue(validator.isValid("123456", null));
```

Cepat, tetapi tidak menguji integration dengan Jakarta Validation provider.

Testing melalui `Validator`:

```java
Set<ConstraintViolation<AddressRequest>> violations = validator.validate(request);
```

Lebih realistis karena menguji:

- annotation discovery;
- target compatibility;
- message template;
- property path;
- groups;
- type-use support.

Recommendation:

- pure logic helper dites langsung;
- custom constraint dites via `Validator`;
- API error mapping dites di integration/controller test.

---

## 43. Common Failure Modes

### 43.1 Constraint Tidak Jalan karena Retention Salah

```java
@Retention(CLASS)
```

Harus:

```java
@Retention(RUNTIME)
```

### 43.2 Constraint Tidak Bisa Dipasang di Container Element

Lupa `TYPE_USE`.

```java
@Target({ FIELD })
```

Harus:

```java
@Target({ FIELD, TYPE_USE })
```

### 43.3 Null Ditolak Diam-Diam

Validator:

```java
return value.length() == 6;
```

Jika `value == null`, NPE.

Harus:

```java
if (value == null) return true;
```

atau jelas-jelas constraint required.

### 43.4 Validator Tidak Thread-Safe

Menyimpan request state di field validator.

### 43.5 DB Call di Validator Menjadi Bottleneck

Setiap request validasi memanggil DB.

Dalam batch 10.000 row, ini menjadi 10.000 query.

### 43.6 Error Message Tidak Stabil

Frontend parse message text:

```javascript
if (message === "Invalid case reference number") { ... }
```

Harus pakai code.

### 43.7 Constraint Terlalu Umum

```java
@ValidApplication
```

Tidak jelas apa yang divalidasi.

Lebih baik pecah:

```java
@ValidApplicantIdentity
@ValidContactInformation
@ValidSubmissionPeriod
```

Namun jangan berlebihan sampai semua rule tersebar.

---

## 44. Decision Framework: Annotation atau Bukan?

Gunakan custom constraint jika mayoritas jawaban “ya”:

1. Rule bersifat lokal pada value/object?
2. Rule relatif stabil?
3. Rule tidak butuh actor/current user?
4. Rule tidak butuh database final consistency?
5. Rule tidak butuh remote service?
6. Rule bisa dievaluasi deterministik?
7. Rule cocok direpresentasikan sebagai declarative metadata?
8. Error-nya bisa diberi stable message code?
9. Constraint bisa dites secara isolated?
10. Constraint tidak menyembunyikan workflow decision?

Jika banyak jawaban “tidak”, gunakan:

- command validator;
- domain policy;
- workflow guard;
- database constraint;
- rule engine;
- service-level validation.

---

## 45. Layering Custom Constraint dalam Enterprise Architecture

Contoh alur request:

```text
HTTP JSON
  -> DTO binding
  -> Jakarta Validation annotations
  -> API error response if invalid
  -> command mapping
  -> domain policy validation
  -> workflow transition guard
  -> persistence
  -> database constraints
  -> event publication
```

Custom constraint paling cocok di tahap:

```text
DTO binding -> Jakarta Validation annotations
```

atau:

```text
domain value object invariant
```

Untuk workflow:

```text
workflow transition guard
```

jangan dipaksa annotation.

---

## 46. Regulatory/Case Management Perspective

Dalam sistem case management/regulatory, validation harus bisa dijelaskan.

Contoh rule:

```java
@CaseReferenceNumber
private String caseReference;
```

Ini mudah diaudit:

> Field caseReference ditolak karena tidak memenuhi format nomor referensi case.

Contoh rule:

```java
@CanApprove
private ApprovalRequest request;
```

Ini tidak cukup defensible jika di dalamnya ada:

- role check;
- maker-checker check;
- conflict of interest;
- pending document;
- deadline;
- enforcement hold;
- case assignment.

Untuk regulatory systems, rejection sebaiknya punya:

- rule code;
- rule version;
- actor;
- operation;
- object id;
- state before;
- reason;
- evidence.

Bean Validation custom constraint tidak ideal untuk menyimpan seluruh konteks ini.

Gunakan rule result model:

```java
public record RuleViolation(
        String code,
        String message,
        Severity severity,
        String field,
        Map<String, Object> evidence
) {}
```

Custom constraints tetap berguna untuk input shape dan local invariant.

---

## 47. Java 8 sampai Java 25 Compatibility Notes

### Java 8

- Mendukung Bean Validation 2.0 era.
- Type-use annotation tersedia.
- Repeatable annotation tersedia.
- Tidak ada records.
- Tidak ada `String::isBlank`.
- Tidak ada `Collectors.toUnmodifiableSet`.
- Gunakan `javax.validation` pada stack legacy.

### Java 11

- `String.isBlank()` tersedia.
- Masih banyak Spring Boot 2 / Javax stack.

### Java 17

- Baseline modern untuk Jakarta EE 11/Jakarta Validation 3.1 stack.
- Records stable.
- Sealed classes available.
- Cocok untuk `jakarta.validation` modern.

### Java 21

- LTS modern.
- Records dan pattern matching style makin natural.
- Virtual threads tidak mengubah semantics validator, tetapi memperbesar kebutuhan validator tidak blocking secara sembarangan.

### Java 25

- Target modern terbaru dalam seri ini.
- Prinsip validation tetap sama.
- Jangan membuat validator bergantung pada fitur JDK terbaru jika library harus dipakai di Java 8/11.

Compatibility strategy:

```text
Library shared across Java 8 legacy services:
  -> compile Java 8
  -> javax.validation
  -> no records
  -> no Java 11+ APIs

Modern service Java 17/21/25:
  -> jakarta.validation
  -> records allowed
  -> modern immutable DTO
  -> avoid blocking validators on high-throughput paths
```

---

## 48. `javax.validation` vs `jakarta.validation` Version of Examples

Modern Jakarta version:

```java
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
```

Legacy Javax version:

```java
import javax.validation.Constraint;
import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import javax.validation.Payload;
```

Core design sama, package berbeda.

Jangan mencampur:

```java
import javax.validation.Constraint;
import jakarta.validation.ConstraintValidator;
```

Itu bisa membuat constraint tidak dikenali provider atau gagal runtime.

Migration harus namespace-consistent.

---

## 49. Production Checklist untuk Custom Constraint

Sebelum merge custom constraint baru, review:

### Semantics

- Apakah nama constraint jelas?
- Apakah rule cocok menjadi annotation?
- Apakah rule lokal atau contextual?
- Apakah rule overlap dengan built-in constraint?
- Apakah null handling eksplisit?

### Annotation Design

- Ada `message`, `groups`, `payload`?
- Ada `@Constraint`?
- Ada `@Retention(RUNTIME)`?
- Ada `@Target` yang benar?
- Perlu `TYPE_USE`?
- Perlu `@Repeatable`?
- Attribute sederhana dan jelas?

### Validator Design

- Thread-safe?
- Tidak menyimpan request state?
- Tidak melakukan DB/remote call tanpa alasan kuat?
- Regex precompiled?
- Tidak vulnerable ReDoS?
- Edge cases dites?
- Unicode semantics jelas?

### Error Contract

- Message template pakai stable key?
- API bisa map ke error code?
- Violation path benar?
- Tidak leak PII?
- Multiple violations jelas?

### Testing

- Unit test valid/invalid/null/boundary?
- Test annotation integration via `Validator`?
- Test group jika ada?
- Test type-use jika didukung?
- Test API error mapping?

### Architecture

- Tidak menyembunyikan workflow rule?
- Tidak menggantikan DB constraint untuk consistency final?
- Tidak menggabungkan authorization?
- Tidak membuat shared library terlalu coupled ke satu aplikasi?

---

## 50. Anti-Patterns

### 50.1 `@ValidEverything`

```java
@ValidApplication
private Application application;
```

Jika annotation ini mengecek semua hal, ia menjadi black box.

### 50.2 Constraint Memanggil Banyak Repository

```java
@CanSubmit
```

di dalamnya query:

- case repository;
- user repository;
- payment repository;
- document repository;
- SLA repository.

Ini service layer terselubung.

### 50.3 Message sebagai Logic Contract

Frontend mengecek text message.

Harus pakai code.

### 50.4 Requiredness Tersembunyi

```java
@PhoneNumber
private String phone;
```

Tapi validator menolak null.

Lebih jelas:

```java
@NotBlank
@PhoneNumber
private String phone;
```

### 50.5 Cross-Field Rule Dipaksa Field-Level

```java
@EndDateAfterStartDate
private LocalDate endDate;
```

Validator field-level tidak punya akses bersih ke `startDate`.

Gunakan class-level constraint atau command validator.

### 50.6 Constraint Terlalu Configurable

```java
@BusinessRule(
    expression = "status == 'DRAFT' && actor.role == 'OFFICER' && ..."
)
```

Ini mini rule engine tanpa governance.

---

## 51. Worked Example: From Raw Annotation to Production-Ready Constraint

### Step 1: Raw requirement

> Field reference number harus mengikuti format `ACE-YYYY-NNNNNN`.

### Step 2: Classify rule

- syntactic? yes;
- local semantic? yes;
- requires DB? no;
- requires actor? no;
- stable? likely yes.

Suitable for custom constraint.

### Step 3: Choose name

```java
@AceCaseReferenceNumber
```

Lebih domain-specific daripada:

```java
@ValidReference
```

### Step 4: Define annotation

```java
@Documented
@Constraint(validatedBy = AceCaseReferenceNumberValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface AceCaseReferenceNumber {

    String message() default "{validation.aceCaseReferenceNumber.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

### Step 5: Implement validator

```java
public final class AceCaseReferenceNumberValidator
        implements ConstraintValidator<AceCaseReferenceNumber, String> {

    private static final Pattern PATTERN =
            Pattern.compile("^ACE-\\d{4}-\\d{6}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        return PATTERN.matcher(value).matches();
    }
}
```

### Step 6: Add message

```properties
validation.aceCaseReferenceNumber.invalid=Case reference number must follow the expected format.
```

Avoid exposing exact internal pattern if that is not desirable. But for user correction, sometimes example format helps:

```properties
validation.aceCaseReferenceNumber.invalid=Case reference number must follow the format ACE-YYYY-NNNNNN.
```

### Step 7: Use with requiredness

```java
public record CaseLookupRequest(
        @NotBlank
        @AceCaseReferenceNumber
        String referenceNo
) {}
```

### Step 8: Test

- `null`: rejected by `@NotBlank`, not by custom constraint;
- empty: rejected by `@NotBlank` and maybe custom;
- `ACE-2025-000001`: valid;
- `ace-2025-000001`: invalid unless case-insensitive desired;
- `ACE-25-1`: invalid;
- Unicode digits: invalid if regex `\d` behavior is considered; use `[0-9]` if ASCII-only desired.

Important detail: Java regex `\d` can be Unicode-aware depending flags and behavior; if business needs ASCII digits only, prefer `[0-9]` or manual char check.

Production pattern:

```java
Pattern.compile("^ACE-[0-9]{4}-[0-9]{6}$");
```

---

## 52. Summary Mental Model

Custom constraint is good when it makes a domain rule:

- visible;
- reusable;
- declarative;
- testable;
- stable;
- local;
- machine-readable.

Custom constraint is dangerous when it hides:

- workflow decision;
- authorization;
- database consistency;
- remote service dependency;
- policy matrix;
- transaction-sensitive logic.

The best custom constraints are small, boring, deterministic, and expressive.

They should feel like part of the language of the domain:

```java
@SingaporePostalCode
@CaseReferenceNumber
@MaxUtf8Bytes(4000)
@ValidDateRange
@BusinessRegistrationNumber
```

not like a hidden service call:

```java
@CanSubmit
@CanApprove
@IsAllowedForCurrentUser
@ExistsAndIsOwnedByActor
```

---

## 53. Key Takeaways

1. A custom constraint is a declarative contract, not a service layer.
2. Always include `message`, `groups`, and `payload`.
3. Use `@Retention(RUNTIME)` or the provider cannot read the annotation.
4. Add `TYPE_USE` if the constraint should work inside containers like `List<@X String>`.
5. Most format constraints should treat `null` as valid; combine with `@NotNull`/`@NotBlank` for requiredness.
6. Validators must be thread-safe and must not store request-specific mutable state.
7. Precompile regex and avoid ReDoS-prone patterns.
8. Use stable message keys/error codes, not hardcoded messages as contracts.
9. Class-level constraints should create useful violation paths when possible.
10. Avoid DB/remote calls in validators unless you understand latency, race conditions, and lifecycle consequences.
11. Do not hide workflow, authorization, or regulatory policy inside annotations.
12. Test custom constraints through the real `Validator`, not only by instantiating the validator class.

---

## 54. References

- Jakarta Validation 3.1 specification: https://jakarta.ee/specifications/bean-validation/3.1/
- Jakarta Validation 3.1 API `@Constraint`: https://jakarta.ee/specifications/bean-validation/3.1/apidocs/jakarta/validation/constraint
- Jakarta Validation 3.1 API `ConstraintValidator`: https://jakarta.ee/specifications/bean-validation/3.1/apidocs/jakarta/validation/constraintvalidator
- Bean Validation / Jakarta Validation specification site: https://beanvalidation.org/specification/
- Jakarta Validation 3.1 release page: https://beanvalidation.org/3.1/
- Hibernate Validator reference guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator 9.0 release series: https://hibernate.org/validator/releases/9.0/

---

## 55. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

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

Part berikutnya:

**Part 010 — Class-Level and Cross-Field Validation: Consistency inside One Object**

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-008](./learn-java-validation-jakarta-hibernate-validator-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-010](./learn-java-validation-jakarta-hibernate-validator-part-010.md)

</div>
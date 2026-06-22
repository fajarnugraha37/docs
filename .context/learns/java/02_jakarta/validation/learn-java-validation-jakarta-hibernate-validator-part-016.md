# learn-java-validation-jakarta-hibernate-validator-part-016

# Constraint Composition: Reusable Higher-Level Constraints

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: 016  
> Topik: Constraint Composition, Reusable Higher-Level Constraints, `@ReportAsSingleViolation`, Hibernate Validator `@ConstraintComposition`, Attribute Overriding, Error Contract, dan Governance  
> Target Java: 8 sampai 25  
> Namespace: `javax.validation.*` dan `jakarta.validation.*`

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membangun custom constraint dari nol: annotation, validator, message, target, repeatable, dan violation path. Di part ini kita naik satu level: **bagaimana membuat constraint yang lebih tinggi dengan menyusun constraint lain**.

Ini disebut **constraint composition**.

Contoh sederhana:

```java
@NotBlank
@Size(max = 50)
@Pattern(regexp = "[A-Z0-9_-]+")
private String code;
```

Jika pola ini muncul di banyak tempat, engineer biasanya punya beberapa pilihan:

1. copy-paste tiga annotation itu di semua field;
2. membuat helper method manual di service;
3. membuat custom `ConstraintValidator` baru;
4. membuat composed constraint seperti `@ValidBusinessCode`.

Part ini fokus pada pilihan keempat.

Constraint composition penting karena di sistem besar, validation rule bukan hanya soal correctness lokal. Ia menjadi bagian dari readability model, API contract, frontend error mapping, shared rule library, auditability, consistency antar module, dan migration dari legacy rule ke rule yang lebih eksplisit.

Tetapi composition juga berbahaya jika salah digunakan. Constraint tingkat tinggi bisa berubah menjadi **black box annotation** yang menyembunyikan banyak rule bisnis, membuat debugging sulit, dan menimbulkan coupling antar bounded context.

Mental model utama part ini:

> Composition bagus untuk membungkus **constraint shape yang stabil dan reusable**.  
> Composition buruk jika dipakai untuk menyembunyikan **workflow rule, authorization rule, database rule, atau business policy yang sering berubah**.

---

## 2. Apa Itu Constraint Composition?

Constraint composition adalah kemampuan Bean Validation/Jakarta Validation untuk membuat satu annotation constraint yang tersusun dari constraint lain.

Misalnya kita ingin membuat constraint untuk kode referensi kasus:

```java
@Documented
@Constraint(validatedBy = {})
@Target({
        ElementType.FIELD,
        ElementType.METHOD,
        ElementType.PARAMETER,
        ElementType.ANNOTATION_TYPE,
        ElementType.TYPE_USE
})
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@Size(min = 8, max = 32)
@Pattern(regexp = "[A-Z0-9-]+")
public @interface CaseReference {
    String message() default "{case.reference.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Pemakaian:

```java
public record SearchCaseRequest(
        @CaseReference String caseReference
) {}
```

Dengan ini, `@CaseReference` bukan validator baru yang punya implementasi Java sendiri. Ia adalah constraint yang terdiri dari `@NotBlank`, `@Size`, dan `@Pattern`. Karena `validatedBy = {}` kosong, provider tidak mencari `ConstraintValidator` khusus untuk `@CaseReference`; provider mengevaluasi composing constraints yang ditempelkan pada annotation tersebut.

Secara standar, composed constraint berarti **semua composing constraints harus valid**. Dengan kata lain, default-nya adalah logika AND.

---

## 3. Kenapa Composition Dibutuhkan?

### 3.1 Menghindari Copy-Paste Constraint

Tanpa composition:

```java
@NotBlank(message = "Case reference is required")
@Size(min = 8, max = 32, message = "Case reference length is invalid")
@Pattern(regexp = "[A-Z0-9-]+", message = "Case reference format is invalid")
private String caseReference;
```

Lalu pola yang sama muncul di search request, appeal request, document attachment request, workflow transition request, correspondence template request, event payload, dan admin override request.

Dalam sistem besar, copy-paste menghasilkan rule drift: satu tempat `max = 32`, tempat lain `max = 30`, tempat lain regex lupa mengizinkan tanda `-`, dan frontend harus menangani variasi error yang sebenarnya sama.

Dengan composition:

```java
@CaseReference
private String caseReference;
```

Rule shape menjadi satu konsep.

### 3.2 Meningkatkan Bahasa Domain

Annotation built-in menjelaskan mekanisme:

```java
@NotBlank
@Size(max = 32)
@Pattern(regexp = "...")
String uen;
```

Composed constraint bisa menjelaskan meaning:

```java
@BusinessIdentifier
String uen;
```

Pada review kode, ini lebih mudah dibaca karena annotation menyatakan domain intent.

### 3.3 Membuat Rule Lebih Discoverable

Dengan composed constraint, kita bisa mencari `@CaseReference`, `@SingaporePostalCodeFormat`, `@StrongPassword`, `@BusinessIdentifier`, `@PublicOfficerIdFormat`, atau `@DocumentReferenceFormat` secara langsung.

Ini berguna untuk impact analysis, migration, audit, security review, API compatibility review, dan rule catalog generation.

### 3.4 Menjaga Error Contract

Composition memungkinkan kita menstandarkan message key, error code, payload severity, rule id, rule version, dan documentation.

```java
@CaseReference(message = "{case.reference.invalid}")
String caseReference;
```

Atau dengan custom attribute:

```java
@CaseReference(code = "CASE_REFERENCE_INVALID")
String caseReference;
```

Nanti API mapper bisa membaca metadata annotation untuk menghasilkan error response yang stabil.

---

## 4. Constraint Composition Standar vs Hibernate-Specific Composition

Ada dua level composition.

| Jenis | Sumber | Kemampuan |
|---|---|---|
| Standard composition | Jakarta Validation / Bean Validation | composing constraints dievaluasi dengan logika AND |
| Hibernate Validator composition extension | Hibernate Validator | mendukung composition type seperti OR dan ALL_FALSE melalui `@ConstraintComposition` |

Secara standar:

```java
@NotBlank
@Size(max = 20)
@Pattern(regexp = "[A-Z]+")
public @interface UppercaseCode { ... }
```

Valid jika tidak blank, panjang maksimal 20, dan cocok regex uppercase.

Hibernate Validator menambah extension:

```java
@ConstraintComposition(CompositionType.OR)
```

Dengan ini, kita bisa membuat constraint yang valid jika salah satu composing constraint valid. Namun extension ini provider-specific. Jika aplikasi harus portable ke provider selain Hibernate Validator, hindari extension tersebut atau bungkus penggunaannya dengan sadar.

---

## 5. Anatomi Composed Constraint

Minimal composed constraint:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Documented
@Constraint(validatedBy = {})
@Target({
        ElementType.FIELD,
        ElementType.METHOD,
        ElementType.PARAMETER,
        ElementType.ANNOTATION_TYPE,
        ElementType.TYPE_USE
})
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@Size(min = 8, max = 32)
@Pattern(regexp = "[A-Z0-9-]+")
public @interface CaseReference {
    String message() default "{case.reference.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Elemen penting:

| Elemen | Fungsi |
|---|---|
| `@Constraint(validatedBy = {})` | Menandai annotation sebagai constraint. Kosong karena validasi didelegasikan ke composing constraints. |
| `@Target(...)` | Menentukan tempat annotation boleh dipakai. |
| `@Retention(RUNTIME)` | Harus runtime agar validation provider bisa membaca annotation. |
| `message()` | Default message untuk composed constraint. |
| `groups()` | Required oleh specification untuk constraint annotation. |
| `payload()` | Required oleh specification untuk constraint annotation. |
| composing annotations | Constraint yang membentuk constraint ini. |

Jika annotation ingin bisa dipakai di dalam composition lain, tambahkan `ElementType.ANNOTATION_TYPE`. Jika annotation ingin bisa dipakai pada type argument seperti `List<@CaseReference String>`, tambahkan `ElementType.TYPE_USE`.

---

## 6. Null Semantics dalam Composition

Ini salah satu jebakan paling penting.

Banyak built-in constraints menganggap `null` valid, kecuali constraint yang memang mengecek null/blank seperti `@NotNull`, `@NotBlank`, dan `@NotEmpty`.

Contoh:

```java
@Size(min = 8, max = 32)
@Pattern(regexp = "[A-Z0-9-]+")
public @interface CaseReferenceFormat { ... }
```

Jika field bernilai `null`, kedua constraint tersebut biasanya tidak gagal. Artinya `null` valid. Maka annotation di atas berarti:

> Jika ada nilai, formatnya harus valid.

Bukan:

> Nilai wajib ada.

Jika ingin wajib ada:

```java
@NotBlank
@Size(min = 8, max = 32)
@Pattern(regexp = "[A-Z0-9-]+")
public @interface RequiredCaseReference { ... }
```

Namun jangan mencampur requiredness dan format jika requiredness berbeda per operation.

Lebih fleksibel:

```java
@CaseReferenceFormat
private String optionalCaseReference;

@NotBlank
@CaseReferenceFormat
private String requiredCaseReference;
```

Atau buat dua annotation dengan nama eksplisit:

```java
@OptionalCaseReference
@RequiredCaseReference
```

Tetapi hati-hati agar tidak membuat terlalu banyak variasi.

---

## 7. `@ReportAsSingleViolation`

Secara default, jika composed constraint gagal, provider bisa melaporkan violation dari masing-masing composing constraint.

Contoh:

```java
@CaseReference
String caseReference = "";
```

Bisa menghasilkan beberapa violation:

- not blank failed;
- size min failed;
- pattern failed.

Kadang ini bagus karena user mendapat detail. Kadang ini buruk karena API mengembalikan banyak error untuk satu field yang membingungkan.

`@ReportAsSingleViolation` membuat composed constraint dilaporkan sebagai satu violation.

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@Size(min = 8, max = 32)
@Pattern(regexp = "[A-Z0-9-]+")
@ReportAsSingleViolation
public @interface CaseReference {
    String message() default "{case.reference.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Semantics:

- composing constraints tetap dipakai untuk validasi;
- report yang keluar adalah violation milik composed constraint;
- evaluasi composing constraints berhenti pada kegagalan pertama untuk composed constraint yang menggunakan `@ReportAsSingleViolation`.

Cocok jika frontend hanya butuh satu error per field, detail internal tidak penting untuk user, rule ingin dipresentasikan sebagai satu domain rule, error code harus stabil, dan composing constraints adalah implementation detail.

Tidak cocok jika user butuh tahu persis mana yang salah, UI ingin menampilkan checklist password, import batch perlu reason detail, support team butuh diagnosis detail, atau composing constraints punya remediation berbeda.

---

## 8. Example: `@StrongPassword`

### 8.1 Simple Composed Constraint

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@Size(min = 12, max = 128)
@Pattern(regexp = ".*[A-Z].*", message = "{password.uppercase.missing}")
@Pattern(regexp = ".*[a-z].*", message = "{password.lowercase.missing}")
@Pattern(regexp = ".*\\d.*", message = "{password.digit.missing}")
@Pattern(regexp = ".*[^A-Za-z0-9].*", message = "{password.symbol.missing}")
public @interface StrongPassword {
    String message() default "{password.weak}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

### 8.2 Dengan Single Violation

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@Size(min = 12, max = 128)
@Pattern(regexp = ".*[A-Z].*")
@Pattern(regexp = ".*[a-z].*")
@Pattern(regexp = ".*\\d.*")
@Pattern(regexp = ".*[^A-Za-z0-9].*")
@ReportAsSingleViolation
public @interface StrongPassword {
    String message() default "{password.weak}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Ini menghasilkan satu error seperti:

```json
{
  "field": "password",
  "code": "PASSWORD_WEAK",
  "message": "Password does not meet the security policy."
}
```

Untuk password, composition bukan selalu pilihan terbaik. Jika rule membutuhkan blocklist breached password, entropy check, username similarity, tenant policy, progressive rollout, atau policy version, custom validator/policy service lebih tepat daripada pure composition.

---

## 9. Example: `@CaseReferenceFormat`

Untuk sistem case management, kita mungkin punya format case reference:

```text
CAS-2026-000123
APL-2026-000099
CMP-2026-000001
```

Buat constraint format:

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@Size(min = 15, max = 15)
@Pattern(regexp = "[A-Z]{3}-\\d{4}-\\d{6}")
public @interface CaseReferenceFormat {
    String message() default "{case.reference.format.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Pemakaian optional:

```java
public record SearchRequest(
        @CaseReferenceFormat String caseReference
) {}
```

Pemakaian required:

```java
public record GetCaseRequest(
        @NotBlank
        @CaseReferenceFormat
        String caseReference
) {}
```

Atau jika banyak required use case:

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@CaseReferenceFormat
@ReportAsSingleViolation
public @interface RequiredCaseReference {
    String message() default "{case.reference.required_or_invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Namun satu message `required_or_invalid` bisa kurang precise. Untuk API, biasanya lebih bagus membedakan `CASE_REFERENCE_REQUIRED` dan `CASE_REFERENCE_FORMAT_INVALID` karena remediation-nya berbeda.

---

## 10. Example: `@SingaporePostalCodeFormat`

Postal code sering terlihat sederhana, tetapi perlu hati-hati.

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@Pattern(regexp = "\\d{6}")
public @interface SingaporePostalCodeFormat {
    String message() default "{postalCode.sg.format.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Ini hanya format validation:

- enam digit;
- tidak memastikan postal code exists;
- tidak memanggil OneMap;
- tidak mengecek alamat cocok dengan postal code.

Naming harus jujur. `@SingaporePostalCodeFormat` lebih akurat daripada `@ValidSingaporePostalCode`, karena kata “valid” bisa disalahartikan sebagai exists/verified.

Untuk rule eksternal seperti “postal code exists in authoritative address registry”, itu bukan pure annotation composition. Itu integration/domain validation, dengan latency, cache, retry, rate limit, dan failure classification.

---

## 11. Example: `@TrimmedNotBlank` — Jangan Salah Tempat

Developer sering ingin membuat:

```java
@TrimmedNotBlank
String name;
```

Tetapi validation tidak seharusnya mengubah value. ConstraintValidator harus side-effect-free. Composition juga tidak melakukan normalization.

Jika ingin trim sebelum validate, lakukan normalization di boundary:

```java
String normalizedName = input.name() == null ? null : input.name().strip();
validator.validate(new Request(normalizedName));
```

Atau gunakan deserializer/custom binder yang jelas. Jangan berharap annotation composition melakukan transformasi.

---

## 12. Attribute Overriding

Composed constraint sering perlu mengekspos parameter dari composing constraints.

Contoh `@Code` dengan configurable `min`, `max`, dan `regexp`:

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@NotBlank
@Size
@Pattern(regexp = ".*")
public @interface Code {
    String message() default "{code.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    @OverridesAttribute(constraint = Size.class, name = "min")
    int min() default 1;

    @OverridesAttribute(constraint = Size.class, name = "max")
    int max() default 64;

    @OverridesAttribute(constraint = Pattern.class, name = "regexp")
    String regexp() default "[A-Z0-9_\\-]+";
}
```

Pemakaian:

```java
@Code(min = 3, max = 20, regexp = "[A-Z][A-Z0-9_]*")
String moduleCode;
```

Artinya `min()` dan `max()` di `@Code` override attribute milik `@Size`, sedangkan `regexp()` override attribute milik `@Pattern`.

Kita juga bisa override message composing constraint:

```java
@OverridesAttribute(constraint = Pattern.class, name = "message")
String patternMessage() default "{code.pattern.invalid}";
```

Tetapi attribute overriding terlihat elegan sekaligus berisiko. Annotation bisa menjadi terlalu generic, domain meaning melemah, developer harus membaca override untuk paham rule aktual, error code bisa berbeda-beda tanpa governance, dan metadata introspection menjadi lebih kompleks.

Contoh terlalu generic:

```java
@ValidString(min = 1, max = 50, regexp = "...")
```

Ini tidak jauh berbeda dari menulis `@Size` dan `@Pattern` langsung. Lebih baik gunakan annotation yang punya meaning domain stabil seperti `@CaseReferenceFormat`, `@OfficerReferenceFormat`, `@TemplateCode`, atau `@ModuleCode`.

---

## 13. Multiple Composing Constraints of Same Type

Misalnya `@Pattern` dipakai beberapa kali:

```java
@Pattern(regexp = ".*[A-Z].*")
@Pattern(regexp = ".*\\d.*")
```

Jika ingin override attribute untuk salah satu `@Pattern`, butuh mekanisme yang lebih spesifik. Bean Validation/Jakarta Validation menyediakan cara untuk menunjuk composing constraint tertentu melalui index saat ada beberapa constraint dengan type sama.

Namun dari sudut desain, jika composition punya banyak constraint sejenis dan perlu override satu per satu, tanyakan:

> Apakah annotation ini masih readable?

Untuk password policy yang kompleks, custom validator atau policy object sering lebih jelas daripada composition regex bertumpuk yang sulit di-debug.

---

## 14. Hibernate Validator `@ConstraintComposition`

Hibernate Validator menyediakan extension untuk mengubah logic composition.

### 14.1 OR Composition

Misalnya sebuah identifier boleh berupa email atau phone number.

```java
import org.hibernate.validator.constraints.ConstraintComposition;
import org.hibernate.validator.constraints.CompositionType;

@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@Email
@Pattern(regexp = "\\+?[0-9]{8,15}")
@ConstraintComposition(CompositionType.OR)
@ReportAsSingleViolation
public @interface LoginIdentifier {
    String message() default "{login.identifier.invalid}";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

Valid jika email valid atau phone format valid.

### 14.2 ALL_FALSE Composition

`ALL_FALSE` berarti semua composing constraints harus false. Ini jarang digunakan, tetapi bisa dipakai untuk melarang beberapa bentuk nilai. Namun rule “tidak boleh X atau Y” sering lebih jelas ditulis sebagai custom validator atau explicit denylist policy.

### 14.3 Portability Cost

`@ConstraintComposition` berasal dari Hibernate Validator, bukan standard Jakarta Validation. Artinya aplikasi bergantung pada Hibernate Validator, provider lain mungkin tidak mendukung, shared library harus mendeklarasikan dependency provider-specific, dan migration perlu diperiksa.

Di banyak aplikasi Spring/Jakarta modern, Hibernate Validator memang provider dominan. Tetapi engineer tetap harus sadar mana standard dan mana extension.

---

## 15. Composition vs Custom Validator

| Kebutuhan | Composition | Custom Validator |
|---|---:|---:|
| Gabungan rule sederhana | Sangat cocok | Bisa, tapi berlebihan |
| Built-in constraints cukup | Sangat cocok | Tidak perlu |
| Perlu external dependency | Tidak cocok | Lebih cocok |
| Perlu database lookup | Tidak cocok | Mungkin, tapi tetap hati-hati |
| Perlu dynamic policy | Kurang cocok | Lebih cocok atau domain policy |
| Perlu OR/ALL_FALSE portable | Tidak bisa standard | Custom validator lebih portable |
| Perlu rich violation detail | Terbatas | Lebih fleksibel |
| Perlu custom path | Tidak cocok | Cocok |
| Perlu algorithmic validation | Tidak cocok | Cocok |
| Perlu reusable domain shape | Cocok | Bisa, tapi lebih banyak kode |

Rule praktis:

> Jika rule bisa diekspresikan sebagai kombinasi statis dari constraint existing, pakai composition.  
> Jika rule membutuhkan logika, dependency, state, atau branching kompleks, pakai custom validator atau domain policy.

---

## 16. Composition vs Domain Value Object

Composition sering dipakai untuk validasi string domain:

```java
@CaseReferenceFormat
String caseReference;
```

Tetapi untuk domain internal, value object sering lebih kuat:

```java
public record CaseReference(String value) {
    public CaseReference {
        Objects.requireNonNull(value, "value");
        if (!value.matches("[A-Z]{3}-\\d{4}-\\d{6}")) {
            throw new IllegalArgumentException("Invalid case reference");
        }
    }
}
```

Layering sehat:

| Layer | Validation style |
|---|---|
| API DTO | annotation/composition untuk input shape |
| Application command | conversion ke value object |
| Domain | constructor invariant/value object |
| Persistence | DB constraints |

Composed constraint menjaga boundary user input. Value object menjaga domain internal. Jangan hanya mengandalkan annotation jika value tersebut menjadi konsep domain penting.

---

## 17. Composition dan Error Code

Tanpa `@ReportAsSingleViolation`, violation bisa berasal dari `@Size` atau `@Pattern`, padahal domain contract yang diinginkan mungkin `CASE_REFERENCE_FORMAT_INVALID`.

Strategi:

### Strategi A — `@ReportAsSingleViolation`

```java
@ReportAsSingleViolation
public @interface CaseReferenceFormat { ... }
```

API mapper melihat violation pada `CaseReferenceFormat`.

### Strategi B — Custom Attribute `code`

```java
public @interface CaseReferenceFormat {
    String message() default "{case.reference.format.invalid}";
    String code() default "CASE_REFERENCE_FORMAT_INVALID";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Kemudian mapper membaca annotation attributes dari `ConstraintDescriptor`.

### Strategi C — Message Key sebagai Code

```java
String message() default "{CASE_REFERENCE_FORMAT_INVALID}";
```

Ini sederhana, tapi mencampur i18n key dan machine code.

### Strategi D — External Registry

```yaml
constraints:
  CaseReferenceFormat:
    code: CASE_REFERENCE_FORMAT_INVALID
    severity: ERROR
    publicMessageKey: case.reference.format.invalid
```

Bagus untuk enterprise governance, tetapi menambah operational complexity.

---

## 18. Composition dan API Path

Composed constraint tidak mengubah path. Jika field gagal:

```java
public record Request(
        @CaseReferenceFormat String caseReference
) {}
```

Path tetap `caseReference`.

Jika dipakai pada container element:

```java
public record Request(
        List<@CaseReferenceFormat String> caseReferences
) {}
```

Path bisa menjadi semacam `caseReferences[2].<list element>`. API mapper sebaiknya menormalisasi menjadi format stabil:

```json
{
  "field": "caseReferences[2]",
  "code": "CASE_REFERENCE_FORMAT_INVALID"
}
```

Jangan mengekspos path internal provider secara mentah jika frontend mengandalkan format tertentu.

---

## 19. Composition dan Groups

Groups pada composed constraint bekerja seperti constraint lain.

```java
public interface SubmitChecks {}

public record SubmitRequest(
        @CaseReferenceFormat(groups = SubmitChecks.class)
        String caseReference
) {}
```

Hindari membuat annotation composition yang hardcode group pada composing constraint:

```java
@NotBlank(groups = Create.class) // hindari kecuali benar-benar sadar
@Size(max = 32)
public @interface SomeConstraint { ... }
```

Ini sulit dipahami, group behavior tersembunyi, reusable annotation menjadi context-specific, dan debugging menjadi sulit. Lebih baik groups diberikan saat annotation dipakai.

---

## 20. Composition dan Payload

Payload bisa dipakai untuk severity atau metadata.

```java
public final class Severity {
    private Severity() {}

    public interface Error extends Payload {}
    public interface Warning extends Payload {}
}
```

Pemakaian:

```java
@CaseReferenceFormat(payload = Severity.Error.class)
String caseReference;
```

Pada composed constraint dengan `@ReportAsSingleViolation`, payload composed constraint lebih mudah dipakai sebagai metadata API. Tanpa single violation, payload yang keluar mungkin berasal dari composing constraint. Ini bisa membuat severity/error code tidak sesuai domain.

---

## 21. Composition dan `TYPE_USE`

Jika annotation tidak menyertakan `ElementType.TYPE_USE`, ini tidak bisa dipakai pada container element:

```java
List<@CaseReferenceFormat String> refs;
```

Untuk Java 8+ modern validation, hampir semua reusable string/value constraint sebaiknya mempertimbangkan `TYPE_USE`.

Template target modern:

```java
@Target({
        ElementType.FIELD,
        ElementType.METHOD,
        ElementType.PARAMETER,
        ElementType.ANNOTATION_TYPE,
        ElementType.TYPE_USE
})
```

Tambahkan `ElementType.RECORD_COMPONENT` hanya jika target compile dan runtime mendukungnya. Untuk library yang harus compile di Java 8, jangan gunakan enum constant yang tidak ada di Java 8.

---

## 22. Composition dan Records

Record:

```java
public record CaseSearchRequest(
        @CaseReferenceFormat String caseReference
) {}
```

Constraint pada record component diproses oleh provider modern sesuai dukungan Jakarta Validation/Hibernate Validator versi baru. Jakarta Validation 3.1 mengklarifikasi record validation.

Namun untuk compatibility, cek Java version, Jakarta Validation API version, Hibernate Validator version, framework integration, compiler target, dan reflection metadata.

Jika ragu, tulis integration test:

```java
Set<ConstraintViolation<CaseSearchRequest>> violations =
        validator.validate(new CaseSearchRequest("invalid"));

assertThat(violations).isNotEmpty();
```

Jangan asumsikan annotation pada record component bekerja sama di semua kombinasi legacy stack.

---

## 23. Composition dan Repeatable Annotation

Jika composed constraint ingin repeatable:

```java
@Repeatable(Codes.class)
public @interface Code { ... }
```

Container:

```java
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
public @interface Codes {
    Code[] value();
}
```

Namun repeatable composed constraint sering jarang perlu. Jika satu field butuh dua `@Code` dengan parameter berbeda, mungkin modeling-nya kurang jelas.

---

## 24. Composition dan Documentation

Composed constraint adalah dokumentasi executable. Tetapi dokumentasi harus jujur.

Buruk:

```java
@ValidAddress
String postalCode;
```

Jika rule hanya:

```java
@Pattern(regexp = "\\d{6}")
```

Nama `@ValidAddress` menipu. Ia tidak memvalidasi alamat.

Naming rule:

| Nama | Meaning |
|---|---|
| `...Format` | hanya syntactic format |
| `...Reference` | format/reference shape, belum tentu exists |
| `Existing...` | membutuhkan lookup; jangan pakai pure composition |
| `Allowed...` | policy/authorization; biasanya bukan composition |
| `Verified...` | menyiratkan external validation; hindari jika tidak benar |
| `Required...` | menyiratkan non-null/non-blank |

---

## 25. Composition dan Security

Composition bisa membantu security, tetapi juga bisa memberi rasa aman palsu.

Validation bukan sanitization. Composition seperti:

```java
@Pattern(regexp = "[a-zA-Z0-9 ]+")
```

bukan jaminan aman dari XSS/SQL injection. Output encoding, content security policy, sanitizer yang benar, parameterized query, dan context-specific escaping tetap diperlukan.

Composition sering membungkus regex. Regex yang buruk bisa menjadi DoS vector. Guideline:

1. gunakan regex sederhana;
2. batasi panjang input dengan `@Size` sebelum regex;
3. hindari nested quantifier berbahaya;
4. test worst-case input;
5. pertimbangkan parser manual untuk format kompleks.

Dengan composition tanpa `@ReportAsSingleViolation`, response juga bisa membocorkan detail internal, misalnya regex password. Untuk security-sensitive rules, gunakan stable public message.

---

## 26. Composition dan Performance

Composed constraint mengevaluasi beberapa constraint. Untuk satu field, biasanya murah. Tetapi di hot path, batch import, atau nested collection besar, cost bisa signifikan.

Cost factors:

- jumlah composing constraints;
- regex complexity;
- message interpolation;
- path construction;
- number of elements;
- fail-fast or not;
- `@ReportAsSingleViolation` stopping behavior;
- group sequence;
- cascaded validation graph size.

Guideline:

1. Selalu pasang size limit untuk string yang divalidasi regex.
2. Hindari regex mahal di element constraint batch besar.
3. Untuk import, pisahkan cheap validation dan expensive validation.
4. Gunakan metrics untuk top failing/top expensive rules.
5. Jangan membuat `ValidatorFactory` per request.

---

## 27. Composition dalam Shared Library

Di enterprise, tim sering membuat shared validation library. Composed constraints cocok untuk shared library jika rule benar-benar cross-module, semantics stabil, ownership jelas, versioning jelas, error code stabil, dan migration policy jelas.

Contoh cocok:

- `@IsoCountryCodeFormat`
- `@CurrencyCodeFormat`
- `@CaseReferenceFormat`
- `@PublicOfficerIdFormat`
- `@DocumentReferenceFormat`

Contoh tidak cocok:

- `@CanApproveCase`
- `@HasValidOutstandingComplianceStatus`
- `@AllowedForSeniorOfficer`
- `@ValidForRenewalSubmission`

Itu workflow/domain policy, bukan generic validation composition.

---

## 28. Composition dan Versioning Rule

Rule format bisa berubah. Jika `@CaseReferenceFormat` diubah langsung, endpoint lama bisa reject data lama, import legacy gagal, event replay gagal, database existing data dianggap invalid, FE contract berubah, dan tests banyak gagal.

Strategi:

1. **Versioned constraint**: `@CaseReferenceFormatV1`, `@CaseReferenceFormatV2`.
2. **Permissive constraint + domain policy**: annotation menerima V1 dan V2, lalu domain/service menentukan mana yang boleh untuk operation tertentu.
3. **Group-based versioning**: pakai group `ApiV1` dan `ApiV2`, tetapi rawan kompleks.
4. **External rule registry**: rule version disimpan di metadata dan mapper/audit mencatat rule version.

---

## 29. Composition untuk Soft Validation

Kadang rule baru tidak langsung blocking. Misalnya minggu pertama log warning, minggu kedua tampilkan warning, minggu ketiga reject new submission, minggu keempat reject semua channel.

Bean Validation secara default menghasilkan violation yang dianggap failure. Untuk warning, ada beberapa strategi:

### 29.1 Separate Warning Group

```java
public interface WarningChecks {}

@NewPostalCodePolicy(groups = WarningChecks.class)
String postalCode;
```

Flow:

```java
Set<ConstraintViolation<Request>> blocking = validator.validate(request, Default.class);
Set<ConstraintViolation<Request>> warnings = validator.validate(request, WarningChecks.class);
```

### 29.2 Payload Severity

```java
@NewPostalCodePolicy(payload = Severity.Warning.class)
String postalCode;
```

Default validate tetap menghasilkan violation. Mapper yang menentukan apakah blocking atau non-blocking.

### 29.3 Domain Policy Engine

Untuk soft rollout yang serius, domain policy object lebih eksplisit daripada annotation.

---

## 30. Composition dan XML/Programmatic Mapping

Constraint composition biasanya annotation-based. Tetapi di sistem legacy/generated model, constraint bisa datang dari XML/programmatic mapping. Jika composed constraint dipakai di mapping eksternal, pastikan annotation tersedia di runtime classpath, metadata API membaca constraint sesuai ekspektasi, error mapper memahami annotation custom, native-image/AOT reflection metadata tersedia jika diperlukan, dan generated docs tahu cara menampilkan composed constraint.

Jika rule externalized sudah sangat dinamis, composition mungkin bukan pusat arsitektur. Gunakan programmatic mapping atau domain policy registry.

---

## 31. Production Example: Case Management Validation Library

Struktur package:

```text
com.example.validation
  ├─ constraints
  │   ├─ CaseReferenceFormat.java
  │   ├─ RequiredCaseReference.java
  │   ├─ SingaporePostalCodeFormat.java
  │   ├─ OfficerIdFormat.java
  │   ├─ TemplateCode.java
  │   └─ DocumentReferenceFormat.java
  ├─ payload
  │   └─ Severity.java
  ├─ codes
  │   └─ ValidationErrorCodes.java
  └─ metadata
      └─ PublicConstraintMetadata.java
```

Example annotation:

```java
@Documented
@Constraint(validatedBy = {})
@Target({ ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER, ElementType.TYPE_USE })
@Retention(RetentionPolicy.RUNTIME)
@Size(min = 15, max = 15)
@Pattern(regexp = "[A-Z]{3}-\\d{4}-\\d{6}")
@ReportAsSingleViolation
public @interface CaseReferenceFormat {
    String message() default "{case.reference.format.invalid}";

    String code() default "CASE_REFERENCE_FORMAT_INVALID";

    String ruleId() default "CASE-REF-FORMAT";

    String ruleVersion() default "1.0";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

API error mapper extracts:

```java
private static String errorCode(ConstraintViolation<?> violation) {
    ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();
    Object code = descriptor.getAttributes().get("code");
    if (code instanceof String value && !value.isBlank()) {
        return value;
    }
    return descriptor.getAnnotation().annotationType().getSimpleName();
}
```

Response:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "traceId": "01J...",
  "violations": [
    {
      "field": "caseReference",
      "code": "CASE_REFERENCE_FORMAT_INVALID",
      "message": "Case reference format is invalid.",
      "ruleId": "CASE-REF-FORMAT",
      "ruleVersion": "1.0"
    }
  ]
}
```

---

## 32. Testing Composed Constraints

Test bukan hanya “valid/invalid”. Test harus memastikan semantics composition.

### 32.1 Basic Validation Test

```java
class CaseReferenceFormatTest {
    private static Validator validator;

    @BeforeAll
    static void setup() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    record Request(@CaseReferenceFormat String caseReference) {}

    @Test
    void acceptsValidReference() {
        var violations = validator.validate(new Request("CAS-2026-000123"));
        assertThat(violations).isEmpty();
    }

    @Test
    void rejectsInvalidReference() {
        var violations = validator.validate(new Request("bad"));
        assertThat(violations).hasSize(1);
    }
}
```

### 32.2 Null Semantics Test

```java
@Test
void allowsNullWhenOnlyFormatConstraint() {
    var violations = validator.validate(new Request(null));
    assertThat(violations).isEmpty();
}
```

Jika test ini gagal, berarti annotation mengandung requiredness.

### 32.3 Single Violation Test

```java
@Test
void reportsSingleViolation() {
    var violations = validator.validate(new Request(""));
    assertThat(violations).hasSize(1);
    assertThat(violations.iterator().next()
            .getConstraintDescriptor()
            .getAnnotation()
            .annotationType())
            .isEqualTo(CaseReferenceFormat.class);
}
```

### 32.4 Metadata Test

```java
@Test
void exposesStableErrorCode() {
    var violation = validator.validate(new Request("bad")).iterator().next();
    assertThat(violation.getConstraintDescriptor().getAttributes())
            .containsEntry("code", "CASE_REFERENCE_FORMAT_INVALID");
}
```

### 32.5 Container Element Test

```java
record BatchRequest(List<@CaseReferenceFormat String> references) {}

@Test
void validatesListElements() {
    var violations = validator.validate(new BatchRequest(List.of("CAS-2026-000123", "bad")));
    assertThat(violations).hasSize(1);
}
```

---

## 33. Common Anti-Patterns

### 33.1 Mega Constraint

```java
@ValidApplicationSubmission
```

Jika annotation ini memvalidasi required fields, applicant identity, address validity, eligibility, outstanding compliance, payment status, document completeness, SLA window, role permission, dan state transition, maka ini bukan composed constraint. Ini workflow/domain policy yang disamarkan.

### 33.2 Misleading Name

```java
@ValidPostalCode
```

Padahal hanya regex enam digit. Gunakan `@PostalCodeFormat`.

### 33.3 Requiredness Dicampur dengan Format

Constraint format yang menyertakan `@NotBlank` dipakai untuk optional filter. Ini menyebabkan filter opsional menjadi required.

### 33.4 Provider-Specific Extension Tanpa Sadar

`@ConstraintComposition(CompositionType.OR)` dipakai di shared library yang mengklaim provider-neutral.

### 33.5 Regex Policy yang Tidak Ditest Worst Case

Composition sering membuat regex tersembunyi di annotation. Jika regex mahal, dampaknya tidak terlihat di call site.

### 33.6 Error Code Berasal dari Built-in Constraint

Domain ingin `CASE_REFERENCE_INVALID`, tetapi API mengembalikan `Pattern` atau `Size`.

### 33.7 Composition untuk Rule yang Butuh Database

`@ExistingCaseReference` jika benar-benar mengecek DB bukan pure composition. Jika hanya format, namanya menipu.

---

## 34. Decision Framework

Gunakan pertanyaan ini sebelum membuat composed constraint:

1. Apakah rule ini murni shape/format/local invariant?
2. Apakah rule ini stabil lintas operation?
3. Apakah rule ini tidak membutuhkan DB/external service?
4. Apakah requiredness-nya sama di semua penggunaan?
5. Apakah annotation name menyatakan meaning dengan jujur?
6. Apakah error code/message stabil?
7. Apakah composition membuat code lebih jelas, bukan lebih tersembunyi?
8. Apakah provider-specific extension acceptable?
9. Apakah rule perlu versioning?
10. Apakah frontend/support/audit butuh detail composing constraint atau single violation?

Jika jawabannya banyak “tidak”, jangan paksa composition.

---

## 35. PR Review Checklist

Saat review composed constraint, cek:

- [ ] Annotation punya `message`, `groups`, `payload`.
- [ ] `@Retention(RUNTIME)` ada.
- [ ] `@Target` sesuai kebutuhan, termasuk `TYPE_USE` jika perlu.
- [ ] `ANNOTATION_TYPE` ada jika constraint boleh dikomposisi lagi.
- [ ] Nama annotation tidak misleading.
- [ ] Null semantics jelas.
- [ ] Requiredness tidak dicampur sembarangan dengan format.
- [ ] `@ReportAsSingleViolation` dipakai/ditinggalkan dengan alasan jelas.
- [ ] Error code stabil tersedia jika API membutuhkan.
- [ ] Regex sederhana dan diberi size bound.
- [ ] Tidak ada DB/external call tersembunyi.
- [ ] Provider-specific extension diberi justifikasi.
- [ ] Unit test mencakup valid, invalid, null, boundary, dan metadata.
- [ ] Container element usage dites jika `TYPE_USE` didukung.
- [ ] Migration `javax`/`jakarta` diperhatikan.
- [ ] Documentation/message catalog diperbarui.

---

## 36. Java 8 sampai Java 25 Notes

### Java 8

Bean Validation 2.0 membawa type-use/container element constraints. `TYPE_USE` sangat relevan. Records belum ada. Jika library harus compile di Java 8, jangan gunakan `ElementType.RECORD_COMPONENT`. Banyak legacy stack masih `javax.validation`.

### Java 11

Banyak enterprise app masih Spring Boot 2.x atau Jakarta EE 8 era. Namespace biasanya masih `javax.validation`. Composition pattern tetap sama.

### Java 17

Baseline penting untuk Jakarta EE 11/Jakarta Validation 3.1 stack modern. Records tersedia dan mulai umum sebagai DTO. Spring Boot 3 menggunakan Jakarta namespace.

### Java 21

Modern LTS untuk production. Records/sealed classes lebih matang sebagai modeling tool. Composition cocok untuk DTO boundary, value object tetap penting untuk domain.

### Java 25

Treat sebagai modern target untuk aplikasi baru. Pattern matching, records, sealed modeling, dan stronger domain types mendorong validation yang lebih eksplisit. Jangan membawa pola Java 8 “semua string + annotation” jika domain value object lebih tepat.

---

## 37. `javax.validation` vs `jakarta.validation`

Versi legacy:

```java
import javax.validation.Constraint;
import javax.validation.Payload;
import javax.validation.ReportAsSingleViolation;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
```

Versi modern:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import jakarta.validation.ReportAsSingleViolation;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
```

Jangan campur namespace:

```java
import jakarta.validation.Constraint;
import javax.validation.constraints.NotBlank; // salah untuk stack modern
```

Mixed namespace bisa membuat annotation tidak diproses, dependency conflict, atau behavior aneh. Migration harus atomic per module atau dikontrol dengan compatibility boundary.

---

## 38. Ringkasan Mental Model

Constraint composition adalah alat untuk membuat validation vocabulary yang lebih tinggi.

Gunakan composition untuk format yang stabil, constraint shape yang reusable, domain vocabulary ringan, error contract yang konsisten, dan mengurangi copy-paste annotation.

Jangan gunakan composition untuk workflow engine, authorization, database existence, external service validation, contextual policy kompleks, atau rule yang sering berubah dan butuh versioning granular.

Pola layering yang sehat:

```text
Transport DTO
  -> composed constraints untuk shape/format
  -> custom constraints untuk local algorithmic checks
  -> application/domain policy untuk contextual business rules
  -> workflow guard untuk state transition
  -> DB constraints untuk final consistency
```

Satu kalimat penting:

> Composed constraint harus membuat rule lebih mudah dipahami, bukan lebih mudah disembunyikan.

---

## 39. Referensi

- Jakarta Validation 3.1 Specification — metadata model, constraint declaration, constraint composition, `ConstraintDescriptor`, `@ReportAsSingleViolation`.
- Bean Validation 2.0 Specification / JSR 380 — Java 8 features, container element constraints, constraint composition model.
- Hibernate Validator Reference Guide — custom constraints, constraint composition, Hibernate-specific composition extension.
- Hibernate Validator 9.x Documentation — Jakarta Validation 3.1 reference implementation for modern Jakarta EE 11 stack.

---

## 40. Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat:

- Part 000 — Orientation: Validation as Contract, Boundary Defense, and Domain Integrity
- Part 001 — Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`
- Part 002 — Core API Mental Model
- Part 003 — Built-in Constraints Deep Dive
- Part 004 — Nullability Strategy
- Part 005 — Cascaded Validation
- Part 006 — Container Element Constraints
- Part 007 — Validation Groups
- Part 008 — Group Sequence and Dynamic Group Sequence
- Part 009 — Custom Constraint Design
- Part 010 — Class-Level and Cross-Field Validation
- Part 011 — Cross-Parameter and Executable Validation
- Part 012 — Records, Immutability, Builders, Lombok, and Modern Java Modeling
- Part 013 — Message Interpolation
- Part 014 — Payload, Severity, Error Codes, and Machine-Readable Violations
- Part 015 — Programmatic Constraint Mapping and Runtime Metadata
- Part 016 — Constraint Composition: Reusable Higher-Level Constraints

Bagian berikutnya:

**Part 017 — Hibernate Validator Extensions: Beyond the Specification**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-015.md">⬅️ Part 015 — Programmatic Constraint Mapping and Runtime Metadata</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-017.md">Hibernate Validator Extensions: Beyond the Specification ➡️</a>
</div>

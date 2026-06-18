# learn-java-validation-jakarta-hibernate-validator-part-002

# Core API Mental Model: `ValidatorFactory`, `Validator`, `ConstraintViolation`, and Metadata

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: 002  
> Target: Java 8 hingga Java 25  
> Fokus: mental model API inti Jakarta/Bean Validation dan Hibernate Validator sebagai engine production-grade

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya, kita sudah membedakan dunia lama `javax.validation` dan dunia modern `jakarta.validation`, serta memahami bahwa “validation” bukan sekadar annotation, tetapi kontrak lintas layer.

Part ini membahas jantung dari Bean/Jakarta Validation:

```text
Validation
  └── ValidatorFactory
        └── Validator
              └── validate(...)
                    └── Set<ConstraintViolation<T>>
```

Di atas kelihatannya sederhana. Namun di sistem besar, pemahaman dangkal terhadap empat objek ini sering menyebabkan:

- factory dibuat berulang-ulang di hot path;
- custom validator tidak thread-safe;
- error response hanya berisi string, bukan data terstruktur;
- violation path salah dipahami;
- validation metadata tidak dimanfaatkan;
- framework integration menjadi “magic” yang tidak bisa di-debug;
- migration `javax` ke `jakarta` menjadi kacau karena classpath campur.

Tujuan part ini adalah membangun mental model yang presisi: **apa yang terjadi ketika `validator.validate(object)` dipanggil, bagaimana hasilnya dibaca, dan bagaimana metadata validation bisa dipakai sebagai arsitektur kontrak.**

---

## 1. Sumber Resmi dan Fakta Dasar

Jakarta Validation adalah spesifikasi Java untuk mengekspresikan constraint pada object model, membuat custom constraint, memvalidasi object graph, memvalidasi parameter/return value method dan constructor, serta melaporkan violation secara terstruktur dan terlokalisasi.[^beanvalidation-home]

Spesifikasi Jakarta Bean Validation 3.0 menyatakan tujuan teknisnya sebagai fasilitas deklarasi constraint level object, runtime validation, metadata repository/query API, dan method/constructor validation.[^jakarta-spec-30]

Hibernate Validator adalah reference implementation dari Jakarta Validation. Hibernate Validator 9.x menargetkan Jakarta Validation 3.1 / Jakarta EE 11, dan pada stack tersebut minimum Java version adalah Java 17.[^hv-90]

Jakarta Validation 3.1 menetapkan minimum Java version 17, mengganti nama spesifikasi dari Jakarta Bean Validation menjadi Jakarta Validation, dan mengklarifikasi validasi Java records.[^bv31-news]

[^beanvalidation-home]: Jakarta Validation home, beanvalidation.org, “What is Jakarta Validation”. https://beanvalidation.org/
[^jakarta-spec-30]: Jakarta Bean Validation 3.0 Specification, Introduction. https://jakarta.ee/specifications/bean-validation/3.0/jakarta-bean-validation-spec-3.0.html
[^hv-90]: Hibernate Validator 9.0 release notes. https://hibernate.org/validator/releases/9.0/
[^bv31-news]: Bean Validation news, “Jakarta Validation 3.1 specification”. https://beanvalidation.org/news/2025/02/17/bean-validation-3-1/

---

## 2. Mental Model Utama: Validation Engine Bukan Sekadar Reflection Utility

Banyak engineer melihat Bean Validation seperti ini:

```java
Set<ConstraintViolation<UserRequest>> violations = validator.validate(request);
```

Lalu disimpulkan:

> “Validator membaca annotation lalu mengembalikan error.”

Itu benar secara permukaan, tetapi tidak cukup untuk sistem production.

Mental model yang lebih tepat:

```text
Validated object
  ├── class metadata
  ├── property metadata
  ├── constraint descriptors
  ├── group selection
  ├── group sequence ordering
  ├── cascaded graph traversal
  ├── container element extraction
  ├── constraint validator resolution
  ├── message interpolation
  ├── path construction
  └── violation set
```

Dengan kata lain, Bean/Jakarta Validation adalah kombinasi dari:

1. **declarative constraint model** — constraint dinyatakan sebagai annotation atau programmatic mapping;
2. **runtime validation engine** — engine memilih constraint yang aktif, mengeksekusi validator, dan mengumpulkan violation;
3. **metadata repository** — constraint bisa diinspeksi melalui API;
4. **message interpolation system** — template error menjadi pesan final;
5. **object graph traversal engine** — `@Valid`, container element, nested object;
6. **executable validation engine** — method/constructor parameter dan return value;
7. **provider SPI** — integrasi message interpolator, traversable resolver, constraint validator factory, value extractor, clock provider, dan lain-lain.

Ini penting karena keputusan arsitektur tidak bisa dibuat hanya dengan tahu `@NotNull`.

---

## 3. API Core: Peta Objek yang Harus Dikuasai

Secara praktis, API core dapat dipetakan seperti ini:

```text
jakarta.validation.Validation
  └── bootstrap entry point

jakarta.validation.ValidatorFactory
  ├── expensive, application-scoped
  ├── owns provider configuration
  ├── creates Validator
  ├── exposes MessageInterpolator, TraversableResolver, ConstraintValidatorFactory
  └── must be closed when no longer needed

jakarta.validation.Validator
  ├── usually reused
  ├── validates object, property, value
  ├── exposes ExecutableValidator
  └── exposes metadata API

jakarta.validation.ConstraintViolation<T>
  ├── describes one failed constraint
  ├── contains root bean, leaf bean, invalid value
  ├── contains message/template
  ├── contains property path
  └── contains ConstraintDescriptor

jakarta.validation.Path
  └── structured location of violation

jakarta.validation.metadata.*
  ├── BeanDescriptor
  ├── PropertyDescriptor
  ├── MethodDescriptor
  ├── ConstructorDescriptor
  ├── ParameterDescriptor
  ├── ReturnValueDescriptor
  ├── ContainerElementTypeDescriptor
  └── ConstraintDescriptor
```

Kalau Anda ingin menjadi kuat di validation, hafalan annotation tidak cukup. Anda harus memahami **data structure yang dihasilkan engine**.

---

## 4. `Validation`: Bootstrap Entry Point

`Validation` adalah entry point untuk membuat `ValidatorFactory`.

Contoh paling sederhana:

```java
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;

try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
    Validator validator = factory.getValidator();
}
```

Untuk dunia lama Java 8 / Bean Validation 2.0, package-nya:

```java
import javax.validation.Validation;
import javax.validation.Validator;
import javax.validation.ValidatorFactory;
```

Secara mental model, `Validation.buildDefaultValidatorFactory()` melakukan beberapa hal:

```text
1. Temukan Bean/Jakarta Validation provider dari classpath.
2. Baca konfigurasi default jika ada.
3. Bangun provider-specific ValidatorFactory.
4. Siapkan metadata, resolver, interpolator, validator factory, dan integrasi lain.
```

### 4.1 Kenapa Bootstrap Penting?

Karena bootstrap bukan operasi gratis.

Kesalahan umum:

```java
public Set<ConstraintViolation<UserRequest>> validate(UserRequest request) {
    ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
    Validator validator = factory.getValidator();
    return validator.validate(request);
}
```

Ini buruk karena setiap request akan membangun ulang factory. Dalam service dengan traffic tinggi, pola ini bisa menyebabkan:

- startup-like cost berulang;
- metadata discovery berulang;
- provider initialization berulang;
- object allocation tidak perlu;
- sulit mengelola lifecycle;
- potensi resource leak jika factory tidak ditutup.

Pola yang benar:

```java
public final class ValidationSupport implements AutoCloseable {
    private final ValidatorFactory factory;
    private final Validator validator;

    public ValidationSupport() {
        this.factory = Validation.buildDefaultValidatorFactory();
        this.validator = factory.getValidator();
    }

    public Validator validator() {
        return validator;
    }

    @Override
    public void close() {
        factory.close();
    }
}
```

Di framework seperti Spring Boot, Quarkus, Micronaut, atau Jakarta EE container, factory/validator biasanya dibuat oleh container. Anda tidak perlu membuatnya manual untuk setiap use case.

---

## 5. `ValidatorFactory`: Application-Level Engine Configuration

`ValidatorFactory` adalah objek level aplikasi. Ia menyimpan konfigurasi provider dan membuat `Validator`.

Secara konseptual:

```text
ValidatorFactory
  ├── provider implementation
  ├── constraint metadata cache
  ├── message interpolator
  ├── traversable resolver
  ├── constraint validator factory
  ├── parameter name provider
  ├── clock provider
  ├── value extractors
  ├── fail-fast mode/provider options
  └── mapping configuration
```

### 5.1 Sifat `ValidatorFactory`

Prinsip production:

```text
ValidatorFactory dibuat sedikit mungkin, biasanya satu per application context.
ValidatorFactory ditutup saat aplikasi shutdown.
ValidatorFactory bukan objek per request.
```

Dalam aplikasi Java SE:

```java
public final class AppValidation {
    private static final ValidatorFactory FACTORY = Validation.buildDefaultValidatorFactory();
    private static final Validator VALIDATOR = FACTORY.getValidator();

    private AppValidation() {}

    public static Validator validator() {
        return VALIDATOR;
    }

    public static void shutdown() {
        FACTORY.close();
    }
}
```

Dalam Spring:

```java
@Service
public class UserCommandValidator {
    private final Validator validator;

    public UserCommandValidator(Validator validator) {
        this.validator = validator;
    }

    public void validateOrThrow(CreateUserCommand command) {
        Set<ConstraintViolation<CreateUserCommand>> violations = validator.validate(command);
        if (!violations.isEmpty()) {
            throw new InvalidCommandException(violations);
        }
    }
}
```

### 5.2 Kapan Perlu Lebih dari Satu `ValidatorFactory`?

Biasanya jarang. Namun bisa diperlukan jika:

- tenant berbeda punya programmatic mapping berbeda;
- mode fail-fast berbeda secara sengaja;
- message interpolator berbeda;
- value extractor berbeda;
- Anda sedang menulis framework/library;
- Anda perlu isolasi konfigurasi untuk test.

Tetapi hati-hati: banyak factory berarti banyak metadata/configuration context.

Decision rule:

```text
Jika perbedaannya hanya group, gunakan group.
Jika perbedaannya hanya locale, gunakan locale context/message interpolation, bukan factory baru.
Jika perbedaannya hanya operation create/update, gunakan group atau DTO berbeda.
Jika perbedaannya benar-benar provider configuration, baru pertimbangkan factory berbeda.
```

---

## 6. `Validator`: Runtime Validation Facade

`Validator` adalah facade utama yang Anda gunakan untuk menjalankan validation.

Method penting:

```java
<T> Set<ConstraintViolation<T>> validate(T object, Class<?>... groups);

<T> Set<ConstraintViolation<T>> validateProperty(
    T object,
    String propertyName,
    Class<?>... groups
);

<T> Set<ConstraintViolation<T>> validateValue(
    Class<T> beanType,
    String propertyName,
    Object value,
    Class<?>... groups
);

BeanDescriptor getConstraintsForClass(Class<?> clazz);

ExecutableValidator forExecutables();
```

### 6.1 `validate(object)`

Ini memvalidasi bean secara keseluruhan:

```java
Set<ConstraintViolation<CreateUserRequest>> violations =
    validator.validate(request);
```

Yang diperiksa:

- constraints di class;
- constraints di field/getter sesuai access strategy;
- cascaded validation via `@Valid`;
- container element constraints;
- group yang dipilih;
- default group jika group tidak diberikan.

### 6.2 `validate(object, Group.class)`

```java
Set<ConstraintViolation<CreateUserRequest>> violations =
    validator.validate(request, Create.class);
```

Ini penting untuk operation-specific contract. Namun part group akan dibahas khusus nanti.

Prinsip awal:

```text
Group memilih constraint mana yang aktif.
Group bukan workflow engine.
```

### 6.3 `validateProperty(object, propertyName)`

Contoh:

```java
Set<ConstraintViolation<UserProfile>> violations =
    validator.validateProperty(profile, "email");
```

Ini memvalidasi property tertentu dari object instance.

Use case:

- UI field-level validation;
- admin form partial validation;
- debugging;
- framework binding.

Namun hati-hati: validasi property tidak sama dengan validasi object penuh.

Jika ada class-level constraint seperti:

```java
@ValidDateRange(start = "startDate", end = "endDate")
public class PeriodRequest {
    private LocalDate startDate;
    private LocalDate endDate;
}
```

maka `validateProperty(request, "startDate")` tidak cukup untuk menjamin date range valid.

### 6.4 `validateValue(beanType, propertyName, value)`

Contoh:

```java
Set<ConstraintViolation<UserProfile>> violations =
    validator.validateValue(UserProfile.class, "email", "not-an-email");
```

Ini memvalidasi value tanpa membuat object instance.

Use case:

- live field validation;
- generated UI form;
- pre-validation sebelum binding object;
- validation service untuk satu field.

Keterbatasan:

- tidak bisa mengevaluasi constraint yang butuh state object lain;
- tidak menjalankan class-level constraint;
- tidak cocok untuk business invariant.

---

## 7. `ConstraintViolation<T>`: Error Itu Data, Bukan String

Hasil validation adalah:

```java
Set<ConstraintViolation<T>>
```

Setiap `ConstraintViolation` merepresentasikan satu constraint yang gagal.

Informasi penting di dalamnya:

```java
violation.getMessage();              // pesan final setelah interpolation
violation.getMessageTemplate();      // template asli, misalnya "{jakarta.validation.constraints.NotNull.message}"
violation.getRootBean();             // object root yang divalidasi
violation.getRootBeanClass();        // class root
violation.getLeafBean();             // bean tempat constraint gagal
violation.getInvalidValue();         // value yang gagal
violation.getPropertyPath();         // structured path
violation.getConstraintDescriptor(); // metadata constraint
```

Untuk executable validation juga ada:

```java
violation.getExecutableParameters();
violation.getExecutableReturnValue();
```

API `ConstraintViolation` Jakarta Validation 3.1 memang menyediakan akses untuk parameter executable dan return value ketika violation berasal dari validasi method/constructor.[^constraintviolation-api]

[^constraintviolation-api]: Jakarta Validation API 3.1, `ConstraintViolation`. https://jakarta.ee/specifications/bean-validation/3.1/apidocs/jakarta/validation/constraintviolation

### 7.1 Kesalahan Umum: Hanya Mengambil Message

Anti-pattern:

```java
List<String> errors = violations.stream()
    .map(ConstraintViolation::getMessage)
    .toList();
```

Ini kehilangan hampir semua informasi penting:

- field mana yang salah;
- constraint apa yang gagal;
- rejected value apa;
- group apa;
- payload/severity apa;
- message template apa;
- machine-readable code apa;
- container element path apa;
- method parameter mana yang gagal.

Pola lebih baik:

```java
public record ValidationError(
    String path,
    String message,
    String messageTemplate,
    String constraint,
    Object rejectedValue
) {}

public static List<ValidationError> toErrors(Set<? extends ConstraintViolation<?>> violations) {
    return violations.stream()
        .map(v -> new ValidationError(
            v.getPropertyPath().toString(),
            v.getMessage(),
            v.getMessageTemplate(),
            v.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName(),
            safeRejectedValue(v.getInvalidValue())
        ))
        .toList();
}

private static Object safeRejectedValue(Object value) {
    if (value == null) return null;
    if (value instanceof CharSequence s && s.length() > 128) {
        return s.subSequence(0, 128) + "...";
    }
    return value;
}
```

Catatan: dalam sistem yang memproses PII, `rejectedValue` jangan sembarang dikembalikan ke client atau log. Kita akan bahas di part security.

---

## 8. Membaca `Path`: Lokasi Violation Secara Terstruktur

`getPropertyPath()` bukan sekadar string. Ia adalah structured path yang terdiri dari node.

Contoh DTO:

```java
public class CreateApplicationRequest {
    @NotBlank
    private String applicantName;

    @Valid
    private Address address;

    @Valid
    private List<DocumentRequest> documents;

    private Map<@NotBlank String, @Valid ContactPerson> contactsByRole;
}
```

Jika `applicantName` kosong:

```text
applicantName
```

Jika `address.postalCode` invalid:

```text
address.postalCode
```

Jika document index ke-2 invalid:

```text
documents[2].fileName
```

Jika map value invalid:

```text
contactsByRole[director].email
```

Jika map key invalid:

```text
contactsByRole<K>[].<map key>
```

Format string bisa terlihat berbeda tergantung provider/version dan node type. Karena itu untuk API serius, sebaiknya pahami node-nya, bukan hanya `toString()`.

### 8.1 Iterasi Path Node

```java
for (Path.Node node : violation.getPropertyPath()) {
    System.out.println("name=" + node.getName());
    System.out.println("kind=" + node.getKind());
    System.out.println("inIterable=" + node.isInIterable());
    System.out.println("index=" + node.getIndex());
    System.out.println("key=" + node.getKey());
}
```

Node bisa merepresentasikan:

- bean;
- property;
- method;
- constructor;
- parameter;
- return value;
- cross-parameter;
- container element.

### 8.2 Kenapa Ini Penting untuk API Error Contract?

Misalnya frontend punya form nested:

```json
{
  "documents": [
    { "type": "ID", "fileName": "ktp.pdf" },
    { "type": "LICENSE", "fileName": "" }
  ]
}
```

Jika backend hanya mengirim:

```json
{
  "message": "must not be blank"
}
```

Frontend tidak tahu field mana yang harus diberi error.

Better:

```json
{
  "errors": [
    {
      "path": "documents[1].fileName",
      "code": "NotBlank",
      "message": "must not be blank"
    }
  ]
}
```

Even better untuk sistem enterprise:

```json
{
  "type": "https://example.gov/errors/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "traceId": "01HZY...",
  "errors": [
    {
      "path": "documents[1].fileName",
      "field": "fileName",
      "container": "documents",
      "index": 1,
      "code": "DOCUMENT_FILE_NAME_REQUIRED",
      "constraint": "NotBlank",
      "message": "Document file name is required."
    }
  ]
}
```

---

## 9. `ConstraintDescriptor`: Metadata dari Constraint yang Gagal

`ConstraintViolation#getConstraintDescriptor()` memberi akses ke metadata constraint.

Contoh:

```java
ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();

Annotation annotation = descriptor.getAnnotation();
Map<String, Object> attributes = descriptor.getAttributes();
Set<Class<?>> groups = descriptor.getGroups();
Set<Class<? extends Payload>> payload = descriptor.getPayload();
List<Class<? extends ConstraintValidator<?, ?>>> validators = descriptor.getConstraintValidatorClasses();
```

Jika constraint-nya:

```java
@Size(min = 8, max = 64)
private String password;
```

Maka `attributes` dapat berisi:

```text
min=8
max=64
message={jakarta.validation.constraints.Size.message}
groups=[]
payload=[]
```

### 9.1 Kenapa Metadata Penting?

Karena Anda bisa membuat validation response yang tidak bergantung pada parsing string.

Anti-pattern:

```java
if (violation.getMessage().contains("must not be blank")) {
    code = "REQUIRED";
}
```

Better:

```java
String constraintName = violation
    .getConstraintDescriptor()
    .getAnnotation()
    .annotationType()
    .getSimpleName();

// NotBlank, Size, Pattern, Email, ValidPostalCode, etc.
```

Untuk custom constraint, Anda bisa desain annotation agar memiliki `code`:

```java
@Documented
@Constraint(validatedBy = ValidCaseReferenceValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface ValidCaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    String code() default "CASE_REFERENCE_INVALID";
}
```

Lalu saat violation:

```java
Object code = violation.getConstraintDescriptor()
    .getAttributes()
    .get("code");
```

Ini jauh lebih stabil daripada parsing human message.

---

## 10. Metadata API: `getConstraintsForClass()`

Validator juga bisa digunakan untuk membaca constraint metadata tanpa memvalidasi instance.

```java
BeanDescriptor descriptor = validator.getConstraintsForClass(CreateUserRequest.class);
```

Dari `BeanDescriptor`, Anda bisa membaca:

- apakah class memiliki constraints;
- property mana yang constrained;
- class-level constraints;
- method constraints;
- constructor constraints;
- container element constraints.

Contoh:

```java
BeanDescriptor bean = validator.getConstraintsForClass(CreateUserRequest.class);

for (PropertyDescriptor property : bean.getConstrainedProperties()) {
    System.out.println(property.getPropertyName());

    for (ConstraintDescriptor<?> constraint : property.getConstraintDescriptors()) {
        System.out.println(constraint.getAnnotation().annotationType().getSimpleName());
        System.out.println(constraint.getAttributes());
    }
}
```

### 10.1 Use Case Metadata API

Metadata API berguna untuk:

- generate form rules;
- generate API documentation;
- enforce architecture test;
- validate consistency antara DTO dan OpenAPI;
- membuat validation catalog;
- membuat governance dashboard;
- introspeksi rule saat troubleshooting;
- menulis test yang memastikan field tertentu punya constraint tertentu;
- mendeteksi constraint drift antar module.

Contoh architecture test:

```java
@Test
void createApplicationRequest_mustRequireApplicantName() {
    BeanDescriptor bean = validator.getConstraintsForClass(CreateApplicationRequest.class);

    PropertyDescriptor applicantName = bean.getConstraintsForProperty("applicantName");

    assertThat(applicantName.getConstraintDescriptors())
        .anyMatch(c -> c.getAnnotation().annotationType().equals(NotBlank.class));
}
```

Ini bukan pengganti behavior test, tetapi bisa berguna untuk aturan enterprise tertentu.

---

## 11. End-to-End Example: Dari DTO ke Violation Model

### 11.1 DTO

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public class CreateCaseRequest {

    @NotBlank(message = "{case.applicantName.required}")
    @Size(max = 120, message = "{case.applicantName.tooLong}")
    private String applicantName;

    @Email(message = "{case.email.invalid}")
    private String email;

    @Valid
    private AddressRequest address;

    @NotEmpty(message = "{case.documents.required}")
    private List<@Valid DocumentRequest> documents;

    // getters/setters omitted
}
```

```java
public class AddressRequest {
    @NotBlank(message = "{address.postalCode.required}")
    @Size(min = 6, max = 6, message = "{address.postalCode.length}")
    private String postalCode;

    // getters/setters omitted
}
```

```java
public class DocumentRequest {
    @NotBlank(message = "{document.type.required}")
    private String type;

    @NotBlank(message = "{document.fileName.required}")
    private String fileName;

    // getters/setters omitted
}
```

### 11.2 Validation

```java
Set<ConstraintViolation<CreateCaseRequest>> violations =
    validator.validate(request);
```

### 11.3 Mapping ke API Error

```java
public record ApiValidationError(
    String path,
    String code,
    String constraint,
    String message
) {}

public final class ValidationErrorMapper {

    public static List<ApiValidationError> map(Set<? extends ConstraintViolation<?>> violations) {
        return violations.stream()
            .map(ValidationErrorMapper::mapOne)
            .sorted(Comparator.comparing(ApiValidationError::path))
            .toList();
    }

    private static ApiValidationError mapOne(ConstraintViolation<?> violation) {
        String constraint = violation.getConstraintDescriptor()
            .getAnnotation()
            .annotationType()
            .getSimpleName();

        String code = toErrorCode(violation, constraint);

        return new ApiValidationError(
            violation.getPropertyPath().toString(),
            code,
            constraint,
            violation.getMessage()
        );
    }

    private static String toErrorCode(ConstraintViolation<?> violation, String constraint) {
        String path = violation.getPropertyPath().toString()
            .replaceAll("\\[[^]]*]", "")
            .replace('.', '_')
            .toUpperCase(Locale.ROOT);

        return path + "_" + constraint.toUpperCase(Locale.ROOT);
    }
}
```

Output contoh:

```json
{
  "errors": [
    {
      "path": "address.postalCode",
      "code": "ADDRESS_POSTALCODE_SIZE",
      "constraint": "Size",
      "message": "Postal code must contain exactly 6 characters."
    },
    {
      "path": "documents[0].fileName",
      "code": "DOCUMENTS_FILENAME_NOTBLANK",
      "constraint": "NotBlank",
      "message": "Document file name is required."
    }
  ]
}
```

Catatan: kode di atas hanya contoh. Dalam sistem besar, error code sebaiknya dikontrol eksplisit, bukan digenerate sepenuhnya dari path.

---

## 12. Lifecycle and Thread-Safety Mental Model

### 12.1 Apa yang Aman Di-share?

Prinsip umum:

```text
ValidatorFactory: share application-wide.
Validator: share/reuse, biasanya aman digunakan oleh banyak thread.
ConstraintValidator: provider dapat cache/reuse; implementasi Anda harus thread-safe.
ConstraintViolation: hasil immutable-ish per validation call, jangan dimutasi.
```

Validator custom sering menjadi sumber bug.

Anti-pattern:

```java
public class UniqueEmailValidator implements ConstraintValidator<UniqueEmail, String> {
    private String lastCheckedEmail;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        this.lastCheckedEmail = value;
        return value == null || !repository.existsByEmail(value);
    }
}
```

Masalah:

- state mutable di validator;
- validator bisa dipakai lintas thread;
- `lastCheckedEmail` tidak punya manfaat;
- validasi uniqueness via DB punya race condition.

Better:

```java
public class NormalizedEmailValidator implements ConstraintValidator<NormalizedEmail, String> {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return value.equals(value.trim().toLowerCase(Locale.ROOT));
    }
}
```

Custom validator idealnya:

- stateless;
- deterministic;
- no side effect;
- no network call;
- no database write;
- dependency-free jika memungkinkan;
- predictable cost.

### 12.2 Bolehkah Validator Menggunakan Dependency Injection?

Bisa, tetapi harus hati-hati. Integrasi Spring/CDI biasanya menyediakan `ConstraintValidatorFactory` sendiri. API `ConstraintValidatorFactory` bertugas membuat dan melepas instance `ConstraintValidator`.[^constraintvalidatorfactory-api]

[^constraintvalidatorfactory-api]: Jakarta Validation API, `ConstraintValidatorFactory`. https://jakarta.ee/specifications/platform/9/apidocs/jakarta/validation/constraintvalidatorfactory

Namun top-tier rule:

```text
Jangan membuat annotation validator menjadi tempat seluruh business logic.
```

Jika validator memanggil database, remote API, atau workflow service, tanyakan:

- Apakah hasilnya deterministic?
- Apakah aman secara transaction isolation?
- Apakah ada race condition?
- Apakah validasi harus retry?
- Apakah validasi ini seharusnya command handler rule?
- Apakah database constraint tetap dibutuhkan?

---

## 13. `ConstraintValidator`: Bagaimana Engine Mengeksekusi Constraint

Custom constraint biasanya terdiri dari dua bagian:

```text
Annotation constraint
  └── ConstraintValidator implementation
```

Contoh annotation:

```java
@Documented
@Constraint(validatedBy = CaseReferenceValidator.class)
@Target({ FIELD, METHOD, PARAMETER, TYPE_USE })
@Retention(RUNTIME)
public @interface CaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class CaseReferenceValidator
        implements ConstraintValidator<CaseReference, String> {

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

### 13.1 Kenapa `null` Sering Dianggap Valid?

Dalam Bean/Jakarta Validation, constraint seperti `@Email`, `@Size`, atau custom format validator umumnya membiarkan `null` valid. Requiredness dipisahkan memakai `@NotNull` atau `@NotBlank`.

Contoh:

```java
@Email
private String secondaryEmail;
```

Artinya:

```text
Jika secondaryEmail ada, harus email valid.
Jika null, tidak masalah.
```

Jika wajib:

```java
@NotBlank
@Email
private String primaryEmail;
```

Pemisahan ini penting karena:

- format rule berbeda dari requiredness rule;
- optional field tetap bisa divalidasi jika diisi;
- partial update lebih fleksibel;
- error message lebih akurat.

---

## 14. Validation Groups dari Perspektif Core API

Walaupun groups dibahas detail pada part khusus, di core API kita harus tahu bahwa `validate` menerima varargs group.

```java
validator.validate(command, Draft.class);
validator.validate(command, Submit.class);
validator.validate(command, Approval.class);
```

Jika tidak ada group diberikan:

```java
validator.validate(command);
```

maka yang digunakan adalah `Default` group.

Mental model:

```text
Object sama.
Constraint sama.
Group berbeda.
Kontrak aktif berbeda.
```

Contoh:

```java
public interface Draft {}
public interface Submit {}

public class ApplicationCommand {
    @NotBlank(groups = Submit.class)
    private String applicantName;

    @NotBlank(groups = Submit.class)
    private String declarationAccepted;
}
```

Draft boleh incomplete. Submit tidak.

Namun jangan menyalahgunakan group untuk seluruh state machine:

```text
DraftGroup
SubmittedGroup
AssignedGroup
ClarificationRequestedGroup
ClarificationRespondedGroup
AssessmentCompletedGroup
ApprovedGroup
RejectedGroup
AppealedGroup
...
```

Jika mulai seperti itu, kemungkinan besar Anda sedang membuat workflow engine di atas Bean Validation. Itu akan dibahas di part workflow.

---

## 15. Executable Validation: `forExecutables()`

`Validator#forExecutables()` mengembalikan `ExecutableValidator`, yang dipakai untuk validasi method/constructor.

Contoh manual:

```java
ExecutableValidator executableValidator = validator.forExecutables();

Method method = CaseService.class.getMethod("assignCase", String.class, String.class);

Set<ConstraintViolation<CaseService>> violations = executableValidator.validateParameters(
    caseService,
    method,
    new Object[] { "", "officer-123" }
);
```

Method:

```java
public class CaseService {
    public void assignCase(
        @NotBlank String caseId,
        @NotBlank String officerId
    ) {
        // ...
    }
}
```

Executable validation juga bisa memvalidasi return value:

```java
@NotNull
public CaseDetails getCase(@NotBlank String caseId) {
    return repository.find(caseId);
}
```

Konsep penting:

```text
Parameter constraints = precondition.
Return value constraints = postcondition.
```

Namun di framework berbasis proxy, method validation biasanya punya jebakan:

- self-invocation tidak kena proxy;
- private method tidak divalidasi;
- final method/class bisa bermasalah tergantung proxy mechanism;
- method overloading perlu metadata parameter yang jelas;
- exception mapping framework berbeda-beda.

Part executable validation akan membahas ini lebih dalam.

---

## 16. Message Interpolation dalam Flow Core API

Saat constraint gagal, engine tidak langsung mengembalikan string literal dari annotation.

Flow konseptual:

```text
Constraint fails
  └── message template selected
        └── MessageInterpolator resolves template
              ├── resource bundle lookup
              ├── annotation attribute replacement
              ├── locale handling
              └── expression interpolation if supported/enabled
                    └── final message
```

Contoh:

```java
@Size(min = 8, max = 64, message = "Password must be between {min} and {max} characters")
private String password;
```

Final message:

```text
Password must be between 8 and 64 characters
```

Core API menyediakan:

```java
violation.getMessage();         // final interpolated message
violation.getMessageTemplate(); // original template
```

Untuk sistem serius, simpan keduanya dalam model internal:

```java
public record ValidationIssue(
    String path,
    String code,
    String message,
    String messageTemplate
) {}
```

Kenapa?

- `message` berubah tergantung locale;
- `messageTemplate` stabil untuk mapping;
- `code` stabil untuk client;
- support/debug bisa membedakan human display dan internal key.

---

## 17. Fail-Fast vs Full Accumulation

Secara default, validation umumnya mengumpulkan semua violation yang ditemukan sesuai group/sequence traversal. Hibernate Validator menyediakan mode fail-fast sebagai extension provider.

Mental model:

```text
Full accumulation:
  cocok untuk form/API response karena user melihat semua error sekaligus.

Fail-fast:
  cocok untuk hot path, pipeline internal, atau ketika error pertama cukup.
```

Contoh use case full accumulation:

```text
User submit application form.
Ada 10 field salah.
Lebih baik balikan 10 error sekaligus.
```

Contoh use case fail-fast:

```text
Internal batch memproses jutaan record.
Begitu satu object invalid, tidak perlu lanjut cek expensive constraints.
```

Namun fail-fast punya konsekuensi:

- error order bisa menjadi observable behavior;
- user experience bisa buruk;
- test tidak boleh bergantung pada “error pertama” kecuali sengaja;
- group sequence sering lebih eksplisit untuk cost ordering.

---

## 18. Access Strategy: Field vs Getter Constraint

Bean Validation dapat membaca constraint di field atau getter.

Field-level:

```java
public class UserRequest {
    @NotBlank
    private String name;

    public String getName() {
        return name;
    }
}
```

Getter-level:

```java
public class UserRequest {
    private String name;

    @NotBlank
    public String getName() {
        return name;
    }
}
```

Jangan campur tanpa alasan kuat.

Risiko mixing:

- constraint terbaca ganda;
- semantics membingungkan;
- getter punya logic yang beda dari field;
- proxy/entity framework punya behavior berbeda;
- refactoring sulit.

Guideline umum:

```text
DTO modern: field atau record component, konsisten.
Entity JPA: ikuti access strategy entity.
Record: gunakan record component constraints.
Framework/library: dokumentasikan convention.
```

---

## 19. Object Graph Validation: Core Flow Singkat

Jika object punya nested property dengan `@Valid`:

```java
public class CreateCaseRequest {
    @Valid
    private AddressRequest address;
}
```

Maka `validator.validate(request)` akan masuk ke `address`.

Flow:

```text
Validate root bean
  ├── validate root constraints
  ├── inspect cascaded properties
  ├── if nested object != null, validate nested object
  ├── if iterable/map/container, extract elements
  ├── build path as traversal proceeds
  └── collect violations
```

Constraint pada nested object hanya dijalankan jika cascade diaktifkan dengan `@Valid`.

Contoh:

```java
public class CreateCaseRequest {
    private AddressRequest address; // tanpa @Valid
}
```

Jika `address.postalCode` invalid, validation root tidak akan mendeteksi constraint di `AddressRequest`.

Ini sering menjadi bug nyata.

---

## 20. Container Element Validation: Core View

Sejak Bean Validation 2.0, constraint bisa ditempel ke type argument.

```java
private List<@NotBlank String> tags;

private Map<@NotBlank String, @Valid ContactPerson> contactsByRole;
```

Artinya constraint bukan hanya pada `List` atau `Map`, tetapi pada elemen di dalamnya.

Bedakan:

```java
@NotEmpty
private List<String> tags;
```

Artinya list harus tidak kosong.

```java
private List<@NotBlank String> tags;
```

Artinya setiap item tidak boleh blank.

Gabungan:

```java
@NotEmpty
private List<@NotBlank String> tags;
```

Artinya list harus tidak kosong dan setiap item valid.

Core engine memakai `ValueExtractor` untuk tahu cara mengambil nilai dari container. Ini akan dibahas dalam part container element khusus.

---

## 21. Sorting and Determinism of Violations

`validate()` mengembalikan `Set`, bukan `List`.

Jangan mengandalkan urutan natural dari hasil provider.

Anti-pattern:

```java
ConstraintViolation<?> first = violations.iterator().next();
assertEquals("name", first.getPropertyPath().toString());
```

Better:

```java
List<ConstraintViolation<?>> sorted = violations.stream()
    .sorted(Comparator
        .comparing((ConstraintViolation<?> v) -> v.getPropertyPath().toString())
        .thenComparing(v -> v.getConstraintDescriptor().getAnnotation().annotationType().getName()))
    .toList();
```

Untuk API response, sorting penting agar:

- output stabil;
- snapshot/golden test stabil;
- frontend behavior predictable;
- observability lebih mudah.

---

## 22. Validation Exception Design

Jangan lempar raw `ConstraintViolationException` dari seluruh layer tanpa standar.

Untuk command layer, lebih baik punya exception domain/application:

```java
public final class CommandValidationException extends RuntimeException {
    private final List<ValidationIssue> issues;

    public CommandValidationException(List<ValidationIssue> issues) {
        super("Command validation failed");
        this.issues = List.copyOf(issues);
    }

    public List<ValidationIssue> issues() {
        return issues;
    }
}
```

Lalu adapter REST memetakan ke HTTP 400:

```java
@ExceptionHandler(CommandValidationException.class)
public ResponseEntity<ProblemDetail> handle(CommandValidationException ex) {
    ProblemDetail problem = ProblemDetail.forStatus(400);
    problem.setTitle("Validation failed");
    problem.setProperty("errors", ex.issues());
    return ResponseEntity.badRequest().body(problem);
}
```

Layering:

```text
Bean/Jakarta Validation result
  └── internal ValidationIssue
        └── application exception
              └── transport-specific error response
```

Jangan langsung ikat domain ke HTTP.

---

## 23. Production-Grade Validation Result Model

Untuk sistem besar, model violation sebaiknya eksplisit.

Contoh:

```java
public record ValidationIssue(
    String path,
    String code,
    String constraint,
    String message,
    String messageTemplate,
    Severity severity,
    Map<String, Object> attributes
) {
    public enum Severity {
        INFO,
        WARNING,
        ERROR,
        BLOCKER
    }
}
```

Mapping:

```java
public final class ConstraintViolationMapper {

    public static ValidationIssue toIssue(ConstraintViolation<?> violation) {
        ConstraintDescriptor<?> descriptor = violation.getConstraintDescriptor();
        String constraint = descriptor.getAnnotation().annotationType().getSimpleName();

        return new ValidationIssue(
            violation.getPropertyPath().toString(),
            resolveCode(violation, descriptor, constraint),
            constraint,
            violation.getMessage(),
            violation.getMessageTemplate(),
            resolveSeverity(descriptor),
            sanitizeAttributes(descriptor.getAttributes())
        );
    }

    private static String resolveCode(
        ConstraintViolation<?> violation,
        ConstraintDescriptor<?> descriptor,
        String constraint
    ) {
        Object explicitCode = descriptor.getAttributes().get("code");
        if (explicitCode instanceof String s && !s.isBlank()) {
            return s;
        }
        return defaultCode(violation.getPropertyPath().toString(), constraint);
    }

    private static String defaultCode(String path, String constraint) {
        return (path + "." + constraint).toUpperCase(Locale.ROOT);
    }

    private static ValidationIssue.Severity resolveSeverity(ConstraintDescriptor<?> descriptor) {
        return ValidationIssue.Severity.ERROR;
    }

    private static Map<String, Object> sanitizeAttributes(Map<String, Object> attributes) {
        Map<String, Object> copy = new LinkedHashMap<>(attributes);
        copy.remove("payload");
        copy.remove("groups");
        return Map.copyOf(copy);
    }
}
```

Kelebihan:

- API bisa stabil;
- logging bisa aman;
- FE bisa mapping error code;
- audit trail bisa menyimpan rule code;
- support team bisa search berdasarkan code;
- localization tidak merusak client contract.

---

## 24. Architecture Boundary: Where Should `Validator` Be Used?

Ada beberapa pilihan.

### 24.1 Transport Adapter

```text
HTTP request masuk
  └── framework validate DTO
        └── controller hanya menerima valid DTO
```

Kelebihan:

- cepat;
- umum;
- cocok untuk shape validation;
- error dekat dengan request.

Kekurangan:

- framework-specific;
- tidak cukup untuk domain command;
- partial update rumit;
- business context sering belum ada.

### 24.2 Application Command Boundary

```text
Controller maps request to command
  └── command validator validates command
        └── handler executes use case
```

Kelebihan:

- explicit;
- testable;
- transport-independent;
- cocok untuk internal API/event/CLI.

Kekurangan:

- perlu boilerplate;
- perlu konsistensi.

### 24.3 Domain Constructor/Factory

```text
Command valid
  └── domain object constructed
        └── constructor/factory enforces invariant
```

Kelebihan:

- invariant dekat dengan model;
- object tidak bisa hidup dalam state invalid;
- kuat untuk domain correctness.

Kekurangan:

- Bean Validation annotation tidak selalu cocok;
- error accumulation bisa lebih sulit;
- context-dependent rule sebaiknya tidak di constructor.

### 24.4 Persistence Layer

```text
Entity save
  └── JPA validation / DB constraint
```

Kelebihan:

- last line of defense;
- mencegah data invalid tersimpan.

Kekurangan:

- terlambat untuk UX;
- error mapping lebih sulit;
- entity graph/lazy loading risk;
- tidak cukup untuk business rule.

### 24.5 Recommended Layering

```text
Transport DTO validation
  └── shape, syntax, requiredness for request

Command validation
  └── use-case contract, operation-specific requiredness

Domain invariant
  └── object consistency that must always hold

Workflow guard
  └── state transition eligibility

Database constraint
  └── final consistency under concurrency
```

---

## 25. Debugging Mental Model: Ketika Validation “Tidak Jalan”

Checklist:

### 25.1 Annotation Package Salah

Spring Boot 3/Jakarta stack memakai:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
```

Legacy Spring Boot 2/Java EE stack memakai:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
```

Campur package bisa membuat validation tidak terdeteksi atau dependency konflik.

### 25.2 Tidak Ada Provider di Classpath

API saja tidak cukup. Perlu provider seperti Hibernate Validator.

### 25.3 Lupa `@Valid` untuk Nested Object

```java
private Address address; // constraints di Address tidak dicek
```

Harus:

```java
@Valid
private Address address;
```

### 25.4 Salah Group

Constraint ada di group `Submit`, tetapi validate default:

```java
validator.validate(command); // Default only
```

Harus:

```java
validator.validate(command, Submit.class);
```

### 25.5 Method Validation Tidak Aktif

Annotation parameter method tidak otomatis selalu jalan. Perlu integrasi framework/proxy atau manual `ExecutableValidator`.

### 25.6 Self-Invocation

```java
@Service
public class CaseService {
    public void outer() {
        inner(""); // method validation via proxy mungkin tidak jalan
    }

    public void inner(@NotBlank String id) {}
}
```

Karena call terjadi dalam object yang sama, proxy tidak terlibat.

### 25.7 Constraint di Getter Tapi Framework Pakai Field Semantics

Campur field/getter constraint bisa menyebabkan kebingungan.

### 25.8 Custom Validator Tidak Cocok Generic Type

```java
implements ConstraintValidator<MyConstraint, Integer>
```

tetapi dipakai pada `String`.

### 25.9 Container Element Butuh ValueExtractor

Untuk custom container, engine tidak tahu cara mengambil value jika tidak ada `ValueExtractor`.

---

## 26. Version-Aware Notes: Java 8 sampai 25

### 26.1 Java 8 Era

Umumnya:

```text
Bean Validation 2.0
Hibernate Validator 6.x
javax.validation.*
```

Fitur penting:

- Java 8 date/time support;
- type-use/container element constraints;
- Optional support;
- repeatable annotations.

### 26.2 Java 11 Era

Masih banyak sistem berada di:

```text
javax.validation.*
Spring Boot 2.x
Hibernate Validator 6.x
```

Migration concern:

- dependency freeze;
- transitive dependency konflik;
- library internal masih `javax`;
- framework upgrade besar.

### 26.3 Java 17+ Era

Umumnya:

```text
jakarta.validation.*
Spring Boot 3.x
Jakarta EE 10/11
Hibernate Validator 8/9
```

Java 17 juga menjadi baseline penting untuk banyak framework modern.

### 26.4 Java 21 sampai 25 Era

Fokus desain berubah:

- records untuk immutable DTO;
- sealed types untuk polymorphic command;
- virtual threads membuat blocking validation perlu tetap diaudit, bukan dianggap gratis;
- native-image/AOT awareness untuk reflection metadata;
- stronger architecture testing karena codebase makin modular.

Java 25 sudah tersedia sebagai GA release pada 16 September 2025 menurut OpenJDK project page.[^jdk25]

[^jdk25]: OpenJDK JDK 25 project page. https://openjdk.org/projects/jdk/25/

---

## 27. Common Anti-Patterns di Core API

### 27.1 Membuat Factory Per Request

```java
Validation.buildDefaultValidatorFactory().getValidator().validate(obj);
```

Masalah:

- mahal;
- resource lifecycle buruk;
- sulit diobservasi;
- konfigurasi tidak konsisten.

### 27.2 Mengubah Violation Menjadi String Terlalu Awal

```java
throw new RuntimeException(violations.toString());
```

Masalah:

- structured data hilang;
- tidak bisa mapping field;
- tidak bisa localization;
- tidak bisa stable error code.

### 27.3 Menaruh Business Transaction Rule di Annotation

```java
@CanApproveCase
private String caseId;
```

Jika rule ini butuh actor, role, state, assignment, SLA, conflict-of-interest, dan audit context, annotation field-level hampir pasti tempat yang salah.

### 27.4 Validator Memanggil Remote Service

```java
public boolean isValid(String value, ConstraintValidatorContext context) {
    return remoteRegistryClient.exists(value);
}
```

Risiko:

- latency unpredictable;
- timeout;
- retry ambiguity;
- validation menjadi side-effect-ish;
- batch validation lambat;
- circuit breaker perlu dipikirkan;
- error transient disalahartikan sebagai invalid.

### 27.5 Mengandalkan Urutan Violation

Karena hasilnya `Set`, urutan bukan kontrak utama.

### 27.6 Mencampur `javax` dan `jakarta`

Ini sering terjadi saat migrasi Spring Boot 2 ke 3 atau Jakarta EE 8 ke 10/11.

---

## 28. Mini Case Study: Validation untuk Case Submission

Bayangkan sistem case management regulatory.

Request:

```json
{
  "applicantName": "",
  "email": "not-email",
  "address": {
    "postalCode": "123"
  },
  "documents": [
    { "type": "ID", "fileName": "" }
  ]
}
```

DTO validation menemukan:

```text
applicantName: NotBlank
email: Email
address.postalCode: Size
address.postalCode: maybe Pattern
 documents[0].fileName: NotBlank
```

Tetapi DTO validation tidak boleh menjawab:

- apakah applicant boleh submit case ini;
- apakah case type sedang open;
- apakah officer boleh approve;
- apakah SLA sudah lewat;
- apakah document sudah scanned virus;
- apakah duplicate case sedang diproses;
- apakah database unique constraint akan lolos di bawah concurrency.

Layering yang benar:

```text
DTO Validation
  └── request shape valid?

Command Validation
  └── submit command lengkap untuk use case ini?

Domain Policy
  └── applicant eligible?
  └── duplicate policy?
  └── document policy?

Workflow Guard
  └── current state allows SUBMIT?

Persistence Constraint
  └── uniqueness/FK/not-null/check final defense
```

Core API part ini hanya mencakup engine untuk DTO/command/object constraint. Jangan memaksakan semua jenis rule masuk ke `Validator`.

---

## 29. Practical Checklist untuk Part Ini

Gunakan checklist ini saat membangun validation infrastructure.

### 29.1 Bootstrap

- [ ] `ValidatorFactory` tidak dibuat per request.
- [ ] `ValidatorFactory` lifecycle jelas.
- [ ] Provider dependency eksplisit.
- [ ] Tidak ada campuran `javax` dan `jakarta` dalam stack yang sama.

### 29.2 Usage

- [ ] `Validator` di-inject atau di-share secara konsisten.
- [ ] `validate`, `validateProperty`, dan `validateValue` dipakai sesuai tujuan.
- [ ] Group dipilih eksplisit untuk operation yang butuh group.
- [ ] Nested object diberi `@Valid` jika memang harus divalidasi.

### 29.3 Violation Handling

- [ ] Jangan ubah violation menjadi string terlalu awal.
- [ ] Simpan path, constraint, message, template, dan code.
- [ ] Sorting response stabil.
- [ ] Rejected value disanitasi atau tidak diekspos.
- [ ] Error response transport-specific dibuat di adapter layer.

### 29.4 Custom Validator

- [ ] Stateless.
- [ ] Thread-safe.
- [ ] Null semantics jelas.
- [ ] Tidak ada side effect.
- [ ] Tidak melakukan remote/DB call kecuali benar-benar disadari risikonya.

### 29.5 Metadata

- [ ] Metadata API dipahami.
- [ ] Bisa introspeksi constraints untuk debugging/test/governance.
- [ ] Tidak parsing human message untuk logic.

---

## 30. Ringkasan Mental Model

Core API Bean/Jakarta Validation bisa diringkas seperti ini:

```text
Validation
  = bootstrap entry point

ValidatorFactory
  = configured validation engine, application-scoped

Validator
  = reusable facade for validating beans/properties/values/executables

ConstraintViolation
  = structured failure data, not just error message

Path
  = structured location of failure

ConstraintDescriptor
  = metadata about failed constraint

Metadata API
  = queryable constraint repository
```

Poin terpenting:

```text
Top-tier engineer tidak melihat validation sebagai annotation magic.
Top-tier engineer melihat validation sebagai structured contract engine.
```

Kalau Anda memahami part ini, Anda akan lebih siap untuk part berikutnya: membaca built-in constraints bukan sebagai daftar annotation, tetapi sebagai **semantic primitives** yang punya null behavior, type behavior, boundary behavior, dan misuse risk.

---

## 31. Latihan Praktis

### Latihan 1 — Build Manual Validator

Buat class `ValidationBootstrapDemo` yang:

1. membuat `ValidatorFactory` sekali;
2. mengambil `Validator`;
3. memvalidasi DTO invalid;
4. mencetak path, constraint name, message, message template, invalid value;
5. menutup factory.

### Latihan 2 — Error Mapper

Buat mapper dari `Set<ConstraintViolation<?>>` menjadi:

```java
record ValidationError(
    String path,
    String code,
    String constraint,
    String message
) {}
```

Pastikan output stabil dengan sorting.

### Latihan 3 — Metadata Inspector

Buat utility:

```java
void printConstraints(Class<?> beanClass)
```

Output:

```text
Class: CreateCaseRequest
Property: applicantName
  - NotBlank {message=..., groups=...}
  - Size {min=..., max=...}
Property: address
  - cascaded=true
```

### Latihan 4 — Debug Missing Nested Validation

Buat object nested dengan constraint di child. Jalankan validation tanpa `@Valid`, lalu dengan `@Valid`. Amati perbedaan violation.

### Latihan 5 — `validateValue`

Gunakan `validateValue()` untuk memvalidasi `email` tanpa membuat instance DTO penuh. Jelaskan kenapa ini tidak cukup untuk cross-field validation.

---

## 32. Apa yang Tidak Dibahas Mendalam di Part Ini

Agar tidak mengulang dan tetap fokus, part ini belum membahas detail:

- semua built-in constraints;
- custom constraint design lengkap;
- validation groups dan group sequence secara penuh;
- container element constraints secara mendalam;
- message interpolation advanced;
- REST/JAX-RS/Spring exception mapping detail;
- JPA/database integration;
- performance benchmarking;
- security hardening;
- migration playbook.

Semua itu akan dibahas di part berikutnya.

---

## 33. Status Seri

Seri **belum selesai**.

Part saat ini: `part-002`.

Part berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-003.md
Built-in Constraints Deep Dive: Semantics, Edge Cases, and Misuse
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-001.md">⬅️ Specification Landscape: Bean Validation, Jakarta Validation, `javax` vs `jakarta`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-003.md">in Constraints Deep Dive: Semantics, Edge Cases, and Misuse ➡️</a>
</div>

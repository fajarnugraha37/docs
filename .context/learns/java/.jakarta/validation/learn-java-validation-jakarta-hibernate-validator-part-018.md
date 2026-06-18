# learn-java-validation-jakarta-hibernate-validator-part-018

# Dependency Injection in Validators: CDI, Spring, Jakarta EE, and Testability

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `018`  
> Topik: Dependency Injection di `ConstraintValidator`, lifecycle, thread-safety, testability, database-backed validation, race condition, dan desain rule yang production-grade  
> Target Java: 8 sampai 25  
> Namespace: `javax.validation.*` dan `jakarta.validation.*`  
> Provider utama: Hibernate Validator

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas custom constraint, class-level constraint, executable validation, message interpolation, payload/error-code, programmatic mapping, composition, dan Hibernate Validator extension.

Sekarang kita masuk ke salah satu area yang sering terlihat sederhana tetapi sangat berbahaya di production:

> “Bolehkah `ConstraintValidator` melakukan dependency injection ke service/repository/database/external API?”

Jawaban pendeknya:

> Boleh secara teknis, tetapi tidak selalu benar secara arsitektur.

Yang perlu dikuasai bukan hanya cara menulis:

```java
@Autowired
private UserRepository userRepository;
```

melainkan:

1. siapa yang membuat instance `ConstraintValidator`,
2. apakah instance tersebut di-cache,
3. apakah validator thread-safe,
4. apakah validator boleh punya state,
5. apakah validasi boleh memanggil database,
6. apakah hasil validasi masih benar setelah request masuk ke database,
7. bagaimana transaksi, isolation, race condition, retry, dan uniqueness constraint diperlakukan,
8. bagaimana validator dites tanpa framework berat,
9. bagaimana membedakan shape validation, contextual validation, business rule, authorization, dan final consistency.

Part ini akan membangun mental model agar kita tidak menjadikan Bean/Jakarta Validation sebagai “mini service layer tersembunyi”.

---

## 2. Core Mental Model

### 2.1 Constraint Validator Bukan Service Layer

`ConstraintValidator` idealnya adalah fungsi kecil:

```text
(annotation configuration, validated value) -> valid / invalid
```

Contoh yang ideal:

```text
@CaseReferenceFormat
"EA-2026-000123" -> valid
"abc"            -> invalid
```

Validator seperti ini:

- deterministic,
- side-effect-free,
- cepat,
- mudah dites,
- tidak butuh transaksi,
- tidak butuh database,
- tidak tergantung request context,
- tidak berubah hasilnya karena waktu atau actor.

Semakin validator bergantung pada service eksternal, semakin ia berubah dari “constraint validator” menjadi “business policy evaluator”. Itu tidak selalu salah, tetapi konsekuensinya besar.

---

### 2.2 Rule Taxonomy: Jangan Semua Rule Masuk Annotation

Sebelum inject service ke validator, tanyakan dulu rule-nya termasuk kategori apa.

| Kategori Rule | Contoh | Cocok di Bean/Jakarta Validation? |
|---|---|---|
| Shape/syntax | required, length, format, numeric range | Sangat cocok |
| Local object consistency | `startDate <= endDate` | Cocok |
| Cross-field consistency | jika `type=COMPANY`, `uen` wajib | Cocok jika hanya melihat object itu |
| Reference existence | `agencyId` harus ada di DB | Kadang, tapi hati-hati |
| Uniqueness | email/case number belum dipakai | Biasanya tidak cukup; harus DB constraint juga |
| Ownership | user boleh akses `caseId` ini | Bukan validation; ini authorization/policy |
| Workflow transition | status `DRAFT -> SUBMITTED` boleh jika semua section lengkap | Lebih cocok workflow guard/domain policy |
| Expensive external check | validasi ke third-party registry | Biasanya bukan annotation validator langsung |
| Final consistency | unique FK/check under concurrency | Database constraint wajib |

Prinsip utamanya:

> Bean/Jakarta Validation sangat kuat untuk local deterministic constraints. Semakin rule membutuhkan context eksternal, semakin besar kemungkinan rule itu harus pindah ke application service/domain policy/workflow guard/database constraint.

---

## 3. Siapa yang Membuat `ConstraintValidator`?

Constraint validator tidak selalu dibuat langsung oleh `new` di kode kita.

Saat kita menulis:

```java
Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
Set<ConstraintViolation<MyDto>> violations = validator.validate(dto);
```

provider validation akan:

1. membaca metadata constraint,
2. menentukan `ConstraintValidator` yang cocok,
3. meminta instance validator dari `ConstraintValidatorFactory`,
4. memanggil `initialize()` jika diperlukan,
5. memanggil `isValid()` untuk nilai yang divalidasi.

Komponen pentingnya:

```java
jakarta.validation.ConstraintValidatorFactory
```

atau pada stack lama:

```java
javax.validation.ConstraintValidatorFactory
```

Interface ini bertanggung jawab menyediakan instance `ConstraintValidator`.

---

## 4. Lifecycle `ConstraintValidator`

### 4.1 Model Sederhana Lifecycle

Secara konseptual:

```text
ValidatorFactory created
        |
        v
Validator requested
        |
        v
Constraint metadata resolved
        |
        v
ConstraintValidatorFactory.getInstance(...)
        |
        v
ConstraintValidator.initialize(annotation)
        |
        v
ConstraintValidator.isValid(value, context)
        |
        v
instance may be reused / cached by provider
```

Yang penting:

- `ValidatorFactory` mahal dibuat dan harus di-cache.
- `Validator` thread-safe dan dapat di-reuse.
- `ConstraintValidator` instance dapat dikelola/cached oleh provider/framework.
- Jangan mengasumsikan validator instance dibuat baru untuk setiap request.
- Jangan menyimpan request-specific mutable state di field validator.

---

### 4.2 Contoh Validator yang Aman

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class CaseReferenceValidator
        implements ConstraintValidator<CaseReference, String> {

    private String prefix;

    @Override
    public void initialize(CaseReference annotation) {
        this.prefix = annotation.prefix();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return value.startsWith(prefix + "-")
            && value.length() == prefix.length() + 1 + 10;
    }
}
```

Field `prefix` aman karena berasal dari annotation configuration dan stabil setelah `initialize()`.

---

### 4.3 Contoh Validator yang Tidak Aman

```java
public final class BadValidator
        implements ConstraintValidator<MyConstraint, String> {

    private String lastValidatedValue;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        this.lastValidatedValue = value;
        return value != null;
    }
}
```

Masalah:

- validator instance bisa digunakan lintas thread,
- field mutable berubah per request,
- hasil debug/logging bisa salah,
- ada data leakage antar request,
- race condition.

Rule:

> Field validator hanya boleh berisi configuration immutable, dependency stateless/thread-safe, atau object yang lifecycle-nya jelas. Jangan simpan data request di field validator.

---

## 5. `ConstraintValidatorFactory`

### 5.1 Default Behavior

Tanpa framework seperti Spring/CDI, provider biasanya membuat validator melalui no-arg constructor.

Validator seperti ini aman:

```java
public final class PostalCodeValidator
        implements ConstraintValidator<PostalCode, String> {

    public PostalCodeValidator() {
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || value.matches("\\d{6}");
    }
}
```

Tetapi validator seperti ini tidak akan otomatis bekerja pada bootstrap manual biasa:

```java
public final class UniqueEmailValidator
        implements ConstraintValidator<UniqueEmail, String> {

    private final UserRepository userRepository;

    public UniqueEmailValidator(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || !userRepository.existsByEmail(value);
    }
}
```

Karena default factory tidak tahu cara membuat `UserRepository`.

---

### 5.2 Custom `ConstraintValidatorFactory`

Secara manual, kita bisa membuat factory sendiri.

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorFactory;

public final class SimpleInjectingConstraintValidatorFactory
        implements ConstraintValidatorFactory {

    private final UserRepository userRepository;

    public SimpleInjectingConstraintValidatorFactory(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public <T extends ConstraintValidator<?, ?>> T getInstance(Class<T> key) {
        try {
            if (key == UniqueEmailValidator.class) {
                return key.cast(new UniqueEmailValidator(userRepository));
            }
            return key.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot instantiate validator: " + key.getName(), e);
        }
    }

    @Override
    public void releaseInstance(ConstraintValidator<?, ?> instance) {
        // release resources if your factory created resources that need cleanup
    }
}
```

Bootstrap:

```java
ValidatorFactory factory = Validation
    .byDefaultProvider()
    .configure()
    .constraintValidatorFactory(
        new SimpleInjectingConstraintValidatorFactory(userRepository)
    )
    .buildValidatorFactory();

Validator validator = factory.getValidator();
```

Namun di aplikasi besar, membuat factory manual seperti ini jarang diperlukan jika menggunakan Spring, CDI, Jakarta EE, atau framework lain.

---

## 6. Spring Dependency Injection

### 6.1 Spring Mental Model

Pada Spring, integrasi validation umumnya melalui:

```java
org.springframework.validation.beanvalidation.LocalValidatorFactoryBean
```

Spring mengonfigurasi factory yang dapat membuat `ConstraintValidator` dengan dukungan dependency injection.

Artinya validator seperti ini bisa bekerja:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.springframework.stereotype.Component;

@Component
public final class ExistingAgencyValidator
        implements ConstraintValidator<ExistingAgency, String> {

    private final AgencyLookupService agencyLookupService;

    public ExistingAgencyValidator(AgencyLookupService agencyLookupService) {
        this.agencyLookupService = agencyLookupService;
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        return agencyLookupService.exists(value);
    }
}
```

Catatan:

- Constructor injection lebih mudah dites daripada field injection.
- `@Component` sering dipakai, tetapi pada beberapa konfigurasi Spring, validator dapat tetap dibuat oleh `SpringConstraintValidatorFactory` walau bukan component eksplisit. Dalam codebase besar, lebih baik konsisten dan eksplisit.
- Jangan membuat validator bergantung pada request-scoped object kecuali benar-benar paham lifecycle dan proxy-nya.

---

### 6.2 Spring Boot 2 vs 3 Namespace

Spring Boot 2 umumnya berada pada dunia:

```java
javax.validation.*
```

Spring Boot 3 berada pada dunia:

```java
jakarta.validation.*
```

Jangan mencampur:

```java
// buruk pada Boot 3
import javax.validation.ConstraintValidator;
```

dengan:

```java
// benar pada Boot 3
import jakarta.validation.ConstraintValidator;
```

Mixed namespace bisa menyebabkan:

- constraint tidak terbaca,
- validator tidak dipanggil,
- exception runtime,
- dependency conflict,
- test lolos tetapi production gagal karena classpath berbeda.

---

### 6.3 `@Valid` vs `@Validated` di Spring

Secara praktis:

```java
@PostMapping("/applications")
public ResponseEntity<?> create(@Valid @RequestBody CreateApplicationRequest request) {
    ...
}
```

`@Valid` cukup untuk object validation default.

Untuk groups di Spring:

```java
@PostMapping("/applications")
public ResponseEntity<?> submit(
        @Validated(Submit.class) @RequestBody ApplicationRequest request) {
    ...
}
```

Untuk method validation pada service:

```java
@Validated
@Service
public class ApplicationService {

    public void submit(@Valid SubmitApplicationCommand command) {
        ...
    }
}
```

Tetapi ingat jebakan proxy:

```java
@Service
@Validated
public class ApplicationService {

    public void outer() {
        inner(null); // self-invocation: method validation proxy bisa tidak aktif
    }

    public void inner(@NotNull String value) {
    }
}
```

---

## 7. CDI and Jakarta EE Dependency Injection

### 7.1 CDI Mental Model

Dalam lingkungan Jakarta EE/CDI, `Validator` dan `ValidatorFactory` dapat dikelola sebagai bean, dan `ConstraintValidator` dapat menggunakan injection.

Contoh:

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class AgencyDirectory {

    public boolean exists(String agencyCode) {
        return true;
    }
}
```

```java
import jakarta.inject.Inject;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class ExistingAgencyValidator
        implements ConstraintValidator<ExistingAgency, String> {

    @Inject
    AgencyDirectory agencyDirectory;

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        return agencyDirectory.exists(value);
    }
}
```

Kelebihan:

- integrasi natural dengan Jakarta EE,
- bisa memakai CDI-managed service,
- cocok untuk application server/Jakarta runtime.

Risiko:

- lifecycle bisa berbeda dari ekspektasi developer Spring,
- request scope/proxy perlu dipahami,
- injection field membuat unit test lebih sulit,
- validator bisa diam-diam menjadi service-layer rule.

---

## 8. Kapan Dependency Injection di Validator Layak?

### 8.1 Layak Jika Dependency Bersifat Pure/Static Lookup

Contoh dependency yang relatif aman:

- country code registry in-memory,
- ISO currency metadata,
- preloaded postal code format registry,
- module-specific rule catalog immutable,
- clock provider/wrapper,
- normalization utility,
- compiled pattern registry,
- configuration immutable.

Contoh:

```java
public interface CountryMetadata {
    boolean supportsPostalCode(String countryCode);
    String postalCodeRegex(String countryCode);
}
```

Validator:

```java
public final class CountryPostalCodeValidator
        implements ConstraintValidator<ValidCountryPostalCode, AddressDto> {

    private final CountryMetadata metadata;

    public CountryPostalCodeValidator(CountryMetadata metadata) {
        this.metadata = metadata;
    }

    @Override
    public boolean isValid(AddressDto value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        if (value.countryCode() == null || value.postalCode() == null) {
            return true;
        }

        if (!metadata.supportsPostalCode(value.countryCode())) {
            return true;
        }

        return value.postalCode().matches(metadata.postalCodeRegex(value.countryCode()));
    }
}
```

Ini relatif aman jika `CountryMetadata`:

- thread-safe,
- tidak memanggil remote service per validation,
- tidak melakukan mutation,
- punya lifecycle jelas.

---

### 8.2 Berisiko Jika Dependency Memanggil Database

Contoh umum:

```java
@UniqueEmail
private String email;
```

Validator:

```java
public final class UniqueEmailValidator
        implements ConstraintValidator<UniqueEmail, String> {

    private final UserRepository userRepository;

    public UniqueEmailValidator(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        return !userRepository.existsByEmail(value);
    }
}
```

Ini terlihat benar, tetapi secara concurrency tidak cukup.

Race condition:

```text
T1 validate email fajar@example.com -> not exists
T2 validate email fajar@example.com -> not exists
T1 insert email fajar@example.com -> success
T2 insert email fajar@example.com -> duplicate
```

Kesimpulan:

> Uniqueness tidak boleh hanya dijaga oleh Bean Validation. Database unique constraint tetap wajib.

Validator seperti ini paling jauh hanya memberi early feedback, bukan final correctness.

---

### 8.3 Berbahaya Jika Dependency Memanggil External API

Contoh:

```java
@ValidGovernmentRegistryId
private String registryId;
```

Validator memanggil external API:

```java
registryClient.isValid(registryId)
```

Risiko:

- latency tinggi,
- timeout,
- retry storm,
- rate limit,
- circuit breaker diperlukan,
- hasil berubah-ubah,
- dependency outage membuat semua request invalid/failed,
- validation path menjadi distributed transaction kecil,
- sulit membedakan invalid input vs dependency unavailable.

Lebih baik diperlakukan sebagai application service step:

```text
1. syntactic validation
2. command accepted
3. registry check with timeout/circuit breaker
4. result mapped to business decision
5. audit outcome
```

Bukan annotation validator biasa.

---

## 9. Database-Backed Validation: Failure Model

### 9.1 Reference Existence

Contoh:

```java
@ExistingAgency
private String agencyCode;
```

Validator cek DB:

```text
SELECT 1 FROM agency WHERE code = ?
```

Masalah yang perlu dijawab:

1. Apakah data reference bisa berubah?
2. Apakah agency inactive dianggap invalid?
3. Apakah user berhak melihat agency tersebut?
4. Apakah transaksi request sama dengan transaksi lookup?
5. Apakah result harus konsisten sampai write?
6. Apakah cache boleh stale?
7. Apakah failure DB berarti invalid atau system error?

Jika rule-nya hanya “format agency code valid”, annotation cocok.

Jika rule-nya “agency ada dan aktif pada saat submit”, ini mulai masuk business/domain policy.

Jika rule-nya “actor boleh submit untuk agency tersebut”, itu authorization, bukan validation.

---

### 9.2 Uniqueness

Untuk uniqueness, desain yang benar biasanya:

```text
API DTO validation:
  - not blank
  - email format
  - length limit

Application service:
  - optional early check for better message

Database:
  - unique constraint is source of final truth

Exception translation:
  - duplicate key -> EMAIL_ALREADY_REGISTERED
```

Contoh service:

```java
@Transactional
public UserId register(RegisterUserCommand command) {
    validator.validateOrThrow(command);

    // Optional early feedback only, not final guarantee.
    if (userRepository.existsByEmail(command.email())) {
        throw new DomainConflictException("EMAIL_ALREADY_REGISTERED");
    }

    try {
        User user = User.register(command.email(), command.name());
        userRepository.save(user);
        return user.id();
    } catch (DuplicateKeyException ex) {
        throw new DomainConflictException("EMAIL_ALREADY_REGISTERED", ex);
    }
}
```

Database constraint tetap wajib.

---

### 9.3 Ownership and Access

Contoh yang keliru:

```java
@OwnedByCurrentUser
private UUID caseId;
```

Kenapa buruk?

- membutuhkan current user context,
- membutuhkan permission model,
- membutuhkan tenant/org boundary,
- violation-nya bukan input invalid, tetapi access denied,
- error HTTP bisa 403/404, bukan 400/422,
- dapat menyebabkan information disclosure.

Lebih tepat:

```java
public Case loadCaseForUpdate(User actor, CaseId caseId) {
    Case c = caseRepository.findById(caseId)
        .orElseThrow(() -> notFound());

    authorizationPolicy.requireCanUpdate(actor, c);
    return c;
}
```

---

## 10. Validator Purity Spectrum

Tidak semua validator harus 100% pure, tetapi kita harus sadar posisinya.

| Level | Tipe Validator | Contoh | Risiko |
|---|---|---|---|
| 0 | Pure local | regex, length, date order | Rendah |
| 1 | Static metadata | country/currency registry in memory | Rendah-sedang |
| 2 | Config-driven | tenant config cached | Sedang |
| 3 | DB lookup read-only | reference exists | Sedang-tinggi |
| 4 | External service call | government registry | Tinggi |
| 5 | Mutating validator | create reservation, update usage | Sangat buruk |

Rule keras:

> `ConstraintValidator.isValid()` tidak boleh melakukan side effect bisnis.

Jangan lakukan:

```java
public boolean isValid(String code, ConstraintValidatorContext context) {
    couponService.markAsChecked(code); // buruk
    return couponService.isValid(code);
}
```

---

## 11. Thread-Safety and State Management

### 11.1 Validator Instance Bisa Dipakai Berkali-kali

Karena validator dapat di-cache/reuse, desain validator harus aman untuk concurrent call.

Aman:

```java
public final class AllowedValuesValidator
        implements ConstraintValidator<AllowedValues, String> {

    private Set<String> allowed;

    @Override
    public void initialize(AllowedValues annotation) {
        this.allowed = Set.of(annotation.value());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || allowed.contains(value);
    }
}
```

Catatan Java 8:

```java
this.allowed = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(annotation.value())));
```

Tidak aman:

```java
public final class BadAllowedValuesValidator
        implements ConstraintValidator<AllowedValues, String> {

    private final List<String> violations = new ArrayList<>();

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        if (!violations.contains(value)) {
            violations.add(value);
        }
        return true;
    }
}
```

Masalah:

- mutable shared field,
- memory leak,
- data leakage,
- race condition.

---

### 11.2 Dependency Juga Harus Thread-Safe

Constructor injection tidak otomatis aman.

```java
public final class MyValidator implements ConstraintValidator<MyRule, String> {

    private final NonThreadSafeClient client;

    public MyValidator(NonThreadSafeClient client) {
        this.client = client;
    }
}
```

Jika `client` tidak thread-safe, validator juga tidak aman.

Checklist:

- Apakah dependency stateless?
- Apakah singleton-safe?
- Apakah punya connection pool?
- Apakah punya mutable cache internal?
- Apakah request-scoped?
- Apakah proxy thread-safe?
- Apakah ada timeout?
- Apakah bisa throw exception?

---

## 12. Exception Handling di Validator

### 12.1 Jangan Menelan Dependency Failure sebagai Invalid Input

Buruk:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    try {
        return externalRegistry.isValid(value);
    } catch (Exception e) {
        return false;
    }
}
```

Masalah:

- registry down dianggap input invalid,
- user mendapat pesan salah,
- support/debug susah,
- audit menyesatkan,
- retry client tidak jelas.

Lebih baik:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null || value.isBlank()) {
        return true;
    }

    try {
        return registry.isKnown(value);
    } catch (RegistryUnavailableException e) {
        throw new ValidationDependencyUnavailableException(
            "Registry unavailable while validating registryId", e
        );
    }
}
```

Tetapi ini pun harus dipikirkan: apakah framework akan memetakan exception tersebut menjadi 500? Apakah itu yang diinginkan? Jika iya, bagus. Jika tidak, jangan letakkan rule ini di annotation validator.

---

### 12.2 Invalid vs System Failure

Bedakan:

```text
invalid input       -> 400/422 validation error
conflict            -> 409 domain conflict
forbidden           -> 403 authorization error
not found           -> 404 resource visibility decision
dependency failure  -> 503/500 or async retry
bug/invariant fail  -> 500/internal alert
```

Jika `ConstraintValidator` tidak bisa membedakan semua ini, jangan paksa semua masuk `false`.

---

## 13. Transaction Boundary Problem

### 13.1 Validator Biasanya Berjalan di Boundary yang Berbeda

Pada REST request:

```text
HTTP request received
        |
        v
body deserialized
        |
        v
Bean Validation on DTO
        |
        v
controller method invoked
        |
        v
service transaction starts
        |
        v
domain logic + repository write
```

Sering kali request DTO validation terjadi sebelum service transaction.

Jika validator melakukan DB lookup:

- lookup bisa di luar transaction,
- lookup bisa memakai transaction berbeda,
- isolation tidak sama dengan write,
- data bisa berubah setelah validation.

Maka hasil validator bukan final guarantee.

---

### 13.2 Method Validation pada Service Bisa Masuk Transaction?

Jika service method diberi `@Validated` dan `@Transactional`, urutan proxy penting.

```java
@Service
@Validated
public class ApplicationService {

    @Transactional
    public void submit(@Valid SubmitCommand command) {
        ...
    }
}
```

Tergantung ordering proxy/advisor, method validation bisa terjadi sebelum atau sesudah transaction dibuka. Jangan menggantungkan correctness pada asumsi implisit ini tanpa test/instrumentasi.

Untuk rule yang butuh transaction, lebih eksplisit:

```java
@Transactional
public void submit(SubmitCommand command) {
    commandValidator.validate(command); // application/domain validator, not Bean Validation only
    ...
}
```

---

## 14. Designing DI-Based Validators Properly

### 14.1 Example: Safe Config-Backed Validator

Annotation:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.RECORD_COMPONENT;
import static java.lang.annotation.ElementType.TYPE_USE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Documented
@Constraint(validatedBy = ConfiguredCodeValidator.class)
@Target({ FIELD, PARAMETER, TYPE_USE, RECORD_COMPONENT })
@Retention(RUNTIME)
public @interface ConfiguredCode {
    String catalog();
    String message() default "{validation.configuredCode.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Service:

```java
public interface CodeCatalogRegistry {
    boolean contains(String catalog, String code);
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class ConfiguredCodeValidator
        implements ConstraintValidator<ConfiguredCode, String> {

    private final CodeCatalogRegistry registry;
    private String catalog;

    public ConfiguredCodeValidator(CodeCatalogRegistry registry) {
        this.registry = registry;
    }

    @Override
    public void initialize(ConfiguredCode annotation) {
        this.catalog = annotation.catalog();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        return registry.contains(catalog, value);
    }
}
```

Aman jika registry:

- read-only/cached,
- thread-safe,
- tidak melakukan remote call per request,
- punya behavior deterministic selama validation lifecycle.

---

### 14.2 Example: Safer Uniqueness Design

Jangan membuat `@UniqueEmail` sebagai satu-satunya guard.

DTO:

```java
public record RegisterUserRequest(
        @NotBlank
        @Email
        @Size(max = 320)
        String email,

        @NotBlank
        @Size(max = 200)
        String name
) {
}
```

Command/service:

```java
public record RegisterUserCommand(String email, String name) {
}
```

Service:

```java
@Transactional
public UserId register(RegisterUserCommand command) {
    if (userRepository.existsByEmail(command.email())) {
        throw new DomainConflictException("EMAIL_ALREADY_REGISTERED");
    }

    try {
        User user = User.register(command.email(), command.name());
        userRepository.save(user);
        return user.id();
    } catch (DuplicateKeyException ex) {
        throw new DomainConflictException("EMAIL_ALREADY_REGISTERED", ex);
    }
}
```

Database:

```sql
ALTER TABLE app_user
ADD CONSTRAINT uq_app_user_email UNIQUE (email);
```

Ini lebih benar karena:

- Bean Validation menjaga shape,
- service memberi early user-friendly conflict,
- DB memberi final concurrency guarantee,
- duplicate key diterjemahkan ke error contract stabil.

---

## 15. Testing DI Validators

### 15.1 Unit Test Tanpa Spring/CDI

Validator dengan constructor injection mudah dites.

```java
class ConfiguredCodeValidatorTest {

    @Test
    void validWhenCatalogContainsValue() {
        CodeCatalogRegistry registry = (catalog, code) ->
            catalog.equals("AGENCY") && code.equals("CEA");

        ConfiguredCodeValidator validator = new ConfiguredCodeValidator(registry);
        ConfiguredCode annotation = annotation("AGENCY");

        validator.initialize(annotation);

        assertTrue(validator.isValid("CEA", null));
        assertFalse(validator.isValid("UNKNOWN", null));
    }
}
```

Masalah: membuat instance annotation manual tidak selalu nyaman. Alternatif:

- test via real `ValidatorFactory`,
- buat test DTO kecil,
- validasi object.

```java
class ConfiguredCodeIntegrationTest {

    record TestDto(@ConfiguredCode(catalog = "AGENCY") String agencyCode) {
    }

    @Test
    void invalidCodeProducesViolation() {
        Validator validator = buildValidatorWithRegistry((catalog, code) -> false);

        Set<ConstraintViolation<TestDto>> violations =
            validator.validate(new TestDto("UNKNOWN"));

        assertEquals(1, violations.size());
    }
}
```

---

### 15.2 Spring Integration Test

```java
@SpringBootTest
class ExistingAgencyValidatorSpringTest {

    @Autowired
    Validator validator;

    @MockBean
    AgencyLookupService agencyLookupService;

    record TestDto(@ExistingAgency String agencyCode) {
    }

    @Test
    void usesInjectedService() {
        when(agencyLookupService.exists("CEA")).thenReturn(true);

        Set<ConstraintViolation<TestDto>> violations =
            validator.validate(new TestDto("CEA"));

        assertTrue(violations.isEmpty());
    }
}
```

Gunakan integration test hanya untuk memastikan wiring. Logic validator tetap sebaiknya dites unit-level.

---

### 15.3 Test Race Condition Tidak Cukup dengan Validator Test

Untuk uniqueness, test validator tidak membuktikan correctness.

Test yang benar harus mencakup DB constraint:

```java
@Test
void duplicateEmailRejectedByDatabaseEvenUnderRace() {
    // spawn two transactions inserting same email
    // expect one success and one duplicate/conflict
}
```

Jika tidak ada unique constraint di database, validator uniqueness hanya ilusi correctness.

---

## 16. Design Alternatives to DI in `ConstraintValidator`

### 16.1 Application Service Validator

Untuk rule contextual:

```java
public final class SubmitApplicationValidator {

    private final AgencyRepository agencyRepository;
    private final AuthorizationPolicy authorizationPolicy;
    private final WorkflowPolicy workflowPolicy;

    public ValidationResult validate(User actor, SubmitApplicationCommand command) {
        ValidationResult result = new ValidationResult();

        if (!agencyRepository.existsActive(command.agencyCode())) {
            result.add("agencyCode", "AGENCY_NOT_ACTIVE");
        }

        if (!authorizationPolicy.canSubmitForAgency(actor, command.agencyCode())) {
            result.add("agencyCode", "AGENCY_FORBIDDEN");
        }

        if (!workflowPolicy.canSubmit(command.caseId())) {
            result.add("caseId", "CASE_NOT_SUBMITTABLE");
        }

        return result;
    }
}
```

Kelebihan:

- actor tersedia,
- transaction jelas,
- repository/service dependency eksplisit,
- error code bisa spesifik,
- bisa membedakan 400/403/409/422,
- lebih mudah diobservasi.

---

### 16.2 Domain Policy Object

```java
public final class CaseSubmissionPolicy {

    public PolicyDecision canSubmit(Case c, User actor, Clock clock) {
        if (!c.isDraft()) {
            return PolicyDecision.deny("CASE_NOT_IN_DRAFT");
        }
        if (!actor.canSubmit(c.agency())) {
            return PolicyDecision.deny("ACTOR_CANNOT_SUBMIT_FOR_AGENCY");
        }
        if (c.deadline().isBefore(LocalDate.now(clock))) {
            return PolicyDecision.deny("SUBMISSION_DEADLINE_PASSED");
        }
        return PolicyDecision.allow();
    }
}
```

Ini lebih cocok daripada `@SubmittableCase` jika rule adalah workflow/authorization/temporal policy.

---

### 16.3 Database Constraint

Untuk final consistency:

```sql
ALTER TABLE application
ADD CONSTRAINT chk_application_period
CHECK (start_date <= end_date);
```

```sql
ALTER TABLE user_account
ADD CONSTRAINT uq_user_account_email UNIQUE (email);
```

Bean Validation boleh memberi early feedback, tetapi database tetap sumber final truth untuk invariants yang harus benar di bawah concurrency.

---

### 16.4 Reservation Pattern

Untuk rule seperti “case number must be unique and reserved before submit”:

```text
1. allocate/reserve case number in transactional table
2. unique constraint protects reservation
3. submit uses reserved number
4. expiry/cleanup for abandoned reservations
```

Ini tidak cocok dilakukan di `isValid()` karena `isValid()` tidak seharusnya mutate state.

---

## 17. Case Management Example

Misal request:

```java
public record SubmitLicenceApplicationRequest(
        @NotBlank
        @Size(max = 30)
        @Pattern(regexp = "[A-Z0-9-]+")
        String applicationRef,

        @NotBlank
        @Size(max = 10)
        String agencyCode,

        @NotNull
        @Valid
        ApplicantDto applicant,

        @NotEmpty
        List<@Valid SupportingDocumentDto> documents
) {
}
```

DTO validation cocok untuk:

- field wajib,
- format reference,
- length,
- nested applicant shape,
- document DTO shape,
- collection tidak kosong.

Tidak cocok untuk:

- actor boleh submit agency ini,
- application masih draft,
- semua mandatory section lengkap berdasarkan rule versi tertentu,
- document sudah lolos virus scan,
- payment sudah settled,
- no active compliance hold,
- submission masih dalam SLA window,
- applicant not blacklisted by external registry.

Layering yang benar:

```text
REST DTO Bean Validation
        |
        v
Command mapping / normalization
        |
        v
Application service transaction
        |
        v
Authorization policy
        |
        v
Workflow transition guard
        |
        v
Domain policy validation
        |
        v
Persistence write
        |
        v
Database constraints
        |
        v
Outbox/event validation
```

---

## 18. Error Contract Implications

Jika validator injected service gagal, error contract harus jelas.

### 18.1 Invalid Input

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "violations": [
    {
      "path": "agencyCode",
      "code": "AGENCY_CODE_INVALID",
      "message": "Agency code is invalid."
    }
  ]
}
```

### 18.2 Conflict

```json
{
  "type": "https://api.example.com/problems/conflict",
  "title": "Conflict",
  "status": 409,
  "code": "EMAIL_ALREADY_REGISTERED"
}
```

### 18.3 Authorization

```json
{
  "type": "https://api.example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "ACTOR_CANNOT_SUBMIT_FOR_AGENCY"
}
```

### 18.4 Dependency Failure

```json
{
  "type": "https://api.example.com/problems/dependency-unavailable",
  "title": "Validation dependency unavailable",
  "status": 503,
  "code": "REGISTRY_UNAVAILABLE"
}
```

Jangan semua dipaksa menjadi `ConstraintViolation` biasa.

---

## 19. Observability for Injected Validators

Jika validator memakai dependency, observability menjadi wajib.

Minimal metrics:

```text
validation.validator.invocations{validator="ExistingAgencyValidator"}
validation.validator.failures{validator="ExistingAgencyValidator", reason="invalid"}
validation.validator.errors{validator="ExistingAgencyValidator", reason="dependency_unavailable"}
validation.validator.latency{validator="ExistingAgencyValidator"}
validation.validator.db_calls{validator="ExistingAgencyValidator"}
```

Namun hati-hati:

- jangan log raw PII,
- jangan log full rejected value sensitif,
- jangan membuat high-cardinality label dari input user,
- gunakan error code/rule id.

Contoh safe log:

```text
validation_failed rule=AGENCY_EXISTS path=agencyCode requestId=... actorType=external
```

Bukan:

```text
validation_failed agencyCode=SECRET-AGENCY userEmail=fajar@example.com
```

---

## 20. Caching Considerations

### 20.1 Cache Bisa Membantu, Tetapi Bisa Membuat Salah

Untuk reference data:

```text
agency code -> active/inactive
postal code prefix -> valid area
country code -> metadata
```

Cache bisa mengurangi latency. Tetapi pertanyaan penting:

1. Seberapa stale boleh?
2. Apakah inactive agency boleh tetap dianggap valid selama cache TTL?
3. Apakah ada event invalidation?
4. Apakah negative result di-cache?
5. Apakah cache per tenant?
6. Apakah cache key aman dari high-cardinality abuse?

### 20.2 Cache di Service, Bukan di Validator Field

Buruk:

```java
public final class ExistingAgencyValidator implements ConstraintValidator<ExistingAgency, String> {
    private final Map<String, Boolean> cache = new HashMap<>(); // buruk
}
```

Lebih baik:

```java
public interface AgencyLookupService {
    boolean existsActive(String agencyCode);
}
```

Cache dikelola oleh service yang jelas:

- thread-safe,
- bounded,
- observable,
- configurable,
- testable.

---

## 21. Version Notes: Java 8 sampai Java 25

### 21.1 Java 8

Pada Java 8 legacy stack:

- sering memakai Bean Validation 2.0 / Hibernate Validator 6.x,
- namespace `javax.validation.*`,
- `Optional` dan type-use constraints tersedia sejak Bean Validation 2.0,
- records belum tersedia,
- immutable DTO biasanya dibuat manual atau dengan Lombok.

Contoh import:

```java
import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
```

### 21.2 Java 11/17

Java 17 menjadi baseline umum untuk Jakarta EE 10/11 era dan Hibernate Validator modern.

Namespace modern:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
```

### 21.3 Java 21/25

Dengan Java modern:

- records cocok untuk DTO immutable,
- sealed hierarchy dapat membantu command modeling,
- virtual threads tidak menghapus risiko blocking DB/external call dalam validator,
- native/AOT environment membutuhkan perhatian pada reflection/proxy/resources,
- explicit application/domain validator tetap sering lebih baik untuk rule contextual.

Virtual thread note:

> Walaupun blocking lebih murah dengan virtual threads, memanggil database/external API dari `isValid()` tetap membawa risiko correctness, transaction boundary, rate limit, observability, dan error semantics.

---

## 22. Native Image / AOT Considerations

Dalam environment seperti GraalVM native image, Quarkus, atau Spring AOT:

- validator class perlu bisa ditemukan,
- reflection metadata mungkin perlu konfigurasi,
- resource bundle validation message harus masuk image,
- dynamic classpath scanning bisa terbatas,
- proxy/injection behavior bisa berbeda,
- custom `ConstraintValidatorFactory` perlu dites di mode native/AOT.

Prinsip:

> Jika validator makin magic, makin besar risiko AOT/native mismatch. Prefer explicit wiring dan test mode produksi.

---

## 23. Anti-Patterns

### 23.1 Repository di Semua Validator

```java
@ExistingX
@ActiveY
@OwnedZ
@UniqueA
@NoPendingB
```

Lalu setiap annotation memanggil repository.

Dampak:

- N+1 validation queries,
- latency tinggi,
- transaksi tidak jelas,
- duplicate checks,
- race condition,
- sulit observability,
- error contract berantakan.

---

### 23.2 Validator Menggunakan Current User Context

```java
public boolean isValid(UUID caseId, ConstraintValidatorContext context) {
    User user = SecurityContext.currentUser();
    return caseRepository.isOwnedBy(caseId, user.id());
}
```

Masalah:

- hidden dependency,
- sulit dites,
- tidak jelas HTTP status,
- authorization disamarkan sebagai validation,
- risiko information disclosure.

---

### 23.3 Validator Melakukan Side Effect

```java
public boolean isValid(String token, ConstraintValidatorContext context) {
    tokenService.consume(token);
    return true;
}
```

Ini buruk. Validation bisa dipanggil lebih dari sekali, bisa fail di tahap lain, bisa dipanggil oleh test/tooling/framework, dan tidak menjamin commit.

---

### 23.4 Validator Menelan Semua Exception

```java
catch (Exception e) {
    return false;
}
```

Ini membuat system failure tampak seperti input invalid.

---

### 23.5 Validator Menjadi Workflow Engine

```java
@ValidForSubmission
class ApplicationDto { ... }
```

Lalu di dalamnya:

- cek role,
- cek DB,
- cek workflow status,
- cek payment,
- cek external registry,
- cek audit history,
- cek SLA.

Ini bukan constraint validator; ini policy/workflow orchestration.

---

## 24. Recommended Decision Framework

Sebelum inject dependency ke validator, jawab pertanyaan berikut.

### 24.1 Nature of Rule

```text
Apakah rule hanya butuh value/object yang sedang divalidasi?
```

Jika ya, annotation validator cocok.

```text
Apakah rule butuh actor, tenant, time, transaction, database, workflow state, atau external system?
```

Jika ya, pertimbangkan application/domain validator.

---

### 24.2 Correctness Under Concurrency

```text
Apakah hasil validasi masih benar saat write dilakukan?
```

Jika tidak, perlu DB constraint atau transactional guard.

---

### 24.3 Error Semantics

```text
Jika dependency gagal, apakah itu invalid input atau system error?
```

Jika system error, jangan kembalikan `false` seolah-olah input invalid.

---

### 24.4 Performance

```text
Berapa call validator per request?
Berapa query per validation?
Apakah cascade bisa memanggil validator berkali-kali?
Apakah ada batch import 10.000 row?
```

Jika mahal, jangan letakkan di generic annotation tanpa cost gate.

---

### 24.5 Testability

```text
Bisakah validator dites tanpa full application context?
Bisakah failure dependency dites?
Bisakah race condition dites?
```

Jika tidak, desainnya terlalu tersembunyi.

---

## 25. Practical Patterns

### 25.1 Pure Constraint + Service Policy

DTO:

```java
public record AssignCaseRequest(
        @NotNull UUID caseId,
        @NotNull UUID officerId
) {
}
```

Service:

```java
@Transactional
public void assign(User actor, AssignCaseCommand command) {
    Case c = caseRepository.getForUpdate(command.caseId());
    Officer officer = officerRepository.get(command.officerId());

    authorizationPolicy.requireCanAssign(actor, c);
    assignmentPolicy.requireAssignable(c, officer);

    c.assignTo(officer);
}
```

### 25.2 Annotation for Stable Reference Catalog

```java
public record CreateApplicationRequest(
        @ConfiguredCode(catalog = "APPLICATION_TYPE")
        String applicationType
) {
}
```

Jika catalog immutable/cached, ini masuk akal.

### 25.3 DB Constraint for Final Truth

```java
public record CreateUserRequest(
        @NotBlank @Email String email
) {
}
```

DB:

```sql
CREATE UNIQUE INDEX uq_user_email ON app_user(email);
```

Service translate duplicate.

---

## 26. Production Checklist

Gunakan checklist ini saat review PR yang menambahkan DI dalam validator.

### 26.1 Lifecycle

- [ ] Apakah validator stateless atau hanya menyimpan immutable config?
- [ ] Apakah dependency thread-safe?
- [ ] Apakah tidak ada request-specific mutable field?
- [ ] Apakah `ValidatorFactory` tidak dibuat per request?

### 26.2 Correctness

- [ ] Apakah rule memang validation, bukan authorization/workflow/domain policy?
- [ ] Apakah hasil validasi tetap benar di bawah concurrency?
- [ ] Apakah DB constraint tetap ada untuk uniqueness/final consistency?
- [ ] Apakah transaction boundary jelas?

### 26.3 Failure Handling

- [ ] Apakah dependency failure dibedakan dari invalid input?
- [ ] Apakah exception mapping jelas?
- [ ] Apakah timeout/retry/circuit breaker dipikirkan jika ada remote call?

### 26.4 Performance

- [ ] Apakah validator bisa dipanggil berkali-kali dalam cascade/batch?
- [ ] Apakah ada N+1 query?
- [ ] Apakah ada caching yang bounded dan observable?
- [ ] Apakah regex/external call/database call tidak berada di hot path tanpa kontrol?

### 26.5 Security

- [ ] Apakah tidak ada PII di violation message/log?
- [ ] Apakah authorization tidak disamarkan sebagai validation?
- [ ] Apakah error tidak membocorkan resource existence?

### 26.6 Testability

- [ ] Apakah validator logic bisa dites unit-level?
- [ ] Apakah framework wiring dites integration-level?
- [ ] Apakah DB final constraint dites?
- [ ] Apakah race condition/duplicate insert dites untuk uniqueness?

---

## 27. Summary Mental Model

Dependency injection di `ConstraintValidator` bukan fitur yang salah. Justru ia berguna ketika validator butuh registry/config/service yang dikelola framework.

Namun, semakin validator bergantung pada dunia luar, semakin ia kehilangan sifat idealnya:

```text
pure, deterministic, fast, local, side-effect-free
```

Gunakan aturan sederhana ini:

```text
Local shape rule                  -> Bean/Jakarta Validation
Local object consistency          -> class-level constraint
Reusable format/catalog rule      -> custom constraint, DI boleh jika dependency aman
Reference check                   -> hati-hati; sering lebih baik service policy
Uniqueness                        -> DB constraint wajib
Ownership/permission              -> authorization policy
Workflow transition               -> workflow/domain guard
External system validation        -> application service step, not casual annotation
Final consistency under race      -> database/transactional design
```

Top-tier engineer tidak hanya bertanya:

> “Bisa di-inject tidak?”

Tetapi bertanya:

> “Apakah rule ini seharusnya hidup di validation annotation, dan apakah hasilnya tetap benar, observable, testable, dan defensible di production?”

---

## 28. References

- Jakarta Validation 3.1 Specification: https://jakarta.ee/specifications/bean-validation/3.1/
- Jakarta Validation Specification HTML: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Bean Validation 2.0 Specification: https://beanvalidation.org/2.0/spec/
- Hibernate Validator Reference Guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator GitHub: https://github.com/hibernate/hibernate-validator
- Hibernate Validator Migration Guide: https://hibernate.org/validator/documentation/migration-guide/
- Spring Framework Bean Validation Reference: https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html
- Jakarta CDI Specification: https://jakarta.ee/specifications/cdi/

---

## 29. Status Seri

Seri belum selesai.

Part berikutnya:

`learn-java-validation-jakarta-hibernate-validator-part-019.md` — **Validation in REST APIs: JAX-RS, Spring MVC, Error Mapping, and Problem Details**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-017.md">⬅️ Hibernate Validator Extensions: Beyond the Specification</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-019.md">Validation in REST APIs: JAX-RS, Spring MVC, Error Mapping, and Problem Details ➡️</a>
</div>

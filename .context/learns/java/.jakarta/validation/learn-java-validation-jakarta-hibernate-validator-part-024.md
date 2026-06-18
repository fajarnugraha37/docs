# learn-java-validation-jakarta-hibernate-validator-part-024

# Performance Engineering: Cost Model, Fail Fast, Caching, Reflection, Hot Paths

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `024`  
> Topik: Performance engineering untuk Java/Jakarta Validation dan Hibernate Validator  
> Target Java: 8 sampai 25  
> Fokus: cost model, lifecycle, fail-fast, metadata cache, graph traversal, regex, hot path, observability, dan production decision making

---

## 1. Tujuan bagian ini

Pada bagian sebelumnya kita sudah membahas validation dari sisi API, custom constraint, message, error code, persistence, event-driven system, workflow, dan domain policy. Sekarang kita masuk ke pertanyaan yang sering muncul ketika sistem mulai besar:

> “Apakah validation ini mahal?”

Jawaban yang lebih benar:

> Validation bisa sangat murah, bisa juga sangat mahal. Biayanya tergantung di mana validation dilakukan, seberapa besar graph yang divalidasi, apakah validator memanggil dependency eksternal, apakah regex aman, apakah metadata cache dipakai dengan benar, apakah message interpolation dilakukan berlebihan, dan apakah validation berada di hot path.

Jakarta Validation sendiri menyediakan object-level constraint declaration, metadata API, serta method/constructor validation. Specification juga menyatakan bahwa API tidak terikat pada web atau persistence tier, sehingga bisa digunakan di berbagai layer aplikasi. Hibernate Validator adalah reference implementation yang menyediakan banyak optimisasi dan extension seperti fail-fast mode. Referensi resmi Jakarta Validation 3.1 menyebutkan bahwa Jakarta Validation mendefinisikan metadata model dan API untuk JavaBean dan method validation, sedangkan dokumentasi Hibernate Validator menjelaskan fail-fast sebagai mode untuk berhenti pada constraint violation pertama, berguna pada object graph besar ketika kita hanya perlu mengetahui apakah ada pelanggaran atau tidak.

Referensi:

- Jakarta Validation 3.1 Specification: <https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html>
- Jakarta Validation 3.1 overview: <https://jakarta.ee/specifications/bean-validation/3.1/>
- Bean Validation 2.0 Specification: <https://beanvalidation.org/2.0/spec/>
- Hibernate Validator Reference Guide: <https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/>
- Hibernate Validator releases: <https://hibernate.org/validator/releases/>
- Hibernate Validator migration guide: <https://hibernate.org/validator/documentation/migration-guide/>

---

## 2. Core mental model: validation is a costed pipeline

Jangan lihat validation sebagai satu operasi atomik bernama `validator.validate(obj)`.

Secara mental, anggap validation sebagai pipeline:

```text
Input object
   │
   ▼
Resolve bean metadata
   │
   ▼
Select groups / group sequence
   │
   ▼
Traverse properties / methods / container elements / cascaded graph
   │
   ▼
Resolve constraint validators
   │
   ▼
Execute each constraint validator
   │
   ├─ cheap local check
   ├─ regex check
   ├─ date/time check
   ├─ graph cascade
   ├─ DI-backed check
   └─ possibly expensive custom logic
   │
   ▼
Build ConstraintViolation objects
   │
   ▼
Interpolate message
   │
   ▼
Map to API/domain/event error model
```

Setiap tahap punya biaya.

Biaya paling umum:

| Area | Biasanya murah? | Bisa jadi mahal jika |
|---|---:|---|
| Metadata lookup | Ya, jika cached | `ValidatorFactory` dibuat ulang sering |
| Simple constraints | Ya | Jumlah field/object sangat besar |
| Cascaded validation | Sedang | Object graph dalam, cyclic, banyak collection |
| Container element constraints | Sedang | Nested `List<Map<String, List<...>>>` besar |
| Regex | Bisa murah | Pattern buruk, catastrophic backtracking |
| Message interpolation | Sedang | Semua error selalu dilocalize di hot path |
| Custom validator | Tergantung | Memanggil DB/API/cache/IO |
| Method validation | Murah-sedang | Dipasang di hot internal method sangat sering |
| Error mapping | Murah | Mengambil rejected value besar/PII, serialisasi berat |

Top-tier engineer tidak bertanya “validation lambat atau tidak?”, tetapi:

1. Validation ini berada di **boundary biasa** atau **hot path**?
2. Validation ini **local and deterministic** atau memanggil dependency eksternal?
3. Validation ini memeriksa **shape** atau **graph/domain policy besar**?
4. Kita perlu **semua violation** atau cukup tahu “valid/tidak valid”?
5. Cost validation bisa diamati lewat metric atau hanya dirasakan saat produksi lambat?

---

## 3. Performance principle utama

### 3.1 Validation harus murah secara default

Constraint seperti ini biasanya murah:

```java
public record CreateCustomerRequest(
        @NotBlank
        @Size(max = 100)
        String name,

        @NotBlank
        @Email
        String email,

        @Size(max = 20)
        String phoneNumber
) {}
```

Ini local, tidak cascade dalam, tidak memanggil DB, dan error count kecil.

### 3.2 Validation menjadi mahal ketika ia mulai menyamar sebagai domain engine

Contoh buruk:

```java
@Target({ ElementType.FIELD })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = UniqueEmailValidator.class)
public @interface UniqueEmail {
    String message() default "email already exists";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

@Component
public class UniqueEmailValidator implements ConstraintValidator<UniqueEmail, String> {
    private final CustomerRepository repository;

    public UniqueEmailValidator(CustomerRepository repository) {
        this.repository = repository;
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true;
        }
        return !repository.existsByEmail(value);
    }
}
```

Masalah:

1. Setiap validation bisa query database.
2. Race condition tetap ada: email bisa dibuat oleh request lain setelah check.
3. Error semantics bercampur: invalid input atau conflict?
4. Validator tidak lagi pure.
5. Latency validation tergantung database.
6. Batch validation bisa menghasilkan N query.

Lebih baik:

```text
DTO validation:
  - email required
  - email format
  - email max length

Application service:
  - check business conflict if needed

Database:
  - unique constraint as final consistency guard

Error mapping:
  - duplicate key -> EMAIL_ALREADY_REGISTERED
```

### 3.3 Jangan memindahkan semua correctness ke annotation

Annotation cocok untuk local invariant dan structural contract.

Annotation tidak ideal untuk:

- authorization,
- ownership,
- workflow transition,
- SLA calculation kompleks,
- cross-aggregate rule,
- uniqueness final,
- temporal rule yang memerlukan snapshot domain besar,
- rule yang harus versioned/auditable secara eksplisit.

Jika dipaksa, performa dan maintainability akan memburuk.

---

## 4. Lifecycle cost: `ValidatorFactory` dan `Validator`

### 4.1 `ValidatorFactory` mahal dan harus di-cache

Bootstrap seperti ini tidak boleh dilakukan per request:

```java
public Set<ConstraintViolation<MyDto>> validate(MyDto dto) {
    ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
    Validator validator = factory.getValidator();
    return validator.validate(dto);
}
```

Kenapa buruk?

Karena factory creation bisa melibatkan:

- provider discovery,
- metadata initialization,
- configuration parsing,
- value extractor discovery,
- constraint validator factory setup,
- message interpolator setup,
- clock provider setup,
- parameter name provider setup,
- XML/programmatic mapping load,
- integration dengan CDI/Spring/Jakarta EE.

Specification/Javadocs Bean Validation/Jakarta Validation menekankan bahwa `ValidatorFactory` sebaiknya di-cache dan di-share. Bean Validation 2.0 juga menyebut `Validator` implementation thread-safe dan caching `Validator` sebaiknya dikelola oleh `ValidatorFactory`.

Benar:

```java
public final class ValidationSupport implements AutoCloseable {
    private final ValidatorFactory validatorFactory;
    private final Validator validator;

    public ValidationSupport() {
        this.validatorFactory = Validation.buildDefaultValidatorFactory();
        this.validator = validatorFactory.getValidator();
    }

    public <T> Set<ConstraintViolation<T>> validate(T value, Class<?>... groups) {
        return validator.validate(value, groups);
    }

    @Override
    public void close() {
        validatorFactory.close();
    }
}
```

Dalam Spring Boot/Jakarta EE, biasanya framework sudah menyediakan `Validator` bean/facility. Jangan membuat factory manual kecuali memang ada kebutuhan khusus.

### 4.2 `Validator` bisa di-share

`Validator` adalah facade utama untuk validation dan metadata access. Ia umumnya thread-safe. Jadi pola ini benar:

```java
@Service
public class RequestValidationService {
    private final Validator validator;

    public RequestValidationService(Validator validator) {
        this.validator = validator;
    }

    public <T> void validateOrThrow(T object, Class<?>... groups) {
        Set<ConstraintViolation<T>> violations = validator.validate(object, groups);
        if (!violations.isEmpty()) {
            throw new RequestValidationException(violations);
        }
    }
}
```

### 4.3 Kapan boleh membuat lebih dari satu `ValidatorFactory`?

Boleh, tapi harus sadar konsekuensi.

Use case valid:

- factory A fail-fast, factory B full violations,
- factory per tenant dengan rule mapping berbeda,
- factory untuk bootstrap test tertentu,
- factory khusus batch import dengan message interpolator berbeda,
- factory migration tool yang memuat mapping legacy.

Namun jangan membuat factory per:

- request,
- message,
- row import,
- method call,
- validation attempt.

Jika ada multi-tenant rule, pertimbangkan apakah dynamic factory benar-benar perlu. Sering kali lebih aman memakai rule policy layer di luar Bean Validation.

---

## 5. Metadata cost dan metadata API

Validation provider perlu tahu constraints untuk class tertentu:

```java
BeanDescriptor descriptor = validator.getConstraintsForClass(CreateCaseRequest.class);
```

Metadata mencakup:

- property constraints,
- class-level constraints,
- container element constraints,
- executable constraints,
- group information,
- payload,
- message templates,
- constraint attributes,
- cascaded validation markers.

Metadata biasanya di-cache oleh provider/factory. Karena itu repeated validation terhadap class yang sama biasanya jauh lebih murah setelah warm-up.

### 5.1 Warm-up consideration

Pada aplikasi low-latency, request pertama bisa lebih lambat karena:

- class metadata pertama kali di-resolve,
- constraint validators pertama kali dibuat,
- message bundle pertama kali dibaca,
- regex pertama kali digunakan,
- framework proxy pertama kali aktif.

Jika latency request pertama penting, lakukan warm-up saat startup:

```java
@Component
public class ValidationWarmup implements ApplicationRunner {
    private final Validator validator;

    public ValidationWarmup(Validator validator) {
        this.validator = validator;
    }

    @Override
    public void run(ApplicationArguments args) {
        validator.getConstraintsForClass(CreateCaseRequest.class);
        validator.getConstraintsForClass(SubmitCaseRequest.class);
        validator.getConstraintsForClass(ApproveCaseRequest.class);
    }
}
```

Catatan: warm-up jangan memvalidasi dummy object yang berisiko memanggil DB/API dari custom validator. Cukup metadata introspection jika tujuan hanya memanaskan metadata.

---

## 6. Constraint execution cost model

### 6.1 Cheap constraints

Biasanya murah:

```java
@NotNull
@NotBlank
@Size(max = 100)
@Min(1)
@Max(999)
@Positive
@PastOrPresent
```

Mahalnya muncul jika:

- object sangat banyak,
- constraint dipanggil jutaan kali,
- digunakan dalam event stream throughput tinggi,
- error mapping melakukan kerja berat,
- message interpolation selalu dilakukan untuk semua violation.

### 6.2 Medium constraints

Contoh:

```java
@Email
@Pattern(regexp = "...")
@Digits(integer = 10, fraction = 2)
```

`@Pattern` bisa sangat murah atau sangat mahal tergantung regex.

### 6.3 Expensive constraints

Umumnya expensive:

- validator yang memanggil database,
- validator yang memanggil remote API,
- validator yang membaca file/config remote,
- validator yang melakukan cryptographic verification,
- validator yang melakukan parsing besar,
- validator yang melakukan regex kompleks,
- validator yang traverse graph besar,
- validator yang memvalidasi collection ribuan item.

Prinsip:

> Jika validator tidak pure, deterministic, dan local, treat it as expensive until proven otherwise.

---

## 7. Cascaded validation cost

`@Valid` bisa memperluas scope validation dari satu object menjadi graph traversal.

Contoh:

```java
public class SubmitApplicationRequest {
    @NotBlank
    private String applicationNo;

    @Valid
    @NotNull
    private ApplicantDto applicant;

    @Valid
    @Size(max = 50)
    private List<DocumentDto> documents;
}
```

Ini masih wajar.

Tetapi ini berbahaya:

```java
@Entity
public class CaseEntity {
    @Valid
    @OneToMany(mappedBy = "caseEntity")
    private List<CaseActionEntity> actions;

    @Valid
    @OneToMany(mappedBy = "caseEntity")
    private List<CaseDocumentEntity> documents;

    @Valid
    @OneToMany(mappedBy = "caseEntity")
    private List<CaseAuditTrailEntity> auditTrails;
}
```

Risiko:

1. Graph besar divalidasi tanpa sadar.
2. Lazy association bisa ter-load.
3. Flush bisa menjadi mahal.
4. Validasi entity menjadi bergantung pada persistence context.
5. Error path menjadi terlalu panjang.
6. Cycle handling memang ada, tapi bukan berarti graph traversal gratis.

### 7.1 Rule of thumb cascade

Gunakan cascade untuk:

- DTO request graph yang kecil,
- command object yang memang lengkap,
- nested value object,
- collection dengan batas ukuran jelas.

Hindari cascade untuk:

- JPA entity graph besar,
- bidirectional association,
- audit trail/history collection,
- lazy-loaded references,
- graph yang tidak punya bounded size,
- domain aggregate yang child collection-nya bisa ribuan.

### 7.2 Batasi collection size sebelum cascade mahal

Contoh:

```java
public record BulkImportRequest(
        @NotNull
        @Size(min = 1, max = 500)
        List<@Valid ImportRow> rows
) {}
```

`@Size(max = 500)` bukan hanya business rule. Ini juga performance guard.

Tanpa batas, user bisa mengirim 100.000 row dan memaksa server melakukan validation object graph besar.

---

## 8. Container element constraints cost

Type-use constraints modern sangat powerful:

```java
public record Request(
        List<@NotBlank @Size(max = 20) String> tags,
        Map<@NotBlank String, @Valid AttributeValue> attributes
) {}
```

Tapi ingat: constraint dieksekusi per element.

Jika `tags` berisi 10 item, murah. 100.000 item, mahal.

### 8.1 Nested container explosion

Contoh:

```java
Map<@NotBlank String, List<@Valid DocumentDto>> documentsByType
```

Cost roughly:

```text
number of map entries
  × number of documents per entry
  × constraints per document
  × possible cascaded child constraints
```

Jadi jangan hanya melihat annotation secara lokal. Lihat cardinality runtime.

### 8.2 ValueExtractor cost

Custom `ValueExtractor` untuk container custom seperti `PatchField<T>` atau `Either<L, R>` bisa sangat berguna, tetapi harus murah.

Buruk:

```java
public class ExpensiveValueExtractor implements ValueExtractor<MyContainer<@ExtractedValue ?>> {
    @Override
    public void extractValues(MyContainer<?> originalValue, ValueReceiver receiver) {
        Object value = originalValue.loadFromDatabase(); // buruk
        receiver.value("value", value);
    }
}
```

`ValueExtractor` harus dianggap sebagai traversal helper, bukan data loader.

---

## 9. Regex performance dan ReDoS

Regex adalah salah satu sumber performance bug paling sering pada validation.

Contoh pattern berbahaya:

```java
@Pattern(regexp = "^(a+)+$")
private String value;
```

Input tertentu seperti banyak `a` diikuti karakter mismatch bisa menyebabkan catastrophic backtracking.

### 9.1 Rule of thumb regex aman

Hindari:

- nested quantifier seperti `(a+)+`,
- alternation ambigu yang panjang,
- wildcard greedy tak terbatas,
- lookaround kompleks tanpa batas,
- regex dari config/user input tanpa review,
- regex untuk parsing grammar kompleks.

Lebih baik:

- batasi panjang input dengan `@Size(max = ...)`,
- gunakan regex linear sederhana,
- precompile di custom validator jika regex dinamis,
- gunakan parser khusus untuk format kompleks,
- benchmark worst-case input, bukan hanya happy path.

Contoh lebih aman:

```java
public record CaseReferenceRequest(
        @NotBlank
        @Size(max = 30)
        @Pattern(regexp = "^[A-Z]{2,10}-[0-9]{4}-[0-9]{1,10}$")
        String caseReferenceNo
) {}
```

`@Size(max = 30)` menjadi guard penting sebelum regex.

---

## 10. Message interpolation cost

Setiap violation biasanya membawa message template:

```java
@NotBlank(message = "{case.title.required}")
private String title;
```

Provider kemudian bisa melakukan:

- resource bundle lookup,
- locale resolution,
- annotation attribute interpolation,
- Expression Language evaluation,
- final string generation.

Untuk request biasa, ini bukan masalah.

Tetapi untuk batch import 100.000 row dengan ribuan violation, message interpolation bisa menjadi signifikan.

### 10.1 Jangan selalu jadikan human message sebagai source of truth

Untuk API, lebih baik error code stabil:

```json
{
  "code": "VALIDATION_FAILED",
  "violations": [
    {
      "path": "rows[31].postalCode",
      "code": "POSTAL_CODE_INVALID_FORMAT",
      "message": "Postal code format is invalid."
    }
  ]
}
```

Untuk internal high-throughput pipeline, bisa saja simpan:

```json
{
  "path": "rows[31].postalCode",
  "code": "POSTAL_CODE_INVALID_FORMAT",
  "messageTemplate": "{postalCode.invalid}",
  "constraint": "SingaporePostalCode"
}
```

Lalu human-readable message dibuat saat ditampilkan, bukan saat ingestion.

### 10.2 PII dan rejected value

Jangan mengoptimalkan performa dengan cara men-dump semua value ke log/error.

Buruk:

```java
violation.getInvalidValue().toString()
```

Masalah:

- bisa memanggil `toString()` mahal,
- bisa memuat PII,
- bisa memuat object graph besar,
- bisa membuka data sensitif,
- bisa memicu lazy loading jika object entity.

Gunakan redaction/classification.

---

## 11. Fail-fast mode

Hibernate Validator menyediakan fail-fast mode, yaitu berhenti pada violation pertama. Dokumentasi Hibernate Validator menjelaskan mode ini berguna untuk validation object graph besar ketika hanya perlu tahu apakah ada violation.

Konsep:

```text
Full validation:
  run all applicable constraints
  collect all violations

Fail-fast validation:
  stop as soon as first violation is found
```

### 11.1 Kapan fail-fast cocok?

Cocok untuk:

- internal guard,
- hot path boolean check,
- large graph where any invalid is enough,
- security precheck,
- batch pipeline tahap awal,
- workflow eligibility check yang hanya perlu “blocked/not blocked”.

Kurang cocok untuk:

- public API form validation,
- frontend UX yang ingin semua error sekaligus,
- batch import yang harus melaporkan semua row error,
- regulatory rejection yang butuh alasan lengkap,
- audit report yang perlu full rule evidence.

### 11.2 Contoh bootstrap fail-fast

```java
ValidatorFactory factory = Validation.byProvider(HibernateValidator.class)
        .configure()
        .failFast(true)
        .buildValidatorFactory();

Validator failFastValidator = factory.getValidator();
```

Atau property:

```properties
hibernate.validator.fail_fast=true
```

Catatan: nama property/config bisa berbeda tergantung framework dan versi. Misalnya Quarkus memiliki `quarkus.hibernate-validator.fail-fast`.

### 11.3 Fail-fast tidak menjamin violation mana yang pertama secara business meaningful

Jangan menulis logic seperti:

```java
ConstraintViolation<?> first = violations.iterator().next();
if (first.getPropertyPath().toString().equals("status")) {
    // business decision
}
```

Urutan constraint tidak boleh dijadikan business contract.

Jika butuh tahap bermakna, gunakan group sequence atau policy evaluator eksplisit.

---

## 12. Group sequence sebagai performance gate

Group sequence dapat digunakan untuk menjalankan validation bertahap:

```java
public interface BasicChecks {}
public interface ExpensiveChecks {}

@GroupSequence({ BasicChecks.class, ExpensiveChecks.class })
public interface OrderedChecks {}
```

Contoh DTO:

```java
public record RegisterAccountRequest(
        @NotBlank(groups = BasicChecks.class)
        @Email(groups = BasicChecks.class)
        String email,

        @StrongPassword(groups = ExpensiveChecks.class)
        String password
) {}
```

Jika `BasicChecks` gagal, `ExpensiveChecks` tidak dijalankan.

### 12.1 Kapan group sequence berguna?

- Jalankan cheap structural validation dulu.
- Jalankan expensive semantic validation belakangan.
- Hindari error noise dari validation yang bergantung pada field dasar valid.
- Buat staged validation yang predictable.

### 12.2 Kapan jangan memakai group sequence?

Jangan memakai group sequence untuk:

- workflow engine,
- authorization branching,
- state machine transition,
- cross-aggregate orchestration,
- complex rule dependency graph.

Group sequence adalah validation ordering tool, bukan orchestration model.

---

## 13. Custom validator performance design

### 13.1 Validator harus stateless atau immutable

Baik:

```java
public final class CaseReferenceValidator
        implements ConstraintValidator<CaseReference, String> {

    private static final Pattern PATTERN = Pattern.compile("^[A-Z]{2,10}-[0-9]{4}-[0-9]{1,10}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return value.length() <= 30 && PATTERN.matcher(value).matches();
    }
}
```

Buruk:

```java
public class NonThreadSafeValidator implements ConstraintValidator<MyConstraint, String> {
    private final StringBuilder buffer = new StringBuilder();

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        buffer.setLength(0);
        buffer.append(value);
        return expensiveCheck(buffer.toString());
    }
}
```

Validator instance bisa digunakan berulang dan harus aman secara concurrency. `isValid()` harus thread-safe.

### 13.2 Precompute di `initialize()`

Baik:

```java
public final class PrefixValidator implements ConstraintValidator<AllowedPrefix, String> {
    private Set<String> prefixes;

    @Override
    public void initialize(AllowedPrefix annotation) {
        this.prefixes = Set.of(annotation.value());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        return prefixes.stream().anyMatch(value::startsWith);
    }
}
```

Lebih baik jika prefix banyak:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null) {
        return true;
    }
    for (String prefix : prefixes) {
        if (value.startsWith(prefix)) {
            return true;
        }
    }
    return false;
}
```

Jangan parse annotation attribute berulang setiap `isValid()`.

### 13.3 Hindari allocation berlebihan

Buruk:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null) return true;
    return Arrays.asList("A", "B", "C").contains(value);
}
```

Baik:

```java
private static final Set<String> ALLOWED = Set.of("A", "B", "C");

@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    return value == null || ALLOWED.contains(value);
}
```

Untuk Java 8:

```java
private static final Set<String> ALLOWED = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("A", "B", "C"))
);
```

### 13.4 Jangan gunakan exception untuk normal invalid result

Buruk:

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    try {
        parse(value);
        return true;
    } catch (Exception e) {
        return false;
    }
}
```

Boleh jika parser API memang hanya expose exception, tapi untuk hot path, exception sebagai control flow mahal.

Lebih baik precheck format sederhana sebelum parsing.

---

## 14. Database-backed validation performance

### 14.1 N+1 validation query

Contoh import:

```java
public record ImportRow(
        @ExistingAgencyCode
        String agencyCode
) {}
```

Jika validator query DB per row:

```text
10.000 rows = 10.000 DB queries
```

Ini buruk.

### 14.2 Alternative: preload reference data

Untuk batch:

```java
public ImportValidationResult validateImport(List<ImportRow> rows) {
    Set<String> submittedAgencyCodes = rows.stream()
            .map(ImportRow::agencyCode)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());

    Set<String> existingCodes = agencyRepository.findExistingCodes(submittedAgencyCodes);

    // validate in memory
}
```

Pisahkan:

```text
Bean Validation:
  - agencyCode required
  - agencyCode format
  - max length

Batch domain validation:
  - agencyCode exists using bulk query
```

### 14.3 Request path uniqueness

Untuk create request:

```text
Do not rely on @UniqueEmail only.
Use database unique constraint as final guard.
```

Pattern:

```java
try {
    repository.save(customer);
} catch (DataIntegrityViolationException ex) {
    throw new ConflictException("EMAIL_ALREADY_EXISTS", ex);
}
```

Validation boleh memberikan early UX feedback, tapi DB constraint tetap authoritative.

---

## 15. Method validation hot path

Method validation bagus sebagai service contract:

```java
@Validated
@Service
public class CaseCommandService {
    public void submit(@Valid @NotNull SubmitCaseCommand command) {
        // ...
    }
}
```

Tapi hati-hati jika dipasang di method yang dipanggil sangat sering:

```java
@Positive
public int normalizeScore(@Min(0) int rawScore) {
    return Math.min(rawScore, 100);
}
```

Jika method ini dipanggil jutaan kali di loop, proxy-based validation dapat menjadi overhead signifikan.

### 15.1 Rule of thumb method validation

Cocok untuk:

- public service boundary,
- controller/resource boundary,
- command handler,
- facade antar module,
- integration adapter.

Hindari untuk:

- inner-loop utility method,
- mapper per field,
- computation hot path,
- serialization/deserialization tight loop,
- methods called millions of times per second.

### 15.2 Self-invocation issue

Dalam Spring proxy model:

```java
@Service
@Validated
public class CaseService {
    public void outer() {
        inner(null); // self-invocation may bypass proxy validation
    }

    public void inner(@NotNull String value) {
        // ...
    }
}
```

Performance implication: jangan mengandalkan method validation sebagai internal invariant di semua tempat. Pahami framework invocation model.

---

## 16. Batch validation strategy

Batch/import adalah tempat validation cost mudah meledak.

### 16.1 Naive approach

```java
List<RowError> errors = new ArrayList<>();
for (ImportRow row : rows) {
    Set<ConstraintViolation<ImportRow>> violations = validator.validate(row);
    errors.addAll(map(violations));
}
```

Ini bisa cukup untuk batch kecil.

Masalah untuk batch besar:

- banyak object allocation,
- banyak message interpolation,
- banyak path building,
- banyak duplicate reference checks,
- memory pressure dari menyimpan semua errors.

### 16.2 Better staged batch pipeline

```text
Stage 1: payload size limit
Stage 2: parse file/JSON/CSV
Stage 3: row shape validation
Stage 4: collect reference keys
Stage 5: bulk reference lookup
Stage 6: semantic validation in memory
Stage 7: deduplication and cross-row validation
Stage 8: persist valid rows / reject batch / partial accept
```

### 16.3 Cap violation count

Jangan biarkan satu request menghasilkan 1 juta error object.

Gunakan cap:

```java
public final class ViolationCollector {
    private final int maxErrors;
    private final List<RowError> errors = new ArrayList<>();
    private boolean truncated;

    public ViolationCollector(int maxErrors) {
        this.maxErrors = maxErrors;
    }

    public void add(RowError error) {
        if (errors.size() >= maxErrors) {
            truncated = true;
            return;
        }
        errors.add(error);
    }

    public boolean isTruncated() {
        return truncated;
    }
}
```

API response:

```json
{
  "code": "BATCH_VALIDATION_FAILED",
  "errorCount": 1000,
  "truncated": true,
  "message": "Too many validation errors. Showing first 1000 errors."
}
```

### 16.4 Full error vs first error per row

Untuk UX import, sering lebih baik:

- maksimal N error per row,
- maksimal M row error per file,
- severity ordering,
- structural error dulu,
- semantic error setelah structural valid.

---

## 17. Validation and memory allocation

Validation menghasilkan object:

- `ConstraintViolation`,
- `Path` nodes,
- message string,
- interpolated values,
- collections of violations,
- API error DTO,
- rejected value representation,
- exception object.

Pada request normal, ini kecil.

Pada high-throughput/batch, ini bisa signifikan.

### 17.1 Jangan throw exception untuk internal expected invalid dalam loop besar

Buruk:

```java
for (ImportRow row : rows) {
    try {
        validateOrThrow(row);
    } catch (ValidationException ex) {
        errors.add(toError(ex));
    }
}
```

Lebih baik:

```java
for (ImportRow row : rows) {
    Set<ConstraintViolation<ImportRow>> violations = validator.validate(row);
    if (!violations.isEmpty()) {
        errors.addAll(toErrors(row, violations));
    }
}
```

Exception bagus untuk request boundary. Untuk batch internal, return result lebih efisien dan jelas.

### 17.2 Jangan simpan invalid object graph penuh di error result

Buruk:

```java
public record ValidationError(
        String path,
        Object rejectedValue,
        Object wholeRequest
) {}
```

Baik:

```java
public record ValidationError(
        String path,
        String code,
        String message,
        String rejectedValuePreview
) {}
```

Gunakan redacted preview jika aman.

---

## 18. Validation in virtual-thread era

Java 21 membawa virtual threads sebagai fitur final. Java 25 berada di era modern yang makin sering memakai virtual threads untuk request handling/blocking IO concurrency.

Validation local CPU-bound biasanya aman di virtual thread.

Tetapi validator yang melakukan blocking DB/API call dapat menyebabkan:

- latency per request meningkat,
- load dependency naik,
- throughput turun,
- backpressure sulit dipahami,
- validator berubah menjadi hidden IO layer.

Virtual threads tidak membuat IO validation menjadi “gratis”. Ia membuat concurrency blocking lebih murah, tetapi dependency tetap punya limit.

Prinsip:

```text
Virtual thread does not remove database capacity, API rate limit, or remote latency.
```

Maka:

- tetap hindari DB/API call dalam `ConstraintValidator`,
- gunakan bulk lookup untuk batch,
- gunakan service layer untuk contextual checks,
- gunakan timeout/circuit breaker di dependency layer, bukan annotation validator.

---

## 19. AOT/native-image consideration

Pada environment AOT/native-image seperti GraalVM native image, Quarkus, atau Spring AOT, reflection metadata perlu diperhatikan.

Validation framework biasanya membutuhkan:

- annotation metadata,
- constructor/field/method access,
- record component metadata,
- message bundles,
- constraint validator classes,
- value extractor classes.

Framework modern sering menyediakan integration otomatis, tetapi custom constraint, custom value extractor, custom message interpolator, atau programmatic mapping tetap perlu diuji.

Checklist:

1. Custom `ConstraintValidator` terdeteksi?
2. Message bundle ikut masuk?
3. Record component constraints terbaca?
4. Method validation masih jalan?
5. Parameter names tersedia jika dibutuhkan?
6. Programmatic mapping tidak bergantung pada classpath scanning runtime yang tidak tersedia?
7. Error response sama antara JVM dan native image?

---

## 20. Observability: validation harus bisa diukur

Tanpa observability, validation performance hanya menjadi opini.

### 20.1 Metrics yang berguna

Minimal:

```text
validation.requests.total
validation.violations.total
validation.duration
validation.failures.by_constraint
validation.failures.by_path
validation.failures.by_endpoint
validation.failures.by_group
validation.failures.by_client_version
validation.truncated_errors.total
```

Untuk expensive validation:

```text
validation.external_lookup.total
validation.external_lookup.duration
validation.cache.hit
validation.cache.miss
validation.batch.rows.validated
validation.batch.errors.count
```

### 20.2 Jangan label metric dengan cardinality liar

Buruk:

```text
validation.failure{path="documents[12345].metadata.someDynamicKey"}
```

Lebih baik normalize:

```text
validation.failure{path="documents[].metadata.*", constraint="NotBlank"}
```

### 20.3 Timing wrapper

Contoh sederhana:

```java
public final class TimedValidator {
    private final Validator validator;
    private final ValidationMetrics metrics;

    public TimedValidator(Validator validator, ValidationMetrics metrics) {
        this.validator = validator;
        this.metrics = metrics;
    }

    public <T> Set<ConstraintViolation<T>> validate(
            String validationName,
            T object,
            Class<?>... groups
    ) {
        long startNanos = System.nanoTime();
        try {
            Set<ConstraintViolation<T>> violations = validator.validate(object, groups);
            metrics.recordViolationCount(validationName, violations.size());
            return violations;
        } finally {
            long durationNanos = System.nanoTime() - startNanos;
            metrics.recordDuration(validationName, durationNanos);
        }
    }
}
```

`validationName` harus low-cardinality, misalnya:

- `create-case-request`,
- `submit-application-command`,
- `import-row-basic`,
- `outbound-case-event`.

---

## 21. Benchmarking validation dengan benar

### 21.1 Jangan benchmark dengan stopwatch naive saja

Buruk:

```java
long start = System.currentTimeMillis();
for (int i = 0; i < 1_000_000; i++) {
    validator.validate(dto);
}
System.out.println(System.currentTimeMillis() - start);
```

Masalah:

- JIT warm-up tidak jelas,
- dead-code elimination mungkin terjadi,
- GC tidak diamati,
- data tidak representative,
- factory/bootstrap cost bercampur dengan runtime cost,
- violation/no violation path berbeda.

### 21.2 Benchmark skenario yang benar

Pisahkan:

1. Bootstrap cost.
2. First validation cost.
3. Steady-state valid object cost.
4. Steady-state invalid object cost.
5. Full violations vs fail-fast.
6. Small DTO vs large graph.
7. Regex worst-case.
8. Batch validation memory pressure.
9. Message interpolation on/off/locale variation.
10. Custom validator with cache hit/miss.

Untuk benchmark Java serius, gunakan JMH. Karena Anda sudah punya seri testing/benchmarking/performance, detail JMH tidak diulang di sini. Yang penting: benchmark validation harus memodelkan **cost shape** yang benar.

---

## 22. Hot path decision framework

Ketika melihat validation di PR, tanyakan:

### 22.1 Apakah validation ini di public boundary?

Jika ya:

- correctness lebih penting,
- full error mungkin dibutuhkan,
- response harus structured,
- performance dijaga dengan limit size dan local checks.

### 22.2 Apakah validation ini di internal hot loop?

Jika ya:

- hindari proxy method validation,
- hindari message interpolation,
- hindari exception per invalid item,
- hindari DB/API call,
- gunakan direct predicate atau specialized validator jika perlu.

### 22.3 Apakah validation ini di batch?

Jika ya:

- limit row count,
- cap error count,
- staged validation,
- bulk reference lookup,
- stream result jika besar,
- jangan simpan semua object graph invalid.

### 22.4 Apakah validation ini di workflow transition?

Jika ya:

- Bean Validation untuk command shape,
- policy evaluator untuk contextual rule,
- state machine guard untuk transition,
- DB constraint untuk consistency,
- audit trail untuk decision evidence.

---

## 23. Practical architecture: two validators, two modes

Dalam sistem besar, sering berguna punya dua mode:

```text
User-facing mode:
  - collect violations
  - localized messages
  - stable error code
  - best UX

Fast internal mode:
  - fail-fast
  - no heavy message interpolation if possible
  - boolean/decision result
  - used for hot guard
```

Contoh:

```java
@Configuration
public class ValidationConfiguration {

    @Bean
    public ValidatorFactory fullValidatorFactory() {
        return Validation.buildDefaultValidatorFactory();
    }

    @Bean
    public Validator fullValidator(ValidatorFactory fullValidatorFactory) {
        return fullValidatorFactory.getValidator();
    }

    @Bean
    public Validator failFastValidator() {
        ValidatorFactory factory = Validation.byProvider(HibernateValidator.class)
                .configure()
                .failFast(true)
                .buildValidatorFactory();
        return factory.getValidator();
    }
}
```

Catatan produksi:

- Jika membuat factory manual di Spring, pastikan lifecycle/close benar.
- Jangan membuat terlalu banyak factory.
- Dokumentasikan kapan validator mana dipakai.
- Pastikan behavior error tidak berbeda tanpa sengaja.

Alternatif lebih sederhana: satu factory default, dan fail-fast hanya dipakai di komponen khusus yang jelas.

---

## 24. Case management example

Misalnya ada request submit application:

```java
public record SubmitApplicationRequest(
        @NotBlank
        @Size(max = 30)
        String applicationNo,

        @NotNull
        @Valid
        ApplicantDto applicant,

        @NotNull
        @Size(min = 1, max = 50)
        List<@Valid DocumentDto> documents,

        @Size(max = 20)
        List<@NotBlank @Size(max = 50) String> declarations
) {}
```

Performance-safe shape:

- `applicationNo` dibatasi.
- `documents` dibatasi maksimum 50.
- `declarations` dibatasi maksimum 20.
- element string dibatasi.
- nested DTO divalidasi dengan `@Valid`.

Jangan lakukan ini di annotation:

```java
@ApplicationCanBeSubmitted
String applicationNo;
```

Jika validator itu memanggil:

- database case state,
- user role,
- document completeness,
- deadline/SLA,
- pending appeal,
- maker-checker conflict,
- external eligibility service,

maka itu bukan Bean Validation sederhana. Itu transition policy.

Better flow:

```text
1. Deserialize request
2. Jakarta Validation: shape/local invariant
3. Load case aggregate snapshot
4. Workflow policy: can submit?
5. Domain operation: submit
6. Persistence: optimistic lock + DB constraints
7. Event emission
8. Audit decision
```

Pseudo-code:

```java
public SubmitResult submit(SubmitApplicationRequest request, Actor actor) {
    validateRequestShape(request);

    CaseAggregate aggregate = caseRepository.getByApplicationNo(request.applicationNo());

    PolicyDecision decision = submitPolicy.evaluate(new SubmitContext(
            aggregate,
            actor,
            clock.instant()
    ));

    if (decision.isBlocked()) {
        throw new WorkflowConflictException(decision);
    }

    aggregate.submit(actor, clock.instant());
    caseRepository.save(aggregate);
    outbox.add(CaseSubmittedEvent.from(aggregate));

    return SubmitResult.success(aggregate.id());
}
```

Performance benefit:

- cheap local validation happens before DB load,
- expensive workflow validation happens only after request shape valid,
- policy result is auditable,
- Bean Validation does not hide DB/API calls,
- bounded object graph avoids accidental traversal explosion.

---

## 25. Security-performance intersection

Performance and security overlap strongly in validation.

Important guards:

| Guard | Security benefit | Performance benefit |
|---|---|---|
| `@Size(max=...)` on String | prevents huge payload field | bounds regex/message cost |
| collection max size | prevents memory/CPU abuse | bounds cascade traversal |
| nesting depth control | prevents parser/graph abuse | bounds recursive processing |
| regex review | prevents ReDoS | keeps matching predictable |
| fail-fast for guard | reduces abuse cost | stops early |
| error cap | avoids huge response/log | avoids memory blowup |
| redaction | avoids PII leakage | avoids heavy `toString()` |

Validation is not sanitization, but validation is one of the earliest abuse-resistance layers.

---

## 26. Java 8 sampai Java 25 notes

### Java 8

- Bean Validation 2.0 era penting.
- Type-use/container element constraints mulai relevan.
- Tidak ada records/sealed classes.
- Gunakan DTO class biasa.
- Hati-hati dengan stream allocation pada validator hot path.

### Java 11

- Banyak enterprise system masih di fase ini.
- Migration dari `javax.validation` ke `jakarta.validation` belum otomatis.
- Hibernate Validator 6.x sering masih ditemukan.

### Java 17

- Baseline penting untuk stack Jakarta EE 11/Hibernate Validator 9.x.
- Records dan sealed classes lebih matang.
- Cocok untuk modern validation modeling.

### Java 21

- Virtual threads final.
- Jangan menganggap blocking validator gratis.
- Cocok untuk immutable/record-heavy DTO pipeline.

### Java 25

- Treat sebagai modern LTS-era target untuk codebase baru.
- Gunakan records/value-style modeling dengan baik.
- Validation harus tetap bounded, observable, dan AOT-aware jika environment membutuhkan.

### Hibernate Validator version awareness

- HV 6.x: `javax.validation`, cocok untuk legacy Java 8/11 stack.
- HV 7/8.x: `jakarta.validation`, Jakarta EE 9/10 generation.
- HV 9.x: Jakarta Validation 3.1/Jakarta EE 11 generation, Java 17 minimum menurut release/migration notes.

---

## 27. Anti-patterns

### 27.1 Build `ValidatorFactory` per request

```java
Validation.buildDefaultValidatorFactory().getValidator().validate(obj);
```

Masalah: expensive bootstrap berulang.

### 27.2 `@Valid` everywhere

Masalah: graph traversal tidak terkendali.

### 27.3 DB query dalam setiap `ConstraintValidator`

Masalah: latency, N+1, race condition, hidden dependency.

### 27.4 Regex tanpa length bound

Masalah: ReDoS dan CPU spike.

### 27.5 Full violation collection untuk hot boolean check

Masalah: melakukan kerja lebih dari yang dibutuhkan.

### 27.6 Fail-fast untuk user-facing form tanpa alasan

Masalah: UX buruk, user memperbaiki error satu per satu.

### 27.7 Message sebagai error code

Masalah: i18n, compatibility, parsing fragile.

### 27.8 Rejected value logging mentah

Masalah: PII leak, heavy serialization.

### 27.9 Method validation di inner loop

Masalah: proxy/validation overhead tidak perlu.

### 27.10 Group sequence sebagai workflow engine

Masalah: rule tersembunyi, audit buruk, debugging sulit.

---

## 28. Production checklist

Sebelum merge validation rule baru, cek:

### Correctness

- Apakah rule ini local validation, domain policy, authorization, workflow guard, atau DB consistency?
- Apakah annotation adalah tempat yang tepat?
- Apakah null semantics benar?
- Apakah operation-specific contract benar?

### Performance

- Apakah berada di hot path?
- Apakah collection size dibatasi?
- Apakah cascaded graph bounded?
- Apakah regex aman dan diberi max length?
- Apakah validator memanggil DB/API?
- Apakah batch path punya cap error?
- Apakah full violations memang diperlukan?
- Apakah fail-fast bisa dipakai untuk internal guard?

### Lifecycle

- Apakah `ValidatorFactory` dibuat sekali?
- Apakah `Validator` di-inject/reused?
- Apakah custom validator thread-safe?
- Apakah `initialize()` dipakai untuk precompute?

### API/error

- Apakah error code stabil?
- Apakah rejected value aman?
- Apakah message interpolation tidak jadi source of truth?
- Apakah path normalized?

### Observability

- Apakah ada metric duration/count?
- Apakah top failing constraints bisa dilihat?
- Apakah expensive validator bisa dideteksi?
- Apakah batch truncation dilaporkan?

### Migration/version

- Apakah namespace `javax`/`jakarta` konsisten?
- Apakah HV version sesuai Java baseline?
- Apakah native/AOT metadata diuji jika relevan?

---

## 29. Mental model akhir

Validation performance bukan terutama soal “annotation lambat”. Annotation biasanya bukan masalah.

Masalah performance muncul ketika:

1. Factory/bootstrap salah lifecycle.
2. Object graph tidak bounded.
3. Collection tidak dibatasi.
4. Regex buruk.
5. Custom validator memanggil dependency eksternal.
6. Full errors dibuat di hot path.
7. Message interpolation dan error mapping dilakukan berlebihan.
8. Validation dipakai sebagai workflow/domain/rule engine tersembunyi.
9. Observability tidak ada.

Mental model yang sehat:

```text
Cheap structural validation early.
Bound graph and payload size.
Keep ConstraintValidator local and deterministic.
Use group sequence or fail-fast only when semantics match.
Move contextual/cross-aggregate checks to explicit policy layer.
Use DB constraints as final consistency guard.
Measure validation cost in production.
```

---

## 30. Ringkasan

Di bagian ini kita sudah membahas:

- cost model Jakarta/Hibernate Validator,
- lifecycle `ValidatorFactory` dan `Validator`,
- metadata cache dan warm-up,
- constraint execution cost,
- cascaded validation cost,
- container element cost,
- regex/ReDoS,
- message interpolation,
- fail-fast mode,
- group sequence sebagai performance gate,
- custom validator performance design,
- DB-backed validation risk,
- method validation hot path,
- batch validation strategy,
- memory allocation,
- virtual thread consideration,
- AOT/native-image consideration,
- observability,
- benchmarking strategy,
- case management validation architecture,
- anti-patterns,
- production checklist.

Intinya:

> Validation yang baik bukan hanya benar secara rule, tetapi juga bounded, predictable, observable, dan ditempatkan di layer yang tepat.

---

## 31. Status seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-025.md
```

Topik berikutnya:

```text
Security and Abuse Resistance: Validation Is Not Sanitization
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-validation-jakarta-hibernate-validator-part-023](./learn-java-validation-jakarta-hibernate-validator-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-validation-jakarta-hibernate-validator-part-025](./learn-java-validation-jakarta-hibernate-validator-part-025.md)

</div>
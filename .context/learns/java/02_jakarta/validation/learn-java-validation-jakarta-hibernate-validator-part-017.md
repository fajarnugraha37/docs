# learn-java-validation-jakarta-hibernate-validator-part-017

# Hibernate Validator Extensions: Beyond the Specification

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Part: `017`  
> Topik: Hibernate Validator extensions, provider-specific features, fail-fast, built-in non-standard constraints, clock provider, payload, value extraction, configuration, and provider lock-in strategy  
> Target Java: Java 8 sampai Java 25  
> Target API: Bean Validation 2.0 `javax.validation`, Jakarta Validation 3.x `jakarta.validation`, Hibernate Validator 6.x sampai 9.x

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. validation sebagai kontrak dan boundary defense,
2. landscape `javax.validation` vs `jakarta.validation`,
3. core API seperti `ValidatorFactory`, `Validator`, `ConstraintViolation`, dan metadata,
4. built-in constraints standar,
5. nullability strategy,
6. cascaded validation,
7. container element constraints,
8. validation groups dan group sequence,
9. custom constraint,
10. class-level/cross-field validation,
11. executable validation,
12. records/immutability/builders,
13. message interpolation,
14. payload/error codes,
15. programmatic constraint mapping,
16. constraint composition.

Sekarang kita masuk ke wilayah yang sangat penting untuk engineer senior: **apa saja fitur Hibernate Validator yang melampaui spesifikasi Jakarta Validation**, bagaimana memakainya dengan benar, dan kapan justru harus menghindarinya.

Hibernate Validator adalah reference implementation untuk Jakarta Validation. Tetapi Hibernate Validator bukan hanya “implementasi standar”. Ia juga menyediakan banyak extension:

- constraint tambahan,
- configuration tambahan,
- fail-fast mode,
- custom clock provider behavior,
- constraint validator payload,
- dynamic default group sequence,
- programmatic constraint mapping,
- specialized value extraction,
- script/property node enhancement,
- provider-specific APIs,
- tuning untuk integration framework.

Sebagian extension ini sangat berguna. Sebagian lain bisa membuat sistem sulit dimigrasi, sulit dites, atau terlalu bergantung pada provider.

Mental model utama part ini:

> Jakarta Validation adalah kontrak portabel. Hibernate Validator adalah engine dengan fitur ekstra. Pakai extension ketika value-nya jelas, risiko lock-in-nya diterima, dan boundary-nya terdokumentasi.

---

## 1. Jakarta Validation Specification vs Hibernate Validator Implementation

### 1.1 Apa yang distandardisasi oleh Jakarta Validation

Jakarta Validation mendefinisikan:

- annotation constraint model,
- `ValidatorFactory`,
- `Validator`,
- `ConstraintViolation`,
- group,
- group sequence,
- cascaded validation,
- container element validation,
- method/constructor validation,
- metadata API,
- message interpolation,
- XML mapping,
- bootstrap mechanism,
- service provider mechanism.

Hal-hal ini portable selama kita hanya memakai package dan behavior standar:

```java
import jakarta.validation.Valid;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
```

Atau pada stack lama:

```java
import javax.validation.Valid;
import javax.validation.Validation;
import javax.validation.Validator;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
```

Jika hanya memakai API standar, secara teori provider bisa diganti dari Hibernate Validator ke provider lain.

Dalam praktik, Hibernate Validator adalah provider paling dominan dan menjadi reference implementation. Untuk enterprise Java, Spring Boot, Quarkus, Jakarta EE, dan banyak stack JVM lain, Hibernate Validator sering menjadi default engine.

### 1.2 Apa yang dimaksud extension

Extension adalah fitur yang tidak dijamin oleh specification, misalnya:

```java
import org.hibernate.validator.constraints.Length;
import org.hibernate.validator.constraints.Range;
import org.hibernate.validator.constraints.UUID;
```

Atau konfigurasi provider-specific:

```java
import org.hibernate.validator.HibernateValidator;
import org.hibernate.validator.HibernateValidatorConfiguration;

ValidatorFactory factory = Validation
    .byProvider(HibernateValidator.class)
    .configure()
    .failFast(true)
    .buildValidatorFactory();
```

Kode seperti ini secara eksplisit memilih Hibernate Validator.

Itu bukan salah. Tetapi harus sadar bahwa kita sedang membuat keputusan arsitektur.

---

## 2. Compatibility Landscape: Java 8 sampai Java 25

### 2.1 Versi penting

Secara praktis:

| Era | API | Package | Hibernate Validator | Java umum | Catatan |
|---|---|---|---|---|---|
| Legacy Java EE / Spring Boot 2 | Bean Validation 2.0 | `javax.validation` | HV 6.x | Java 8+ | Banyak aplikasi enterprise lama berada di sini |
| Jakarta EE 9/10 / Spring Boot 3 awal | Jakarta Validation 3.0 | `jakarta.validation` | HV 7.x/8.x | Java 11/17+ tergantung stack | Perubahan besar package namespace |
| Jakarta EE 11 modern | Jakarta Validation 3.1 | `jakarta.validation` | HV 9.x | Java 17+ | Clarification untuk records, Java 17 minimum |

Hibernate Validator 9.x menargetkan Jakarta Validation 3.1/Jakarta EE 11 dan mensyaratkan Java 17+. Hibernate Validator 9.1.0.Final dan Jakarta Validation 3.1.1 juga mensyaratkan Java 17 atau lebih baru.

### 2.2 Konsekuensi untuk seri Java 8–25

Karena seri ini mencakup Java 8 sampai 25, kita perlu membedakan tiga mode berpikir:

#### Mode A — Legacy portable Java 8

Gunakan:

```java
javax.validation.*
```

Dan biasanya Hibernate Validator 6.x.

Cocok untuk:

- aplikasi Spring Boot 2,
- Java 8/11 legacy,
- application server lama,
- sistem yang belum migrasi ke Jakarta namespace.

#### Mode B — Jakarta modern Java 17+

Gunakan:

```java
jakarta.validation.*
```

Dan biasanya Hibernate Validator 8.x/9.x.

Cocok untuk:

- Spring Boot 3+,
- Jakarta EE 10/11,
- Quarkus modern,
- Java 17/21/25,
- records dan immutable DTO modern.

#### Mode C — Cross-version library

Jika membuat shared validation library yang harus dipakai Java 8 dan Java 21 sekaligus, jangan campur sembarangan.

Buruk:

```java
// Library A exposes javax annotations
public class PersonDto {
    @javax.validation.constraints.NotBlank
    private String name;
}
```

Lalu dipakai aplikasi Spring Boot 3 yang hanya scan `jakarta.validation`.

Hasilnya bisa membingungkan: constraint ada di source code, tetapi tidak efektif karena namespace tidak cocok.

Pattern yang lebih aman:

- pisahkan artifact `validation-javax` dan `validation-jakarta`, atau
- migrasikan seluruh platform sekaligus, atau
- jangan expose annotated DTO lintas namespace, atau
- gunakan internal domain rule object yang tidak bergantung ke namespace validation.

---

## 3. Provider-Specific Constraints

Hibernate Validator menyediakan constraint tambahan di luar standar Jakarta Validation.

Contoh yang umum dikenal:

- `@Length`,
- `@Range`,
- `@URL`,
- `@UUID`,
- `@CreditCardNumber`,
- `@Currency`,
- `@EAN`,
- `@ISBN`,
- `@CodePointLength`,
- `@UniqueElements`,
- country/identifier-specific constraints tergantung versi,
- crypto/identifier constraints pada versi baru tertentu.

Beberapa constraint berpindah status atau berubah relevansi antar versi. Misalnya, `@UUID` muncul sebagai Hibernate Validator-specific constraint pada HV 8.x line, sementara HV 9.x menambahkan beberapa constraint baru seperti `@KorRRN` dan `@BitcoinAddress` dalam release series-nya.

Prinsip penting:

> Jangan menghafal daftar constraint sebagai “selalu ada”. Selalu cek versi Hibernate Validator yang dipakai aplikasi.

### 3.1 `@Length` vs `@Size`

Hibernate Validator:

```java
import org.hibernate.validator.constraints.Length;

public record CreateUserRequest(
    @Length(min = 3, max = 80)
    String displayName
) {}
```

Standar Jakarta Validation:

```java
import jakarta.validation.constraints.Size;

public record CreateUserRequest(
    @Size(min = 3, max = 80)
    String displayName
) {}
```

Untuk `String`, sering kali `@Size` cukup.

Gunakan `@Size` jika:

- ingin portabilitas,
- tidak butuh fitur khusus,
- constraint hanya panjang string/collection/map/array.

Gunakan `@Length` hanya jika:

- sudah jelas ingin Hibernate Validator-specific,
- tim menyepakati provider lock-in,
- ada alasan konsistensi legacy.

Untuk sistem besar, default recommendation:

```java
// Prefer this
@Size(min = 3, max = 80)
private String displayName;
```

Bukan:

```java
// Avoid unless intentionally provider-specific
@Length(min = 3, max = 80)
private String displayName;
```

### 3.2 `@Range` vs `@Min` + `@Max`

Hibernate Validator:

```java
import org.hibernate.validator.constraints.Range;

@Range(min = 1, max = 100)
private Integer score;
```

Standar:

```java
@Min(1)
@Max(100)
private Integer score;
```

`@Range` lebih ringkas. Tetapi `@Min` + `@Max` portable dan memberi dua error yang lebih spesifik.

Trade-off:

| Pendekatan | Kelebihan | Kekurangan |
|---|---|---|
| `@Range` | Ringkas, satu semantic range | Provider-specific |
| `@Min` + `@Max` | Portable, error lebih granular | Sedikit lebih verbose |

Untuk API publik, `@Min` + `@Max` sering lebih baik karena error code bisa spesifik:

```json
{
  "errors": [
    {
      "path": "score",
      "code": "score.too_low",
      "message": "Score must be at least 1."
    }
  ]
}
```

Dengan `@Range`, code sering menjadi lebih generik:

```json
{
  "path": "score",
  "code": "score.out_of_range"
}
```

Keduanya valid. Pilih berdasarkan contract, bukan selera.

### 3.3 `@URL`

Hibernate Validator menyediakan `@URL` untuk validasi URL.

Contoh:

```java
import org.hibernate.validator.constraints.URL;

public record RegisterWebsiteRequest(
    @URL(protocol = "https")
    String website
) {}
```

Pertanyaan penting: apakah validasi URL cukup dengan annotation?

Biasanya tidak.

Untuk security-sensitive system, URL harus diperlakukan hati-hati:

- apakah domain boleh private IP?
- apakah boleh `localhost`?
- apakah boleh redirect?
- apakah boleh non-standard port?
- apakah DNS rebinding relevant?
- apakah akan dipakai server-side fetch?
- apakah perlu allowlist domain?

`@URL` hanya format-level validation. Ia bukan SSRF protection.

Buruk:

```java
@URL
private String callbackUrl;

public void callWebhook(String callbackUrl) {
    httpClient.get(callbackUrl); // dangerous if no outbound policy
}
```

Lebih aman:

```java
@URL(protocol = "https")
private String callbackUrl;

// Then separately enforce:
// - allowlisted host
// - no private ranges
// - no localhost
// - DNS resolution policy
// - redirect policy
// - timeout
// - outbound firewall
```

Mental model:

> `@URL` menjawab “apakah ini terlihat seperti URL?”. Ia tidak menjawab “apakah aman dipanggil server?”.

### 3.4 `@UUID`

Pada modern systems, UUID sering dipakai sebagai public identifier.

Hibernate Validator menyediakan `@UUID` pada versi tertentu.

Contoh:

```java
import org.hibernate.validator.constraints.UUID;

public record GetCaseRequest(
    @UUID
    String casePublicId
) {}
```

Alternatif portable:

```java
@Pattern(regexp = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
private String casePublicId;
```

Atau lebih baik jika framework binding mendukung:

```java
public record GetCaseRequest(
    java.util.UUID casePublicId
) {}
```

Trade-off:

| Model | Kelebihan | Kekurangan |
|---|---|---|
| `String + @UUID` | Error bisa controlled, cocok untuk JSON string | Provider-specific |
| `String + @Pattern` | Portable | Regex raw, mudah salah |
| `UUID` type langsung | Strong type | Error parsing terjadi sebelum Bean Validation di beberapa framework |

Untuk API error governance, `String + @UUID` atau custom `@ValidPublicId` sering lebih mudah dikontrol.

### 3.5 `@UniqueElements`

Hibernate Validator menyediakan constraint untuk memastikan collection tidak punya elemen duplikat.

Contoh:

```java
import org.hibernate.validator.constraints.UniqueElements;

public record AssignRolesRequest(
    @UniqueElements
    List<@NotBlank String> roleCodes
) {}
```

Ini berguna untuk:

- deduplicate request,
- mencegah ambiguous operation,
- menjaga API contract bersih.

Tetapi hati-hati:

- equality mengikuti `equals()` dan `hashCode()`,
- untuk object mutable hasilnya bisa membingungkan,
- untuk DTO kompleks bisa butuh uniqueness berdasarkan property tertentu, bukan seluruh object.

Misalnya:

```java
public record LineItem(String productCode, int quantity) {}

@UniqueElements
private List<LineItem> items;
```

Ini hanya unique jika seluruh record sama. Tetapi business mungkin butuh unique berdasarkan `productCode` saja.

Lebih tepat:

```java
@UniqueByProductCode
private List<LineItem> items;
```

Atau validasi di command validator:

```java
Set<String> seen = new HashSet<>();
for (LineItem item : request.items()) {
    if (!seen.add(item.productCode())) {
        errors.add("items.duplicate_product_code");
    }
}
```

### 3.6 `@CreditCardNumber`

Constraint seperti `@CreditCardNumber` biasanya memeriksa Luhn checksum.

Itu bukan berarti kartu valid secara bisnis.

Ia tidak menjawab:

- kartu aktif atau tidak,
- kartu milik user atau tidak,
- kartu expired atau tidak,
- kartu bisa ditagih atau tidak,
- kartu fraud atau tidak.

Mental model:

> Luhn validation adalah syntactic checksum. Payment validation adalah business/integration rule.

Untuk sistem enterprise, jangan menaruh hasil `@CreditCardNumber` ke log. Nilai kartu adalah data sensitif.

### 3.7 `@Currency`

Constraint semacam `@Currency` berguna untuk validasi currency code.

Tetapi domain money biasanya butuh value object:

```java
public record Money(
    @NotNull BigDecimal amount,
    @NotBlank String currency
) {}
```

Masalahnya:

- apakah amount boleh negative?
- precision berapa?
- scale berapa?
- currency exponent berapa?
- currency aktif atau deprecated?
- apakah currency allowed untuk product/jurisdiction tertentu?

Maka constraint format saja tidak cukup.

Lebih baik:

```java
public record Money(
    @NotNull @PositiveOrZero BigDecimal amount,
    @NotBlank String currency
) {
    public Money {
        currency = currency == null ? null : currency.toUpperCase(Locale.ROOT);
    }
}
```

Lalu domain policy:

```java
policy.validateCurrencyAllowed(productType, jurisdiction, money.currency());
policy.validateScale(money.currency(), money.amount());
```

---

## 4. Provider-Specific Constraints: Decision Framework

Gunakan decision table berikut sebelum memakai constraint dari `org.hibernate.validator.*`.

| Pertanyaan | Jika ya | Jika tidak |
|---|---|---|
| Apakah constraint standar sudah cukup? | Pakai standar | Pertimbangkan HV extension |
| Apakah aplikasi pasti memakai Hibernate Validator? | Extension acceptable | Hindari provider-specific |
| Apakah constraint memengaruhi public API contract? | Dokumentasikan code dan behavior | Lebih fleksibel |
| Apakah ada migration path jika pindah provider? | Aman | Tambah wrapper/custom abstraction |
| Apakah semantic rule-nya business-specific? | Buat custom/domain validator | Built-in extension mungkin cukup |
| Apakah rule butuh audit/versioning? | Jangan sembunyikan di annotation generic | Bisa annotation biasa |

Pattern yang bagus:

```java
@Target({ FIELD, PARAMETER, RECORD_COMPONENT })
@Retention(RUNTIME)
@Documented
@Constraint(validatedBy = {})
@UUID
public @interface PublicIdentifier {
    String message() default "{case.public_id.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Dengan ini, dependency ke Hibernate Validator tetap ada, tetapi aplikasi expose semantic constraint milik domain:

```java
public record GetCaseRequest(
    @PublicIdentifier String caseId
) {}
```

Kalau suatu hari `@UUID` diganti dengan implementation custom, public annotation domain tetap stabil.

---

## 5. Fail-Fast Mode

### 5.1 Apa itu fail-fast

Secara default, validation mengumpulkan semua violation yang ditemukan.

Contoh:

```java
public record RegisterUserRequest(
    @NotBlank String username,
    @Email String email,
    @Size(min = 8) String password
) {}
```

Jika semuanya invalid, default result bisa berisi tiga violation.

Fail-fast mode membuat engine berhenti setelah menemukan violation pertama.

Hibernate Validator configuration:

```java
ValidatorFactory factory = Validation
    .byProvider(HibernateValidator.class)
    .configure()
    .failFast(true)
    .buildValidatorFactory();

Validator validator = factory.getValidator();
```

### 5.2 Kapan fail-fast cocok

Fail-fast cocok untuk:

- internal service validation,
- expensive object graph,
- batch processing yang hanya perlu tahu “valid/invalid”,
- performance-sensitive hot path,
- command validation yang akan berhenti pada error pertama,
- validation sebagai guard sebelum operasi mahal.

Contoh:

```java
public boolean isAcceptable(EventPayload payload) {
    return validator.validate(payload).isEmpty();
}
```

Jika hanya butuh boolean, fail-fast bisa masuk akal.

### 5.3 Kapan fail-fast buruk

Fail-fast buruk untuk:

- public API form submission,
- frontend validation feedback,
- batch import yang harus memberi semua error per row,
- regulatory submission yang butuh daftar semua missing fields,
- UI wizard yang perlu menampilkan banyak error sekaligus.

Buruk untuk UX:

```json
{
  "errors": [
    { "path": "name", "code": "required" }
  ]
}
```

User memperbaiki nama, submit lagi, baru muncul email invalid. Ini membuat user bolak-balik.

Lebih baik untuk API/UI:

```json
{
  "errors": [
    { "path": "name", "code": "required" },
    { "path": "email", "code": "invalid_email" },
    { "path": "password", "code": "too_short" }
  ]
}
```

### 5.4 Fail-fast bukan deterministic ordering guarantee

Penting:

> Jangan membuat logika bisnis bergantung pada “violation pertama”.

Validation engine tidak selalu menjamin urutan constraint evaluation yang cocok untuk business logic. Jika butuh urutan deterministic, gunakan group sequence atau staged validation eksplisit.

Buruk:

```java
Set<ConstraintViolation<Request>> violations = validator.validate(request);
ConstraintViolation<Request> first = violations.iterator().next();
// Business decision based on first violation: dangerous
```

Lebih baik:

```java
if (!basicValidator.validate(request).isEmpty()) {
    return ValidationStageResult.basicFailed();
}

if (!semanticValidator.validate(request).isEmpty()) {
    return ValidationStageResult.semanticFailed();
}
```

### 5.5 Fail-fast vs group sequence

Fail-fast:

- stop pada violation pertama secara global,
- provider-specific di Hibernate Validator,
- cocok untuk performance boolean check.

Group sequence:

- stop antar group,
- standardized behavior,
- masih bisa mengumpulkan semua violation dalam group yang sama,
- cocok untuk staged validation.

Contoh staged validation:

```java
interface BasicChecks {}
interface ExpensiveChecks {}

@GroupSequence({ BasicChecks.class, ExpensiveChecks.class })
interface OrderedChecks {}
```

Jika `BasicChecks` gagal, `ExpensiveChecks` tidak dijalankan.

---

## 6. Clock Provider and Temporal Validation

Temporal constraints seperti:

- `@Past`,
- `@PastOrPresent`,
- `@Future`,
- `@FutureOrPresent`,

membutuhkan konsep “sekarang”.

Jakarta Validation menyediakan `ClockProvider`. Hibernate Validator mengimplementasikan dan memungkinkan konfigurasi.

Contoh:

```java
Clock fixedClock = Clock.fixed(
    Instant.parse("2026-06-16T00:00:00Z"),
    ZoneOffset.UTC
);

ValidatorFactory factory = Validation
    .byDefaultProvider()
    .configure()
    .clockProvider(() -> fixedClock)
    .buildValidatorFactory();
```

### 6.1 Kenapa clock penting

Tanpa clock provider yang controlled, test temporal mudah flaky.

Buruk:

```java
public record ScheduleRequest(
    @Future Instant executionTime
) {}

@Test
void testFuture() {
    var request = new ScheduleRequest(Instant.now().plusMillis(1));
    assertThat(validator.validate(request)).isEmpty(); // flaky
}
```

Lebih baik:

```java
Clock fixed = Clock.fixed(Instant.parse("2026-06-16T10:00:00Z"), ZoneOffset.UTC);
Validator validator = validatorWithClock(fixed);

var request = new ScheduleRequest(Instant.parse("2026-06-16T10:01:00Z"));
assertThat(validator.validate(request)).isEmpty();
```

### 6.2 Business clock vs system clock

Untuk sistem regulasi/case management, “sekarang” bisa bukan sekadar `Instant.now()`.

Contoh:

- tanggal submit mengikuti agency timezone,
- deadline dihitung berdasarkan business day,
- SLA pause/resume,
- grace period,
- backdated approval,
- legal effective date,
- imported legacy timestamp.

`ClockProvider` cocok untuk basic temporal validation.

Tetapi untuk business calendar, jangan masukkan semuanya ke `@Future`/`@Past`.

Buruk:

```java
@Future
private LocalDate appealDeadline;
```

Padahal deadline tergantung:

- working day,
- public holiday,
- extension approval,
- jurisdiction,
- submitted channel.

Lebih baik:

```java
appealPolicy.validateDeadline(caseContext, appealDate);
```

Bean Validation:

```java
@NotNull
private LocalDate appealDate;
```

Domain policy:

```java
if (!appealCalendar.isWithinAppealWindow(caseContext, appealDate)) {
    errors.add("appeal.date.outside_allowed_window");
}
```

### 6.3 Time zone caveat

`LocalDate` tidak punya timezone. `Instant` selalu point-in-time UTC. `OffsetDateTime` membawa offset. `ZonedDateTime` membawa zone rules.

Untuk validation:

```java
@Future
private LocalDate appointmentDate;
```

Pertanyaan: future menurut timezone siapa?

- server timezone?
- user timezone?
- agency timezone?
- tenant timezone?
- case jurisdiction timezone?

Jika tidak jelas, hasil validation bisa berbeda antar environment.

Pattern:

- pakai `ClockProvider` untuk test determinism,
- tetapkan timezone domain secara eksplisit,
- hindari implicit JVM default timezone untuk rule penting,
- untuk regulatory rule, gunakan domain calendar/policy object.

---

## 7. Constraint Validator Payload

Hibernate Validator menyediakan konsep provider-specific yang memungkinkan payload/context tertentu diberikan ke `ConstraintValidator` saat runtime.

Ini berbeda dari `payload` standar pada annotation.

### 7.1 Payload standar Jakarta Validation

Pada annotation:

```java
public @interface ValidCaseReference {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

`payload` standar adalah metadata di constraint declaration.

Contoh:

```java
public interface Severity {
    final class Error implements Payload {}
    final class Warning implements Payload {}
}
```

Dipakai seperti:

```java
@NotBlank(payload = Severity.Error.class)
private String caseReference;
```

Ini statis.

### 7.2 Constraint validator payload provider-specific

Hibernate Validator memungkinkan membawa contextual payload ke validator.

Use case:

- tenant id,
- channel,
- jurisdiction,
- request context,
- external policy snapshot,
- feature flag state.

Namun ini harus dipakai sangat hati-hati.

Kenapa?

Karena validator yang tadinya pure bisa berubah menjadi context-dependent.

Buruk jika tidak dikontrol:

```java
public boolean isValid(String value, ConstraintValidatorContext context) {
    var tenantId = getTenantFromPayload(context);
    return tenantRules.forTenant(tenantId).isAllowed(value);
}
```

Masalah:

- hasil validation berubah tergantung hidden context,
- test lebih sulit,
- audit lebih sulit,
- caching/parallel validation harus hati-hati,
- sulit dipahami dari annotation saja.

### 7.3 Kapan constraint validator payload layak dipakai

Layak dipakai jika:

- context benar-benar validation concern,
- context immutable untuk satu validation call,
- rule tetap deterministic,
- payload type jelas,
- error response mencantumkan rule context bila perlu,
- ada test untuk payload berbeda,
- tidak memanggil resource eksternal secara liar.

Contoh yang lebih terkendali:

```java
public record ValidationExecutionContext(
    String tenantCode,
    String channel,
    String ruleSetVersion
) {}
```

Validator hanya membaca snapshot:

```java
// Conceptual example, exact API depends on HV version/configuration style.
ValidationExecutionContext executionContext = context.unwrap(HibernateConstraintValidatorContext.class)
    .getConstraintValidatorPayload(ValidationExecutionContext.class);
```

Gunakan untuk rule yang masih local dan deterministic.

Jangan gunakan untuk menggantikan domain service yang kompleks.

---

## 8. HibernateConstraintValidatorContext

Hibernate Validator menyediakan context extension yang bisa diakses melalui `unwrap()`.

Contoh umum:

```java
HibernateConstraintValidatorContext hibernateContext = context
    .unwrap(HibernateConstraintValidatorContext.class);
```

Dengan context provider-specific, kita bisa melakukan hal-hal seperti:

- menambahkan expression variable,
- menambahkan message parameter,
- mengakses payload provider-specific,
- membuat message lebih kaya.

### 8.1 Message parameter

Misalnya constraint butuh menampilkan daftar allowed value.

```java
@Override
public boolean isValid(String value, ConstraintValidatorContext context) {
    if (value == null || allowed.contains(value)) {
        return true;
    }

    context.unwrap(HibernateConstraintValidatorContext.class)
        .addMessageParameter("allowedValues", String.join(", ", allowed));

    return false;
}
```

Message:

```properties
status.invalid=Status is invalid. Allowed values: {allowedValues}
```

### 8.2 Jangan bocorkan data sensitif

Hati-hati dengan parameter seperti:

```java
.addMessageParameter("submittedValue", value)
```

Untuk data sensitif, jangan expose:

- identifier pribadi,
- email,
- nomor kartu,
- token,
- NRIC/NIK/passport,
- full address,
- free text yang mungkin berisi PII.

Lebih baik:

```java
.addMessageParameter("submittedLength", value.length())
```

Atau:

```java
.addMessageParameter("valueCategory", classify(value))
```

---

## 9. Dynamic Default Group Sequence

Kita sudah membahas group sequence pada part 008. Hibernate Validator menambahkan dynamic default group sequence melalui provider-specific extension.

Use case:

```java
public class ApplicationSubmission {
    private ApplicationType type;
    private String individualId;
    private String companyUen;
}
```

Jika `type = INDIVIDUAL`, validasi group individual.

Jika `type = COMPANY`, validasi group company.

Dengan Hibernate Validator, default group sequence bisa dibuat dynamic berdasarkan state object.

### 9.1 Kapan berguna

Berguna untuk:

- object yang punya mode internal jelas,
- constraint set berbeda berdasarkan discriminator,
- legacy model sulit dipecah menjadi subtype,
- UI model tunggal tetapi operation-specific behavior berbeda.

### 9.2 Risiko

Risiko sangat besar jika dipakai berlebihan:

- rule tersembunyi,
- sulit dipahami dari annotation,
- validation result tergantung object state,
- bisa menjadi workflow engine terselubung,
- sulit didokumentasikan untuk API consumer,
- testing matrix meningkat.

Buruk:

```java
// Dynamic group sequence decides rules for Draft, Submitted, Approved, Rejected,
// Reopened, Escalated, Closed, Archived, etc.
```

Itu bukan tugas Bean Validation. Itu workflow/state machine rule.

Lebih baik:

```java
transitionPolicy.validateSubmit(caseAggregate, actor, now);
```

Dynamic group sequence sebaiknya untuk **mode lokal object**, bukan lifecycle penuh.

---

## 10. Programmatic Constraint Mapping Extension

Hibernate Validator menyediakan fluent API untuk mendeklarasikan constraint secara programmatic.

Contoh conceptual:

```java
HibernateValidatorConfiguration configuration = Validation
    .byProvider(HibernateValidator.class)
    .configure();

ConstraintMapping mapping = configuration.createConstraintMapping();

mapping.type(CustomerDto.class)
    .property("name", FIELD)
        .constraint(new NotBlankDef())
    .property("email", FIELD)
        .constraint(new EmailDef());

ValidatorFactory factory = configuration
    .addMapping(mapping)
    .buildValidatorFactory();
```

Ini provider-specific.

### 10.1 Kapan cocok

Cocok untuk:

- generated classes yang tidak bisa dianotasi,
- third-party classes,
- migration sementara,
- tenant-specific schema yang dibekukan saat startup,
- rule catalog yang harus di-load dari config terkontrol,
- white-label product dengan per-client constraints.

### 10.2 Kapan tidak cocok

Tidak cocok untuk:

- rule berubah per request,
- rule tidak versioned,
- tim tidak punya governance,
- error code tidak stabil,
- API documentation harus generated tetapi metadata tidak konsisten,
- developer tidak bisa melihat constraint dari code.

Jika programmatic mapping dipakai, wajib punya:

- rule id,
- rule version,
- owner module,
- source config,
- test generator,
- compatibility diff,
- audit trail.

---

## 11. Value Extractor Extension and Custom Containers

Jakarta Validation sudah mendefinisikan value extraction untuk container element constraints. Hibernate Validator menyediakan implementasi dan extension behavior yang luas.

Custom container:

```java
public final class PatchField<T> {
    private final boolean present;
    private final T value;

    private PatchField(boolean present, T value) {
        this.present = present;
        this.value = value;
    }

    public static <T> PatchField<T> absent() {
        return new PatchField<>(false, null);
    }

    public static <T> PatchField<T> of(T value) {
        return new PatchField<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    public T value() {
        return value;
    }
}
```

Value extractor:

```java
public class PatchFieldValueExtractor
        implements ValueExtractor<PatchField<@ExtractedValue ?>> {

    @Override
    public void extractValues(PatchField<?> originalValue, ValueReceiver receiver) {
        if (originalValue != null && originalValue.isPresent()) {
            receiver.value("value", originalValue.value());
        }
    }
}
```

Usage:

```java
public record PatchUserRequest(
    PatchField<@NotBlank String> displayName
) {}
```

Meaning:

- absent field: do not validate value,
- present field with null/blank: validate,
- present field with valid value: pass.

Ini sangat berguna untuk PATCH semantics.

### 11.1 Pitfall custom value extractor

Hati-hati:

- extractor ambiguity,
- nested container path readability,
- null container vs null value,
- registration order,
- provider-specific behavior details,
- framework integration.

Jika value extractor salah, validation bisa diam-diam tidak jalan atau path error menjadi sulit dipakai frontend.

---

## 12. Hibernate Validator Built-in Constraints vs Domain-Specific Constraints

Banyak engineer tergoda memakai built-in extension sebanyak mungkin.

Tetapi top-tier engineer berpikir dengan pertanyaan:

> Apakah constraint ini benar-benar menyatakan bahasa domain saya?

Contoh:

```java
@Pattern(regexp = "^[A-Z]{3}-\\d{6}$")
private String caseReference;
```

Lebih baik:

```java
@CaseReferenceNumber
private String caseReference;
```

Walaupun implementation-nya bisa memakai:

```java
@Pattern(regexp = "^[A-Z]{3}-\\d{6}$")
```

Kenapa domain-specific annotation lebih baik?

- error code lebih meaningful,
- message lebih stabil,
- rule bisa versioned,
- regex bisa diganti tanpa ubah semua DTO,
- dokumentasi API lebih jelas,
- audit lebih mudah.

Hibernate-specific constraints sebaiknya menjadi implementation detail, bukan selalu public language.

---

## 13. Script-Based Constraints: Powerful but Dangerous

Hibernate Validator historically supported script-based constraints in some forms/version lines. Fitur seperti ini terlihat menarik karena rule bisa ditulis sebagai expression/script.

Namun untuk production-grade enterprise system, script-based validation perlu sangat hati-hati.

Risiko:

- security injection,
- sandbox complexity,
- performance unpredictability,
- debugging sulit,
- refactoring tidak aman,
- IDE support minim,
- type safety hilang,
- audit/versioning lebih kompleks,
- dependency ke scripting engine.

Buruk:

```java
@ScriptAssert(lang = "javascript", script = "_this.start <= _this.end")
public class DateRangeDto { ... }
```

Lebih baik:

```java
@ValidDateRange
public class DateRangeDto { ... }
```

Atau:

```java
DateRange.of(start, end);
```

Untuk regulated systems, rule harus explainable, testable, versioned, dan reviewable. Script string di annotation biasanya lemah di semua aspek itu.

---

## 14. Provider-Specific Bootstrap

Standar:

```java
ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
```

Provider-specific:

```java
ValidatorFactory factory = Validation
    .byProvider(HibernateValidator.class)
    .configure()
    .failFast(false)
    .buildValidatorFactory();
```

Provider-specific configuration object:

```java
HibernateValidatorConfiguration configuration = Validation
    .byProvider(HibernateValidator.class)
    .configure();
```

Gunakan provider-specific bootstrap ketika:

- butuh fail-fast,
- butuh programmatic mapping HV,
- butuh provider-specific message/context behavior,
- butuh custom configuration yang tidak ada di standar,
- ingin memastikan provider yang dipakai adalah Hibernate Validator.

Jangan gunakan provider-specific bootstrap hanya karena copy-paste.

Untuk framework seperti Spring Boot/Quarkus/Jakarta EE, biasanya framework yang mengelola factory. Maka custom configuration sebaiknya lewat extension point framework, bukan membuat factory manual di mana-mana.

Buruk:

```java
@Service
public class UserService {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
}
```

Masalah:

- factory tidak di-close,
- config framework tidak terpakai,
- message interpolator beda,
- DI validator factory tidak terpakai,
- test inconsistent,
- native-image/AOT behavior bisa rusak.

Lebih baik:

```java
@Service
public class UserService {
    private final Validator validator;

    public UserService(Validator validator) {
        this.validator = validator;
    }
}
```

---

## 15. Hibernate Validator in Frameworks

### 15.1 Spring Boot

Spring Boot biasanya auto-configure Bean/Jakarta Validation jika dependency tersedia.

Dalam Spring Boot 3+, namespace adalah `jakarta.validation`.

Spring-specific behavior:

- `@Valid` untuk standard validation,
- `@Validated` untuk group/method validation,
- `LocalValidatorFactoryBean`,
- integration dengan message source,
- exception mapping melalui MVC/WebFlux mechanisms.

Provider-specific Hibernate Validator tetap bisa aktif di bawahnya.

Perhatikan:

- jangan campur `javax.validation` di Boot 3,
- method validation bergantung proxy,
- self-invocation tetap tidak tervalidasi,
- configuration harus konsisten dengan Spring-managed `Validator`.

### 15.2 Quarkus

Quarkus menggunakan Hibernate Validator secara natural. Pada environment native image/AOT, reflection/configuration menjadi penting.

Prinsip:

- hindari dynamic classpath scanning liar,
- gunakan framework-managed validation,
- custom validators harus compatible dengan injection/native mode,
- jangan membuat factory manual tanpa perlu.

### 15.3 Jakarta EE

Dalam Jakarta EE, validation terintegrasi dengan:

- CDI,
- JAX-RS/Jakarta REST,
- JPA,
- method validation.

Jika application server menyediakan provider, versi provider bisa berbeda dari yang kita kira.

Risiko:

- application bundled HV conflict dengan server-provided HV,
- Jakarta Validation API version mismatch,
- EL implementation mismatch,
- package namespace mismatch.

Untuk enterprise deployment, dependency governance wajib jelas.

---

## 16. Jakarta Expression Language Dependency

Message interpolation dalam Bean/Jakarta Validation sering bergantung pada Expression Language implementation.

Pada stack modern, Hibernate Validator 9.x berbasis Jakarta Validation 3.1 dan Jakarta Expression Language 6.0. Artinya aplikasi perlu menyediakan implementation EL yang kompatibel jika berjalan di Java SE/plain application.

Dalam container Jakarta EE, EL mungkin disediakan container.

Dalam plain Java/Spring Boot, dependency biasanya disediakan oleh framework starter atau perlu ditambahkan.

Masalah umum:

```text
jakarta.el.ELManager not found
```

Atau message interpolation gagal karena EL implementation tidak tersedia.

Pattern:

- cek dependency tree,
- gunakan starter/framework managed dependency,
- jangan campur EL versi lama dengan Jakarta Validation baru,
- untuk Java SE bootstrap manual, tambahkan EL implementation yang sesuai.

---

## 17. Advanced Property Path Construction

Dalam custom validator, kita bisa membuat violation path.

Standar:

```java
context.disableDefaultConstraintViolation();
context.buildConstraintViolationWithTemplate("{date.range.invalid}")
    .addPropertyNode("endDate")
    .addConstraintViolation();
```

Untuk nested/container path, API path construction bisa kompleks. Hibernate Validator sering menyediakan behavior yang lebih kaya dan jelas dalam rendering path.

Rule:

> Path violation adalah contract dengan frontend. Jangan asal tempel error ke object root jika user perlu tahu field mana yang harus diperbaiki.

Buruk:

```json
{
  "path": "",
  "message": "Invalid request"
}
```

Lebih baik:

```json
{
  "path": "endDate",
  "code": "date_range.end_before_start"
}
```

Untuk list:

```json
{
  "path": "items[3].quantity",
  "code": "quantity.must_be_positive"
}
```

Untuk map:

```json
{
  "path": "addresses[HOME].postalCode",
  "code": "postal_code.invalid"
}
```

Jangan lupa test path output, terutama jika API contract sudah dipakai FE.

---

## 18. Hibernate Validator-Specific Message Features

Hibernate Validator message interpolation mendukung message parameters dan expression variables melalui context extension.

Contoh:

```java
context.unwrap(HibernateConstraintValidatorContext.class)
    .addMessageParameter("minAge", minAge)
    .addExpressionVariable("actualAge", actualAge);
```

Message:

```properties
age.too_young=Applicant must be at least {minAge} years old.
```

Namun gunakan expression variable secara hati-hati.

Rule production:

- message template tidak boleh menjadi business logic,
- jangan expose sensitive values,
- jangan membuat message tergantung data yang tidak stabil,
- jangan jadikan interpolated message sebagai machine-readable contract,
- error code tetap utama.

---

## 19. Extended Constraint Composition

Jakarta Validation mendukung constraint composition standar. Hibernate Validator menambahkan `@ConstraintComposition` dengan mode seperti OR/ALL_FALSE pada versi yang mendukung.

Contoh conceptual:

```java
@ConstraintComposition(CompositionType.OR)
@Pattern(regexp = "^[A-Z]{3}-\\d{6}$")
@Pattern(regexp = "^[A-Z]{4}-\\d{8}$")
@ReportAsSingleViolation
@Constraint(validatedBy = {})
@Target({ FIELD, PARAMETER, RECORD_COMPONENT })
@Retention(RUNTIME)
public @interface CaseReferenceFormat {
    String message() default "{case.reference.invalid}";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Use case:

- migration format lama + baru,
- accept multiple legal identifiers,
- compatibility period.

Risiko:

- OR logic tersembunyi,
- error message kurang spesifik,
- API documentation harus menjelaskan semua accepted format,
- jika terlalu banyak alternative, lebih baik custom validator.

---

## 20. Security Manager Removal and Modern Java

Pada Hibernate Validator 9.x, integration dengan Java Security Manager dihapus karena Security Manager sendiri sudah deprecated/removed trajectory di modern Java.

Konsekuensi praktis:

- jangan bergantung pada Security Manager untuk sandbox validator,
- validator harus diperlakukan sebagai trusted application code,
- script/expression/dynamic rule execution harus punya security model sendiri,
- AOT/native/security hardening harus dilakukan di layer deployment/runtime.

Untuk Java 17/21/25, pendekatan security modern bukan “biarkan arbitrary validator code lalu berharap Security Manager membatasi”. Pendekatan yang lebih baik:

- restrict dynamic code execution,
- avoid script-based validation,
- use allowlisted rules,
- test dependency supply chain,
- review custom validators seperti production code biasa.

---

## 21. Provider Lock-In: Kapan Masalah, Kapan Tidak

Provider lock-in bukan selalu buruk.

Sistem enterprise sering memang memilih provider tertentu:

- Hibernate Validator untuk validation,
- Hibernate ORM untuk JPA,
- Spring Framework untuk DI/MVC,
- Jackson untuk JSON.

Yang berbahaya bukan lock-in itu sendiri. Yang berbahaya adalah **lock-in yang tidak disadari**.

### 21.1 Lock-in acceptable

Acceptable jika:

- provider dipilih secara eksplisit,
- fitur extension memberi value nyata,
- aplikasi tidak punya requirement provider portability,
- dependency version governed,
- extension usage terdokumentasi,
- test melindungi behavior,
- migration strategy ada.

Contoh:

```java
@UniqueElements
private List<String> selectedModuleCodes;
```

Jika seluruh stack sudah Hibernate Validator dan value-nya jelas, ini acceptable.

### 21.2 Lock-in berbahaya

Berbahaya jika:

- shared library dipakai banyak platform,
- public API contract bergantung pada provider behavior yang tidak terdokumentasi,
- annotation provider-specific tersebar tanpa governance,
- ada rencana migration provider/stack,
- behavior berbeda antar versi HV.

Contoh buruk:

```java
// Shared DTO artifact used by Spring Boot 2, Spring Boot 3, Quarkus, and legacy app server.
import org.hibernate.validator.constraints.Length;

public class SharedCustomerDto {
    @Length(max = 80)
    private String name;
}
```

Better:

```java
public class SharedCustomerDto {
    @Size(max = 80)
    private String name;
}
```

Atau domain annotation dengan module-specific adapter.

---

## 22. Designing a Provider-Specific Boundary

Untuk sistem besar, buat boundary eksplisit.

### 22.1 Option 1 — Allow direct usage everywhere

```java
@Length(max = 100)
@URL
@Range(min = 1, max = 10)
```

Kelebihan:

- cepat,
- simple,
- developer familiar.

Kekurangan:

- provider-specific dependency tersebar,
- sulit audit,
- sulit migration,
- rule language tidak domain-oriented.

Cocok untuk:

- aplikasi internal kecil,
- prototype,
- service yang seluruh stack-nya stabil dan tidak shared.

### 22.2 Option 2 — Wrap provider-specific constraints in domain annotations

```java
@PublicIdentifier
@SecureCallbackUrl
@CaseReferenceNumber
@AllowedCurrencyCode
```

Kelebihan:

- bahasa domain jelas,
- provider detail tersembunyi,
- error code lebih stabil,
- migration lebih mudah.

Kekurangan:

- butuh effort desain,
- custom annotation bertambah,
- harus maintain documentation.

Cocok untuk:

- enterprise APIs,
- regulated systems,
- shared platform,
- multi-module codebase.

### 22.3 Option 3 — Keep Bean Validation portable; domain rules outside

```java
@NotBlank
@Size(max = 80)
private String name;
```

Lalu:

```java
casePolicy.validate(command);
```

Kelebihan:

- portable,
- domain rules explicit,
- good auditability.

Kekurangan:

- more code,
- tidak semua rule terlihat di DTO,
- perlu error aggregation model.

Cocok untuk:

- workflow-heavy systems,
- state machines,
- regulatory case management,
- complex business rules.

---

## 23. Example: Provider Extension in a Case Management Platform

Misalkan ada request:

```java
public record SubmitCaseRequest(
    String caseReference,
    String callbackUrl,
    List<String> selectedGrounds,
    String applicantEmail,
    LocalDate declarationDate
) {}
```

Naive validation:

```java
public record SubmitCaseRequest(
    @Pattern(regexp = "^[A-Z]{3}-\\d{6}$")
    String caseReference,

    @URL
    String callbackUrl,

    @UniqueElements
    List<@NotBlank String> selectedGrounds,

    @Email
    String applicantEmail,

    @PastOrPresent
    LocalDate declarationDate
) {}
```

Better production-grade version:

```java
public record SubmitCaseRequest(
    @NotBlank
    @CaseReferenceNumber
    String caseReference,

    @SecureCallbackUrl
    String callbackUrl,

    @NotEmpty
    @UniqueElements
    List<@NotBlank String> selectedGrounds,

    @NotBlank
    @Email
    String applicantEmail,

    @NotNull
    @PastOrPresent
    LocalDate declarationDate
) {}
```

Then additional service-level rules:

```java
submissionPolicy.validateSubmit(
    caseAggregate,
    command,
    actor,
    businessClock,
    ruleSetVersion
);
```

Reasoning:

- Bean Validation handles shape and local invariant.
- Hibernate-specific `@UniqueElements` is acceptable because it is local and simple.
- `@SecureCallbackUrl` should not rely only on `@URL`; it must enforce security/domain policy or at least delegate to safe URL policy.
- `declarationDate` uses `@PastOrPresent` for simple sanity, but regulatory deadline belongs to policy layer.
- workflow state belongs outside annotation.

---

## 24. Version-Specific Notes: HV 6, 7, 8, 9

### 24.1 Hibernate Validator 6.x

Common in:

- Java 8/11 legacy,
- Spring Boot 2,
- `javax.validation`,
- Bean Validation 2.0.

Important:

- package is `javax.validation`,
- supports container element constraints from Bean Validation 2.0,
- many provider-specific constraints available,
- legacy apps often depend on HV-specific annotations unintentionally.

### 24.2 Hibernate Validator 7.x

Common transition line for Jakarta namespace.

Important:

- package moves to `jakarta.validation`,
- migration from `javax` can be painful,
- mixed namespace is common failure mode.

### 24.3 Hibernate Validator 8.x

Targets Jakarta EE 10 stack.

Important:

- still `jakarta.validation`,
- modern Java baseline,
- includes additional provider constraints such as `@UUID` in release line.

### 24.4 Hibernate Validator 9.x

Targets Jakarta EE 11 and implements Jakarta Validation 3.1.

Important:

- Java 17+,
- Jakarta Validation 3.1,
- Jakarta EE 11 alignment,
- records support clarified at specification level,
- additional constraints in release line,
- Security Manager integration removed,
- Jakarta EL 6.0 compatibility requirement.

For Java 21/25 projects, HV 9.x is the modern target if the rest of stack supports Jakarta EE 11 level dependencies.

---

## 25. Migration Risks with Hibernate Extensions

When migrating `javax` to `jakarta`, standard annotations are easy to refactor mechanically.

Example:

```java
javax.validation.constraints.NotNull
```

becomes:

```java
jakarta.validation.constraints.NotNull
```

But provider-specific annotations need separate attention:

```java
org.hibernate.validator.constraints.Length
org.hibernate.validator.constraints.Range
org.hibernate.validator.constraints.URL
```

Potential migration risks:

- constraint removed/deprecated,
- annotation package remains but behavior changed,
- dependency artifact version mismatch,
- EL version mismatch,
- message key changed,
- validator behavior tightened,
- internal SPI changes,
- framework auto-config changed.

Migration checklist:

1. Generate inventory of all `org.hibernate.validator.*` imports.
2. Classify each usage:
   - replace with standard constraint,
   - keep HV-specific,
   - wrap in domain annotation,
   - move to domain policy.
3. Test validation result count and path.
4. Test message code/message interpolation.
5. Test API error response contract.
6. Test method validation if proxies changed.
7. Test native/AOT if relevant.
8. Check dependency tree for mixed `javax`/`jakarta`.
9. Check EL implementation compatibility.
10. Document accepted provider-specific usage.

---

## 26. Production Observability for Hibernate Validator Extensions

If using provider-specific features, observe them.

Metrics worth collecting:

- validation latency,
- validation failure count,
- failure count by constraint type,
- failure count by domain error code,
- fail-fast enabled/disabled per validator factory,
- expensive custom validator count,
- top rejected endpoints,
- top rejected fields,
- message interpolation errors,
- validation exceptions caused by misconfiguration.

Example structured log:

```json
{
  "event": "validation_failed",
  "endpoint": "POST /cases/{id}/submit",
  "constraint": "CaseReferenceNumber",
  "providerConstraint": "Pattern",
  "path": "caseReference",
  "code": "case.reference.invalid",
  "ruleVersion": "2026.06",
  "correlationId": "..."
}
```

Do not log raw rejected value unless it is guaranteed non-sensitive.

---

## 27. Testing Provider-Specific Behavior

### 27.1 Test provider-specific constraint directly

```java
class SubmitCaseRequestValidationTest {
    private static Validator validator;

    @BeforeAll
    static void setup() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    @Test
    void selectedGroundsMustBeUnique() {
        var request = new SubmitCaseRequest(
            "ABC-123456",
            "https://example.com/callback",
            List.of("LATE_FILING", "LATE_FILING"),
            "user@example.com",
            LocalDate.now()
        );

        Set<ConstraintViolation<SubmitCaseRequest>> violations = validator.validate(request);

        assertThat(violations)
            .anyMatch(v -> v.getPropertyPath().toString().equals("selectedGrounds"));
    }
}
```

### 27.2 Test fail-fast separately

```java
Validator failFastValidator = Validation
    .byProvider(HibernateValidator.class)
    .configure()
    .failFast(true)
    .buildValidatorFactory()
    .getValidator();
```

Do not use fail-fast validator accidentally for API tests expecting all errors.

### 27.3 Test clock provider

```java
Validator validator = Validation
    .byDefaultProvider()
    .configure()
    .clockProvider(() -> Clock.fixed(
        Instant.parse("2026-06-16T00:00:00Z"),
        ZoneOffset.UTC
    ))
    .buildValidatorFactory()
    .getValidator();
```

### 27.4 Test path and error code

Do not only assert violation size.

Weak:

```java
assertThat(violations).hasSize(1);
```

Better:

```java
assertThat(toErrors(violations))
    .containsExactly(
        new ApiValidationError("selectedGrounds", "selected_grounds.duplicate")
    );
```

### 27.5 Contract tests for migration

Before upgrading HV 6 → 8/9 or Boot 2 → 3:

- snapshot validation errors for representative DTOs,
- compare path/message/code,
- detect behavior drift,
- decide if drift is acceptable.

---

## 28. Anti-Patterns

### 28.1 Treating Hibernate Validator extensions as standard

```java
@Length(max = 80)
```

Then later team assumes all providers support it.

Fix:

- use standard `@Size`, or
- document HV-specific usage, or
- wrap domain annotation.

### 28.2 Using `@URL` as security control

`@URL` is not SSRF protection.

Fix:

- allowlist host,
- block private ranges,
- control redirects,
- apply outbound network policy,
- use short timeout,
- sanitize logs.

### 28.3 Fail-fast for public form API

User receives one error at a time.

Fix:

- collect all errors for UI/API,
- reserve fail-fast for internal/hot path.

### 28.4 Dynamic group sequence as workflow engine

If validation group depends on full case state lifecycle, it is probably wrong.

Fix:

- use state machine guard,
- domain policy,
- rule engine with explicit versioning if needed.

### 28.5 DB calls inside provider-specific validator

```java
public boolean isValid(String value, ConstraintValidatorContext context) {
    return repository.existsByCode(value);
}
```

Problems:

- latency,
- transaction boundary,
- race condition,
- stale read,
- validator side effect risk,
- harder testing.

Fix:

- use domain/application service validation,
- enforce DB unique constraint,
- translate DB exception,
- use reservation/locking if needed.

### 28.6 Creating `ValidatorFactory` manually per request

```java
Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
```

inside request method.

Fix:

- create once,
- inject framework-managed `Validator`,
- close factory if manually created at application lifecycle.

---

## 29. Review Checklist for Pull Requests

When reviewing validation code that uses Hibernate Validator extensions, ask:

1. Is this feature standard Jakarta Validation or Hibernate-specific?
2. If Hibernate-specific, is lock-in intentional?
3. Can a standard constraint express the same rule?
4. Is this rule syntactic, semantic, business, workflow, authorization, or persistence consistency?
5. Is the annotation hiding business policy?
6. Is error code stable?
7. Is message safe from PII leakage?
8. Is rejected value logged anywhere?
9. Is `ValidatorFactory` lifecycle correct?
10. Is fail-fast appropriate for this use case?
11. Are temporal tests deterministic with `ClockProvider`?
12. Are custom validators pure/thread-safe?
13. Are DB/network calls avoided in validators?
14. Is provider-specific behavior covered by tests?
15. Is migration impact documented?
16. Does the API documentation reflect accepted formats?
17. Does frontend rely on path/message ordering?
18. Are groups/dynamic groups becoming workflow logic?
19. Is dependency version aligned with Java/Jakarta stack?
20. Are `javax` and `jakarta` namespaces not mixed?

---

## 30. Practical Architecture Recommendations

### 30.1 Default rule

Use standard Jakarta Validation constraints first:

```java
@NotBlank
@Size(max = 80)
@Email
@Pattern(...)
@PastOrPresent
```

### 30.2 Use Hibernate Validator extensions selectively

Good candidates:

- `@UniqueElements` for simple collection uniqueness,
- `@UUID` for public identifier string where standard type binding is not desired,
- fail-fast for internal hot path,
- clock provider for deterministic tests,
- programmatic mapping for generated/third-party models,
- message parameter extension for controlled, safe interpolation,
- value extractor support for custom containers.

### 30.3 Wrap domain concepts

Prefer:

```java
@CaseReferenceNumber
@SecureCallbackUrl
@AllowedCurrencyCode
@PublicIdentifier
```

Over scattering:

```java
@Pattern(...)
@URL(...)
@UUID(...)
```

### 30.4 Keep workflow outside Bean Validation

For case management:

```java
workflowGuard.canSubmit(caseAggregate, actor, now)
```

not:

```java
validator.validate(caseDto, SubmittedCase.class)
```

unless it is purely shape validation for submit input.

### 30.5 Build explicit error model

Do not expose raw provider messages as the only contract.

Better:

```json
{
  "code": "validation_failed",
  "errors": [
    {
      "path": "callbackUrl",
      "code": "callback_url.host_not_allowed",
      "message": "Callback URL is not allowed."
    }
  ]
}
```

---

## 31. Mental Model Summary

Hibernate Validator extensions are like using vendor-specific SQL features.

Sometimes vendor-specific SQL is exactly the right choice:

- better performance,
- richer features,
- less code,
- more practical implementation.

But a top-tier engineer does not accidentally depend on vendor behavior. They make the trade-off explicit.

The same applies to Hibernate Validator.

Use standard Jakarta Validation for portable object/method validation.

Use Hibernate Validator extensions when they provide clear practical value.

Wrap provider-specific constraints when they represent domain language.

Keep business workflow, authorization, persistence consistency, and external dependency checks out of annotation validators unless there is a very strong reason.

Make error results machine-readable, safe, observable, and testable.

---

## 32. Key Takeaways

1. Hibernate Validator is the reference implementation of Jakarta Validation, but also provides non-standard extensions.
2. Standard constraints are portable; `org.hibernate.validator.*` constraints are provider-specific.
3. Provider-specific features are not bad, but must be intentional.
4. `@Length` can often be replaced by standard `@Size`.
5. `@Range` can often be replaced by `@Min` + `@Max`.
6. `@URL` is not SSRF protection.
7. `@UUID` is useful, but may be replaceable by `UUID` type or domain annotation.
8. `@UniqueElements` is useful for simple equality-based uniqueness only.
9. Fail-fast is useful for internal/hot path validation, but often bad for public API UX.
10. Clock provider is essential for deterministic temporal validation tests.
11. Constraint validator payload/context can be powerful but can hide dependencies.
12. Dynamic group sequence should not become workflow/state machine logic.
13. Programmatic mapping is powerful but requires governance.
14. Script-based validation is usually not suitable for regulated production systems.
15. Provider lock-in is acceptable only when explicit, documented, and tested.
16. For enterprise systems, prefer domain-specific annotations over scattering low-level technical constraints.
17. Validation results should be machine-readable, safe, observable, and stable.

---

## 33. References

- Jakarta Validation 3.1 specification page: https://jakarta.ee/specifications/bean-validation/3.1/
- Jakarta Validation 3.1 specification document: https://jakarta.ee/specifications/bean-validation/3.1/jakarta-validation-spec-3.1.html
- Bean Validation / Jakarta Validation official site: https://beanvalidation.org/3.1/
- Hibernate Validator stable reference guide: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
- Hibernate Validator releases: https://hibernate.org/validator/releases/
- Hibernate Validator 9.0 release series: https://hibernate.org/validator/releases/9.0/
- Hibernate Validator migration guide: https://hibernate.org/validator/documentation/migration-guide/
- Hibernate Validator 9.0.0.Final release announcement: https://in.relation.to/2025/05/20/hibernate-validator-9-0-0-Final/

---

## 34. Status Seri

Seri belum selesai.

Part berikutnya:

`learn-java-validation-jakarta-hibernate-validator-part-018.md`

Topik:

**Dependency Injection in Validators: CDI, Spring, Jakarta EE, and Testability**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-validation-jakarta-hibernate-validator-part-016.md">⬅️ Constraint Composition: Reusable Higher-Level Constraints</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-validation-jakarta-hibernate-validator-part-018.md">Dependency Injection in Validators: CDI, Spring, Jakarta EE, and Testability ➡️</a>
</div>

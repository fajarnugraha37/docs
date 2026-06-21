# Part 16 — Validation, Binding, Conversion, and Data Boundary

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `16-validation-binding-conversion-data-boundary.md`  
> Status seri: Part 16 dari 35 — **belum selesai**  
> Berikutnya: `17-error-handling-problem-details-failure-semantics.md`

---

## 0. Tujuan Part Ini

Bagian ini membahas **jalur data masuk** dalam aplikasi Spring: bagaimana nilai mentah dari HTTP request, form, query string, path variable, header, JSON body, configuration property, method argument, dan event payload berubah menjadi object Java yang dipakai application layer.

Fokusnya bukan hanya:

```java
@Valid
@RequestBody CreateUserRequest request
```

Tetapi:

- siapa yang mengubah string menjadi type Java;
- siapa yang memilih converter;
- kapan binding terjadi;
- kapan validation terjadi;
- bagaimana error dikumpulkan;
- apa beda binding error dan validation error;
- kapan `@Valid` tidak cukup;
- bagaimana mencegah mass assignment;
- bagaimana memisahkan API DTO, command object, config object, dan domain object;
- bagaimana membuat data boundary yang aman, eksplisit, dan audit-friendly.

Dalam Spring, validation dan binding adalah bagian dari **boundary engineering**. Semua data yang datang dari luar sistem harus dianggap belum dipercaya sampai melewati boundary ini.

---

## 1. Mental Model Besar

Spring punya beberapa lapisan untuk memproses data masuk.

```text
raw input
  ↓
source-specific extraction
  ↓
conversion / formatting
  ↓
binding into target object
  ↓
validation
  ↓
error collection / exception
  ↓
controller/application method receives object
```

Contoh sumber data:

```text
HTTP query param        ?page=1&active=true
HTTP path variable      /users/123
HTTP header             X-Tenant-Id: aceas
HTTP JSON body          {"name":"Fajar"}
form data               name=Fajar&role=ADMIN
configuration property  app.retry.max-attempts=3
method parameter        service.create(@Valid command)
```

Spring tidak selalu memakai pipeline yang sama untuk semua sumber data. JSON body, query parameter, config property, dan method validation punya jalur yang mirip secara konsep tetapi berbeda secara implementasi.

---

## 2. Vocabulary Utama

| Istilah | Arti |
|---|---|
| Conversion | Mengubah satu type ke type lain, misalnya `String` ke `Integer`, `String` ke `UUID`, `String` ke enum. |
| Formatting | Conversion yang memperhatikan representasi manusia, locale, date/time format, currency, number format. |
| Binding | Mengisi property object dari input field/key/value. |
| Validation | Memeriksa apakah object memenuhi aturan. |
| Constraint | Aturan validasi, misalnya `@NotNull`, `@Size`, `@Min`. |
| BindingResult | Wadah error binding dan validation untuk target tertentu. |
| DataBinder | Komponen Spring untuk binding + validation object. |
| WebDataBinder | `DataBinder` khusus web request. |
| ConversionService | Service utama Spring untuk type conversion. |
| FormatterRegistry | Registry converter/formatter. |
| Validator | Interface Spring untuk validasi object. |
| Bean Validation | Standar Jakarta Validation, biasanya implementasinya Hibernate Validator. |

Spring Framework documentation menempatkan `Validator` dan `DataBinder` dalam paket validation, dan `DataBinder` memang dipakai untuk binding user input ke object yang diproses aplikasi.

---

## 3. Kenapa Data Boundary Penting?

Banyak bug enterprise bukan berasal dari algoritma rumit, tetapi dari boundary yang terlalu longgar.

Contoh:

```java
@PostMapping("/users")
public User create(@RequestBody User user) {
    return userRepository.save(user);
}
```

Kelihatannya sederhana, tetapi sangat berbahaya.

Masalah:

1. Client bisa mengisi field internal seperti `id`, `role`, `status`, `createdBy`, `approvedAt`.
2. Entity persistence dipakai langsung sebagai API contract.
3. Validasi domain, API, dan database bercampur.
4. Perubahan schema internal bisa memecahkan API publik.
5. Tidak ada explicit mapping dari intent user ke command aplikasi.

Boundary yang lebih sehat:

```java
public record CreateUserRequest(
        @NotBlank String fullName,
        @Email @NotBlank String email,
        @NotBlank String departmentCode
) {}

@PostMapping("/users")
public ResponseEntity<UserResponse> create(
        @Valid @RequestBody CreateUserRequest request
) {
    CreateUserCommand command = new CreateUserCommand(
            request.fullName(),
            request.email(),
            request.departmentCode()
    );

    User created = createUserUseCase.create(command);

    return ResponseEntity.status(HttpStatus.CREATED)
            .body(UserResponse.from(created));
}
```

Prinsipnya:

```text
external data ≠ internal model
request DTO ≠ domain entity
validation annotation ≠ full business invariant
binding success ≠ safe operation
```

---

## 4. Conversion: Dari String ke Type Java

HTTP parameter dan property file sering datang sebagai string.

Contoh:

```http
GET /cases?status=OPEN&page=2&from=2026-01-01
```

Controller:

```java
@GetMapping("/cases")
public List<CaseResponse> search(
        @RequestParam CaseStatus status,
        @RequestParam int page,
        @RequestParam LocalDate from
) {
    ...
}
```

Spring harus mengubah:

```text
"OPEN"       → CaseStatus.OPEN
"2"          → int 2
"2026-01-01" → LocalDate
```

Ini dikerjakan melalui conversion infrastructure.

---

## 5. ConversionService

`ConversionService` adalah API umum Spring untuk type conversion.

Secara konseptual:

```java
public interface ConversionService {
    boolean canConvert(Class<?> sourceType, Class<?> targetType);
    <T> T convert(Object source, Class<T> targetType);
}
```

Di aplikasi Spring Boot, conversion service biasanya sudah dikonfigurasi otomatis dan dipakai oleh:

- MVC argument binding;
- `@ConfigurationProperties` binding;
- SpEL;
- data binding;
- formatting web layer;
- beberapa integration component.

Contoh custom converter:

```java
@Component
public final class StringToCaseIdConverter implements Converter<String, CaseId> {

    @Override
    public CaseId convert(String source) {
        if (source == null || source.isBlank()) {
            throw new IllegalArgumentException("case id must not be blank");
        }
        return CaseId.of(source.trim());
    }
}
```

Usage:

```java
@GetMapping("/cases/{caseId}")
public CaseResponse get(@PathVariable CaseId caseId) {
    ...
}
```

Dengan converter ini, controller tidak lagi menerima raw string.

---

## 6. Converter vs Formatter vs PropertyEditor

Spring modern lebih mendorong `Converter`, `GenericConverter`, `Formatter`, dan `ConversionService`.

| Mekanisme | Kapan dipakai |
|---|---|
| `Converter<S,T>` | Conversion sederhana dari type S ke T. |
| `ConverterFactory<S,R>` | Conversion dari satu source ke keluarga target type. Contoh string ke enum subtype. |
| `GenericConverter` | Conversion kompleks yang butuh informasi source/target lebih detail. |
| `Formatter<T>` | Parsing/printing berbasis locale atau format manusia. |
| `PropertyEditor` | Mekanisme JavaBeans lama; masih ada tetapi bukan pilihan utama modern. |

Contoh `Formatter`:

```java
public final class CaseNumberFormatter implements Formatter<CaseNumber> {

    @Override
    public CaseNumber parse(String text, Locale locale) {
        return CaseNumber.parse(text);
    }

    @Override
    public String print(CaseNumber object, Locale locale) {
        return object.value();
    }
}
```

Kapan pakai converter?

```text
String → UUID
String → CaseId
String → Money
String → Status enum
```

Kapan pakai formatter?

```text
String ↔ LocalDate dengan format locale
String ↔ Currency amount display
String ↔ business number display
```

---

## 7. Register Converter dan Formatter

Di Spring MVC:

```java
@Configuration
public class WebConversionConfiguration implements WebMvcConfigurer {

    @Override
    public void addFormatters(FormatterRegistry registry) {
        registry.addConverter(new StringToCaseIdConverter());
        registry.addFormatter(new CaseNumberFormatter());
    }
}
```

Di Spring Boot, converter yang menjadi bean sering otomatis terdeteksi untuk application conversion service. Namun untuk boundary yang kritis, lebih baik tetap jelas: apakah converter berlaku global, web-only, config-only, atau module-specific.

Engineering rule:

```text
Global converter harus stabil, deterministic, side-effect free, dan tidak bergantung database/external service.
```

Jangan membuat converter seperti ini:

```java
@Component
public class StringToUserConverter implements Converter<String, User> {
    private final UserRepository userRepository;

    public User convert(String source) {
        return userRepository.findById(Long.valueOf(source)).orElseThrow();
    }
}
```

Kenapa buruk?

1. Conversion jadi melakukan I/O.
2. Binding bisa memicu query database secara tidak terlihat.
3. Error conversion bercampur dengan not-found business semantics.
4. Sulit diobservasi.
5. Riskan untuk performance dan security.

Lebih baik:

```java
@GetMapping("/users/{userId}")
public UserResponse get(@PathVariable UserId userId) {
    User user = userQueryService.getExistingUser(userId);
    return UserResponse.from(user);
}
```

---

## 8. DataBinder: Inti Binding Object

`DataBinder` mengikat property dari input ke target object.

Contoh mental model:

```text
input map:
  fullName=Fajar
  email=fajar@example.com
  age=29

target:
  CreateUserForm

binding result:
  fullName -> "Fajar"
  email    -> "fajar@example.com"
  age      -> 29
```

`DataBinder` melakukan beberapa hal:

1. Menentukan field/property target.
2. Mengambil value dari input.
3. Menggunakan conversion service/property editor.
4. Mengisi property target.
5. Mengumpulkan binding error.
6. Menjalankan validator bila diminta.

Spring docs menjelaskan `DataBinder` sebagai mekanisme untuk binding user input ke object aplikasi, sedangkan `Validator` dan `DataBinder` berada dalam paket validation Spring.

---

## 9. WebDataBinder

`WebDataBinder` adalah varian binder untuk web.

Dipakai untuk:

- binding request parameter ke model attribute;
- conversion string ke type object;
- formatting field;
- validasi target object;
- membatasi field mana yang boleh dibind.

Contoh:

```java
@ControllerAdvice
public class GlobalBindingConfiguration {

    @InitBinder
    public void initBinder(WebDataBinder binder) {
        binder.setDisallowedFields("id", "createdAt", "createdBy", "role", "status");
    }
}
```

Namun konfigurasi global seperti ini harus hati-hati. `@InitBinder` global bisa berdampak ke banyak controller.

Lebih aman untuk use case spesifik:

```java
@Controller
public class UserController {

    @InitBinder("createUserForm")
    public void initCreateUserBinder(WebDataBinder binder) {
        binder.setAllowedFields("fullName", "email", "departmentCode");
    }
}
```

Spring MVC documentation menjelaskan `@InitBinder` sebagai method pada `@Controller` atau `@ControllerAdvice` untuk menginisialisasi `WebDataBinder`, termasuk binding request parameter, conversion, dan formatting.

---

## 10. Binding ke `@ModelAttribute` vs `@RequestBody`

Ini perbedaan penting.

### 10.1 `@ModelAttribute`

Biasanya dipakai untuk:

- form data;
- query parameter kompleks;
- MVC server-side rendered form;
- object dari request parameter.

Contoh:

```java
@GetMapping("/cases")
public Page<CaseResponse> search(@Valid @ModelAttribute CaseSearchRequest request) {
    ...
}
```

Input:

```http
GET /cases?status=OPEN&page=1&size=20
```

Spring menggunakan binder untuk mengisi object dari parameter.

### 10.2 `@RequestBody`

Dipakai untuk body seperti JSON/XML.

Contoh:

```java
@PostMapping("/cases")
public CaseResponse create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

Spring memakai `HttpMessageConverter` seperti Jackson untuk membaca body menjadi object, lalu validation berjalan setelah deserialization.

Implikasi:

| Aspek | `@ModelAttribute` | `@RequestBody` |
|---|---|---|
| Sumber | query/form/path-like parameter | body JSON/XML |
| Komponen utama | `WebDataBinder` | `HttpMessageConverter` + validator |
| Mass assignment risk | tinggi jika binding ke mutable object/entity | tetap ada jika JSON bisa mengisi field internal |
| Cocok untuk | search/filter/form | command JSON API |

---

## 11. BindingResult

`BindingResult` menyimpan error binding dan validation.

Contoh:

```java
@PostMapping("/users")
public String submit(
        @Valid @ModelAttribute("form") CreateUserForm form,
        BindingResult bindingResult
) {
    if (bindingResult.hasErrors()) {
        return "users/create";
    }
    ...
}
```

Perhatikan urutan parameter. `BindingResult` harus langsung setelah target yang divalidasi.

Benar:

```java
public String submit(@Valid @ModelAttribute UserForm form,
                     BindingResult result)
```

Salah:

```java
public String submit(@Valid @ModelAttribute UserForm form,
                     Principal principal,
                     BindingResult result)
```

Untuk REST API modern, biasanya kita tidak menulis `BindingResult` langsung. Kita biarkan Spring melempar exception lalu ditangani oleh `@ControllerAdvice`.

Namun memahami `BindingResult` penting karena error validation pada akhirnya punya struktur ini:

```text
objectName
fieldErrors
objectErrors
globalErrors
rejectedValue
code
message
```

---

## 12. Binding Error vs Validation Error

Ini sering tertukar.

### Binding error

Terjadi ketika input gagal diubah atau diikat.

Contoh:

```http
GET /cases?page=abc
```

Target:

```java
@RequestParam int page
```

`abc` tidak bisa menjadi integer.

### Validation error

Terjadi ketika object berhasil dibentuk, tetapi melanggar aturan.

Contoh:

```json
{
  "email": "not-an-email"
}
```

Target:

```java
public record CreateUserRequest(
        @Email String email
) {}
```

Object bisa dibuat, tetapi tidak valid.

Perbedaan ini penting untuk error contract:

```text
binding error    → input tidak bisa dipahami sistem
validation error → input bisa dipahami, tetapi tidak memenuhi aturan
```

---

## 13. Bean Validation: Jakarta Validation di Spring

Bean Validation adalah standar annotation-based validation.

Contoh:

```java
public record CreateUserRequest(
        @NotBlank String fullName,
        @Email @NotBlank String email,
        @Size(min = 2, max = 20) String departmentCode
) {}
```

Controller:

```java
@PostMapping("/users")
public UserResponse create(@Valid @RequestBody CreateUserRequest request) {
    ...
}
```

Spring akan menjalankan validator setelah object tersedia.

Constraint umum:

| Constraint | Makna |
|---|---|
| `@NotNull` | Nilai tidak boleh null. |
| `@NotBlank` | String tidak boleh null/kosong/blank. |
| `@NotEmpty` | Collection/string tidak boleh kosong. |
| `@Size` | Ukuran string/collection/array. |
| `@Min`, `@Max` | Numeric range. |
| `@Positive`, `@PositiveOrZero` | Numeric positive. |
| `@Email` | Format email. |
| `@Pattern` | Regex. |
| `@Past`, `@Future` | Date/time constraint. |
| `@AssertTrue`, `@AssertFalse` | Boolean condition. |
| `@Valid` | Cascade validation ke nested object. |

---

## 14. `@Valid` vs `@Validated`

`@Valid` berasal dari Jakarta Validation.

`@Validated` berasal dari Spring dan menambahkan dukungan validation group pada level Spring.

Contoh group:

```java
public interface OnCreate {}
public interface OnUpdate {}

public record UserRequest(
        @Null(groups = OnCreate.class)
        @NotNull(groups = OnUpdate.class)
        Long id,

        @NotBlank
        String fullName
) {}
```

Controller:

```java
@PostMapping("/users")
public UserResponse create(@Validated(OnCreate.class) @RequestBody UserRequest request) {
    ...
}

@PutMapping("/users/{id}")
public UserResponse update(@Validated(OnUpdate.class) @RequestBody UserRequest request) {
    ...
}
```

Namun group bisa membuat model sulit dibaca jika terlalu banyak.

Sering lebih bersih:

```java
public record CreateUserRequest(...) {}
public record UpdateUserRequest(...) {}
```

Rule praktis:

```text
Gunakan validation group untuk variasi kecil pada model yang sama.
Gunakan DTO berbeda untuk intent berbeda.
```

---

## 15. Nested Validation

Tanpa `@Valid` pada nested field, constraint di object anak tidak selalu dijalankan.

Contoh:

```java
public record CreateOrderRequest(
        @NotBlank String customerId,
        @Valid @NotEmpty List<OrderLineRequest> lines
) {}

public record OrderLineRequest(
        @NotBlank String sku,
        @Positive int quantity
) {}
```

Tanpa `@Valid` pada `lines`, Spring bisa memvalidasi list sebagai collection tetapi tidak cascade ke setiap item.

Untuk `Map`:

```java
public record UpdateMetadataRequest(
        @Valid Map<@NotBlank String, @NotBlank String> metadata
) {}
```

Container element validation penting untuk collection generic.

---

## 16. Class-Level Constraint

Field-level constraint tidak cukup untuk aturan antar field.

Contoh:

```text
startDate harus sebelum endDate
setidaknya salah satu dari email atau phone harus diisi
jika type = COMPANY maka companyRegistrationNumber wajib
```

Buat custom class-level constraint.

Annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ValidDateRangeValidator.class)
public @interface ValidDateRange {
    String message() default "start date must be before end date";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public final class ValidDateRangeValidator
        implements ConstraintValidator<ValidDateRange, DateRangeRequest> {

    @Override
    public boolean isValid(DateRangeRequest value, ConstraintValidatorContext context) {
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

DTO:

```java
@ValidDateRange
public record DateRangeRequest(
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate
) {}
```

Poin penting: custom validator sebaiknya **pure**, tidak melakukan database call atau remote call.

---

## 17. Validation Boundary vs Business Invariant

Tidak semua aturan harus menjadi annotation validation.

Contoh API request:

```java
public record SubmitAppealRequest(
        @NotBlank String caseId,
        @NotBlank String reason
) {}
```

Annotation bisa memastikan:

```text
caseId tidak kosong
reason tidak kosong
```

Tetapi aturan berikut bukan sekadar validation annotation:

```text
case harus exist
case harus milik user/tenant yang sama
case status harus ALLOW_APPEAL
appeal window belum expired
user punya permission SUBMIT_APPEAL
```

Itu adalah business invariant dan authorization invariant. Letakkan di application/domain service.

```java
public Appeal submit(SubmitAppealCommand command) {
    Case c = caseRepository.getRequired(command.caseId());

    authorization.checkCanSubmitAppeal(currentUser, c);
    c.assertAppealAllowed(clock.today());

    Appeal appeal = c.submitAppeal(command.reason());
    appealRepository.save(appeal);
    return appeal;
}
```

Rule:

```text
Validation annotation = shape, syntax, local consistency.
Business invariant = stateful, contextual, domain decision.
Authorization invariant = subject/action/resource policy.
```

---

## 18. Method Validation

Spring dapat memvalidasi parameter dan return value method service.

Contoh:

```java
@Service
@Validated
public class CaseCommandService {

    public CaseId create(@Valid CreateCaseCommand command) {
        ...
    }

    public void assign(
            @NotNull CaseId caseId,
            @NotNull UserId assigneeId
    ) {
        ...
    }
}
```

Penting: method validation di Spring berbasis AOP/proxy.

Implikasi:

1. Method harus dipanggil lewat Spring proxy.
2. Self-invocation tidak memicu method validation.
3. Final/private method tidak cocok untuk proxy-based validation.
4. Interface/class proxy behavior harus dipahami.

Contoh gagal:

```java
@Service
@Validated
public class CaseService {

    public void outer() {
        inner(null); // self-invocation, validation bisa tidak jalan
    }

    public void inner(@NotNull String value) {
        ...
    }
}
```

Jika rule penting, jangan hanya bergantung pada method validation proxy. Validasi eksplisit di domain/application boundary.

---

## 19. ConfigurationProperties Validation

Config juga data boundary.

Contoh:

```yaml
app:
  onemap:
    base-url: https://example.com
    connect-timeout: 2s
    read-timeout: 5s
    max-retry: 3
```

Properties:

```java
@ConfigurationProperties(prefix = "app.onemap")
@Validated
public record OneMapProperties(
        @NotNull URI baseUrl,
        @NotNull Duration connectTimeout,
        @NotNull Duration readTimeout,
        @Min(0) @Max(5) int maxRetry
) {}
```

Enable:

```java
@ConfigurationPropertiesScan
@SpringBootApplication
public class Application {}
```

Mengapa validasi config penting?

1. Fail fast saat startup.
2. Mencegah production berjalan dengan default salah.
3. Membuat konfigurasi bisa diaudit.
4. Mengurangi runtime surprise.

Spring Boot documentation membahas externalized configuration dan binding configuration properties; konfigurasi bisa datang dari banyak sumber seperti properties file, YAML, environment variable, dan command-line argument.

---

## 20. `@Value` vs `@ConfigurationProperties`

| Aspek | `@Value` | `@ConfigurationProperties` |
|---|---|---|
| Cocok untuk | 1 nilai sederhana | kelompok config |
| Type-safe model | lemah | kuat |
| Metadata IDE | terbatas | lebih baik |
| Validation | tidak natural | natural dengan `@Validated` |
| Discoverability | tersebar | terpusat |
| Refactoring | lebih sulit | lebih mudah |

Kurang ideal:

```java
@Service
public class OneMapClient {
    public OneMapClient(
            @Value("${app.onemap.base-url}") String baseUrl,
            @Value("${app.onemap.max-retry:3}") int maxRetry
    ) {}
}
```

Lebih baik:

```java
@Service
public class OneMapClient {
    private final OneMapProperties properties;

    public OneMapClient(OneMapProperties properties) {
        this.properties = properties;
    }
}
```

Rule:

```text
Untuk production system, config yang punya makna bisnis/operasional sebaiknya punya object model sendiri.
```

---

## 21. Request DTO Design

Request DTO harus merepresentasikan **intent client**, bukan struktur database.

Buruk:

```java
public class CaseEntity {
    public Long id;
    public String status;
    public String assignedOfficer;
    public LocalDateTime createdAt;
    public LocalDateTime approvedAt;
    public String internalRemark;
}
```

Lebih sehat:

```java
public record CreateCaseRequest(
        @NotBlank String applicantId,
        @NotBlank String caseType,
        @NotBlank String description,
        @Valid List<AttachmentRequest> attachments
) {}
```

Kemudian mapping ke command:

```java
public record CreateCaseCommand(
        ApplicantId applicantId,
        CaseType caseType,
        String description,
        List<AttachmentCommand> attachments,
        UserId submittedBy,
        TenantId tenantId
) {}
```

Kenapa command berbeda dari request?

1. Command bisa mengandung data dari security context.
2. Command bisa memakai value object.
3. Command tidak terikat format API.
4. Command lebih dekat ke use case.
5. Request bisa berubah tanpa merusak application service.

---

## 22. Response DTO Bukan Kebalikan Request DTO

Sering terjadi anti-pattern:

```java
public class UserDto {
    public Long id;
    public String name;
    public String email;
    public String role;
    public String password;
}
```

Dipakai untuk request dan response sekaligus.

Risiko:

1. Field password bisa bocor di response.
2. Role bisa diisi user saat request.
3. Validasi create/update/search bercampur.
4. Tidak jelas ownership field.

Pisahkan:

```java
public record CreateUserRequest(
        @NotBlank String name,
        @Email @NotBlank String email,
        @NotBlank String password
) {}

public record UserResponse(
        String id,
        String name,
        String email,
        String status
) {}
```

Rule:

```text
Request DTO mengikuti intent write.
Response DTO mengikuti kebutuhan read.
Domain model mengikuti invariant internal.
```

---

## 23. Mass Assignment Risk

Mass assignment terjadi ketika client bisa mengisi field yang seharusnya dikontrol server.

Contoh buruk:

```java
@PostMapping("/accounts")
public Account create(@RequestBody Account account) {
    return repository.save(account);
}
```

Client mengirim:

```json
{
  "name": "Fajar",
  "role": "ADMIN",
  "verified": true,
  "creditLimit": 999999999
}
```

Jika entity punya field tersebut dan binding/deserialization mengisi semuanya, sistem bisa rusak.

Mitigasi:

1. Jangan bind request langsung ke entity.
2. Gunakan request DTO eksplisit.
3. Gunakan immutable record untuk request.
4. Gunakan allow-list field untuk form binding.
5. Jangan expose setter untuk field internal jika tidak perlu.
6. Konfigurasi object mapper untuk unknown property sesuai kebijakan.
7. Review setiap endpoint write: “field mana yang client boleh kontrol?”

---

## 24. Unknown Field Policy

Dalam JSON API, pertanyaan penting:

```text
Jika client mengirim field yang tidak dikenal, apakah harus ditolak atau diabaikan?
```

Contoh:

```json
{
  "name": "Fajar",
  "email": "fajar@example.com",
  "role": "ADMIN"
}
```

Jika `role` tidak ada di DTO, Jackson bisa mengabaikan atau menolak tergantung konfigurasi.

Untuk API internal/regulatory/strict contract, sering lebih aman menolak unknown field.

Kebijakan:

| Kebijakan | Kelebihan | Risiko |
|---|---|---|
| Ignore unknown | Lebih toleran ke client lama/baru | typo field bisa diam-diam diabaikan |
| Fail unknown | Contract strict, typo cepat ketahuan | compatibility lebih ketat |

Decision rule:

```text
Public API yang butuh forward compatibility: pertimbangkan ignore dengan monitoring.
Critical command API: pertimbangkan fail unknown.
```

---

## 25. Null Semantics

Null adalah salah satu sumber bug terbesar dalam data boundary.

Pertanyaan untuk setiap field:

```text
field wajib ada?
field boleh null?
field boleh kosong?
field boleh blank?
field absent beda dengan null?
field null berarti clear value atau no change?
```

Contoh create:

```java
public record CreateProfileRequest(
        @NotBlank String fullName,
        @Email @NotBlank String email,
        String phoneNumber
) {}
```

Contoh patch lebih kompleks:

```java
public record PatchProfileRequest(
        OptionalField<String> fullName,
        OptionalField<String> phoneNumber
) {}
```

Karena untuk PATCH, tiga keadaan sering berbeda:

```text
absent     → jangan ubah
null       → clear value
value      → set value
```

Jangan memaksakan `Optional<T>` di semua DTO tanpa desain jelas. `Optional` sebagai field DTO sering membuat serialization/deserialization lebih rumit.

---

## 26. Validation untuk PATCH

PATCH tidak sama dengan PUT.

PUT biasanya replace state:

```json
{
  "fullName": "Fajar",
  "email": "fajar@example.com"
}
```

PATCH biasanya partial update:

```json
{
  "phoneNumber": null
}
```

Masalah:

```java
public record UpdateUserRequest(
        @NotBlank String fullName,
        @Email @NotBlank String email
) {}
```

Tidak cocok untuk PATCH karena field absent akan dianggap null dan gagal validasi.

Solusi:

1. Pakai DTO khusus PATCH.
2. Validasi hanya field yang hadir.
3. Gunakan JSON Merge Patch/JSON Patch jika kontrak membutuhkan.
4. Jalankan invariant final di domain setelah patch diterapkan.

Pattern:

```java
public record PatchUserRequest(
        String fullName,
        String phoneNumber
) {
    public void validatePatch() {
        if (fullName != null && fullName.isBlank()) {
            throw new InvalidRequestException("fullName must not be blank when provided");
        }
    }
}
```

Untuk sistem enterprise, validasi PATCH sering lebih baik eksplisit daripada memaksakan annotation.

---

## 27. Error Message dan MessageSource

Validation error idealnya tidak hardcoded langsung untuk semua bahasa.

Constraint:

```java
public record CreateUserRequest(
        @NotBlank(message = "{user.fullName.required}")
        String fullName
) {}
```

Message bundle:

```properties
user.fullName.required=Full name is required.
```

Dengan `MessageSource`, aplikasi bisa mendukung localization.

Namun untuk API machine-to-machine, message manusia saja tidak cukup. Butuh error code stabil.

Contoh error response:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "traceId": "abc-123",
  "errors": [
    {
      "field": "fullName",
      "code": "NotBlank",
      "message": "Full name is required."
    }
  ]
}
```

Prinsip:

```text
message boleh berubah
code sebaiknya stabil
field path harus jelas
traceId membantu debugging
```

---

## 28. Field Path untuk Nested Error

Nested validation menghasilkan path seperti:

```text
lines[0].sku
lines[1].quantity
applicant.address.postalCode
metadata['source']
```

Pastikan error response mempertahankan path ini.

Contoh:

```json
{
  "field": "lines[1].quantity",
  "code": "Positive",
  "message": "quantity must be greater than 0"
}
```

Jangan ubah semua error menjadi pesan global seperti:

```json
{
  "message": "Invalid request"
}
```

Itu tidak cukup untuk client memperbaiki request.

---

## 29. Validation Exception di Spring MVC

Umumnya beberapa jenis error muncul:

| Kondisi | Exception umum |
|---|---|
| `@RequestBody` invalid | `MethodArgumentNotValidException` |
| `@ModelAttribute` invalid tanpa `BindingResult` | `MethodArgumentNotValidException` / binding-related exception tergantung versi dan jalur |
| `@RequestParam` conversion gagal | `MethodArgumentTypeMismatchException` atau conversion exception wrapped |
| Missing parameter | `MissingServletRequestParameterException` |
| Method validation gagal | `ConstraintViolationException` atau Spring method validation exception tergantung versi/config |
| Body malformed JSON | `HttpMessageNotReadableException` |

Jangan terlalu bergantung pada nama exception sebagai kontrak bisnis. Buat mapping error di `@ControllerAdvice` yang memisahkan:

```text
malformed body
binding/type mismatch
validation failed
business rule failed
authorization failed
resource not found
conflict
```

Part berikutnya akan membahas error semantics lebih dalam.

---

## 30. `@InitBinder`: Kapan Perlu?

Gunakan `@InitBinder` untuk hal yang benar-benar terkait binding web.

Contoh use case:

1. Membatasi allowed fields pada form binding.
2. Register editor/converter khusus controller tertentu.
3. Register validator khusus command object tertentu.
4. Menyesuaikan binder untuk legacy form.

Contoh:

```java
@InitBinder("caseSearchRequest")
public void initCaseSearchBinder(WebDataBinder binder) {
    binder.setAllowedFields("status", "fromDate", "toDate", "page", "size");
}
```

Jangan gunakan `@InitBinder` untuk:

1. Business rule kompleks.
2. Database lookup.
3. Authorization.
4. Global transformation tersembunyi yang membuat API sulit diprediksi.

---

## 31. Security: Data Binding sebagai Attack Surface

Data binding bisa menjadi attack surface.

Risiko:

1. Mass assignment.
2. Nested property binding tidak terkontrol.
3. Auto-growing collection terlalu besar.
4. Malicious field path.
5. Sensitive field overwritten.
6. Unknown field ignored silently.
7. Error message membocorkan class/internal field.

Mitigasi:

```java
@InitBinder
public void initBinder(WebDataBinder binder) {
    binder.setAllowedFields("fullName", "email", "departmentCode");
    binder.setAutoGrowCollectionLimit(100);
}
```

Untuk JSON, mitigasi lebih banyak pada DTO design dan ObjectMapper policy.

Checklist endpoint write:

```text
[ ] Endpoint tidak menerima entity langsung.
[ ] Field request eksplisit.
[ ] Unknown field policy jelas.
[ ] Field internal tidak punya setter publik dari request path.
[ ] Nested object divalidasi.
[ ] Collection punya batas ukuran.
[ ] Error tidak membocorkan internals.
[ ] Business invariant tidak hanya annotation.
```

---

## 32. Collection Size dan Payload Abuse

Validasi bukan hanya field value, tetapi juga ukuran payload.

Contoh:

```java
public record BulkUploadRequest(
        @NotEmpty
        @Size(max = 500)
        @Valid List<ItemRequest> items
) {}
```

Tanpa batas:

```json
{
  "items": [ ... 1_000_000 items ... ]
}
```

Masalah:

1. Memory pressure.
2. Long validation time.
3. Database overload.
4. Transaction terlalu besar.
5. DoS vector.

Untuk file upload atau bulk import, jangan hanya mengandalkan validation annotation. Buat pipeline ingestion dengan limit ukuran file, row count, chunking, retry, dan error report.

---

## 33. Enum Binding

Enum terlihat mudah tetapi sering menimbulkan compatibility issue.

```java
public enum CaseStatus {
    OPEN,
    PENDING_REVIEW,
    CLOSED
}
```

Request:

```http
GET /cases?status=open
```

Default binding bisa case-sensitive tergantung converter/config.

Risiko:

1. Nama enum internal menjadi API contract.
2. Rename enum memecahkan client.
3. Enum display value bercampur dengan persistence value.
4. Unknown future value tidak tertangani.

Lebih aman untuk public API:

```java
public enum CaseStatusParam {
    OPEN("open"),
    PENDING_REVIEW("pending_review"),
    CLOSED("closed");

    private final String apiValue;
}
```

Atau gunakan string param lalu map eksplisit:

```java
CaseStatus status = CaseStatusApiMapper.fromApiValue(request.status());
```

Rule:

```text
Internal enum name jangan otomatis dianggap external API value.
```

---

## 34. Date/Time Binding

Date/time adalah boundary yang sering salah.

Pertanyaan:

```text
apakah input LocalDate, LocalDateTime, OffsetDateTime, Instant?
timezone siapa?
apakah inclusive/exclusive?
apakah range akhir termasuk?
```

Untuk API:

```java
public record SearchRequest(
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
        LocalDate fromDate,

        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
        LocalDate toDate
) {}
```

Untuk event timestamp:

```java
public record EventRequest(
        @NotNull Instant occurredAt
) {}
```

Guideline:

| Use case | Type yang umum lebih aman |
|---|---|
| Tanggal bisnis tanpa jam | `LocalDate` |
| Timestamp absolut | `Instant` |
| Timestamp dengan offset client | `OffsetDateTime` |
| Internal scheduled local time | `ZonedDateTime` dengan zone jelas |
| Jangan untuk timestamp global | `LocalDateTime` tanpa zone |

---

## 35. Numeric Binding dan Precision

Jangan gunakan `double` untuk money.

Buruk:

```java
public record PaymentRequest(double amount) {}
```

Lebih baik:

```java
public record PaymentRequest(
        @NotNull
        @DecimalMin("0.01")
        @Digits(integer = 12, fraction = 2)
        BigDecimal amount,

        @NotBlank
        String currency
) {}
```

Lalu map ke value object:

```java
Money money = Money.of(request.amount(), CurrencyUnit.of(request.currency()));
```

Validation annotation hanya memastikan bentuk angka. Invariant money seperti currency allowed, scale, rounding, dan business limit tetap perlu domain logic.

---

## 36. String Normalization

Pertanyaan penting:

```text
apakah trim dilakukan?
apakah blank dianggap null?
apakah case-insensitive?
apakah Unicode normalization dilakukan?
apakah whitespace internal dipertahankan?
```

Jangan melakukan normalization tersembunyi secara global tanpa kebijakan.

Contoh buruk:

```java
@InitBinder
public void trimEverything(WebDataBinder binder) {
    binder.registerCustomEditor(String.class, new StringTrimmerEditor(true));
}
```

Ini bisa mengubah semantics field yang seharusnya mempertahankan whitespace.

Lebih baik explicit di mapping layer:

```java
String fullName = request.fullName().trim();
Email email = Email.parse(request.email().trim().toLowerCase(Locale.ROOT));
```

Atau value object:

```java
public record Email(String value) {
    public static Email parse(String raw) {
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        // validate format
        return new Email(normalized);
    }
}
```

---

## 37. Value Object di Boundary

Ada dua pendekatan.

### 37.1 DTO memakai primitive/string

```java
public record CreateCaseRequest(
        @NotBlank String applicantId,
        @NotBlank String caseType
) {}
```

Mapping ke value object:

```java
ApplicantId applicantId = ApplicantId.of(request.applicantId());
CaseType caseType = CaseType.from(request.caseType());
```

Kelebihan:

- API DTO sederhana.
- Error handling lebih mudah dikontrol.
- Tidak perlu banyak converter/deserializer.

### 37.2 DTO langsung memakai value object

```java
public record CreateCaseRequest(
        @NotNull ApplicantId applicantId,
        @NotNull CaseType caseType
) {}
```

Butuh converter/deserializer.

Kelebihan:

- Type safety lebih awal.
- Controller lebih bersih.

Risiko:

- Conversion error bisa lebih sulit dipetakan.
- Value object API dan internal domain bisa terlalu melekat.

Rule praktis:

```text
Untuk public/external API, DTO primitive/string + explicit mapping sering lebih controllable.
Untuk internal API yang stabil, value object binding bisa dipakai dengan converter yang baik.
```

---

## 38. Validation di Layer Mana?

Lapisan yang berbeda punya tanggung jawab berbeda.

| Layer | Validasi yang cocok |
|---|---|
| Controller/API DTO | shape, required field, local format, size limit |
| Application command | use case precondition, caller context, tenant context |
| Domain model | invariant inti yang selalu benar |
| Repository/database | uniqueness, FK, constraint final |
| Integration client | contract external system, response validation |
| Config properties | startup correctness |

Jangan menaruh semua validasi di satu tempat.

Contoh:

```text
email format valid                      → DTO validation
email belum digunakan tenant tersebut   → application/domain rule + repository
email normalized lowercase              → value object/domain mapping
unique constraint final                 → database
```

---

## 39. Fail Fast vs Error Accumulation

Dua strategi:

### Fail fast

Berhenti pada error pertama.

Cocok untuk:

- command internal;
- invariant domain;
- pipeline yang mahal;
- security/authorization failure.

### Error accumulation

Kumpulkan semua field error.

Cocok untuk:

- form input;
- REST validation response;
- bulk upload row validation;
- user-facing correction.

DTO validation biasanya accumulation. Domain invariant biasanya fail fast.

---

## 40. Validation untuk Bulk Operation

Bulk operation punya kebutuhan berbeda.

Input:

```json
{
  "items": [
    {"rowId":"1", "email":"bad"},
    {"rowId":"2", "email":"valid@example.com"}
  ]
}
```

Error response ideal:

```json
{
  "errors": [
    {
      "rowId": "1",
      "field": "email",
      "code": "Email",
      "message": "email must be valid"
    }
  ]
}
```

Jangan hanya response:

```json
{"message":"Validation failed"}
```

Bulk validation perlu:

1. Row identity.
2. Field path.
3. Error code.
4. Severity.
5. Partial success policy.
6. Max error count agar response tidak terlalu besar.

---

## 41. Testing Conversion dan Validation

Jangan hanya test happy path controller.

### 41.1 Test DTO validation langsung

```java
class CreateUserRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory()
            .getValidator();

    @Test
    void rejectsBlankEmail() {
        var request = new CreateUserRequest("Fajar", " ", "DEV");

        Set<ConstraintViolation<CreateUserRequest>> violations = validator.validate(request);

        assertThat(violations)
                .anyMatch(v -> v.getPropertyPath().toString().equals("email"));
    }
}
```

### 41.2 Test MVC binding

```java
@WebMvcTest(UserController.class)
class UserControllerValidationTest {

    @Autowired MockMvc mvc;

    @Test
    void rejectsInvalidRequest() throws Exception {
        mvc.perform(post("/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"fullName":"", "email":"bad"}
                """))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.errors").isArray());
    }
}
```

### 41.3 Test converter

```java
class StringToCaseIdConverterTest {

    private final StringToCaseIdConverter converter = new StringToCaseIdConverter();

    @Test
    void convertsValidId() {
        assertThat(converter.convert("CASE-001"))
                .isEqualTo(CaseId.of("CASE-001"));
    }
}
```

### 41.4 Test config validation

Gunakan `ApplicationContextRunner` untuk auto-config/config properties.

```java
class OneMapPropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(TestConfig.class)
            .withPropertyValues(
                    "app.onemap.base-url=https://example.com",
                    "app.onemap.connect-timeout=2s",
                    "app.onemap.read-timeout=5s",
                    "app.onemap.max-retry=3"
            );

    @Test
    void bindsValidProperties() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(OneMapProperties.class);
        });
    }
}
```

---

## 42. Observability untuk Boundary Error

Validation error bukan sekadar client mistake. Dalam production, error boundary bisa menunjukkan:

1. Client salah versi.
2. UI mengirim payload rusak.
3. API contract tidak terdokumentasi.
4. Attack attempt.
5. Backward compatibility rusak.
6. Config drift.

Metric yang berguna:

```text
http.server.requests{status=400, exception=MethodArgumentNotValidException}
api.validation.errors{endpoint, field, code}
api.binding.errors{endpoint, parameter}
config.binding.failure{property}
```

Namun hati-hati cardinality. Jangan jadikan raw field value sebagai tag metric.

Log yang baik:

```json
{
  "event": "api.validation.failed",
  "traceId": "abc-123",
  "endpoint": "POST /users",
  "errorCount": 2,
  "fields": ["fullName", "email"]
}
```

Jangan log rejected sensitive value seperti password, token, NRIC, credential, atau PII sensitif.

---

## 43. Version Differences: Java 8 sampai Java 25

### Java 8 era

Umum:

- Spring Framework 4/5;
- Spring Boot 1/2;
- `javax.validation.*`;
- mutable POJO DTO;
- no records;
- banyak aplikasi masih pakai `PropertyEditor`/legacy binder;
- `RestTemplate` dominan.

DTO umum:

```java
public class CreateUserRequest {
    @NotBlank
    private String fullName;

    @Email
    private String email;

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }
}
```

### Java 17+ era

Umum:

- Spring Framework 6;
- Spring Boot 3;
- `jakarta.validation.*`;
- record DTO lebih umum;
- constructor binding lebih natural;
- native/AOT lebih diperhatikan.

DTO:

```java
public record CreateUserRequest(
        @NotBlank String fullName,
        @Email @NotBlank String email
) {}
```

### Java 21–25 era

Umum:

- Spring Framework 6.2/7.x;
- Spring Boot 3.4/3.5/4.x;
- stronger null-safety direction;
- virtual threads untuk request processing;
- AOT/native lebih matang;
- API versioning dan HTTP service client makin first-class di Boot 4 ecosystem.

Implikasi validation/binding:

1. Record DTO makin natural.
2. Constructor/object creation error harus dipetakan jelas.
3. Null-safety annotation makin penting.
4. Reflection hints bisa perlu untuk native image.
5. Dynamic binding yang terlalu magical makin bermasalah untuk AOT.

---

## 44. AOT/Native Image Implications

Dynamic reflection-heavy pattern bisa bermasalah di native image.

Agar lebih native-friendly:

1. Gunakan DTO eksplisit.
2. Hindari dynamic class loading di converter/validator.
3. Hindari reflection manual tanpa runtime hints.
4. Gunakan Spring-supported binding/conversion infrastructure.
5. Test native image bila aplikasi target native.

Custom validator biasanya aman jika dependency-nya jelas dan bean-nya registered.

Masalah sering muncul jika:

```text
validator membaca class name dari string lalu reflect
converter membuat proxy dinamis sendiri
binding target memakai type tidak reachable oleh AOT analysis
```

---

## 45. Design Pattern: Boundary Pipeline

Untuk endpoint command production-grade:

```text
HTTP Request
  ↓
Request DTO deserialization
  ↓
DTO validation: syntax/shape/local consistency
  ↓
Request → Command mapping
  ↓
Value object parsing/normalization
  ↓
Application service
  ↓
Authorization/policy check
  ↓
Domain invariant check
  ↓
Persistence transaction
  ↓
Response DTO mapping
```

Contoh:

```java
@PostMapping("/cases/{caseId}/appeals")
public ResponseEntity<AppealResponse> submitAppeal(
        @PathVariable String caseId,
        @Valid @RequestBody SubmitAppealRequest request,
        Authentication authentication
) {
    SubmitAppealCommand command = new SubmitAppealCommand(
            CaseId.of(caseId),
            request.reason().trim(),
            UserId.from(authentication),
            TenantId.from(authentication)
    );

    Appeal appeal = submitAppealUseCase.submit(command);

    return ResponseEntity.status(HttpStatus.CREATED)
            .body(AppealResponse.from(appeal));
}
```

---

## 46. Anti-Patterns

### 46.1 Entity as Request Body

```java
@PostMapping("/users")
public User create(@RequestBody User user) { ... }
```

Masalah: mass assignment, persistence leakage, API fragility.

### 46.2 One DTO for Everything

```java
UserDto used for create, update, patch, response, admin response, search
```

Masalah: validation ambiguity, overexposure, compatibility pain.

### 46.3 Validation Annotation as Business Rule Engine

```java
@UserMustBeAllowedToSubmitAppeal
```

Jika validator query database dan security context, boundary menjadi kabur.

### 46.4 Global Converter with I/O

```java
String → Entity by repository lookup
```

Masalah: hidden database call during binding.

### 46.5 Silent Unknown Fields for Critical Command

Client typo field, server ignore, data hilang tanpa sadar.

### 46.6 No Collection Limit

Bulk request tanpa `@Size(max=...)`.

### 46.7 Error Message Leaks Internal Class

```json
"Failed to bind property com.company.internal.CaseEntity.approvedBy"
```

Masalah: information disclosure.

### 46.8 Method Validation Trusted as Only Guard

Self-invocation atau proxy bypass membuat validation tidak jalan.

---

## 47. Production Checklist

Untuk setiap API write endpoint:

```text
[ ] Request DTO berbeda dari entity.
[ ] Request DTO merepresentasikan intent, bukan table structure.
[ ] Required field diberi constraint eksplisit.
[ ] Collection punya size limit.
[ ] Nested object diberi @Valid.
[ ] Date/time semantics jelas.
[ ] Numeric precision benar, terutama money.
[ ] Enum external value tidak bergantung internal enum name secara sembarangan.
[ ] Unknown field policy jelas.
[ ] Mass assignment dicegah.
[ ] Error response punya field path, code, message, traceId.
[ ] Sensitive rejected value tidak dilog.
[ ] Mapping request ke command eksplisit.
[ ] Business invariant ada di application/domain layer.
[ ] Authorization tidak dicampur dengan DTO validation.
[ ] Converter tidak melakukan I/O.
[ ] Method validation tidak menjadi satu-satunya penjaga invariant penting.
[ ] Config properties divalidasi saat startup.
[ ] Test mencakup malformed input, binding error, validation error, dan valid request.
```

---

## 48. Review Rubric untuk Senior/Staff Engineer

Saat review PR Spring, tanyakan:

1. **Apa boundary data eksternalnya?**
2. **Apakah client bisa mengontrol field internal?**
3. **Apakah request DTO berbeda dari domain/entity?**
4. **Apakah validation hanya memeriksa shape atau sudah mencampur business policy?**
5. **Apakah error contract bisa dipakai client untuk memperbaiki request?**
6. **Apakah conversion deterministic dan bebas side effect?**
7. **Apakah config gagal cepat jika invalid?**
8. **Apakah PATCH semantics jelas?**
9. **Apakah collection/payload punya limit?**
10. **Apakah test membuktikan invalid input ditolak dengan benar?**

Engineer top-tier tidak hanya bertanya “apakah validasi jalan”, tetapi:

```text
apakah boundary ini menjaga invariant sistem dalam jangka panjang?
```

---

## 49. Mini Case Study: Case Management Submit Appeal

### Requirement

User dapat submit appeal untuk case tertentu jika:

1. `caseId` valid.
2. Reason wajib dan maksimal 2000 karakter.
3. Case harus exist.
4. Case milik tenant user.
5. Status case memperbolehkan appeal.
6. Window appeal belum expired.
7. User punya permission.

### Salah

```java
@PostMapping("/cases/{caseId}/appeal")
public Appeal appeal(@PathVariable String caseId,
                     @RequestBody Appeal appeal) {
    appeal.setCaseId(caseId);
    return appealRepository.save(appeal);
}
```

Masalah:

- Entity langsung dari request.
- Tidak ada DTO validation.
- Tidak ada tenant boundary.
- Tidak ada state transition check.
- Tidak ada authorization.
- Client bisa mengisi internal field appeal.

### Lebih Baik

```java
public record SubmitAppealRequest(
        @NotBlank
        @Size(max = 2000)
        String reason
) {}

@PostMapping("/cases/{caseId}/appeals")
public ResponseEntity<AppealResponse> submit(
        @PathVariable String caseId,
        @Valid @RequestBody SubmitAppealRequest request,
        Authentication authentication
) {
    SubmitAppealCommand command = new SubmitAppealCommand(
            CaseId.of(caseId),
            request.reason().trim(),
            TenantId.from(authentication),
            UserId.from(authentication)
    );

    Appeal appeal = submitAppealUseCase.submit(command);

    return ResponseEntity.status(HttpStatus.CREATED)
            .body(AppealResponse.from(appeal));
}
```

Application service:

```java
@Transactional
public Appeal submit(SubmitAppealCommand command) {
    Case c = caseRepository.getRequired(command.caseId());

    tenantPolicy.assertSameTenant(command.tenantId(), c.tenantId());
    authorizationPolicy.assertCanSubmitAppeal(command.userId(), c);
    c.assertAppealAllowed(clock.instant());

    Appeal appeal = c.submitAppeal(command.reason(), command.userId(), clock.instant());

    appealRepository.save(appeal);
    return appeal;
}
```

Boundary split:

| Rule | Lokasi |
|---|---|
| reason wajib | DTO validation |
| reason max 2000 | DTO validation |
| caseId parseable | value object mapping/converter |
| case exist | application service |
| tenant sama | policy/application service |
| user boleh submit | authorization policy |
| status allow appeal | domain invariant |
| appeal window valid | domain invariant |

---

## 50. Ringkasan Mental Model

Spring validation/binding bukan dekorasi annotation. Ia adalah sistem boundary.

Mental model inti:

```text
raw external input harus melewati:
  extraction → conversion → binding/deserialization → validation → mapping → invariant check
```

Pemisahan penting:

```text
binding error       = input tidak bisa dibentuk
validation error    = object terbentuk tetapi local rule gagal
business error      = state/context tidak memperbolehkan operasi
authorization error = subject tidak boleh melakukan action pada resource
conflict error      = request valid tetapi bertabrakan dengan state saat ini
```

Prinsip desain:

1. Jangan menerima entity sebagai request.
2. Buat DTO berdasarkan intent.
3. Gunakan validation untuk shape/local consistency.
4. Gunakan domain/application logic untuk invariant stateful.
5. Gunakan policy layer untuk authorization.
6. Conversion harus deterministic dan tanpa I/O.
7. Error response harus terstruktur.
8. Config juga harus divalidasi.
9. Test invalid path sekuat happy path.
10. Jangan percaya data sampai melewati boundary.

---

## 51. Referensi Resmi

- Spring Framework Reference — Validation, Data Binding, and Type Conversion: `https://docs.spring.io/spring-framework/reference/core/validation.html`
- Spring Framework Reference — Type Conversion: `https://docs.spring.io/spring-framework/reference/core/validation/convert.html`
- Spring Framework Reference — `@InitBinder`: `https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-initbinder.html`
- Spring Framework Javadoc — `WebDataBinder`: `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/WebDataBinder.html`
- Spring Boot Reference — Externalized Configuration: `https://docs.spring.io/spring-boot/reference/features/external-config.html`
- Spring Boot Reference — Properties and Configuration: `https://docs.spring.io/spring-boot/how-to/properties-and-configuration.html`

---

## 52. Latihan

### Latihan 1 — DTO Boundary Audit

Ambil satu endpoint write di aplikasi Spring. Jawab:

```text
apakah endpoint menerima entity?
field mana yang client boleh kontrol?
field mana yang harus server tentukan?
apakah request DTO berbeda dari response DTO?
apakah validation cukup untuk shape input?
apakah business invariant ada di service/domain?
```

### Latihan 2 — Error Contract

Desain error response untuk:

```text
malformed JSON
missing required field
invalid enum
invalid date range
business rule: case cannot be appealed
authorization denied
duplicate email
```

Pisahkan status code, error code, message, field path, dan trace id.

### Latihan 3 — Converter Design

Buat `Converter<String, CaseId>` yang:

1. trim input;
2. reject blank;
3. validate pattern `CASE-[0-9]{6}`;
4. tidak melakukan database lookup;
5. punya unit test.

### Latihan 4 — Config Validation

Buat `@ConfigurationProperties` untuk external API client:

```text
base-url
connect-timeout
read-timeout
max-retry
rate-limit-per-minute
enabled
```

Tambahkan validation agar aplikasi fail-fast jika config tidak aman.

---

## 53. Penutup Part 16

Setelah bagian ini, kita sudah punya fondasi untuk memahami bahwa input handling di Spring bukan sekadar `@Valid`, tetapi gabungan conversion, binding, validation, mapping, dan invariant enforcement.

Bagian berikutnya akan melanjutkan ke:

```text
17-error-handling-problem-details-failure-semantics.md
```

Di sana kita akan membangun model error yang lebih lengkap: bagaimana membedakan validation error, domain error, conflict, authorization failure, integration failure, retryable error, dan bagaimana memetakannya ke HTTP Problem Details serta observability produksi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./15-spring-http-clients-restclient-webclient-http-interface.md">⬅️ Part 15 — Spring HTTP Clients: RestTemplate, RestClient, WebClient, and HTTP Interface</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./17-error-handling-problem-details-failure-semantics.md">Error Handling, Problem Details, and Failure Semantics ➡️</a>
</div>

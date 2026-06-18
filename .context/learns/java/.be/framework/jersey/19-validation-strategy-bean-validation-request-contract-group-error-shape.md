# Part 19 — Validation Strategy: Bean Validation, Request Contract, Group, and Error Shape

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Previous: Part 18 — Security Integration  
Next: Part 20 — API Versioning and Compatibility with Jersey

---

## 0. Posisi Materi Ini dalam Series

Di part sebelumnya kita membahas security integration: bagaimana request membawa identity, principal, role, tenant context, authorization decision, dan audit-safe security failure.

Part ini membahas lapisan yang sering terlihat sederhana tetapi sangat menentukan kualitas API production: **validation strategy**.

Di Jersey/Jakarta REST, validation bukan sekadar menaruh annotation seperti `@NotNull`, `@Size`, atau `@Valid`. Validation adalah mekanisme untuk menjaga agar **kontrak request**, **aturan domain**, **aturan workflow**, dan **constraint persistence** tidak tercampur secara kacau.

Engineer yang hanya tahu annotation biasanya akan membuat API yang tampak berjalan, tetapi rapuh ketika:

- create dan update butuh aturan berbeda;
- PATCH hanya mengirim sebagian field;
- role tertentu boleh melewati constraint tertentu;
- field wajib secara UI tetapi tidak wajib secara API;
- domain invariant lebih kompleks daripada DTO shape;
- error response perlu stabil untuk frontend, external client, audit, dan support;
- constraint message mengandung informasi internal;
- validasi dilakukan setelah transaction terbuka;
- object graph terlalu dalam dan menyebabkan performa buruk;
- validation group dipakai sebagai conditional logic yang sulit dipahami.

Target part ini: kamu bisa menempatkan validation sebagai **boundary architecture**, bukan dekorasi annotation.

---

## 1. Mental Model: Validation Itu Bukan Satu Lapisan

Kesalahan besar yang umum terjadi adalah menganggap semua aturan validasi sama.

Dalam sistem production, biasanya ada beberapa jenis aturan:

```text
HTTP request shape validation
  ↓
API contract validation
  ↓
Authorization-sensitive validation
  ↓
Workflow/state validation
  ↓
Domain invariant validation
  ↓
Persistence constraint
  ↓
External system constraint
```

Masing-masing punya tujuan, timing, dan error shape berbeda.

### 1.1 Request Shape Validation

Ini menjawab pertanyaan:

> Apakah payload bisa dipahami sebagai request yang valid secara struktur?

Contoh:

- body JSON valid atau tidak;
- field `email` bertipe string atau bukan;
- `amount` bisa di-bind ke `BigDecimal` atau tidak;
- query param `page` bisa dikonversi ke integer atau tidak;
- enum value dikenal atau tidak.

Di Jersey, sebagian error ini terjadi sebelum Bean Validation:

```text
raw HTTP body
  → MessageBodyReader
  → JSON provider / XML provider
  → DTO instance
  → Bean Validation
```

Kalau JSON tidak bisa dibaca, Bean Validation belum berjalan.

### 1.2 API Contract Validation

Ini menjawab:

> Apakah request memenuhi kontrak endpoint ini?

Contoh:

```java
public record CreateUserRequest(
    @NotBlank String username,
    @Email @NotBlank String email,
    @Size(min = 8, max = 128) String password
) {}
```

Aturan ini milik API boundary. Ia belum tentu sama dengan domain invariant.

### 1.3 Authorization-Sensitive Validation

Kadang validasi tergantung siapa pemanggilnya.

Contoh:

- admin boleh mengisi `manualOverrideReason`;
- public user tidak boleh mengisi `status`;
- officer boleh submit field tambahan;
- supervisor wajib mengisi approval reason;
- tenant A tidak boleh refer ke entity tenant B.

Ini tidak cocok jika dipaksakan seluruhnya ke Bean Validation annotation statis. Biasanya butuh service validation atau policy validation setelah identity diketahui.

### 1.4 Workflow/State Validation

Ini menjawab:

> Apakah operasi ini legal terhadap state entity saat ini?

Contoh:

```text
DRAFT → SUBMITTED: allowed
APPROVED → SUBMITTED: invalid
CLOSED → UPDATED: invalid
PENDING_REVIEW → APPROVED: only supervisor
```

Ini bukan sekadar DTO validation. Ini adalah state transition invariant.

### 1.5 Domain Invariant Validation

Domain invariant menjawab:

> Apakah model bisnis tetap benar jika operasi diterapkan?

Contoh:

- total allocation tidak boleh melebihi budget;
- end date harus setelah start date;
- appeal hanya boleh dibuat untuk decision yang appealable;
- case closure wajib punya final outcome;
- satu license tidak boleh punya dua active renewal process.

Sebagian bisa memakai Bean Validation, tetapi banyak yang membutuhkan database lookup, state machine, rule engine, atau domain service.

### 1.6 Persistence Constraint

Database constraint adalah lapisan pertahanan terakhir, bukan satu-satunya validation.

Contoh:

- `NOT NULL`;
- unique index;
- foreign key;
- check constraint;
- optimistic locking;
- trigger.

Persistence constraint bagus untuk integrity, tetapi error-nya tidak selalu bagus untuk API client. Jadi API boundary tetap perlu menerjemahkan kegagalan constraint menjadi error contract yang konsisten.

---

## 2. Bagaimana Jersey Terhubung dengan Jakarta Validation

Jersey mendukung Bean Validation melalui modul integration seperti `jersey-bean-validation`. Dengan modul ini, Jersey bisa melakukan validasi terhadap:

- entity/body object;
- parameter resource method;
- bean parameter;
- return value;
- nested object dengan `@Valid`;
- constraint pada resource method.

Jakarta Validation sendiri menyediakan model annotation-based untuk object, method, constructor, custom constraint, validation group, dan violation reporting. Specification-nya mendukung object graph validation, method validation, dan localized violation messages.

Secara runtime, alurnya kurang lebih seperti ini:

```text
HTTP request
  ↓
Jersey request matching
  ↓
parameter extraction/conversion
  ↓
entity read via MessageBodyReader
  ↓
Bean Validation integration
  ↓
resource method invocation
  ↓
return value validation, if enabled/applicable
  ↓
MessageBodyWriter
  ↓
HTTP response
```

Important distinction:

```text
Parsing/conversion error ≠ validation error
```

Contoh:

```http
GET /cases?page=abc
```

Kalau `page` ditargetkan ke `int`, error bisa terjadi di parameter conversion, bukan Bean Validation.

Contoh lain:

```json
{
  "amount": "not-a-number"
}
```

Kalau DTO punya `BigDecimal amount`, JSON provider gagal membuat DTO sebelum `@DecimalMin` pernah dievaluasi.

---

## 3. Dependency dan Namespace: Java 8 sampai Java 25

Kita harus selalu sadar generasi namespace.

### 3.1 Jersey 2.x / Java EE style

Umumnya memakai:

```java
javax.ws.rs.*
javax.validation.*
```

Cocok untuk legacy Java 8/11 estate.

Contoh dependency konseptual:

```xml
<dependency>
  <groupId>org.glassfish.jersey.ext</groupId>
  <artifactId>jersey-bean-validation</artifactId>
  <version>${jersey.version}</version>
</dependency>
```

Pada Jersey 2.x, package API REST masih `javax.ws.rs`.

### 3.2 Jersey 3.x / Jakarta EE 9/10 style

Umumnya memakai:

```java
jakarta.ws.rs.*
jakarta.validation.*
```

Ini fase penting untuk aplikasi Jakarta modern.

### 3.3 Jersey 4.x / Jakarta EE 11 style

Jakarta REST 4.0 berada pada Jakarta EE 11 dan baseline Java SE 17. Jakarta Validation 3.1 juga menaikkan minimum Java version ke 17 dan menjadi bagian dari Jakarta EE 11 wave.

Implikasinya:

```text
Java 8 compatibility → Jersey 2.x / javax world
Java 17+ Jakarta EE 11 → Jersey 4.x / jakarta world
Java 21/25 → modern runtime, tapi tetap tergantung compatibility container/framework
```

Jangan mencampur:

```text
javax.validation.Valid
jakarta.ws.rs.POST
```

atau:

```text
jakarta.validation.NotNull
javax.ws.rs.Path
```

Campuran namespace seperti ini sering menghasilkan:

- validation tidak jalan;
- provider tidak ditemukan;
- annotation tidak dikenali;
- classpath conflict;
- `ClassNotFoundException`;
- `NoSuchMethodError`;
- perilaku berbeda antar environment.

---

## 4. Minimal Example: Entity Validation di Resource Method

Contoh Jakarta namespace:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

@Path("/users")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class UserResource {

    private final UserApplicationService users;

    public UserResource(UserApplicationService users) {
        this.users = users;
    }

    @POST
    public Response create(@Valid CreateUserRequest request) {
        UserId id = users.create(request);
        return Response.status(Response.Status.CREATED)
            .entity(new CreateUserResponse(id.value()))
            .build();
    }

    public record CreateUserRequest(
        @NotBlank @Size(max = 80) String username,
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(min = 8, max = 128) String password
    ) {}

    public record CreateUserResponse(String id) {}
}
```

Mental model:

```text
JSON payload
  → CreateUserRequest instance
  → validate object because parameter has @Valid
  → if valid: call users.create(...)
  → if invalid: throw validation exception / map to response
```

Tanpa `@Valid`, nested bean validation pada body object sering tidak berjalan sesuai ekspektasi. Annotation constraint langsung pada parameter dan nested object perlu dipahami berbeda.

---

## 5. Parameter Validation: Query, Path, Header, BeanParam

Validation juga bisa diterapkan ke parameter resource method.

```java
@GET
@Path("/{caseId}")
public CaseResponse getCase(
    @PathParam("caseId") @NotBlank String caseId,
    @QueryParam("includeHistory") @DefaultValue("false") boolean includeHistory,
    @HeaderParam("X-Correlation-ID") @Size(max = 128) String correlationId
) {
    return service.getCase(caseId, includeHistory, correlationId);
}
```

Namun ada beberapa jebakan.

### 5.1 `@NotNull` pada Primitive Tidak Berguna

```java
@QueryParam("page") @Min(1) int page
```

Jika query param tidak ada, primitive `int` menjadi `0`, lalu `@Min(1)` akan gagal.

Ini bisa saja disengaja. Tapi jika kamu ingin membedakan:

```text
absent
present but invalid
present but below minimum
```

lebih baik gunakan wrapper:

```java
@QueryParam("page") @Min(1) Integer page
```

Lalu tentukan default secara eksplisit di layer request normalization.

### 5.2 `@DefaultValue` Mengubah Semantik Absent

```java
@QueryParam("page") @DefaultValue("1") @Min(1) int page
```

Artinya:

```text
?page absent → page = 1
?page=0 → validation fails
?page=abc → conversion fails
```

Ini bagus jika kontrak API memang menyatakan default page adalah 1.

Tetapi jangan pakai default untuk menyembunyikan required field.

Buruk:

```java
@QueryParam("status") @DefaultValue("DRAFT") Status status
```

Kalau `status` secara bisnis wajib dipilih user, default diam-diam bisa menciptakan data salah.

---

## 6. `@BeanParam` sebagai Request Contract Object

Untuk endpoint dengan banyak query/header/path parameter, gunakan parameter object.

```java
public class CaseSearchParams {

    @QueryParam("q")
    @Size(max = 200)
    private String query;

    @QueryParam("status")
    private List<String> statuses;

    @QueryParam("page")
    @DefaultValue("1")
    @Min(1)
    private int page;

    @QueryParam("size")
    @DefaultValue("20")
    @Min(1)
    @Max(100)
    private int size;

    @HeaderParam("X-Correlation-ID")
    @Size(max = 128)
    private String correlationId;

    public String query() { return query; }
    public List<String> statuses() { return statuses == null ? List.of() : statuses; }
    public int page() { return page; }
    public int size() { return size; }
    public String correlationId() { return correlationId; }
}
```

Resource:

```java
@GET
public SearchResult search(@Valid @BeanParam CaseSearchParams params) {
    return service.search(params);
}
```

Kenapa ini bagus?

Karena resource method tidak menjadi signature panjang:

```java
public SearchResult search(String q, List<String> statuses, int page, int size, ...)
```

Dan kita punya object yang bisa menjadi API boundary eksplisit.

Namun hati-hati: jangan biarkan `BeanParam` menjadi domain object. Ia tetap request adapter object.

---

## 7. Nested Validation dan Object Graph

Jika request punya nested object, gunakan `@Valid` pada field nested.

```java
public record CreateApplicationRequest(
    @NotBlank String applicantName,
    @Valid @NotNull AddressRequest address,
    @Valid List<DocumentRequest> documents
) {}

public record AddressRequest(
    @NotBlank String postalCode,
    @NotBlank String block,
    @Size(max = 120) String street
) {}

public record DocumentRequest(
    @NotBlank String type,
    @NotBlank String fileId
) {}
```

Tanpa `@Valid` pada `address` atau `documents`, constraint di dalam nested object bisa tidak dievaluasi.

Mental model:

```text
Constraint pada field parent mengecek field parent.
@Valid membuka traversal ke object child.
```

### 7.1 Jangan Validasi Object Graph Tanpa Batas

Untuk DTO request, object graph harus dangkal dan terkontrol.

Buruk:

```text
ApplicationRequest
  → Applicant
    → Company
      → Directors
        → Addresses
          → Country
            → ...
```

Risiko:

- performa buruk;
- error path sulit dipahami;
- infinite/cyclic traversal jika model salah;
- request contract terlalu besar;
- domain model bocor ke API.

DTO request sebaiknya memiliki shape yang memang didesain untuk endpoint.

---

## 8. Validation Group: Powerful, But Easy to Abuse

Validation group memungkinkan constraint aktif hanya pada konteks tertentu.

Contoh:

```java
public interface CreateGroup {}
public interface UpdateGroup {}
public interface SubmitGroup {}
```

DTO:

```java
public class ApplicationRequest {

    @NotBlank(groups = CreateGroup.class)
    private String applicantName;

    @NotBlank(groups = SubmitGroup.class)
    private String declarationAcceptedBy;

    @Size(max = 200, groups = {CreateGroup.class, UpdateGroup.class})
    private String remarks;
}
```

Secara konseptual:

```text
CreateGroup → constraint untuk create
UpdateGroup → constraint untuk update
SubmitGroup → constraint untuk transition submit
```

### 8.1 Problem: Bagaimana Jersey Memilih Group?

Default Bean Validation memakai `Default` group.

Untuk resource method, kalau kamu hanya memakai:

```java
public Response create(@Valid ApplicationRequest request)
```

maka yang berjalan biasanya `Default` group, bukan otomatis `CreateGroup`.

Ada beberapa strategi:

1. Gunakan DTO berbeda per operation.
2. Gunakan service-level validator manual dengan group tertentu.
3. Gunakan custom annotation/interceptor jika benar-benar perlu otomatisasi.
4. Hindari group jika hanya dua endpoint sederhana.

### 8.2 Strategi yang Biasanya Lebih Bersih: DTO per Operation

```java
public record CreateApplicationRequest(
    @NotBlank String applicantName,
    @Size(max = 200) String remarks
) {}

public record SubmitApplicationRequest(
    @NotBlank String declarationAcceptedBy,
    @AssertTrue Boolean acceptedTerms
) {}
```

Kelebihan:

- kontrak endpoint eksplisit;
- OpenAPI lebih jelas;
- error lebih mudah dipahami;
- tidak perlu group kompleks;
- lebih mudah evolution/versioning.

Kekurangan:

- ada duplikasi field;
- mapping lebih banyak.

Untuk API enterprise, duplikasi DTO sering lebih murah daripada validasi group yang terlalu abstrak.

### 8.3 Kapan Group Masuk Akal

Validation group masuk akal jika:

- object contract memang sama tetapi mode validasi berbeda;
- banyak field sama antara create/update/submit;
- ada framework internal yang konsisten memilih group;
- team memahami group sequence;
- dokumentasi jelas.

Group tidak cocok jika:

- group dipakai untuk menyembunyikan business workflow;
- constraint menjadi sulit dilacak;
- satu DTO dipakai untuk semua endpoint;
- developer harus membaca 7 interface group untuk memahami required field.

---

## 9. Partial Update dan PATCH: Validasi Paling Mudah Salah

PATCH adalah area yang sering membuat validasi kacau.

Contoh request:

```json
{
  "email": "new@example.com"
}
```

Kalau kamu memakai DTO yang sama dengan create:

```java
public record UserRequest(
    @NotBlank String username,
    @Email @NotBlank String email
) {}
```

maka PATCH email akan gagal karena `username` tidak dikirim.

### 9.1 Jangan Pakai Create DTO untuk PATCH

Gunakan DTO khusus:

```java
public record PatchUserRequest(
    OptionalField<String> username,
    OptionalField<String> email
) {}
```

Atau secara lebih sederhana:

```java
public class PatchUserRequest {
    private String username;
    private String email;

    public boolean hasUsername() { ... }
    public boolean hasEmail() { ... }
}
```

Masalah utama PATCH:

```text
absent ≠ present null ≠ present invalid value
```

JSON biasa ke POJO sering kehilangan informasi ini kecuali kamu mendesainnya secara eksplisit.

### 9.2 PATCH Validation Pattern

Alur yang lebih sehat:

```text
1. Parse patch request
2. Deteksi field yang hadir
3. Validasi hanya field yang hadir
4. Load existing aggregate
5. Apply patch command
6. Validasi domain invariant setelah patch
7. Persist
```

Jangan hanya mengandalkan annotation DTO.

### 9.3 Merge Patch vs JSON Patch

Dua model umum:

```text
JSON Merge Patch
  - object partial
  - null sering berarti remove/set null
  - mudah dibaca
  - sulit untuk array operation detail

JSON Patch
  - operasi eksplisit: add, remove, replace
  - lebih presisi
  - lebih sulit dipakai client
```

Jersey bisa menerima payload tersebut sebagai JSON biasa, tetapi strategi validasinya harus kamu desain sendiri.

---

## 10. Cross-Field Validation

Banyak aturan tidak bisa divalidasi satu field saja.

Contoh:

```text
startDate harus sebelum endDate
kalau status REJECTED, rejectionReason wajib
kalau applicantType COMPANY, companyUen wajib
kalau deliveryMode EMAIL, email wajib
```

### 10.1 Class-Level Constraint

Annotation:

```java
@ValidDateRange
public record SearchWindowRequest(
    LocalDate startDate,
    LocalDate endDate
) {}
```

Constraint:

```java
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = DateRangeValidator.class)
public @interface ValidDateRange {
    String message() default "startDate must be before or equal to endDate";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class DateRangeValidator implements ConstraintValidator<ValidDateRange, SearchWindowRequest> {

    @Override
    public boolean isValid(SearchWindowRequest value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        if (value.startDate() == null || value.endDate() == null) {
            return true; // let @NotNull handle requiredness
        }
        return !value.startDate().isAfter(value.endDate());
    }
}
```

Prinsip penting:

```text
Satu validator sebaiknya fokus pada satu invariant.
Jangan buat validator yang menjadi mini service layer.
```

### 10.2 Better Error Path untuk Cross-Field

Secara default, class-level violation bisa muncul di object root. Untuk client, lebih bagus jika diarahkan ke field tertentu.

```java
@Override
public boolean isValid(SearchWindowRequest value, ConstraintValidatorContext context) {
    if (value == null || value.startDate() == null || value.endDate() == null) {
        return true;
    }

    if (!value.startDate().isAfter(value.endDate())) {
        return true;
    }

    context.disableDefaultConstraintViolation();
    context.buildConstraintViolationWithTemplate("must be after or equal to startDate")
        .addPropertyNode("endDate")
        .addConstraintViolation();
    return false;
}
```

Ini membuat error lebih actionable:

```json
{
  "field": "endDate",
  "message": "must be after or equal to startDate"
}
```

---

## 11. Custom Constraint: Kapan Dipakai dan Kapan Tidak

Custom constraint cocok untuk aturan yang:

- reusable;
- pure/in-memory;
- tidak butuh database call berat;
- tidak tergantung identity/request context kompleks;
- bisa dijelaskan sebagai constraint data.

Contoh bagus:

```text
@PostalCode
@UenFormat
@ValidDateRange
@NoControlCharacters
@SafeFilename
@AllowedSortField
```

Contoh kurang cocok:

```text
@UserHasPermissionToApprove
@ApplicationCanTransitionToSubmitted
@EmailMustBeUniqueInDatabase
@CaseBelongsToTenant
```

Kenapa kurang cocok?

Karena aturan seperti itu biasanya membutuhkan:

- current authenticated user;
- database query;
- state machine;
- tenant policy;
- external system;
- transaction context;
- audit reason.

Lebih baik ditempatkan di application service/domain service.

---

## 12. Validation Sebelum atau Sesudah Authorization?

Ini bukan pertanyaan sepele.

Ada trade-off security.

### 12.1 Validate Before Authorization

Kelebihan:

- request buruk ditolak cepat;
- resource/service tidak menerima data invalid;
- error 400 muncul sebelum 403.

Risiko:

- attacker bisa mendapat informasi tentang shape resource yang sebenarnya tidak boleh diakses;
- validasi bisa melakukan lookup sebelum identity dicek;
- error field bisa membocorkan existence rule.

### 12.2 Authorization Before Validation

Kelebihan:

- tidak membocorkan detail resource ke caller unauthorized;
- cocok untuk object-level authorization;
- lebih aman untuk endpoint sensitif.

Risiko:

- perlu parse minimal request dulu;
- kalau authorization butuh field dari body, body harus bisa dibaca;
- error 403 bisa menutupi request yang invalid.

### 12.3 Practical Rule

Untuk production:

```text
1. Parsing minimal harus terjadi dulu.
2. Authentication harus terjadi sangat awal.
3. Coarse authorization bisa terjadi sebelum deep validation.
4. Shape validation aman bisa terjadi sebelum load entity.
5. Object-level authorization biasanya setelah load target entity.
6. Domain validation setelah authorization dan state load.
```

Contoh flow:

```text
Request arrives
  ↓
Correlation ID
  ↓
Authentication
  ↓
Basic content-type/body parse
  ↓
Coarse role check
  ↓
DTO validation
  ↓
Load aggregate
  ↓
Object-level authorization
  ↓
Workflow/domain validation
  ↓
Execute command
```

---

## 13. Validation Sebelum atau Sesudah Transaction?

General rule:

```text
Jangan buka transaction untuk validasi yang tidak butuh transaction.
```

Lebih baik:

```text
DTO validation
  → authorization
  → load required state in transaction or read-only operation
  → domain validation
  → mutate/persist
```

Namun domain validation sering butuh data dari database.

Contoh:

```text
submit application
  - application exists
  - user can access application
  - application state is DRAFT
  - required documents uploaded
  - declaration accepted
```

Sebagian membutuhkan database.

Pattern:

```java
public SubmitResult submit(SubmitApplicationCommand command) {
    // request-level validation already done by Jersey/Bean Validation

    return transaction.execute(() -> {
        Application app = repository.getForUpdate(command.applicationId());

        authorization.checkCanSubmit(command.actor(), app);
        app.submit(command.declaration(), command.now());

        repository.save(app);
        audit.record(...);

        return SubmitResult.of(app.id());
    });
}
```

Domain object `app.submit(...)` tetap menjaga invariant.

---

## 14. Error Shape: Jangan Biarkan Default Menjadi Public Contract

Jersey/Bean Validation bisa memberi default error response. Tetapi untuk enterprise API, kamu biasanya butuh error contract sendiri.

Target error response:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "correlationId": "c-123",
  "violations": [
    {
      "field": "email",
      "code": "INVALID_EMAIL",
      "message": "must be a well-formed email address"
    },
    {
      "field": "password",
      "code": "TOO_SHORT",
      "message": "size must be between 8 and 128"
    }
  ]
}
```

### 14.1 RFC 7807 / Problem Details Style

Problem Details style membantu menormalisasi error:

```text
type    → category URI/string
title   → human-readable summary
status  → HTTP status
code    → stable machine code
instance/correlationId → traceability
extra fields → violations, details, etc.
```

Tidak wajib persis RFC 7807, tetapi style-nya bagus untuk konsistensi.

### 14.2 Field Error Harus Stabil

Jangan mengembalikan path internal yang berubah-ubah:

```text
create.arg0.address.postalCode
```

Untuk client, lebih baik:

```text
address.postalCode
```

Untuk query parameter:

```text
page
size
sort
```

Untuk header:

```text
header.X-Correlation-ID
```

Untuk path param:

```text
path.caseId
```

Buat normalizer.

---

## 15. ExceptionMapper untuk ConstraintViolationException

Contoh mapper konseptual:

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

import java.util.Comparator;
import java.util.List;

@Provider
public class ConstraintViolationExceptionMapper
    implements ExceptionMapper<ConstraintViolationException> {

    @Context
    RequestCorrelation correlation;

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        List<ViolationResponse> violations = exception.getConstraintViolations().stream()
            .map(this::toViolation)
            .sorted(Comparator.comparing(ViolationResponse::field))
            .toList();

        ProblemResponse body = new ProblemResponse(
            "https://api.example.com/problems/validation-error",
            "Validation failed",
            400,
            "VALIDATION_FAILED",
            correlation.id(),
            violations
        );

        return Response.status(Response.Status.BAD_REQUEST)
            .type(MediaType.APPLICATION_JSON_TYPE)
            .entity(body)
            .build();
    }

    private ViolationResponse toViolation(ConstraintViolation<?> violation) {
        String field = normalizePath(violation);
        String code = toStableCode(violation);
        String message = safeMessage(violation);
        Object rejectedValue = safeRejectedValue(violation.getInvalidValue());

        return new ViolationResponse(field, code, message, rejectedValue);
    }

    private String normalizePath(ConstraintViolation<?> violation) {
        // Implementation should map method/path internals to public field path.
        return ViolationPathNormalizer.normalize(violation.getPropertyPath());
    }

    private String toStableCode(ConstraintViolation<?> violation) {
        String annotation = violation.getConstraintDescriptor()
            .getAnnotation()
            .annotationType()
            .getSimpleName();

        return switch (annotation) {
            case "NotNull" -> "REQUIRED";
            case "NotBlank" -> "REQUIRED";
            case "Email" -> "INVALID_EMAIL";
            case "Size" -> "INVALID_SIZE";
            case "Min" -> "TOO_SMALL";
            case "Max" -> "TOO_LARGE";
            case "Pattern" -> "INVALID_FORMAT";
            default -> "INVALID_VALUE";
        };
    }

    private String safeMessage(ConstraintViolation<?> violation) {
        return violation.getMessage();
    }

    private Object safeRejectedValue(Object invalidValue) {
        if (invalidValue == null) {
            return null;
        }
        if (invalidValue instanceof CharSequence s) {
            return s.length() <= 128 ? s.toString() : "<too-long>";
        }
        if (invalidValue instanceof Number || invalidValue instanceof Boolean) {
            return invalidValue;
        }
        return "<redacted>";
    }

    public record ProblemResponse(
        String type,
        String title,
        int status,
        String code,
        String correlationId,
        List<ViolationResponse> violations
    ) {}

    public record ViolationResponse(
        String field,
        String code,
        String message,
        Object rejectedValue
    ) {}
}
```

Catatan penting:

```text
Jangan selalu mengembalikan invalidValue mentah.
```

Karena invalid value bisa mengandung:

- password;
- token;
- NRIC/NIK/passport;
- secret;
- payload besar;
- object internal;
- PII.

Untuk external API, sering lebih aman tidak mengembalikan `rejectedValue` sama sekali.

---

## 16. Path Normalization untuk ConstraintViolation

Constraint violation path bisa berbeda tergantung apakah pelanggaran berasal dari:

- field DTO;
- method parameter;
- return value;
- nested object;
- collection element;
- bean param;
- constructor parameter;
- class-level constraint.

Contoh internal path:

```text
create.arg0.email
create.request.email
search.arg0.page
submit.<cross-parameter>
```

Public API sebaiknya menampilkan:

```text
email
page
address.postalCode
documents[0].fileId
```

Pseudo normalizer:

```java
public final class ViolationPathNormalizer {

    private ViolationPathNormalizer() {}

    public static String normalize(jakarta.validation.Path path) {
        String raw = path.toString();

        // Remove common method prefixes.
        raw = raw.replaceFirst("^[a-zA-Z0-9_]+\\.arg[0-9]+\\.", "");
        raw = raw.replaceFirst("^[a-zA-Z0-9_]+\\.", "");

        // Normalize known parameter aliases if needed.
        raw = raw.replace("<return value>", "response");
        raw = raw.replace("<cross-parameter>", "request");

        return raw.isBlank() ? "request" : raw;
    }
}
```

Untuk production, normalizer perlu dites dengan banyak kasus.

---

## 17. Return Value Validation: Berguna tapi Harus Hati-Hati

Bean Validation juga bisa diterapkan ke return value.

```java
@GET
@Path("/{id}")
@NotNull
public CaseResponse get(@PathParam("id") String id) {
    return service.get(id);
}
```

Atau:

```java
@GET
@Valid
public CaseResponse getCase() {
    return service.getCase();
}
```

Secara teori bagus karena memastikan response juga valid.

Namun di production, return value validation punya trade-off:

Kelebihan:

- menangkap bug internal sebelum response dikirim;
- melindungi API contract;
- berguna untuk test/staging;
- membantu detect mapper bug.

Risiko:

- error terjadi setelah business logic sukses;
- kalau transaction sudah commit, response gagal tetapi state berubah;
- bisa mahal untuk response besar;
- bisa membocorkan bug internal sebagai validation error;
- bisa membingungkan client.

Rekomendasi:

```text
Gunakan return value validation secara selektif.
Untuk public API, response contract lebih baik dijaga oleh test contract, mapper discipline, dan type design.
```

---

## 18. Fail-Fast vs Aggregate Errors

Ada dua pendekatan:

### 18.1 Fail-Fast

Berhenti di violation pertama.

Kelebihan:

- lebih cepat;
- lebih sederhana;
- bagus untuk rule mahal;
- cocok untuk internal command pipeline.

Kekurangan:

- UX buruk untuk form besar;
- client harus submit berkali-kali.

### 18.2 Aggregate Errors

Kumpulkan semua violation.

Kelebihan:

- UX bagus;
- frontend bisa menampilkan semua field error;
- cocok untuk request DTO.

Kekurangan:

- lebih mahal;
- harus hati-hati jika rule membutuhkan database;
- error ordering harus stabil.

Practical rule:

```text
Request field validation → aggregate
Security/authorization → fail fast
Workflow transition → fail fast or domain-specific aggregate
Domain batch validation → depends on use case
```

---

## 19. Internationalization dan Message Strategy

Bean Validation mendukung message interpolation.

Contoh:

```java
@NotBlank(message = "{user.email.required}")
@Email(message = "{user.email.invalid}")
private String email;
```

Message bundle:

```properties
user.email.required=Email is required
user.email.invalid=Email must be valid
```

Namun untuk API enterprise, jangan jadikan human message sebagai satu-satunya contract.

Lebih stabil:

```json
{
  "field": "email",
  "code": "INVALID_EMAIL",
  "message": "Email must be valid"
}
```

`code` dipakai mesin/frontend logic.  
`message` bisa dilokalisasi/diubah.

### 19.1 Jangan Taruh Rule Detail Sensitif di Message

Buruk:

```text
email already exists in table USER_ACCOUNT_TENANT_42
```

Lebih aman:

```text
email is already in use
```

Atau untuk mencegah account enumeration:

```text
request cannot be processed
```

Tergantung threat model.

---

## 20. Validation dan Security: Sensitive Fields

Beberapa field tidak boleh muncul di log/error:

- password;
- access token;
- refresh token;
- OTP;
- secret key;
- NRIC/NIK/passport;
- bank account;
- birth date dalam konteks tertentu;
- medical information;
- private notes.

Buat mekanisme redaction.

Contoh annotation internal:

```java
@Target({ElementType.FIELD, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface Sensitive {}
```

DTO:

```java
public record LoginRequest(
    @NotBlank String username,
    @Sensitive @NotBlank String password
) {}
```

Error mapper/logging filter bisa memakai metadata untuk masking.

Namun jangan terlalu bergantung pada reflection annotation saja. Untuk sistem kritikal, pakai allowlist field yang boleh keluar.

---

## 21. Validation dengan Records, Sealed Types, dan Java Modern

### 21.1 Java Records

Records cocok untuk DTO immutable.

```java
public record CreateCaseRequest(
    @NotBlank String title,
    @Size(max = 2000) String description
) {}
```

Jakarta Validation 3.1 mengklarifikasi record validation, dan modern provider seperti Hibernate Validator mendukung penggunaan constraint pada record component.

Kelebihan:

- immutable;
- ringkas;
- cocok untuk request/response DTO;
- tidak perlu setter;
- constructor canonical jelas.

Perhatian:

- JSON provider harus mendukung records;
- Java 8 tidak bisa memakai records;
- untuk Jersey 2.x/Java 8, gunakan POJO biasa.

### 21.2 Sealed Types

Sealed types bisa berguna untuk command variants.

```java
public sealed interface CaseActionRequest permits ApproveRequest, RejectRequest {}

public record ApproveRequest(@NotBlank String approvalNote) implements CaseActionRequest {}

public record RejectRequest(@NotBlank String rejectionReason) implements CaseActionRequest {}
```

Namun polymorphic JSON binding perlu sangat hati-hati. Jangan aktifkan polymorphic deserialization secara sembarangan.

Untuk public API, sering lebih aman:

```json
{
  "action": "REJECT",
  "rejectionReason": "..."
}
```

lalu mapping eksplisit ke command.

---

## 22. Validasi Enum dan Evolusi API

Enum tampak mudah tetapi berisiko untuk compatibility.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Jika client mengirim unknown enum:

```json
{"status":"ARCHIVED"}
```

error bisa terjadi saat JSON deserialization, bukan Bean Validation.

Pertimbangkan apakah request DTO sebaiknya menerima `String` lalu divalidasi sendiri:

```java
public record SearchRequest(
    @AllowedValues({"DRAFT", "SUBMITTED", "APPROVED", "REJECTED"})
    String status
) {}
```

Kelebihan:

- error message lebih terkontrol;
- unknown value bisa dikembalikan sebagai validation error normal;
- compatibility lebih mudah;
- bisa membedakan deprecated value.

Kekurangan:

- type safety berkurang di boundary;
- perlu mapping eksplisit ke enum internal.

Untuk external API yang butuh error contract stabil, string + explicit mapping sering lebih defensible.

---

## 23. Validasi Sort, Filter, dan Search Endpoint

Search endpoint sering terlihat tidak berbahaya tetapi rentan:

```http
GET /cases?sort=createdAt,desc&filter=status:APPROVED&page=1&size=20
```

Validasi penting:

- `page >= 1`;
- `size <= max`;
- sort field harus allowlist;
- sort direction hanya `asc/desc`;
- filter field allowlist;
- operator allowlist;
- date range dibatasi;
- query length dibatasi;
- wildcard/regex dibatasi;
- kombinasi filter tidak membuat query explosion;
- tenant constraint selalu dipaksa server-side, bukan dari request.

Contoh:

```java
public record SearchCasesRequest(
    @Min(1) int page,
    @Min(1) @Max(100) int size,
    @AllowedSortFields({"createdAt", "updatedAt", "status", "referenceNo"})
    String sort,
    @Size(max = 200) String q
) {}
```

Jangan langsung masukkan sort field dari client ke SQL/JPQL.

Buruk:

```java
String sql = "select * from cases order by " + request.sort();
```

Baik:

```java
Sort sort = SortParser.parse(request.sort(), Map.of(
    "createdAt", "c.created_at",
    "updatedAt", "c.updated_at",
    "status", "c.status",
    "referenceNo", "c.reference_no"
));
```

---

## 24. Validasi File Upload

Untuk multipart/upload, Bean Validation hanya sebagian kecil.

Validasi file perlu mencakup:

- field metadata;
- file presence;
- size limit;
- MIME type claim;
- magic bytes;
- extension allowlist;
- filename sanitization;
- hash;
- malware scan;
- zip bomb detection;
- duplicate detection;
- storage quota;
- tenant ownership;
- document type policy;
- retention classification.

DTO metadata bisa divalidasi Bean Validation:

```java
public record UploadDocumentMetadata(
    @NotBlank String documentType,
    @Size(max = 200) String remarks
) {}
```

Tetapi stream file harus divalidasi dengan pipeline khusus.

---

## 25. Bean Validation vs Domain Validation

Perbedaan penting:

```text
Bean Validation:
  - object shape
  - local constraints
  - mostly deterministic
  - useful at API boundary

Domain Validation:
  - business invariants
  - stateful
  - context-aware
  - often needs repository/current actor/current time
```

Contoh jangan dipaksakan ke Bean Validation:

```java
@ApplicationCanBeSubmitted
public record SubmitApplicationRequest(...) {}
```

Lebih baik:

```java
public void submit(SubmitApplicationCommand command) {
    Application app = repository.getForUpdate(command.applicationId());
    policy.ensureCanSubmit(command.actor(), app);
    app.submit(command.now(), command.declaration());
}
```

Domain object:

```java
public void submit(Instant now, Declaration declaration) {
    if (status != Status.DRAFT) {
        throw new InvalidStateTransitionException(status, Status.SUBMITTED);
    }
    if (!documents.hasRequiredDocuments()) {
        throw new MissingRequiredDocumentsException(id);
    }
    this.status = Status.SUBMITTED;
    this.submittedAt = now;
}
```

---

## 26. Validation dan Idempotency

Untuk command endpoint:

```http
POST /payments
Idempotency-Key: abc-123
```

Validasi idempotency key:

```java
@HeaderParam("Idempotency-Key")
@NotBlank
@Size(max = 128)
@Pattern(regexp = "^[A-Za-z0-9._:-]+$")
String idempotencyKey
```

Tetapi validasi format key bukan keseluruhan idempotency.

Idempotency membutuhkan:

- key uniqueness per actor/tenant/operation;
- request fingerprint;
- replay response;
- conflict jika same key different payload;
- TTL;
- persistence;
- concurrency handling.

Bean Validation hanya menjaga shape.

---

## 27. Validation untuk Regulatory/Case Management System

Untuk sistem enforcement/case management, validasi harus defendable.

Pertanyaan audit:

```text
Siapa yang submit?
Kapan submit?
Data apa yang dianggap invalid?
Aturan mana yang dilanggar?
Apakah aturan itu versi berapa?
Apakah user diberi pesan yang benar?
Apakah invalid attempt dicatat?
Apakah ada bypass manual?
Siapa approve bypass?
```

Validation architecture harus mendukung:

- stable error code;
- validation rule version;
- correlation ID;
- actor ID;
- tenant/agency context;
- operation name;
- state before operation;
- request hash untuk payload sensitif;
- audit event untuk critical validation failure;
- separation antara user-safe message dan internal diagnostic.

Contoh internal validation event:

```json
{
  "eventType": "VALIDATION_FAILED",
  "operation": "SUBMIT_APPLICATION",
  "actorId": "u-123",
  "applicationId": "app-456",
  "state": "DRAFT",
  "ruleCodes": ["MISSING_REQUIRED_DOCUMENT", "DECLARATION_NOT_ACCEPTED"],
  "correlationId": "c-789",
  "occurredAt": "2026-06-16T10:15:30Z"
}
```

Tidak semua validation failure perlu audit event. Tapi untuk high-risk action, ini penting.

---

## 28. Recommended Jersey Validation Architecture

Untuk production Jersey API, struktur yang sehat:

```text
Resource layer
  - parses request
  - applies Bean Validation for API DTO
  - maps request to command/query
  - does not contain business rule complexity

Application service
  - orchestrates authorization, load, transaction
  - calls domain policy/domain aggregate
  - maps domain exceptions to error taxonomy

Domain layer
  - enforces invariant and state transition
  - independent from Jersey/Jakarta annotations when possible

Persistence layer
  - enforces final integrity constraints
  - maps DB constraint violation to domain/infrastructure error

Exception mapper layer
  - converts validation/domain/security/infrastructure errors to API contract
```

Diagram:

```text
HTTP Request
  ↓
Jersey filters
  ↓
Resource matching
  ↓
Entity read / param conversion
  ↓
Bean Validation on DTO/params
  ↓
Resource method
  ↓
Command mapper
  ↓
Application service
  ↓
Authorization + domain validation + transaction
  ↓
Repository/database
  ↓
Response mapper
  ↓
Jersey response pipeline
```

---

## 29. Design Pattern: Request DTO + Command + Domain

Request DTO:

```java
public record SubmitApplicationRequest(
    @NotNull Boolean declarationAccepted,
    @Size(max = 1000) String remarks
) {}
```

Command:

```java
public record SubmitApplicationCommand(
    ApplicationId applicationId,
    Actor actor,
    boolean declarationAccepted,
    String remarks,
    Instant now,
    String correlationId
) {}
```

Resource:

```java
@POST
@Path("/{applicationId}/submit")
public Response submit(
    @PathParam("applicationId") String applicationId,
    @Valid SubmitApplicationRequest request,
    @Context SecurityContext security,
    @Context RequestCorrelation correlation
) {
    SubmitApplicationCommand command = new SubmitApplicationCommand(
        ApplicationId.parse(applicationId),
        Actor.from(security),
        Boolean.TRUE.equals(request.declarationAccepted()),
        request.remarks(),
        clock.instant(),
        correlation.id()
    );

    SubmitApplicationResult result = service.submit(command);

    return Response.ok(new SubmitApplicationResponse(result.status())).build();
}
```

Domain/application validation:

```java
public SubmitApplicationResult submit(SubmitApplicationCommand command) {
    if (!command.declarationAccepted()) {
        throw new DomainValidationException("DECLARATION_NOT_ACCEPTED");
    }

    return transaction.execute(() -> {
        Application app = repository.getForUpdate(command.applicationId());
        authorization.ensureCanSubmit(command.actor(), app);
        app.submit(command.now(), command.remarks());
        repository.save(app);
        return new SubmitApplicationResult(app.status());
    });
}
```

Kenapa `declarationAccepted` dicek lagi padahal ada `@NotNull`?

Karena:

```text
@NotNull hanya memastikan field hadir.
Domain rule memastikan nilainya true untuk submit.
```

---

## 30. Common Failure Modes

### 30.1 `@Valid` Lupa Dipasang

Gejala:

- nested object invalid tetap lolos;
- DTO tampak punya annotation tapi tidak berpengaruh.

Fix:

```java
public Response create(@Valid CreateRequest request)
```

Dan nested:

```java
public record CreateRequest(@Valid Address address) {}
```

### 30.2 Validation Module Tidak Ada

Gejala:

- constraint tidak jalan;
- tidak ada validation exception;
- behavior beda antara test dan production.

Fix:

- pastikan dependency `jersey-bean-validation` ada;
- pastikan provider validation implementation ada;
- pastikan namespace cocok.

### 30.3 `javax` dan `jakarta` Tercampur

Gejala:

- annotation diabaikan;
- runtime class conflict;
- deploy gagal.

Fix:

- satu aplikasi satu namespace generation;
- enforce dependency convergence.

### 30.4 Default Error Shape Bocor ke Client

Gejala:

- error path internal;
- message tidak konsisten;
- frontend sulit mapping;
- stack trace atau class name bocor.

Fix:

- custom `ExceptionMapper`;
- stable error taxonomy;
- redaction.

### 30.5 Validation Group Overengineering

Gejala:

- field required sulit dipahami;
- satu DTO punya banyak group;
- bug muncul saat endpoint baru memakai group salah.

Fix:

- DTO per operation;
- group hanya untuk kasus yang benar-benar reusable.

### 30.6 Database Lookup di ConstraintValidator

Gejala:

- validation lambat;
- N+1 query;
- validator butuh transaction;
- sulit dites;
- deadlock/race condition.

Fix:

- pindahkan ke domain/application service;
- gunakan DB constraint untuk final uniqueness.

### 30.7 PATCH Menggunakan Create DTO

Gejala:

- partial update selalu gagal;
- absent field diperlakukan invalid;
- null semantics kacau.

Fix:

- DTO khusus PATCH;
- explicit absent/present/null model.

### 30.8 Invalid Value Masuk Log/Error

Gejala:

- password/token/PII muncul di log;
- compliance issue.

Fix:

- redaction strategy;
- allowlist output;
- sensitive metadata.

---

## 31. Testing Strategy untuk Validation

Test validation tidak boleh hanya mengetes DTO annotation secara isolated.

Layer test:

### 31.1 DTO Validator Test

```java
Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
Set<ConstraintViolation<CreateUserRequest>> violations = validator.validate(request);
```

Cocok untuk custom constraint dan complex DTO.

### 31.2 Jersey Runtime Test

Gunakan Jersey Test Framework untuk memastikan:

- `@Valid` dipanggil;
- mapper aktif;
- error shape benar;
- field path benar;
- status code benar.

Test cases:

```text
POST /users {} → 400 VALIDATION_FAILED username required email required
POST /users invalid-json → 400/parse error contract
POST /users email invalid → 400 INVALID_EMAIL
GET /cases?page=abc → conversion error contract
GET /cases?page=0 → validation error contract
```

### 31.3 Contract Test

Pastikan error response stabil:

```json
{
  "code": "VALIDATION_FAILED",
  "violations": [
    {"field": "email", "code": "INVALID_EMAIL"}
  ]
}
```

Jangan assert exact localized message jika message bisa berubah.

### 31.4 Security Test

Pastikan sensitive fields tidak muncul.

```text
password invalid → response tidak mengandung raw password
invalid token → tidak mengandung token
large text invalid → tidak echo full payload
```

### 31.5 Workflow Validation Test

Test domain/service, bukan Jersey.

```text
DRAFT + submit + complete docs → success
APPROVED + submit → INVALID_STATE_TRANSITION
DRAFT + missing docs → MISSING_REQUIRED_DOCUMENT
```

---

## 32. Checklist Production Validation

Gunakan checklist ini saat mendesain endpoint Jersey.

### 32.1 Request Contract

```text
[ ] DTO khusus operation, bukan reuse sembarangan
[ ] Required field eksplisit
[ ] Optional field semantics jelas
[ ] Default value hanya jika benar-benar kontrak API
[ ] Query/path/header constraints ada
[ ] Sort/filter allowlist
[ ] Size limit ada untuk string/list
[ ] Nested object memakai @Valid
[ ] PATCH absent/null semantics jelas
```

### 32.2 Error Contract

```text
[ ] ConstraintViolationExceptionMapper custom
[ ] Error response punya stable code
[ ] Field path dinormalisasi
[ ] Correlation ID disertakan
[ ] Sensitive invalid value tidak bocor
[ ] Message aman untuk client
[ ] Status code konsisten
[ ] Error ordering stabil untuk test
```

### 32.3 Architecture

```text
[ ] Bean Validation hanya untuk API/local constraints
[ ] Domain invariant tidak dipaksa ke annotation jika butuh state/context
[ ] Authorization boundary jelas
[ ] Transaction tidak dibuka terlalu awal
[ ] DB constraint tetap ada untuk final integrity
[ ] Persistence errors dimap ke domain/API error yang aman
```

### 32.4 Runtime

```text
[ ] jersey-bean-validation dependency tersedia
[ ] Namespace javax/jakarta tidak campur
[ ] Validation provider tersedia
[ ] Auto-discovery behavior diketahui
[ ] Test environment sama dengan production behavior
```

### 32.5 Security/Compliance

```text
[ ] Password/token/PII tidak dikembalikan dalam error
[ ] Validation failure high-risk diaudit jika perlu
[ ] Error tidak membocorkan existence/authorization info
[ ] Rule code cukup stabil untuk audit/support
```

---

## 33. Mini Exercise

### Exercise 1 — Create vs Update

Desain DTO untuk:

```text
POST /users
PUT /users/{id}
PATCH /users/{id}
```

Tentukan:

- field mana wajib;
- field mana optional;
- apakah pakai group atau DTO berbeda;
- bagaimana membedakan absent dan null pada PATCH.

### Exercise 2 — Error Mapper

Buat error response untuk kasus:

```json
{
  "email": "not-email",
  "password": "123",
  "profile": {
    "displayName": ""
  }
}
```

Target:

```text
email → INVALID_EMAIL
password → INVALID_SIZE, tanpa echo password
profile.displayName → REQUIRED
```

### Exercise 3 — Workflow Validation

Endpoint:

```text
POST /applications/{id}/submit
```

Rules:

```text
- application must be DRAFT
- required documents must exist
- declarationAccepted must be true
- user must be owner or officer
```

Pisahkan mana yang:

- Bean Validation;
- authorization;
- domain validation;
- persistence constraint;
- audit event.

---

## 34. Ringkasan

Validation di Jersey bukan hanya `@Valid`.

Mental model yang benar:

```text
Parsing/conversion
  ≠ request validation
  ≠ authorization
  ≠ workflow validation
  ≠ domain invariant
  ≠ database constraint
```

Bean Validation sangat berguna untuk menjaga API boundary:

- required field;
- string size;
- numeric range;
- email/pattern;
- nested DTO;
- parameter constraints;
- reusable local constraints.

Tetapi jangan jadikan Bean Validation sebagai tempat semua business rule.

Untuk production-grade Jersey API:

- gunakan DTO per operation jika lebih jelas;
- hati-hati dengan validation group;
- desain PATCH secara eksplisit;
- normalisasi error field path;
- buat stable error code;
- redaksi sensitive value;
- bedakan validation, authorization, domain, dan persistence failure;
- test behavior melalui Jersey runtime, bukan hanya validator unit test.

Top engineer tidak hanya tahu annotation. Ia tahu **di boundary mana sebuah aturan harus hidup**, **kapan aturan dievaluasi**, **apa konsekuensi security-nya**, **bagaimana error menjadi kontrak**, dan **bagaimana sistem tetap dapat diaudit saat request ditolak**.

---

## 35. Status Series

Selesai:

```text
Part 0  — Orientasi Seri
Part 1  — Jersey Mental Model
Part 2  — Application Bootstrap
Part 3  — Resource Model Internals
Part 4  — Request Matching Deep Dive
Part 5  — Parameter Injection Semantics
Part 6  — Entity Provider Pipeline
Part 7  — JSON in Jersey
Part 8  — Response Engineering
Part 9  — Exception Mapping Architecture
Part 10 — Filters and Interceptors
Part 11 — Jersey Injection Model
Part 12 — CDI, Spring, and Jersey Integration
Part 13 — Jersey Client Deep Dive
Part 14 — Resilient Outbound Calls
Part 15 — Async Server Processing
Part 16 — Server-Sent Events and Streaming APIs
Part 17 — Multipart, File Upload, Download, and Large Payload Engineering
Part 18 — Security Integration
Part 19 — Validation Strategy
```

Berikutnya:

```text
Part 20 — API Versioning and Compatibility with Jersey
```

Series belum selesai. Target akhir tetap Part 32 — Capstone.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 18 — Security Integration: Authentication, Authorization, Principal, Roles, and Context](./18-security-integration-authentication-authorization-principal-roles-context.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 20 — API Versioning and Compatibility with Jersey](./20-api-versioning-and-compatibility-with-jersey (1).md)

</div>
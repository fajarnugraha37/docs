# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-014

# Part 014 — Validation, Serialization, DTO, and API Contract Engineering

> Seri: **learn-java-quarkus-runtime-cloud-native-native-image-engineering**  
> Level: Advanced / Top 1% Software Engineer Track  
> Fokus: Quarkus REST contract engineering, Bean Validation, DTO boundary, serialization governance, error contract, API evolution, dan native-image implications.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- Quarkus sebagai framework yang melakukan banyak pekerjaan pada **build time**.
- Quarkus REST sebagai layer HTTP modern berbasis Vert.x dan build-time metadata.
- Blocking vs reactive execution model.
- Hibernate ORM, Panache, Hibernate Reactive, dan transaction boundary.

Part ini berada di titik pertemuan antara:

```text
HTTP Request
   ↓
DTO / Input Contract
   ↓
Validation
   ↓
Application Use Case
   ↓
Domain / Persistence
   ↓
DTO / Output Contract
   ↓
Serialization
   ↓
HTTP Response / Error Contract
```

Di banyak codebase enterprise, bug API bukan terjadi karena developer tidak tahu cara membuat endpoint. Bug terjadi karena contract tidak dikelola sebagai **public system boundary**.

Contoh bug nyata:

- Field request ditambah tanpa backward compatibility.
- Enum berubah dan client lama gagal parse.
- `null` punya arti ambigu.
- Error response tidak konsisten antar endpoint.
- Validasi hanya ada di frontend.
- Entity langsung diekspos sebagai JSON.
- Date/time diserialisasi tidak konsisten.
- Lazy-loaded entity menyebabkan serialization exception.
- Native image gagal karena library serialization memakai reflection dinamis.
- Error internal bocor ke client.
- Audit tidak bisa menjelaskan input yang valid/invalid.

Karena itu, part ini bukan sekadar “cara pakai Hibernate Validator” atau “cara pakai Jackson”. Kita akan membahas bagaimana API contract harus didesain sebagai boundary yang stabil, evolvable, defensible, dan production-safe.

---

## 1. Core Problem

Problem utama pada API contract engineering adalah:

> Bagaimana membuat boundary HTTP yang jelas, validatable, backward-compatible, aman terhadap perubahan, mudah diobservasi, dan tetap compatible dengan model build-time/native Quarkus?

Dalam Quarkus, problem ini punya dimensi tambahan:

1. **Build-time metadata**  
   Quarkus melakukan banyak scanning, indexing, dan optimization saat build. Model DTO/validation/serialization yang terlalu dinamis dapat mengurangi manfaat Quarkus.

2. **Native image constraints**  
   Dynamic reflection, polymorphic serialization liar, runtime class discovery, dan implicit metadata bisa menjadi masalah di native image.

3. **Reactive and non-blocking boundary**  
   Error handling, validation, dan serialization tidak boleh diam-diam memblok event loop atau membuat failure propagation menjadi tidak jelas.

4. **Enterprise compatibility**  
   API sering hidup lebih lama daripada implementasinya. Client bisa berupa frontend SPA, mobile app, batch integration, agency integration, atau service lain.

5. **Audit and regulatory defensibility**  
   Untuk sistem enforcement/case management, contract harus menjawab: “data apa yang diterima, apa yang ditolak, kenapa ditolak, dan bagaimana response dibentuk?”

---

## 2. Mental Model: API Contract Adalah Firewall Semantik

Jangan pikir DTO hanya sebagai “class untuk JSON”. DTO adalah firewall semantik antara dunia luar dan sistem internal.

```text
External World
  - unstable input
  - unknown client version
  - malicious payload
  - incomplete data
  - inconsistent assumptions
  - timezone ambiguity
  - enum drift
  - over-posting risk
        │
        ▼
API Contract Firewall
  - DTO shape
  - validation rules
  - defaulting rules
  - normalization rules
  - authorization boundary
  - error contract
  - compatibility rules
        │
        ▼
Internal Application
  - use case command/query
  - domain model
  - transaction boundary
  - persistence model
  - audit trail
```

Contract firewall punya beberapa tugas:

| Tugas | Penjelasan |
|---|---|
| Shape control | Menentukan field apa yang boleh masuk/keluar. |
| Semantic validation | Menentukan nilai apa yang masuk akal. |
| Evolution control | Menjaga perubahan API tetap compatible. |
| Security boundary | Mencegah over-posting, data leakage, dan insecure direct object exposure. |
| Error normalization | Membuat error dapat dipahami client dan operasional. |
| Observability | Membuat failure dapat dianalisis tanpa membocorkan PII/secrets. |
| Native friendliness | Menghindari model serialization yang terlalu dinamis. |

Top 1% engineer tidak melihat DTO sebagai boilerplate. Mereka melihat DTO sebagai **contract artifact**.

---

## 3. Jangan Mengekspos Entity Sebagai API Contract

Ini salah satu aturan paling penting.

Entity bukan DTO.

Entity adalah model persistence. DTO adalah model contract.

### 3.1 Kenapa Entity Tidak Boleh Langsung Diekspos?

Misalnya:

```java
@Entity
public class CaseRecord {
    @Id
    public Long id;

    public String caseNumber;

    public String internalRiskScore;

    public String officerRemark;

    @OneToMany(mappedBy = "caseRecord", fetch = FetchType.LAZY)
    public List<CaseAction> actions;
}
```

Jika langsung dikembalikan dari REST resource:

```java
@GET
@Path("/{id}")
public CaseRecord get(Long id) {
    return entityManager.find(CaseRecord.class, id);
}
```

Masalah:

1. **Data leakage**  
   `internalRiskScore` dan `officerRemark` bisa bocor.

2. **Lazy loading issue**  
   Serialization dapat memicu lazy loading setelah transaction/session sudah selesai.

3. **N+1 query tersembunyi**  
   JSON serialization bisa memicu query tambahan.

4. **API ikut berubah saat schema berubah**  
   Tambah kolom entity bisa tidak sengaja menambah field response.

5. **Over-posting vulnerability**  
   Client bisa mengirim field yang seharusnya internal-only.

6. **Circular reference**  
   Entity relationship bidirectional bisa menyebabkan infinite recursion.

7. **Backward compatibility rusak**  
   Refactor internal persistence bisa mematahkan client.

8. **Native image metadata risk**  
   Serialization atas model kompleks dan relationship dinamis bisa memerlukan metadata lebih banyak.

### 3.2 DTO Boundary yang Benar

Gunakan DTO eksplisit:

```java
public record CaseSummaryResponse(
    String caseNumber,
    String status,
    String subjectName,
    OffsetDateTime createdAt,
    OffsetDateTime lastUpdatedAt
) {}
```

Resource:

```java
@GET
@Path("/{caseNumber}")
public CaseSummaryResponse getCase(@PathParam("caseNumber") String caseNumber) {
    CaseRecord record = caseQueryService.getCaseSummary(caseNumber);
    return new CaseSummaryResponse(
        record.caseNumber,
        record.status.name(),
        record.subjectName,
        record.createdAt,
        record.updatedAt
    );
}
```

DTO eksplisit membuat contract terlihat.

---

## 4. DTO Taxonomy: Jangan Semua Disebut DTO

Istilah “DTO” terlalu luas. Dalam sistem besar, bedakan beberapa jenis object.

```text
Request DTO
Command DTO
Query DTO
Response DTO
Event DTO
Persistence Projection
Domain Object
```

### 4.1 Request DTO

Mewakili payload eksternal.

```java
public record CreateCaseRequest(
    @NotBlank String subjectName,
    @NotBlank String subjectId,
    @NotNull CaseType caseType,
    String initialRemark
) {}
```

Tugas:

- shape request,
- basic validation,
- documentation,
- compatibility boundary.

Tidak boleh berisi business logic berat.

### 4.2 Command DTO

Mewakili intensi use case internal.

```java
public record CreateCaseCommand(
    String subjectName,
    String subjectId,
    CaseType caseType,
    String initialRemark,
    String requestedBy,
    OffsetDateTime requestedAt
) {}
```

Command boleh mengandung data tambahan dari security context, request metadata, atau normalized values.

### 4.3 Response DTO

Mewakili contract response.

```java
public record CreateCaseResponse(
    String caseNumber,
    String status,
    OffsetDateTime createdAt
) {}
```

Response harus stabil dan tidak expose internal.

### 4.4 Projection DTO

Mewakili hasil query database.

```java
public record CaseListProjection(
    String caseNumber,
    String status,
    String subjectName,
    OffsetDateTime createdAt
) {}
```

Projection bisa dekat dengan query shape, tapi jangan langsung dianggap external response jika butuh masking/formatting.

### 4.5 Event DTO

Mewakili integration contract asynchronous.

```java
public record CaseSubmittedEvent(
    String eventId,
    String caseNumber,
    String caseType,
    OffsetDateTime occurredAt,
    int schemaVersion
) {}
```

Event contract punya aturan compatibility sendiri.

---

## 5. Validation Layering

Validasi tidak satu lapis.

```text
Transport Validation
  - required field
  - string length
  - pattern
  - enum shape

Semantic Validation
  - date range masuk akal
  - amount tidak negatif
  - start <= end

Business Validation
  - user boleh submit?
  - case status memungkinkan transisi?
  - duplicate case?
  - subject under restriction?

Persistence Constraint
  - unique key
  - FK constraint
  - check constraint
```

### 5.1 Transport Validation

Cocok untuk Bean Validation di DTO:

```java
public record SubmitApplicationRequest(
    @NotBlank
    @Size(max = 100)
    String applicantName,

    @NotBlank
    @Pattern(regexp = "^[A-Z0-9]{8,20}$")
    String applicantId,

    @NotNull
    ApplicationType type
) {}
```

Resource:

```java
@POST
public Response submit(@Valid SubmitApplicationRequest request) {
    // request sudah lolos basic validation
    return Response.accepted().build();
}
```

### 5.2 Semantic Validation

Contoh:

```java
public record SearchCaseRequest(
    @NotNull OffsetDateTime from,
    @NotNull OffsetDateTime to
) {
    @AssertTrue(message = "from must be before or equal to to")
    public boolean isDateRangeValid() {
        return from == null || to == null || !from.isAfter(to);
    }
}
```

Ini masih cocok di DTO bila validasi hanya tergantung field dalam object yang sama.

### 5.3 Business Validation

Jangan taruh business validation berat di annotation DTO.

Contoh buruk:

```java
public record ApproveCaseRequest(
    @CaseMustBePending
    String caseNumber
) {}
```

Annotation seperti ini bisa menyembunyikan query database di validation layer.

Lebih baik:

```java
public void approve(ApproveCaseCommand command) {
    CaseRecord record = caseRepository.findByCaseNumber(command.caseNumber());

    if (!record.canBeApprovedBy(command.actor())) {
        throw new BusinessRuleViolation("CASE_NOT_APPROVABLE");
    }

    record.approve(command.actor(), command.now());
}
```

Business validation harus dekat dengan use case/domain agar:

- transaction boundary jelas,
- authorization jelas,
- audit jelas,
- retry semantics jelas,
- database access tidak tersembunyi di annotation.

---

## 6. Bean Validation di Quarkus

Quarkus menyediakan integrasi Hibernate Validator untuk validasi REST input/output dan method parameter/return value pada business service.

Dependency umum:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-hibernate-validator</artifactId>
</dependency>
```

### 6.1 Validasi Request Body

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @POST
    public CreateCaseResponse create(@Valid CreateCaseRequest request) {
        return service.create(request);
    }
}
```

DTO:

```java
public record CreateCaseRequest(
    @NotBlank @Size(max = 120) String subjectName,
    @NotBlank @Size(max = 30) String subjectId,
    @NotNull CaseType caseType,
    @Size(max = 2_000) String initialRemark
) {}
```

### 6.2 Validasi Path dan Query Parameter

```java
@GET
@Path("/{caseNumber}")
public CaseResponse get(
    @PathParam("caseNumber")
    @Pattern(regexp = "^CASE-[0-9]{8}$")
    String caseNumber
) {
    return service.get(caseNumber);
}
```

### 6.3 Validasi Return Value

```java
@NotNull
public CaseResponse getCase(String caseNumber) {
    return repository.findResponse(caseNumber);
}
```

Gunakan hati-hati. Return value validation berguna untuk invariant internal, tetapi jangan jadikan pengganti test atau domain correctness.

### 6.4 Validasi Service Method

```java
@ApplicationScoped
public class CaseCommandService {

    public CreateCaseResult create(@Valid CreateCaseCommand command) {
        // ...
    }
}
```

Validasi method service berguna jika service dipanggil dari beberapa entrypoint:

- REST,
- messaging,
- scheduler,
- internal orchestration.

Tetapi hindari validasi berlapis yang membuat error duplicate atau inconsistent.

---

## 7. Validation Groups

Validation groups memungkinkan rule berbeda untuk context berbeda.

```java
public interface Draft {}
public interface Submit {}
```

DTO:

```java
public record ApplicationRequest(
    @NotBlank(groups = Submit.class)
    String applicantName,

    @NotBlank(groups = Submit.class)
    String applicantId,

    @Size(max = 2_000, groups = {Draft.class, Submit.class})
    String remark
) {}
```

Service:

```java
public void saveDraft(@Validated(Draft.class) ApplicationRequest request) {
    // draft validation
}

public void submit(@Validated(Submit.class) ApplicationRequest request) {
    // submit validation
}
```

Namun hati-hati: group bisa membuat DTO terlalu banyak konteks.

Jika perbedaan shape besar, lebih baik buat DTO berbeda:

```java
public record SaveDraftRequest(...) {}
public record SubmitApplicationRequest(...) {}
```

### Rule Praktis

Gunakan validation group jika:

- field sama,
- context mirip,
- hanya requiredness/constraint kecil berbeda.

Buat DTO berbeda jika:

- workflow berbeda,
- authorization berbeda,
- semantic berbeda,
- lifecycle state berbeda,
- response/error berbeda.

---

## 8. Custom Constraint: Kapan Layak Dibuat?

Custom Bean Validation constraint cocok untuk rule yang:

- murni deterministic,
- tidak butuh external IO,
- reusable,
- dekat dengan shape/value,
- tidak bergantung pada transaction.

Contoh postal code:

```java
@Target({ ElementType.FIELD, ElementType.PARAMETER })
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PostalCodeValidator.class)
public @interface PostalCode {
    String message() default "invalid postal code";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

Validator:

```java
public class PostalCodeValidator implements ConstraintValidator<PostalCode, String> {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isBlank()) {
            return true; // combine with @NotBlank if required
        }
        return value.matches("^[0-9]{6}$");
    }
}
```

DTO:

```java
public record AddressRequest(
    @PostalCode
    String postalCode
) {}
```

### Hindari Custom Constraint yang Melakukan IO

Buruk:

```java
public class UniqueCaseNumberValidator implements ConstraintValidator<UniqueCaseNumber, String> {
    @Inject CaseRepository repository;

    public boolean isValid(String value, ConstraintValidatorContext context) {
        return !repository.exists(value);
    }
}
```

Masalah:

- hidden DB access,
- transaction boundary tidak jelas,
- race condition tetap ada,
- sulit ditest,
- validasi bisa dipanggil di tempat tidak terduga,
- performance tidak terlihat.

Unique constraint tetap harus dipastikan di database dan ditangani di use case.

---

## 9. Error Contract: Jangan Biarkan Exception Menjadi API

Default error response mungkin cukup untuk demo. Untuk production, error harus menjadi contract.

Error contract minimal:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "detail": "Request contains invalid fields",
  "instance": "/cases",
  "traceId": "01H...",
  "violations": [
    {
      "field": "subjectName",
      "message": "must not be blank",
      "code": "NOT_BLANK"
    }
  ]
}
```

Ini mirip pendekatan Problem Details, dengan tambahan field yang berguna untuk client dan operasional.

### 9.1 Error Taxonomy

Pisahkan error berdasarkan sifatnya:

| Kategori | HTTP | Contoh |
|---|---:|---|
| Validation error | 400 | field kosong, format salah |
| Authentication error | 401 | token missing/invalid |
| Authorization error | 403 | role tidak cukup |
| Not found | 404 | case tidak ada atau tidak terlihat user |
| Conflict | 409 | stale version, duplicate, invalid state transition |
| Rate limit | 429 | terlalu banyak request |
| External dependency | 502/503/504 | downstream gagal |
| Internal error | 500 | bug/unexpected failure |

### 9.2 Domain Error Jangan Dikonversi Semua ke 500

Buruk:

```java
throw new RuntimeException("Case cannot be approved");
```

Lebih baik:

```java
public final class BusinessRuleViolation extends RuntimeException {
    private final String code;

    public BusinessRuleViolation(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Exception mapper:

```java
@Provider
public class BusinessRuleViolationMapper implements ExceptionMapper<BusinessRuleViolation> {

    @Context
    UriInfo uriInfo;

    @Override
    public Response toResponse(BusinessRuleViolation exception) {
        ProblemResponse problem = ProblemResponse.conflict(
            "BUSINESS_RULE_VIOLATION",
            exception.code(),
            exception.getMessage(),
            uriInfo.getPath()
        );

        return Response.status(Response.Status.CONFLICT)
            .entity(problem)
            .type(MediaType.APPLICATION_JSON)
            .build();
    }
}
```

---

## 10. Exception Mapper Design

Exception mapper adalah boundary antara internal failure dan external contract.

### 10.1 Mapper untuk Validation Error

```java
@Provider
public class ConstraintViolationMapper implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        List<FieldViolation> violations = exception.getConstraintViolations()
            .stream()
            .map(v -> new FieldViolation(
                propertyPath(v),
                v.getMessage(),
                annotationCode(v)
            ))
            .toList();

        ProblemResponse body = new ProblemResponse(
            "https://api.example.com/problems/validation-error",
            "Validation failed",
            400,
            "VALIDATION_ERROR",
            "Request contains invalid fields",
            violations
        );

        return Response.status(400).entity(body).build();
    }

    private String propertyPath(ConstraintViolation<?> violation) {
        return violation.getPropertyPath().toString();
    }

    private String annotationCode(ConstraintViolation<?> violation) {
        return violation.getConstraintDescriptor()
            .getAnnotation()
            .annotationType()
            .getSimpleName()
            .toUpperCase(Locale.ROOT);
    }
}
```

Response type:

```java
public record ProblemResponse(
    String type,
    String title,
    int status,
    String code,
    String detail,
    List<FieldViolation> violations
) {}

public record FieldViolation(
    String field,
    String message,
    String code
) {}
```

### 10.2 Mapper untuk Unexpected Error

Unexpected error tidak boleh bocor detail internal.

```java
@Provider
public class UnexpectedExceptionMapper implements ExceptionMapper<Throwable> {

    private static final Logger LOG = Logger.getLogger(UnexpectedExceptionMapper.class);

    @Override
    public Response toResponse(Throwable exception) {
        String traceId = TraceId.currentOrUnknown();

        LOG.errorf(exception, "Unexpected error. traceId=%s", traceId);

        ProblemResponse body = new ProblemResponse(
            "https://api.example.com/problems/internal-error",
            "Internal server error",
            500,
            "INTERNAL_ERROR",
            "Unexpected error occurred",
            List.of()
        );

        return Response.status(500).entity(body).build();
    }
}
```

Jangan kirim stack trace ke client.

---

## 11. Field-Level Error: Nama Field Harus Stabil

Jika validation error mengembalikan path internal seperti:

```text
create.arg0.subjectName
```

Client akan kesulitan.

Lebih baik normalize menjadi:

```text
subjectName
```

Atau untuk nested:

```text
addresses[0].postalCode
```

Field path adalah bagian dari API contract. Jangan tergantung pada nama method Java yang bisa berubah.

---

## 12. Serialization Strategy: Jackson vs JSON-B

Quarkus mendukung JSON serialization melalui extension seperti Jackson atau JSON-B.

Dalam banyak sistem enterprise modern, Jackson sering dipilih karena:

- ecosystem besar,
- banyak module,
- kontrol annotation luas,
- integrasi dengan record,
- custom serializer/deserializer matang,
- umum dipakai di Spring/Jakarta ecosystem.

JSON-B bisa cocok jika:

- ingin Jakarta standard style,
- model sederhana,
- tidak butuh customization kompleks,
- ingin dependency lebih standard-oriented.

Yang penting: jangan campur sembarangan.

### 12.1 Jackson Dependency

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-jackson</artifactId>
</dependency>
```

### 12.2 JSON-B Dependency

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-jsonb</artifactId>
</dependency>
```

### 12.3 Rule Praktis

Pilih satu default serialization stack per service atau per platform.

Jangan membuat satu service memakai Jackson, service lain JSON-B, kecuali ada governance yang jelas. Inconsistency kecil seperti date format, enum behavior, unknown fields, dan null handling bisa menjadi integration bug.

---

## 13. ObjectMapper Governance

Jika menggunakan Jackson, jangan biarkan `ObjectMapper` dikonfigurasi ad hoc di banyak tempat.

Buruk:

```java
ObjectMapper mapper = new ObjectMapper();
mapper.writeValueAsString(object);
```

Ini bypass konfigurasi Quarkus.

Lebih baik gunakan managed ObjectMapper/customizer.

```java
@Singleton
public class ObjectMapperConfiguration implements ObjectMapperCustomizer {

    @Override
    public void customize(ObjectMapper mapper) {
        mapper.findAndRegisterModules();
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }
}
```

Catatan: `FAIL_ON_UNKNOWN_PROPERTIES` punya trade-off.

| Mode | Kelebihan | Risiko |
|---|---|---|
| Fail on unknown | Contract ketat, typo cepat terlihat | Client forward compatibility lebih sulit |
| Ignore unknown | Lebih tolerant untuk evolusi | Typo client bisa diam-diam diabaikan |

Untuk public/enterprise API, strategi sering:

- request dari external client: pertimbangkan fail on unknown untuk endpoint command yang critical,
- event integration: biasanya tolerant reader,
- internal admin API: bisa lebih strict,
- read response: client harus tolerant terhadap field baru.

---

## 14. Null Semantics

`null` bukan detail kecil. `null` adalah contract.

Pertanyaan yang harus dijawab:

- Apakah field boleh hilang?
- Apakah field boleh hadir dengan nilai `null`?
- Apakah `null` berarti clear value?
- Apakah absent berarti no change?
- Apakah empty string sama dengan null?
- Apakah empty list berarti tidak ada item atau belum dihitung?

### 14.1 Create Request

Pada create request:

```json
{
  "remark": null
}
```

Mungkin sama dengan:

```json
{}
```

Jika field optional.

### 14.2 Patch Request

Pada PATCH, absent dan null sering berbeda.

```json
{
  "remark": null
}
```

Bisa berarti hapus remark.

Sedangkan:

```json
{}
```

Bisa berarti jangan ubah remark.

### 14.3 Jangan Pakai DTO Create untuk Patch

Buruk:

```java
public record UpdateCaseRequest(
    String subjectName,
    String remark
) {}
```

Tidak jelas apakah `null` berarti no change atau clear.

Lebih eksplisit:

```java
public record PatchCaseRequest(
    OptionalField<String> subjectName,
    OptionalField<String> remark
) {}
```

Atau gunakan JSON Patch / merge patch jika memang perlu.

---

## 15. Date and Time Contract

Untuk API modern, gunakan `OffsetDateTime` atau `Instant` secara eksplisit.

### 15.1 Rule Praktis

| Kebutuhan | Tipe |
|---|---|
| Timestamp absolut | `Instant` |
| Timestamp dengan offset | `OffsetDateTime` |
| Local date tanpa waktu | `LocalDate` |
| Jam tanpa tanggal | `LocalTime` |
| Jangan untuk API external | `java.util.Date`, `Calendar` |

### 15.2 Timezone Anti-Pattern

Buruk:

```json
{
  "createdAt": "2026-06-20 10:15:00"
}
```

Tidak jelas timezone-nya.

Lebih baik:

```json
{
  "createdAt": "2026-06-20T10:15:00+07:00"
}
```

atau:

```json
{
  "createdAt": "2026-06-20T03:15:00Z"
}
```

### 15.3 Date Range Validation

```java
public record ReportSearchRequest(
    @NotNull OffsetDateTime from,
    @NotNull OffsetDateTime to
) {
    @AssertTrue(message = "from must not be after to")
    public boolean isValidRange() {
        return from == null || to == null || !from.isAfter(to);
    }
}
```

Tetapi validasi maksimal range, misalnya 31 hari, bisa masuk semantic validation:

```java
@AssertTrue(message = "range must not exceed 31 days")
public boolean isRangeWithinLimit() {
    if (from == null || to == null) return true;
    return Duration.between(from, to).toDays() <= 31;
}
```

Jika limit tergantung role/subscription/config, pindahkan ke service.

---

## 16. Enum Evolution

Enum di API tampak sederhana, tapi sering merusak compatibility.

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}
```

Jika nanti ditambah:

```java
UNDER_REVIEW
```

Client lama mungkin gagal parse.

### 16.1 Untuk Request

Enum request boleh strict.

Jika client mengirim status tidak dikenal, return 400.

### 16.2 Untuk Response

Client harus disiapkan tolerant terhadap enum baru.

Di sisi server, dokumentasikan:

> Client must treat unknown status as non-terminal unless explicitly documented.

### 16.3 Jangan Rename Enum Value Sembarangan

Rename dari `SUBMITTED` ke `PENDING_REVIEW` adalah breaking change.

Lebih baik:

- tambah value baru,
- deprecate value lama,
- migration window,
- versioned behavior bila perlu.

### 16.4 Enum Dengan Code Stabil

Jika enum internal bisa berubah, expose code stabil:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW");

    private final String apiCode;

    CaseStatus(String apiCode) {
        this.apiCode = apiCode;
    }

    public String apiCode() {
        return apiCode;
    }
}
```

Response:

```java
public record CaseResponse(
    String caseNumber,
    String status
) {}
```

---

## 17. Records as DTO in Quarkus

Java records cocok untuk DTO karena:

- immutable,
- concise,
- field eksplisit,
- constructor canonical,
- cocok untuk response/request sederhana.

Contoh:

```java
public record CreateCaseRequest(
    @NotBlank String subjectName,
    @NotBlank String subjectId,
    @NotNull CaseType caseType
) {}
```

### 17.1 Kapan Record Cocok

Record cocok untuk:

- request DTO sederhana,
- response DTO,
- projection,
- immutable command,
- event payload.

### 17.2 Kapan Record Kurang Cocok

Record kurang cocok jika:

- perlu partial update dengan absent/null distinction,
- perlu complex construction,
- perlu mutable builder,
- perlu framework yang butuh no-arg constructor,
- ada inheritance DTO kompleks.

### 17.3 Compact Constructor untuk Normalization

```java
public record CreateCaseRequest(
    @NotBlank String subjectName,
    @NotBlank String subjectId
) {
    public CreateCaseRequest {
        subjectName = subjectName == null ? null : subjectName.trim();
        subjectId = subjectId == null ? null : subjectId.trim().toUpperCase(Locale.ROOT);
    }
}
```

Gunakan normalization ringan. Jangan taruh business logic berat di constructor DTO.

---

## 18. DTO Mapping Strategy

Mapping bisa dilakukan dengan:

1. Manual mapping.
2. Mapper class biasa.
3. MapStruct.
4. Jackson conversion.
5. Reflection-based mapper.

### 18.1 Manual Mapping

```java
public final class CaseDtoMapper {

    private CaseDtoMapper() {}

    public static CaseSummaryResponse toSummary(CaseRecord record) {
        return new CaseSummaryResponse(
            record.caseNumber(),
            record.status().apiCode(),
            record.subjectName(),
            record.createdAt(),
            record.updatedAt()
        );
    }
}
```

Kelebihan:

- eksplisit,
- native-friendly,
- mudah debug,
- no magic.

Kekurangan:

- boilerplate.

### 18.2 MapStruct

MapStruct cocok karena compile-time generation, bukan reflection-heavy.

```java
@Mapper(componentModel = "jakarta")
public interface CaseMapper {
    CaseSummaryResponse toSummary(CaseRecord record);
}
```

Kelebihan:

- compile-time,
- cepat,
- native-friendly relatif baik,
- mengurangi boilerplate.

Risiko:

- mapping implicit bisa menyembunyikan field leakage,
- perubahan nama field bisa berdampak tak terlihat jika tidak dikonfigurasi strict,
- complex mapping bisa sulit dibaca.

### 18.3 Jangan Gunakan ObjectMapper untuk Mapping Internal

Buruk:

```java
CaseResponse response = objectMapper.convertValue(entity, CaseResponse.class);
```

Masalah:

- mapping lewat serialization semantics,
- error runtime,
- field leakage,
- reflection/metadata complexity,
- sulit audit.

---

## 19. Input Normalization

Validasi dan normalization berbeda.

Validasi menjawab:

> Apakah input valid?

Normalization menjawab:

> Bagaimana input yang valid direpresentasikan secara konsisten?

Contoh normalization:

- trim whitespace,
- uppercase code,
- normalize phone number,
- normalize postal code,
- canonicalize email,
- convert empty string to null jika policy mengizinkan.

### 19.1 Jangan Normalisasi Diam-Diam Jika Berbahaya

Contoh:

```text
"ABC 123" → "ABC123"
```

Ini mungkin aman untuk postal code, tapi berbahaya untuk legal identifier jika spasi punya makna.

### 19.2 Normalize di Boundary atau Command Mapper

```java
public CreateCaseCommand toCommand(CreateCaseRequest request, SecurityIdentity identity) {
    return new CreateCaseCommand(
        request.subjectName().trim(),
        request.subjectId().trim().toUpperCase(Locale.ROOT),
        request.caseType(),
        identity.getPrincipal().getName(),
        clock.now()
    );
}
```

Dengan begini raw request tetap bisa diaudit jika perlu, sedangkan command sudah canonical.

---

## 20. Over-Posting and Mass Assignment

Over-posting terjadi saat client dapat mengirim field yang seharusnya tidak boleh dikontrol client.

Buruk:

```java
public class UserEntity {
    public String username;
    public String role;
    public boolean active;
}
```

Endpoint:

```java
@POST
public void create(UserEntity user) {
    repository.persist(user);
}
```

Client bisa mengirim:

```json
{
  "username": "fajar",
  "role": "ADMIN",
  "active": true
}
```

Solusi:

```java
public record CreateUserRequest(
    @NotBlank String username
) {}
```

Role dan active ditentukan server:

```java
User user = User.createStandardUser(request.username());
```

Rule:

> Field yang tidak boleh dikontrol client tidak boleh ada di request DTO.

---

## 21. Output Masking and Data Leakage

Response DTO harus mempertimbangkan siapa pemanggilnya.

Contoh:

```java
public record CaseDetailResponse(
    String caseNumber,
    String status,
    String subjectName,
    String maskedIdentifier,
    List<ActionResponse> actions
) {}
```

Jangan expose raw identifier jika tidak perlu.

### 21.1 Role-Based Projection

Untuk role berbeda, jangan selalu gunakan DTO sama dengan field nullable.

Bisa gunakan DTO berbeda:

```java
public record PublicCaseResponse(...) {}
public record OfficerCaseResponse(...) {}
public record SupervisorCaseResponse(...) {}
```

Atau gunakan field-level masking service:

```java
public CaseDetailResponse toResponse(CaseRecord record, Viewer viewer) {
    return new CaseDetailResponse(
        record.caseNumber(),
        record.status().apiCode(),
        viewer.canViewSubjectName() ? record.subjectName() : "REDACTED",
        mask(record.subjectIdentifier()),
        actionMapper.toResponses(record.actions(), viewer)
    );
}
```

### 21.2 Audit Masking Decision

Untuk regulatory system, masking decision harus dapat diaudit:

- siapa melihat,
- field apa yang dimasking,
- policy mana yang digunakan,
- waktu akses.

---

## 22. API Versioning

Versioning bukan hanya `/v1` dan `/v2`.

Ada beberapa jenis versioning:

| Jenis | Contoh | Kapan dipakai |
|---|---|---|
| URI version | `/api/v1/cases` | Public API jelas, major version |
| Header version | `X-API-Version: 2` | Client controlled, cleaner URI |
| Media type version | `application/vnd.company.case.v2+json` | Mature public API |
| Field-level evolution | tambah optional field | Minor non-breaking change |
| Behavior version | old/new behavior by client | Migration complex |

### 22.1 Breaking vs Non-Breaking

Non-breaking biasanya:

- tambah optional request field,
- tambah response field,
- tambah enum response value dengan client tolerant,
- tambah endpoint baru,
- tambah error code baru jika documented as extensible.

Breaking biasanya:

- hapus field,
- rename field,
- ubah tipe field,
- ubah requiredness dari optional menjadi required,
- ubah meaning field,
- ubah enum value existing,
- ubah HTTP status untuk kondisi yang sama tanpa migration,
- ubah error body shape.

### 22.2 Compatibility Rule

Server harus konservatif terhadap request dan eksplisit terhadap response.

Client harus:

- ignore unknown response fields,
- handle unknown enum response values,
- not depend on field order,
- use error code not message text.

Server harus:

- tidak menghapus field tanpa deprecation,
- tidak mengubah meaning field diam-diam,
- tidak mengembalikan error internal detail,
- menjaga error code stabil.

---

## 23. Pagination, Sorting, and Filtering Contract

List endpoint sering menjadi sumber contract debt.

Buruk:

```http
GET /cases?page=1&size=10&sort=name
```

Tidak jelas:

- page 0-based atau 1-based?
- max size?
- sort field apa yang valid?
- sort direction?
- stable ordering?
- total count mahal atau tidak?

Lebih eksplisit:

```http
GET /cases?page=0&size=50&sort=createdAt,desc
```

Response:

```java
public record PageResponse<T>(
    List<T> items,
    PageMetadata page
) {}

public record PageMetadata(
    int page,
    int size,
    long totalElements,
    int totalPages,
    boolean hasNext
) {}
```

### 23.1 Offset vs Cursor

| Model | Cocok untuk | Risiko |
|---|---|---|
| Offset pagination | admin screen, small-medium dataset | inconsistent under mutation, large offset slow |
| Cursor pagination | high-volume feed/list | more complex, harder arbitrary jump |

Untuk regulatory case listing, offset sering cukup jika ada filter kuat dan index baik. Untuk high-volume event/audit stream, cursor lebih aman.

### 23.2 Sorting Whitelist

Jangan pass sort field langsung ke query tanpa whitelist.

```java
private static final Map<String, String> SORT_COLUMNS = Map.of(
    "createdAt", "createdDateTime",
    "caseNumber", "caseNumber",
    "status", "status"
);
```

Jika field tidak valid, return 400 dengan error contract jelas.

---

## 24. Partial Update: PUT vs PATCH

### 24.1 PUT

PUT mengganti representasi resource secara keseluruhan.

```http
PUT /cases/CASE-00000001
```

Request harus mengandung state lengkap yang bisa diganti.

### 24.2 PATCH

PATCH mengubah sebagian resource.

Masalah utama PATCH:

- absent vs null,
- field clearing,
- validation context,
- concurrency control,
- audit detail.

### 24.3 Prefer Command Endpoint untuk Workflow

Untuk domain workflow, jangan paksakan semuanya ke PATCH.

Buruk:

```http
PATCH /cases/CASE-1
{
  "status": "APPROVED"
}
```

Lebih baik:

```http
POST /cases/CASE-1/approve
{
  "remark": "Reviewed and approved"
}
```

Kenapa?

Karena approval bukan sekadar update field. Itu domain action dengan:

- authorization,
- state transition,
- audit,
- notification,
- transaction,
- event emission.

---

## 25. Idempotency Contract

Untuk command endpoint yang bisa di-retry, pertimbangkan idempotency key.

```http
POST /cases
Idempotency-Key: 01J0ABC...
```

Server menyimpan key + result untuk window tertentu.

Response retry harus konsisten:

- jika request sama: return same result,
- jika key sama tapi payload beda: return 409,
- jika key expired: documented behavior.

DTO:

```java
public record CreateCaseRequest(
    @NotBlank String subjectName,
    @NotBlank String subjectId,
    @NotNull CaseType caseType
) {}
```

Command:

```java
public record CreateCaseCommand(
    String idempotencyKey,
    String subjectName,
    String subjectId,
    CaseType caseType,
    String actor
) {}
```

Idempotency bukan validasi DTO. Ini application/infrastructure concern.

---

## 26. ETag and Optimistic Concurrency Contract

Untuk update resource, gunakan version.

Response:

```http
ETag: "case-123-v7"
```

Update:

```http
PUT /cases/CASE-1
If-Match: "case-123-v7"
```

Jika stale:

```http
409 Conflict
```

atau:

```http
412 Precondition Failed
```

Pilih dan dokumentasikan.

DTO internal:

```java
public record UpdateCaseCommand(
    String caseNumber,
    long expectedVersion,
    String remark,
    String actor
) {}
```

Entity:

```java
@Version
long version;
```

ETag membantu client memahami bahwa update berbenturan dengan perubahan lain.

---

## 27. OpenAPI Contract

Quarkus dapat menghasilkan OpenAPI melalui SmallRye OpenAPI.

Dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-openapi</artifactId>
</dependency>
```

OpenAPI berguna untuk:

- client generation,
- contract review,
- API governance,
- security review,
- documentation,
- integration testing.

### 27.1 Jangan Anggap Generated OpenAPI Selalu Cukup

Generated OpenAPI sering kurang menjelaskan:

- business error code,
- enum evolution rule,
- idempotency behavior,
- concurrency behavior,
- pagination semantics,
- rate limit,
- auth scope,
- deprecation.

Tambahkan annotation/documentation bila perlu.

### 27.2 API Contract Review Checklist

Sebelum endpoint dianggap production-ready:

- Request DTO eksplisit?
- Response DTO eksplisit?
- Tidak expose entity?
- Validation lengkap?
- Error response documented?
- Error code stabil?
- Auth requirement jelas?
- Idempotency perlu/tidak?
- Concurrency control perlu/tidak?
- Pagination/sorting/filtering jelas?
- Date/time timezone jelas?
- Enum evolution jelas?
- PII masking jelas?
- OpenAPI benar?
- Contract test ada?

---

## 28. Native Image Implications

Native image menyukai program yang metadata-nya jelas saat build.

Serialization yang terlalu dinamis dapat bermasalah:

- reflection-heavy mapper,
- runtime subtype discovery,
- dynamic proxies,
- classpath scanning runtime,
- polymorphic deserialization bebas,
- private field access via reflection,
- libraries yang membuat ObjectMapper sendiri.

### 28.1 Native-Friendly DTO

Native-friendly DTO biasanya:

- public record/class,
- constructor jelas,
- field/property jelas,
- tidak bergantung pada dynamic classloading,
- mapping compile-time/manual,
- serializer custom didaftarkan jelas,
- tidak expose entity graph kompleks.

### 28.2 Polymorphic Serialization

Contoh:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @JsonSubTypes.Type(value = EmailNotification.class, name = "EMAIL"),
    @JsonSubTypes.Type(value = SmsNotification.class, name = "SMS")
})
public sealed interface NotificationRequest permits EmailNotification, SmsNotification {}
```

Ini lebih baik daripada class name based polymorphism.

Buruk:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
```

Risiko:

- security risk,
- leaks Java class names,
- brittle,
- native metadata lebih sulit,
- backward compatibility buruk.

---

## 29. Security Implications of Serialization

Serialization bisa menjadi security boundary.

Risiko:

1. **Sensitive field leakage**  
   Field internal tidak sengaja muncul.

2. **Mass assignment**  
   Field internal bisa diisi client.

3. **Polymorphic deserialization attack**  
   Jika class name based polymorphism dibuka.

4. **Error detail leakage**  
   Exception detail diserialisasi ke client.

5. **PII in logs**  
   Request/response body dilog mentah.

6. **Unbounded payload**  
   Payload besar membuat memory pressure.

### 29.1 Jangan Log Body Mentah

Buruk:

```java
LOG.infof("request=%s", request);
```

Jika record `toString()` mengandung PII, bocor.

Lebih baik:

```java
LOG.infof("create case requested. subjectIdHash=%s actor=%s",
    hash(request.subjectId()), actor);
```

### 29.2 Output Whitelist

Response DTO adalah whitelist. Jangan gunakan blacklist seperti `@JsonIgnore` pada entity sebagai security control utama.

`@JsonIgnore` boleh membantu, tapi bukan boundary utama.

---

## 30. Request Size and Payload Governance

Contract juga mencakup ukuran.

Pertanyaan:

- Maksimal body size?
- Maksimal array length?
- Maksimal string length?
- Maksimal nesting depth?
- Maksimal file upload size?
- Apakah bulk endpoint punya item limit?

Contoh DTO bulk:

```java
public record BulkUpdateRequest(
    @NotEmpty
    @Size(max = 100)
    List<@Valid UpdateItemRequest> items
) {}
```

Tanpa limit, client bisa mengirim 100.000 item dan membuat:

- memory pressure,
- transaction terlalu lama,
- lock besar,
- timeout,
- partial failure sulit.

---

## 31. Contract for Bulk Operations

Bulk operation harus menjelaskan failure semantics.

Ada dua model:

### 31.1 All-or-Nothing

Jika satu gagal, semua gagal.

Cocok untuk:

- item saling terkait,
- transaction kecil,
- consistency lebih penting.

### 31.2 Partial Success

Sebagian berhasil, sebagian gagal.

Response:

```java
public record BulkUpdateResponse(
    int total,
    int success,
    int failed,
    List<BulkItemResult> results
) {}

public record BulkItemResult(
    String itemId,
    String status,
    String errorCode,
    String message
) {}
```

Cocok untuk:

- batch admin,
- independent items,
- high volume.

Tapi perlu audit dan retry design.

---

## 32. Multi-Tenant Contract Considerations

Jika service multi-tenant, tenant boundary harus jelas.

Pilihan:

- tenant dari token claim,
- tenant dari header,
- tenant dari path,
- tenant dari subdomain,
- tenant dari database routing.

Jangan sembarang percaya tenant dari request body.

Buruk:

```java
public record CreateCaseRequest(
    String tenantId,
    String subjectName
) {}
```

Jika tenant berasal dari security context, body tidak boleh menentukan tenant.

Lebih baik:

```java
TenantId tenantId = tenantResolver.fromSecurityIdentity(identity);
```

DTO tidak mengandung `tenantId` kecuali memang API administrative cross-tenant.

---

## 33. Contract Testing

Contract tidak cukup hanya didokumentasikan. Harus dites.

### 33.1 REST Assured Example

```java
@QuarkusTest
class CaseResourceTest {

    @Test
    void createCaseShouldRejectBlankSubjectName() {
        given()
            .contentType(ContentType.JSON)
            .body("""
                {
                  "subjectName": "",
                  "subjectId": "S1234567A",
                  "caseType": "COMPLIANCE"
                }
                """)
        .when()
            .post("/cases")
        .then()
            .statusCode(400)
            .body("code", equalTo("VALIDATION_ERROR"));
    }
}
```

### 33.2 Snapshot Test for Error Shape

Test bahwa error response tidak berubah sembarangan.

```java
.then()
    .body("type", equalTo("https://api.example.com/problems/validation-error"))
    .body("status", equalTo(400))
    .body("violations[0].field", equalTo("subjectName"));
```

### 33.3 Contract Regression Tests

Untuk setiap endpoint penting:

- valid request,
- invalid request,
- unauthorized,
- forbidden,
- not found,
- conflict,
- unknown enum,
- unknown field,
- date format invalid,
- max length exceeded,
- idempotency retry,
- stale version.

---

## 34. Example: Production-Grade Case Submission API

### 34.1 Request DTO

```java
public record SubmitCaseRequest(
    @NotBlank
    @Size(max = 120)
    String subjectName,

    @NotBlank
    @Pattern(regexp = "^[A-Z0-9]{8,20}$")
    String subjectIdentifier,

    @NotNull
    CaseType caseType,

    @Size(max = 2_000)
    String initialRemark
) {
    public SubmitCaseRequest {
        subjectName = normalize(subjectName);
        subjectIdentifier = normalizeUpper(subjectIdentifier);
        initialRemark = normalizeNullable(initialRemark);
    }

    private static String normalize(String value) {
        return value == null ? null : value.trim();
    }

    private static String normalizeUpper(String value) {
        return value == null ? null : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String normalizeNullable(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
```

### 34.2 Command

```java
public record SubmitCaseCommand(
    String idempotencyKey,
    String subjectName,
    String subjectIdentifier,
    CaseType caseType,
    String initialRemark,
    String actor,
    OffsetDateTime requestedAt
) {}
```

### 34.3 Response DTO

```java
public record SubmitCaseResponse(
    String caseNumber,
    String status,
    OffsetDateTime submittedAt
) {}
```

### 34.4 Resource

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseCommandService commandService;
    private final SecurityIdentity identity;
    private final Clock clock;

    public CaseResource(
        CaseCommandService commandService,
        SecurityIdentity identity,
        Clock clock
    ) {
        this.commandService = commandService;
        this.identity = identity;
        this.clock = clock;
    }

    @POST
    public Response submit(
        @HeaderParam("Idempotency-Key") String idempotencyKey,
        @Valid SubmitCaseRequest request
    ) {
        SubmitCaseCommand command = new SubmitCaseCommand(
            idempotencyKey,
            request.subjectName(),
            request.subjectIdentifier(),
            request.caseType(),
            request.initialRemark(),
            identity.getPrincipal().getName(),
            OffsetDateTime.now(clock)
        );

        SubmitCaseResult result = commandService.submit(command);

        SubmitCaseResponse response = new SubmitCaseResponse(
            result.caseNumber(),
            result.status().apiCode(),
            result.submittedAt()
        );

        return Response.status(Response.Status.CREATED)
            .entity(response)
            .build();
    }
}
```

### 34.5 Why This Design Is Better

- Request DTO tidak expose entity.
- Validation dilakukan di boundary.
- Normalization ringan dilakukan sebelum command.
- Actor tidak diambil dari request body.
- Idempotency key adalah command metadata.
- Response DTO minimal dan stabil.
- Domain status diekspos sebagai API code.
- Business logic berada di service/domain, bukan resource.

---

## 35. Error Contract Implementation Example

```java
public record ApiProblem(
    String type,
    String title,
    int status,
    String code,
    String detail,
    String instance,
    String traceId,
    List<ApiViolation> violations
) {
    public static ApiProblem validation(
        String instance,
        String traceId,
        List<ApiViolation> violations
    ) {
        return new ApiProblem(
            "https://api.example.com/problems/validation-error",
            "Validation failed",
            400,
            "VALIDATION_ERROR",
            "Request contains invalid fields",
            instance,
            traceId,
            violations
        );
    }

    public static ApiProblem conflict(
        String code,
        String detail,
        String instance,
        String traceId
    ) {
        return new ApiProblem(
            "https://api.example.com/problems/conflict",
            "Conflict",
            409,
            code,
            detail,
            instance,
            traceId,
            List.of()
        );
    }
}

public record ApiViolation(
    String field,
    String message,
    String code
) {}
```

Validation mapper:

```java
@Provider
public class ApiConstraintViolationMapper implements ExceptionMapper<ConstraintViolationException> {

    @Context
    UriInfo uriInfo;

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        String traceId = TraceId.currentOrUnknown();

        List<ApiViolation> violations = exception.getConstraintViolations()
            .stream()
            .map(this::toViolation)
            .toList();

        ApiProblem problem = ApiProblem.validation(
            uriInfo.getPath(),
            traceId,
            violations
        );

        return Response.status(Response.Status.BAD_REQUEST)
            .entity(problem)
            .type(MediaType.APPLICATION_JSON)
            .build();
    }

    private ApiViolation toViolation(ConstraintViolation<?> violation) {
        return new ApiViolation(
            normalizePath(violation.getPropertyPath().toString()),
            violation.getMessage(),
            constraintCode(violation)
        );
    }

    private String normalizePath(String path) {
        int lastDot = path.lastIndexOf('.');
        return lastDot >= 0 ? path.substring(lastDot + 1) : path;
    }

    private String constraintCode(ConstraintViolation<?> violation) {
        return violation.getConstraintDescriptor()
            .getAnnotation()
            .annotationType()
            .getSimpleName()
            .toUpperCase(Locale.ROOT);
    }
}
```

---

## 36. API Contract and Audit Trail

Untuk sistem regulatory, API contract harus mendukung audit.

Pertanyaan audit:

- Siapa mengirim request?
- Endpoint apa?
- Request ID/trace ID apa?
- Payload valid atau invalid?
- Jika invalid, field mana yang invalid?
- Jika rejected karena business rule, rule apa?
- Jika conflict, version berapa yang diharapkan dan actual?
- Jika authorization denied, permission apa yang kurang?
- Data sensitif apa yang tidak boleh disimpan di audit?

### 36.1 Audit Event Example

```java
public record ApiAuditEvent(
    String eventId,
    String traceId,
    String actor,
    String action,
    String resourceType,
    String resourceId,
    String outcome,
    String errorCode,
    OffsetDateTime occurredAt
) {}
```

Jangan simpan full request body tanpa masking policy.

---

## 37. Common Anti-Patterns

### 37.1 Entity as API

```java
@GET
public List<CaseEntity> list() { ... }
```

Konsekuensi:

- schema leak,
- lazy load issue,
- N+1,
- backward compatibility rusak.

### 37.2 Validation Only in Frontend

Frontend validation membantu UX, bukan security.

Backend tetap wajib validate.

### 37.3 One Mega DTO

```java
public class CaseDto {
    public String caseNumber;
    public String status;
    public String subjectName;
    public String approvalRemark;
    public String rejectionReason;
    public String escalationLevel;
    public String internalRiskScore;
}
```

Dipakai untuk create, update, approve, reject, list, detail.

Konsekuensi:

- validation kacau,
- field nullable everywhere,
- over-posting risk,
- API meaning tidak jelas.

### 37.4 Error Message as Contract

Client membaca:

```json
{"message":"Case cannot be approved"}
```

Lalu client logic tergantung string itu.

Harus pakai error code stabil:

```json
{
  "code": "CASE_NOT_APPROVABLE",
  "detail": "Case cannot be approved in current status"
}
```

### 37.5 Dynamic Map Payload Everywhere

```java
public Response submit(Map<String, Object> payload) { ... }
```

Kadang perlu untuk truly dynamic metadata, tapi jangan jadikan default.

Risiko:

- no compile-time contract,
- no OpenAPI clarity,
- no validation clarity,
- native reflection/dynamic behavior,
- runtime failure.

### 37.6 Silent Unknown Field Ignoring Without Policy

Client mengirim typo:

```json
{
  "subjectNmae": "John"
}
```

Jika unknown ignored, validasi `subjectName` mungkin gagal jika required. Tapi jika field optional, bug bisa diam-diam.

Tentukan policy per endpoint.

---

## 38. Production Checklist

Sebelum API Quarkus dianggap production-grade:

### DTO Boundary

- [ ] Tidak expose entity sebagai request/response.
- [ ] Request DTO eksplisit per use case.
- [ ] Response DTO eksplisit per view.
- [ ] Command/query object terpisah dari external DTO jika perlu.
- [ ] Field sensitive tidak ada di response kecuali authorized.
- [ ] Over-posting dicegah.

### Validation

- [ ] Required fields jelas.
- [ ] String length limit ada.
- [ ] Pattern validation untuk code/id penting.
- [ ] List/bulk size limit ada.
- [ ] Date range validation ada.
- [ ] Business validation tidak disembunyikan di annotation IO-heavy.
- [ ] Validation error response stabil.

### Serialization

- [ ] Jackson atau JSON-B dipilih konsisten.
- [ ] Date/time format jelas.
- [ ] Enum evolution policy jelas.
- [ ] Null semantics jelas.
- [ ] ObjectMapper/customizer terpusat.
- [ ] Tidak membuat ObjectMapper ad hoc.
- [ ] Polymorphic deserialization aman.

### Error Contract

- [ ] Error taxonomy jelas.
- [ ] Error code stabil.
- [ ] Internal error tidak bocor.
- [ ] Trace/correlation ID tersedia.
- [ ] Validation violation field path stabil.
- [ ] Authentication/authorization error tidak membocorkan resource existence secara tidak sengaja.

### Compatibility

- [ ] Breaking/non-breaking rule terdokumentasi.
- [ ] OpenAPI diperiksa.
- [ ] Deprecated field punya timeline.
- [ ] Client tidak tergantung message text.
- [ ] Versioning strategy jelas.

### Security and Audit

- [ ] PII masking policy jelas.
- [ ] Request/response body tidak dilog mentah.
- [ ] Audit event menangkap outcome penting.
- [ ] Tenant tidak dipercaya dari body jika berasal dari identity.
- [ ] Payload size limit dikontrol.

### Native and Build-Time

- [ ] DTO native-friendly.
- [ ] Mapping tidak reflection-heavy tanpa kebutuhan.
- [ ] Polymorphic model eksplisit.
- [ ] Serialization library compatible dengan native mode.
- [ ] Native image test mencakup endpoint penting.

---

## 39. Top 1% Engineering Lens

Engineer biasa bertanya:

> “Bagaimana cara validasi request di Quarkus?”

Engineer kuat bertanya:

> “Apa boundary antara invalid input, invalid state, unauthorized action, stale update, duplicate command, dan downstream failure?”

Engineer top-tier bertanya:

> “Bagaimana API contract ini berevolusi 3 tahun tanpa merusak client, tetap aman, tetap observable, tetap audit-defensible, dan tetap compatible dengan native/cloud runtime?”

Itulah pergeseran mental modelnya.

---

## 40. Key Invariants

Pegang invariants berikut:

1. **Entity is not API contract.**
2. **DTO is a semantic firewall.**
3. **Validation is layered.**
4. **Business validation belongs near use case/domain.**
5. **Error response is part of the API.**
6. **Error code must be stable; message is not contract logic.**
7. **Date/time must include clear timezone semantics.**
8. **Enum response must be evolvable.**
9. **Null semantics must be explicit.**
10. **Serialization is a security boundary.**
11. **OpenAPI is necessary but not sufficient.**
12. **Native image punishes dynamic ambiguity.**
13. **Contract compatibility is cheaper than migration chaos.**
14. **Auditability starts at the API boundary.**
15. **A good API tells clients what happened without exposing how internals failed.**

---

## 41. Mini Exercise

Desain endpoint berikut:

```text
POST /cases/{caseNumber}/escalate
```

Requirement:

- User harus punya permission `CASE_ESCALATE`.
- Case hanya bisa diescalate dari status `SUBMITTED` atau `UNDER_REVIEW`.
- Request wajib punya `reason`, maksimal 1000 karakter.
- Optional `targetTeam`.
- Jika client retry karena timeout, operasi tidak boleh double-escalate.
- Jika case sudah berubah status, return conflict.
- Audit harus mencatat actor, previous status, new status, reason hash, trace id.

Pertanyaan desain:

1. Apa request DTO-nya?
2. Apa command object-nya?
3. Apa response DTO-nya?
4. Apa validation annotation-nya?
5. Apa business validation-nya?
6. Apa error code untuk invalid state?
7. Apakah butuh idempotency key?
8. Apakah butuh optimistic locking?
9. Apa yang boleh dilog?
10. Apa yang masuk audit trail?

Jika kamu bisa menjawab ini dengan jelas, kamu sudah mulai berpikir pada level contract engineering, bukan CRUD endpoint.

---

## 42. Referensi Resmi dan Lanjutan

Referensi utama:

- Quarkus — Validation with Hibernate Validator: https://quarkus.io/guides/validation
- Quarkus — Writing REST Services with Quarkus REST: https://quarkus.io/guides/rest
- Quarkus — Writing JSON REST Services: https://quarkus.io/guides/rest-json
- Quarkus — Configuring JSON support: https://quarkus.io/guides/rest-json
- Quarkus — OpenAPI and Swagger UI: https://quarkus.io/guides/openapi-swaggerui
- Quarkus — Building a Native Executable: https://quarkus.io/guides/building-native-image
- Quarkus — REST Client: https://quarkus.io/guides/rest-client
- Quarkus — Hibernate ORM with Panache: https://quarkus.io/guides/hibernate-orm-panache
- Quarkiverse HTTP Problem extension: https://quarkus.io/extensions/io.quarkiverse.httpproblem/quarkus-http-problem/
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html

---

# Status Part

**Part 014 selesai.**

Seri belum selesai dan belum mencapai bagian terakhir.

Part berikutnya:

**Part 015 — Security I: Authentication, OIDC, Keycloak, JWT, Token Propagation**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-013.md">⬅️ Part 013 — Transaction Engineering: Narayana, JTA, Reactive Transactions, Outbox, dan Consistency Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-015.md">Part 015 — Security I: Authentication, OIDC, Keycloak, JWT, Token Propagation ➡️</a>
</div>

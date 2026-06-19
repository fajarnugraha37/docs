# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-008

# Part 008 — REST Layer Deep Dive: Quarkus REST, RESTEasy Reactive, Routing, Filters, Exception Mapping

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / Top 1% Software Engineer Track  
> Fokus: REST layer Quarkus modern sebagai execution boundary, contract boundary, error boundary, dan performance boundary.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membangun fondasi berikut:

- Part 000: orientasi seri dan strategi belajar.
- Part 001: mental model Quarkus sebagai build-time optimized runtime.
- Part 002: version strategy Java 8 sampai 25, Quarkus 2/3, Jakarta migration.
- Part 003: internal architecture, build steps, augmentation, Jandex, Arc, extension model.
- Part 004: dev mode, continuous testing, Dev UI, Dev Services.
- Part 005: project structure, Maven/Gradle, BOM, extension governance.
- Part 006: configuration architecture.
- Part 007: CDI with Arc.

Part ini masuk ke lapisan yang paling terlihat oleh user dan client sistem: **REST API**.

Tetapi target part ini bukan mengulang dasar JAX-RS/Jakarta REST seperti:

- apa itu `@Path`,
- apa itu `@GET`,
- apa itu JSON,
- apa itu HTTP status code,
- apa itu DTO,
- apa itu request/response.

Hal-hal itu sudah dianggap selesai dari seri sebelumnya.

Target part ini adalah memahami Quarkus REST sebagai kombinasi dari:

1. **HTTP routing boundary**  
   Bagaimana request masuk, dicocokkan ke endpoint, dan dieksekusi.

2. **Execution model boundary**  
   Apakah endpoint berjalan di event loop, worker thread, atau virtual thread.

3. **Serialization boundary**  
   Bagaimana body dikonversi ke object dan object dikonversi ke response.

4. **Validation boundary**  
   Bagaimana input ditolak sebelum masuk ke domain logic.

5. **Error boundary**  
   Bagaimana exception berubah menjadi API error contract.

6. **Security boundary**  
   Bagaimana identity dan permission masuk ke REST layer.

7. **Observability boundary**  
   Bagaimana setiap request punya trace, correlation, metric, audit signal.

8. **Production boundary**  
   Bagaimana API tetap predictable saat traffic tinggi, downstream lambat, payload besar, atau client salah.

Quarkus REST harus dipahami bukan sebagai “controller layer”, tetapi sebagai **public protocol adapter** antara dunia HTTP dan application/domain core.

---

## 1. Quarkus REST: Nama Baru, Mental Model Lama yang Harus Diperbaiki

Pada Quarkus modern, istilah yang dipakai adalah **Quarkus REST**. Sebelumnya banyak orang mengenalnya sebagai **RESTEasy Reactive**. Rename ini penting karena kata “Reactive” sering membuat orang salah paham seolah-olah semua aplikasi harus menulis `Uni<T>` dan `Multi<T>`.

Mental model yang lebih tepat:

> Quarkus REST adalah implementasi Jakarta REST di atas reactive HTTP runtime Quarkus, tetapi endpoint aplikasi boleh imperative, blocking, reactive, atau virtual-thread-based.

Artinya:

- infrastrukturnya reactive,
- routing-nya efisien,
- banyak metadata diproses saat build,
- tetapi cara menulis endpoint bisa tetap familiar seperti Jakarta REST.

Contoh imperative endpoint:

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseApplicationService service;

    public CaseResource(CaseApplicationService service) {
        this.service = service;
    }

    @POST
    public Response create(CreateCaseRequest request) {
        CaseId id = service.create(request);
        return Response.status(Response.Status.CREATED)
                .entity(new CreateCaseResponse(id.value()))
                .build();
    }
}
```

Contoh reactive endpoint:

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final ReactiveCaseApplicationService service;

    public CaseResource(ReactiveCaseApplicationService service) {
        this.service = service;
    }

    @POST
    public Uni<Response> create(CreateCaseRequest request) {
        return service.create(request)
                .map(id -> Response.status(Response.Status.CREATED)
                        .entity(new CreateCaseResponse(id.value()))
                        .build());
    }
}
```

Keduanya valid, tetapi trade-off-nya berbeda.

Kesalahan umum engineer menengah:

> “Quarkus REST reactive berarti semua endpoint harus non-blocking.”

Kesalahan engineer advanced yang terlalu idealis:

> “Semua blocking code harus dihindari total.”

Mental model top-tier:

> REST layer harus memilih execution model berdasarkan dependency graph endpoint: apakah dia memanggil JDBC, filesystem, CPU-heavy logic, non-blocking client, messaging, atau hanya memory lookup.

---

## 2. REST Layer sebagai Adapter, Bukan Tempat Domain Logic

Dalam arsitektur yang sehat, REST resource bukan “tempat bisnis proses”. REST resource adalah adapter.

Struktur tanggung jawab ideal:

```text
HTTP Request
    |
    v
REST Resource
    - bind HTTP input
    - validate protocol-level constraint
    - extract identity/correlation
    - call application service
    - map application result to HTTP response
    |
    v
Application Service
    - orchestrate use case
    - transaction boundary
    - authorization domain-level
    - call repository/integration/event publisher
    |
    v
Domain Model / Workflow / Policy
    - invariant
    - state transition
    - business decision
```

REST resource boleh tahu tentang:

- HTTP method,
- path,
- query parameter,
- header,
- status code,
- content type,
- request DTO,
- response DTO,
- security identity,
- correlation ID,
- exception-to-response mapping.

REST resource sebaiknya tidak menjadi tempat:

- state machine utama,
- entitlement/permission domain kompleks,
- SQL query detail,
- Kafka publishing detail,
- retry loop external API,
- mapping entity langsung ke response tanpa kontrol,
- audit trail domain final,
- long-running orchestration.

Contoh buruk:

```java
@Path("/applications")
public class ApplicationResource {

    @POST
    @Transactional
    public Response submit(SubmitApplicationRequest request) {
        ApplicationEntity entity = new ApplicationEntity();
        entity.status = "SUBMITTED";
        entity.submittedAt = LocalDateTime.now();
        entity.applicantName = request.applicantName();

        entity.persist();

        if (request.requiresScreening()) {
            ScreeningEntity screening = new ScreeningEntity();
            screening.application = entity;
            screening.status = "PENDING";
            screening.persist();
        }

        // more branching...
        // send email...
        // write audit...
        // call external system...

        return Response.ok().build();
    }
}
```

Masalah:

- REST resource menjadi transaction script besar.
- Domain transition tersebar.
- Sulit dites tanpa HTTP.
- Audit logic rawan tidak konsisten.
- Error handling bercampur dengan business flow.
- Authorization cenderung endpoint-level saja.
- Future channel lain, misalnya batch/import/messaging, tidak bisa reuse use case.

Contoh lebih sehat:

```java
@Path("/applications")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class ApplicationResource {

    private final SubmitApplicationUseCase submitApplication;

    public ApplicationResource(SubmitApplicationUseCase submitApplication) {
        this.submitApplication = submitApplication;
    }

    @POST
    public Response submit(
            @Valid SubmitApplicationHttpRequest request,
            @Context SecurityContext securityContext,
            @HeaderParam("X-Correlation-Id") String correlationId
    ) {
        SubmitApplicationCommand command = request.toCommand(
                securityContext.getUserPrincipal().getName(),
                CorrelationId.fromNullable(correlationId)
        );

        SubmitApplicationResult result = submitApplication.handle(command);

        return Response.status(Response.Status.CREATED)
                .entity(SubmitApplicationHttpResponse.from(result))
                .build();
    }
}
```

Perhatikan pemisahan:

- HTTP request DTO berbeda dari command.
- HTTP response DTO berbeda dari domain result.
- Security principal diekstrak di boundary.
- Use case menjadi pusat orchestration.
- REST hanya mapping protocol.

---

## 3. Quarkus REST Dependency dan Extension Landscape

Untuk REST JSON service modern biasanya dependency minimal:

### Maven

```xml
<dependencies>
    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-rest</artifactId>
    </dependency>

    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-rest-jackson</artifactId>
    </dependency>

    <dependency>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-hibernate-validator</artifactId>
    </dependency>
</dependencies>
```

Atau kalau memakai JSON-B:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-rest-jsonb</artifactId>
</dependency>
```

Pilihan umum enterprise modern biasanya Jackson karena:

- ecosystem luas,
- module untuk Java time matang,
- customization fleksibel,
- banyak library integrasi memakai Jackson,
- DTO polymorphism lebih umum dikenal.

Namun JSON-B bisa lebih cocok jika tim sangat Jakarta EE oriented dan ingin standard API.

Dependency terkait REST lain:

```xml
<!-- OpenAPI / Swagger UI -->
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-openapi</artifactId>
</dependency>

<!-- Metrics / Observability -->
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-micrometer</artifactId>
</dependency>

<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-opentelemetry</artifactId>
</dependency>

<!-- Security -->
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-oidc</artifactId>
</dependency>

<!-- Fault tolerance, mostly for outbound calls/service methods -->
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-fault-tolerance</artifactId>
</dependency>
```

Important distinction:

```text
quarkus-rest
    -> server-side REST API

quarkus-rest-client / quarkus-rest-client-jackson
    -> outbound HTTP client
```

Jangan mencampur mental model inbound REST resource dan outbound REST client. Keduanya sama-sama HTTP, tetapi failure semantics, timeout, retry, dan observability-nya berbeda.

---

## 4. Routing Model: Dari HTTP Request ke Java Method

Secara konseptual, request diproses seperti ini:

```text
Client
  |
  v
HTTP server / Vert.x layer
  |
  v
Quarkus routing layer
  |
  v
REST resource matching
  |
  v
Request filters
  |
  v
Parameter binding + body reading
  |
  v
Validation
  |
  v
Resource method invocation
  |
  v
Response filters / writer interceptors
  |
  v
HTTP response
```

Routing ditentukan oleh kombinasi:

- base path aplikasi,
- class-level `@Path`,
- method-level `@Path`,
- HTTP method annotation,
- media type consumes/produces,
- path parameter,
- query parameter,
- matrix parameter jika digunakan,
- matching priority.

Contoh:

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CaseResource {

    @GET
    public List<CaseSummaryResponse> search(
            @QueryParam("status") String status,
            @QueryParam("assignedTo") String assignedTo,
            @DefaultValue("0") @QueryParam("page") int page,
            @DefaultValue("50") @QueryParam("size") int size
    ) {
        // ...
    }

    @GET
    @Path("/{caseId}")
    public CaseDetailResponse get(@PathParam("caseId") String caseId) {
        // ...
    }

    @POST
    @Path("/{caseId}/assignments")
    public Response assign(
            @PathParam("caseId") String caseId,
            @Valid AssignCaseRequest request
    ) {
        // ...
    }
}
```

### Routing discipline

Gunakan path sebagai representasi resource dan sub-resource, bukan action sembarangan.

Lebih baik:

```text
POST /cases/{caseId}/assignments
POST /cases/{caseId}/submissions
POST /cases/{caseId}/approvals
POST /cases/{caseId}/rejections
POST /cases/{caseId}/appeals
```

Kurang baik:

```text
POST /case/assignCase
POST /case/submitCase
POST /case/approveCase
POST /case/rejectCase
POST /case/createAppealForCase
```

Namun dalam enterprise workflow, jangan terlalu dogmatis. Kadang action resource lebih jelas daripada pura-pura REST murni.

Contoh yang masih masuk akal:

```text
POST /cases/{caseId}/actions/submit
POST /cases/{caseId}/actions/approve
POST /cases/{caseId}/actions/request-clarification
```

Kenapa ini bisa diterima?

Karena dalam workflow/state-machine, transition adalah domain concept. Daripada menyembunyikan transition ke update field status, lebih jujur membuat transition sebagai command resource.

Contoh buruk:

```http
PATCH /cases/123
Content-Type: application/json

{
  "status": "APPROVED"
}
```

Masalah:

- status terlihat seperti field update biasa,
- transition rule tersembunyi,
- permission bisa salah,
- audit event tidak spesifik,
- validasi state machine sulit,
- client bisa mengira status bebas diedit.

Contoh lebih defensible:

```http
POST /cases/123/approvals
Content-Type: application/json

{
  "decisionReason": "All requirements satisfied",
  "effectiveDate": "2026-06-20"
}
```

Atau:

```http
POST /cases/123/actions/approve
Content-Type: application/json

{
  "reason": "All requirements satisfied"
}
```

Top-tier REST design bukan sekadar “noun good, verb bad”. Yang penting:

- command jelas,
- invariant jelas,
- permission jelas,
- audit jelas,
- idempotency jelas,
- status code jelas,
- error contract jelas.

---

## 5. Base Path dan API Namespace

Quarkus memungkinkan konfigurasi root path aplikasi dan REST path.

Contoh umum:

```properties
quarkus.http.root-path=/api
```

Atau:

```properties
quarkus.rest.path=/v1
```

Tergantung versi dan extension, konfigurasi path harus dicek terhadap dokumentasi versi Quarkus yang dipakai. Tetapi desain API namespace-nya secara prinsip harus matang.

Contoh desain:

```text
/api/internal/v1/cases
/api/public/v1/applications
/api/admin/v1/users
```

Atau:

```text
/v1/cases
/v1/applications
/v1/reports
```

Guideline:

1. Jangan versioning terlalu granular per endpoint.
2. Jangan memasukkan environment ke path.
3. Jangan memasukkan implementation detail ke path.
4. Pisahkan external API dan internal API.
5. Pisahkan admin API dan user API.
6. Jangan expose module internal mentah-mentah jika domain boundary berbeda.

Contoh buruk:

```text
/dev/api/v1/case-management-service/case-entity-controller/getCaseById
```

Contoh lebih baik:

```text
/api/internal/v1/cases/{caseId}
```

---

## 6. Parameter Binding: Jangan Biarkan HTTP Shape Merusak Domain Shape

Quarkus REST mendukung binding parameter seperti Jakarta REST:

```java
@Path("/reports")
public class ReportResource {

    @GET
    public ReportResponse generate(
            @QueryParam("from") LocalDate from,
            @QueryParam("to") LocalDate to,
            @QueryParam("module") String module,
            @HeaderParam("X-Correlation-Id") String correlationId,
            @CookieParam("SESSION") String session
    ) {
        // ...
    }
}
```

Untuk endpoint sederhana ini cukup. Tetapi untuk endpoint kompleks, terlalu banyak parameter membuat method signature menjadi rapuh.

Buruk:

```java
@GET
public List<CaseSummaryResponse> search(
        @QueryParam("status") String status,
        @QueryParam("assignedTo") String assignedTo,
        @QueryParam("createdFrom") LocalDate createdFrom,
        @QueryParam("createdTo") LocalDate createdTo,
        @QueryParam("priority") String priority,
        @QueryParam("agency") String agency,
        @QueryParam("page") int page,
        @QueryParam("size") int size,
        @QueryParam("sort") String sort
) {
    // ...
}
```

Lebih baik gunakan parameter object jika cocok:

```java
public class CaseSearchQueryParams {

    @QueryParam("status")
    public String status;

    @QueryParam("assignedTo")
    public String assignedTo;

    @QueryParam("createdFrom")
    public LocalDate createdFrom;

    @QueryParam("createdTo")
    public LocalDate createdTo;

    @QueryParam("priority")
    public String priority;

    @QueryParam("agency")
    public String agency;

    @DefaultValue("0")
    @QueryParam("page")
    public int page;

    @DefaultValue("50")
    @QueryParam("size")
    public int size;

    @QueryParam("sort")
    public String sort;
}
```

Lalu:

```java
@GET
public List<CaseSummaryResponse> search(@BeanParam CaseSearchQueryParams params) {
    CaseSearchCriteria criteria = params.toCriteria();
    return service.search(criteria).stream()
            .map(CaseSummaryResponse::from)
            .toList();
}
```

Namun jangan biarkan `CaseSearchQueryParams` masuk ke service/domain. Itu tetap HTTP DTO.

Boundary yang baik:

```text
CaseSearchQueryParams  -> HTTP binding object
CaseSearchCriteria     -> application input model
CaseSearchSpecification -> domain/persistence search concept, jika perlu
```

---

## 7. Request DTO: Record, Class, Builder, dan Validation

Untuk request sederhana, Java record cocok:

```java
public record CreateCaseRequest(
        @NotBlank String applicantName,
        @NotBlank String applicationType,
        @NotNull LocalDate submittedDate
) {
    public CreateCaseCommand toCommand(String submittedBy) {
        return new CreateCaseCommand(
                applicantName,
                applicationType,
                submittedDate,
                submittedBy
        );
    }
}
```

Kelebihan record:

- immutable,
- ringkas,
- cocok untuk DTO,
- jelas sebagai data carrier,
- serialization-friendly jika dikonfigurasi benar.

Keterbatasan:

- tidak cocok untuk object dengan construction logic kompleks,
- nested optional field bisa sulit dibaca,
- validation group bisa kurang nyaman,
- backward compatibility perlu hati-hati.

Untuk request kompleks, class biasa bisa lebih jelas:

```java
public class SubmitApplicationRequest {

    @NotBlank
    private String applicationId;

    @NotNull
    private ApplicantSection applicant;

    @Valid
    @NotEmpty
    private List<DocumentSection> documents;

    public SubmitApplicationCommand toCommand(Actor actor) {
        return new SubmitApplicationCommand(
                ApplicationId.of(applicationId),
                applicant.toCommandPart(),
                documents.stream().map(DocumentSection::toCommandPart).toList(),
                actor
        );
    }

    // getters/setters or constructor depending Jackson configuration
}
```

### DTO design rules

1. Request DTO tidak harus sama dengan entity.
2. Response DTO tidak harus sama dengan entity.
3. Request DTO tidak harus sama dengan command.
4. Jangan expose database ID internal jika public contract butuh external reference.
5. Jangan expose enum internal yang mudah berubah.
6. Jangan menerima field yang tidak boleh client kontrol.
7. Jangan reuse DTO untuk create dan update jika constraint-nya berbeda.
8. Jangan reuse response detail untuk list jika list butuh projection ringan.

Buruk:

```java
@POST
public CaseEntity create(CaseEntity entity) {
    entity.persist();
    return entity;
}
```

Masalah:

- client bisa inject field internal,
- entity lifecycle bocor,
- lazy association bisa ikut terserialisasi,
- response contract terikat schema DB,
- migration entity menjadi breaking API,
- security risk field over-posting.

Lebih baik:

```java
@POST
public Response create(@Valid CreateCaseRequest request) {
    CreateCaseResult result = service.create(request.toCommand());

    return Response.status(Response.Status.CREATED)
            .entity(CreateCaseResponse.from(result))
            .build();
}
```

---

## 8. Response Design: Status Code Adalah Bagian dari Contract

REST response bukan hanya body JSON. Contract terdiri dari:

- status code,
- headers,
- content type,
- body shape,
- error shape,
- cache behavior,
- idempotency behavior,
- pagination metadata,
- correlation ID.

### Common status code discipline

```text
200 OK
    Request sukses dan response body tersedia.

201 Created
    Resource baru dibuat.

202 Accepted
    Command diterima tapi diproses async.

204 No Content
    Sukses tanpa response body.

400 Bad Request
    Request syntactically/semantically invalid di protocol/application boundary.

401 Unauthorized
    Authentication tidak ada/tidak valid.

403 Forbidden
    Authenticated tetapi tidak punya permission.

404 Not Found
    Resource tidak ditemukan atau sengaja disamarkan.

409 Conflict
    State conflict, version conflict, duplicate, invalid transition karena state saat ini.

412 Precondition Failed
    Conditional request gagal, misalnya ETag/If-Match.

415 Unsupported Media Type
    Content-Type tidak didukung.

422 Unprocessable Entity
    Valid JSON tetapi business validation gagal, jika organization memakai convention ini.

429 Too Many Requests
    Rate limit.

500 Internal Server Error
    Unexpected server failure.

503 Service Unavailable
    Dependency/service sementara tidak tersedia.
```

### Jangan semua error jadi 500

Buruk:

```java
try {
    service.approve(caseId);
    return Response.ok().build();
} catch (Exception e) {
    return Response.status(500).entity(e.getMessage()).build();
}
```

Masalah:

- client tidak bisa membedakan invalid request vs system failure,
- monitoring false positive,
- retry policy salah,
- security leak dari exception message,
- audit sulit.

Lebih baik:

```java
@POST
@Path("/{caseId}/approvals")
public Response approve(@PathParam("caseId") String caseId,
                        @Valid ApproveCaseRequest request) {
    ApproveCaseResult result = service.approve(request.toCommand(caseId));

    return Response.ok(ApproveCaseResponse.from(result)).build();
}
```

Exception mapping ditangani global:

```java
@Provider
public class InvalidStateTransitionMapper
        implements ExceptionMapper<InvalidStateTransitionException> {

    @Override
    public Response toResponse(InvalidStateTransitionException exception) {
        ApiError error = ApiError.conflict(
                "CASE_INVALID_STATE_TRANSITION",
                exception.safeMessage(),
                exception.correlationId()
        );

        return Response.status(Response.Status.CONFLICT)
                .entity(error)
                .type(MediaType.APPLICATION_JSON)
                .build();
    }
}
```

---

## 9. API Error Contract: Problem Details dan Domain Error Codes

Untuk enterprise service, error response harus stabil.

Contoh shape:

```json
{
  "code": "CASE_INVALID_STATE_TRANSITION",
  "message": "Case cannot be approved from DRAFT state.",
  "correlationId": "9e61b6a4-8886-4e37-91e4-4b829a648c8b",
  "details": [
    {
      "field": "caseId",
      "reason": "Current state is DRAFT. Expected SUBMITTED or UNDER_REVIEW."
    }
  ]
}
```

Atau mengikuti Problem Details style:

```json
{
  "type": "https://api.example.com/problems/case-invalid-state-transition",
  "title": "Invalid case state transition",
  "status": 409,
  "detail": "Case cannot be approved from DRAFT state.",
  "instance": "/cases/C-2026-001/approvals",
  "code": "CASE_INVALID_STATE_TRANSITION",
  "correlationId": "9e61b6a4-8886-4e37-91e4-4b829a648c8b"
}
```

Top-tier error design principles:

1. `code` stabil untuk programmatic handling.
2. `message` aman untuk user/client.
3. `correlationId` selalu ada.
4. Jangan expose stack trace.
5. Jangan expose SQL error mentah.
6. Jangan expose internal class name.
7. Field-level errors harus structured.
8. Domain conflict harus 409/422, bukan 500.
9. Authentication failure harus 401, authorization failure harus 403.
10. Unexpected error tetap punya generic response.

Contoh API error model:

```java
public record ApiError(
        String code,
        String message,
        String correlationId,
        List<ApiErrorDetail> details
) {
    public static ApiError of(String code, String message, String correlationId) {
        return new ApiError(code, message, correlationId, List.of());
    }

    public static ApiError validation(String correlationId, List<ApiErrorDetail> details) {
        return new ApiError(
                "VALIDATION_FAILED",
                "Request validation failed.",
                correlationId,
                details
        );
    }

    public static ApiError internal(String correlationId) {
        return new ApiError(
                "INTERNAL_SERVER_ERROR",
                "An unexpected error occurred.",
                correlationId,
                List.of()
        );
    }
}
```

```java
public record ApiErrorDetail(
        String field,
        String reason
) {
}
```

---

## 10. Exception Mapping Strategy

Exception mapper adalah salah satu bagian terpenting REST layer.

Tujuannya:

```text
Exception type -> HTTP status + API error body + log severity + metric label
```

Contoh taxonomy:

```text
ValidationException
    -> 400 or 422
    -> WARN
    -> client_error

EntityNotFoundException / ResourceNotFoundException
    -> 404
    -> INFO/WARN depending context
    -> client_error

UnauthorizedException
    -> 401
    -> INFO/WARN
    -> auth_error

ForbiddenException / AccessDeniedException
    -> 403
    -> WARN
    -> authz_error

OptimisticLockException
    -> 409
    -> WARN
    -> conflict

InvalidStateTransitionException
    -> 409
    -> WARN
    -> domain_conflict

DuplicateResourceException
    -> 409
    -> WARN
    -> conflict

ExternalDependencyTimeoutException
    -> 503 or 504
    -> ERROR
    -> dependency_failure

Unexpected Throwable
    -> 500
    -> ERROR
    -> server_error
```

Contoh mapper untuk validation:

```java
@Provider
public class ConstraintViolationExceptionMapper
        implements ExceptionMapper<ConstraintViolationException> {

    @Inject
    CorrelationIdProvider correlationIdProvider;

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        List<ApiErrorDetail> details = exception.getConstraintViolations()
                .stream()
                .map(violation -> new ApiErrorDetail(
                        violation.getPropertyPath().toString(),
                        violation.getMessage()
                ))
                .toList();

        ApiError error = ApiError.validation(
                correlationIdProvider.current(),
                details
        );

        return Response.status(Response.Status.BAD_REQUEST)
                .entity(error)
                .type(MediaType.APPLICATION_JSON)
                .build();
    }
}
```

Mapper untuk unexpected error:

```java
@Provider
public class UnexpectedExceptionMapper implements ExceptionMapper<Throwable> {

    private static final Logger LOG = Logger.getLogger(UnexpectedExceptionMapper.class);

    @Inject
    CorrelationIdProvider correlationIdProvider;

    @Override
    public Response toResponse(Throwable exception) {
        String correlationId = correlationIdProvider.current();

        LOG.errorf(exception,
                "Unexpected REST failure. correlationId=%s",
                correlationId);

        ApiError error = ApiError.internal(correlationId);

        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .entity(error)
                .type(MediaType.APPLICATION_JSON)
                .build();
    }
}
```

Hati-hati dengan catch-all mapper:

- Jangan menelan security exception yang seharusnya ditangani security layer.
- Jangan override behavior framework tanpa sadar.
- Jangan mengubah 404 static/resource menjadi 500.
- Jangan logging semua client error sebagai ERROR.

Production guideline:

```text
4xx normally log at INFO/WARN.
5xx log at ERROR.
Expected domain conflict should not page on-call.
Unexpected 5xx should be counted and alertable.
```

---

## 11. Filters: Cross-Cutting Concern di REST Boundary

Filter digunakan untuk concern yang terjadi sebelum/atau sesudah resource method.

Contoh use case:

- correlation ID,
- request logging,
- response header,
- security header,
- tenant resolution,
- API version header,
- request size guard,
- idempotency key extraction,
- maintenance mode,
- audit context initialization.

### ContainerRequestFilter style

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CorrelationIdRequestFilter implements ContainerRequestFilter {

    public static final String HEADER = "X-Correlation-Id";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String correlationId = requestContext.getHeaderString(HEADER);

        if (correlationId == null || correlationId.isBlank()) {
            correlationId = UUID.randomUUID().toString();
        }

        requestContext.setProperty(HEADER, correlationId);
        MDC.put("correlationId", correlationId);
    }
}
```

### ContainerResponseFilter

```java
@Provider
public class CorrelationIdResponseFilter implements ContainerResponseFilter {

    public static final String HEADER = "X-Correlation-Id";

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        Object correlationId = requestContext.getProperty(HEADER);
        if (correlationId != null) {
            responseContext.getHeaders().putSingle(HEADER, correlationId.toString());
        }
        MDC.remove("correlationId");
    }
}
```

### Quarkus REST-specific filters

Quarkus REST juga memiliki annotation filter seperti `@ServerRequestFilter` dan `@ServerResponseFilter`.

Contoh konseptual:

```java
public class SecurityHeadersFilter {

    @ServerResponseFilter
    public void addSecurityHeaders(ContainerResponseContext responseContext) {
        responseContext.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
        responseContext.getHeaders().putSingle("X-Frame-Options", "DENY");
    }
}
```

Gunakan filter untuk concern protocol-wide. Jangan gunakan filter untuk domain logic.

Buruk:

```java
@Provider
public class ApprovalFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        if (ctx.getUriInfo().getPath().contains("approve")) {
            // check DB state and approve case here
        }
    }
}
```

Ini salah karena filter menjadi hidden domain executor.

---

## 12. Request Logging: Jangan Log Body Sembarangan

Request logging tampak sederhana, tetapi mudah menjadi security incident.

Jangan log mentah:

- Authorization header,
- cookie,
- password,
- token,
- NRIC/NIK/PII,
- file upload content,
- full payload besar,
- sensitive financial/medical data,
- signed URL,
- OTP,
- secret.

Logging yang baik:

```text
timestamp
correlationId
method
path template
status
latency_ms
principal/user id, jika aman
client app id, jika ada
request size
response size
error code
```

Contoh log:

```json
{
  "event": "http_request_completed",
  "correlationId": "4a9e3e0f",
  "method": "POST",
  "path": "/cases/{caseId}/approvals",
  "status": 409,
  "latencyMs": 38,
  "principal": "user:12345",
  "errorCode": "CASE_INVALID_STATE_TRANSITION"
}
```

Hindari:

```json
{
  "authorization": "Bearer eyJhbGci...",
  "requestBody": "{\"password\":\"secret\", ... }"
}
```

Top-tier discipline:

> Log untuk operasi harus cukup untuk troubleshoot tanpa membuka data sensitif.

---

## 13. Blocking vs Non-Blocking Endpoint Semantics

Ini bagian kritikal Quarkus REST.

Karena Quarkus REST berada di atas reactive core, endpoint bisa berjalan dalam mode yang berbeda.

Secara mental:

```text
Event loop thread
    - untuk non-blocking work
    - sangat sedikit jumlahnya
    - tidak boleh diblokir
    - cocok untuk reactive pipeline, memory operation cepat, non-blocking IO

Worker thread
    - untuk blocking work
    - jumlah lebih banyak
    - cocok untuk JDBC, filesystem blocking, legacy SDK, CPU-light blocking IO

Virtual thread
    - untuk blocking-style code dengan concurrency tinggi
    - cocok untuk banyak IO blocking yang Loom-friendly
    - tetap harus hati-hati dengan pinning, pool bottleneck, JDBC driver behavior
```

### Endpoint imperative blocking

```java
@GET
@Path("/{caseId}")
public CaseDetailResponse get(@PathParam("caseId") String caseId) {
    return service.get(caseId);
}
```

Jika `service.get()` memakai blocking JDBC, endpoint harus dipastikan tidak berjalan di event loop.

Quarkus memiliki mekanisme smart dispatch dan annotation seperti `@Blocking`. Tetapi sebagai engineer advanced, jangan hanya mengandalkan default tanpa memahami konsekuensinya.

```java
@GET
@Path("/{caseId}")
@Blocking
public CaseDetailResponse get(@PathParam("caseId") String caseId) {
    return service.get(caseId);
}
```

### Endpoint non-blocking reactive

```java
@GET
@Path("/{caseId}")
public Uni<CaseDetailResponse> get(@PathParam("caseId") String caseId) {
    return service.get(caseId)
            .map(CaseDetailResponse::from);
}
```

Ini cocok jika seluruh chain non-blocking:

- reactive SQL client,
- reactive REST client,
- non-blocking Redis client,
- no blocking filesystem,
- no blocking lock wait,
- no long CPU computation.

### Mixed mistake

Buruk:

```java
@GET
@Path("/{caseId}")
public Uni<CaseDetailResponse> get(@PathParam("caseId") String caseId) {
    return Uni.createFrom().item(() -> jdbcRepository.find(caseId))
            .map(CaseDetailResponse::from);
}
```

Ini terlihat reactive, tetapi sebenarnya blocking. Kalau supplier dijalankan di event loop, event loop bisa macet.

Lebih baik jika memang harus wrap blocking:

```java
@GET
@Path("/{caseId}")
@Blocking
public CaseDetailResponse get(@PathParam("caseId") String caseId) {
    return CaseDetailResponse.from(jdbcRepository.find(caseId));
}
```

Atau offload secara eksplisit pada layer yang benar, tetapi jangan menjadikan reactive wrapper sebagai kosmetik.

### Decision table

| Workload Endpoint | Rekomendasi |
|---|---|
| JDBC/Hibernate ORM blocking | Imperative + worker thread / `@Blocking` |
| Hibernate Reactive | `Uni<T>` non-blocking |
| External HTTP via reactive client | `Uni<T>` non-blocking |
| External legacy SDK blocking | worker thread / virtual thread |
| CPU-heavy calculation | worker thread / dedicated executor, bukan event loop |
| Simple in-memory lookup | non-blocking bisa aman |
| File upload besar | streaming/non-blocking atau worker isolation |
| Report generation lama | async job + `202 Accepted`, bukan synchronous REST |

---

## 14. Virtual Threads di REST Layer

Virtual threads memberi opsi menarik: menulis kode blocking-style tanpa biaya thread platform sebanyak model tradisional.

Contoh konseptual:

```java
@GET
@Path("/{caseId}")
@RunOnVirtualThread
public CaseDetailResponse get(@PathParam("caseId") String caseId) {
    return service.get(caseId);
}
```

Virtual thread cocok saat:

- kode lebih mudah imperative,
- banyak blocking IO,
- dependency belum reactive,
- ingin menghindari callback/reactive chain kompleks,
- bottleneck bukan CPU,
- library tidak banyak melakukan pinning.

Tetapi virtual threads bukan sihir.

Tetap ada bottleneck:

- database connection pool,
- downstream rate limit,
- synchronized block pinning,
- native calls,
- CPU saturation,
- memory pressure,
- transaction duration,
- lock contention.

Jika 10.000 virtual threads semua menunggu DB, tetapi connection pool hanya 50, sistem tetap antre.

Mental model:

```text
Virtual thread memperkecil biaya menunggu.
Virtual thread tidak memperbesar kapasitas dependency.
```

Jangan gunakan virtual threads untuk menyembunyikan desain buruk:

- endpoint report 2 menit,
- unbounded external calls,
- no timeout,
- no backpressure,
- no rate limit,
- no idempotency,
- no circuit breaker.

---

## 15. Serialization: Jackson/JSON-B sebagai Public Contract Compiler

Serialization sering dianggap mekanis. Padahal di REST API, serialization adalah contract.

Hal yang harus distandarkan:

- field naming,
- null behavior,
- date/time format,
- enum representation,
- unknown property behavior,
- decimal precision,
- polymorphic type handling,
- binary data representation,
- sensitive field exclusion.

### Date/time

Gunakan ISO-8601 secara konsisten.

```json
{
  "submittedAt": "2026-06-20T10:15:30+07:00",
  "effectiveDate": "2026-06-20"
}
```

Jangan campur:

```json
{
  "submittedAt": "20/06/2026 10:15",
  "effectiveDate": "20260620"
}
```

### Enum

Buruk:

```json
{
  "status": 3
}
```

Lebih baik:

```json
{
  "status": "UNDER_REVIEW"
}
```

Namun ingat: enum string tetap public contract. Jika nama enum internal berubah, API bisa breaking.

Untuk domain kompleks, pertimbangkan API enum terpisah:

```java
public enum CaseStatusDto {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Jangan expose domain enum langsung jika domain enum sering berubah.

### Null handling

Tentukan standar:

- field null tetap muncul,
- field null dihilangkan,
- empty list selalu `[]`,
- optional object null atau absent.

Untuk public API, konsistensi lebih penting daripada preferensi pribadi.

### Unknown property

Untuk request, ada dua strategi:

1. Strict: unknown property ditolak.
2. Lenient: unknown property diabaikan.

Strict lebih aman untuk regulated API karena client salah cepat diketahui.

Lenient lebih fleksibel untuk backward/forward compatibility, tetapi bisa menyembunyikan typo.

Contoh typo:

```json
{
  "applicantNmae": "John"
}
```

Jika unknown ignored, client mengira sukses padahal field penting hilang.

---

## 16. Validation Boundary: Protocol Validity vs Domain Validity

Validation punya layer.

```text
Protocol validation
    - JSON valid?
    - Content-Type benar?
    - required field ada?
    - type cocok?

Request validation
    - @NotBlank
    - @Size
    - @Pattern
    - @Email
    - @PastOrPresent

Application validation
    - applicant exists?
    - user can submit?
    - duplicate application?
    - referenced document belongs to applicant?

Domain validation
    - state transition valid?
    - policy rule satisfied?
    - invariant preserved?
```

Jangan menaruh semua validation di annotation.

Contoh annotation cocok:

```java
public record CreateUserRequest(
        @NotBlank
        @Size(max = 120)
        String name,

        @NotBlank
        @Email
        String email
) {
}
```

Contoh tidak cocok hanya annotation:

```text
User can approve this case only if:
- user belongs to assigned agency,
- case is in UNDER_REVIEW,
- case has no pending clarification,
- all mandatory documents are verified,
- approval threshold policy is satisfied,
- user is not the original submitter.
```

Itu domain/application rule.

REST resource cukup memanggil use case:

```java
@POST
@Path("/{caseId}/approvals")
public Response approve(@PathParam("caseId") String caseId,
                        @Valid ApproveCaseRequest request) {
    ApproveCaseCommand command = request.toCommand(caseId);
    ApproveCaseResult result = approveCase.handle(command);
    return Response.ok(ApproveCaseResponse.from(result)).build();
}
```

Jika domain rule gagal:

```java
throw new InvalidStateTransitionException(
        "CASE_INVALID_STATE_TRANSITION",
        "Case cannot be approved from current state."
);
```

Mapper mengubahnya ke 409.

---

## 17. Content Negotiation dan Media Type Discipline

Endpoint harus eksplisit tentang consume/produce.

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {
    // ...
}
```

Untuk download file:

```java
@GET
@Path("/{caseId}/documents/{documentId}/content")
@Produces(MediaType.APPLICATION_OCTET_STREAM)
public Response download(@PathParam("caseId") String caseId,
                         @PathParam("documentId") String documentId) {
    DocumentContent content = service.getContent(caseId, documentId);

    return Response.ok(content.stream())
            .header("Content-Disposition", "attachment; filename=\"" + content.safeFilename() + "\"")
            .build();
}
```

Jangan return file besar sebagai base64 JSON kecuali ada alasan kuat.

Buruk:

```json
{
  "filename": "report.pdf",
  "content": "JVBERi0xLjQKJ..."
}
```

Masalah:

- payload membesar,
- memory pressure,
- latency naik,
- browser/client handling lebih buruk,
- streaming sulit.

Lebih baik:

```http
GET /reports/123/content
Accept: application/pdf
```

Response:

```http
200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="report-123.pdf"
```

---

## 18. Streaming Response dan Large Payload

Large payload harus diperlakukan sebagai architecture decision.

Contoh kasus:

- export CSV 1 juta row,
- download PDF besar,
- upload attachment,
- report generation,
- bulk import validation result,
- audit trail export.

Jangan default ke `List<T>` besar.

Buruk:

```java
@GET
@Path("/audit-trails/export")
public List<AuditTrailResponse> export() {
    return service.exportAll();
}
```

Masalah:

- memory spike,
- GC pressure,
- timeout,
- client disconnect handling buruk,
- DB cursor/resource leak,
- response tidak mulai sampai semua data siap.

Lebih baik pikirkan:

1. Pagination.
2. Cursor-based pagination.
3. Streaming file.
4. Async export job.
5. Object storage pre-signed download.
6. Backpressure.

Untuk export besar:

```text
POST /audit-trail-exports
    -> 202 Accepted
    -> returns exportJobId

GET /audit-trail-exports/{exportJobId}
    -> status: PENDING/RUNNING/COMPLETED/FAILED

GET /audit-trail-exports/{exportJobId}/content
    -> download file when completed
```

Ini jauh lebih production-safe daripada endpoint synchronous yang menahan request 5 menit.

---

## 19. Pagination, Sorting, Filtering

List endpoint harus punya strategi sejak awal.

Offset pagination:

```http
GET /cases?page=0&size=50&sort=createdAt,desc
```

Cocok untuk:

- data kecil-menengah,
- UI admin,
- query sederhana.

Masalah:

- page besar makin lambat,
- data berubah bisa duplicate/skip,
- count query mahal,
- tidak cocok untuk high-volume event/audit log.

Cursor pagination:

```http
GET /audit-trails?limit=100&after=eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTIwVDEwOjAwOjAwWiIsImlkIjoiMTIzIn0
```

Cocok untuk:

- append-heavy data,
- audit trail,
- activity feed,
- high-volume records.

Response:

```json
{
  "items": [
    { "id": "A1", "activity": "CASE_CREATED" }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTIwVDEwOjAxOjAwWiIsImlkIjoiQTEifQ"
}
```

Sorting whitelist penting.

Buruk:

```java
String sort = queryParamSort;
repository.find("order by " + sort);
```

Lebih baik:

```java
public enum CaseSortField {
    CREATED_AT("createdAt"),
    UPDATED_AT("updatedAt"),
    PRIORITY("priority");

    private final String persistenceField;

    CaseSortField(String persistenceField) {
        this.persistenceField = persistenceField;
    }

    public String persistenceField() {
        return persistenceField;
    }
}
```

Filtering juga harus dikontrol:

- field yang boleh difilter,
- operator yang boleh dipakai,
- max date range,
- max page size,
- default sort stable,
- index DB tersedia.

REST API search bukan hanya problem HTTP. Itu juga problem database performance.

---

## 20. Idempotency untuk Command Endpoint

Command endpoint seperti create, submit, approve, pay, upload, send email, publish event harus memikirkan duplicate request.

Client bisa retry karena:

- timeout,
- network drop,
- gateway retry,
- user double click,
- mobile reconnect,
- browser refresh,
- message redelivery.

Untuk create command:

```http
POST /applications
Idempotency-Key: 01J0ZSWM4W0Z9H4QAJ3VA1W0QY
```

Server menyimpan:

```text
idempotency_key
request_hash
response_status
response_body_ref
created_at
expires_at
principal/client_id
```

Jika request sama dikirim ulang:

- return response yang sama,
- jangan create resource kedua,
- jangan kirim email kedua,
- jangan publish event kedua.

Jika key sama tapi payload beda:

```http
409 Conflict
```

Atau:

```json
{
  "code": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
  "message": "Idempotency key was already used with a different request payload.",
  "correlationId": "..."
}
```

Idempotency bukan hanya REST concern; harus terhubung ke transaction boundary.

Pseudo flow:

```text
receive request
  -> extract idempotency key
  -> hash normalized payload
  -> start transaction
  -> check key record
       if same completed: return stored result
       if same in-progress: return 409/425 or wait policy
       if same key different hash: 409
  -> execute command
  -> store idempotency result
  -> commit
  -> return response
```

---

## 21. Conditional Requests, ETag, and Optimistic Concurrency

Untuk update resource, race condition sering terjadi.

Contoh masalah:

```text
User A GET /cases/123 -> status UNDER_REVIEW, version 7
User B GET /cases/123 -> status UNDER_REVIEW, version 7
User A PATCH /cases/123 -> changes priority, version becomes 8
User B PATCH /cases/123 -> changes assignment, based on stale version 7
```

Jika tidak ada concurrency control, update B bisa menimpa perubahan A.

Gunakan ETag/If-Match atau explicit version field.

Response GET:

```http
200 OK
ETag: "case-123-v7"
```

Update:

```http
PATCH /cases/123
If-Match: "case-123-v7"
```

Jika version sudah berubah:

```http
412 Precondition Failed
```

Atau menggunakan body version:

```json
{
  "version": 7,
  "assignedTo": "officer-2"
}
```

Jika mismatch:

```http
409 Conflict
```

Untuk regulated workflow, optimistic concurrency sangat penting karena:

- approval tidak boleh berdasarkan state lama,
- assignment tidak boleh silent overwrite,
- document verification tidak boleh hilang,
- audit harus mencerminkan konflik.

---

## 22. Security Boundary di REST Resource

Quarkus REST resource bisa memakai annotation security:

```java
@Path("/admin/users")
@RolesAllowed("admin")
public class AdminUserResource {

    @GET
    public List<UserResponse> list() {
        return service.listUsers();
    }
}
```

Method-level:

```java
@POST
@Path("/{caseId}/approvals")
@RolesAllowed({"case-approver", "supervisor"})
public Response approve(@PathParam("caseId") String caseId,
                        @Valid ApproveCaseRequest request) {
    // ...
}
```

Tetapi endpoint role check tidak cukup untuk domain complex.

Contoh:

```text
Role: case-approver
Tetapi hanya boleh approve case:
- di agency yang sama,
- bukan case yang dia submit sendiri,
- status UNDER_REVIEW,
- assigned group cocok,
- threshold amount dalam limit approval dia.
```

Maka resource-level annotation hanya coarse gate.

Use case tetap harus check domain authorization:

```java
public ApproveCaseResult handle(ApproveCaseCommand command) {
    Case caseRecord = caseRepository.get(command.caseId());
    Actor actor = actorProvider.currentActor();

    authorizationPolicy.assertCanApprove(actor, caseRecord);
    caseRecord.approve(actor, command.reason());

    caseRepository.save(caseRecord);
    auditPublisher.caseApproved(caseRecord, actor);

    return ApproveCaseResult.from(caseRecord);
}
```

REST layer mengambil identity, application layer memutuskan permission domain.

---

## 23. CORS, Security Headers, dan Browser Boundary

Untuk API yang dipakai browser SPA, CORS harus dikonfigurasi eksplisit.

Kesalahan umum:

```properties
quarkus.http.cors=true
quarkus.http.cors.origins=*
```

Ini terlalu longgar jika API memakai credential/cookie.

Lebih baik:

```properties
quarkus.http.cors=true
quarkus.http.cors.origins=https://app.example.com
quarkus.http.cors.methods=GET,POST,PUT,PATCH,DELETE,OPTIONS
quarkus.http.cors.headers=Authorization,Content-Type,X-Correlation-Id,Idempotency-Key
quarkus.http.cors.exposed-headers=X-Correlation-Id,Location,ETag
```

Security headers umum:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy: ...
Cache-Control: no-store for sensitive responses
```

Untuk API murni backend-to-backend, CORS mungkin tidak perlu.

Jangan aktifkan CORS karena “biar frontend jalan” tanpa threat model.

---

## 24. OpenAPI: Contract Documentation Bukan Hiasan

Quarkus bisa generate OpenAPI dari REST annotations.

Dependency:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-openapi</artifactId>
</dependency>
```

OpenAPI berguna untuk:

- FE/BE contract,
- API review,
- generated client,
- security review,
- external partner integration,
- regression diff,
- documentation portal.

Tetapi generated OpenAPI buruk jika DTO dan annotation asal-asalan.

Tambahkan metadata yang jelas:

```java
@POST
@Operation(
        summary = "Approve a case",
        description = "Approves a case if the current actor is authorized and the case is in an approvable state."
)
@APIResponses({
        @APIResponse(responseCode = "200", description = "Case approved"),
        @APIResponse(responseCode = "400", description = "Invalid request"),
        @APIResponse(responseCode = "403", description = "Actor is not allowed to approve this case"),
        @APIResponse(responseCode = "404", description = "Case not found"),
        @APIResponse(responseCode = "409", description = "Case is not in approvable state")
})
@Path("/{caseId}/approvals")
public Response approve(@PathParam("caseId") String caseId,
                        @Valid ApproveCaseRequest request) {
    // ...
}
```

OpenAPI discipline:

1. Error response harus documented.
2. Security scheme harus documented.
3. Pagination model harus consistent.
4. Enum description harus jelas.
5. Deprecated field/endpoint harus diberi marker.
6. Internal endpoint jangan bocor ke public spec.
7. Generated spec harus divalidasi di CI jika dipakai contract governance.

---

## 25. REST Resource Testing

Quarkus menyediakan `@QuarkusTest` untuk menjalankan aplikasi dalam test mode.

Contoh test dengan REST Assured:

```java
@QuarkusTest
class CaseResourceTest {

    @Test
    void createCaseShouldReturnCreated() {
        given()
                .contentType(ContentType.JSON)
                .body("""
                        {
                          "applicantName": "John Doe",
                          "applicationType": "SALESPERSON",
                          "submittedDate": "2026-06-20"
                        }
                        """)
        .when()
                .post("/cases")
        .then()
                .statusCode(201)
                .body("caseId", notNullValue());
    }
}
```

Test taxonomy REST:

```text
Resource unit-ish test
    - resource + mocked service
    - verifies HTTP mapping

Quarkus integration test
    - actual CDI wiring
    - actual filters/mappers
    - test profile config

Contract test
    - OpenAPI/schema compatibility
    - consumer-driven if needed

Security test
    - 401 no token
    - 403 wrong role
    - 200 correct role
    - domain authorization denial

Error mapping test
    - validation error shape
    - not found shape
    - conflict shape
    - unexpected error shape

Performance smoke test
    - payload size
    - latency budget
    - no event loop blocking warning
```

### Test error contract

```java
@Test
void approveDraftCaseShouldReturnConflict() {
    given()
            .contentType(ContentType.JSON)
            .body("""
                    {
                      "reason": "Looks good"
                    }
                    """)
    .when()
            .post("/cases/C-DRAFT-001/approvals")
    .then()
            .statusCode(409)
            .body("code", equalTo("CASE_INVALID_STATE_TRANSITION"))
            .body("correlationId", notNullValue());
}
```

Testing harus memastikan API contract, bukan hanya happy path.

---

## 26. REST Performance Failure Modes

REST endpoint sering gagal bukan karena Java lambat, tetapi karena boundary salah.

### Failure mode 1: Event loop blocked

Gejala:

- latency tiba-tiba naik,
- throughput drop,
- warning event loop blocked,
- semua endpoint ikut lambat.

Penyebab:

- blocking JDBC di event loop,
- file IO blocking,
- synchronous external SDK,
- `Thread.sleep`,
- CPU-heavy JSON transformation,
- large payload parsing di path non-blocking.

Mitigasi:

- gunakan `@Blocking`,
- pindah ke worker/virtual thread,
- pakai reactive client end-to-end,
- isolate heavy workload,
- async job untuk workload panjang.

### Failure mode 2: Worker pool exhaustion

Gejala:

- request antre,
- latency tinggi,
- CPU belum tentu penuh,
- thread dump banyak WAITING/BLOCKED.

Penyebab:

- DB lambat,
- downstream timeout terlalu panjang,
- pool terlalu kecil,
- retry nested,
- report endpoint synchronous,
- lock contention.

Mitigasi:

- timeout budget,
- circuit breaker,
- bulkhead,
- async processing,
- pool sizing,
- query optimization.

### Failure mode 3: Serialization memory spike

Gejala:

- GC pressure,
- high RSS,
- OOM,
- slow response for large list.

Penyebab:

- return `List` sangat besar,
- entity graph terlalu luas,
- recursive serialization,
- base64 file,
- no pagination.

Mitigasi:

- projection,
- pagination,
- streaming,
- async export,
- DTO discipline.

### Failure mode 4: Error mapper leak

Gejala:

- response berisi SQL/internal message,
- security scan finding,
- client bergantung pada internal message.

Mitigasi:

- safe message,
- internal log detail,
- public error code,
- sanitize exception.

### Failure mode 5: Contract drift

Gejala:

- frontend tiba-tiba rusak,
- generated client tidak compatible,
- old client gagal setelah deploy.

Penyebab:

- rename field,
- enum berubah,
- null behavior berubah,
- status code berubah,
- error shape berubah.

Mitigasi:

- OpenAPI diff,
- semantic API versioning,
- contract test,
- deprecation policy,
- backward-compatible DTO.

---

## 27. REST Layer and Transaction Boundary

Jangan otomatis menaruh `@Transactional` di resource.

Bisa, tapi biasanya lebih baik transaction ada di application service.

Kurang ideal:

```java
@Path("/cases")
public class CaseResource {

    @POST
    @Transactional
    public Response create(CreateCaseRequest request) {
        return Response.ok(service.create(request)).build();
    }
}
```

Lebih baik:

```java
@ApplicationScoped
public class CreateCaseUseCase {

    @Transactional
    public CreateCaseResult handle(CreateCaseCommand command) {
        // transaction use case here
    }
}
```

Resource:

```java
@POST
public Response create(@Valid CreateCaseRequest request) {
    CreateCaseResult result = createCase.handle(request.toCommand());
    return Response.status(Response.Status.CREATED)
            .entity(CreateCaseResponse.from(result))
            .build();
}
```

Kenapa lebih baik?

- use case bisa dipanggil dari REST, batch, messaging,
- transaction boundary dekat dengan business operation,
- REST tidak menjadi owner persistence,
- testing use case lebih mudah,
- audit dan event publish bisa satu boundary.

Exception:

- sangat sederhana CRUD internal tool,
- prototype,
- generated resource,
- admin endpoint kecil.

Tetapi untuk top-tier enterprise architecture, application service boundary lebih defensible.

---

## 28. REST Layer and Auditability

Untuk sistem regulatory/case management, REST request bukan audit trail final.

Audit trail harus mencatat domain event, bukan sekadar HTTP access log.

HTTP access log:

```text
POST /cases/C-001/approvals -> 200 by user A
```

Domain audit:

```text
Case C-001 approved by user A at 2026-06-20T10:15:30+07:00
Previous state: UNDER_REVIEW
New state: APPROVED
Reason: All requirements satisfied
Policy version: approval-policy-v12
Correlation ID: ...
Request source: WEB_PORTAL
```

REST layer memberi context:

- principal,
- IP/client app,
- correlation ID,
- user agent,
- request channel,
- endpoint.

Domain/application layer menentukan audit event:

- action,
- actor,
- target aggregate,
- old/new state,
- decision reason,
- policy version,
- relevant references.

Jangan membuat audit hanya di filter:

```text
Filter only knows HTTP happened.
Use case knows what business event happened.
```

---

## 29. REST Endpoint Design for Workflow/State Machine Systems

Untuk sistem enforcement/case management, banyak endpoint adalah state transition.

Contoh lifecycle:

```text
DRAFT
  -> SUBMITTED
  -> SCREENING
  -> UNDER_REVIEW
  -> CLARIFICATION_REQUESTED
  -> UNDER_REVIEW
  -> APPROVED
  -> CLOSED
```

Endpoint sebaiknya merepresentasikan command:

```text
POST /cases/{caseId}/submissions
POST /cases/{caseId}/screenings
POST /cases/{caseId}/review-starts
POST /cases/{caseId}/clarification-requests
POST /cases/{caseId}/clarification-responses
POST /cases/{caseId}/approvals
POST /cases/{caseId}/closures
```

Atau action style:

```text
POST /cases/{caseId}/actions/submit
POST /cases/{caseId}/actions/start-screening
POST /cases/{caseId}/actions/request-clarification
POST /cases/{caseId}/actions/approve
POST /cases/{caseId}/actions/close
```

Pilih style yang paling jelas bagi API consumer.

Yang penting setiap transition punya:

- request DTO khusus,
- permission rule khusus,
- validation khusus,
- idempotency rule,
- audit event,
- error mapping,
- state conflict response,
- test matrix.

Contoh approval endpoint:

```java
@POST
@Path("/{caseId}/approvals")
@RolesAllowed("case-approver")
public Response approve(@PathParam("caseId") String caseId,
                        @HeaderParam("Idempotency-Key") String idempotencyKey,
                        @Valid ApproveCaseRequest request) {

    ApproveCaseCommand command = request.toCommand(caseId, idempotencyKey);
    ApproveCaseResult result = approveCase.handle(command);

    return Response.ok(ApproveCaseResponse.from(result)).build();
}
```

---

## 30. REST Anti-Patterns di Quarkus

### Anti-pattern 1: Entity as API

```java
@GET
public List<CaseEntity> list() {
    return CaseEntity.listAll();
}
```

Masalah:

- lazy loading,
- circular graph,
- sensitive fields,
- DB schema leaks,
- contract drift.

### Anti-pattern 2: Reactive by decoration

```java
public Uni<Response> create(Request request) {
    return Uni.createFrom().item(() -> blockingService.create(request));
}
```

Masalah:

- terlihat reactive,
- sebenarnya blocking,
- event loop risk.

### Anti-pattern 3: Catch exception di setiap resource

```java
try {
   ...
} catch (Exception e) {
   return Response.serverError().build();
}
```

Masalah:

- duplicated error logic,
- inconsistent response,
- lost observability,
- wrong status.

### Anti-pattern 4: God resource

```text
CaseResource with 80 endpoints and 5000 lines
```

Masalah:

- boundary blur,
- test sulit,
- ownership sulit,
- module coupling.

Split berdasarkan sub-resource/use case:

```text
CaseQueryResource
CaseSubmissionResource
CaseApprovalResource
CaseAssignmentResource
CaseDocumentResource
CaseAuditResource
```

### Anti-pattern 5: Everything POST

```text
POST /getCase
POST /searchCases
POST /deleteCase
```

Kadang POST untuk search kompleks bisa diterima, tetapi jangan jadikan semua endpoint RPC tanpa alasan.

### Anti-pattern 6: No timeout thinking

REST resource memanggil service yang memanggil external API tanpa timeout jelas.

Akibat:

- request menggantung,
- worker pool habis,
- upstream retry storm.

### Anti-pattern 7: No max payload

Endpoint menerima payload besar tanpa guard.

Akibat:

- memory pressure,
- abuse vector,
- accidental client bug bisa menjatuhkan service.

### Anti-pattern 8: Endpoint does too much synchronously

```text
POST /submit
  -> save DB
  -> generate PDF
  -> upload S3
  -> send email
  -> call external registry
  -> publish event
  -> update report table
```

Jika semua harus synchronous, latency dan failure coupling tinggi.

Pertimbangkan:

- transactional core,
- outbox,
- async workers,
- process state,
- `202 Accepted`.

---

## 31. Reference Architecture: REST Module Layout

Contoh package structure:

```text
src/main/java/com/example/caseapp/
  caseprocessing/
    api/
      CaseQueryResource.java
      CaseSubmissionResource.java
      CaseApprovalResource.java
      dto/
        CaseDetailResponse.java
        CaseSummaryResponse.java
        SubmitCaseRequest.java
        ApproveCaseRequest.java
        ApiError.java
        ApiErrorDetail.java
      mapper/
        CaseApiMapper.java
      error/
        CaseExceptionMappers.java
    application/
      SubmitCaseUseCase.java
      ApproveCaseUseCase.java
      SearchCaseUseCase.java
      command/
      result/
    domain/
      Case.java
      CaseStatus.java
      CasePolicy.java
      CaseStateMachine.java
    infrastructure/
      persistence/
      messaging/
      external/
  shared/
    api/
      CorrelationIdFilter.java
      SecurityHeadersFilter.java
      GlobalExceptionMapper.java
      RequestContext.java
```

Aturan:

- `api` tahu application.
- `application` tidak tahu HTTP/Jakarta REST.
- `domain` tidak tahu HTTP, CDI, JSON, database.
- `infrastructure` tahu database/external systems.
- shared API concern dipisah dan distandarkan.

Dependency direction:

```text
api -> application -> domain
application -> infrastructure ports/interfaces
infrastructure -> application/domain interfaces
```

Jangan:

```text
domain -> api DTO
domain -> Response
domain -> HttpHeaders
application -> ContainerRequestContext
```

---

## 32. Step-by-Step: Membuat REST Endpoint Production-Grade

Kasus: approve case.

### Step 1 — Tentukan command semantics

```text
POST /cases/{caseId}/approvals
```

Semantics:

- mencoba approve case,
- bukan update field status,
- menghasilkan domain event `CASE_APPROVED`,
- butuh permission `case-approver`,
- butuh idempotency key,
- conflict jika state tidak valid.

### Step 2 — Request DTO

```java
public record ApproveCaseRequest(
        @NotBlank
        @Size(max = 500)
        String reason,

        @NotNull
        LocalDate effectiveDate
) {
    public ApproveCaseCommand toCommand(String caseId,
                                        String idempotencyKey,
                                        String actorId,
                                        String correlationId) {
        return new ApproveCaseCommand(
                CaseId.of(caseId),
                reason,
                effectiveDate,
                IdempotencyKey.of(idempotencyKey),
                ActorId.of(actorId),
                CorrelationId.of(correlationId)
        );
    }
}
```

### Step 3 — Response DTO

```java
public record ApproveCaseResponse(
        String caseId,
        String status,
        String approvedAt,
        String approvedBy
) {
    public static ApproveCaseResponse from(ApproveCaseResult result) {
        return new ApproveCaseResponse(
                result.caseId().value(),
                result.status().name(),
                result.approvedAt().toString(),
                result.approvedBy().value()
        );
    }
}
```

### Step 4 — Resource method

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseApprovalResource {

    private final ApproveCaseUseCase approveCase;
    private final RequestContext requestContext;

    public CaseApprovalResource(ApproveCaseUseCase approveCase,
                                RequestContext requestContext) {
        this.approveCase = approveCase;
        this.requestContext = requestContext;
    }

    @POST
    @Path("/{caseId}/approvals")
    @RolesAllowed("case-approver")
    public Response approve(@PathParam("caseId") String caseId,
                            @HeaderParam("Idempotency-Key") String idempotencyKey,
                            @Valid ApproveCaseRequest request) {

        ApproveCaseCommand command = request.toCommand(
                caseId,
                idempotencyKey,
                requestContext.actorId(),
                requestContext.correlationId()
        );

        ApproveCaseResult result = approveCase.handle(command);

        return Response.ok(ApproveCaseResponse.from(result))
                .header("X-Correlation-Id", requestContext.correlationId())
                .build();
    }
}
```

### Step 5 — Exception mapping

```java
@Provider
public class CaseDomainExceptionMapper implements ExceptionMapper<CaseDomainException> {

    @Inject
    RequestContext requestContext;

    @Override
    public Response toResponse(CaseDomainException exception) {
        ApiError error = ApiError.of(
                exception.code(),
                exception.safeMessage(),
                requestContext.correlationId()
        );

        return Response.status(toStatus(exception))
                .entity(error)
                .type(MediaType.APPLICATION_JSON)
                .build();
    }

    private int toStatus(CaseDomainException exception) {
        return switch (exception.code()) {
            case "CASE_NOT_FOUND" -> 404;
            case "CASE_INVALID_STATE_TRANSITION" -> 409;
            case "CASE_APPROVAL_NOT_ALLOWED" -> 403;
            default -> 400;
        };
    }
}
```

### Step 6 — Test matrix

```text
POST /cases/{id}/approvals

Happy path:
- valid approver, valid state -> 200

Validation:
- blank reason -> 400
- missing effectiveDate -> 400

Auth:
- no token -> 401
- wrong role -> 403
- approver role but wrong agency -> 403

Domain:
- case not found -> 404
- case DRAFT -> 409
- already approved with same idempotency key -> return same success
- same idempotency key different payload -> 409

Observability:
- X-Correlation-Id returned
- audit event written
- no sensitive data in logs
```

---

## 33. Production Checklist untuk Quarkus REST Endpoint

Sebelum endpoint dianggap production-ready, cek:

### Contract

- [ ] Path merepresentasikan resource/command dengan jelas.
- [ ] HTTP method tepat.
- [ ] Status code documented.
- [ ] Request DTO tidak sama dengan entity.
- [ ] Response DTO tidak sama dengan entity.
- [ ] Error response konsisten.
- [ ] OpenAPI jelas.
- [ ] Backward compatibility dipikirkan.

### Validation

- [ ] Required field divalidasi.
- [ ] Length/range/pattern divalidasi.
- [ ] Unknown field strategy jelas.
- [ ] Domain validation di use case/domain.
- [ ] Error validation structured.

### Security

- [ ] Authentication enforced.
- [ ] Coarse role check ada jika perlu.
- [ ] Domain authorization ada di use case.
- [ ] Sensitive fields tidak keluar.
- [ ] CORS tidak terlalu longgar.
- [ ] Security headers sesuai kebutuhan.

### Execution

- [ ] Blocking/non-blocking model benar.
- [ ] Tidak blocking event loop.
- [ ] Timeout downstream jelas.
- [ ] Long-running workload tidak synchronous.
- [ ] Payload size dipertimbangkan.

### Persistence/Transaction

- [ ] Transaction boundary di use case.
- [ ] Optimistic locking/concurrency dipikirkan.
- [ ] Idempotency untuk command penting.
- [ ] No N+1 accidental serialization.

### Observability

- [ ] Correlation ID masuk dan keluar.
- [ ] Logs structured.
- [ ] Error code masuk log/metric.
- [ ] Metrics per endpoint tersedia.
- [ ] Trace propagation bekerja.
- [ ] Audit event domain dicatat jika perlu.

### Testing

- [ ] Happy path.
- [ ] Validation errors.
- [ ] Auth/authz errors.
- [ ] Domain conflict.
- [ ] Not found.
- [ ] Unexpected error mapper.
- [ ] Contract/OpenAPI test jika applicable.
- [ ] Native image test jika service target native.

---

## 34. Mini Case Study: REST API untuk Regulatory Case Approval

### Problem

Sistem punya case approval flow. Officer bisa approve hanya jika:

- user authenticated,
- user punya role approver,
- user berada di agency yang sama,
- case status `UNDER_REVIEW`,
- semua document mandatory verified,
- user bukan submitter,
- approval reason wajib,
- duplicate request harus idempotent,
- semua action harus audit-able.

### Weak design

```http
PATCH /cases/123

{
  "status": "APPROVED"
}
```

Resource:

```java
@PATCH
@Path("/{id}")
@Transactional
public CaseEntity update(@PathParam("id") String id, CaseEntity input) {
    CaseEntity entity = CaseEntity.findById(id);
    entity.status = input.status;
    return entity;
}
```

Masalah fatal:

- client bisa update status langsung,
- no explicit approval command,
- no domain authorization,
- no state transition invariant,
- audit tidak lengkap,
- response expose entity,
- no idempotency,
- no conflict semantics.

### Strong design

Endpoint:

```http
POST /cases/123/approvals
Idempotency-Key: 01J0ZSWM4W0Z9H4QAJ3VA1W0QY
X-Correlation-Id: abc-123

{
  "reason": "All mandatory checks have passed.",
  "effectiveDate": "2026-06-20"
}
```

Possible responses:

```http
200 OK
```

```json
{
  "caseId": "123",
  "status": "APPROVED",
  "approvedAt": "2026-06-20T10:15:30+07:00",
  "approvedBy": "officer-778"
}
```

If wrong state:

```http
409 Conflict
```

```json
{
  "code": "CASE_INVALID_STATE_TRANSITION",
  "message": "Case cannot be approved from DRAFT state.",
  "correlationId": "abc-123",
  "details": []
}
```

If same request retried:

```http
200 OK
```

same response.

If same idempotency key different request:

```http
409 Conflict
```

```json
{
  "code": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
  "message": "Idempotency key was already used with a different request payload.",
  "correlationId": "abc-123",
  "details": []
}
```

Why this is stronger:

- transition explicit,
- permission explicit,
- domain invariant centralized,
- audit event precise,
- retry safe,
- API client gets meaningful errors,
- operation is defensible.

---

## 35. Mental Model Ringkas

Quarkus REST bukan sekadar endpoint annotation.

Ingat model ini:

```text
REST Resource
  = protocol adapter
  = execution boundary
  = serialization boundary
  = validation boundary
  = error boundary
  = security entrypoint
  = observability entrypoint
```

Yang tidak boleh terjadi:

```text
REST Resource
  = domain model
  = transaction script dump
  = SQL executor
  = audit source of truth
  = retry engine
  = hidden workflow engine
```

Top-tier Quarkus REST engineer berpikir seperti ini:

1. Apa resource/command yang sebenarnya?
2. Apa status code yang benar?
3. Apa DTO yang aman sebagai public contract?
4. Apa validation yang pantas di boundary?
5. Apa domain rule yang harus tetap di use case/domain?
6. Apa execution model endpoint ini?
7. Apakah ada blocking dependency?
8. Apakah perlu idempotency?
9. Apakah perlu concurrency control?
10. Bagaimana error dipetakan?
11. Bagaimana endpoint ini diobservasi?
12. Bagaimana endpoint ini gagal saat production traffic?
13. Bagaimana endpoint ini dites?
14. Bagaimana endpoint ini berevolusi tanpa merusak client?

---

## 36. Latihan Top 1% Engineer

### Latihan 1 — Refactor endpoint buruk

Diberikan endpoint:

```java
@POST
@Path("/updateStatus")
@Transactional
public Response updateStatus(UpdateStatusRequest request) {
    CaseEntity entity = CaseEntity.findById(request.caseId);
    entity.status = request.status;
    entity.reason = request.reason;
    entity.persist();
    return Response.ok(entity).build();
}
```

Tugas:

1. Pecah menjadi command endpoint yang eksplisit.
2. Buat request/response DTO.
3. Tentukan status code untuk tiap failure.
4. Buat domain exception taxonomy.
5. Tentukan idempotency rule.
6. Tentukan audit event.
7. Tentukan test matrix.

### Latihan 2 — Execution model classification

Klasifikasikan endpoint berikut:

```text
GET /cases/{id}
    -> Hibernate ORM blocking

GET /notifications/stream
    -> streaming events

POST /reports
    -> generate report 2 menit

GET /postal-code/{code}
    -> Redis cache + external HTTP API

POST /documents
    -> upload file 100 MB
```

Untuk masing-masing:

- blocking/non-blocking/virtual thread,
- synchronous/asynchronous,
- timeout,
- response code,
- observability signal,
- failure mode.

### Latihan 3 — Error contract design

Buat error response untuk:

1. invalid JSON,
2. missing required field,
3. unknown case ID,
4. invalid state transition,
5. duplicate submission,
6. downstream timeout,
7. unauthorized,
8. forbidden domain access,
9. unexpected exception.

Pastikan tiap error punya:

- status code,
- stable code,
- safe message,
- correlation ID,
- details jika perlu.

---

## 37. Ringkasan Invariants

Beberapa invariants yang harus dipegang:

1. REST resource adalah adapter, bukan domain owner.
2. Entity tidak boleh menjadi public API contract.
3. Error response harus konsisten dan aman.
4. 4xx bukan operational incident kecuali volumenya abnormal.
5. 5xx harus observable dan alertable.
6. Blocking dependency tidak boleh berjalan di event loop.
7. Reactive return type tidak otomatis membuat kode non-blocking.
8. Long-running workload sebaiknya async dengan `202 Accepted`.
9. Command penting butuh idempotency.
10. State transition harus explicit, bukan field update biasa.
11. API contract harus stabil lebih lama daripada struktur internal.
12. Validation annotation bukan pengganti domain invariant.
13. Security annotation bukan pengganti domain authorization.
14. HTTP access log bukan pengganti domain audit trail.
15. Pagination/filtering adalah performance contract, bukan UI detail.
16. OpenAPI harus merepresentasikan contract sebenarnya, bukan dekorasi.
17. Test REST harus mencakup failure path, bukan hanya happy path.
18. Native image readiness mempengaruhi serialization, reflection, dan dependency choice.
19. REST endpoint harus didesain berdasarkan failure mode production.
20. Endpoint yang jelas lebih mudah diamankan, dites, diobservasi, dan diaudit.

---

## 38. Referensi Resmi yang Relevan

Gunakan dokumentasi resmi sesuai versi Quarkus yang dipakai di project:

- Quarkus REST guide.
- Quarkus REST JSON guide.
- Quarkus REST migration guide.
- Quarkus REST filters and exception mapping reference.
- Quarkus reactive routes guide.
- Quarkus OpenAPI guide.
- Quarkus validation guide.
- Quarkus security guide.
- Quarkus OpenTelemetry/Micrometer guide.
- Quarkus testing guide.

---

## 39. Penutup Part 008

Part ini membangun pemahaman bahwa REST layer di Quarkus adalah boundary yang sangat strategis.

Engineer biasa melihat REST sebagai:

```text
@Path + @GET + return DTO
```

Engineer kuat melihat REST sebagai:

```text
HTTP contract + execution model + validation + authorization + transaction handoff + error mapping + observability + evolution strategy
```

Di Quarkus, layer ini makin penting karena kesalahan kecil seperti blocking di event loop, response entity terlalu besar, atau exception mapper buruk bisa langsung menjadi masalah production.

Part berikutnya akan masuk lebih dalam ke:

> **Part 009 — Blocking vs Reactive Execution Model: Event Loop, Worker Thread, Mutiny, dan Backpressure**

Bagian berikutnya akan membedah model eksekusi Quarkus secara lebih fundamental: event loop, worker pool, `@Blocking`, `@NonBlocking`, `Uni`, `Multi`, failure propagation, timeout, retry, backpressure, dan kapan reactive benar-benar worth it.

---

**Status:** Part 008 selesai.  
**Seri belum selesai dan belum mencapai bagian terakhir.**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-007.md">⬅️ Part 007 — CDI with Arc: Dependency Injection yang Dioptimalkan untuk Build-Time</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-009.md">Part 009 — Blocking vs Reactive Execution Model: Event Loop, Worker Thread, Mutiny, dan Backpressure ➡️</a>
</div>

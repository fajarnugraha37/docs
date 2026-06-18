# learn-java-validation-jakarta-hibernate-validator-part-019

# Validation in REST APIs: JAX-RS, Spring MVC, Error Mapping, and Problem Details

> Seri: `learn-java-validation-jakarta-hibernate-validator`  
> Bagian: `019`  
> Target pembaca: Java engineer yang sudah paham Java, Jakarta/JAX-RS, Spring, testing, persistence, concurrency, dan ingin menaikkan validation layer menjadi kontrak API yang stabil, aman, observable, dan defensible.  
> Cakupan versi: Java 8 sampai Java 25, Bean Validation 2.0 (`javax.validation`), Jakarta Validation 3.x (`jakarta.validation`), Hibernate Validator 6/7/8/9, Spring MVC/Spring Boot modern, Jakarta REST/JAX-RS.

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas constraint, group, custom validator, message interpolation, payload, metadata, constraint composition, Hibernate Validator extension, dan dependency injection di validator.

Sekarang kita masuk ke tempat yang paling sering membuat validation terlihat oleh user dan client system: **REST API boundary**.

Di REST API, validation bukan hanya soal menolak request invalid. Validation adalah bagian dari kontrak publik sistem:

1. **Apa yang boleh dikirim client.**
2. **Kapan request dianggap malformed vs semantically invalid.**
3. **Bagaimana error dikembalikan secara stabil.**
4. **Apakah error bisa dipetakan ke field UI.**
5. **Apakah error aman dari leakage PII/internal detail.**
6. **Apakah API versioning tetap backward-compatible.**
7. **Apakah support/auditor bisa memahami kenapa request ditolak.**

Jakarta Validation mendefinisikan metadata model dan API untuk JavaBean serta method validation. Hibernate Validator adalah reference implementation yang umum dipakai. Di level framework, Spring MVC dan Jakarta REST/JAX-RS menghubungkan validation API tersebut ke HTTP request lifecycle.

Referensi resmi yang relevan:

- Jakarta Validation 3.1 mendefinisikan metadata model dan API untuk JavaBean dan method validation, serta menargetkan Jakarta EE 11.  
  <https://jakarta.ee/specifications/bean-validation/3.1/>
- Situs Bean Validation/Jakarta Validation menjelaskan bahwa spesifikasi ini menyediakan API untuk validasi object graph, parameter method, dan return value.  
  <https://beanvalidation.org/>
- Hibernate Validator adalah reference implementation Jakarta Validation 3.1.  
  <https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/>
- Spring Framework mendukung `ProblemDetail`/error response berbasis RFC 9457 dan memiliki mekanisme exception mapping web MVC.  
  <https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html>
- Spring `MethodArgumentNotValidException` mengembalikan body berbentuk RFC 9457 `ProblemDetail` pada versi modern Spring Framework.  
  <https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/MethodArgumentNotValidException.html>

---

## 2. Mental Model: REST Validation adalah Boundary Contract

REST API boundary adalah titik masuk data dari luar trust boundary sistem.

```text
External Client
    |
    | HTTP request
    v
Transport Boundary
    |
    | parse, bind, deserialize
    v
DTO / Parameter Validation
    |
    | map to command
    v
Application Service / Command Handler
    |
    | domain rule / workflow guard / authorization / persistence
    v
Domain + DB + Event
```

Validation di REST API harus menjawab pertanyaan berikut:

```text
Apakah request ini memiliki bentuk, tipe, struktur, dan nilai lokal yang layak
untuk masuk ke application/service layer?
```

REST validation **bukan** tempat ideal untuk:

- mengecek semua business workflow,
- mengecek authorization kompleks,
- memutuskan state transition valid/tidak,
- memastikan uniqueness tanpa DB constraint,
- memanggil external system mahal,
- melakukan sanitization output,
- menggantikan database constraints.

REST validation adalah **first gate**, bukan satu-satunya gate.

---

## 3. Jenis Error di REST Boundary

Sebelum menentukan HTTP status dan response shape, engineer harus membedakan kelas error.

### 3.1 Malformed Request

Request tidak bisa dipahami oleh server.

Contoh:

- JSON rusak.
- Content-Type salah.
- field numeric berisi object.
- tanggal tidak bisa di-parse.
- enum value tidak dikenal, tergantung konfigurasi.
- body hilang padahal wajib.

Biasanya ini terjadi **sebelum Bean/Jakarta Validation berjalan**, karena object DTO belum berhasil dibentuk.

HTTP umum:

```text
400 Bad Request
```

Contoh response:

```json
{
  "type": "https://api.example.com/problems/malformed-json",
  "title": "Malformed request body",
  "status": 400,
  "detail": "The request body cannot be parsed as valid JSON.",
  "instance": "/applications",
  "correlationId": "01HZ..."
}
```

### 3.2 Constraint Violation pada DTO Body

Request bisa diparse, tetapi field tidak memenuhi constraint.

Contoh:

```java
public record CreateApplicantRequest(
        @NotBlank String name,
        @Email String email,
        @Size(min = 6, max = 6) String postalCode
) {}
```

HTTP umum:

```text
400 Bad Request
```

atau dalam beberapa organisasi:

```text
422 Unprocessable Content / Unprocessable Entity
```

Yang penting bukan angka status saja, tetapi **konsistensi kontrak**.

### 3.3 Constraint Violation pada Query/Path/Header Parameter

Contoh:

```java
@GetMapping("/cases/{caseId}")
public CaseResponse getCase(
        @PathVariable @Pattern(regexp = "CASE-[0-9]{8}") String caseId,
        @RequestParam @Min(1) @Max(100) int pageSize) {
    ...
}
```

Error ini sering menjadi `ConstraintViolationException` atau framework-specific method validation exception.

HTTP umum:

```text
400 Bad Request
```

### 3.4 Domain/Business Rule Violation

Request secara shape valid, tetapi tidak valid secara domain/context.

Contoh:

- case sudah closed sehingga tidak bisa diubah,
- user mencoba approve action sendiri,
- application sudah submitted,
- deadline sudah lewat,
- state transition tidak valid.

Ini sebaiknya **bukan** sekadar Bean Validation error.

HTTP bisa:

```text
409 Conflict
422 Unprocessable Content
403 Forbidden
400 Bad Request
```

Tergantung semantics.

Contoh:

```json
{
  "type": "https://api.example.com/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "The case cannot be submitted because it is already closed.",
  "code": "CASE_STATE_TRANSITION_INVALID",
  "correlationId": "01HZ..."
}
```

### 3.5 Persistence Constraint Violation

Bean Validation lolos, tetapi database menolak.

Contoh:

- unique constraint violation,
- foreign key violation,
- not null constraint,
- check constraint,
- optimistic locking.

Ini bukan kegagalan Bean Validation. Mapping-nya harus hati-hati.

HTTP umum:

```text
409 Conflict        // duplicate / optimistic lock
400 atau 422        // invalid reference, tergantung API contract
500                 // jika sebenarnya bug internal mapping
```

---

## 4. REST Validation Pipeline yang Sehat

Production REST pipeline sebaiknya eksplisit.

```text
1. HTTP transport validation
   - method
   - path
   - content-type
   - accept
   - body presence
   - payload size

2. Parsing / deserialization
   - JSON syntax
   - type conversion
   - enum/date parsing

3. Bean/Jakarta Validation
   - DTO field constraints
   - nested DTO constraints
   - container element constraints
   - method parameter constraints

4. Normalization / canonicalization
   - trim if policy allows
   - case normalization
   - phone/postal formatting
   - never use normalization to hide invalid input silently unless documented

5. Command mapping
   - DTO -> command
   - explicit presence handling for PATCH

6. Application/domain validation
   - contextual rules
   - workflow guard
   - authorization-sensitive checks

7. Persistence constraint
   - unique
   - FK
   - CHECK
   - NOT NULL
   - optimistic locking

8. Error mapping
   - stable problem type
   - stable error code
   - safe message
   - field path
   - correlation id
```

Key invariant:

```text
REST validation should make invalid input obvious,
but it must not pretend to prove complete domain correctness.
```

---

## 5. Request Body Validation

### 5.1 Spring MVC Basic Pattern

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ApplicantController {

    private final ApplicantService applicantService;

    ApplicantController(ApplicantService applicantService) {
        this.applicantService = applicantService;
    }

    @PostMapping("/applicants")
    @ResponseStatus(HttpStatus.CREATED)
    ApplicantResponse create(@Valid @RequestBody CreateApplicantRequest request) {
        CreateApplicantCommand command = request.toCommand();
        return applicantService.create(command);
    }
}

record CreateApplicantRequest(
        @NotBlank(message = "{applicant.name.required}")
        String name,

        @NotBlank(message = "{applicant.email.required}")
        @Email(message = "{applicant.email.invalid}")
        String email,

        @NotBlank(message = "{applicant.postalCode.required}")
        @Size(min = 6, max = 6, message = "{applicant.postalCode.length}")
        String postalCode
) {
    CreateApplicantCommand toCommand() {
        return new CreateApplicantCommand(name, email, postalCode);
    }
}
```

Catatan:

- `@Valid` memicu validation pada request body.
- Constraint ditempatkan di DTO, bukan entity persistence.
- DTO melakukan mapping eksplisit ke command.
- Error message memakai bundle key, bukan literal message.

### 5.2 Spring Boot Dependency

Untuk Spring Boot 3.x biasanya dependency:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

Untuk Boot 2.x:

```java
import javax.validation.Valid;
```

Untuk Boot 3.x:

```java
import jakarta.validation.Valid;
```

Jangan campur dua namespace di satu application module.

---

## 6. Query, Path, and Header Parameter Validation

### 6.1 Spring MVC Method Parameter Validation

```java
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
class CaseSearchController {

    @GetMapping("/cases/{caseRef}")
    CaseResponse getCase(
            @PathVariable
            @Pattern(regexp = "CASE-[0-9]{8}", message = "{caseRef.invalid}")
            String caseRef,

            @RequestParam(defaultValue = "20")
            @Min(value = 1, message = "{pageSize.min}")
            @Max(value = 100, message = "{pageSize.max}")
            int pageSize,

            @RequestHeader(name = "X-Channel", required = false)
            @Pattern(regexp = "WEB|MOBILE|INTERNAL", message = "{channel.invalid}")
            String channel) {
        ...
    }
}
```

Important:

- Di banyak konfigurasi Spring, method validation membutuhkan `@Validated` di class atau dukungan method validation aktif.
- Exception untuk method parameter dapat berbeda tergantung versi Spring dan jenis argument.
- Jangan membuat response mapper hanya untuk satu exception class.

### 6.2 Primitive Trap

```java
@RequestParam(defaultValue = "0") @Min(1) int page
```

Jika tidak ada request param dan default `0`, maka validation gagal.

Tetapi:

```java
@RequestParam(required = false) @Min(1) int page
```

Tidak aman karena primitive tidak bisa `null`; binding/default behavior bisa mengejutkan.

Lebih eksplisit:

```java
@RequestParam(required = false) @Min(1) Integer page
```

Lalu application menentukan default:

```java
int effectivePage = page == null ? 1 : page;
```

---

## 7. JAX-RS / Jakarta REST Validation Pattern

Pada Jakarta REST/JAX-RS, Bean/Jakarta Validation bisa diterapkan pada:

- resource method parameter,
- entity body,
- return value,
- resource class,
- sub-resource.

Contoh dengan namespace Jakarta:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

@Path("/applications")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class ApplicationResource {

    @POST
    public Response create(@Valid CreateApplicationRequest request) {
        ...
    }

    @GET
    @Path("/{applicationRef}")
    public ApplicationResponse get(
            @PathParam("applicationRef")
            @Pattern(regexp = "APP-[0-9]{8}")
            String applicationRef,

            @QueryParam("limit")
            @Min(1)
            @Max(100)
            Integer limit) {
        ...
    }
}

record CreateApplicationRequest(
        @NotBlank String applicantName,
        @NotBlank String applicationType
) {}
```

Dengan Java EE/Jakarta EE lama:

```java
import javax.validation.Valid;
import javax.ws.rs.POST;
```

Dengan Jakarta EE modern:

```java
import jakarta.validation.Valid;
import jakarta.ws.rs.POST;
```

### 7.1 JAX-RS Exception Mapping

Di Jakarta REST, error dapat dipetakan dengan `ExceptionMapper`.

```java
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class ConstraintViolationExceptionMapper
        implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        ValidationProblem problem = ValidationProblem.from(exception.getConstraintViolations());

        return Response.status(Response.Status.BAD_REQUEST)
                .entity(problem)
                .type("application/problem+json")
                .build();
    }
}
```

Prinsipnya sama dengan Spring:

- jangan return raw exception message,
- normalize path,
- redaksi rejected value,
- gunakan stable error code,
- sertakan correlation id,
- jangan leak class/package/method internal.

---

## 8. `@Valid` vs `@Validated` di Spring

### 8.1 `@Valid`

`@Valid` berasal dari Bean/Jakarta Validation.

```java
@PostMapping("/cases")
CaseResponse create(@Valid @RequestBody CreateCaseRequest request) {
    ...
}
```

Fungsi utama:

- trigger cascaded validation,
- digunakan pada request body,
- digunakan pada nested field,
- tidak membawa group secara langsung.

### 8.2 `@Validated`

`@Validated` adalah annotation Spring.

```java
@PostMapping("/cases")
CaseResponse submit(@Validated(Submit.class) @RequestBody CaseSubmitRequest request) {
    ...
}
```

Fungsi utama:

- menjalankan validation dengan group tertentu,
- mengaktifkan/mempermudah method validation dalam konteks Spring,
- dipakai di class/service/controller.

Contoh group:

```java
interface Draft {}
interface Submit {}

record CaseRequest(
        @NotBlank(groups = Submit.class)
        String applicantName,

        @Size(max = 500, groups = {Draft.class, Submit.class})
        String remarks
) {}
```

Controller:

```java
@PostMapping("/cases/draft")
CaseResponse saveDraft(@Validated(Draft.class) @RequestBody CaseRequest request) {
    ...
}

@PostMapping("/cases/submit")
CaseResponse submit(@Validated(Submit.class) @RequestBody CaseRequest request) {
    ...
}
```

Caveat:

```text
Group is good for operation-specific shape validation.
Group is dangerous when used as hidden workflow engine.
```

---

## 9. Error Mapping: Jangan Biarkan Framework Default Menjadi API Contract

Framework default error sering berguna untuk developer, tetapi tidak selalu layak menjadi public API contract.

Masalah umum response default:

- format berubah saat upgrade framework,
- path tidak sesuai kebutuhan frontend,
- message tidak stabil,
- rejected value bisa bocor,
- exception class bocor,
- tidak ada stable error code,
- tidak ada correlation id,
- tidak membedakan malformed/validation/business conflict.

Top-tier API design membutuhkan explicit error model.

---

## 10. Problem Details: Base Envelope, Not Complete Validation Model

Problem Details memberi envelope standar untuk error HTTP.

Field umum:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Request validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/applications",
  "correlationId": "01HZ...",
  "violations": []
}
```

Problem Details tidak mendefinisikan sendiri bentuk `violations`. Itu bisa menjadi extension property.

Contoh validation response:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Request validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/applications",
  "correlationId": "01HZ7VPJ1Z4W4JZPAE6QZ6R5QP",
  "violations": [
    {
      "path": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid.",
      "constraint": "Email",
      "rejectedValuePresent": true
    },
    {
      "path": "documents[0].type",
      "code": "DOCUMENT_TYPE_REQUIRED",
      "message": "Document type is required.",
      "constraint": "NotBlank",
      "rejectedValuePresent": false
    }
  ]
}
```

### 10.1 Why Not Return Map Field to Message?

Common simple response:

```json
{
  "email": "must be a well-formed email address",
  "name": "must not be blank"
}
```

Ini praktis, tetapi lemah untuk production:

- tidak bisa menampung multiple violation pada satu field,
- tidak ada error code,
- tidak ada severity,
- tidak ada nested path detail,
- tidak ada global/class-level violation,
- message harus diparse client,
- tidak bisa mendukung localization dengan baik.

Lebih baik:

```json
{
  "violations": [
    {
      "path": "email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    },
    {
      "path": "email",
      "code": "EMAIL_DOMAIN_NOT_ALLOWED",
      "message": "Email domain is not allowed."
    }
  ]
}
```

---

## 11. Spring MVC Error Handling

### 11.1 Exception Classes yang Umum

Di Spring MVC, validation/binding error dapat muncul sebagai beberapa exception.

Umum:

- `MethodArgumentNotValidException`
  - request body `@Valid @RequestBody` gagal.
- `BindException`
  - binding/validation pada model attribute atau form-style object.
- `ConstraintViolationException`
  - method validation pada parameter/return value, tergantung konfigurasi/versi.
- `HandlerMethodValidationException`
  - method validation di Spring Framework modern.
- `HttpMessageNotReadableException`
  - JSON parse/type conversion request body gagal.
- `MissingServletRequestParameterException`
  - required query parameter hilang.
- `MethodArgumentTypeMismatchException`
  - path/query type conversion gagal.
- `NoHandlerFoundException` / routing errors
  - bukan validation, tetapi error response shape harus konsisten.

Jangan desain mapper hanya untuk `MethodArgumentNotValidException`.

### 11.2 Spring Controller Advice Example

```java
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;

import java.net.URI;
import java.util.List;

@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handleRequestBodyValidation(
            MethodArgumentNotValidException ex,
            HttpServletRequest request) {

        List<ApiViolation> violations = ex.getBindingResult()
                .getFieldErrors()
                .stream()
                .map(error -> ApiViolation.of(
                        normalizeSpringField(error.getField()),
                        toErrorCode(error.getCode()),
                        safeMessage(error.getDefaultMessage()),
                        error.getCode()))
                .toList();

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://api.example.com/problems/validation-error"));
        problem.setTitle("Request validation failed");
        problem.setDetail("One or more fields are invalid.");
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("violations", violations);
        problem.setProperty("correlationId", Correlation.currentId());

        return ResponseEntity.badRequest().body(problem);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ProblemDetail> handleConstraintViolation(
            ConstraintViolationException ex,
            HttpServletRequest request) {

        List<ApiViolation> violations = ex.getConstraintViolations()
                .stream()
                .map(ApiExceptionHandler::toApiViolation)
                .toList();

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://api.example.com/problems/validation-error"));
        problem.setTitle("Request validation failed");
        problem.setDetail("One or more parameters are invalid.");
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("violations", violations);
        problem.setProperty("correlationId", Correlation.currentId());

        return ResponseEntity.badRequest().body(problem);
    }

    private static ApiViolation toApiViolation(ConstraintViolation<?> violation) {
        String path = normalizeConstraintViolationPath(violation);
        String constraint = violation.getConstraintDescriptor()
                .getAnnotation()
                .annotationType()
                .getSimpleName();

        return ApiViolation.of(
                path,
                toErrorCode(constraint),
                safeMessage(violation.getMessage()),
                constraint);
    }

    private static String normalizeSpringField(String field) {
        return field;
    }

    private static String normalizeConstraintViolationPath(ConstraintViolation<?> violation) {
        // Example raw paths can include method names such as:
        // create.request.email
        // getCase.caseRef
        // Real implementation should remove controller/method internals.
        return PathNormalizer.toPublicApiPath(violation.getPropertyPath());
    }

    private static String toErrorCode(String constraintOrCode) {
        return switch (constraintOrCode) {
            case "NotBlank" -> "FIELD_REQUIRED";
            case "NotNull" -> "FIELD_REQUIRED";
            case "Email" -> "EMAIL_INVALID";
            case "Size" -> "FIELD_SIZE_INVALID";
            case "Pattern" -> "FIELD_FORMAT_INVALID";
            default -> "FIELD_INVALID";
        };
    }

    private static String safeMessage(String message) {
        return message == null ? "Invalid value." : message;
    }
}

record ApiViolation(
        String path,
        String code,
        String message,
        String constraint
) {
    static ApiViolation of(String path, String code, String message, String constraint) {
        return new ApiViolation(path, code, message, constraint);
    }
}
```

### 11.3 Do Not Expose Raw BindingResult Blindly

`BindingResult` contains useful developer details, but response should be curated.

Avoid:

```json
{
  "objectName": "createApplicantRequest",
  "codes": [...],
  "arguments": [...],
  "defaultMessage": "...",
  "rejectedValue": "..."
}
```

Better:

```json
{
  "path": "email",
  "code": "EMAIL_INVALID",
  "message": "Email address is invalid."
}
```

Rejected value policy:

```text
Default: do not return rejectedValue.
Exception: safe enum/simple public values only, if approved.
Never: password, token, document number, national ID, secret, free-text sensitive content.
```

---

## 12. Path Normalization

Raw validation paths are framework/provider-oriented. Public API paths should be contract-oriented.

### 12.1 Request Body Field Error

Spring field path:

```text
applicant.email
```

Nested collection:

```text
documents[0].type
```

Map:

```text
metadata[category].value
```

These are usually already close to public API fields.

### 12.2 Method Parameter ConstraintViolation Path

Raw path may look like:

```text
create.arg0.email
getCase.caseRef
search.pageSize
```

Public path should not expose Java method internals:

```text
email
caseRef
pageSize
```

or more structured:

```json
{
  "location": "path",
  "path": "caseRef"
}
```

### 12.3 Recommended Violation Shape

```json
{
  "location": "body",
  "path": "documents[0].expiryDate",
  "code": "DOCUMENT_EXPIRY_DATE_REQUIRED",
  "message": "Document expiry date is required."
}
```

For query:

```json
{
  "location": "query",
  "path": "pageSize",
  "code": "PAGE_SIZE_OUT_OF_RANGE",
  "message": "Page size must be between 1 and 100."
}
```

For path:

```json
{
  "location": "path",
  "path": "caseRef",
  "code": "CASE_REF_INVALID",
  "message": "Case reference format is invalid."
}
```

Why `location` matters:

```text
Same logical name can appear in path, query, header, and body.
Without location, clients cannot reliably map the error.
```

---

## 13. HTTP Status Decision Model

There is no single universal mapping, but consistency matters.

### 13.1 Recommended Baseline

| Situation | Suggested status | Reason |
|---|---:|---|
| Malformed JSON | 400 | Server cannot parse request. |
| Type conversion failure | 400 | Request syntax/shape invalid. |
| Missing required path/query/header | 400 | HTTP request contract violated. |
| Bean Validation DTO/body failure | 400 or 422 | Choose one and standardize. |
| Query/path/header constraint violation | 400 | Invalid request parameter. |
| Domain state conflict | 409 | Request conflicts with current resource state. |
| Duplicate natural key | 409 | Resource conflict. |
| Authorization failure | 403 | Valid request shape, not allowed. |
| Authentication missing/invalid | 401 | Auth problem, not validation. |
| Unsupported media type | 415 | Content-Type unsupported. |
| Not acceptable | 406 | Accept negotiation failure. |
| Payload too large | 413 | Transport-size boundary. |

### 13.2 400 vs 422

Both are seen in real systems.

A practical rule:

```text
Use 400 when the request violates the HTTP/API input contract broadly.
Use 422 when payload is syntactically valid but semantically unprocessable.
```

But mixing randomly is worse than choosing one.

For large enterprise systems, a common simple standard is:

```text
400 = request validation failure
409 = conflict with existing state/resource
403 = forbidden action
401 = unauthenticated
500 = unexpected server bug
```

Then use `code` inside response to differentiate precisely.

---

## 14. Request DTO Design for REST Validation

### 14.1 Do Not Use Entity as Request Body

Bad:

```java
@PostMapping("/cases")
CaseEntity create(@Valid @RequestBody CaseEntity entity) {
    return repository.save(entity);
}
```

Problems:

- exposes persistence shape,
- accidentally validates entity graph,
- lazy relationship problems,
- overposting/mass assignment risk,
- DB IDs/status fields can be injected,
- API contract coupled to database.

Better:

```java
record CreateCaseRequest(
        @NotBlank String applicantName,
        @NotBlank String applicationType,
        @Valid List<@NotNull DocumentRequest> documents
) {}
```

Then map:

```java
CreateCaseCommand command = mapper.toCommand(request);
```

### 14.2 Separate DTO by Operation When Semantics Differ

Bad:

```java
record CaseRequest(
        @NotBlank(groups = Create.class) String applicantName,
        @NotBlank(groups = Submit.class) String declaration,
        @Null(groups = Create.class) @NotNull(groups = Update.class) Long id,
        @NotBlank(groups = Approve.class) String approvalRemarks
) {}
```

This often becomes unreadable.

Better:

```java
record CreateCaseRequest(...) {}
record SaveDraftRequest(...) {}
record SubmitCaseRequest(...) {}
record ApproveCaseRequest(...) {}
```

Use groups only when operation differences are small and controlled.

### 14.3 PATCH DTO Must Track Presence

Bad:

```java
record PatchApplicantRequest(
        @Email String email,
        @Size(max = 100) String displayName
) {}
```

Problem:

```text
Was email absent, or explicitly null?
```

Better with explicit patch field:

```java
record PatchApplicantRequest(
        PatchField<@Email String> email,
        PatchField<@Size(max = 100) String> displayName
) {}
```

Then define semantics:

```text
absent       = no change
present null = clear value, if allowed
present val  = set value, validate element
```

This may require custom deserialization and/or `ValueExtractor`.

---

## 15. Validation and Deserialization Order

Important production truth:

```text
Bean Validation runs after deserialization/binding succeeds.
```

So this constraint:

```java
record Request(@Min(1) Integer amount) {}
```

will not handle JSON like:

```json
{ "amount": "abc" }
```

The deserializer fails before `@Min` runs.

Therefore your API error layer must handle both:

```text
JSON/type binding error
Bean Validation error
```

Do not tell users “must be greater than 1” when the actual issue is “amount must be a number.”

---

## 16. Normalization: Before or After Validation?

Example:

```json
{ "email": " USER@EXAMPLE.COM " }
```

Possible policies:

### 16.1 Strict Validation First

```text
Input has spaces -> invalid.
```

Pros:

- client learns exact contract,
- no silent mutation.

Cons:

- less user-friendly for human input.

### 16.2 Normalize Then Validate

```text
trim -> lower-case -> validate.
```

Pros:

- user-friendly,
- reduces data noise.

Cons:

- can hide client bugs,
- dangerous for fields where spaces are meaningful,
- must be auditable if regulatory.

### 16.3 Recommended

Normalize only with explicit field-level policy.

```text
Email: trim/lowercase domain maybe acceptable.
Password: never trim silently.
Name: do not collapse culturally meaningful characters blindly.
Free text: do not normalize aggressively.
Identifier: canonicalize only if specification says so.
```

Validation should be paired with canonicalization policy.

---

## 17. Security Concerns at REST Validation Boundary

### 17.1 Size Limits Are Not Optional

Bean Validation can express:

```java
@Size(max = 500)
String remarks;

@Size(max = 20)
List<@Valid DocumentRequest> documents;
```

But HTTP server/framework should also enforce:

- max body size,
- max header size,
- max multipart size,
- max JSON nesting depth if supported,
- request timeout,
- rate limit.

Because Bean Validation may only run after the payload is already loaded/deserialized.

### 17.2 Regex ReDoS

Bad:

```java
@Pattern(regexp = "(a+)+$")
String value;
```

Danger:

```text
Catastrophic backtracking on crafted input.
```

Mitigation:

- limit length before regex,
- use simple deterministic regex,
- prefer parser for complex grammar,
- test worst-case input,
- avoid user-controlled regex.

### 17.3 Error Message Leakage

Bad:

```json
{
  "path": "nric",
  "message": "U1234567A is already registered"
}
```

May leak existence of identity.

Better:

```json
{
  "path": "identityNumber",
  "code": "IDENTITY_NOT_ACCEPTED",
  "message": "The identity information cannot be accepted."
}
```

Depending on domain, duplicate checks may be returned as conflict but still not reveal sensitive details.

---

## 18. API Versioning and Validation Compatibility

Validation rules are API contract.

Changing validation can break clients even if endpoint path and schema remain same.

### 18.1 Breaking Validation Changes

Potentially breaking:

- making optional field required,
- reducing max length,
- tightening regex,
- rejecting previously accepted enum,
- changing date boundary semantics,
- changing error code/path shape,
- changing 400 to 422 unexpectedly,
- changing message if clients parse message.

### 18.2 Usually Non-Breaking Changes

Usually safer:

- increasing max length,
- accepting additional enum value,
- allowing null/omission where previously required,
- adding warning before hard enforcement,
- adding new optional field.

### 18.3 Rollout Pattern

```text
observe -> warn -> document -> enforce -> remove legacy allowance
```

Example:

```text
Phase 1: accept old postal format, emit warning code POSTAL_FORMAT_DEPRECATED
Phase 2: dashboard clients still sending old format
Phase 3: communicate cutover date
Phase 4: reject old format with POSTAL_FORMAT_INVALID
```

---

## 19. Validation Response for Frontend Mapping

Frontend needs stable mapping.

Bad for FE:

```json
{
  "message": "Validation failed: create.request.documents[0].expiryDate must not be null"
}
```

Good:

```json
{
  "violations": [
    {
      "location": "body",
      "path": "documents[0].expiryDate",
      "code": "DOCUMENT_EXPIRY_REQUIRED",
      "message": "Document expiry date is required."
    }
  ]
}
```

Frontend can map:

```text
documents[0].expiryDate -> field component
DOCUMENT_EXPIRY_REQUIRED -> localized client text or display logic
```

### 19.1 Multiple Errors per Field

Possible:

```json
{
  "violations": [
    {
      "path": "password",
      "code": "PASSWORD_TOO_SHORT"
    },
    {
      "path": "password",
      "code": "PASSWORD_MISSING_DIGIT"
    }
  ]
}
```

Do not collapse to one message unless product policy says so.

---

## 20. OpenAPI and Validation Drift

Common problem:

```text
OpenAPI says maxLength = 100.
Backend @Size(max = 80).
Frontend allows 100.
Production rejects 81-100.
```

Validation drift happens when constraints exist in multiple places:

- frontend form,
- OpenAPI schema,
- backend DTO,
- database DDL,
- business documentation,
- import template,
- mobile app validation.

Mitigation:

1. Treat backend as source of enforcement truth.
2. Generate or test OpenAPI from backend constraints where possible.
3. Add contract tests to compare OpenAPI and DTO metadata.
4. Maintain error code catalog.
5. Do not let frontend parse human messages.

---

## 21. Batch/API Import Validation

For batch import endpoints, fail-fast is often wrong.

Bad:

```text
Reject whole file at first invalid row.
```

Better:

```json
{
  "type": "https://api.example.com/problems/batch-validation-error",
  "title": "Batch validation failed",
  "status": 400,
  "summary": {
    "totalRows": 1000,
    "validRows": 940,
    "invalidRows": 60
  },
  "violations": [
    {
      "row": 12,
      "location": "body",
      "path": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid."
    }
  ]
}
```

Batch validation requires:

- row index,
- source column name,
- normalized field path,
- rule code,
- severity,
- max violations returned,
- separate full report download if huge.

---

## 22. Case Management Example

Consider regulatory case management endpoints:

```text
POST /applications/draft
POST /applications/{id}/submit
POST /cases/{id}/assign
POST /cases/{id}/approve
POST /cases/{id}/escalate
```

Validation layers:

### Draft Save

```java
record SaveDraftApplicationRequest(
        @Size(max = 200) String applicantName,
        @Email String contactEmail,
        @Size(max = 50) List<@Valid DraftDocumentRequest> documents
) {}
```

Rules:

- allow incomplete fields,
- enforce max lengths and safe shapes,
- avoid expensive workflow checks.

### Submit

```java
record SubmitApplicationRequest(
        @NotBlank String applicantName,
        @NotBlank @Email String contactEmail,
        @NotEmpty List<@Valid SubmitDocumentRequest> documents,
        @AssertTrue Boolean declarationAccepted
) {}
```

Rules:

- complete local input required,
- document fields required,
- declaration accepted.

### Application Service

```java
void submit(String applicationId, SubmitApplicationCommand command, Actor actor) {
    Application app = repository.get(applicationId);

    authorization.checkCanSubmit(actor, app);
    workflowGuard.checkCanSubmit(app);
    domainPolicy.checkSubmissionCompleteness(app, command);

    app.submit(command, actor);
    repository.save(app);
}
```

Do not put all of this into `@ValidSubmitApplication` annotation.

REST DTO validation answers:

```text
Is the submit request structurally complete?
```

Domain/workflow validation answers:

```text
Given this application, actor, state, deadline, and evidence,
may this submission happen now?
```

---

## 23. Return Value Validation in REST

Executable validation can validate return values.

Example:

```java
@GetMapping("/profiles/{id}")
@NotNull
ProfileResponse getProfile(@PathVariable String id) {
    return service.getProfile(id);
}
```

Or:

```java
record ProfileResponse(
        @NotBlank String id,
        @NotBlank String displayName
) {}
```

Return value validation is useful as **provider-side invariant check**, but public error mapping differs.

If input validation fails:

```text
client fault -> 400
```

If return value validation fails:

```text
server fault -> usually 500
```

Do not return “validation error” to client as if client caused it when server produced invalid response.

---

## 24. Observability for REST Validation

Validation failures are product/contract signals.

Track:

- endpoint,
- HTTP method,
- client id/app version,
- error code,
- field path,
- constraint type,
- status code,
- count/rate,
- latency,
- correlation id,
- validation phase:
  - binding,
  - bean validation,
  - domain rule,
  - DB constraint.

Example metric labels:

```text
api.validation.failure.count{
  endpoint="POST /applications",
  code="EMAIL_INVALID",
  location="body",
  client="mobile-app",
  version="2.8.1"
}
```

Do not include raw values in metric labels.

### 24.1 Alerting

Alert when:

- validation failure rate spikes after deployment,
- one client version causes repeated failures,
- malformed JSON spikes,
- unknown enum spikes,
- new rule rejects too many requests,
- DB unique conflicts spike unexpectedly.

This often reveals:

- frontend/backend drift,
- mobile app old version,
- breaking validation change,
- bot/abuse traffic,
- integration partner contract misunderstanding.

---

## 25. Logging Validation Failures Safely

Bad:

```text
Validation failed: nric=S1234567A, password=abc123, token=...
```

Good:

```json
{
  "event": "api.validation.failed",
  "correlationId": "01HZ...",
  "endpoint": "POST /applications",
  "clientId": "partner-a",
  "status": 400,
  "violations": [
    {
      "location": "body",
      "path": "contactEmail",
      "code": "EMAIL_INVALID",
      "constraint": "Email"
    }
  ]
}
```

Guideline:

```text
Log rule identity, path, and classification.
Do not log submitted sensitive values.
```

---

## 26. Spring WebFlux Note

This part focuses mainly on Spring MVC and Jakarta REST, but conceptually similar rules apply in WebFlux:

- request body validation after decoding,
- method argument validation,
- framework-specific exception classes,
- centralized error handler,
- no blocking DB/external calls inside validators,
- stable error model.

In reactive stacks, blocking validators are more dangerous because they can block event-loop threads if misused.

---

## 27. Virtual Threads Note: Java 21+

Virtual threads make blocking cheaper, not logically safer.

Do not conclude:

```text
Because virtual threads exist, DB-backed validators are fine.
```

Problems remain:

- race condition,
- stale read,
- transaction boundary,
- inconsistent error semantics,
- dependency failure classification,
- hidden latency,
- duplicated rules,
- poor testability.

Virtual threads change throughput characteristics, not validation correctness semantics.

---

## 28. Native Image / AOT Note

Bean/Jakarta Validation commonly relies on:

- annotations,
- reflection,
- resource bundles,
- generated/proxy integration,
- message interpolation,
- provider discovery.

In AOT/native-image environments, verify:

- constraint annotations are reachable,
- validator implementations are registered,
- message bundles are included,
- method parameter names are available if needed,
- framework native support is configured.

Do not assume every dynamic/custom validator works unchanged in native mode.

---

## 29. Migration Notes: `javax.validation` REST APIs to `jakarta.validation`

### 29.1 Namespace Migration

Before:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.ws.rs.POST;
```

After:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.POST;
```

### 29.2 Common Failure Mode

A codebase may compile but validation silently fails when:

- framework expects `jakarta.validation.Valid`,
- DTO imports `javax.validation.Valid`,
- provider is Hibernate Validator 8/9,
- old transitive dependency brings `javax.validation-api`.

Review dependency tree.

Maven:

```bash
mvn dependency:tree | grep -E "validation|hibernate-validator|jakarta.el|javax.el"
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -E "validation|hibernate-validator|jakarta.el|javax.el"
```

### 29.3 API Regression Test

After migration, test:

- invalid request body still rejected,
- invalid query param still rejected,
- nested validation still works,
- container element constraints still work,
- error response shape unchanged,
- message bundle still resolves,
- method validation still works,
- exception handler still catches correct exception.

---

## 30. Production-Grade Error Model Example

### 30.1 Java Model

```java
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;

public record ApiProblem(
        URI type,
        String title,
        int status,
        String detail,
        String instance,
        String correlationId,
        OffsetDateTime timestamp,
        List<ApiViolation> violations
) {}

public record ApiViolation(
        String location,
        String path,
        String code,
        String message,
        String constraint,
        String severity
) {}
```

### 30.2 Example Response

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Request validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/applications",
  "correlationId": "01J1V6X1ND5W7J6FG9Q8B5P2HQ",
  "timestamp": "2026-06-16T10:00:00Z",
  "violations": [
    {
      "location": "body",
      "path": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email address is invalid.",
      "constraint": "Email",
      "severity": "ERROR"
    },
    {
      "location": "body",
      "path": "documents[0].fileName",
      "code": "FIELD_REQUIRED",
      "message": "File name is required.",
      "constraint": "NotBlank",
      "severity": "ERROR"
    }
  ]
}
```

### 30.3 Why This Shape Is Strong

It supports:

- frontend field mapping,
- mobile client compatibility,
- analytics by error code,
- localization,
- no raw rejected value,
- global and field violations,
- nested object paths,
- RFC-style problem envelope,
- support/debug correlation.

---

## 31. Anti-Patterns

### 31.1 Returning Raw Exception Message

Bad:

```java
return ex.getMessage();
```

Risk:

- internal class/method leaks,
- unstable output,
- PII leakage,
- client parsing fragility.

### 31.2 Validating Entity Directly from Request

Bad:

```java
public ResponseEntity<?> create(@Valid @RequestBody UserEntity entity)
```

Risk:

- overposting,
- persistence leakage,
- unintended cascade,
- DB graph coupling.

### 31.3 Using Human Message as Error Code

Bad:

```javascript
if (message === "must not be blank") { ... }
```

Better:

```javascript
if (code === "FIELD_REQUIRED") { ... }
```

### 31.4 DB Calls Inside DTO Validator

Bad:

```java
@UniqueEmail
String email;
```

If implemented by DB lookup in validator, it may be race-prone.

Better:

- use DB unique constraint,
- catch/translate conflict,
- optionally pre-check for user-friendly early feedback,
- never rely only on pre-check.

### 31.5 One Mega Request DTO with 20 Groups

Bad:

```java
CaseRequest used by draft, submit, approve, reject, escalate, reopen, close, import...
```

Better:

- separate operation-specific request DTO,
- use groups only where small differences are intentional.

---

## 32. Testing Strategy

### 32.1 Controller Validation Test

Test invalid request body:

```java
mockMvc.perform(post("/applicants")
        .contentType(MediaType.APPLICATION_JSON)
        .content("""
            {
              "name": "",
              "email": "not-email",
              "postalCode": "123"
            }
            """))
    .andExpect(status().isBadRequest())
    .andExpect(jsonPath("$.type").value("https://api.example.com/problems/validation-error"))
    .andExpect(jsonPath("$.violations[?(@.path == 'name')]").exists())
    .andExpect(jsonPath("$.violations[?(@.code == 'EMAIL_INVALID')]").exists());
```

### 32.2 Malformed JSON Test

```java
mockMvc.perform(post("/applicants")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{ invalid json"))
    .andExpect(status().isBadRequest())
    .andExpect(jsonPath("$.type").value("https://api.example.com/problems/malformed-json"));
```

### 32.3 Query Parameter Validation Test

```java
mockMvc.perform(get("/cases/CASE-20240001")
        .param("pageSize", "1000"))
    .andExpect(status().isBadRequest())
    .andExpect(jsonPath("$.violations[0].location").value("query"))
    .andExpect(jsonPath("$.violations[0].path").value("pageSize"));
```

### 32.4 Error Contract Golden Test

Keep a stable JSON snapshot for common validation failures.

Test:

- field path,
- error code,
- status,
- type,
- absence of rejected sensitive value,
- correlation id presence.

### 32.5 Migration Regression Test

After framework upgrade:

- invalid body still rejected,
- invalid query still rejected,
- same error code,
- same path format,
- no new raw framework fields,
- messages still resolved.

---

## 33. Review Checklist

Use this checklist in PR review.

### Request DTO

- [ ] DTO is not a JPA entity.
- [ ] Operation-specific DTO is used when semantics differ significantly.
- [ ] PATCH uses presence-aware model if null/absence distinction matters.
- [ ] Constraints represent local input shape, not full workflow.
- [ ] Nested DTO uses `@Valid` intentionally.
- [ ] Collection/map sizes are bounded.

### Controller/Resource

- [ ] Request body uses `@Valid` or `@Validated` intentionally.
- [ ] Query/path/header constraints are active and tested.
- [ ] Method validation works in the chosen framework version.
- [ ] No self-invocation/proxy trap for method validation.

### Error Mapping

- [ ] `MethodArgumentNotValidException` handled.
- [ ] `ConstraintViolationException` or framework-specific method validation exception handled.
- [ ] Deserialization/binding errors handled separately.
- [ ] Error response uses stable `type`, `code`, and `path`.
- [ ] Raw exception message is not exposed.
- [ ] Rejected sensitive values are not exposed.
- [ ] Correlation id included.

### Security

- [ ] Payload size limit exists outside Bean Validation.
- [ ] Regex constraints are safe and length-bounded.
- [ ] Messages do not leak PII/secrets/existence.
- [ ] Validation logs exclude raw sensitive values.

### Compatibility

- [ ] Tightening validation is treated as API contract change.
- [ ] OpenAPI/schema matches backend constraints.
- [ ] Error codes are documented.
- [ ] API clients do not parse human messages.

---

## 34. Core Takeaways

1. REST validation is **public boundary contract**, not just DTO decoration.
2. Bean/Jakarta Validation runs after parsing/binding; malformed request handling is separate.
3. Request body, query, path, and header validation may produce different framework exceptions.
4. Framework default error response should not accidentally become your API contract.
5. Problem Details is a good envelope, but validation needs structured `violations` extension.
6. Stable error codes are more important than human messages.
7. Path normalization is mandatory for method parameter validation and nested DTOs.
8. Do not expose raw rejected values by default.
9. Domain state conflict, authorization failure, and DB constraint failure are not the same as DTO validation failure.
10. Validation rules are API compatibility rules; tightening them can be breaking.
11. For case management/regulatory systems, validation must be explainable, auditable, and operationally observable.

---

## 35. How This Connects to the Next Part

REST validation catches invalid requests at the API boundary.

But once data enters persistence, another question appears:

```text
How do Bean/Jakarta Validation constraints interact with JPA lifecycle,
Hibernate ORM, entity graphs, lazy loading, and database constraints?
```

That is the focus of the next part.

---

# Status Seri

Seri **belum selesai**.

Bagian yang sudah dibuat sampai sekarang:

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
- Part 010 — Class-Level and Cross-Field Validation: Consistency inside One Object
- Part 011 — Cross-Parameter and Executable Validation: Methods, Constructors, Return Values
- Part 012 — Records, Immutability, Builders, Lombok, and Modern Java Modeling
- Part 013 — Message Interpolation: i18n, EL, Security, and Error Message Governance
- Part 014 — Payload, Severity, Error Codes, and Machine-Readable Violations
- Part 015 — Programmatic Constraint Mapping and Runtime Metadata
- Part 016 — Constraint Composition: Reusable Higher-Level Constraints
- Part 017 — Hibernate Validator Extensions: Beyond the Specification
- Part 018 — Dependency Injection in Validators: CDI, Spring, Jakarta EE, and Testability
- Part 019 — Validation in REST APIs: JAX-RS, Spring MVC, Error Mapping, and Problem Details

Bagian berikutnya:

```text
learn-java-validation-jakarta-hibernate-validator-part-020.md
```

Topik:

```text
Validation in Persistence: JPA Lifecycle, Hibernate ORM, Database Constraints
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Dependency Injection in Validators: CDI, Spring, Jakarta EE, and Testability](./learn-java-validation-jakarta-hibernate-validator-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Validation in Persistence: JPA Lifecycle, Hibernate ORM, Database Constraints](./learn-java-validation-jakarta-hibernate-validator-part-020.md)

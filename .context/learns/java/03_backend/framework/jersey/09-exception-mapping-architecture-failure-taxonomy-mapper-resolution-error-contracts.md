# Part 9 — Exception Mapping Architecture: Failure Taxonomy, Mapper Resolution, and Error Contracts

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Part: `09`  
Topic: `Exception Mapping Architecture`  
Target: Java 8–25, Jersey 2.x/3.x/4.x, JAX-RS/Jakarta REST, production-grade API engineering

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas response engineering: status code, headers, entity, streaming, caching, conditional request, dan kontrak response HTTP.

Part ini membahas sisi yang lebih sulit: **apa yang terjadi ketika request gagal**.

Di aplikasi kecil, error handling biasanya diperlakukan sebagai hal sampingan:

```java
try {
    return Response.ok(service.doSomething()).build();
} catch (Exception e) {
    return Response.serverError().build();
}
```

Di aplikasi production, terutama sistem enterprise/regulatory, pendekatan seperti itu berbahaya karena error bukan hanya “pesan gagal”. Error adalah bagian dari kontrak sistem.

Error perlu menjawab:

1. Apa yang gagal?
2. Siapa yang salah: client, server, dependency, atau state konflik?
3. Apakah request boleh diulang?
4. Apakah kegagalan perlu diaudit?
5. Apakah detail internal aman untuk ditampilkan?
6. Bagaimana operator menemukan trace/log terkait?
7. Apakah error shape stabil untuk client?
8. Apakah status HTTP-nya benar secara semantik?
9. Apakah error tersebut terjadi sebelum atau setelah response committed?
10. Apakah exception mapper yang tepat benar-benar dipilih runtime?

Jersey, sebagai implementasi JAX-RS/Jakarta REST, menyediakan mekanisme utama bernama:

```java
ExceptionMapper<T extends Throwable>
```

Mapper ini mengubah exception Java menjadi HTTP `Response`.

Tetapi topik ini bukan sekadar “buat class implements ExceptionMapper”. Yang jauh lebih penting adalah **arsitektur error**.

---

## 1. Core Mental Model

### 1.1 Request Processing Tidak Selalu Berakhir di Resource Method

Request ke Jersey bisa gagal di banyak titik:

```text
HTTP request
   |
   v
Container / servlet / connector layer
   |
   v
Pre-matching filters
   |
   v
Resource matching
   |
   v
Post-matching filters
   |
   v
Parameter injection / conversion / validation
   |
   v
MessageBodyReader
   |
   v
Resource method
   |
   v
Service/domain/infrastructure layer
   |
   v
MessageBodyWriter
   |
   v
Response filters / writer interceptors
   |
   v
HTTP response
```

Exception bisa muncul di hampir semua titik itu.

Contoh:

| Lokasi | Contoh Failure | Biasanya HTTP |
|---|---|---:|
| Routing | path tidak cocok | 404 |
| Method selection | method HTTP tidak didukung | 405 |
| Content negotiation | `Accept` tidak cocok | 406 |
| Entity reading | JSON invalid | 400 |
| Media type | `Content-Type` tidak didukung | 415 |
| Parameter conversion | `?page=abc` untuk integer | 400 |
| Validation | field wajib kosong | 400/422 tergantung policy |
| Authn | token tidak ada/tidak valid | 401 |
| Authz | user tidak berwenang | 403 |
| Domain state | data sudah berubah | 409 |
| Persistence | unique constraint | 409/500 tergantung mapping |
| Dependency | remote service timeout | 502/503/504 |
| Serialization | response DTO gagal ditulis | 500 |
| Streaming | client disconnect / write failure | sering tidak bisa dikirim lagi |

Mental model penting:

> Exception mapping adalah boundary antara **internal failure model** dan **external API error contract**.

Jangan biarkan exception internal keluar mentah ke client.

---

## 2. Apa Itu `ExceptionMapper`

Kontrak dasarnya:

```java
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public final class IllegalArgumentMapper implements ExceptionMapper<IllegalArgumentException> {
    @Override
    public Response toResponse(IllegalArgumentException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .entity(new ErrorResponse("BAD_REQUEST", exception.getMessage()))
                .build();
    }
}
```

Di Jersey 2.x namespace-nya masih:

```java
javax.ws.rs.ext.ExceptionMapper
javax.ws.rs.ext.Provider
javax.ws.rs.core.Response
```

Di Jersey 3.x/4.x namespace-nya:

```java
jakarta.ws.rs.ext.ExceptionMapper
jakarta.ws.rs.ext.Provider
jakarta.ws.rs.core.Response
```

### 2.1 Mapper Adalah Provider

Karena `ExceptionMapper` adalah provider, ia mengikuti aturan provider registration:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(BadRequestMapper.class);
        register(NotFoundMapper.class);
        register(GenericThrowableMapper.class);
    }
}
```

Atau auto-discovery melalui annotation `@Provider` jika scanning diaktifkan.

Namun untuk production, registration eksplisit sering lebih mudah dikendalikan.

---

## 3. `WebApplicationException`: Exception yang Sudah Membawa Response

`WebApplicationException` adalah runtime exception yang dapat dilempar oleh resource method, provider, atau `StreamingOutput` ketika aplikasi ingin menghasilkan HTTP error response tertentu.

Contoh:

```java
throw new NotFoundException("Case not found");
```

atau:

```java
throw new WebApplicationException(
        Response.status(Response.Status.CONFLICT)
                .entity(new ErrorResponse("CASE_ALREADY_CLOSED", "Case already closed"))
                .build()
);
```

Subclass umum:

```text
BadRequestException              -> 400
NotAuthorizedException           -> 401
ForbiddenException               -> 403
NotFoundException                -> 404
NotAllowedException              -> 405
NotAcceptableException           -> 406
NotSupportedException            -> 415
InternalServerErrorException     -> 500
ServiceUnavailableException      -> 503
```

### 3.1 Jangan Overuse `WebApplicationException`

`WebApplicationException` berguna untuk kasus dekat HTTP boundary.

Tapi jangan melempar ini dari domain layer:

```java
// buruk: domain layer tahu HTTP
public void approveCase(CaseId id) {
    if (caseClosed) {
        throw new WebApplicationException(409);
    }
}
```

Lebih baik domain layer melempar domain exception:

```java
public void approveCase(CaseId id) {
    if (caseClosed) {
        throw new CaseAlreadyClosedException(id);
    }
}
```

Lalu Jersey mapper menerjemahkan:

```java
@Provider
public final class CaseAlreadyClosedMapper
        implements ExceptionMapper<CaseAlreadyClosedException> {

    @Override
    public Response toResponse(CaseAlreadyClosedException ex) {
        return Response.status(Response.Status.CONFLICT)
                .entity(ApiError.conflict("CASE_ALREADY_CLOSED", "Case is already closed."))
                .build();
    }
}
```

Prinsip:

> Domain exception menjelaskan realitas bisnis. Exception mapper menjelaskan representasi HTTP-nya.

---

## 4. Mapper Resolution: Mapper Mana yang Dipilih?

Ketika exception terjadi, runtime mencari mapper yang paling sesuai dengan tipe exception.

Contoh mapper:

```java
@Provider
public final class RuntimeExceptionMapper implements ExceptionMapper<RuntimeException> { ... }

@Provider
public final class IllegalArgumentMapper implements ExceptionMapper<IllegalArgumentException> { ... }
```

Jika exception yang dilempar:

```java
throw new IllegalArgumentException("invalid page");
```

Maka mapper yang lebih spesifik, yaitu `IllegalArgumentMapper`, seharusnya dipilih.

Mental model:

```text
Thrown exception: IllegalArgumentException

Candidate mappers:
  ExceptionMapper<Throwable>
  ExceptionMapper<Exception>
  ExceptionMapper<RuntimeException>
  ExceptionMapper<IllegalArgumentException>

Best match:
  ExceptionMapper<IllegalArgumentException>
```

### 4.1 Generic Mapper Harus Ada, Tapi Berbahaya Kalau Terlalu Agresif

Generic mapper biasanya:

```java
@Provider
public final class ThrowableMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable ex) {
        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .entity(ApiError.internal("INTERNAL_ERROR", "Unexpected server error."))
                .build();
    }
}
```

Ini berguna untuk mencegah stack trace bocor.

Tapi risiko:

1. Menelan exception yang seharusnya punya status lebih tepat.
2. Menutupi bug registration mapper spesifik.
3. Mengubah 404/405/415 internal menjadi 500 jika tidak hati-hati.
4. Membuat monitoring kehilangan kategori failure asli.

Karena itu generic mapper harus:

- logging dengan severity tepat,
- mempertahankan correlation ID,
- tidak membocorkan internal detail,
- tidak mengubah known HTTP exceptions secara sembarangan,
- menjadi last-resort mapper.

---

## 5. Error Taxonomy: Fondasi Arsitektur Error

Sebelum menulis mapper, tentukan taxonomy.

Tanpa taxonomy, error API biasanya tumbuh liar:

```json
{ "error": "failed" }
```

```json
{ "message": "Data not found" }
```

```json
{ "status": 500, "description": "Oops" }
```

```json
{ "code": "ERR001" }
```

Client akhirnya sulit menulis handling yang stabil.

### 5.1 Taxonomy Utama

Gunakan kategori besar:

```text
CLIENT_INPUT_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
RESOURCE_NOT_FOUND
RESOURCE_CONFLICT
PRECONDITION_FAILED
RATE_LIMITED
DOMAIN_RULE_VIOLATION
DEPENDENCY_FAILURE
TEMPORARY_UNAVAILABLE
INTERNAL_ERROR
```

Mapping umum:

| Taxonomy | HTTP | Contoh |
|---|---:|---|
| `CLIENT_INPUT_ERROR` | 400 | malformed JSON, invalid query parameter |
| `AUTHENTICATION_ERROR` | 401 | token missing/expired |
| `AUTHORIZATION_ERROR` | 403 | role tidak cukup |
| `RESOURCE_NOT_FOUND` | 404 | case ID tidak ada |
| `RESOURCE_CONFLICT` | 409 | duplicate, state conflict |
| `PRECONDITION_FAILED` | 412 | ETag mismatch |
| `RATE_LIMITED` | 429 | client terlalu sering request |
| `DOMAIN_RULE_VIOLATION` | 422/409/400 | tergantung policy |
| `DEPENDENCY_FAILURE` | 502 | upstream error |
| `TEMPORARY_UNAVAILABLE` | 503/504 | timeout/maintenance |
| `INTERNAL_ERROR` | 500 | bug tidak terduga |

### 5.2 Jangan Samakan Semua Validation dengan 400

Tidak semua input failure sama.

Contoh:

```text
Malformed JSON                       -> 400 Bad Request
Query parameter cannot be parsed      -> 400 Bad Request
Field missing                         -> 400 atau 422 tergantung API policy
Business rule violation               -> 409 atau 422 tergantung semantics
Optimistic lock mismatch              -> 409 atau 412
User not allowed                      -> 403
Case not found                        -> 404
Case exists but hidden by permission   -> 404 atau 403 tergantung security policy
```

Untuk sistem regulasi, pilihan `403` vs `404` tidak hanya teknis. Kadang `404` dipakai untuk mencegah resource enumeration.

---

## 6. Error Contract: Bentuk Payload yang Stabil

Minimal error shape yang production-friendly:

```json
{
  "type": "https://api.example.com/problems/case-already-closed",
  "title": "Case already closed",
  "status": 409,
  "code": "CASE_ALREADY_CLOSED",
  "message": "The case cannot be approved because it is already closed.",
  "correlationId": "01HZX9YV7ZQ8Z7E2F5M9XK1T2A",
  "timestamp": "2026-06-16T12:30:45Z",
  "details": {
    "caseId": "CASE-2026-0001"
  }
}
```

Field yang disarankan:

| Field | Tujuan |
|---|---|
| `type` | stable problem URI / classification |
| `title` | human-readable short summary |
| `status` | HTTP status dalam body |
| `code` | application error code stabil |
| `message` | pesan aman untuk client |
| `correlationId` | penghubung ke log/trace |
| `timestamp` | waktu error terjadi |
| `details` | detail aman dan terstruktur |
| `violations` | daftar validation error jika ada |

### 6.1 Problem Details Style

Banyak API modern memakai gaya mirip RFC 7807 / Problem Details:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/CASE-001/approval"
}
```

Untuk enterprise, sering perlu extension fields:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/CASE-001/approval",
  "code": "VALIDATION_FAILED",
  "correlationId": "01HZX...",
  "violations": [
    {
      "field": "decisionDate",
      "code": "REQUIRED",
      "message": "decisionDate is required"
    }
  ]
}
```

### 6.2 Jangan Jadikan `message` sebagai Contract Utama

`message` bisa berubah karena wording, i18n, atau UX.

Client harus bergantung pada:

```text
HTTP status + machine-readable code + structured fields
```

Bukan pada:

```text
string matching terhadap message
```

---

## 7. Desain Class Error Response

Contoh portable untuk Java 8:

```java
public final class ApiError {
    private final String type;
    private final String title;
    private final int status;
    private final String code;
    private final String message;
    private final String correlationId;
    private final String timestamp;
    private final Map<String, Object> details;
    private final List<ApiViolation> violations;

    public ApiError(
            String type,
            String title,
            int status,
            String code,
            String message,
            String correlationId,
            String timestamp,
            Map<String, Object> details,
            List<ApiViolation> violations) {
        this.type = type;
        this.title = title;
        this.status = status;
        this.code = code;
        this.message = message;
        this.correlationId = correlationId;
        this.timestamp = timestamp;
        this.details = details == null ? Collections.emptyMap() : details;
        this.violations = violations == null ? Collections.emptyList() : violations;
    }

    public String getType() { return type; }
    public String getTitle() { return title; }
    public int getStatus() { return status; }
    public String getCode() { return code; }
    public String getMessage() { return message; }
    public String getCorrelationId() { return correlationId; }
    public String getTimestamp() { return timestamp; }
    public Map<String, Object> getDetails() { return details; }
    public List<ApiViolation> getViolations() { return violations; }
}
```

Java 16+ bisa memakai record:

```java
public record ApiError(
        String type,
        String title,
        int status,
        String code,
        String message,
        String correlationId,
        String timestamp,
        Map<String, Object> details,
        List<ApiViolation> violations
) {}
```

Tetapi jika target masih Java 8, gunakan immutable POJO.

---

## 8. Error Factory: Hindari Duplikasi di Tiap Mapper

Buruk:

```java
@Provider
public final class CaseNotFoundMapper implements ExceptionMapper<CaseNotFoundException> {
    @Override
    public Response toResponse(CaseNotFoundException ex) {
        ApiError error = new ApiError(... banyak field manual ...);
        return Response.status(404).entity(error).build();
    }
}
```

Lebih baik buat factory:

```java
public final class ApiErrorFactory {
    private final Clock clock;
    private final CorrelationIdProvider correlationIdProvider;

    public ApiErrorFactory(Clock clock, CorrelationIdProvider correlationIdProvider) {
        this.clock = clock;
        this.correlationIdProvider = correlationIdProvider;
    }

    public ApiError create(
            Response.Status status,
            String code,
            String title,
            String message,
            Map<String, Object> details) {

        return new ApiError(
                "https://api.example.com/problems/" + code.toLowerCase(Locale.ROOT).replace('_', '-'),
                title,
                status.getStatusCode(),
                code,
                message,
                correlationIdProvider.currentCorrelationId(),
                Instant.now(clock).toString(),
                details,
                Collections.emptyList()
        );
    }
}
```

Lalu mapper:

```java
@Provider
public final class CaseNotFoundMapper implements ExceptionMapper<CaseNotFoundException> {
    private final ApiErrorFactory errors;

    public CaseNotFoundMapper(ApiErrorFactory errors) {
        this.errors = errors;
    }

    @Override
    public Response toResponse(CaseNotFoundException ex) {
        ApiError error = errors.create(
                Response.Status.NOT_FOUND,
                "CASE_NOT_FOUND",
                "Case not found",
                "The requested case does not exist or is not accessible.",
                Collections.singletonMap("caseId", ex.caseId().value())
        );

        return Response.status(Response.Status.NOT_FOUND)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

### 8.1 Kenapa Factory Penting?

Karena error contract harus konsisten di semua mapper.

Factory memastikan:

- timestamp format sama,
- correlation ID selalu ada,
- type URI konsisten,
- message policy konsisten,
- status body sama dengan status HTTP,
- details disaring,
- violations shape konsisten.

---

## 9. Failure Taxonomy dalam Kode

Buat base domain exception yang tidak tahu HTTP.

```java
public abstract class DomainException extends RuntimeException {
    private final String code;

    protected DomainException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

Contoh:

```java
public final class CaseAlreadyClosedException extends DomainException {
    private final CaseId caseId;

    public CaseAlreadyClosedException(CaseId caseId) {
        super("CASE_ALREADY_CLOSED", "Case already closed: " + caseId.value());
        this.caseId = caseId;
    }

    public CaseId caseId() {
        return caseId;
    }
}
```

Mapper:

```java
@Provider
public final class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    private final ApiErrorFactory errors;

    public DomainExceptionMapper(ApiErrorFactory errors) {
        this.errors = errors;
    }

    @Override
    public Response toResponse(DomainException ex) {
        Response.Status status = mapStatus(ex);
        ApiError error = errors.create(
                status,
                ex.code(),
                titleOf(ex),
                safeMessageOf(ex),
                detailsOf(ex)
        );

        return Response.status(status)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }

    private Response.Status mapStatus(DomainException ex) {
        if (ex instanceof CaseAlreadyClosedException) {
            return Response.Status.CONFLICT;
        }
        return Response.Status.BAD_REQUEST;
    }
}
```

Untuk sistem besar, jangan taruh mapping raksasa berbasis `instanceof` tanpa struktur. Gunakan policy object atau registry.

Contoh:

```java
public final class ErrorDescriptor {
    private final Response.Status status;
    private final String title;
    private final String safeMessage;

    // constructor/getters
}
```

```java
public interface DomainErrorCatalog {
    ErrorDescriptor describe(DomainException exception);
}
```

---

## 10. Layered Exception Strategy

Jangan semua layer melempar exception yang sama.

```text
HTTP/Jersey layer
  - BadRequestException
  - NotFoundException near boundary
  - WebApplicationException rarely
  - ExceptionMapper

Application service layer
  - Use case exception
  - Authorization decision exception
  - Workflow/state transition exception

Domain layer
  - Domain invariant violation
  - State machine transition error
  - Business rule error

Infrastructure layer
  - Repository exception
  - Remote client exception
  - Timeout exception
  - Messaging exception
```

Mapper menerjemahkan exception yang keluar ke HTTP.

### 10.1 Jangan Bocorkan Infrastructure Detail

Buruk:

```json
{
  "code": "ORA-00001",
  "message": "unique constraint ACEAS.CASE_UK_01 violated"
}
```

Lebih baik:

```json
{
  "code": "DUPLICATE_CASE_REFERENCE",
  "message": "A case with the same reference already exists.",
  "correlationId": "..."
}
```

Detail teknis tetap masuk log internal:

```text
ERROR correlationId=... exception=ORA-00001 constraint=ACEAS.CASE_UK_01
```

---

## 11. Status Code Decision Model

### 11.1 400 vs 422

`400 Bad Request` cocok untuk request yang secara sintaks atau format invalid:

- JSON malformed
- query parameter tidak bisa di-convert
- required parameter hilang
- invalid enum value

`422 Unprocessable Entity` sering dipakai ketika request syntactically valid tapi semantically invalid.

Contoh:

```json
{
  "decision": "APPROVE",
  "decisionDate": "2026-06-16"
}
```

JSON valid, tapi case sudah closed.

Namun Jakarta REST standard enum `Response.Status` tidak selalu menyediakan semua kode non-core seperti 422 di semua versi. Bisa pakai custom `StatusType`.

```java
public enum ExtendedStatus implements Response.StatusType {
    UNPROCESSABLE_ENTITY(422, "Unprocessable Entity"),
    TOO_MANY_REQUESTS(429, "Too Many Requests");

    private final int code;
    private final String reason;

    ExtendedStatus(int code, String reason) {
        this.code = code;
        this.reason = reason;
    }

    @Override
    public int getStatusCode() {
        return code;
    }

    @Override
    public Response.Status.Family getFamily() {
        return Response.Status.Family.familyOf(code);
    }

    @Override
    public String getReasonPhrase() {
        return reason;
    }
}
```

Usage:

```java
return Response.status(ExtendedStatus.UNPROCESSABLE_ENTITY)
        .entity(error)
        .build();
```

### 11.2 401 vs 403

```text
401 Unauthorized     -> authentication missing/invalid/expired
403 Forbidden        -> authenticated but not allowed
```

Untuk `401`, biasanya perlu `WWW-Authenticate` header.

```java
return Response.status(Response.Status.UNAUTHORIZED)
        .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
        .entity(error)
        .build();
```

### 11.3 404 vs 403 untuk Hidden Resources

Dalam sistem sensitif, jika user tidak berhak melihat sebuah resource, mengembalikan `403` bisa membocorkan bahwa resource tersebut ada.

Policy umum:

```text
Resource does not exist                  -> 404
Resource exists but user must not know   -> 404
Resource exists and user knows it exists but action forbidden -> 403
```

Ini harus diputuskan sebagai security policy, bukan keputusan spontan tiap endpoint.

### 11.4 409 vs 412

`409 Conflict` cocok untuk konflik state umum:

```text
Cannot approve a closed case.
Duplicate case reference.
Workflow transition invalid.
```

`412 Precondition Failed` cocok untuk conditional request seperti ETag:

```text
If-Match header tidak cocok dengan current ETag.
```

### 11.5 502 vs 503 vs 504

Untuk dependency failure:

| Status | Makna |
|---|---|
| 502 Bad Gateway | upstream memberi response invalid/error |
| 503 Service Unavailable | dependency atau service sementara unavailable |
| 504 Gateway Timeout | dependency timeout |

Jangan semua remote failure dijadikan 500. 500 berarti server ini gagal secara internal, bukan selalu dependency fault.

---

## 12. Mapper untuk Validation Error

Bean Validation biasanya melempar `ConstraintViolationException`.

Contoh mapper:

```java
@Provider
public final class ConstraintViolationMapper
        implements ExceptionMapper<ConstraintViolationException> {

    private final ApiErrorFactory errors;

    public ConstraintViolationMapper(ApiErrorFactory errors) {
        this.errors = errors;
    }

    @Override
    public Response toResponse(ConstraintViolationException ex) {
        List<ApiViolation> violations = ex.getConstraintViolations()
                .stream()
                .map(v -> new ApiViolation(
                        normalizePath(v.getPropertyPath().toString()),
                        constraintCode(v),
                        v.getMessage()
                ))
                .collect(Collectors.toList());

        ApiError error = errors.validationFailed(violations);

        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }

    private String normalizePath(String rawPath) {
        // Example raw path may include method name or arg index depending runtime.
        return rawPath;
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

Violation shape:

```java
public final class ApiViolation {
    private final String field;
    private final String code;
    private final String message;

    public ApiViolation(String field, String code, String message) {
        this.field = field;
        this.code = code;
        this.message = message;
    }

    public String getField() { return field; }
    public String getCode() { return code; }
    public String getMessage() { return message; }
}
```

### 12.1 Jangan Tampilkan Internal Property Path Mentah

Raw validation path kadang seperti:

```text
createCase.arg0.applicant.email
approve.arg1
CaseRequest.applicant.nric
```

Client tidak butuh `arg0` atau nama method Java.

Normalisasikan menjadi:

```text
applicant.email
```

atau:

```text
body.applicant.email
query.page
path.caseId
```

---

## 13. Mapper untuk JSON Parse Error

JSON invalid biasanya muncul dari provider layer, misalnya Jackson melempar exception tertentu yang dibungkus oleh Jersey/JAX-RS.

Target external response:

```json
{
  "code": "MALFORMED_JSON",
  "message": "Request body is not valid JSON."
}
```

Jangan tampilkan parser detail penuh ke client:

```text
Unexpected character ('}' (code 125)): was expecting double-quote to start field name
 at [Source: ...]
```

Itu boleh masuk log debug/internal, tapi external message harus aman.

Contoh mapper generik untuk bad request near entity reading:

```java
@Provider
public final class BadRequestMapper implements ExceptionMapper<BadRequestException> {
    private final ApiErrorFactory errors;

    public BadRequestMapper(ApiErrorFactory errors) {
        this.errors = errors;
    }

    @Override
    public Response toResponse(BadRequestException ex) {
        ApiError error = errors.create(
                Response.Status.BAD_REQUEST,
                "BAD_REQUEST",
                "Bad request",
                "The request is invalid or cannot be processed.",
                Collections.emptyMap()
        );

        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

Untuk membedakan malformed JSON dari parameter conversion, kita dapat membuat mapper yang lebih spesifik terhadap exception provider tertentu, tetapi hati-hati agar tidak mengikat API contract terlalu dalam ke Jackson internals.

---

## 14. Mapper untuk `NotFoundException`, `NotAllowedException`, `NotSupportedException`

Jersey/Jakarta REST dapat menghasilkan exception HTTP sebelum resource method berjalan.

Contoh:

```java
@Provider
public final class NotFoundMapper implements ExceptionMapper<NotFoundException> {
    private final ApiErrorFactory errors;

    @Override
    public Response toResponse(NotFoundException ex) {
        ApiError error = errors.create(
                Response.Status.NOT_FOUND,
                "RESOURCE_NOT_FOUND",
                "Resource not found",
                "The requested resource was not found.",
                Collections.emptyMap()
        );

        return Response.status(Response.Status.NOT_FOUND)
                .entity(error)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .build();
    }
}
```

Untuk `405 Method Not Allowed`, penting mempertahankan `Allow` header jika runtime menyediakannya.

```java
@Provider
public final class NotAllowedMapper implements ExceptionMapper<NotAllowedException> {
    private final ApiErrorFactory errors;

    @Override
    public Response toResponse(NotAllowedException ex) {
        Response original = ex.getResponse();

        Response.ResponseBuilder builder = Response.status(Response.Status.METHOD_NOT_ALLOWED)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(errors.create(
                        Response.Status.METHOD_NOT_ALLOWED,
                        "METHOD_NOT_ALLOWED",
                        "Method not allowed",
                        "The HTTP method is not allowed for this resource.",
                        Collections.emptyMap()
                ));

        String allow = original.getHeaderString(HttpHeaders.ALLOW);
        if (allow != null) {
            builder.header(HttpHeaders.ALLOW, allow);
        }

        return builder.build();
    }
}
```

Untuk `415 Unsupported Media Type`:

```java
@Provider
public final class NotSupportedMapper implements ExceptionMapper<NotSupportedException> {
    @Override
    public Response toResponse(NotSupportedException ex) {
        ApiError error = ...;
        return Response.status(Response.Status.UNSUPPORTED_MEDIA_TYPE)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

Untuk `406 Not Acceptable`:

```java
@Provider
public final class NotAcceptableMapper implements ExceptionMapper<NotAcceptableException> {
    @Override
    public Response toResponse(NotAcceptableException ex) {
        ApiError error = ...;
        return Response.status(Response.Status.NOT_ACCEPTABLE)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

Catatan penting:

Jika client mengirim `Accept` yang tidak mencakup JSON, mengembalikan JSON error untuk 406 secara ketat bisa diperdebatkan. Namun banyak API production tetap mengembalikan standardized error JSON agar client mudah debugging. Tetapkan policy secara eksplisit.

---

## 15. Exception Mapper dan Response yang Sudah Committed

Ada failure yang terjadi setelah response mulai dikirim.

Contoh:

```java
return Response.ok((StreamingOutput) output -> {
    output.write(firstChunk);
    // error setelah sebagian response terkirim
    throw new RuntimeException("storage read failed");
}).build();
```

Jika header/status/body sebagian sudah committed, mapper tidak bisa lagi mengganti response menjadi JSON error rapi.

Mental model:

```text
Before response committed:
  exception -> mapper -> error response possible

After response committed:
  exception -> connection may close / partial body / log only
```

Implikasi:

- Streaming endpoint harus punya observability kuat.
- Jangan mengandalkan `ExceptionMapper` untuk semua error streaming.
- Validasi precondition sebelum mulai write body.
- Untuk download besar, cek permission, existence, metadata, content length, dan dependency availability sedini mungkin.

---

## 16. Correlation ID dalam Error Response

Correlation ID harus tersedia baik di success maupun error.

Biasanya dibuat di request filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION - 100)
public final class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {
    public static final String HEADER = "X-Correlation-ID";
    public static final String PROPERTY = "correlationId";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String incoming = requestContext.getHeaderString(HEADER);
        String correlationId = isValid(incoming) ? incoming : generate();

        requestContext.setProperty(PROPERTY, correlationId);
        MDC.put("correlationId", correlationId);
    }

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext) {
        Object correlationId = requestContext.getProperty(PROPERTY);
        if (correlationId != null) {
            responseContext.getHeaders().putSingle(HEADER, correlationId.toString());
        }
        MDC.remove("correlationId");
    }

    private boolean isValid(String value) {
        return value != null && value.length() <= 128;
    }

    private String generate() {
        return UUID.randomUUID().toString();
    }
}
```

Mapper bisa membaca dari `ContainerRequestContext`:

```java
@Context
private HttpHeaders headers;

@Context
private ContainerRequestContext requestContext;
```

Namun lebih rapi jika ada abstraction:

```java
public interface CorrelationIdProvider {
    String currentCorrelationId();
}
```

### 16.1 Jangan Percaya Semua Incoming Correlation ID

Validasi:

- panjang maksimal,
- karakter aman,
- tidak mengandung newline,
- tidak mengandung control character,
- jangan langsung masuk log tanpa sanitasi.

Ini mencegah log injection.

---

## 17. Logging Policy dalam Mapper

Kesalahan umum:

```java
log.error("Error", ex);
```

untuk semua exception.

Akibatnya:

- validation error client menghasilkan error log berisik,
- monitoring false alarm,
- log storage membengkak,
- incident asli tenggelam.

Gunakan logging severity berdasarkan taxonomy:

| Error Type | Logging |
|---|---|
| 400 malformed input | debug/info terbatas |
| 401/403 | info/warn tergantung security context |
| 404 normal | debug atau no log |
| 409 business conflict | info/debug |
| 429 rate limit | warn jika abuse |
| 502/503/504 dependency | warn/error tergantung impact |
| 500 internal bug | error + stack trace |

Contoh:

```java
public final class ErrorLogger {
    private static final Logger log = LoggerFactory.getLogger(ErrorLogger.class);

    public void logMapped(Throwable ex, ApiError error, int status) {
        if (status >= 500) {
            log.error("request_failed status={} code={} correlationId={}",
                    status, error.getCode(), error.getCorrelationId(), ex);
        } else if (status == 401 || status == 403 || status == 429) {
            log.warn("request_rejected status={} code={} correlationId={} message={}",
                    status, error.getCode(), error.getCorrelationId(), sanitize(ex.getMessage()));
        } else {
            log.debug("request_invalid status={} code={} correlationId={}",
                    status, error.getCode(), error.getCorrelationId());
        }
    }
}
```

### 17.1 Sensitive Data Policy

Jangan log sembarangan:

- password,
- token,
- authorization header,
- NRIC/NIK/passport,
- raw request body berisi PII,
- full SQL dengan parameter sensitif,
- internal secret,
- private key,
- session cookie.

Error mapper harus menganggap exception message sebagai tidak selalu aman.

---

## 18. Security Exception Mapping

Authentication failure:

```java
@Provider
public final class NotAuthorizedMapper implements ExceptionMapper<NotAuthorizedException> {
    private final ApiErrorFactory errors;

    @Override
    public Response toResponse(NotAuthorizedException ex) {
        ApiError error = errors.create(
                Response.Status.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED",
                "Authentication required",
                "Authentication is required to access this resource.",
                Collections.emptyMap()
        );

        return Response.status(Response.Status.UNAUTHORIZED)
                .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

Authorization failure:

```java
@Provider
public final class ForbiddenMapper implements ExceptionMapper<ForbiddenException> {
    @Override
    public Response toResponse(ForbiddenException ex) {
        ApiError error = ...;
        return Response.status(Response.Status.FORBIDDEN)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

### 18.1 Jangan Bocorkan Authorization Detail

Buruk:

```json
{
  "message": "User lacks CASE_APPROVER_LEVEL_3 role for department ENFORCEMENT_UNIT_A"
}
```

Lebih aman:

```json
{
  "code": "ACCESS_DENIED",
  "message": "You are not allowed to perform this action."
}
```

Detail lengkap bisa masuk audit/security log internal.

---

## 19. Dependency Failure Mapping

Outbound client layer sebaiknya tidak membocorkan exception vendor.

Misalnya Jersey Client remote call gagal:

```java
public final class ExternalRegistryUnavailableException extends RuntimeException {
    private final String dependency;

    public ExternalRegistryUnavailableException(String dependency, Throwable cause) {
        super("External dependency unavailable: " + dependency, cause);
        this.dependency = dependency;
    }

    public String dependency() {
        return dependency;
    }
}
```

Mapper:

```java
@Provider
public final class ExternalDependencyMapper
        implements ExceptionMapper<ExternalRegistryUnavailableException> {

    @Override
    public Response toResponse(ExternalRegistryUnavailableException ex) {
        ApiError error = errors.create(
                Response.Status.SERVICE_UNAVAILABLE,
                "DEPENDENCY_UNAVAILABLE",
                "Dependency unavailable",
                "A required downstream service is temporarily unavailable.",
                Collections.singletonMap("dependency", publicDependencyName(ex.dependency()))
        );

        return Response.status(Response.Status.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, "30")
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

### 19.1 Retry Semantics

Untuk dependency failure, response perlu memberi sinyal:

- boleh retry atau tidak,
- retry setelah berapa lama,
- apakah request idempotent,
- apakah request sudah diterima sebagian.

Contoh:

```text
503 + Retry-After       -> client boleh retry nanti
504                     -> timeout, retry tergantung idempotency
409                     -> jangan retry tanpa perubahan state/input
400                     -> jangan retry input yang sama
500                     -> retry hanya jika operation idempotent atau punya idempotency key
```

---

## 20. Transaction Boundary dan Exception Mapping

Jangan mapping persistence exception mentah tanpa memahami transaksi.

Contoh failure:

```text
Unique constraint violation
Optimistic lock exception
Deadlock
Connection timeout
SQL syntax bug
Data truncation
Foreign key violation
```

Mapping yang mungkin:

| Persistence Exception | External Meaning | HTTP |
|---|---|---:|
| unique violation karena business key | duplicate resource | 409 |
| optimistic lock | concurrent modification | 409 / 412 |
| FK violation dari invalid reference | invalid input | 400 / 409 |
| DB connection unavailable | service unavailable | 503 |
| SQL syntax bug | internal error | 500 |
| deadlock | temporary failure | 503 / 500 tergantung retry policy |

Jangan expose:

```text
table name
schema name
constraint internal name
SQL query
bind parameter PII
```

### 20.1 Convert Infrastructure Exception Sebelum Keluar dari Repository/Application Service

Lebih baik:

```java
try {
    repository.save(caseRecord);
} catch (UniqueConstraintViolation e) {
    throw new DuplicateCaseReferenceException(caseRecord.reference(), e);
}
```

Lalu mapper tahu domain meaning.

---

## 21. ExceptionMapper yang Menggunakan Injection

Mapper sering butuh:

- logger/audit writer,
- error factory,
- clock,
- request context,
- config,
- message localizer.

Dengan HK2/Jersey:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(new AbstractBinder() {
            @Override
            protected void configure() {
                bind(Clock.systemUTC()).to(Clock.class);
                bind(ApiErrorFactory.class).to(ApiErrorFactory.class);
            }
        });

        register(CaseNotFoundMapper.class);
        register(GenericThrowableMapper.class);
    }
}
```

Mapper:

```java
@Provider
public final class GenericThrowableMapper implements ExceptionMapper<Throwable> {
    private final ApiErrorFactory errors;
    private final ErrorLogger errorLogger;

    @Inject
    public GenericThrowableMapper(ApiErrorFactory errors, ErrorLogger errorLogger) {
        this.errors = errors;
        this.errorLogger = errorLogger;
    }

    @Override
    public Response toResponse(Throwable ex) {
        ApiError error = errors.internalError();
        errorLogger.logMapped(ex, error, 500);

        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(error)
                .build();
    }
}
```

Catatan:

- Pastikan dependency mapper thread-safe.
- Mapper bisa singleton tergantung container/provider lifecycle.
- Jangan simpan state request di field instance.
- Gunakan request context abstraction untuk state per request.

---

## 22. Avoiding Mapper Anti-Patterns

### 22.1 Anti-Pattern: One Giant Mapper for Everything

```java
@Provider
public final class EverythingMapper implements ExceptionMapper<Throwable> {
    public Response toResponse(Throwable ex) {
        if (ex instanceof A) ...
        else if (ex instanceof B) ...
        else if (ex instanceof C) ...
        // 500 lines
    }
}
```

Masalah:

- sulit dites,
- ordering mental sulit,
- mapping mudah bentrok,
- domain taxonomy tersembunyi,
- generic catch-all terlalu kuat.

Lebih baik:

- beberapa mapper spesifik untuk kategori besar,
- shared `ApiErrorFactory`,
- shared catalog/policy,
- generic fallback kecil.

### 22.2 Anti-Pattern: Returning Raw String Error

```java
return Response.status(400).entity("Invalid request").build();
```

Masalah:

- client parsing sulit,
- tidak ada code,
- tidak ada correlation ID,
- tidak ada consistent content type.

### 22.3 Anti-Pattern: Leaking Exception Message

```java
.entity(new ErrorResponse("ERROR", ex.getMessage()))
```

`ex.getMessage()` bisa berisi:

- SQL,
- path file,
- credential/token,
- internal class name,
- stack detail,
- vendor-specific message.

Gunakan safe message.

### 22.4 Anti-Pattern: Logging 4xx sebagai ERROR

4xx adalah client-side failure atau expected rejection. Tidak semua perlu error log.

### 22.5 Anti-Pattern: Mapper Melempar Exception Baru

Jika `toResponse` sendiri throw runtime exception, hasilnya bisa menjadi 500 atau behavior yang sulit ditelusuri.

Mapper harus defensif.

```java
@Override
public Response toResponse(Throwable ex) {
    try {
        ApiError error = errors.internalError();
        return Response.status(500).entity(error).build();
    } catch (Throwable mapperFailure) {
        // Last resort. Keep it simple.
        return Response.status(500)
                .type(MediaType.TEXT_PLAIN_TYPE)
                .entity("Internal server error")
                .build();
    }
}
```

---

## 23. Error Contract Versioning

Error contract juga perlu versioning.

Perubahan aman:

- menambah optional field,
- menambah error code baru,
- menambah violation detail baru,
- memperjelas message tanpa mengubah code.

Perubahan berisiko:

- mengganti `code`,
- mengganti HTTP status,
- menghapus field,
- mengubah tipe field,
- mengubah semantics retry,
- mengubah 403 menjadi 404 tanpa client/security alignment.

### 23.1 Error Code Harus Stabil

Gunakan kode seperti:

```text
VALIDATION_FAILED
CASE_NOT_FOUND
CASE_ALREADY_CLOSED
ACCESS_DENIED
AUTHENTICATION_REQUIRED
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

Jangan gunakan kode terlalu teknis:

```text
NULL_POINTER_EXCEPTION
SQL_00001
JACKSON_PARSE_ERROR
HK2_INJECTION_FAILED
```

Kecuali API internal developer platform memang membutuhkan itu.

---

## 24. Testing Exception Mapper

### 24.1 Unit Test Mapper

```java
@Test
public void mapsCaseNotFoundTo404() {
    ApiErrorFactory factory = fixedFactory("corr-1", Instant.parse("2026-06-16T00:00:00Z"));
    CaseNotFoundMapper mapper = new CaseNotFoundMapper(factory);

    Response response = mapper.toResponse(new CaseNotFoundException(new CaseId("CASE-1")));

    assertEquals(404, response.getStatus());
    ApiError error = (ApiError) response.getEntity();
    assertEquals("CASE_NOT_FOUND", error.getCode());
    assertEquals("corr-1", error.getCorrelationId());
}
```

### 24.2 Jersey Runtime Test

Unit test mapper tidak cukup. Kita perlu test bahwa Jersey benar-benar memilih mapper yang tepat.

```java
public class ErrorMappingResourceTest extends JerseyTest {
    @Override
    protected Application configure() {
        return new ResourceConfig()
                .register(TestResource.class)
                .register(CaseNotFoundMapper.class)
                .register(GenericThrowableMapper.class)
                .register(JacksonFeature.class);
    }

    @Test
    public void runtimeUsesSpecificMapper() {
        Response response = target("cases/CASE-404")
                .request(MediaType.APPLICATION_JSON_TYPE)
                .get();

        assertEquals(404, response.getStatus());
        ApiError error = response.readEntity(ApiError.class);
        assertEquals("CASE_NOT_FOUND", error.getCode());
    }
}
```

### 24.3 Negative Tests yang Wajib Ada

Test minimal:

```text
Malformed JSON -> 400 standardized error
Unknown path -> 404 standardized error
Wrong method -> 405 standardized error + Allow header
Unsupported Content-Type -> 415 standardized error
Unsupported Accept -> 406 standardized error
Validation failure -> 400/422 standardized violations
Domain conflict -> 409 standardized error
Forbidden -> 403 no sensitive detail
Unexpected NPE -> 500 safe message + correlation ID
```

---

## 25. Integration dengan Observability

Error mapper adalah tempat strategis untuk:

- menambahkan correlation ID,
- menambahkan error code ke log,
- menambahkan metric counter,
- menambahkan tracing attribute,
- menambahkan audit event tertentu.

Contoh metric:

```text
http.server.errors.total{
  status="409",
  code="CASE_ALREADY_CLOSED",
  resource="CaseApprovalResource.approve"
}
```

Tracing attributes:

```text
error.code=CASE_ALREADY_CLOSED
http.status_code=409
correlation.id=...
exception.type=...
```

Namun jangan masukkan high-cardinality values sebagai label metric:

Buruk:

```text
caseId="CASE-2026-0000001"
userId="S1234567A"
exceptionMessage="..."
```

Baik:

```text
code="CASE_ALREADY_CLOSED"
status="409"
method="POST"
route="/cases/{caseId}/approval"
```

---

## 26. Audit Trail dan Regulatory Defensibility

Untuk sistem regulatory/case management, error tertentu bukan sekadar failure teknis.

Contoh yang perlu audit:

- user mencoba approve case tanpa authority,
- user mencoba akses case yang bukan scope-nya,
- invalid state transition,
- repeated failed authentication,
- duplicate submission,
- tampered version/ETag,
- forbidden document download,
- rejected operation karena legal hold/compliance rule.

Error mapper sendiri boleh memicu audit event, tetapi hati-hati:

```text
Resource/service layer tahu business context lebih kaya.
Mapper tahu HTTP result lebih jelas.
```

Pattern yang lebih baik:

```text
Domain/application service emits structured rejection event
Exception mapper renders external HTTP error
Audit writer records rejection with correlation ID
```

Jangan membuat mapper harus menggali ulang database hanya demi audit.

---

## 27. Java 8–25 Considerations

### 27.1 Java 8

- Gunakan POJO immutable, bukan record.
- Gunakan `javax.ws.rs` untuk Jersey 2.x.
- Hindari API modern seperti `List.of`, `Map.of`.
- `Clock`, `Instant`, dan `Optional` tersedia.
- Stream API tersedia tapi jangan overcomplicate mapper.

### 27.2 Java 11/17

- Java 11 sering menjadi baseline modern legacy.
- Java 17 penting untuk Jakarta EE 10/11 ecosystem di banyak runtime.
- Bisa gunakan switch expression di Java 14+, tapi jika source compatibility harus Java 8, hindari.

### 27.3 Java 21/25

- Bisa gunakan records untuk DTO/error payload jika JSON provider mendukung.
- Virtual threads tidak mengubah semantics exception mapping.
- ThreadLocal/MDC propagation tetap perlu diperhatikan.
- Structured concurrency dapat membantu outbound orchestration, tetapi failure tetap harus diterjemahkan menjadi stable API error.

### 27.4 `javax` vs `jakarta`

Jersey 2.x:

```java
import javax.ws.rs.ext.ExceptionMapper;
import javax.ws.rs.ext.Provider;
import javax.ws.rs.core.Response;
```

Jersey 3.x/4.x:

```java
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import jakarta.ws.rs.core.Response;
```

Kesalahan namespace dapat menyebabkan:

- provider tidak terdeteksi,
- classpath conflict,
- `ClassNotFoundException`,
- `NoSuchMethodError`,
- mapper tidak pernah dipakai.

---

## 28. Recommended Mapper Set untuk Production Jersey API

Baseline mapper set:

```text
1. NotFoundExceptionMapper
2. NotAllowedExceptionMapper
3. NotAcceptableExceptionMapper
4. NotSupportedExceptionMapper
5. BadRequestExceptionMapper
6. NotAuthorizedExceptionMapper
7. ForbiddenExceptionMapper
8. ConstraintViolationExceptionMapper
9. DomainExceptionMapper
10. ConflictExceptionMapper / OptimisticLockMapper
11. DependencyFailureMapper
12. RateLimitMapper
13. WebApplicationExceptionMapper, optional and careful
14. ThrowableMapper fallback
```

Namun jangan langsung membuat semuanya jika belum dibutuhkan. Buat dengan taxonomy jelas.

---

## 29. Registration Strategy

Production recommendation:

```java
public final class ErrorHandlingFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(NotFoundMapper.class);
        context.register(NotAllowedMapper.class);
        context.register(NotAcceptableMapper.class);
        context.register(NotSupportedMapper.class);
        context.register(BadRequestMapper.class);
        context.register(NotAuthorizedMapper.class);
        context.register(ForbiddenMapper.class);
        context.register(ConstraintViolationMapper.class);
        context.register(DomainExceptionMapper.class);
        context.register(ExternalDependencyMapper.class);
        context.register(GenericThrowableMapper.class);
        return true;
    }
}
```

Application:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(new PlatformBinder());
        register(ErrorHandlingFeature.class);
        register(ApiResourcesFeature.class);
    }
}
```

Keuntungan:

- error handling menjadi platform module,
- registration eksplisit,
- mudah dites,
- mudah dipakai ulang antar service,
- bisa versioned sebagai internal library.

---

## 30. Design Checklist

Gunakan checklist ini saat mendesain error architecture Jersey:

```text
[ ] Apakah semua error response punya shape konsisten?
[ ] Apakah semua error response punya machine-readable code?
[ ] Apakah correlation ID selalu ada?
[ ] Apakah status HTTP sesuai semantics?
[ ] Apakah mapper spesifik didaftarkan sebelum fallback?
[ ] Apakah generic fallback tidak membocorkan stack trace?
[ ] Apakah 404/405/406/415 distandardisasi?
[ ] Apakah validation error punya violations array?
[ ] Apakah field path validation dinormalisasi?
[ ] Apakah authn/authz tidak membocorkan detail sensitif?
[ ] Apakah persistence exception diterjemahkan ke domain/infrastructure exception?
[ ] Apakah dependency timeout/error punya status tepat?
[ ] Apakah retry semantics jelas?
[ ] Apakah 4xx tidak memenuhi log error secara berlebihan?
[ ] Apakah 5xx selalu masuk log dengan stack trace dan correlation ID?
[ ] Apakah mapper aman jika error factory gagal?
[ ] Apakah streaming failure dipahami sebagai special case?
[ ] Apakah error contract dites di runtime Jersey?
[ ] Apakah namespace javax/jakarta sesuai versi Jersey?
```

---

## 31. Mini Case Study: Approval API

Endpoint:

```text
POST /cases/{caseId}/approval
```

Kemungkinan failure:

```text
caseId invalid format           -> 400 INVALID_CASE_ID
request JSON malformed          -> 400 MALFORMED_JSON
decision missing                -> 400 VALIDATION_FAILED
user not logged in              -> 401 AUTHENTICATION_REQUIRED
user lacks authority            -> 403 ACCESS_DENIED
case not found                  -> 404 CASE_NOT_FOUND
case already closed             -> 409 CASE_ALREADY_CLOSED
case version mismatch           -> 412 PRECONDITION_FAILED
approval engine timeout         -> 504 DEPENDENCY_TIMEOUT
unexpected bug                  -> 500 INTERNAL_ERROR
```

External error example:

```json
{
  "type": "https://api.example.com/problems/case-already-closed",
  "title": "Case already closed",
  "status": 409,
  "code": "CASE_ALREADY_CLOSED",
  "message": "The case cannot be approved because it is already closed.",
  "correlationId": "9bc8500b-6fa7-4d70-b137-41cc6e6b9a8d",
  "timestamp": "2026-06-16T12:00:00Z",
  "details": {
    "caseId": "CASE-2026-0001"
  },
  "violations": []
}
```

Internal log:

```text
INFO approval_rejected code=CASE_ALREADY_CLOSED caseId=CASE-2026-0001 user=U123 correlationId=9bc8500b-6fa7-4d70-b137-41cc6e6b9a8d
```

Audit event:

```json
{
  "eventType": "CASE_APPROVAL_REJECTED",
  "caseId": "CASE-2026-0001",
  "actor": "U123",
  "reasonCode": "CASE_ALREADY_CLOSED",
  "correlationId": "9bc8500b-6fa7-4d70-b137-41cc6e6b9a8d",
  "occurredAt": "2026-06-16T12:00:00Z"
}
```

Perhatikan pemisahan:

```text
Client response -> aman, stabil, tidak terlalu detail
Log             -> teknis, untuk operator/developer
Audit           -> business/legal evidence
```

---

## 32. Common Debugging Flow

Jika error mapping tidak bekerja:

```text
1. Apakah mapper terdaftar?
2. Apakah annotation @Provider ada jika mengandalkan scanning?
3. Apakah package scanning mencakup mapper?
4. Apakah namespace javax/jakarta sesuai?
5. Apakah generic mapper menutupi mapper spesifik?
6. Apakah exception yang dilempar benar-benar tipe yang dipikirkan?
7. Apakah exception dibungkus oleh exception lain?
8. Apakah error terjadi setelah response committed?
9. Apakah MessageBodyWriter untuk ApiError tersedia?
10. Apakah mapper sendiri throw exception?
11. Apakah content negotiation membuat error entity tidak bisa ditulis?
12. Apakah test benar-benar menjalankan Jersey runtime, bukan memanggil resource method langsung?
```

Untuk mengetahui tipe exception asli, log di fallback mapper:

```java
log.error("unmapped_exception type={} correlationId={}",
        ex.getClass().getName(), correlationId, ex);
```

---

## 33. Summary Mental Model

Exception mapping di Jersey adalah sistem penerjemah:

```text
Java exception
   -> classification
   -> HTTP status
   -> stable error code
   -> safe client message
   -> structured details
   -> correlation ID
   -> logging/metrics/tracing/audit
```

Jangan pikirkan mapper sebagai `catch` global saja.

Pikirkan sebagai:

```text
failure contract boundary
```

Resource method dan service layer boleh gagal. Tetapi API tidak boleh gagal secara acak.

Production-grade Jersey error architecture harus:

- konsisten,
- aman,
- dapat ditelusuri,
- mudah dites,
- tidak membocorkan internal detail,
- compatible dengan client,
- bisa dibedakan oleh monitoring,
- dan mendukung audit/regulatory evidence jika diperlukan.

---

## 34. Practical Exercises

1. Buat `ApiError` immutable POJO yang kompatibel Java 8.
2. Buat `ApiErrorFactory` dengan `Clock` dan `CorrelationIdProvider`.
3. Buat mapper untuk:
   - `NotFoundException`,
   - `BadRequestException`,
   - `ConstraintViolationException`,
   - `DomainException`,
   - `Throwable`.
4. Buat endpoint test yang melempar masing-masing exception.
5. Tulis Jersey runtime test untuk memastikan mapper spesifik dipilih.
6. Pastikan semua error response punya `X-Correlation-ID` header.
7. Pastikan 500 tidak membocorkan exception message.
8. Pastikan 400 validation tidak masuk `ERROR` log.
9. Buat error catalog untuk domain workflow state transition.
10. Simulasikan exception dari `StreamingOutput` setelah sebagian body terkirim dan amati behavior-nya.

---

## 35. Referensi Utama

- Jakarta RESTful Web Services 4.0 Specification
- Jakarta REST API documentation: `ExceptionMapper`, `WebApplicationException`, `Response`
- Eclipse Jersey User Guide: providers, resource lifecycle, error handling, filters/interceptors
- RFC 7807 Problem Details for HTTP APIs
- RFC 9110 HTTP Semantics

---

## 36. Status Series

Part 9 selesai.

Progress:

```text
Part 0  — Orientasi seri — selesai
Part 1  — Jersey mental model — selesai
Part 2  — Application bootstrap — selesai
Part 3  — Resource model internals — selesai
Part 4  — Request matching — selesai
Part 5  — Parameter injection semantics — selesai
Part 6  — Entity provider pipeline — selesai
Part 7  — JSON in Jersey — selesai
Part 8  — Response engineering — selesai
Part 9  — Exception mapping architecture — selesai
Part 10 — Filters and interceptors — berikutnya
...
Part 32 — Capstone — target akhir
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-response-engineering-status-headers-entities-streaming-caching-conditional-requests.md">⬅️ Part 8 — Response Engineering: Status, Headers, Entities, Streaming, Caching, Conditional Requests</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./10-filters-and-interceptors-request-response-pipeline-control.md">Part 10 — Filters and Interceptors: Request/Response Pipeline Control ➡️</a>
</div>

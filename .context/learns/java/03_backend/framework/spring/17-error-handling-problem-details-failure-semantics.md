# 17 — Error Handling, Problem Details, and Failure Semantics

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: `17` dari `35`  
> File: `17-error-handling-problem-details-failure-semantics.md`  
> Status seri: **belum selesai**  
> Berikutnya: `18-spring-security-application-architecture.md`

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas data boundary: binding, conversion, validation, dan bagaimana data masuk ke sistem Spring. Part ini membahas sisi lain dari boundary tersebut: **bagaimana sistem gagal, bagaimana kegagalan diterjemahkan menjadi contract yang stabil, dan bagaimana error dipakai sebagai sinyal operasional**.

Banyak aplikasi Spring terlihat rapi saat happy path, tetapi rapuh saat failure path. Controller punya `try-catch` acak. Error response berbeda-beda antar endpoint. Stack trace bocor ke client. Validation error tidak konsisten. Service melempar `RuntimeException` generik. Scheduler gagal diam-diam. Listener message melakukan retry tanpa batas. Client tidak tahu apakah request boleh diulang. Operator tidak tahu apakah error berasal dari input user, bug, dependency eksternal, timeout, database constraint, atau policy bisnis.

Part ini bertujuan membangun mental model bahwa error handling bukan kosmetik JSON. Error handling adalah bagian dari **application contract**, **failure semantics**, **operational diagnostics**, dan **regulatory defensibility**.

Setelah menyelesaikan part ini, target pemahaman Anda:

1. Mampu membedakan error domain, application, infrastructure, integration, security, validation, dan programming bug.
2. Mampu mendesain exception taxonomy yang tidak bocor ke client tetapi cukup kaya untuk observability.
3. Mampu menggunakan `ProblemDetail`, `ErrorResponse`, `@ControllerAdvice`, dan `ResponseEntityExceptionHandler` secara tepat.
4. Mampu membuat error contract yang stabil untuk REST API.
5. Mampu menentukan apakah suatu failure retryable, non-retryable, transient, permanent, atau ambiguous.
6. Mampu membuat safe error exposure: informatif untuk client, aman dari kebocoran internal.
7. Mampu menyambungkan error handling dengan logging, tracing, metrics, audit, alerting, async jobs, scheduled tasks, messaging, dan transaction boundary.
8. Mampu melakukan review desain error handling dalam sistem Spring enterprise.

---

## 1. Mental Model: Error Adalah Boundary Event

Dalam sistem enterprise, error bukan hanya `Exception`. Error adalah **event yang terjadi saat invariant tidak bisa dipenuhi**.

Contoh:

```text
User mengirim request → sistem mencoba memenuhi intent → ada invariant yang gagal → sistem harus memilih respons.
```

Invariant bisa berasal dari banyak level:

| Level | Contoh invariant | Contoh failure |
|---|---|---|
| Protocol | JSON harus valid | malformed JSON |
| API contract | field wajib harus ada | missing `caseId` |
| Authorization | user harus punya permission | forbidden |
| Domain | case tertutup tidak boleh diedit | invalid transition |
| Application workflow | approval hanya boleh setelah review | precondition failed |
| Persistence | unique reference number | constraint violation |
| Integration | partner API harus merespons | timeout |
| Runtime | heap/thread/connection cukup | resource exhaustion |
| Programming | null tidak diantisipasi | `NullPointerException` |

Top-tier engineer tidak menangani semua error dengan satu catch-all. Mereka bertanya:

```text
Apa invariant yang gagal?
Siapa yang bisa memperbaiki?
Apakah client boleh retry?
Apakah sistem boleh retry?
Apakah ini bug internal?
Apakah ini perlu audit?
Apakah ini perlu alert?
Apakah detailnya aman diekspos?
Apakah failure ini mempengaruhi state?
```

Error handling yang baik harus menjawab pertanyaan tersebut secara eksplisit.

---

## 2. Error vs Exception vs Failure vs Fault

Istilah ini sering bercampur, tetapi untuk desain sistem Spring sebaiknya dibedakan.

### 2.1 Error

Dalam konteks API/application, error adalah kondisi yang dilihat oleh caller sebagai permintaan yang tidak dapat diselesaikan sesuai contract.

Contoh:

```json
{
  "type": "https://api.example.com/problems/case-invalid-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "Case cannot move from CLOSED to UNDER_REVIEW.",
  "instance": "/api/cases/123/transitions"
}
```

### 2.2 Exception

Exception adalah mekanisme bahasa/JVM untuk mengalirkan kegagalan.

Di Java/Spring, exception adalah tool, bukan desain contract final.

```java
throw new InvalidCaseTransitionException(caseId, from, to);
```

### 2.3 Failure

Failure adalah realisasi bahwa sistem tidak memenuhi perilaku yang diharapkan.

Contoh:

```text
Payment posted twice.
Approval email sent before transaction commit.
Audit log missing for rejected case.
```

Failure bisa terjadi walaupun tidak ada exception.

### 2.4 Fault

Fault adalah penyebab internal/eksternal yang memicu failure.

Contoh:

```text
Wrong transaction boundary.
Broken retry policy.
External API returns invalid payload.
Database index missing.
Clock skew.
```

### 2.5 Kenapa Ini Penting?

Karena banyak codebase Spring hanya punya model:

```java
throw new RuntimeException("Something went wrong");
```

Ini menghilangkan semua informasi penting:

1. Apakah salah user atau salah sistem?
2. Apakah retry aman?
3. Apakah status HTTP 400, 409, 422, 500, atau 503?
4. Apakah perlu alert?
5. Apakah perlu rollback?
6. Apakah perlu audit?
7. Apakah boleh detail dikirim ke client?

---

## 3. Error Taxonomy untuk Spring Enterprise

Taxonomy adalah fondasi. Tanpa taxonomy, error handling menjadi patchwork.

### 3.1 Kategori Besar

```text
Throwable
├── Programming defect
├── Protocol/request parsing error
├── Validation error
├── Authentication error
├── Authorization error
├── Domain rule violation
├── Application workflow conflict
├── Persistence conflict
├── External integration failure
├── Infrastructure failure
├── Concurrency/consistency failure
├── Rate limit / capacity failure
└── Unknown/unclassified failure
```

### 3.2 Tabel Taxonomy

| Kategori | Contoh | HTTP umum | Retry client? | Alert? | Safe detail? |
|---|---|---:|---|---|---|
| Malformed request | invalid JSON | 400 | Tidak | Tidak | Ya, terbatas |
| Validation | missing field | 400/422 | Setelah perbaikan | Tidak | Ya |
| Authentication | token missing/expired | 401 | Setelah reauth | Tidak | Terbatas |
| Authorization | no permission | 403 | Tidak | Mungkin audit | Terbatas |
| Not found | entity tidak ada | 404 | Tergantung | Tidak | Ya |
| Domain rule | invalid transition | 409/422 | Tidak, kecuali state berubah | Tidak | Ya |
| Optimistic lock | version conflict | 409/412 | Ya, setelah refresh | Tidak | Ya |
| Duplicate | unique key conflict | 409 | Tidak/cek idempotency | Tidak | Ya |
| Rate limit | too many requests | 429 | Ya, setelah delay | Mungkin | Ya |
| External timeout | partner timeout | 503/504 | Ya, jika idempotent | Ya jika tinggi | Terbatas |
| DB down | connection failure | 503 | Ya | Ya | Tidak detail internal |
| Bug | NPE, illegal state internal | 500 | Tidak | Ya | Tidak |

### 3.3 Mapping Tidak Boleh Asal

Jangan semua business rule violation menjadi 400. Bedakan:

```text
400 Bad Request
→ request secara sintaks/contract invalid.

403 Forbidden
→ caller valid tetapi tidak boleh melakukan aksi.

404 Not Found
→ resource tidak ditemukan atau disembunyikan.

409 Conflict
→ request valid, tetapi konflik dengan state saat ini.

412 Precondition Failed
→ conditional request gagal, misalnya If-Match mismatch.

422 Unprocessable Content
→ payload dapat diparse, tetapi semantik domain tidak valid.

429 Too Many Requests
→ rate/capacity policy dilanggar.

500 Internal Server Error
→ bug atau kegagalan internal tidak terklasifikasi.

503 Service Unavailable
→ dependency atau kapasitas sementara tidak tersedia.

504 Gateway Timeout
→ upstream/dependency timeout saat bertindak sebagai gateway/client.
```

Untuk sistem enterprise, `409 Conflict` sering lebih tepat daripada `400` ketika request valid tetapi state sistem tidak memungkinkan.

Contoh:

```text
PATCH /cases/123/status
{ "status": "APPROVED" }

Case saat ini masih DRAFT.
```

Ini bukan JSON buruk. Ini konflik state.

---

## 4. Spring Error Handling Stack

Dalam Spring MVC, error bisa ditangani di beberapa layer.

```text
HTTP request
  ↓
Servlet Filter chain
  ↓
DispatcherServlet
  ↓
HandlerMapping
  ↓
HandlerAdapter
  ↓
Controller method
  ↓
Exception thrown
  ↓
HandlerExceptionResolver chain
  ↓
Response body / error page / ProblemDetail
```

Komponen utama:

| Komponen | Peran |
|---|---|
| `@ExceptionHandler` | Menangani exception per controller/advice |
| `@ControllerAdvice` | Global cross-controller exception handling |
| `ResponseEntityExceptionHandler` | Base class untuk menangani exception MVC standar |
| `ProblemDetail` | Representasi error standar RFC 9457 |
| `ErrorResponse` | Interface Spring untuk exception yang bisa menghasilkan `ProblemDetail` |
| `HandlerExceptionResolver` | SPI rendah untuk resolve exception MVC |
| `ErrorAttributes` | Model error untuk Boot error endpoint/fallback |
| `BasicErrorController` | Default Boot error endpoint untuk MVC |
| `ErrorWebExceptionHandler` | WebFlux global error handler |

Spring Framework mendukung `ProblemDetail` dan `ErrorResponse` untuk menghasilkan response `application/problem+json`. `ProblemDetail.status` menentukan status HTTP, dan `instance` dapat diisi dari path request bila belum diatur.

---

## 5. Problem Details: Contract Error Modern

### 5.1 Apa Itu Problem Details?

Problem Details adalah format standar untuk menjelaskan error HTTP. Di Spring modern, representasi utamanya adalah `org.springframework.http.ProblemDetail`.

Struktur umum:

```json
{
  "type": "https://api.example.com/problems/invalid-case-transition",
  "title": "Invalid case transition",
  "status": 409,
  "detail": "Case cannot move from CLOSED to UNDER_REVIEW.",
  "instance": "/api/cases/123/transitions"
}
```

Field utama:

| Field | Makna |
|---|---|
| `type` | URI stabil untuk jenis problem |
| `title` | Ringkasan pendek yang stabil |
| `status` | HTTP status |
| `detail` | Penjelasan spesifik instance |
| `instance` | URI request/problem occurrence |

Spring juga memungkinkan extension properties.

Contoh:

```json
{
  "type": "https://api.example.com/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "Request contains invalid fields.",
  "instance": "/api/cases",
  "code": "CASE_VALIDATION_FAILED",
  "correlationId": "01JABC...",
  "errors": [
    {
      "field": "applicant.email",
      "code": "Email",
      "message": "must be a well-formed email address"
    }
  ]
}
```

### 5.2 `type` Harus Stabil

Jangan gunakan dynamic string sebagai `type`.

Buruk:

```json
{
  "type": "Case 123 cannot be approved"
}
```

Baik:

```json
{
  "type": "https://api.example.com/problems/case-invalid-transition"
}
```

`type` sebaiknya mewakili kategori error, bukan pesan instance.

### 5.3 `title` Harus Stabil

`title` idealnya stabil untuk problem type yang sama.

Buruk:

```json
{
  "title": "Case 123 cannot be moved from CLOSED to UNDER_REVIEW by user Bob at 10:31"
}
```

Baik:

```json
{
  "title": "Invalid case transition"
}
```

Detail spesifik masuk ke `detail` atau extension field yang aman.

### 5.4 `detail` Tidak Boleh Bocor Internal

Buruk:

```json
{
  "detail": "ORA-00001: unique constraint ACEAS.SYS_C009881 violated on table CASE_APPLICATION"
}
```

Baik:

```json
{
  "detail": "A case with the same reference number already exists."
}
```

Detail internal masuk log, bukan response client.

### 5.5 Extension Properties

Extension berguna, tetapi harus dikontrol.

Rekomendasi extension umum:

```json
{
  "code": "CASE_INVALID_TRANSITION",
  "correlationId": "01J...",
  "retryable": false,
  "errors": []
}
```

Hindari extension yang leaking:

```json
{
  "className": "com.example.case.CaseService",
  "sql": "select * from ...",
  "stackTrace": "...",
  "serverIp": "10.1.2.3",
  "threadName": "http-nio-8080-exec-7"
}
```

---

## 6. Spring `ProblemDetail` Dasar

Contoh paling kecil:

```java
@GetMapping("/cases/{id}")
public CaseResponse getCase(@PathVariable String id) {
    throw new CaseNotFoundException(id);
}
```

Global handler:

```java
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    public ProblemDetail handleCaseNotFound(CaseNotFoundException ex, HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://api.example.com/problems/case-not-found"));
        problem.setTitle("Case not found");
        problem.setDetail("Case was not found.");
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", "CASE_NOT_FOUND");
        return problem;
    }
}
```

Kelemahan contoh ini:

1. Handler bisa menjadi besar.
2. Mapping type/title/code bisa tersebar.
3. `detail` masih raw string.
4. Tidak ada taxonomy pusat.
5. Tidak ada retryability.
6. Tidak ada correlation ID.

Untuk aplikasi besar, kita butuh struktur lebih sistematis.

---

## 7. Mendesain Domain Exception yang Tidak Bocor

### 7.1 Jangan Jadikan Exception Sebagai Response DTO

Buruk:

```java
public class ApiException extends RuntimeException {
    private final int status;
    private final String responseMessage;
    private final Map<String, Object> responseBody;
}
```

Masalah:

1. Domain layer jadi tahu HTTP.
2. Exception menjadi transport-specific.
3. Sulit dipakai di messaging/batch.
4. Business rule bercampur response formatting.

Lebih baik:

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

Contoh domain exception:

```java
public final class InvalidCaseTransitionException extends DomainException {
    private final String caseId;
    private final CaseStatus from;
    private final CaseStatus to;

    public InvalidCaseTransitionException(String caseId, CaseStatus from, CaseStatus to) {
        super("CASE_INVALID_TRANSITION", "Invalid case transition");
        this.caseId = caseId;
        this.from = from;
        this.to = to;
    }

    public String caseId() {
        return caseId;
    }

    public CaseStatus from() {
        return from;
    }

    public CaseStatus to() {
        return to;
    }
}
```

HTTP mapping dilakukan di adapter layer:

```java
@ExceptionHandler(InvalidCaseTransitionException.class)
public ProblemDetail handleInvalidTransition(InvalidCaseTransitionException ex, HttpServletRequest request) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
    problem.setType(URI.create("https://api.example.com/problems/case-invalid-transition"));
    problem.setTitle("Invalid case transition");
    problem.setDetail("Case cannot move from " + ex.from() + " to " + ex.to() + ".");
    problem.setInstance(URI.create(request.getRequestURI()));
    problem.setProperty("code", ex.code());
    problem.setProperty("retryable", false);
    return problem;
}
```

### 7.2 Domain Exception Boleh Membawa Context, Tapi Aman

Exception internal boleh membawa context untuk mapping/logging.

Contoh aman:

```java
caseId
fromStatus
toStatus
ruleCode
```

Contoh berbahaya:

```java
raw SQL
password/token
full request body
PII lengkap
internal server hostname
stack trace serialized
```

### 7.3 Message Exception Bukan Selalu Message Client

`ex.getMessage()` untuk developer/operator. `ProblemDetail.detail` untuk client.

Jangan otomatis:

```java
problem.setDetail(ex.getMessage());
```

Gunakan mapping eksplisit.

---

## 8. Exception Taxonomy Praktis untuk Codebase Spring

Contoh struktur:

```text
com.example.platform.error
├── AppException
├── DomainException
├── ApplicationException
├── IntegrationException
├── InfrastructureException
├── ConflictException
├── NotFoundException
├── ValidationSupport
├── ErrorCode
├── ProblemType
└── ApiExceptionHandler
```

### 8.1 Base Exception

```java
public abstract class AppException extends RuntimeException {
    private final ErrorCode code;

    protected AppException(ErrorCode code, String message) {
        super(message);
        this.code = code;
    }

    protected AppException(ErrorCode code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }
}
```

### 8.2 ErrorCode

```java
public enum ErrorCode {
    CASE_NOT_FOUND,
    CASE_INVALID_TRANSITION,
    CASE_VERSION_CONFLICT,
    VALIDATION_FAILED,
    EXTERNAL_SERVICE_TIMEOUT,
    EXTERNAL_SERVICE_UNAVAILABLE,
    INTERNAL_ERROR
}
```

### 8.3 Problem Metadata

```java
public record ProblemMapping(
        URI type,
        String title,
        HttpStatus status,
        boolean retryable,
        boolean alertable
) {
}
```

Registry:

```java
@Component
public class ProblemCatalog {

    private final Map<ErrorCode, ProblemMapping> mappings = Map.of(
            ErrorCode.CASE_NOT_FOUND,
            new ProblemMapping(
                    URI.create("https://api.example.com/problems/case-not-found"),
                    "Case not found",
                    HttpStatus.NOT_FOUND,
                    false,
                    false
            ),
            ErrorCode.CASE_INVALID_TRANSITION,
            new ProblemMapping(
                    URI.create("https://api.example.com/problems/case-invalid-transition"),
                    "Invalid case transition",
                    HttpStatus.CONFLICT,
                    false,
                    false
            ),
            ErrorCode.EXTERNAL_SERVICE_TIMEOUT,
            new ProblemMapping(
                    URI.create("https://api.example.com/problems/external-service-timeout"),
                    "External service timeout",
                    HttpStatus.SERVICE_UNAVAILABLE,
                    true,
                    true
            ),
            ErrorCode.INTERNAL_ERROR,
            new ProblemMapping(
                    URI.create("https://api.example.com/problems/internal-error"),
                    "Internal error",
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    false,
                    true
            )
    );

    public ProblemMapping mappingFor(ErrorCode code) {
        return mappings.getOrDefault(code, mappings.get(ErrorCode.INTERNAL_ERROR));
    }
}
```

Manfaat:

1. Error contract terpusat.
2. Status HTTP tidak tersebar.
3. Retryability bisa distandarkan.
4. Alertability bisa dipakai metrics/logging.
5. API documentation bisa generate dari catalog.

---

## 9. Global Exception Handler yang Terstruktur

### 9.1 Basic Handler

```java
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private final ProblemCatalog problemCatalog;
    private final CorrelationIdProvider correlationIdProvider;

    public ApiExceptionHandler(
            ProblemCatalog problemCatalog,
            CorrelationIdProvider correlationIdProvider
    ) {
        this.problemCatalog = problemCatalog;
        this.correlationIdProvider = correlationIdProvider;
    }

    @ExceptionHandler(AppException.class)
    public ResponseEntity<ProblemDetail> handleAppException(
            AppException ex,
            HttpServletRequest request
    ) {
        ProblemMapping mapping = problemCatalog.mappingFor(ex.code());

        ProblemDetail problem = ProblemDetail.forStatus(mapping.status());
        problem.setType(mapping.type());
        problem.setTitle(mapping.title());
        problem.setDetail(toSafeDetail(ex));
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", ex.code().name());
        problem.setProperty("correlationId", correlationIdProvider.currentId());
        problem.setProperty("retryable", mapping.retryable());

        return ResponseEntity
                .status(mapping.status())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnexpected(
            Exception ex,
            HttpServletRequest request
    ) {
        ProblemMapping mapping = problemCatalog.mappingFor(ErrorCode.INTERNAL_ERROR);

        ProblemDetail problem = ProblemDetail.forStatus(mapping.status());
        problem.setType(mapping.type());
        problem.setTitle(mapping.title());
        problem.setDetail("An unexpected error occurred.");
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", ErrorCode.INTERNAL_ERROR.name());
        problem.setProperty("correlationId", correlationIdProvider.currentId());
        problem.setProperty("retryable", false);

        return ResponseEntity
                .status(mapping.status())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private String toSafeDetail(AppException ex) {
        return switch (ex.code()) {
            case CASE_NOT_FOUND -> "Case was not found.";
            case CASE_INVALID_TRANSITION -> "Requested case transition is not allowed in the current state.";
            case CASE_VERSION_CONFLICT -> "The resource was modified by another transaction. Refresh and try again.";
            case EXTERNAL_SERVICE_TIMEOUT -> "A downstream service did not respond in time.";
            default -> "Request could not be completed.";
        };
    }
}
```

### 9.2 Kenapa `ResponseEntity<ProblemDetail>`?

Mengembalikan `ProblemDetail` langsung bisa cukup. Tetapi `ResponseEntity` memberi kontrol tambahan:

1. Status eksplisit.
2. Header eksplisit.
3. Content type eksplisit.
4. Retry-After untuk 429/503.
5. Warning/deprecation header.

Contoh:

```java
return ResponseEntity
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .header(HttpHeaders.RETRY_AFTER, "60")
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(problem);
```

---

## 10. Menangani Validation Error

Validation error harus berbeda dari domain exception.

### 10.1 Method Argument Validation

Untuk `@RequestBody @Valid`, Spring biasanya menghasilkan `MethodArgumentNotValidException`.

Override dari `ResponseEntityExceptionHandler`:

```java
@Override
protected ResponseEntity<Object> handleMethodArgumentNotValid(
        MethodArgumentNotValidException ex,
        HttpHeaders headers,
        HttpStatusCode status,
        WebRequest request
) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
    problem.setType(URI.create("https://api.example.com/problems/validation-failed"));
    problem.setTitle("Validation failed");
    problem.setDetail("Request contains invalid fields.");
    problem.setProperty("code", "VALIDATION_FAILED");
    problem.setProperty("errors", toFieldErrors(ex.getBindingResult()));

    return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
}
```

Field error DTO:

```java
public record FieldViolation(
        String field,
        String code,
        String message,
        Object rejectedValue
) {
}
```

Mapper:

```java
private List<FieldViolation> toFieldErrors(BindingResult bindingResult) {
    return bindingResult.getFieldErrors()
            .stream()
            .map(error -> new FieldViolation(
                    error.getField(),
                    error.getCode(),
                    error.getDefaultMessage(),
                    safeRejectedValue(error.getRejectedValue())
            ))
            .toList();
}

private Object safeRejectedValue(Object value) {
    if (value == null) {
        return null;
    }
    if (value instanceof String text && text.length() <= 128) {
        return text;
    }
    return "<redacted>";
}
```

### 10.2 Jangan Bocorkan Rejected Value Sensitif

Contoh field sensitif:

```text
password
token
otp
secret
authorization
refreshToken
accessToken
idNumber
passportNumber
```

Lebih aman buat allowlist daripada blocklist.

```java
private static final Set<String> SAFE_REJECTED_VALUE_FIELDS = Set.of(
        "name",
        "email",
        "postalCode",
        "status"
);
```

### 10.3 Field Path Harus Stabil

Untuk nested DTO:

```json
{
  "field": "applicant.address.postalCode",
  "code": "Pattern",
  "message": "must match expected format"
}
```

Stabilitas field path penting untuk frontend dan API clients.

### 10.4 Binding Error vs Validation Error

Binding error terjadi saat value gagal dikonversi.

Contoh:

```text
?size=abc
```

`size` harus integer.

Validation error terjadi saat value berhasil dikonversi tetapi melanggar rule.

Contoh:

```text
?size=10000
```

`size` integer, tetapi melebihi max.

Keduanya bisa masuk `VALIDATION_FAILED`, tetapi field error code harus berbeda.

---

## 11. Menangani Request Parsing Error

Malformed JSON biasanya bukan validation error murni.

Contoh:

```json
{ "name": "Alice", }
```

Spring MVC bisa melempar `HttpMessageNotReadableException`.

Handler:

```java
@Override
protected ResponseEntity<Object> handleHttpMessageNotReadable(
        HttpMessageNotReadableException ex,
        HttpHeaders headers,
        HttpStatusCode status,
        WebRequest request
) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
    problem.setType(URI.create("https://api.example.com/problems/malformed-request-body"));
    problem.setTitle("Malformed request body");
    problem.setDetail("Request body could not be parsed.");
    problem.setProperty("code", "MALFORMED_REQUEST_BODY");

    return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(problem);
}
```

Jangan kirim raw Jackson parsing exception ke client karena bisa terlalu teknis.

---

## 12. Not Found: 404 Tidak Selalu Sederhana

Ada dua jenis not found:

```text
1. Resource benar-benar tidak ada.
2. Resource ada, tetapi disembunyikan karena authorization.
```

Dalam sistem sensitif, kadang 404 dipakai untuk mencegah resource enumeration.

Contoh:

```text
GET /cases/SECRET-123
```

Jika user tidak punya akses, mengembalikan 403 bisa mengonfirmasi bahwa case ada. Mengembalikan 404 bisa lebih aman.

Policy harus eksplisit:

```text
Resource existence visible? → 403 jika tidak boleh akses.
Resource existence confidential? → 404 untuk unauthorized access.
```

Jangan dipilih ad-hoc per controller.

---

## 13. Conflict, Optimistic Lock, and Precondition Failure

### 13.1 `409 Conflict`

Gunakan ketika request valid tetapi konflik dengan state.

Contoh:

```text
Case CLOSED tidak boleh diubah.
Reference number sudah dipakai.
Approval sudah diproses sebelumnya.
```

### 13.2 `412 Precondition Failed`

Gunakan ketika client mengirim precondition dan precondition gagal.

Contoh:

```http
PATCH /cases/123
If-Match: "v7"
```

Server version sudah `v8`.

Response:

```json
{
  "type": "https://api.example.com/problems/precondition-failed",
  "title": "Precondition failed",
  "status": 412,
  "detail": "The resource has changed. Refresh it and retry with the latest version.",
  "code": "PRECONDITION_FAILED"
}
```

### 13.3 `409` vs `412`

```text
Client tidak memakai conditional header → 409.
Client memakai If-Match/If-Unmodified-Since → 412.
```

### 13.4 Optimistic Lock Mapping

JPA/Hibernate detail tidak dibahas ulang, tetapi Spring layer perlu mapping.

Contoh exception:

```java
@ExceptionHandler(ObjectOptimisticLockingFailureException.class)
public ResponseEntity<ProblemDetail> handleOptimisticLock(
        ObjectOptimisticLockingFailureException ex,
        HttpServletRequest request
) {
    ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
    problem.setType(URI.create("https://api.example.com/problems/version-conflict"));
    problem.setTitle("Version conflict");
    problem.setDetail("The resource was modified by another transaction. Refresh and try again.");
    problem.setInstance(URI.create(request.getRequestURI()));
    problem.setProperty("code", "VERSION_CONFLICT");
    problem.setProperty("retryable", true);

    return ResponseEntity.status(HttpStatus.CONFLICT).body(problem);
}
```

Retryable di sini berarti **client boleh retry setelah refresh/re-evaluate**, bukan blind automatic retry.

---

## 14. Persistence Exception Translation

Spring dapat menerjemahkan persistence exception ke hierarchy `DataAccessException`.

Contoh kategori:

| Exception | Makna umum | Mapping umum |
|---|---|---|
| `DuplicateKeyException` | unique conflict | 409 |
| `DataIntegrityViolationException` | constraint violation | 400/409 |
| `CannotAcquireLockException` | lock tidak dapat diperoleh | 409/503 |
| `QueryTimeoutException` | query timeout | 503/504 |
| `CannotGetJdbcConnectionException` | DB connection gagal | 503 |
| `OptimisticLockingFailureException` | version conflict | 409/412 |

### 14.1 Jangan Selalu Mapping `DataIntegrityViolationException` ke 500

Buruk:

```text
Unique constraint violation → 500 Internal Server Error
```

Dari perspektif client, duplicate request bisa menjadi conflict.

Baik:

```text
Unique business key conflict → 409 Conflict
Foreign key domain violation karena input invalid → 400/422
DB unavailable → 503
```

### 14.2 Constraint Name Mapping

Untuk enterprise, sering perlu mapping constraint database ke error code.

Contoh:

```java
@Component
public class ConstraintViolationMapper {

    public Optional<ErrorCode> map(Throwable ex) {
        String constraintName = extractConstraintName(ex);
        return switch (constraintName) {
            case "UK_CASE_REFERENCE_NO" -> Optional.of(ErrorCode.CASE_REFERENCE_DUPLICATE);
            case "FK_CASE_APPLICANT" -> Optional.of(ErrorCode.INVALID_APPLICANT_REFERENCE);
            default -> Optional.empty();
        };
    }

    private String extractConstraintName(Throwable ex) {
        // Vendor-specific extraction should be isolated here.
        return "";
    }
}
```

Kenapa isolate?

Karena Oracle, PostgreSQL, MySQL, SQL Server punya exception detail berbeda.

---

## 15. Retryability Semantics

Salah satu pertanyaan paling penting:

```text
Boleh retry atau tidak?
```

Tetapi jawabannya bukan boolean sederhana.

### 15.1 Kategori Retry

| Kategori | Makna | Contoh |
|---|---|---|
| Non-retryable | Request salah atau rule melarang | validation, forbidden |
| Retry after correction | Client perlu ubah input/state | optimistic lock, invalid transition |
| Retry after delay | Rate/capacity sementara | 429, 503 |
| Safe automatic retry | Operation idempotent dan transient | GET timeout, idempotent PUT |
| Dangerous retry | Bisa duplicate side effect | POST payment tanpa idempotency key |
| Ambiguous | Tidak tahu apakah side effect terjadi | timeout setelah send ke upstream |

### 15.2 Problem Detail Extension

```json
{
  "code": "EXTERNAL_SERVICE_TIMEOUT",
  "retryable": true,
  "retryAfterSeconds": 30,
  "idempotencyRequired": true
}
```

Tetapi jangan berlebihan. API contract harus konsisten.

### 15.3 Server Retry vs Client Retry

Server retry:

```text
Spring service memanggil downstream dan retry sendiri.
```

Client retry:

```text
Caller mengulang request ke API kita.
```

Keduanya berbeda.

Misalnya:

```text
Server boleh retry GET downstream.
Client tidak boleh blind retry POST approval tanpa idempotency key.
```

### 15.4 Retry Storm

Jika semua layer retry, sistem bisa collapse.

```text
Mobile client retry 3x
API gateway retry 2x
Spring service retry 3x
HTTP client retry 3x
DB retry 2x

Total amplification = 3 × 2 × 3 × 3 × 2 = 108 attempts
```

Error contract harus menyatakan retry policy, tetapi arsitektur harus membatasi retry amplification.

---

## 16. Safe Error Exposure

### 16.1 Tiga Audience Error

| Audience | Butuh apa? | Media |
|---|---|---|
| Client/API consumer | Apa yang salah dan apa tindakan berikutnya | ProblemDetail |
| Operator/SRE | Penyebab teknis dan dampak | logs/metrics/traces |
| Auditor/business | Keputusan dan rule yang gagal | audit event |

Jangan satu payload dipakai untuk semua audience.

### 16.2 Response Client

Boleh berisi:

```text
stable code
general detail
field errors
correlation id
retry hint
problem type
```

Tidak boleh berisi:

```text
stack trace
SQL
class/package internal
server hostname/IP
file path
secret/token
full PII
raw upstream response sensitif
internal topology
```

### 16.3 Log Internal

Log boleh lebih detail, tetapi tetap harus redacted.

```java
log.warn(
        "Case transition rejected: caseId={}, from={}, to={}, code={}, correlationId={}",
        ex.caseId(), ex.from(), ex.to(), ex.code(), correlationId
);
```

Untuk unexpected exception:

```java
log.error(
        "Unexpected request failure: path={}, method={}, correlationId={}",
        request.getRequestURI(), request.getMethod(), correlationId,
        ex
);
```

### 16.4 Audit Event

Audit harus merekam business-relevant failure, bukan semua technical stack trace.

Contoh:

```json
{
  "event": "CASE_TRANSITION_REJECTED",
  "caseId": "CASE-123",
  "from": "CLOSED",
  "to": "UNDER_REVIEW",
  "actor": "user-789",
  "reasonCode": "CASE_INVALID_TRANSITION",
  "timestamp": "2026-06-21T07:00:00Z"
}
```

---

## 17. Error Code Design

### 17.1 Error Code Harus Stabil

Contoh:

```text
CASE_NOT_FOUND
CASE_INVALID_TRANSITION
CASE_VERSION_CONFLICT
VALIDATION_FAILED
AUTHENTICATION_REQUIRED
ACCESS_DENIED
EXTERNAL_SERVICE_TIMEOUT
INTERNAL_ERROR
```

Jangan:

```text
ERR001
ERROR_BAD_THING
CASE_ERROR_2
```

Numeric code bisa dipakai, tetapi sebaiknya ada symbolic code.

### 17.2 Hierarchical Code

Untuk domain besar:

```text
CASE.NOT_FOUND
CASE.INVALID_TRANSITION
CASE.VERSION_CONFLICT
APPLICATION.DUPLICATE_REFERENCE
AUTH.ACCESS_DENIED
INTEGRATION.ONEMAP.TIMEOUT
SYSTEM.INTERNAL_ERROR
```

Kelebihan:

1. Mudah difilter.
2. Mudah dimapping metrics.
3. Mudah dibuat error catalog.

Kekurangan:

1. Bisa terlalu verbose.
2. Perlu governance naming.

### 17.3 Jangan Campur Error Code dan HTTP Status

`CASE_INVALID_TRANSITION` bisa HTTP 409 pada REST, tetapi dalam messaging bisa menjadi dead-letter reason. Dalam batch bisa menjadi rejected row reason.

Error code harus transport-neutral.

---

## 18. `@ControllerAdvice` Design

### 18.1 Satu Global Handler atau Banyak?

Untuk codebase kecil:

```text
Satu GlobalApiExceptionHandler cukup.
```

Untuk codebase besar:

```text
CoreApiExceptionHandler
ValidationExceptionHandler
SecurityExceptionHandler
IntegrationExceptionHandler
ModuleSpecificExceptionHandler
```

Tetapi hati-hati ordering.

### 18.2 `@Order`

```java
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ValidationExceptionHandler {
}
```

Specific handler harus menang sebelum generic handler.

Buruk:

```java
@ExceptionHandler(Exception.class)
public ProblemDetail catchAll(Exception ex) { ... }
```

Jika handler ini berada di advice dengan precedence terlalu tinggi, exception khusus tidak pernah sampai ke handler yang tepat.

### 18.3 Scope Advice

`@ControllerAdvice` bisa dibatasi:

```java
@ControllerAdvice(basePackages = "com.example.caseapi")
```

Atau:

```java
@ControllerAdvice(assignableTypes = CaseController.class)
```

Gunakan untuk modular boundary, tetapi jangan membuat error contract berbeda-beda tanpa alasan.

---

## 19. `ResponseEntityExceptionHandler`

`ResponseEntityExceptionHandler` berguna karena sudah menangani banyak exception standar MVC.

Contoh exception yang sering relevan:

```text
MethodArgumentNotValidException
HttpMessageNotReadableException
HttpRequestMethodNotSupportedException
HttpMediaTypeNotSupportedException
HttpMediaTypeNotAcceptableException
MissingServletRequestParameterException
TypeMismatchException
NoHandlerFoundException
AsyncRequestTimeoutException
```

Dengan extend class ini, kita bisa override behavior standar.

Contoh:

```java
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    @Override
    protected ResponseEntity<Object> handleHttpRequestMethodNotSupported(
            HttpRequestMethodNotSupportedException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request
    ) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.METHOD_NOT_ALLOWED);
        problem.setType(URI.create("https://api.example.com/problems/method-not-allowed"));
        problem.setTitle("Method not allowed");
        problem.setDetail("HTTP method is not supported for this resource.");
        problem.setProperty("code", "METHOD_NOT_ALLOWED");

        return ResponseEntity
                .status(HttpStatus.METHOD_NOT_ALLOWED)
                .headers(headers)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }
}
```

---

## 20. Spring Boot Fallback Error Handling

Jika exception tidak ditangani oleh controller advice, Spring Boot punya fallback error handling melalui error endpoint.

Di MVC stack, konsep utamanya:

```text
Exception tidak tertangani
  ↓
Servlet container error dispatch
  ↓
/error
  ↓
BasicErrorController
  ↓
ErrorAttributes
```

`ErrorAttributes` menghasilkan map atribut error yang bisa dirender sebagai JSON atau view error.

### 20.1 Kapan Custom `ErrorAttributes`?

Gunakan jika ingin fallback `/error` tetap konsisten.

Contoh alasan:

1. Error dari filter sebelum masuk controller.
2. 404 static/resource fallback.
3. Servlet container error dispatch.
4. Security error yang masuk fallback.

Tetapi jangan menjadikan `ErrorAttributes` sebagai primary business error handler. Untuk application exception, lebih jelas pakai `@ControllerAdvice`.

### 20.2 Jangan Bergantung pada Fallback untuk Semua Error

Buruk:

```text
Semua exception dibiarkan jatuh ke /error.
```

Akibat:

1. Mapping domain error tidak eksplisit.
2. Validation format kurang terkontrol.
3. Retryability tidak jelas.
4. Logging/audit kehilangan konteks.

---

## 21. WebFlux Error Handling

WebFlux punya model berbeda, tetapi prinsip sama.

Di WebFlux annotated controller:

```java
@RestControllerAdvice
public class ReactiveApiExceptionHandler {

    @ExceptionHandler(CaseNotFoundException.class)
    public Mono<ProblemDetail> handle(CaseNotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://api.example.com/problems/case-not-found"));
        problem.setTitle("Case not found");
        problem.setDetail("Case was not found.");
        problem.setProperty("code", "CASE_NOT_FOUND");
        return Mono.just(problem);
    }
}
```

Dalam functional endpoint, error sering ditangani dengan operator Reactor atau global `ErrorWebExceptionHandler`.

### 21.1 Reactive Error Anti-pattern

Buruk:

```java
return service.findCase(id)
        .subscribe(
                value -> log.info("ok"),
                error -> log.error("failed", error)
        );
```

Controller tidak boleh manual subscribe. Error harus mengalir ke WebFlux pipeline.

Baik:

```java
return service.findCase(id)
        .switchIfEmpty(Mono.error(new CaseNotFoundException(id)));
```

### 21.2 `onErrorResume` Harus Spesifik

Buruk:

```java
.onErrorResume(ex -> Mono.just(defaultResponse))
```

Ini bisa menyembunyikan bug.

Baik:

```java
.onErrorResume(ExternalTimeoutException.class, ex -> Mono.error(new ExternalServiceUnavailableException(ex)))
```

---

## 22. Error Handling di Filter dan Security Chain

Tidak semua error terjadi di controller.

Contoh error sebelum controller:

```text
CORS rejection
Authentication failure
Invalid JWT
Request body too large
Rate limit filter
Correlation ID filter failure
```

`@ControllerAdvice` tidak selalu menangkap exception dari filter chain sebelum `DispatcherServlet`.

### 22.1 Security Exception Handling

Spring Security punya mekanisme sendiri:

```text
AuthenticationEntryPoint → 401
AccessDeniedHandler → 403
```

Jika ingin format Problem Details konsisten, security layer perlu custom handler.

Contoh konseptual:

```java
@Component
public class ProblemAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    public ProblemAuthenticationEntryPoint(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void commence(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthenticationException authException
    ) throws IOException {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNAUTHORIZED);
        problem.setType(URI.create("https://api.example.com/problems/authentication-required"));
        problem.setTitle("Authentication required");
        problem.setDetail("Authentication is required to access this resource.");
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", "AUTHENTICATION_REQUIRED");

        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
```

Part security berikutnya akan membahas ini lebih dalam.

---

## 23. Error Handling untuk Async, Scheduled, and Events

### 23.1 `@Async`

Exception dalam `@Async` berbeda tergantung return type.

Jika return `CompletableFuture`:

```java
@Async
public CompletableFuture<Void> sendNotification(String caseId) {
    return CompletableFuture.runAsync(() -> doSend(caseId));
}
```

Exception masuk future.

Jika return `void`:

```java
@Async
public void sendNotification(String caseId) {
    doSend(caseId);
}
```

Exception tidak bisa dikirim ke caller. Butuh `AsyncUncaughtExceptionHandler`.

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            log.error("Uncaught async exception: method={}, params={}", method.getName(), params, ex);
        };
    }
}
```

Rekomendasi:

```text
Untuk pekerjaan penting, hindari @Async void tanpa failure tracking.
Gunakan queue/job table/outbox jika harus reliable.
```

### 23.2 `@Scheduled`

Exception dalam scheduled job tidak boleh hilang.

```java
@Scheduled(cron = "0 */5 * * * *")
public void syncExternalStatus() {
    try {
        syncService.sync();
    } catch (Exception ex) {
        log.error("Scheduled sync failed", ex);
        metrics.counter("job.sync.failed").increment();
        throw ex;
    }
}
```

Tetapi sekadar rethrow mungkin tidak cukup. Untuk job penting, simpan execution status.

```text
job_execution
- job_name
- start_time
- end_time
- status
- error_code
- error_message_safe
- correlation_id
```

### 23.3 Application Events

Synchronous event listener exception bisa membatalkan caller.

```java
@EventListener
public void onCaseApproved(CaseApproved event) {
    emailService.send(event.caseId());
}
```

Jika email gagal, approval bisa gagal jika event synchronous dan berada dalam transaction boundary yang sama.

Pertanyaan desain:

```text
Apakah side effect ini harus menggagalkan command utama?
Apakah boleh diproses after commit?
Apakah harus retryable?
Apakah butuh outbox?
```

Untuk event setelah commit:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onCaseApproved(CaseApproved event) {
    emailService.send(event.caseId());
}
```

Tetapi jika `emailService.send` gagal setelah commit, DB transaction tidak bisa rollback. Perlu retry/job/outbox.

---

## 24. Error Handling di Messaging

Dalam listener message, error response bukan HTTP. Tetapi semantics tetap sama.

Pertanyaan:

```text
Apakah message harus retry?
Berapa kali?
Apakah error transient?
Apakah message poison?
Apakah perlu dead-letter?
Apakah perlu alert?
Apakah consumer idempotent?
```

### 24.1 Poison Message

Poison message adalah message yang selalu gagal karena payload/rule invalid.

Contoh:

```json
{
  "caseId": null,
  "eventType": "CASE_APPROVED"
}
```

Retry 100 kali tidak akan memperbaiki.

Policy:

```text
Validation/permanent error → reject/dead-letter.
Transient dependency error → retry with backoff.
Unknown error → limited retry then dead-letter.
```

### 24.2 Error Envelope untuk Dead Letter

```json
{
  "originalMessageId": "msg-123",
  "consumer": "case-event-consumer",
  "errorCode": "INVALID_EVENT_PAYLOAD",
  "errorCategory": "VALIDATION",
  "retryable": false,
  "failedAt": "2026-06-21T07:00:00Z",
  "correlationId": "01J..."
}
```

Jangan simpan raw payload sensitif tanpa policy.

---

## 25. Transaction Boundary and Error Handling

### 25.1 Exception Menentukan Rollback

Dari part transaction:

```text
Unchecked exception → rollback default.
Checked exception → tidak rollback default kecuali configured.
```

Jangan membuat exception taxonomy tanpa memikirkan rollback.

Contoh:

```java
@Transactional
public void approveCase(String caseId) {
    Case c = caseRepository.get(caseId);
    c.approve();
    externalClient.notifyApproval(caseId); // berbahaya
}
```

Jika `notifyApproval` timeout:

1. Apakah approval harus rollback?
2. Apakah external sudah menerima request tetapi response timeout?
3. Apakah retry akan duplicate?

Lebih baik:

```text
Update DB dalam transaction.
Record outbox event dalam transaction.
Commit.
Worker mengirim notification dengan retry/idempotency.
```

### 25.2 Jangan Swallow Exception dalam Transaction

Buruk:

```java
@Transactional
public void process() {
    try {
        repository.save(entity);
        externalClient.call();
    } catch (Exception ex) {
        log.warn("ignored", ex);
    }
}
```

Akibat:

1. Transaction bisa commit walaupun operation logical gagal.
2. Data partial.
3. Caller menerima success palsu.

Jika memang partial success valid, modelkan eksplisit.

```java
public ProcessingResult process() {
    // returns SUCCESS, PARTIAL_SUCCESS, FAILED with reason
}
```

### 25.3 Mark Rollback Only

Kadang exception ditangkap tetapi transaction harus rollback.

```java
@Transactional
public void process() {
    try {
        doWork();
    } catch (RecoverableBusinessException ex) {
        TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        throw new ProcessingFailedException(ex);
    }
}
```

Gunakan hati-hati. Lebih baik desain flow yang jelas daripada manual rollback status tersebar.

---

## 26. Observability: Logs, Metrics, Traces

Error handling tanpa observability hanya mempercantik response.

### 26.1 Log Level Policy

| Error type | Level umum | Catatan |
|---|---|---|
| Validation user input | DEBUG/INFO | Jangan noise WARN |
| Domain conflict normal | INFO | Bisa audit jika penting |
| Auth failure biasa | INFO/WARN | Rate-based alert |
| Forbidden sensitive | WARN/AUDIT | Tergantung policy |
| External timeout | WARN/ERROR | Berdasarkan severity |
| DB unavailable | ERROR | Alert |
| Programming bug | ERROR | Alert |
| 404 biasa | DEBUG/INFO | Jangan alert |

Jangan log semua 4xx sebagai ERROR. Itu membuat alert meaningless.

### 26.2 Metrics

Contoh metric tags:

```text
http.server.errors{status="409", code="CASE_INVALID_TRANSITION"}
application.errors{category="DOMAIN", code="CASE_INVALID_TRANSITION"}
integration.errors{target="onemap", code="TIMEOUT"}
job.errors{job="case-sync", code="EXTERNAL_TIMEOUT"}
```

Hati-hati cardinality. Jangan tag dengan:

```text
caseId
userId
requestId
raw message
exception message
```

### 26.3 Trace

Trace/span harus menyimpan error event, tetapi jangan bocorkan data sensitif.

Contoh span attributes aman:

```text
error.code=CASE_INVALID_TRANSITION
error.category=DOMAIN
http.status_code=409
retryable=false
```

Tidak aman:

```text
error.detail="Full NRIC 123..."
sql.statement="select ... with params ..."
```

### 26.4 Correlation ID

Problem response harus membawa correlation ID.

```json
{
  "code": "INTERNAL_ERROR",
  "correlationId": "01J..."
}
```

Client menyampaikan correlation ID ke support/operator. Operator mencari log/trace.

---

## 27. Enterprise Error Catalog

Untuk sistem besar, buat error catalog.

Contoh format:

| Code | Type URI | HTTP | Category | Retry | Message | Owner |
|---|---|---:|---|---|---|---|
| `CASE_NOT_FOUND` | `/problems/case-not-found` | 404 | Domain | No | Case was not found | Case module |
| `CASE_INVALID_TRANSITION` | `/problems/case-invalid-transition` | 409 | Domain | No | Transition not allowed | Case module |
| `CASE_VERSION_CONFLICT` | `/problems/version-conflict` | 409/412 | Consistency | Conditional | Refresh and retry | Platform/API |
| `VALIDATION_FAILED` | `/problems/validation-failed` | 400 | Contract | After correction | Invalid fields | Platform/API |
| `EXTERNAL_TIMEOUT` | `/problems/external-timeout` | 503 | Integration | Yes | Downstream timeout | Integration |
| `INTERNAL_ERROR` | `/problems/internal-error` | 500 | System | No | Unexpected error | Platform |

Catalog harus menjawab:

1. Apakah error bisa diekspos?
2. Apakah retryable?
3. Apakah perlu audit?
4. Apakah perlu alert?
5. Siapa owner?
6. Apakah berlaku di REST saja atau juga messaging/batch?

---

## 28. Internationalization and MessageSource

Spring `ErrorResponse` dapat menggunakan message codes untuk `type`, `title`, dan `detail`. Untuk aplikasi multi-locale, jangan hardcode semua message di handler.

Konsep:

```properties
problemDetail.title.com.example.CaseNotFoundException=Case not found
problemDetail.detail.com.example.CaseNotFoundException=Case was not found.
```

Untuk enterprise, Anda bisa memisahkan:

```text
Internal error code stable.
Localized client message optional.
Operator log English/stable.
Audit reason code stable.
```

Jangan menjadikan localized message sebagai machine-readable code.

---

## 29. Versioning Error Contract

Error contract juga perlu backward compatibility.

Jangan sembarangan rename:

```text
CASE_NOT_FOUND → CASE_MISSING
```

Client mungkin bergantung pada code lama.

Aturan:

1. Error code stable.
2. `type` URI stable.
3. Field utama tidak dihapus.
4. Extension field baru boleh ditambah.
5. Jangan ubah semantic retryable tanpa versioning/announcement.
6. Jangan ubah status HTTP untuk code yang sama tanpa migration plan.

Jika perlu deprecate:

```json
{
  "code": "OLD_CODE",
  "replacementCode": "NEW_CODE",
  "deprecated": true
}
```

Tetapi lebih baik hindari churn.

---

## 30. Designing Error Detail for Frontend

Frontend membutuhkan error yang bisa dipakai untuk UX.

### 30.1 Field Error

```json
{
  "code": "VALIDATION_FAILED",
  "errors": [
    {
      "field": "email",
      "code": "Email",
      "message": "Invalid email address"
    }
  ]
}
```

### 30.2 Form-level Error

```json
{
  "code": "CASE_INVALID_TRANSITION",
  "message": "This case cannot be approved because review is incomplete."
}
```

### 30.3 Actionable Error

Tambahkan hint jika benar-benar stable:

```json
{
  "code": "CASE_VERSION_CONFLICT",
  "action": "REFRESH_AND_RETRY"
}
```

Jangan jadikan hint sebagai business logic utama di frontend. Backend tetap sumber kebenaran.

---

## 31. Anti-pattern Error Handling

### 31.1 Catch-All di Controller

Buruk:

```java
@PostMapping("/cases")
public ResponseEntity<?> create(@RequestBody CreateCaseRequest request) {
    try {
        return ResponseEntity.ok(service.create(request));
    } catch (Exception ex) {
        return ResponseEntity.status(500).body("Failed");
    }
}
```

Masalah:

1. Mengulang boilerplate.
2. Menghapus taxonomy.
3. Sulit observability.
4. Bisa swallow exception yang harus rollback.

### 31.2 Mengembalikan 200 untuk Error

Buruk:

```json
{
  "success": false,
  "error": "Case not found"
}
```

dengan HTTP 200.

Masalah:

1. Cache/proxy/client library salah memahami response.
2. Monitoring status code tidak berguna.
3. Retry/circuit breaker sulit.

Exception: beberapa legacy RPC-style API mungkin memakai envelope 200, tetapi untuk REST modern hindari.

### 31.3 Exposing Stack Trace

Buruk:

```json
{
  "error": "java.lang.NullPointerException at com.example.CaseService..."
}
```

### 31.4 Throwing Generic RuntimeException

Buruk:

```java
throw new RuntimeException("invalid status");
```

Baik:

```java
throw new InvalidCaseTransitionException(caseId, currentStatus, requestedStatus);
```

### 31.5 Mapping Semua ke 500

Buruk:

```java
@ExceptionHandler(Exception.class)
@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
public ErrorResponse handle(Exception ex) { ... }
```

### 31.6 Mapping Semua Business Error ke 400

Buruk:

```text
Case already approved → 400
Case version conflict → 400
Duplicate reference → 400
```

Lebih baik:

```text
already approved/idempotent → 200/409 tergantung contract
version conflict → 409/412
duplicate reference → 409
```

### 31.7 Logging Twice or Ten Times

Exception sebaiknya dilog di boundary yang memutuskan final handling. Jika setiap layer log, noise besar.

Buruk:

```text
Repository logs error
Service logs error
Controller advice logs error
Filter logs error
```

Baik:

```text
Lower layer adds context or wraps exception.
Boundary handler logs once with full context.
```

### 31.8 Swallow and Continue

Buruk:

```java
catch (Exception ignored) {
}
```

Jika benar-benar boleh diabaikan, log/audit/metric sesuai criticality.

---

## 32. Example: Production-Grade Error Module

### 32.1 Error Category

```java
public enum ErrorCategory {
    VALIDATION,
    AUTHENTICATION,
    AUTHORIZATION,
    DOMAIN,
    CONFLICT,
    INTEGRATION,
    INFRASTRUCTURE,
    SYSTEM
}
```

### 32.2 Error Descriptor

```java
public record ErrorDescriptor(
        String code,
        ErrorCategory category,
        URI type,
        String title,
        HttpStatus status,
        boolean retryable,
        boolean alertable
) {
}
```

### 32.3 Application Exception

```java
public abstract class ApplicationFailure extends RuntimeException {
    private final String code;

    protected ApplicationFailure(String code, String message) {
        super(message);
        this.code = code;
    }

    protected ApplicationFailure(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
```

### 32.4 Descriptor Registry

```java
@Component
public class ErrorDescriptorRegistry {

    private final Map<String, ErrorDescriptor> descriptors;

    public ErrorDescriptorRegistry() {
        this.descriptors = Map.of(
                "CASE_INVALID_TRANSITION",
                new ErrorDescriptor(
                        "CASE_INVALID_TRANSITION",
                        ErrorCategory.DOMAIN,
                        URI.create("https://api.example.com/problems/case-invalid-transition"),
                        "Invalid case transition",
                        HttpStatus.CONFLICT,
                        false,
                        false
                ),
                "INTERNAL_ERROR",
                new ErrorDescriptor(
                        "INTERNAL_ERROR",
                        ErrorCategory.SYSTEM,
                        URI.create("https://api.example.com/problems/internal-error"),
                        "Internal error",
                        HttpStatus.INTERNAL_SERVER_ERROR,
                        false,
                        true
                )
        );
    }

    public ErrorDescriptor find(String code) {
        return descriptors.getOrDefault(code, descriptors.get("INTERNAL_ERROR"));
    }
}
```

### 32.5 Problem Factory

```java
@Component
public class ProblemFactory {

    private final ErrorDescriptorRegistry registry;
    private final CorrelationIdProvider correlationIdProvider;

    public ProblemFactory(
            ErrorDescriptorRegistry registry,
            CorrelationIdProvider correlationIdProvider
    ) {
        this.registry = registry;
        this.correlationIdProvider = correlationIdProvider;
    }

    public ProblemDetail from(ApplicationFailure failure, String path) {
        ErrorDescriptor descriptor = registry.find(failure.code());

        ProblemDetail problem = ProblemDetail.forStatus(descriptor.status());
        problem.setType(descriptor.type());
        problem.setTitle(descriptor.title());
        problem.setDetail(safeDetail(failure));
        problem.setInstance(URI.create(path));
        problem.setProperty("code", descriptor.code());
        problem.setProperty("category", descriptor.category().name());
        problem.setProperty("correlationId", correlationIdProvider.currentId());
        problem.setProperty("retryable", descriptor.retryable());

        return problem;
    }

    public ProblemDetail internalError(String path) {
        ErrorDescriptor descriptor = registry.find("INTERNAL_ERROR");

        ProblemDetail problem = ProblemDetail.forStatus(descriptor.status());
        problem.setType(descriptor.type());
        problem.setTitle(descriptor.title());
        problem.setDetail("An unexpected error occurred.");
        problem.setInstance(URI.create(path));
        problem.setProperty("code", descriptor.code());
        problem.setProperty("category", descriptor.category().name());
        problem.setProperty("correlationId", correlationIdProvider.currentId());
        problem.setProperty("retryable", false);

        return problem;
    }

    private String safeDetail(ApplicationFailure failure) {
        return switch (failure.code()) {
            case "CASE_INVALID_TRANSITION" -> "Requested case transition is not allowed in the current state.";
            default -> "Request could not be completed.";
        };
    }
}
```

### 32.6 Handler

```java
@RestControllerAdvice
public class GlobalApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalApiExceptionHandler.class);

    private final ProblemFactory problemFactory;

    public GlobalApiExceptionHandler(ProblemFactory problemFactory) {
        this.problemFactory = problemFactory;
    }

    @ExceptionHandler(ApplicationFailure.class)
    public ResponseEntity<ProblemDetail> handleApplicationFailure(
            ApplicationFailure ex,
            HttpServletRequest request
    ) {
        ProblemDetail problem = problemFactory.from(ex, request.getRequestURI());

        logAtAppropriateLevel(ex, problem);

        return ResponseEntity
                .status(problem.getStatus())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnexpected(
            Exception ex,
            HttpServletRequest request
    ) {
        ProblemDetail problem = problemFactory.internalError(request.getRequestURI());

        log.error(
                "Unexpected API failure: method={}, path={}, correlationId={}",
                request.getMethod(),
                request.getRequestURI(),
                problem.getProperties().get("correlationId"),
                ex
        );

        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private void logAtAppropriateLevel(ApplicationFailure ex, ProblemDetail problem) {
        Object code = problem.getProperties().get("code");
        Object category = problem.getProperties().get("category");
        Object correlationId = problem.getProperties().get("correlationId");

        if (problem.getStatus() >= 500) {
            log.error("Application failure: code={}, category={}, correlationId={}", code, category, correlationId, ex);
        } else if (problem.getStatus() == 409 || problem.getStatus() == 403) {
            log.info("Application rejected request: code={}, category={}, correlationId={}", code, category, correlationId);
        } else {
            log.debug("Application request error: code={}, category={}, correlationId={}", code, category, correlationId);
        }
    }
}
```

---

## 33. Testing Error Handling

### 33.1 MVC Error Contract Test

```java
@WebMvcTest(CaseController.class)
class CaseControllerErrorTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private CaseService caseService;

    @Test
    void shouldReturnProblemDetailWhenCaseNotFound() throws Exception {
        given(caseService.getCase("CASE-404"))
                .willThrow(new CaseNotFoundException("CASE-404"));

        mockMvc.perform(get("/api/cases/{id}", "CASE-404"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("https://api.example.com/problems/case-not-found"))
                .andExpect(jsonPath("$.title").value("Case not found"))
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.code").value("CASE_NOT_FOUND"))
                .andExpect(jsonPath("$.correlationId").exists());
    }
}
```

### 33.2 Validation Test

```java
@Test
void shouldReturnValidationProblemWhenRequestInvalid() throws Exception {
    String json = """
            {
              "email": "not-an-email"
            }
            """;

    mockMvc.perform(post("/api/cases")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.errors[0].field").value("email"));
}
```

### 33.3 No Stack Trace Test

```java
@Test
void shouldNotExposeStackTraceForUnexpectedError() throws Exception {
    given(caseService.getCase("CASE-500"))
            .willThrow(new NullPointerException("internal null"));

    mockMvc.perform(get("/api/cases/{id}", "CASE-500"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
            .andExpect(jsonPath("$.stackTrace").doesNotExist())
            .andExpect(jsonPath("$.detail").value("An unexpected error occurred."));
}
```

### 33.4 Contract Regression Test

Buat test untuk memastikan error code tidak berubah tanpa sadar.

```java
@Test
void errorCatalogShouldContainStableCodes() {
    assertThat(registry.find("CASE_INVALID_TRANSITION").type())
            .isEqualTo(URI.create("https://api.example.com/problems/case-invalid-transition"));
}
```

---

## 34. Review Checklist

Gunakan checklist ini saat review PR Spring.

### 34.1 Exception Design

```text
[ ] Exception punya kategori jelas.
[ ] Domain exception tidak membawa HTTP concern.
[ ] Tidak menggunakan RuntimeException generik untuk business rule.
[ ] Exception membawa context secukupnya untuk logging/mapping.
[ ] Tidak membawa secret/PII/raw SQL secara sembarangan.
```

### 34.2 API Error Contract

```text
[ ] Response memakai ProblemDetail/application/problem+json.
[ ] Error code stabil.
[ ] Type URI stabil.
[ ] HTTP status sesuai semantics.
[ ] Validation error punya field path stabil.
[ ] Response tidak membocorkan stack trace/internal class/SQL.
[ ] Correlation ID tersedia.
[ ] Retryability jelas jika relevan.
```

### 34.3 Operational Semantics

```text
[ ] 5xx dilog dengan stack trace.
[ ] 4xx normal tidak menjadi alert noise.
[ ] Metrics punya tag code/category dengan cardinality rendah.
[ ] Trace/span membawa error code aman.
[ ] Critical domain rejection diaudit jika perlu.
```

### 34.4 Async/Messaging/Batch

```text
[ ] @Async void tidak dipakai untuk pekerjaan reliable tanpa handler.
[ ] Scheduled job punya error tracking.
[ ] Message listener membedakan transient vs poison message.
[ ] Retry punya limit dan backoff.
[ ] Dead-letter membawa reason code.
```

### 34.5 Transaction/Consistency

```text
[ ] Exception tidak diswallow dalam transaction.
[ ] External side effect tidak dilakukan sembarangan sebelum commit.
[ ] TransactionalEventListener phase dipilih sadar.
[ ] Outbox dipakai untuk side effect reliable.
[ ] Optimistic conflict dimapping benar.
```

---

## 35. Failure Mode Table untuk Sistem Spring

| Failure | Symptom | Root cause umum | Prevention |
|---|---|---|---|
| Semua error 500 | Client tidak tahu tindakan | taxonomy tidak ada | problem catalog |
| Stack trace bocor | security risk | debug/default error exposure | global handler + safe detail |
| Validation tidak konsisten | frontend sulit handle | tiap controller custom | standardized validation response |
| Error 4xx membanjiri alert | alert fatigue | log level salah | log policy by category |
| Retry duplicate side effect | data ganda | retry tanpa idempotency | idempotency key/outbox |
| Async gagal diam-diam | missing notification | `@Async void` | future/job tracking |
| Scheduled job mati diam-diam | stale data | no execution record | job execution table/metrics |
| Listener retry infinite | queue stuck | poison message tidak dibedakan | DLQ + retry classifier |
| Transaction commit partial | inconsistent state | exception diswallow | explicit failure model |
| Client tidak bisa debug | support sulit | no correlation ID | correlation propagation |

---

## 36. Mental Model Final

Spring error handling bukan hanya:

```java
@ExceptionHandler(Exception.class)
```

Spring error handling yang matang adalah gabungan:

```text
Exception taxonomy
+ Problem Details contract
+ HTTP status semantics
+ safe exposure
+ validation mapping
+ persistence/integration mapping
+ retryability semantics
+ transaction behavior
+ async/messaging failure model
+ logging/metrics/tracing/audit
+ error catalog governance
```

Jika disederhanakan:

```text
Exception adalah mekanisme internal.
ProblemDetail adalah contract eksternal.
Error code adalah bahasa stabil antar sistem.
Log adalah bahasa operator.
Audit adalah bahasa governance.
Metric adalah bahasa operasi.
Retryability adalah bahasa resilience.
```

Engineer top-tier tidak hanya bertanya “exception ini ditangkap di mana?”, tetapi:

```text
Apa invariant yang gagal?
Siapa audience error ini?
Apakah detail aman?
Apakah state berubah?
Apakah retry aman?
Apakah perlu alert?
Apakah perlu audit?
Apakah error code stabil?
Apakah client bisa mengambil tindakan?
```

Jika semua jawaban itu eksplisit, error handling berubah dari afterthought menjadi bagian inti desain sistem.

---

## 37. Ringkasan Part 17

Dalam part ini kita membahas:

1. Error sebagai boundary event.
2. Perbedaan error, exception, failure, dan fault.
3. Error taxonomy untuk aplikasi Spring enterprise.
4. Spring MVC/WebFlux error handling stack.
5. `ProblemDetail` sebagai error contract modern.
6. Domain exception yang transport-neutral.
7. Problem catalog dan error code governance.
8. Global exception handler berbasis `@ControllerAdvice`.
9. Validation, parsing, not found, conflict, optimistic lock, dan persistence error mapping.
10. Retryability semantics.
11. Safe error exposure.
12. Logging, metrics, tracing, audit.
13. Error handling async, scheduled jobs, events, messaging.
14. Transaction boundary dan side effect.
15. Testing error contract.
16. Review checklist production-grade.

---

## 38. Status Seri

```text
Part saat ini : 17 dari 35
Status        : belum selesai
Berikutnya    : 18-spring-security-application-architecture.md
```

Part berikutnya akan masuk ke **Spring Security Architecture for Spring Applications**: `SecurityFilterChain`, filter ordering, `AuthenticationManager`, `AuthenticationProvider`, `SecurityContext`, session/stateless behavior, CSRF/CORS integration, OAuth2 resource server/client, method security, JWT decoder, authority mapping, custom authentication, testing, dan misconfiguration failure model.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./16-validation-binding-conversion-data-boundary.md">⬅️ Part 16 — Validation, Binding, Conversion, and Data Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./18-spring-security-application-architecture.md">Part 18 — Spring Security Application Architecture ➡️</a>
</div>

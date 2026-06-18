# 21 — Error Handling Patterns: Result, Exception Translation, Problem Details

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 21 dari 35  
> File: `21-error-handling-result-exception-translation-problem-details.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: error handling sebagai desain kontrak, bukan sekadar `try-catch`

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya tahu cara memakai `try-catch`, tetapi mampu mendesain **error model** yang stabil untuk sistem Java besar.

Target pemahaman:

1. Membedakan **domain error**, **application error**, **technical error**, **programming error**, dan **infrastructure failure**.
2. Memahami kapan menggunakan exception, kapan menggunakan `Result`, kapan menggunakan validation error aggregation.
3. Mendesain exception hierarchy yang tidak bocor melewati boundary.
4. Menerapkan **Exception Translation Pattern** untuk repository, gateway, API, messaging, dan domain boundary.
5. Mendesain error contract untuk HTTP API dengan pendekatan **Problem Details**.
6. Membedakan error yang retryable, non-retryable, compensatable, user-correctable, dan operator-actionable.
7. Menghindari anti-pattern seperti `throws Exception`, `catch-and-swallow`, string parsing error, destructive wrapping, generic catch, dan exception tunneling.
8. Membuat error handling yang observable, testable, secure, dan defensible.
9. Memahami perubahan gaya desain error handling dari Java 8 sampai Java 25.
10. Mengambil keputusan senior-level: bukan “exception vs result mana yang benar”, tetapi “di boundary mana masing-masing model paling cocok”.

---

## 1. Masalah Nyata yang Ingin Diselesaikan

Di sistem kecil, error handling sering terlihat sederhana:

```java
try {
    service.doSomething();
} catch (Exception e) {
    log.error("failed", e);
    return false;
}
```

Namun di sistem enterprise, error handling menentukan:

- apakah user mendapat pesan yang benar,
- apakah retry aman,
- apakah transaksi rollback atau commit,
- apakah audit trail cukup menjelaskan keputusan,
- apakah incident bisa di-debug,
- apakah API client bisa bereaksi otomatis,
- apakah failure bisa dikompensasi,
- apakah security information bocor,
- apakah operasi regulatory bisa dipertanggungjawabkan.

Error handling yang buruk biasanya tidak langsung terlihat. Ia muncul sebagai:

```text
Bug sulit direproduksi
Data setengah berubah
Retry membuat duplikasi
API response tidak konsisten
User melihat "Internal Server Error" untuk input salah
Log penuh stack trace tanpa konteks
Exception asli hilang karena wrapping sembarangan
Frontend parsing string error
Batch berhenti total karena satu record gagal
Event consumer mengulang pesan yang sebenarnya poison message
```

Top engineer melihat error bukan sebagai “jalur alternatif”, tetapi sebagai **bagian dari kontrak sistem**.

---

## 2. Mental Model Utama: Error Adalah State Transition yang Gagal, Bukan Sekadar Exception

Dalam sistem bisnis, banyak operasi adalah transisi:

```text
Draft -> Submitted
Submitted -> UnderReview
UnderReview -> Approved
Approved -> Published
```

Error terjadi ketika transisi tidak bisa dilakukan karena salah satu alasan:

```text
Input tidak valid
User tidak berwenang
State saat ini tidak cocok
Dependency eksternal gagal
DB timeout
Resource conflict
Bug internal
Data sudah berubah oleh proses lain
External service mengembalikan response ambigu
```

Jadi pertanyaan desainnya bukan:

```text
Apakah saya harus throw exception?
```

Melainkan:

```text
Failure ini bagian dari domain yang normal diprediksi?
Failure ini harus dilihat user?
Failure ini bisa diperbaiki user?
Failure ini bisa di-retry?
Failure ini harus rollback?
Failure ini harus diaudit?
Failure ini harus memicu alert?
Failure ini harus disembunyikan karena security?
Failure ini bug programmer?
Failure ini technical dependency failure?
```

Error model yang matang selalu menjawab pertanyaan-pertanyaan itu.

---

## 3. Taxonomy Error: Klasifikasi Sebelum Implementasi

Sebelum menentukan `Exception`, `Result`, atau HTTP status, kita harus mengklasifikasikan error.

### 3.1 Programming Error

Programming error adalah bug pada code atau pelanggaran invariant internal.

Contoh:

```text
Null yang seharusnya impossible
Switch sealed hierarchy tidak exhaustive
Illegal argument dari internal caller
Impossible state
Array index bug
Concurrent modification karena ownership salah
```

Biasanya:

- tidak boleh dikonversi menjadi pesan bisnis biasa,
- tidak boleh disembunyikan,
- harus fail fast,
- harus muncul di observability,
- biasanya mapped ke 500 jika sampai API boundary.

Contoh Java:

```java
public Money add(Money other) {
    Objects.requireNonNull(other, "other must not be null");

    if (!currency.equals(other.currency())) {
        throw new IllegalArgumentException("currency mismatch");
    }

    return new Money(amount.add(other.amount()), currency);
}
```

`IllegalArgumentException` di sini bukan “business validation untuk user”, tetapi guard untuk caller contract.

### 3.2 Domain Error

Domain error adalah failure yang valid dalam domain bisnis.

Contoh:

```text
Application already submitted
License expired
Officer not assigned to case
Appeal window has closed
Document missing
Decision cannot be changed after issuance
```

Domain error harus punya arti bisnis.

Ia biasanya:

- user-correctable atau process-correctable,
- perlu reason code,
- perlu explanation,
- sering perlu auditability,
- tidak selalu exceptional secara teknis,
- dapat dimodelkan sebagai `Result` atau domain exception tergantung boundary.

Contoh:

```java
public final class CaseAlreadyClosedException extends DomainException {
    public CaseAlreadyClosedException(CaseId caseId) {
        super("CASE_ALREADY_CLOSED", "Case %s is already closed".formatted(caseId.value()));
    }
}
```

Atau dengan `Result`:

```java
public sealed interface SubmitCaseResult permits SubmitCaseResult.Accepted, SubmitCaseResult.Rejected {
    record Accepted(CaseId caseId, Instant submittedAt) implements SubmitCaseResult {}
    record Rejected(String reasonCode, String message) implements SubmitCaseResult {}
}
```

### 3.3 Application Error

Application error muncul di use case/application service boundary.

Contoh:

```text
Authenticated user cannot perform this operation
Request idempotency key already used with different payload
Concurrent update conflict
Command refers to missing aggregate
Validation failed for request body
```

Application error sering menjadi basis mapping ke API error.

Ia tidak murni domain, karena melibatkan:

- request context,
- security context,
- transaction context,
- persistence context,
- idempotency,
- orchestration.

### 3.4 Technical Error

Technical error adalah failure dari detail teknis.

Contoh:

```text
SQL timeout
Connection refused
Socket timeout
DNS failure
Serialization failure
Disk full
S3 unavailable
Message broker down
Optimistic lock exception
```

Technical error tidak boleh bocor mentah ke domain atau API.

Buruk:

```json
{
  "message": "ORA-00001: unique constraint (ACEAS.CASE_UK) violated"
}
```

Lebih baik:

```json
{
  "type": "https://example.gov/errors/resource-conflict",
  "title": "Resource conflict",
  "status": 409,
  "detail": "The case was updated by another request. Please reload and try again.",
  "code": "CASE_CONFLICT",
  "traceId": "f8a3..."
}
```

### 3.5 Infrastructure Failure

Infrastructure failure adalah subset technical error yang berasal dari dependency eksternal atau platform.

Contoh:

```text
External identity provider timeout
OneMap API returns 429
RabbitMQ unavailable
Redis failover
AWS SSM throttling
Database connection pool exhausted
```

Biasanya perlu:

- retry classification,
- timeout,
- circuit breaker,
- fallback policy,
- operator alert,
- dead-letter handling untuk messaging,
- correlation ID.

### 3.6 Validation Error

Validation error adalah input tidak memenuhi kontrak.

Contoh:

```text
postalCode missing
email invalid
startDate after endDate
file type unsupported
field length exceeds limit
```

Validation error sebaiknya dapat mengumpulkan banyak error sekaligus.

Buruk:

```java
if (request.name() == null) {
    throw new IllegalArgumentException("name required");
}
if (request.email() == null) {
    throw new IllegalArgumentException("email required");
}
```

Karena user hanya melihat satu error per request.

Lebih baik:

```java
public record ValidationViolation(
        String field,
        String code,
        String message
) {}

public record ValidationResult(List<ValidationViolation> violations) {
    public boolean isValid() {
        return violations.isEmpty();
    }
}
```

---

## 4. Exception sebagai Control Signal

Exception di Java adalah objek yang dilempar keluar dari normal control flow.

Tetapi top engineer membedakan beberapa fungsi exception:

```text
1. Fail fast untuk programmer error
2. Escape hatch untuk technical failure
3. Boundary signal untuk application/domain failure
4. Transaction rollback signal
5. Observability carrier
6. Stack trace diagnostic
```

Kesalahan umum adalah memakai exception untuk semua hal tanpa membedakan fungsi tersebut.

---

## 5. Checked vs Unchecked Exception: Jangan Dibahas Secara Dogmatis

Java memiliki checked exception dan unchecked exception.

### 5.1 Checked Exception

Checked exception memaksa caller menangani atau mendeklarasikan error.

Cocok ketika:

- caller benar-benar dapat melakukan recovery lokal,
- failure adalah bagian eksplisit dari kontrak API,
- API library ingin memaksa consumer aware terhadap failure,
- boundary rendah seperti file/network parsing.

Contoh:

```java
public interface DocumentParser {
    ParsedDocument parse(Path file) throws InvalidDocumentFormatException, IOException;
}
```

Masalah checked exception:

- sering menyebabkan `throws Exception` menyebar,
- sulit di lambda/stream,
- mudah dibungkus sembarangan,
- membuat signature berisik,
- tidak cocok untuk domain/application layer besar jika recovery tidak lokal.

### 5.2 Unchecked Exception

Unchecked exception tidak dipaksa compiler.

Cocok ketika:

- failure tidak bisa dipulihkan lokal,
- caller tidak bisa melakukan tindakan spesifik,
- error akan ditangani oleh boundary global,
- programming invariant dilanggar,
- transaction rollback lebih natural.

Contoh:

```java
public final class CaseNotFoundException extends ApplicationException {
    public CaseNotFoundException(CaseId caseId) {
        super("CASE_NOT_FOUND", "Case not found: " + caseId.value());
    }
}
```

Risiko unchecked exception:

- kontrak error tidak terlihat di method signature,
- bisa menjadi invisible control flow,
- mudah overuse,
- perlu dokumentasi dan test contract.

### 5.3 Rule of Thumb

Gunakan checked exception ketika:

```text
Caller dekat dengan sumber error dan bisa recover secara spesifik.
```

Gunakan unchecked exception ketika:

```text
Failure akan dikonversi di boundary lebih atas, atau recovery lokal tidak meaningful.
```

Gunakan `Result` ketika:

```text
Failure adalah bagian normal dari domain decision dan caller harus membuat keputusan eksplisit.
```

---

## 6. Exception Hierarchy yang Sehat

### 6.1 Jangan Mulai dari Terlalu Banyak Class

Buruk:

```text
InvalidCaseStatusException
InvalidAppealStatusException
InvalidRenewalStatusException
InvalidDraftStatusException
InvalidSubmissionStatusException
InvalidOfficerStatusException
```

Jika semua hanya membawa `message`, hierarchy menjadi noise.

Lebih baik mulai dari kategori stabil:

```java
public abstract class AppException extends RuntimeException {
    private final String code;
    private final ErrorCategory category;
    private final boolean retryable;

    protected AppException(
            String code,
            ErrorCategory category,
            boolean retryable,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.code = code;
        this.category = category;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public ErrorCategory category() {
        return category;
    }

    public boolean retryable() {
        return retryable;
    }
}
```

```java
public enum ErrorCategory {
    VALIDATION,
    NOT_FOUND,
    CONFLICT,
    FORBIDDEN,
    DOMAIN_RULE,
    EXTERNAL_DEPENDENCY,
    INFRASTRUCTURE,
    INTERNAL
}
```

Kemudian turunan:

```java
public final class DomainRuleViolationException extends AppException {
    public DomainRuleViolationException(String code, String message) {
        super(code, ErrorCategory.DOMAIN_RULE, false, message, null);
    }
}
```

```java
public final class ExternalDependencyException extends AppException {
    public ExternalDependencyException(String code, String message, boolean retryable, Throwable cause) {
        super(code, ErrorCategory.EXTERNAL_DEPENDENCY, retryable, message, cause);
    }
}
```

### 6.2 Field Penting dalam Error Object

Error object yang matang biasanya membawa:

```text
code
category
message internal
safe message public
retryable flag
cause
correlation id / trace id
field violations
resource id
operation name
dependency name
http status mapping
```

Namun jangan semua field dimasukkan ke base exception jika tidak semua kategori butuh.

Gunakan composition:

```java
public record ErrorDescriptor(
        String code,
        ErrorCategory category,
        boolean retryable,
        String publicMessage
) {}
```

### 6.3 Exception Message Bukan Contract

Anti-pattern:

```java
if (e.getMessage().contains("duplicate key")) {
    return Conflict;
}
```

Message untuk manusia/log. Contract harus memakai:

```text
exception type
error code
SQL state
vendor code translated at boundary
structured field
```

---

## 7. Exception Translation Pattern

Exception Translation Pattern berarti menangkap exception level rendah lalu mengubahnya menjadi exception level boundary yang lebih bermakna.

Mental model:

```text
Low-level detail error
        ↓ translate
Boundary-specific error
        ↓ map
User/API/operator-facing error
```

### 7.1 Repository Boundary

Low-level:

```text
SQLException
DataIntegrityViolationException
OptimisticLockException
ConstraintViolationException
SQLTimeoutException
```

Repository/application boundary sebaiknya tidak membocorkan detail vendor.

Contoh:

```java
public final class CaseRepositoryExceptionTranslator {

    public RuntimeException translate(Exception ex) {
        if (isUniqueViolation(ex)) {
            return new ResourceConflictException(
                    "CASE_DUPLICATE",
                    "Case already exists",
                    ex
            );
        }

        if (isTimeout(ex)) {
            return new RepositoryUnavailableException(
                    "CASE_REPOSITORY_TIMEOUT",
                    "Case repository timeout",
                    true,
                    ex
            );
        }

        return new RepositoryFailureException(
                "CASE_REPOSITORY_FAILURE",
                "Case repository failure",
                false,
                ex
        );
    }
}
```

Repository:

```java
public Optional<Case> findById(CaseId id) {
    try {
        return jpaRepository.findById(id.value()).map(mapper::toDomain);
    } catch (RuntimeException ex) {
        throw translator.translate(ex);
    }
}
```

### 7.2 Gateway Boundary

External API error perlu diterjemahkan.

External service mungkin mengembalikan:

```text
HTTP 400
HTTP 401
HTTP 403
HTTP 404
HTTP 409
HTTP 429
HTTP 500
HTTP 503
Socket timeout
Malformed JSON
Business error payload
```

Internal code tidak boleh bergantung langsung pada semua variasi itu.

```java
public Address lookup(Postcode postcode) {
    try {
        ExternalAddressResponse response = client.lookup(postcode.value());
        return mapper.toDomain(response);
    } catch (HttpTooManyRequestsException ex) {
        throw new ExternalDependencyException(
                "ONEMAP_RATE_LIMITED",
                "Address provider is rate limited",
                true,
                ex
        );
    } catch (HttpUnauthorizedException ex) {
        throw new ExternalDependencyException(
                "ONEMAP_AUTH_FAILED",
                "Address provider authentication failed",
                false,
                ex
        );
    } catch (SocketTimeoutException ex) {
        throw new ExternalDependencyException(
                "ONEMAP_TIMEOUT",
                "Address provider timeout",
                true,
                ex
        );
    }
}
```

### 7.3 API Boundary

Application exception harus dikonversi ke API error response.

```java
public ProblemDetailResponse toProblem(AppException ex, String traceId) {
    return switch (ex.category()) {
        case VALIDATION -> validationProblem(ex, traceId);
        case NOT_FOUND -> notFoundProblem(ex, traceId);
        case CONFLICT -> conflictProblem(ex, traceId);
        case FORBIDDEN -> forbiddenProblem(ex, traceId);
        case DOMAIN_RULE -> domainRuleProblem(ex, traceId);
        case EXTERNAL_DEPENDENCY -> dependencyProblem(ex, traceId);
        case INFRASTRUCTURE, INTERNAL -> internalProblem(traceId);
    };
}
```

### 7.4 Translation Jangan Menghapus Cause

Buruk:

```java
catch (SQLException e) {
    throw new RuntimeException("Database failed");
}
```

Cause hilang.

Lebih baik:

```java
catch (SQLException e) {
    throw new RepositoryFailureException("CASE_REPOSITORY_FAILURE", "Database failed", e);
}
```

### 7.5 Translation Jangan Bocorkan Detail Sensitif

Buruk:

```java
throw new ApiException("SQL failed: " + e.getMessage(), e);
```

Lebih baik:

```java
throw new RepositoryFailureException(
        "CASE_REPOSITORY_FAILURE",
        "Unable to load case",
        e
);
```

Log internal boleh menyimpan cause. Response public tidak.

---

## 8. Result / Either Pattern di Java

`Result` adalah object yang merepresentasikan sukses atau gagal tanpa exception.

Java tidak punya built-in `Result` seperti Rust atau `Either` seperti functional libraries, tetapi bisa dimodelkan dengan sealed interface.

### 8.1 Basic Result

```java
public sealed interface Result<T, E> permits Result.Ok, Result.Err {

    record Ok<T, E>(T value) implements Result<T, E> {}

    record Err<T, E>(E error) implements Result<T, E> {}

    static <T, E> Result<T, E> ok(T value) {
        return new Ok<>(value);
    }

    static <T, E> Result<T, E> err(E error) {
        return new Err<>(error);
    }
}
```

Usage:

```java
Result<Decision, DecisionError> result = policy.evaluate(context);

switch (result) {
    case Result.Ok<Decision, DecisionError> ok -> approve(ok.value());
    case Result.Err<Decision, DecisionError> err -> reject(err.error());
}
```

### 8.2 Domain-Specific Result Lebih Baik daripada Generic Result untuk Use Case Penting

Generic `Result<T,E>` fleksibel, tetapi kadang kehilangan readability.

Lebih baik untuk domain besar:

```java
public sealed interface SubmitApplicationResult
        permits SubmitApplicationResult.Submitted,
                SubmitApplicationResult.Rejected,
                SubmitApplicationResult.AlreadySubmitted {

    record Submitted(ApplicationId applicationId, Instant submittedAt)
            implements SubmitApplicationResult {}

    record Rejected(List<RuleViolation> violations)
            implements SubmitApplicationResult {}

    record AlreadySubmitted(ApplicationId applicationId, Instant submittedAt)
            implements SubmitApplicationResult {}
}
```

Ini jauh lebih expressive:

```java
return switch (result) {
    case Submitted submitted -> ok(toResponse(submitted));
    case Rejected rejected -> unprocessable(rejected.violations());
    case AlreadySubmitted already -> conflict(already);
};
```

### 8.3 Kapan Result Cocok

Gunakan `Result` ketika:

```text
Failure adalah hasil normal dari keputusan domain.
Caller harus menangani semua kemungkinan secara eksplisit.
Tidak perlu stack trace.
Tidak ingin memakai exception untuk branch biasa.
Ada multiple failure yang bisa dikembalikan.
Flow dekat dan lokal.
```

Contoh cocok:

```text
policy evaluation
validation
eligibility check
parser business rule
authorization decision internal
matching rule
pricing calculation
case transition availability
```

### 8.4 Kapan Result Tidak Cocok

Jangan pakai `Result` untuk:

```text
programming bug
DB connection failure
unexpected null
resource exhausted
thread interruption
infrastructure timeout yang akan ditangani global
```

Buruk:

```java
Result<Case, DatabaseError> findById(CaseId id);
```

Jika semua repository method mengembalikan `Result`, call chain bisa menjadi noisy dan semua technical failure jadi normal branch.

Boleh, tapi harus ada alasan kuat.

### 8.5 Result Anti-Pattern

Anti-pattern:

```java
public record Result<T>(boolean success, T data, String error) {}
```

Masalah:

- bisa `success=true` tapi `error!=null`,
- bisa `success=false` tapi `data!=null`,
- error hanya string,
- caller lupa check,
- tidak exhaustive.

Lebih baik sealed type.

---

## 9. Validation Error Aggregation

Validation sering lebih baik memakai aggregation daripada exception satu per satu.

### 9.1 ValidationViolation

```java
public record ValidationViolation(
        String path,
        String code,
        String message,
        Object rejectedValue
) {}
```

Untuk keamanan, hati-hati dengan `rejectedValue`. Jangan masukkan password, token, NRIC, file content, atau data sensitif.

### 9.2 ValidationResult

```java
public final class ValidationResult {
    private final List<ValidationViolation> violations;

    private ValidationResult(List<ValidationViolation> violations) {
        this.violations = List.copyOf(violations);
    }

    public static ValidationResult valid() {
        return new ValidationResult(List.of());
    }

    public static ValidationResult invalid(List<ValidationViolation> violations) {
        return new ValidationResult(violations);
    }

    public boolean isValid() {
        return violations.isEmpty();
    }

    public List<ValidationViolation> violations() {
        return violations;
    }
}
```

### 9.3 Validator Composition

```java
public interface Validator<T> {
    List<ValidationViolation> validate(T target);

    default Validator<T> and(Validator<T> other) {
        return target -> {
            List<ValidationViolation> result = new ArrayList<>();
            result.addAll(this.validate(target));
            result.addAll(other.validate(target));
            return result;
        };
    }
}
```

### 9.4 Request Validation vs Domain Validation

Request validation:

```text
field required
format valid
length valid
syntax valid
payload shape valid
```

Domain validation:

```text
state transition allowed
officer assigned
deadline still open
role can approve
case has required documents
```

Jangan campur semua di DTO annotation.

Buruk:

```java
public record SubmitCaseRequest(
    @NotNull String caseId,
    @AssertTrue boolean officerAssigned,
    @AssertTrue boolean deadlineStillOpen
) {}
```

`officerAssigned` dan `deadlineStillOpen` bukan input shape. Itu domain/application rule.

---

## 10. Problem Details untuk HTTP API Error

Untuk HTTP API, error response sebaiknya structured dan machine-readable.

Standar modern untuk ini adalah **Problem Details for HTTP APIs**. RFC 9457 mendefinisikan problem detail sebagai format machine-readable untuk error HTTP dan meng-obsolete RFC 7807.

### 10.1 Bentuk Dasar

```json
{
  "type": "https://example.gov/problems/case-conflict",
  "title": "Case conflict",
  "status": 409,
  "detail": "The case was updated by another request. Please reload and try again.",
  "instance": "/cases/C-2026-001/submission",
  "code": "CASE_CONFLICT",
  "traceId": "4f7a9e2c"
}
```

Field umum:

```text
type      : identifier untuk problem class
title     : human-readable summary
status    : HTTP status
detail    : human-readable explanation untuk occurrence spesifik
instance  : URI/reference untuk occurrence spesifik
```

Extension field bisa digunakan:

```text
code
traceId
violations
retryable
dependency
retryAfter
```

### 10.2 Jangan Jadikan `detail` sebagai Contract Utama

Client tidak boleh parsing `detail`.

Buruk:

```typescript
if (error.detail.includes("already submitted")) {
  showAlreadySubmittedMessage();
}
```

Lebih baik:

```typescript
if (error.code === "APPLICATION_ALREADY_SUBMITTED") {
  showAlreadySubmittedMessage();
}
```

### 10.3 Error Code Taxonomy

Contoh taxonomy:

```text
VALIDATION_REQUIRED
VALIDATION_FORMAT
VALIDATION_RANGE
CASE_NOT_FOUND
CASE_CONFLICT
CASE_INVALID_STATE
CASE_ALREADY_SUBMITTED
AUTH_FORBIDDEN
AUTH_SESSION_EXPIRED
DEPENDENCY_TIMEOUT
DEPENDENCY_RATE_LIMITED
INTERNAL_ERROR
```

Kode harus:

- stabil,
- documented,
- tidak terlalu vendor-specific,
- tidak mengandung data sensitif,
- dapat digunakan frontend/client untuk decision.

### 10.4 Problem Detail untuk Validation

```json
{
  "type": "https://example.gov/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid fields.",
  "code": "VALIDATION_FAILED",
  "traceId": "4f7a9e2c",
  "violations": [
    {
      "path": "applicant.email",
      "code": "EMAIL_INVALID",
      "message": "Email format is invalid"
    },
    {
      "path": "documents[0].type",
      "code": "DOCUMENT_TYPE_UNSUPPORTED",
      "message": "Document type is not supported"
    }
  ]
}
```

### 10.5 Problem Detail untuk External Dependency

```json
{
  "type": "https://example.gov/problems/dependency-unavailable",
  "title": "Dependency unavailable",
  "status": 503,
  "detail": "Address lookup is temporarily unavailable. Please try again later.",
  "code": "ADDRESS_PROVIDER_UNAVAILABLE",
  "traceId": "4f7a9e2c",
  "retryable": true
}
```

### 10.6 Jangan Bocorkan Internal

Buruk:

```json
{
  "status": 500,
  "detail": "java.sql.SQLRecoverableException: IO Error: Connection reset"
}
```

Lebih baik:

```json
{
  "type": "https://example.gov/problems/internal-error",
  "title": "Internal server error",
  "status": 500,
  "detail": "An unexpected error occurred. Contact support with the trace id.",
  "code": "INTERNAL_ERROR",
  "traceId": "4f7a9e2c"
}
```

Internal log tetap menyimpan stack trace.

---

## 11. HTTP Status Mapping: Jangan Asal 400 atau 500

Mapping umum:

| Situation | HTTP Status | Catatan |
|---|---:|---|
| Malformed JSON | 400 | Request syntax invalid |
| Field validation failed | 400 / 422 | Pilih konsisten; banyak API memakai 400 |
| Auth missing/invalid | 401 | Authentication issue |
| Auth valid but forbidden | 403 | Authorization issue |
| Resource not found | 404 | Hati-hati enumeration security |
| Invalid state transition | 409 / 422 | 409 jika conflict dengan resource state |
| Optimistic lock conflict | 409 | Client perlu reload |
| Duplicate resource | 409 | Conflict |
| Rate limit | 429 | Sertakan `Retry-After` jika relevan |
| Dependency timeout | 503 / 504 | Tergantung boundary |
| Unexpected bug | 500 | Jangan detail internal |
| Service overloaded | 503 | Retryable dengan backoff |

### 11.1 400 vs 422

Keduanya bisa digunakan untuk validation. Yang penting konsisten.

Model praktis:

```text
400: request syntactically/structurally invalid
422: request structurally valid, semantically rejected
```

Namun banyak organisasi menyederhanakan semua validation menjadi 400. Itu boleh jika documented.

### 11.2 404 vs 403 untuk Security

Kadang resource ada, tetapi user tidak boleh tahu.

```text
Jika mengungkap keberadaan resource berisiko, return 404.
Jika user boleh tahu resource ada tapi tidak punya akses, return 403.
```

### 11.3 409 untuk State Conflict

Gunakan 409 untuk:

```text
optimistic locking conflict
already submitted
duplicate unique resource
state changed since user loaded data
```

---

## 12. Retryable vs Non-Retryable Failure

Tidak semua error boleh di-retry.

### 12.1 Retryable

Biasanya retryable:

```text
network timeout
HTTP 429
HTTP 503
connection reset
transient DB deadlock
temporary DNS failure
leader election/failover moment
```

### 12.2 Non-Retryable

Biasanya non-retryable:

```text
validation failed
forbidden
not found karena ID salah
business rule violation
malformed request
invalid credentials
unsupported file type
```

### 12.3 Ambiguous

Ambiguous:

```text
HTTP 500 dari external provider
socket closed setelah request dikirim
message broker publish timeout
DB commit unknown
```

Ambiguous failure butuh idempotency.

### 12.4 Retry Classification Object

```java
public enum RetryClassification {
    RETRYABLE,
    NON_RETRYABLE,
    UNKNOWN_COMMIT_STATE
}
```

```java
public interface RetryClassifiedError {
    RetryClassification retryClassification();
}
```

### 12.5 Retry Without Idempotency Is Dangerous

Buruk:

```java
for (int i = 0; i < 3; i++) {
    externalPayment.charge(card, amount);
}
```

Jika timeout terjadi setelah charge berhasil, retry bisa charge dua kali.

Lebih baik:

```java
externalPayment.charge(card, amount, idempotencyKey);
```

---

## 13. Compensation-Aware Errors

Dalam distributed system, failure tidak selalu bisa rollback.

Contoh:

```text
Case approved in local DB
Notification sent
External registry update failed
```

Pertanyaan:

```text
Apakah approval harus dibatalkan?
Apakah registry update di-retry async?
Apakah user melihat status partial?
Apakah perlu manual intervention?
Apakah ada audit entry?
```

Error model perlu membedakan:

```text
failed before mutation
failed after local mutation
failed after external mutation
unknown external mutation state
```

Contoh:

```java
public enum FailurePhase {
    BEFORE_LOCAL_MUTATION,
    AFTER_LOCAL_MUTATION,
    AFTER_EXTERNAL_MUTATION,
    UNKNOWN_EXTERNAL_STATE
}
```

```java
public final class ExternalUpdateAmbiguousException extends AppException {
    private final FailurePhase phase;

    public ExternalUpdateAmbiguousException(String code, String message, Throwable cause) {
        super(code, ErrorCategory.EXTERNAL_DEPENDENCY, true, message, cause);
        this.phase = FailurePhase.UNKNOWN_EXTERNAL_STATE;
    }

    public FailurePhase phase() {
        return phase;
    }
}
```

Ini penting untuk saga, outbox, inbox, dan compensation design.

---

## 14. Error Handling di Layer Berbeda

### 14.1 Domain Layer

Domain layer sebaiknya tidak tahu:

```text
HTTP status
SQL exception
Kafka exception
Spring exception
JPA exception
JSON exception
```

Domain layer boleh tahu:

```text
business invariant
rule violation
illegal transition
value object invalidity
```

Domain error bisa berupa exception atau result.

### 14.2 Application Layer

Application layer mengorkestrasi:

```text
transaction
repository
domain operation
authorization
idempotency
event/outbox
```

Application layer cocok untuk:

- translate repository/gateway error,
- decide rollback,
- classify retry,
- produce application-level exception/result.

### 14.3 Infrastructure Layer

Infrastructure layer menangani:

```text
SQL/JPA/JDBC
HTTP client
messaging
file IO
serialization
cloud SDK
```

Ia harus menerjemahkan technical detail ke boundary-specific failure.

### 14.4 API Layer

API layer menangani:

```text
request parse error
validation error
exception-to-response mapping
Problem Details
security response masking
trace id exposure
```

API layer tidak boleh mengandung business decision logic.

### 14.5 Messaging Layer

Messaging layer perlu membedakan:

```text
transient failure -> retry
poison message -> dead letter
business rejection -> ack + record rejection
unexpected bug -> retry limited + DLQ
schema incompatible -> DLQ/operator alert
```

---

## 15. Global Exception Handler Pattern

Di Spring/JAX-RS/Jakarta, biasanya ada global exception mapper.

Pseudo-code framework-neutral:

```java
public final class ApiExceptionMapper {

    public ProblemResponse map(Throwable throwable, RequestContext context) {
        String traceId = context.traceId();

        if (throwable instanceof ValidationException ex) {
            return validationProblem(ex, traceId);
        }

        if (throwable instanceof AppException ex) {
            return appProblem(ex, traceId);
        }

        if (throwable instanceof IllegalArgumentException ex) {
            return internalBugProblem(traceId);
        }

        return internalProblem(traceId);
    }
}
```

### 15.1 Global Handler Bukan Tempat Business Logic

Buruk:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handle(Exception e) {
    if (e.getMessage().contains("appeal")) {
        return badRequest("Appeal not allowed");
    }
    return internalServerError();
}
```

Global handler hanya mapping dari structured error ke representation.

### 15.2 Handler Ordering

Specific dulu, generic terakhir.

```text
ValidationException
AuthenticationException
AuthorizationException
DomainException
ApplicationException
ExternalDependencyException
Throwable
```

Jika generic `Exception` ditangkap terlalu awal, error semantics hilang.

---

## 16. Error Code Design

### 16.1 Error Code Harus Stabil

Buruk:

```text
ERR_001
ERR_002
ERR_003
```

Tidak meaningful.

Buruk juga:

```text
ORA_UNIQUE_CONSTRAINT_CASE_TABLE
```

Terlalu technical.

Lebih baik:

```text
CASE_ALREADY_EXISTS
CASE_INVALID_STATE
CASE_NOT_FOUND
CASE_CONCURRENT_UPDATE
APPLICATION_SUBMISSION_WINDOW_CLOSED
DOCUMENT_REQUIRED
EXTERNAL_ADDRESS_PROVIDER_TIMEOUT
```

### 16.2 Naming Convention

Gunakan pola:

```text
<DOMAIN>_<CONDITION>
<RESOURCE>_<ERROR>
<DEPENDENCY>_<FAILURE>
```

Contoh:

```text
CASE_NOT_FOUND
CASE_INVALID_STATE
CASE_CONFLICT
DOCUMENT_UNSUPPORTED_TYPE
AUTH_FORBIDDEN
ONEMAP_RATE_LIMITED
EMAIL_PROVIDER_UNAVAILABLE
```

### 16.3 Jangan Terlalu Banyak Code

Jika setiap field punya code unik berlebihan:

```text
CASE_NAME_FIELD_NULL_ERROR_FOR_SUBMIT_SCREEN
CASE_NAME_FIELD_EMPTY_ERROR_FOR_SUBMIT_SCREEN
CASE_NAME_FIELD_WHITESPACE_ERROR_FOR_SUBMIT_SCREEN
```

Itu sulit dipelihara.

Lebih baik:

```text
VALIDATION_REQUIRED
VALIDATION_BLANK
VALIDATION_FORMAT
```

Dengan `path`:

```json
{
  "path": "case.name",
  "code": "VALIDATION_REQUIRED"
}
```

### 16.4 Error Registry

Untuk sistem besar, buat registry:

```text
code
category
http status
public title
public message template
retryable
owner module
first introduced version
deprecation status
```

Contoh:

```markdown
| Code | Category | HTTP | Retryable | Owner | Public Message |
|---|---|---:|---|---|---|
| CASE_NOT_FOUND | NOT_FOUND | 404 | false | case | Case not found |
| CASE_CONFLICT | CONFLICT | 409 | false | case | Case was updated by another request |
| ONEMAP_TIMEOUT | EXTERNAL_DEPENDENCY | 503 | true | address | Address provider timeout |
```

---

## 17. Secure Error Handling

Error response adalah security surface.

Jangan expose:

```text
SQL query
schema/table name
internal host
stack trace
JWT/token
session id
NRIC/passport
password
cloud secret path
bucket name jika sensitif
internal URL
class/package internal jika tidak perlu
```

### 17.1 Public vs Internal Message

```java
public record ErrorMessage(
        String publicMessage,
        String internalMessage
) {}
```

Public:

```text
Unable to process the request. Contact support with trace id.
```

Internal log:

```text
Oracle timeout while loading case C-2026-001 from schema ACEAS_CASE using query hash abc123
```

### 17.2 Authorization Error Masking

Untuk resource sensitif:

```java
if (!accessControl.canView(user, caseId)) {
    throw new ResourceNotFoundOrNotAccessibleException("CASE_NOT_FOUND");
}
```

Response:

```json
{
  "status": 404,
  "code": "CASE_NOT_FOUND"
}
```

Internal audit:

```text
user attempted access to existing case without permission
```

### 17.3 Validation Rejected Value

Jangan echo value sensitif:

Buruk:

```json
{
  "path": "password",
  "rejectedValue": "P@ssw0rd123"
}
```

Lebih baik:

```json
{
  "path": "password",
  "code": "VALIDATION_FORMAT",
  "message": "Password does not meet policy"
}
```

---

## 18. Observability Pattern untuk Error

Error handling yang baik memisahkan:

```text
What client sees
What operator sees
What developer sees
What auditor sees
```

### 18.1 Log Level

Rule praktis:

| Error Type | Log Level | Catatan |
|---|---|---|
| Validation error | DEBUG/INFO | Jangan spam error log |
| Domain rejection | INFO | Normal business outcome |
| Forbidden access | WARN/INFO | Tergantung risk |
| Not found normal lookup | DEBUG/INFO | Jangan alert |
| External timeout | WARN | Jika transient |
| Dependency outage | ERROR | Jika berdampak luas |
| Internal bug | ERROR | Stack trace |
| Security attack pattern | WARN/ERROR | Dengan throttling |

### 18.2 Structured Log

Buruk:

```java
log.error("failed " + e.getMessage());
```

Lebih baik:

```java
log.warn(
    "case submission rejected: code={}, caseId={}, userId={}, traceId={}",
    ex.code(),
    caseId.value(),
    userId.value(),
    traceId
);
```

Untuk technical failure:

```java
log.error(
    "external dependency failed: dependency={}, operation={}, code={}, retryable={}, traceId={}",
    "OneMap",
    "lookupAddress",
    ex.code(),
    ex.retryable(),
    traceId,
    ex
);
```

### 18.3 Metrics

Metrics berguna:

```text
errors_total{code, category, endpoint}
external_dependency_failures_total{dependency, operation, code}
validation_failures_total{endpoint, field, code}
retry_attempts_total{dependency, result}
dead_letter_total{consumer, reason}
```

Hati-hati cardinality:

Jangan jadikan `caseId`, `userId`, `traceId`, atau raw message sebagai label metric.

### 18.4 Trace Span

Span attributes:

```text
error.code
error.category
error.retryable
dependency.name
dependency.operation
http.status_code
```

Jangan masukkan sensitive payload.

---

## 19. Testing Strategy untuk Error Handling

### 19.1 Unit Test Domain Error

```java
@Test
void cannotSubmitClosedCase() {
    Case closed = Case.closed(caseId);

    SubmitCaseResult result = closed.submit(submitter, clock);

    assertThat(result).isInstanceOf(SubmitCaseResult.Rejected.class);
}
```

Jika exception:

```java
@Test
void cannotApproveClosedCase() {
    Case closed = Case.closed(caseId);

    assertThrows(CaseAlreadyClosedException.class, () -> closed.approve(officer));
}
```

### 19.2 Test Exception Translation

```java
@Test
void translatesUniqueConstraintToConflict() {
    SQLException sql = uniqueConstraintViolation();

    RuntimeException translated = translator.translate(sql);

    assertThat(translated).isInstanceOf(ResourceConflictException.class);
    assertThat(((AppException) translated).code()).isEqualTo("CASE_DUPLICATE");
}
```

### 19.3 Test API Problem Details

```java
@Test
void mapsConflictToProblemDetail() {
    AppException ex = new ResourceConflictException("CASE_CONFLICT", "Conflict", null);

    ProblemResponse response = mapper.map(ex, new RequestContext("trace-1"));

    assertThat(response.status()).isEqualTo(409);
    assertThat(response.code()).isEqualTo("CASE_CONFLICT");
    assertThat(response.traceId()).isEqualTo("trace-1");
}
```

### 19.4 Test Sensitive Information Not Exposed

```java
@Test
void doesNotExposeSqlMessage() {
    Throwable cause = new RuntimeException("ORA-01017 invalid username/password; logon denied");
    AppException ex = new RepositoryFailureException("DB_FAILURE", "internal", cause);

    ProblemResponse response = mapper.map(ex, context);

    assertThat(response.detail()).doesNotContain("ORA-");
    assertThat(response.detail()).doesNotContain("password");
}
```

### 19.5 Contract Test untuk Error Response

API error response harus punya contract test:

```text
status
content-type
code
title
detail shape
violations shape
traceId present
no stack trace
```

### 19.6 Chaos/Failure Injection

Untuk dependency:

```text
simulate timeout
simulate 429
simulate 500
simulate malformed response
simulate slow response
simulate connection reset after send
```

Tujuan:

- verify retry classification,
- verify no sensitive leak,
- verify fallback behavior,
- verify metrics/logging.

---

## 20. Java 8–25 Perspective

### 20.1 Java 8

Java 8 membawa lambda dan stream, tetapi checked exception tidak nyaman di lambda.

Anti-pattern:

```java
items.stream()
     .map(item -> {
         try {
             return parser.parse(item);
         } catch (IOException e) {
             throw new RuntimeException(e);
         }
     })
     .toList();
```

Masalah:

- destructive wrapping,
- error context minim,
- item mana yang gagal tidak jelas.

Lebih baik:

```java
items.stream()
     .map(item -> parseWithContext(item))
     .toList();
```

```java
private ParsedItem parseWithContext(Item item) {
    try {
        return parser.parse(item);
    } catch (IOException e) {
        throw new ItemParseException("ITEM_PARSE_FAILED", item.id(), e);
    }
}
```

### 20.2 Optional Bukan Error Channel Umum

`Optional.empty()` cocok untuk absence, bukan failure.

Baik:

```java
Optional<Case> findById(CaseId id);
```

Buruk:

```java
Optional<Case> submit(CaseId id);
```

Karena `empty` tidak menjelaskan:

```text
not found?
invalid state?
forbidden?
DB error?
```

### 20.3 Records untuk Error Payload

Records cocok untuk immutable error payload.

```java
public record ProblemResponse(
        URI type,
        String title,
        int status,
        String detail,
        URI instance,
        String code,
        String traceId,
        List<ViolationResponse> violations
) {}
```

### 20.4 Sealed Interfaces untuk Exhaustive Result

```java
public sealed interface AuthorizationDecision
        permits AuthorizationDecision.Allowed, AuthorizationDecision.Denied {

    record Allowed() implements AuthorizationDecision {}

    record Denied(String reasonCode, String message) implements AuthorizationDecision {}
}
```

Switch exhaustive:

```java
return switch (decision) {
    case AuthorizationDecision.Allowed allowed -> proceed();
    case AuthorizationDecision.Denied denied -> forbidden(denied);
};
```

### 20.5 Pattern Matching Switch

Pattern matching memudahkan mapping error object.

```java
ProblemResponse map(Throwable t) {
    return switch (t) {
        case ValidationException ex -> validation(ex);
        case ResourceConflictException ex -> conflict(ex);
        case NotFoundException ex -> notFound(ex);
        case ExternalDependencyException ex -> dependency(ex);
        case AppException ex -> app(ex);
        default -> internal(t);
    };
}
```

Tetap hati-hati ordering dan leakage.

### 20.6 Virtual Threads

Virtual threads membuat blocking code lebih murah, tetapi tidak menghapus kebutuhan timeout dan cancellation.

Error handling yang buruk di virtual thread:

```java
try {
    client.call(); // no timeout
} catch (Exception e) {
    throw new RuntimeException(e);
}
```

Blocking murah bukan berarti dependency failure aman.

### 20.7 Structured Concurrency

Structured concurrency mengubah error aggregation untuk parallel tasks.

Pertanyaan:

```text
Jika satu child task gagal, apakah sibling dibatalkan?
Jika beberapa gagal, error mana dikembalikan?
Apakah partial result boleh?
Apakah failure aggregated?
```

Desain error harus eksplisit.

---

## 21. Anti-Pattern Catalog

### 21.1 Catch and Swallow

```java
try {
    auditWriter.write(event);
} catch (Exception e) {
    // ignore
}
```

Masalah:

- failure hilang,
- audit mungkin tidak lengkap,
- impossible to debug.

Lebih baik:

```java
try {
    auditWriter.write(event);
} catch (Exception e) {
    log.error("audit write failed: eventId={}, traceId={}", event.id(), traceId, e);
    throw new AuditWriteException("AUDIT_WRITE_FAILED", event.id(), e);
}
```

Jika benar-benar best-effort:

```java
try {
    notification.send(message);
} catch (Exception e) {
    log.warn("best-effort notification failed: notificationId={}", message.id(), e);
    metrics.increment("notification.best_effort.failed");
}
```

Best-effort harus documented.

### 21.2 `throws Exception`

```java
public void process() throws Exception
```

Masalah:

- caller tidak tahu failure contract,
- semua error sama,
- forced generic catch,
- no semantics.

Lebih baik:

```java
public void process() throws InvalidDocumentFormatException, DocumentStorageException
```

Atau unchecked structured exception.

### 21.3 Catch Generic Too Early

```java
try {
    approveCase(command);
} catch (Exception e) {
    throw new ApprovalFailedException(e);
}
```

Masalah:

- `ForbiddenException`, `ValidationException`, `ConflictException` tertutup,
- API jadi 500 semua,
- error semantics hilang.

Lebih baik:

```java
try {
    approveCase(command);
} catch (DomainException | ApplicationException e) {
    throw e;
} catch (ExternalClientException e) {
    throw translator.translate(e);
}
```

### 21.4 Destructive Wrapping

```java
catch (SQLException e) {
    throw new RuntimeException("failed");
}
```

Cause hilang.

Lebih baik:

```java
catch (SQLException e) {
    throw new RepositoryFailureException("CASE_DB_FAILURE", "Failed to save case", e);
}
```

### 21.5 Error String Parsing

```java
if (errorMessage.contains("already exists")) {
    // conflict
}
```

Gunakan code/type.

### 21.6 Exception for Normal Branch

```java
try {
    policy.ensureEligible(applicant);
    approve();
} catch (NotEligibleException e) {
    reject(e.reason());
}
```

Jika ineligibility adalah outcome normal, lebih baik:

```java
EligibilityResult result = policy.evaluate(applicant);
```

### 21.7 Boolean Failure Return

```java
boolean submit(CaseId id);
```

Apa arti `false`?

Lebih baik:

```java
SubmitCaseResult submit(CaseId id);
```

### 21.8 Null as Error

```java
Case load(CaseId id) {
    return null;
}
```

Lebih baik:

```java
Optional<Case> findById(CaseId id);
```

Atau:

```java
Case getRequired(CaseId id) throws CaseNotFoundException;
```

### 21.9 Log and Throw Everywhere

```java
catch (Exception e) {
    log.error("failed", e);
    throw e;
}
```

Jika setiap layer log and throw, satu failure menghasilkan banyak stack trace.

Rule:

```text
Log where error is handled or translated with meaningful context.
Do not log repeatedly at every pass-through layer.
```

### 21.10 Stack Trace as API Response

Sangat buruk untuk security dan UX.

### 21.11 Retry All Exceptions

```java
retry(() -> service.call(), Exception.class);
```

Akan retry validation, forbidden, malformed request, programming bug.

Gunakan classification.

### 21.12 `Optional.get()` as Exception Source

```java
Case c = repository.findById(id).get();
```

Lebih baik:

```java
Case c = repository.findById(id)
        .orElseThrow(() -> new CaseNotFoundException(id));
```

### 21.13 Swallow InterruptedException

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

Lebih baik:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException("OPERATION_INTERRUPTED", e);
}
```

### 21.14 Converting All External Errors to 500

```text
429 -> 500
timeout -> 500
not found -> 500
auth failed -> 500
```

Ini membuat client dan operator buta.

### 21.15 Treating Validation as Internal Error

Field invalid bukan incident.

Jangan log validation error sebagai `ERROR` kecuali ada indikasi attack atau bug client serius.

---

## 22. Refactoring Path: Dari Error Chaos ke Error Model

### Step 1 — Inventory Error Sources

Catat semua sumber:

```text
controller parse
request validation
authorization
domain rule
repository
gateway
messaging
file processing
scheduler
batch item
```

### Step 2 — Klasifikasikan Error

Gunakan taxonomy:

```text
validation
domain
application
technical
infrastructure
programming bug
security
```

### Step 3 — Definisikan Error Code Registry Minimal

Mulai dengan 20–40 code yang paling sering.

### Step 4 — Buat Base Exception / Error Descriptor

Jangan terlalu kompleks di awal.

```java
public abstract class AppException extends RuntimeException {
    private final String code;
    private final ErrorCategory category;
}
```

### Step 5 — Buat Translator per Boundary

```text
RepositoryExceptionTranslator
GatewayExceptionTranslator
MessageExceptionClassifier
ApiExceptionMapper
```

### Step 6 — Perbaiki Global Handler

Pastikan:

```text
specific before generic
no stack trace in response
trace id included
status mapping consistent
validation aggregation supported
```

### Step 7 — Hapus String Parsing

Ganti dengan code/type/metadata.

### Step 8 — Tambahkan Tests

Test:

```text
exception translation
problem detail response
sensitive leakage
retry classification
validation aggregation
```

### Step 9 — Observability

Tambahkan structured logging dan metrics berdasarkan code/category.

### Step 10 — Dokumentasikan Error Contract

Masukkan ke API docs dan engineering guidelines.

---

## 23. Case Study: Submit Regulatory Application

### 23.1 Naive Implementation

```java
public Response submit(String applicationId) {
    try {
        Application app = repository.find(applicationId);

        if (app == null) {
            return Response.status(500).entity("not found").build();
        }

        if (!app.status().equals("DRAFT")) {
            return Response.status(500).entity("invalid status").build();
        }

        app.setStatus("SUBMITTED");
        repository.save(app);
        email.send(app.applicantEmail(), "submitted");

        return Response.ok().build();
    } catch (Exception e) {
        e.printStackTrace();
        return Response.status(500).entity(e.getMessage()).build();
    }
}
```

Masalah:

```text
not found jadi 500
invalid state jadi 500
string status
external email failure mungkin rollback ambiguity
e.getMessage bocor
no trace id
no error code
no audit
no retry classification
catch all
```

### 23.2 Improved Domain Model

```java
public sealed interface SubmitApplicationResult
        permits SubmitApplicationResult.Submitted,
                SubmitApplicationResult.Rejected {

    record Submitted(ApplicationId id, Instant submittedAt) implements SubmitApplicationResult {}

    record Rejected(List<RuleViolation> violations) implements SubmitApplicationResult {}
}
```

```java
public SubmitApplicationResult submit(Actor actor, Clock clock) {
    List<RuleViolation> violations = new ArrayList<>();

    if (status != ApplicationStatus.DRAFT) {
        violations.add(new RuleViolation("APPLICATION_INVALID_STATE", "Only draft application can be submitted"));
    }

    if (!documents.hasRequiredDocuments()) {
        violations.add(new RuleViolation("DOCUMENT_REQUIRED", "Required document is missing"));
    }

    if (!violations.isEmpty()) {
        return new SubmitApplicationResult.Rejected(violations);
    }

    this.status = ApplicationStatus.SUBMITTED;
    this.submittedAt = Instant.now(clock);

    return new SubmitApplicationResult.Submitted(id, submittedAt);
}
```

### 23.3 Application Service

```java
public SubmitApplicationResponse submit(SubmitApplicationCommand command) {
    ApplicationId id = new ApplicationId(command.applicationId());

    Application app = repository.findById(id)
            .orElseThrow(() -> new NotFoundException("APPLICATION_NOT_FOUND", "Application not found"));

    authorization.ensureCanSubmit(command.actor(), app);

    SubmitApplicationResult result = app.submit(command.actor(), clock);

    return switch (result) {
        case SubmitApplicationResult.Submitted submitted -> {
            repository.save(app);
            outbox.add(ApplicationSubmittedEvent.from(app));
            yield SubmitApplicationResponse.submitted(submitted.id(), submitted.submittedAt());
        }
        case SubmitApplicationResult.Rejected rejected -> {
            throw new DomainRuleViolationException(
                    "APPLICATION_SUBMISSION_REJECTED",
                    "Application cannot be submitted",
                    rejected.violations()
            );
        }
    };
}
```

### 23.4 API Problem Detail

Rejected:

```json
{
  "type": "https://example.gov/problems/domain-rule-violation",
  "title": "Domain rule violation",
  "status": 422,
  "detail": "Application cannot be submitted.",
  "code": "APPLICATION_SUBMISSION_REJECTED",
  "traceId": "abc-123",
  "violations": [
    {
      "code": "DOCUMENT_REQUIRED",
      "message": "Required document is missing"
    }
  ]
}
```

Not found:

```json
{
  "type": "https://example.gov/problems/not-found",
  "title": "Resource not found",
  "status": 404,
  "detail": "Application not found.",
  "code": "APPLICATION_NOT_FOUND",
  "traceId": "abc-123"
}
```

Repository timeout:

```json
{
  "type": "https://example.gov/problems/service-unavailable",
  "title": "Service unavailable",
  "status": 503,
  "detail": "The request cannot be processed right now. Please try again later.",
  "code": "APPLICATION_REPOSITORY_TIMEOUT",
  "traceId": "abc-123",
  "retryable": true
}
```

---

## 24. Decision Matrix

| Situation | Preferred Model | Reason |
|---|---|---|
| Invalid method argument internal | Exception | Programming contract violation |
| Missing optional resource lookup | Optional | Absence is expected |
| Required resource missing | Exception | Use case cannot continue |
| Domain policy rejects operation | Result or DomainException | Depends whether caller should branch locally |
| Multiple field validation errors | ValidationResult | Need aggregation |
| External service timeout | Exception translated to dependency error | Technical failure, stack trace useful |
| Batch item invalid | Item-level Result | Continue processing other items |
| Fatal batch infrastructure failure | Exception | Stop batch |
| Unauthorized operation | Exception / decision result | Usually boundary mapped to 403 |
| Retryable dependency failure | Exception with retry classification | Infrastructure handling |
| Unknown commit state | Specialized exception/result | Requires idempotency/compensation |
| API error response | Problem Details | Machine-readable contract |

---

## 25. Design Review Checklist

Gunakan checklist ini saat review error handling:

```text
[ ] Apakah error taxonomy jelas?
[ ] Apakah domain error dibedakan dari technical error?
[ ] Apakah validation bisa mengembalikan multiple violations?
[ ] Apakah exception hierarchy membawa code/category yang stabil?
[ ] Apakah message string tidak dipakai sebagai contract?
[ ] Apakah low-level exception diterjemahkan di boundary yang benar?
[ ] Apakah cause asli dipertahankan untuk debugging?
[ ] Apakah response public tidak membocorkan stack trace/internal detail?
[ ] Apakah HTTP status konsisten?
[ ] Apakah error code documented?
[ ] Apakah retryable/non-retryable jelas?
[ ] Apakah ambiguous failure punya idempotency/compensation strategy?
[ ] Apakah InterruptedException ditangani dengan interrupt restore?
[ ] Apakah global handler tidak berisi business logic?
[ ] Apakah log level sesuai kategori error?
[ ] Apakah metrics memakai label low-cardinality?
[ ] Apakah test mencakup mapping error dan leakage prevention?
[ ] Apakah API client tidak perlu parsing string message?
[ ] Apakah batch/messaging membedakan retry vs DLQ vs business rejection?
```

---

## 26. Common Staff-Level Discussion

### 26.1 “Apakah semua domain error harus exception?”

Tidak.

Jika failure adalah outcome normal yang caller harus proses eksplisit, gunakan `Result` atau sealed outcome.

Jika failure menghentikan use case dan akan dikonversi di boundary, exception bisa lebih sederhana.

### 26.2 “Apakah checked exception masih berguna?”

Masih, terutama di API rendah/library ketika caller dekat dengan sumber error dan recovery meaningful.

Namun di application/domain layer besar, checked exception sering menjadi noise jika semua caller hanya meneruskan.

### 26.3 “Apakah global exception handler cukup?”

Tidak.

Global handler hanya mapping terakhir. Error semantics harus dibangun sejak domain, application, repository, gateway, dan messaging boundary.

### 26.4 “Apakah 500 selalu buruk?”

Tidak.

500 tepat untuk unexpected internal failure. Yang buruk adalah menjadikan semua error 500.

### 26.5 “Apakah stack trace harus selalu dilog?”

Tidak.

Untuk validation/domain rejection normal, stack trace biasanya noise.

Untuk internal bug/infrastructure failure, stack trace penting.

### 26.6 “Apakah Result membuat code terlalu verbose?”

Bisa.

Gunakan Result untuk domain decision penting, bukan semua repository/service call.

### 26.7 “Apakah exception mahal secara performance?”

Exception lebih mahal daripada normal branch, terutama karena stack trace. Namun untuk exceptional failure, biaya ini biasanya acceptable. Masalah utama bukan performance, tetapi semantic misuse.

---

## 27. Mini Pattern Language untuk Error Handling

Gunakan pattern berikut sebagai bahasa internal tim:

```text
Exception Translation
Problem Details
Validation Aggregation
Domain Result
Error Code Registry
Retry Classification
Failure Phase
Safe Public Message
Structured Error Logging
Error Contract Test
Poison Message Classification
```

Dengan bahasa ini, diskusi code review menjadi lebih matang.

Daripada berkata:

```text
Ini error handling-nya jelek.
```

Lebih baik:

```text
Repository masih membocorkan SQL exception ke application layer.
Kita butuh exception translation di persistence boundary.
Error code juga belum stabil karena client saat ini bergantung pada message string.
```

---

## 28. Summary

Error handling adalah bagian inti dari desain sistem.

Prinsip utama:

1. Error harus diklasifikasikan sebelum diimplementasikan.
2. Domain error berbeda dari technical error.
3. Exception bukan selalu salah; Result bukan selalu benar.
4. Gunakan exception untuk invariant breach, technical failure, dan boundary escape.
5. Gunakan Result untuk domain decision yang normal dan perlu exhaustive handling.
6. Gunakan validation aggregation untuk input error yang banyak.
7. Translate low-level exception di boundary yang benar.
8. Jangan jadikan message string sebagai contract.
9. API error harus structured, machine-readable, dan aman.
10. Retryability harus eksplisit.
11. Ambiguous failure butuh idempotency atau compensation strategy.
12. Logging, metrics, tracing, dan audit harus mendukung error model.
13. Anti-pattern error handling sering terlihat sederhana, tetapi merusak debuggability dan correctness dalam jangka panjang.

Mental model terakhir:

```text
Error handling yang baik bukan membuat sistem tidak pernah gagal.
Error handling yang baik membuat failure tetap terklasifikasi, aman, observable, bisa diputuskan, dan bisa dipertanggungjawabkan.
```

---

## 29. Referensi Lanjut

- RFC 9457 — Problem Details for HTTP APIs
- Java SE 25 API — `Throwable`, `Exception`, `RuntimeException`
- Effective Java — exception best practices
- Enterprise Application Architecture patterns — exception translation, data source boundary, domain/application layering
- Release It! — stability, timeout, retry, circuit breaker, operational failure thinking
- Domain-Driven Design — domain invariant, repository, service, aggregate boundary
- Enterprise Integration Patterns — messaging error handling, dead letter, retry, idempotency

---

## 30. Status Seri

```text
Part 21 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
22-concurrency-immutability-confinement-guarded-suspension.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./20-dto-mapper-assembler-presenter-view-model-boundary.md">⬅️ Part 20 — DTO, Mapper, Assembler, Presenter, View Model Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./22-concurrency-immutability-confinement-guarded-suspension.md">Part 22 — Concurrency Pattern I: Immutability, Confinement, Guarded Suspension ➡️</a>
</div>

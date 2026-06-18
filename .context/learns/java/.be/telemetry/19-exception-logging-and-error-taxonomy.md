# Part 19 — Exception Logging and Error Taxonomy

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Module: Java Logging, Observability, Profiling, and Troubleshooting  
Range: Java 8–25  
Focus: exception semantics, error classification, diagnostic logging, trace/span error correlation, production troubleshooting

---

## 0. Tujuan Bagian Ini

Bagian ini membahas salah satu area yang paling sering membuat sistem Java sulit didiagnosis: **exception logging**.

Banyak engineer bisa menulis:

```java
try {
    service.process(request);
} catch (Exception e) {
    log.error("Error processing request", e);
}
```

Tetapi engineer yang matang tidak berhenti di sana. Mereka bertanya:

1. Error ini **expected** atau **unexpected**?
2. Error ini berasal dari user, state, dependency, infrastructure, concurrency, atau bug?
3. Apakah operation ini boleh di-retry?
4. Apakah error ini harus memunculkan alert?
5. Apakah stack trace perlu dicatat di sini, atau sudah dicatat di boundary lain?
6. Apakah log ini mengandung data sensitif?
7. Apakah error ini bisa dikorelasikan dengan trace, request, tenant, job, message, dan workflow instance?
8. Apakah error response untuk client harus sama dengan internal error detail?
9. Apakah error ini mempengaruhi SLO atau hanya noise?
10. Apakah log ini membantu diagnosis dalam 3 menit pertama incident?

Exception logging bukan hanya tentang mencetak stack trace. Exception logging adalah desain **error evidence**.

Tujuan akhir bagian ini:

- Membedakan exception sebagai control-flow signal, failure signal, dan defect signal.
- Mendesain taxonomy error yang konsisten untuk Java service.
- Menentukan level logging yang benar untuk berbagai error.
- Menghindari duplicate stack trace dan log storm.
- Menghubungkan exception logging dengan OpenTelemetry traces/logs/metrics.
- Membuat error model yang cocok untuk enterprise/backend/regulatory workflows.
- Menulis exception log yang aman, queryable, dan actionable.

---

## 1. Mental Model: Exception Is Not Always Error

Di Java, `Exception` sering dianggap otomatis sebagai “error”. Ini framing yang buruk.

Exception adalah **mekanisme representasi exceptional control flow**. Tetapi “exceptional” di level bahasa tidak selalu berarti “incident” di level sistem.

Contoh:

```java
throw new ValidationException("postalCode is invalid");
```

Ini mungkin exception di code, tetapi bukan incident. User mengirim input salah.

Contoh lain:

```java
throw new SQLRecoverableException("IO Error: Connection reset");
```

Ini bisa berarti dependency issue, network issue, database restart, atau connection pool problem.

Contoh lain:

```java
throw new NullPointerException("Cannot invoke ... because x is null");
```

Ini biasanya defect signal.

Jadi taxonomy awal:

| Category | Meaning | Usually Alert? | Usually Stack Trace? |
|---|---|---:|---:|
| User/input error | Client/user memberi input invalid | No | No |
| Business rule rejection | State/domain rule menolak action | No, kecuali spike | No |
| Authorization/authentication error | Principal tidak valid/tidak berhak | Maybe security metric | Usually no |
| Expected conflict | Duplicate, stale version, invalid state transition | No, kecuali spike | No |
| Dependency failure | DB/API/cache/queue failure | Maybe | Yes at boundary |
| Infrastructure failure | network, DNS, disk, container, thread | Yes | Yes |
| Programming defect | NPE, illegal state, class cast, assertion failure | Yes | Yes |
| Data corruption/invariant violation | state impossible, referential issue | Yes | Yes |
| Timeout/cancellation | operation exceeded deadline | Depends | Often yes with context |
| Resource exhaustion | pool, memory, threads, disk | Yes | Yes |
| Security suspicious event | brute force, tampering, injection | Security alert | Context, not secrets |

Top-tier engineer tidak bertanya “exception ini log level apa?”. Mereka bertanya:

> Apa meaning dari exception ini dalam runtime system?

---

## 2. Throwable Hierarchy: What Java Gives You, and What It Does Not

Java menyediakan hierarchy:

```text
Throwable
├── Error
│   ├── OutOfMemoryError
│   ├── StackOverflowError
│   ├── NoClassDefFoundError
│   └── ...
└── Exception
    ├── RuntimeException
    │   ├── NullPointerException
    │   ├── IllegalArgumentException
    │   ├── IllegalStateException
    │   └── ...
    └── checked exceptions
        ├── IOException
        ├── SQLException
        └── ...
```

Ini membantu, tetapi tidak cukup.

Java hierarchy menjawab:

- Apakah throwable checked atau unchecked?
- Apakah throwable termasuk severe VM-level `Error`?
- Apakah caller dipaksa handle?

Tetapi hierarchy ini tidak menjawab:

- Apakah retriable?
- Apakah user-caused?
- Apakah alert-worthy?
- Apakah safe untuk expose ke client?
- Apakah perlu stack trace?
- Apakah dependency-specific?
- Apakah melanggar domain invariant?
- Apakah mempengaruhi SLO?

Karena itu, production system butuh **application error taxonomy** di atas Java exception hierarchy.

---

## 3. Checked vs Unchecked: Logging Perspective

### 3.1 Checked exception

Checked exception sering muncul untuk IO, SQL, network, parsing, dan integration boundary.

Contoh:

```java
try {
    objectMapper.readValue(json, Request.class);
} catch (JsonProcessingException e) {
    throw new InvalidPayloadException("Invalid JSON payload", e);
}
```

Checked exception cocok saat caller memang diharapkan mengambil keputusan recovery.

Tetapi di modern enterprise Java, banyak checked exception dibungkus menjadi domain/application exception agar service layer tidak bocor detail implementation.

### 3.2 Unchecked exception

Unchecked exception sering dipakai untuk:

- programming defect,
- invalid state,
- precondition violation,
- domain rejection,
- dependency failure wrapper,
- framework exceptions.

Contoh:

```java
throw new CaseAlreadyClosedException(caseId);
```

Unchecked bukan berarti fatal. Bisa saja expected business rejection.

### 3.3 Error

`Error` biasanya tidak untuk business handling.

Contoh:

- `OutOfMemoryError`,
- `StackOverflowError`,
- `NoClassDefFoundError`,
- `ExceptionInInitializerError`,
- `LinkageError`.

Secara umum, jangan membuat policy recovery kompleks untuk `Error` kecuali pada boundary sangat spesifik. Banyak `Error` menunjukkan JVM/application dalam kondisi tidak reliable.

---

## 4. Error Taxonomy untuk Java Backend

Kita butuh taxonomy yang operationally useful.

Salah satu taxonomy production-grade:

```text
ApplicationError
├── CLIENT_INPUT
├── BUSINESS_RULE
├── AUTHENTICATION
├── AUTHORIZATION
├── STATE_CONFLICT
├── IDEMPOTENCY_CONFLICT
├── RATE_LIMITED
├── DEPENDENCY_TIMEOUT
├── DEPENDENCY_UNAVAILABLE
├── DEPENDENCY_REJECTED
├── DATA_ACCESS
├── DATA_INTEGRITY
├── CONCURRENCY_CONFLICT
├── RESOURCE_EXHAUSTED
├── CONFIGURATION
├── SECURITY_SUSPICIOUS
├── PROGRAMMING_DEFECT
└── UNKNOWN
```

Setiap category sebaiknya punya metadata:

| Field | Meaning |
|---|---|
| `error.category` | kategori utama |
| `error.code` | kode stabil untuk query dan client mapping |
| `error.reason` | reason machine-readable |
| `error.retriable` | apakah retry mungkin berhasil |
| `error.expected` | apakah termasuk expected path |
| `error.owner` | application, user, dependency, infra, unknown |
| `error.http_status` | mapping response jika HTTP |
| `error.alertable` | apakah layak alert langsung |
| `error.safe_message` | pesan aman untuk client |
| `error.internal_message` | pesan internal diagnostic |

Contoh:

```json
{
  "error.category": "STATE_CONFLICT",
  "error.code": "CASE_ALREADY_CLOSED",
  "error.reason": "case_closed",
  "error.expected": true,
  "error.retriable": false,
  "error.owner": "user_or_business_state",
  "http.response.status_code": 409
}
```

---

## 5. Error Category Detail

### 5.1 CLIENT_INPUT

Input client invalid.

Examples:

- invalid JSON,
- missing mandatory field,
- invalid email format,
- postal code invalid,
- date range invalid,
- unsupported enum.

Usually:

- HTTP 400,
- log level `DEBUG` or `INFO` depending business importance,
- no stack trace,
- metric counter yes,
- alert only if spike/anomaly.

Bad:

```java
log.error("Validation failed", e);
```

Better:

```java
log.info("request.validation_failed field={} reason={} correlation_id={}",
        "postalCode",
        "invalid_format",
        correlationId);
```

Structured version:

```java
log.atInfo()
   .setMessage("request.validation_failed")
   .addKeyValue("error.category", "CLIENT_INPUT")
   .addKeyValue("error.code", "INVALID_POSTAL_CODE")
   .addKeyValue("validation.field", "postalCode")
   .addKeyValue("validation.reason", "invalid_format")
   .log();
```

### 5.2 BUSINESS_RULE

Request valid secara teknis tetapi ditolak domain rule.

Examples:

- application not eligible for renewal,
- appeal submission window closed,
- cannot approve own request,
- document type not allowed for case stage.

Usually:

- HTTP 400/403/409/422 depending API style,
- no stack trace,
- log as business outcome,
- audit may be needed if regulatory action.

```java
log.atInfo()
   .setMessage("case.action_rejected")
   .addKeyValue("error.category", "BUSINESS_RULE")
   .addKeyValue("error.code", "APPROVAL_NOT_ALLOWED_BY_ROLE")
   .addKeyValue("case.id", caseId)
   .addKeyValue("case.state", currentState)
   .addKeyValue("action", "approve")
   .addKeyValue("outcome", "rejected")
   .log();
```

### 5.3 AUTHENTICATION

Identity tidak valid atau tidak bisa diverifikasi.

Examples:

- missing token,
- expired token,
- invalid signature,
- unknown issuer,
- session expired.

Usually:

- HTTP 401,
- no stack trace untuk normal auth failure,
- security metric yes,
- security log for suspicious patterns,
- do not log full token.

### 5.4 AUTHORIZATION

Identity valid tetapi tidak punya permission.

Examples:

- user lacks role,
- user cannot access tenant/case,
- maker-checker violation.

Usually:

- HTTP 403,
- no stack trace,
- security log/audit depending sensitivity,
- include actor and resource identifiers only if allowed by policy.

### 5.5 STATE_CONFLICT

Request bertentangan dengan current state.

Examples:

- case already closed,
- application already submitted,
- version mismatch,
- action invalid for current state.

Usually:

- HTTP 409,
- no stack trace,
- valuable for workflow observability.

### 5.6 IDEMPOTENCY_CONFLICT

Duplicate or conflicting request identity.

Examples:

- same idempotency key with different payload,
- duplicate submit button,
- retry after timeout creates duplicate mutation attempt.

Usually:

- HTTP 409 or cached previous response,
- log event with idempotency key hash, not raw if sensitive,
- no stack trace unless invariant violated.

### 5.7 DEPENDENCY_TIMEOUT

External call exceeded deadline.

Examples:

- DB query timeout,
- HTTP read timeout,
- queue publish timeout,
- cache timeout.

Usually:

- WARN for isolated,
- ERROR if operation failed and affects user/business,
- stack trace at boundary,
- include timeout type and configured timeout.

```java
log.atWarn()
   .setMessage("dependency.timeout")
   .addKeyValue("error.category", "DEPENDENCY_TIMEOUT")
   .addKeyValue("dependency.name", "onemap")
   .addKeyValue("dependency.operation", "postal_code_lookup")
   .addKeyValue("timeout.ms", 3000)
   .addKeyValue("attempt", attempt)
   .setCause(e)
   .log();
```

### 5.8 DEPENDENCY_UNAVAILABLE

Dependency unavailable or connection failed.

Examples:

- connection refused,
- DNS failure,
- TLS handshake failure,
- DB listener unavailable,
- RabbitMQ unavailable.

Usually:

- WARN/ERROR depending impact,
- stack trace once at boundary,
- metric and trace span error.

### 5.9 DATA_ACCESS

Database access failed.

Examples:

- SQL exception,
- connection acquisition failure,
- query timeout,
- pool exhausted,
- transaction failure.

Usually:

- ERROR if request failed,
- include SQL operation name/fingerprint, not raw SQL with PII,
- include pool metrics via metrics, not excessive log fields.

### 5.10 DATA_INTEGRITY

Data invariant violated.

Examples:

- duplicate unique key where impossible,
- foreign key violation,
- missing mandatory reference,
- impossible case state.

Usually:

- ERROR,
- stack trace,
- alert-worthy if not caused by expected concurrency.

### 5.11 CONCURRENCY_CONFLICT

Concurrent update conflict.

Examples:

- optimistic lock failure,
- compare-and-set failure,
- stale version,
- duplicate unique insert racing.

Usually:

- expected in some systems,
- INFO/WARN depending rate,
- no stack trace for normal optimistic lock,
- metric important.

### 5.12 RESOURCE_EXHAUSTED

Resource capacity reached.

Examples:

- DB pool exhausted,
- thread pool queue full,
- heap OOM,
- direct buffer OOM,
- disk full,
- rate limiter saturated.

Usually:

- ERROR,
- alert-worthy,
- include resource name and limits,
- stack trace if useful.

### 5.13 CONFIGURATION

Bad runtime configuration.

Examples:

- missing env var,
- invalid endpoint,
- wrong certificate,
- feature flag inconsistent,
- incompatible provider.

Usually:

- ERROR at startup or first use,
- fail fast if critical,
- no secrets in log.

### 5.14 PROGRAMMING_DEFECT

Bug or broken invariant in code.

Examples:

- NPE,
- ClassCastException,
- IllegalStateException for impossible state,
- IndexOutOfBoundsException,
- assertion failure.

Usually:

- ERROR,
- stack trace,
- alert if user impact,
- fix code, not retry blindly.

---

## 6. Expected vs Unexpected Failure

This distinction is more useful than checked vs unchecked.

### 6.1 Expected failure

Expected failure means system design explicitly acknowledges the condition.

Examples:

- invalid input,
- user not authorized,
- duplicate submission,
- business rule rejection,
- optimistic locking conflict,
- rate limit exceeded.

Expected failure should usually not produce alarming logs.

Bad:

```java
catch (ValidationException e) {
    log.error("Failed", e);
    throw e;
}
```

Better:

```java
catch (ValidationException e) {
    log.atInfo()
       .setMessage("request.rejected")
       .addKeyValue("error.category", "CLIENT_INPUT")
       .addKeyValue("error.code", e.code())
       .addKeyValue("outcome", "rejected")
       .log();
    throw e;
}
```

### 6.2 Unexpected failure

Unexpected failure means the system did not design this as a normal outcome.

Examples:

- NPE,
- DB connection reset,
- impossible state,
- serialization failure for valid object,
- classloading error.

Unexpected failure should preserve diagnostic detail.

```java
catch (RuntimeException e) {
    log.atError()
       .setMessage("case.submit_failed")
       .addKeyValue("error.category", "PROGRAMMING_DEFECT_OR_UNKNOWN")
       .addKeyValue("case.id", caseId)
       .setCause(e)
       .log();
    throw e;
}
```

---

## 7. Retriable vs Non-Retriable

Retry is not a logging decision only. It is a correctness decision.

### 7.1 Retriable errors

Usually retriable:

- transient network failure,
- dependency 503,
- connection reset,
- deadlock victim,
- lock timeout,
- HTTP 429 with retry-after,
- optimistic conflict if operation is designed for retry,
- temporary DNS issue.

### 7.2 Non-retriable errors

Usually non-retriable:

- validation error,
- authorization failure,
- business rule rejection,
- idempotency conflict with different payload,
- unsupported operation,
- malformed request,
- programming defect.

### 7.3 Retry log design

Retry logging is dangerous. It can easily create log storm.

Bad:

```java
for (int i = 0; i < 5; i++) {
    try {
        return client.call();
    } catch (Exception e) {
        log.error("Call failed", e);
    }
}
```

This logs stack trace five times for one logical operation.

Better:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        return client.call();
    } catch (TimeoutException e) {
        if (attempt < maxAttempts) {
            log.atWarn()
               .setMessage("dependency.call_retrying")
               .addKeyValue("dependency.name", "payment-gateway")
               .addKeyValue("attempt", attempt)
               .addKeyValue("max_attempts", maxAttempts)
               .addKeyValue("error.category", "DEPENDENCY_TIMEOUT")
               .log();
            continue;
        }

        log.atError()
           .setMessage("dependency.call_failed_after_retries")
           .addKeyValue("dependency.name", "payment-gateway")
           .addKeyValue("attempt", attempt)
           .addKeyValue("max_attempts", maxAttempts)
           .addKeyValue("error.category", "DEPENDENCY_TIMEOUT")
           .setCause(e)
           .log();
        throw e;
    }
}
```

Guideline:

- intermediate retry: `WARN` without stack trace or with abbreviated cause only;
- final failure: `ERROR` with stack trace;
- success after retry: optionally `INFO` or metric only;
- every retry attempt should be measured by metric, not necessarily logged.

---

## 8. Log Level Decision Model for Exceptions

A practical matrix:

| Scenario | Level | Stack Trace? | Alert? |
|---|---:|---:|---:|
| Validation failed | INFO/DEBUG | No | No |
| Business rule rejected | INFO | No | No |
| Authorization denied | INFO/WARN | No | Maybe security anomaly |
| Authentication failed normal | INFO/DEBUG | No | No |
| Suspicious auth pattern | WARN | No/limited | Security alert maybe |
| Optimistic lock conflict normal | INFO/WARN | No | No unless spike |
| Dependency timeout recovered by retry | WARN | Usually no | Maybe metric-based |
| Dependency timeout final failure | ERROR | Yes | Maybe |
| DB pool exhausted | ERROR | Yes | Yes |
| NPE in request path | ERROR | Yes | Yes if user impact |
| Config missing at startup | ERROR | Yes/clear message | Yes |
| OOM | ERROR if possible | Yes if possible | Yes |
| Deadlock victim retryable | WARN/ERROR final | final yes | Maybe |
| Duplicate request idempotent replay | INFO | No | No |
| Duplicate request conflicting payload | WARN | No | Maybe security/business |

Rule of thumb:

- `ERROR` means someone should eventually investigate if repeated or impactful.
- `WARN` means abnormal but potentially handled/degraded.
- `INFO` means meaningful business/operational outcome.
- `DEBUG/TRACE` means local/deep diagnostic, not normal production signal unless temporarily enabled.

---

## 9. Stack Trace Once Rule

A common Java anti-pattern:

```java
try {
    serviceA.call();
} catch (Exception e) {
    log.error("Service A failed", e);
    throw new ServiceException("Service A failed", e);
}
```

Then upper layer:

```java
try {
    application.submit();
} catch (Exception e) {
    log.error("Submit failed", e);
    throw e;
}
```

Then global handler:

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handle(Exception e) {
    log.error("Unhandled error", e);
    return status(500).build();
}
```

One failure becomes three stack traces. This damages signal-to-noise.

### 9.1 Better principle

Log stack trace at one clear boundary:

- API boundary global exception handler,
- async consumer boundary,
- scheduled job boundary,
- batch job boundary,
- external dependency wrapper boundary,
- process startup boundary.

Internal layers should enrich/wrap exceptions, not repeatedly log them.

### 9.2 Boundary example

Repository layer:

```java
try {
    return jdbc.query(...);
} catch (SQLException e) {
    throw new DataAccessFailure("CASE_QUERY_FAILED", "Failed to load case", e);
}
```

Service layer:

```java
Case c = repository.load(caseId)
    .orElseThrow(() -> new BusinessException("CASE_NOT_FOUND"));
```

HTTP boundary:

```java
@ExceptionHandler(DataAccessFailure.class)
public ResponseEntity<ErrorResponse> handle(DataAccessFailure e) {
    log.atError()
       .setMessage("http.request_failed")
       .addKeyValue("error.category", "DATA_ACCESS")
       .addKeyValue("error.code", e.code())
       .setCause(e)
       .log();

    return ResponseEntity.status(503)
        .body(ErrorResponse.of("SERVICE_UNAVAILABLE"));
}
```

---

## 10. Wrapping Exceptions Without Destroying Evidence

Bad wrapping:

```java
catch (SQLException e) {
    throw new RuntimeException("Failed");
}
```

This loses cause.

Better:

```java
catch (SQLException e) {
    throw new DataAccessFailure("CASE_QUERY_FAILED", "Failed to query case", e);
}
```

Better custom exception:

```java
public final class AppException extends RuntimeException {
    private final ErrorCode code;
    private final ErrorCategory category;
    private final boolean retriable;
    private final boolean expected;

    public AppException(
            ErrorCode code,
            ErrorCategory category,
            boolean retriable,
            boolean expected,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.code = code;
        this.category = category;
        this.retriable = retriable;
        this.expected = expected;
    }

    public ErrorCode code() {
        return code;
    }

    public ErrorCategory category() {
        return category;
    }

    public boolean retriable() {
        return retriable;
    }

    public boolean expected() {
        return expected;
    }
}
```

Do not put sensitive values in exception messages:

Bad:

```java
throw new AuthenticationException("Invalid token: " + token);
```

Better:

```java
throw new AuthenticationException("Invalid access token");
```

---

## 11. Error Code Design

Error code should be stable, queryable, and operationally useful.

Bad:

```text
ERR_001
ERR_002
ERR_003
```

These are opaque.

Better:

```text
CASE_NOT_FOUND
CASE_ALREADY_CLOSED
CASE_INVALID_STATE_TRANSITION
APPLICATION_RENEWAL_WINDOW_CLOSED
DEPENDENCY_ONEMAP_TIMEOUT
DB_CONNECTION_ACQUIRE_TIMEOUT
AUTH_FORBIDDEN_CASE_ACCESS
IDEMPOTENCY_PAYLOAD_MISMATCH
```

### 11.1 Error code properties

Good error code:

- stable across releases,
- not too granular,
- not too generic,
- safe to expose if needed,
- easy to search in logs,
- maps to HTTP/gRPC/UI behavior,
- maps to support/runbook.

### 11.2 Error code registry

Example:

```java
public enum ErrorCode {
    CASE_NOT_FOUND(ErrorCategory.BUSINESS_RULE, false, true, 404),
    CASE_ALREADY_CLOSED(ErrorCategory.STATE_CONFLICT, false, true, 409),
    CASE_INVALID_STATE_TRANSITION(ErrorCategory.STATE_CONFLICT, false, true, 409),
    DB_CONNECTION_ACQUIRE_TIMEOUT(ErrorCategory.RESOURCE_EXHAUSTED, true, false, 503),
    DEPENDENCY_ONEMAP_TIMEOUT(ErrorCategory.DEPENDENCY_TIMEOUT, true, false, 504),
    UNKNOWN_INTERNAL_ERROR(ErrorCategory.UNKNOWN, false, false, 500);

    private final ErrorCategory category;
    private final boolean retriable;
    private final boolean expected;
    private final int httpStatus;

    ErrorCode(ErrorCategory category, boolean retriable, boolean expected, int httpStatus) {
        this.category = category;
        this.retriable = retriable;
        this.expected = expected;
        this.httpStatus = httpStatus;
    }
}
```

---

## 12. Error Response vs Internal Log

Never assume internal exception message should be client response.

Internal evidence:

```json
{
  "event.name": "case.submit_failed",
  "error.category": "DATA_ACCESS",
  "error.code": "DB_CONNECTION_ACQUIRE_TIMEOUT",
  "db.system": "oracle",
  "db.operation": "case_submit_transaction",
  "pool.name": "main-hikari",
  "trace.id": "...",
  "exception.type": "java.sql.SQLTransientConnectionException"
}
```

Client response:

```json
{
  "errorCode": "SERVICE_TEMPORARILY_UNAVAILABLE",
  "message": "The request could not be completed right now. Please try again later.",
  "correlationId": "..."
}
```

Why separate?

- Internal log may contain implementation detail.
- Client message must be stable and safe.
- Security posture improves.
- Support can use correlation ID to retrieve internal evidence.

---

## 13. Global Exception Handler Pattern

For Spring-style Java backend:

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AppException.class)
    ResponseEntity<ErrorResponse> handleAppException(AppException e, HttpServletRequest request) {
        if (e.expected()) {
            logExpected(e, request);
        } else {
            logUnexpected(e, request);
        }

        return ResponseEntity
                .status(e.code().httpStatus())
                .body(ErrorResponse.safe(e.code(), currentCorrelationId()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> handleUnknown(Exception e, HttpServletRequest request) {
        log.atError()
           .setMessage("http.request_failed")
           .addKeyValue("error.category", "UNKNOWN")
           .addKeyValue("error.code", "UNKNOWN_INTERNAL_ERROR")
           .addKeyValue("http.request.method", request.getMethod())
           .addKeyValue("url.path", request.getRequestURI())
           .setCause(e)
           .log();

        return ResponseEntity
                .status(500)
                .body(ErrorResponse.safe("UNKNOWN_INTERNAL_ERROR", currentCorrelationId()));
    }

    private void logExpected(AppException e, HttpServletRequest request) {
        log.atInfo()
           .setMessage("http.request_rejected")
           .addKeyValue("error.category", e.category().name())
           .addKeyValue("error.code", e.code().name())
           .addKeyValue("error.expected", true)
           .addKeyValue("error.retriable", e.retriable())
           .addKeyValue("http.request.method", request.getMethod())
           .addKeyValue("url.path", request.getRequestURI())
           .log();
    }

    private void logUnexpected(AppException e, HttpServletRequest request) {
        log.atError()
           .setMessage("http.request_failed")
           .addKeyValue("error.category", e.category().name())
           .addKeyValue("error.code", e.code().name())
           .addKeyValue("error.expected", false)
           .addKeyValue("error.retriable", e.retriable())
           .addKeyValue("http.request.method", request.getMethod())
           .addKeyValue("url.path", request.getRequestURI())
           .setCause(e)
           .log();
    }
}
```

Key idea:

- expected exception gets semantic outcome log;
- unexpected exception gets stack trace;
- unknown exception gets defensive generic handling;
- response is safe;
- correlation ID links client/support/internal evidence.

---

## 14. Exception Logging with SLF4J

### 14.1 Classic style

Correct:

```java
log.error("Failed to submit case caseId={}", caseId, e);
```

In SLF4J, a trailing `Throwable` argument is treated as the exception cause by compatible backends.

Incorrect:

```java
log.error("Failed to submit case caseId={} exception={}", caseId, e);
```

This may print `e.toString()` but not full stack trace depending method resolution and argument placement.

### 14.2 Fluent style

```java
log.atError()
   .setMessage("case.submit_failed")
   .addKeyValue("case.id", caseId)
   .addKeyValue("error.category", "DATA_ACCESS")
   .addKeyValue("error.code", "CASE_SUBMIT_DB_FAILURE")
   .setCause(e)
   .log();
```

This is clearer for structured logging.

### 14.3 Avoid exception in message only

Bad:

```java
log.error("Failed: " + e);
```

This loses stack trace.

Better:

```java
log.error("Failed", e);
```

### 14.4 Avoid double logging and rethrowing

Bad:

```java
catch (Exception e) {
    log.error("Failed", e);
    throw e;
}
```

If upper boundary will log, this creates duplicate stack trace.

Better:

```java
catch (SQLException e) {
    throw new DataAccessFailure("CASE_SAVE_FAILED", "Failed to save case", e);
}
```

---

## 15. Exception Fields for Structured Logging

Recommended fields:

```text
error.category
error.code
error.reason
error.expected
error.retriable
error.owner
error.safe_message
exception.type
exception.message
exception.stacktrace
exception.cause.type
exception.root_cause.type
exception.root_cause.message
```

Context fields:

```text
trace.id
span.id
correlation.id
request.id
tenant.id
user.id/hash
case.id
workflow.instance.id
job.execution.id
message.id
dependency.name
dependency.operation
http.request.method
url.path
http.response.status_code
```

Avoid:

```text
password
token
authorization
cookie
session_raw
full_request_body
full_response_body
raw_sql_with_params
card_number
national_id_plain
secret_key
```

---

## 16. OpenTelemetry Error and Exception Correlation

Exception logging should not be isolated from tracing.

When a request fails:

- log event should include `trace.id` and `span.id`,
- active span should record exception if useful,
- span status should reflect failure when operation failed,
- metrics should count error category/code at controlled cardinality.

Example:

```java
Span span = Span.current();

try {
    submitCase(command);
} catch (AppException e) {
    span.setAttribute("error.category", e.category().name());
    span.setAttribute("error.code", e.code().name());

    if (!e.expected()) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR, e.code().name());
    }

    throw e;
}
```

Do not record every expected validation exception as span error. Otherwise traces become noisy and error rate becomes misleading.

### 16.1 Span status rule

A practical rule:

- Request rejected due to client input: span may end with HTTP 400 but not necessarily `ERROR` from service reliability perspective.
- Dependency timeout causing failed operation: span `ERROR`.
- Business rule rejection: usually not span `ERROR`; record outcome attribute.
- Programming defect: span `ERROR`.
- Authorization denied: depends on viewpoint; security event yes, service error no.

---

## 17. Metrics for Exceptions

Exception metrics should be low-cardinality.

Good:

```text
app_errors_total{service="case-service",error_category="DATA_ACCESS",error_code="DB_CONNECTION_ACQUIRE_TIMEOUT"}
```

Careful:

```text
app_errors_total{exception_message="ORA-00001 unique constraint SYS_C001928 violated for CASE_ID=123"}
```

Bad because message can be high-cardinality and sensitive.

Recommended dimensions:

- service,
- environment,
- operation,
- error category,
- error code,
- expected/unexpected,
- retriable,
- dependency name if applicable.

Avoid dimensions:

- user id,
- case id,
- request id,
- trace id,
- exception message,
- raw URL with IDs,
- SQL text.

---

## 18. Domain Exceptions for Workflow/State Machine Systems

For systems with state transitions, case management, enforcement lifecycle, or regulatory workflows, exception taxonomy must capture state semantics.

Examples:

```text
CASE_NOT_FOUND
CASE_ALREADY_CLOSED
CASE_STATE_VERSION_CONFLICT
CASE_ACTION_NOT_ALLOWED_FROM_CURRENT_STATE
CASE_ASSIGNEE_REQUIRED
CASE_ESCALATION_RULE_FAILED
CASE_DECISION_REQUIRES_REVIEW
CASE_LEGAL_HOLD_ACTIVE
CASE_AUDIT_EVENT_WRITE_FAILED
```

State transition failure log:

```java
log.atInfo()
   .setMessage("case.transition_rejected")
   .addKeyValue("error.category", "STATE_CONFLICT")
   .addKeyValue("error.code", "CASE_ACTION_NOT_ALLOWED_FROM_CURRENT_STATE")
   .addKeyValue("case.id", caseId)
   .addKeyValue("state.from", currentState)
   .addKeyValue("transition.action", action)
   .addKeyValue("actor.role", actorRole)
   .addKeyValue("outcome", "rejected")
   .log();
```

Unexpected invariant violation:

```java
log.atError()
   .setMessage("case.invariant_violated")
   .addKeyValue("error.category", "DATA_INTEGRITY")
   .addKeyValue("error.code", "CASE_APPROVED_WITHOUT_REQUIRED_DOCUMENT")
   .addKeyValue("case.id", caseId)
   .addKeyValue("case.state", state)
   .setCause(e)
   .log();
```

The first is expected rejection. The second is potential system defect or data corruption.

---

## 19. Dependency Exception Mapping

Do not leak vendor-specific exception types across the whole application.

Bad:

```java
public Case load(String caseId) throws SQLException
```

Better:

```java
public Case load(String caseId) {
    try {
        return jdbcTemplate.queryForObject(...);
    } catch (QueryTimeoutException e) {
        throw new AppException(
            ErrorCode.DB_QUERY_TIMEOUT,
            ErrorCategory.DEPENDENCY_TIMEOUT,
            true,
            false,
            "Case query timed out",
            e
        );
    } catch (DataAccessException e) {
        throw new AppException(
            ErrorCode.DB_QUERY_FAILED,
            ErrorCategory.DATA_ACCESS,
            true,
            false,
            "Case query failed",
            e
        );
    }
}
```

External HTTP mapping:

| Dependency response | Internal category | Retriable? |
|---|---|---:|
| 400 | DEPENDENCY_REJECTED / CONTRACT_ERROR | No |
| 401/403 | CONFIGURATION / AUTH_TO_DEPENDENCY | Usually no |
| 404 | Depends on operation | Usually no |
| 408 | DEPENDENCY_TIMEOUT | Maybe |
| 429 | RATE_LIMITED | Yes if retry-after |
| 500 | DEPENDENCY_UNAVAILABLE | Maybe |
| 502/503/504 | DEPENDENCY_UNAVAILABLE/TIMEOUT | Yes |
| connect timeout | DEPENDENCY_TIMEOUT | Yes |
| read timeout | DEPENDENCY_TIMEOUT | Maybe |
| TLS error | CONFIGURATION/DEPENDENCY_UNAVAILABLE | Usually no until fixed |

---

## 20. Timeout Taxonomy

Timeout is not one thing.

| Timeout | Meaning | Common Root Cause |
|---|---|---|
| DNS timeout | name resolution failed/slow | DNS/CoreDNS/network |
| connect timeout | cannot establish connection | dependency down/network/firewall |
| TLS handshake timeout | TLS negotiation slow/failing | cert/network/dependency load |
| connection pool acquire timeout | no connection available | pool exhausted/leak/slow DB |
| read timeout | server did not respond in time | dependency slow/query slow |
| write timeout | client cannot send request | network/backpressure |
| total deadline exceeded | end-to-end budget exceeded | cumulative latency/retry |
| lock wait timeout | DB/concurrency lock contention | long transaction/deadlock risk |
| transaction timeout | transaction exceeded budget | slow operations/locks |

Log timeout with exact type:

```java
log.atWarn()
   .setMessage("dependency.timeout")
   .addKeyValue("error.category", "DEPENDENCY_TIMEOUT")
   .addKeyValue("timeout.type", "connection_pool_acquire")
   .addKeyValue("timeout.ms", 30000)
   .addKeyValue("dependency.name", "oracle")
   .addKeyValue("pool.name", "main-hikari")
   .setCause(e)
   .log();
```

“Timeout” without type is often too vague.

---

## 21. Log Injection and Exception Messages

Exception messages often contain user-controlled input.

Example risk:

```java
throw new IllegalArgumentException("Invalid username: " + username);
```

If username contains newline/control characters, it can forge logs.

Safer:

```java
log.atInfo()
   .setMessage("user.input_invalid")
   .addKeyValue("field", "username")
   .addKeyValue("reason", "invalid_format")
   .log();
```

If logging user input is truly needed:

- sanitize CR/LF/control chars,
- truncate long values,
- mask sensitive parts,
- avoid raw request body,
- prefer hash for identifiers when possible.

---

## 22. Exception Logging in Async, Messaging, and Batch

### 22.1 Messaging consumer boundary

```java
try {
    handler.handle(message);
    acknowledge(message);
} catch (BusinessException e) {
    log.atInfo()
       .setMessage("message.rejected")
       .addKeyValue("error.category", e.category().name())
       .addKeyValue("error.code", e.code().name())
       .addKeyValue("message.id", message.id())
       .addKeyValue("consumer.name", consumerName)
       .log();
    deadLetter(message, e.code());
} catch (Exception e) {
    log.atError()
       .setMessage("message.processing_failed")
       .addKeyValue("error.category", "UNKNOWN")
       .addKeyValue("message.id", message.id())
       .addKeyValue("consumer.name", consumerName)
       .setCause(e)
       .log();
    retryOrDeadLetter(message, e);
}
```

### 22.2 Batch step boundary

```java
try {
    step.execute(chunk);
} catch (Exception e) {
    log.atError()
       .setMessage("batch.chunk_failed")
       .addKeyValue("job.name", jobName)
       .addKeyValue("job.execution.id", executionId)
       .addKeyValue("step.name", stepName)
       .addKeyValue("chunk.index", chunkIndex)
       .addKeyValue("records.count", chunk.size())
       .setCause(e)
       .log();
    throw e;
}
```

Batch logs must include job execution identity, otherwise failures are hard to reconstruct.

---

## 23. Exception Logging in Virtual Threads

Java 21+ virtual threads change concurrency scale.

Implications:

1. More concurrent failures can appear at once.
2. Thread names may be less useful as primary identity.
3. MDC/ThreadLocal works, but many virtual threads can increase context proliferation if careless.
4. Structured context fields are more important than thread name.
5. Exception logs should include request/message/job identity, not rely on thread identity.

Bad mental model:

> I can identify request by thread name.

Better mental model:

> Thread is execution vehicle; correlation ID and trace ID are runtime identity.

---

## 24. Practical Error Model Implementation

### 24.1 Enums

```java
public enum ErrorCategory {
    CLIENT_INPUT,
    BUSINESS_RULE,
    AUTHENTICATION,
    AUTHORIZATION,
    STATE_CONFLICT,
    IDEMPOTENCY_CONFLICT,
    RATE_LIMITED,
    DEPENDENCY_TIMEOUT,
    DEPENDENCY_UNAVAILABLE,
    DEPENDENCY_REJECTED,
    DATA_ACCESS,
    DATA_INTEGRITY,
    CONCURRENCY_CONFLICT,
    RESOURCE_EXHAUSTED,
    CONFIGURATION,
    SECURITY_SUSPICIOUS,
    PROGRAMMING_DEFECT,
    UNKNOWN
}
```

```java
public enum Owner {
    USER,
    BUSINESS_STATE,
    APPLICATION,
    DEPENDENCY,
    INFRASTRUCTURE,
    SECURITY,
    UNKNOWN
}
```

### 24.2 Error descriptor

```java
public record ErrorDescriptor(
        String code,
        ErrorCategory category,
        Owner owner,
        boolean expected,
        boolean retriable,
        int httpStatus,
        String safeMessage
) {
}
```

### 24.3 Exception base

```java
public class DomainException extends RuntimeException {
    private final ErrorDescriptor descriptor;

    public DomainException(ErrorDescriptor descriptor, String internalMessage) {
        super(internalMessage);
        this.descriptor = descriptor;
    }

    public DomainException(ErrorDescriptor descriptor, String internalMessage, Throwable cause) {
        super(internalMessage, cause);
        this.descriptor = descriptor;
    }

    public ErrorDescriptor descriptor() {
        return descriptor;
    }
}
```

### 24.4 Logging helper

```java
public final class ErrorLogger {
    private ErrorLogger() {}

    public static void log(Logger log, String eventName, DomainException e) {
        ErrorDescriptor d = e.descriptor();

        var builder = d.expected() ? log.atInfo() : log.atError();

        builder.setMessage(eventName)
               .addKeyValue("error.category", d.category().name())
               .addKeyValue("error.code", d.code())
               .addKeyValue("error.owner", d.owner().name())
               .addKeyValue("error.expected", d.expected())
               .addKeyValue("error.retriable", d.retriable())
               .addKeyValue("http.response.status_code", d.httpStatus());

        if (!d.expected()) {
            builder.setCause(e);
        }

        builder.log();
    }
}
```

This helper prevents every developer from inventing their own exception logging style.

---

## 25. Anti-Patterns

### 25.1 Catching `Exception` everywhere

```java
catch (Exception e) {
    log.error("Error", e);
    return null;
}
```

This destroys error semantics and creates hidden failure.

### 25.2 Logging and swallowing

```java
catch (Exception e) {
    log.error("Failed", e);
}
```

Unless explicitly intended, this creates false success.

### 25.3 Logging expected validation as ERROR

```java
log.error("User input invalid", e);
```

This pollutes incident signal.

### 25.4 Returning raw exception to client

```java
return ResponseEntity.status(500).body(e.getMessage());
```

This may leak internals.

### 25.5 Rewrapping without cause

```java
throw new RuntimeException("Failed");
```

This loses root cause.

### 25.6 Repeated stack traces for same logical failure

This increases noise and storage cost.

### 25.7 High-cardinality error codes

Bad:

```text
ERROR_USER_123_CASE_456_FAILED
```

Error code must be stable category, not instance-specific.

### 25.8 Misusing exception for normal branch

If every validation branch throws and logs stack traces, system becomes noisy and expensive.

---

## 26. Troubleshooting With Exception Logs

When facing production error spike, ask:

1. Which `error.category` increased?
2. Which `error.code` increased?
3. Is it expected or unexpected?
4. Which operation is affected?
5. Is it global, tenant-specific, user-specific, or dependency-specific?
6. Did deployment/config change happen before spike?
7. Are traces showing one dependency or internal code path?
8. Are metrics showing saturation?
9. Are stack traces identical or diverse?
10. Is this retry amplification?
11. Are there duplicate logs per request?
12. Are error responses aligned with internal logs?

Example query mindset:

```text
error.category:DEPENDENCY_TIMEOUT AND dependency.name:onemap
```

Then split by:

```text
dependency.operation
timeout.type
service.version
k8s.pod.name
http.route
```

If only one pod:

- local resource issue,
- connection pool leak,
- DNS cache issue,
- bad config rollout.

If all pods:

- dependency outage,
- network issue,
- shared DB/API slowdown,
- traffic spike.

---

## 27. Exception Logging Review Checklist

For each exception path:

- Is this expected or unexpected?
- Is error category explicit?
- Is error code stable?
- Is retriable flag correct?
- Is owner clear?
- Is client response safe?
- Is internal log detailed enough?
- Is stack trace logged exactly once?
- Are sensitive values excluded?
- Are trace/correlation IDs present?
- Is metric cardinality controlled?
- Is alerting based on symptoms/impact, not every exception?
- Is retry logging controlled?
- Is exception cause preserved?
- Does the log support incident diagnosis?

---

## 28. Practical Labs

### Lab 1 — Refactor noisy exception logging

Given:

```java
try {
    service.submit(request);
} catch (Exception e) {
    log.error("Error", e);
    throw e;
}
```

Refactor into:

- expected business errors,
- expected validation errors,
- dependency errors,
- unknown errors,
- global exception handler boundary.

### Lab 2 — Build error taxonomy enum

Create:

- `ErrorCategory`,
- `ErrorCode`,
- `ErrorDescriptor`,
- `AppException`,
- `GlobalExceptionHandler`.

### Lab 3 — Trace-log exception correlation

Implement:

- log with `trace.id`,
- span `recordException` only for unexpected failures,
- metrics by `error.category` and `error.code`.

### Lab 4 — Retry logging policy

Create wrapper for dependency calls:

- intermediate retry logs without stack trace,
- final failure with stack trace,
- metric per attempt,
- trace span event per retry.

### Lab 5 — Duplicate stack trace detection

Trigger one failure and check whether logs show exactly one stack trace per logical request.

---

## 29. Production Standard Template

A production exception logging standard can say:

```text
1. Expected client/business errors must not be logged as ERROR.
2. Unexpected failures must include stack trace at exactly one boundary.
3. All logged failures must include error.category and error.code.
4. Dependency failures must include dependency.name, dependency.operation, and timeout/error type where applicable.
5. Retry attempts must not emit full stack trace except final failure.
6. Client responses must expose safe error messages only.
7. Exception messages must not contain secrets, tokens, raw PII, or full request bodies.
8. Logs must include trace.id/correlation.id where request context exists.
9. Metrics must use bounded-cardinality error dimensions.
10. Alerting must be based on user impact, SLO, or abnormal rate, not isolated expected exceptions.
```

---

## 30. Summary

Exception logging is not “print the stack trace”.

It is the discipline of converting failure into evidence:

- semantically accurate,
- operationally useful,
- safe,
- correlated,
- low-noise,
- queryable,
- actionable.

The most important distinctions:

1. Expected vs unexpected.
2. Retriable vs non-retriable.
3. User/business/dependency/infrastructure/application owner.
4. Client-safe response vs internal diagnostic evidence.
5. Stack trace once vs duplicate noise.
6. Error category/code vs arbitrary message.
7. Error signal vs alert signal.

A mature Java system does not merely catch exceptions. It classifies, wraps, records, correlates, and responds to them with intention.

---

## 31. References

- SLF4J Manual — facade, parameterized logging, fluent logging.
- SLF4J `Logger` API documentation — exception/throwable logging and fluent API.
- OpenTelemetry Semantic Conventions — exceptions in logs and error recording guidance.
- OpenTelemetry Java API — span status, exception recording, context correlation.
- OWASP Logging Cheat Sheet — secure logging and sensitive data guidance.
- OWASP Error Handling Cheat Sheet — safe error handling and global handler principles.
- Google SRE Book, Monitoring Distributed Systems — latency, traffic, errors, saturation as high-value operational signals.

---

## 32. Status Seri

Selesai sampai: **Part 19 — Exception Logging and Error Taxonomy**.

Seri belum selesai.

Berikutnya:

**Part 20 — JFR Deep Dive I: Java Flight Recorder Mental Model**.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 18 — Secure Logging: PII, Secrets, Injection, Compliance, Auditability](./18-secure-logging-pii-secrets-injection-compliance-auditability.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 20 — JFR Deep Dive I: Java Flight Recorder Mental Model](./20-jfr-deep-dive-java-flight-recorder-mental-model.md)

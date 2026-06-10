# Strict Coding Standards — Java Error Handling

> **Purpose**: define strict rules for Java exception/error handling so LLM coding agents produce predictable, debuggable, secure, and retry-aware code.
>
> This file is an **overlay standard**. It must be used together with:
>
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_logging.md`
> - `strict-coding-standards__java_telemetry.md`
> - `strict-coding-standards__java_http.md` / `strict-coding-standards__java_grpc.md`
> - persistence/integration-specific standards where applicable

---

## 1. Core Principle

Error handling is part of the system contract.

It must define:

- what failed
- where it failed
- whether the caller can recover
- whether retry is safe
- what user/client should see
- what operator should see
- what should be logged/audited
- what state transition is allowed after failure

LLM agents MUST NOT add `try/catch` merely to silence compilation errors.

---

## 2. Error Taxonomy

Every meaningful failure must fit one category.

### 2.1 Programmer Error

Examples:

- null passed where non-null is required
- illegal enum/state transition due to bug
- impossible branch reached
- broken invariant
- misconfigured dependency injected as null

Default handling:

- use unchecked exception
- fail fast
- do not retry
- log at boundary with diagnostic context
- fix code, not runtime data

Common exception types:

```java
IllegalArgumentException
IllegalStateException
NullPointerException // normally from bug, not intentionally thrown except rare fail-fast cases
AssertionError       // only for impossible internal invariant, not user input
```

### 2.2 Validation/User Input Error

Examples:

- invalid request field
- malformed JSON/XML
- unknown enum value
- field length exceeded
- unsupported file type

Default handling:

- no stack trace to client
- no retry by client without correction
- return field-level errors where appropriate
- HTTP 400/422 depending API policy
- gRPC `INVALID_ARGUMENT`

### 2.3 Authorization/Authentication Error

Examples:

- missing token
- expired token
- insufficient permission
- object belongs to different tenant

Default handling:

- do not leak object existence unless policy allows
- HTTP 401 for unauthenticated, 403 for authenticated but forbidden
- gRPC `UNAUTHENTICATED` or `PERMISSION_DENIED`
- audit security-relevant denial when appropriate

### 2.4 Business Conflict

Examples:

- duplicate case number
- version conflict
- state transition not allowed
- quota exceeded by business rule

Default handling:

- no retry unless state changes externally
- HTTP 409/422 depending API policy
- gRPC `FAILED_PRECONDITION` or `ALREADY_EXISTS`
- expose stable machine-readable error code

### 2.5 Dependency Failure

Examples:

- database unavailable
- Redis timeout
- S3 throttling
- SMTP temporary failure
- Kafka broker unavailable

Default handling:

- classify retryable vs non-retryable
- apply timeout/circuit breaker/retry policy at adapter boundary
- convert to module-level exception
- avoid leaking provider exception to domain/API

### 2.6 Partial Failure

Examples:

- batch item failure
- multi-step workflow failure
- message published but response failed
- database commit succeeded but downstream call failed

Default handling:

- model explicitly
- include item-level result where needed
- use outbox/saga/compensation where appropriate
- never pretend full success

### 2.7 Fatal/System Error

Examples:

- `OutOfMemoryError`
- `StackOverflowError`
- JVM linkage errors
- corrupted process state

Default handling:

- do not catch broadly
- allow process/container supervision to restart where appropriate
- only catch at very high boundary for minimal logging/shutdown if safe

---

## 3. Checked vs Unchecked Exceptions

### 3.1 Checked Exceptions

Use checked exceptions only when:

- caller is expected to recover directly
- recovery action is part of API contract
- exception is stable and meaningful to callers
- forcing handling improves correctness

Examples:

```java
class InvalidImportFileException extends Exception { }
class RecoverableExternalServiceException extends Exception { }
```

Avoid checked exceptions for:

- programmer errors
- every business rule failure
- wrapping every dependency exception
- internal service methods where callers cannot recover

### 3.2 Unchecked Exceptions

Use unchecked exceptions for:

- invariant violations
- programming errors
- invalid state
- business/domain failures handled by boundary mappers
- dependency failures converted at adapter boundary

But unchecked exception does not mean “unimportant”. It still needs taxonomy, message, and mapping.

### 3.3 `Error` Types

Do not create custom subclasses of `Error` for application failures.

Forbidden:

```java
class BusinessError extends Error { }
```

---

## 4. Exception Class Design

### 4.1 Naming

Exception names must describe failure category and owner.

Good:

```java
CaseNotFoundException
CaseVersionConflictException
UnauthorizedCaseAccessException
DocumentStorageUnavailableException
InvalidReportFilterException
```

Bad:

```java
AppException
BaseException
CommonException
BusinessException
SystemException
ProcessException
SomethingWentWrongException
```

Generic base exceptions are allowed only if they carry stable taxonomy and are not used to hide detail.

### 4.2 Required Fields for Domain/Application Exceptions

For meaningful application errors, prefer structured fields:

```java
public final class CaseVersionConflictException extends RuntimeException {
    private final UUID caseId;
    private final long expectedVersion;
    private final long actualVersion;

    public CaseVersionConflictException(UUID caseId, long expectedVersion, long actualVersion) {
        super("Case version conflict: caseId=%s expected=%d actual=%d"
                .formatted(caseId, expectedVersion, actualVersion));
        this.caseId = caseId;
        this.expectedVersion = expectedVersion;
        this.actualVersion = actualVersion;
    }
}
```

Rules:

- include stable machine-readable error code at boundary
- include diagnostic context internally
- never include secrets/PII in exception message
- preserve cause when wrapping

### 4.3 Preserve Cause

Forbidden:

```java
catch (SQLException e) {
    throw new RepositoryException("Failed");
}
```

Required:

```java
catch (SQLException e) {
    throw new RepositoryException("Failed to load case id=" + caseId, e);
}
```

### 4.4 Do Not Over-Expose Cause

Preserve cause internally, but do not expose raw stack traces/provider messages to clients.

API error response must map to safe code/message.

---

## 5. Catching Rules

### 5.1 Catch Narrowly

Catch the most specific exception that can be handled.

Allowed:

```java
catch (SQLTimeoutException e) { ... }
catch (OptimisticLockException e) { ... }
catch (JsonProcessingException e) { ... }
```

Forbidden by default:

```java
catch (Exception e) { ... }
catch (Throwable t) { ... }
```

`catch (Exception)` is allowed only at top-level boundary such as:

- HTTP exception mapper fallback
- worker/message listener boundary
- scheduler boundary
- CLI command boundary
- batch job boundary

and it must log/map/terminate deterministically.

### 5.2 Never Swallow Exceptions

Forbidden:

```java
try {
    doWork();
} catch (Exception ignored) {
}
```

Allowed only with explicit comment and safe reason:

```java
try {
    cleanupTempFile(path);
} catch (IOException cleanupFailure) {
    log.warn("Failed to delete temporary file path={}", path, cleanupFailure);
}
```

### 5.3 Do Not Catch and Continue Incorrectly

Forbidden:

```java
for (Item item : items) {
    try {
        process(item);
    } catch (Exception e) {
        log.error("failed", e);
    }
}
return Success;
```

If partial failure is acceptable, return partial result and item-level failures.

### 5.4 Do Not Use Exceptions for Normal Control Flow

Forbidden:

```java
try {
    return map.get(key).toString();
} catch (NullPointerException e) {
    return "";
}
```

Use explicit condition.

---

## 6. Throwing Rules

### 6.1 Message Quality

Exception message must include enough diagnostic context:

Good:

```java
throw new IllegalStateException(
    "Cannot approve case: caseId=%s currentState=%s".formatted(caseId, state));
```

Bad:

```java
throw new RuntimeException("error");
throw new RuntimeException("failed");
throw new RuntimeException("not valid");
```

### 6.2 No Secrets in Messages

Forbidden in exception messages:

- password
- token
- API key
- session id
- full authorization header
- private key
- OTP
- secret config value
- full PII where not needed

Use redaction.

### 6.3 Do Not Throw Generic `RuntimeException`

Forbidden in domain/application code:

```java
throw new RuntimeException("case failed");
```

Allowed only in test scaffolding or very temporary code that must not be committed.

### 6.4 Do Not Throw Framework Exceptions from Domain

Forbidden:

```java
throw new ResponseStatusException(HttpStatus.NOT_FOUND);
throw new WebApplicationException(404);
throw new StatusRuntimeException(Status.NOT_FOUND);
```

inside domain/application core.

Map domain/application errors to framework errors at adapter boundary.

---

## 7. Boundary Mapping Rules

### 7.1 HTTP Mapping

Default mapping:

| Failure                         |                         HTTP |
| ------------------------------- | ---------------------------: |
| malformed request               |                          400 |
| validation error                |     400 or 422 by API policy |
| unauthenticated                 |                          401 |
| forbidden                       |                          403 |
| not found                       |                          404 |
| conflict/version/state conflict |                          409 |
| unsupported media type          |                          415 |
| rate limit                      |                          429 |
| dependency unavailable          |                          503 |
| timeout                         | 504 or 503 by gateway policy |
| internal bug/unclassified       |                          500 |

HTTP API errors SHOULD use stable problem/error format such as RFC 9457 Problem Details where project policy allows.

Required fields:

```json
{
  "type": "https://errors.example.com/case-version-conflict",
  "title": "Case version conflict",
  "status": 409,
  "detail": "The case was modified by another request.",
  "errorCode": "CASE_VERSION_CONFLICT",
  "traceId": "..."
}
```

Do not include raw stack trace in response.

### 7.2 gRPC Mapping

Default mapping:

| Failure                   | gRPC status           |
| ------------------------- | --------------------- |
| validation                | `INVALID_ARGUMENT`    |
| unauthenticated           | `UNAUTHENTICATED`     |
| forbidden                 | `PERMISSION_DENIED`   |
| not found                 | `NOT_FOUND`           |
| duplicate                 | `ALREADY_EXISTS`      |
| state conflict            | `FAILED_PRECONDITION` |
| version conflict          | `ABORTED`             |
| dependency unavailable    | `UNAVAILABLE`         |
| timeout/deadline          | `DEADLINE_EXCEEDED`   |
| internal bug/unclassified | `INTERNAL`            |

Use structured error details if project supports it.

### 7.3 Message Consumer Mapping

Message listener boundaries must classify failure into:

- ack success
- retry later
- DLQ/parking lot
- poison message reject
- stop consumer/process

Rules:

- do not infinite-loop poison messages
- preserve original message metadata
- include failure reason/code
- ensure idempotent processing
- avoid acknowledging before durable side effect unless design says so

---

## 8. Retryability Rules

A failure is retryable only if all are true:

- operation is idempotent or has idempotency key
- failure is transient or unknown transient
- retry policy has bounded attempts/time
- retry does not violate ordering/state assumptions
- downstream can handle retry load

Retryable examples:

- connection timeout
- HTTP 503/504/429 with policy
- SQL transient connection exception
- optimistic conflict when use case supports reload/retry
- temporary SMTP 4xx response

Non-retryable examples:

- validation error
- authorization denial
- malformed request
- duplicate unique key if operation lacks idempotency key
- permanent SMTP 5xx for invalid address
- non-idempotent payment/approval without idempotency key

Forbidden:

```java
for (int i = 0; i < 3; i++) {
    try { return client.post(request); }
    catch (Exception e) { }
}
```

Required:

- bounded retry
- backoff/jitter
- retryable classification
- observability counter/span events
- idempotency proof

---

## 9. Transaction and Error Handling

### 9.1 Rollback Rules

Transaction boundary must define which exceptions rollback.

For Spring:

- unchecked exceptions rollback by default
- checked exceptions do not rollback unless configured

LLM agents MUST not introduce checked exceptions across transactional boundaries without checking rollback behavior.

### 9.2 External Calls Inside Transaction

Forbidden by default:

```java
@Transactional
void approve() {
    repository.save(caseFile);
    externalHttpClient.notify(...); // slow external I/O inside DB transaction
}
```

Prefer:

- transaction commits state/outbox
- outbox publisher sends after commit
- saga/process manager coordinates

### 9.3 Partial Commit Awareness

When failure occurs after commit, do not pretend rollback happened.

Document recovery/compensation.

---

## 10. Resource Cleanup Rules

Use `try-with-resources` for resources:

- streams
- readers/writers
- channels
- JDBC connection/statement/result set when manually managed
- `Response`/body objects that require close
- temporary file handles

Forbidden:

```java
InputStream in = file.openStream();
process(in);
in.close();
```

Required:

```java
try (InputStream in = file.openStream()) {
    process(in);
}
```

Cleanup failure should be logged only if actionable.

---

## 11. Async/Concurrent Error Handling

### 11.1 Executor Tasks

Never submit tasks without error observation.

Forbidden:

```java
executor.submit(() -> doWork()); // Future ignored
```

Required:

- inspect `Future`
- use structured task supervision where available and allowed
- install uncaught exception handler where appropriate
- log boundary failures with context

### 11.2 CompletableFuture

Every `CompletableFuture` pipeline must define error handling or be returned to caller.

Forbidden:

```java
CompletableFuture.runAsync(this::sendEmail);
```

Required:

```java
CompletableFuture.runAsync(this::sendEmail, executor)
    .whenComplete((ignored, failure) -> {
        if (failure != null) {
            log.error("Email sending failed messageId={}", messageId, failure);
        }
    });
```

### 11.3 Interruption

Do not swallow `InterruptedException`.

Required:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new OperationInterruptedException("Interrupted while waiting for worker", e);
}
```

Forbidden:

```java
catch (InterruptedException ignored) { }
```

---

## 12. Logging Rules

### 12.1 Log Once at Boundary

Do not log the same exception repeatedly at every layer.

Good:

- lower layer wraps with context
- boundary logs final failure once

Bad:

- repository logs
- service logs
- controller logs
- global handler logs same stack trace again

### 12.2 Log Level

| Situation                             | Level                           |
| ------------------------------------- | ------------------------------- |
| expected validation failure           | debug or no log                 |
| authz denial                          | audit/security policy dependent |
| dependency timeout recovered by retry | warn or metric only             |
| request failed due to dependency      | warn/error depending severity   |
| internal bug                          | error                           |
| startup configuration failure         | error/fatal                     |

### 12.3 Required Context

Include:

- correlation/trace id
- operation/use case
- resource id if safe
- tenant id if safe
- external dependency name
- retry attempt if relevant
- error code

Do not include secrets/PII.

---

## 13. Telemetry Rules

For important failure paths, add:

- counter metric by stable error code/category
- span status/error event for traced operation
- dependency latency/timeout metrics
- retry count
- DLQ/poison message count where relevant

Do not use high-cardinality exception messages as metric labels.

Allowed metric labels:

```text
error.category=dependency_timeout
error.code=DOCUMENT_STORAGE_UNAVAILABLE
service=s3
operation=putObject
```

Forbidden labels:

```text
exception.message=Failed for user john@example.com file abc123...
stacktrace=...
```

---

## 14. Validation Error Contract

Validation errors must be structured.

Example:

```json
{
  "errorCode": "VALIDATION_FAILED",
  "fields": [
    { "field": "email", "code": "INVALID_EMAIL" },
    { "field": "amount", "code": "MUST_BE_POSITIVE" }
  ]
}
```

Rules:

- do not return raw validator interpolation if it leaks internals
- field paths must match API contract, not internal entity paths where possible
- batch validation must report item index/key
- validation failures are not server errors

---

## 15. Dependency Error Translation

Adapters must translate provider-specific exceptions.

Example:

```java
try {
    s3.putObject(request, body);
} catch (S3Exception e) {
    throw DocumentStorageException.fromS3(e);
} catch (SdkClientException e) {
    throw new DocumentStorageUnavailableException("S3 client failure", e);
}
```

Rules:

- provider exception must not leak into domain/application API
- preserve provider status/code internally
- map retryability explicitly
- sanitize external message

---

## 16. Persistence Error Handling

### 16.1 Constraint Violations

Database constraint errors should map to stable domain/application conflict where possible.

Examples:

- unique constraint -> duplicate/conflict
- FK violation -> invalid reference/conflict
- optimistic lock -> version conflict
- deadlock/serialization failure -> retryable if operation idempotent

Do not expose raw constraint names to public API unless intentionally stable.

### 16.2 Query Result Absence

Do not use exception-heavy absence handling when optional result is normal.

Preferred:

```java
Optional<CaseFile> findById(CaseId id);
```

Boundary maps absence to 404 or domain rule.

### 16.3 Transaction Conflicts

Optimistic locking conflicts must be handled as business conflict, not generic 500.

---

## 17. Security Error Handling

Rules:

- authentication failure message must not reveal whether account exists unless policy allows
- authorization failure must not leak resource existence across tenant/security boundary
- rate-limit/auth failures should be auditable
- invalid token details should not be returned to attacker
- cryptographic failures must not reveal key/plaintext details

Forbidden:

```text
Password for user alice@example.com is wrong
Token signature failed with secret key id internal-prod-main
Case 123 exists but you cannot access it
```

Safer:

```text
Invalid credentials
Invalid token
Resource not found
```

depending policy.

---

## 18. API Error Code Rules

Stable error codes must be:

- uppercase snake case or project standard
- documented
- versioned if public API requires
- mapped to one category/status
- not generated from exception class name automatically

Good:

```text
CASE_NOT_FOUND
CASE_VERSION_CONFLICT
VALIDATION_FAILED
DOCUMENT_STORAGE_UNAVAILABLE
AUTHORIZATION_DENIED
```

Bad:

```text
RuntimeException
NullPointerException
ERROR_123
UNKNOWN_ERROR_EVERYWHERE
```

---

## 19. Fallback Rules

Fallback is allowed only when degraded behavior is correct and visible.

Allowed examples:

- cache fallback for read-only non-critical data
- default feature flag value with safe default
- queue message for later delivery

Forbidden:

- fallback that pretends a failed write succeeded
- fallback to insecure behavior
- fallback to stale authorization decision unless policy explicitly allows
- fallback that hides data corruption

Every fallback must define:

- freshness bound
- safety rule
- observability signal
- user/client impact

---

## 20. Circuit Breaker and Bulkhead Rules

Circuit breaker is not error handling by itself.

When used:

- define failure types that count
- define timeout
- define fallback or failure response
- expose metrics
- do not wrap validation/business errors as circuit failures

Bulkhead/thread-pool isolation must preserve context propagation and cancellation.

---

## 21. Error Handling Anti-Patterns

Forbidden:

```java
catch (Exception e) { }
```

```java
catch (Exception e) {
    return null;
}
```

```java
catch (Exception e) {
    throw new RuntimeException(e.getMessage());
}
```

```java
catch (Throwable t) {
    log.error("ignored", t);
}
```

```java
throw new RuntimeException("error");
```

```java
return ResponseEntity.ok("failed");
```

```java
log.error("Failed password={}", password, e);
```

```java
retryAllExceptionsForever();
```

```java
@SneakyThrows
void productionCode() { ... }
```

```java
if (error) {
    System.exit(1);
}
```

inside library/server request handling code.

---

## 22. Testing Rules

Error handling must be tested.

Required tests where applicable:

- validation failure shape
- not found mapping
- conflict/optimistic lock mapping
- authorization denial mapping
- dependency timeout mapping
- retryable vs non-retryable behavior
- DLQ/poison handling
- rollback behavior
- no secret leak in logs/error response
- interruption preservation
- partial failure result
- fallback behavior

Do not only test happy path.

---

## 23. Review Checklist

A change touching error handling is acceptable only if:

- failure category is clear
- exception type is specific
- cause is preserved when wrapping
- no secrets/PII leak in message/log/response
- checked vs unchecked choice is justified
- transaction rollback behavior is correct
- retryability is explicit and idempotency-safe
- API mapping is stable and documented
- logs are emitted once at correct boundary
- telemetry uses stable low-cardinality labels
- dependency exceptions are translated at adapter boundary
- async failures are observed
- interruption is preserved
- tests cover negative/failure paths

---

## 24. LLM Prompt Contract

When implementing Java error handling, the LLM agent MUST follow this contract:

```text
Before adding catch/throw/retry/fallback logic:
1. Classify the failure category.
2. Decide whether caller can recover.
3. Decide checked vs unchecked exception.
4. Preserve original cause when wrapping.
5. Define retryability and idempotency requirements.
6. Map to API/message/batch boundary error contract.
7. Ensure no secret/PII leaks.
8. Add negative tests.

Do not catch generic Exception unless this is a top-level boundary.
Do not swallow exceptions.
Do not throw generic RuntimeException for domain/application failure.
Do not expose provider exception directly to public API.
Do not add retry without timeout, max attempts, backoff, and idempotency proof.
```

---

## 25. Source References

Use these as authoritative anchors when updating this standard:

- Java Language Specification — Exceptions
- dev.java / Oracle Java Tutorials — Exceptions
- Java `Throwable`, `Exception`, `RuntimeException`, `Error` API docs
- RFC 9457 — Problem Details for HTTP APIs
- gRPC Status Codes documentation
- OWASP Authentication, Authorization, Logging, and Error Handling guidance
- Project-specific API/error-code standard

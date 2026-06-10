# Strict Coding Standards — Java Logging

> **Purpose**: This document defines mandatory logging standards for Java services and libraries so logs remain useful, safe, structured, searchable, and operationally defensible.
>
> **Audience**: LLM code agents, reviewers, backend developers, SRE/platform engineers, security reviewers, and auditors.
>
> **Compatibility**: Java 11, 17, 21, and 25 projects. Framework-specific examples assume SLF4J-style logging but the rules apply to Logback, Log4j 2, JUL bridges, and platform logging stacks.

---

## 1. Non-Negotiable Contract

All logging code MUST follow these rules:

1. **Do not log secrets or sensitive personal data.**
2. **Use parameterized logging**, not string concatenation.
3. **Every important request/job/event must be correlatable** via trace ID, request ID, job ID, message ID, or domain identifier.
4. **Logs must be structured or structure-compatible**. Free text alone is insufficient for operational events.
5. **Logging must not change program behavior** except for intentional audit/security side effects.
6. **Logging must not introduce expensive computation** when the log level is disabled.
7. **Do not swallow exceptions after logging** unless the failure is intentionally handled.
8. **Do not use `System.out.println` or `printStackTrace()`** in application code.
9. **Do not log untrusted text without log-injection consideration**.
10. **Do not create one-off logging conventions per class**.

---

## 2. Logger API Policy

### 2.1 Application and Library Code

Use a logging facade, preferably SLF4J, unless the project standard says otherwise.

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);
```

### 2.2 Forbidden

```java
System.out.println(value);
System.err.println(value);
e.printStackTrace();
logger.info("user=" + userId);        // string concat
logger.info(String.format("x=%s", x)); // unnecessary formatting when level disabled
```

### 2.3 Allowed Exception Logging

```java
log.warn("payment authorization failed orderId={} provider={} reason={}",
        orderId, provider, reasonCode, exception);
```

The throwable must be the last argument for SLF4J-style APIs.

---

## 3. Log Level Rules

| Level | Use For | Must Not Use For |
|---|---|---|
| TRACE | Very fine-grained diagnostic flow, disabled in production by default. | Business/audit events. |
| DEBUG | Developer diagnostics, request internals, non-sensitive payload metadata. | High-volume production evidence unless sampled. |
| INFO | Important lifecycle/business/operational events. | Per-record spam in loops. |
| WARN | Recoverable abnormal conditions requiring attention. | Expected validation failures on normal user input at high volume. |
| ERROR | Failed operation needing investigation or alerting. | Every handled exception. |

### 3.1 Level Selection Invariant

If the service owner would not search for it during an incident, do not log it at INFO+.

### 3.2 Duplicate Error Logging

An exception should usually be logged once at the boundary where it is handled or converted.

Forbidden pattern:

```java
catch (Exception e) {
    log.error("failed", e);
    throw e; // will be logged again upstream
}
```

Allowed pattern:

```java
catch (ExternalServiceException e) {
    throw new OrderSubmissionException(orderId, e);
}
```

Then log once at the boundary.

---

## 4. Structured Logging Rules

### 4.1 Required Fields for Operational Events

Each important log event should include:

- event name
- outcome/status
- correlation ID / trace ID
- actor/service identity where relevant
- resource/domain ID
- operation name
- duration where relevant
- external dependency name where relevant
- failure class/reason code for failures

Example:

```java
log.info("order.submission.completed orderId={} customerId={} durationMs={} outcome={}",
        orderId, customerId, durationMs, "success");
```

If the logging backend supports JSON/layout structured fields, use structured arguments instead of encoding key-value strings manually.

### 4.2 Event Name Policy

Event names must be stable and searchable:

```text
<domain>.<operation>.<phase>
```

Examples:

- `case.escalation.started`
- `case.escalation.completed`
- `payment.authorization.failed`
- `outbox.publish.retried`

Do not invent poetic messages as primary event identity.

### 4.3 Cardinality Control

Do not put high-cardinality or unbounded values in labels/fields that are indexed aggressively by the log platform unless intentionally approved.

High-risk fields:

- raw URL with query
- raw SQL
- raw user agent
- full exception message from external systems
- request body
- email address
- IP address depending on privacy policy

---

## 5. Correlation and Context

### 5.1 Required Context

Inbound request/job/message boundaries must establish correlation context:

- `traceId` if using OpenTelemetry
- `spanId` where available
- `requestId` or `correlationId`
- `messageId` for async messages
- `tenantId` if multi-tenant and safe to log
- `jobId` for batch jobs

### 5.2 MDC / Thread Context

MDC may be used for per-request context, but must be cleaned up.

```java
try (MDC.MDCCloseable ignored = MDC.putCloseable("requestId", requestId)) {
    handler.handle(request);
}
```

For async, reactive, virtual thread, or executor code, verify context propagation. Do not assume `ThreadLocal`/MDC automatically crosses thread boundaries.

### 5.3 Baggage vs Logs

Do not put sensitive or high-cardinality values into OpenTelemetry baggage just to make them appear in logs.

---

## 6. Security and Privacy Rules

### 6.1 Forbidden Data in Logs

Never log:

- passwords
- password hashes
- session tokens
- access tokens
- refresh tokens
- API keys
- private keys
- raw authorization headers
- cookies
- OTPs
- full payment card numbers
- CVV
- personal identity documents
- biometric data
- decrypted sensitive payloads
- security answers

### 6.2 Restricted Data

Restricted unless explicitly approved and redacted/minimized:

- email address
- phone number
- IP address
- username
- customer ID
- tenant ID
- account ID
- full URL query string
- request/response body
- SQL text
- stack trace in user-visible logs

### 6.3 Redaction

Use centralized redaction/masking utilities. Do not implement one-off masking.

```java
log.info("login.failed usernameHash={} reason={}", hashForLogging(username), reason);
```

Do not use reversible encryption as “masking” for routine logs.

### 6.4 Log Injection

Untrusted input logged as text must not allow forged log lines or terminal control abuse. Sanitize or encode control characters when logs are line-oriented.

At minimum, normalize:

- CR `\r`
- LF `\n`
- tab if parser-sensitive
- ANSI escape sequences if terminal logs are used

---

## 7. Exception Logging Rules

### 7.1 Preserve Stack Trace

Do not log only `e.getMessage()` for unexpected exceptions.

```java
log.error("invoice generation failed invoiceId={}", invoiceId, e);
```

### 7.2 Expected Business Failures

Expected validation/business failures usually log at DEBUG or INFO with reason code, not stack trace.

```java
log.info("order.rejected orderId={} reasonCode={}", orderId, reasonCode);
```

### 7.3 External Dependency Failures

Include dependency, operation, timeout/retry status, and safe error class.

```java
log.warn("dependency.call.failed dependency={} operation={} durationMs={} retryable={} status={}",
        "PaymentGateway", "authorize", durationMs, retryable, statusCode, e);
```

Do not log raw provider response body unless explicitly classified safe.

---

## 8. Audit and Security Logging

Security/audit logs are not normal debug logs. They must be stable, queryable, and protected.

Log security-relevant events such as:

- login success/failure
- logout
- MFA challenge failure
- authorization deny
- privilege changes
- credential changes
- token revocation
- account lock/unlock
- administrative configuration changes
- data export
- high-risk workflow transition
- security validation failure

Audit events must include:

- actor
- action
- target/resource
- outcome
- timestamp from trusted source
- source context when allowed
- correlation ID
- reason code

Never log secrets in audit logs.

---

## 9. Performance Rules

### 9.1 Parameterized Logging

```java
log.debug("computed candidate count={}", candidateCount);
```

For expensive data:

```java
if (log.isDebugEnabled()) {
    log.debug("state dump={}", expensiveStateDump());
}
```

### 9.2 Loop Logging

Do not log inside large loops at INFO+ unless rate-limited or aggregated.

Prefer:

```java
log.info("batch.completed batchId={} total={} success={} failed={} durationMs={}",
        batchId, total, success, failed, durationMs);
```

### 9.3 Async Logging

Async logging is restricted. If used, define:

- queue size
- overflow/drop policy
- shutdown flush behavior
- backpressure behavior
- error handling
- sensitive data redaction before enqueue

---

## 10. Container/Kubernetes Logging

- Application logs should normally go to stdout/stderr in containers.
- Do not write rotating local log files unless platform contract requires it.
- Logs must be parseable by the log collector.
- Multi-line stack traces must be handled by collector configuration or structured logging.
- Include service name, environment, version, and instance/pod metadata via platform enrichment where possible.

---

## 11. Framework Rules

### 11.1 SLF4J

- Use `slf4j-api` in libraries.
- Applications choose the implementation/binding.
- Do not mix multiple logging implementations accidentally.
- Use parameterized messages.

### 11.2 Logback / Log4j 2

- Configuration lives in application/platform layer, not libraries.
- Do not hardcode appenders in code.
- Production config must have redaction policy, level policy, and safe default format.
- Disable overly verbose third-party logs by default.

### 11.3 JUL Bridge

If bridging `java.util.logging`, ensure no duplicate logs and no recursive bridge configuration.

---

## 12. Testing Requirements

Logging-sensitive code must test:

- important event is emitted
- failure path includes reason code
- sensitive values are redacted
- exception is logged at correct boundary
- MDC is cleared after request
- async context propagation where applicable
- no duplicate logging for same exception
- no log injection via CR/LF input

Testing logs should not make tests brittle by asserting full human messages unless the message is the contract. Prefer stable event name/fields.

---

## 13. Anti-Patterns

Forbidden or strongly discouraged:

- `logger.info("entered method")` everywhere
- logging full DTO/request body by default
- logging and rethrowing every exception
- `catch (Exception e) { log.error(...); }` with no handling
- logging secrets then relying on log retention policy
- using logs as a substitute for metrics
- using logs as a substitute for audit tables where strong audit integrity is required
- correlation ID generated differently in every layer
- `System.out.println` debugging committed to code
- per-class custom log formats

---

## 14. Review Checklist

- [ ] No secrets or sensitive payloads logged.
- [ ] Parameterized logging is used.
- [ ] Important events have stable event names.
- [ ] Correlation context is present.
- [ ] Exceptions are logged once at the right boundary.
- [ ] Log levels are appropriate.
- [ ] No expensive log computation when disabled.
- [ ] Untrusted data is sanitized/encoded if line-oriented.
- [ ] MDC/context is cleaned up.
- [ ] Logs are compatible with container/platform collection.
- [ ] Security/audit events are represented explicitly.

---

## 15. LLM Prompt Contract

Before adding or changing logs, the LLM MUST answer:

```text
1. What operational question will this log answer?
2. Is this a debug, operational, security, or audit event?
3. What stable event name should it use?
4. What correlation fields are available?
5. Could any value contain secrets, PII, or untrusted input?
6. What is the correct level?
7. Will this log be too high-volume?
8. Is there already a log at another boundary for this exception?
9. Should this be a metric/trace instead of or in addition to a log?
10. How will this be tested or reviewed?
```

If the log cannot answer a clear operational question, do not add it.

---

## 16. References

- SLF4J Manual: https://www.slf4j.org/manual.html
- SLF4J MDC API: https://www.slf4j.org/api/org/slf4j/MDC.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Logging Vocabulary Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html
- OWASP Top 10 Security Logging and Alerting Failures: https://owasp.org/Top10/
- OpenTelemetry Logs Data Model: https://opentelemetry.io/docs/specs/otel/logs/data-model/

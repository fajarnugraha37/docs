# Strict Coding Standards — Go Logging

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, CLIs, jobs, libraries, background workers, event processors, regulatory/case-management systems  
Baseline: Go 1.21+ structured logging with `log/slog`; compatible with Go 1.24–1.26+ projects

---

## 1. Purpose

Logging is a production evidence stream, not a debugging afterthought.

Every Go implementation MUST produce logs that are:

- structured,
- queryable,
- privacy-safe,
- correlation-friendly,
- stable across releases,
- useful during incident response,
- defensible for audit/regulatory review,
- bounded in volume and cardinality,
- consistent with metrics and traces.

The LLM MUST NOT generate ad-hoc `fmt.Println`, `log.Printf`, or arbitrary string-concatenated logs in production code unless explicitly implementing a temporary local debug tool.

---

## 2. Source authority

When this file conflicts with generated code, this file wins unless a human explicitly overrides it.

Primary references:

- Go `log/slog` package documentation: https://pkg.go.dev/log/slog
- Go structured logging blog: https://go.dev/blog/slog
- Go `context` package documentation: https://pkg.go.dev/context
- OpenTelemetry Go docs: https://opentelemetry.io/docs/languages/go/
- Go diagnostics guide: https://go.dev/doc/diagnostics

---

## 3. Non-negotiable rules

### 3.1 Use structured logging

Production Go code MUST use structured logging.

Preferred default:

```go
import "log/slog"
```

Allowed:

```go
logger.InfoContext(ctx, "case assignment completed",
    slog.String("case_id", caseID),
    slog.String("officer_id", officerID),
    slog.String("transition", "submitted_to_assigned"),
)
```

Forbidden:

```go
log.Printf("case %s assigned to %s", caseID, officerID)
fmt.Println("assigned", caseID, officerID)
```

Rationale:

- Free-form text cannot be reliably queried.
- String interpolation leaks secrets more easily.
- Attribute names drift over time.
- Incident response needs field-level filtering.

---

### 3.2 Log messages MUST be stable event names

The message string MUST describe a stable event, not include variable data.

Good:

```go
logger.InfoContext(ctx, "payment authorization rejected",
    slog.String("payment_id", paymentID),
    slog.String("reason_code", reasonCode),
)
```

Bad:

```go
logger.Infof("payment %s rejected because %s", paymentID, reason)
```

Rules:

- Message text SHOULD be lowercase and action-oriented.
- Dynamic data MUST be attributes.
- Do not encode fields into the message.
- Do not create many message variants for the same event.
- Do not use jokes, vague labels, or emotional wording.

---

### 3.3 Always pass context when available

If a function has a `context.Context`, logging MUST use context-aware calls:

```go
logger.ErrorContext(ctx, "document upload failed", slog.Any("error", err))
```

Do not discard context:

```go
logger.Error("document upload failed", slog.Any("error", err)) // avoid if ctx exists
```

This keeps logs compatible with trace/log correlation, request IDs, tenant IDs, actor IDs, and cancellation-aware logging adapters.

---

### 3.4 Do not create global mutable loggers inside business code

Allowed at application bootstrap:

```go
logger := slog.New(handler)
svc := NewService(logger, repo, clock)
```

Forbidden inside domain/application code:

```go
var logger = slog.Default()
```

Rules:

- Dependencies MUST receive `*slog.Logger` explicitly.
- Libraries MUST NOT configure global logging.
- Only the application entrypoint may configure handlers, levels, output format, sampling, and sinks.
- Package-level loggers are allowed only for tiny internal packages with no test isolation concerns and no dynamic configuration needs.

---

## 4. Logger ownership and dependency injection

### 4.1 Application entrypoint owns logging configuration

The `main` package MUST configure:

- handler type: JSON in production, text only for local development,
- minimum level,
- output destination,
- attribute redaction,
- source location policy,
- service metadata,
- environment metadata,
- trace/log correlation integration if used.

Example:

```go
handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
})

logger := slog.New(handler).With(
    slog.String("service", "case-service"),
    slog.String("env", cfg.Environment),
    slog.String("version", build.Version),
)
```

### 4.2 Services receive loggers explicitly

```go
type CaseService struct {
    logger *slog.Logger
    repo   CaseRepository
}

func NewCaseService(logger *slog.Logger, repo CaseRepository) *CaseService {
    if logger == nil {
        logger = slog.New(slog.DiscardHandler)
    }
    return &CaseService{logger: logger, repo: repo}
}
```

Rules:

- Constructors MAY default nil logger to discard only for libraries/tests.
- Application services SHOULD fail fast if logging is mandatory for audit trails.
- Do not reach into `slog.Default()` from core code.

---

## 5. Field naming standard

### 5.1 Attribute keys MUST be consistent

Use snake_case keys.

Preferred common keys:

| Field            | Meaning                                |
| ---------------- | -------------------------------------- |
| `service`        | service/module name                    |
| `env`            | runtime environment                    |
| `version`        | application version/build SHA          |
| `trace_id`       | distributed trace ID                   |
| `span_id`        | distributed span ID                    |
| `request_id`     | inbound request correlation ID         |
| `correlation_id` | business/process correlation ID        |
| `tenant_id`      | tenant/agency/org scope                |
| `actor_id`       | authenticated user/system actor        |
| `actor_type`     | user/system/service/batch              |
| `case_id`        | case aggregate ID                      |
| `application_id` | application aggregate ID               |
| `workflow_id`    | workflow/process ID                    |
| `state`          | current state                          |
| `from_state`     | previous state                         |
| `to_state`       | target state                           |
| `event_type`     | domain/integration event type          |
| `command_type`   | command/action type                    |
| `attempt`        | retry attempt number                   |
| `duration_ms`    | elapsed duration in milliseconds       |
| `error`          | error value or sanitized error message |
| `error_code`     | stable classified error code           |
| `retryable`      | whether operation may be retried       |

Forbidden drift:

```go
"caseId", "caseID", "case_id", "case-id" // do not mix
```

### 5.2 Field values MUST be low-cardinality where possible

High-cardinality values are allowed only when operationally necessary.

Acceptable high-cardinality fields:

- `request_id`,
- `trace_id`,
- `case_id`,
- `application_id`,
- `document_id`,
- `event_id`.

Forbidden as routine labels/fields unless explicitly required:

- full request body,
- full response body,
- raw SQL,
- raw stack dumps,
- raw JWT,
- raw API key,
- complete email body,
- full file path containing user input,
- arbitrary user search query without sanitization.

---

## 6. Log levels

### 6.1 Level policy

| Level | Use for                                                   | Do not use for                          |
| ----- | --------------------------------------------------------- | --------------------------------------- |
| DEBUG | diagnostic details, decision branches, dev-only internals | normal business events in prod          |
| INFO  | important successful business/technical events            | per-item spam in hot loops              |
| WARN  | recoverable abnormal condition needing attention          | expected validation failure             |
| ERROR | operation failed and requires caller/operator awareness   | successful fallback or normal rejection |

Rules:

- Validation failure caused by user input is usually INFO or WARN depending on business criticality, not ERROR.
- Retries MUST log at DEBUG/INFO for early attempts and WARN/ERROR only after exhaustion or material impact.
- Expected not-found result MUST NOT be ERROR unless it violates an invariant.
- Panic recovery MUST be ERROR or higher equivalent.
- Security denial SHOULD be WARN if it indicates suspicious behavior, otherwise INFO.

### 6.2 Do not log at ERROR and also return the same error from every layer

Only log at the boundary that can add operational meaning.

Bad:

```go
func (r *Repo) Save(ctx context.Context, c Case) error {
    if err := r.db.Save(ctx, c); err != nil {
        r.logger.ErrorContext(ctx, "save failed", slog.Any("error", err))
        return err
    }
    return nil
}

func (s *Service) Submit(ctx context.Context, id string) error {
    if err := s.repo.Save(ctx, c); err != nil {
        s.logger.ErrorContext(ctx, "submit failed", slog.Any("error", err))
        return err
    }
    return nil
}
```

Good:

```go
func (r *Repo) Save(ctx context.Context, c Case) error {
    if err := r.db.Save(ctx, c); err != nil {
        return fmt.Errorf("save case %s: %w", c.ID, err)
    }
    return nil
}

func (s *Service) Submit(ctx context.Context, id string) error {
    if err := s.repo.Save(ctx, c); err != nil {
        s.logger.ErrorContext(ctx, "case submission failed",
            slog.String("case_id", id),
            slog.Any("error", err),
        )
        return err
    }
    return nil
}
```

---

## 7. Error logging

### 7.1 Log errors with classification

Error logs SHOULD include:

- stable operation name,
- entity IDs,
- `error`,
- `error_code`,
- retryability,
- upstream system if relevant,
- duration if relevant,
- attempt count if retried,
- whether operation was canceled/deadline exceeded.

Example:

```go
logger.ErrorContext(ctx, "outlook email delivery failed",
    slog.String("message_id", msg.ID),
    slog.String("upstream", "outlook_ews"),
    slog.String("error_code", codeOf(err)),
    slog.Bool("retryable", isRetryable(err)),
    slog.Int("attempt", attempt),
    slog.Duration("duration", elapsed),
    slog.Any("error", err),
)
```

### 7.2 Do not log raw internal errors to user-facing audit logs

Operational logs and audit logs are not the same.

- Operational logs may include sanitized error details.
- Audit logs must capture business facts and decisions.
- User-facing error messages must not expose internal topology, SQL, secrets, or stack traces.

---

## 8. Sensitive data and redaction

### 8.1 Never log secrets

Forbidden fields:

- password,
- token,
- bearer token,
- refresh token,
- API key,
- private key,
- session cookie,
- OTP,
- PGP private material,
- full JWT,
- full authorization header,
- raw credential JSON,
- database DSN with credentials.

Any code logging these is a merge blocker.

### 8.2 Personal and regulatory data must be minimized

PII and sensitive regulatory data MUST be minimized or pseudonymized.

Do not log:

- NRIC/passport numbers,
- full address,
- full email body,
- full document content,
- medical data,
- payment card data,
- free-text complaint body unless explicitly scrubbed,
- uploaded document text,
- user-generated descriptions containing unknown content.

Allowed alternatives:

- stable internal ID,
- hash with approved keyed method,
- redacted suffix/prefix where legally accepted,
- classification/category code,
- length/count,
- validation error code.

Bad:

```go
logger.InfoContext(ctx, "applicant loaded", slog.String("nric", applicant.NRIC))
```

Good:

```go
logger.InfoContext(ctx, "applicant loaded",
    slog.String("applicant_id", applicant.ID),
    slog.String("profile_source", "myinfo"),
)
```

### 8.3 Use `LogValue` for redaction-capable types

Sensitive domain types SHOULD implement `slog.LogValuer`.

```go
type EmailAddress string

func (e EmailAddress) LogValue() slog.Value {
    return slog.StringValue(redactEmail(string(e)))
}
```

Rules:

- Redaction must be centralized, not manually repeated.
- Do not rely on every call site remembering to redact.
- Tests MUST verify sensitive types do not emit raw values.

---

## 9. Audit logging vs application logging

### 9.1 Do not confuse audit trail with logs

Application logs are for observability. Audit records are domain evidence.

Audit records MUST be persisted as structured business events or audit entities when required by regulation/business process.

Application logs MAY reference audit event IDs.

Example:

```go
logger.InfoContext(ctx, "audit event recorded",
    slog.String("audit_event_id", eventID),
    slog.String("case_id", caseID),
    slog.String("event_type", "case_state_changed"),
)
```

### 9.2 Audit-relevant transitions must include before/after state

For workflow systems, logs around transitions SHOULD include:

- aggregate ID,
- command type,
- actor ID/type,
- from state,
- to state,
- decision reason code,
- correlation ID,
- audit event ID.

```go
logger.InfoContext(ctx, "case state transition committed",
    slog.String("case_id", caseID),
    slog.String("command_type", "submit_case"),
    slog.String("from_state", "draft"),
    slog.String("to_state", "submitted"),
    slog.String("actor_id", actor.ID),
    slog.String("actor_type", actor.Type),
    slog.String("audit_event_id", auditID),
)
```

---

## 10. Request, trace, and correlation IDs

### 10.1 Correlation must enter at the edge

HTTP/gRPC/message consumers MUST extract or create correlation IDs at the boundary.

Rules:

- Request ID tracks a technical request.
- Trace ID tracks distributed execution.
- Correlation ID tracks business process/message flow.
- Idempotency key tracks safe retry semantics.
- Do not invent different IDs at each layer.

### 10.2 Propagate IDs explicitly where domain-relevant

Do not hide business IDs inside context values when they are domain inputs.

Bad:

```go
caseID := ctx.Value("case_id").(string)
```

Good:

```go
func (s *CaseService) Submit(ctx context.Context, caseID CaseID, actor Actor) error
```

Context may carry technical correlation metadata. Domain IDs should be function parameters or command fields.

---

## 11. Logging from libraries

Libraries MUST NOT assume the application logging stack.

Rules:

- Reusable libraries SHOULD accept an optional logger or callback.
- Libraries MUST NOT call `slog.SetDefault`.
- Libraries MUST NOT configure output format.
- Libraries MUST NOT log secrets from caller-provided inputs.
- Libraries SHOULD return errors with context and let application boundaries log them.

---

## 12. Hot-path and high-volume logging

### 12.1 Avoid unbounded per-item logs

Do not log per row, per byte, per token, per poll, or per message in hot paths unless sampling or debug gating exists.

Bad:

```go
for _, row := range rows {
    logger.InfoContext(ctx, "row processed", slog.String("row_id", row.ID))
}
```

Better:

```go
logger.InfoContext(ctx, "batch processed",
    slog.Int("row_count", len(rows)),
    slog.Duration("duration", elapsed),
)
```

### 12.2 Expensive attributes must be lazy or guarded

Do not compute expensive log attributes if the level is disabled.

```go
if logger.Enabled(ctx, slog.LevelDebug) {
    logger.DebugContext(ctx, "query plan generated",
        slog.String("plan", expensivePlan.String()),
    )
}
```

Rules:

- Do not marshal large JSON solely for a disabled log.
- Do not allocate large slices only for debug output.
- Do not call `fmt.Sprintf` for structured attributes unless necessary.

---

## 13. Logging and retries

Retry loops MUST avoid log storms.

Rules:

- Include `attempt`, `max_attempts`, `backoff_ms`, `retryable`.
- Log final failure at ERROR.
- Log intermediate failures at DEBUG/INFO/WARN depending on duration and impact.
- Use counters/metrics for retry volume.
- Do not emit stack traces on every retry.

Example:

```go
logger.WarnContext(ctx, "outbound request retry scheduled",
    slog.String("upstream", "onemap"),
    slog.Int("attempt", attempt),
    slog.Int("max_attempts", maxAttempts),
    slog.Duration("backoff", backoff),
    slog.String("error_code", codeOf(err)),
)
```

---

## 14. Logger API boundaries

### 14.1 Do not pass logger through context

Forbidden:

```go
ctx = context.WithValue(ctx, loggerKey{}, logger)
```

Use explicit dependency injection instead.

### 14.2 Do not expose logger in domain entities

Domain entities MUST NOT depend on logging.

Bad:

```go
type Case struct {
    logger *slog.Logger
}
```

Good:

- Domain returns events/errors.
- Application service logs outcome.
- Audit writer persists evidence.

---

## 15. HTTP logging

HTTP middleware SHOULD log one request completion event.

Required fields:

- method,
- route/template, not raw path where possible,
- status,
- duration,
- request_id,
- trace_id if available,
- user/actor ID if authenticated and safe,
- tenant ID if applicable,
- response size if cheap,
- error code if failed.

Avoid raw:

- query string with secrets,
- authorization headers,
- cookies,
- request body,
- response body.

Good:

```go
logger.InfoContext(r.Context(), "http request completed",
    slog.String("method", r.Method),
    slog.String("route", routePattern),
    slog.Int("status", status),
    slog.Duration("duration", time.Since(start)),
)
```

---

## 16. Background workers and consumers

Worker logs MUST include:

- worker name,
- job/message/event ID,
- partition/shard if applicable,
- attempt,
- lag if applicable,
- result,
- duration.

Message consumer logs MUST distinguish:

- decoded,
- validated,
- duplicate ignored,
- processed successfully,
- retried,
- moved to DLQ,
- poison message rejected.

Do not log full message payload by default.

---

## 17. Test logging

### 17.1 Tests should use `t.Log` or test logger

Unit tests SHOULD NOT write directly to stdout/stderr unless testing CLI output.

Allowed:

```go
t.Logf("case id: %s", id)
```

For services requiring logger:

```go
logger := slog.New(slog.NewTextHandler(testWriter{t}, nil))
```

### 17.2 Log output tests must assert structure

When testing logging behavior, assert:

- event message,
- level,
- required fields,
- no secret leakage,
- stable error code.

Do not assert entire raw log line unless format is part of contract.

---

## 18. Common LLM anti-patterns

The LLM MUST NOT generate:

```go
fmt.Println("debug")
```

```go
log.Fatal(err) // outside main/init boundary
```

```go
panic(err) // for normal error handling
```

```go
logger.Info("user", "password", password)
```

```go
logger.ErrorContext(ctx, "failed", slog.String("body", string(rawBody)))
```

```go
logger.InfoContext(ctx, fmt.Sprintf("case %s submitted", caseID))
```

```go
logger.InfoContext(context.Background(), "operation completed") // when caller ctx exists
```

```go
slog.SetDefault(...) // outside application bootstrap
```

---

## 19. Required review checklist

Before merge, the LLM MUST verify:

- [ ] No production `fmt.Println`, `println`, or ad-hoc `log.Printf`.
- [ ] Logs are structured and use stable event messages.
- [ ] Dynamic values are attributes, not interpolated into message text.
- [ ] Context-aware logging is used when context exists.
- [ ] No secrets, credentials, raw tokens, or sensitive PII are logged.
- [ ] Error logs include operation context and stable error classification where possible.
- [ ] Hot paths do not emit unbounded per-item logs.
- [ ] Retry logging cannot create log storms.
- [ ] Audit evidence is persisted separately when required.
- [ ] Field names follow the project dictionary.
- [ ] Logs can be correlated with traces/requests/business process IDs.
- [ ] Tests cover redaction for sensitive domain types.

---

## 20. LLM implementation rule

When asked to add logging, the LLM MUST first identify:

1. the operational event,
2. the business/event boundary,
3. the safe fields,
4. the log level,
5. the correlation IDs,
6. whether the data belongs in logs, metrics, traces, or audit records.

The LLM MUST NOT add logging merely because a function has an error branch. It must log where the event becomes operationally meaningful.

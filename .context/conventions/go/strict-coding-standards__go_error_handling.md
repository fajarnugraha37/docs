# Strict Coding Standards — Go Error Handling

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go services, libraries, CLIs, workers, schedulers, event processors, regulatory workflow systems  
Baseline: Go 1.13+ error wrapping with `errors.Is`, `errors.As`, `errors.Join`; compatible with Go 1.24–1.26+

---

## 1. Purpose

Error handling in Go is part of the API contract and failure model.

The LLM MUST treat every error path as a product behavior, operational signal, and correctness boundary.

Good Go error handling makes failure:

- explicit,
- typed or classified where needed,
- retry-aware,
- observable,
- secure,
- testable,
- compatible with cancellation,
- suitable for user-facing and machine-facing responses.

The LLM MUST NOT hide errors, panic for normal failures, or convert all errors into generic strings.

---

## 2. Source authority

Primary references:

- Go `errors` package documentation: https://pkg.go.dev/errors
- Go 1.13 error wrapping blog: https://go.dev/blog/go1.13-errors
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Go `context` package documentation: https://pkg.go.dev/context
- Go `fmt` package documentation for `%w`: https://pkg.go.dev/fmt
- Go `net/http` package documentation: https://pkg.go.dev/net/http

---

## 3. Non-negotiable rules

### 3.1 Always handle errors explicitly

Forbidden:

```go
value, _ := repo.Find(ctx, id)
```

Allowed only with explicit justification:

```go
_, _ = io.Copy(io.Discard, r) // explicitly ignoring drain error in cleanup path
```

Preferred:

```go
value, err := repo.Find(ctx, id)
if err != nil {
    return fmt.Errorf("find case %s: %w", id, err)
}
```

Rules:

- Ignored errors MUST be justified by code structure or comment.
- Do not ignore errors from `Close`, `Flush`, `Commit`, `Rollback`, `Encode`, `Decode`, `Write`, `Scanner.Err`, or transaction finalization.
- If cleanup error can change outcome, preserve it.

---

### 3.2 Do not panic for normal failures

Panics are allowed only for:

- impossible programmer errors,
- invalid static configuration at startup,
- invariant breach that cannot be safely recovered,
- test helper failures via `t.Fatal`/`require` equivalent.

Forbidden:

```go
if err != nil {
    panic(err)
}
```

Preferred:

```go
if err != nil {
    return fmt.Errorf("load policy config: %w", err)
}
```

`panic` MUST NOT be used for:

- user input validation,
- database failure,
- network failure,
- timeout,
- authorization denial,
- not found,
- duplicate request,
- normal domain rejection.

---

### 3.3 Return errors; log at boundaries

Lower-level functions SHOULD return contextual errors. Boundary layers SHOULD log.

Bad:

```go
func (r *Repo) Save(ctx context.Context, c Case) error {
    if err := r.db.Save(ctx, c); err != nil {
        r.logger.ErrorContext(ctx, "save failed", slog.Any("error", err))
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
```

Rules:

- Do not log and return the same error at every layer.
- Add context where the layer has meaningful information.
- Log once at request/job/message boundary unless immediate logging is required for security/audit.

---

## 4. Error taxonomy

Every meaningful error SHOULD belong to one category.

Common categories:

| Category               | Meaning                                 |          Typical HTTP | Retryable       |
| ---------------------- | --------------------------------------- | --------------------: | --------------- |
| validation             | malformed/invalid user input            |                   400 | no              |
| unauthenticated        | missing/invalid identity                |                   401 | no              |
| unauthorized           | identity lacks permission               |                   403 | no              |
| not_found              | entity does not exist                   |                   404 | no              |
| conflict               | version/state/idempotency conflict      |                   409 | maybe           |
| domain_rejection       | valid command rejected by business rule |               422/409 | no              |
| rate_limited           | caller exceeded quota                   |                   429 | yes after delay |
| dependency_unavailable | upstream unavailable                    |               502/503 | yes             |
| timeout                | deadline exceeded                       |               504/503 | maybe           |
| canceled               | caller canceled                         | 499/499-like internal | no              |
| internal               | invariant/system bug                    |                   500 | maybe           |

The LLM MUST NOT return only `errors.New("failed")` for application-level failures.

---

## 5. Sentinel errors

### 5.1 Use sentinel errors for stable conditions

Sentinel errors are appropriate when callers need `errors.Is`.

```go
var ErrCaseNotFound = errors.New("case not found")
var ErrInvalidTransition = errors.New("invalid case transition")
```

Usage:

```go
if err := svc.Submit(ctx, id); err != nil {
    if errors.Is(err, ErrInvalidTransition) {
        return problemConflict(err)
    }
    return problemInternal(err)
}
```

Rules:

- Sentinel names MUST start with `Err`.
- Sentinel text MUST be lowercase and without punctuation.
- Do not create sentinel errors for every possible message.
- Do not compare errors using `==` outside the package unless the sentinel contract explicitly allows it; prefer `errors.Is`.

---

## 6. Typed errors

### 6.1 Use typed errors when callers need structured data

```go
type ValidationError struct {
    Field string
    Code  string
    Err   error
}

func (e *ValidationError) Error() string {
    return "validation failed: " + e.Field
}

func (e *ValidationError) Unwrap() error { return e.Err }
```

Rules:

- Typed errors MUST implement `Error()`.
- Use pointer receiver when the error carries mutable/large data or optional fields.
- Use `errors.As` to extract typed errors.
- Do not expose sensitive data through `Error()`.
- Typed errors SHOULD expose machine-safe fields for mapping/logging.

### 6.2 Error string is not the machine contract

Forbidden:

```go
if strings.Contains(err.Error(), "duplicate") { ... }
```

Preferred:

```go
var conflict *ConflictError
if errors.As(err, &conflict) { ... }
```

---

## 7. Wrapping and preserving cause

### 7.1 Use `%w` for causal wrapping

```go
return fmt.Errorf("decode application request: %w", err)
```

Rules:

- Use `%w` when caller may need to inspect cause.
- Use `%v` only when intentionally hiding the underlying error contract.
- Add operation context, not generic filler.
- Do not wrap nil error.
- Do not lose cancellation causes.

Bad:

```go
return errors.New(err.Error())
```

Bad:

```go
return fmt.Errorf("failed: %w", err)
```

Good:

```go
return fmt.Errorf("load case %s from repository: %w", caseID, err)
```

### 7.2 Preserve both operation and entity context

Error context SHOULD answer:

- what operation failed,
- which entity or boundary was involved,
- which dependency failed,
- whether it was caller-controlled or system-controlled.

Do not include secrets, raw SQL with parameters, tokens, or large payloads.

---

## 8. Joining errors

### 8.1 Use `errors.Join` for independent multiple failures

Appropriate:

```go
err = errors.Join(closeErr, flushErr)
```

Rules:

- Use `errors.Join` when multiple errors are independently relevant.
- Do not join errors just to avoid deciding precedence.
- Do not use joined errors for user-facing messages without mapping/sanitization.
- Tests SHOULD verify `errors.Is` / `errors.As` still work for important causes.

### 8.2 Cleanup error precedence

When primary operation fails and cleanup also fails, preserve both if cleanup matters.

```go
if err := tx.Commit(); err != nil {
    return fmt.Errorf("commit case transition: %w", err)
}
```

For rollback after primary failure:

```go
if err != nil {
    if rbErr := tx.Rollback(); rbErr != nil {
        return errors.Join(err, fmt.Errorf("rollback transaction: %w", rbErr))
    }
    return err
}
```

---

## 9. Context cancellation and deadlines

### 9.1 Treat context errors specially

```go
if err := ctx.Err(); err != nil {
    return err
}
```

Rules:

- `context.Canceled` usually means caller abandoned work.
- `context.DeadlineExceeded` means deadline budget was exhausted.
- Do not wrap cancellation in a way that prevents `errors.Is`.
- Do not retry blindly after cancellation.
- Do not log cancellation as ERROR unless it violates an invariant or causes material system impact.

### 9.2 Preserve cancellation cause when used

If using `context.WithCancelCause`, downstream code SHOULD inspect `context.Cause(ctx)` where it changes behavior.

Do not overwrite a meaningful cause with a generic timeout error.

---

## 10. Domain errors

### 10.1 Domain rejection is not infrastructure failure

A valid command may be rejected by business rules.

Example:

```go
var ErrInvalidCaseTransition = errors.New("invalid case transition")

type InvalidTransitionError struct {
    CaseID    string
    FromState string
    ToState   string
}

func (e *InvalidTransitionError) Error() string {
    return "invalid case transition"
}

func (e *InvalidTransitionError) Is(target error) bool {
    return target == ErrInvalidCaseTransition
}
```

Rules:

- Domain errors SHOULD be deterministic.
- Domain errors SHOULD include stable reason codes when exposed to APIs/events.
- Domain errors MUST NOT mention database, HTTP, queue, or vendor details.
- Domain errors SHOULD be safe to convert to user-facing problem responses.

### 10.2 Workflow/state-machine errors must be explicit

For stateful systems, errors SHOULD distinguish:

- unknown aggregate,
- invalid transition,
- stale version,
- unauthorized action,
- missing prerequisite,
- duplicate command,
- already completed terminal state.

Do not collapse all of these into `bad request`.

---

## 11. Infrastructure errors

Infrastructure adapters MUST translate vendor-specific errors into application-level categories while preserving cause.

Example:

```go
if isUniqueViolation(err) {
    return fmt.Errorf("insert case %s: %w", c.ID, ErrDuplicateCase)
}
return fmt.Errorf("insert case %s: %w", c.ID, err)
```

Rules:

- Do not leak vendor-specific errors beyond adapter boundary unless package contract says so.
- Do not parse SQL error strings if the driver exposes structured codes.
- Mark retryability based on actual failure class, not just source.
- Timeout and connection errors should be distinguishable.

---

## 12. API error mapping

Transport layers MUST map internal errors to stable API responses.

Error response SHOULD contain:

- stable error code,
- user-safe message,
- request/correlation ID,
- field errors if validation,
- retry hint if appropriate.

It MUST NOT contain:

- stack trace,
- raw SQL,
- dependency hostnames,
- credentials,
- internal package paths,
- raw panic message from unknown source,
- wrapped error chain text if sensitive.

Example:

```go
switch {
case errors.Is(err, ErrCaseNotFound):
    writeProblem(w, http.StatusNotFound, "CASE_NOT_FOUND", "Case was not found.")
case errors.Is(err, ErrInvalidCaseTransition):
    writeProblem(w, http.StatusConflict, "INVALID_CASE_TRANSITION", "Case cannot move to the requested state.")
case errors.Is(err, context.DeadlineExceeded):
    writeProblem(w, http.StatusGatewayTimeout, "REQUEST_TIMEOUT", "The request timed out.")
default:
    writeProblem(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Unexpected error.")
}
```

---

## 13. Validation errors

Validation errors SHOULD be structured.

```go
type FieldViolation struct {
    Field string
    Code  string
}

type ValidationErrors struct {
    Violations []FieldViolation
}

func (e *ValidationErrors) Error() string { return "validation failed" }
```

Rules:

- Do not return one concatenated string for multiple field errors.
- Do not expose raw regex/parser internals to users.
- Field names must follow external API schema, not necessarily Go struct fields.
- Validation errors are usually non-retryable.

---

## 14. Retryability

Retryability MUST be explicit.

Bad:

```go
if err != nil {
    retry()
}
```

Preferred:

```go
if IsRetryable(err) {
    retry()
}
```

Rules:

- Do not retry validation/domain rejection.
- Do not retry after caller cancellation.
- Retrying non-idempotent operations requires idempotency key or transactional guard.
- Retry errors must include attempt and final outcome in logs/metrics.
- Retry classifier must be tested.

---

## 15. Error handling in transactions

Transaction code MUST make commit/rollback behavior explicit.

Pattern:

```go
func (s *Service) Do(ctx context.Context) (err error) {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("begin transaction: %w", err)
    }

    defer func() {
        if err != nil {
            if rbErr := tx.Rollback(); rbErr != nil {
                err = errors.Join(err, fmt.Errorf("rollback transaction: %w", rbErr))
            }
        }
    }()

    if err = doWork(ctx, tx); err != nil {
        return fmt.Errorf("execute work: %w", err)
    }

    if err = tx.Commit(); err != nil {
        return fmt.Errorf("commit transaction: %w", err)
    }

    return nil
}
```

Rules:

- Commit error is outcome-changing.
- Rollback error after primary failure may be operationally important.
- Do not ignore commit errors.
- Do not rollback after successful commit.

---

## 16. Error handling in goroutines

Goroutine errors MUST have an owner.

Forbidden:

```go
go func() {
    _ = doWork()
}()
```

Preferred with `errgroup` when errors matter:

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    return doWork(ctx)
})
if err := g.Wait(); err != nil {
    return fmt.Errorf("run workers: %w", err)
}
```

Rules:

- If a goroutine can fail, failure must be returned, sent, logged at boundary, or intentionally ignored with comment.
- `sync.WaitGroup.Go` is for fire-and-wait without error propagation; use `errgroup` when errors must cancel siblings.
- Panics in goroutines must be recovered only at safe process boundaries and converted to observable failures.

---

## 17. CLI error handling

CLI `main` may log/print and exit.

Rules:

- Business logic returns errors.
- `main` decides exit code.
- User-facing stderr must be concise.
- Debug mode may print wrapped chain or stack if intentionally supported.
- Do not call `os.Exit` deep inside library/application code.

Pattern:

```go
func main() {
    if err := run(context.Background(), os.Args[1:]); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(exitCode(err))
    }
}
```

---

## 18. Testing error behavior

Tests MUST cover:

- error category,
- wrapping compatibility with `errors.Is`,
- typed extraction with `errors.As`,
- safe user-facing mapping,
- retryability,
- cancellation behavior,
- transaction cleanup behavior,
- no sensitive data in `Error()` where relevant.

Example:

```go
if !errors.Is(err, ErrCaseNotFound) {
    t.Fatalf("expected ErrCaseNotFound, got %v", err)
}
```

Do not assert exact full wrapped error string unless the string is part of public CLI/API contract.

---

## 19. Common LLM anti-patterns

Forbidden:

```go
if err != nil {
    return err
}
```

when the layer has important operation context.

Forbidden:

```go
return errors.New("something went wrong")
```

Forbidden:

```go
return nil // after failed operation
```

Forbidden:

```go
panic(err)
```

Forbidden:

```go
if err.Error() == "not found" { ... }
```

Forbidden:

```go
logger.ErrorContext(ctx, "failed", slog.Any("error", err))
return err
```

at every layer.

Forbidden:

```go
http.Error(w, err.Error(), http.StatusInternalServerError)
```

when error may contain internal/sensitive data.

---

## 20. Required review checklist

Before merge, the LLM MUST verify:

- [ ] No ignored errors without explicit justification.
- [ ] Normal failures return errors, not panics.
- [ ] Error wrapping preserves root cause with `%w` where appropriate.
- [ ] `errors.Is` / `errors.As` works for public error contracts.
- [ ] Error strings are not used as machine contracts.
- [ ] Domain errors are separated from infrastructure errors.
- [ ] API mapping does not leak internals.
- [ ] Context cancellation/deadline errors are handled intentionally.
- [ ] Retryability is classified explicitly.
- [ ] Transaction commit/rollback errors are handled.
- [ ] Goroutine errors have an owner.
- [ ] Logging happens at meaningful boundaries, not every layer.
- [ ] Tests cover important failure modes.

---

## 21. LLM implementation rule

When writing a function that can fail, the LLM MUST decide and encode:

1. what failure categories exist,
2. which errors are caller-actionable,
3. which errors are retryable,
4. which errors are safe for users,
5. which errors must preserve low-level cause,
6. where the error is logged,
7. how the error is tested.

If the LLM cannot answer these, the implementation is incomplete.

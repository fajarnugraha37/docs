# Strict Coding Standards — Go Best Practices

> Mandatory positive conventions for LLM-assisted Go implementation, refactoring, and review.
>
> This document defines the default safe path. More specialized standards may override it only with a documented reason.

---

## 0. Scope

This document defines best practices that LLM/code agents MUST follow when writing production-grade Go code.

It applies to:

- services;
- CLIs;
- libraries;
- workers;
- HTTP/gRPC APIs;
- database access;
- integrations;
- tests;
- benchmarks;
- generated-code wrappers;
- security-sensitive code.

The objective is to make code:

1. simple to reason about;
2. explicit about ownership;
3. safe under cancellation and failure;
4. testable;
5. observable;
6. secure by default;
7. idiomatic enough for Go maintainers to review quickly.

---

## 1. Source Baseline

Use this document together with these canonical references:

- Go language specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go Test Comments: <https://go.dev/wiki/TestComments>
- Go Doc Comments: <https://go.dev/doc/comment>
- Organizing a Go module: <https://go.dev/doc/modules/layout>
- How to Write Go Code: <https://go.dev/doc/code>
- Package names: <https://go.dev/blog/package-names>
- Organizing Go code: <https://go.dev/blog/organizing-go-code>
- Go Modules Reference: <https://go.dev/ref/mod>
- Go security best practices: <https://go.dev/doc/security/best-practices>
- Go diagnostics: <https://go.dev/doc/diagnostics>
- Go Memory Model: <https://go.dev/ref/mem>
- Data race detector: <https://go.dev/doc/articles/race_detector>
- Fuzzing: <https://go.dev/doc/security/fuzz/>
- `context`: <https://pkg.go.dev/context>
- `errors`: <https://pkg.go.dev/errors>
- `sync`: <https://pkg.go.dev/sync>
- `net/http`: <https://pkg.go.dev/net/http>
- `database/sql`: <https://pkg.go.dev/database/sql>
- `encoding/json`: <https://pkg.go.dev/encoding/json>
- `testing`: <https://pkg.go.dev/testing>
- `log/slog`: <https://pkg.go.dev/log/slog>

If this document conflicts with official Go documentation, official Go documentation wins.

---

## 2. Normative Language

- **MUST** means required.
- **MUST NOT** means forbidden.
- **SHOULD** means expected unless a documented reason exists.
- **MAY** means permitted with judgment.
- **LLM MUST** means the code agent must enforce the rule before producing or modifying code.

---

## 3. Core Go Engineering Principles

LLM-generated Go code MUST optimize for these properties, in order:

1. correctness;
2. simplicity;
3. explicitness;
4. bounded resource use;
5. testability;
6. observability;
7. performance.

Performance matters, but not before correctness and operational safety.

Preferred Go design is:

```text
small packages + explicit dependencies + clear errors + context-aware boundaries + deterministic tests
```

---

## 4. Baseline Code Quality Gate

Every meaningful Go change MUST pass or document why it cannot pass:

```bash
gofmt -w .
go test ./...
go test -race ./...
go vet ./...
govulncheck ./...
```

For performance-sensitive code, add:

```bash
go test -bench=. -benchmem ./...
```

For changed public APIs or wire contracts, add compatibility notes and golden/contract tests.

---

## 5. Project and Package Organization

### 5.1 Package ownership

Every package MUST have one coherent responsibility.

A package SHOULD answer:

```text
What concept does this package own?
What invariants does it protect?
Who is allowed to import it?
What external dependencies does it hide?
```

### 5.2 Use `internal/` intentionally

Rules:

- Put non-public application code under `internal/`.
- Keep exported reusable library API outside `internal/` only when it is intentionally importable.
- Do not expose implementation packages just for test convenience.

### 5.3 Keep package names short and meaningful

Preferred:

```text
case
policy
money
clock
postgres
httpapi
authz
outbox
```

Avoid:

```text
util
common
helper
manager
processor
impl
```

### 5.4 Dependency direction

Default dependency direction:

```text
transport -> application -> domain
infrastructure -> application/domain through explicit interfaces or adapters
```

Domain packages SHOULD NOT import HTTP, SQL, gRPC, JSON DTOs, or external provider SDKs unless the project deliberately uses a simpler architecture and documents it.

---

## 6. API and Function Design

### 6.1 Keep function signatures meaningful

Preferred:

```go
func (s *Service) Approve(ctx context.Context, cmd ApproveCaseCommand) error
```

over:

```go
func (s *Service) Approve(ctx context.Context, id string, status string, force bool, notify bool) error
```

Rules:

- Use command/query structs when parameter count grows or call-site meaning weakens.
- Keep functions small enough that error paths and invariants are visible.
- Do not split code into tiny functions only to hide logic.

### 6.2 Context first

Request-scoped functions MUST accept `context.Context` as first parameter:

```go
func Fetch(ctx context.Context, id ID) (Result, error)
```

Do not store context in structs.

### 6.3 Return values

Rules:

- Return concrete types from constructors unless interface abstraction is intentionally owned by the caller.
- Return interfaces only when hiding implementation is part of the API contract.
- Prefer `(T, error)` over panic for expected failures.
- Prefer zero-value-safe types where feasible.

### 6.4 Constructor design

Constructors SHOULD validate required dependencies once:

```go
func NewService(store Store, logger *slog.Logger, clock Clock) (*Service, error) {
    if store == nil { return nil, errors.New("store is required") }
    if logger == nil { logger = slog.Default() }
    if clock == nil { clock = SystemClock{} }
    return &Service{store: store, logger: logger, clock: clock}, nil
}
```

Rules:

- Required dependencies MUST be explicit.
- Optional dependencies SHOULD use options struct or functional options when there are several.
- Constructors MUST NOT start goroutines unless lifecycle ownership is explicit.

---

## 7. Type Design

### 7.1 Use named types for domain concepts

Use named types for:

- IDs;
- statuses;
- states;
- permissions;
- money/currency;
- quantities;
- tenant identifiers;
- external correlation IDs.

Example:

```go
type CaseID string
type TenantID string
type Status string
```

### 7.2 Prefer value semantics when possible

Rules:

- Use values for small immutable structs.
- Use pointers when mutation, optionality, large copy avoidance, identity, or interface method set requires it.
- Document ownership when returning slices/maps/pointers that can mutate shared state.

### 7.3 Make zero value intentional

Every exported type SHOULD have one of:

1. useful zero value;
2. documented invalid zero value requiring constructor;
3. unexported fields forcing constructor.

### 7.4 Keep domain, transport, and persistence separate

Do not use one struct for all of these roles:

```text
HTTP request/response DTO
Domain entity/value object
Database row/document
Event payload
View/read model
```

Mappers are acceptable when they preserve semantics and do not silently drop fields.

---

## 8. Error Handling

### 8.1 Errors are part of the contract

Every exported function returning error SHOULD make the error categories discoverable through docs, sentinels, typed errors, or package-level classification.

### 8.2 Wrap with context

Preferred:

```go
if err != nil {
    return fmt.Errorf("load case %s: %w", id, err)
}
```

Rules:

- Use `%w` when caller may inspect the cause.
- Do not expose secrets in error messages.
- Do not rely on string matching.

### 8.3 Classify at boundaries

Application boundaries SHOULD classify errors into stable categories:

```text
validation
unauthenticated
unauthorized
not_found
conflict
rate_limited
transient_dependency
internal
```

HTTP/gRPC mapping MUST happen at transport boundary, not deep inside domain logic.

### 8.4 Cleanup path

For resources:

- check close errors when they can indicate failed write/flush;
- rollback transactions on failure;
- commit exactly once;
- prefer `defer` for cleanup where ordering is clear.

---

## 9. Context, Cancellation, and Deadlines

Rules:

- Public request-scoped operations MUST accept context.
- Database, HTTP, gRPC, and queue operations MUST receive context.
- Timeouts MUST be budgeted at the boundary or use case owner.
- Always call cancel for contexts created with timeout/deadline/cancel.
- Treat `context.Canceled` and `context.DeadlineExceeded` as expected operational outcomes, not necessarily internal errors.

Example:

```go
ctx, cancel := context.WithTimeout(parent, 3*time.Second)
defer cancel()

if err := repo.Save(ctx, entity); err != nil {
    return fmt.Errorf("save entity: %w", err)
}
```

---

## 10. Concurrency

### 10.1 Concurrency must have ownership

Every goroutine MUST have:

- owner;
- stop signal;
- wait path;
- error path;
- panic policy;
- observability.

### 10.2 Prefer simple synchronization

Use:

- mutex for protecting shared memory;
- channels for ownership transfer, fan-out/fan-in, and cancellation-aware pipelines;
- atomics for single-variable low-level state;
- `errgroup` for task groups with cancellation/error propagation;
- `sync.WaitGroup` or `WaitGroup.Go` only when error propagation is not needed.

### 10.3 Bound everything

Bound:

- goroutine count;
- queue size;
- memory buffer;
- retry count;
- network deadlines;
- file size;
- request body size;
- cache size.

### 10.4 Test concurrency deterministically

Use deterministic synchronization. Avoid sleeps. Use race detector and, where available and appropriate, `testing/synctest` for fake-time concurrency tests.

---

## 11. I/O and Resource Management

Rules:

- Treat `io.Reader` and `io.Writer` as partial-operation interfaces.
- Limit untrusted reads.
- Close resources exactly once.
- Check errors from encoders, flushers, closers, and scanners.
- Use streaming for large payloads.
- Do not buffer entire files/messages unless bounded and justified.

Example:

```go
limited := io.LimitReader(r, maxBytes)
if err := json.NewDecoder(limited).Decode(&dst); err != nil {
    return fmt.Errorf("decode request: %w", err)
}
```

---

## 12. HTTP and Network Defaults

### 12.1 Server

Production HTTP servers MUST configure:

- read header timeout;
- read/write timeout or explicit streaming policy;
- idle timeout;
- max header/body size policy;
- graceful shutdown;
- panic recovery at boundary;
- structured access logs;
- health/readiness endpoints where applicable.

### 12.2 Client

Production HTTP clients MUST:

- be injected, not recreated per request;
- use context-aware request;
- close response body;
- bound response size;
- verify TLS;
- classify retryable errors;
- use idempotency keys where required.

---

## 13. Database Access

Rules:

- Use `QueryContext`, `ExecContext`, `BeginTx`.
- Parameterize values.
- Allowlist dynamic identifiers.
- Close rows and check `rows.Err()`.
- Treat `sql.ErrNoRows` as a domain/application classification point.
- Make transaction ownership explicit.
- Use optimistic locking/version checks where concurrent updates affect invariants.
- Instrument query duration and error categories without logging sensitive data.

Transaction pattern:

```go
tx, err := db.BeginTx(ctx, opts)
if err != nil { return err }
defer tx.Rollback()

// operations...

if err := tx.Commit(); err != nil {
    return fmt.Errorf("commit transaction: %w", err)
}
```

---

## 14. JSON and Wire Contracts

Rules:

- Use DTOs for wire contracts.
- Use strict decoding at external boundaries unless compatibility requires loose mode.
- Define unknown-field behavior.
- Define null/omitted/zero semantics.
- Avoid `float64` for money and precise identifiers.
- Version events and external contracts.
- Add golden/contract tests for public wire formats.

Recommended strict JSON decode flow:

1. body size limit;
2. decode one value;
3. reject unknown fields when contract is strict;
4. reject trailing values;
5. validate semantically;
6. map DTO to command/domain.

---

## 15. Logging

Use structured logs.

Rules:

- Prefer `log/slog` or project-approved structured logger.
- Include stable correlation fields: request ID, trace ID, job ID, message ID, tenant ID where allowed.
- Use bounded field names and values.
- Redact secrets and regulated data.
- Log at ownership boundary, not every layer.
- Do not use logs as control flow.

Example field dictionary:

```text
operation
request_id
trace_id
tenant_id
actor_id
resource_type
resource_id
status
error_kind
duration_ms
attempt
```

---

## 16. Telemetry

Services SHOULD expose:

- structured logs;
- metrics;
- traces where distributed calls exist;
- health/readiness;
- runtime metrics where operationally useful;
- pprof/runtime trace only behind safe administrative boundary.

Metric labels MUST have bounded cardinality.

Trace spans MUST avoid sensitive attributes.

---

## 17. Security Defaults

LLM-generated Go code MUST be secure by default.

Rules:

- Validate input at trust boundaries.
- Authorize object-level access in application/domain layer.
- Use least privilege.
- Do not log secrets.
- Use `crypto/rand` for security randomness.
- Do not disable TLS verification.
- Avoid shell execution; if required, use fixed executable and argument list.
- Use parameterized SQL.
- Use `html/template` for HTML output.
- Run dependency vulnerability checks.
- Add negative tests for authorization and validation.

---

## 18. Testing Practices

### 18.1 Test behavior, not private implementation

Tests SHOULD verify observable behavior, state changes, emitted events, repository effects, and error classification.

### 18.2 Use table tests where useful

```go
func TestValidateStatus(t *testing.T) {
    tests := []struct{
        name string
        status Status
        wantErr error
    }{
        {name: "valid submitted", status: StatusSubmitted},
        {name: "invalid empty", status: "", wantErr: ErrInvalidStatus},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateStatus(tt.status)
            if !errors.Is(err, tt.wantErr) { ... }
        })
    }
}
```

### 18.3 Required cases

For non-trivial code, include tests for:

- success;
- invalid input;
- dependency failure;
- timeout/cancellation;
- authorization denial;
- idempotency/retry;
- boundary values;
- concurrent access if applicable.

### 18.4 Fuzzing

Use fuzzing for parsers, decoders, validators, mappers, path handling, binary formats, and security-sensitive input.

---

## 19. Benchmarking and Performance

Rules:

- Benchmark only after defining the performance question.
- Use representative data sizes and distributions.
- Report allocations with `-benchmem`.
- Compare repeated runs with `benchstat` or equivalent.
- Use profiling before optimizing.
- Avoid unsafe or pooling optimizations without evidence.

For Go 1.24+, prefer `b.Loop()` for new benchmarks when project toolchain supports it.

---

## 20. Documentation and Comments

Rules:

- Exported identifiers SHOULD have doc comments unless obvious and project policy allows omission.
- Comments SHOULD explain why, not restate what.
- Concurrency safety MUST be documented for exported types when relevant.
- Package comments SHOULD describe responsibility and import boundary.
- Public APIs MUST document error/cancellation/ownership semantics.

---

## 21. Dependency Management

Rules:

- Prefer standard library before third-party dependencies.
- Add dependencies intentionally and record why when non-obvious.
- Keep `go.mod` and `go.sum` tidy.
- Use maintained libraries with acceptable license and security posture.
- Pin tools through project-approved mechanism.
- Do not use `replace` in committed production module unless documented.

---

## 22. Generated Code

Rules:

- Generated code MUST be isolated and marked.
- Do not edit generated files manually.
- Wrap generated types at boundaries if domain semantics are required.
- Codegen command/version MUST be reproducible.
- Generated code MUST still pass security and lint gates unless explicitly excluded with reason.

---

## 23. State Machine and Workflow Code

For regulatory/business workflows, code MUST model:

- explicit states;
- allowed transitions;
- actor/action/resource/environment;
- guard conditions;
- side effects;
- audit events;
- idempotency;
- version/optimistic lock;
- denial reasons;
- migration compatibility.

Forbidden approach:

```go
caseObj.Status = req.Status
```

Preferred:

```go
if err := caseObj.TransitionTo(ctx, target, actor, now); err != nil {
    return fmt.Errorf("transition case: %w", err)
}
```

---

## 24. LLM Implementation Workflow

Before writing code, LLM MUST identify:

1. package owner;
2. domain invariant;
3. input/output contract;
4. error categories;
5. cancellation/deadline behavior;
6. resource bounds;
7. security boundary;
8. test matrix.

While writing code, LLM MUST:

1. use explicit types;
2. propagate context;
3. check errors;
4. keep dependencies injected;
5. avoid global mutable state;
6. keep functions readable;
7. add tests for negative paths.

Before finalizing code, LLM MUST verify:

1. formatting;
2. tests;
3. race safety if concurrent;
4. vet/security gates;
5. no anti-patterns introduced;
6. public contract compatibility.

---

## 25. Best-Practice Checklist

A Go change is acceptable only if:

- package placement matches ownership;
- names are idiomatic and meaningful;
- context is propagated correctly;
- errors are checked, wrapped, and classified;
- resources are closed and bounded;
- goroutines have lifecycle ownership;
- external inputs are validated;
- authorization is not bypassed;
- logs are structured and redacted;
- metrics labels are bounded;
- tests cover failure and boundary cases;
- dependencies are justified;
- performance claims are benchmarked;
- public contract changes are documented.

---

## 26. Merge Gate Statement

The default Go implementation style is explicit, small, context-aware, error-aware, and boring.

LLM/code agents MUST start from this standard and escalate to specialized patterns only when the simpler design cannot preserve the required invariant.

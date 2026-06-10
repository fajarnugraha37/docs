# Strict Coding Standards — Go Anti-Pattern

> Mandatory negative rules for LLM-assisted Go implementation, refactoring, and review.
>
> This document is a merge gate. It exists to stop code that compiles but is structurally unsafe, non-idiomatic, untestable, or operationally fragile.

---

## 0. Scope

This document defines Go anti-patterns that MUST NOT be introduced by an LLM/code agent.

It applies to:

- new Go services;
- refactoring existing Go services;
- HTTP/gRPC handlers;
- CLI commands;
- background workers;
- database access code;
- integration clients;
- tests and fakes;
- generated-code wrappers;
- performance optimizations;
- security-sensitive code.

The goal is not to ban every imperfect pattern. The goal is to prevent recurring failure modes where an LLM chooses code that is easy to generate but hard to operate, reason about, review, secure, or evolve.

---

## 1. Source Baseline

Use this document together with these canonical references:

- Go language specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go Test Comments: <https://go.dev/wiki/TestComments>
- Go Doc Comments: <https://go.dev/doc/comment>
- Organizing a Go module: <https://go.dev/doc/modules/layout>
- Package names: <https://go.dev/blog/package-names>
- Go Memory Model: <https://go.dev/ref/mem>
- Go Concurrency Patterns — Pipelines and cancellation: <https://go.dev/blog/pipelines>
- Go Concurrency Patterns — Context: <https://go.dev/blog/context>
- Errors are values: <https://go.dev/blog/errors-are-values>
- Working with Errors in Go 1.13: <https://go.dev/blog/go1.13-errors>
- Go security best practices: <https://go.dev/doc/security/best-practices>
- Go diagnostics: <https://go.dev/doc/diagnostics>
- Data race detector: <https://go.dev/doc/articles/race_detector>
- Fuzzing: <https://go.dev/doc/security/fuzz/>
- `context`: <https://pkg.go.dev/context>
- `errors`: <https://pkg.go.dev/errors>
- `sync`: <https://pkg.go.dev/sync>
- `net/http`: <https://pkg.go.dev/net/http>
- `database/sql`: <https://pkg.go.dev/database/sql>
- `encoding/json`: <https://pkg.go.dev/encoding/json>
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

## 3. Global Anti-Pattern Principle

An implementation is unacceptable when it optimizes for local compilation while damaging one or more of these properties:

1. correctness;
2. cancellation;
3. bounded resource usage;
4. deterministic tests;
5. clear ownership;
6. explicit dependencies;
7. readable domain behavior;
8. security posture;
9. observability;
10. evolvability.

LLM-generated Go code MUST NOT be accepted merely because `go test ./...` passes.

Every non-trivial change MUST satisfy:

```text
compiles + tests pass + race-safe + bounded + observable + idiomatic + reviewable
```

---

## 4. Package and Module Anti-Patterns

### 4.1 `utils`, `common`, `helpers`, `shared` dumping ground

Forbidden:

```go
package utils

func DoThing(v any) any { ... }
```

Rules:

- MUST NOT create catch-all packages named `utils`, `common`, `helpers`, `shared`, `misc`, or `base` unless the existing project already has a documented convention.
- MUST name packages by domain capability or concrete responsibility.
- MUST move functions to the package that owns the concept.

Preferred:

```text
internal/money
internal/policy
internal/idempotency
internal/httpjson
internal/retry
internal/clock
```

### 4.2 Java-style package layering without Go package semantics

Forbidden:

```text
internal/controller
internal/service
internal/repository
internal/model
```

This layout is not automatically wrong, but it is forbidden when every domain feature is spread across all layers and changes require touching every package.

Preferred:

```text
internal/case/application
internal/case/domain
internal/case/postgres
internal/case/httpapi
```

or, for smaller services:

```text
internal/case
internal/case/postgres
internal/case/httpapi
```

### 4.3 Premature multi-module split

Rules:

- MUST NOT split a repository into multiple Go modules just to imitate microservice architecture.
- MUST NOT create a shared module before proving stable ownership, release cadence, compatibility policy, and consumer needs.
- SHOULD use packages before modules unless versioning/dependency boundaries require separate modules.

### 4.4 Public API leakage

Rules:

- MUST NOT export types/functions only because tests or another package are inconvenient.
- MUST NOT expose persistence rows, transport DTOs, or generated types as domain API.
- MUST NOT put internal-only code outside `internal/` when it is not intended for external import.

---

## 5. Naming Anti-Patterns

### 5.1 Stuttering names

Forbidden:

```go
package user

type UserService struct{}
func NewUserService() *UserService { return &UserService{} }
```

Better:

```go
package user

type Service struct{}
func NewService() *Service { return &Service{} }
```

### 5.2 Meaningless suffixes

Avoid names that hide responsibility:

```text
Manager
Processor
Handler
Helper
Util
Common
Base
Impl
Logic
Core
```

These names MAY be used only when the package context makes responsibility precise.

### 5.3 Acronym inconsistency

Rules:

- MUST consistently name initialisms: `ID`, `URL`, `HTTP`, `JSON`, `SQL`, `API`, `TLS`, `JWT`.
- MUST NOT mix `Id`, `Url`, `Http`, `Json` in exported names unless preserving external contract names.

---

## 6. Type and Data Modelling Anti-Patterns

### 6.1 Primitive obsession

Forbidden:

```go
func Approve(caseID string, actorID string, status string, amount int64) error
```

Preferred:

```go
type CaseID string
type ActorID string
type CaseStatus string
type MoneyCents int64

func Approve(ctx context.Context, caseID CaseID, actor ActorID) error
```

Rules:

- MUST NOT model domain-critical IDs, statuses, permissions, currencies, or workflow states as anonymous primitives at important boundaries.
- MUST use named types when it prevents invalid mixing.

### 6.2 Boolean parameter trap

Forbidden:

```go
CreateUser(ctx, input, true, false)
```

Rules:

- MUST NOT use multiple boolean parameters where call-site meaning is unclear.
- MUST use named options, explicit methods, or separate commands.

Preferred:

```go
CreateUser(ctx, CreateUserCommand{
    Input: input,
    SendInvite: true,
    RequireMFA: false,
})
```

### 6.3 Struct as unvalidated bag

Forbidden:

```go
type Case struct {
    Status string
    DueAt  time.Time
}

caseObj.Status = "approved"
```

Rules:

- MUST NOT expose mutable fields for state that has invariants.
- MUST enforce domain transitions through methods/functions.

Preferred:

```go
func (c *Case) Approve(now time.Time, actor ActorID) error {
    if c.status != StatusSubmitted { return ErrInvalidTransition }
    c.status = StatusApproved
    c.approvedAt = now
    return nil
}
```

### 6.4 Pointer everywhere

Rules:

- MUST NOT use pointers for every struct by default.
- MUST NOT use `*string`, `*int`, `*bool` unless tri-state semantics or mutation sharing is required and documented.
- SHOULD pass small immutable values by value.

### 6.5 Interface nil trap

Forbidden:

```go
func NewError() error {
    var e *MyError = nil
    return e // non-nil interface
}
```

Rules:

- MUST NOT return typed nil values as interface values.
- MUST test nil behavior for custom error/interface implementations.

### 6.6 `map[string]any` as domain model

Rules:

- MUST NOT use `map[string]any` as domain model, command, event, or repository result.
- MAY use it only at controlled dynamic boundaries such as generic metadata, telemetry attributes, or raw JSON passthrough with validation.

---

## 7. Error Handling Anti-Patterns

### 7.1 Ignored errors

Forbidden:

```go
json.NewEncoder(w).Encode(resp)
rows.Close()
```

Rules:

- MUST check errors except where official docs explicitly make the error irrelevant and the reason is commented.
- MUST handle close/flush/commit/rollback errors according to resource semantics.

### 7.2 Panic for expected failures

Forbidden:

```go
if err != nil { panic(err) }
```

Rules:

- MUST NOT use panic for ordinary input, network, database, validation, authorization, or dependency failure.
- MAY panic only for impossible programmer errors during initialization or invariant violation that indicates corrupted process state.

### 7.3 String matching errors

Forbidden:

```go
if strings.Contains(err.Error(), "duplicate") { ... }
```

Rules:

- MUST use `errors.Is`, `errors.As`, typed errors, driver error codes, or explicit classification.

### 7.4 Wrapping destroys identity

Forbidden:

```go
return fmt.Errorf("load user: %v", err)
```

Preferred:

```go
return fmt.Errorf("load user: %w", err)
```

Rules:

- MUST use `%w` when caller needs classification.
- MUST NOT wrap context cancellation/deadline errors in a way that breaks `errors.Is`.

### 7.5 Double logging and returning

Forbidden:

```go
if err != nil {
    logger.Error("failed", "err", err)
    return err
}
```

Rules:

- MUST NOT log and return the same error at every layer.
- SHOULD log at boundary/ownership layer with request/job identifiers.

---

## 8. Context Anti-Patterns

### 8.1 Context stored in struct

Forbidden:

```go
type Service struct {
    ctx context.Context
}
```

Rules:

- MUST NOT store request context in structs.
- MUST pass `context.Context` as the first argument of request-scoped operations.

### 8.2 Nil context

Forbidden:

```go
svc.Do(nil, input)
```

Rules:

- MUST NOT pass nil context.
- Use `context.Background()` or `context.TODO()` explicitly when no request context exists.

### 8.3 Context as dependency container

Forbidden:

```go
logger := ctx.Value("logger").(*slog.Logger)
db := ctx.Value("db").(*sql.DB)
```

Rules:

- MUST NOT store logger, DB, config, service, repository, or feature flag client in context.
- Context values are only for request-scoped values that cross API/process boundaries.

### 8.4 Missing cancel

Forbidden:

```go
ctx, _ := context.WithTimeout(parent, time.Second)
```

Preferred:

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel()
```

---

## 9. Concurrency Anti-Patterns

### 9.1 Fire-and-forget goroutine

Forbidden:

```go
go func() {
    doWork()
}()
```

Rules:

- MUST NOT start goroutines without ownership, cancellation, error handling, and shutdown path.
- MUST document who stops the goroutine.

### 9.2 Unbounded goroutines

Forbidden:

```go
for _, item := range items {
    go process(item)
}
```

Rules:

- MUST bound concurrency with worker pool, semaphore, rate limiter, or queue.
- MUST consider backpressure.

### 9.3 Channel close by receiver

Rules:

- MUST NOT close a channel from the receiver side unless receiver is the only sender by construction.
- Channel owner/sender is responsible for close.

### 9.4 Sleep-based synchronization

Forbidden:

```go
time.Sleep(100 * time.Millisecond)
```

Rules:

- MUST NOT use sleeps as synchronization in tests or production.
- Use channels, contexts, wait groups, fake clocks, `testing/synctest`, or deterministic hooks.

### 9.5 Copying sync primitives

Forbidden:

```go
type Cache struct { sync.Mutex }
func (c Cache) Put(k string, v any) { ... } // copies mutex
```

Rules:

- MUST NOT copy values containing `sync.Mutex`, `sync.RWMutex`, `sync.Once`, `sync.WaitGroup`, atomic values, or no-copy resources.
- Use pointer receivers for structs containing synchronization primitives.

### 9.6 Shared map without synchronization

Rules:

- MUST NOT read and write the same map concurrently without synchronization.
- MUST use mutex, actor ownership, copy-on-write, or `sync.Map` with a documented access pattern.

### 9.7 Atomic as magic race cure

Rules:

- MUST NOT replace a mutex with atomics unless the invariant is single-variable or rigorously documented.
- Multi-field invariants require locks or actor ownership.

---

## 10. I/O and Network Anti-Patterns

### 10.1 `http.Get` in production code

Forbidden:

```go
resp, err := http.Get(url)
```

Rules:

- MUST NOT use package-level HTTP helpers in production clients because they hide timeout/transport policy.
- MUST use injected `*http.Client` with configured timeout/transport and request context.

### 10.2 Missing response body close

Forbidden:

```go
resp, err := client.Do(req)
if err != nil { return err }
body, _ := io.ReadAll(resp.Body)
```

Preferred:

```go
resp, err := client.Do(req)
if err != nil { return err }
defer resp.Body.Close()
```

### 10.3 Unbounded read

Forbidden:

```go
b, err := io.ReadAll(r)
```

Rules:

- MUST NOT read untrusted input without size limit.
- Use `io.LimitReader`, `http.MaxBytesReader`, streaming decoder, or bounded buffer.

### 10.4 Assuming full read/write

Rules:

- MUST NOT assume `Read` fills the buffer.
- MUST NOT assume `Write` writes all bytes unless using a helper that guarantees it.
- MUST handle partial read/write semantics.

### 10.5 No deadline on network connection

Rules:

- MUST set deadlines or use context-aware operations for network I/O.
- Long-lived streams MUST have heartbeat/idle timeout policy.

---

## 11. File and Filesystem Anti-Patterns

### 11.1 Path concatenation

Forbidden:

```go
path := base + "/" + userInput
```

Rules:

- MUST use `filepath.Join` for OS paths and `path.Join` only for slash-separated paths such as URL paths or `io/fs` paths.

### 11.2 Path traversal

Rules:

- MUST NOT open user-provided paths without locality validation.
- MUST validate with `filepath.IsLocal`, controlled root handling, and symlink policy where relevant.

### 11.3 Non-atomic file update

Forbidden:

```go
os.WriteFile(path, data, 0644)
```

for state/config files where partial write is dangerous.

Rules:

- MUST use temp-file + fsync + rename pattern for critical file replacement.
- MUST handle close/sync errors.

---

## 12. JSON/XML/Encoding Anti-Patterns

### 12.1 Domain struct used as API DTO

Rules:

- MUST NOT put JSON/XML tags on domain entities unless the type is explicitly a wire contract.
- MUST use DTOs for transport and mappers for boundary conversion.

### 12.2 Loose JSON decode at external boundary

Forbidden:

```go
json.NewDecoder(r.Body).Decode(&req)
```

without size limit, unknown-field policy, and trailing token check.

Rules:

- MUST define unknown field policy.
- MUST reject trailing JSON values where API contract expects one object.
- MUST validate optional/null/zero semantics.

### 12.3 Numeric precision loss

Rules:

- MUST NOT decode money, ID, or high-precision numbers into `float64`.
- MUST use string, integer minor units, `json.Number`, or decimal/big type with explicit policy.

### 12.4 Unsafe template rendering

Rules:

- MUST NOT use `text/template` for HTML output.
- MUST NOT pass untrusted data as `template.HTML`, `template.JS`, `template.CSS`, or equivalent trusted wrapper.

---

## 13. Database Anti-Patterns

### 13.1 SQL string concatenation with values

Forbidden:

```go
query := "SELECT * FROM users WHERE email = '" + email + "'"
```

Rules:

- MUST use parameterized queries for values.
- Dynamic identifiers MUST come from allowlisted constants, not raw user input.

### 13.2 Ignored `Rows.Close` and `rows.Err`

Rules:

- MUST close rows.
- MUST check `rows.Err()` after iteration.

### 13.3 Transaction hidden inside repository method without ownership

Rules:

- MUST NOT let random repository methods silently begin/commit transactions when caller requires atomic multi-step behavior.
- Transaction ownership MUST be explicit.

### 13.4 Offset pagination by default

Rules:

- MUST NOT use offset pagination for large/unstable datasets without documented reason.
- Prefer keyset pagination for high-volume or mutation-prone lists.

### 13.5 Migration mixed into application startup by default

Rules:

- MUST NOT run destructive or long-running schema migrations automatically on every app startup.
- Migration execution MUST be an explicit deployment operation unless project standard says otherwise.

---

## 14. Security Anti-Patterns

### 14.1 Disabling TLS verification

Forbidden:

```go
&tls.Config{InsecureSkipVerify: true}
```

Rules:

- MUST NOT disable TLS verification in production code.
- Test-only exceptions MUST be local, named, and impossible to enable accidentally in production config.

### 14.2 Secrets in logs/errors

Rules:

- MUST NOT log tokens, passwords, private keys, API keys, session IDs, OTPs, raw authorization headers, PII, or regulated identifiers without redaction policy.

### 14.3 Home-grown crypto

Rules:

- MUST NOT invent encryption, signing, token, hashing, key exchange, or password storage algorithms.
- MUST use reviewed primitives and protocols.

### 14.4 Weak randomness

Forbidden:

```go
math/rand.Int63()
```

for security tokens, nonces, salts, IDs requiring unpredictability, or reset links.

Rules:

- MUST use `crypto/rand` for security randomness.

### 14.5 Authorization only in UI/handler

Rules:

- MUST NOT rely only on front-end checks or route-level checks for object-level authorization.
- Application/domain layer MUST enforce resource ownership, tenant, state, and permission invariants where relevant.

---

## 15. Logging and Telemetry Anti-Patterns

### 15.1 `fmt.Println` logging

Rules:

- MUST NOT use `fmt.Println`, `log.Println`, or ad-hoc string logs in service code unless project standard says so for CLI output.
- Use structured logging, preferably `log/slog` or project logging abstraction.

### 15.2 High-cardinality metrics

Rules:

- MUST NOT use user ID, email, request ID, order ID, raw path, SQL text, or error message as metric label values.
- Use bounded label sets.

### 15.3 Missing correlation

Rules:

- Boundary logs MUST include request/job/message correlation fields where available.
- Errors returned to caller MUST be correlated to logs without exposing secrets.

### 15.4 Instrumentation changes behavior

Rules:

- Telemetry MUST NOT become required for business correctness.
- Code MUST behave correctly when telemetry exporter is unavailable.

---

## 16. Testing Anti-Patterns

### 16.1 Tests that only cover happy path

Rules:

- MUST NOT accept implementation tests without invalid input, boundary, cancellation, error, and concurrency cases where relevant.

### 16.2 Over-mocking internal implementation

Rules:

- MUST NOT mock every internal function.
- Prefer behavior tests at package boundary.
- Use fakes for external dependencies.

### 16.3 Golden files without update discipline

Rules:

- MUST NOT add golden tests without deterministic output and explicit review of golden changes.

### 16.4 Ignoring race detector

Rules:

- Concurrent code MUST have a `go test -race` path unless unsupported by platform or test type.

### 16.5 Benchmark as proof without profiling

Rules:

- MUST NOT claim performance improvement from single noisy benchmark run.
- Use repeated runs, `benchstat`, allocation metrics, and representative input.

---

## 17. Generics and Reflection Anti-Patterns

### 17.1 Generic abstraction before duplication is understood

Rules:

- MUST NOT introduce generic repository/service/pipeline solely to reduce visible repetition.
- Generics MUST encode real type-safe behavior or container/algorithm reuse.

### 17.2 `any` as escape hatch

Rules:

- MUST NOT replace type safety with `any` and type switches unless dynamic boundary requires it.

### 17.3 Reflection for normal dispatch

Rules:

- MUST NOT use reflection where interface, function, generic, or explicit mapping is clearer.
- Reflection MUST be isolated, tested, and guarded against invalid/nil/unexported values.

### 17.4 `reflect.DeepEqual` for semantic equality

Rules:

- MUST NOT use `reflect.DeepEqual` for time values, nil-vs-empty slices/maps, floating-point values, protobufs, or semantic domain equality unless behavior is intentional.

---

## 18. Performance Anti-Patterns

### 18.1 Premature micro-optimization

Rules:

- MUST NOT introduce unsafe code, pooling, custom allocators, manual binary protocol, or concurrency solely based on intuition.
- Must have benchmark/profile evidence.

### 18.2 `sync.Pool` for correctness

Rules:

- MUST NOT rely on `sync.Pool` for object lifecycle or guaranteed reuse.
- Pooled objects MUST be reset before reuse and MUST NOT contain secrets unless securely cleared and justified.

### 18.3 Retaining large backing arrays

Forbidden:

```go
small := big[:10]
return small
```

when `big` is large and should be released.

Rules:

- MUST copy out small retained slices from large buffers when lifetime differs.

### 18.4 Unbounded caches

Rules:

- MUST NOT introduce maps as caches without max size, TTL, eviction, invalidation, and telemetry.

---

## 19. Dependency Anti-Patterns

### 19.1 Adding library for trivial code

Rules:

- MUST NOT add third-party dependencies for simple helper functions available in standard library or small local code.

### 19.2 Unpinned tool behavior

Rules:

- Tooling used in CI/codegen/migration MUST be versioned through `go.mod` tool directive, `tools.go`, container image, lock file, or equivalent project mechanism.

### 19.3 Hidden transitive API dependency

Rules:

- MUST NOT import packages just because they are transitively present.
- Directly require modules used by code.

---

## 20. LLM-Specific Anti-Patterns

LLM MUST NOT:

1. create abstraction without naming the invariant it protects;
2. introduce a goroutine without shutdown path;
3. introduce a retry without idempotency and budget;
4. introduce a cache without invalidation policy;
5. introduce a mapper that silently drops fields;
6. introduce security-sensitive code without tests and review notes;
7. introduce reflection/unsafe without explicit justification;
8. add TODOs instead of implementing required error handling;
9. use placeholders like `// handle error`;
10. silently change public wire contract;
11. silently widen permissions or bypass authorization;
12. ignore context cancellation;
13. introduce package cycles and solve them with global variables;
14. change migration semantics without rollout notes;
15. optimize without benchmark/profiling evidence.

---

## 21. Mandatory Rejection Checklist

Reject the change if any answer is **yes**:

- Does it ignore an error from I/O, DB, JSON, close, commit, rollback, flush, or encode?
- Does it spawn a goroutine without owner, cancel, wait, and error path?
- Does it use unbounded `io.ReadAll`, unbounded goroutines, unbounded cache, or unbounded queue?
- Does it concatenate SQL, shell command, path, HTML, XML, JSON, or header strings using untrusted input?
- Does it use raw `map[string]any` as domain or API contract?
- Does it disable TLS verification?
- Does it log secrets/PII/token material?
- Does it rely on sleeps for synchronization?
- Does it store context in struct or use context as DI container?
- Does it add reflection/generics/unsafe without strong justification?
- Does it hide transaction ownership?
- Does it leak transport/persistence DTOs into domain logic?
- Does it lack tests for failure/cancellation/boundary behavior?
- Does it modify public API/wire contract without compatibility note?

---

## 22. Preferred Replacement Map

| Anti-pattern                  | Replacement                                        |
| ----------------------------- | -------------------------------------------------- |
| `utils` package               | domain/capability package                          |
| global mutable config         | explicit config passed at construction             |
| `http.Get`                    | injected `*http.Client` + context + timeout        |
| `panic(err)`                  | return typed/wrapped error                         |
| `map[string]any` domain model | typed struct + validation                          |
| string-matched errors         | `errors.Is` / `errors.As` / typed classification   |
| fire-and-forget goroutine     | owned worker with context and wait path            |
| unbounded `io.ReadAll`        | bounded read/streaming decoder                     |
| SQL concatenation             | parameterized query + allowlisted identifiers      |
| UI-only authorization         | application/domain authorization invariant         |
| `fmt.Println` logging         | structured log with bounded fields                 |
| sleep in test                 | deterministic synchronization/fake clock           |
| generic CRUD repository       | explicit store/query method per aggregate/use case |
| reflection mapper             | explicit mapper or generated mapper                |
| offset pagination by default  | keyset pagination when dataset is large/unstable   |

---

## 23. Merge Gate Statement

A Go change MUST be rejected when it introduces any anti-pattern in this document without a documented exception approved by the maintainer.

The LLM/code agent MUST prefer small, explicit, boring Go over clever abstractions.

The best Go code is usually the code where ownership, error handling, cancellation, and invariants are obvious at the call site.

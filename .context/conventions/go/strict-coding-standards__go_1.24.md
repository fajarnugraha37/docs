# Strict Coding Standards — Go 1.24

> Mandatory engineering conventions for LLM-assisted implementation, code generation, refactoring, and review in Go 1.24 codebases.

---

## 0. Scope

This document defines strict coding standards for Go services, libraries, CLIs, background workers, and internal tooling that target **Go 1.24**.

The intended reader is both:

1. a human engineer reviewing Go code, and
2. an LLM/code agent that must generate, modify, and review Go code safely.

This is not a beginner tutorial. It is an implementation contract.

---

## 1. Source Baseline

Use this document together with the following canonical references:

- Go 1.24 release notes: <https://go.dev/doc/go1.24>
- Go language specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go Test Comments: <https://go.dev/wiki/TestComments>
- Go Modules Reference: <https://go.dev/ref/mod>
- go.mod reference: <https://go.dev/doc/modules/gomod-ref>
- Organizing a Go module: <https://go.dev/doc/modules/layout>
- Go toolchains: <https://go.dev/doc/toolchain>
- Go doc comments: <https://go.dev/doc/comment>
- Go vulnerability management: <https://go.dev/doc/security/vuln/>
- Go fuzzing: <https://go.dev/doc/security/fuzz/>
- `log/slog`: <https://pkg.go.dev/log/slog>

If this document conflicts with the Go language specification or the current Go 1.24 documentation, the official Go documentation wins.

---

## 2. Normative Language

The following words are binding:

- **MUST**: required. Code that violates it must not be merged.
- **MUST NOT**: forbidden unless an explicit exception is documented in code review.
- **SHOULD**: required by default; deviation requires reason.
- **MAY**: allowed, but not required.
- **LLM MUST**: a rule specifically targeting agent behavior.

---

## 3. Prime Directive for LLMs

LLM-generated Go code must optimize for correctness, maintainability, concurrency safety, operational clarity, and minimal surprise.

LLM MUST NOT:

- invent packages, APIs, symbols, config keys, or project conventions that do not exist;
- silently change public API contracts;
- add dependencies without explaining why the standard library is insufficient;
- hide errors, ignore cancellation, or swallow panics;
- produce code that only compiles in the happy path while leaving concurrency, timeout, rollback, and partial failure behavior undefined;
- replace simple Go with unnecessary abstraction, framework patterns, or Java/C#-style layering unless the existing project already uses that shape.

LLM MUST:

- inspect `go.mod`, existing package layout, naming, error conventions, logging conventions, and tests before modifying code;
- preserve existing architectural boundaries unless the requested change explicitly asks to redesign them;
- prefer small, reviewable changes;
- include tests for behavior changes;
- run or specify the exact validation commands required before merge;
- state assumptions when information is missing.

---

## 4. Version and Toolchain Standards

### 4.1 Go version

A Go 1.24 module MUST declare a compatible `go` directive:

```go.mod
module example.com/company/service

go 1.24
```

Rules:

- `go.mod` MUST be present at the module root.
- The `go` directive MUST represent the language semantics the module assumes.
- For Go 1.24 projects, new Go 1.25+ language/library features MUST NOT be used unless the module is intentionally upgraded.
- LLM MUST NOT upgrade `go.mod` from Go 1.24 to a newer version unless explicitly requested.
- LLM MUST NOT downgrade the `go` directive to bypass compile or lint issues.

### 4.2 Toolchain directive

For reproducible local and CI behavior, a main module MAY declare a specific toolchain:

```go.mod
toolchain go1.24.13
```

Rules:

- Use an approved Go 1.24 patch version from the organization/toolchain image.
- If CI pins Go via Docker image, `actions/setup-go`, Bazel, asdf, mise, or internal buildpacks, the toolchain directive MUST NOT contradict CI.
- Do not add `toolchain` merely to satisfy local machine convenience.
- If `GOTOOLCHAIN=local` is used in CI, CI image MUST already contain the required version.

### 4.3 Go 1.24 tool dependencies

Go 1.24 supports executable tool dependencies via `tool` directives in `go.mod`. Prefer this over the older `tools.go` blank-import pattern for new modules.

Example:

```bash
go get -tool golang.org/x/vuln/cmd/govulncheck@latest
go get -tool honnef.co/go/tools/cmd/staticcheck@latest
```

Then run:

```bash
go tool govulncheck ./...
go tool staticcheck ./...
```

Rules:

- Project tools SHOULD be declared as module tool dependencies when the project needs reproducible tool execution.
- Do not keep both `tools.go` blank imports and `tool` directives for the same tools unless migration is in progress.
- Tool upgrades MUST be reviewed like dependency upgrades.
- LLM MUST NOT add tool dependencies for one-off local convenience.

---

## 5. Mandatory Validation Gates

Every non-trivial change MUST pass these gates before merge:

```bash
gofmt -w .
go mod tidy
go test ./...
go vet ./...
govulncheck ./...
```

Recommended stricter gate:

```bash
go test -race ./...
go test -count=1 ./...
staticcheck ./...
golangci-lint run ./...
```

For CI that must not modify files:

```bash
test -z "$(gofmt -l .)"
go mod tidy -diff
go test ./...
go vet ./...
govulncheck ./...
```

Rules:

- CI MUST fail on formatting drift.
- CI MUST fail on `go vet` findings.
- CI MUST fail on dependency graph inconsistency.
- CI SHOULD run `govulncheck` at least on main branch, release branch, and pull request paths that change dependencies or security-sensitive code.
- CI SHOULD run `go test -race ./...` for packages with concurrency, HTTP servers, background workers, caches, channels, goroutines, maps shared across goroutines, or database transaction orchestration.
- LLM MUST include validation commands in its final implementation notes when it changes code.

---

## 6. Formatting, Imports, and File Hygiene

### 6.1 Formatting

Go formatting is not subjective.

Rules:

- All Go files MUST be formatted with `gofmt`.
- Imports SHOULD be organized with `goimports` or equivalent IDE integration.
- Do not manually align fields, assignments, or comments in a way that fights `gofmt`.
- Do not use custom formatting conventions.

### 6.2 Import rules

Rules:

- Imports MUST be minimal.
- Unused imports MUST NOT exist.
- Dot imports MUST NOT be used except in narrowly justified external test packages where they materially improve readability.
- Blank imports MUST only be used for documented side effects and MUST have a comment explaining the side effect unless it is a well-known driver registration pattern.
- Aliased imports MUST only be used to resolve name conflicts or improve clarity.

Bad:

```go
import . "fmt"
```

Good:

```go
import "fmt"
```

### 6.3 Generated code

Generated files MUST contain a standard generated-code marker near the top:

```go
// Code generated by <tool>; DO NOT EDIT.
```

Rules:

- LLM MUST NOT manually edit generated code unless explicitly requested and the generator is unavailable.
- If generated code must change, update the source schema/template and regenerate.
- Generated files SHOULD be excluded from human style nitpicks but MUST still compile.

---

## 7. Package and Module Layout

### 7.1 Package purpose

A Go package MUST have a clear, narrow purpose. Package boundaries are semantic boundaries, not folders for arbitrary layering.

Rules:

- Package names MUST be short, lowercase, and meaningful.
- Package names MUST NOT use underscores, hyphens, or mixedCaps.
- Package names SHOULD describe what the package provides, not generic architecture layers.
- Avoid package names such as `common`, `utils`, `helpers`, `base`, `core`, `misc`.
- If a package cannot be named without generic words, the boundary is probably wrong.

Bad:

```text
internal/common
internal/helpers
internal/utils
```

Better:

```text
internal/clock
internal/retry
internal/auditlog
internal/tenant
internal/idempotency
```

### 7.2 `internal` usage

Rules:

- Use `internal/` to prevent accidental external import of implementation packages.
- Public reusable library APIs MAY live outside `internal/` only when they are intended to be imported by other modules.
- Application-specific implementation MUST usually live under `internal/`.

Recommended service shape:

```text
service-root/
  go.mod
  cmd/service/main.go
  internal/config/
  internal/httpapi/
  internal/domain/
  internal/store/
  internal/worker/
  internal/telemetry/
  migrations/
  testdata/
```

Rules:

- `cmd/<binary>/main.go` MUST be thin.
- `main` MUST wire dependencies, start processes, handle shutdown, and return errors.
- Business logic MUST NOT be embedded in `main`.

### 7.3 Avoid fake enterprise layering

Go code MUST NOT blindly copy Java/Spring/C# layering patterns.

Avoid:

```text
controller/service/repository/dto/mapper/factory/manager
```

unless those names reflect real domain responsibilities.

Preferred:

- name packages by domain capability;
- keep interfaces near consumers;
- keep concrete types near implementation;
- avoid one-method pass-through layers.

---

## 8. Naming Standards

### 8.1 General naming

Rules:

- Names MUST be clear at the point of use.
- Short names are acceptable for small scopes: `i`, `n`, `r`, `w`, `ctx`, `err`.
- Longer names are required for broader scopes.
- Do not use Hungarian notation or type suffixes unless idiomatic (`HTTPServer`, `URL`, `ID`).
- Initialisms MUST be consistently capitalized: `ID`, `URL`, `HTTP`, `JSON`, `SQL`, `API`, `TLS`, `UUID`.

Bad:

```go
var userId string
func getHttpUrl() string
```

Good:

```go
var userID string
func getHTTPURL() string
```

### 8.2 Package names

Rules:

- Package names MUST be singular unless plural is idiomatic or domain-specific.
- Package names MUST not repeat the module name unnecessarily.
- Package names MUST not force stutter at call sites.

Bad:

```go
package user

func UserCreate(...) {}
```

Good:

```go
package user

func Create(...) {}
```

Call site:

```go
user.Create(...)
```

### 8.3 Interface names

Rules:

- Single-method interfaces SHOULD use `-er`: `Reader`, `Writer`, `Clock`, `Signer`.
- Interfaces SHOULD be defined by the consuming package, not the producing package.
- Do not create interfaces just because a concrete type exists.
- Do not create `IUserRepository`, `UserRepositoryInterface`, or similar names.

Bad:

```go
type IUserRepository interface {
    FindUser(ctx context.Context, id string) (*User, error)
}
```

Good:

```go
type UserStore interface {
    FindUser(ctx context.Context, id string) (*User, error)
}
```

### 8.4 Error names

Rules:

- Sentinel errors MUST be named `ErrXxx`.
- Error types MUST be named `XxxError` only when callers need structured access.
- Error values MUST start lowercase unless they begin with a proper noun.
- Error messages MUST NOT end with punctuation.

Good:

```go
var ErrNotFound = errors.New("not found")
```

---

## 9. Comments and Documentation

### 9.1 Comments explain intent

Rules:

- Comments MUST explain why, invariants, constraints, or non-obvious behavior.
- Comments MUST NOT restate obvious code.
- Public identifiers SHOULD have doc comments unless they are trivial or internal policy allows otherwise.
- Package comments SHOULD exist for non-trivial packages.

Bad:

```go
// Increment i by one.
i++
```

Good:

```go
// The external API accepts page numbers starting from 1, while the store uses zero-based offsets.
offset := (page - 1) * limit
```

### 9.2 Doc comment style

Public declaration comments SHOULD start with the identifier name.

Good:

```go
// Store persists and retrieves enforcement cases.
type Store struct { ... }
```

### 9.3 TODO format

TODOs MUST be actionable and owned.

Good:

```go
// TODO(auth): remove legacy role mapping after all tenants migrate to policy v2.
```

Bad:

```go
// TODO fix later
```

---

## 10. API and Function Design

### 10.1 Function size and responsibility

Rules:

- A function MUST do one coherent thing.
- A function SHOULD fit on one screen unless it is a simple linear orchestration.
- Deep nesting MUST be reduced using guard clauses.
- Avoid boolean parameters that obscure call sites.

Bad:

```go
process(user, true, false)
```

Good:

```go
process(user, ProcessOptions{
    SendNotification: true,
    DryRun:           false,
})
```

### 10.2 Return values

Rules:

- Return concrete types by default.
- Return interfaces only when the caller should not know the implementation or when the standard library idiom expects an interface.
- Do not return pointers to interfaces.
- Prefer `(T, error)` for operations that can fail.
- Prefer `(T, bool)` for map-like lookups where absence is expected and not exceptional.

### 10.3 Options pattern

Use an options struct when there are multiple optional parameters or when parameter meaning is unclear.

Good:

```go
type RetryOptions struct {
    MaxAttempts int
    BaseDelay   time.Duration
    MaxDelay    time.Duration
}
```

Rules:

- Options structs MUST have documented zero-value behavior.
- Functional options MAY be used for public libraries but MUST NOT be used merely for fashion.
- For internal services, plain options structs are usually clearer.

### 10.4 Zero value

Types SHOULD be useful or safe in their zero value where practical.

If zero value is not valid, constructors MUST validate required dependencies.

Good:

```go
func NewProcessor(store Store, logger *slog.Logger) (*Processor, error) {
    if store == nil {
        return nil, errors.New("store is required")
    }
    if logger == nil {
        logger = slog.Default()
    }
    return &Processor{store: store, logger: logger}, nil
}
```

---

## 11. Error Handling

### 11.1 Errors are values

Rules:

- Every returned error MUST be checked unless explicitly and safely ignored.
- Ignored errors MUST be documented.
- Do not use panic for expected operational failures.
- Do not log and return the same error at the same layer unless adding local context that will not be duplicated upstream.
- Error handling MUST preserve programmatic semantics where callers need to branch.

Bad:

```go
file.Close()
```

Good:

```go
if err := file.Close(); err != nil {
    return fmt.Errorf("close report file: %w", err)
}
```

Acceptable ignore:

```go
_, _ = io.Copy(io.Discard, resp.Body) // best-effort drain before close
```

### 11.2 Error wrapping

Rules:

- Use `fmt.Errorf("context: %w", err)` to preserve the cause.
- Error messages MUST add useful context.
- Do not wrap when it would break intended sentinel matching and no alternative is provided.
- Use `errors.Is` and `errors.As` for matching wrapped errors.

Good:

```go
user, err := store.FindUser(ctx, userID)
if err != nil {
    return nil, fmt.Errorf("find user %q: %w", userID, err)
}
```

### 11.3 Sentinel errors

Rules:

- Use sentinel errors for stable, package-level conditions callers may test.
- Do not expose a sentinel for every internal failure.
- Do not compare errors with `==` outside the package unless the API explicitly requires it; use `errors.Is`.

Good:

```go
if errors.Is(err, user.ErrNotFound) {
    return http.StatusNotFound
}
```

### 11.4 Structured error types

Use structured error types when callers need fields.

```go
type ValidationError struct {
    Field string
    Rule  string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s violates %s", e.Field, e.Rule)
}
```

Rules:

- Error types MUST be immutable after return.
- Error types MUST NOT expose sensitive values through `Error()`.

---

## 12. Context Standards

### 12.1 Context propagation

Rules:

- Functions that perform I/O, blocking operations, RPC, database calls, subprocess execution, lock acquisition with timeout, or background work MUST accept `context.Context`.
- `context.Context` MUST be the first parameter, conventionally named `ctx`.
- Do not store context in structs except for request-scoped structs with very strong justification.
- Do not pass `nil` context.
- Use `context.Background()` only at process roots, tests, and explicit detached operations.
- Use `context.TODO()` only as a temporary marker and not in final production code.

Good:

```go
func (s *Store) FindCase(ctx context.Context, caseID string) (*Case, error) {
    row := s.db.QueryRowContext(ctx, queryFindCase, caseID)
    // ...
}
```

### 12.2 Cancellation

Rules:

- Long-running loops MUST observe `ctx.Done()`.
- Goroutines started for a request MUST stop when the request context is canceled.
- Timeout creation MUST call cancel to release resources.

Good:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

### 12.3 Context values

Rules:

- Context values MUST only carry request-scoped metadata, not optional parameters.
- Context keys MUST use unexported custom types to avoid collisions.
- Do not store loggers, database handles, config, or business objects in context unless the project has an established convention and the value is truly request-scoped.

---

## 13. Concurrency and Goroutine Safety

### 13.1 Goroutine ownership

Every goroutine MUST have a clear owner, lifecycle, cancellation path, and error path.

Bad:

```go
go func() {
    doWork()
}()
```

Good:

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

- Do not start goroutines without a shutdown plan.
- Do not ignore goroutine errors.
- Do not write to shared memory from goroutines without synchronization.
- Do not use `time.Sleep` for synchronization.
- Do not use unbounded goroutine fan-out.
- Use bounded concurrency for batch processing.

### 13.2 Channels

Rules:

- Use channels for ownership transfer, signaling, and pipeline coordination.
- Do not use channels as a substitute for every lock.
- The sender should usually close the channel.
- Receivers MUST handle closed channels correctly.
- Do not close a channel from the receiver side unless the receiver owns the channel.
- Do not close a channel with multiple senders unless closure is coordinated.

Good:

```go
for item := range items {
    if err := process(ctx, item); err != nil {
        return err
    }
}
```

### 13.3 Mutexes

Rules:

- Use `sync.Mutex` for protecting shared mutable state.
- Do not copy a value containing `sync.Mutex`, `sync.RWMutex`, `sync.Once`, `sync.WaitGroup`, or other lock-like state after first use.
- Keep critical sections small.
- Never call external callbacks while holding a lock unless explicitly documented.
- Do not use `defer mu.Unlock()` in extremely hot loops without measuring overhead; otherwise prefer it for safety.

Good:

```go
type Cache struct {
    mu    sync.RWMutex
    items map[string]Item
}

func (c *Cache) Get(key string) (Item, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    item, ok := c.items[key]
    return item, ok
}
```

### 13.4 Maps and shared memory

Rules:

- Built-in maps MUST NOT be read and written concurrently without synchronization.
- Use `sync.Map` only for its intended cases: high-read caches, disjoint-key concurrent access, or cases where lock contention is measured and problematic.
- Do not assume Go 1.24 Swiss-map performance changes remove synchronization requirements.

### 13.5 `testing/synctest`

Go 1.24 includes experimental `testing/synctest` behind `GOEXPERIMENT=synctest`.

Rules:

- Production tests MUST NOT depend on experimental APIs unless the module explicitly opts into the experiment.
- If `testing/synctest` is used, the test package MUST document that the API is experimental and may change.
- Do not use experimental packages in library public APIs.

---

## 14. HTTP and Network Standards

### 14.1 HTTP client

Rules:

- Do not use `http.Get`, `http.Post`, or default client in production code unless a timeout is guaranteed elsewhere.
- Use `http.Client` with timeout and transport configuration.
- Requests MUST use context.
- Response bodies MUST be closed.
- Non-2xx responses MUST be handled explicitly.
- External calls MUST have bounded timeout, retry policy, and observability.

Good:

```go
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
if err != nil {
    return nil, fmt.Errorf("create request: %w", err)
}

resp, err := c.http.Do(req)
if err != nil {
    return nil, fmt.Errorf("send request: %w", err)
}
defer resp.Body.Close()

if resp.StatusCode < 200 || resp.StatusCode >= 300 {
    return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
}
```

### 14.2 HTTP server

Rules:

- Servers MUST configure read, write, idle, and header timeouts.
- Handlers MUST respect `r.Context()`.
- Handlers MUST not leak goroutines after client disconnect.
- Request bodies MUST be bounded when reading untrusted input.
- Error responses MUST not leak sensitive internals.

Good:

```go
srv := &http.Server{
    Addr:              cfg.Addr,
    Handler:           handler,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       15 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
}
```

### 14.3 Go 1.24 HTTP protocol configuration

Go 1.24 adds `Server.Protocols` and `Transport.Protocols` for protocol configuration.

Rules:

- Do not enable unencrypted HTTP/2 (`h2c` prior-knowledge style) unless explicitly required by internal infrastructure and threat model.
- If HTTP/2 settings are changed, document compatibility, proxy, ALB/NLB, sidecar, and client behavior.
- Do not rely on deprecated `Upgrade: h2c` behavior.

---

## 15. Filesystem and Path Security

### 15.1 Path handling

Rules:

- Never concatenate paths with string operations.
- Use `path/filepath` for OS paths.
- Use `path` for slash-separated paths such as URLs or embedded file systems.
- Clean and validate untrusted paths.
- Do not trust user-supplied filenames.

### 15.2 Go 1.24 `os.Root`

Go 1.24 introduces `os.Root` for directory-limited filesystem access.

Rules:

- Use `os.Root`/`os.OpenRoot` for operations that must be confined to a directory when path input may be influenced by users, archives, plugins, or external systems.
- Do not implement ad-hoc path sandboxing with only `filepath.Clean` and prefix checks when symlinks may exist.
- Document what directory boundary is being enforced.

Recommended pattern:

```go
root, err := os.OpenRoot(baseDir)
if err != nil {
    return fmt.Errorf("open root %q: %w", baseDir, err)
}
defer root.Close()

f, err := root.Open(userPath)
if err != nil {
    return fmt.Errorf("open file inside root: %w", err)
}
defer f.Close()
```

---

## 16. JSON, Encoding, and API Payloads

### 16.1 JSON contracts

Rules:

- Public API DTOs MUST define explicit JSON tags.
- Do not rely on default field-name encoding for public contracts.
- Unknown fields SHOULD be rejected for command/write APIs unless backward compatibility requires otherwise.
- Use `json.Decoder` for streams and large payloads.
- Bound request body size before decoding.

Good:

```go
dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
dec.DisallowUnknownFields()

var req CreateCaseRequest
if err := dec.Decode(&req); err != nil {
    return fmt.Errorf("decode request: %w", err)
}
```

### 16.2 `omitempty` vs `omitzero`

Go 1.24 adds `omitzero` for JSON struct tags.

Rules:

- Use `omitzero` when the intent is to omit zero values.
- Prefer `omitzero` over `omitempty` for `time.Time` fields where zero time should be omitted.
- Do not use `omitempty` for fields where false, zero, or empty string are semantically meaningful.
- For PATCH semantics, use pointer fields or explicit optional types to distinguish absent from zero.

Example:

```go
type CaseResponse struct {
    ID        string    `json:"id"`
    ClosedAt  time.Time `json:"closedAt,omitzero"`
    IsUrgent  bool      `json:"isUrgent"`
}
```

### 16.3 Encoding appender interfaces

Go 1.24 introduces `encoding.TextAppender` and `encoding.BinaryAppender`.

Rules:

- Use appender-style APIs only in allocation-sensitive paths where measurement shows value.
- Do not introduce complex custom appenders for ordinary application code.
- Preserve simple `MarshalText`/`MarshalBinary` APIs unless allocation reduction is a real requirement.

---

## 17. Cryptography and Security

### 17.1 General crypto rules

Rules:

- Prefer the Go standard library crypto packages.
- Do not implement custom cryptographic algorithms.
- Do not use deprecated or unauthenticated modes for new encryption.
- Use AEAD modes for symmetric encryption.
- Do not use `math/rand` for secrets, tokens, IDs, keys, nonces, salts, or authentication material.
- Use `crypto/rand` for security randomness.
- Do not log secrets, tokens, keys, credentials, session IDs, or private claims.

### 17.2 Go 1.24 crypto changes

Rules:

- Use `crypto/hkdf`, `crypto/pbkdf2`, and `crypto/sha3` standard library packages in Go 1.24 instead of importing `golang.org/x/crypto/...` equivalents for new code.
- Do not use RSA keys smaller than 2048 bits for new systems. Go 1.24 rejects RSA keys below 1024 bits; organizational policy should be stricter.
- Do not use SHA-1 certificate signatures. Go 1.24 `crypto/x509` no longer supports SHA-1 based signatures in `Certificate.Verify`.
- Prefer `cipher.NewGCMWithRandomNonce` where random nonce generation and ciphertext format match the system contract.
- Do not use deprecated OFB/CFB helpers for new code; use AEAD modes.
- Be aware that Go 1.24 enables post-quantum `X25519MLKEM768` by default when TLS curve preferences are nil. If disabled for compatibility, document the reason.

### 17.3 FIPS mode

Go 1.24 includes FIPS 140-3 mechanisms.

Rules:

- Do not claim FIPS compliance merely because code is built with Go 1.24.
- If FIPS mode is required, document build environment, `GOFIPS140`, runtime `GODEBUG` settings, approved algorithms, deployment target, and validation status.
- LLM MUST NOT add FIPS claims to docs or comments unless the project explicitly requires and validates them.

### 17.4 Randomness

Rules:

- `crypto/rand.Read` in Go 1.24 is guaranteed not to return an error with the default reader, but code MAY still use APIs that return errors for compatibility and custom readers.
- Do not override `crypto/rand.Reader` outside tests.
- Test overrides MUST be isolated and restored.

---

## 18. Logging and Observability

### 18.1 Structured logging

Use `log/slog` for new standard-library-based logging unless the project already standardizes on another logger.

Rules:

- Logs MUST be structured for services.
- Logs MUST include stable keys.
- Logs MUST avoid high-cardinality values unless intentionally needed.
- Logs MUST not contain secrets, raw PII, tokens, passwords, private keys, or full request bodies.
- Do not log and return the same error repeatedly across layers.
- Log at boundaries: request entry/exit, external calls, background job lifecycle, retry exhaustion, state transitions, security-relevant decisions.

Good:

```go
logger.InfoContext(ctx, "case transition completed",
    slog.String("case_id", caseID),
    slog.String("from_state", from),
    slog.String("to_state", to),
)
```

### 18.2 Logger injection

Rules:

- Libraries SHOULD accept a logger only if they produce operational logs.
- If logger is optional, nil MUST safely default to `slog.Default()` or a discard handler.
- Do not store loggers in context unless the project has a strict request-scoped logging convention.

### 18.3 Metrics and tracing

Rules:

- Instrument external I/O, queue processing, background jobs, retries, and state transitions.
- Metrics names and labels MUST be low-cardinality.
- Do not use unbounded user input as metric labels.
- Trace spans SHOULD include errors and important state boundaries but MUST not include secrets.

---

## 19. Database and Transaction Standards

### 19.1 Context-aware database operations

Rules:

- Use `QueryContext`, `QueryRowContext`, `ExecContext`, and transaction APIs that accept context.
- Database calls MUST have request or operation timeouts.
- Rows MUST be closed.
- `rows.Err()` MUST be checked after iteration.
- SQL errors MUST be wrapped with operation context but not full sensitive SQL values.

Good:

```go
rows, err := db.QueryContext(ctx, query, tenantID)
if err != nil {
    return fmt.Errorf("query active cases: %w", err)
}
defer rows.Close()

for rows.Next() {
    // scan
}
if err := rows.Err(); err != nil {
    return fmt.Errorf("iterate active cases: %w", err)
}
```

### 19.2 Transactions

Rules:

- Transactions MUST be bounded by context.
- Rollback MUST be deferred immediately after successful begin.
- Commit errors MUST be returned.
- Do not perform slow external network calls inside DB transactions unless explicitly required.
- Transaction functions SHOULD make ownership clear.

Good:

```go
tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
if err != nil {
    return fmt.Errorf("begin transaction: %w", err)
}
defer tx.Rollback()

if err := updateCase(ctx, tx, cmd); err != nil {
    return err
}

if err := tx.Commit(); err != nil {
    return fmt.Errorf("commit transaction: %w", err)
}
```

### 19.3 SQL construction

Rules:

- Use parameterized queries.
- Do not concatenate user input into SQL.
- Dynamic identifiers MUST be whitelisted.
- Query builders are acceptable only when they improve safety or readability.
- Migrations MUST be versioned, repeatable in CI, and backward-compatible for rolling deployments unless downtime is explicitly planned.

---

## 20. Testing Standards

### 20.1 Test structure

Rules:

- Tests MUST be deterministic.
- Tests MUST not depend on execution order.
- Tests MUST avoid real time sleeps; use fake clocks, controlled channels, or contexts.
- Tests MUST isolate filesystem, environment variables, network ports, and global state.
- Test helpers that accept `*testing.T` MUST call `t.Helper()`.
- Prefer standard `testing` package unless the project has an approved test framework.

### 20.2 Table-driven tests

Use table-driven tests when cases share the same logic.

Good:

```go
func TestNormalizeStatus(t *testing.T) {
    tests := []struct {
        name string
        in   string
        want Status
    }{
        {name: "open lowercase", in: "open", want: StatusOpen},
        {name: "trim spaces", in: " closed ", want: StatusClosed},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := NormalizeStatus(tt.in)
            if got != tt.want {
                t.Fatalf("NormalizeStatus(%q) = %v, want %v", tt.in, got, tt.want)
            }
        })
    }
}
```

Rules:

- Test case names MUST be human-readable.
- Failure messages SHOULD include function name, input, got, and want.
- Prefer `got, want` wording.
- Use `t.Error` instead of `t.Fatal` when subsequent checks can still provide useful information.
- Use `t.Fatal` for setup failure or when continuing would panic/mislead.

### 20.3 Assertions

Rules:

- Avoid assertion libraries by default.
- For complex object comparison, use `go-cmp` if approved by project.
- Prefer semantic comparison over exact string comparison for JSON, maps, and serialized output where order is not contractually fixed.
- Do not use `reflect.DeepEqual` blindly for complex structures if semantic equality matters.

### 20.4 Error tests

Rules:

- Test error semantics using `errors.Is` or `errors.As` when API exposes structured/sentinel errors.
- Do not assert exact full error strings unless the string is a documented user-facing contract.
- Test both success and failure paths.

### 20.5 Go 1.24 `T.Context` and `B.Context`

Go 1.24 adds `testing.T.Context()` and `testing.B.Context()`.

Rules:

- Prefer `t.Context()` for test-scoped contexts that should be canceled when the test ends.
- Prefer `b.Context()` in benchmarks that need context.
- Do not use a never-canceled `context.Background()` in tests for operations that should observe cancellation.

### 20.6 Go 1.24 `T.Chdir` and `B.Chdir`

Rules:

- Prefer `t.Chdir(dir)` over manual `os.Chdir` in tests.
- Do not change process working directory in parallel tests unless isolated and supported by `testing` semantics.

### 20.7 Fuzzing

Rules:

- Fuzz targets MUST be fast and deterministic.
- Fuzz targets MUST not depend on global mutable state.
- Fuzz targets MUST not perform unbounded I/O, network calls, sleeps, or non-deterministic operations.
- Add seed corpus for known edge cases.
- Fuzz parsers, decoders, validators, tokenizers, state-transition guards, and security-sensitive normalization logic.

Example:

```go
func FuzzParseCaseID(f *testing.F) {
    f.Add("CASE-2026-0001")
    f.Fuzz(func(t *testing.T, input string) {
        _, _ = ParseCaseID(input)
    })
}
```

---

## 21. Benchmarking and Performance

### 21.1 Benchmark correctness

Rules:

- Benchmarks MUST measure realistic code paths.
- Benchmark setup MUST not be included in the measured loop unless intended.
- Results MUST not be optimized away.
- Use `b.ReportAllocs()` for allocation-sensitive code.
- Avoid benchmarking with global mutable state unless reset per benchmark.

### 21.2 Go 1.24 `testing.B.Loop`

Prefer `b.Loop()` for new Go 1.24 benchmarks.

Good:

```go
func BenchmarkNormalizeStatus(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        _ = NormalizeStatus(" closed ")
    }
}
```

Rules:

- Use `b.Loop()` for cleaner benchmark loops in Go 1.24+.
- Do not mix `b.N` and `b.Loop()` in the same benchmark.
- Keep expensive setup outside the benchmark loop unless intentionally measured.

### 21.3 Allocation discipline

Rules:

- Do not prematurely optimize ordinary application code.
- In hot paths, avoid unnecessary allocations, conversions, reflection, and interface boxing.
- Prefer `strings.Builder` or `bytes.Buffer` for repeated concatenation.
- Preallocate slices when final size or safe upper bound is known.
- Avoid `fmt.Sprintf` in hot paths unless formatting is required and measured acceptable.
- Use Go 1.24 iterator helpers such as `strings.Lines`, `strings.FieldsSeq`, `bytes.SplitSeq`, etc., when they simplify streaming-style iteration and reduce allocation pressure.

---

## 22. Generics and Type System

### 22.1 Use generics sparingly

Rules:

- Use generics when they remove real duplication across types while preserving readability.
- Do not use generics to simulate inheritance, dependency injection containers, or framework-style abstractions.
- Constraint names MUST be clear.
- Public generic APIs MUST document type parameter expectations.

Good:

```go
func Ptr[T any](v T) *T {
    return &v
}
```

Bad:

```go
type AbstractService[TRepository any, TEntity any, TDTO any] struct { ... }
```

### 22.2 Generic type aliases in Go 1.24

Go 1.24 fully supports generic type aliases.

Rules:

- Use generic type aliases for migration, compatibility, or package-boundary refactoring where preserving type identity matters.
- Do not use aliases to hide confusing domain types.
- Prefer defined types when the new type needs methods, validation semantics, or stronger domain meaning.

Example:

```go
type Set[T comparable] = map[T]struct{}
```

Use carefully: aliases do not create new named types.

---

## 23. Data Modeling and Domain Invariants

Rules:

- Domain state MUST be represented explicitly.
- Invalid states SHOULD be unrepresentable where practical.
- Do not model everything as `string`, `int`, or `map[string]any`.
- Use typed constants for stable enumerations.
- Validate at system boundaries.
- Preserve invariants inside constructors or transition methods.

Good:

```go
type CaseStatus string

const (
    CaseStatusDraft     CaseStatus = "DRAFT"
    CaseStatusSubmitted CaseStatus = "SUBMITTED"
    CaseStatusClosed    CaseStatus = "CLOSED"
)

func (s CaseStatus) CanTransitionTo(next CaseStatus) bool {
    switch s {
    case CaseStatusDraft:
        return next == CaseStatusSubmitted
    case CaseStatusSubmitted:
        return next == CaseStatusClosed
    default:
        return false
    }
}
```

Rules:

- State transitions MUST be centralized for regulated workflows.
- Do not scatter state-transition rules across handlers, repositories, and UI mappers.
- Audit-relevant transitions MUST produce traceable events/logs.

---

## 24. Interface and Dependency Design

### 24.1 Interface placement

Rules:

- Define interfaces where they are consumed.
- Accept interfaces, return concrete types by default.
- Do not create an interface with a single implementation unless needed for testing, boundary isolation, or future extension already known.
- Keep interfaces small.

### 24.2 Dependency injection

Rules:

- Prefer explicit constructor injection.
- Avoid global mutable dependencies.
- Do not introduce reflection-based containers.
- Do not hide dependencies behind package-level singletons.

Good:

```go
type Service struct {
    store  Store
    clock  Clock
    logger *slog.Logger
}

func NewService(store Store, clock Clock, logger *slog.Logger) (*Service, error) {
    if store == nil {
        return nil, errors.New("store is required")
    }
    if clock == nil {
        clock = systemClock{}
    }
    if logger == nil {
        logger = slog.Default()
    }
    return &Service{store: store, clock: clock, logger: logger}, nil
}
```

---

## 25. Configuration Standards

Rules:

- Configuration MUST be explicit and validated at startup.
- Missing required config MUST fail fast.
- Config parsing MUST be separated from business logic.
- Do not read environment variables throughout the codebase.
- Durations MUST use `time.Duration` after parsing.
- Secrets MUST not be logged.

Good:

```go
type Config struct {
    Addr         string
    DatabaseURL  string
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
}

func (c Config) Validate() error {
    if c.Addr == "" {
        return errors.New("addr is required")
    }
    if c.DatabaseURL == "" {
        return errors.New("database url is required")
    }
    return nil
}
```

---

## 26. CLI Standards

Rules:

- `main` MUST be thin and delegate to `run(ctx, args, env)` or equivalent.
- CLI functions MUST return errors instead of calling `os.Exit` deep in code.
- `os.Exit` MAY only occur in `main`.
- Use `flag` standard library unless project requirements justify another parser.
- CLI output MUST separate machine-readable output from human logs.
- Long-running CLI commands MUST support cancellation.

Good:

```go
func main() {
    if err := run(context.Background(), os.Args[1:], os.Stdout, os.Stderr); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

---

## 27. Panic and Recovery

Rules:

- Panic MUST NOT be used for expected business or I/O errors.
- Panic MAY be used for impossible programmer errors, package initialization invariants, or truly unrecoverable states.
- HTTP middleware MAY recover panics at process boundaries to protect availability, but MUST log the panic safely and return generic error responses.
- Recovery MUST NOT allow corrupted state to continue silently.

Bad:

```go
if err != nil {
    panic(err)
}
```

Good:

```go
if err != nil {
    return fmt.Errorf("load config: %w", err)
}
```

---

## 28. Unsafe, Reflection, and Cgo

### 28.1 `unsafe`

Rules:

- `unsafe` MUST NOT be used in ordinary application code.
- Any `unsafe` usage MUST have a benchmark or systems-level justification.
- Any `unsafe` usage MUST document memory safety invariants.
- Any `unsafe` usage MUST be isolated in a small package with tests.
- LLM MUST NOT introduce `unsafe` unless explicitly requested.

### 28.2 Reflection

Rules:

- Reflection MUST be avoided unless required for serialization, framework integration, code generation, or generic tooling.
- Reflection-heavy code MUST have tests for invalid inputs and panic paths.
- Prefer generics or explicit code when simpler.

### 28.3 Cgo

Rules:

- Cgo MUST be avoided unless required by platform integration or native libraries.
- Cgo calls MUST document ownership, pointer lifetime, callbacks, thread affinity, and failure behavior.
- Go 1.24 cgo `noescape`/`nocallback` annotations MUST only be used when the invariants are proven. Incorrect use can break memory safety.

---

## 29. Dependency Management

Rules:

- Prefer the standard library.
- Every new dependency MUST have a clear reason.
- Dependencies MUST be maintained, versioned, licensed, and security-reviewed.
- Do not add large frameworks for small tasks.
- Do not use abandoned packages for core paths.
- Do not commit dependency changes unrelated to the task.
- `go.mod` and `go.sum` MUST be committed together.
- `replace` directives MUST NOT point to local paths in committed production modules unless explicitly part of a workspace strategy and documented.
- Use `go mod tidy` after dependency changes.
- Use `go mod verify` in stricter CI environments where module cache integrity matters.

LLM dependency rule:

- LLM MUST explain: what dependency is added, why it is needed, why stdlib is insufficient, and what risk it introduces.

---

## 30. Build Tags and Platform Code

Rules:

- Use `//go:build` constraints, not old-only `// +build` style.
- Build constraints MUST be valid major Go versions, not point releases. Use `go1.24`, not `go1.24.1`.
- Platform-specific files SHOULD use suffixes such as `_linux.go`, `_windows.go`, `_test.go`.
- Platform-specific behavior MUST have tests or compile checks for each supported target.
- Do not hide business logic behind build tags unless required.

Good:

```go
//go:build linux
```

Bad:

```go
//go:build go1.24.1
```

---

## 31. Environment and Global State

Rules:

- Avoid package-level mutable state.
- Global variables MUST be constants, immutable tables, sentinel errors, or carefully synchronized singletons.
- Tests MUST restore environment variables using `t.Setenv`.
- Do not mutate global loggers, HTTP defaults, random sources, or time zones in library code.
- Global caches MUST have bounded size or clear lifecycle.

---

## 32. Time and Clock Handling

Rules:

- Use `time.Time` for instants and `time.Duration` for durations.
- Do not store durations as raw `int` or `string` after config parsing.
- Use UTC for persistence unless a domain explicitly requires local time.
- Do not compare formatted time strings when comparing time values.
- Inject a clock interface when logic depends on current time and needs deterministic tests.
- Do not use `time.Sleep` in tests except as a last resort with strong justification.

Good:

```go
type Clock interface {
    Now() time.Time
}
```

---

## 33. Memory, Slices, and Maps

### 33.1 Slices

Rules:

- Preallocate slices when size is known.
- Do not retain references to large backing arrays accidentally.
- Be careful when appending to slices shared with callers.
- Document whether functions mutate input slices.

Good:

```go
out := make([]Item, 0, len(in))
for _, item := range in {
    if item.Enabled {
        out = append(out, item)
    }
}
```

### 33.2 Maps

Rules:

- Check map presence using comma-ok when zero value is ambiguous.
- Do not rely on map iteration order.
- Sort keys before deterministic output.
- Do not modify maps while iterating if semantics would be unclear.

Good:

```go
v, ok := counts[key]
if !ok {
    return 0, false
}
return v, true
```

---

## 34. Security Input Validation

Rules:

- Validate input at boundaries: HTTP, CLI, message consumer, file parser, database edge, and external callbacks.
- Distinguish syntactic validation from authorization and state-transition validation.
- Normalize before validation only when normalization rules are explicit.
- Reject ambiguous input.
- Do not trust IDs, tenant IDs, role names, headers, JWT claims, or filenames solely because they are present.
- Authorization checks MUST be close to the operation being protected.

---

## 35. State Machines and Workflow Code

For lifecycle-heavy systems, state must be modeled as a first-class concept.

Rules:

- State transition rules MUST be centralized.
- Transition functions MUST validate current state, target state, actor permission, required data, and side effects.
- State changes MUST be atomic with their durable audit/event records when required by the domain.
- Transitions MUST be idempotent where external retries are possible.
- Invalid transitions MUST return semantic errors that callers can map to proper responses.
- Do not encode workflow transitions as scattered `if` statements across handlers and repositories.

Recommended shape:

```go
type TransitionCommand struct {
    CaseID string
    From   CaseStatus
    To     CaseStatus
    Actor  Actor
    Reason string
}

func (m Machine) Validate(cmd TransitionCommand) error {
    if !cmd.From.CanTransitionTo(cmd.To) {
        return ErrInvalidTransition
    }
    // authorization and required-field checks
    return nil
}
```

---

## 36. LLM Implementation Workflow

When asked to implement or modify Go code, LLM MUST follow this sequence:

1. Read `go.mod` and determine Go version, module path, and dependencies.
2. Identify existing package layout and naming conventions.
3. Locate related tests and similar implementations.
4. Determine public API impact.
5. Make the smallest coherent change.
6. Add or update tests.
7. Run or specify validation commands.
8. Explain changed behavior and risk.

LLM MUST NOT:

- mass-rewrite unrelated files;
- reformat unrelated files beyond `gofmt` on touched files unless requested;
- introduce new architecture when a local fix is enough;
- delete tests to make code pass;
- weaken validation, authorization, error handling, or concurrency controls;
- add sleeps as concurrency fixes;
- add TODOs instead of completing required behavior.

---

## 37. Code Review Checklist

A Go 1.24 change is reviewable only if the reviewer can answer yes to these questions:

### Correctness

- Does the code compile under the module's declared Go version?
- Are all errors handled or intentionally ignored with explanation?
- Are edge cases and failure paths tested?
- Are nil, zero value, empty input, timeout, cancellation, and partial failure considered?

### API design

- Are names idiomatic and clear?
- Is the package boundary coherent?
- Are interfaces small and defined at the consumer boundary?
- Does the change avoid unnecessary abstraction?

### Concurrency

- Are goroutines bounded and cancelable?
- Are shared maps/slices/state synchronized?
- Are channels closed by owners only?
- Does `go test -race` pass where relevant?

### Security

- Are inputs validated?
- Are secrets excluded from logs and errors?
- Is SQL parameterized?
- Are filesystem paths confined where needed?
- Are crypto APIs modern and standard-library based?
- Does `govulncheck` pass or are findings triaged?

### Operations

- Are logs structured and useful?
- Are metrics/traces low-cardinality?
- Are external calls bounded by timeout?
- Are shutdown and cleanup paths defined?

### Go 1.24 awareness

- Are `tool` directives used appropriately for project tools?
- Is `omitzero` used where zero-value JSON omission is intended?
- Is `os.Root` considered for directory confinement?
- Is `testing.B.Loop` used for new benchmarks?
- Are Go 1.24 vet findings fixed rather than suppressed?

---

## 38. Anti-Patterns That Must Be Rejected

The following patterns MUST be rejected in generated or reviewed code:

```go
// ignoring errors
result, _ := doThing()
```

```go
// unbounded goroutine creation
for _, item := range items {
    go process(item)
}
```

```go
// production HTTP with no timeout
resp, err := http.Get(url)
```

```go
// SQL injection risk
query := "SELECT * FROM users WHERE id = '" + userID + "'"
```

```go
// global mutable service dependency
var db *sql.DB
```

```go
// business panic
if !allowed {
    panic("not allowed")
}
```

```go
// fake abstraction
func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    return s.repo.GetUser(ctx, id)
}
```

```go
// context stored in long-lived struct
type Worker struct {
    ctx context.Context
}
```

```go
// non-deterministic map output
for k, v := range m {
    fmt.Println(k, v)
}
```

```go
// sleeps as synchronization
time.Sleep(100 * time.Millisecond)
```

---

## 39. Minimal Service Skeleton

A production service should be shaped so that startup, runtime, and shutdown behavior are explicit.

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    if err := run(); err != nil {
        slog.Error("service failed", slog.Any("error", err))
        os.Exit(1)
    }
}

func run() error {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    handler := http.NewServeMux()
    srv := &http.Server{
        Addr:              ":8080",
        Handler:           handler,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       15 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       60 * time.Second,
    }

    errCh := make(chan error, 1)
    go func() {
        logger.Info("http server starting", slog.String("addr", srv.Addr))
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            errCh <- fmt.Errorf("listen and serve: %w", err)
            return
        }
        errCh <- nil
    }()

    select {
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        if err := srv.Shutdown(shutdownCtx); err != nil {
            return fmt.Errorf("shutdown server: %w", err)
        }
        return <-errCh
    case err := <-errCh:
        return err
    }
}
```

Rules demonstrated:

- `main` delegates to `run`.
- shutdown is signal-aware;
- server timeouts are explicit;
- errors are wrapped;
- logging is structured;
- goroutine has an error path.

---

## 40. Go 1.24 Feature Adoption Rules

Use Go 1.24 features intentionally:

| Feature                                       | Default standard                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic type aliases                          | Use for migration/compatibility; avoid for domain hiding.                                                                                             |
| `go.mod tool` directive                       | Prefer for reproducible tool dependencies.                                                                                                            |
| `go build -json`, `go install -json`          | Use in CI/tooling integrations that parse build output.                                                                                               |
| `toolchaintrace=1`                            | Use for diagnosing toolchain selection, not normal runtime.                                                                                           |
| `os.Root`                                     | Prefer for directory-confined filesystem access.                                                                                                      |
| `testing.B.Loop`                              | Prefer for new benchmarks.                                                                                                                            |
| `runtime.AddCleanup`                          | Prefer over `runtime.SetFinalizer` only for resource cleanup patterns that truly need finalization. Avoid finalizers when explicit close is possible. |
| `weak` package                                | Use only for specialized caches/canonicalization; not ordinary app state.                                                                             |
| `crypto/mlkem`                                | Use only when protocol/security design requires ML-KEM.                                                                                               |
| `crypto/hkdf`, `crypto/pbkdf2`, `crypto/sha3` | Prefer stdlib packages for new code.                                                                                                                  |
| FIPS mechanisms                               | Use only under explicit compliance requirement.                                                                                                       |
| `testing/synctest`                            | Experimental; require explicit opt-in.                                                                                                                |
| `encoding/json,omitzero`                      | Prefer when omitting zero values is intended, especially `time.Time`.                                                                                 |
| `strings`/`bytes` iterator helpers            | Use when they improve clarity or allocation behavior.                                                                                                 |
| `testing.T.Context`, `testing.B.Context`      | Prefer for test-scoped contexts.                                                                                                                      |
| `testing.T.Chdir`, `testing.B.Chdir`          | Prefer over manual `os.Chdir` in tests.                                                                                                               |
| `runtime.GOROOT` deprecation                  | Do not use in new code; use `go env GOROOT` when needed by tooling.                                                                                   |

---

## 41. Required LLM Response Format for Code Changes

When an LLM completes a Go implementation, its response SHOULD include:

```text
Changed:
- <files/packages changed>

Behavior:
- <what now happens>

Validation:
- gofmt -w <files>
- go test ./...
- go vet ./...
- govulncheck ./...

Risks / Notes:
- <migration, concurrency, compatibility, or security notes>
```

LLM MUST NOT claim tests passed unless it actually ran them in the environment.

---

## 42. Final Merge Bar

A Go 1.24 change is acceptable only when:

- it is formatted;
- it compiles;
- tests pass;
- vet findings are resolved;
- error, timeout, cancellation, and cleanup behavior are defined;
- concurrency is bounded and race-safe;
- dependency and security impact is reviewed;
- public API changes are intentional and documented;
- Go 1.24 features are used deliberately, not accidentally;
- the code is simpler after the change or the added complexity is justified by real requirements.

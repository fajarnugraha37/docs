# Strict Coding Standards — Go 1.26

> Mandatory engineering conventions for LLM-assisted implementation, code generation, refactoring, and review in Go 1.26 codebases.

---

## 0. Scope

This document defines strict coding standards for Go services, libraries, CLIs, background workers, platform components, integration services, and internal tooling that target **Go 1.26**.

The intended readers are:

1. human engineers reviewing Go code, and
2. LLM/code agents that generate, modify, test, and review Go implementation work.

This is not a beginner tutorial. It is an implementation contract and merge gate.

---

## 1. Source Baseline

Use this document together with these canonical references:

- Go 1.26 release notes: <https://go.dev/doc/go1.26>
- Go release history: <https://go.dev/doc/devel/release>
- Go 1.26 announcement: <https://go.dev/blog/go1.26>
- Using `go fix` to modernize Go code: <https://go.dev/blog/gofix>
- `//go:fix inline` and source-level inliner: <https://go.dev/blog/inliner>
- Go language specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go Test Comments: <https://go.dev/wiki/TestComments>
- Go Modules Reference: <https://go.dev/ref/mod>
- `go.mod` reference: <https://go.dev/doc/modules/gomod-ref>
- Organizing a Go module: <https://go.dev/doc/modules/layout>
- Go toolchains: <https://go.dev/doc/toolchain>
- Go doc comments: <https://go.dev/doc/comment>
- Go vulnerability management: <https://go.dev/doc/security/vuln/>
- Go fuzzing: <https://go.dev/doc/security/fuzz/>
- Go FIPS 140-3 compliance: <https://go.dev/doc/security/fips140>
- `sync.WaitGroup`: <https://pkg.go.dev/sync#WaitGroup>
- `testing/synctest`: <https://pkg.go.dev/testing/synctest>
- `testing/cryptotest`: <https://pkg.go.dev/testing/cryptotest>
- `net/http.CrossOriginProtection`: <https://pkg.go.dev/net/http#CrossOriginProtection>
- `net/http/httputil.ReverseProxy`: <https://pkg.go.dev/net/http/httputil#ReverseProxy>
- `log/slog`: <https://pkg.go.dev/log/slog>

If this document conflicts with the Go language specification or current official Go 1.26 documentation, the official Go documentation wins.

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

LLM-generated Go code must optimize for correctness, maintainability, concurrency safety, operational clarity, security, and minimal surprise.

LLM MUST NOT:

- invent packages, APIs, symbols, config keys, directories, generated files, or project conventions that do not exist;
- silently change public API contracts;
- add dependencies without explaining why the standard library is insufficient;
- hide errors, ignore cancellation, or swallow panics;
- produce code that only compiles in the happy path while leaving timeout, rollback, concurrency, retry, idempotency, authorization, and partial failure behavior undefined;
- replace simple Go with unnecessary abstraction, framework patterns, or Java/C#-style layering unless the existing project already uses that shape;
- upgrade or downgrade Go version, dependency major version, code generator, database migration format, or API schema unless explicitly requested;
- use Go 1.26 experimental APIs as if they are stable;
- use `GODEBUG` or `GOEXPERIMENT` to bypass correct implementation, test failures, or security posture.

LLM MUST:

- inspect `go.mod`, `go.work`, package layout, build tags, generated-code markers, naming, error conventions, logging conventions, tests, and CI commands before modifying code;
- preserve existing architectural boundaries unless the requested change explicitly asks to redesign them;
- prefer small, reviewable changes;
- include tests for behavior changes;
- run or specify exact validation commands before merge;
- state assumptions when information is missing;
- explicitly report any rule in this document that cannot be satisfied.

---

## 4. Version and Toolchain Standards

### 4.1 Go version

A Go 1.26 module MUST declare a compatible `go` directive:

```go.mod
module example.com/company/service

go 1.26
```

Rules:

- `go.mod` MUST be present at the module root.
- The `go` directive MUST represent the language semantics the module assumes.
- For Go 1.26 projects, new Go 1.27+ language/library features MUST NOT be used unless the module is intentionally upgraded.
- LLM MUST NOT upgrade `go.mod` from an older Go version to Go 1.26 unless explicitly requested or required by a dependency that has been approved.
- LLM MUST NOT downgrade the `go` directive to bypass compile, vet, dependency, or lint issues.
- A change to the `go` directive MUST be reviewed as a platform/runtime change, not as incidental formatting.

### 4.2 Go 1.26 `go mod init` behavior

Go 1.26 changes the default `go` directive generated by `go mod init`. A Go 1.N toolchain creates a new module with `go 1.(N-1).0`; Go 1.26 therefore creates `go 1.25.0` by default.

Rules:

- If a new repository is intended to target Go 1.26, the creator MUST explicitly set the `go` directive to Go 1.26 after initialization.
- New modules MUST NOT accidentally remain on `go 1.25.0` if they intentionally use Go 1.26 language, library, compiler, testing, crypto, or tooling behavior.
- LLM MUST inspect a newly created `go.mod` after `go mod init`; do not assume it targets the currently installed toolchain.
- If broad compatibility is desired, leaving `go 1.25.0` is allowed only if the code does not depend on Go 1.26-only semantics or APIs.

Example:

```bash
go mod init example.com/company/service
go get go@1.26
```

### 4.3 Toolchain directive

For reproducible local and CI behavior, a main module MAY declare a specific toolchain:

```go.mod
toolchain go1.26.4
```

Rules:

- Use an approved Go 1.26 patch version from the organization/toolchain image.
- If CI pins Go via Docker image, `actions/setup-go`, Bazel, asdf, mise, or internal buildpacks, the `toolchain` directive MUST NOT contradict CI.
- Do not add `toolchain` merely to satisfy local machine convenience.
- If `GOTOOLCHAIN=local` is used in CI, the CI image MUST already contain the required version.
- LLM MUST NOT change the `toolchain` directive without checking CI and release notes.

### 4.4 Go 1.26 patch level

Rules:

- New production builds SHOULD use the latest approved Go 1.26 patch available in the organization.
- Security-sensitive services MUST NOT remain on `go1.26.0` if a later Go 1.26 patch is approved and available.
- Patch upgrades MUST run the full validation gate, especially when the release history mentions fixes in packages used by the service.
- As of 2026-06-10, `go1.26.4` is the relevant Go 1.26 patch baseline referenced by this document. Replace it with the latest organization-approved patch when newer releases are adopted.

### 4.5 Tool dependencies

Executable project tools SHOULD be declared with Go tool dependencies rather than the older `tools.go` blank-import pattern for new modules.

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

- Project tools SHOULD be declared as module tool dependencies when reproducible tool execution matters.
- Do not keep both `tools.go` blank imports and `tool` directives for the same tools unless migration is in progress.
- Tool upgrades MUST be reviewed like dependency upgrades.
- LLM MUST NOT add tool dependencies for one-off local convenience.

### 4.6 Workspaces

Rules:

- `go.work` MAY be used for multi-module local development, but production CI SHOULD build from module roots unless the repository explicitly standardizes on workspace CI.
- LLM MUST inspect `go.work` before changing dependencies in a multi-module repository.
- LLM MUST NOT assume `./...` from the repository root equals all modules when `go.work` exists.
- Dependency changes in a workspace MUST be applied to the owning module, not randomly to the nearest `go.mod`.

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

Go 1.26-specific recommended gates:

```bash
# Try Go 1.26 source modernization only in an explicit review branch.
go fix ./...

# Detect code sensitive to experimental JSON implementation, if the project opts into json/v2 evaluation.
GOEXPERIMENT=jsonv2 go test ./...

# Detect concurrency leaks using Go 1.26 experimental goroutine leak profile.
GOEXPERIMENT=goroutineleakprofile go test ./...

# Detect cgo leak issues when AddressSanitizer is enabled and supported.
go test -asan ./...
```

Rules:

- CI MUST fail on formatting drift.
- CI MUST fail on `go vet` findings.
- CI MUST fail on tests.
- Security-sensitive services SHOULD run `govulncheck` in CI.
- `go fix` MUST NOT be run blindly in the same branch as business logic changes.
- `GOEXPERIMENT` gates MUST be opt-in validation signals, not hidden production behavior.
- If a gate cannot run locally, the PR description MUST state why and where it will run.

---

## 6. Formatting, Imports, and File Hygiene

Rules:

- All Go files MUST be formatted with `gofmt`.
- Import blocks MUST be managed by `goimports` or equivalent standard tooling.
- Do not manually align struct fields, comments, or assignments in ways that fight `gofmt`.
- Generated files MUST contain a valid generated-code marker:

```go
// Code generated by <tool>; DO NOT EDIT.
```

- Generated files MUST NOT be manually edited.
- Do not mix generated and hand-written logic in the same file.
- Do not create mega-files. Split by cohesive behavior, not by arbitrary layers.
- Do not use package-level mutable state unless it is explicitly safe, testable, and justified.

LLM MUST:

- preserve existing file organization unless there is a clear reason to change it;
- avoid broad file rewrites when a local patch is sufficient;
- not reformat unrelated files unless the task is specifically formatting cleanup.

---

## 7. Package and Module Design

### 7.1 Package names

Rules:

- Package names MUST be short, lowercase, and meaningful.
- Package names MUST NOT use underscores, camelCase, or generic names such as `common`, `utils`, `helpers`, `misc`, or `shared` unless already established and unavoidable.
- Package names SHOULD describe what the package provides, not where it is used.
- Avoid stutter: `user.UserService` may be worse than `user.Service` if the package already provides the domain context.

### 7.2 Internal boundaries

Rules:

- Use `internal/` to enforce package-level access boundaries when code must not be imported by external modules.
- Public packages MUST expose minimal stable APIs.
- Do not expose types only because tests are difficult; use package-level tests or small interfaces when appropriate.
- Cross-package imports MUST not create cycles.

### 7.3 Application layout

Acceptable baseline layout:

```text
repo/
  cmd/<binary>/main.go
  internal/<domain-or-component>/
  pkg/<public-library>/        # only when intentionally public/reusable
  api/                         # schemas, OpenAPI, protobuf, contracts
  migrations/
  testdata/
  go.mod
```

Rules:

- `cmd/<name>/main.go` MUST wire dependencies and start the process; it MUST NOT contain domain logic.
- `internal/` SHOULD contain application-specific logic.
- `pkg/` MUST NOT be used as a dumping ground. Use it only for deliberate reusable API.
- `testdata/` MUST be used for test fixtures that should be ignored by the Go tool.

---

## 8. Naming and API Shape

Rules:

- Exported identifiers MUST have doc comments unless they are trivial and internal policy explicitly allows omission.
- Exported API names MUST be stable, unsurprising, and domain-aligned.
- Avoid names that encode implementation details: `SQLUserStore` is acceptable only if SQL is part of the contract; otherwise use `UserStore`.
- Do not use `Manager`, `Processor`, `Handler`, `Helper`, or `Util` as lazy names. Name the role precisely.
- Acronyms MUST be consistently cased: `HTTPServer`, `URL`, `ID`, `JSON`.
- Context parameters MUST be named `ctx`.
- Error variables SHOULD be named `ErrX`; unexported sentinel errors should be `errX`.

Function rules:

- Keep functions small enough that invariants and failure paths are visible.
- Prefer returning values and errors over mutating output parameters.
- Do not return partially initialized objects unless explicitly documented.
- Do not hide I/O, goroutine creation, global state mutation, or transactions behind innocent-looking methods.

---

## 9. Go 1.26 Language Rules

### 9.1 `new(expression)`

Go 1.26 allows `new` to accept an expression, producing a pointer to a new variable initialized with that expression.

Allowed:

```go
age := new(yearsSince(born))
```

Rules:

- Use `new(expr)` only when a pointer is semantically required, such as optional values in JSON/protobuf structs or stable pointer identity.
- Do not use `new(expr)` merely to avoid a local variable when the code becomes less readable.
- Do not use it for large values in hot paths without checking escape behavior.
- Do not use it to smuggle mutation into otherwise value-oriented APIs.
- LLM MUST prefer clarity. If `v := expr; return &v` is easier to debug or read, use the explicit variable.

### 9.2 Self-referential generic constraints

Go 1.26 allows a generic type to refer to itself in its type parameter list.

Example:

```go
type Adder[A Adder[A]] interface {
    Add(A) A
}
```

Rules:

- Use self-referential constraints only when they model a real invariant such as algebraic operations on the same concrete type.
- Do not use recursive constraints to make ordinary interfaces look clever.
- Public APIs using recursive constraints MUST include tests that demonstrate compile-time behavior for at least one accepted and one rejected type.
- Do not introduce recursive generic APIs into widely used public packages without review by senior maintainers.
- LLM MUST avoid speculative generic abstractions unless the existing codebase already uses them or the requirement clearly benefits.

---

## 10. Go 1.26 `go fix` and Modernization Rules

Go 1.26 revamps `go fix` as the home of Go modernizers and builds it on the same analysis framework as `go vet`.

Rules:

- `go fix` MAY be used to modernize code, but only in a dedicated modernization commit or PR.
- `go fix` MUST NOT be mixed with business logic changes, security fixes, schema changes, or dependency upgrades in the same commit unless the diff is tiny and explicitly reviewed.
- Generated files MUST be excluded from manual modernization unless they are regenerated by the source generator.
- Before applying `go fix`, capture a clean baseline:

```bash
go test ./...
go vet ./...
git status --short
```

- After applying `go fix`, run:

```bash
go test ./...
go vet ./...
govulncheck ./...
```

- Any behavior-changing diff from `go fix` MUST be treated as a bug or a human-reviewed migration issue.
- LLM MUST summarize every semantic-looking transformation introduced by `go fix`.

### 10.1 `//go:fix inline`

Rules:

- `//go:fix inline` MAY be used for deliberate API migrations owned by the repository.
- It MUST NOT be added to production APIs casually.
- Migration directives MUST be documented with removal criteria.
- Public library maintainers MUST test both old call sites and migrated call sites before release.
- LLM MUST NOT invent `//go:fix inline` directives for APIs it does not own.

---

## 11. Error Handling

Rules:

- Every error MUST be handled, returned, or explicitly ignored with a documented reason.
- Do not write `_ = err` unless the operation is truly safe to ignore and the reason is obvious or documented.
- Wrap errors with context using `fmt.Errorf("...: %w", err)` when crossing boundaries.
- Do not wrap errors if callers need exact sentinel identity and no `errors.Is`/`errors.As` path exists.
- Use `errors.Is` for sentinel matching.
- Use `errors.As` or Go 1.26 `errors.AsType` for typed errors.
- Avoid string matching on errors.
- Do not log and return the same error at the same layer unless there is a clear boundary reason.
- Public packages SHOULD document returned sentinel or typed errors.

Preferred typed matching:

```go
var pathErr *fs.PathError
if errors.As(err, &pathErr) {
    // handle path-specific error
}
```

Go 1.26 generic helper MAY be used when it improves type-safety and readability:

```go
if pathErr, ok := errors.AsType[*fs.PathError](err); ok {
    // handle path-specific error
}
```

Rules for `errors.AsType`:

- Use only when the project targets Go 1.26+.
- Do not mix `errors.As` and `errors.AsType` inconsistently within the same package without reason.
- Do not use typed errors to leak internal infrastructure details across domain boundaries.

---

## 12. Context, Cancellation, and Timeouts

Rules:

- `context.Context` MUST be the first parameter of functions that perform I/O, block, wait, retry, acquire locks, start goroutines, query databases, publish messages, or call external services.
- Do not store `context.Context` in structs except for short-lived request-scoped structs where the lifecycle is explicit.
- Do not pass `nil` context. Use `context.Background()` or `context.TODO()`.
- Use `context.WithTimeout` or `context.WithDeadline` at external boundaries.
- Always call the returned cancel function.
- Do not use context values for optional parameters, configuration, loggers, database handles, or service dependencies.
- Context values MUST be reserved for request-scoped metadata crossing process/API boundaries.

Signal handling:

- Use `signal.NotifyContext` for graceful shutdown.
- In Go 1.26, `signal.NotifyContext` cancels with a cause indicating the signal received. Code that observes cancellation causes SHOULD preserve and log that cause.

Example:

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

<-ctx.Done()
logger.Info("shutdown requested", slog.Any("cause", context.Cause(ctx)))
```

---

## 13. Concurrency Standards

### 13.1 Goroutine lifecycle

Rules:

- Every goroutine MUST have a bounded lifecycle.
- Every goroutine MUST have an owner responsible for cancellation, draining, and error handling.
- Goroutines MUST NOT be started from constructors unless the constructor returns a close/shutdown mechanism.
- Do not start background goroutines in package `init`.
- Do not leak goroutines on early return, timeout, or error.
- Channel sends MUST be cancellable or buffered sufficiently to avoid leaks.
- Receivers MUST know when channels close.
- Only senders should close channels.

Bad:

```go
ch := make(chan result)
for _, item := range items {
    go func() {
        ch <- work(item)
    }()
}
return nil, err // can leak senders
```

Better:

```go
g, ctx := errgroup.WithContext(ctx)
results := make(chan result, len(items))

for _, item := range items {
    item := item
    g.Go(func() error {
        r, err := work(ctx, item)
        if err != nil {
            return err
        }
        select {
        case results <- r:
            return nil
        case <-ctx.Done():
            return ctx.Err()
        }
    })
}
```

### 13.2 `sync.WaitGroup` and `WaitGroup.Go`

Rules:

- `sync.WaitGroup` MAY be used for fire-and-wait tasks with no error propagation.
- `WaitGroup.Go` MAY be used when targeting Go 1.25+ and the function cannot panic.
- If errors or cancellation matter, use `errgroup.Group` or an equivalent explicit error channel.
- Do not call `Add` inside a goroutine.
- Do not copy `WaitGroup` after first use.
- Do not let `WaitGroup.Go` functions panic. Recover only at process/request boundaries where recovery policy is defined.

Allowed:

```go
var wg sync.WaitGroup
for _, item := range items {
    item := item
    wg.Go(func() {
        process(item)
    })
}
wg.Wait()
```

Not enough when error matters:

```go
var wg sync.WaitGroup
wg.Go(func() {
    _ = doRiskyWork(ctx) // forbidden: error lost
})
```

### 13.3 Channels

Rules:

- Use channels to coordinate ownership or events, not as hidden global queues.
- Do not use unbounded goroutine fan-out.
- Always document channel ownership: who sends, who receives, who closes.
- Select loops MUST handle context cancellation or a shutdown signal.
- Do not use `time.After` repeatedly in loops where it causes avoidable allocations; prefer `time.Timer` where appropriate.

### 13.4 Mutexes and atomics

Rules:

- Prefer simple `sync.Mutex` over clever lock-free code.
- Use `sync.RWMutex` only when read contention is proven or strongly expected.
- Never hold locks while performing network I/O, disk I/O, logging to slow sinks, calling unknown callbacks, or blocking on channels.
- Atomic operations MUST protect a clearly documented invariant.
- Do not mix atomic and non-atomic access to the same variable.

### 13.5 Go 1.26 goroutine leak profile

Go 1.26 provides an experimental `goroutineleak` profile when built with `GOEXPERIMENT=goroutineleakprofile`.

Rules:

- Concurrency-heavy packages SHOULD include a CI or pre-merge job that runs representative tests with `GOEXPERIMENT=goroutineleakprofile`.
- Services with long-lived workers SHOULD evaluate `/debug/pprof/goroutineleak` in staging before production enablement.
- The profile is a detector, not a substitute for ownership design.
- Do not accept a goroutine leak because it does not appear in the profile; the profile cannot detect all leak classes.
- LLM MUST design cancellation/draining explicitly rather than relying on the profiler to find mistakes later.

---

## 14. Runtime, Compiler, and Performance Standards

### 14.1 Stack allocation optimization

Go 1.26 can allocate backing storage for slices on the stack in more situations.

Rules:

- Do not hand-optimize slice allocation patterns unless benchmarks prove a benefit.
- Do not depend on heap vs stack allocation as a correctness behavior.
- Performance-sensitive changes MUST include benchmarks and allocation measurements.
- If a Go 1.26 upgrade changes memory/performance behavior unexpectedly, isolate with benchmarks and compiler diagnostics before changing code.

Recommended commands:

```bash
go test -bench=. -benchmem ./...
go test -run=NONE -bench=BenchmarkName -benchmem -count=10 ./path
```

### 14.2 Avoid premature abstraction

Rules:

- Optimize only after identifying a real bottleneck.
- Prefer algorithmic improvements over micro-optimizations.
- Do not introduce object pools unless allocation pressure is measured and lifecycle is safe.
- Do not use `unsafe` for performance without benchmark, correctness tests, and code-owner approval.

### 14.3 Runtime metrics

Go 1.26 adds scheduler metrics for goroutine states, runtime thread counts, and total goroutines created.

Rules:

- Production services SHOULD expose runtime metrics through the existing telemetry stack.
- Concurrency-sensitive services SHOULD alert on goroutine growth, runnable backlog, and unexpected OS thread growth.
- Do not create custom goroutine counters when runtime metrics already provide the needed signal.

---

## 15. HTTP, Networking, and API Boundary Standards

### 15.1 HTTP server rules

Rules:

- `http.Server` MUST configure timeouts:
  - `ReadHeaderTimeout`
  - `ReadTimeout` or explicit body limits where appropriate
  - `WriteTimeout` where safe for the endpoint type
  - `IdleTimeout`
- Handlers MUST respect `r.Context()`.
- Request body size MUST be bounded using `http.MaxBytesReader` or equivalent for public endpoints.
- Do not use package-level default `http.ListenAndServe` for production servers.
- Do not expose `net/http/pprof` on public interfaces.

Example:

```go
srv := &http.Server{
    Addr:              cfg.Addr,
    Handler:           handler,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       120 * time.Second,
}
```

### 15.2 HTTP client rules

Rules:

- Do not use `http.DefaultClient` for production external calls.
- Every outbound request MUST have context, timeout, and explicit error handling.
- Reuse clients; do not create a new `http.Client` per request.
- Transport settings MUST be intentional for connection pooling, TLS, proxies, and idle timeouts.
- Retries MUST be bounded, jittered, idempotency-aware, and observable.

### 15.3 HTTP/2 and connection management

Go 1.26 adds `HTTP2Config.StrictMaxConcurrentRequests` and `Transport.NewClientConn`.

Rules:

- Use default transport connection pooling unless there is a proven need for custom connection management.
- `Transport.NewClientConn` MUST be treated as an advanced API. Do not use it in normal client code.
- HTTP/2 stream-limit behavior MUST be tested under load if the service is sensitive to fan-out or multiplexing limits.

### 15.4 Reverse proxy rules

Go 1.26 deprecates `httputil.ReverseProxy.Director` in favor of `Rewrite` because `Director` is fundamentally unsafe with hop-by-hop header handling.

Rules:

- New reverse proxy code MUST use `ReverseProxy.Rewrite`, not `Director`.
- Existing `Director` usage SHOULD be migrated in a dedicated change.
- Proxy code MUST explicitly define:
  - upstream URL rewrite behavior,
  - allowed forwarded headers,
  - host handling,
  - hop-by-hop header policy,
  - timeout behavior,
  - error response behavior.
- LLM MUST NOT copy old `Director` examples into Go 1.26 code.

### 15.5 URL parsing

Go 1.26 makes `net/url.Parse` reject malformed URLs containing colons in the host subcomponent.

Rules:

- Do not use `GODEBUG=urlstrictcolons=0` to accept malformed user input.
- User-provided URLs MUST be parsed, normalized, validated, and allowlisted by scheme/host when security matters.
- SSRF-sensitive code MUST validate resolved IP ranges and redirect behavior.
- Tests SHOULD include malformed IPv6-like and multi-colon host cases.

### 15.6 Cross-origin protection

Rules:

- Browser-facing state-changing endpoints SHOULD use `net/http.CrossOriginProtection` or an equivalent CSRF/CORS policy.
- CORS is not authentication.
- CSRF protection MUST be applied to cookie-authenticated browser flows.
- APIs using bearer tokens MUST still validate origin/cors policy when called from browsers.

---

## 16. JSON and Serialization Standards

### 16.1 JSON field semantics

Rules:

- JSON structs MUST distinguish between absent, null, zero, and empty values when the API requires it.
- Do not use pointer fields just because `omitempty` seems convenient; use pointers when optionality is part of the contract.
- For Go 1.24+ code, `omitzero` MAY be used when zero-value omission is semantically correct.
- For Go 1.26 code, `new(expr)` MAY simplify optional pointer population, but only where it improves clarity.

Example:

```go
type UpdateUserRequest struct {
    DisplayName *string `json:"displayName"`
}
```

### 16.2 Experimental `encoding/json/v2`

Rules:

- `encoding/json/v2` MUST be treated as experimental unless the Go project declares it stable.
- Do not migrate production API contracts to `json/v2` without explicit approval.
- If evaluating `json/v2`, run compatibility tests against existing payload fixtures.
- Golden tests MUST include unknown fields, nulls, empty arrays, omitted fields, number precision, and time formats.

### 16.3 Schema contracts

Rules:

- Public APIs MUST be backed by OpenAPI, protobuf, JSON schema, or equivalent contract where project policy requires it.
- Serialization changes MUST include backward/forward compatibility analysis.
- Do not rename JSON fields casually.
- Do not change `omitempty`, `omitzero`, nullability, or default behavior without migration notes.

---

## 17. Filesystem and Process Safety

Rules:

- Treat file paths from users, archives, requests, environment variables, and config as untrusted.
- Use `os.Root` or equivalent confinement when operating inside a trusted root with untrusted relative paths.
- Do not concatenate paths for security-sensitive file access.
- Use `filepath.Clean` only as normalization, not as a full security boundary.
- Refuse absolute paths when only relative paths are expected.
- Avoid following symlinks unless explicitly allowed and tested.
- Temporary files MUST be created with safe APIs such as `os.CreateTemp`.
- Secrets MUST not be written to temp files unless explicitly required and protected.

Process rules:

- Use `exec.CommandContext` for external commands.
- Do not shell-concatenate user input.
- Pass arguments as argv entries.
- Bound stdout/stderr capture to avoid memory blowups.
- Explicitly handle process cancellation and cleanup.
- On platforms where `Process.WithHandle` is used, encapsulate it behind platform-specific code and tests.

---

## 18. Crypto, TLS, and Secret Handling

### 18.1 General crypto rules

Rules:

- Prefer the Go standard library crypto packages over third-party crypto unless a vetted requirement exists.
- Do not implement custom crypto primitives.
- Do not use deprecated or unsafe primitives for new code.
- Randomness MUST come from secure cryptographic sources.
- Do not assume crypto package `rand` parameters are honored in Go 1.26; many are now ignored in favor of secure global randomness.
- For deterministic crypto tests, use `testing/cryptotest.SetGlobalRandom` where appropriate.

### 18.2 HPKE and post-quantum crypto

Go 1.26 adds `crypto/hpke` implementing HPKE including support for post-quantum hybrid KEMs.

Rules:

- Use `crypto/hpke` for HPKE requirements instead of third-party implementations unless interoperability demands otherwise.
- HPKE usage MUST include explicit mode, KEM, KDF, AEAD, associated data, and test vectors.
- Do not invent ad-hoc envelope encryption when HPKE is the right primitive.

### 18.3 TLS rules

Go 1.26 enables hybrid post-quantum TLS key exchanges by default.

Rules:

- Do not disable default secure TLS behavior unless interoperability requires it and the exception is documented.
- Do not use `tlssecpmlkem=0` as a performance workaround without measurement and risk review.
- New services MUST use TLS 1.2+ at minimum unless a legacy integration exception is approved.
- TLS config MUST set server name verification correctly for clients.
- Do not set `InsecureSkipVerify: true` except in tests with explicit comments and safe test-only scope.
- Legacy GODEBUG compatibility switches for TLS MUST NOT be used in production as a long-term policy.

### 18.4 FIPS 140-3

Rules:

- Services requiring FIPS MUST use organization-approved Go toolchains and build flags.
- Go 1.26+ can use the Go Cryptographic Module v1.26.0, but compliance status MUST be verified against current organizational/legal requirements.
- Use `crypto/fips140.Version` or approved runtime verification when FIPS mode matters.
- `crypto/fips140.WithoutEnforcement` MUST NOT be used in production unless explicitly approved by security/compliance owners.
- Do not claim FIPS compliance merely because code compiles with Go 1.26.

### 18.5 Experimental `runtime/secret`

Go 1.26 provides experimental `runtime/secret` behind `GOEXPERIMENT=runtimesecret`.

Rules:

- Treat `runtime/secret` as experimental and non-portable.
- Do not depend on it in production unless the organization has explicitly approved the experiment.
- It may be evaluated for cryptographic temporary handling on supported Linux amd64/arm64 platforms.
- Even with `runtime/secret`, secrets MUST still avoid logs, panics, traces, metrics, and core dumps.

---

## 19. Database and Transaction Standards

Rules:

- Database calls MUST accept context.
- Transactions MUST be explicit.
- Every transaction MUST commit or rollback exactly once.
- Rollback errors SHOULD be logged only when useful and not masking the original error.
- Do not hold transactions across network calls, user interaction, long CPU work, or unbounded loops.
- SQL queries MUST use parameters, not string concatenation.
- Migrations MUST be backward-compatible for rolling deployments unless downtime is explicitly planned.
- Schema changes MUST include rollback or forward-fix strategy.

Example transaction pattern:

```go
func transfer(ctx context.Context, db *sql.DB, cmd TransferCommand) error {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return fmt.Errorf("begin transfer transaction: %w", err)
    }
    defer func() { _ = tx.Rollback() }()

    if err := debit(ctx, tx, cmd.From, cmd.Amount); err != nil {
        return fmt.Errorf("debit account: %w", err)
    }
    if err := credit(ctx, tx, cmd.To, cmd.Amount); err != nil {
        return fmt.Errorf("credit account: %w", err)
    }
    if err := tx.Commit(); err != nil {
        return fmt.Errorf("commit transfer transaction: %w", err)
    }
    return nil
}
```

Rules:

- Repositories MUST not hide transaction boundaries if the caller needs atomic multi-step behavior.
- Do not use global database handles in domain logic; inject dependencies.
- Retry logic MUST understand idempotency and transaction isolation.

---

## 20. Logging and Observability

### 20.1 Logging

Rules:

- Use structured logging for production services.
- `log/slog` SHOULD be the default standard-library logger for new Go services unless the project already standardizes on another logger.
- Logs MUST include enough context to diagnose failures without exposing secrets.
- Do not log access tokens, passwords, API keys, private keys, raw authorization headers, session cookies, or PII unless explicitly approved and redacted.
- Do not log and return the same error at every layer.
- Use stable log keys.

Go 1.26 `slog.NewMultiHandler`:

- MAY be used when the same record must be sent to multiple handlers.
- Do not use multi-handler logging to duplicate noisy logs without sampling or level policy.
- Every handler in a multi-handler setup MUST have clear ownership, retention, and redaction behavior.

### 20.2 Metrics

Rules:

- Expose RED metrics for services: rate, errors, duration.
- Expose USE metrics for resources: utilization, saturation, errors.
- Include dependency metrics for DB, cache, queues, external APIs, and workers.
- Avoid high-cardinality labels such as user ID, email, raw URL, request body, trace ID, or unbounded error message.
- Runtime metrics SHOULD include goroutine and thread-related metrics for concurrency-heavy services.

### 20.3 Tracing

Rules:

- Propagate context across service boundaries.
- Spans MUST not contain secrets or high-cardinality raw values.
- Trace errors at the boundary where they become observable.
- Do not create spans for tiny internal functions unless needed for diagnosis.

---

## 21. Testing Standards

### 21.1 Unit tests

Rules:

- Behavior changes MUST include tests.
- Tests MUST be deterministic.
- Tests MUST not depend on wall-clock sleeps unless there is no viable alternative.
- Prefer table-driven tests for input/output matrices.
- Use `t.Helper()` in helpers.
- Use `t.TempDir()` for temp files unless artifacts must persist.
- Use `t.Context()` for tests that require cancellation semantics.
- Do not test implementation details unless the detail is part of a safety invariant.

### 21.2 Test artifacts

Go 1.26 adds `T.ArtifactDir`, `B.ArtifactDir`, and `F.ArtifactDir` for test output artifacts.

Rules:

- Use `ArtifactDir` for diagnostics that should be inspectable after test execution: generated traces, minimized failing payloads, snapshots, benchmark profiles, or reproducer files.
- Do not write artifacts into repository directories during tests.
- Do not rely on artifact files unless the `-artifacts` behavior is configured in CI.
- Artifact contents MUST not contain secrets.

### 21.3 Concurrency tests and `testing/synctest`

Rules:

- Use `testing/synctest` for deterministic tests of time, timers, cancellation, and goroutine synchronization when appropriate.
- Do not use `testing/synctest` for real network I/O, external processes, or resources outside the synctest bubble.
- Concurrency tests MUST prove no leak, no deadlock, and correct cancellation behavior.
- Race-prone packages MUST run under `go test -race`.

### 21.4 Crypto tests and deterministic randomness

Go 1.26 adds `testing/cryptotest.SetGlobalRandom`.

Rules:

- Use `testing/cryptotest.SetGlobalRandom` for deterministic tests that need predictable cryptographic randomness.
- Do not pass fake readers to crypto APIs and assume they are honored in Go 1.26.
- Deterministic randomness MUST be limited to tests.
- Do not create deterministic crypto behavior in production.

### 21.5 Integration tests

Rules:

- Integration tests MUST be isolated and repeatable.
- External dependencies SHOULD use containers, emulators, or test doubles with contract coverage.
- Tests requiring external services MUST be gated with build tags or environment checks.
- Do not skip integration tests silently in CI; skipped tests MUST state the missing dependency.

### 21.6 Fuzz tests

Rules:

- Fuzz security-sensitive parsers, decoders, validators, path handling, URL handling, protocol logic, and state machines.
- Fuzz targets MUST be deterministic and fast.
- Fuzz-discovered failures MUST be committed as regression corpus entries.
- Do not fuzz external services or non-deterministic behavior.

---

## 22. Benchmarking Standards

Rules:

- Benchmarks MUST use `testing.B` correctly.
- For Go 1.26, prefer `b.Loop()` for new benchmarks.
- Do not do setup work inside the measured loop unless that setup is part of the operation being measured.
- Use `b.ReportAllocs()` when allocation behavior matters.
- Use `b.SetBytes(n)` for throughput benchmarks.
- Benchmarks MUST consume results so the compiler cannot eliminate the work.

Preferred Go 1.26 style:

```go
func BenchmarkEncode(b *testing.B) {
    input := makePayload()
    b.ReportAllocs()
    for b.Loop() {
        out, err := Encode(input)
        if err != nil {
            b.Fatal(err)
        }
        sink = out
    }
}
```

Rules:

- Do not compare benchmark numbers across machines without controlling environment.
- Performance claims MUST include command, hardware/context, Go version, and representative result.
- Use `benchstat` for comparisons.

---

## 23. Security Standards

Rules:

- Validate all external input.
- Authorize every state-changing action at the boundary and again at sensitive domain transitions if required.
- Authentication and authorization MUST be explicit; do not infer permissions from UI flow.
- Secrets MUST come from approved secret stores or environment/config mechanisms.
- Do not hardcode credentials, tokens, private keys, or internal endpoints.
- Use constant-time comparison for secrets.
- Do not expose debug endpoints in production without authentication and network controls.
- Run `govulncheck` for security-sensitive services.
- Dependencies MUST be reviewed for license, maintenance, transitive risk, and vulnerability posture.

Input classes requiring special handling:

- paths and archive entries;
- URLs and redirect targets;
- SQL and query filters;
- HTML/templates;
- shell command arguments;
- regex patterns from users;
- uploaded files;
- serialized payloads;
- tenant IDs and authorization scopes.

LLM MUST:

- identify trust boundaries in new code;
- explain validation and authorization behavior;
- reject shortcuts that make tests pass while weakening security.

---

## 24. Dependency Management

Rules:

- Prefer the standard library when it is sufficient.
- Add third-party dependencies only with clear value.
- Do not add a large framework for a small helper need.
- Pin versions through Go modules.
- Run `go mod tidy` after dependency changes.
- Review `go.mod` and `go.sum` diffs.
- Avoid replacing modules with local paths in committed code unless the repository intentionally uses a workspace or monorepo policy.
- `replace` directives MUST be documented and reviewed.
- Dependency major upgrades MUST include migration notes and validation results.

LLM MUST NOT:

- add dependencies just because an example on the internet uses them;
- upgrade unrelated dependencies opportunistically;
- remove indirect dependencies manually without running module tooling.

---

## 25. Interfaces and Abstractions

Rules:

- Accept interfaces, return concrete types, unless returning an interface is part of the contract.
- Define interfaces at the consumer side when possible.
- Keep interfaces small.
- Do not create an interface with one implementation merely for “testability” if a concrete fake or function injection is simpler.
- Do not create Java-style service hierarchies by default.
- Public interfaces are hard to change; keep them minimal.

Bad:

```go
type UserService interface {
    CreateUser(ctx context.Context, req CreateUserRequest) (*User, error)
    UpdateUser(ctx context.Context, req UpdateUserRequest) (*User, error)
    DeleteUser(ctx context.Context, id string) error
    SearchUsers(ctx context.Context, q SearchQuery) ([]User, error)
}
```

Better when only one operation is needed:

```go
type UserCreator interface {
    CreateUser(context.Context, CreateUserRequest) (*User, error)
}
```

---

## 26. Generics Standards

Rules:

- Use generics to remove real duplication while preserving type safety.
- Do not use generics when a simple function, interface, or concrete type is clearer.
- Avoid generic public APIs unless the type parameter meaning is obvious.
- Type constraints MUST be minimal and named when reused.
- Do not use `any` as a way to avoid modeling.
- Benchmark generic code only if performance is a stated concern.
- Go 1.26 self-referential constraints MUST be reviewed carefully because they increase API complexity.

Allowed:

```go
func Map[S ~[]E, E any, R any](items S, f func(E) R) []R {
    out := make([]R, 0, len(items))
    for _, item := range items {
        out = append(out, f(item))
    }
    return out
}
```

Forbidden unless justified:

```go
type AbstractProcessor[T any, R any, C any, E any] interface {
    Process(T, C) (R, E)
}
```

---

## 27. Reflection, Unsafe, and Code Generation

### 27.1 Reflection

Rules:

- Use reflection only for framework-like, serialization, validation, tooling, or compatibility scenarios.
- Do not use reflection to avoid writing straightforward code.
- Reflection-heavy code MUST have tests for nils, pointers, zero values, unexported fields, embedded fields, and type aliases.
- Go 1.26 iterator methods on `reflect.Type` and `reflect.Value` MAY be used for cleaner reflection iteration in Go 1.26-only code.

### 27.2 Unsafe

Rules:

- `unsafe` MUST require explicit reviewer approval.
- Every unsafe block MUST explain the invariant that makes it safe.
- Unsafe code MUST have tests and ideally fuzz tests.
- Do not use unsafe for string/byte conversion unless performance is proven and immutability/lifetime risks are controlled.

### 27.3 Code generation

Rules:

- Generators MUST be reproducible.
- Generated files MUST be committed only when project policy requires it.
- Generated diffs MUST be reviewed separately from manual logic where feasible.
- `go generate` commands MUST be deterministic and documented.
- Go 1.26 `go/ast.ParseDirective` MAY be used in source tooling that parses directive comments.

---

## 28. State Machine and Workflow Standards

For regulatory, enforcement, lifecycle, case management, approval, ticketing, or workflow systems, state transitions MUST be modeled explicitly.

Rules:

- State MUST be represented by typed constants or equivalent domain types, not raw strings scattered across the codebase.
- Allowed transitions MUST be centralized and tested.
- Invalid transitions MUST fail closed.
- Transition side effects MUST be idempotent or guarded by transaction/outbox/versioning.
- Audit records MUST capture actor, previous state, next state, command, timestamp, reason, and correlation/request ID where applicable.
- Authorization MUST be checked against transition intent, not only entity visibility.
- External events MUST be deduplicated.
- Retry behavior MUST not produce duplicate side effects.

Example:

```go
type CaseState string

const (
    CaseDraft      CaseState = "DRAFT"
    CaseSubmitted  CaseState = "SUBMITTED"
    CaseUnderReview CaseState = "UNDER_REVIEW"
    CaseClosed     CaseState = "CLOSED"
)

type Transition struct {
    From CaseState
    To   CaseState
}

var allowedTransitions = map[Transition]struct{}{
    {CaseDraft, CaseSubmitted}:       {},
    {CaseSubmitted, CaseUnderReview}: {},
    {CaseUnderReview, CaseClosed}:    {},
}

func CanTransition(from, to CaseState) bool {
    _, ok := allowedTransitions[Transition{From: from, To: to}]
    return ok
}
```

Rules:

- Tests MUST cover all allowed transitions and representative invalid transitions.
- Code MUST define what happens on duplicate commands, stale versions, concurrent updates, and partial failure.
- State changes MUST be observable through logs, metrics, and audit trail.

---

## 29. Event, Worker, and Queue Standards

Rules:

- Message handlers MUST be idempotent.
- Message identity, aggregate identity, causation ID, and correlation ID SHOULD be explicit.
- Acknowledgement MUST happen only after durable processing or safe handoff.
- Retries MUST be bounded and observable.
- Poison messages MUST go to a dead-letter mechanism or quarantine path.
- Ordering assumptions MUST be documented.
- Consumers MUST handle duplicate, out-of-order, stale, and unknown-version messages.
- Schema evolution MUST be backward and forward compatible.

LLM MUST:

- define idempotency keys for new message handlers;
- document retry/ack behavior;
- avoid hidden goroutine fan-out inside consumers unless backpressure is explicit.

---

## 30. Configuration Standards

Rules:

- Configuration MUST be explicit and validated at startup.
- Missing required config MUST fail fast.
- Invalid config MUST fail fast with actionable errors.
- Secrets MUST not be logged.
- Default values MUST be safe for local development and non-dangerous for production.
- Timeouts, limits, and retry counts MUST be configurable when operationally relevant.
- Do not read environment variables throughout domain logic; centralize config loading.

Example:

```go
type Config struct {
    Addr         string
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
}

func (c Config) Validate() error {
    if c.Addr == "" {
        return errors.New("addr is required")
    }
    if c.ReadTimeout <= 0 {
        return errors.New("read timeout must be positive")
    }
    return nil
}
```

---

## 31. Build Tags, Ports, and Platform Rules

Rules:

- Build tags MUST be documented and tested in CI if production-relevant.
- Do not use platform-specific code without a portable fallback or explicit platform policy.
- Go 1.26 removes `GOOS=windows GOARCH=arm`; do not add or preserve CI matrix entries for it.
- `freebsd/riscv64` is marked broken in Go 1.26; do not claim support without explicit validation.
- Go 1.26 is the last release that runs on macOS 12 Monterey; platform support policies SHOULD plan for Go 1.27 requiring macOS 13+.
- For `linux/riscv64`, race detector support is available in Go 1.26 and SHOULD be used in CI when that platform is supported.
- WebAssembly builds MUST not rely on ignored `GOWASM=signext` or `GOWASM=satconv` settings.

---

## 32. CLI Standards

Rules:

- CLI commands MUST return proper exit codes.
- CLI errors MUST be written to stderr.
- Normal output MUST be written to stdout.
- Do not log progress into stdout when stdout is machine-readable.
- Support context cancellation for long-running commands.
- File processing MUST be streaming when inputs can be large.
- Flags MUST have clear names, defaults, and help text.
- Do not panic for user errors.

Example:

```go
func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    fs.SetOutput(stderr)

    input := fs.String("input", "", "input file path")
    if err := fs.Parse(args); err != nil {
        return err
    }
    if *input == "" {
        return errors.New("-input is required")
    }
    return processFile(ctx, *input, stdout)
}
```

---

## 33. Memory and Large Data Standards

Rules:

- Do not use `io.ReadAll` on unbounded input even though Go 1.26 improves its allocation behavior.
- Use streaming decoders/readers for large files, request bodies, and queues.
- Bound memory for batch processing.
- Use backpressure for pipelines.
- Avoid retaining large byte slices through small subslices.
- Clear buffers containing secrets where feasible and approved.
- Use benchmarks and profiles before introducing pooling.

Large input APIs MUST define:

- maximum size;
- streaming behavior;
- timeout/cancellation behavior;
- partial failure behavior;
- memory bound;
- observability.

---

## 34. Review Checklist for LLM-Generated Go

Before accepting LLM-generated Go code, reviewer MUST verify:

- [ ] The code compiles under the declared Go 1.26 toolchain.
- [ ] The `go.mod` and `toolchain` directives are intentional.
- [ ] `go mod init` default did not accidentally leave a Go 1.26 project at `go 1.25.0`.
- [ ] No invented APIs, packages, config keys, or conventions are present.
- [ ] Public APIs and schemas were not changed silently.
- [ ] Errors are handled and wrapped at useful boundaries.
- [ ] Context cancellation is respected.
- [ ] Goroutines have bounded lifecycle and no leak-prone early return path.
- [ ] `WaitGroup.Go` is not used where error propagation is required.
- [ ] Reverse proxies use `Rewrite`, not deprecated `Director`, for new code.
- [ ] URL parsing/validation accounts for Go 1.26 stricter colon behavior.
- [ ] Crypto code does not assume custom random readers are honored.
- [ ] TLS defaults are not weakened without approved exception.
- [ ] FIPS claims are not made without approved FIPS build/runtime policy.
- [ ] Experimental packages/features are not used as stable production dependencies.
- [ ] Tests cover success, failure, timeout, cancellation, invalid input, and concurrency cases.
- [ ] Benchmarks use `b.Loop()` for new Go 1.26 benchmarks where appropriate.
- [ ] Logs are structured and do not expose secrets.
- [ ] Metrics avoid high-cardinality labels.
- [ ] Database transactions are explicit and safe.
- [ ] State transitions are explicit, audited, authorized, and idempotent where required.
- [ ] Dependencies are justified and minimal.
- [ ] Security-sensitive changes pass `govulncheck`.
- [ ] CI commands are documented and pass.

---

## 35. Forbidden Patterns

The following patterns are forbidden unless explicitly approved:

```go
// Ignoring errors.
value, _ := risky()
```

```go
// Context-less I/O.
resp, err := http.Get(url)
```

```go
// Production server without timeouts.
http.ListenAndServe(addr, handler)
```

```go
// Unsafe TLS.
&tls.Config{InsecureSkipVerify: true}
```

```go
// Unbounded input read.
b, err := io.ReadAll(r)
```

```go
// Shell injection risk.
exec.Command("sh", "-c", "tool "+userInput)
```

```go
// Goroutine without lifecycle owner.
go doForever()
```

```go
// Lost goroutine error.
wg.Go(func() { _ = doRiskyWork(ctx) })
```

```go
// Reverse proxy using deprecated unsafe hook in new Go 1.26 code.
proxy := &httputil.ReverseProxy{Director: func(r *http.Request) {}}
```

```go
// Experimental API treated as stable.
// import "runtime/secret" without explicit experiment policy
```

```go
// Hiding security behavior behind GODEBUG.
// GODEBUG=tlssecpmlkem=0,urlstrictcolons=0
```

---

## 36. Required PR Notes for Go 1.26 Changes

Any PR generated by an LLM or modifying Go 1.26 behavior SHOULD include:

```markdown
## Go validation

- Go version:
- Toolchain:
- Commands run:
  - gofmt/goimports:
  - go mod tidy:
  - go test ./...:
  - go vet ./...:
  - govulncheck ./...:
  - race/staticcheck/golangci-lint if applicable:

## Behavior impact

- Public API changed: yes/no
- JSON/schema changed: yes/no
- Database migration: yes/no
- Goroutines/concurrency changed: yes/no
- Network/TLS behavior changed: yes/no
- Crypto/FIPS behavior changed: yes/no
- Experimental Go feature used: yes/no

## Risk notes

- Rollback strategy:
- Compatibility notes:
- Operational notes:
```

---

## 37. LLM Final Self-Check

Before returning code, LLM MUST ask itself:

1. Did I inspect the actual project structure before adding code?
2. Did I preserve the module's declared Go version and toolchain policy?
3. Did I accidentally rely on Go 1.26-only APIs in a module that does not declare Go 1.26?
4. Did I handle errors, timeouts, cancellation, and partial failure?
5. Did I create any goroutine with unclear ownership?
6. Did I introduce hidden global state?
7. Did I weaken security defaults?
8. Did I use experimental Go features without making that explicit?
9. Did I add a dependency where the standard library is enough?
10. Did I include tests that prove the behavior and failure modes?
11. Did I leave validation commands or results?
12. Did I clearly state assumptions and unresolved risks?

If the answer to any question is unsafe or unknown, LLM MUST stop and report the issue instead of pretending the implementation is complete.

---

## 38. Summary of Go 1.26-Specific Merge Gates

A Go 1.26 codebase MUST treat the following as high-risk review areas:

- `go.mod` version accuracy because `go mod init` defaults to `go 1.25.0` under Go 1.26.
- `go fix` modernization because it can produce broad source diffs.
- `new(expr)` because it can improve optional pointer construction but also reduce clarity if overused.
- Recursive generic constraints because they increase API complexity.
- Goroutine leak profile because it is useful but not complete.
- Compiler stack allocation changes because performance/memory behavior may shift.
- `crypto/*` random parameter changes because deterministic tests must use `testing/cryptotest` instead of fake readers.
- Hybrid post-quantum TLS defaults because compatibility exceptions must be explicit.
- `httputil.ReverseProxy.Director` deprecation because new proxy code must use `Rewrite`.
- `net/url.Parse` stricter host colon rejection because URL validation tests may need updates.
- `testing.ArtifactDir` because test artifacts must not pollute the repository or leak secrets.
- Experimental `simd/archsimd`, `runtime/secret`, and `goroutineleakprofile` because they require explicit opt-in policy.

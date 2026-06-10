# Strict Coding Standards — Go 1.25

> Mandatory engineering conventions for LLM-assisted implementation, code generation, refactoring, and review in Go 1.25 codebases.

---

## 0. Scope

This document defines strict coding standards for Go services, libraries, CLIs, background workers, platform components, and internal tooling that target **Go 1.25**.

The intended readers are:

1. human engineers reviewing Go code, and
2. LLM/code agents that generate, modify, test, and review Go implementation work.

This is not a beginner tutorial. It is an implementation contract and merge gate.

---

## 1. Source Baseline

Use this document together with the following canonical references:

- Go 1.25 release notes: <https://go.dev/doc/go1.25>
- Go release history: <https://go.dev/doc/devel/release>
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
- `sync.WaitGroup`: <https://pkg.go.dev/sync#WaitGroup>
- `testing/synctest`: <https://pkg.go.dev/testing/synctest>
- `net/http.CrossOriginProtection`: <https://pkg.go.dev/net/http#CrossOriginProtection>
- `log/slog`: <https://pkg.go.dev/log/slog>

If this document conflicts with the Go language specification or current official Go 1.25 documentation, the official Go documentation wins.

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
- upgrade or downgrade Go version, dependency major version, code generator, database migration format, or API schema unless explicitly requested.

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

A Go 1.25 module MUST declare a compatible `go` directive:

```go.mod
module example.com/company/service

go 1.25
```

Rules:

- `go.mod` MUST be present at the module root.
- The `go` directive MUST represent the language semantics the module assumes.
- For Go 1.25 projects, new Go 1.26+ language/library features MUST NOT be used unless the module is intentionally upgraded.
- LLM MUST NOT upgrade `go.mod` from Go 1.25 to a newer version unless explicitly requested.
- LLM MUST NOT downgrade the `go` directive to bypass compile, vet, dependency, or lint issues.
- A change to the `go` directive MUST be reviewed as a platform/runtime change, not as incidental formatting.

### 4.2 Toolchain directive

For reproducible local and CI behavior, a main module MAY declare a specific toolchain:

```go.mod
toolchain go1.25.11
```

Rules:

- Use an approved Go 1.25 patch version from the organization/toolchain image.
- If CI pins Go via Docker image, `actions/setup-go`, Bazel, asdf, mise, or internal buildpacks, the `toolchain` directive MUST NOT contradict CI.
- Do not add `toolchain` merely to satisfy local machine convenience.
- If `GOTOOLCHAIN=local` is used in CI, the CI image MUST already contain the required version.
- Go 1.25 no longer automatically adds a `toolchain` line when the `go` command updates `go.mod` or `go.work`; LLM MUST NOT re-add one without project policy.

### 4.3 Go 1.25 patch level

Rules:

- New production builds SHOULD use the latest approved Go 1.25 patch available in the organization.
- Security-sensitive services MUST NOT remain on `go1.25.0` if a later Go 1.25 patch is approved and available.
- Patch upgrades MUST run the full validation gate, especially when the release history mentions fixes in packages used by the service.

### 4.4 Tool dependencies

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

### 4.5 `ignore` directive

Go 1.25 supports the `ignore` directive in `go.mod` to tell the `go` command to ignore directories when matching package patterns such as `all` or `./...`.

Rules:

- Use `ignore` only for directories that intentionally contain non-buildable, archived, fixture-like, generated, or foreign Go source trees.
- Do not use `ignore` to hide broken production code.
- Every `ignore` entry MUST have a nearby comment or review explanation describing why the directory is excluded from package discovery.
- LLM MUST NOT add an `ignore` directive to make validation pass unless the excluded directory is demonstrably not part of the module build surface.

### 4.6 Workspaces

Rules:

- `go.work` MAY be used for multi-module local development, but production CI SHOULD build from module roots unless the repository explicitly standardizes on workspace CI.
- The Go 1.25 `work` package pattern MAY be used for workspace-wide validation.
- LLM MUST inspect `go.work` before changing dependencies in a multi-module repository.
- LLM MUST NOT assume `./...` from the repository root equals all modules when `go.work` exists.

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

Go 1.25-specific recommended compatibility gates:

```bash
# Detect code sensitive to the experimental JSON implementation.
GOEXPERIMENT=jsonv2 go test ./...

# Detect cgo leak issues when AddressSanitizer is enabled.
go test -asan ./...
```

Rules:

- CI MUST fail on formatting drift.
- CI MUST fail on `go vet` findings.
- CI MUST fail on dependency graph inconsistency.
- CI SHOULD run `govulncheck` on main branch, release branch, and pull requests that change dependencies or security-sensitive code.
- CI SHOULD run `go test -race ./...` for packages with concurrency, HTTP servers, background workers, caches, channels, goroutines, shared maps, database transaction orchestration, or state-machine transitions.
- CI SHOULD test JSON-heavy packages with `GOEXPERIMENT=jsonv2` before adopting Go 1.25 broadly.
- LLM MUST include validation commands in final implementation notes when it changes code.

---

## 6. Go 1.25 Delta Rules

This section is mandatory for projects migrating from Go 1.24 to Go 1.25.

### 6.1 Language behavior

Go 1.25 does not introduce language changes that affect Go programs. However, code MUST still be reviewed against Go 1.25 compiler and standard-library behavior.

Rules:

- LLM MUST NOT invent Go 1.25 language syntax.
- Generic type aliases introduced in Go 1.24 remain allowed if the module targets Go 1.24+ and the project accepts generic aliases.
- Do not use Go 1.26+ APIs or syntax in Go 1.25 modules.

### 6.2 Error-first nil safety

Go 1.25 fixes a compiler bug that previously allowed some incorrect nil dereferences to appear successful when a result was used before checking `err`.

Bad:

```go
f, err := os.Open(name)
fileName := f.Name() // forbidden before err check
if err != nil {
	return err
}
```

Good:

```go
f, err := os.Open(name)
if err != nil {
	return fmt.Errorf("open %q: %w", name, err)
}
fileName := f.Name()
```

Rules:

- Any function returning `(T, error)` MUST have `err` checked before using `T`, unless the API explicitly guarantees `T` is valid on error.
- LLM MUST scan nearby code for result-before-error usage when touching error-handling code.
- Code review MUST reject dereferencing, method-calling, channel-sending, map-indexing, or field-reading from a possibly invalid result before checking `err`.

### 6.3 Container-aware `GOMAXPROCS`

Go 1.25 changes the default `GOMAXPROCS` behavior. On Linux, the runtime may consider cgroup CPU bandwidth limits, and the runtime may periodically update `GOMAXPROCS` when CPU availability changes.

Rules:

- Containerized services SHOULD allow Go 1.25 runtime defaults unless there is a measured reason to override them.
- Kubernetes CPU **limits** affect the Go 1.25 default; CPU **requests** do not.
- Do not set `GOMAXPROCS` manually in app code, Dockerfile, Helm chart, or entrypoint unless there is a benchmark/profiling result and rollback plan.
- If a legacy service sets `GOMAXPROCS`, migration review MUST decide whether to remove it or call `runtime.SetDefaultGOMAXPROCS()`.
- Libraries MUST NOT call `runtime.GOMAXPROCS` as a side effect.
- Application startup MAY log effective `runtime.GOMAXPROCS(0)`, CPU limit metadata, and process CPU settings for operational debugging.
- LLM MUST NOT add `GOMAXPROCS` tuning to “improve performance” without data.

### 6.4 Panic output

Go 1.25 changes text formatting for recovered-and-repanicked unhandled panic output.

Rules:

- Tests MUST NOT assert exact runtime panic text unless the test is specifically for panic formatting.
- Monitoring MUST NOT rely on exact panic line text for classification.
- Structured logging and explicit error values MUST be preferred over parsing panic output.

### 6.5 `go vet` new analyzers

Go 1.25 adds vet analyzers for misplaced `sync.WaitGroup.Add` calls and host/port construction that breaks IPv6.

Rules:

- `go vet ./...` MUST be a merge gate.
- `sync.WaitGroup.Add(1)` MUST happen before the goroutine/event it tracks.
- For goroutine fan-out without error propagation, prefer `sync.WaitGroup.Go` where appropriate.
- Address construction MUST use `net.JoinHostPort(host, port)` or equivalent API, not `fmt.Sprintf("%s:%d", host, port)`.

Bad:

```go
addr := fmt.Sprintf("%s:%d", host, port)
```

Good:

```go
addr := net.JoinHostPort(host, strconv.Itoa(port))
```

### 6.6 `sync.WaitGroup.Go`

Go 1.25 adds `(*sync.WaitGroup).Go`.

Rules:

- Use `wg.Go(fn)` for simple fire-and-wait goroutine groups where the task has no returned error.
- The function passed to `wg.Go` MUST NOT panic.
- If the task can fail, prefer `errgroup.Group` or an explicit result channel over hiding the error in logs.
- If using `wg.Add`/`Done`, `Add` MUST execute before starting the goroutine.
- A `WaitGroup` MUST NOT be copied after first use.
- A `WaitGroup` MUST NOT be embedded by value in structs that are copied.
- A reused `WaitGroup` MUST start new tasks only after the previous `Wait` has returned.
- LLM MUST NOT replace `errgroup` with `WaitGroup.Go` when error propagation or cancellation is required.

Good:

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

Better when errors matter:

```go
g, ctx := errgroup.WithContext(ctx)
for _, item := range items {
	item := item
	g.Go(func() error {
		return process(ctx, item)
	})
}
if err := g.Wait(); err != nil {
	return err
}
```

### 6.7 `testing/synctest`

Go 1.25 graduates `testing/synctest` to general availability.

Rules:

- Use `testing/synctest` for deterministic tests of timeouts, timers, cancellation, goroutines, channels, and asynchronous state transitions.
- Do not use `time.Sleep` as a synchronization mechanism in unit tests.
- Do not use `synctest` for tests that depend on real network I/O, external processes, real databases, real filesystems, or goroutines outside the test bubble.
- Tests using `synctest.Test` MUST be self-contained.
- `synctest.Wait()` MUST be called only inside a synctest bubble and MUST NOT be called concurrently by multiple goroutines in the same bubble.
- Do not use the old Go 1.24 `GOEXPERIMENT=synctest` API in Go 1.25 production tests.
- LLM SHOULD propose `testing/synctest` when it sees flaky tests caused by timers, sleeps, context cancellation, or goroutine scheduling.

### 6.8 Experimental `encoding/json/v2`

Go 1.25 includes an experimental JSON implementation enabled by `GOEXPERIMENT=jsonv2`.

Rules:

- Production code MUST continue to import `encoding/json` unless the project explicitly opts into the experiment.
- Do not import `encoding/json/v2` or `encoding/json/jsontext` in production code without architecture approval.
- JSON error messages MUST NOT be treated as stable public API.
- Tests SHOULD assert JSON behavior semantically, not by exact error-string text.
- JSON-heavy packages SHOULD run `GOEXPERIMENT=jsonv2 go test ./...` during migration to expose compatibility risks.
- LLM MUST NOT “modernize” JSON code to `json/v2` unless explicitly requested.

### 6.9 `net/http.CrossOriginProtection`

Go 1.25 adds `net/http.CrossOriginProtection` for rejecting non-safe cross-origin browser requests using Fetch metadata.

Rules:

- HTTP services that handle browser-authenticated state-changing requests SHOULD evaluate `CrossOriginProtection` as a CSRF defense layer.
- `CrossOriginProtection` does not replace authentication, authorization, input validation, origin policy review, session security, or explicit business-level authorization.
- Trusted origins MUST be exact scheme/host/port values; do not use broad or user-controlled trust configuration.
- Insecure bypass patterns MUST be rare, documented, tested, and reviewed as security-sensitive changes.
- Deny behavior SHOULD return safe, non-sensitive responses.
- LLM MUST NOT add trusted origins based only on examples, local development URLs, or guessed deployment domains.

Example:

```go
cop := http.NewCrossOriginProtection()
if err := cop.AddTrustedOrigin("https://app.example.com"); err != nil {
	return fmt.Errorf("configure cross-origin protection: %w", err)
}
handler := cop.Handler(mux)
```

### 6.10 Filesystem and `os.Root`

Go 1.24 introduced `os.Root`; Go 1.25 expands its methods and filesystem integration.

Rules:

- For user-influenced filesystem paths, prefer `os.Root` over manual path joining when restricting access to a directory tree.
- Do not use `http.Dir` or `os.DirFS` alone as a security boundary when symlinks or dotfiles may expose sensitive data.
- `Root` operations MUST preserve the intended root boundary.
- Code that copies, serves, archives, or deletes filesystem trees MUST explicitly define symlink behavior.
- `os.RemoveAll` on user-influenced paths MUST be treated as dangerous unless performed through a validated root boundary.
- LLM MUST NOT implement path traversal defense using only `strings.Contains(path, "..")`.

### 6.11 TLS and cryptography

Go 1.25 tightens some TLS behavior and adds crypto APIs.

Rules:

- SHA-1 TLS 1.2 signature algorithms MUST remain disabled unless a documented legacy interoperability exception is approved.
- Do not set `GODEBUG=tlssha1=1` in production without a security exception and decommission date.
- TLS configuration MUST set minimum versions and cipher policy according to organization security baseline.
- `crypto.MessageSigner` and `crypto.SignMessage` MAY be used when integrating signers that hash messages internally.
- Do not use undocumented or removed `crypto/elliptic` methods.
- Certificate parsing failures after Go 1.25 MUST be treated as compatibility/security findings, not suppressed automatically.
- FIPS behavior MUST be configured before process start; do not attempt runtime mutation of FIPS mode.

### 6.12 `log/slog`

Go 1.25 adds useful `slog` helpers such as `GroupAttrs` and source extraction.

Rules:

- Use structured logs for request IDs, trace IDs, user IDs, tenant IDs, case IDs, correlation IDs, workflow IDs, state transitions, dependency calls, retries, and failure classifications.
- Do not log secrets, tokens, passwords, private keys, session cookies, PII beyond approved policy, or full request/response bodies by default.
- Use stable attribute keys.
- Group nested attributes intentionally.
- Logging MUST preserve causal context: operation, input identifier, dependency, duration, outcome, and error category.

---

## 7. Formatting, Imports, and File Hygiene

### 7.1 Formatting

Go formatting is not subjective.

Rules:

- All Go files MUST be formatted with `gofmt`.
- Imports SHOULD be organized with `goimports` or equivalent IDE integration.
- Do not manually align fields, assignments, or comments in a way that fights `gofmt`.
- Do not use custom formatting conventions.

### 7.2 Import rules

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

### 7.3 Generated code

Generated files MUST contain a standard generated-code marker near the top:

```go
// Code generated by <tool>; DO NOT EDIT.
```

Rules:

- LLM MUST NOT manually edit generated files unless explicitly asked and no generator is available.
- If generated code changes, the generator command, version, and input source MUST be identified.
- Generated-code diffs MUST be reviewed for unexpectedly broad changes.

### 7.4 File size and package cohesion

Rules:

- A package MUST have one clear responsibility.
- Avoid dumping unrelated helpers into `utils`, `common`, or `shared` packages.
- Large files SHOULD be split by behavior, not by arbitrary line count.
- Keep tests close to the package they verify.
- Use `internal/` to enforce private boundaries across modules.

---

## 8. Package and Module Design

### 8.1 Package naming

Rules:

- Package names MUST be short, lowercase, and meaningful.
- Package names MUST NOT use underscores, mixedCaps, or vague names such as `common`, `base`, `misc`, `manager`, or `helper` unless already established in the codebase.
- Package names SHOULD describe provided capability, not implementation pattern.

Bad:

```go
package commonutils
```

Good:

```go
package validator
```

### 8.2 Package boundaries

Rules:

- A package MUST expose a small public API.
- Exported symbols MUST be intentionally stable.
- Internal implementation details MUST remain unexported.
- Cross-package dependencies MUST point inward toward stable abstractions, not outward toward transport or infrastructure details.
- Domain packages MUST NOT import HTTP handlers, CLI frameworks, SQL drivers, Kafka clients, or cloud SDKs unless they are explicitly infrastructure/domain integration packages.

### 8.3 `internal/` packages

Rules:

- Use `internal/` for code that must not be imported outside the repository or module subtree.
- Do not place reusable public libraries under `internal/`.
- Do not bypass `internal/` boundaries with copy-paste.

### 8.4 `cmd/` packages

Rules:

- `cmd/<app>/main.go` MUST be thin.
- Main packages should parse configuration, assemble dependencies, start runtime, and handle shutdown.
- Business logic MUST live outside `cmd/`.
- `main` MUST return meaningful exit status through a top-level `run(ctx, args)` function pattern where appropriate.

Example:

```go
func main() {
	ctx := context.Background()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

---

## 9. Naming Standards

Rules:

- Use clear names over clever names.
- Keep local variable names short only when the scope is short.
- Avoid stutter: `user.User` may be acceptable; `user.UserService` often signals poor package naming.
- Interfaces SHOULD be named by behavior, usually `Reader`, `Writer`, `Store`, `Clock`, `Notifier`, `Authorizer`, etc.
- Do not create interfaces before there are real multiple implementations or a test seam that justifies them.
- Acronyms MUST be consistently cased: `URL`, `ID`, `HTTP`, `JSON`, `SQL`, `API`, `TLS`.

Bad:

```go
type HttpClient struct{}
type UserId string
```

Good:

```go
type HTTPClient struct{}
type UserID string
```

---

## 10. Error Handling

### 10.1 Error-first discipline

Rules:

- Errors MUST be checked immediately unless there is a documented reason.
- Do not use successful return values before checking `err`.
- Do not ignore errors with `_` unless the API explicitly documents the error as safe to ignore and a comment explains why.
- Error paths MUST preserve enough context for diagnosis.

Bad:

```go
user, err := repo.Find(ctx, id)
log.Println(user.Name)
if err != nil {
	return err
}
```

Good:

```go
user, err := repo.Find(ctx, id)
if err != nil {
	return fmt.Errorf("find user %s: %w", id, err)
}
log.Println(user.Name)
```

### 10.2 Wrapping and matching

Rules:

- Use `fmt.Errorf("context: %w", err)` to preserve error identity.
- Use `errors.Is` and `errors.As` for matching.
- Sentinel errors MUST be stable and documented when exported.
- Do not compare error strings.
- Do not wrap errors that intentionally hide sensitive details from callers; sanitize first.

### 10.3 Domain errors

Rules:

- Domain errors SHOULD distinguish validation failure, not found, conflict, forbidden, unauthorized, dependency failure, timeout, cancellation, and invariant violation.
- Transport layers MUST map domain errors to transport responses explicitly.
- Domain packages MUST NOT return HTTP status codes unless the package is HTTP-specific.

### 10.4 Panic policy

Rules:

- Panic MUST NOT be used for ordinary business errors.
- Panic MAY be used for impossible programmer errors, invalid generated tables, or startup misconfiguration that makes the process unsafe to run.
- Goroutines MUST recover at process boundaries only when the recovery path can log, classify, and safely terminate or isolate the failed work.
- Recovered panics MUST NOT be silently swallowed.

---

## 11. Context and Cancellation

Rules:

- Functions that perform I/O, blocking work, retries, database queries, network calls, queue operations, or long CPU work MUST accept `context.Context`.
- `context.Context` MUST be the first parameter, named `ctx`.
- Do not store `context.Context` in structs except for request-scoped structs with narrow lifetime and strong justification.
- Do not pass `nil` context. Use `context.Background()` or `context.TODO()`.
- Always call cancel functions returned by `context.WithCancel`, `context.WithTimeout`, or `context.WithDeadline`.
- Do not use context values for optional parameters.
- Context values MAY be used for request-scoped metadata crossing API boundaries, such as trace IDs, auth principals, or tenant IDs, if the project already standardizes it.
- Background goroutines MUST have a shutdown path tied to context cancellation.

Bad:

```go
func FetchUser(id string) (*User, error)
```

Good:

```go
func FetchUser(ctx context.Context, id string) (*User, error)
```

---

## 12. Concurrency Standards

### 12.1 Goroutine lifecycle

Rules:

- Every goroutine MUST have an owner, purpose, cancellation path, and completion strategy.
- Do not start goroutines from libraries without giving callers a way to stop them.
- Do not leak goroutines on error, timeout, panic, test failure, or early return.
- Prefer `errgroup.WithContext` when goroutines can fail.
- Prefer `sync.WaitGroup.Go` only when tasks cannot return errors or errors are handled explicitly inside the task.
- Use bounded worker pools for unbounded input.

### 12.2 Channels

Rules:

- Channels are for coordination and ownership transfer, not as a default queue abstraction.
- The sender usually closes the channel.
- Do not close a channel from the receiver unless ownership is explicitly transferred.
- Do not send on a channel after cancellation without a `select` on `ctx.Done()`.
- Buffered channel size MUST be intentional and documented when it affects backpressure.

### 12.3 Shared state

Rules:

- Shared mutable state MUST be protected by a mutex, channel ownership, atomic primitive, or immutable copy-on-write strategy.
- Built-in maps MUST NOT be read and written concurrently without synchronization.
- `sync.Map` MUST be used only for its intended patterns: mostly-read caches, disjoint key ownership, or avoiding lock contention proven by profiling.
- Atomic operations MUST be used only when memory-order reasoning is simple and documented.

### 12.4 Mutexes

Rules:

- Do not copy `sync.Mutex`, `sync.RWMutex`, `sync.Once`, `sync.Pool`, `sync.Cond`, or `sync.WaitGroup` after first use.
- Keep critical sections small.
- Do not call external code while holding locks unless documented and safe.
- Do not hold locks across blocking I/O, network calls, database calls, or channel sends unless the lock is explicitly part of backpressure design.
- `TryLock` and `TryRLock` are rare and require justification.

### 12.5 Timers and tickers

Rules:

- Always stop tickers.
- Use `time.NewTimer`/`time.NewTicker` when lifecycle control matters.
- Do not use `time.Sleep` to wait for asynchronous work in production code except for intentional backoff or scheduling.
- In tests, prefer deterministic synchronization or `testing/synctest` over sleeps.

---

## 13. HTTP and Network Standards

### 13.1 Server timeouts

HTTP servers MUST set timeouts.

```go
srv := &http.Server{
	Addr:              addr,
	Handler:           handler,
	ReadHeaderTimeout: 5 * time.Second,
	ReadTimeout:       15 * time.Second,
	WriteTimeout:      30 * time.Second,
	IdleTimeout:       60 * time.Second,
}
```

Rules:

- Do not use `http.ListenAndServe` directly in production services.
- Set `ReadHeaderTimeout` at minimum.
- Shutdown MUST use `Server.Shutdown(ctx)` with a timeout.
- Long-running handlers MUST observe `r.Context()`.

### 13.2 Client timeouts

Rules:

- HTTP clients MUST set timeouts or use contexts with deadlines.
- Do not use `http.DefaultClient` for production dependency calls unless wrapped with explicit timeout policy.
- Response bodies MUST be closed.
- For connection reuse, response bodies SHOULD be drained when safe and bounded.
- Retries MUST be bounded, context-aware, and idempotency-aware.

### 13.3 Address construction

Rules:

- Use `net.JoinHostPort` for host/port strings.
- Do not use manual `fmt.Sprintf("%s:%d", host, port)` for network addresses.
- IPv6 MUST be supported unless explicitly out of scope.

### 13.4 HTTP handler design

Rules:

- Handlers MUST validate method, path variables, query parameters, headers, and body limits.
- Request bodies MUST be size-limited with `http.MaxBytesReader` or equivalent.
- Do not decode unbounded JSON request bodies.
- Do not log raw request bodies by default.
- Return consistent error responses.
- Do not expose internal error details to clients.

### 13.5 CSRF and cross-origin state changes

Rules:

- Browser-facing authenticated state-changing endpoints MUST have a CSRF/cross-origin defense strategy.
- For Go 1.25+, evaluate `net/http.CrossOriginProtection` as a default defense layer.
- Origin/trusted-origin changes MUST be security reviewed.
- Bypass patterns MUST be minimized and tested.

---

## 14. JSON and Serialization

Rules:

- Public JSON contracts MUST use explicit struct tags.
- Do not rely on default field names for public APIs.
- Unknown field handling MUST be explicit for external inputs.
- Use `json.Decoder.DisallowUnknownFields` for strict APIs where forward compatibility is not required.
- Distinguish absent, null, zero, and empty values when the API contract requires it.
- Do not use `map[string]any` as a domain model unless the schema is truly dynamic.
- Avoid exact JSON string comparisons in tests; compare decoded structures or canonicalized JSON.
- Do not depend on JSON error message text as stable API.
- `encoding/json/v2` is experimental in Go 1.25 and MUST NOT be adopted implicitly.

Example strict decode:

```go
var req CreateUserRequest
dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
dec.DisallowUnknownFields()
if err := dec.Decode(&req); err != nil {
	return fmt.Errorf("decode create user request: %w", err)
}
```

---

## 15. Filesystem, Paths, and Archives

Rules:

- Treat every user-controlled path as hostile.
- Prefer `os.Root` for rooted filesystem operations.
- Do not use simple string checks for path traversal prevention.
- Define symlink behavior explicitly.
- Do not serve `.git`, secrets, dotfiles, backups, or temporary files unintentionally.
- Archive extraction MUST defend against zip-slip/tar-slip, absolute paths, path traversal, device files, and symlinks if unsafe.
- File permissions MUST be explicit for created files and directories.
- Temporary files MUST be cleaned up.

Bad:

```go
path := base + "/" + userInput
```

Good:

```go
root, err := os.OpenRoot(base)
if err != nil {
	return err
}
defer root.Close()

b, err := root.ReadFile(userInput)
if err != nil {
	return err
}
```

---

## 16. Database Standards

### 16.1 Context and timeouts

Rules:

- Database calls MUST use context-aware APIs.
- Transactions MUST have bounded context lifetimes.
- Long-running migrations and maintenance jobs MUST have explicit timeout and observability policy.

### 16.2 Transactions

Rules:

- Transaction boundaries MUST be explicit.
- Always rollback on error unless commit succeeds.
- Do not perform external network calls inside a database transaction unless explicitly justified.
- Idempotency MUST be designed for retried commands.

Example:

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
	return fmt.Errorf("begin tx: %w", err)
}
defer tx.Rollback()

if err := update(ctx, tx); err != nil {
	return err
}

if err := tx.Commit(); err != nil {
	return fmt.Errorf("commit tx: %w", err)
}
```

### 16.3 SQL

Rules:

- Use parameterized queries.
- Do not concatenate SQL with untrusted input.
- Dynamic query builders MUST whitelist identifiers.
- Query result scanning MUST check errors.
- Migrations MUST be reversible or have a documented forward-fix plan.

---

## 17. Security Standards

Rules:

- Do not hardcode secrets.
- Do not log secrets.
- Do not return sensitive internal details to clients.
- Validate all external input.
- Enforce authorization at the operation boundary, not only at UI/router level.
- Use constant-time comparison for secrets/tokens where applicable.
- Use `crypto/rand` for security randomness.
- Do not use `math/rand` for security decisions.
- Do not implement custom cryptography.
- Run `govulncheck` in CI.
- Dependency additions MUST be reviewed for license, maintenance, transitive risk, and necessity.

---

## 18. Logging and Observability

Rules:

- Use structured logging for production services.
- Logs MUST include operation name and relevant correlation identifiers.
- Errors MUST be logged once at the boundary where they are handled, not repeatedly at every stack layer.
- Metrics MUST be used for rates, latency, saturation, queue depth, retry count, failure classes, and dependency health.
- Traces SHOULD cross process and dependency boundaries.
- State transitions MUST log previous state, next state, actor/system, correlation ID, and reason.
- Background workers MUST expose lifecycle logs: start, stop, drain, error, retry, poison message, and shutdown timeout.

Bad:

```go
slog.Error("failed", "err", err)
```

Good:

```go
slog.ErrorContext(ctx, "case transition failed",
	"case_id", caseID,
	"from_state", from,
	"to_state", to,
	"reason", reason,
	"err", err,
)
```

---

## 19. Testing Standards

### 19.1 Test structure

Rules:

- Tests MUST verify behavior, not implementation details, unless the package is infrastructure-level.
- Use table-driven tests when cases share setup and assertions.
- Test names MUST describe the behavior under test.
- Tests MUST be deterministic.
- Tests MUST NOT depend on execution order.
- Tests MUST NOT require external services unless explicitly marked as integration tests.

### 19.2 Test contexts

Rules:

- Use `t.Context()` where appropriate for test-scoped cancellation.
- Do not use `context.Background()` in tests that spawn goroutines or perform blocking calls unless there is no lifecycle risk.
- Use `t.Cleanup` for resources.

### 19.3 Flaky test prevention

Rules:

- Do not use arbitrary sleeps to wait for goroutines.
- Prefer channels, fake clocks, hooks, deterministic synchronization, or `testing/synctest`.
- Tests with timeouts MUST use generous deadlines only as safety limits, not as synchronization.
- Parallel tests MUST not mutate shared global state.
- `testing.AllocsPerRun` MUST NOT be used while parallel tests are running.

### 19.4 Fuzzing

Rules:

- Parsers, decoders, validators, URL/path processors, serialization logic, and security-sensitive input handling SHOULD have fuzz tests.
- Fuzz tests MUST minimize external dependencies.
- Crashing fuzz inputs MUST be committed as regression tests when appropriate.

### 19.5 Benchmarks

Rules:

- Go 1.24+ `b.Loop()` SHOULD be used for new benchmarks unless project policy prefers older style for compatibility.
- Benchmarks MUST avoid measuring setup unless setup is part of the behavior.
- Benchmarks MUST document input size, allocation expectations, and relevant environment assumptions.
- Performance claims MUST be backed by benchmark output.

Example:

```go
func BenchmarkEncode(b *testing.B) {
	payload := buildPayload()
	b.ReportAllocs()
	for b.Loop() {
		_, _ = encode(payload)
	}
}
```

---

## 20. Generics and Reflection

### 20.1 Generics

Rules:

- Use generics to remove real duplication while preserving readability.
- Do not use generics merely to appear modern.
- Constraints MUST be minimal and named when reused.
- Avoid generic APIs that hide domain meaning.
- Generic type aliases MAY be used when they simplify migration or API compatibility, but must not obscure ownership.

### 20.2 Reflection

Rules:

- Reflection MUST be contained behind small, tested APIs.
- Prefer explicit code over reflection in domain logic.
- Use reflection primarily for serialization, validation frameworks, dependency injection boundaries, or tooling.
- Reflection-heavy code MUST have tests for zero values, pointers, nils, embedded fields, tags, unexported fields, and concurrency if cached.
- Go 1.25 `reflect.TypeAssert` MAY be used in reflection-heavy hot paths when allocation reduction is measured.

### 20.3 Unsafe

Rules:

- `unsafe` is forbidden by default.
- Any `unsafe` usage MUST include a comment explaining invariants, alignment, lifetime, aliasing, immutability, and Go version assumptions.
- `unsafe` code MUST have tests and benchmarks.
- Go 1.25 compiler stack allocation improvements can expose incorrect `unsafe.Pointer` usage; migration review MUST inspect unsafe conversions carefully.
- Do not convert `string` to `[]byte` or `[]byte` to `string` unsafely unless the immutability/lifetime contract is proven and documented.

---

## 21. Configuration Standards

Rules:

- Configuration MUST be explicit, typed, validated at startup, and logged safely.
- Environment variables MUST have documented names, defaults, and validation rules.
- Missing required configuration MUST fail fast at startup.
- Do not read environment variables deep inside business logic.
- Secrets MUST be loaded through approved secret mechanisms.
- Feature flags MUST have owners, default values, expiry/review dates, and test coverage.

---

## 22. State Machine and Workflow Code

For regulatory systems, enforcement lifecycle modeling, case management, approval flows, and complex domain workflows, the following rules are mandatory.

Rules:

- States MUST be explicit typed constants, not loose strings scattered across code.
- Transitions MUST be centralized or generated from a declarative transition table.
- Transition validation MUST check current state, target state, actor/system permission, guard conditions, version/concurrency token, and idempotency key when applicable.
- Invalid transitions MUST return typed domain errors.
- State changes MUST be auditable.
- Side effects MUST happen after state persistence or via transactional outbox/event mechanism.
- Retried commands MUST be idempotent.
- Event handlers MUST be idempotent and version-aware.
- Partial failure behavior MUST be documented.

Example:

```go
type CaseState string

const (
	CaseStateDraft      CaseState = "DRAFT"
	CaseStateSubmitted  CaseState = "SUBMITTED"
	CaseStateUnderReview CaseState = "UNDER_REVIEW"
	CaseStateClosed     CaseState = "CLOSED"
)
```

---

## 23. Dependency Standards

Rules:

- Prefer the standard library when it is sufficient.
- Third-party dependencies MUST solve a real problem and have acceptable maintenance, license, security, and transitive dependency profile.
- Avoid large frameworks for small needs.
- Do not add dependency wrappers unless they create testability, isolation, policy enforcement, or future migration value.
- `go.sum` changes MUST correspond to intentional dependency changes.
- LLM MUST NOT run broad dependency upgrades unless explicitly requested.

---

## 24. Build Tags and Platform Code

Rules:

- Build tags MUST be explicit and tested for supported platforms.
- Platform-specific files MUST use canonical suffixes where possible: `_linux.go`, `_windows.go`, `_darwin.go`, `_unix.go`.
- Do not hide production behavior behind local-only build tags.
- Go 1.25 requires macOS 12 Monterey or later for Darwin builds.
- `windows/arm` is deprecated in Go 1.25 and should not be targeted for new work.

---

## 25. LLM Implementation Workflow

Before editing code, LLM MUST:

1. inspect `go.mod`, `go.work`, CI config, package layout, and existing tests;
2. identify Go version and whether the module targets Go 1.25;
3. identify validation commands used by the project;
4. identify existing error/logging/context conventions;
5. identify concurrency, filesystem, network, database, security, and state-machine risks in the requested change.

While editing code, LLM MUST:

1. keep diffs focused;
2. preserve public contracts unless explicitly changing them;
3. add or update tests for behavior changes;
4. avoid unrelated refactoring;
5. avoid broad dependency changes;
6. document assumptions in comments only when they are useful to future maintainers.

After editing code, LLM MUST report:

1. files changed;
2. behavior changed;
3. validation commands run or recommended;
4. known limitations;
5. any standards from this file that required trade-offs.

---

## 26. Review Checklist

A Go 1.25 change is reviewable only if the answer to every applicable item is “yes”.

### Version and build

- Does `go.mod` target the intended Go version?
- Is the toolchain policy consistent with CI?
- Are `go.mod` and `go.sum` changes intentional?
- Does `go test ./...` pass?
- Does `go vet ./...` pass?
- Does formatting pass?

### Go 1.25-specific

- Are all `(value, error)` results checked before using `value`?
- Does the code avoid manual `GOMAXPROCS` tuning unless justified?
- Are `WaitGroup` usages safe under Go 1.25 vet rules?
- Are host/port strings built with `net.JoinHostPort`?
- Are flaky timer/concurrency tests candidates for `testing/synctest`?
- Is `encoding/json/v2` avoided unless explicitly approved?
- Are browser-facing state-changing handlers protected against CSRF/cross-origin abuse?
- Are filesystem operations rooted and symlink-safe where needed?

### Correctness

- Are errors handled and wrapped with useful context?
- Are edge cases tested?
- Are nil, zero, empty, timeout, cancellation, and partial failure cases handled?
- Are state transitions legal and auditable?
- Are retries idempotent?

### Concurrency

- Does every goroutine have ownership and shutdown?
- Are shared maps protected?
- Are locks held safely?
- Are channels closed by owners?
- Does cancellation propagate?

### Security

- Are inputs validated?
- Are secrets protected?
- Are permissions checked at the correct layer?
- Are dependency additions justified?
- Does `govulncheck` pass or have documented exceptions?

### Observability

- Are logs structured and safe?
- Are important failures visible?
- Are metrics/traces added where operationally relevant?
- Do logs preserve correlation IDs and domain identifiers?

---

## 27. Forbidden Patterns

The following patterns are forbidden unless an exception is documented in review:

```go
// Ignoring important errors.
_ = json.NewEncoder(w).Encode(resp)
```

```go
// Using result before checking error.
f, err := os.Open(name)
fmt.Println(f.Name())
if err != nil { return err }
```

```go
// IPv6-broken host:port construction.
addr := fmt.Sprintf("%s:%d", host, port)
```

```go
// Unbounded production HTTP server.
http.ListenAndServe(addr, handler)
```

```go
// Context hidden in struct without lifecycle clarity.
type Client struct {
	ctx context.Context
}
```

```go
// Goroutine with no owner or shutdown.
go func() {
	for {
		work()
	}
}()
```

```go
// Unsafe path traversal defense.
if strings.Contains(path, "..") {
	return errors.New("bad path")
}
```

```go
// Security randomness using math/rand.
token := fmt.Sprint(rand.Int())
```

```go
// Exact JSON error text dependency.
if err.Error() == "invalid character 'x' looking for beginning of value" {
	// fragile
}
```

---

## 28. Required Agent Response Format for Code Changes

When an LLM modifies Go code, it MUST end with a concise implementation report:

```text
Changed:
- <file>: <what changed>

Validation:
- <command>: <passed / not run / failed + reason>

Notes:
- <assumptions, trade-offs, follow-up risks>
```

Rules:

- Do not claim tests passed unless they were actually run.
- If validation cannot be run, state why.
- If a rule in this standard is intentionally not followed, explicitly identify the exception.

---

## 29. Summary

Go 1.25 code must be boring, explicit, observable, secure, testable, and easy to review.

The most important Go 1.25-specific enforcement points are:

1. check `err` before using returned values;
2. let container-aware `GOMAXPROCS` work unless measured data says otherwise;
3. use `go vet` to catch WaitGroup and IPv6 host/port mistakes;
4. use `sync.WaitGroup.Go` only for no-error goroutine groups;
5. use `testing/synctest` for deterministic concurrent/time-based tests;
6. treat `encoding/json/v2` as experimental;
7. evaluate `net/http.CrossOriginProtection` for browser-facing state changes;
8. use rooted filesystem APIs for user-influenced paths;
9. keep crypto/TLS defaults secure;
10. force LLM-generated code through the same validation gates as human code.

# Strict Coding Standards — Go Testing

Status: Mandatory for all Go test implementation, review, refactoring, and generated code.  
Audience: LLM coding agents, reviewers, maintainers, QA engineers, and service owners.  
Scope: unit tests, table tests, subtests, integration tests, contract tests, fuzz tests, concurrency tests, HTTP/gRPC/database tests, test fixtures, test data, mocks/fakes, race testing, and CI test gates.

This standard is a merge gate. Any code that violates these rules must be rejected or accompanied by an explicit, reviewed exception.

---

## 1. Source authority

Use these sources as the primary authority when resolving ambiguity:

- Go `testing` package documentation.
- Go `testing/synctest` package documentation for deterministic concurrent/time-based tests.
- Go fuzzing documentation.
- Go race detector documentation.
- Go Test Comments and Code Review Comments.
- Go packages `httptest`, `iotest`, `fstest`, `quick`, `cmp`, `slices`, `maps`, and `context`.
- Project-specific architecture, security, validation, logging, telemetry, database, and API standards.

When this document conflicts with local security or regulatory policy, the stricter rule wins.

---

## 2. Non-negotiable testing principles

LLM-generated Go tests MUST obey these principles:

1. Tests must verify behavior, contracts, and invariants, not implementation trivia.
2. Every bug fix must add a regression test that fails without the fix.
3. Every domain invariant and state transition must have positive and negative tests.
4. Tests must be deterministic, isolated, and safe to run repeatedly in any order.
5. Tests must not depend on wall-clock sleeps except as a last resort with documented reason.
6. External resources must be replaced by fakes, test containers, local servers, or explicit integration-test gates.
7. Randomized tests must use logged seeds or deterministic seed control.
8. Concurrency tests must detect cancellation, leak, ordering, and race behavior.
9. Security-sensitive parsers and boundary handlers must include malicious input tests and fuzz tests where practical.
10. Tests must be readable enough to serve as executable documentation.

---

## 3. Test naming and structure

### 3.1 Test names

Test names MUST express behavior.

Preferred:

```go
func TestAuthorize_DeniesCrossTenantCaseAccess(t *testing.T) {}
func TestDecodeRequest_RejectsUnknownJSONFields(t *testing.T) {}
func TestTransition_RejectsClosedCaseReopenWithoutPermission(t *testing.T) {}
```

Avoid:

```go
func TestHandler(t *testing.T) {}
func TestService1(t *testing.T) {}
func TestFoo(t *testing.T) {}
```

### 3.2 Arrange/Act/Assert shape

Tests SHOULD be structured as:

1. arrange fixtures and dependencies;
2. act once;
3. assert observable behavior;
4. assert side effects if relevant.

Avoid hiding the important behavior inside over-generic helper functions.

### 3.3 Failure messages

Failure messages MUST explain the violated expectation.

Forbidden:

```go
if got != want {
    t.Fatal("failed")
}
```

Preferred:

```go
if got != want {
    t.Fatalf("status mismatch: got %s, want %s", got, want)
}
```

---

## 4. Table-driven tests

Use table-driven tests when behavior is naturally parameterized.

Required table fields:

- `name`;
- inputs;
- expected result or expected error;
- expected side effects where relevant.

Preferred:

```go
func TestValidateCaseCommand(t *testing.T) {
    tests := []struct {
        name    string
        cmd     CreateCaseCommand
        wantErr string
    }{
        {name: "missing subject", cmd: CreateCaseCommand{}, wantErr: "subject"},
        {name: "valid", cmd: CreateCaseCommand{Subject: "noise complaint"}},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateCreateCase(tt.cmd)
            if tt.wantErr == "" {
                if err != nil {
                    t.Fatalf("ValidateCreateCase() error = %v", err)
                }
                return
            }
            if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
                t.Fatalf("ValidateCreateCase() error = %v, want containing %q", err, tt.wantErr)
            }
        })
    }
}
```

### 4.1 Loop variable safety

When using parallel subtests or goroutines inside table loops, capture loop variables explicitly if required by the project Go version and lint policy.

```go
for _, tt := range tests {
    tt := tt
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // use tt
    })
}
```

---

## 5. Error assertions

### 5.1 Prefer semantic error checks

Use `errors.Is` and `errors.As` when code exposes semantic errors.

Preferred:

```go
if !errors.Is(err, ErrForbidden) {
    t.Fatalf("error = %v, want ErrForbidden", err)
}
```

Avoid relying only on exact error strings unless the string is a stable user-facing contract.

### 5.2 API error contract

For HTTP/gRPC/API errors, assert:

- status code or gRPC status;
- error code;
- user-safe message;
- absence of internal details;
- correlation ID/header where required.

---

## 6. Fixture and helper rules

### 6.1 Helpers must call `t.Helper()`

```go
func requireNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}
```

### 6.2 Helpers must not hide assertions excessively

A helper is allowed when it:

- removes repetitive setup;
- improves readability;
- produces good failure messages.

A helper is forbidden when it:

- hides the behavior under test;
- silently ignores cleanup errors;
- hides network/database coupling;
- creates global shared mutable state.

### 6.3 Test data builders

Builders are preferred over massive fixture literals when domain objects have many fields.

Rules:

- defaults must be valid;
- test overrides must be explicit;
- invalid builders must be named accordingly;
- no random hidden data unless seed is controlled.

---

## 7. Isolation and cleanup

### 7.1 Use `t.Cleanup`

Tests that create resources MUST register cleanup.

Examples:

- temp directories;
- database rows;
- files;
- HTTP servers;
- goroutines;
- environment variables;
- global config overrides;
- log/metric hooks.

Preferred:

```go
old := os.Getenv("APP_MODE")
t.Setenv("APP_MODE", "test")
t.Cleanup(func() { _ = os.Setenv("APP_MODE", old) }) // usually t.Setenv handles this
```

Use built-in `t.TempDir` and `t.Setenv` when possible.

### 7.2 No shared mutable global state

Tests MUST NOT share mutable package-level state unless synchronized and reset per test.

Forbidden:

```go
var testDB *sql.DB // mutated by multiple tests unpredictably
```

### 7.3 Parallel tests

`t.Parallel()` is allowed only when:

- test state is isolated;
- fixtures are not shared mutably;
- ports/files/env/global clocks are not shared unsafely;
- database rows use unique tenant/test IDs;
- log/metric collectors are safe or isolated.

---

## 8. Context and cancellation testing

Code that accepts `context.Context` MUST have tests for:

- already-canceled context;
- timeout/deadline exceeded;
- cancellation during blocking operation;
- cleanup after cancellation;
- no goroutine leaks after cancellation.

Preferred:

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()

err := svc.Process(ctx, cmd)
if !errors.Is(err, context.Canceled) {
    t.Fatalf("error = %v, want context.Canceled", err)
}
```

---

## 9. Concurrency testing

### 9.1 No sleep-based synchronization

Forbidden unless explicitly justified:

```go
time.Sleep(100 * time.Millisecond)
```

Preferred:

- channels;
- `sync.WaitGroup`;
- `errgroup`;
- `context` cancellation;
- fake clocks;
- `testing/synctest` for deterministic time/concurrency behavior where available.

### 9.2 `testing/synctest`

Use `testing/synctest` for tests involving:

- virtual time;
- timer behavior;
- context timeout;
- goroutines that should block/unblock deterministically;
- cancellation callbacks;
- retry/backoff logic that can use fake time.

Rules:

1. Tests inside a synctest bubble must be self-contained.
2. Avoid real network I/O inside the bubble.
3. Avoid external processes.
4. Avoid goroutines started outside the bubble.
5. Do not leak background goroutines.
6. Assert after `synctest.Wait()` when waiting for all bubble goroutines to block.

### 9.3 Race detector gate

Concurrency-sensitive code MUST pass:

```bash
go test -race ./...
```

At minimum, race tests are required for:

- shared maps;
- caches;
- worker pools;
- pipelines;
- metrics collectors;
- in-memory repositories;
- background schedulers;
- retry queues;
- state-machine processors.

---

## 10. Fuzz testing

### 10.1 Required fuzz targets

Fuzz tests SHOULD be added for:

- parsers;
- decoders;
- validators;
- URL/path normalization;
- JSON/XML handling;
- binary protocols;
- template-related sanitizers;
- security-sensitive boundary code;
- state transition command validation.

### 10.2 Fuzz target rules

Fuzz targets MUST be:

- deterministic;
- fast;
- side-effect free or isolated;
- independent of global mutable state;
- bounded in memory and CPU;
- capable of rejecting invalid input with `t.Skip()` when invalid input is not a bug.

Preferred:

```go
func FuzzDecodeCommand(f *testing.F) {
    f.Add([]byte(`{"caseId":"C-1","action":"close"}`))

    f.Fuzz(func(t *testing.T, b []byte) {
        cmd, err := DecodeCommand(bytes.NewReader(b))
        if err != nil {
            t.Skip()
        }
        if err := ValidateCommand(cmd); err != nil {
            return
        }
        _ = cmd
    })
}
```

### 10.3 Regression corpus

Inputs found by fuzzing that expose bugs MUST be committed as regression corpus when they are small, safe, and not sensitive.

Never commit fuzz corpus containing secrets, production PII, credentials, or proprietary payloads.

---

## 11. HTTP testing

HTTP handlers MUST be tested with `httptest`.

Required cases:

- valid request;
- malformed method/path/header/body;
- oversized body;
- invalid content type;
- strict JSON unknown field;
- auth missing/invalid/insufficient;
- context cancellation;
- downstream failure;
- safe error response;
- observability/correlation header where required.

Preferred:

```go
req := httptest.NewRequest(http.MethodPost, "/cases", strings.NewReader(body))
req.Header.Set("Content-Type", "application/json")
rr := httptest.NewRecorder()

handler.ServeHTTP(rr, req)

if rr.Code != http.StatusCreated {
    t.Fatalf("status = %d, want %d; body=%s", rr.Code, http.StatusCreated, rr.Body.String())
}
```

---

## 12. Database testing

Database code MUST have integration tests for:

- query success;
- no rows;
- constraint violation;
- transaction rollback;
- context timeout/cancel;
- nullable fields;
- optimistic lock conflict;
- pagination boundary;
- tenant isolation;
- migration compatibility.

Rules:

1. Unit tests may use fakes for application behavior.
2. SQL correctness requires real database tests or a reviewed SQL-level test strategy.
3. Do not mock `database/sql` internals casually.
4. Use unique schema/database/tenant/test IDs where parallelism exists.
5. Clean up test data or use ephemeral databases.

---

## 13. gRPC testing

Use gRPC test servers, `bufconn`, or approved integration setup.

Required cases:

- status code mapping;
- metadata propagation;
- deadline exceeded;
- cancellation;
- authentication/authorization failure;
- streaming backpressure and early close;
- protobuf backward compatibility where relevant.

---

## 14. Golden tests

Golden tests are allowed for stable outputs such as:

- templates;
- generated code;
- JSON/XML examples;
- CLI output;
- regulatory notice documents.

Rules:

1. Golden output must be deterministic.
2. Update flag must be explicit.
3. Golden changes require review.
4. Tests must diff readable output.
5. Golden output must not contain secrets or production PII.

---

## 15. Test coverage policy

Coverage is a signal, not the goal.

Required:

- critical domain logic must have meaningful branch and negative-case coverage;
- authorization paths must test deny cases;
- error handling paths must be tested;
- transaction rollback paths must be tested;
- retry/backoff idempotency must be tested;
- state-machine invalid transitions must be tested.

Forbidden:

- writing shallow tests only to increase coverage percentage;
- tests that simply call functions without assertions;
- over-mocking until no real behavior remains.

---

## 16. Test logging

Tests should log only when it improves failure diagnosis.

Rules:

- use `t.Logf`, not `fmt.Println`;
- never log secrets;
- include seed/config values for randomized tests;
- include inputs for fuzz regression only if safe;
- include correlation IDs for integration tests where helpful.

---

## 17. CI test gates

Default CI SHOULD run:

```bash
go test ./...
go test -race ./...
go vet ./...
govulncheck ./...
```

Additional gates where applicable:

```bash
go test -run Test -count=1 ./...
go test -fuzz=Fuzz -fuzztime=30s ./path/to/package
go test -tags=integration ./...
```

Long integration tests must be separated by build tags or CI stage, but they must not be abandoned.

---

## 18. Anti-patterns

The following are forbidden unless explicitly approved:

- Tests that only assert no panic for meaningful logic.
- Tests that rely on arbitrary `time.Sleep` for synchronization.
- Tests that require public internet access by default.
- Tests that depend on wall-clock current date without injected clock.
- Tests that share mutable global state.
- Tests that ignore cleanup errors for resources where cleanup matters.
- Mocking every dependency until behavior is meaningless.
- Testing private implementation details instead of observable behavior.
- Using production credentials, production endpoints, or production PII.
- Updating golden files without review.
- Skipping flaky tests instead of fixing determinism.

---

## 19. LLM implementation checklist

Before producing or modifying Go tests, the LLM MUST verify:

- [ ] Test names describe behavior.
- [ ] Positive, negative, and boundary cases are covered.
- [ ] Domain invariants and state transitions have explicit tests.
- [ ] Error assertions use semantic checks where possible.
- [ ] Helpers call `t.Helper()` and improve readability.
- [ ] Resources use `t.Cleanup`, `t.TempDir`, or equivalent cleanup.
- [ ] Tests are deterministic and isolated.
- [ ] Context cancellation/deadline behavior is tested where applicable.
- [ ] Concurrency tests avoid arbitrary sleeps.
- [ ] Race-sensitive code is covered by `-race` gate.
- [ ] Parsers/validators/boundary code have fuzz tests where practical.
- [ ] HTTP/gRPC/database tests include failure and security cases.
- [ ] Golden files are stable, reviewed, and secret-free.
- [ ] CI commands are documented or updated.

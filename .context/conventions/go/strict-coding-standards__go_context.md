# Strict Coding Standards — Go Context

**File:** `strict-coding-standards__go_context.md`  
**Scope:** `context.Context` usage in Go APIs, request handling, cancellation, deadlines, timeout budgets, values, observability propagation, external calls, database calls, testing, and shutdown.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go code.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

`context.Context` is a cancellation, deadline, and request-scoped propagation mechanism.

It is not:

- a dependency injection container;
- a bag of optional parameters;
- a domain model;
- a global variable substitute;
- a logging shortcut;
- an authorization model;
- a storage place for large objects;
- a way to hide required function inputs.

An LLM coding agent MUST NOT add, remove, or modify context usage unless it preserves cancellation correctness, deadline semantics, API clarity, and resource cleanup.

---

## 1. Source Authority

This standard is derived from official Go package documentation and Go concurrency guidance.

Primary references:

- `context` package: https://pkg.go.dev/context
- Go blog: Context: https://go.dev/blog/context
- Go blog: Pipelines and cancellation: https://go.dev/blog/pipelines
- `net/http` package: https://pkg.go.dev/net/http
- `database/sql` package: https://pkg.go.dev/database/sql
- `os/signal` package: https://pkg.go.dev/os/signal
- `errgroup` package: https://pkg.go.dev/golang.org/x/sync/errgroup
- Go Memory Model: https://go.dev/ref/mem

---

## 2. Mental Model

### 2.1 Context Is a Tree

Derived contexts form a cancellation tree.

When a parent context is canceled, all children derived from it are canceled. A child context may have a tighter deadline than its parent, but it MUST NOT be used to secretly extend the parent's budget.

### 2.2 Context Is Request-Scoped

Context should flow through a request, command, job, workflow step, or component run loop.

It should not be stored as long-lived object state.

### 2.3 Context Carries Signals, Not Business Truth

Business concepts such as tenant, actor, case ID, command ID, workflow transition, and authorization decision SHOULD be explicit parameters or fields in a command object.

A context may carry correlation or transport-scoped values, but domain logic MUST NOT depend on hidden context values when explicit modelling is possible.

---

## 3. Function Signature Standard

### 3.1 Context Must Be First Parameter

Any function that accepts a context MUST take it as the first parameter.

Required:

```go
func (s *Service) ApproveCase(ctx context.Context, cmd ApproveCaseCommand) error
```

Forbidden:

```go
func (s *Service) ApproveCase(cmd ApproveCaseCommand, ctx context.Context) error
```

### 3.2 Do Not Use Context for Pure Functions

Do not add `context.Context` to pure computation that does not block, call external systems, allocate long-running work, observe cancellation, or need request-scoped propagation.

Forbidden:

```go
func NormalizeName(ctx context.Context, name string) string
```

Required:

```go
func NormalizeName(name string) string
```

### 3.3 Use Context When Operation Can Block or Be Canceled

A function SHOULD accept context if it:

- performs network I/O;
- performs database I/O;
- waits on a channel;
- waits on a lock-like abstraction;
- starts goroutines;
- calls external services;
- performs long-running computation;
- performs retries/backoff;
- reads/writes large files;
- participates in request or job lifecycle.

### 3.4 Public API Compatibility

Adding context to public APIs is a breaking change in Go libraries. The agent MUST consider versioning and migration impact.

For internal application code, adding context is often correct when cancellation propagation is missing.

---

## 4. No Nil Context

A context parameter MUST never be nil.

Forbidden:

```go
svc.Do(nil, input)
```

Required:

```go
svc.Do(context.Background(), input)
```

In tests:

```go
ctx := context.Background()
```

If unsure which context to use temporarily, use `context.TODO()` and add a clear follow-up only in transitional code. Do not leave `TODO` in final production code without justification.

---

## 5. Do Not Store Context in Structs

Context MUST NOT be stored in a struct except in rare framework integration types where the struct itself is request-scoped and not retained.

Forbidden:

```go
type Service struct {
    ctx context.Context
    repo Repository
}
```

Required:

```go
type Service struct {
    repo Repository
}

func (s *Service) Execute(ctx context.Context, cmd Command) error {
    return s.repo.Save(ctx, cmd)
}
```

Reason: storing context obscures lifetime, leaks cancellation ownership, and makes concurrent calls unsafe or confusing.

---

## 6. Context Creation Standard

### 6.1 Use Incoming Context at Boundaries

HTTP handlers MUST start from `r.Context()`.

```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    _ = h.service.Execute(ctx, commandFrom(r))
}
```

CLI commands SHOULD create a root context that observes OS signals.

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
```

Tests SHOULD use `context.Background()` unless testing cancellation or deadline behavior.

### 6.2 Always Call Cancel

When using `WithCancel`, `WithTimeout`, or `WithDeadline`, the returned cancel function MUST be called to release resources.

Required:

```go
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
defer cancel()
```

Forbidden:

```go
ctx, _ := context.WithTimeout(parent, 2*time.Second)
```

### 6.3 Cancel Function Ownership Must Be Local

The function that creates a cancellable context should normally own and call the cancel function.

Avoid returning `cancel` except for explicit lifecycle APIs.

Problematic:

```go
func NewRequestContext(parent context.Context) (context.Context, context.CancelFunc) {
    return context.WithTimeout(parent, time.Second)
}
```

Acceptable only when caller ownership is explicit and tested.

---

## 7. Deadline and Timeout Budget Standard

### 7.1 Deadline Owner Must Be Clear

Only boundary layers should usually define total request deadlines:

- HTTP server timeout;
- CLI command timeout;
- worker job timeout;
- scheduled task timeout;
- workflow step timeout.

Inner layers may set narrower deadlines for downstream dependencies, but MUST respect the parent context.

### 7.2 Do Not Blindly Add Timeout Everywhere

Forbidden:

```go
func (r *Repo) Save(ctx context.Context, e Entity) error {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    return r.db.Save(ctx, e)
}
```

This may be wrong because the repository has no knowledge of the caller's SLA.

Better:

```go
func (r *Repo) Save(ctx context.Context, e Entity) error {
    return r.db.Save(ctx, e)
}
```

If a dependency-specific timeout is required, make it configurable and documented.

### 7.3 Budget Splitting Must Be Explicit

For multi-step operations, do not give every step the full original timeout if the total operation has a fixed SLA.

Preferred shape:

```go
deadline, ok := ctx.Deadline()
if ok {
    remaining := time.Until(deadline)
    if remaining <= 0 {
        return ctx.Err()
    }
}
```

Use explicit timeout configuration for downstream calls:

```go
lookupCtx, cancel := context.WithTimeout(ctx, s.lookupTimeout)
defer cancel()
```

### 7.4 Do Not Extend Parent Deadline

Creating a child context with a later deadline than the parent does not extend the effective deadline and is misleading.

Forbidden:

```go
child, cancel := context.WithTimeout(ctx, 10*time.Minute) // parent may already expire earlier
```

unless documented as a maximum cap and parent deadline is intentionally authoritative.

---

## 8. Cancellation Handling Standard

### 8.1 Blocking Code Must Select on `ctx.Done()`

Forbidden:

```go
job := <-jobs
```

Required:

```go
select {
case job := <-jobs:
    return handle(ctx, job)
case <-ctx.Done():
    return ctx.Err()
}
```

### 8.2 Loops Must Check Cancellation

Long-running loops MUST observe cancellation.

```go
for _, item := range items {
    if err := ctx.Err(); err != nil {
        return err
    }
    if err := process(ctx, item); err != nil {
        return err
    }
}
```

For CPU-heavy loops, check periodically rather than every instruction-level operation.

### 8.3 Retry and Backoff Must Be Cancelable

Forbidden:

```go
time.Sleep(backoff)
```

Required:

```go
timer := time.NewTimer(backoff)
defer timer.Stop()

select {
case <-timer.C:
case <-ctx.Done():
    return ctx.Err()
}
```

### 8.4 Return Context Errors Intentionally

When cancellation stops work, return `ctx.Err()` or wrap it while preserving identity.

```go
if err := ctx.Err(); err != nil {
    return fmt.Errorf("approve case canceled: %w", err)
}
```

Callers must be able to use:

```go
errors.Is(err, context.Canceled)
errors.Is(err, context.DeadlineExceeded)
```

---

## 9. Cancellation Cause Standard

When using Go versions that support cancellation causes, use `context.WithCancelCause` when the reason for cancellation matters across goroutines.

Example:

```go
ctx, cancel := context.WithCancelCause(parent)
defer cancel(nil)

g.Go(func() error {
    if err := work(ctx); err != nil {
        cancel(fmt.Errorf("worker failed: %w", err))
        return err
    }
    return nil
})

if err := g.Wait(); err != nil {
    return context.Cause(ctx)
}
```

Rules:

- use causes for diagnostic and orchestration value;
- do not expose sensitive internal errors across security boundaries;
- still preserve `context.Canceled` / `context.DeadlineExceeded` semantics when callers rely on them.

---

## 10. `context.WithoutCancel` Standard

`context.WithoutCancel` is dangerous when used casually because it intentionally detaches cancellation from the parent.

Allowed only when:

- the follow-up work must continue after client cancellation;
- it has its own bounded timeout;
- it does not use request-owned resources;
- it does not mutate response state;
- it is observable;
- failure policy is explicit.

Forbidden:

```go
go audit(context.WithoutCancel(r.Context()), event)
```

Required:

```go
auditCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Second)
defer cancel()

if err := h.audit.Enqueue(auditCtx, event); err != nil {
    h.log.Warn("audit enqueue failed", "error", err)
}
```

For durable post-response work, prefer outbox or queue rather than detached goroutine.

---

## 11. Context Values Standard

### 11.1 Context Values Are Last Resort

Use context values only for request-scoped data that transits process/API boundaries and is not part of function-specific business input.

Usually acceptable:

- trace/span context;
- request ID;
- correlation ID;
- logger enriched by middleware;
- authentication claims at transport boundary;
- locale at presentation boundary.

Usually forbidden:

- database handle;
- repository;
- service dependency;
- optional function parameter;
- business command field;
- large object;
- mutable map/slice;
- secrets;
- transaction object unless framework-specific and rigorously controlled.

### 11.2 Context Keys Must Be Type-Safe

Forbidden:

```go
ctx = context.WithValue(ctx, "userID", userID)
```

Required:

```go
type userIDKey struct{}

func WithUserID(ctx context.Context, userID string) context.Context {
    return context.WithValue(ctx, userIDKey{}, userID)
}

func UserIDFrom(ctx context.Context) (string, bool) {
    v, ok := ctx.Value(userIDKey{}).(string)
    return v, ok
}
```

### 11.3 Do Not Hide Required Inputs in Context

Forbidden:

```go
func (s *Service) Approve(ctx context.Context, caseID string) error {
    actor := ctx.Value(actorKey{}).(Actor) // hidden required business input
    return s.approve(ctx, actor, caseID)
}
```

Required:

```go
type ApproveCaseCommand struct {
    CaseID string
    Actor  Actor
    Reason string
}

func (s *Service) Approve(ctx context.Context, cmd ApproveCaseCommand) error
```

### 11.4 Context Values Must Be Immutable or Effectively Immutable

Do not store mutable maps/slices/pointers that can be modified concurrently.

If a value must be placed in context, prefer immutable scalar or immutable struct.

---

## 12. HTTP Standard

### 12.1 Server Handlers Must Use Request Context

```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    result, err := h.service.Execute(ctx, parseCommand(r))
    if err != nil {
        writeError(w, err)
        return
    }
    writeJSON(w, result)
}
```

### 12.2 Do Not Use Request Context After Handler Returns

Forbidden:

```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    go h.sendEmail(r.Context(), email)
    w.WriteHeader(http.StatusAccepted)
}
```

Required for durable async:

```go
if err := h.outbox.Append(r.Context(), EmailRequested{...}); err != nil {
    writeError(w, err)
    return
}
w.WriteHeader(http.StatusAccepted)
```

### 12.3 Outgoing HTTP Requests Must Use Context

Forbidden:

```go
req, err := http.NewRequest("GET", url, nil)
```

Required:

```go
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
```

### 12.4 HTTP Client Timeout Policy

Use context deadlines and client-level timeouts deliberately.

Rules:

- `http.Client.Timeout` is a total request cap;
- per-call context can be used for request-specific budgets;
- do not leave both unspecified for external calls;
- do not set conflicting timeouts without documenting precedence.

---

## 13. Database Standard

### 13.1 Use Context-Aware Database Methods

Required:

```go
row := db.QueryRowContext(ctx, query, args...)
_, err := db.ExecContext(ctx, query, args...)
```

Forbidden:

```go
row := db.QueryRow(query, args...)
_, err := db.Exec(query, args...)
```

### 13.2 Transactions Must Use the Same Context Deliberately

A transaction context controls begin and operation cancellation. The agent MUST understand what happens if the context is canceled before commit/rollback.

Required shape:

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil {
    return err
}
defer func() { _ = tx.Rollback() }()

if _, err := tx.ExecContext(ctx, query, args...); err != nil {
    return err
}

if err := tx.Commit(); err != nil {
    return err
}
```

If commit must use a different timeout or cannot be canceled the same way, document it and test it.

### 13.3 Repository Must Not Invent Hidden Business Timeout

Repository methods should accept and propagate context. They should not silently override the caller's deadline unless configured as dependency-specific guardrail.

---

## 14. External Client Standard

Every client wrapper MUST accept and propagate context:

```go
type PaymentClient interface {
    Authorize(ctx context.Context, req AuthorizeRequest) (AuthorizeResponse, error)
}
```

Forbidden:

```go
type PaymentClient interface {
    Authorize(req AuthorizeRequest) (AuthorizeResponse, error)
}
```

except for pure local computation.

External calls MUST have:

- timeout or deadline;
- cancellation propagation;
- retry policy respecting context;
- idempotency policy if retried;
- observability.

---

## 15. Goroutine and `errgroup` Standard

When spawning subtasks that share a request lifecycle, use `errgroup.WithContext`.

```go
g, ctx := errgroup.WithContext(ctx)

g.Go(func() error { return a(ctx) })
g.Go(func() error { return b(ctx) })

if err := g.Wait(); err != nil {
    return err
}
```

Rules:

- pass derived `ctx` into subtasks;
- subtasks must return promptly on cancellation;
- do not start goroutines that ignore `ctx`;
- do not use `sync.WaitGroup` when error propagation is required.

---

## 16. Background Work Standard

### 16.1 Component Run Loops Accept Context

Long-lived components should expose:

```go
Run(ctx context.Context) error
```

Example:

```go
func (w *Worker) Run(ctx context.Context) error {
    ticker := time.NewTicker(w.interval)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            if err := w.tick(ctx); err != nil {
                return err
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}
```

### 16.2 Start/Stop APIs Must Define Context Ownership

If a component uses `Start`/`Stop`, it must define who owns cancellation.

Acceptable:

```go
type Worker struct {
    cancel context.CancelFunc
    done   chan struct{}
}
```

Only if:

- `Start` is idempotent or rejects duplicate start;
- `Stop` is idempotent;
- `Stop` waits or has explicit timeout semantics;
- errors are observable.

Prefer `Run(ctx)` when possible.

---

## 17. Logging, Tracing, and Metrics Context

### 17.1 Context May Propagate Trace State

Instrumentation libraries may use context to propagate trace/span state. This is valid.

Application code should avoid reaching into context repeatedly for business data. Extract at boundary if needed.

### 17.2 Logger in Context Is Allowed Only by Project Convention

If the project uses logger-in-context, wrap access through helper functions and provide fallback behavior.

Do not require every function to pull logger from context if a dependency-injected logger would be clearer.

### 17.3 No Sensitive Data in Context

Do not store secrets, tokens, passwords, raw authorization headers, private keys, or confidential payloads in context values.

Context may be passed through logs, traces, hooks, and middleware chains. Treat it as propagation infrastructure, not a vault.

---

## 18. Authorization and Actor Standard

Context may carry authentication claims at transport middleware boundary, but domain/service methods SHOULD receive actor information explicitly.

Boundary extraction:

```go
actor, ok := auth.ActorFromContext(r.Context())
if !ok {
    writeUnauthorized(w)
    return
}

cmd := ApproveCaseCommand{
    CaseID: caseID,
    Actor:  actor,
}
err := h.service.ApproveCase(r.Context(), cmd)
```

Forbidden domain logic:

```go
func (s *CaseService) ApproveCase(ctx context.Context, caseID string) error {
    actor := auth.MustActorFromContext(ctx)
    return s.policy.CanApprove(actor, caseID)
}
```

Reason: regulatory/audit decisions must be explicit, testable, and defensible.

---

## 19. Tenant and Locale Standard

Tenant, locale, and request ID may appear in context at boundaries, but business commands SHOULD carry tenant explicitly when it affects data access, authorization, or invariants.

Forbidden:

```go
func (r *Repo) GetCase(ctx context.Context, id string) (Case, error) {
    tenant := tenantFromContext(ctx)
    return r.query(ctx, tenant, id)
}
```

Required:

```go
func (r *Repo) GetCase(ctx context.Context, tenantID TenantID, id CaseID) (Case, error)
```

---

## 20. Context in Tests

### 20.1 Use Background for Normal Tests

```go
ctx := context.Background()
```

### 20.2 Use Timeout as Guardrail, Not Synchronization

```go
ctx, cancel := context.WithTimeout(context.Background(), time.Second)
defer cancel()
```

A test timeout prevents hanging. It does not prove correctness by itself.

### 20.3 Test Cancellation Explicitly

Required for cancelable operations:

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()

err := svc.Execute(ctx, cmd)
if !errors.Is(err, context.Canceled) {
    t.Fatalf("expected canceled, got %v", err)
}
```

### 20.4 Test Deadline Explicitly

```go
ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
defer cancel()

time.Sleep(time.Millisecond)

err := svc.Execute(ctx, cmd)
if !errors.Is(err, context.DeadlineExceeded) {
    t.Fatalf("expected deadline exceeded, got %v", err)
}
```

Prefer fake clocks or deterministic synchronization for complex timing logic.

---

## 21. Context and Cleanup

### 21.1 Context Cancellation Is Not Cleanup by Itself

Canceling context signals cancellation. It does not automatically close arbitrary resources unless code observes it.

Required:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return worker.Run(ctx) })

return g.Wait()
```

### 21.2 Always Close Resources Explicitly

Even with context, still close:

- response bodies;
- files;
- rows;
- tickers;
- timers when appropriate;
- subscriptions;
- message consumers;
- database transactions.

Forbidden:

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
return decode(resp.Body) // body never closed
```

Required:

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()
return decode(resp.Body)
```

---

## 22. Context and Error Mapping

### 22.1 Preserve Canceled and Deadline Errors

Do not convert context cancellation into vague internal errors.

Forbidden:

```go
if err != nil {
    return errors.New("operation failed")
}
```

Required:

```go
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}
```

### 22.2 HTTP Mapping

Typical mapping:

| Error                      | HTTP Meaning                                                       |
| -------------------------- | ------------------------------------------------------------------ |
| `context.Canceled`         | client disconnected / request canceled; often no response possible |
| `context.DeadlineExceeded` | 504 Gateway Timeout or 503 depending layer                         |
| downstream timeout         | 504 or domain-specific unavailable                                 |

Do not always map cancellation to 500.

### 22.3 Domain Mapping

For business workflows, context cancellation means execution did not complete. It is not automatically a business rejection.

Do not mark a case as `REJECTED` merely because request context timed out. Use separate technical failure/retry semantics.

---

## 23. Context and Domain Transactions

For regulatory/workflow systems:

- context cancellation may abort the technical operation;
- the domain state must remain consistent;
- partial side effects must be avoided or made recoverable;
- state transitions must be committed transactionally with outbox events when async work follows.

Forbidden:

```go
case.Status = Approved
_ = notify(ctx, case)
return repo.Save(ctx, case)
```

Required:

```go
err := repo.WithTx(ctx, func(tx Tx) error {
    c, err := tx.GetCaseForUpdate(ctx, cmd.CaseID)
    if err != nil {
        return err
    }
    if err := c.Approve(cmd.Actor, cmd.Reason); err != nil {
        return err
    }
    if err := tx.SaveCase(ctx, c); err != nil {
        return err
    }
    return tx.AppendOutbox(ctx, CaseApproved{CaseID: c.ID, Version: c.Version})
})
```

---

## 24. Context and API Layering

### 24.1 Transport Layer

Responsibilities:

- derive from request context;
- extract transport values;
- enforce top-level timeout if needed;
- map context errors to protocol response.

### 24.2 Application Service Layer

Responsibilities:

- accept context;
- propagate context;
- optionally split budget for dependencies;
- model actor/tenant/command explicitly;
- return cancellation/deadline errors transparently.

### 24.3 Domain Layer

Pure domain objects SHOULD NOT depend on context.

Forbidden:

```go
func (c *Case) Approve(ctx context.Context) error
```

Required:

```go
func (c *Case) Approve(actor Actor, reason string, now time.Time) error
```

### 24.4 Infrastructure Layer

Responsibilities:

- use context-aware client methods;
- respect deadlines;
- close resources;
- preserve error identity;
- expose dependency-specific timeout configuration when needed.

---

## 25. Anti-Patterns

The agent MUST NOT generate these patterns:

1. `context.Context` stored in a long-lived struct;
2. nil context;
3. context not first parameter;
4. context added to pure functions unnecessarily;
5. missing `defer cancel()` after `WithTimeout`/`WithCancel`;
6. context values used for required business parameters;
7. string keys for context values;
8. secrets or large mutable objects in context;
9. HTTP outgoing request without context;
10. database call without context-aware method;
11. retry loop ignoring context;
12. `time.Sleep` instead of cancelable wait;
13. goroutine that ignores context;
14. `context.Background()` used deep inside request path;
15. `WithoutCancel` used without new timeout;
16. cancellation mapped to business rejection;
17. context errors wrapped without `%w`;
18. request context used after request lifecycle;
19. timeout hardcoded in repository without ownership rationale;
20. domain entity method requiring context.

---

## 26. LLM Implementation Checklist

Before producing or modifying code with context, the LLM MUST verify:

- [ ] Context is first parameter where used.
- [ ] No nil context is passed.
- [ ] Context is not stored in long-lived structs.
- [ ] The function actually needs context.
- [ ] Parent context is propagated, not replaced with `Background`.
- [ ] `cancel` is called for derived contexts.
- [ ] Deadline owner is clear.
- [ ] Dependency-specific timeouts are configurable or justified.
- [ ] Blocking sends/receives/waits observe `ctx.Done()`.
- [ ] Retries/backoff are cancelable.
- [ ] Outgoing HTTP/DB/client calls use context-aware APIs.
- [ ] Context values use private typed keys.
- [ ] Required business inputs are explicit, not hidden in context.
- [ ] Context errors preserve `errors.Is` behavior.
- [ ] Detached work uses `WithoutCancel` only with bounded timeout and rationale.
- [ ] Tests cover cancellation/deadline behavior where relevant.
- [ ] Domain logic remains pure where possible.

---

## 27. Reviewer Checklist

A reviewer MUST reject context usage when:

- context is used as parameter bag;
- cancellation does not actually unblock the operation;
- timeout ownership is unclear;
- caller deadline is ignored or replaced;
- context values hide domain requirements;
- `Background` appears inside request-processing code without reason;
- goroutines outlive their context owner;
- resources are not closed;
- context errors become generic failures;
- tests do not exercise cancellation for blocking code.

---

## 28. Decision Table

| Situation                        | Required Pattern                                  |
| -------------------------------- | ------------------------------------------------- |
| HTTP handler                     | use `r.Context()`                                 |
| CLI root command                 | `signal.NotifyContext(context.Background(), ...)` |
| request-scoped subtasks          | `errgroup.WithContext(ctx)`                       |
| outgoing HTTP                    | `http.NewRequestWithContext`                      |
| database query                   | `QueryContext`, `ExecContext`, `BeginTx`          |
| retry/backoff                    | timer + select on `ctx.Done()`                    |
| pure domain method               | no context parameter                              |
| actor/tenant in business command | explicit command field                            |
| trace propagation                | context value via instrumentation                 |
| post-response durable work       | outbox/queue, not request context goroutine       |
| detached non-durable cleanup     | `WithoutCancel` + own timeout + observability     |
| timeout at boundary              | `WithTimeout` + `defer cancel()`                  |
| dependency-specific timeout      | configurable child context                        |

---

## 29. Example: Correct Service Shape

```go
type ApproveCaseCommand struct {
    CaseID CaseID
    Actor  Actor
    Reason string
    Now    time.Time
}

type CaseService struct {
    repo Repository
}

func (s *CaseService) ApproveCase(ctx context.Context, cmd ApproveCaseCommand) error {
    if err := ctx.Err(); err != nil {
        return err
    }

    if err := validateApproveCommand(cmd); err != nil {
        return err
    }

    err := s.repo.WithTx(ctx, func(tx Tx) error {
        c, err := tx.GetCaseForUpdate(ctx, cmd.CaseID)
        if err != nil {
            return err
        }
        if err := c.Approve(cmd.Actor, cmd.Reason, cmd.Now); err != nil {
            return err
        }
        if err := tx.SaveCase(ctx, c); err != nil {
            return err
        }
        return tx.AppendOutbox(ctx, CaseApproved{CaseID: c.ID, Version: c.Version})
    })
    if err != nil {
        if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
            return fmt.Errorf("approve case interrupted: %w", err)
        }
        return fmt.Errorf("approve case: %w", err)
    }

    return nil
}
```

Properties:

- context is first parameter;
- actor is explicit;
- domain method does not need context;
- DB operations receive context;
- cancellation is preserved;
- side effect is outboxed transactionally.

---

## 30. Final Rule

Context is acceptable only when it makes cancellation, deadline, and request-scoped propagation clearer.

If context hides ownership, hides business inputs, weakens cancellation, or obscures deadlines, the agent MUST redesign the API instead of adding context mechanically.

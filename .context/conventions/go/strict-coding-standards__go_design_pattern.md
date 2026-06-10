# Strict Coding Standards — Go Design Pattern

> Mandatory engineering conventions for LLM-assisted design, implementation, refactoring, and review of Go code that uses design patterns.
>
> This document is a merge gate. It is not an inspirational pattern catalog.

---

## 0. Scope

This document defines strict rules for applying design patterns in Go.

It exists because LLMs often fail in two opposite ways:

1. they produce under-designed code where business rules, lifecycle, retries, authorization, state transitions, and failure behavior are scattered; or
2. they copy Java/C#/TypeScript design patterns into Go and create unnecessary abstraction, fake inheritance, global service locators, and interface pollution.

These standards apply to:

- application services;
- HTTP/gRPC handlers;
- CLI commands;
- background workers;
- data access layers;
- workflow/state-machine implementations;
- integration clients;
- tests and fakes;
- generated or hand-written glue code.

Patterns are allowed only when they preserve Go's strengths:

- small packages;
- explicit dependencies;
- simple interfaces;
- value-oriented design;
- clear error handling;
- context-aware boundaries;
- deterministic tests;
- low cognitive overhead.

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
- Organizing Go code: <https://go.dev/blog/organizing-go-code>
- Go Memory Model: <https://go.dev/ref/mem>
- Go Concurrency Patterns — Pipelines and cancellation: <https://go.dev/blog/pipelines>
- Go Concurrency Patterns — Context: <https://go.dev/blog/context>
- Errors are values: <https://go.dev/blog/errors-are-values>
- Working with Errors in Go 1.13: <https://go.dev/blog/go1.13-errors>
- `context`: <https://pkg.go.dev/context>
- `errors`: <https://pkg.go.dev/errors>
- `sync`: <https://pkg.go.dev/sync>
- `net/http`: <https://pkg.go.dev/net/http>
- `log/slog`: <https://pkg.go.dev/log/slog>
- `database/sql`: <https://pkg.go.dev/database/sql>
- Google Go Style Guide: <https://google.github.io/styleguide/go/>

If this document conflicts with official Go documentation, official Go documentation wins.

---

## 2. Normative Language

- **MUST** means required.
- **MUST NOT** means forbidden.
- **SHOULD** means expected unless a documented reason exists.
- **MAY** means permitted with judgment.
- **LLM MUST** means the code agent must enforce the rule before producing or modifying code.

Every non-trivial pattern choice MUST be justified by at least one of:

- a domain invariant;
- a failure-mode boundary;
- a lifecycle boundary;
- a testability boundary;
- a dependency direction boundary;
- a performance or concurrency invariant;
- an external integration contract.

A pattern MUST NOT be introduced merely because it is famous.

---

## 3. Universal Pattern Gate

Before applying any pattern, the LLM MUST answer these questions in comments, design notes, PR description, or generated plan when the change is non-trivial:

1. **What instability is being isolated?**
2. **What invariant is being protected?**
3. **Which dependency direction is being enforced?**
4. **How will this be tested without real external systems?**
5. **What code becomes simpler because of this pattern?**
6. **What complexity is being added?**
7. **How will failure, cancellation, timeout, and retry behave?**

If the pattern does not improve at least one of those answers, the LLM MUST prefer straightforward functions, structs, and packages.

---

## 4. Preferred Go Design Principles

### 4.1 Prefer functions first

MUST prefer a plain function when:

- there is no state;
- there is no dependency to inject;
- behavior does not vary by implementation;
- testing can call the function directly;
- lifecycle is not needed.

```go
func NormalizeEmail(s string) (string, error) {
    // simple behavior; no artificial object needed
}
```

MUST NOT create `EmailNormalizerServiceImplFactory` for simple pure behavior.

### 4.2 Prefer concrete types at ownership boundaries

The package that owns behavior SHOULD expose concrete types when callers need real capabilities.

```go
type Sender struct {
    client *http.Client
    log    *slog.Logger
}
```

Do not expose an interface from the producer package just to make mocking possible.

### 4.3 Accept interfaces at consumer boundary

Interfaces SHOULD be declared where they are consumed, not where they are implemented.

```go
type EmailSender interface {
    Send(ctx context.Context, msg Message) error
}

type UseCase struct {
    sender EmailSender
}
```

The interface MUST be small and behavior-oriented.

Forbidden:

```go
type UserRepository interface {
    CreateUser(ctx context.Context, u User) error
    UpdateUser(ctx context.Context, u User) error
    DeleteUser(ctx context.Context, id string) error
    FindUserByID(ctx context.Context, id string) (User, error)
    FindUserByEmail(ctx context.Context, email string) (User, error)
    FindAllUsers(ctx context.Context) ([]User, error)
    // huge speculative interface
}
```

Prefer role-specific interfaces:

```go
type UserReader interface {
    FindByID(ctx context.Context, id UserID) (User, error)
}
```

### 4.4 Prefer composition over inheritance imitation

Go has no class inheritance. The LLM MUST NOT simulate inheritance using:

- `BaseService`;
- `AbstractRepository`;
- `Impl` suffix hierarchies;
- embedded structs used as mandatory parent classes;
- method override illusions.

Embedding MAY be used only for:

- composition of reusable behavior with clear semantics;
- embedding `sync.Mutex` only when intentionally part of implementation and never copied;
- implementing decorator/middleware where promoted methods are intentional;
- test helper composition.

Embedding MUST NOT hide required dependencies or lifecycle rules.

---

## 5. Constructor Pattern

### 5.1 Constructor requirements

Any type with dependencies, invariants, background goroutines, pooled resources, or non-trivial zero value MUST have a constructor.

```go
type Processor struct {
    repo Repository
    log  *slog.Logger
    now  func() time.Time
}

func NewProcessor(repo Repository, log *slog.Logger, now func() time.Time) (*Processor, error) {
    if repo == nil {
        return nil, errors.New("repo is required")
    }
    if log == nil {
        log = slog.Default()
    }
    if now == nil {
        now = time.Now
    }
    return &Processor{repo: repo, log: log, now: now}, nil
}
```

Constructor MUST:

- validate required dependencies;
- set safe defaults;
- avoid starting goroutines unless lifecycle is explicit;
- return error when config is invalid;
- avoid side effects such as network calls unless documented.

### 5.2 Zero-value policy

For each exported type, the LLM MUST decide one of:

1. zero value is valid and documented;
2. zero value is invalid and constructor is required;
3. zero value is only valid for test/local minimal use.

Exported types with non-obvious zero-value behavior MUST document it.

---

## 6. Functional Options Pattern

Functional options MAY be used when a constructor has many optional settings.

Functional options MUST NOT be used to hide required dependencies.

Good:

```go
type Option func(*options) error

func WithTimeout(d time.Duration) Option {
    return func(o *options) error {
        if d <= 0 {
            return errors.New("timeout must be positive")
        }
        o.timeout = d
        return nil
    }
}
```

Rules:

- required dependencies stay as constructor parameters;
- options validate values;
- options return errors when invalid;
- defaults are explicit;
- options MUST NOT perform I/O;
- options MUST NOT start goroutines;
- option application order MUST NOT be surprising.

Forbidden:

```go
func WithDatabaseURL(url string) Option {
    return func(o *options) {
        o.db = sql.OpenDB(... ) // hidden side effect
    }
}
```

---

## 7. Strategy Pattern

Use strategy when behavior varies by policy, locale, protocol, algorithm, tenant, or product rule.

Strategy MUST be selected explicitly and validated.

```go
type PricePolicy interface {
    Calculate(ctx context.Context, input PriceInput) (PriceResult, error)
}
```

Strategy is appropriate for:

- jurisdiction-specific rules;
- locale-specific parsing;
- tenant-specific policy;
- scoring algorithms;
- pricing/tax rules;
- retry/backoff policy;
- clock/randomness injection in tests.

Strategy MUST NOT be used when a simple `switch` over a small closed set is clearer.

Closed-set alternative:

```go
func RiskLevel(score int) RiskLevel {
    switch {
    case score >= 80:
        return RiskHigh
    case score >= 50:
        return RiskMedium
    default:
        return RiskLow
    }
}
```

Strategy implementations MUST be:

- stateless, or concurrency-safe;
- deterministic unless randomness/time is explicit;
- independently testable;
- traceable in logs/metrics by strategy name, not implementation detail.

---

## 8. Policy / Specification Pattern

Use policy/specification for domain decisions that must be explainable, testable, and auditable.

```go
type Decision struct {
    Allowed bool
    Code    string
    Reason  string
}

type TransitionPolicy interface {
    CanTransition(ctx context.Context, actor Actor, from State, to State, entity Case) Decision
}
```

MUST use this pattern for:

- authorization decisions;
- workflow transitions;
- regulatory eligibility;
- escalation rules;
- segregation-of-duty checks;
- cross-entity dependency checks.

Policy MUST return structured decision data when denial reason matters.

Policy MUST NOT only return `bool` if the caller needs audit, user feedback, or support diagnostics.

Forbidden:

```go
if user.Role == "admin" || case.Owner == user.ID || case.Status == "draft" {
    // opaque scattered policy
}
```

Preferred:

```go
decision := policy.CanApprove(ctx, actor, c)
if !decision.Allowed {
    return decision.ToError()
}
```

---

## 9. State Machine Pattern

A workflow with named states MUST be modelled explicitly.

Required when:

- states have legal transitions;
- transitions create audit events;
- permissions depend on state;
- side effects depend on transition;
- timers/deadlines/escalations exist;
- reprocessing/idempotency matters.

Minimum structure:

```go
type State string

type Transition struct {
    From State
    To   State
    Name string
}

type TransitionResult struct {
    NewState State
    Events   []DomainEvent
}
```

State machine MUST define:

- allowed transitions;
- invalid-transition error;
- actor permission gate;
- guard conditions;
- side-effect events;
- idempotency behavior;
- optimistic locking/versioning if persisted;
- tests for all valid and invalid transitions.

Forbidden:

```go
entity.Status = req.Status // external caller controls state directly
```

Preferred:

```go
result, err := machine.Apply(ctx, actor, entity, SubmitTransition)
```

---

## 10. Command Handler Pattern

Use command handlers when the use case mutates state or emits events.

```go
type SubmitApplicationCommand struct {
    ApplicationID ApplicationID
    ActorID       ActorID
    Version       int64
}

type SubmitApplicationHandler struct {
    repo   ApplicationRepository
    policy SubmitPolicy
}

func (h *SubmitApplicationHandler) Handle(ctx context.Context, cmd SubmitApplicationCommand) error {
    // load, validate, transition, persist, emit
}
```

Command handler MUST:

- accept `context.Context` first;
- accept a strongly typed command;
- validate command boundary;
- load required state inside transaction/unit of work when necessary;
- enforce authorization/policy;
- apply domain operation;
- persist atomically;
- emit outbox/domain events consistently;
- return typed/wrapped errors.

Command handler MUST NOT:

- accept raw HTTP request types;
- return HTTP responses;
- read global config;
- perform hidden authorization;
- use context values for domain parameters.

---

## 11. Query Handler Pattern

Use query handlers for read use cases with explicit projection and authorization.

```go
type GetCaseQuery struct {
    CaseID CaseID
    Actor  Actor
}
```

Query handler MUST:

- define access boundary;
- avoid exposing persistence rows directly;
- select only needed columns/fields;
- apply tenant/actor filter in query when possible;
- support pagination with deterministic order;
- avoid domain mutation.

Query handler MUST NOT become a dumping ground for arbitrary SQL strings.

---

## 12. Repository / Store Pattern

Repository is allowed only when it protects domain persistence semantics.

Good repository methods are domain-specific:

```go
type CaseStore interface {
    LoadForUpdate(ctx context.Context, tx Tx, id CaseID) (Case, error)
    Save(ctx context.Context, tx Tx, c Case, expectedVersion int64) error
}
```

Rules:

- repository MUST NOT expose `*sql.DB`, `*sql.Tx`, `*sql.Rows`, driver-specific rows, or ORM models across domain boundary;
- repository MUST NOT be generic CRUD by default;
- repository MUST encode optimistic locking when entity versioning exists;
- repository MUST distinguish not-found, conflict, and transient errors;
- repository MUST accept context;
- repository MUST keep transaction ownership explicit.

Forbidden:

```go
type Repository[T any] interface {
    Create(ctx context.Context, t T) error
    Update(ctx context.Context, t T) error
    Delete(ctx context.Context, id any) error
    FindAll(ctx context.Context) ([]T, error)
}
```

This hides domain invariants and encourages unsafe bulk access.

---

## 13. Unit of Work / Transaction Pattern

Use a unit of work when multiple persistence operations must commit atomically.

```go
type UnitOfWork interface {
    Do(ctx context.Context, fn func(ctx context.Context, tx Tx) error) error
}
```

Rules:

- transaction owner MUST commit or rollback exactly once;
- rollback error MUST be handled/logged when relevant;
- no goroutine may use `tx` after callback returns;
- no network side effect may occur inside transaction unless required and bounded;
- domain events should be stored in outbox within the same transaction;
- context cancellation MUST abort transaction work.

Forbidden:

```go
tx, _ := db.Begin()
// commit hidden in another package
```

---

## 14. Outbox Pattern

Use outbox when a local database change and external event/message must be coordinated.

Outbox record MUST include:

- event ID/idempotency key;
- aggregate type and ID;
- event type;
- schema version;
- payload;
- created timestamp;
- processing status/attempts;
- trace/correlation metadata when required.

Rules:

- outbox write MUST be in same transaction as state change;
- publisher MUST be idempotent;
- consumer MUST handle duplicates;
- retry MUST be bounded and observable;
- poison messages MUST go to DLQ/manual review;
- payload MUST be contract-tested.

LLM MUST NOT publish to Kafka/RabbitMQ/SNS/etc. directly inside a DB transaction and assume atomicity.

---

## 15. Adapter / Anti-Corruption Layer Pattern

Use adapter when external systems have incompatible models, errors, retries, auth, or lifecycle.

Adapter MUST:

- map external DTO to internal domain/query models;
- hide external client details;
- normalize external errors;
- enforce timeout and context;
- apply retry only for safe operations;
- validate response schema;
- redact secrets in logs;
- expose stable internal interface.

External API types MUST NOT leak into domain or application packages.

Forbidden:

```go
func (u *UseCase) Submit(ctx context.Context, req externalvendor.SubmitRequest) error
```

Preferred:

```go
func (u *UseCase) Submit(ctx context.Context, cmd SubmitCommand) error
```

---

## 16. Middleware / Interceptor Pattern

Use middleware for cross-cutting behavior at transport boundary.

Allowed middleware responsibilities:

- request ID/correlation ID;
- authentication;
- authorization boundary check;
- logging;
- metrics;
- tracing;
- panic recovery;
- timeout;
- request size limit;
- CORS;
- rate limit;
- response security headers.

Middleware MUST NOT contain domain business logic.

Order MUST be explicit and tested when behavior depends on order.

Suggested HTTP order:

1. request ID;
2. panic recovery;
3. timeout/body limit;
4. structured logging/tracing;
5. authentication;
6. authorization;
7. handler.

---

## 17. Decorator Pattern

Use decorators to add behavior around an interface without changing the core implementation.

Good decorator uses:

- tracing;
- metrics;
- logging;
- retry;
- cache;
- circuit breaker;
- rate limiting;
- idempotency.

Decorator MUST preserve interface contract.

Decorator MUST NOT swallow errors unless documented and tested.

Decorator order MUST be explicit.

```go
store := NewSQLStore(db)
store = NewTracingStore(store, tracer)
store = NewMetricsStore(store, meter)
```

Avoid decorator stacks that obscure failure semantics.

---

## 18. Pipeline Pattern

Use pipeline for streaming transformations with backpressure and cancellation.

Pipeline stage MUST:

- accept context;
- close its outbound channel;
- stop on cancellation;
- drain or unblock upstream where necessary;
- propagate errors explicitly;
- bound concurrency;
- avoid goroutine leaks.

Forbidden:

```go
go func() {
    for x := range in {
        out <- transform(x) // blocks forever if downstream exits
    }
}()
```

Preferred:

```go
go func() {
    defer close(out)
    for x := range in {
        y, err := transform(x)
        if err != nil {
            sendErr(err)
            return
        }
        select {
        case out <- y:
        case <-ctx.Done():
            return
        }
    }
}()
```

---

## 19. Worker Pool Pattern

Use worker pool only when concurrency must be bounded.

Worker pool MUST define:

- queue size;
- worker count;
- cancellation behavior;
- backpressure behavior;
- error propagation;
- panic handling;
- shutdown protocol;
- telemetry.

Do not create unbounded goroutines per item.

Worker pool MUST NOT hide lifecycle from caller. Provide `Start`, `Stop`, or `Run(ctx)` semantics.

---

## 20. Retry Pattern

Retry MUST be explicit and safe.

Retry requires:

- operation idempotency decision;
- retryable error classification;
- max attempts or max elapsed time;
- exponential backoff with jitter;
- context cancellation support;
- observability;
- no retry on validation/auth/business errors.

Forbidden:

```go
for {
    err := call()
    if err == nil { return nil }
}
```

Preferred:

```go
for attempt := 1; attempt <= maxAttempts; attempt++ {
    err := call(ctx)
    if err == nil {
        return nil
    }
    if !isRetryable(err) {
        return err
    }
    if err := sleep(ctx, backoff(attempt)); err != nil {
        return err
    }
}
```

---

## 21. Circuit Breaker / Bulkhead Pattern

Use circuit breaker or bulkhead only for unstable remote dependencies.

MUST define:

- failure classification;
- open/half-open/closed behavior;
- timeout;
- fallback semantics;
- metrics;
- operator visibility.

MUST NOT use circuit breaker to hide application bugs.

Fallback MUST be safe and explicit. Stale data must be labelled as stale.

---

## 22. Cache Pattern

Cache MUST have correctness semantics.

Every cache MUST define:

- key structure;
- value ownership/mutability;
- TTL/eviction;
- negative caching policy;
- invalidation trigger;
- consistency expectation;
- memory limit;
- concurrency safety;
- metrics;
- stampede control when needed.

MUST NOT cache authorization decisions unless scope, actor, resource, tenant, and expiry are explicit.

MUST NOT return mutable cached slices/maps without copying or documenting ownership.

---

## 23. Builder Pattern

Builder MAY be used for complex immutable value construction.

Prefer constructor or plain struct literal when object is simple.

Builder MUST validate at `Build()` and return error.

Builder MUST NOT be required for every DTO.

```go
type QueryBuilder struct { /* ... */ }

func (b *QueryBuilder) Build() (Query, error) {
    // validate all required fields
}
```

Avoid fluent APIs that hide errors until too late or encourage invalid intermediate states.

---

## 24. Factory Pattern

Factory is allowed when object creation depends on configuration, protocol, tenant, or environment.

Factory MUST return explicit errors for unsupported types.

```go
func NewSigner(kind SignerKind, cfg Config) (Signer, error) {
    switch kind {
    case SignerHMAC:
        return NewHMACSigner(cfg.HMAC)
    case SignerRSA:
        return NewRSASigner(cfg.RSA)
    default:
        return nil, fmt.Errorf("unsupported signer kind %q", kind)
    }
}
```

MUST NOT use reflection-based factories unless plugin/dynamic loading is a documented requirement.

---

## 25. Observer / Pub-Sub Pattern

In-process pub-sub MUST be used carefully.

Rules:

- event type must be explicit;
- subscriber lifecycle must be explicit;
- slow subscriber behavior must be defined;
- panic handling must be defined;
- ordering must be defined;
- backpressure/drop policy must be defined;
- errors must be observable.

For durable business events, prefer outbox/message broker over in-memory observer.

---

## 26. Idempotency Pattern

Use idempotency key for externally retried mutation requests.

Idempotency record MUST capture:

- key;
- actor/tenant;
- operation;
- request hash if necessary;
- result reference;
- status;
- expiry;
- created/updated timestamps.

Rules:

- same key with different request body MUST be rejected;
- concurrent duplicate MUST return consistent behavior;
- completed operation replay MUST return same semantic result;
- idempotency storage must be transactional with mutation when possible.

---

## 27. Template Method Anti-Pattern

Classic template method with abstract base class MUST NOT be emulated.

Forbidden:

```go
type BaseProcessor struct{}

func (b BaseProcessor) Process() {
    b.Before()
    b.Execute() // impossible virtual dispatch expectation
    b.After()
}
```

Preferred:

```go
type Step func(context.Context, Input) (Input, error)

type Pipeline struct {
    steps []Step
}
```

or explicit composition:

```go
type Processor struct {
    validate Validator
    execute  Executor
    notify   Notifier
}
```

---

## 28. Singleton Anti-Pattern

Global singleton mutable state is forbidden unless it is a true process-wide constant or standard-library-style safe singleton.

Forbidden:

```go
var DB *sql.DB
var Config Config
var Logger *slog.Logger
```

Preferred:

```go
type App struct {
    DB     *sql.DB
    Config Config
    Logger *slog.Logger
}
```

Global values MAY be used for:

- immutable constants;
- package-level errors;
- compiled regex with documented safety;
- metrics instruments when initialized safely;
- default logger only at application edge.

---

## 29. Service Locator Anti-Pattern

Service locator is forbidden.

Forbidden:

```go
type Container interface {
    Get(name string) any
}
```

LLM MUST use explicit constructor injection.

Reason: service locator hides dependency graph, breaks compile-time checking, weakens tests, and encourages runtime failures.

---

## 30. Reflection-Based Pattern Anti-Pattern

Do not use reflection to implement DI, mapper, validator, factory, or router unless the project has explicitly chosen that framework style.

Reflection MUST NOT replace simple compile-time code.

If reflection is used:

- cache metadata;
- validate tags at startup;
- test nil/unexported/pointer cases;
- fuzz untrusted input;
- document panic conditions.

---

## 31. Pattern Selection Matrix

| Need                              | Preferred Go Pattern           | Avoid                                  |
| --------------------------------- | ------------------------------ | -------------------------------------- |
| Required dependency               | Constructor injection          | Global locator                         |
| Optional config                   | Functional options             | Huge constructor with ambiguous zeroes |
| Varying domain rule               | Strategy or policy             | Giant scattered switch                 |
| Workflow states                   | Explicit state machine         | Direct status assignment               |
| Mutation use case                 | Command handler                | HTTP handler containing business logic |
| Read projection                   | Query handler                  | Returning DB rows directly             |
| DB consistency                    | Unit of work                   | Hidden transaction ownership           |
| DB + message atomicity            | Outbox                         | Publish inside transaction and hope    |
| External system                   | Adapter/ACL                    | External DTO in domain                 |
| Cross-cutting transport           | Middleware/interceptor         | Business logic in middleware           |
| Cross-cutting dependency behavior | Decorator                      | Copy-paste logging/retry               |
| Streaming transformation          | Pipeline                       | Unbounded goroutines                   |
| Bounded parallelism               | Worker pool                    | Goroutine per item                     |
| Remote instability                | Retry/circuit breaker/bulkhead | Infinite retry                         |
| Expensive stable lookup           | Cache                          | Hidden mutable global map              |
| Complex immutable construction    | Builder                        | Partially valid mutable struct         |
| Repeated external mutation        | Idempotency key                | Blind re-execution                     |

---

## 32. LLM Pattern Review Checklist

Before finalizing code, the LLM MUST verify:

- [ ] The pattern has a concrete reason tied to invariant, dependency boundary, lifecycle, or failure handling.
- [ ] No Java-style inheritance or `Impl` hierarchy was introduced.
- [ ] Interfaces are declared by consumers and are small.
- [ ] Required dependencies are explicit constructor parameters.
- [ ] Functional options, if used, only cover optional settings and validate input.
- [ ] Context is passed explicitly as first parameter where I/O or cancellation is involved.
- [ ] Errors are typed/wrapped and mapped at boundaries.
- [ ] Authorization/policy is not scattered across handlers.
- [ ] State transitions are not direct field assignment when workflow exists.
- [ ] Repositories are domain-specific, not generic CRUD by default.
- [ ] Transaction ownership is explicit.
- [ ] External DTOs do not leak into domain/application layer.
- [ ] Retry/idempotency semantics are explicit.
- [ ] Goroutine lifecycle and channel ownership are explicit.
- [ ] Cache ownership, invalidation, and mutation safety are explicit.
- [ ] Tests cover success, invalid input, failure, cancellation, concurrency, and duplicate/retry cases.
- [ ] The implementation is simpler than the equivalent no-pattern code for the given problem.

---

## 33. Mandatory Refusal Cases for LLM

The LLM MUST refuse or request redesign when asked to:

- add a global service locator;
- introduce generic CRUD repository without domain reason;
- bypass context propagation for I/O;
- implement authorization as scattered inline role checks;
- publish events without idempotency or outbox where atomicity matters;
- use reflection to hide compile-time dependencies;
- create fake inheritance with `Base*`/`Abstract*`/`Impl` chains;
- add unbounded goroutines or queues;
- create cache without invalidation/TTL/memory/race policy;
- swallow errors in decorator/middleware/retry code;
- put business logic inside HTTP/gRPC middleware;
- use pattern names as justification without explaining invariants.

---

## 34. Minimal Acceptance Standard

A design-pattern implementation is acceptable only if:

1. it is idiomatic Go;
2. it reduces accidental complexity at the correct boundary;
3. it improves testability or correctness;
4. it makes failure behavior more explicit;
5. it preserves dependency direction;
6. it does not hide business rules;
7. it is covered by meaningful tests;
8. it is understandable by a Go engineer without framework magic.

If a simpler direct implementation satisfies the same constraints, the LLM MUST choose the simpler implementation.

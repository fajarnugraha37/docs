# Strict Coding Standards — Go Object-Oriented Design Without Inheritance

**File:** `strict-coding-standards__go_oop.md`  
**Scope:** Methods, receivers, interfaces, embedding, composition, encapsulation, polymorphism, constructors, domain behavior, and package-level object design in Go.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go systems.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

Go object design MUST be based on composition, explicit behavior, small interfaces, and package boundaries.

The agent MUST NOT simulate Java/C#/TypeScript class hierarchies in Go.

Before adding a type, method, interface, embedding, or constructor, the agent MUST answer:

1. What invariant does this type own?
2. Is behavior attached to the right type?
3. Is mutation explicit and safe?
4. Does the interface belong to the consumer?
5. Is embedding being used for composition or fake inheritance?
6. Does the package boundary hide implementation details?
7. Does the design remain testable without global state?

If these cannot be answered, use simple functions and concrete structs until the design is clear.

---

## 1. Source Authority

This standard is derived from official Go references:

- Go Language Specification: https://go.dev/ref/spec
- Effective Go: https://go.dev/doc/effective_go
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Go Doc Comments: https://go.dev/doc/comment
- Go FAQ: https://go.dev/doc/faq
- Go Proverbs: https://go-proverbs.github.io/
- Package names: https://go.dev/blog/package-names
- Organizing Go Code: https://go.dev/blog/organizing-go-code
- `context` package: https://pkg.go.dev/context
- `sync` package: https://pkg.go.dev/sync
- Go Memory Model: https://go.dev/ref/mem

---

## 2. Go OOP Mental Model

Go supports object-oriented programming through:

- named types;
- methods;
- interfaces;
- composition;
- embedding;
- package visibility;
- explicit constructors;
- behavior-oriented design.

Go does not support:

- classes;
- inheritance;
- abstract classes;
- method overriding;
- constructors as language features;
- implements declarations;
- method overloading;
- generic methods with independent type parameters.

The agent MUST design for Go's model, not import another language's object model.

---

## 3. Type Ownership Rules

### 3.1 Every Exported Type Must Own an Invariant

Forbidden:

```go
type CaseData struct {
    ID     string
    Status string
    Any    map[string]any
}
```

Preferred:

```go
type Case struct {
    id     CaseID
    status CaseStatus
}

func NewCase(id CaseID) (Case, error) {
    if id == "" {
        return Case{}, ErrInvalidCaseID
    }
    return Case{id: id, status: CaseStatusDraft}, nil
}
```

### 3.2 Keep Fields Unexported When Invariants Matter

If a field cannot be freely changed by callers, it MUST be unexported and modified through methods.

Forbidden:

```go
type Case struct {
    ID     CaseID
    Status CaseStatus
}
```

Preferred:

```go
type Case struct {
    id     CaseID
    status CaseStatus
}

func (c Case) ID() CaseID { return c.id }
func (c Case) Status() CaseStatus { return c.status }
```

### 3.3 Avoid Getter/Setter Boilerplate

The agent MUST NOT generate Java-style getters/setters for every field.

Allowed getters:

- expose immutable or derived state;
- enforce representation hiding;
- preserve package boundary.

Allowed setters:

- enforce validation;
- perform state transition;
- maintain invariants;
- emit domain events.

Forbidden:

```go
func (c *Case) SetStatus(status CaseStatus) {
    c.Status = status
}
```

Preferred:

```go
func (c *Case) Submit(now time.Time) error {
    if c.status != CaseStatusDraft {
        return fmt.Errorf("submit from %s: %w", c.status, ErrInvalidTransition)
    }
    c.status = CaseStatusSubmitted
    c.submittedAt = now.UTC()
    return nil
}
```

---

## 4. Method Receiver Rules

### 4.1 Receiver Choice Must Be Intentional

Use value receiver when:

- the type is small;
- immutable behavior is intended;
- copying is safe;
- methods do not mutate receiver state;
- receiver contains no mutex or resource handle.

Use pointer receiver when:

- method mutates receiver;
- copying is expensive;
- receiver contains `sync.Mutex`, `sync.Once`, `atomic`, file/socket/client, or cache;
- method must preserve identity;
- nil receiver behavior is intentionally supported.

Forbidden:

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}

func (c Cache) Get(k string) string { // copies mutex
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}
```

Preferred:

```go
func (c *Cache) Get(k string) (string, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.m[k]
    return v, ok
}
```

### 4.2 Receiver Style Must Be Consistent

If any method on a type requires pointer receiver, the agent SHOULD use pointer receivers for all methods unless value semantics are deliberately documented.

### 4.3 Do Not Use Receiver Names Like `this` or `self`

Forbidden:

```go
func (this *CaseService) Submit(ctx context.Context, id CaseID) error
```

Preferred:

```go
func (s *CaseService) Submit(ctx context.Context, id CaseID) error
```

Receiver names SHOULD be short and meaningful.

### 4.4 Nil Receiver Must Be Documented

If a method accepts a nil receiver, it MUST document and test that behavior.

```go
func (l *Logger) Debug(msg string) {
    if l == nil {
        return
    }
    l.write("debug", msg)
}
```

Nil receiver behavior MUST NOT be accidental.

---

## 5. Constructor and Zero-Value Rules

### 5.1 Zero Value Must Be Either Useful or Invalid by Design

Every exported type MUST have a documented zero-value policy.

Useful zero value example:

```go
type Counter struct {
    n atomic.Int64
}
```

Constructor-required example:

```go
// Processor validates and executes case actions.
// Use NewProcessor; the zero Processor is not valid.
type Processor struct {
    store CaseStore
    clock Clock
}
```

### 5.2 Constructors Must Validate Invariants

Forbidden:

```go
func NewProcessor(store CaseStore) *Processor {
    return &Processor{store: store}
}
```

Preferred:

```go
func NewProcessor(store CaseStore, clock Clock) (*Processor, error) {
    if store == nil {
        return nil, ErrMissingCaseStore
    }
    if clock == nil {
        return nil, ErrMissingClock
    }
    return &Processor{store: store, clock: clock}, nil
}
```

### 5.3 Constructors Should Return Concrete Types

Forbidden in most cases:

```go
func NewCaseService() CaseServiceInterface
```

Preferred:

```go
func NewCaseService(store CaseStore, clock Clock) (*CaseService, error)
```

Return an interface only when the implementation must be hidden for compatibility or multiple implementations are selected internally.

---

## 6. Interface Rules

### 6.1 Interfaces Belong to Consumers

Forbidden:

```go
// package postgres
type Repository interface {
    Find(ctx context.Context, id string) (any, error)
    Save(ctx context.Context, v any) error
}
```

Preferred:

```go
// package caseapp
type CaseStore interface {
    FindByID(ctx context.Context, id CaseID) (Case, error)
    Save(ctx context.Context, c Case) error
}
```

The consumer defines the minimum behavior it needs.

### 6.2 Accept Interfaces, Return Concrete Types

Preferred:

```go
func NewCaseService(store CaseStore) *CaseService {
    return &CaseService{store: store}
}
```

The agent SHOULD accept interfaces at boundaries and return concrete implementation types from constructors.

### 6.3 Keep Interfaces Small

Forbidden:

```go
type CaseRepository interface {
    Create(context.Context, Case) error
    Update(context.Context, Case) error
    Delete(context.Context, CaseID) error
    Find(context.Context, CaseID) (Case, error)
    Search(context.Context, SearchQuery) ([]Case, error)
    Count(context.Context, SearchQuery) (int, error)
    Lock(context.Context, CaseID) error
    Unlock(context.Context, CaseID) error
}
```

Preferred:

```go
type CaseFinder interface {
    FindByID(context.Context, CaseID) (Case, error)
}

type CaseSaver interface {
    Save(context.Context, Case) error
}
```

### 6.4 Do Not Create Interfaces for a Single Local Implementation by Default

Forbidden:

```go
type CaseService interface {
    Submit(context.Context, CaseID) error
}

type caseServiceImpl struct{}
```

Preferred:

```go
type CaseService struct {
    store CaseStore
}
```

An interface is justified when:

- consumed by another package;
- needed for testing an external dependency;
- multiple real implementations exist;
- it defines protocol behavior.

### 6.5 Compile-Time Interface Satisfaction Is Required for Important Adapters

```go
var _ CaseStore = (*PostgresCaseStore)(nil)
```

Use this for adapters, plugin implementations, and public API contracts.

### 6.6 Avoid Marker Interfaces

Forbidden:

```go
type Command interface {
    IsCommand()
}
```

Preferred:

```go
type SubmitCaseCommand struct {
    CaseID CaseID
    Actor  UserID
}
```

Use explicit handler functions or behavior interfaces instead.

---

## 7. Embedding Rules

### 7.1 Embedding Is Not Inheritance

The agent MUST NOT use embedding to imply “is-a” inheritance.

Forbidden:

```go
type BaseService struct {
    log *slog.Logger
}

type CaseService struct {
    BaseService
}
```

Preferred:

```go
type CaseService struct {
    log   *slog.Logger
    store CaseStore
}
```

### 7.2 Embedded Fields Must Be Deliberate API Exposure

Embedding promotes methods. In exported structs, this becomes part of the public API.

Forbidden:

```go
type Server struct {
    *http.Server // exposes more API than intended
}
```

Preferred:

```go
type Server struct {
    srv *http.Server
}

func (s *Server) Start() error { return s.srv.ListenAndServe() }
```

### 7.3 Do Not Embed Locks in Exported Structs

Forbidden:

```go
type Registry struct {
    sync.Mutex
    items map[string]Item
}
```

Preferred:

```go
type Registry struct {
    mu    sync.Mutex
    items map[string]Item
}
```

### 7.4 Embedding Interfaces Is for Composition of Behavior

Allowed:

```go
type ReadWriteCloser interface {
    io.Reader
    io.Writer
    io.Closer
}
```

Do not create giant embedded interfaces that couple unrelated behavior.

---

## 8. Polymorphism Rules

### 8.1 Prefer Behavior Interfaces Over Type Checks

Forbidden:

```go
func Execute(rule any, c Case) error {
    switch r := rule.(type) {
    case AgeRule:
        return r.Check(c)
    case StatusRule:
        return r.Check(c)
    default:
        return ErrUnsupportedRule
    }
}
```

Preferred:

```go
type Rule interface {
    Check(context.Context, Case) error
}

func Execute(ctx context.Context, rule Rule, c Case) error {
    return rule.Check(ctx, c)
}
```

### 8.2 Use Functions for Single-Method Behavior When Simpler

```go
type RuleFunc func(context.Context, Case) error

func (f RuleFunc) Check(ctx context.Context, c Case) error {
    return f(ctx, c)
}
```

### 8.3 Domain State Transitions Belong to Domain Types or Policy Objects

Forbidden:

```go
caseRecord.Status = "APPROVED"
caseRecord.ApprovedAt = time.Now()
```

Preferred:

```go
func (c *Case) Approve(actor UserID, now time.Time) error {
    if c.status != CaseStatusSubmitted {
        return fmt.Errorf("approve from %s: %w", c.status, ErrInvalidTransition)
    }
    c.status = CaseStatusApproved
    c.approvedBy = actor
    c.approvedAt = now.UTC()
    return nil
}
```

### 8.4 Do Not Use Interface Dispatch for Simple Branching

If there are only two local branches and no reusable behavior, use a normal function or switch. Interface abstraction must buy something real.

---

## 9. Package Boundary Rules

### 9.1 Package Is the Encapsulation Unit

The agent MUST design with package visibility in mind:

- exported names are public contracts;
- unexported names are implementation details;
- domain invariants should be protected inside the package;
- tests outside package should verify public behavior.

### 9.2 Avoid `internal/common` Dumping Grounds

Forbidden package names:

- `common`
- `utils`
- `helper`
- `manager`
- `base`
- `impl`

Preferred names describe behavior or domain:

- `caseworkflow`
- `casepolicy`
- `postgrescase`
- `auditlog`
- `notification`

### 9.3 Do Not Leak Infrastructure Types Into Domain Objects

Forbidden:

```go
type Case struct {
    Row sql.NullString
    DB  *sql.DB
}
```

Preferred:

```go
type Case struct {
    id     CaseID
    status CaseStatus
}
```

Infrastructure maps to domain at package boundaries.

---

## 10. Dependency Injection Rules

### 10.1 Use Constructor Injection

Forbidden:

```go
var defaultStore CaseStore

func Submit(ctx context.Context, id CaseID) error {
    return defaultStore.Save(ctx, id)
}
```

Preferred:

```go
type SubmitHandler struct {
    store CaseStore
    clock Clock
}

func NewSubmitHandler(store CaseStore, clock Clock) (*SubmitHandler, error) {
    if store == nil || clock == nil {
        return nil, ErrMissingDependency
    }
    return &SubmitHandler{store: store, clock: clock}, nil
}
```

### 10.2 Do Not Use Context as Dependency Container

Forbidden:

```go
store := ctx.Value(storeKey{}).(CaseStore)
```

Preferred:

```go
type Handler struct {
    store CaseStore
}
```

### 10.3 Global Mutable Singletons Are Forbidden by Default

Allowed package-level values:

- immutable constants;
- sentinel errors;
- compiled regular expressions that are safe for concurrent use;
- default configuration values that are not mutated.

Mutable global services require explicit justification.

---

## 11. Error Behavior as Object Contract

Types that perform business operations MUST return meaningful errors.

Forbidden:

```go
func (s *CaseService) Submit(ctx context.Context, id CaseID) bool
```

Preferred:

```go
func (s *CaseService) Submit(ctx context.Context, id CaseID) error
```

Errors SHOULD preserve:

- operation;
- identifier;
- failed invariant;
- wrapped cause where appropriate.

```go
return fmt.Errorf("submit case %s: %w", id, ErrInvalidTransition)
```

---

## 12. Concurrency Rules for Object Design

### 12.1 Concurrency Safety Must Be Documented

Every exported mutable type MUST document whether it is safe for concurrent use.

```go
// Registry stores case handlers.
// Registry is safe for concurrent use.
type Registry struct {
    mu sync.RWMutex
    m  map[CaseType]Handler
}
```

If no stronger guarantee is documented, callers must assume the type is not safe for concurrent use.

### 12.2 Do Not Copy Types Containing Locks

The agent MUST ensure types containing locks, atomics, pools, or resource handles are not copied after first use.

Prefer pointer constructors and pointer receivers.

### 12.3 Methods Must Not Start Goroutines Without Lifecycle Ownership

Forbidden:

```go
func (s *Service) Start() {
    go s.loop()
}
```

Preferred:

```go
func (s *Service) Run(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case item := <-s.items:
            if err := s.handle(ctx, item); err != nil {
                return err
            }
        }
    }
}
```

---

## 13. Testing Rules

### 13.1 Test Behavior, Not Implementation Inheritance

The agent MUST test public behavior and invariants.

Required cases:

- constructor rejects invalid dependencies;
- zero-value behavior is documented and tested;
- state transition rejects invalid previous state;
- interface adapter satisfies consumer contract;
- methods do not leak mutable internal state;
- concurrent-safe types pass race detector tests;
- nil dependencies fail early;
- errors preserve operation and cause.

### 13.2 Use Fakes That Model Behavior

Forbidden:

```go
type MockRepository struct {
    Called bool
}
```

Preferred:

```go
type fakeCaseStore struct {
    find func(context.Context, CaseID) (Case, error)
    save func(context.Context, Case) error
}

func (f fakeCaseStore) FindByID(ctx context.Context, id CaseID) (Case, error) {
    return f.find(ctx, id)
}
```

### 13.3 Avoid Over-Mocking Domain Objects

If a type is simple and deterministic, instantiate the real type. Mock only external dependencies or hard-to-control boundaries.

---

## 14. LLM Anti-Patterns

The agent MUST NOT introduce:

- `BaseService`, `AbstractService`, `Impl`, or inheritance-like naming;
- interface per concrete type without consumer need;
- generic `Service[T]` or `Repository[T]` for domain orchestration;
- exported structs with arbitrary mutable fields;
- setters that bypass state transitions;
- embedding to expose dependency APIs accidentally;
- marker interfaces;
- global mutable singletons;
- context-based dependency injection;
- type switches where behavior interfaces are appropriate;
- package names such as `utils`, `common`, `helper`, `manager`;
- mocks that assert implementation details instead of behavior;
- hidden goroutine lifecycle inside object methods.

---

## 15. Review Checklist

A Go OOP/design change is mergeable only if:

- [ ] Each exported type has a clear invariant or purpose.
- [ ] Field visibility protects invariants.
- [ ] Receiver choice is intentional and consistent.
- [ ] Types containing locks/resources are not copied.
- [ ] Constructors validate dependencies and invariants.
- [ ] Zero-value policy is documented.
- [ ] Interfaces are small and consumer-owned.
- [ ] Constructors return concrete types unless interface return is justified.
- [ ] Embedding does not simulate inheritance or leak APIs.
- [ ] Domain transitions happen through behavior, not raw field mutation.
- [ ] Package names describe behavior/domain, not generic utility buckets.
- [ ] Dependencies are injected explicitly.
- [ ] Concurrency safety is documented for mutable exported types.
- [ ] Tests cover invariants, invalid states, and adapter contracts.

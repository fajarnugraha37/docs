# learn-go-design-patterns-common-patterns-anti-patterns-part-030.md

# Part 030 — Generics-Based Pattern Design

## Status Seri

- Seri: **Go Design Patterns, Common Patterns, and Anti-Patterns**
- Part: **030 dari 035**
- Status seri: **belum selesai**
- Lanjutan dari:
  - Part 029 — Template Method, Hook, and Callback Pattern Without Inheritance
- Setelah ini:
  - Part 031 — Observability Pattern: Logs, Metrics, Traces, and Audit

---

## Tujuan Part Ini

Di part ini kita membahas bagaimana **generics** memengaruhi desain pattern di Go.

Generics di Go membuka kemampuan untuk menulis abstraction berbasis tipe tanpa mengorbankan type safety. Namun generics juga membuka pintu baru untuk over-engineering, terutama bagi engineer yang terbiasa dengan Java generics, inheritance, framework abstraction, repository generic, dan type hierarchy yang kompleks.

Target part ini bukan mengulang syntax generics. Kita sudah melewati seri composition, OOP, functional, reflection, code generation, dan modules. Di sini fokusnya adalah **desain**:

- kapan generics memperbaiki desain
- kapan interface lebih cocok
- kapan concrete function lebih baik
- bagaimana mendesain constraint yang tidak terlalu clever
- bagaimana generics dipakai untuk algorithm reuse
- bagaimana generics dipakai untuk handler/result/cache/key/value helper
- kenapa generic repository sering menjadi anti-pattern
- bagaimana menghindari type parameter API yang sulit dibaca
- bagaimana menjaga public API generic tetap stabil
- bagaimana generics berdampak pada testing, performance, dan evolvability

Mental model utama:

> Generics adalah alat untuk reuse atas bentuk algoritma yang stabil. Generics bukan alat untuk membuat domain yang belum stabil terlihat “framework-ready”.

---

## 1. Apa Masalah yang Diselesaikan Generics?

Sebelum generics, Go punya beberapa pilihan untuk reuse:

1. concrete function
2. interface
3. `any` / `interface{}`
4. code generation
5. reflection
6. duplication

Generics menambah pilihan ke-7:

7. type-parameterized function/type

Generics cocok ketika:

- logic sama untuk banyak tipe
- tipe tetap penting
- kamu ingin menghindari `any` + type assertion
- kamu ingin menghindari reflection
- kamu ingin compiler menjaga type safety
- algorithm lebih penting daripada domain type tertentu

Contoh sederhana:

```go
func Contains[T comparable](items []T, target T) bool {
    for _, item := range items {
        if item == target {
            return true
        }
    }
    return false
}
```

Di sini generic masuk akal karena:

- algorithm stabil
- constraint sederhana
- behavior jelas
- tidak menyembunyikan domain
- tidak butuh interface

---

## 2. Java Generics vs Go Generics

### Java Mindset

Java generics sering dipakai bersama:

- class hierarchy
- bounded type parameter
- abstract base class
- generic repository
- generic service
- generic controller
- dependency injection framework
- reflection/proxy
- annotation
- variance (`? extends`, `? super`)
- type erasure constraints

Contoh style Java enterprise:

```java
interface Repository<T, ID> {
    Optional<T> findById(ID id);
    T save(T entity);
    void deleteById(ID id);
}

abstract class BaseService<T, ID> {
    protected final Repository<T, ID> repo;
}
```

Lalu banyak entity/service/controller mengikuti template.

### Go Mindset

Go generics lebih sempit dan lebih pragmatic.

Generics di Go lebih cocok untuk:

- reusable algorithms
- containers
- helper functions
- typed result wrappers
- small framework-internal helpers
- type-safe adapter glue
- map/slice operations
- cache/key/value utilities
- constraint-limited computation
- test helpers

Go generics bukan pengganti:

- inheritance
- framework base class
- dynamic dispatch
- annotation processing
- runtime metadata system
- domain modeling
- persistence modeling

Di Go, sering lebih baik menulis:

```go
type UserRepository interface {
    FindByID(context.Context, UserID) (User, error)
    Save(context.Context, User) error
}
```

daripada:

```go
type Repository[T any, ID comparable] interface {
    FindByID(context.Context, ID) (T, error)
    Save(context.Context, T) error
}
```

Kenapa?

Karena domain repository punya semantic berbeda, bukan sekadar shape CRUD.

---

## 3. Generics vs Interface vs Concrete

Pertanyaan desain utama:

> Apakah variasinya berada pada tipe data, behavior, atau domain semantics?

### Jika Variasi Ada pada Tipe Data: Generics

```go
func MapSlice[A any, B any](items []A, fn func(A) B) []B {
    out := make([]B, 0, len(items))
    for _, item := range items {
        out = append(out, fn(item))
    }
    return out
}
```

### Jika Variasi Ada pada Behavior: Interface

```go
type Clock interface {
    Now() time.Time
}
```

### Jika Tidak Ada Variasi Penting: Concrete

```go
func NormalizePostalCode(s string) (string, error) {
    ...
}
```

Decision table:

| Situation | Prefer |
|---|---|
| Same algorithm over many element types | Generics |
| Need substitute behavior | Interface |
| Need one clear implementation | Concrete |
| Need optional cross-cutting wrapper | Decorator/interface |
| Need compile-time type-safe utility | Generics |
| Need dynamic plugin behavior | Interface/registry |
| Need reflection over struct tags | Reflection |
| Need repeated boilerplate with complex domain semantics | Usually explicit code |
| Need performance critical specialized code | Concrete or benchmarked generics |
| Need public stable domain API | Concrete/domain-specific interface |

---

## 4. The Three Generics Questions

Before introducing a type parameter, ask:

### 1. What is truly generic?

Bad:

```go
type Service[T any] struct {
    repo Repository[T]
}
```

Maybe nothing here is truly generic except CRUD ceremony.

Good:

```go
func Deduplicate[T comparable](items []T) []T {
    ...
}
```

Deduplication is truly generic.

### 2. What does the constraint mean?

Bad:

```go
type Entity interface {
    GetID() string
    SetID(string)
    Validate() error
    TableName() string
}
```

This constraint mixes:

- identity
- mutation
- validation
- persistence
- database mapping

Good:

```go
func IndexByID[T any, ID comparable](items []T, idOf func(T) ID) map[ID]T {
    out := make(map[ID]T, len(items))
    for _, item := range items {
        out[idOf(item)] = item
    }
    return out
}
```

Instead of forcing all domain types to implement `GetID`.

### 3. Does generic API improve call-site clarity?

Bad:

```go
result, err := Execute[ApproveCommand, ApproveResult, ApprovalPolicy, ApprovalRepository](ctx, cmd, deps)
```

Good:

```go
result, err := approver.Approve(ctx, cmd)
```

If call site becomes harder, generics may not be helping.

---

## 5. Constraint Design

Constraint is part of API.

Simple constraints are usually best.

### `any`

Use when algorithm does not need operations on `T`.

```go
func First[T any](items []T) (T, bool) {
    var zero T
    if len(items) == 0 {
        return zero, false
    }
    return items[0], true
}
```

### `comparable`

Use when values must be map keys or compared with `==`.

```go
func SetFromSlice[T comparable](items []T) map[T]struct{} {
    out := make(map[T]struct{}, len(items))
    for _, item := range items {
        out[item] = struct{}{}
    }
    return out
}
```

### Custom Constraint

Use sparingly.

```go
type Ordered interface {
    ~int | ~int64 | ~float64 | ~string
}
```

But if this is for public library, think carefully. Constraint shape can become hard to evolve.

### Function Parameter Instead of Constraint

Often better:

```go
func SortBy[T any, K cmp.Ordered](items []T, key func(T) K) {
    slices.SortFunc(items, func(a, b T) int {
        return cmp.Compare(key(a), key(b))
    })
}
```

This avoids forcing domain type to implement methods.

### Avoid Fat Constraints

Bad:

```go
type Persistable interface {
    comparable
    Validate() error
    MarshalJSON() ([]byte, error)
    TableName() string
    ID() string
}
```

Fat constraints couple unrelated concerns.

Rule:

> A constraint should describe the minimum operation the generic algorithm needs, not everything the domain object happens to support.

---

## 6. Generic Functions as Algorithm Reuse

Generic functions are the safest use of generics.

### Filter

```go
func Filter[T any](items []T, keep func(T) bool) []T {
    out := make([]T, 0, len(items))
    for _, item := range items {
        if keep(item) {
            out = append(out, item)
        }
    }
    return out
}
```

### Map

```go
func Map[A any, B any](items []A, fn func(A) B) []B {
    out := make([]B, 0, len(items))
    for _, item := range items {
        out = append(out, fn(item))
    }
    return out
}
```

### GroupBy

```go
func GroupBy[T any, K comparable](items []T, key func(T) K) map[K][]T {
    out := make(map[K][]T)
    for _, item := range items {
        k := key(item)
        out[k] = append(out[k], item)
    }
    return out
}
```

### IndexBy

```go
func IndexBy[T any, K comparable](items []T, key func(T) K) map[K]T {
    out := make(map[K]T, len(items))
    for _, item := range items {
        out[key(item)] = item
    }
    return out
}
```

These are fine because:

- semantics are obvious
- type parameters map naturally
- algorithm is stable
- no hidden domain behavior

### Caveat

Do not create a giant functional programming library just because you can.

Sometimes loop is clearer:

```go
var active []User
for _, user := range users {
    if user.Active {
        active = append(active, user)
    }
}
```

This is often more readable than `Filter`.

---

## 7. Generic Result Type

A common idea:

```go
type Result[T any] struct {
    Value T
    Err   error
}
```

Be careful.

Go convention already returns `(T, error)`.

Generic `Result[T]` may be useful when:

- collecting batch results
- passing result through channel
- representing partial success
- aggregating async operations
- storing operation outcome
- returning value + metadata, not just error

Example:

```go
type ItemResult[T any] struct {
    Item  T
    Err   error
    Index int
}
```

For channels:

```go
type AsyncResult[T any] struct {
    Value T
    Err   error
}
```

Usage:

```go
func FetchAsync[T any](ctx context.Context, fn func(context.Context) (T, error)) <-chan AsyncResult[T] {
    ch := make(chan AsyncResult[T], 1)

    go func() {
        defer close(ch)

        value, err := fn(ctx)
        ch <- AsyncResult[T]{Value: value, Err: err}
    }()

    return ch
}
```

Good.

But for normal direct call, prefer:

```go
value, err := service.Do(ctx)
```

not:

```go
result := service.Do(ctx)
if result.Err != nil { ... }
```

Unless result contains domain decision semantics.

---

## 8. Generic Optional Type

Some developers want:

```go
type Option[T any] struct {
    value T
    ok    bool
}
```

Useful? Sometimes.

Go idiom already has:

```go
value, ok := m[key]
```

or:

```go
user, err := repo.FindByID(ctx, id)
```

Option can be useful when:

- value absence is not an error
- you need to store/pass optional value
- you need JSON/config semantics carefully
- avoiding pointer for scalar optional
- internal API benefits from explicit optional

Example:

```go
type Optional[T any] struct {
    value T
    ok    bool
}

func Some[T any](v T) Optional[T] {
    return Optional[T]{value: v, ok: true}
}

func None[T any]() Optional[T] {
    var zero T
    return Optional[T]{value: zero, ok: false}
}

func (o Optional[T]) Get() (T, bool) {
    return o.value, o.ok
}
```

But avoid infecting entire codebase with `Optional[T]` when ordinary Go `(T, bool)` is clearer.

---

## 9. Generic Set

Generic set is a legitimate reusable type.

```go
type Set[T comparable] map[T]struct{}

func NewSet[T comparable](items ...T) Set[T] {
    s := make(Set[T], len(items))
    for _, item := range items {
        s[item] = struct{}{}
    }
    return s
}

func (s Set[T]) Add(item T) {
    s[item] = struct{}{}
}

func (s Set[T]) Contains(item T) bool {
    _, ok := s[item]
    return ok
}

func (s Set[T]) Remove(item T) {
    delete(s, item)
}
```

Use cases:

- allowed states
- allowed roles
- deduplication
- visited nodes
- membership checking

But for a small local use:

```go
allowed := map[State]struct{}{
    StateDraft: {},
    StateOpen:  {},
}
```

is often enough.

---

## 10. Generic Cache

Generic cache can be useful if value type varies.

```go
type Cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Set(K, V, time.Duration)
    Delete(K)
}
```

In-memory implementation:

```go
type MemoryCache[K comparable, V any] struct {
    mu    sync.RWMutex
    items map[K]cacheItem[V]
}

type cacheItem[V any] struct {
    value     V
    expiresAt time.Time
}

func NewMemoryCache[K comparable, V any]() *MemoryCache[K, V] {
    return &MemoryCache[K, V]{
        items: make(map[K]cacheItem[V]),
    }
}

func (c *MemoryCache[K, V]) Get(key K) (V, bool) {
    c.mu.RLock()
    item, ok := c.items[key]
    c.mu.RUnlock()

    var zero V
    if !ok {
        return zero, false
    }

    if !item.expiresAt.IsZero() && time.Now().After(item.expiresAt) {
        c.Delete(key)
        return zero, false
    }

    return item.value, true
}

func (c *MemoryCache[K, V]) Set(key K, value V, ttl time.Duration) {
    var expiresAt time.Time
    if ttl > 0 {
        expiresAt = time.Now().Add(ttl)
    }

    c.mu.Lock()
    c.items[key] = cacheItem[V]{
        value:     value,
        expiresAt: expiresAt,
    }
    c.mu.Unlock()
}

func (c *MemoryCache[K, V]) Delete(key K) {
    c.mu.Lock()
    delete(c.items, key)
    c.mu.Unlock()
}
```

Caveats:

- copying mutable value
- pointer value mutability
- TTL cleanup
- time source testability
- memory growth
- eviction policy
- metrics
- concurrency contention

Generic cache type is okay. But cache policy remains domain-specific.

---

## 11. Generic Key Type Pattern

Sometimes key type safety matters.

Bad:

```go
cache.Get("123")
```

Which ID is `"123"`?

Better:

```go
type UserID string
type CaseID string
```

Generic key helper:

```go
type Key[T any] struct {
    namespace string
    id        string
}

func NewKey[T any](namespace string, id string) Key[T] {
    return Key[T]{namespace: namespace, id: id}
}
```

Usage:

```go
type User struct {
    ID UserID
}

userKey := NewKey[User]("user", string(user.ID))
```

But be careful: phantom type key can be clever. It may be useful in cache library, but overkill in application code.

Simpler often:

```go
type UserCacheKey string
type CaseCacheKey string
```

---

## 12. Generic Handler Pattern

Generic handler can reduce repetition.

```go
type CommandHandler[C any, R any] interface {
    Handle(context.Context, C) (R, error)
}
```

Or function:

```go
type Handler[C any, R any] func(context.Context, C) (R, error)
```

HTTP adapter:

```go
func JSONHandler[C any, R any](
    decode func(*http.Request) (C, error),
    handle func(context.Context, C) (R, error),
    encode func(http.ResponseWriter, R) error,
    writeErr func(http.ResponseWriter, error),
) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        cmd, err := decode(r)
        if err != nil {
            writeErr(w, err)
            return
        }

        result, err := handle(r.Context(), cmd)
        if err != nil {
            writeErr(w, err)
            return
        }

        if err := encode(w, result); err != nil {
            writeErr(w, err)
            return
        }
    })
}
```

This can be useful in internal transport package.

But danger:

- too generic handler hides route semantics
- error mapping differs per endpoint
- status code differs per operation
- auth differs per endpoint
- streaming/file upload does not fit
- request body limits differ
- validation/report shape differs
- audit/correlation differs

Use generic handler only where endpoint semantics are truly uniform.

For critical endpoints, explicit handler may be better.

---

## 13. Generic Middleware/Decorator

Generic command decorator:

```go
type CommandFunc[C any, R any] func(context.Context, C) (R, error)

func WithCommandLogging[C any, R any](
    operation string,
    logger *slog.Logger,
    next CommandFunc[C, R],
) CommandFunc[C, R] {
    return func(ctx context.Context, cmd C) (R, error) {
        start := time.Now()

        result, err := next(ctx, cmd)

        logger.InfoContext(ctx, "command handled",
            slog.String("operation", operation),
            slog.Duration("duration", time.Since(start)),
            slog.Bool("success", err == nil),
        )

        return result, err
    }
}
```

Good when:

- logging metadata can be supplied
- no need to inspect concrete command
- error classification generic enough
- call-site remains readable

If you start adding callbacks for every metadata field:

```go
WithCommandLogging(
    operation,
    extractTenant,
    extractActor,
    extractResource,
    extractState,
    extractDecision,
    logger,
    next,
)
```

Maybe explicit decorator is clearer.

---

## 14. Generic Validation Helpers

Good:

```go
func RequireNonZero[T comparable](field string, value T) ValidationIssue {
    var zero T
    if value == zero {
        return ValidationIssue{
            Field: field,
            Code:  "required",
        }
    }
    return ValidationIssue{}
}
```

But this may not work for all types, and zero value may not mean missing.

Better often:

```go
func RequireString(field string, value string) []ValidationIssue {
    if strings.TrimSpace(value) == "" {
        return []ValidationIssue{{Field: field, Code: "required"}}
    }
    return nil
}
```

Generic validation is risky because validation is semantic, not merely structural.

Examples:

- `0` may be valid age for newborn
- empty string may be valid optional note
- nil slice vs empty slice can differ
- zero `time.Time` may be invalid or meaningful
- `false` may be valid, not missing

Rule:

> Use generics for validation mechanics, not business meaning.

---

## 15. Generic Policy Evaluator?

Tempting:

```go
type Policy[I any, D any] interface {
    Evaluate(context.Context, I) D
}
```

This is okay as a small interface in an internal package.

But if all policies become generic `Policy[I,D]`, naming can lose semantic clarity.

Better for domain:

```go
type ApprovalPolicy interface {
    EvaluateApproval(context.Context, ApprovalInput) ApprovalDecision
}
```

Why?

- clearer call site
- domain-specific documentation
- easier search
- easier audit
- better error/result semantics
- avoids generic soup

Generic helper can still be used internally:

```go
type Rule[I any] interface {
    Evaluate(context.Context, I) RuleResult
}
```

Policy composes rules.

```go
type RuleSet[I any] struct {
    rules []Rule[I]
}

func (s RuleSet[I]) Evaluate(ctx context.Context, input I) Decision {
    ...
}
```

This is a good division:

- generic reusable rule-set engine
- domain-specific public policy

---

## 16. Generic Repository Anti-Pattern

This is one of the biggest traps.

Bad:

```go
type Repository[T any, ID comparable] interface {
    FindByID(context.Context, ID) (T, error)
    FindAll(context.Context) ([]T, error)
    Save(context.Context, T) error
    Delete(context.Context, ID) error
}
```

Looks clean. Usually harmful.

Why?

### 1. Domain Repositories Are Not Uniform

User repository:

```go
FindByEmail(ctx, email)
FindActiveByTenant(ctx, tenant)
```

Case repository:

```go
FindOpenByAssignee(ctx, actor)
FindForTransition(ctx, caseID)
SaveWithVersion(ctx, case, expectedVersion)
```

Audit repository:

```go
Append(ctx, record)
FindByObject(ctx, objectID, filter)
```

Outbox repository:

```go
Add(ctx, event)
ClaimBatch(ctx, workerID, limit)
MarkPublished(ctx, ids)
```

A generic CRUD interface hides real query semantics.

### 2. Transaction Semantics Differ

Some writes require:

- optimistic version
- append-only
- upsert
- lock for update
- conditional update
- soft delete
- outbox in same transaction
- tenant boundary

Generic `Save` says nothing.

### 3. Error Semantics Differ

`ErrNotFound` may mean different things.

`Delete` may be:

- hard delete
- soft delete
- tombstone
- disallowed
- state transition

### 4. Persistence Shape Differs

Some entities are not persisted one-to-one:

- aggregate spans tables
- read model joins tables
- event stream
- audit append-only
- search index
- cache
- external API

Generic repository pretends all storage is same.

### 5. Testing Becomes Too Generic

Mocks/fakes implement CRUD but not business query semantics.

Better:

```go
type CaseRepository interface {
    FindForApproval(ctx context.Context, id CaseID) (Case, error)
    SaveApproved(ctx context.Context, c Case, expectedVersion Version) error
}
```

This expresses intent.

### When Generic Repository Might Be Acceptable

- internal admin CRUD tool
- scaffolding
- simple in-memory test helper
- generic key-value storage
- infrastructure library not domain repository
- prototype, not core domain

Even then, be careful.

---

## 17. Generic DAO Helper Instead of Generic Repository

Instead of generic domain repository, use generic lower-level helper.

Example row scanner helper:

```go
func QueryOne[T any](
    ctx context.Context,
    db Queryer,
    query string,
    scan func(*sql.Row) (T, error),
    args ...any,
) (T, error) {
    row := db.QueryRowContext(ctx, query, args...)
    return scan(row)
}
```

Or:

```go
func CollectRows[T any](
    rows *sql.Rows,
    scan func(*sql.Rows) (T, error),
) ([]T, error) {
    defer rows.Close()

    var out []T
    for rows.Next() {
        item, err := scan(rows)
        if err != nil {
            return nil, err
        }
        out = append(out, item)
    }

    if err := rows.Err(); err != nil {
        return nil, err
    }

    return out, nil
}
```

Domain repository remains explicit:

```go
func (r *SQLCaseRepository) FindForApproval(ctx context.Context, id CaseID) (Case, error) {
    rows, err := r.db.QueryContext(ctx, queryFindForApproval, id)
    if err != nil {
        return Case{}, mapDBError(err)
    }

    cases, err := CollectRows(rows, scanCase)
    if err != nil {
        return Case{}, err
    }

    ...
}
```

This is a healthy use of generics:

- generic helper for mechanics
- explicit repository for semantics

---

## 18. Generic Event Envelope

Event envelope can be generic.

```go
type EventEnvelope[P any] struct {
    ID            EventID
    Type          string
    Version       int
    OccurredAt    time.Time
    CorrelationID string
    CausationID   string
    Payload       P
}
```

Useful:

```go
type CaseApprovedPayload struct {
    CaseID string
    ActorID string
}

event := EventEnvelope[CaseApprovedPayload]{
    ID:      NewEventID(),
    Type:    "case.approved",
    Version: 1,
    Payload: CaseApprovedPayload{
        CaseID: caseID.String(),
        ActorID: actorID.String(),
    },
}
```

Good because:

- envelope mechanics same
- payload type differs
- type safety useful
- serialization can remain explicit

Caveat:

- stored/published events usually become bytes/JSON/Protobuf
- registry/versioning still needed
- consumers need schema contract
- generic envelope does not solve compatibility

---

## 19. Generic Outbox Helper

Outbox write helper:

```go
func AddEvent[P any](
    ctx context.Context,
    outbox OutboxWriter,
    event EventEnvelope[P],
    marshal func(P) ([]byte, error),
) error {
    payload, err := marshal(event.Payload)
    if err != nil {
        return err
    }

    return outbox.Add(ctx, OutboxRecord{
        ID:            event.ID,
        Type:          event.Type,
        Version:       event.Version,
        OccurredAt:    event.OccurredAt,
        CorrelationID: event.CorrelationID,
        CausationID:   event.CausationID,
        Payload:       payload,
    })
}
```

This is useful because mechanics are generic, but serialization/versioning remains explicit.

Bad:

```go
func PublishAnything[T any](ctx context.Context, t T) error {
    b, _ := json.Marshal(t)
    topic := reflect.TypeOf(t).Name()
    return publish(topic, b)
}
```

Problems:

- topic based on type name is fragile
- versioning hidden
- serialization errors ignored
- public contract accidental
- refactor breaks event type

---

## 20. Generic State Machine?

Possible:

```go
type Transition[S comparable, C comparable] struct {
    From S
    Command C
    To   S
}
```

Engine:

```go
type StateMachine[S comparable, C comparable] struct {
    transitions map[transitionKey[S, C]]S
}

type transitionKey[S comparable, C comparable] struct {
    from S
    cmd  C
}

func NewStateMachine[S comparable, C comparable](transitions []Transition[S, C]) *StateMachine[S, C] {
    m := make(map[transitionKey[S, C]]S, len(transitions))
    for _, t := range transitions {
        m[transitionKey[S, C]{from: t.From, cmd: t.Command}] = t.To
    }
    return &StateMachine[S, C]{transitions: m}
}

func (m *StateMachine[S, C]) Next(from S, cmd C) (S, bool) {
    to, ok := m.transitions[transitionKey[S, C]{from: from, cmd: cmd}]
    return to, ok
}
```

This is okay for transition mechanics.

But real state machine often needs:

- guard
- authorization
- validation
- audit
- side effects
- transition reason
- idempotency
- concurrency
- versioning

Generic engine should not hide domain workflow.

Healthy split:

- generic transition table helper
- domain-specific transition service

---

## 21. Generic Worker Pool

Worker pool can be generic.

```go
type JobFunc[I any, O any] func(context.Context, I) (O, error)

type JobResult[I any, O any] struct {
    Input  I
    Output O
    Err    error
}

func RunWorkerPool[I any, O any](
    ctx context.Context,
    inputs <-chan I,
    workers int,
    fn JobFunc[I, O],
) <-chan JobResult[I, O] {
    results := make(chan JobResult[I, O])

    var wg sync.WaitGroup
    wg.Add(workers)

    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()

            for {
                select {
                case <-ctx.Done():
                    return

                case input, ok := <-inputs:
                    if !ok {
                        return
                    }

                    output, err := fn(ctx, input)

                    select {
                    case results <- JobResult[I, O]{
                        Input:  input,
                        Output: output,
                        Err:    err,
                    }:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(results)
    }()

    return results
}
```

Good generic pattern.

Caveats:

- ordering not preserved
- backpressure depends on channels
- error policy external
- cancellation external
- worker count selection domain-specific
- panic recovery policy missing
- observability missing
- input channel ownership must be clear

Generic worker pool provides mechanics. Production worker still needs domain policy.

---

## 22. Generic Singleflight-like Pattern

For in-flight deduplication, generics can type result.

```go
type Call[V any] struct {
    wg  sync.WaitGroup
    val V
    err error
}

type Group[K comparable, V any] struct {
    mu sync.Mutex
    m  map[K]*Call[V]
}

func NewGroup[K comparable, V any]() *Group[K, V] {
    return &Group[K, V]{
        m: make(map[K]*Call[V]),
    }
}

func (g *Group[K, V]) Do(key K, fn func() (V, error)) (V, error, bool) {
    g.mu.Lock()
    if c, ok := g.m[key]; ok {
        g.mu.Unlock()
        c.wg.Wait()
        return c.val, c.err, true
    }

    c := new(Call[V])
    c.wg.Add(1)
    g.m[key] = c
    g.mu.Unlock()

    c.val, c.err = fn()
    c.wg.Done()

    g.mu.Lock()
    delete(g.m, key)
    g.mu.Unlock()

    return c.val, c.err, false
}
```

This is a good generic infra helper.

Caution:

- panic handling
- context cancellation for waiters
- memory growth
- key cardinality
- long-running call
- result sharing semantics
- stale result not cached after call

---

## 23. Generic Test Helpers

Generics are useful for test assertions.

```go
func AssertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()

    if got != want {
        t.Fatalf("got %v, want %v", got, want)
    }
}
```

For slices:

```go
func AssertSliceEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()

    if len(got) != len(want) {
        t.Fatalf("len got %d, want %d", len(got), len(want))
    }

    for i := range got {
        if got[i] != want[i] {
            t.Fatalf("index %d got %v, want %v", i, got[i], want[i])
        }
    }
}
```

But avoid building huge assertion framework. Existing simple tests are often clearer.

---

## 24. Generic Configuration Loader?

Tempting:

```go
func LoadConfig[T any](path string) (T, error) {
    var cfg T
    b, err := os.ReadFile(path)
    if err != nil {
        return cfg, err
    }
    if err := yaml.Unmarshal(b, &cfg); err != nil {
        return cfg, err
    }
    return cfg, nil
}
```

This can be useful.

But production config also needs:

- source precedence
- defaulting
- validation
- secret redaction
- environment-specific policy
- migration
- observability
- documentation
- reload semantics

So generic loading is only one mechanical step.

Better:

```go
raw, err := LoadYAML[RawConfig](path)
if err != nil {
    return Config{}, err
}

cfg, err := BuildConfig(raw, env)
if err != nil {
    return Config{}, err
}
```

Generic decode, explicit build/validate.

---

## 25. Generic JSON Helpers?

Generic decode helper:

```go
func DecodeJSON[T any](r io.Reader, maxBytes int64) (T, error) {
    var zero T

    limited := io.LimitReader(r, maxBytes)
    dec := json.NewDecoder(limited)
    dec.DisallowUnknownFields()

    var value T
    if err := dec.Decode(&value); err != nil {
        return zero, err
    }

    return value, nil
}
```

Useful.

But endpoint-specific logic still matters:

- max body size
- unknown fields policy
- validation
- auth
- audit
- version
- content type
- streaming
- partial updates

Generic decoding should not become generic handler framework accidentally.

---

## 26. Generics and Public API Stability

Generic public API is harder to change once released.

Example:

```go
type Store[K comparable, V any] interface {
    Get(context.Context, K) (V, error)
    Set(context.Context, K, V) error
}
```

If later you need:

- TTL
- version
- compare-and-set
- batch
- metadata
- not-found bool
- stale flag
- tenant
- consistency level

Changing generic interface may break users.

Guideline:

- keep public generic API small
- avoid exporting clever constraints
- avoid exporting generic framework types unless stable
- prefer unexported generic helpers inside package
- expose domain-specific API where semantics matter
- document zero value and error behavior

Generic API is still API. Compatibility matters.

---

## 27. Generics and Error Semantics

Avoid generic error handling that erases meaning.

Bad:

```go
func Must[T any](value T, err error) T {
    if err != nil {
        panic(err)
    }
    return value
}
```

This can be okay in tests/setup, but dangerous in application flow.

Bad generic mapper:

```go
func IgnoreNotFound[T any](value T, err error) T {
    if errors.Is(err, ErrNotFound) {
        return value
    }
    if err != nil {
        panic(err)
    }
    return value
}
```

Semantics depend on operation.

Better:

- keep error translation domain-specific
- use generic helpers only for mechanics
- do not hide retryability/security/validation semantics

---

## 28. Generics and Context

Avoid generic API that hides context.

Bad:

```go
type Loader[T any] func() (T, error)
```

For production operations, likely need:

```go
type Loader[T any] func(context.Context) (T, error)
```

Context should remain explicit where operation can block, cancel, or cross boundary.

Generic helpers should preserve Go conventions:

```go
func WithTimeoutResult[T any](
    parent context.Context,
    timeout time.Duration,
    fn func(context.Context) (T, error),
) (T, error) {
    ctx, cancel := context.WithTimeout(parent, timeout)
    defer cancel()

    return fn(ctx)
}
```

Do not put context inside generic struct as hidden state unless there is a strong reason.

---

## 29. Generics and Performance

Generics can reduce interface/reflection overhead and improve type safety. But performance depends on implementation and compiler behavior. Do not assume generics are always faster.

Performance considerations:

- generic function may inline or may not
- interface constraint may still involve dynamic dispatch for methods
- function callback may allocate if closure escapes
- generic containers may avoid `any` boxing
- reflection-based helpers often slower and less type-safe
- concrete specialized code may still win in hot paths
- readable code may matter more than micro-optimization

Benchmark when:

- hot path
- serialization
- per-row import
- in-memory store
- cache access
- worker pool item processing
- tight loops

Example benchmark target:

```go
func BenchmarkSetContains(b *testing.B) {
    s := NewSet[int](1, 2, 3, 4, 5)

    for i := 0; i < b.N; i++ {
        _ = s.Contains(i % 10)
    }
}
```

Do not benchmark generic vs non-generic unless you have a real performance question.

---

## 30. Generics and Readability

Generics can reduce code, but type parameters add cognitive load.

Bad:

```go
type Executor[C Command[I, O], I Input[K], O Output[V], K comparable, V any] struct {
    ...
}
```

If reader needs a compiler in their head, design is too clever.

Good:

```go
type Handler[C any, R any] func(context.Context, C) (R, error)
```

Simple.

Naming conventions:

- `T` for single arbitrary type
- `K` for key
- `V` for value
- `E` for element
- `C` for command/context-specific type when clear
- `R` for result
- `I`/`O` for input/output

But don't overdo abbreviations in public API if domain names are clearer.

---

## 31. Generics and Type Inference at Call Site

Good generic APIs infer types:

```go
ids := Map(users, func(u User) UserID {
    return u.ID
})
```

No explicit type args needed.

Less good:

```go
ids := Map[User, UserID](users, func(u User) UserID {
    return u.ID
})
```

Still okay.

Bad:

```go
result := Execute[
    ApproveCommand,
    ApproveResult,
    ApprovalContext,
    ApprovalPolicy,
    ApprovalRepository,
](ctx, cmd, deps)
```

If every call needs long type argument list, API may be too generic.

---

## 32. Generics with Method Limitations

Go generics have language-specific boundaries. For design, the practical lesson is:

- keep generic logic in functions/types where it is natural
- do not try to simulate Java generic methods on non-generic types in complicated ways
- do not force whole type to be generic just because one method wants a type parameter
- use free functions when appropriate

Example:

```go
type Store struct {
    db *sql.DB
}

func LoadJSON[T any](s *Store, ctx context.Context, key string) (T, error) {
    ...
}
```

A free function can be clearer than making entire `Store[T]`.

---

## 33. Generic Type Overuse Smells

Watch for these smells:

1. Type parameter appears only once.
2. Constraint has many unrelated methods.
3. Generic type name is `Manager[T]`, `Service[T]`, `Processor[T]`.
4. Call sites require explicit long type arguments.
5. Domain method names disappear into `Execute`.
6. Tests need many fake generic types.
7. Error semantics become generic and vague.
8. API returns `Result[T]` everywhere instead of `(T, error)`.
9. Generic repository appears for core domain.
10. Reflection added to compensate for type erasure-like expectations.
11. Generics used to avoid writing three simple functions.
12. Type parameters leak across packages unnecessarily.
13. Public API constraint becomes impossible to evolve.
14. Debugging stack traces become less meaningful.
15. Reviewers ask “what is T here?” repeatedly.

---

## 34. Healthy Generics Patterns Catalog

Use this as quick reference.

| Pattern | Healthy Use |
|---|---|
| Generic slice helper | algorithm reuse |
| Generic set | membership/dedup |
| Generic cache | typed key/value cache |
| Generic result for async/batch | channel/batch outcomes |
| Generic event envelope | typed payload wrapper |
| Generic worker pool | reusable concurrency mechanics |
| Generic retry template | reusable retry mechanics |
| Generic decode helper | typed JSON/YAML decode |
| Generic test assertion | small test helper |
| Generic transition table | state machine mechanics |
| Generic rule set internal | reusable policy mechanics |
| Generic option | limited optional value semantics |
| Generic repository | rarely, mostly infra/admin/simple CRUD |
| Generic service | usually avoid |
| Generic controller/handler framework | use with caution |
| Generic domain model | usually avoid |

---

## 35. Production Example: Generic Mechanics, Domain-Specific API

Suppose we build case approval service.

### Bad Over-Generic Design

```go
type Entity interface {
    ID() string
    Validate() error
}

type Repository[T Entity] interface {
    FindByID(context.Context, string) (T, error)
    Save(context.Context, T) error
}

type Service[T Entity] struct {
    repo Repository[T]
}

func (s *Service[T]) Approve(ctx context.Context, id string) error {
    entity, err := s.repo.FindByID(ctx, id)
    if err != nil {
        return err
    }

    if err := entity.Validate(); err != nil {
        return err
    }

    return s.repo.Save(ctx, entity)
}
```

Problems:

- `Approve` does not apply to all entity
- validation is not approval policy
- transition missing
- authorization missing
- audit missing
- outbox missing
- state machine missing
- error semantics vague
- repository semantics vague

### Better Design

Domain-specific API:

```go
type CaseApprover interface {
    Approve(context.Context, ApproveCaseCommand) (ApproveCaseResult, error)
}

type CaseRepository interface {
    FindForApproval(context.Context, CaseID) (Case, error)
    SaveApproved(context.Context, Case, Version) error
}
```

Generic helper inside:

```go
func IndexBy[T any, K comparable](items []T, key func(T) K) map[K]T {
    out := make(map[K]T, len(items))
    for _, item := range items {
        out[key(item)] = item
    }
    return out
}
```

Generic event envelope:

```go
event := EventEnvelope[CaseApprovedPayload]{
    Type:    "case.approved",
    Version: 1,
    Payload: CaseApprovedPayload{
        CaseID: cmd.CaseID.String(),
        ActorID: cmd.ActorID.String(),
    },
}
```

Generic outbox helper:

```go
if err := AddEvent(ctx, s.outbox, event, marshalCaseApproved); err != nil {
    return ApproveCaseResult{}, err
}
```

This is the right split:

- domain API explicit
- generic mechanics reusable
- semantics not erased

---

## 36. Production Example: Typed Batch Result

Batch command processing:

```go
type BatchResult[T any] struct {
    Total     int
    Succeeded int
    Failed    int
    Items     []ItemOutcome[T]
}

type ItemOutcome[T any] struct {
    Index int
    Value T
    Err   error
}
```

Processor:

```go
func ProcessBatch[I any, O any](
    ctx context.Context,
    items []I,
    fn func(context.Context, I) (O, error),
) BatchResult[O] {
    result := BatchResult[O]{
        Total: len(items),
    }

    for i, item := range items {
        output, err := fn(ctx, item)
        outcome := ItemOutcome[O]{
            Index: i,
            Value: output,
            Err:   err,
        }

        result.Items = append(result.Items, outcome)

        if err != nil {
            result.Failed++
        } else {
            result.Succeeded++
        }
    }

    return result
}
```

Usage:

```go
result := ProcessBatch(ctx, commands, func(ctx context.Context, cmd ApproveCaseCommand) (ApproveCaseResult, error) {
    return approver.Approve(ctx, cmd)
})
```

Good because:

- batch mechanics generic
- command behavior domain-specific
- result typed
- error preserved

---

## 37. Production Example: Generic Rule Set Internal, Domain-Specific Policy External

Generic rule mechanics:

```go
type Rule[I any] interface {
    Evaluate(context.Context, I) RuleResult
}

type RuleResult struct {
    Passed bool
    Reason DecisionReason
}

type RuleSet[I any] struct {
    rules []Rule[I]
}

func NewRuleSet[I any](rules ...Rule[I]) RuleSet[I] {
    return RuleSet[I]{rules: rules}
}

func (s RuleSet[I]) Evaluate(ctx context.Context, input I) Decision {
    decision := Decision{Allowed: true}

    for _, rule := range s.rules {
        result := rule.Evaluate(ctx, input)
        if !result.Passed {
            decision.Allowed = false
            decision.Reasons = append(decision.Reasons, result.Reason)
        }
    }

    return decision
}
```

Domain-specific policy:

```go
type ApprovalPolicy struct {
    rules RuleSet[ApprovalInput]
}

func (p ApprovalPolicy) EvaluateApproval(ctx context.Context, input ApprovalInput) ApprovalDecision {
    decision := p.rules.Evaluate(ctx, input)

    return ApprovalDecision{
        Allowed: decision.Allowed,
        Reasons: decision.Reasons,
    }
}
```

Call site:

```go
decision := policy.EvaluateApproval(ctx, ApprovalInput{
    Case: c,
    Actor: actor,
})
```

This is readable and type-safe.

---

## 38. Refactoring Playbook

### 38.1 From `any` Helper to Generic Helper

Before:

```go
func Contains(items []any, target any) bool {
    for _, item := range items {
        if item == target {
            return true
        }
    }
    return false
}
```

Problem:

- loses type safety
- may panic for non-comparable
- caller must convert

After:

```go
func Contains[T comparable](items []T, target T) bool {
    for _, item := range items {
        if item == target {
            return true
        }
    }
    return false
}
```

### 38.2 From Reflection Mapper to Typed Function

Before:

```go
func MapField(items any, field string) []any {
    // reflection magic
}
```

After:

```go
func Map[A any, B any](items []A, fn func(A) B) []B {
    out := make([]B, 0, len(items))
    for _, item := range items {
        out = append(out, fn(item))
    }
    return out
}
```

### 38.3 From Generic Repository to Explicit Repository

Before:

```go
type Repository[T any, ID comparable] interface {
    FindByID(context.Context, ID) (T, error)
    Save(context.Context, T) error
}
```

After:

```go
type CaseRepository interface {
    FindForApproval(context.Context, CaseID) (Case, error)
    SaveWithVersion(context.Context, Case, Version) error
}
```

Generic helpers can remain in infrastructure.

### 38.4 From Generic Service to Use Case

Before:

```go
type Service[T any] struct {
    repo Repository[T]
}
```

After:

```go
type ApproveCaseService struct {
    cases CaseRepository
    policy ApprovalPolicy
    outbox Outbox
}
```

### 38.5 From Over-Clever Constraint to Function Parameter

Before:

```go
type Identifiable[ID comparable] interface {
    ID() ID
}

func Index[T Identifiable[ID], ID comparable](items []T) map[ID]T {
    ...
}
```

After:

```go
func IndexBy[T any, ID comparable](items []T, id func(T) ID) map[ID]T {
    ...
}
```

This avoids forcing domain types to implement generic interface.

---

## 39. Review Checklist

### Necessity

- Apa yang benar-benar generic?
- Apakah generic menghapus duplikasi bermakna atau hanya membuat code terlihat sophisticated?
- Apakah concrete code lebih jelas?
- Apakah interface lebih tepat karena variasinya behavior?

### Constraint

- Apakah constraint minimal?
- Apakah constraint mencampur concern?
- Apakah `comparable`/`any` cukup?
- Apakah function parameter lebih baik daripada method constraint?

### API

- Apakah call site readable?
- Apakah type inference bekerja?
- Apakah public API mudah dievolusi?
- Apakah domain semantics hilang?
- Apakah error semantics tetap jelas?

### Domain

- Apakah generics dipakai untuk mechanics atau domain?
- Apakah repository/service menjadi terlalu generic?
- Apakah method name masih domain-specific?
- Apakah audit/security/transaction semantics tetap eksplisit?

### Testing

- Apakah generic helper punya test dengan beberapa tipe?
- Apakah edge case zero value dites?
- Apakah nil/pointer/mutable value behavior jelas?
- Apakah concurrency behavior dites jika generic type concurrent?

### Performance

- Apakah hot path?
- Apakah closure allocation penting?
- Apakah interface/reflection diganti generics benar-benar membantu?
- Apakah benchmark diperlukan?

---

## 40. Anti-Pattern Catalog

### Anti-Pattern 1: Generics Because Java

```go
type BaseService[T any] struct { ... }
```

Dipakai karena terbiasa dengan Java base class, bukan karena algorithm generic.

### Anti-Pattern 2: Generic Repository Everywhere

```go
Repository[T, ID]
```

Menghapus semantics repository yang sebenarnya.

### Anti-Pattern 3: Fat Constraint

```go
type Entity interface {
    Validate()
    ID()
    TableName()
    MarshalJSON()
}
```

Mencampur domain, validation, persistence, serialization.

### Anti-Pattern 4: Type Parameter Soup

```go
Executor[A, B, C, D, E, F]
```

Sulit dibaca dan dievolusi.

### Anti-Pattern 5: Generic Result Everywhere

```go
Result[T]
```

Menggantikan `(T, error)` tanpa alasan.

### Anti-Pattern 6: Domain Erased Into Execute

```go
handler.Execute(ctx, input)
```

Semua use case jadi tidak searchable dan tidak ekspresif.

### Anti-Pattern 7: Generic Validation With Wrong Semantics

`zero == invalid` untuk semua field.

### Anti-Pattern 8: Generic Event Type Without Versioning

Payload typed tetapi schema contract tidak jelas.

### Anti-Pattern 9: Public Clever Constraint

Constraint diekspor dan sulit diubah setelah user bergantung padanya.

### Anti-Pattern 10: Generic Framework Before Product Shape Stabilizes

Membuat framework internal sebelum pola nyata muncul.

---

## 41. Practical Heuristics

1. Start concrete.
2. Extract generic only after repeated stable algorithm appears.
3. Prefer generics for mechanics.
4. Prefer explicit domain types for semantics.
5. Prefer interface for behavior substitution.
6. Prefer function parameter over fat constraint.
7. Avoid generic repository for core domain.
8. Avoid generic service/controller unless semantics truly uniform.
9. Keep generic public API small.
10. Ensure call site remains readable.
11. Use `(T, error)` by default.
12. Use generic `Result[T]` mostly for async/batch.
13. Keep context explicit.
14. Benchmark hot generic paths.
15. Let domain language survive.

---

## 42. Exercises

### Exercise 1: Refactor `any` to Generic

Convert this:

```go
func Unique(items []any) []any
```

Into:

```go
func Unique[T comparable](items []T) []T
```

Then test with:

- `[]string`
- `[]int`
- custom type `UserID`

### Exercise 2: Avoid Generic Repository

Given:

```go
type Repository[T any, ID comparable] interface {
    FindByID(context.Context, ID) (T, error)
    Save(context.Context, T) error
}
```

Refactor into domain-specific repository for `CaseApproval`.

Include:

- `FindForApproval`
- optimistic version save
- meaningful error semantics

### Exercise 3: Generic Batch Result

Implement:

```go
func ProcessBatch[I any, O any](
    ctx context.Context,
    inputs []I,
    fn func(context.Context, I) (O, error),
) BatchResult[O]
```

Test partial success.

### Exercise 4: Constraint Design

Given a fat constraint:

```go
type Entity interface {
    ID() string
    Validate() error
    TableName() string
}
```

Replace it with function parameters.

### Exercise 5: Generic Event Envelope

Create typed event envelope for:

- `CaseApprovedPayload`
- `CaseRejectedPayload`

Then write generic helper to convert to `OutboxRecord` with explicit event type and version.

---

## 43. Ringkasan

Generics di Go adalah alat yang kuat, tetapi harus dipakai dengan disiplin.

Generics cocok untuk:

- algorithm reuse
- typed helper
- generic collection
- cache/key/value mechanics
- worker pool mechanics
- event envelope mechanics
- batch result mechanics
- test helper
- internal rule engine mechanics

Generics kurang cocok untuk:

- core domain modeling
- generic service layer
- generic repository untuk workflow penting
- generic controller framework
- business policy yang butuh bahasa domain
- API publik yang belum stabil
- abstraction karena kebiasaan Java

Mental model utama:

> Gunakan generics untuk mekanik yang stabil. Gunakan nama domain eksplisit untuk keputusan bisnis yang penting.

---

## 44. Koneksi ke Part Berikutnya

Part berikutnya:

# Part 031 — Observability Pattern: Logs, Metrics, Traces, and Audit

Kita akan membahas observability sebagai design pattern, bukan hanya logging:

- structured logs
- metric boundaries
- trace propagation
- correlation/causation ID
- error cardinality
- audit vs log
- decision trace
- regulatory defensibility
- privacy and redaction
- observability anti-pattern


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-design-patterns-common-patterns-anti-patterns-part-029.md">⬅️ Part 029 — Template Method, Hook, and Callback Pattern Without Inheritance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-design-patterns-common-patterns-anti-patterns-part-031.md">Part 031 — Observability Pattern: Logs, Metrics, Traces, and Audit ➡️</a>
</div>

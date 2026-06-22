# learn-go-composition-oop-functional-reflection-codegen-modules-part-029.md

# Part 029 — API Compatibility Engineering: Go 1 Promise, Exported API Contract, Breaking Changes, Semantic Import Versioning, Deprecation, Migration, dan Compatibility Tests

> Seri: `learn-go-composition-oop-functional-reflection-codegen-modules`  
> Bagian: `029 / 030`  
> Target pembaca: Java software engineer / tech lead yang ingin merancang dan menjaga API Go untuk library/internal platform skala besar  
> Fokus: compatibility engineering, exported API governance, semantic versioning, major version strategy, deprecation, migration path, compatibility testing, dan large-organization API discipline

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membahas:

- package design;
- module fundamentals;
- modern module governance;
- private modules;
- large-scale repo architecture.

Part ini menjawab pertanyaan lanjutan:

> Setelah package/module/repository terbentuk, bagaimana kita menjaga API-nya tetap stabil, evolve dengan aman, dan tidak menghancurkan consumer?

Dalam Go, API compatibility sangat penting karena:

- interface satisfaction bersifat implicit;
- exported names menjadi kontrak;
- struct fields bisa dipakai langsung oleh consumer;
- function signatures sulit diubah tanpa breaking change;
- module major version harus tercermin pada import path mulai v2;
- package name/import path adalah identity;
- internal library sering menjadi platform dependency bagi banyak service;
- Go ecosystem sangat menghargai backward compatibility.

Mental model utama:

> Di Go, public API bukan hanya dokumentasi.  
> Public API adalah semua exported identifier, import path, observable behavior, module path, version policy, dan semantic expectations yang sudah dipakai consumer.

---

## 1. Kenapa Compatibility Engineering Penting

Untuk Java engineer, compatibility sering dipikirkan dalam bentuk:

- binary compatibility;
- source compatibility;
- Maven artifact version;
- interface/class method signature;
- annotations;
- runtime behavior;
- serialization contract;
- dependency convergence.

Di Go, bentuknya berbeda:

- source compatibility lebih dominan;
- import path adalah bagian dari identity;
- package-level exported names adalah API;
- method set memengaruhi interface satisfaction;
- adding methods to exported interface can break implementers;
- adding fields to struct may be okay or harmful depending struct literal usage;
- changing receiver type can alter method set;
- changing generic constraint can break callers;
- changing tags/serialization behavior can break wire compatibility;
- changing module path/major version changes import path.

Compatibility bukan hanya “apakah compile”.

Ada beberapa lapisan:

```mermaid
flowchart TD
    A[Compatibility] --> B[Source Compatibility]
    A --> C[Behavior Compatibility]
    A --> D[Import Path Compatibility]
    A --> E[Module Version Compatibility]
    A --> F[Wire/Data Compatibility]
    A --> G[Operational Compatibility]
    A --> H[Performance Compatibility]
    A --> I[Security Compatibility]

    B --> B1[Exported identifiers]
    B --> B2[Signatures]
    B --> B3[Interfaces]
    B --> B4[Struct fields]
    B --> B5[Generic constraints]

    C --> C1[Errors]
    C --> C2[Nil behavior]
    C --> C3[Ordering]
    C --> C4[Idempotency]
    C --> C5[Concurrency safety]

    D --> D1[module path]
    D --> D2[package path]
    D --> D3[/v2 major suffix]

    F --> F1[JSON]
    F --> F2[DB schema mapping]
    F --> F3[Protobuf]
    F --> F4[OpenAPI]
```

Top engineer memikirkan semuanya.

---

## 2. Go Compatibility Philosophy

Go memiliki compatibility culture yang kuat. Go 1 compatibility promise menjadi referensi penting: program yang bekerja dengan Go 1 seharusnya terus compile dan berjalan dengan versi Go 1 berikutnya, dengan batasan tertentu.

Bagi library/application engineer, prinsip yang perlu ditiru:

> Jika consumer mengimport package path yang sama, versi baru harus backward compatible dengan versi lama.

Dalam module system, ini dikenal sebagai **import compatibility rule**:

```text
If an old package and a new package have the same import path,
the new package must be backwards compatible with the old package.
```

Konsekuensinya:

- breaking change untuk stable module tidak boleh memakai import path yang sama;
- mulai major version v2, module path harus memiliki suffix `/v2`, `/v3`, dan seterusnya;
- consumer bisa mengimport v1 dan v2 secara bersamaan karena path-nya berbeda.

Example:

```go
import "example.com/workflow"
import workflowv2 "example.com/workflow/v2"
```

Ini berbeda dari Java Maven, di mana artifact coordinate bisa berubah versi tanpa package import berubah.

---

## 3. API Surface: Apa yang Termasuk Public API?

Public API Go mencakup lebih banyak dari yang sering disadari.

### 3.1 Exported Identifiers

Semua identifier berawalan kapital di package importable:

```go
type Client struct {}
func NewClient(...) *Client
const DefaultTimeout = ...
var ErrNotFound = ...
```

Ini public API.

### 3.2 Exported Struct Fields

```go
type Config struct {
    Timeout time.Duration
    Logger  *slog.Logger
}
```

Fields ini public API.

Consumer bisa:

```go
cfg := permission.Config{
    Timeout: 5 * time.Second,
    Logger: logger,
}
```

Menghapus/rename field = breaking change.

Mengubah type field = breaking change.

### 3.3 Exported Interface Methods

```go
type Store interface {
    Save(ctx context.Context, c Case) error
}
```

Method set adalah contract.

Adding method:

```go
type Store interface {
    Save(ctx context.Context, c Case) error
    Delete(ctx context.Context, id ID) error
}
```

breaking untuk semua implementer.

### 3.4 Function Signatures

```go
func Evaluate(ctx context.Context, p Policy, c Case) (Decision, error)
```

Perubahan parameter/return type adalah breaking.

### 3.5 Method Receiver and Method Set

Receiver choice memengaruhi method set.

Changing:

```go
func (p Policy) Evaluate(...)
```

to:

```go
func (p *Policy) Evaluate(...)
```

can break interface satisfaction for `Policy` values.

### 3.6 Generic Type Parameters and Constraints

```go
func ParseID[T ~string](s string) (T, error)
```

Constraint adalah API.

Changing constraint can break callers.

### 3.7 Error Sentinels and Types

```go
var ErrPermissionDenied = errors.New("permission denied")

type ValidationError struct {
    Field string
    Code  string
}
```

If consumers use:

```go
errors.Is(err, permission.ErrPermissionDenied)
errors.As(err, *ValidationError)
```

then error shape is public contract.

### 3.8 Observable Behavior

Even if type signatures unchanged, behavior can break:

- changed default timeout;
- changed nil handling;
- changed ordering;
- changed retry behavior;
- changed validation strictness;
- changed JSON field;
- changed error wrapping;
- changed concurrency safety;
- changed idempotency.

### 3.9 Module Path and Package Path

Changing:

```go
module example.com/permission
```

to:

```go
module example.com/platform/permission
```

is breaking for imports.

### 3.10 Generated API

Generated code can expose public symbols too.

If generated `PermissionCode` constants are exported, they are API.

---

## 4. Compatibility Classification

Classify every change.

### 4.1 Usually Compatible

Examples:

- adding a new exported function;
- adding a new exported type;
- adding a new method to a concrete exported type;
- adding unexported fields to exported struct;
- adding new optional functional option;
- adding new error wrapping while preserving `errors.Is`;
- adding new package;
- improving performance without behavior change;
- adding new enum value if consumers handle unknown values safely.

But “usually” is not “always”.

### 4.2 Usually Breaking

Examples:

- removing exported identifier;
- renaming exported identifier;
- changing function signature;
- changing method signature;
- adding method to exported interface;
- changing exported field type;
- removing exported struct field;
- changing package path;
- changing module path;
- changing major version without `/vN`;
- changing error type/sentinel semantics;
- changing generic constraint in restrictive way;
- changing JSON field name;
- changing default behavior relied by consumers;
- changing concurrency safety contract;
- changing nil acceptance.

### 4.3 Gray Area

Examples:

- adding field to exported struct;
- adding enum value;
- making validation stricter;
- changing error messages;
- changing ordering;
- changing time zone behavior;
- changing zero value behavior;
- adding retries;
- changing logging/metrics labels;
- changing context cancellation timing;
- changing panic vs error behavior.

Gray area needs compatibility test and release notes.

---

## 5. Versioning Semantics

Semantic version:

```text
vMAJOR.MINOR.PATCH
```

Meaning:

- `PATCH`: backward-compatible bug fix;
- `MINOR`: backward-compatible new feature;
- `MAJOR`: breaking change.

In Go modules:

- v0 means unstable; breaking changes may occur;
- v1+ should preserve backward compatibility within same major version;
- v2+ requires major suffix in module path.

Example:

```go
module example.com/workflow/v2
```

Import:

```go
import "example.com/workflow/v2"
```

### 5.1 v0 Is Not a Free Pass Forever

`v0.x.y` signals instability.

But in internal enterprise context, a widely used `v0` module can still have large blast radius.

If 30 services consume `v0.8.4`, breaking it casually is operationally expensive.

Policy:

```text
v0 can break, but breakage must still be communicated and tested.
```

### 5.2 v1 Is a Promise

Once you tag:

```text
v1.0.0
```

you are saying:

```text
Public API is stable enough that breaking changes require v2.
```

Do not tag v1 casually.

### 5.3 v2+ Path

For v2:

```go
module example.com/permission/v2
```

not:

```go
module example.com/permission
```

with tag `v2.0.0`.

This allows:

```go
import "example.com/permission"
import permissionv2 "example.com/permission/v2"
```

coexistence.

---

## 6. Breaking Changes in Detail

### 6.1 Removing Function

Before:

```go
func Evaluate(ctx context.Context, p Policy, c Case) (Decision, error)
```

After removed.

Breaking.

Migration:

```go
func Evaluate(ctx context.Context, p Policy, c Case) (Decision, error) {
    return NewEvaluator(p).Evaluate(ctx, c)
}
```

Keep wrapper until v2.

### 6.2 Changing Signature

Before:

```go
func NewClient(endpoint string) *Client
```

After:

```go
func NewClient(endpoint string, timeout time.Duration) *Client
```

Breaking.

Compatible alternative:

```go
func NewClient(endpoint string, opts ...Option) (*Client, error)
```

But changing existing return type from `*Client` to `(*Client, error)` is breaking.

Better migration:

```go
func NewClient(endpoint string) *Client {
    c, _ := NewClientWithOptions(endpoint)
    return c
}

func NewClientWithOptions(endpoint string, opts ...Option) (*Client, error) {
    // ...
}
```

### 6.3 Adding Method to Interface

Before:

```go
type Authorizer interface {
    Authorize(ctx context.Context, subject Subject, action Action) (Decision, error)
}
```

After:

```go
type Authorizer interface {
    Authorize(ctx context.Context, subject Subject, action Action) (Decision, error)
    Explain(ctx context.Context, subject Subject, action Action) (Explanation, error)
}
```

Breaking.

Compatible alternative:

```go
type Explainer interface {
    Explain(ctx context.Context, subject Subject, action Action) (Explanation, error)
}
```

Then use optional capability:

```go
if e, ok := authorizer.(Explainer); ok {
    return e.Explain(ctx, subject, action)
}
```

### 6.4 Changing Struct Field

Before:

```go
type Config struct {
    Timeout time.Duration
}
```

After:

```go
type Config struct {
    RequestTimeout time.Duration
}
```

Breaking.

Compatible migration:

```go
type Config struct {
    // Deprecated: use RequestTimeout.
    Timeout time.Duration

    RequestTimeout time.Duration
}
```

Resolve:

```go
timeout := cfg.RequestTimeout
if timeout == 0 {
    timeout = cfg.Timeout
}
```

Document precedence.

### 6.5 Adding Field to Struct

Usually source-compatible for keyed literals:

```go
Config{Timeout: time.Second}
```

But can break unkeyed literals:

```go
Config{time.Second}
```

For exported struct intended for external use, unkeyed literals are possible unless discouraged by docs.

Mitigation:

- document “use keyed fields”;
- prefer constructor/options for complex config;
- avoid exported struct with many positional fields;
- add unexported field to prevent unkeyed external literals if needed.

Example:

```go
type Config struct {
    _ noUnkeyedLiterals

    Timeout time.Duration
    Logger  *slog.Logger
}

type noUnkeyedLiterals struct{}
```

But this has ergonomics trade-offs.

### 6.6 Changing Error Text

If consumers compare:

```go
if err.Error() == "permission denied" { ... }
```

they are wrong, but it happens.

Better API:

```go
var ErrPermissionDenied = errors.New("permission denied")
```

Consumers use:

```go
errors.Is(err, ErrPermissionDenied)
```

Compatibility policy:

- error text is usually not stable unless documented;
- sentinel/type behavior can be stable;
- do not rely on message for machine logic.

### 6.7 Changing Nil Behavior

Before:

```go
func NewEvaluator(policy *Policy) *Evaluator
```

accepted nil and used default.

After nil panics.

Breaking behavior.

If nil was never documented but commonly used, still risky.

Policy:

- document nil semantics;
- test nil behavior;
- avoid hidden default from nil unless intentionally supported.

### 6.8 Changing Concurrency Safety

Before:

```text
Client is safe for concurrent use.
```

After not safe.

Breaking.

Even if signatures unchanged.

Document:

```go
// Client is safe for concurrent use by multiple goroutines.
```

or:

```go
// Client must not be used concurrently.
```

### 6.9 Changing Default Options

Before default timeout 30s.

After default timeout 3s.

Could be breaking operationally.

Policy:

- defaults are behavior contract;
- large default changes need minor/major decision based on impact;
- release notes and migration config required.

### 6.10 Changing Serialization

Before:

```go
type CaseDTO struct {
    CreatedAt string `json:"createdAt"`
}
```

After:

```go
type CaseDTO struct {
    CreatedAt time.Time `json:"createdAt"`
}
```

Go API and wire API both affected.

Requires separate compatibility review.

---

## 7. Interface Evolution Strategy

Interfaces are one of the easiest places to break Go consumers.

### 7.1 Keep Interfaces Small

Small interface:

```go
type Reader interface {
    Read(ctx context.Context, id ID) (Record, error)
}
```

Large interface:

```go
type Repository interface {
    Find(...)
    Save(...)
    Delete(...)
    Search(...)
    Count(...)
    Exists(...)
    Lock(...)
    Unlock(...)
}
```

Large interfaces are harder to evolve.

### 7.2 Add New Interface Instead of New Method

Instead of expanding:

```go
type Store interface {
    Save(...)
    Delete(...)
}
```

define:

```go
type Deleter interface {
    Delete(...)
}
```

Use composition:

```go
type FullStore interface {
    Store
    Deleter
}
```

### 7.3 Optional Capability

```go
type Explainer interface {
    Explain(ctx context.Context, req Request) (Explanation, error)
}

func MaybeExplain(ctx context.Context, auth Authorizer, req Request) (Explanation, bool, error) {
    e, ok := auth.(Explainer)
    if !ok {
        return Explanation{}, false, nil
    }
    exp, err := e.Explain(ctx, req)
    return exp, true, err
}
```

### 7.4 Sealed-Like Interface

Sometimes you do not want external implementation.

```go
type Token interface {
    Value() string
    private()
}
```

Because external packages cannot implement unexported method.

This is compatibility control.

Use sparingly.

### 7.5 Interface Compatibility Checklist

Before changing exported interface:

- Who implements it?
- Is it intended for consumers to implement?
- Can you add separate interface?
- Can you use optional capability?
- Can you add concrete helper instead?
- Is v2 required?
- Do compatibility tests cover external implementer?

---

## 8. Struct Evolution Strategy

### 8.1 Exported Config Struct

Config structs are common.

```go
type Config struct {
    Endpoint string
    Timeout  time.Duration
    Logger   *slog.Logger
}
```

Good for simple config.

Risks:

- zero value semantics unclear;
- fields become permanent API;
- validation added later can break;
- defaults change can surprise;
- unkeyed literals possible.

### 8.2 Functional Options for Evolvability

```go
type Option func(*config)

func WithTimeout(d time.Duration) Option
func WithLogger(l *slog.Logger) Option

func NewClient(endpoint string, opts ...Option) (*Client, error)
```

Adding new option is compatible.

But changing existing option semantics can break.

### 8.3 Hybrid

For application internal code, struct config is fine.

For public library, prefer:

- constructor for required fields;
- options for optional behavior;
- exported config only if stable and simple.

### 8.4 Unexported Fields

Adding unexported fields to exported struct is usually source-compatible for keyed literals but breaks unkeyed literals from same package only. External packages cannot name unexported fields but can use unkeyed literal if all fields? Actually unkeyed literals for structs from another package can include only exported? Go permits composite literals of exported struct type with unkeyed values only if fields are accessible? In practice, unkeyed literals of structs from another package are allowed only for exported fields? The safest guidance: do not rely on external unkeyed literals for exported structs; document keyed usage and consider constructors.

### 8.5 Struct Compatibility Checklist

- Are fields exported?
- Do consumers construct it?
- Are unkeyed literals likely?
- Is zero value meaningful?
- Are defaults documented?
- Can new field be optional?
- Can constructor/options hide future changes?
- Does JSON/db tag form wire contract?
- Are fields safe to mutate after construction?

---

## 9. Error Compatibility

Go error compatibility is subtle.

### 9.1 Stable Sentinel

```go
var ErrNotFound = errors.New("not found")
```

Changing this variable breaks `errors.Is`.

Do not replace casually.

### 9.2 Wrapping

Compatible:

```go
return fmt.Errorf("find case %s: %w", id, ErrNotFound)
```

Consumer:

```go
errors.Is(err, ErrNotFound)
```

### 9.3 Error Type

```go
type ValidationError struct {
    Field string
    Code  string
}

func (e *ValidationError) Error() string { ... }
```

Changing exported fields is compatibility change.

Adding fields usually okay.

### 9.4 Error Code

For machine contract:

```go
type Code string

const (
    CodePermissionDenied Code = "PERMISSION_DENIED"
    CodeInvalidState     Code = "INVALID_STATE"
)
```

Adding new code may break exhaustive consumer switches if they assume closed set.

Document whether enum is open or closed.

### 9.5 Error Compatibility Rules

- Do not require string comparison.
- Preserve `errors.Is` behavior.
- Preserve `errors.As` behavior for documented error types.
- Document whether error codes are stable.
- Avoid leaking internal error text as public contract.
- Changing from error to panic is breaking.
- Changing from panic to error can be compatible but behaviorally significant.

---

## 10. Generic API Compatibility

Generics add new compatibility surfaces.

### 10.1 Constraint Tightening

Before:

```go
func Dedup[T comparable](items []T) []T
```

After:

```go
func Dedup[T ~string | ~int](items []T) []T
```

Breaking for callers using other comparable types.

### 10.2 Constraint Widening

Before:

```go
func Parse[T ~string](s string) (T, error)
```

After:

```go
func Parse[T ~string | ~[]byte](s string) (T, error)
```

Usually compatible, but behavior for inference may change.

### 10.3 Type Parameter Order

Before:

```go
func Map[A, B any](items []A, f func(A) B) []B
```

After:

```go
func Map[B, A any](items []A, f func(A) B) []B
```

Can break explicit type arguments.

### 10.4 Exported Constraint Types

```go
type Ordered interface {
    ~int | ~int64 | ~float64 | ~string
}
```

This is API.

Changing it changes what downstream generic functions/types can accept.

### 10.5 Generic Compatibility Checklist

- Are constraints exported?
- Are constraints widened or narrowed?
- Do callers use explicit type args?
- Does inference change?
- Are union terms changed?
- Is `~T` removed or added?
- Is `comparable` added?
- Does method requirement change?
- Does type parameter order change?
- Does generated code depend on generic API?

---

## 11. Functional Options Compatibility

Functional options are powerful for compatible evolution.

### 11.1 Adding Option

Compatible:

```go
func WithRetryPolicy(p RetryPolicy) Option
```

### 11.2 Changing Existing Option

Risky:

```go
WithTimeout(0)
```

Before means no timeout.

After means default timeout.

Breaking if documented/relied upon.

### 11.3 Option Ordering

If options are applied sequentially:

```go
NewClient(WithTimeout(1*time.Second), WithNoTimeout())
```

Document precedence.

Better validate conflicts:

```go
if cfg.timeoutSet && cfg.noTimeout {
    return nil, errors.New("conflicting timeout options")
}
```

### 11.4 Option Type Exposure

```go
type Option func(*config)
```

If `config` unexported, consumers cannot inspect but can create custom options only if type permits? They can write function with unexported parameter type? No, cannot name unexported type from another package. Therefore exported option constructors control API.

Alternative:

```go
type Option interface {
    apply(*config)
}
```

with unexported method prevents external implementations.

This gives compatibility control.

### 11.5 Option Compatibility Checklist

- Are options additive?
- Are old options preserved?
- Are semantics stable?
- Are conflict rules documented?
- Are defaults stable?
- Are options externally implementable?
- Should option interface be sealed?
- Are invalid combinations rejected deterministically?

---

## 12. Deprecation Strategy

Go convention:

```go
// Deprecated: use NewEvaluator instead.
func Evaluate(...) (...) {
    ...
}
```

A deprecation paragraph begins with `Deprecated:`.

Tools and documentation systems can surface this.

### 12.1 Good Deprecation Comment

```go
// Evaluate evaluates a policy for a case.
//
// Deprecated: use Evaluator.Evaluate. Evaluate will remain available until v2.
func Evaluate(ctx context.Context, p Policy, c Case) (Decision, error) {
    return NewEvaluator(p).Evaluate(ctx, c)
}
```

Good because it says:

- what to use instead;
- lifecycle;
- old function still works.

### 12.2 Bad Deprecation Comment

```go
// Deprecated.
func Evaluate(...)
```

Bad because no migration path.

### 12.3 Module Deprecation

A module can be deprecated via `// Deprecated:` comment in `go.mod` and tagging new version.

Example:

```go
// Deprecated: use example.com/platform/permission instead.
module example.com/old-permission
```

Use for:

- moved module;
- abandoned module;
- replaced module;
- insecure module.

### 12.4 Deprecation Policy

For internal platform:

```text
Deprecation must include:
- replacement API;
- migration example;
- minimum support period;
- owner;
- removal target if any;
- compatibility tests.
```

---

## 13. Migration Strategy

Breaking changes should be staged.

### 13.1 Add New API First

Release v1.5.0:

```go
func NewEvaluator(...) *Evaluator
```

Keep old:

```go
// Deprecated: use NewEvaluator.
func Evaluate(...) (...)
```

### 13.2 Migrate Consumers

Update internal services gradually.

### 13.3 Add Compatibility Tests

Ensure old API still works.

### 13.4 Release v2

Only after migration window:

```go
module example.com/permission/v2
```

Remove deprecated API.

### 13.5 Provide Migration Guide

```markdown
# Migrating from v1 to v2

## Import path

Before:
import "example.com/permission"

After:
import "example.com/permission/v2"

## Evaluate

Before:
decision, err := permission.Evaluate(ctx, policy, c)

After:
evaluator := permission.NewEvaluator(policy)
decision, err := evaluator.Evaluate(ctx, c)
```

### 13.6 Compatibility Bridge

Sometimes v2 can offer adapters:

```go
package compat

func FromV1Policy(p v1.Policy) v2.Policy
```

Use carefully to ease migration.

---

## 14. Major Version Strategy

### 14.1 When to Create v2

Create v2 if:

- breaking API is necessary;
- old design blocks safety/performance/correctness;
- migration path exists;
- consumers can adopt gradually;
- maintenance plan for v1 is clear.

Do not create v2 just for cosmetic API cleanup.

### 14.2 v2 Directory Strategy

Common approaches:

#### Root branch for v2

Change module path:

```go
module example.com/permission/v2
```

in main branch.

#### Subdirectory `/v2`

```text
permission/
  go.mod        module example.com/permission
  v2/
    go.mod      module example.com/permission/v2
```

Useful for maintaining v1 and v2 in same repo.

#### Separate branch

Maintain v1 release branch, main for v2.

Choice depends on organization.

### 14.3 Maintaining Multiple Majors

If you support v1 and v2:

- security fixes may need backport;
- docs must separate versions;
- examples must clarify import path;
- CI must test both;
- deprecation policy must be explicit.

### 14.4 Major Version Checklist

- Is breaking change truly needed?
- Has v1 deprecation path been provided?
- Is module path `/v2` correct?
- Are docs/examples updated?
- Are old imports and new imports distinguishable?
- Can v1 and v2 coexist?
- Are release tags correct?
- Is internal proxy aware?
- Are consumers notified?
- Are backport rules defined?

---

## 15. Compatibility Testing

Do not rely on intuition.

### 15.1 Golden Consumer Tests

Create test fixtures representing old consumer code.

```text
testdata/compat/v1-consumer/
  go.mod
  main.go
```

CI runs:

```bash
cd testdata/compat/v1-consumer
go test ./...
```

This proves old usage still compiles.

### 15.2 API Surface Snapshot

Use tooling or generated docs to snapshot exported API.

Possible approaches:

- `go doc` output comparison;
- `go list -json` analysis;
- custom `go/packages` API extractor;
- third-party API diff tools if organization approves.

The concept:

```text
Exported API changes should be visible in PR.
```

### 15.3 Behavior Compatibility Tests

For documented behavior:

```go
func TestEvaluatePreservesErrPermissionDenied(t *testing.T) {
    _, err := Evaluate(ctx, denyPolicy, c)
    if !errors.Is(err, ErrPermissionDenied) {
        t.Fatalf("expected ErrPermissionDenied, got %v", err)
    }
}
```

### 15.4 Serialization Compatibility Tests

Use fixtures:

```text
testdata/case-v1.json
testdata/case-v2.json
```

Test both decode/encode compatibility.

### 15.5 Module Upgrade Tests

Create sample consumer:

```bash
go get example.com/permission@v1.4.0
go get example.com/permission@v1.5.0
go test ./...
```

### 15.6 Interface Implementation Tests

External implementer fixture:

```go
type fakeAuthorizer struct{}

func (fakeAuthorizer) Authorize(ctx context.Context, s Subject, a Action) (Decision, error) {
    return Decision{}, nil
}

var _ permission.Authorizer = fakeAuthorizer{}
```

If adding method breaks it, test catches.

---

## 16. Documentation as Compatibility Contract

Docs are part of API.

### 16.1 Document Behavior

```go
// Evaluate returns ErrPermissionDenied when the subject is not allowed.
// It is safe to call Evaluate concurrently.
// If ctx is canceled, Evaluate returns an error wrapping context.Canceled.
// The order of returned Reasons is stable by policy priority.
func (e *Evaluator) Evaluate(ctx context.Context, req Request) (Decision, error)
```

This sets expectations.

Do not document things you cannot maintain.

### 16.2 Document Non-Guarantees

```go
// The text of returned errors is not part of the API.
// Use errors.Is and errors.As for programmatic checks.
```

or:

```go
// The order of map iteration in the returned diagnostics is not specified.
```

### 16.3 Good API Docs Mention

- nil behavior;
- zero value behavior;
- concurrency safety;
- context cancellation;
- error semantics;
- ownership of input/output;
- mutation behavior;
- ordering guarantees;
- idempotency;
- performance expectation if relevant;
- deprecation/migration.

---

## 17. Wire Compatibility vs Go API Compatibility

Go package compatibility is not enough.

If package exposes HTTP/JSON/protobuf schemas, compatibility also includes external contract.

### 17.1 JSON

Breaking:

- rename field;
- remove field;
- change type;
- change required/optional;
- change nullability;
- change enum values if clients exhaustive;
- change timestamp format.

Compatible:

- add optional field;
- accept old and new field during migration;
- preserve old field as deprecated.

### 17.2 Protobuf

Protobuf has its own compatibility rules:

- never reuse field numbers;
- reserve removed fields;
- adding optional fields usually okay;
- changing type can break;
- changing package/go_package affects generated API.

### 17.3 OpenAPI

OpenAPI compatibility includes:

- path/method;
- request schema;
- response schema;
- status codes;
- auth requirements;
- pagination semantics;
- error response shape.

### 17.4 Internal DTOs

Even internal DTOs become contract if shared across packages/modules.

Be careful with generated DTO exported from public module.

---

## 18. Operational Compatibility

A change can compile and still break production.

Examples:

- default timeout reduced;
- cache key format changed;
- retry behavior added causing duplicate writes;
- metric label cardinality increased;
- log field renamed affecting alert queries;
- DB transaction isolation changed;
- clock/timezone behavior changed;
- goroutine lifecycle changed;
- memory usage increased;
- generated SQL changed query plan;
- permission evaluation stricter.

Compatibility review for production packages must include:

- runtime behavior;
- observability;
- performance;
- resource usage;
- failure modes;
- idempotency;
- security posture.

---

## 19. Internal Platform API Governance

Internal platform package:

```text
example.com/regulatory/permission
```

used by many services.

Governance should include:

1. API owner;
2. semantic versioning;
3. compatibility tests;
4. migration guides;
5. deprecation policy;
6. release notes;
7. consumer inventory;
8. security review;
9. performance baseline;
10. support window.

### 19.1 Consumer Inventory

Track:

```text
Service A uses permission v1.4.2
Service B uses permission v1.5.0
Service C uses permission v0.9.1
```

Why?

- security advisory;
- deprecation;
- v2 migration;
- incident blast radius.

### 19.2 Change Classes

| Change Class | Review Required |
|---|---|
| Patch bugfix | tests + release notes |
| New additive API | API review |
| Behavior change | design review + migration notes |
| Deprecation | replacement + timeline |
| Breaking change | v2 plan |
| Security fix | advisory + upgrade deadline |
| Performance-sensitive | benchmark evidence |
| Wire contract change | API governance review |

---

## 20. Case Study: Permission Engine v1 to v2

### 20.1 v1 API

```go
package permission

type Authorizer interface {
    Authorize(ctx context.Context, subject string, action string, resource string) (bool, error)
}

func NewAuthorizer(rules []Rule) Authorizer
```

Problems:

- subject/action/resource are raw strings;
- bool lacks reason;
- no explainability;
- hard to audit;
- adding `Explain` to interface would break implementers.

### 20.2 v1.5 Additive API

```go
type Subject struct { ID string }
type Action string
type Resource struct { Type string; ID string }

type Decision struct {
    Allowed bool
    Reasons []Reason
}

type Evaluator struct { ... }

func NewEvaluator(rules []Rule, opts ...Option) (*Evaluator, error)

func (e *Evaluator) Evaluate(ctx context.Context, req Request) (Decision, error)
```

Keep old:

```go
// Deprecated: use Evaluator.Evaluate.
func NewAuthorizer(rules []Rule) Authorizer {
    eval, _ := NewEvaluator(rules)
    return legacyAuthorizer{eval: eval}
}
```

### 20.3 v2 API

```go
module example.com/regulatory/permission/v2
```

Remove old raw-string authorizer.

Expose:

```go
type Evaluator struct{}
func NewEvaluator(source RuleSource, opts ...Option) (*Evaluator, error)
func (e *Evaluator) Evaluate(ctx context.Context, req Request) (Decision, error)
```

### 20.4 Migration Guide

Before:

```go
auth := permission.NewAuthorizer(rules)
ok, err := auth.Authorize(ctx, userID, "approve", caseID)
```

After:

```go
eval, err := permission.NewEvaluator(permission.StaticRules(rules))
if err != nil { return err }

decision, err := eval.Evaluate(ctx, permission.Request{
    Subject: permission.Subject{ID: userID},
    Action: permission.ActionApprove,
    Resource: permission.Resource{Type: "case", ID: caseID},
})
if err != nil { return err }
if !decision.Allowed { ... }
```

### 20.5 Compatibility Tests

- v1 old authorizer still works in v1.x.
- v1.5 new evaluator works.
- v2 migration sample compiles.
- errors preserve `ErrPermissionDenied`.
- decision reasons order stable.
- generated permission constants unchanged unless major.

---

## 21. API Review Checklist

Before merging exported API change:

### 21.1 Source Compatibility

- Does any exported identifier change?
- Any signature change?
- Any interface method added/removed?
- Any exported struct field changed?
- Any generic constraint changed?
- Any receiver type changed?
- Any package path changed?
- Any module path changed?

### 21.2 Behavior Compatibility

- Any default changed?
- Any nil behavior changed?
- Any error sentinel/type behavior changed?
- Any ordering guarantee changed?
- Any concurrency safety changed?
- Any idempotency changed?
- Any validation strictness changed?
- Any context cancellation behavior changed?

### 21.3 Data/Wire Compatibility

- Any JSON/protobuf/OpenAPI field changed?
- Any enum added/removed?
- Any timestamp format changed?
- Any error response changed?
- Any DB mapping changed?

### 21.4 Operational Compatibility

- Any performance impact?
- Any memory/goroutine impact?
- Any logging/metric label change?
- Any retry/cache behavior change?
- Any security behavior change?

### 21.5 Versioning

- Patch/minor/major?
- If major, is `/vN` path correct?
- If deprecated, is replacement documented?
- If v0, is breaking change still communicated?
- Are release notes updated?

### 21.6 Tests

- Existing consumer fixture?
- API diff?
- Behavior test?
- Serialization fixture?
- Integration test?
- Benchmark if needed?

---

## 22. Release Notes Template

```markdown
# Release v1.6.0

## Summary

Short description.

## Compatibility

This release is backward compatible with v1.5.x.

## Added

- Added `Evaluator.Explain`.
- Added `WithDecisionTrace`.

## Changed

- Improved policy evaluation cache.
- Error messages include policy ID. Programmatic error matching via `errors.Is` is unchanged.

## Deprecated

- `NewAuthorizer` is deprecated. Use `NewEvaluator`.

## Fixed

- Fixed incorrect deny reason ordering.

## Migration

Before:
...

After:
...

## Security

No security-impacting changes.

## Performance

Benchmark:
- Evaluate p50 unchanged
- allocation reduced by 15%

## Checks

- go test ./...
- govulncheck ./...
- compatibility fixture passed
```

---

## 23. Deprecation Timeline Template

```markdown
# Deprecation: NewAuthorizer

Deprecated in:
- v1.5.0

Replacement:
- NewEvaluator

Reason:
- New API supports typed request, explainability, and audit reasons.

Support:
- NewAuthorizer remains available for all v1.x releases.
- It will be removed in v2.

Migration:
- See docs/migration/v1-authorizer-to-evaluator.md

Owner:
- Platform Permission Team
```

---

## 24. Compatibility Matrix

Example internal platform:

| Module | Current | Stable? | Deprecated APIs | Next Major |
|---|---:|---:|---|---|
| permission | v1.6.0 | Yes | NewAuthorizer | v2 planned Q4 |
| workflow | v0.9.2 | No | none | v1 planned |
| auditlog | v1.3.1 | Yes | RecordText | no v2 |
| identity | v2.1.0 | Yes | v1 module deprecated | v3 not planned |

Use this in platform governance.

---

## 25. Tooling Ideas

### 25.1 API Diff Tool

Build internal tool using `go/packages`:

- load package;
- collect exported identifiers;
- collect function/method signatures;
- collect exported struct fields;
- collect interface methods;
- compare against baseline.

Baseline:

```text
api-snapshot/permission-v1.5.0.json
```

### 25.2 Consumer Compile Matrix

CI job:

```text
compat/
  consumer-v1-basic
  consumer-v1-interface-implementer
  consumer-v1-config-literal
  consumer-v1-error-matching
```

Run all against current module.

### 25.3 Deprecated API Linter

Detect use of deprecated APIs in internal services.

### 25.4 Import Path Scanner

Find consumers of old module:

```bash
grep -R '"example.com/permission"' .
grep -R '"example.com/permission/v2"' .
```

At enterprise scale, use code search.

---

## 26. Anti-Patterns

### 26.1 “It Compiles, So Compatible”

Wrong.

Behavior/wire/operational changes can break production.

### 26.2 Adding Method to Public Interface Casually

Breaks implementers.

Prefer new smaller interface.

### 26.3 Exporting Config Struct Too Early

Fields become forever API.

Use constructors/options if unsure.

### 26.4 v2 Without Migration Path

Creating v2 is easy. Migrating consumers is hard.

### 26.5 Deprecation Without Replacement

```go
// Deprecated.
```

is not enough.

### 26.6 Error String as Contract

If users need programmatic handling, expose sentinel/type/code.

### 26.7 Internal Means Can Break Anytime

Internal shared libraries still have consumers.

### 26.8 Giant Breaking Release

Do not combine:

- v2 API;
- dependency upgrade;
- Go toolchain upgrade;
- performance rewrite;
- generated schema change.

Separate changes for causality.

### 26.9 Hiding Breaking Change in Minor Version

If import path same and module stable, consumers expect compatibility.

### 26.10 Package Rename for Aesthetics

Import path change is breaking. Do not rename package path casually.

---

## 27. What Top Engineers Internalize

Top Go engineers understand:

1. Exported names are contracts.
2. Import path identity is part of compatibility.
3. Same import path must remain backward compatible.
4. v2+ requires `/vN` module path.
5. Adding methods to interfaces breaks implementers.
6. Struct fields are API if exported.
7. Error semantics must be designed, not accidental.
8. Behavior compatibility matters as much as source compatibility.
9. Deprecation must include migration.
10. `v0` reduces promise but not blast radius.
11. Functional options support additive evolution.
12. Generic constraints are API.
13. Generated code can expose stable contracts.
14. Internal libraries need real release governance.
15. Compatibility tests are better than opinion.
16. Major versions are migration programs, not just tags.
17. Good API design includes future evolution paths.
18. Documentation defines what consumers can rely on.
19. Removing public API is easy technically and expensive organizationally.
20. Compatibility engineering is how platform teams earn trust.

---

## 28. Exercises

### Exercise 1 — Is This Breaking?

Change:

```go
type Store interface {
    Save(ctx context.Context, c Case) error
}
```

to:

```go
type Store interface {
    Save(ctx context.Context, c Case) error
    Delete(ctx context.Context, id ID) error
}
```

Answer:

- breaking for implementers.

Compatible alternative:

```go
type Deleter interface {
    Delete(ctx context.Context, id ID) error
}
```

### Exercise 2 — Config Evolution

Existing:

```go
type Config struct {
    Timeout time.Duration
}
```

Need add retry policy.

Compatible:

```go
type Config struct {
    Timeout time.Duration
    RetryPolicy RetryPolicy
}
```

Potential issue:

- unkeyed literals.
- default semantics must be documented.

Alternative for public API:

```go
func NewClient(endpoint string, opts ...Option) (*Client, error)
func WithRetryPolicy(p RetryPolicy) Option
```

### Exercise 3 — v2 Path

Current:

```go
module example.com/workflow
```

Breaking v2 must be:

```go
module example.com/workflow/v2
```

Import:

```go
import "example.com/workflow/v2"
```

### Exercise 4 — Deprecation Comment

Write good deprecation:

```go
// Authorize checks whether subject can perform action.
//
// Deprecated: use Evaluator.Evaluate, which returns typed Decision with audit reasons.
// Authorize will remain available for v1.x and be removed in v2.
func Authorize(...)
```

### Exercise 5 — Error Compatibility

Existing consumers use:

```go
errors.Is(err, ErrPermissionDenied)
```

You wrap error with context.

Compatible:

```go
return fmt.Errorf("evaluate permission: %w", ErrPermissionDenied)
```

Breaking:

```go
return errors.New("evaluate permission: permission denied")
```

because `errors.Is` no longer works.

---

## 29. Summary

API compatibility engineering in Go is the discipline of evolving exported package/module behavior while preserving consumer trust.

Key lessons:

- Public API includes exported identifiers, signatures, struct fields, interfaces, errors, generics constraints, import paths, and documented behavior.
- Same import path must remain backward compatible.
- Stable modules use semantic versioning; breaking changes require a new major version.
- v2+ modules require `/v2`, `/v3`, etc. in the module path.
- Adding methods to exported interfaces is breaking.
- Config structs and exported fields are long-term commitments.
- Functional options help additive evolution.
- Error contracts should use `errors.Is`, `errors.As`, sentinel errors, types, or codes.
- Deprecation must include replacement and migration guidance.
- Compatibility tests should compile old consumer patterns and verify behavior.
- Wire/data/operational compatibility must be reviewed separately from Go source compatibility.
- Internal platform APIs deserve the same discipline as public libraries when many services depend on them.

Compatibility is not about never changing. It is about changing in ways that preserve trust, minimize blast radius, and provide clear migration paths.

---

## 30. References

Primary references:

- Go 1 and the Future of Go Programs — Go 1 compatibility promise.
- Go Modules Reference — semantic import versioning and major version suffixes.
- A Proposal for Package Versioning in Go — import compatibility rule and semantic import versioning rationale.
- Go Modules: v2 and Beyond — creating and maintaining v2+ modules.
- Module version numbering — semantic version meaning in Go modules.
- Developing and publishing modules — module release and backward compatibility guidance.
- Go Doc Comments — exported identifier documentation conventions.
- Go Wiki: Deprecated — `Deprecated:` doc comment convention.
- Go 1.17 Release Notes — module deprecation via `// Deprecated:` in `go.mod`.

---

## 31. Next Part

Part 030 adalah capstone akhir seri:

# Capstone Handbook: Designing a Production-Grade Go Platform Library End-to-End

Topik utama:

- memilih problem domain
- package/module boundary
- API compatibility design
- composition model
- interface strategy
- generic/reflection/codegen decision
- generated code governance
- config/options
- error contract
- testing matrix
- CI/release governance
- private module/supply-chain policy
- migration/deprecation strategy
- final review checklist

Status seri: **belum selesai**. Part ini adalah **029 dari 030**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-composition-oop-functional-reflection-codegen-modules-part-028.md">⬅️ Part 028 — Large-Scale Repo Architecture: Monorepo, Multi-Module, `/cmd`, `/internal`, `/pkg`, Dependency Direction, Ownership Boundary, dan Migration Strategy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-composition-oop-functional-reflection-codegen-modules-part-030.md">Part 030 — Capstone Handbook: Designing a Production-Grade Go Platform Library End-to-End ➡️</a>
</div>

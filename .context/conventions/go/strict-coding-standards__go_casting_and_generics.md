# Strict Coding Standards — Go Casting, Conversion, Type Assertion, and Generics

**File:** `strict-coding-standards__go_casting_and_generics.md`  
**Scope:** Explicit conversions, type assertions, type switches, named types, type aliases, generic functions, generic types, constraints, type sets, and abstraction boundaries in Go.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go code.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

A Go implementation MUST NOT use conversion, type assertion, `any`, reflection, or generics to hide an unclear type model.

Before changing type-related code, the agent MUST be able to answer:

1. What are the source and target types?
2. Is this a representation conversion, domain conversion, or interface dispatch?
3. Can the operation fail, truncate, overflow, lose precision, allocate, or panic?
4. Is the conversion preserving semantic meaning or merely making code compile?
5. Is a generic abstraction simpler than concrete code?
6. Which type invariants are preserved after the operation?

If these cannot be answered, the agent MUST keep code concrete, explicit, and validated.

---

## 1. Source Authority

This standard is derived from official Go references:

- Go Language Specification: https://go.dev/ref/spec
- Effective Go: https://go.dev/doc/effective_go
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Go Generics Tutorial: https://go.dev/doc/tutorial/generics
- An Introduction to Generics: https://go.dev/blog/intro-generics
- When To Use Generics: https://go.dev/blog/when-generics
- Generic Interfaces: https://go.dev/blog/generic-interfaces
- Go 1.18 Release Notes: https://go.dev/doc/go1.18
- Go 1.24 Release Notes: https://go.dev/doc/go1.24
- Go 1.26 Release Notes: https://go.dev/doc/go1.26
- `cmp` package: https://pkg.go.dev/cmp
- `slices` package: https://pkg.go.dev/slices
- `maps` package: https://pkg.go.dev/maps
- `strconv` package: https://pkg.go.dev/strconv
- `go vet`: https://pkg.go.dev/cmd/vet

---

## 2. Terminology Rules

The agent MUST use precise Go terminology.

| Term                  | Required meaning                                                          |
| --------------------- | ------------------------------------------------------------------------- |
| Conversion            | Explicit Go conversion expression, for example `T(x)`.                    |
| Type assertion        | Runtime assertion on interface value, for example `v.(T)`.                |
| Type switch           | Runtime dispatch over dynamic interface type.                             |
| Named type            | A distinct type with its own method set and semantic boundary.            |
| Type alias            | An alias declaration, not a new semantic type.                            |
| Underlying type       | The structural representation used for assignability/conversion rules.    |
| Constraint            | Interface used to restrict type parameters.                               |
| Type set              | Set of types permitted by a constraint.                                   |
| Approximation element | Constraint term such as `~string` meaning types with underlying `string`. |

The agent MUST NOT call Go conversions “casts” in code comments or design notes unless referring to an external system concept.

---

## 3. Conversion Rules

### 3.1 Conversion Must Have an Explicit Purpose

Every non-trivial conversion MUST be one of these:

1. **Representation conversion** — bytes to string, numeric width, DTO to wire type.
2. **Domain boundary conversion** — raw primitive to domain type after validation.
3. **Protocol conversion** — database, JSON, HTTP, CLI, message bus.
4. **Compatibility conversion** — two structurally identical local types with the same semantics.
5. **Performance-controlled conversion** — allocation or copy is intentional and justified.

Forbidden:

```go
age := Age(raw) // raw was not validated
```

Preferred:

```go
func NewAge(raw int) (Age, error) {
    if raw < 0 || raw > 130 {
        return 0, fmt.Errorf("age %d: %w", raw, ErrInvalidAge)
    }
    return Age(raw), nil
}
```

### 3.2 Do Not Convert to Bypass Type Safety

Named domain types exist to prevent accidental mixing.

Forbidden:

```go
func AssignOwner(caseID CaseID, userID UserID) error {
    return repo.Assign(UserID(caseID), userID) // semantic corruption
}
```

Preferred:

```go
func AssignOwner(caseID CaseID, userID UserID) error {
    if caseID == "" || userID == "" {
        return ErrInvalidIdentifier
    }
    return repo.Assign(caseID, userID)
}
```

### 3.3 Narrowing Numeric Conversion Requires Bounds Check

The agent MUST check range before converting to a smaller integer type or signedness-changing type.

Forbidden:

```go
limit := int32(request.Limit)
```

Preferred:

```go
func ToInt32(name string, v int64) (int32, error) {
    if v < math.MinInt32 || v > math.MaxInt32 {
        return 0, fmt.Errorf("%s=%d outside int32 range", name, v)
    }
    return int32(v), nil
}
```

### 3.4 Float Conversion Requires Precision Decision

The agent MUST NOT convert `int64`, money, count, ID, timestamp, or version values through `float64` unless the precision loss is explicitly acceptable.

Forbidden:

```go
amount := int64(jsonNumberFloat)
```

Preferred:

```go
amount, err := strconv.ParseInt(rawAmount, 10, 64)
if err != nil {
    return fmt.Errorf("amount %q: %w", rawAmount, err)
}
```

### 3.5 String, Byte, and Rune Conversion Must Respect Encoding

The agent MUST distinguish these operations:

| Operation       | Meaning                                          | Rule                                                   |
| --------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `[]byte(s)`     | Encode/copy string bytes into mutable byte slice | Allowed when mutation or I/O byte API is required.     |
| `string(b)`     | Copy bytes into immutable string                 | Validate UTF-8 if semantic text is required.           |
| `[]rune(s)`     | Decode Unicode code points                       | Use for rune-level processing, not grapheme counting.  |
| `string(runes)` | Encode runes as UTF-8                            | Validate replacement behavior if input may be invalid. |

Forbidden:

```go
if len(name) > 20 { // bytes, not user-perceived characters
    return ErrTooLong
}
```

Preferred:

```go
if utf8.RuneCountInString(name) > maxNameRunes {
    return ErrTooLong
}
```

If user-perceived characters/grapheme clusters matter, the agent MUST NOT pretend rune count is sufficient.

### 3.6 Struct Conversion Must Not Replace Mapping Across Semantic Boundaries

Go permits conversion between certain structurally identical struct types. The agent MAY use that only for internal representation compatibility where semantics are identical.

Forbidden across domain/API/persistence boundaries:

```go
dto := CaseDTO(domainCase)
```

Preferred:

```go
func ToCaseDTO(c Case) CaseDTO {
    return CaseDTO{
        ID:        string(c.ID),
        Status:    string(c.Status),
        UpdatedAt: c.UpdatedAt.UTC().Format(time.RFC3339Nano),
    }
}
```

### 3.7 Unsafe Conversion Is Forbidden by Default

The agent MUST NOT use `unsafe.String`, `unsafe.Slice`, `unsafe.Pointer`, or reflect/unsafe conversion unless all are true:

1. There is a measured bottleneck.
2. A safe version exists and is tested.
3. Aliasing and lifetime are documented.
4. The code is isolated in a small internal package.
5. Fuzz/race tests cover boundary cases.
6. Security-sensitive buffers are not exposed.

---

## 4. Type Assertion and Type Switch Rules

### 4.1 Never Use Panic-Based Type Assertion in Request Paths

Forbidden:

```go
user := ctx.Value(userKey{}).(User)
```

Preferred:

```go
user, ok := ctx.Value(userKey{}).(User)
if !ok {
    return User{}, ErrUserMissing
}
```

Single-value assertions are allowed only when all possible dynamic types are proven locally, such as inside a controlled test helper.

### 4.2 Type Switch Must Have a Default Case

Forbidden:

```go
switch v := event.Payload.(type) {
case CaseOpened:
    handleOpened(v)
case CaseClosed:
    handleClosed(v)
}
```

Preferred:

```go
switch v := event.Payload.(type) {
case CaseOpened:
    return handleOpened(v)
case CaseClosed:
    return handleClosed(v)
default:
    return fmt.Errorf("unsupported event payload %T", v)
}
```

### 4.3 Prefer Interface Behavior Over Type Switch

If behavior is stable, use an interface.

Forbidden:

```go
switch r := rule.(type) {
case AgeRule:
    return r.Check(age)
case LicenceRule:
    return r.Check(licence)
}
```

Preferred:

```go
type Rule interface {
    Check(ctx context.Context, input Input) error
}
```

Type switches are acceptable at serialization, adapter, plugin, or compatibility boundaries.

### 4.4 Avoid `any` as a Domain Type

The agent MUST NOT introduce `any` into domain/application code unless the value is genuinely opaque and only passed through.

Forbidden:

```go
type Command struct {
    Name string
    Data any
}
```

Preferred:

```go
type OpenCaseCommand struct {
    CaseID CaseID
    Reason string
}
```

---

## 5. Named Type and Alias Rules

### 5.1 Use Named Types for Domain Identity and Invariants

Preferred:

```go
type CaseID string
type UserID string
type EscalationLevel int
```

The agent MUST NOT replace meaningful named types with primitives merely to reduce conversions.

### 5.2 Type Alias Is for Compatibility, Not Modelling

Allowed:

```go
// Deprecated: use audit.EventID.
type EventID = audit.EventID
```

Forbidden:

```go
type CaseID = string // removes boundary and method ownership
```

### 5.3 Constructor Must Own Validation

For named domain types with invariants, the agent MUST provide constructor/parse functions.

```go
func ParseCaseID(raw string) (CaseID, error) {
    raw = strings.TrimSpace(raw)
    if raw == "" {
        return "", ErrInvalidCaseID
    }
    return CaseID(raw), nil
}
```

---

## 6. Generic Design Rules

### 6.1 Start Concrete, Generalize Only After Evidence

The agent MUST NOT start by designing generic abstractions for business code.

Allowed use cases for generics:

1. type-safe containers;
2. reusable algorithms over slices/maps/sets;
3. numeric or ordered helper algorithms with clear constraints;
4. compile-time-safe test helpers;
5. adapters where the type parameter removes duplication without hiding behavior.

Forbidden:

```go
type Service[T any] struct {
    repo Repository[T]
}
```

Preferred for domain services:

```go
type CaseService struct {
    cases CaseStore
    clock Clock
}
```

### 6.2 Generic Code Must Reduce Complexity

Before adding type parameters, the agent MUST verify that at least one is true:

- The same algorithm is duplicated for multiple types.
- Static type safety would otherwise require `any` and assertions.
- The abstraction is a real container/algorithm boundary.
- The caller benefits from compile-time type inference.

If not, use concrete code.

### 6.3 Constraints Must Be Minimal

Forbidden:

```go
type ID interface {
    ~string | ~int | ~int64
}
```

Preferred:

```go
func DedupComparable[T comparable](items []T) []T {
    seen := make(map[T]struct{}, len(items))
    out := make([]T, 0, len(items))
    for _, item := range items {
        if _, ok := seen[item]; ok {
            continue
        }
        seen[item] = struct{}{}
        out = append(out, item)
    }
    return out
}
```

A broad union constraint MUST be justified by operations actually used by the implementation.

### 6.4 Do Not Over-Constrain Generic Interfaces

A generic constraint MUST NOT require `comparable`, `cmp.Ordered`, or methods that the implementation does not need.

Forbidden:

```go
type Entity interface {
    comparable
    ID() string
    Validate() error
    Clone() Entity
}
```

Preferred:

```go
type HasID interface {
    ID() string
}
```

### 6.5 `any` Is Acceptable Only When Truly Type-Independent

Allowed:

```go
func Reverse[T any](items []T) {
    for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
        items[i], items[j] = items[j], items[i]
    }
}
```

Forbidden:

```go
func Save[T any](ctx context.Context, value T) error {
    v := reflect.ValueOf(value) // generic API hiding reflection
    // ...
}
```

### 6.6 Use `comparable` Only for Equality or Map Keys

The agent MUST use `comparable` only when the implementation uses `==`, `!=`, or map keys.

Allowed:

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

If equality has domain semantics, use an explicit comparator.

```go
func ContainsFunc[T any](items []T, match func(T) bool) bool {
    for _, item := range items {
        if match(item) {
            return true
        }
    }
    return false
}
```

### 6.7 Use `cmp.Ordered` Only for Natural Ordering

The agent MUST NOT use `cmp.Ordered` when ordering is domain-specific.

Forbidden:

```go
slices.Sort(caseIDs) // only OK if lexical case ID order is explicitly required
```

Preferred:

```go
slices.SortFunc(cases, func(a, b Case) int {
    if c := a.Deadline.Compare(b.Deadline); c != 0 {
        return c
    }
    return strings.Compare(string(a.ID), string(b.ID))
})
```

### 6.8 `~T` Must Preserve Semantics

Use approximation constraints only when the implementation is valid for every type with that underlying representation.

Allowed:

```go
type StringID interface {
    ~string
}

func IsBlankID[T StringID](id T) bool {
    return strings.TrimSpace(string(id)) == ""
}
```

Forbidden:

```go
type NumericID interface {
    ~int | ~int64
}

func NextID[T NumericID](id T) T { return id + 1 } // sequence semantics may not hold
```

### 6.9 Do Not Use Generics to Simulate Inheritance

Forbidden:

```go
type BaseService[T any] struct {
    Repo Repository[T]
}
```

Preferred:

```go
type CaseStore interface {
    FindByID(ctx context.Context, id CaseID) (Case, error)
}

type CaseService struct {
    store CaseStore
}
```

### 6.10 Generic Methods Are Not a Substitute for API Design

Go methods may use the receiver type's type parameters, but methods cannot introduce arbitrary extra type parameters like Java/C# generic methods. The agent MUST design generic behavior as either:

- a generic function;
- a method on a generic type using the receiver's type parameters;
- a concrete method with an explicit interface dependency.

Preferred:

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Has(v T) bool {
    _, ok := s[v]
    return ok
}
```

### 6.11 Self-Referential Constraints Require Go 1.26+ and Justification

If the repository baseline is Go 1.26+, the agent MAY use self-referential generic constraints only for algebraic or comparable behavior where the relationship is clearer than interface-based design.

Allowed only with justification:

```go
type Addable[T any] interface {
    Add(T) T
}

func Sum[T Addable[T]](items []T) T {
    var zero T
    out := zero
    for _, item := range items {
        out = out.Add(item)
    }
    return out
}
```

The agent MUST NOT use self-referential constraints in ordinary CRUD/service/business orchestration code.

---

## 7. Generic API Boundary Rules

### 7.1 Exported Generic APIs Need Clear Documentation

Every exported generic function or type MUST document:

- type parameter meaning;
- constraint reason;
- zero-value behavior;
- nil behavior, if `T` can be pointer/slice/map/interface;
- ordering/equality semantics;
- concurrency safety.

Preferred:

```go
// Set stores unique values of type T.
// T must be comparable because values are stored as map keys.
// The zero Set is nil and readable, but Add requires initialization via NewSet.
type Set[T comparable] map[T]struct{}
```

### 7.2 Avoid Generic Repository/DAO Abstractions

Forbidden:

```go
type Repository[T any, ID comparable] interface {
    Find(ctx context.Context, id ID) (T, error)
    Save(ctx context.Context, entity T) error
}
```

Preferred:

```go
type CaseStore interface {
    FindByID(ctx context.Context, id CaseID) (Case, error)
    Save(ctx context.Context, c Case) error
}
```

Reason: generic repositories often hide query semantics, transaction requirements, consistency guarantees, locking, authorization, and domain invariants.

### 7.3 Do Not Export Constraints Prematurely

If a constraint is used by one package only, keep it unexported.

```go
type orderedID interface {
    ~string
}
```

Export constraints only when they are part of a deliberate public API.

---

## 8. Error and Nil Rules in Generic Code

### 8.1 Zero Value Must Be Explicit

Generic functions returning `T` on error MUST return the zero value intentionally.

```go
func First[T any](items []T) (T, error) {
    var zero T
    if len(items) == 0 {
        return zero, ErrEmpty
    }
    return items[0], nil
}
```

### 8.2 Nil Handling Must Not Assume Pointer-Like T

Forbidden:

```go
func IsNil[T any](v T) bool {
    return v == nil // invalid for unconstrained T
}
```

Preferred: avoid generic nil checks, or use explicit interfaces/types at call sites.

### 8.3 Generic Code Must Not Return Typed Nil as Interface

Forbidden:

```go
func BuildError[T error](v T) error {
    return v // may hide typed nil traps
}
```

Preferred: return concrete errors or guard nil explicitly in non-generic code.

---

## 9. Performance Rules

### 9.1 Generics Are Not a Free Optimization

The agent MUST NOT claim generic code is faster unless benchmarked.

Required benchmark cases:

- small input;
- large input;
- zero value;
- pointer element type;
- value element type;
- named domain type;
- hot path representative data.

### 9.2 Avoid Generic Abstractions That Force Allocation

Forbidden:

```go
func MapAny[T any](items []T, f func(T) any) []any {
    out := make([]any, 0, len(items))
    for _, item := range items {
        out = append(out, f(item))
    }
    return out
}
```

Preferred:

```go
func Map[T, U any](items []T, f func(T) U) []U {
    out := make([]U, 0, len(items))
    for _, item := range items {
        out = append(out, f(item))
    }
    return out
}
```

### 9.3 Avoid Reflection Inside Generic Code

Generic code that immediately uses reflection is usually a bad abstraction.

Allowed only for framework/boundary packages with clear documentation and tests.

---

## 10. Testing Rules

Generic code MUST be tested with more than one type.

Required examples:

```go
type CaseID string
type UserID string

t.Run("string", func(t *testing.T) { /* ... */ })
t.Run("named string", func(t *testing.T) { /* ... */ })
t.Run("int", func(t *testing.T) { /* ... */ })
t.Run("pointer element", func(t *testing.T) { /* ... */ })
```

The agent MUST include tests for:

1. empty input;
2. nil slice/map when applicable;
3. duplicate values;
4. named types;
5. pointer element types;
6. comparator/equality edge cases;
7. compile-time interface satisfaction where relevant;
8. race behavior if generic type is concurrent;
9. benchmark for hot path;
10. fuzz tests for conversion/parsing helpers.

---

## 11. LLM Anti-Patterns

The agent MUST NOT introduce:

- `any` as a shortcut for unclear modelling;
- generic `Repository[T]` for domain persistence;
- generic `Service[T]` for business orchestration;
- broad union constraints unrelated to actual operations;
- type assertions without `ok` in production paths;
- unchecked numeric narrowing;
- `string([]byte)` in hot loops without allocation review;
- conversion between domain types with different semantics;
- reflection inside generic helpers without a decision record;
- exported constraints that are used only once;
- Java/C# inheritance simulation using type parameters.

---

## 12. Review Checklist

A Go change involving conversion, assertion, or generics is mergeable only if:

- [ ] All conversions have semantic justification.
- [ ] Numeric narrowing checks bounds.
- [ ] Float conversions do not corrupt money/count/version/time values.
- [ ] Text conversions respect byte/rune/Unicode semantics.
- [ ] Type assertions use the comma-ok form unless locally proven safe.
- [ ] Type switches include default handling.
- [ ] Named types preserve domain boundaries.
- [ ] Type aliases are used only for compatibility/migration.
- [ ] Generic constraints are minimal.
- [ ] `comparable` is used only for equality/map-key requirements.
- [ ] `cmp.Ordered` is used only when natural ordering is correct.
- [ ] Generic APIs document zero/nil/order/concurrency behavior.
- [ ] Generic code is tested with at least two materially different types.
- [ ] No generic repository/service abstraction hides domain semantics.
- [ ] No reflection/unsafe is hidden behind a generic API without justification.

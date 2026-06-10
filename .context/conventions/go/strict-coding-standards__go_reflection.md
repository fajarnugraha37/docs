# Strict Coding Standards — Go Reflection

**File:** `strict-coding-standards__go_reflection.md`  
**Scope:** `reflect`, dynamic type inspection, struct tags, generic boundary tooling, runtime mapping, validation frameworks, dynamic invocation, `DeepEqual`, and reflection performance/safety.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go code.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

Reflection is forbidden in domain/application logic by default.

An LLM coding agent MAY use reflection only when all are true:

1. Static typing, interfaces, and generics are insufficient or materially worse.
2. The reflection is isolated in a boundary/framework/internal helper package.
3. The input type space is constrained and validated.
4. Panic conditions are guarded.
5. Performance and allocation cost are acceptable or benchmarked.
6. Tests cover nils, pointers, unexported fields, tags, embedding, and invalid input.
7. Security-sensitive exposure is reviewed.

If these cannot be satisfied, the agent MUST use explicit typed code.

---

## 1. Source Authority

This standard is derived from official Go references:

- Go Language Specification: https://go.dev/ref/spec
- Effective Go: https://go.dev/doc/effective_go
- The Laws of Reflection: https://go.dev/blog/laws-of-reflection
- `reflect` package: https://pkg.go.dev/reflect
- `encoding/json` package: https://pkg.go.dev/encoding/json
- `encoding` package: https://pkg.go.dev/encoding
- Go Doc Comments: https://go.dev/doc/comment
- `go vet`: https://pkg.go.dev/cmd/vet
- Go Fuzzing: https://go.dev/doc/security/fuzz
- Go Diagnostics: https://go.dev/doc/diagnostics
- Go Memory Model: https://go.dev/ref/mem

---

## 2. Reflection Decision Record

Every non-trivial reflection implementation MUST include a short decision comment.

```go
// bindStruct maps validated HTTP form values into a command DTO.
// Reflection is isolated here because handlers share form binding behavior.
// It accepts only pointers to structs, ignores unexported fields, validates tags,
// and returns errors instead of panicking on unsupported fields.
func bindStruct(dst any, values url.Values) error {
    // ...
}
```

The comment MUST state:

- why reflection is needed;
- accepted input shapes;
- unsupported input behavior;
- whether unexported fields are ignored;
- performance expectation;
- panic avoidance strategy.

---

## 3. Allowed Reflection Use Cases

Reflection is allowed for:

1. serialization/deserialization boundary helpers;
2. struct tag processing;
3. validation libraries;
4. dependency wiring/bootstrap with explicit type registry;
5. test helper assertions where `cmp`, `slices`, or explicit comparison are insufficient;
6. code generation support tools;
7. metrics/logging adapters with whitelist fields;
8. schema generation;
9. migration tooling;
10. framework-like internal packages with stable ownership.

Reflection is not allowed for:

- domain state transitions;
- authorization policy decisions;
- workflow routing when typed commands/events are available;
- repository query semantics;
- avoiding interface design;
- avoiding explicit DTO mapping;
- hot loops without benchmark evidence;
- untrusted method invocation.

---

## 4. Prefer Static Alternatives

### 4.1 Prefer Explicit Mapping

Forbidden:

```go
func ToDTO(v any) any {
    return copyFieldsByName(v)
}
```

Preferred:

```go
func ToCaseDTO(c Case) CaseDTO {
    return CaseDTO{
        ID:        string(c.ID()),
        Status:    string(c.Status()),
        UpdatedAt: c.UpdatedAt().UTC().Format(time.RFC3339Nano),
    }
}
```

### 4.2 Prefer Interfaces for Behavior

Forbidden:

```go
method := reflect.ValueOf(handler).MethodByName("Handle")
method.Call([]reflect.Value{reflect.ValueOf(ctx), reflect.ValueOf(cmd)})
```

Preferred:

```go
type Handler[C any] interface {
    Handle(context.Context, C) error
}
```

### 4.3 Prefer Generics for Type-Independent Algorithms

Forbidden:

```go
func Reverse(slice any) {
    v := reflect.ValueOf(slice)
    // ...
}
```

Preferred:

```go
func Reverse[T any](items []T) {
    for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
        items[i], items[j] = items[j], items[i]
    }
}
```

### 4.4 Prefer Code Generation for Stable Schemas

If many structs require repetitive mapping/validation and schema is stable, the agent SHOULD consider code generation instead of runtime reflection.

---

## 5. `reflect.Value` Safety Rules

### 5.1 Check Validity Before Use

Forbidden:

```go
field := reflect.ValueOf(v).FieldByName("ID")
return field.String()
```

Preferred:

```go
rv := reflect.ValueOf(v)
if !rv.IsValid() {
    return errors.New("invalid value")
}
if rv.Kind() == reflect.Pointer {
    if rv.IsNil() {
        return errors.New("nil pointer")
    }
    rv = rv.Elem()
}
if rv.Kind() != reflect.Struct {
    return fmt.Errorf("expected struct, got %s", rv.Kind())
}
field := rv.FieldByName("ID")
if !field.IsValid() {
    return errors.New("missing ID field")
}
```

### 5.2 Guard `IsNil`

`IsNil` may be called only for these kinds:

- `Chan`
- `Func`
- `Interface`
- `Map`
- `Pointer`
- `Slice`

Forbidden:

```go
if v.IsNil() { // panics for int, struct, string, etc.
    return nil
}
```

Preferred:

```go
func isNilable(k reflect.Kind) bool {
    switch k {
    case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
        return true
    default:
        return false
    }
}

if isNilable(v.Kind()) && v.IsNil() {
    return nil
}
```

### 5.3 Guard `Elem`

`Elem` MUST be called only after checking kind and nil.

```go
if rv.Kind() != reflect.Pointer {
    return fmt.Errorf("expected pointer, got %s", rv.Kind())
}
if rv.IsNil() {
    return errors.New("nil pointer")
}
rv = rv.Elem()
```

### 5.4 Guard `Set`

Before setting a value, the agent MUST check:

- target is addressable;
- target is settable;
- source is assignable or safely convertible;
- conversion does not overflow;
- unexported fields are not modified.

Forbidden:

```go
field.Set(reflect.ValueOf(raw))
```

Preferred:

```go
if !field.CanSet() {
    return fmt.Errorf("field %s is not settable", sf.Name)
}

src := reflect.ValueOf(raw)
if src.Type().AssignableTo(field.Type()) {
    field.Set(src)
    return nil
}
if src.Type().ConvertibleTo(field.Type()) {
    converted := src.Convert(field.Type())
    field.Set(converted)
    return nil
}
return fmt.Errorf("cannot assign %s to %s", src.Type(), field.Type())
```

### 5.5 Guard Numeric Overflow

When setting numeric fields from dynamic input, use overflow checks.

```go
func setInt(field reflect.Value, n int64) error {
    if field.Kind() < reflect.Int || field.Kind() > reflect.Int64 {
        return fmt.Errorf("field kind %s is not signed int", field.Kind())
    }
    if field.OverflowInt(n) {
        return fmt.Errorf("%d overflows %s", n, field.Type())
    }
    field.SetInt(n)
    return nil
}
```

Equivalent checks are required for unsigned, float, and complex values.

---

## 6. Type Inspection Rules

### 6.1 Work With `Type` Before `Value` When Possible

For metadata extraction, prefer `reflect.Type` to avoid unnecessary value handling.

```go
func fieldsOf(t reflect.Type) ([]fieldMeta, error) {
    if t.Kind() == reflect.Pointer {
        t = t.Elem()
    }
    if t.Kind() != reflect.Struct {
        return nil, fmt.Errorf("expected struct, got %s", t.Kind())
    }
    // ...
}
```

### 6.2 Pointer Normalization Must Be Explicit

The agent MUST decide whether the API accepts:

- struct value only;
- pointer to struct only;
- either value or pointer;
- nested pointers.

Do not silently dereference arbitrary pointer chains unless documented.

### 6.3 Embedded Fields Must Be Handled Deliberately

Reflection over structs with embedded fields MUST define behavior for:

- promoted fields;
- field name collisions;
- anonymous fields;
- unexported embedded fields;
- tag precedence.

If ambiguous, return an error instead of guessing.

### 6.4 Unexported Fields Must Not Be Exposed

Forbidden:

```go
value := field.Interface() // may panic or expose private data
```

Preferred:

```go
if !field.CanInterface() {
    continue // or return explicit error based on API contract
}
value := field.Interface()
```

---

## 7. Struct Tag Rules

### 7.1 Struct Tags Are Boundary Metadata Only

Struct tags MAY describe:

- JSON fields;
- DB columns;
- validation rules;
- form binding;
- metrics/log fields;
- schema hints.

Struct tags MUST NOT encode business workflow or authorization policy.

Forbidden:

```go
type Case struct {
    Status CaseStatus `transition:"draft->submitted->approved"`
}
```

Preferred:

```go
func (c *Case) Submit(now time.Time) error {
    // explicit transition logic
}
```

### 7.2 Tags Must Be Parsed Strictly

The agent MUST reject malformed or unsupported tags in framework code.

```go
tag := sf.Tag.Get("form")
name, opts, err := parseFormTag(tag)
if err != nil {
    return fmt.Errorf("field %s form tag: %w", sf.Name, err)
}
```

### 7.3 Run Vet Struct Tag Checks

Changes introducing struct tags MUST pass:

```bash
go vet ./...
```

The `structtag` vet analyzer catches malformed struct tags.

### 7.4 Tags Must Not Hide Required Mapping Semantics

Forbidden:

```go
type Case struct {
    ID string `json:"case_id" db:"CASE_ID" validate:"required" audit:"subject"`
}
```

Preferred: split DTOs by boundary when metadata diverges.

```go
type CaseJSON struct {
    ID string `json:"case_id"`
}

type caseRow struct {
    ID string `db:"CASE_ID"`
}
```

---

## 8. `DeepEqual` and Equality Rules

### 8.1 Do Not Use `reflect.DeepEqual` Blindly

`reflect.DeepEqual` has semantics that often do not match domain equality.

Problem cases:

- nil slice vs empty slice;
- nil map vs empty map;
- unexported fields;
- function values;
- cyclic values;
- map iteration/order expectations;
- `time.Time` monotonic clock data;
- floating-point NaN;
- domain-specific equality.

Forbidden:

```go
if !reflect.DeepEqual(got, want) {
    t.Fatalf("got %+v want %+v", got, want)
}
```

Preferred for simple slices/maps:

```go
if !slices.Equal(gotIDs, wantIDs) {
    t.Fatalf("ids got %v want %v", gotIDs, wantIDs)
}
```

Preferred for domain equality:

```go
func (c Case) Equal(other Case) bool {
    return c.id == other.id && c.status == other.status
}
```

### 8.2 Equality Must Match Business Semantics

The agent MUST NOT use structural equality when domain equality is based on identity, version, normalized text, rounded time, or case-insensitive values.

---

## 9. Dynamic Method Invocation Rules

### 9.1 Untrusted Method Names Are Forbidden

Forbidden:

```go
method := reflect.ValueOf(target).MethodByName(req.Method)
method.Call(args)
```

Preferred:

```go
var handlers = map[string]Handler{
    "submit": submitHandler,
    "close":  closeHandler,
}
```

If dynamic invocation is unavoidable, method names MUST be whitelisted and argument types validated.

### 9.2 Reflect Calls Must Recover Only at Framework Boundary

Reflection panics caused by bad framework input should be converted to errors at the boundary.

Recover MUST NOT be used to mask programmer errors in domain code.

---

## 10. Map and Slice Reflection Rules

### 10.1 Map Iteration Order Is Not Deterministic

When reflection iterates map keys and output order matters, the agent MUST sort keys explicitly.

```go
keys := rv.MapKeys()
slices.SortFunc(keys, func(a, b reflect.Value) int {
    return strings.Compare(fmt.Sprint(a.Interface()), fmt.Sprint(b.Interface()))
})
```

Prefer typed map extraction before sorting when possible.

### 10.2 Slice Mutation Must Respect Addressability

Reflection cannot set elements of non-settable slices unless the element values are addressable/settable through the provided value.

The agent MUST test mutations through:

- nil slice;
- empty slice;
- non-empty slice;
- pointer to slice;
- slice of pointers;
- slice of structs.

---

## 11. Performance Rules

### 11.1 Reflection in Hot Paths Requires Benchmark

Reflection in any request path, stream processor, DB row loop, JSON hot path, or metric emitter MUST include a benchmark or clear exemption.

Required benchmark:

```bash
go test -bench=. -benchmem ./...
```

The benchmark MUST compare reflection with at least one explicit/static alternative when feasible.

### 11.2 Cache Metadata, Not Mutable Values

Allowed:

```go
typeCache sync.Map // map[reflect.Type]*typeMeta
```

Metadata cache MUST be immutable after construction or protected by synchronization.

Forbidden:

```go
var globalValueCache = map[string]reflect.Value{}
```

### 11.3 Do Not Store `reflect.Value` Longer Than Necessary

Prefer storing `reflect.Type`, field index paths, parsed tags, and setter functions. Avoid long-lived `reflect.Value` unless lifetime is proven safe.

### 11.4 Avoid Per-Item Reflection in Large Loops

Forbidden:

```go
for _, row := range rows {
    bindByReflection(&dst, row)
}
```

Preferred:

- prepare metadata once;
- generate mapper code;
- use explicit scan functions;
- cache field indexes and converters.

---

## 12. Security Rules

### 12.1 Do Not Expose Private or Sensitive Fields

Reflection-based logging, auditing, metrics, or JSON-like dumping MUST whitelist fields.

Forbidden:

```go
log.Any("request", dumpAllFields(req))
```

Preferred:

```go
log.String("case_id", string(req.CaseID))
log.String("actor", string(req.ActorID))
```

### 12.2 Reflection Must Not Bypass Authorization

Forbidden:

```go
if hasField(user, action.RequiredField) {
    allow()
}
```

Preferred:

```go
if err := policy.CanApprove(ctx, actor, c); err != nil {
    return err
}
```

### 12.3 No Reflect/Unsafe Access to Unexported Fields

The agent MUST NOT use `unsafe` to read or write unexported fields. This breaks package invariants and may expose secrets.

### 12.4 Dynamic Plugin/Command Registries Must Be Explicit

Forbidden:

```go
handler := findTypeByName(commandName)
```

Preferred:

```go
registry.Register("submit_case", SubmitCaseHandler{})
```

---

## 13. Error Handling Rules

Reflection helpers MUST return structured errors with:

- operation;
- expected kind/type;
- actual kind/type;
- field name/path when applicable;
- tag name when applicable;
- cause.

Preferred:

```go
return fmt.Errorf("bind field %s: expected %s, got %s", fieldPath, dstType, srcType)
```

The agent MUST NOT allow raw reflection panics to escape request paths.

---

## 14. Testing Rules

Reflection code MUST include tests for:

1. nil input;
2. non-pointer input;
3. pointer to non-struct;
4. nil pointer;
5. struct value if accepted;
6. pointer to struct if accepted;
7. unexported fields;
8. embedded fields;
9. duplicate/promoted field conflicts;
10. malformed tags;
11. unsupported kinds;
12. numeric overflow;
13. string/byte/rune conversion;
14. nil slice/map/interface;
15. map order determinism;
16. sensitive field redaction;
17. concurrency safety of metadata caches;
18. fuzz input for parsers/binders.

### 14.1 Fuzz Tag Parsers and Dynamic Binders

Any custom tag parser or dynamic binder SHOULD have fuzz tests.

```go
func FuzzParseTag(f *testing.F) {
    f.Add("name,omitempty")
    f.Add("-")
    f.Fuzz(func(t *testing.T, raw string) {
        _, _, _ = parseTag(raw)
    })
}
```

### 14.2 Race Test Metadata Caches

```bash
go test -race ./...
```

Any global reflection metadata cache MUST be race-safe.

---

## 15. LLM Anti-Patterns

The agent MUST NOT introduce:

- reflection to avoid writing a small explicit mapper;
- reflection in domain state transitions;
- reflection for authorization/policy checks;
- `MethodByName` using user-controlled input;
- `FieldByName` without checking validity;
- `IsNil` without checking kind;
- `Elem` without checking pointer/interface and nil;
- `Set` without `CanSet`, assignability, and conversion checks;
- `reflect.DeepEqual` for domain equality without justification;
- map reflection output that assumes stable order;
- struct tags that encode business workflow;
- reflect/unsafe access to unexported fields;
- reflection hidden behind generic APIs;
- uncached reflection in high-volume loops;
- panic/recover as normal control flow.

---

## 16. Review Checklist

A Go reflection change is mergeable only if:

- [ ] Reflection is isolated outside domain/application core.
- [ ] A decision comment explains why reflection is needed.
- [ ] Accepted input shapes are documented.
- [ ] Invalid input returns errors, not request-path panics.
- [ ] `IsValid`, `Kind`, `IsNil`, `Elem`, `CanSet`, and `CanInterface` are guarded correctly.
- [ ] Numeric conversions check overflow.
- [ ] Unexported fields are not exposed or modified.
- [ ] Struct tags are parsed strictly and pass `go vet`.
- [ ] Dynamic method invocation is avoided or whitelisted.
- [ ] Map order is deterministic if output order matters.
- [ ] Reflection metadata is cached for hot paths.
- [ ] Benchmarks exist for request-path/high-volume reflection.
- [ ] Tests cover nil, pointer, embedded, unexported, malformed tag, and unsupported kind cases.
- [ ] Security-sensitive fields are redacted by whitelist.
- [ ] `go test -race ./...` passes if caches/concurrency are involved.

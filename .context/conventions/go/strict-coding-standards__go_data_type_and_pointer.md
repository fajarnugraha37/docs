# Strict Coding Standards — Go Data Types and Pointers

> Mandatory engineering conventions for LLM-assisted implementation, code generation, refactoring, and review of Go code involving data types, pointer semantics, memory ownership, aliasing, value semantics, and API data modelling.

---

## 0. Scope

This document defines strict coding standards for how Go code MUST model data, choose concrete types, use pointers, expose interfaces, manage slices/maps/structs, and reason about ownership and mutation.

The intended readers are:

1. human engineers reviewing Go code, and
2. LLM/code agents that generate, modify, test, and review Go implementation work.

This is not a beginner tutorial. It is an implementation contract and merge gate.

This document applies to:

- backend services;
- CLIs;
- workers;
- libraries;
- SDKs;
- API clients;
- persistence layers;
- event/message models;
- generated-code wrappers;
- test fakes and fixtures.

---

## 1. Source Baseline

Use this document together with these canonical references:

- Go language specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- Go Test Comments: <https://go.dev/wiki/TestComments>
- Go Doc Comments: <https://go.dev/doc/comment>
- Go Memory Model: <https://go.dev/ref/mem>
- A Guide to the Go Garbage Collector: <https://go.dev/doc/gc-guide>
- Go Slices: usage and internals: <https://go.dev/blog/slices-intro>
- Arrays, slices, and strings — mechanics of append: <https://go.dev/blog/slices>
- Robust generic functions on slices: <https://go.dev/blog/generic-slice-functions>
- Go maps in action: <https://go.dev/blog/maps>
- Strings, bytes, runes and characters in Go: <https://go.dev/blog/strings>
- Package names: <https://go.dev/blog/package-names>
- Frequently Asked Questions: <https://go.dev/doc/faq>
- `errors` package: <https://pkg.go.dev/errors>
- `unsafe` package: <https://pkg.go.dev/unsafe>
- `slices` package: <https://pkg.go.dev/slices>
- `maps` package: <https://pkg.go.dev/maps>
- Google Go Style Guide: <https://google.github.io/styleguide/go/>
- Uber Go Style Guide: <https://github.com/uber-go/guide/blob/master/style.md>

If this document conflicts with the Go language specification or official package documentation, the official Go documentation wins.

---

## 2. Normative Language

The following words are binding:

- **MUST**: required. Code violating it must not be merged.
- **MUST NOT**: forbidden unless an explicit exception is documented in code review.
- **SHOULD**: required by default; deviation requires reason.
- **MAY**: allowed, but not required.
- **LLM MUST**: a rule specifically targeting agent behavior.

---

## 3. Prime Directive for LLMs

LLM-generated Go code MUST treat data modelling as a correctness problem, not a cosmetic style problem.

LLM MUST NOT:

- choose pointers simply because another language would pass objects by reference;
- use `any`, `map[string]any`, `interface{}`, reflection, or `unsafe` as a shortcut for missing modelling;
- expose mutable maps, slices, or struct pointers across package boundaries without an explicit ownership contract;
- introduce nil ambiguity in domain code without documenting what nil means;
- copy structs containing locks, atomics, `sync.Once`, file handles, buffers, or other no-copy resources;
- rely on map iteration order;
- ignore aliasing between slices, maps, pointers, and interface-held values;
- use pointers to interfaces except in extraordinary low-level cases with explicit justification;
- use `uintptr` as a general pointer or identifier type;
- use generated DTO shapes as the domain model unless the generated model is explicitly the domain boundary.

LLM MUST:

- inspect existing type conventions before adding a new type;
- preserve value-vs-pointer semantics of public APIs unless a migration is explicitly requested;
- explain whether a new type is a domain value, DTO, persistence record, event payload, configuration object, or mutable runtime object;
- decide nil-vs-empty behavior intentionally for slices and maps;
- add tests covering nil, empty, zero value, copy, mutation, and serialization semantics when those semantics matter;
- run or specify exact validation commands before merge.

---

## 4. Mental Model: Values, References, and Ownership

Go is value-oriented. Assignment, argument passing, returns, and channel sends copy the value being assigned, passed, returned, or sent.

However, some values contain references internally:

| Go value                     |   Copied on assignment? |               May reference shared backing data? | Review risk                                 |
| ---------------------------- | ----------------------: | -----------------------------------------------: | ------------------------------------------- |
| `int`, `bool`, numeric types |                     yes |                                               no | overflow, wrong width                       |
| `string`                     |                     yes |                     yes, immutable backing bytes | byte/rune confusion, retention              |
| array `[N]T`                 |                     yes | only through elements if elements are references | accidental large copy                       |
| slice `[]T`                  |     slice header copied |                                              yes | aliasing, append surprises, retained memory |
| map `map[K]V`                |       map header copied |                                              yes | mutation aliasing, concurrency race         |
| channel `chan T`             |   channel handle copied |                                              yes | ownership, close semantics                  |
| function `func(...)`         |   function value copied |                            may capture variables | hidden mutation/lifetime                    |
| interface                    | interface header copied |                                            maybe | nil trap, hidden concrete mutability        |
| pointer `*T`                 |          pointer copied |                                              yes | nil, mutation, escape, ownership            |
| struct                       |           fields copied |                    only through reference fields | shallow copy risk                           |

### Mandatory invariant

Before passing, returning, storing, or exposing any value with reference-bearing fields, code MUST answer:

1. Who owns mutation rights?
2. Can another goroutine observe mutation?
3. Should the receiver be allowed to retain it?
4. Does nil have a different meaning from empty?
5. Does serialization preserve the intended meaning?

If those answers are unclear, the code is not ready for merge.

---

## 5. Type Selection Standards

### 5.1 Primitive type usage

Primitive types MUST be used only when the value has no domain-specific invariant.

Bad:

```go
func SuspendUser(id string, days int) error
```

Good:

```go
type UserID string
type SuspensionDays int

func SuspendUser(id UserID, days SuspensionDays) error
```

Domain concepts SHOULD use named types when they prevent mixing unrelated values.

Use named types for:

- IDs;
- statuses;
- state names;
- event types;
- command types;
- role codes;
- permission names;
- business categories;
- currency amounts;
- units of measure;
- bounded counters;
- persisted enum-like values.

MUST NOT use named types only to make code look sophisticated. A named type MUST provide at least one of:

- type safety;
- validation;
- method set;
- serialization boundary;
- documentation of invariant;
- prevention of invalid cross-assignment.

### 5.2 Type aliases

A type alias (`type A = B`) MUST be used only for:

- package migration;
- compatibility during refactoring;
- generated code compatibility;
- intentional re-export of a type from another package.

MUST NOT use aliases to fake domain modelling. Use a defined type (`type A B`) when the value has its own domain meaning.

### 5.3 Constants and enums

Enum-like values MUST be modelled as named types with constants.

```go
type CaseStatus string

const (
	CaseStatusDraft     CaseStatus = "DRAFT"
	CaseStatusSubmitted CaseStatus = "SUBMITTED"
	CaseStatusApproved  CaseStatus = "APPROVED"
	CaseStatusRejected  CaseStatus = "REJECTED"
)
```

Enum-like types SHOULD provide validation when values cross trust boundaries:

```go
func (s CaseStatus) Valid() bool {
	switch s {
	case CaseStatusDraft, CaseStatusSubmitted, CaseStatusApproved, CaseStatusRejected:
		return true
	default:
		return false
	}
}
```

LLM MUST NOT add a new enum value without checking:

- API contract;
- DB constraints;
- event schema;
- state machine transitions;
- frontend assumptions;
- reporting/analytics logic;
- backward compatibility.

---

## 6. Numeric Type Standards

### 6.1 `int` and `uint`

Use `int` for:

- slice indexes;
- loop counters;
- lengths;
- capacities;
- local arithmetic that does not cross process boundaries.

Do not use `uint` merely because a value cannot be negative. `uint` often creates unsafe conversions, underflow bugs, and awkward API boundaries.

Use explicit-width integers for:

- database fields;
- wire protocols;
- binary formats;
- hashes;
- timestamps represented as integers;
- interoperability with external APIs;
- values whose range is part of the contract.

Examples:

```go
type Version int64
type Sequence uint64
type ShardID uint32
```

### 6.2 Integer overflow

Code handling money, limits, indexes, sizes, offsets, retries, quota, pagination, or binary formats MUST consider overflow.

MUST NOT write unchecked arithmetic when overflow changes security, billing, pagination, storage, or authorization behavior.

Bad:

```go
limit := page * size
```

Better:

```go
if page < 0 || size <= 0 || page > maxPage || size > maxSize {
	return 0, fmt.Errorf("invalid pagination")
}
offset := page * size
```

For high-risk arithmetic, use explicit bound checks before multiplication/addition.

### 6.3 Floating point

`float32` and `float64` MUST NOT be used for money, legal quantities, exact counters, regulatory thresholds, or persisted business amounts.

Use one of:

- integer minor units, such as cents;
- fixed-scale decimal package approved by the project;
- database decimal type mapped through a precise representation.

Floating point MAY be used for telemetry, ratios, ML features, scientific calculations, or approximate metrics when approximation is acceptable.

### 6.4 `time.Duration` and time values

Durations MUST use `time.Duration`, not raw integer milliseconds/seconds, inside Go code.

External numeric duration fields MUST be converted at the boundary.

```go
timeout := time.Duration(req.TimeoutMillis) * time.Millisecond
```

MUST NOT persist or transmit Go's raw `time.Duration` string unless the contract explicitly defines that format.

---

## 7. String, Byte, Rune, and Encoding Standards

### 7.1 String immutability

Strings are immutable values. Code MUST NOT use unsafe tricks to mutate string storage.

Use `string` for text.
Use `[]byte` for mutable bytes, binary data, buffers, encrypted data, compressed data, hashes, and network/file payloads.

### 7.2 Byte vs rune

Indexing a string returns a byte, not a Unicode character.

Bad:

```go
first := name[0] // byte, not character
```

Good when byte-level processing is intended:

```go
firstByte := name[0]
```

Good when Unicode code points are intended:

```go
for _, r := range name {
	_ = r
}
```

LLM MUST NOT write character logic using string indexes unless the logic is explicitly byte-oriented.

### 7.3 UTF-8 and external encodings

Go source code and Go strings are commonly handled as UTF-8, but external systems may not be.

Boundary code MUST document encoding assumptions for:

- legacy files;
- database CLOB/BLOB fields;
- mainframe integrations;
- CSV imports;
- government/regulatory data feeds;
- third-party APIs;
- email attachments.

MUST NOT silently treat arbitrary bytes as valid text.

### 7.4 String building

Repeated string concatenation in loops MUST be avoided for non-trivial loops.

Use:

- `strings.Builder` for text;
- `bytes.Buffer` or `[]byte` for bytes;
- `fmt.Appendf` or append-based formatting where appropriate in hot paths.

Bad:

```go
out := ""
for _, item := range items {
	out += item.Name
}
```

Good:

```go
var b strings.Builder
for _, item := range items {
	b.WriteString(item.Name)
}
out := b.String()
```

---

## 8. Array Standards

Arrays are values. Assigning or passing an array copies all elements.

Use arrays for:

- fixed-size protocol fields;
- hashes, nonces, keys, and fixed binary identifiers;
- small fixed-size mathematical values;
- compile-time fixed data.

Do not use arrays as general dynamic collections. Use slices.

MUST NOT pass large arrays by value unless copying is intentional and cheap enough.

Good:

```go
type SHA256Sum [32]byte
```

Risky:

```go
func Process(buf [4096]byte) // copies 4096 bytes per call
```

Prefer:

```go
func Process(buf []byte)
```

---

## 9. Slice Standards

### 9.1 Slice mental model

A slice is a descriptor over an underlying array. Copying a slice copies the descriptor, not the elements.

LLM MUST reason about:

- length;
- capacity;
- underlying array sharing;
- append reallocation;
- retention of large backing arrays;
- mutation visibility across aliases.

### 9.2 Nil vs empty slices

Nil and empty slices both have length zero, but they can serialize differently and communicate different intent.

| Meaning                        | Preferred representation                  |
| ------------------------------ | ----------------------------------------- |
| not loaded / unknown / omitted | `nil`                                     |
| loaded and empty               | `[]T{}` or `make([]T, 0)`                 |
| append target                  | nil is usually acceptable                 |
| JSON API requiring `[]`        | non-nil empty slice or custom JSON policy |

Public API and DTO code MUST decide nil-vs-empty explicitly.

MUST NOT rely on accidental default JSON behavior when the external contract cares about `null` vs `[]`.

### 9.3 Append result must be assigned

The result of `append` MUST be assigned to the slice that should observe the growth.

Bad:

```go
append(items, item)
```

Good:

```go
items = append(items, item)
```

### 9.4 Avoid unintended sharing

When storing a slice for later use, returning a slice from internal state, or crossing package/goroutine boundaries, code MUST decide whether to clone.

Bad:

```go
func (c *Cache) Put(key string, data []byte) {
	c.data[key] = data // caller can mutate cache after Put
}
```

Good:

```go
func (c *Cache) Put(key string, data []byte) {
	c.data[key] = slices.Clone(data)
}
```

Bad:

```go
func (c *Cache) Get(key string) []byte {
	return c.data[key] // caller can mutate cache internals
}
```

Good:

```go
func (c *Cache) Get(key string) []byte {
	return slices.Clone(c.data[key])
}
```

### 9.5 Capacity retention

Code MUST avoid retaining small slices of very large arrays when the large array should be garbage collected.

Bad:

```go
func Header(payload []byte) []byte {
	return payload[:16] // retains entire payload backing array
}
```

Good:

```go
func Header(payload []byte) []byte {
	return slices.Clone(payload[:16])
}
```

### 9.6 Preallocation

When expected size is known or bounded, slices SHOULD be preallocated.

Good:

```go
ids := make([]UserID, 0, len(users))
for _, user := range users {
	ids = append(ids, user.ID)
}
```

MUST NOT preallocate huge buffers without validating limits.

### 9.7 Deleting and clearing elements

When deleting from slices of pointer-like values, code SHOULD clear removed elements if retention matters.

Use `slices.Delete`, `slices.Compact`, `clear`, or explicit zeroing where appropriate.

```go
items = slices.Delete(items, i, j)
```

For security-sensitive or memory-sensitive data, explicitly clear obsolete references or bytes.

### 9.8 Slice concurrency

A slice and its backing array MUST NOT be mutated concurrently without synchronization.

Concurrent reads are safe only when no goroutine mutates the slice header or backing array.

Do not append to a shared slice from multiple goroutines without a mutex, channel ownership, or pre-partitioned indexes with safe synchronization.

---

## 10. Map Standards

### 10.1 Nil maps

Reading from a nil map is allowed. Writing to a nil map panics.

Code MUST initialize maps before writes.

```go
counts := make(map[string]int)
counts[key]++
```

### 10.2 Map ownership

Maps are reference-like values. Copying a map copies the header; mutations affect the same underlying map.

MUST NOT expose internal mutable maps directly.

Bad:

```go
func (r *Registry) Entries() map[string]Handler {
	return r.entries
}
```

Good:

```go
func (r *Registry) Entries() map[string]Handler {
	return maps.Clone(r.entries)
}
```

### 10.3 Map iteration order

Map iteration order is not a contract. Code MUST NOT depend on it.

For deterministic output, collect and sort keys.

```go
keys := make([]string, 0, len(m))
for k := range m {
	keys = append(keys, k)
}
slices.Sort(keys)
for _, k := range keys {
	// deterministic
}
```

### 10.4 Map concurrency

Plain maps MUST NOT be read and written concurrently without synchronization.

Use one of:

- `sync.RWMutex` around map;
- channel-owned map goroutine;
- copy-on-write immutable snapshot;
- `sync.Map` only for its intended access patterns.

Do not use `sync.Map` as a generic replacement for `map` plus mutex.

### 10.5 Map key standards

Map keys MUST be comparable and stable.

Do not use pointer keys unless identity semantics are explicitly intended.

Bad:

```go
map[*User]Permissions
```

Better for domain identity:

```go
map[UserID]Permissions
```

### 10.6 `map[string]any`

`map[string]any` MUST be restricted to true dynamic boundary data:

- raw JSON passthrough;
- loosely-typed third-party payloads;
- logging attributes before normalization;
- test fixtures for intentionally schema-less input.

Domain logic MUST use typed structs or typed maps.

---

## 11. Struct Standards

### 11.1 Struct purpose

Every struct MUST have a clear role:

- domain entity;
- immutable value object;
- DTO/request/response;
- persistence record;
- event payload;
- config;
- runtime component;
- test fixture;
- internal accumulator.

LLM MUST NOT create generic `Data`, `Info`, `Manager`, `Helper`, `Processor`, or `Payload` structs without precise domain meaning.

### 11.2 Zero value

Structs SHOULD be useful or at least safe in their zero value when practical.

Good:

```go
type Counter struct {
	mu sync.Mutex
	n  int64
}
```

The zero value of `Counter` is usable.

When zero value is invalid, constructors MUST enforce invariants.

```go
type Client struct {
	baseURL *url.URL
	http    *http.Client
}

func NewClient(baseURL string, httpClient *http.Client) (*Client, error) {
	if baseURL == "" {
		return nil, fmt.Errorf("base URL is required")
	}
	// validate and initialize
}
```

### 11.3 Struct field visibility

Public fields are part of the API contract.

Export fields only when callers are allowed to construct, read, and mutate them directly.

Use unexported fields when invariants must be protected.

### 11.4 Field ordering

Struct fields SHOULD be ordered by semantic clarity first.

For high-volume or memory-sensitive structs, field order MAY be optimized to reduce padding, but only when measured or obviously beneficial.

Do not reorder public struct fields casually if reflection, JSON, generated code, tests, docs, or compatibility expectations depend on them.

### 11.5 Struct tags

Struct tags MUST match the actual boundary contract.

Bad:

```go
type User struct {
	ID string `json:"user_id" db:"id" validate:"required"`
}
```

This is bad if the struct is simultaneously acting as domain model, API DTO, DB record, and validation object without explicit boundary ownership.

Prefer separate structs when boundary semantics differ:

```go
type User struct {
	ID UserID
}

type UserResponse struct {
	ID string `json:"id"`
}

type userRow struct {
	ID string `db:"id"`
}
```

### 11.6 No-copy fields

Structs containing any of the following MUST NOT be copied after first use:

- `sync.Mutex`;
- `sync.RWMutex`;
- `sync.Once`;
- `sync.Cond`;
- `sync.WaitGroup`;
- atomics;
- file descriptors;
- network connections;
- buffers with ownership assumptions;
- runtime components with goroutines.

Methods on such structs MUST use pointer receivers.

Bad:

```go
func (c Counter) Inc() { // copies mutex
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
}
```

Good:

```go
func (c *Counter) Inc() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
}
```

---

## 12. Pointer Standards

### 12.1 When to use pointers

Use `*T` when at least one is true:

1. the function/method must mutate the value;
2. copying the value is expensive or semantically wrong;
3. the value contains no-copy fields;
4. nil is an intentional state;
5. identity is part of the model;
6. method set requires pointer receiver;
7. API contract requires optional field semantics;
8. the value represents a shared runtime component;
9. the value must satisfy an interface with pointer receiver methods.

### 12.2 When not to use pointers

Do not use `*T` when:

- `T` is a small immutable value;
- nil has no meaningful distinction;
- copying is cheap and clearer;
- pointer use only imitates Java/C#/TypeScript object references;
- a pointer would expose mutation that should be impossible;
- the value is a domain value object.

Examples that usually SHOULD be values:

```go
type Money struct {
	Currency Currency
	Cents    int64
}

type DateRange struct {
	Start time.Time
	End   time.Time
}

type CaseStatus string
```

### 12.3 Optional values

Pointers MAY represent optional fields at API/serialization boundaries.

```go
type UpdateUserRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Active      *bool   `json:"active,omitempty"`
}
```

But domain code SHOULD avoid pointer-heavy optional modelling unless absence is truly part of the business invariant.

Prefer explicit domain types when absence has meaning:

```go
type OptionalReason struct {
	value string
	set   bool
}
```

### 12.4 Nil handling

Any exported function accepting a pointer MUST document whether nil is allowed.

If nil is invalid, fail early.

```go
func NewService(repo *Repository) (*Service, error) {
	if repo == nil {
		return nil, fmt.Errorf("repository is required")
	}
	return &Service{repo: repo}, nil
}
```

MUST NOT allow nil pointer panics to become implicit validation.

### 12.5 Pointer to interface

MUST NOT use `*interface`, `*any`, or pointer to named interface in ordinary application code.

Bad:

```go
func Handle(w *io.Writer) error
```

Good:

```go
func Handle(w io.Writer) error
```

An interface value already carries the dynamic value, which may itself be a pointer.

### 12.6 Pointer to slice/map/channel/function

Do not use pointers to slices, maps, channels, or functions unless the function must replace the descriptor itself and the API cannot return the new value.

Bad:

```go
func Add(items *[]Item, item Item)
```

Good:

```go
func Add(items []Item, item Item) []Item {
	return append(items, item)
}
```

Pointers to maps are almost never justified. A map value already behaves like a handle to mutable storage.

### 12.7 Pointer receiver consistency

For a given type, receiver choice SHOULD be consistent.

Use pointer receivers when any method:

- mutates receiver;
- uses synchronization;
- would copy a large value;
- must avoid copying internal references with ownership meaning;
- needs pointer method set for interface satisfaction.

Use value receivers when:

- the type is small;
- immutable semantics are intended;
- methods do not mutate;
- copying is correct and unsurprising.

Avoid mixed pointer/value receivers unless there is a clear documented reason.

### 12.8 Address of loop variables

Code MUST be careful when taking addresses in loops.

Even in Go versions where range variable semantics are safer than historical Go, code SHOULD prefer explicit local variables when the address must be retained for clarity and version portability.

```go
ptrs := make([]*UserID, 0, len(ids))
for _, id := range ids {
	id := id
	ptrs = append(ptrs, &id)
}
```

### 12.9 `new` and address literals

Use `&T{...}` for struct allocation when fields are initialized.

```go
cfg := &Config{Timeout: 5 * time.Second}
```

Use `new(T)` only when the zero value is intended and clearer.

```go
var buf bytes.Buffer
// usually better than b := new(bytes.Buffer) for local use
```

For Go 1.26+ modules, `new(expr)` MAY be used for optional scalar fields when it improves clarity and the module explicitly targets Go 1.26 or later.

```go
req := Request{Attempts: new(3)}
```

MUST NOT use `new(expr)` in modules targeting older Go versions.

---

## 13. Interface Data Semantics

### 13.1 Consumer-owned interfaces

Interfaces generally belong where they are consumed, not where they are implemented.

Bad:

```go
// package postgres
type UserRepository interface {
	Find(ctx context.Context, id UserID) (*User, error)
}
```

Good:

```go
// package user
type Repository interface {
	Find(ctx context.Context, id UserID) (*User, error)
}
```

Implementing packages SHOULD return concrete types.

### 13.2 Small interfaces

Interfaces MUST be small and behavior-focused.

Good:

```go
type Clock interface {
	Now() time.Time
}
```

Bad:

```go
type UtilityService interface {
	Now() time.Time
	UUID() string
	Hash([]byte) []byte
	Marshal(any) ([]byte, error)
}
```

### 13.3 Compile-time interface assertions

When interface implementation is part of a contract, assert it at compile time.

```go
var _ io.Reader = (*Buffer)(nil)
```

Use assertions for:

- exported implementations;
- plugin/adapter contracts;
- generated code wrappers;
- strategy implementations;
- state handlers;
- middleware adapters.

Do not add assertion noise for obvious local-only types.

### 13.4 Nil interface trap

Code MUST avoid returning typed nil values as interface values.

Bad:

```go
func Load() error {
	var e *PathError = nil
	return e // non-nil error interface
}
```

Good:

```go
func Load() error {
	return nil
}
```

When returning `error`, return `nil` directly for no error.

---

## 14. Error Type Standards

### 14.1 Error as value

Errors are values and MUST be modelled deliberately.

Use:

- sentinel errors for stable classification;
- custom error types for structured data;
- wrapping with `%w` to preserve cause;
- `errors.Is` and `errors.As` for classification.

Bad:

```go
if strings.Contains(err.Error(), "not found") {
	// ...
}
```

Good:

```go
if errors.Is(err, ErrNotFound) {
	// ...
}
```

### 14.2 Pointer vs value error types

Error types MUST choose pointer or value semantics intentionally.

If callers need `errors.As` against a pointer type, return pointer values consistently.

```go
type ValidationError struct {
	Field string
	Rule  string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Rule }
```

MUST NOT mix `ValidationError` and `*ValidationError` returns arbitrarily.

### 14.3 Error wrapping

When adding context to an error, wrap with `%w` exactly once when the cause should remain machine-detectable.

```go
return fmt.Errorf("load user %s: %w", id, err)
```

Do not wrap when the underlying error must be hidden for security or abstraction reasons.

---

## 15. Data Boundary Standards

### 15.1 Domain vs DTO vs persistence record

Domain types MUST NOT be polluted by every transport/persistence concern.

Use separate types when boundaries have different semantics.

```go
type User struct {
	ID    UserID
	Email Email
}

type createUserRequest struct {
	Email string `json:"email"`
}

type userRow struct {
	ID    string `db:"id"`
	Email string `db:"email"`
}
```

LLM MUST NOT merge these types to reduce file count if it weakens invariants.

### 15.2 Nullable database fields

Nullable DB fields MUST be modelled explicitly.

Allowed approaches:

- `sql.NullString`, `sql.NullTime`, etc.;
- project-approved nullable generic type;
- pointer fields in persistence DTOs;
- domain-specific optional types.

MUST NOT guess that an empty string, zero time, or zero number means NULL unless the schema contract says so.

### 15.3 API PATCH semantics

PATCH/update request DTOs SHOULD use pointers or explicit presence wrappers to distinguish:

- omitted;
- present with zero value;
- present with null, if supported.

Bad:

```go
type UpdateUserRequest struct {
	Name string `json:"name"`
}
```

This cannot distinguish omitted name from empty name.

Better:

```go
type UpdateUserRequest struct {
	Name *string `json:"name,omitempty"`
}
```

For advanced APIs, prefer explicit presence types if null semantics matter.

### 15.4 Event payload immutability

Event payload structs SHOULD be treated as immutable after creation.

Do not pass around pointers to event payloads for mutation.

Good:

```go
type UserSuspended struct {
	UserID    UserID
	Reason    string
	Occurred  time.Time
	EventID   EventID
	Version   int64
}
```

---

## 16. Ownership and Mutability Standards

### 16.1 Ownership transfer

Functions receiving mutable reference-bearing values MUST make ownership clear.

Examples:

```go
// Put copies data before storing it.
func (c *Cache) Put(key string, data []byte)
```

```go
// PutOwned takes ownership of data. The caller must not mutate data after this call.
func (c *Cache) PutOwned(key string, data []byte)
```

Do not rely on undocumented ownership transfer.

### 16.2 Immutability by convention

Go does not enforce deep immutability for structs containing slices/maps/pointers.

If a type is described as immutable, constructors and accessors MUST clone mutable fields.

```go
type Policy struct {
	allowed []Role
}

func NewPolicy(allowed []Role) Policy {
	return Policy{allowed: slices.Clone(allowed)}
}

func (p Policy) Allowed() []Role {
	return slices.Clone(p.allowed)
}
```

### 16.3 Defensive copying

Defensive copying is REQUIRED when:

- storing caller-owned `[]byte` or `[]T`;
- returning internal slices/maps;
- crossing goroutine ownership boundaries;
- caching security-sensitive data;
- retaining a sub-slice of a large buffer;
- constructing immutable values;
- exposing data to untrusted plugins/hooks.

Defensive copying SHOULD be avoided in hot paths only when ownership is explicit and tested.

---

## 17. Concurrency and Memory Safety

### 17.1 Data races are correctness bugs

Any unsynchronized concurrent read/write or write/write to the same memory location is a bug.

MUST NOT rely on timing, scheduler behavior, or "it works locally".

Validation for concurrent code MUST include:

```bash
go test -race ./...
```

### 17.2 Share memory by communicating

Prefer ownership transfer through channels over shared mutable memory when it simplifies reasoning.

If shared memory is necessary, use:

- `sync.Mutex` / `sync.RWMutex`;
- `sync/atomic` for simple atomic state;
- immutable snapshots;
- single-writer goroutine ownership;
- explicit lifecycle management.

### 17.3 Atomic types

Use typed atomics from `sync/atomic` for counters/flags that truly need lock-free access.

Do not combine atomic and non-atomic access to the same variable.

Bad:

```go
var stopped atomic.Bool

if stopped.Load() {
	return
}
stopped = atomic.Bool{} // invalid semantic reset pattern
```

Use an explicit lifecycle or protected state instead.

### 17.4 Copying synchronized structs

Code MUST NOT copy structs containing synchronization primitives after first use.

`go vet` warnings about copying locks MUST be treated as merge blockers.

---

## 18. `unsafe`, `uintptr`, and Reflection Standards

### 18.1 Default ban

`unsafe` MUST NOT be used in normal application code.

Allowed only when all are true:

1. standard library or safe code cannot meet a measured requirement;
2. benchmark proves the need;
3. memory safety invariants are documented;
4. tests cover edge cases;
5. race tests pass;
6. code review explicitly approves it;
7. the unsafe code is isolated in a tiny package.

### 18.2 `uintptr`

`uintptr` is an integer large enough to hold a pointer bit pattern, not a safe pointer.

MUST NOT store Go pointers in `uintptr` across GC safepoints.

MUST NOT use `uintptr` as a generic ID type.

### 18.3 Reflection

Reflection MUST NOT replace normal typing.

Use reflection only for:

- serializers/deserializers;
- framework integration;
- generic tooling;
- validation libraries;
- test helpers;
- migration utilities.

Reflection-heavy code MUST include tests for nil, pointer, value, unexported fields, embedded fields, and zero values.

---

## 19. Generics and Data Type Standards

### 19.1 Use generics for type-safe reuse

Use generics when they remove duplication while preserving clear type contracts.

Good:

```go
func Keys[M ~map[K]V, K comparable, V any](m M) []K {
	keys := make([]K, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
```

MUST NOT use generics to simulate inheritance or hide domain concepts.

### 19.2 Constraints

Constraints MUST be as narrow as practical.

Bad:

```go
func Equal[T any](a, b T) bool { return a == b } // invalid: any may not be comparable
```

Good:

```go
func Equal[T comparable](a, b T) bool { return a == b }
```

### 19.3 Generic optional/result types

Generic optional/result types MAY be used if already project-standard.

MUST NOT introduce a new generic abstraction just because a single function has two return values.

Go's idiomatic `(T, error)` remains preferred for fallible operations.

---

## 20. Testing Requirements

### 20.1 Required test cases for data type changes

Any change to data modelling MUST include tests for relevant cases:

- zero value;
- nil pointer;
- nil slice/map;
- empty slice/map;
- invalid enum;
- valid enum;
- JSON encode/decode;
- DB scan/value conversion;
- copy vs mutation behavior;
- map ordering independence;
- concurrency safety;
- error classification with `errors.Is`/`errors.As`.

### 20.2 Table-driven tests

Use table-driven tests for type validation and edge cases.

```go
func TestCaseStatusValid(t *testing.T) {
	tests := []struct {
		name string
		in   CaseStatus
		want bool
	}{
		{name: "submitted", in: CaseStatusSubmitted, want: true},
		{name: "unknown", in: CaseStatus("UNKNOWN"), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.in.Valid(); got != tt.want {
				t.Fatalf("Valid() = %v, want %v", got, tt.want)
			}
		})
	}
}
```

### 20.3 Fuzz tests

Fuzz tests SHOULD be added for parsers, decoders, normalization, validators, and binary/text boundary code.

```bash
go test ./... -fuzz=Fuzz -fuzztime=30s
```

### 20.4 Race tests

Concurrent data structures MUST be validated with:

```bash
go test -race ./...
```

---

## 21. Review Checklist

Before merge, reviewers and LLM agents MUST verify:

- [ ] Type has clear role: domain, DTO, persistence, event, config, runtime, or test.
- [ ] Named types are used where they prevent invalid mixing.
- [ ] Type aliases are not used as fake domain modelling.
- [ ] Numeric widths are explicit at persistence/wire boundaries.
- [ ] Money/exact quantities do not use float.
- [ ] String logic distinguishes byte, rune, and encoding semantics.
- [ ] Slice nil-vs-empty behavior is intentional.
- [ ] Slice/map ownership is documented or protected by cloning.
- [ ] Map iteration order is not relied upon.
- [ ] Plain maps are not accessed concurrently without synchronization.
- [ ] Structs with locks/atomics/no-copy resources are not copied.
- [ ] Pointer use has a reason: mutation, identity, optionality, no-copy, large value, or interface method set.
- [ ] No pointer-to-interface in ordinary code.
- [ ] Nil pointer behavior is documented or rejected early.
- [ ] Interfaces are consumer-owned and small.
- [ ] Error types have consistent pointer/value semantics.
- [ ] `errors.Is`/`errors.As` are used instead of string matching.
- [ ] `unsafe` is absent or isolated and justified.
- [ ] Reflection is not hiding weak modelling.
- [ ] Tests cover zero/nil/empty/mutation/serialization behavior.
- [ ] `go test ./...`, `go test -race ./...`, `go vet ./...`, and project linters pass.

---

## 22. LLM Output Contract

When implementing data type or pointer-related changes, LLM MUST include in its final response or PR notes:

```text
DATA MODEL SUMMARY
- Types added/changed:
- Value vs pointer decisions:
- Nil vs empty semantics:
- Ownership/mutation semantics:
- Serialization impact:
- Persistence/API/event impact:

SAFETY CHECKS
- Race risk:
- Aliasing risk:
- Copy risk:
- Nil risk:
- Overflow risk:
- Unsafe/reflection use:

VALIDATION
- Tests added:
- Commands run:
- Known limitations:
```

If any section is unknown, LLM MUST write `UNKNOWN` and explain what evidence is missing.

---

## 23. Hard Bans

The following are merge blockers:

- pointer to interface in ordinary application code;
- shared mutable map without synchronization;
- shared mutable slice append without synchronization;
- public API changing value to pointer or pointer to value without migration notes;
- nil pointer dereference used as validation;
- string matching for error classification;
- use of `float64` for money or exact legal/business quantities;
- `map[string]any` as domain model;
- leaking internal maps/slices from getters;
- taking dependency on map iteration order;
- copying structs containing locks/atomics after first use;
- `unsafe` without documented invariants and review approval;
- ignoring `go vet` copylock or printf-related warnings;
- generated DTOs used as domain model without explicit boundary decision.

---

## 24. Minimal Commands

At minimum, after changes to data types, pointer semantics, or shared mutable state, run:

```bash
gofmt -w .
go test ./...
go test -race ./...
go vet ./...
```

For parser/decoder/normalizer changes, also run project fuzz targets:

```bash
go test ./... -fuzz=Fuzz -fuzztime=30s
```

For Go 1.26+ modernization work, from a clean git state:

```bash
go fix -diff ./...
```

Apply `go fix` changes only when they are compatible with project style and target Go version.

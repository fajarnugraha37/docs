# Strict Coding Standards — Go Data Structure

**File:** `strict-coding-standards__go_data_structure.md`  
**Scope:** Go arrays, slices, maps, sets, queues, stacks, heaps, lists, rings, indexes, caches, trees, graphs, iterators, and domain-specific data structures.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go code.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

A data structure is a correctness decision, not a storage detail.

An LLM coding agent MUST NOT introduce, replace, or expose a data structure unless it can state all of the following:

1. What invariant the structure protects.
2. Whether order matters.
3. Whether duplicates are allowed.
4. Whether lookup, insertion, deletion, iteration, or memory usage dominates the workload.
5. Whether mutation is allowed after construction.
6. Who owns the structure and its element references.
7. Whether callers may retain or mutate returned slices, maps, pointers, iterators, or elements.
8. Whether iteration order must be deterministic.
9. Whether concurrent access is possible.
10. What complexity and allocation behavior is expected at realistic input sizes.

If any answer is unknown, the agent MUST choose the simplest structure that preserves correctness and MUST document the trade-off.

---

## 1. Source Authority

This standard is derived from official Go language and standard library references:

- Go Language Specification: https://go.dev/ref/spec
- Effective Go: https://go.dev/doc/effective_go
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Go Slices: usage and internals: https://go.dev/blog/slices-intro
- Arrays, slices, and strings: append mechanics: https://go.dev/blog/slices
- Robust generic functions on slices: https://go.dev/blog/generic-slice-functions
- Go maps in action: https://go.dev/blog/maps
- `slices` package: https://pkg.go.dev/slices
- `maps` package: https://pkg.go.dev/maps
- `cmp` package: https://pkg.go.dev/cmp
- `sort` package: https://pkg.go.dev/sort
- `container/heap`: https://pkg.go.dev/container/heap
- `container/list`: https://pkg.go.dev/container/list
- `container/ring`: https://pkg.go.dev/container/ring
- Go Memory Model: https://go.dev/ref/mem

---

## 2. Required Decision Record Before Choosing a Data Structure

For non-trivial collections, the agent MUST write or maintain a short design note near the type or constructor.

Required fields:

```go
// IndexByCaseID stores cases by stable case ID.
// Invariants:
//   - each CaseID appears at most once;
//   - values are immutable snapshots owned by this index;
//   - iteration order is not semantically meaningful;
//   - all access is guarded by Index.mu.
// Complexity:
//   - lookup: expected O(1);
//   - insert/update/delete: expected O(1);
//   - snapshot: O(n) with deterministic sorting by CaseID.
type IndexByCaseID struct {
    mu sync.RWMutex
    byID map[CaseID]CaseSnapshot
}
```

The note MAY be omitted only when the structure is local, obvious, and has no ownership or ordering consequence.

---

## 3. Standard Decision Matrix

The agent MUST prefer the following choices unless a measured or documented reason exists.

| Need                          | Preferred structure                      | Avoid by default                          |
| ----------------------------- | ---------------------------------------- | ----------------------------------------- |
| ordered sequence              | `[]T`                                    | `container/list`                          |
| small fixed-size value        | `[N]T`                                   | heap-allocated slice                      |
| lookup by key                 | `map[K]V`                                | linear scan after growth                  |
| membership set                | `map[T]struct{}` or `map[T]bool`         | `[]T` with repeated scan                  |
| stable sorted unique values   | sorted `[]T` + binary search             | map if deterministic output dominates     |
| priority queue                | `container/heap` wrapper                 | repeated full sort                        |
| FIFO queue                    | slice ring buffer / bounded channel      | unbounded goroutine/channel growth        |
| LRU cache                     | `map[K]*list.Element` + `container/list` | map-only cache with no eviction invariant |
| graph adjacency               | `map[NodeID][]Edge` or `[][]int`         | nested maps without size reason           |
| tree with ordered traversal   | sorted slice / custom tree               | generic tree without workload proof       |
| deterministic output from map | `maps.Keys` + `slices.Sorted`            | raw `range map`                           |

---

## 4. Arrays

### 4.1 Use Arrays Only When Length Is a Semantic Part of the Type

Arrays MUST be used when fixed length is part of correctness:

- cryptographic keys, hashes, identifiers, and fixed protocol fields;
- fixed-size windows;
- small value objects where copying is intended;
- internal buffers where escape is controlled.

Acceptable:

```go
type SHA256Digest [32]byte

type IPv4Address [4]byte
```

Forbidden:

```go
func Process(items [100]Item) error // arbitrary limit encoded into API
```

Use `[]Item` unless exactly 100 is a domain or protocol invariant.

### 4.2 Avoid Accidental Large Copies

The agent MUST NOT pass large arrays by value unless copying is intentionally part of the design.

Forbidden:

```go
func HashBlock(block [4096]byte) { // copies 4096 bytes per call
    // ...
}
```

Preferred:

```go
func HashBlock(block []byte) error {
    if len(block) != 4096 {
        return fmt.Errorf("block length: got %d, want 4096", len(block))
    }
    // ...
    return nil
}
```

---

## 5. Slices

### 5.1 Treat Slices as Views Over Shared Storage

A slice value contains a pointer to an underlying array, a length, and a capacity. Slicing does not copy elements. Therefore, the agent MUST assume any slice may alias another slice unless it was explicitly cloned.

Forbidden:

```go
func (s *Store) Save(input []byte) {
    s.payload = input // caller can mutate Store state after Save
}
```

Preferred:

```go
func (s *Store) Save(input []byte) {
    s.payload = bytes.Clone(input)
}
```

For non-byte slices:

```go
func NewRules(rules []Rule) RuleSet {
    return RuleSet{rules: slices.Clone(rules)}
}
```

### 5.2 Returning Internal Slices Is Forbidden Unless Read-Only By Contract

Forbidden:

```go
func (s *Store) Items() []Item {
    return s.items
}
```

Preferred snapshot:

```go
func (s *Store) Items() []Item {
    return slices.Clone(s.items)
}
```

Preferred iterator-style read-only API:

```go
func (s *Store) ForEach(fn func(Item) bool) {
    for _, item := range s.items {
        if !fn(item) {
            return
        }
    }
}
```

The callback MUST NOT receive mutable pointers unless mutation is intended and guarded.

### 5.3 Preallocate With Evidence, Not Guesswork

The agent SHOULD preallocate when an upper bound or exact size is known.

Acceptable:

```go
out := make([]CaseSummary, 0, len(cases))
for _, c := range cases {
    if c.VisibleTo(user) {
        out = append(out, summarize(c))
    }
}
```

Forbidden:

```go
out := make([]CaseSummary, 0, 1_000_000) // arbitrary memory reservation
```

### 5.4 Control Capacity When Passing Sub-Slices

If a sub-slice is returned or passed to code that might append, the agent MUST prevent append from mutating unrelated tail data.

Preferred:

```go
chunk := data[start:end:end] // len == cap
```

or:

```go
chunk := slices.Clone(data[start:end])
```

### 5.5 Avoid Long-Lived Tiny Slices That Retain Huge Arrays

Forbidden:

```go
func Header(packet []byte) []byte {
    return packet[:16] // may retain a large packet buffer
}
```

Preferred:

```go
func Header(packet []byte) []byte {
    return bytes.Clone(packet[:16])
}
```

### 5.6 Delete Pointer Elements Without Retention

When manually deleting from a slice of pointers, interfaces, maps, slices, channels, or large objects, the agent MUST ensure obsolete references are cleared before the slice remains long-lived.

Preferred manual pattern:

```go
copy(items[i:], items[i+1:])
var zero *Item
items[len(items)-1] = zero
items = items[:len(items)-1]
```

When using `slices.Delete`, the agent MUST still understand retention behavior and Go version behavior. For critical memory-sensitive paths, write tests or inspect heap profiles rather than relying on assumption.

### 5.7 Nil vs Empty Slices Must Be Contractual

The agent MUST NOT casually change nil/empty behavior across API, JSON, DB, or cache boundaries.

Rules:

- Use nil slice internally when “not initialized” and “empty” are equivalent.
- Use empty non-nil slice when JSON/API must encode `[]` rather than `null`.
- Document when nil has semantic meaning.
- Do not compare slices with `==` except against nil.
- Use `slices.Equal` or a domain-specific comparator for element equality.

---

## 6. Maps

### 6.1 Map Keys Must Be Stable, Comparable, and Canonical

Map key types MUST be comparable and SHOULD be domain-specific named types.

Preferred:

```go
type CaseID string

type CaseIndex map[CaseID]CaseSnapshot
```

Forbidden:

```go
map[string]CaseSnapshot // when string could mean case ID, user ID, ref no, etc.
```

when the domain has multiple string identifiers.

### 6.2 Do Not Rely on Map Iteration Order

Map iteration order MUST be treated as non-deterministic.

Forbidden:

```go
for id, c := range cases {
    writeRow(id, c) // unstable report output
}
```

Preferred:

```go
ids := slices.Sorted(maps.Keys(cases))
for _, id := range ids {
    writeRow(id, cases[id])
}
```

This rule is mandatory for:

- tests;
- reports;
- regulatory decisions;
- audit logs;
- cache keys;
- signatures;
- API responses where clients may diff output;
- deterministic replay.

### 6.3 Nil Map Writes Are Forbidden

The agent MUST initialize maps before writing.

Forbidden:

```go
var m map[string]int
m["x"] = 1 // panic
```

Preferred:

```go
m := make(map[string]int, expected)
m["x"] = 1
```

### 6.4 Always Use Two-Value Lookup When Zero Value Is Ambiguous

Forbidden:

```go
if attempts[userID] == 0 {
    // absent or exactly zero?
}
```

Preferred:

```go
attempt, ok := attempts[userID]
if !ok {
    return ErrNotFound
}
if attempt == 0 {
    // known zero
}
```

### 6.5 Map Values Must Not Hide Shared Mutable State

`maps.Clone` and `maps.Copy` perform shallow assignment. If values are slices, maps, pointers, or interfaces wrapping mutable values, the agent MUST deep-copy at the domain boundary.

Forbidden:

```go
func CloneIndex(in map[CaseID][]Event) map[CaseID][]Event {
    return maps.Clone(in) // slices still alias
}
```

Preferred:

```go
func CloneIndex(in map[CaseID][]Event) map[CaseID][]Event {
    out := make(map[CaseID][]Event, len(in))
    for id, events := range in {
        out[id] = slices.Clone(events)
    }
    return out
}
```

### 6.6 Maps Are Not Safe for Concurrent Mutation

The agent MUST NOT read/write or write/write the same map from multiple goroutines without synchronization.

Preferred choices:

- `sync.RWMutex` around ordinary map for most cases;
- actor goroutine for serialized mutation when operation ordering matters;
- `sync.Map` only for its documented workload profile and with justification;
- immutable snapshot map behind `atomic.Value` only when whole-map replacement is intended.

Forbidden:

```go
go func() { m[k] = v }()
value := m[k]
```

### 6.7 Set Representation Must Be Explicit

Preferred memory-efficient set:

```go
type CaseIDSet map[CaseID]struct{}
```

Preferred readable set when value is semantically useful:

```go
type PermissionSet map[Permission]bool
```

Rules:

- Provide methods for domain sets when used beyond local scope.
- Do not expose raw set maps from public APIs.
- Provide deterministic `Values()` when output matters.

```go
func (s CaseIDSet) Values() []CaseID {
    ids := make([]CaseID, 0, len(s))
    for id := range s {
        ids = append(ids, id)
    }
    slices.Sort(ids)
    return ids
}
```

---

## 7. Structs as Data Structures

### 7.1 Structs Must Encode Invariants, Not Just Fields

A struct with multiple related fields MUST have a constructor or validation boundary if arbitrary combinations are invalid.

Forbidden:

```go
type DateRange struct {
    Start time.Time
    End   time.Time
}
```

when `End` must be greater than or equal to `Start`.

Preferred:

```go
type DateRange struct {
    start time.Time
    end   time.Time
}

func NewDateRange(start, end time.Time) (DateRange, error) {
    if end.Before(start) {
        return DateRange{}, fmt.Errorf("invalid range: end before start")
    }
    return DateRange{start: start, end: end}, nil
}
```

### 7.2 Public Fields Are an API Commitment

The agent MUST NOT expose struct fields merely for convenience when invariants matter.

Use public fields for:

- DTOs;
- config structs;
- simple immutable value objects;
- test fixtures.

Use private fields plus methods for:

- state machines;
- caches;
- indexes;
- domain aggregates;
- lifecycle-managed resources;
- concurrency-protected structures.

### 7.3 Field Order May Matter in Hot Structures

For high-volume structs, the agent SHOULD consider padding and memory layout, but MUST NOT reorder fields if it harms readability or API stability.

Allowed:

```go
type entry struct {
    expiresAt int64
    hits      int64
    key       string
    value     []byte
    active    bool
}
```

only if this structure is high volume and benchmarked or obviously repeated at scale.

---

## 8. Queues

### 8.1 Use a Queue Only With Explicit Boundaries

Any queue MUST define:

- maximum size or memory budget;
- behavior when full;
- fairness requirements;
- cancellation behavior;
- shutdown behavior;
- observability metrics.

Forbidden:

```go
var q []Task
q = append(q, task) // unbounded production queue
```

### 8.2 Slice-Based FIFO Must Avoid Retaining Consumed Elements

Forbidden long-lived queue:

```go
item := q[0]
q = q[1:] // old array still retained; old element may remain referenced
```

Preferred:

```go
item := q[0]
var zero Task
q[0] = zero
q = q[1:]
```

For high-throughput queues, prefer a ring buffer:

```go
type RingQueue[T any] struct {
    buf        []T
    head, tail int
    size       int
}
```

The implementation MUST test wraparound, full, empty, and single-element states.

### 8.3 Channels Are Not General Queues

The agent MUST NOT use a buffered channel as a persistent queue unless:

- capacity is fixed and justified;
- send and receive obey context cancellation;
- close ownership is explicit;
- queued items may be lost on process crash;
- ordering and retry semantics are acceptable.

For durable queues, use a database, log, message broker, or explicit outbox/inbox design.

---

## 9. Stacks

Stacks SHOULD use `[]T`.

Preferred:

```go
stack = append(stack, item)

n := len(stack) - 1
item := stack[n]
var zero T
stack[n] = zero
stack = stack[:n]
```

Rules:

- Check empty before pop.
- Clear popped pointer-like values in long-lived stacks.
- Prefer iterative stack over recursion for untrusted/deep input.
- Avoid generic stack abstractions unless reused across multiple packages.

---

## 10. Heaps and Priority Queues

### 10.1 Use `container/heap` for Priority Queues

The agent MUST use `container/heap` or a well-tested equivalent for repeated priority operations.

Forbidden:

```go
items = append(items, item)
slices.SortFunc(items, comparePriority)
next := items[0]
```

inside repeated scheduling loops.

Preferred:

```go
type Item struct {
    ID       TaskID
    Priority int
    index    int
}

type PriorityQueue []*Item

func (pq PriorityQueue) Len() int { return len(pq) }
func (pq PriorityQueue) Less(i, j int) bool {
    return pq[i].Priority > pq[j].Priority // highest first
}
func (pq PriorityQueue) Swap(i, j int) {
    pq[i], pq[j] = pq[j], pq[i]
    pq[i].index = i
    pq[j].index = j
}
func (pq *PriorityQueue) Push(x any) {
    item := x.(*Item)
    item.index = len(*pq)
    *pq = append(*pq, item)
}
func (pq *PriorityQueue) Pop() any {
    old := *pq
    n := len(old)
    item := old[n-1]
    old[n-1] = nil
    item.index = -1
    *pq = old[:n-1]
    return item
}
```

### 10.2 Priority Queue Invariants Must Be Tested

Required tests:

- pop order;
- equal priority behavior if deterministic order is required;
- update priority;
- remove arbitrary item;
- stale index handling;
- empty pop protection;
- GC retention of popped items.

---

## 11. Lists and Rings

### 11.1 `container/list` Is Rarely the First Choice

The agent MUST NOT choose a linked list merely because insert/delete is O(1). In Go, slices are often faster due to locality and lower allocation overhead.

`container/list` is acceptable when:

- removing known elements from the middle is frequent;
- element handles are stored externally;
- LRU cache implementation needs stable element pointers;
- list length is large enough that shifting slices is costly;
- allocation cost is acceptable or measured.

### 11.2 Use `container/ring` Only When Circular Structure Is the Model

Use `container/ring` for circular traversal, not as a default FIFO queue.

For fixed-capacity FIFO, a custom ring buffer backed by a slice is often clearer and allocation-free.

---

## 12. Sorted Slices

### 12.1 Sorted Slice Is Often Better Than Map for Small or Read-Heavy Sets

Use sorted `[]T` when:

- deterministic ordering is required;
- collection is small;
- writes are rare;
- binary search is enough;
- memory locality matters.

```go
type SortedCaseIDs []CaseID

func (ids SortedCaseIDs) Contains(id CaseID) bool {
    _, found := slices.BinarySearch(ids, id)
    return found
}
```

Rules:

- The constructor MUST sort and deduplicate when uniqueness is required.
- Mutation MUST preserve sorted invariant.
- Binary search MUST only be used on proven sorted input.
- Tests MUST include unsorted input rejection or normalization.

---

## 13. Indexes and Multi-Indexes

### 13.1 Multi-Index Updates Must Be Atomic at the Structure Level

When one logical object is indexed multiple ways, update operations MUST either update all indexes or none.

Forbidden:

```go
byID[c.ID] = c
byOwner[c.Owner] = append(byOwner[c.Owner], c.ID) // if this fails/panics, structure corrupts
```

Preferred:

```go
func (s *CaseStore) Upsert(c Case) error {
    if err := c.Validate(); err != nil {
        return err
    }

    old, existed := s.byID[c.ID]
    if existed {
        s.removeFromOwnerIndex(old.Owner, c.ID)
    }

    s.byID[c.ID] = c
    s.byOwner[c.Owner] = appendUniqueSorted(s.byOwner[c.Owner], c.ID)
    return nil
}
```

### 13.2 Index Consistency Must Be Assertable

Any complex in-memory index MUST provide an internal test helper or invariant checker.

```go
func (s *CaseStore) checkInvariants() error {
    for id, c := range s.byID {
        if !contains(s.byOwner[c.Owner], id) {
            return fmt.Errorf("owner index missing case %s", id)
        }
    }
    return nil
}
```

This helper SHOULD be used in tests and MAY be enabled in debug builds.

---

## 14. Trees

### 14.1 Avoid Custom Trees Unless Required

The agent MUST NOT implement a custom tree unless a sorted slice, map, heap, or database query cannot satisfy the requirement.

Valid reasons:

- interval search;
- prefix search;
- ordered range query with frequent mutation;
- hierarchical domain model;
- parsing AST;
- memory-bound specialized structure;
- algorithmic requirement with known complexity.

### 14.2 Tree Invariants Must Be Explicit

For every custom tree, document:

- ordering rule;
- duplicate key rule;
- balancing rule, if any;
- traversal order;
- mutation ownership;
- maximum expected depth;
- recursion safety.

For untrusted or deep input, traversal MUST be iterative or depth-limited.

---

## 15. Graphs

### 15.1 Graph Representation Must Match Operations

Preferred representations:

```go
type Graph map[NodeID][]Edge
```

for sparse domain graphs.

```go
type Graph [][]int
```

for dense numeric node IDs.

```go
type Edge struct {
    To     NodeID
    Weight int64
}
```

for weighted graphs.

Rules:

- Node identity MUST use named types.
- Directed vs undirected MUST be explicit.
- Self-loop and duplicate-edge policy MUST be explicit.
- Traversal order MUST be deterministic when output affects tests or decisions.
- Cycle behavior MUST be defined.

### 15.2 Domain Workflow Graphs Require Stronger Rules

For workflow, enforcement, licensing, case lifecycle, or regulatory state graphs:

- states MUST be typed constants;
- transitions MUST be explicit data, not scattered conditionals;
- illegal transitions MUST return typed domain errors;
- transition graph MUST be testable;
- terminal states MUST be explicit;
- escalation/deadline transitions MUST be deterministic;
- audit event generation MUST be tied to transition success, not attempted transition.

Example:

```go
type CaseState string

const (
    CaseDraft     CaseState = "DRAFT"
    CaseSubmitted CaseState = "SUBMITTED"
    CaseClosed    CaseState = "CLOSED"
)

type Transition struct {
    From CaseState
    To   CaseState
    Name string
}

var allowedTransitions = map[CaseState]map[CaseState]Transition{
    CaseDraft: {
        CaseSubmitted: {From: CaseDraft, To: CaseSubmitted, Name: "submit"},
    },
    CaseSubmitted: {
        CaseClosed: {From: CaseSubmitted, To: CaseClosed, Name: "close"},
    },
}
```

---

## 16. Caches

### 16.1 Every Cache Must Have an Invalidation Policy

The agent MUST NOT add a cache unless it defines:

- key canonicalization;
- value ownership;
- max entries or max bytes;
- TTL or invalidation trigger;
- eviction policy;
- concurrency model;
- stale read policy;
- error behavior;
- metrics.

Forbidden:

```go
var cache = map[string]Result{}
```

Preferred:

```go
type CacheConfig struct {
    MaxEntries int
    TTL        time.Duration
}
```

### 16.2 Cache Values Must Not Be Mutable Shared Objects

Returned cache values MUST be immutable or cloned.

```go
func (c *Cache) Get(id CaseID) (CaseSnapshot, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()

    v, ok := c.items[id]
    return v, ok // acceptable if CaseSnapshot is immutable value
}
```

For slices/maps:

```go
return slices.Clone(v.Events), true
```

---

## 17. Iterators and Go 1.23+ Sequence APIs

### 17.1 Iterator Use Must Preserve Ownership and Determinism

When using `iter`, `slices`, or `maps` sequence APIs:

- state whether iteration order is deterministic;
- do not mutate the underlying collection while iterating unless explicitly safe;
- do not leak references to mutable internal values;
- document early-stop behavior;
- convert to sorted slice before deterministic output.

Preferred deterministic map keys:

```go
ids := slices.Sorted(maps.Keys(index))
```

### 17.2 Do Not Use Iterators to Hide Expensive Work

Iterator functions MUST document if iteration performs I/O, locking, allocation, or blocking work.

Forbidden:

```go
func (r *Repo) All() iter.Seq[Case] // silently performs DB calls while iterating
```

Preferred:

```go
func (r *Repo) StreamCases(ctx context.Context, fn func(Case) error) error
```

---

## 18. Generics for Data Structures

### 18.1 Generic Structures Must Earn Their Abstraction

The agent MUST NOT create generic containers just because Go supports generics.

Allowed:

- reused package-local helpers;
- type-safe set, stack, queue with clear semantics;
- algorithmic structures independent of domain;
- test helpers.

Forbidden:

```go
type Repository[T any] interface {
    Save(context.Context, T) error
    Find(context.Context, string) (T, error)
}
```

when domain-specific behavior, identity, validation, or transaction boundaries differ.

### 18.2 Constraint Must Match Required Operations

Forbidden:

```go
func Contains[T any](items []T, target T) bool { // cannot compare T
    for _, item := range items {
        if item == target {
            return true
        }
    }
    return false
}
```

Preferred:

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

Use `cmp.Ordered` only when ordering operators are truly required.

---

## 19. Concurrency and Data Structures

### 19.1 Synchronization Is Part of the Structure

A concurrent data structure MUST define whether synchronization is internal or external.

Internal synchronization:

```go
type Store struct {
    mu sync.RWMutex
    byID map[CaseID]Case
}
```

External synchronization:

```go
// CaseIndex is not safe for concurrent use.
type CaseIndex map[CaseID]Case
```

The agent MUST document concurrency safety in exported types.

### 19.2 Do Not Return Locks or Mutable Internals

Forbidden:

```go
func (s *Store) Map() map[CaseID]Case {
    return s.byID
}
```

Preferred:

```go
func (s *Store) Snapshot() map[CaseID]Case {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return maps.Clone(s.byID)
}
```

If values are mutable, perform a deep clone.

---

## 20. Serialization Boundaries

Data structures used internally SHOULD NOT be forced to match JSON, database, or wire format shapes.

Rules:

- Internal maps may use named typed keys; DTOs may use strings.
- Internal sorted slices may become JSON arrays.
- Internal sets must define JSON shape explicitly.
- Do not serialize maps when output order is semantically important unless sorted externally.
- Do not use `map[string]any` as a domain data structure.
- Do not use reflection-heavy generic structures for hot paths without benchmark proof.

---

## 21. Error Handling for Data Structures

The agent MUST return explicit errors for invariant violations instead of silently repairing data when repair changes meaning.

Examples:

- duplicate key in unique index;
- unsorted input to binary-search-only structure;
- cycle in acyclic graph;
- invalid priority update;
- queue full;
- cache key cannot be canonicalized;
- nil dependency in structure constructor.

Preferred:

```go
var ErrDuplicateCaseID = errors.New("duplicate case id")
```

Wrap with context:

```go
return fmt.Errorf("build case index: %w: %s", ErrDuplicateCaseID, id)
```

---

## 22. Testing Requirements

### 22.1 Required Tests for Non-Trivial Structures

Every non-trivial data structure MUST have tests for:

- zero value behavior;
- empty input;
- single element;
- duplicate handling;
- nil input, if applicable;
- deterministic order, if required;
- mutation after insertion;
- mutation after retrieval;
- concurrency safety, if claimed;
- boundary capacity;
- deletion and GC retention for pointer-like values;
- serialization contract, if exposed.

### 22.2 Property/Fuzz Testing

Fuzz or property tests SHOULD be used for:

- parsers producing structures;
- graph algorithms;
- custom heaps;
- ring buffers;
- indexes with multiple derived maps;
- sorting/dedup normalization;
- state transition tables.

Example property:

```go
func TestSortedSetInvariant(t *testing.T) {
    set := NewSortedSet([]CaseID{"B", "A", "B"})
    if !slices.IsSorted(set.ids) {
        t.Fatal("ids not sorted")
    }
    if slices.Contains(set.ids[:1], set.ids[1]) {
        t.Fatal("duplicate retained")
    }
}
```

### 22.3 Cross-Check With Simple Implementation

Complex structures SHOULD be tested against a slow, obvious implementation.

```go
func TestPriorityQueueMatchesSort(t *testing.T) {
    // Push into heap and into slice.
    // Pop heap and compare against sorted slice order.
}
```

---

## 23. Benchmarking Requirements

Benchmark before replacing simple structures with complex ones.

Required benchmark dimensions:

- realistic size distribution;
- allocation count;
- read/write ratio;
- mutation pattern;
- key distribution;
- cache hit/miss distribution;
- concurrency level;
- deterministic output cost;
- GC behavior.

Forbidden benchmark style:

```go
func BenchmarkThing(b *testing.B) {
    for i := 0; i < b.N; i++ {
        // unrealistic tiny fixed input
    }
}
```

Preferred:

```go
func BenchmarkIndexLookup_100k(b *testing.B) {
    index := buildIndex(100_000)
    keys := makeLookupKeys(10_000)

    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = index.Get(keys[i%len(keys)])
    }
}
```

---

## 24. Observability Requirements

Long-lived data structures SHOULD expose metrics or diagnostics when they affect production behavior.

Examples:

- queue depth;
- dropped/enqueued/dequeued count;
- cache size/hits/misses/evictions;
- index rebuild duration;
- graph node/edge count;
- heap length;
- memory estimate;
- invariant check failures;
- snapshot generation latency.

The agent MUST NOT add high-cardinality labels such as raw user ID, case ID, or request ID to metrics.

---

## 25. Security and Defensiveness

The agent MUST treat attacker-controlled input as untrusted structure size.

Rules:

- enforce max input length before allocation;
- enforce max map entries for decoded maps;
- enforce max nesting depth for tree/graph construction;
- reject duplicate keys if duplicates change semantics;
- avoid unbounded recursion;
- avoid regex or parser output producing unbounded structures;
- avoid `map[string]any` from untrusted JSON without schema validation;
- avoid using user-provided strings directly as cache keys without canonicalization and size limits.

---

## 26. Forbidden Anti-Patterns

The agent MUST NOT introduce these patterns:

```go
// Raw map as public mutable API.
func (s *Service) Data() map[string]any
```

```go
// Data structure with implicit ordering from map iteration.
for k := range m { return k }
```

```go
// Unbounded process-lifetime cache.
var cache = map[string]Result{}
```

```go
// Generic container hiding domain invariants.
type EntityStore[T any] struct { data map[string]T }
```

```go
// Slice sub-view escaping without capacity control or clone.
return payload[:n]
```

```go
// Concurrent map access without synchronization.
go func() { m[k] = v }()
_ = m[k]
```

```go
// `container/list` chosen before measuring or proving need.
list.New()
```

```go
// Deep graph recursion on untrusted input.
func visit(n Node) { for _, c := range n.Children { visit(c) } }
```

---

## 27. LLM Implementation Protocol

Before changing a data structure, the agent MUST perform this protocol:

1. Identify current invariant.
2. Identify current callers and mutation paths.
3. Identify API exposure and serialization impact.
4. Identify deterministic output requirements.
5. Identify concurrency assumptions.
6. Compare complexity before and after.
7. Compare memory and allocation behavior before and after.
8. Add or update invariant tests.
9. Add benchmark when performance is the motivation.
10. Explain why the new structure is simpler or more correct.

The agent MUST NOT perform a “refactor” that changes map/slice ownership behavior silently.

---

## 28. Review Checklist

A Go data structure change is mergeable only if all applicable items are true:

- [ ] The structure choice is justified by invariants and workload.
- [ ] Slice/map ownership is explicit.
- [ ] Caller mutation cannot corrupt internal state.
- [ ] Map iteration order is not used accidentally.
- [ ] Nil vs empty behavior is intentional.
- [ ] Duplicate handling is explicit.
- [ ] Order semantics are explicit.
- [ ] Concurrency safety is documented.
- [ ] Boundedness is defined for queues/caches/buffers.
- [ ] Long-lived structures do not retain obsolete pointer-like values.
- [ ] Public APIs do not expose mutable internals.
- [ ] Tests cover zero, empty, one, many, duplicate, and mutation cases.
- [ ] Benchmarks exist if complexity/performance motivated the change.
- [ ] Serialization contracts are preserved or explicitly migrated.
- [ ] Security limits exist for untrusted input.

---

## 29. Minimal Good Examples

### 29.1 Deterministic Set

```go
type CaseID string

type CaseIDSet struct {
    ids map[CaseID]struct{}
}

func NewCaseIDSet(values []CaseID) CaseIDSet {
    ids := make(map[CaseID]struct{}, len(values))
    for _, id := range values {
        ids[id] = struct{}{}
    }
    return CaseIDSet{ids: ids}
}

func (s CaseIDSet) Contains(id CaseID) bool {
    _, ok := s.ids[id]
    return ok
}

func (s CaseIDSet) Values() []CaseID {
    values := make([]CaseID, 0, len(s.ids))
    for id := range s.ids {
        values = append(values, id)
    }
    slices.Sort(values)
    return values
}
```

### 29.2 Immutable Snapshot Store

```go
type CaseStore struct {
    mu   sync.RWMutex
    byID map[CaseID]CaseSnapshot
}

func NewCaseStore() *CaseStore {
    return &CaseStore{byID: make(map[CaseID]CaseSnapshot)}
}

func (s *CaseStore) Put(c CaseSnapshot) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.byID[c.ID] = c
}

func (s *CaseStore) Snapshot() map[CaseID]CaseSnapshot {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return maps.Clone(s.byID)
}
```

---

## 30. Final Rule

The simplest Go data structure is usually the best one only when its invariants are explicit.

The agent MUST optimize for:

1. correctness;
2. ownership clarity;
3. deterministic behavior where required;
4. bounded resource use;
5. testability;
6. then performance.

A clever structure without a stated invariant is not acceptable.

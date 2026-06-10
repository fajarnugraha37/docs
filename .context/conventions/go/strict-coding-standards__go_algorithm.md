# Strict Coding Standards — Go Algorithm

**File:** `strict-coding-standards__go_algorithm.md`  
**Scope:** Algorithm design, complexity, sorting, searching, deduplication, graph traversal, dynamic programming, streaming, batching, numeric correctness, concurrency, benchmarking, fuzzing, and production safety in Go.  
**Audience:** LLM coding agents, reviewers, and engineers implementing or modifying Go algorithms.  
**Status:** Mandatory merge gate.  
**Last updated:** 2026-06-10.

---

## 0. Non-Negotiable Rule

An algorithm is not acceptable merely because it passes the sample test.

An LLM coding agent MUST NOT implement or replace an algorithm unless it can state:

1. input domain;
2. maximum expected input size;
3. worst-case input size;
4. time complexity;
5. memory complexity;
6. ordering and determinism requirements;
7. failure behavior;
8. overflow/precision behavior;
9. cancellation behavior, if long-running;
10. test strategy beyond happy path.

If the agent cannot answer these, it MUST implement the simplest correct version, state assumptions, and avoid pretending performance is proven.

---

## 1. Source Authority

This standard is derived from official Go references:

- Go Language Specification: https://go.dev/ref/spec
- Effective Go: https://go.dev/doc/effective_go
- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- `sort` package: https://pkg.go.dev/sort
- `slices` package: https://pkg.go.dev/slices
- `maps` package: https://pkg.go.dev/maps
- `cmp` package: https://pkg.go.dev/cmp
- `container/heap`: https://pkg.go.dev/container/heap
- `math/bits`: https://pkg.go.dev/math/bits
- `math/big`: https://pkg.go.dev/math/big
- `testing` package: https://pkg.go.dev/testing
- Fuzzing: https://go.dev/doc/security/fuzz
- Profiling Go Programs: https://go.dev/blog/pprof
- Diagnostics: https://go.dev/doc/diagnostics
- Go Memory Model: https://go.dev/ref/mem

---

## 2. Required Algorithm Decision Record

For every non-trivial algorithm, the agent MUST add or update a short comment near the function.

```go
// ResolveEscalations computes due escalation actions.
// Complexity:
//   - O(n log n) due to deterministic sort by deadline and case ID;
//   - O(n) additional memory for output and seen set.
// Invariants:
//   - output order is deterministic;
//   - an escalation is emitted at most once per case ID;
//   - cancelled context stops before processing the next case;
//   - invalid deadlines are returned as errors, not silently ignored.
func ResolveEscalations(ctx context.Context, cases []Case) ([]Escalation, error) {
    // ...
}
```

The decision record MAY be omitted for local, obvious O(n) loops with no boundary or domain consequence.

---

## 3. Algorithm Selection Rules

### 3.1 Correctness Before Performance

The agent MUST first make correctness explicit:

- What result is valid?
- What inputs are invalid?
- How are ties handled?
- Is the output deterministic?
- Are duplicates allowed?
- Is there a stable ordering requirement?
- What happens when data is incomplete?

Only after this may the agent optimize.

### 3.2 Complexity Must Match Input Scale

The agent MUST NOT use algorithms with avoidable quadratic behavior for unbounded or production-sized input.

Forbidden:

```go
for _, a := range allCases {
    for _, b := range allUsers {
        if a.UserID == b.ID {
            // join
        }
    }
}
```

Preferred:

```go
usersByID := make(map[UserID]User, len(users))
for _, user := range users {
    usersByID[user.ID] = user
}

for _, c := range cases {
    user, ok := usersByID[c.UserID]
    if !ok {
        return nil, fmt.Errorf("case %s user %s: %w", c.ID, c.UserID, ErrUserNotFound)
    }
    // join
}
```

### 3.3 Bound Memory Before Allocation

The agent MUST validate or cap untrusted input before allocating.

Forbidden:

```go
buf := make([]byte, declaredLength) // declaredLength from client
```

Preferred:

```go
if declaredLength < 0 || declaredLength > maxPayloadBytes {
    return nil, fmt.Errorf("payload length %d exceeds limit %d", declaredLength, maxPayloadBytes)
}
buf := make([]byte, declaredLength)
```

---

## 4. Sorting

### 4.1 Prefer `slices.SortFunc` / `slices.SortStableFunc` for Typed Slices

For modern Go, prefer `slices` over `sort.Slice` when sorting typed slices.

Preferred:

```go
slices.SortFunc(cases, func(a, b Case) int {
    if c := a.Deadline.Compare(b.Deadline); c != 0 {
        return c
    }
    return cmp.Compare(a.ID, b.ID)
})
```

Use `sort.Slice` only when there is a reason, such as legacy Go version or existing interface.

### 4.2 Comparator Must Be a Strict Weak Ordering

The comparator MUST be transitive, deterministic, and consistent with equality.

Forbidden:

```go
slices.SortFunc(items, func(a, b Item) int {
    return int(a.Score - b.Score) // overflow or precision loss
})
```

Preferred:

```go
slices.SortFunc(items, func(a, b Item) int {
    return cmp.Compare(a.Score, b.Score)
})
```

For multi-key sort:

```go
slices.SortFunc(items, func(a, b Item) int {
    if c := cmp.Compare(a.Priority, b.Priority); c != 0 {
        return -c // descending priority
    }
    if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
        return c
    }
    return cmp.Compare(a.ID, b.ID)
})
```

### 4.3 Floating-Point Sorting Must Handle NaN Explicitly

The agent MUST NOT rely on plain `<` for floats if NaN may exist.

Preferred:

```go
slices.SortFunc(values, func(a, b float64) int {
    return cmp.Compare(a, b)
})
```

If domain rules require NaN last, define it explicitly.

### 4.4 Stable Sort Is Mandatory When Equal-Key Order Matters

Use stable sort when:

- preserving input order is part of API behavior;
- sorting by secondary keys in multiple passes;
- reports must retain previous grouping order;
- regulatory/audit output depends on stable tie handling.

Preferred:

```go
slices.SortStableFunc(rows, compareByDisplayGroup)
```

Forbidden:

```go
sort.Slice(rows, less) // when equal rows must preserve original order
```

### 4.5 Sorting Must Not Hide Mutation of Caller-Owned Input

If input order is caller-owned, clone first.

Forbidden:

```go
func TopCases(cases []Case) []Case {
    slices.SortFunc(cases, compareCases)
    return cases[:min(10, len(cases))]
}
```

Preferred:

```go
func TopCases(cases []Case) []Case {
    sorted := slices.Clone(cases)
    slices.SortFunc(sorted, compareCases)
    return sorted[:min(10, len(sorted))]
}
```

---

## 5. Searching

### 5.1 Linear Search Is Acceptable Only When Scale Is Bounded or Small

Linear search is acceptable when:

- collection is tiny;
- collection is scanned once;
- no lookup index is reused;
- preserving order is more important than lookup speed;
- code clarity dominates and size is bounded.

Otherwise, build an index or sort and binary search.

### 5.2 Binary Search Requires a Proven Monotonic Predicate

The agent MUST NOT use binary search unless the data is sorted or the predicate is monotonic.

Forbidden:

```go
i := sort.Search(len(items), func(i int) bool {
    return items[i].Status == StatusReady // not monotonic
})
```

Preferred:

```go
slices.SortFunc(items, compareByDeadline)
i, found := slices.BinarySearchFunc(items, targetDeadline, func(item Item, target time.Time) int {
    return item.Deadline.Compare(target)
})
```

### 5.3 Binary Search Not Found Is an Insertion Point

The agent MUST remember that `sort.Search` and `slices.BinarySearch` do not use `-1` as not-found.

Preferred:

```go
i, found := slices.BinarySearch(ids, id)
if !found {
    ids = slices.Insert(ids, i, id)
}
```

---

## 6. Deduplication

### 6.1 Dedup Must Define Equality and Order

Before deduplicating, the agent MUST define:

- equality key;
- whether first or last wins;
- whether output order is preserved;
- whether canonicalization is needed;
- what happens on conflicting duplicate data.

Preserve input order:

```go
func UniquePreserveOrder[T comparable](in []T) []T {
    seen := make(map[T]struct{}, len(in))
    out := make([]T, 0, len(in))
    for _, v := range in {
        if _, ok := seen[v]; ok {
            continue
        }
        seen[v] = struct{}{}
        out = append(out, v)
    }
    return out
}
```

Deterministic sorted unique:

```go
func UniqueSorted[T cmp.Ordered](in []T) []T {
    out := slices.Clone(in)
    slices.Sort(out)
    return slices.Compact(out)
}
```

### 6.2 Duplicate Conflict Must Not Be Silently Ignored

Forbidden:

```go
byID[c.ID] = c // last wins accidentally
```

Preferred:

```go
if existing, ok := byID[c.ID]; ok && existing != c {
    return fmt.Errorf("duplicate case id %s with conflicting value: %w", c.ID, ErrDuplicate)
}
byID[c.ID] = c
```

---

## 7. Grouping and Joining

### 7.1 Grouping Must Control Slice Ownership

Preferred:

```go
groups := make(map[OwnerID][]CaseID)
for _, c := range cases {
    groups[c.OwnerID] = append(groups[c.OwnerID], c.ID)
}
for owner := range groups {
    slices.Sort(groups[owner])
}
```

If group values are mutable objects, store immutable IDs or snapshots instead of pointers unless mutation is intended.

### 7.2 Joins Must Validate Missing References

Forbidden:

```go
user := usersByID[c.UserID]
out = append(out, BuildRow(c, user)) // zero-value user hides data integrity issue
```

Preferred:

```go
user, ok := usersByID[c.UserID]
if !ok {
    return nil, fmt.Errorf("case %s references missing user %s: %w", c.ID, c.UserID, ErrReferenceNotFound)
}
out = append(out, BuildRow(c, user))
```

---

## 8. Merge, Diff, and Reconciliation

### 8.1 Diff Algorithms Must Define Identity and Change Semantics

Required decisions:

- identity key;
- field equality;
- create/update/delete ordering;
- conflict handling;
- stable output order;
- idempotency.

Preferred pattern:

```go
func DiffCases(oldCases, newCases []Case) (Diff, error) {
    oldByID, err := indexUnique(oldCases)
    if err != nil {
        return Diff{}, err
    }
    newByID, err := indexUnique(newCases)
    if err != nil {
        return Diff{}, err
    }

    ids := make(map[CaseID]struct{}, len(oldByID)+len(newByID))
    for id := range oldByID { ids[id] = struct{}{} }
    for id := range newByID { ids[id] = struct{}{} }

    ordered := make([]CaseID, 0, len(ids))
    for id := range ids { ordered = append(ordered, id) }
    slices.Sort(ordered)

    // produce deterministic diff
    return buildDiff(ordered, oldByID, newByID), nil
}
```

---

## 9. Pagination and Windowing

### 9.1 Offset Pagination Must Be Bounded

The agent MUST NOT implement unbounded offset scans over large in-memory or database-backed collections without limits.

Rules:

- validate `limit`;
- cap maximum `limit`;
- define deterministic sort order;
- prefer cursor pagination for mutable datasets;
- include tie-breaker key in cursor;
- avoid using map iteration as source order.

Preferred cursor concept:

```go
type Cursor struct {
    LastCreatedAt time.Time
    LastID        CaseID
}
```

### 9.2 Window Boundaries Must Be Half-Open

Use `[start, end)` for index ranges unless a domain standard says otherwise.

Forbidden ambiguity:

```go
func Window(start, end int) []T // is end inclusive?
```

Preferred:

```go
// Window returns items in the half-open range [start, end).
func Window[T any](items []T, start, end int) ([]T, error)
```

---

## 10. Streaming Algorithms

### 10.1 Do Not Load Everything If Streaming Is Natural

Forbidden:

```go
b, err := io.ReadAll(r)
// parse giant file
```

for unbounded input.

Preferred:

```go
scanner := bufio.NewScanner(r)
scanner.Buffer(make([]byte, 64*1024), maxTokenBytes)
for scanner.Scan() {
    if err := process(scanner.Bytes()); err != nil {
        return err
    }
}
if err := scanner.Err(); err != nil {
    return err
}
```

Use `bufio.Reader`, custom tokenizer, or streaming decoder when tokens may exceed `bufio.Scanner` limits.

### 10.2 Streaming Must Define Partial Failure Behavior

The agent MUST define whether partial results are:

- discarded;
- returned with error;
- checkpointed;
- retried;
- sent to dead-letter path;
- compensated.

This is mandatory for ingestion, migration, event processing, report generation, and batch jobs.

---

## 11. Graph Algorithms

### 11.1 BFS/DFS Must Define Cycle Behavior

Forbidden:

```go
func visit(n Node) {
    for _, next := range graph[n] {
        visit(next) // infinite recursion on cycle
    }
}
```

Preferred:

```go
func DFS(start NodeID, graph map[NodeID][]NodeID, fn func(NodeID) error) error {
    seen := map[NodeID]struct{}{}
    stack := []NodeID{start}

    for len(stack) > 0 {
        n := len(stack) - 1
        node := stack[n]
        stack = stack[:n]

        if _, ok := seen[node]; ok {
            continue
        }
        seen[node] = struct{}{}

        if err := fn(node); err != nil {
            return err
        }

        next := slices.Clone(graph[node])
        slices.Sort(next) // deterministic traversal
        for i := len(next) - 1; i >= 0; i-- {
            stack = append(stack, next[i])
        }
    }
    return nil
}
```

### 11.2 Topological Sort Must Detect Cycles

Any dependency ordering algorithm MUST return an error on cycle.

Required tests:

- no nodes;
- single node;
- disconnected graph;
- chain;
- diamond;
- cycle;
- self-cycle;
- deterministic tie ordering.

### 11.3 Workflow Graph Algorithms Must Be Auditable

For regulatory/case workflow graphs:

- illegal transition must be distinguishable from missing data;
- terminal state behavior must be explicit;
- graph traversal must be deterministic;
- transition evaluation must not mutate state until validation succeeds;
- audit event generation must be coupled to successful transition;
- replay must produce the same state from the same event sequence.

---

## 12. Dynamic Programming and Memoization

### 12.1 Memoization Requires a Bounded Key Space

Forbidden:

```go
var memo = map[string]Result{} // unbounded process lifetime
```

Preferred:

```go
func solve(input Input) (Result, error) {
    memo := make(map[stateKey]Result)
    // bounded to this call
}
```

Long-lived memoization is a cache and MUST follow cache rules: max size, TTL/invalidation, concurrency, and metrics.

### 12.2 DP Must Explain State and Transition

For DP algorithms, document:

- state definition;
- base case;
- transition;
- iteration order;
- memory reduction, if any;
- overflow behavior.

Forbidden:

```go
// magic recurrence copied without explanation
```

---

## 13. Numeric Algorithms

### 13.1 Avoid Overflow in Midpoint and Difference

Forbidden:

```go
mid := (lo + hi) / 2
```

Preferred:

```go
mid := lo + (hi-lo)/2
```

Forbidden comparator:

```go
return int(a.Amount - b.Amount)
```

Preferred:

```go
return cmp.Compare(a.Amount, b.Amount)
```

### 13.2 Money and Decimal-Like Algorithms Must Not Use Float

Forbidden:

```go
fee := amount * 0.07
```

Preferred:

```go
type MoneyCents int64
fee := amountCents * 7 / 100
```

If precision exceeds fixed integer modelling, use a vetted decimal package or `math/big` with explicit scale and rounding rules.

### 13.3 Floating-Point Algorithms Must Define Tolerance

The agent MUST NOT compare floats with `==` unless exact representation is intended.

Preferred:

```go
func NearlyEqual(a, b, epsilon float64) bool {
    return math.Abs(a-b) <= epsilon
}
```

The epsilon MUST be domain-specific; do not use arbitrary global constants.

### 13.4 Bit Algorithms Must Use `math/bits` Where Appropriate

Preferred:

```go
ones := bits.OnesCount64(mask)
```

instead of handwritten loops, unless the custom behavior is domain-specific and tested.

---

## 14. Randomized Algorithms

### 14.1 Security Randomness Must Use `crypto/rand`

Forbidden:

```go
token := make([]byte, 32)
mathrand.Read(token)
```

Preferred:

```go
token := make([]byte, 32)
if _, err := rand.Read(token); err != nil {
    return "", err
}
```

where `rand` is `crypto/rand`.

### 14.2 Deterministic Tests Must Use Controlled Sources

For randomized non-security algorithms, inject the random source.

```go
type Shuffler struct {
    rnd *rand.Rand
}
```

Do not make tests flaky by relying on time-seeded randomness.

### 14.3 Randomization Must Not Decide Regulatory Outcomes

Randomized selection, sampling, or tie-breaking MUST NOT affect enforcement, eligibility, licensing, audit, or legal outcomes unless the randomness itself is a documented, approved business requirement with auditable seed/source.

---

## 15. Concurrency in Algorithms

### 15.1 Parallelism Must Preserve Semantics

The agent MUST NOT parallelize an algorithm unless it defines:

- bounded goroutine count;
- cancellation;
- error propagation;
- output ordering;
- shared state protection;
- deterministic reduction;
- memory amplification.

Forbidden:

```go
for _, item := range items {
    go process(item)
}
```

Preferred:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(workerLimit)

results := make([]Result, len(items))
for i, item := range items {
    i, item := i, item
    g.Go(func() error {
        result, err := process(ctx, item)
        if err != nil {
            return err
        }
        results[i] = result // each goroutine owns one slot
        return nil
    })
}
if err := g.Wait(); err != nil {
    return nil, err
}
return results, nil
```

### 15.2 Parallel Reduction Must Be Associative or Ordered

The agent MUST NOT parallelize reductions unless the operation is associative/commutative or the reduction order is controlled.

Forbidden:

```go
// floating-point sum in arbitrary goroutine order
```

Preferred:

- deterministic chunking and ordered merge;
- integer aggregation when exact;
- documented precision tolerance;
- sequential algorithm when order affects result.

---

## 16. Recursion

### 16.1 Avoid Recursion for Untrusted Depth

Go goroutine stacks grow, but recursion can still overflow or cause uncontrolled memory use.

Use iterative algorithms for:

- user-provided trees;
- graphs;
- deeply nested JSON/XML/YAML;
- dependency graphs;
- expression trees from untrusted input.

If recursion is used, define max depth.

```go
func visit(n Node, depth int) error {
    if depth > maxDepth {
        return ErrMaxDepthExceeded
    }
    // ...
}
```

---

## 17. State Machine Algorithms

### 17.1 State Transitions Must Be Table-Driven or Explicitly Guarded

Forbidden:

```go
if status == "submitted" && action == "approve" {
    status = "approved"
}
```

Preferred:

```go
type TransitionKey struct {
    From   State
    Action Action
}

var transitions = map[TransitionKey]State{
    {From: Draft, Action: Submit}: Submitted,
    {From: Submitted, Action: Approve}: Approved,
}
```

### 17.2 State Algorithm Must Separate Decision From Side Effect

Preferred:

```go
next, events, err := machine.Decide(current, command)
if err != nil {
    return err
}
if err := repo.SaveTransition(ctx, current.ID, next, events); err != nil {
    return err
}
```

Forbidden:

```go
sendEmail()
state = Approved
save(state)
```

where side effects can happen before persistence succeeds.

---

## 18. Retry, Backoff, and Polling Algorithms

### 18.1 Retry Must Be Bounded and Classified

The agent MUST define:

- retryable errors;
- max attempts or max elapsed time;
- backoff schedule;
- jitter, if needed;
- context cancellation;
- idempotency requirement;
- observability.

Forbidden:

```go
for {
    err := call()
    if err == nil { return nil }
}
```

Preferred:

```go
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := call(ctx)
    if err == nil {
        return nil
    }
    if !isRetryable(err) {
        return err
    }

    wait := backoff(attempt)
    timer := time.NewTimer(wait)
    select {
    case <-ctx.Done():
        if !timer.Stop() { <-timer.C }
        return context.Cause(ctx)
    case <-timer.C:
    }
}
return ErrRetryExhausted
```

### 18.2 Polling Must Have Exit Conditions

Polling requires:

- timeout/deadline;
- interval/backoff;
- max attempts;
- terminal success condition;
- terminal failure condition;
- cancellation;
- metrics/logging.

---

## 19. Parsing and Validation Algorithms

### 19.1 Parse Then Validate

Do not mix parsing, validation, mutation, and side effects in one loop unless the flow is explicitly transactional.

Preferred stages:

1. parse raw input;
2. normalize;
3. validate schema;
4. validate domain invariants;
5. apply mutation;
6. emit side effects/events.

### 19.2 Parser Algorithms Must Protect Against Resource Exhaustion

Required limits:

- maximum bytes;
- maximum tokens;
- maximum nesting depth;
- maximum field count;
- maximum line length;
- maximum decoded collection size;
- timeout/cancellation for long-running parse.

---

## 20. Security-Sensitive Algorithms

### 20.1 Do Not Implement Cryptographic Algorithms

The agent MUST NOT implement custom encryption, hashing, signing, password hashing, key exchange, MAC, token format, or random generator.

Use standard library or vetted packages.

Forbidden:

```go
func Encrypt(data []byte, key []byte) []byte { /* custom crypto */ }
```

### 20.2 Constant-Time Comparison for Secrets

Forbidden:

```go
if providedToken == expectedToken { ... }
```

Preferred:

```go
if subtle.ConstantTimeCompare(provided, expected) == 1 {
    // match
}
```

### 20.3 Algorithmic Complexity Attacks Must Be Considered

For untrusted input, the agent MUST consider:

- excessive map entries;
- pathological regex/input patterns;
- deeply nested structures;
- huge sort inputs;
- hash/canonicalization costs;
- repeated expensive normalization;
- N+1 I/O behavior.

---

## 21. Database and External-I/O Algorithms

### 21.1 Avoid N+1 Algorithms

Forbidden:

```go
for _, id := range ids {
    item, err := repo.FindByID(ctx, id)
    // ...
}
```

Preferred:

```go
items, err := repo.FindByIDs(ctx, ids)
```

Then validate missing IDs explicitly.

### 21.2 Batch Size Must Be Tuned and Bounded

Batch algorithms MUST define:

- max batch size;
- retry granularity;
- transaction boundary;
- partial failure behavior;
- ordering;
- idempotency.

---

## 22. Benchmarking Requirements

### 22.1 Benchmark Algorithmic Claims

If the agent claims an algorithm is faster, it MUST provide benchmark evidence or remove the claim.

Benchmark must include:

- representative input sizes;
- worst-case or adversarial input;
- allocation count;
- cold vs warm cache when relevant;
- stable output cost;
- comparison with simpler baseline.

Preferred:

```go
func BenchmarkResolveEscalations_100k(b *testing.B) {
    cases := generateCases(100_000)
    b.ReportAllocs()
    for b.Loop() {
        _, err := ResolveEscalations(context.Background(), cases)
        if err != nil {
            b.Fatal(err)
        }
    }
}
```

If using Go before `b.Loop`, use standard `for i := 0; i < b.N; i++`.

### 22.2 Benchmarks Must Not Mutate Shared Input Accidentally

If an algorithm sorts or mutates input, clone inside benchmark loop or prepare per-iteration input.

```go
for b.Loop() {
    in := slices.Clone(base)
    Run(in)
}
```

Otherwise the benchmark may measure already-sorted or already-mutated data.

---

## 23. Testing Requirements

### 23.1 Table Tests Are Mandatory for Branchy Algorithms

Required cases:

- nil/empty input;
- one element;
- many elements;
- duplicate values;
- invalid input;
- boundary values;
- max allowed size, when feasible;
- deterministic tie case;
- cancellation, when applicable;
- partial failure, when applicable.

### 23.2 Fuzzing Is Required for Parsers and Normalizers

Use fuzzing for:

- parsers;
- decoders;
- tokenizers;
- canonicalizers;
- path/name processors;
- graph builders from external input;
- algorithms with complex boundary conditions.

Fuzz tests MUST assert invariants, not only “no panic”.

Example:

```go
func FuzzNormalizeCaseID(f *testing.F) {
    f.Add("ABC-123")
    f.Fuzz(func(t *testing.T, raw string) {
        id, err := NormalizeCaseID(raw)
        if err != nil {
            return
        }
        if id == "" {
            t.Fatal("normalized id is empty")
        }
        if strings.ContainsAny(string(id), " \t\n") {
            t.Fatalf("id contains whitespace: %q", id)
        }
    })
}
```

### 23.3 Cross-Check With Naive Algorithm

For optimized algorithms, the agent SHOULD implement a simple reference algorithm in tests.

```go
func TestFastDiffMatchesSlowDiff(t *testing.T) {
    got := FastDiff(oldItems, newItems)
    want := SlowDiffReference(oldItems, newItems)
    if diff := cmp.Diff(want, got); diff != "" {
        t.Fatal(diff)
    }
}
```

The reference algorithm MUST be test-only if inefficient.

---

## 24. Observability Requirements

Long-running or production-critical algorithms SHOULD expose:

- processed item count;
- skipped item count;
- invalid item count;
- retry count;
- batch count;
- duration;
- queue depth, if any;
- memory estimate, if meaningful;
- cancellation reason;
- error classification.

Do not log every item in large loops. Log summaries and sample safely.

---

## 25. LLM Implementation Protocol

Before writing or modifying an algorithm, the agent MUST follow this protocol:

1. State input and output contract.
2. State invalid input behavior.
3. State ordering and duplicate behavior.
4. State complexity.
5. State memory behavior.
6. State mutation/ownership behavior.
7. State cancellation/deadline behavior if applicable.
8. Pick the simplest correct algorithm.
9. Add table tests.
10. Add fuzz/property tests for parsers or complex invariants.
11. Add benchmark if performance is the motivation.
12. Avoid adding concurrency unless sequential performance is insufficient and semantics are preserved.

---

## 26. Forbidden Anti-Patterns

The agent MUST NOT introduce these patterns:

```go
// Quadratic join over production collections.
for _, a := range as {
    for _, b := range bs {
        // match
    }
}
```

```go
// Comparator using subtraction.
return int(a.ID - b.ID)
```

```go
// Binary search over unsorted data.
sort.Search(len(items), predicateOverUnsortedItems)
```

```go
// Unbounded retry.
for { _ = call() }
```

```go
// Unbounded read-all.
b, _ := io.ReadAll(r)
```

```go
// Parallelism with unbounded goroutines.
for _, x := range xs { go f(x) }
```

```go
// Map output assumed deterministic.
for k := range m { out = append(out, k) }
```

```go
// State mutation before validation completes.
state = next
if err := validate(state); err != nil { return err }
```

```go
// Regulatory decision from random tie-break.
winner := candidates[rand.Intn(len(candidates))]
```

---

## 27. Review Checklist

A Go algorithm change is mergeable only if all applicable items are true:

- [ ] Input contract is explicit.
- [ ] Invalid input behavior is explicit.
- [ ] Complexity is documented for non-trivial algorithms.
- [ ] Memory behavior is bounded or justified.
- [ ] Output ordering is deterministic where required.
- [ ] Duplicate behavior is defined.
- [ ] Sorting comparator is transitive and overflow-safe.
- [ ] Binary search predicate is monotonic.
- [ ] Map iteration is not used for stable output.
- [ ] Long-running algorithm accepts context or has an external bound.
- [ ] Retry/polling algorithms are bounded.
- [ ] Numeric overflow/precision is handled.
- [ ] Untrusted input has size/depth limits.
- [ ] Tests cover boundary and adversarial cases.
- [ ] Fuzz/property tests exist for parsers/normalizers/complex invariants.
- [ ] Benchmark exists when performance motivated the design.
- [ ] Concurrency, if any, is bounded and deterministic where required.
- [ ] Side effects occur only after validation and persistence boundaries are correct.

---

## 28. Minimal Good Examples

### 28.1 Stable Deterministic Top-N

```go
func TopNByScore(items []Item, n int) []Item {
    if n <= 0 || len(items) == 0 {
        return nil
    }

    sorted := slices.Clone(items)
    slices.SortStableFunc(sorted, func(a, b Item) int {
        if c := cmp.Compare(b.Score, a.Score); c != 0 {
            return c
        }
        return cmp.Compare(a.ID, b.ID)
    })

    if n > len(sorted) {
        n = len(sorted)
    }
    return sorted[:n]
}
```

### 28.2 Bounded Batch Processing

```go
func ProcessInBatches(ctx context.Context, ids []CaseID, batchSize int, process func(context.Context, []CaseID) error) error {
    if batchSize <= 0 {
        return fmt.Errorf("batch size must be positive")
    }
    if batchSize > maxBatchSize {
        return fmt.Errorf("batch size %d exceeds max %d", batchSize, maxBatchSize)
    }

    for start := 0; start < len(ids); start += batchSize {
        if err := ctx.Err(); err != nil {
            return err
        }

        end := min(start+batchSize, len(ids))
        batch := ids[start:end:end]
        if err := process(ctx, batch); err != nil {
            return fmt.Errorf("process batch [%d,%d): %w", start, end, err)
        }
    }
    return nil
}
```

### 28.3 Cycle-Safe Topological Sort Skeleton

```go
type visitState uint8

const (
    unvisited visitState = iota
    visiting
    visited
)

func TopologicalSort(nodes []NodeID, edges map[NodeID][]NodeID) ([]NodeID, error) {
    orderedNodes := slices.Clone(nodes)
    slices.Sort(orderedNodes)

    state := make(map[NodeID]visitState, len(nodes))
    out := make([]NodeID, 0, len(nodes))

    var visit func(NodeID) error
    visit = func(n NodeID) error {
        switch state[n] {
        case visiting:
            return fmt.Errorf("cycle at %s: %w", n, ErrCycle)
        case visited:
            return nil
        }

        state[n] = visiting
        next := slices.Clone(edges[n])
        slices.Sort(next)
        for _, m := range next {
            if err := visit(m); err != nil {
                return err
            }
        }
        state[n] = visited
        out = append(out, n)
        return nil
    }

    for _, n := range orderedNodes {
        if err := visit(n); err != nil {
            return nil, err
        }
    }

    slices.Reverse(out)
    return out, nil
}
```

---

## 29. Final Rule

A Go algorithm is acceptable when it is:

1. correct for stated inputs;
2. explicit about invalid inputs;
3. deterministic where decisions or tests require it;
4. bounded in time and memory;
5. safe around numeric and mutation boundaries;
6. observable in production when long-running;
7. tested against edge cases;
8. benchmarked when performance is the reason.

The agent MUST NOT replace a simple correct algorithm with a complex one unless the complexity buys a documented invariant, scale requirement, or measured performance improvement.

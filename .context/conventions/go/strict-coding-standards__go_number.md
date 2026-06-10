# Strict Coding Standards — Go Numbers, Numeric Types, Precision, Overflow, Money, Counters, and Bit Operations

**File:** `strict-coding-standards__go_number.md`  
**Scope:** Go implementation performed by LLM/code agents involving numeric types, arithmetic, counters, quantities, money, percentages, rates, durations, IDs, pagination, bit flags, binary protocols, parsing, formatting, rounding, aggregation, overflow, and arbitrary precision.  
**Mode:** Mandatory merge gate. This document is not advice. It defines constraints the agent MUST follow before proposing or committing Go code.

---

## 1. Core Principle

Numeric code MUST model the meaning of a number, not merely choose a type that compiles.

The agent MUST classify every important number as one of:

1. **count** — non-negative integer quantity;
2. **index/offset/length** — memory or collection position;
3. **identifier** — numeric-looking token with no arithmetic meaning;
4. **money** — exact decimal-like value with currency and rounding rules;
5. **measurement** — quantity with units;
6. **ratio/percentage/rate** — bounded or unbounded fraction;
7. **timestamp/duration** — time value or elapsed time;
8. **bitset/flags** — integer used as binary state;
9. **hash/checksum** — numeric representation of bytes;
10. **scientific/approximate value** — floating-point acceptable;
11. **arbitrary precision** — integer/rational/float beyond machine limits.

The type choice MUST follow this classification.

---

## 2. Non-Negotiable Rules

### 2.1 Do Not Use Floating Point for Money

The agent MUST NOT represent money with `float32` or `float64`.

Forbidden:

```go
type Invoice struct {
    Amount float64
}
```

Required options:

```go
type Currency string

type Money struct {
    Currency Currency
    Minor    int64 // cents, sen, etc.; currency-specific minor unit
}
```

or a reviewed decimal library:

```go
type Money struct {
    Currency Currency
    Amount   decimal.Decimal
}
```

The code MUST define:

- currency;
- minor unit scale;
- rounding mode;
- tax/fee calculation order;
- serialization format;
- overflow behavior;
- database representation.

### 2.2 Do Not Use Numeric Types for Numeric-Looking Identifiers

Identifiers such as postal codes, account numbers, case numbers, phone numbers, tax IDs, and reference numbers MUST be strings or domain-specific text types unless arithmetic is required.

Forbidden:

```go
type PostalCode int
```

Required:

```go
type PostalCode string
```

Reasons:

- leading zeroes must be preserved;
- length matters;
- formatting matters;
- arithmetic is invalid;
- external systems may include letters or separators later.

### 2.3 Always Define Units

The agent MUST NOT create naked numeric fields where the unit is unclear.

Forbidden:

```go
type RetryPolicy struct {
    Timeout int
}
```

Required:

```go
type RetryPolicy struct {
    Timeout time.Duration
}
```

or:

```go
const MaxBodyBytes int64 = 10 << 20
```

Field names MUST include units when not encoded in the type:

```go
LimitBytes int64
RatePerSecond int64
TimeoutMillis int64 // only for wire compatibility; convert to time.Duration internally
```

### 2.4 Check Overflow Before It Matters

The agent MUST NOT assume integer arithmetic is safe. Go integer operations on non-constant values can overflow according to the type width.

Required for security/resource-sensitive arithmetic:

```go
if n > math.MaxInt-size {
    return errors.New("size overflow")
}
total := n + size
```

or use `math/bits` for checked arithmetic:

```go
sum, carry := bits.Add64(a, b, 0)
if carry != 0 {
    return 0, errors.New("uint64 overflow")
}
return sum, nil
```

### 2.5 Never Ignore Numeric Parse Errors

Every numeric parse MUST check errors and range.

Forbidden:

```go
n, _ := strconv.Atoi(s)
```

Required:

```go
n, err := strconv.ParseInt(s, 10, 32)
if err != nil {
    return 0, fmt.Errorf("parse limit: %w", err)
}
limit := int32(n)
```

### 2.6 Do Not Rely on `int` for External Contracts

Use `int` for local indexing, lengths, and idiomatic Go APIs. Do NOT use `int` in:

- wire formats;
- persistent storage schemas;
- JSON API contracts requiring stable width;
- cross-language protocols;
- cryptographic or binary formats;
- values that may exceed platform-dependent assumptions.

Use explicit widths:

```go
int32
int64
uint32
uint64
```

---

## 3. Type Selection Rules

### 3.1 `int`

Use `int` for:

- slice indexes;
- local loop counters;
- `len`/`cap` interoperability;
- small local counts that cannot cross API/storage boundaries;
- APIs that require `int`.

Do NOT use `int` for:

- database IDs;
- timestamps;
- file sizes;
- money;
- external API fields;
- binary protocol fields;
- values requiring exact bit width.

### 3.2 Signed Integers

Use signed integers when negative values are meaningful or when the standard library API uses signed values.

Examples:

```go
Delta int64
BalanceMinor int64
Offset int64
```

The agent MUST validate domain bounds even when the type allows wider values.

### 3.3 Unsigned Integers

Use unsigned integers only when the value is genuinely bit-oriented or dictated by protocol/API.

Appropriate:

- bit masks;
- hashes/checksums;
- binary protocol fields;
- counters that map to unsigned external formats;
- `math/bits` operations.

Avoid unsigned integers merely to express non-negative business values. They often create bugs around subtraction and comparison.

Forbidden:

```go
func Remaining(total, used uint) uint {
    return total - used // underflow if used > total
}
```

Required:

```go
func Remaining(total, used int64) (int64, error) {
    if used > total {
        return 0, errors.New("used exceeds total")
    }
    return total - used, nil
}
```

### 3.4 `float32` and `float64`

Use floating point only for approximate numeric domains:

- scientific calculations;
- telemetry sampling;
- averages where exact decimal representation is not required;
- percentages/rates where rounding error is acceptable and documented;
- graphics/geometry when acceptable.

Prefer `float64` unless storage/protocol/GPU constraints require `float32`.

Do NOT use floats for:

- money;
- exact counters;
- pagination;
- IDs;
- equality-sensitive domain state;
- legal/compliance thresholds requiring exact decimal rounding;
- retry counts;
- inventory.

### 3.5 Complex Numbers

Use `complex64`/`complex128` only for domains that genuinely need complex arithmetic.

Do NOT use complex numbers as pairs, coordinates, or generic two-value containers.

### 3.6 `math/big`

Use `math/big` for:

- arbitrary precision integers;
- rational arithmetic;
- high precision calculations;
- cryptographic/math algorithms where standard integer widths are insufficient.

The agent MUST remember `math/big` values are mutable through pointer receiver operations.

Forbidden:

```go
func Add(a, b *big.Int) *big.Int {
    return a.Add(a, b) // mutates a unexpectedly
}
```

Required:

```go
func Add(a, b *big.Int) *big.Int {
    return new(big.Int).Add(a, b)
}
```

### 3.7 Decimal Libraries

If exact decimal arithmetic is required beyond integer minor units, the agent MAY use an approved decimal package only after checking:

- rounding modes;
- scale handling;
- JSON/database representation;
- zero value behavior;
- immutability or mutation semantics;
- performance;
- maintenance/security posture;
- interoperability with existing systems.

Do NOT introduce a decimal dependency casually.

---

## 4. Constants and Untyped Numbers

### 4.1 Use Constants for Compile-Time Numeric Invariants

Use constants for values known at compile time:

```go
const MaxRetries = 3
const MaxBodyBytes int64 = 10 << 20
const PercentScale = 10_000 // basis points
```

### 4.2 Type Constants at Boundaries

Untyped constants are useful inside Go expressions, but exported constants and boundary values SHOULD be typed when width matters.

```go
const MaxMessageBytes int64 = 1 << 20
```

### 4.3 Avoid Magic Numbers

Every non-obvious numeric literal MUST be named.

Forbidden:

```go
if attempts > 7 { ... }
```

Required:

```go
const MaxLoginAttempts = 7
if attempts > MaxLoginAttempts { ... }
```

Exceptions:

- `0`, `1`, `-1` in obvious arithmetic;
- small loop increments;
- bit shifts where named masks are clearer elsewhere.

### 4.4 Use `iota` Only for Stable Internal Enums

`iota` is allowed for internal enum-like values.

```go
type Status int

const (
    StatusUnknown Status = iota
    StatusRequested
    StatusApproved
    StatusRejected
)
```

Do NOT expose raw `iota` values over APIs or persistent storage without explicit mapping.

Required:

```go
func (s Status) String() string { ... }
func ParseStatus(s string) (Status, error) { ... }
```

---

## 5. Parsing Rules

### 5.1 Use `strconv` for Numeric Parsing

Required:

```go
v, err := strconv.ParseInt(s, 10, 64)
if err != nil {
    return 0, fmt.Errorf("invalid amount_minor: %w", err)
}
```

Use `ParseUint` for unsigned external fields only when the domain is truly unsigned.

Use `ParseFloat` only for approximate domains.

### 5.2 Specify Base and Width

The agent MUST specify base and bit size.

```go
port, err := strconv.ParseUint(s, 10, 16)
```

Do NOT parse a port into plain `int` then validate loosely.

### 5.3 Validate Domain Range After Parsing

Parsing width is not enough for domain validation.

```go
n, err := strconv.ParseInt(s, 10, 64)
if err != nil {
    return 0, err
}
if n < 1 || n > 1000 {
    return 0, errors.New("page size must be between 1 and 1000")
}
```

### 5.4 Reject Ambiguous Text Formats

The agent MUST define whether numeric input allows:

- leading/trailing spaces;
- `+` sign;
- leading zeroes;
- underscores;
- decimal separators;
- exponent notation;
- `NaN`, `Inf`, `Infinity`;
- hexadecimal;
- locale-specific separators;
- percent suffix;
- currency symbols.

For APIs, prefer strict machine formats.

### 5.5 Do Not Accept NaN or Infinity Unless Explicit

For floating-point input, reject `NaN` and infinity unless the domain explicitly supports them.

```go
f, err := strconv.ParseFloat(s, 64)
if err != nil {
    return 0, err
}
if math.IsNaN(f) || math.IsInf(f, 0) {
    return 0, errors.New("finite value required")
}
```

---

## 6. Formatting Rules

### 6.1 Use `strconv` for Stable Machine Formatting

```go
s := strconv.FormatInt(v, 10)
s := strconv.FormatUint(v, 10)
s := strconv.FormatFloat(f, 'f', 2, 64)
```

Use `fmt` for human-readable messages, not stable protocol formatting unless explicitly reviewed.

### 6.2 Define Float Formatting Precision

The agent MUST NOT format floats without deciding precision.

Forbidden:

```go
fmt.Sprintf("%f", value) // implicit precision may be wrong
```

Required:

```go
strconv.FormatFloat(value, 'f', 6, 64)
```

or for round-trip:

```go
strconv.FormatFloat(value, 'g', -1, 64)
```

### 6.3 JSON Numeric Precision Must Be Reviewed

Large integers sent to JavaScript clients may lose precision if treated as JS numbers.

For IDs or exact large values, encode as strings:

```go
type Response struct {
    ID string `json:"id"`
}
```

Do NOT expose `int64` identifiers as JSON numbers to JS clients unless precision loss is impossible or accepted.

---

## 7. Arithmetic and Overflow

### 7.1 Addition

For bounded integer addition:

```go
func AddInt64(a, b int64) (int64, error) {
    if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
        return 0, errors.New("int64 overflow")
    }
    return a + b, nil
}
```

### 7.2 Multiplication

Multiplication MUST be checked in size, memory, billing, quota, and protocol code.

```go
func MulInt64(a, b int64) (int64, error) {
    if a == 0 || b == 0 {
        return 0, nil
    }
    if a == math.MinInt64 && b == -1 || b == math.MinInt64 && a == -1 {
        return 0, errors.New("int64 overflow")
    }
    r := a * b
    if r/b != a {
        return 0, errors.New("int64 overflow")
    }
    return r, nil
}
```

For unsigned hot paths, use `math/bits`:

```go
hi, lo := bits.Mul64(a, b)
if hi != 0 {
    return 0, errors.New("uint64 overflow")
}
return lo, nil
```

### 7.3 Subtraction

Subtraction MUST check underflow/overflow where values are bounded.

```go
if used > total {
    return 0, errors.New("used exceeds total")
}
remaining := total - used
```

### 7.4 Division

Every division MUST consider:

- division by zero;
- integer truncation;
- negative values;
- rounding direction;
- overflow for `MinInt / -1`;
- precision loss.

```go
if denominator == 0 {
    return 0, errors.New("division by zero")
}
q := numerator / denominator
```

### 7.5 Integer Division Must Be Explicitly Intended

Forbidden:

```go
ratio := completed / total // loses fraction
```

Required:

```go
ratio := float64(completed) / float64(total)
```

or exact scaled integer:

```go
basisPoints := completed * 10_000 / total
```

with overflow check.

---

## 8. Rounding Rules

### 8.1 Rounding Must Be Domain-Specific

The agent MUST NOT call `math.Round`, `math.Floor`, or `math.Ceil` without domain justification.

The code MUST specify:

- round half up;
- round half even;
- floor;
- ceiling;
- truncate toward zero;
- currency-specific rounding;
- tax-specific rounding;
- display-only rounding vs stored-value rounding.

### 8.2 Do Not Round Intermediate Money Values Casually

Financial calculations MUST define when rounding occurs.

Bad:

```go
fee := math.Round(amount * rate)
tax := math.Round(fee * taxRate)
```

Required:

- document calculation order;
- use integer minor units or decimal;
- test boundary values;
- match legal/business rule.

### 8.3 Display Rounding Must Not Mutate Stored Value

The agent MUST separate stored exact value from displayed rounded value.

---

## 9. Money Standards

### 9.1 Money Requires Currency

A monetary amount without currency is invalid except in narrow internal calculations with documented currency inherited from context.

Required:

```go
type Money struct {
    Currency Currency
    Minor    int64
}
```

### 9.2 Minor Units Must Be Currency-Aware

Do not assume every currency has 2 decimal places.

The agent MUST provide a currency scale table or depend on an approved money package if multiple currencies are supported.

### 9.3 Money Arithmetic Must Enforce Same Currency

```go
func (m Money) Add(n Money) (Money, error) {
    if m.Currency != n.Currency {
        return Money{}, errors.New("currency mismatch")
    }
    sum, err := AddInt64(m.Minor, n.Minor)
    if err != nil {
        return Money{}, err
    }
    return Money{Currency: m.Currency, Minor: sum}, nil
}
```

### 9.4 Percentages and Rates Must Use Scale

Prefer explicit scaled integers:

```go
type BasisPoints int64 // 1 bp = 0.01%
```

or a decimal type if fractional precision requires it.

The scale MUST appear in the type name, docs, or constructor.

---

## 10. Time and Duration Numbers

### 10.1 Use `time.Duration` for Durations

Do NOT store internal durations as naked integers.

Forbidden:

```go
Timeout int64
```

Required:

```go
Timeout time.Duration
```

At API boundaries, convert explicitly:

```go
timeout := time.Duration(req.TimeoutMillis) * time.Millisecond
```

with overflow/range checks.

### 10.2 Use `time.Time` for Timestamps

Do NOT use Unix timestamps internally unless required by boundary protocol.

Required:

```go
CreatedAt time.Time
```

If Unix time is used externally, field name MUST include unit:

```go
CreatedAtUnixSeconds int64 `json:"createdAtUnixSeconds"`
```

---

## 11. Counters, Metrics, and Atomic Numbers

### 11.1 Counters Must Define Reset and Monotonicity

For every counter, define whether it is:

- monotonic;
- resettable;
- eventually consistent;
- atomic;
- per-process;
- persisted;
- approximate.

### 11.2 Use `sync/atomic` for Shared Counters

Concurrent numeric state MUST be protected by `sync.Mutex`, channel ownership, or `sync/atomic`.

```go
var requests atomic.Uint64
requests.Add(1)
```

Do NOT use unsynchronized increments across goroutines.

### 11.3 Metrics Must Avoid High-Cardinality Numeric Labels

Do NOT put unbounded numeric values into metric labels.

Bad:

```go
requestCount.WithLabelValues(strconv.Itoa(userID)).Inc()
```

Use attributes/labels only for bounded dimensions.

---

## 12. Pagination, Limit, and Offset

### 12.1 Validate Pagination Strictly

```go
const (
    MinPageSize = 1
    MaxPageSize = 100
)

func ParsePageSize(s string) (int, error) {
    n, err := strconv.ParseInt(s, 10, 32)
    if err != nil {
        return 0, err
    }
    if n < MinPageSize || n > MaxPageSize {
        return 0, errors.New("invalid page size")
    }
    return int(n), nil
}
```

### 12.2 Offset Arithmetic Must Be Checked

```go
offset, err := MulInt64(int64(page-1), int64(pageSize))
if err != nil {
    return 0, err
}
```

### 12.3 Prefer Cursor Pagination for Large Datasets

The agent SHOULD prefer cursor pagination when offset becomes expensive or unstable under concurrent writes.

---

## 13. Bit Flags and Masks

### 13.1 Use Unsigned Types for Bitsets

```go
type Permission uint64

const (
    PermissionRead Permission = 1 << iota
    PermissionWrite
    PermissionApprove
)
```

### 13.2 Provide Methods, Not Raw Bit Twiddling Everywhere

```go
func (p Permission) Has(flag Permission) bool {
    return p&flag == flag
}

func (p Permission) With(flag Permission) Permission {
    return p | flag
}

func (p Permission) Without(flag Permission) Permission {
    return p &^ flag
}
```

### 13.3 Validate Unknown Bits at Boundaries

```go
const allPermissions = PermissionRead | PermissionWrite | PermissionApprove

func ValidatePermission(p Permission) error {
    if p&^allPermissions != 0 {
        return errors.New("unknown permission bits")
    }
    return nil
}
```

### 13.4 Use `math/bits` for Low-Level Bit Operations

Use `math/bits` for population count, leading/trailing zeros, rotations, checked add/mul, and division primitives.

Do NOT hand-roll bit hacks unless there is a measured reason and tests.

---

## 14. JSON, Database, and Wire Contracts

### 14.1 Numeric JSON Fields Must Have Stable Width Semantics

For public APIs, document numeric bounds.

```go
type Request struct {
    PageSize int32 `json:"pageSize"`
}
```

If the JSON decoder maps into `float64` through `map[string]any`, the agent MUST avoid precision-sensitive numeric handling or use `json.Decoder.UseNumber`.

```go
dec := json.NewDecoder(r)
dec.UseNumber()
```

### 14.2 Database Numeric Types Must Match Domain Semantics

Mapping examples:

| Domain            | Go type                             | Database type                           |
| ----------------- | ----------------------------------- | --------------------------------------- |
| count             | `int64`                             | `bigint`                                |
| money minor units | `int64`                             | `bigint`                                |
| exact decimal     | decimal library / string wrapper    | `numeric(p,s)`                          |
| timestamp         | `time.Time`                         | timestamp/timestamptz                   |
| ID                | string or int64 depending semantics | text/uuid/bigint                        |
| bit flags         | `uint64` or custom type             | bigint/numeric/bit varying depending DB |

The agent MUST not map money to floating database types.

### 14.3 Binary Protocols Must Use Explicit Endianness

```go
var b [8]byte
binary.BigEndian.PutUint64(b[:], value)
```

Do NOT rely on platform native layout.

---

## 15. Floating-Point Rules

### 15.1 Do Not Compare Floats Directly Unless Exact Semantics Are Intended

Allowed exact comparisons:

- checking `0` before division if value is known exact from integer conversion;
- `math.IsNaN` / `math.IsInf`;
- sentinel values explicitly designed.

For approximate calculations:

```go
func AlmostEqual(a, b, eps float64) bool {
    return math.Abs(a-b) <= eps
}
```

The epsilon MUST be chosen for the domain, not copied blindly.

### 15.2 Handle NaN Semantics

The agent MUST remember:

- `NaN != NaN`;
- sorting with NaN needs explicit policy;
- JSON encoding may reject NaN/Inf;
- database storage may behave differently.

### 15.3 Avoid Float Accumulation Error When Exact Aggregation Is Needed

For approximate metrics, float accumulation is acceptable. For billing, compliance, quota, or legal thresholds, use exact integer/decimal arithmetic.

---

## 16. Generics and Numeric Constraints

### 16.1 Do Not Create Over-Broad Numeric Generic Helpers

Forbidden:

```go
func Add[T ~int | ~int64 | ~float64](a, b T) T { return a + b }
```

unless the semantics are valid for every included type.

The agent MUST consider overflow, NaN, rounding, unsigned underflow, and domain units before writing generic numeric helpers.

### 16.2 Prefer Domain Methods Over Generic Arithmetic

Required:

```go
func (m Money) Add(n Money) (Money, error)
```

instead of:

```go
func Add[T constraints.Integer](a, b T) T
```

for domain values.

### 16.3 Generic Constraints Must Preserve Named Types When Needed

If named domain numeric types are accepted, use approximation constraints carefully:

```go
type Signed interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64
}
```

But do not expose such constraints in public APIs unless the abstraction is truly stable.

---

## 17. Security and Resource Protection

### 17.1 Size Calculations Must Be Safe

Any allocation size derived from input MUST be checked.

Forbidden:

```go
buf := make([]byte, count*size)
```

Required:

```go
if count < 0 || size < 0 {
    return errors.New("negative size")
}
total, err := MulInt64(count, size)
if err != nil {
    return err
}
if total > MaxAllocationBytes {
    return errors.New("allocation too large")
}
buf := make([]byte, int(total))
```

### 17.2 Quotas Must Not Overflow

Quota checks MUST avoid overflow bypasses.

Bad:

```go
if used+requested > quota { ... } // overflow can bypass
```

Required:

```go
if requested > quota-used {
    return errors.New("quota exceeded")
}
```

with prior validation that `used <= quota`.

### 17.3 Timeouts and Backoff Must Be Bounded

Backoff calculations MUST cap maximum duration and check multiplication/shift.

```go
func Backoff(base time.Duration, attempt int, max time.Duration) time.Duration {
    if attempt <= 0 {
        return base
    }
    if attempt > 30 { // prevent shift overflow / absurd duration
        return max
    }
    d := base << attempt
    if d <= 0 || d > max {
        return max
    }
    return d
}
```

---

## 18. Domain Modelling Patterns

### 18.1 Counts

```go
type Count int64

func NewCount(n int64) (Count, error) {
    if n < 0 {
        return 0, errors.New("count cannot be negative")
    }
    return Count(n), nil
}
```

### 18.2 Quantity With Unit

```go
type Bytes int64

type RatePerSecond int64
```

### 18.3 Percentage

```go
type BasisPoints int64

const HundredPercent BasisPoints = 10_000

func NewBasisPoints(v int64) (BasisPoints, error) {
    if v < 0 || v > int64(HundredPercent) {
        return 0, errors.New("basis points out of range")
    }
    return BasisPoints(v), nil
}
```

### 18.4 Version Numbers

For monotonic versions:

```go
type Version int64

func (v Version) Next() (Version, error) {
    n, err := AddInt64(int64(v), 1)
    return Version(n), err
}
```

### 18.5 Sequence Numbers

Sequence numbers MUST define wraparound behavior. If wraparound is not allowed, overflow MUST be an error.

---

## 19. Testing Requirements

Every numeric function MUST include tests for:

- zero;
- one;
- negative values if signed;
- max allowed value;
- just above max;
- min allowed value;
- just below min;
- `math.MaxInt*` and `math.MinInt*` where relevant;
- overflow boundary;
- division by zero;
- rounding boundary;
- NaN/Inf for float input;
- parse failure;
- leading zeroes if text input;
- large JSON numbers if API-facing;
- currency mismatch for money;
- different units if unit-aware.

### 19.1 Example Overflow Test

```go
func TestAddInt64(t *testing.T) {
    tests := []struct {
        name    string
        a, b    int64
        want    int64
        wantErr bool
    }{
        {"zero", 0, 0, 0, false},
        {"positive", 1, 2, 3, false},
        {"max overflow", math.MaxInt64, 1, 0, true},
        {"min overflow", math.MinInt64, -1, 0, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := AddInt64(tt.a, tt.b)
            if (err != nil) != tt.wantErr {
                t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
            }
            if !tt.wantErr && got != tt.want {
                t.Fatalf("got %d, want %d", got, tt.want)
            }
        })
    }
}
```

### 19.2 Fuzz Numeric Parsers

```go
func FuzzParsePageSize(f *testing.F) {
    f.Add("1")
    f.Add("100")
    f.Add("0")
    f.Add("-1")
    f.Add("999999999999999999999")

    f.Fuzz(func(t *testing.T, s string) {
        n, err := ParsePageSize(s)
        if err == nil && (n < MinPageSize || n > MaxPageSize) {
            t.Fatalf("accepted out-of-range page size: %d", n)
        }
    })
}
```

---

## 20. Code Review Checklist

Before merging numeric Go code, the agent MUST verify:

- [ ] The number's semantic category is clear: count, ID, money, duration, offset, percentage, etc.
- [ ] Units appear in the type or field name.
- [ ] Money is not represented with float.
- [ ] Numeric-looking identifiers are not accidentally numeric.
- [ ] External contracts do not use platform-dependent `int` unless justified.
- [ ] Parse errors are checked.
- [ ] Base and bit size are specified for parsing.
- [ ] Domain range is validated after parsing.
- [ ] Overflow/underflow is checked for size, quota, billing, memory, and version arithmetic.
- [ ] Division by zero is impossible or handled.
- [ ] Integer division/truncation is intentional.
- [ ] Rounding mode is explicit.
- [ ] Float NaN/Inf behavior is defined.
- [ ] JSON precision risk is reviewed.
- [ ] Database numeric type matches domain semantics.
- [ ] Bit flags validate unknown bits.
- [ ] Tests cover boundary and overflow cases.

---

## 21. Agent-Specific Operating Rules

When an LLM/code agent edits Go numeric code, it MUST:

1. classify each important number by domain meaning;
2. choose the smallest type that is semantically correct, not merely convenient;
3. avoid `float64` unless approximation is valid;
4. avoid `uint` merely to express non-negative domain values;
5. avoid `int` at external boundaries;
6. introduce domain types for money, percentages, durations, quantities, and versions;
7. check overflow before allocation, quota comparison, billing, and version increment;
8. define rounding policy before calculating money, tax, fees, or percentages;
9. add boundary tests before or together with implementation;
10. document any precision loss, truncation, rounding, or overflow behavior.

---

## 22. Common Anti-Patterns

### 22.1 Money as Float

```go
Amount float64
```

### 22.2 ID as Integer When Formatting Matters

```go
PhoneNumber int64
```

### 22.3 Unitless Field

```go
Timeout int
```

### 22.4 Ignored Parse Error

```go
n, _ := strconv.Atoi(s)
```

### 22.5 Overflow-Prone Allocation

```go
buf := make([]byte, count*size)
```

### 22.6 Unsigned Underflow

```go
remaining := quota - used
```

when both are unsigned and `used > quota` is possible.

### 22.7 Accidental Integer Division

```go
progress := done / total
```

### 22.8 Float Equality in Approximate Domain

```go
if score == threshold { ... }
```

### 22.9 Raw `iota` in Persistent Storage

```go
Status int `json:"status"`
```

where numeric values can change when constants are reordered.

### 22.10 Generic Numeric Helper With Hidden Semantics

```go
func Min[T ~int | ~uint | ~float64](a, b T) T
```

without defining NaN behavior or domain meaning.

---

## 23. Recommended Package Use

| Need                                       | Preferred package/API                           |
| ------------------------------------------ | ----------------------------------------------- |
| String-to-number conversion                | `strconv`                                       |
| Basic math functions                       | `math`                                          |
| Complex math functions                     | `math/cmplx`                                    |
| Checked/low-level bit operations           | `math/bits`                                     |
| Arbitrary precision integer/rational/float | `math/big`                                      |
| Binary protocol numeric encoding           | `encoding/binary`                               |
| Duration                                   | `time.Duration`                                 |
| Timestamp                                  | `time.Time`                                     |
| Atomic counters                            | `sync/atomic`                                   |
| JSON with large numbers                    | `encoding/json.Decoder.UseNumber`               |
| Exact decimal money                        | integer minor units or approved decimal package |

---

## 24. References

- Go Specification — numeric types, constants, conversions, arithmetic: https://go.dev/ref/spec
- Go Blog — Constants: https://go.dev/blog/constants
- `strconv` package: https://pkg.go.dev/strconv
- `math` package: https://pkg.go.dev/math
- `math/bits` package: https://pkg.go.dev/math/bits
- `math/big` package: https://pkg.go.dev/math/big
- `math/cmplx` package: https://pkg.go.dev/math/cmplx
- `encoding/binary` package: https://pkg.go.dev/encoding/binary
- `time` package: https://pkg.go.dev/time
- `sync/atomic` package: https://pkg.go.dev/sync/atomic
- `encoding/json` package: https://pkg.go.dev/encoding/json

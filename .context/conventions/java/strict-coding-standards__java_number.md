# Strict Coding Standards — Java Number, Money, Precision, Rounding

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when implementing numeric logic in Java.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. It covers primitive numeric types, wrappers, `BigInteger`, `BigDecimal`, money, rounding, parsing, formatting, overflow, comparison, serialization, database/API boundaries, and performance.
>
> **Mode**: Strict. Numeric code is correctness-critical. If precision, range, rounding, unit, and overflow behavior are not explicit, the implementation is incomplete.

---

## 0. Core Principle

A number is not just a type. It has a domain contract:

```text
value = quantity + unit + precision + scale + range + rounding + representation + boundary encoding
```

Before implementing numeric code, a code agent must know:

1. Is this count, money, ratio, measurement, percentage, score, identifier, duration, size, or ordering key?
2. Is it exact or approximate?
3. What is the allowed range?
4. What is the unit?
5. What is the rounding rule?
6. What is the serialization/database representation?
7. What happens on overflow, divide-by-zero, NaN, infinity, and missing value?

If any answer is unknown, do not guess.

---

## 1. Version Compatibility Matrix

| Feature / API | Java 11 | Java 17 | Java 21 | Java 25 | Rule |
|---|---:|---:|---:|---:|---|
| Primitive numeric types | Yes | Yes | Yes | Yes | Allowed with range/overflow rules |
| `Math.addExact/subtractExact/multiplyExact` | Yes | Yes | Yes | Yes | Required when overflow must fail fast |
| `BigInteger` | Yes | Yes | Yes | Yes | Use for exact integer beyond primitive range |
| `BigDecimal` | Yes | Yes | Yes | Yes | Required for decimal money/financial precision |
| `MathContext` | Yes | Yes | Yes | Yes | Required when precision-limited decimal operation exists |
| `RoundingMode` | Yes | Yes | Yes | Yes | Required whenever rounding can occur |
| `NumberFormat` / `DecimalFormat` | Yes | Yes | Yes | Yes | Display/parsing only; locale explicit |
| `double` / `float` | Yes | Yes | Yes | Yes | Restricted for approximate/scientific values only |
| Unsigned helpers (`Integer.toUnsignedLong`, etc.) | Yes | Yes | Yes | Yes | Restricted; document unsigned semantics |
| Vector API | Incubator? | Incubator | Incubator | Incubator | Forbidden by default for application standards |

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

1. Using `double` or `float` for money, fee, tax, fine, balance, regulatory amount, or exact decimal quantity.
2. Creating `BigDecimal` from `double`, e.g. `new BigDecimal(0.1)`.
3. Rounding without explicit `RoundingMode`.
4. Dividing `BigDecimal` without scale/rounding when non-terminating decimal is possible.
5. Comparing `BigDecimal` using `equals` when numeric equality is intended.
6. Ignoring overflow in counters, totals, IDs, sizes, pagination, or financial computations.
7. Silently truncating decimal to integer.
8. Parsing numbers with default locale for protocol/config/API input.
9. Formatting user-visible numbers without explicit locale.
10. Using wrapper numeric types to represent optional values without null policy.
11. Returning `NaN` or infinity from business methods without explicit contract.
12. Encoding money as floating point in JSON.
13. Mixing units in raw numbers, e.g. cents and dollars both as `long`.
14. Using magic numeric constants without named constant/value object.
15. Using modulo for security randomness/token generation.

### 2.2 Required by Default

1. Use `int` for small local counts only when range is obviously safe.
2. Use `long` for counts, IDs, byte sizes, timestamps, and totals that may exceed `int`.
3. Use `BigDecimal` for exact decimal business values.
4. Use minor units (`long cents`) only when currency scale is fixed and documented.
5. Use `Math.*Exact` for overflow-sensitive primitive arithmetic.
6. Use `RoundingMode` every time rounding is possible.
7. Use `Locale.ROOT` for protocol/config numeric text.
8. Use explicit user locale for display formatting/parsing.
9. Model money/rate/percentage/quantity as value objects when they cross domain boundaries.
10. Add boundary tests for min, max, zero, negative, overflow, rounding, and invalid input.

---

## 3. Numeric Type Selection

### 3.1 Type Decision Matrix

| Domain | Preferred type | Notes |
|---|---|---|
| Small loop index | `int` | Safe for collection indexes |
| Collection size/count | `int`/`long` | Use `long` for cross-page/DB totals |
| Byte size/file size | `long` | `Files.size` returns `long` |
| Database ID | `long`, UUID, domain ID | Do not use `int` unless DB guarantees it |
| Money exact decimal | `BigDecimal` or Money value object | Never `double` |
| Minor-unit money | `long` + Currency | Only fixed scale, e.g. cents |
| Percentage/rate exact | `BigDecimal` | Define scale and rounding |
| Scientific measurement | `double` | Accept approximate semantics |
| Cryptographic/random number | `SecureRandom`, `BigInteger` where needed | Never `Random` for security |
| Version/sequence | `long` | Handle overflow/monotonicity |
| Page number/size | constrained `int` | Validate max page size |
| Duration | `Duration`, not raw number | Define unit |
| Epoch timestamp | `Instant`, not raw number | Use raw number only at boundary |
| Bit flags | enum set or explicit bit type | Avoid magic masks |

### 3.2 Value Object Required

Use a value object when a number has business semantics.

Bad:

```java
void imposeFine(BigDecimal amount, String currency, BigDecimal taxRate) { ... }
```

Better:

```java
void imposeFine(Money amount, TaxRate taxRate) { ... }
```

Rules:

1. Value object must validate range and scale.
2. Value object must expose unit/currency.
3. Value object must control rounding.
4. Value object must define serialization format.
5. Value object must avoid leaking raw primitive where misuse is likely.

---

## 4. Primitive Integer Rules

### 4.1 Overflow Policy

Primitive overflow is silent in Java integer arithmetic. Therefore, overflow-sensitive code must use exact arithmetic.

Allowed:

```java
long total = Math.addExact(currentTotal, delta);
int next = Math.incrementExact(sequence);
long size = Math.multiplyExact(rowCount, bytesPerRow);
```

Forbidden:

```java
int total = a + b; // forbidden if overflow would violate business correctness
```

Overflow-sensitive domains:

1. money minor units;
2. totals and counters;
3. pagination offset;
4. array/buffer sizing;
5. rate limit counters;
6. version numbers;
7. retry/backoff delay;
8. file sizes;
9. timestamps/durations;
10. security token bounds.

### 4.2 Pagination Arithmetic

Forbidden:

```java
int offset = page * size;
```

Required:

```java
int page = validatePage(rawPage);
int size = validatePageSize(rawSize);
long offset = Math.multiplyExact((long) page, (long) size);
if (offset > MAX_OFFSET) {
    throw new ValidationException("offset too large");
}
```

### 4.3 Narrowing Conversion

Any narrowing conversion must be explicit and validated.

Allowed:

```java
int count = Math.toIntExact(longCount);
```

Forbidden:

```java
int count = (int) longCount;
```

unless truncation is the explicit low-level contract and documented.

---

## 5. Floating Point Rules

### 5.1 Allowed Uses

`double`/`float` are allowed for:

1. approximate scientific measurements;
2. telemetry/metrics where exact decimal is not required;
3. probabilistic algorithms;
4. ML/scoring models;
5. geometry/graphics calculations;
6. performance-sensitive approximate math with documented tolerance.

### 5.2 Forbidden Uses

`double`/`float` are forbidden for:

1. money;
2. tax;
3. accounting;
4. fine/penalty computation;
5. billing;
6. exact decimal quantity;
7. regulatory threshold if exact comparison matters;
8. user-visible financial percentage unless converted from exact type with explicit rounding.

### 5.3 Comparison

Forbidden:

```java
if (a == b) { ... } // forbidden for approximate floating-point domain
```

Required:

```java
static boolean nearlyEqual(double a, double b, double epsilon) {
    return Math.abs(a - b) <= epsilon;
}
```

Rules:

1. Epsilon must be domain-specific.
2. Handle `NaN` and infinity explicitly.
3. Do not hide `NaN` by converting to zero.
4. Test large, small, negative, zero, NaN, infinity.

### 5.4 NaN and Infinity

Business/domain methods must not return `NaN`/infinity unless contract explicitly allows them.

Required:

```java
if (!Double.isFinite(value)) {
    throw new CalculationException("non-finite result");
}
```

---

## 6. BigDecimal Rules

### 6.1 Construction

Allowed:

```java
BigDecimal amount = new BigDecimal("10.25");
BigDecimal value = BigDecimal.valueOf(10.25); // acceptable for controlled double conversion; still avoid for money input
BigDecimal zero = BigDecimal.ZERO;
```

Forbidden:

```java
BigDecimal amount = new BigDecimal(10.25);
```

Rules:

1. Parse business decimal input from string.
2. Use `BigDecimal.valueOf(long)` for integer values.
3. Use constants `ZERO`, `ONE`, `TEN` where appropriate.
4. Normalize scale only under domain policy.
5. Never assume scale is irrelevant.

### 6.2 Scale and Rounding

Every `BigDecimal` domain must define:

```text
precision: total significant digits if applicable
scale: digits after decimal point
rounding: RoundingMode
storage: database/API representation
comparison: numeric or scale-sensitive
```

Allowed:

```java
private static final int MONEY_SCALE = 2;
private static final RoundingMode MONEY_ROUNDING = RoundingMode.HALF_UP;

BigDecimal rounded = amount.setScale(MONEY_SCALE, MONEY_ROUNDING);
```

Forbidden:

```java
BigDecimal rounded = amount.setScale(2); // fails or unclear if rounding required
```

### 6.3 Division

Forbidden:

```java
BigDecimal ratio = numerator.divide(denominator);
```

unless mathematically guaranteed to terminate and tested.

Required:

```java
BigDecimal ratio = numerator.divide(denominator, 8, RoundingMode.HALF_UP);
```

or:

```java
BigDecimal ratio = numerator.divide(denominator, new MathContext(16, RoundingMode.HALF_EVEN));
```

### 6.4 Equality and Comparison

`BigDecimal.equals` considers scale. `1.0` and `1.00` are not equal via `equals`.

Numeric equality:

```java
if (a.compareTo(b) == 0) { ... }
```

Scale-sensitive equality:

```java
if (a.equals(b)) { ... }
```

Rules:

1. Use `compareTo` for numeric comparison.
2. Use `equals` only when scale is part of identity.
3. Do not use raw `BigDecimal` as `HashMap` key unless scale-sensitive identity is intended.
4. Normalize scale in value object if hash/equality must be numeric.

### 6.5 Money Value Object

Preferred:

```java
public final class Money implements Comparable<Money> {
    private static final int SCALE = 2;
    private static final RoundingMode ROUNDING = RoundingMode.HALF_UP;

    private final Currency currency;
    private final BigDecimal amount;

    private Money(Currency currency, BigDecimal amount) {
        this.currency = Objects.requireNonNull(currency, "currency");
        this.amount = amount.setScale(SCALE, ROUNDING);
    }

    public static Money of(Currency currency, BigDecimal amount) {
        Objects.requireNonNull(amount, "amount");
        return new Money(currency, amount);
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(currency, amount.add(other.amount));
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
    }

    @Override
    public int compareTo(Money other) {
        requireSameCurrency(other);
        return amount.compareTo(other.amount);
    }
}
```

Rules:

1. Currency must be part of money identity.
2. Do not add/subtract different currencies.
3. Define rounding per operation.
4. Define whether negative amounts are allowed.
5. Define maximum amount.
6. Define serialization format.

---

## 7. Percent, Rate, Ratio, and Measurement

### 7.1 Percent vs Fraction

Always specify representation:

```text
0.15 means 15%? or 0.15%?
15 means 15%? or factor 15x?
```

Required value objects:

```java
public final class Percentage {
    private final BigDecimal fraction; // 0.15 == 15%
}
```

Rules:

1. Name fields with representation: `taxRateFraction`, `discountPercent`, `basisPoints`.
2. Do not use ambiguous names like `rate` or `percentage` without unit.
3. Define allowed range: e.g. `0 <= rate <= 1`.
4. Define rounding when converting to display.

### 7.2 Units of Measure

Raw numbers with implicit units are forbidden at boundaries.

Bad:

```java
void setTimeout(long value) { ... }
```

Better:

```java
void setTimeout(Duration timeout) { ... }
```

Bad:

```java
long size = 10; // bytes? KB? MB?
```

Better:

```java
long sizeBytes = 10L * 1024L * 1024L;
```

---

## 8. Parsing Rules

### 8.1 Protocol/Config Parsing

Use locale-neutral parsing for protocols/configs/APIs.

Allowed:

```java
int limit = Integer.parseInt(rawLimit);
BigDecimal amount = new BigDecimal(rawAmount);
```

Rules:

1. Validate range after parsing.
2. Reject leading/trailing junk.
3. Define whether leading plus/minus is allowed.
4. Define whether grouping separators are allowed.
5. Define decimal separator.
6. Define exponent notation acceptance.
7. Return structured validation error.

### 8.2 User-Facing Parsing

Use explicit locale:

```java
NumberFormat format = NumberFormat.getNumberInstance(userLocale);
Number parsed = format.parse(input);
```

Rules:

1. User-facing parsing must know locale.
2. Parsing must reject partial parses unless explicitly allowed.
3. Parsed `Number` must be converted carefully to target type.
4. Display formatting and parsing must be tested per locale.

### 8.3 Fail-Fast Parsing Helper

```java
public static int parseBoundedInt(String raw, String field, int min, int max) {
    Objects.requireNonNull(raw, field);
    try {
        int value = Integer.parseInt(raw.strip());
        if (value < min || value > max) {
            throw new ValidationException(field + " out of range");
        }
        return value;
    } catch (NumberFormatException ex) {
        throw new ValidationException(field + " must be an integer", ex);
    }
}
```

Rules:

1. Do not leak raw untrusted input in error messages if sensitive.
2. Include field name.
3. Include min/max in API docs if applicable.
4. Test invalid values.

---

## 9. Formatting Rules

### 9.1 Display Formatting

Use explicit locale and domain-specific formatter.

```java
NumberFormat moneyFormat = NumberFormat.getCurrencyInstance(userLocale);
moneyFormat.setCurrency(currency);
String display = moneyFormat.format(amount);
```

Rules:

1. Formatting for display must not be reused for machine serialization.
2. Do not parse display strings as protocol values.
3. Do not rely on JVM default locale.
4. Do not use display-formatted numbers in logs intended for machine parsing.

### 9.2 Machine Serialization

Machine representation must be stable.

Preferred examples:

```json
{ "amount": "10.25", "currency": "SGD" }
{ "sizeBytes": 1048576 }
{ "rateFraction": "0.075" }
```

Rules:

1. Use strings for exact decimals in JSON when client precision may be an issue.
2. Use integer minor units only when currency scale is fixed and agreed.
3. Include unit in field name or schema.
4. Define precision/scale in OpenAPI/JSON schema.
5. Avoid scientific notation for business decimals unless explicitly allowed.

---

## 10. Database Boundary Rules

### 10.1 SQL Numeric Mapping

| Java type | Database type | Rule |
|---|---|---|
| `int` | INTEGER | Validate range |
| `long` | BIGINT / NUMBER(19) | Validate DB precision |
| `BigDecimal` | DECIMAL/NUMERIC/NUMBER | Define precision and scale |
| `double` | DOUBLE/FLOAT/BINARY_DOUBLE | Approximate only |
| `Money` | amount + currency columns | Prefer explicit structure |
| `Percentage` | DECIMAL with documented scale | Define fraction vs percent |

Rules:

1. DB precision/scale must match Java validation.
2. Do not rely on DB rounding/truncation.
3. Use bind parameters, never string formatting.
4. When reading `BigDecimal`, normalize scale in domain value object if required.
5. Test DB round-trip for boundary values.

### 10.2 Aggregation

Database sums/counts can exceed Java target type.

Rules:

1. Read `COUNT(*)` as `long` or `BigInteger` depending driver/database.
2. Read monetary `SUM` as `BigDecimal`.
3. Check null result for aggregate over empty set.
4. Define rounding after aggregate, not per row unless business requires per-row rounding.

---

## 11. JSON/API Boundary Rules

### 11.1 JSON Number Risk

JavaScript clients may lose integer precision for large values.

Rules:

1. IDs larger than JavaScript safe integer should be serialized as strings.
2. Exact decimals should be serialized as strings if cross-language precision matters.
3. OpenAPI schema must document format and range.
4. Do not change numeric field representation without API versioning.

### 11.2 Request Validation

Every numeric request field must define:

1. required vs optional;
2. min/max;
3. inclusive/exclusive bounds;
4. scale;
5. rounding or reject-extra-decimals;
6. unit;
7. default if omitted;
8. error code/message.

---

## 12. Rounding Policy

### 12.1 Rounding Must Be Named

Every rounding rule must state:

```text
operation: tax calculation / display / storage / payout / allocation
scale: 2
rounding mode: HALF_UP / HALF_EVEN / DOWN / CEILING / FLOOR / ...
rounding stage: per line / subtotal / final invoice
legal/business basis: <reference>
```

### 12.2 Avoid Hidden Rounding

Forbidden:

```java
amount.divide(rate).setScale(2);
```

Required:

```java
amount.divide(rate, 8, RATE_ROUNDING)
      .setScale(MONEY_SCALE, MONEY_ROUNDING);
```

### 12.3 Allocation

When splitting money:

1. total after allocation must equal original amount;
2. define remainder distribution rule;
3. deterministic ordering required;
4. test uneven splits;
5. audit allocation decisions.

---

## 13. Null, Optional, and Defaults

### 13.1 Null Policy

Numeric null is not zero unless business says so.

Rules:

1. Use `OptionalInt`, `OptionalLong`, or nullable field only at boundaries.
2. Convert to domain value with explicit defaulting rule.
3. Do not use `0` as sentinel for missing unless protocol requires it.
4. Avoid boxed numbers in hot paths.
5. Do not unbox nullable wrappers.

### 13.2 Default Values

Default must be visible:

```java
int pageSize = request.pageSize().orElse(DEFAULT_PAGE_SIZE);
```

Forbidden:

```java
int pageSize = request.pageSize(); // returns 0 if absent, unclear
```

---

## 14. Concurrency and Atomic Numeric State

### 14.1 Counters

Use correct concurrency primitive:

| Use case | Type |
|---|---|
| single-thread counter | `long` |
| low-contention atomic counter | `AtomicLong` |
| high-contention metric counter | `LongAdder` |
| bounded domain value | lock or transactional update |
| DB sequence/version | database-owned mechanism |

Rules:

1. Do not use `volatile int` for compound increment.
2. Do not use `AtomicLong` for business invariant involving multiple fields.
3. Use DB optimistic locking for persisted numeric state.
4. Avoid overflow in counters.

### 14.2 Rate Limit / Quota

Numeric quota logic must define:

1. time window;
2. counter type;
3. reset behavior;
4. overflow behavior;
5. atomicity boundary;
6. distributed consistency model.

---

## 15. Security Rules

1. Use `SecureRandom` for security tokens/randomness.
2. Do not use `% bound` on random bytes if modulo bias matters.
3. Validate numeric input size before allocation.
4. Bound loops driven by user-provided numbers.
5. Bound pagination/page size.
6. Bound retry/backoff maximum delay.
7. Avoid integer overflow in buffer allocation.
8. Avoid regex or parsing paths with unbounded numeric precision from attacker input.
9. Do not expose exact internal counters if they leak sensitive business volume.
10. Treat numeric IDs as identifiers, not authorization proof.

---

## 16. Performance Rules

### 16.1 BigDecimal Performance

Rules:

1. Use `BigDecimal` where correctness requires it.
2. Avoid repeated parsing in hot loops.
3. Reuse constants and `MathContext`.
4. Avoid unnecessary scale normalization in loops.
5. Do not replace `BigDecimal` with `double` without domain approval.
6. Consider minor-unit `long` only if scale is fixed and all operations are safe.

### 16.2 Boxing

Rules:

1. Avoid boxed numbers in hot loops.
2. Prefer primitive streams only when they improve clarity/performance.
3. Do not store nullable boxed values in maps without null/missing distinction.
4. Avoid accidental unboxing of null.

### 16.3 Benchmarking

Numeric optimizations require:

1. realistic data distribution;
2. edge values;
3. precision checks;
4. allocation measurements;
5. regression tests proving same numeric result.

---

## 17. Testing Requirements

Every numeric implementation must test:

1. zero;
2. one;
3. negative values if allowed/forbidden;
4. minimum valid;
5. maximum valid;
6. below minimum;
7. above maximum;
8. overflow boundary;
9. divide by zero;
10. rounding half cases;
11. scale mismatch;
12. parse invalid input;
13. parse locale-specific input if applicable;
14. JSON serialization round trip;
15. database round trip if persisted;
16. concurrency race if shared state;
17. `NaN`/infinity if floating-point is used.

### 17.1 BigDecimal Edge Tests

```java
assertEquals(0, new BigDecimal("1.0").compareTo(new BigDecimal("1.00")));
assertNotEquals(new BigDecimal("1.0"), new BigDecimal("1.00"));
assertThrows(ArithmeticException.class, () -> new BigDecimal("1").divide(new BigDecimal("3")));
```

### 17.2 Overflow Tests

```java
assertThrows(ArithmeticException.class, () -> Math.addExact(Integer.MAX_VALUE, 1));
assertThrows(ArithmeticException.class, () -> Math.toIntExact(Long.MAX_VALUE));
```

---

## 18. Anti-Patterns

### 18.1 Money as Double

Bad:

```java
double total = price * quantity * 1.07;
```

Better:

```java
Money total = price.multiply(quantity).apply(taxRate);
```

### 18.2 Magic Units

Bad:

```java
Thread.sleep(5000);
```

Better:

```java
Thread.sleep(Duration.ofSeconds(5));
```

or for APIs requiring millis:

```java
long timeoutMillis = timeout.toMillis();
```

### 18.3 Ambiguous Rate

Bad:

```java
BigDecimal rate = new BigDecimal("7.5");
```

Better:

```java
TaxRate taxRate = TaxRate.percent(new BigDecimal("7.5"));
```

### 18.4 Hidden Truncation

Bad:

```java
int count = (int) repository.count();
```

Better:

```java
int count = Math.toIntExact(repository.count());
```

### 18.5 BigDecimal as Map Key without Scale Policy

Bad:

```java
Map<BigDecimal, Rule> byThreshold = new HashMap<>();
```

unless scale-sensitive identity is intended.

Better:

```java
Map<Threshold, Rule> byThreshold = new HashMap<>();
```

---

## 19. LLM Implementation Protocol

Before generating or modifying numeric code, the agent must answer:

```text
1. What domain does this number represent?
2. What is the unit?
3. Is it exact or approximate?
4. What type is selected and why?
5. What are min/max bounds?
6. Can arithmetic overflow?
7. Can division be non-terminating or divide by zero?
8. What rounding mode and scale apply?
9. Is locale relevant for parsing/formatting?
10. How is it serialized to API/database/logs?
11. What edge tests prove correctness?
```

If the agent cannot answer, it must not implement the numeric transformation.

---

## 20. Reviewer Checklist

- [ ] Is the numeric domain and unit explicit?
- [ ] Is exact vs approximate semantics explicit?
- [ ] Is `double/float` avoided for money/exact decimals?
- [ ] Is `BigDecimal` constructed safely?
- [ ] Is rounding explicit with `RoundingMode`?
- [ ] Is division safe and tested?
- [ ] Is overflow handled with `Math.*Exact` or range validation?
- [ ] Is narrowing conversion done with `Math.toIntExact` or validation?
- [ ] Are null/missing/zero distinguished?
- [ ] Are JSON/API/database numeric representations stable?
- [ ] Are locale-sensitive parsing/formatting rules explicit?
- [ ] Are money/currency/rate modeled as value objects where needed?
- [ ] Are boundary tests included?
- [ ] Are concurrency and atomicity considered for shared counters/state?
- [ ] Are untrusted numeric values bounded before allocation/loop/query?

---

## 21. Prompt Contract for LLM Code Agents

```text
You are implementing numeric Java code under strict standards.

Mandatory rules:
- Never use double/float for money, tax, fee, fine, billing, or exact decimal business values.
- Never create BigDecimal from a double literal. Use String, valueOf(long), or validated parsed text.
- Every rounding operation must specify scale and RoundingMode.
- BigDecimal division must specify scale/rounding/MathContext unless termination is proven.
- Use Math.addExact/subtractExact/multiplyExact/toIntExact when overflow/narrowing would violate correctness.
- Do not treat null as zero unless business rules explicitly say so.
- Do not serialize exact decimals as ambiguous JSON numbers if cross-language precision matters.
- Include unit in field names or value objects.
- Include tests for min/max, overflow, divide-by-zero, rounding half cases, invalid parsing, and serialization/database round trip.

Before coding, state domain, unit, type choice, bounds, precision/scale, rounding, overflow policy, and test cases.
```

---

## 22. References

- Java SE `BigDecimal` API: https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/math/BigDecimal.html
- Java SE `BigInteger` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigInteger.html
- Java SE `RoundingMode` API: https://docs.oracle.com/javase/8/docs/api/java/math/RoundingMode.html
- Java SE `Math` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Math.html
- Java SE `NumberFormat` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/text/NumberFormat.html
- Java SE `Currency` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Currency.html
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html

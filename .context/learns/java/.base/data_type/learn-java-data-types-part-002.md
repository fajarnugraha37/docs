# learn-java-data-types-part-002.md

# Java Data Types — Part 002  
# Numeric Types untuk Production: Money, Quantity, Counter, ID, Version, dan Precision

> Seri: **Advanced Java Data Types**  
> Bagian: **002**  
> Fokus: memahami angka di Java sebagai **konsep production dan domain**, bukan hanya primitive arithmetic. Kita akan membahas kapan memakai `int`, `long`, `BigInteger`, `BigDecimal`, `double`, fixed-point, value object seperti `Money`, `Quantity`, `Version`, dan bagaimana angka melewati boundary JSON, database, Kafka, metrics, dan audit.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Angka Bukan Sekadar Angka](#2-angka-bukan-sekadar-angka)
3. [Mental Model: Numeric Meaning vs Numeric Representation](#3-mental-model-numeric-meaning-vs-numeric-representation)
4. [Kategori Numeric Data di Production](#4-kategori-numeric-data-di-production)
5. [`int`: Count, Index, Limit, dan Pagination](#5-int-count-index-limit-dan-pagination)
6. [`long`: ID, Counter Besar, Epoch, Size, dan Version](#6-long-id-counter-besar-epoch-size-dan-version)
7. [`BigInteger`: Arbitrary-Precision Integer](#7-biginteger-arbitrary-precision-integer)
8. [`float` dan `double`: Approximate Measurement, Bukan Decimal Business](#8-float-dan-double-approximate-measurement-bukan-decimal-business)
9. [`BigDecimal`: Decimal Arithmetic untuk Business-Critical Values](#9-bigdecimal-decimal-arithmetic-untuk-business-critical-values)
10. [Scale, Precision, dan Rounding](#10-scale-precision-dan-rounding)
11. [Money Modeling: `BigDecimal` vs `long minorUnits`](#11-money-modeling-bigdecimal-vs-long-minorunits)
12. [Quantity, Unit, Measurement, dan Unit-of-Measure Bug](#12-quantity-unit-measurement-dan-unit-of-measure-bug)
13. [Percentage, Ratio, Rate, dan Basis Points](#13-percentage-ratio-rate-dan-basis-points)
14. [Counter, Sequence, dan Version](#14-counter-sequence-dan-version)
15. [ID Numeric: Database ID, Snowflake-like ID, dan JSON Precision](#15-id-numeric-database-id-snowflake-like-id-dan-json-precision)
16. [Epoch Time, Duration, dan Numeric Time Trap](#16-epoch-time-duration-dan-numeric-time-trap)
17. [Numeric Boundary: JSON, JavaScript, Database, Kafka, CSV](#17-numeric-boundary-json-javascript-database-kafka-csv)
18. [Database Mapping: `NUMERIC`, `DECIMAL`, `BIGINT`, `INTEGER`](#18-database-mapping-numeric-decimal-bigint-integer)
19. [Formatting vs Data: `NumberFormat`, Currency, Locale](#19-formatting-vs-data-numberformat-currency-locale)
20. [Overflow, Underflow, Saturation, dan Exact Arithmetic](#20-overflow-underflow-saturation-dan-exact-arithmetic)
21. [Equality dan Comparison untuk Numeric Domain](#21-equality-dan-comparison-untuk-numeric-domain)
22. [Performance dan Memory Cost Numeric Types](#22-performance-dan-memory-cost-numeric-types)
23. [Design Patterns untuk Numeric Domain Types](#23-design-patterns-untuk-numeric-domain-types)
24. [Anti-Patterns](#24-anti-patterns)
25. [Production Failure Case Studies](#25-production-failure-case-studies)
26. [Decision Matrix: Pilih Numeric Type yang Tepat](#26-decision-matrix-pilih-numeric-type-yang-tepat)
27. [Checklist Review Numeric Type](#27-checklist-review-numeric-type)
28. [Latihan](#28-latihan)
29. [Ringkasan](#29-ringkasan)
30. [Referensi](#30-referensi)

---

# 1. Tujuan Bagian Ini

Di part 001 kita membahas primitive semantics: overflow, promotion, floating point, `char`, `boolean`, dan conversion.

Di part ini, kita naik satu level:

```text
Bagaimana memilih numeric representation yang benar untuk sistem production?
```

Pertanyaan yang akan dijawab:

- Apakah `int` cukup untuk count?
- Kapan harus `long`?
- Apakah `double` boleh untuk amount?
- Apa bedanya `BigDecimal("1.0")` dan `BigDecimal("1.00")`?
- Kenapa `BigDecimal.equals` bisa mengejutkan?
- Kapan money lebih baik sebagai `long minorUnits`?
- Bagaimana menyimpan money ke database?
- Bagaimana mengirim `long` ID ke JSON client?
- Bagaimana menghindari overflow pada pagination?
- Bagaimana modeling percentage, ratio, quantity, dan unit?
- Bagaimana angka bisa menyebabkan audit/regulatory bug?

Tujuan utamanya: kamu tidak lagi memilih type numeric berdasarkan kebiasaan, tetapi berdasarkan **semantics, range, precision, boundary, performance, dan correctness**.

---

# 2. Angka Bukan Sekadar Angka

Lihat field berikut:

```java
long value;
```

Apa maknanya?

Bisa jadi:

```text
ID
epoch millis
duration nanos
amount in cents
file size
row count
version
sequence number
offset
percentage basis points
risk score
retry count
priority
```

Semua memakai angka, tetapi aturan domainnya berbeda.

Contoh:

| Meaning | Valid operations | Invalid operations |
|---|---|---|
| ID | equality, display, lookup | add/subtract |
| Money | add same currency, compare same currency | add different currency blindly |
| Version | increment, compare | multiply |
| Timestamp epoch | compare, convert to Instant | add money |
| Duration | add/subtract, compare | use as absolute time |
| Percentage | compare, multiply amount | exceed range if constrained |
| Count | increment, aggregate | negative if count cannot be negative |

Jika semua direpresentasikan sebagai `long`, compiler tidak bisa mencegah:

```java
long caseId = 123;
long amountMinor = 1000;
long epochMillis = 1710000000000L;

long nonsense = caseId + amountMinor + epochMillis; // compile success
```

Domain-specific type mencegah operasi ngawur.

```java
record CaseId(long value) {}
record MoneyMinor(long value, Currency currency) {}
record EpochMillis(long value) {}
```

---

# 3. Mental Model: Numeric Meaning vs Numeric Representation

Pisahkan dua hal:

```text
numeric meaning
numeric representation
```

## 3.1 Numeric meaning

Meaning menjawab:

```text
Angka ini merepresentasikan apa?
```

Contoh:

- amount;
- quantity;
- ID;
- version;
- percentage;
- rate;
- score;
- distance;
- deadline;
- count;
- size.

## 3.2 Numeric representation

Representation menjawab:

```text
Bagaimana angka ini disimpan dan dihitung?
```

Contoh:

- `int`;
- `long`;
- `double`;
- `BigDecimal`;
- `BigInteger`;
- `short`;
- `byte`;
- fixed-point;
- string at boundary;
- database `NUMERIC(19,2)`;
- JSON string;
- Protobuf `int64`.

## 3.3 Contoh pemisahan

Meaning:

```text
Money in SGD
```

Representation options:

```text
BigDecimal amount + Currency
long minorUnits + Currency
database NUMERIC(19, 2) + currency column
JSON string "12.34" + "SGD"
JSON minor unit 1234 + "SGD"
```

Tidak ada satu representation yang selalu benar. Pilihan bergantung:

- precision requirement;
- rounding rule;
- currency;
- storage;
- API compatibility;
- performance;
- audit;
- team convention.

## 3.4 Rule utama

```text
Raw numeric types are implementation detail.
Domain numeric types are semantic boundary.
```

Di dalam hot loop, `long` mungkin tepat. Di application/domain API, `Money`, `Quantity`, `Version`, atau `CaseId` sering lebih baik.

---

# 4. Kategori Numeric Data di Production

## 4.1 Count

Count adalah jumlah.

Contoh:

```text
number of records
retry count
attempt count
item count
page size
```

Biasanya non-negative.

Potential types:

- `int` untuk bounded count kecil;
- `long` untuk large count;
- value object jika domain-critical.

## 4.2 Index/offset

Index adalah posisi.

```java
list.get(index)
```

Offset pagination:

```text
page * size
```

Risiko:

- negative index;
- overflow;
- unbounded pagination;
- offset pagination slow.

## 4.3 Identifier

ID biasanya numeric atau UUID/string.

Operasi valid:

- equality;
- lookup;
- display;
- ordering only if meaningful.

Operasi invalid:

- arithmetic.

Jadi walaupun ID disimpan `long`, exposed API sebaiknya type khusus:

```java
record UserId(long value) {}
```

## 4.4 Version

Version untuk optimistic locking/event ordering.

```java
record AggregateVersion(long value) {
    AggregateVersion next() {
        return new AggregateVersion(Math.incrementExact(value));
    }
}
```

Version harus monotonic.

## 4.5 Money

Money punya:

- amount;
- currency;
- scale/rounding;
- legal/regulatory expectations.

Money bukan `double`.

## 4.6 Quantity

Quantity butuh unit:

```text
10 kg
10 meter
10 licenses
10 cases
```

`10` sendiri tidak cukup.

## 4.7 Percentage/rate

Percentage bisa:

```text
0..100
0..1
basis points
decimal ratio
```

Harus jelas.

## 4.8 Score

Risk score/model score sering approximate.

`double` mungkin benar, tetapi output threshold harus didefinisikan.

## 4.9 Time numeric

Epoch millis/nanos adalah number, tetapi semantics time.

Better internal API:

```java
Instant
Duration
```

bukan raw `long`, kecuali low-level/performance/boundary.

---

# 5. `int`: Count, Index, Limit, dan Pagination

`int` adalah default integer untuk banyak operasi.

## 5.1 Cocok untuk

```java
int retryCount;
int pageSize;
int arrayIndex;
int port;
int percentInt;
int priority;
```

Dengan validasi.

## 5.2 Validasi range

Port:

```java
public record Port(int value) {
    public Port {
        if (value < 1 || value > 65535) {
            throw new IllegalArgumentException("Port must be 1..65535");
        }
    }
}
```

Retry count:

```java
public record RetryCount(int value) {
    public RetryCount {
        if (value < 0 || value > 10) {
            throw new IllegalArgumentException("Retry count must be 0..10");
        }
    }
}
```

## 5.3 Pagination overflow

Bad:

```java
int offset = page * size;
```

If:

```java
page = 100_000
size = 100_000
```

result should be:

```text
10,000,000,000
```

But `int` overflows.

Better:

```java
long offset = Math.multiplyExact((long) page, size);
```

Then bound:

```java
if (offset > MAX_OFFSET) {
    throw new IllegalArgumentException("Offset too large");
}
```

## 5.4 Page size should be bounded

Bad:

```java
GET /cases?page=0&size=1000000
```

Good:

```java
public record PageSize(int value) {
    private static final int MAX = 200;

    public PageSize {
        if (value < 1 || value > MAX) {
            throw new IllegalArgumentException("Page size must be 1.." + MAX);
        }
    }
}
```

## 5.5 Count as `int` vs `long`

`List.size()` returns `int`, but database count may exceed int.

```java
long totalRows = repository.count();
```

If you expose to API:

```json
{
  "totalElements": 1234567890123
}
```

Consider JavaScript precision if above safe integer range.

---

# 6. `long`: ID, Counter Besar, Epoch, Size, dan Version

`long` sering dipakai untuk values besar.

## 6.1 Good use cases

```java
long id;
long epochMillis;
long fileSizeBytes;
long aggregateVersion;
long sequenceNumber;
long totalCount;
long amountMinor;
long durationNanos;
```

Tetapi raw `long` tidak menjelaskan semantics.

## 6.2 Typed long

```java
public record CaseId(long value) {
    public CaseId {
        if (value <= 0) {
            throw new IllegalArgumentException("CaseId must be positive");
        }
    }
}
```

Version:

```java
public record AggregateVersion(long value) implements Comparable<AggregateVersion> {
    public AggregateVersion {
        if (value < 0) {
            throw new IllegalArgumentException("Version must not be negative");
        }
    }

    public AggregateVersion next() {
        return new AggregateVersion(Math.incrementExact(value));
    }

    @Override
    public int compareTo(AggregateVersion other) {
        return Long.compare(this.value, other.value);
    }
}
```

## 6.3 `long` still overflows

```java
long x = Long.MAX_VALUE;
long y = x + 1; // Long.MIN_VALUE
```

Use:

```java
Math.addExact
Math.incrementExact
Math.multiplyExact
```

## 6.4 Long for epoch time

Bad API:

```java
void schedule(long time)
```

What is `time`?

- epoch millis?
- epoch seconds?
- nanos?
- duration?
- local timestamp?

Better:

```java
void scheduleAt(Instant instant)
void scheduleAfter(Duration delay)
```

Use raw long only at boundary:

```java
Instant.ofEpochMilli(epochMillis)
```

## 6.5 Long ID and JSON

Large long values can lose precision in JavaScript.

For public JSON API:

```json
{
  "caseId": "9223372036854775807"
}
```

Use string for IDs if clients include JavaScript or languages with limited integer precision.

---

# 7. `BigInteger`: Arbitrary-Precision Integer

`BigInteger` represents arbitrary-precision integers.

Use cases:

- cryptography;
- very large numbers;
- arbitrary precision arithmetic;
- identifiers beyond 64-bit;
- mathematical algorithms;
- exact combinatorics;
- protocol values.

## 7.1 BigInteger is immutable

```java
BigInteger a = BigInteger.TEN;
BigInteger b = a.add(BigInteger.ONE);

System.out.println(a); // 10
System.out.println(b); // 11
```

Operations return new instances.

## 7.2 BigInteger is not for normal IDs by default

Just because `BigInteger` can be huge does not mean it should be used for every ID.

Trade-offs:

- more memory;
- slower than primitive;
- serialization complexity;
- database mapping;
- API compatibility.

Use `long`/UUID/string unless domain demands arbitrary precision.

## 7.3 BigInteger and crypto

Cryptographic code uses `BigInteger`, but security-sensitive implementation should rely on well-reviewed crypto libraries/APIs. Do not invent crypto arithmetic unless you know what you're doing.

## 7.4 BigInteger boundary

For JSON, large BigInteger should often be string.

```json
{
  "value": "123456789012345678901234567890"
}
```

---

# 8. `float` dan `double`: Approximate Measurement, Bukan Decimal Business

`float` and `double` are binary floating-point types.

## 8.1 Good use cases for `double`

- measurement;
- score;
- probability;
- distance;
- temperature;
- scientific computation;
- simulation;
- ML;
- ranking;
- approximate analytics.

## 8.2 Bad use cases

- money;
- tax;
- invoice;
- settlement;
- regulatory decimal;
- exact ratio with legal rounding;
- quantity requiring decimal exactness.

## 8.3 Floating point comparison

```java
double expected = 0.3;
double actual = 0.1 + 0.2;

actual == expected // false
```

Use tolerance:

```java
static boolean approximatelyEqual(double a, double b, double epsilon) {
    return Math.abs(a - b) <= epsilon;
}
```

But choose epsilon based on domain.

## 8.4 NaN/infinity guard

For domain score:

```java
public record RiskScore(double value) {
    public RiskScore {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("Risk score must be finite");
        }
        if (value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Risk score must be 0..1");
        }
    }
}
```

## 8.5 `double` in JSON

JSON number has no built-in distinction between integer/float/decimal. Consumers may parse as double. If exactness matters, use string or structured representation.

---

# 9. `BigDecimal`: Decimal Arithmetic untuk Business-Critical Values

`BigDecimal` represents immutable arbitrary-precision signed decimal numbers.

Conceptually:

```text
value = unscaledValue × 10^-scale
```

Examples:

```java
new BigDecimal("123.45")
```

can be seen as:

```text
unscaledValue = 12345
scale = 2
```

## 9.1 Create BigDecimal correctly

Good:

```java
BigDecimal a = new BigDecimal("0.10");
BigDecimal b = BigDecimal.valueOf(0.10);
BigDecimal c = BigDecimal.valueOf(10, 2); // 0.10
```

Dangerous:

```java
BigDecimal bad = new BigDecimal(0.10);
```

Because `0.10` is already approximate double.

Example:

```java
System.out.println(new BigDecimal(0.1));
```

prints a long decimal approximation.

## 9.2 BigDecimal immutable

```java
BigDecimal amount = new BigDecimal("10.00");
amount.add(new BigDecimal("5.00"));

System.out.println(amount); // still 10.00
```

Need:

```java
amount = amount.add(new BigDecimal("5.00"));
```

## 9.3 Division can require rounding

```java
BigDecimal.ONE.divide(new BigDecimal("3"));
```

throws `ArithmeticException` because exact decimal expansion is non-terminating.

Specify scale/rounding:

```java
BigDecimal result = BigDecimal.ONE.divide(
    new BigDecimal("3"),
    2,
    RoundingMode.HALF_UP
);
```

## 9.4 BigDecimal for money

`BigDecimal` is common for money, but must be wrapped in a `Money` type.

Bad:

```java
BigDecimal amount;
```

Better:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");

        int scale = currency.getDefaultFractionDigits();
        if (scale >= 0 && amount.scale() > scale) {
            throw new IllegalArgumentException("Too many fraction digits for " + currency);
        }
    }
}
```

But default fraction digits can be insufficient for some financial products, crypto assets, or domain-specific pricing. Use domain-specific scale when needed.

## 9.5 `equals` vs `compareTo`

```java
BigDecimal a = new BigDecimal("1.0");
BigDecimal b = new BigDecimal("1.00");

System.out.println(a.compareTo(b) == 0); // true
System.out.println(a.equals(b));         // false
```

Why?

`equals` considers value and scale. `compareTo` compares numeric value.

This is critical for:

- HashSet;
- HashMap keys;
- equality in value objects;
- tests.

Normalize if needed:

```java
amount.stripTrailingZeros()
```

But be careful: scale can have business meaning in some contexts.

## 9.6 BigDecimal in hash-based collections

```java
Set<BigDecimal> set = new HashSet<>();
set.add(new BigDecimal("1.0"));
set.add(new BigDecimal("1.00"));

System.out.println(set.size()); // 2
```

If your domain considers them same amount, use a Money type with normalized representation/equality policy.

---

# 10. Scale, Precision, dan Rounding

## 10.1 Scale

Scale is number of digits to the right of decimal point.

```java
new BigDecimal("123.45").scale() // 2
new BigDecimal("123").scale()    // 0
new BigDecimal("1.2300").scale() // 4
```

## 10.2 Precision

Precision is number of digits in unscaled value.

```java
new BigDecimal("123.45").precision() // 5
new BigDecimal("0.00123").precision() // depends representation, understand API
```

## 10.3 RoundingMode

Common modes:

- `HALF_UP`;
- `HALF_EVEN`;
- `DOWN`;
- `UP`;
- `FLOOR`;
- `CEILING`;
- `UNNECESSARY`.

Business must define rounding.

Do not let developer choose casually.

## 10.4 HALF_UP vs HALF_EVEN

`HALF_UP` is common in simple business expectations.

`HALF_EVEN` is banker's rounding and reduces cumulative bias in repeated calculations.

But use the rule required by domain/regulation.

## 10.5 Rounding location matters

Rounding after every line item vs rounding at final total can produce different result.

Example:

```text
round each item tax then sum
vs
sum exact tax then round once
```

This must be business-defined.

## 10.6 Rounding policy type

```java
public record RoundingPolicy(int scale, RoundingMode mode) {
    public BigDecimal round(BigDecimal value) {
        return value.setScale(scale, mode);
    }
}
```

Then:

```java
Money tax = policy.round(rawTax);
```

Do not scatter:

```java
setScale(2, RoundingMode.HALF_UP)
```

everywhere without central policy.

---

# 11. Money Modeling: `BigDecimal` vs `long minorUnits`

Money is not just amount. Money is:

```text
amount + currency + rounding policy + scale + operations
```

## 11.1 Option A — BigDecimal Money

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(this.amount.add(other.amount), this.currency);
    }

    private void requireSameCurrency(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
    }
}
```

Pros:

- natural decimal representation;
- flexible scale;
- good for financial calculations;
- maps to DB `NUMERIC`.

Cons:

- scale/equality traps;
- slower than long;
- memory overhead;
- must define rounding;
- careless construction from double dangerous.

## 11.2 Option B — long minor units

```java
public record Money(long minorUnits, Currency currency) {
    public Money {
        Objects.requireNonNull(currency);
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(Math.addExact(this.minorUnits, other.minorUnits), currency);
    }
}
```

Pros:

- exact integer arithmetic;
- fast;
- compact;
- simple equality;
- good for currencies with fixed minor units.

Cons:

- currency fraction digits vary;
- some domains need more precision than minor units;
- conversion/rounding still needed at boundary;
- crypto/high-precision assets not covered;
- display formatting needs conversion.

## 11.3 Which one to choose?

Use `long minorUnits` if:

- currency has stable minor unit;
- operations mostly add/subtract/compare;
- performance/storage simplicity important;
- scale is fixed by domain.

Use `BigDecimal` if:

- variable scale;
- interest/tax/ratio calculations;
- regulatory decimal rounding;
- fractional units beyond currency minor unit;
- database/reporting expects decimal.

## 11.4 Never money as just amount

Bad:

```java
BigDecimal amount;
```

Better:

```java
Money amount;
```

Because currency matters.

## 11.5 Currency conversion

Currency conversion requires:

```text
source money
target currency
exchange rate
rate timestamp
rounding policy
provider/source
```

Type:

```java
public record ExchangeRate(
    Currency source,
    Currency target,
    BigDecimal rate,
    Instant effectiveAt
) {}
```

Do not multiply money by random BigDecimal without context.

---

# 12. Quantity, Unit, Measurement, dan Unit-of-Measure Bug

Quantity needs unit.

Bad:

```java
double distance = 10.0;
```

10 what?

- meters?
- kilometers?
- miles?

## 12.1 Unit mismatch case

Classic production bug class:

```text
service A sends duration in seconds
service B interprets as milliseconds
```

Fix with explicit type:

```java
Duration timeout;
```

not:

```java
long timeout;
```

## 12.2 Quantity type

```java
public enum LengthUnit {
    METER,
    KILOMETER
}

public record Length(BigDecimal value, LengthUnit unit) {
    public Length {
        Objects.requireNonNull(value);
        Objects.requireNonNull(unit);
        if (value.signum() < 0) {
            throw new IllegalArgumentException("Length must not be negative");
        }
    }
}
```

## 12.3 Prefer standard types when available

Use:

```java
Duration
Period
Instant
LocalDate
```

instead of raw numeric time.

For data size, Java standard lacks a universal `DataSize`, but frameworks may provide one. Domain type can help:

```java
record ByteSize(long bytes) {}
```

## 12.4 Quantity and BigDecimal

Use `BigDecimal` if quantity can be fractional decimal.

Use `long` if quantity is countable integer.

```java
record LicenseSeatCount(int value) {}
record Weight(BigDecimal kilograms) {}
```

---

# 13. Percentage, Ratio, Rate, dan Basis Points

## 13.1 Percentage ambiguity

```java
BigDecimal percentage = new BigDecimal("5");
```

Does it mean:

```text
5%
0.05
5.0 ratio
500 basis points
```

Be explicit.

## 13.2 Percentage type

```java
public record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value);
        if (value.compareTo(BigDecimal.ZERO) < 0 ||
            value.compareTo(new BigDecimal("100")) > 0) {
            throw new IllegalArgumentException("Percentage must be 0..100");
        }
    }

    public BigDecimal asRatio() {
        return value.divide(new BigDecimal("100"));
    }
}
```

But division should specify precision/rounding if needed.

## 13.3 Ratio type

```java
public record Ratio(BigDecimal value) {
    public Ratio {
        Objects.requireNonNull(value);
    }
}
```

Ratio may be 0..1 or unconstrained depending domain.

## 13.4 Basis points

Financial systems often use basis points:

```text
1 basis point = 0.01%
100 basis points = 1%
```

Type:

```java
public record BasisPoints(int value) {
    public BigDecimal asRatio() {
        return BigDecimal.valueOf(value, 4); // value / 10000
    }
}
```

## 13.5 Rate needs period

```java
5% per year
```

not just 5%.

Type:

```java
public record InterestRate(BasisPoints annualBasisPoints) {}
```

or include compounding convention if needed.

---

# 14. Counter, Sequence, dan Version

## 14.1 Counter

Counter can be:

- business counter;
- metric counter;
- retry counter;
- sequence counter.

Each has different semantics.

## 14.2 Metric counter

For high-concurrency metric:

```java
LongAdder
```

often better than `AtomicLong` under high contention.

But `LongAdder` is not for strict sequence.

## 14.3 Business counter

Business counter must be exact and auditable.

Use database transaction/constraint if needed.

## 14.4 Sequence number

Sequence number often must be unique and monotonic.

Do not generate with:

```java
static long nextId;
```

in multi-node system.

Use:

- database sequence;
- dedicated ID generator;
- Snowflake-like generator;
- UUID/ULID;
- transactional table;
- distributed sequence service.

## 14.5 Aggregate version

Version for optimistic locking:

```java
record AggregateVersion(long value) {
    AggregateVersion next() {
        return new AggregateVersion(Math.incrementExact(value));
    }
}
```

Database:

```sql
UPDATE cases
SET version = version + 1
WHERE id = ? AND version = ?
```

If no row updated, conflict.

## 14.6 Event version

Events should include aggregate version for ordering/idempotency:

```java
record CaseEscalated(CaseId caseId, AggregateVersion version, Instant occurredAt) {}
```

Consumer can ignore duplicates:

```text
if incomingVersion <= currentVersion: ignore
```

---

# 15. ID Numeric: Database ID, Snowflake-like ID, dan JSON Precision

## 15.1 Numeric database ID

```sql
BIGINT PRIMARY KEY
```

maps to Java:

```java
long
Long
record CaseId(long value)
```

Use wrapper/domain type at boundary.

## 15.2 Generated ID vs domain ID

Database ID may be persistence identity. Domain ID may be business identity.

Example:

```text
internal_id: BIGINT
case_number: CASE-2026-000012
```

Domain may expose case number, not DB ID.

## 15.3 Numeric ID should not be arithmetic

Even if ID is long:

```java
caseId + 1
```

usually meaningless.

Wrap it:

```java
record CaseId(long value) {}
```

## 15.4 Snowflake-like IDs

64-bit IDs may encode:

- timestamp;
- worker ID;
- sequence.

They are numeric but semantically opaque.

Boundary risk:

- JavaScript precision;
- sorting assumptions;
- clock rollback;
- multi-region uniqueness;
- information leakage from timestamp.

## 15.5 External API representation

For public API:

```java
record CaseId(long value) {}
```

can serialize as:

```json
{
  "caseId": "1234567890123456789"
}
```

Use custom serializer or DTO:

```java
record CaseResponse(String caseId) {}
```

## 15.6 Avoid exposing sequential IDs if enumeration risk

Sequential IDs can allow scraping:

```text
/cases/1001
/cases/1002
/cases/1003
```

Authorization must protect regardless, but consider opaque IDs for public-facing resources.

---

# 16. Epoch Time, Duration, dan Numeric Time Trap

## 16.1 Raw time numeric is ambiguous

```java
long timestamp;
```

Could be:

- epoch seconds;
- epoch millis;
- epoch micros;
- epoch nanos;
- local timestamp encoded;
- duration.

## 16.2 Prefer java.time types

Use:

```java
Instant occurredAt;
Duration timeout;
LocalDate businessDate;
ZonedDateTime scheduledAtWithZone;
```

## 16.3 Boundary conversion

JSON:

```json
{
  "occurredAt": "2026-06-12T10:15:30Z"
}
```

or epoch millis if contract says so:

```json
{
  "occurredAtEpochMillis": 1781259330000
}
```

Naming should include unit.

## 16.4 Duration unit bug

Bad:

```java
void setTimeout(long timeout) {}
```

Better:

```java
void setTimeout(Duration timeout) {}
```

If boundary needs milliseconds:

```java
record TimeoutMillis(long value) {}
```

## 16.5 `System.currentTimeMillis` vs `System.nanoTime`

Use:

- `Instant.now(clock)` or `System.currentTimeMillis()` for wall-clock timestamp;
- `System.nanoTime()` for elapsed duration measurement.

Do not store `nanoTime` as timestamp. It is monotonic-ish for elapsed measurement, not epoch time.

---

# 17. Numeric Boundary: JSON, JavaScript, Database, Kafka, CSV

## 17.1 JSON number is not enough

JSON number has no explicit int/long/decimal distinction.

Consumers choose representation.

Risk:

- JavaScript precision loss;
- decimal converted to binary float;
- BigDecimal scale lost;
- scientific notation surprises.

## 17.2 JSON recommendations

For IDs:

```json
{ "id": "9223372036854775807" }
```

For money:

```json
{ "amount": "12.34", "currency": "SGD" }
```

or:

```json
{ "minorUnits": 1234, "currency": "SGD" }
```

For percentage:

```json
{ "basisPoints": 1250 }
```

For timestamp:

```json
{ "occurredAt": "2026-06-12T10:15:30Z" }
```

## 17.3 Kafka/event schema

If using Avro/Protobuf/JSON Schema:

- define logical types;
- specify decimal precision/scale;
- version schema;
- test backward/forward compatibility.

## 17.4 CSV

CSV has no types. Everything is text.

You need parsing rules:

- decimal separator;
- thousand separator;
- currency;
- timezone;
- empty value;
- rounding;
- encoding.

## 17.5 API docs must define semantics

OpenAPI should specify:

- format;
- min/max;
- pattern;
- example;
- string vs number;
- units;
- currency;
- precision/scale.

---

# 18. Database Mapping: `NUMERIC`, `DECIMAL`, `BIGINT`, `INTEGER`

## 18.1 Integer mapping

| Java | SQL typical |
|---|---|
| `int` / `Integer` | `INTEGER` |
| `long` / `Long` | `BIGINT` |
| `BigInteger` | `NUMERIC`/`DECIMAL` with enough precision or text |

## 18.2 Decimal mapping

| Java | SQL typical |
|---|---|
| `BigDecimal` | `NUMERIC(p, s)` or `DECIMAL(p, s)` |

Example:

```sql
amount NUMERIC(19, 2) NOT NULL
currency CHAR(3) NOT NULL
```

## 18.3 Precision/scale mismatch

If Java allows:

```java
BigDecimal("123.456")
```

but DB column:

```sql
NUMERIC(19, 2)
```

DB may round, reject, or truncate depending database/settings.

Validate before persistence.

## 18.4 Nullable numeric columns

DB nullable:

```sql
score INTEGER NULL
```

Java primitive cannot represent null:

```java
int score; // 0 might be mistaken for null
```

Use:

```java
Integer score;
```

at persistence boundary, then map to explicit domain:

```java
Optional<Score>
sealed ScoreState
```

## 18.5 Money database model

Option A:

```sql
amount NUMERIC(19, 2) NOT NULL
currency CHAR(3) NOT NULL
```

Option B:

```sql
minor_units BIGINT NOT NULL
currency CHAR(3) NOT NULL
```

Choose based on domain.

## 18.6 Database constraints

Use constraints:

```sql
CHECK (amount >= 0)
CHECK (currency ~ '^[A-Z]{3}$')
CHECK (minor_units >= 0)
```

Domain validation plus DB constraint is better than either alone.

---

# 19. Formatting vs Data: `NumberFormat`, Currency, Locale

## 19.1 Formatting is presentation

Do not store/display-formatted number as data.

Bad:

```java
String amount = "$1,234.50";
```

Good domain:

```java
Money amount = new Money(new BigDecimal("1234.50"), Currency.getInstance("USD"));
```

Format only at UI/report boundary.

## 19.2 NumberFormat

`NumberFormat` formats numbers/currencies according to locale.

```java
NumberFormat nf = NumberFormat.getCurrencyInstance(Locale.US);
String display = nf.format(new BigDecimal("1234.50"));
```

This is presentation.

## 19.3 Locale matters

Formatting differs:

```text
en-US: $1,234.50
de-DE: 1.234,50 €
id-ID: Rp1.234,50
```

Do not parse user input without locale-aware rules.

## 19.4 Currency formatting is not accounting logic

`NumberFormat` helps display. It does not decide:

- tax rounding;
- settlement;
- FX conversion;
- legal scale;
- accounting policy.

Those belong in domain policy.

## 19.5 Report/audit

For audit, store numeric value and currency separately. Render formatted string as derived output.

---

# 20. Overflow, Underflow, Saturation, dan Exact Arithmetic

## 20.1 Overflow

Integer overflow wraps.

```java
int x = Integer.MAX_VALUE + 1;
```

## 20.2 Underflow

Floating underflow occurs when value becomes too close to zero to represent normally.

For business apps, underflow is less common than precision/rounding issues, but numeric/scientific code must care.

## 20.3 Saturation

Sometimes domain wants saturation:

```text
score max 100
```

Instead of overflow/wrap, clamp:

```java
int saturatedAdd(int a, int b) {
    long result = (long) a + b;
    if (result > 100) return 100;
    if (result < 0) return 0;
    return (int) result;
}
```

But do this only if domain explicitly requires it.

## 20.4 Exact methods

Use:

```java
Math.addExact
Math.subtractExact
Math.multiplyExact
Math.incrementExact
Math.decrementExact
Math.negateExact
Math.toIntExact
```

For exact integer business operations.

## 20.5 BigDecimal exactness

BigDecimal exact decimal arithmetic can still throw on non-terminating division unless rounding specified.

Exactness doesn't remove the need for policy.

---

# 21. Equality dan Comparison untuk Numeric Domain

## 21.1 Primitive equality

`int`, `long` equality is straightforward.

## 21.2 Floating equality

Use tolerance for approximate measurement.

But avoid tolerance for money. Use exact decimal/fixed-point.

## 21.3 BigDecimal comparison

```java
a.compareTo(b) == 0
```

numeric equality.

```java
a.equals(b)
```

numeric value + scale equality.

## 21.4 Domain equality

For Money, decide:

```text
Is SGD 1.0 equal to SGD 1.00?
```

Usually yes.

Implement normalized equality by storing normalized amount or minor units.

With record default equals, be careful:

```java
record Money(BigDecimal amount, Currency currency) {}
```

Default record equals uses `BigDecimal.equals`, so scale matters.

Better:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        this.currency = Objects.requireNonNull(currency);
        this.amount = normalize(amount, currency);
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Money m
            && currency.equals(m.currency)
            && amount.compareTo(m.amount) == 0;
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount.stripTrailingZeros(), currency);
    }
}
```

But ensure hash normalization matches equals.

## 21.5 Ordering with units

Do not compare quantities with different units/currencies without conversion.

```java
SGD 10 < USD 9
```

Meaningless without exchange rate.

---

# 22. Performance dan Memory Cost Numeric Types

## 22.1 Primitive fastest/compact

`int`, `long`, `double` in arrays are compact and efficient.

```java
long[] values;
```

## 22.2 Wrapper overhead

```java
List<Long>
```

has:

- reference array/list;
- Long objects;
- boxing;
- GC pressure.

## 22.3 BigDecimal overhead

`BigDecimal` contains scale and arbitrary precision integer representation.

It is much heavier than primitive. But correctness can be worth it.

Use `BigDecimal` for business values that require decimal exactness, not for every measurement.

## 22.4 Money object overhead

`Money(BigDecimal, Currency)` adds object overhead. Usually acceptable for business transaction processing.

For analytics over millions of rows, consider:

- long minor units;
- vectorized/database aggregation;
- primitive arrays;
- columnar processing;
- avoid per-row object churn.

## 22.5 Measure

Use:

- JMH for microbenchmark;
- JFR allocation profiling;
- load test for end-to-end effect.

Do not reject domain types based on imagined overhead.

---

# 23. Design Patterns untuk Numeric Domain Types

## 23.1 Tiny type

```java
public record CaseCount(int value) {
    public CaseCount {
        if (value < 0) {
            throw new IllegalArgumentException("Case count must not be negative");
        }
    }
}
```

## 23.2 Rich value object

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money add(Money other) { ... }
    public Money multiply(BigDecimal factor, RoundingPolicy rounding) { ... }
}
```

## 23.3 Range type

```java
public record IntRange(int minInclusive, int maxInclusive) {
    public IntRange {
        if (maxInclusive < minInclusive) {
            throw new IllegalArgumentException("Invalid range");
        }
    }

    public boolean contains(int value) {
        return value >= minInclusive && value <= maxInclusive;
    }
}
```

## 23.4 Unit type

```java
public record ByteSize(long bytes) {
    public static ByteSize mebibytes(long mib) {
        return new ByteSize(Math.multiplyExact(mib, 1024L * 1024L));
    }
}
```

## 23.5 Policy type

```java
public record MoneyRoundingPolicy(int scale, RoundingMode roundingMode) {
    public BigDecimal apply(BigDecimal value) {
        return value.setScale(scale, roundingMode);
    }
}
```

## 23.6 Version type

```java
public record Version(long value) {
    public Version {
        if (value < 0) throw new IllegalArgumentException();
    }

    public Version next() {
        return new Version(Math.incrementExact(value));
    }
}
```

---

# 24. Anti-Patterns

## 24.1 `double` for money

```java
double amount;
```

Avoid.

## 24.2 Raw `long` for everything

```java
long id;
long amount;
long timeout;
long version;
```

Everything looks the same.

## 24.3 Ambiguous unit

```java
long timeout;
```

Use:

```java
Duration timeout
TimeoutMillis timeoutMillis
```

## 24.4 BigDecimal from double

```java
new BigDecimal(0.1)
```

Avoid.

## 24.5 Rounding scattered everywhere

```java
value.setScale(2, HALF_UP)
```

duplicated in many places.

Use rounding policy.

## 24.6 Enum ordinal as number

```java
status.ordinal()
```

for persistence/API is dangerous. Reordering enum breaks data.

## 24.7 Numeric status/type code

```java
int status = 3;
```

without enum/domain mapping.

## 24.8 Nullable primitive wrapper leaking everywhere

```java
Integer score
```

passed through many layers without explicit meaning.

## 24.9 Offset pagination unbounded

```java
page * size
```

without overflow and max limit.

## 24.10 JSON long ID as number

Potential precision loss.

---

# 25. Production Failure Case Studies

## 25.1 Settlement mismatch from double

Symptom:

```text
Daily settlement differs by small cents.
```

Root cause:

```java
double total = items.stream().mapToDouble(Item::amount).sum();
```

Fix:

- Money type;
- BigDecimal or minor units;
- explicit rounding;
- golden tests.

## 25.2 Pagination overflow

Symptom:

```text
Negative offset sent to DB, query error or wrong page.
```

Root cause:

```java
int offset = page * size;
```

Fix:

```java
long offset = Math.multiplyExact((long) page, size);
```

with max limit.

## 25.3 JSON ID precision loss

Symptom:

```text
Client requests ID that does not exist.
```

Root cause:

```text
Server sends long JSON number.
Browser rounds it.
```

Fix:

```text
Send ID as string.
```

## 25.4 BigDecimal equality bug

Symptom:

```text
Duplicate amounts appear in HashSet.
```

Root cause:

```java
new BigDecimal("1.0") and new BigDecimal("1.00") not equals.
```

Fix:

- normalize;
- compareTo based domain equality;
- Money type.

## 25.5 Timeout unit bug

Symptom:

```text
Request times out immediately or waits too long.
```

Root cause:

```text
caller sends seconds, callee interprets milliseconds.
```

Fix:

```java
Duration
```

or unit-suffixed field name.

## 25.6 Version overflow

Rare but critical in long-running systems or synthetic tests.

Fix:

```java
Math.incrementExact
```

and define migration/reset strategy if ever needed.

---

# 26. Decision Matrix: Pilih Numeric Type yang Tepat

| Use case | Preferred Java type | Domain wrapper? | Notes |
|---|---|---:|---|
| loop index | `int` | no | local implementation detail |
| bounded page size | `int` | yes optional | validate max |
| DB count | `long` | optional | large counts possible |
| ID internal | `long`/UUID | yes | no arithmetic |
| public JSON ID | `String` DTO | yes internal | avoid JS precision loss |
| money simple fixed minor | `long` | yes Money | include currency |
| money decimal/regulatory | `BigDecimal` | yes Money | rounding policy |
| percentage | `BigDecimal`/int bps | yes | define 0..100 or ratio |
| risk score | `double` | yes optional | finite/range check |
| timeout | `Duration` | maybe | avoid raw long |
| file size | `long` | `ByteSize` optional | explicit unit |
| crypto big integer | `BigInteger` | maybe | use vetted APIs |
| metric high-concurrency | `LongAdder` | no | stats not strict sequence |
| optimistic version | `long` | yes | monotonic/exact increment |

---

# 27. Checklist Review Numeric Type

## 27.1 Meaning

- [ ] Angka ini merepresentasikan apa?
- [ ] Apakah namanya menyebut unit?
- [ ] Apakah primitive cukup jelas?
- [ ] Apakah butuh value object?

## 27.2 Range

- [ ] Nilai minimum/maksimum?
- [ ] Boleh negatif?
- [ ] Bisa overflow?
- [ ] Perlu exact arithmetic?

## 27.3 Precision

- [ ] Exact atau approximate?
- [ ] Decimal atau binary?
- [ ] Butuh rounding?
- [ ] Scale/precision didefinisikan?

## 27.4 Boundary

- [ ] JSON aman?
- [ ] JavaScript consumer aman?
- [ ] Database precision/scale cocok?
- [ ] Kafka/schema compatibility?
- [ ] CSV parsing/formatting jelas?

## 27.5 Domain

- [ ] Currency/unit ada?
- [ ] Operasi antar unit/currency dicegah?
- [ ] Equality/comparison benar?
- [ ] Audit/reporting butuh formatted value?

## 27.6 Performance

- [ ] Volume data besar?
- [ ] BigDecimal overhead acceptable?
- [ ] Boxing terjadi?
- [ ] Primitive array lebih tepat?
- [ ] Sudah diukur jika critical?

---

# 28. Latihan

## Latihan 1 — Money with BigDecimal

Implement:

```java
Money(BigDecimal amount, Currency currency)
```

Rules:

- amount non-null;
- currency non-null;
- add only same currency;
- multiply with rounding policy;
- normalize scale.

Test:

- SGD 1.0 equals SGD 1.00 according to your policy;
- SGD + USD rejected;
- division/rounding deterministic.

## Latihan 2 — Money with minor units

Implement:

```java
MoneyMinor(long minorUnits, Currency currency)
```

Rules:

- use `Math.addExact`;
- reject different currency;
- convert to display decimal.

## Latihan 3 — Pagination overflow

Implement:

```java
Offset calculateOffset(PageNumber page, PageSize size)
```

with:

- max page size;
- overflow guard;
- max offset.

## Latihan 4 — Percentage vs ratio

Implement:

```java
Percentage
Ratio
BasisPoints
```

Show conversions.

## Latihan 5 — BigDecimal equality

Experiment:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"))
new BigDecimal("1.0").compareTo(new BigDecimal("1.00"))
```

Then design Money equality.

## Latihan 6 — JSON long precision

Serialize:

```java
Long.MAX_VALUE
```

as JSON number and as JSON string. Explain why string is safer for browser clients.

## Latihan 7 — Duration

Refactor:

```java
void call(long timeout)
```

to:

```java
void call(Duration timeout)
```

and create boundary DTO with explicit `timeoutMillis`.

## Latihan 8 — Version

Implement:

```java
AggregateVersion
```

with:

- non-negative;
- `next()` exact;
- compareTo;
- JSON representation;
- DB mapping.

---

# 29. Ringkasan

Numeric types in Java are not just:

```text
int, long, double, BigDecimal
```

They are choices about:

```text
meaning
range
precision
rounding
unit
currency
identity
boundary
performance
audit
compatibility
```

Rules to remember:

- Use `int` for ordinary bounded counts/indexes.
- Use `long` for large counters, versions, sizes, epoch values, and minor units.
- Use `BigInteger` only when arbitrary integer precision is truly needed.
- Use `double` for approximate measurement/scoring, not money.
- Use `BigDecimal` for exact decimal business values, but wrap it.
- Never model money as amount without currency.
- Never ignore scale/rounding policy.
- Never expose large `long` IDs as JSON numbers to JavaScript clients.
- Prefer `Duration`, `Instant`, `LocalDate` over raw numeric time.
- Use exact arithmetic for business-critical integer operations.
- Use domain-specific numeric types when meaning matters.

Top-tier engineering is not choosing the “largest” or “most precise” type every time. It is choosing the type whose semantics match the business and whose representation is safe across runtime, database, API, and production operations.

---

# 30. Referensi

1. Java SE 25 API — `BigDecimal`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html

2. Java SE 25 API — `BigInteger`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html

3. Java SE 25 API — `RoundingMode`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/RoundingMode.html

4. Java SE 25 API — `Math`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Math.html

5. Java SE 25 API — `Integer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Integer.html

6. Java SE 25 API — `Long`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Long.html

7. Java SE 25 API — `Double`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Double.html

8. Java SE 25 API — `Currency`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Currency.html

9. Java SE 25 API — `NumberFormat`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/NumberFormat.html

10. Java Language Specification SE 25 — Chapter 4: Types, Values, and Variables  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

11. Java Language Specification SE 25 — Chapter 5: Conversions and Contexts  
    https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-001.md](./learn-java-data-types-part-001.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-data-types-part-003.md](./learn-java-data-types-part-003.md)

</div>
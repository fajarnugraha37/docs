# learn-java-data-types-part-003.md

# Java Data Types — Part 003  
# Floating Point Deep Dive: IEEE 754, NaN, Precision, Determinism, dan Numeric Correctness

> Seri: **Advanced Java Data Types**  
> Bagian: **003**  
> Fokus: memahami `float` dan `double` secara mendalam: representasi biner, precision, rounding, `NaN`, infinity, signed zero, comparison, determinism, `strictfp`, JEP 306, dan bagaimana membuat keputusan engineering yang benar saat memakai floating point.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Floating Point Itu Bukan Decimal Real Number](#2-floating-point-itu-bukan-decimal-real-number)
3. [Kapan Floating Point Tepat dan Kapan Tidak](#3-kapan-floating-point-tepat-dan-kapan-tidak)
4. [Mental Model IEEE 754: Sign, Exponent, Significand](#4-mental-model-ieee-754-sign-exponent-significand)
5. [`float` vs `double`](#5-float-vs-double)
6. [Kenapa `0.1 + 0.2` Tidak Sama dengan `0.3`](#6-kenapa-01--02-tidak-sama-dengan-03)
7. [Rounding Error dan Error Accumulation](#7-rounding-error-dan-error-accumulation)
8. [Machine Epsilon dan ULP](#8-machine-epsilon-dan-ulp)
9. [Special Values: `NaN`, Infinity, dan Signed Zero](#9-special-values-nan-infinity-dan-signed-zero)
10. [`NaN`: Not-a-Number yang Menular](#10-nan-not-a-number-yang-menular)
11. [Infinity: Bukan Exception](#11-infinity-bukan-exception)
12. [Signed Zero: `0.0` dan `-0.0`](#12-signed-zero-00-dan--00)
13. [Comparison: `==`, Tolerance, `Double.compare`, dan Sorting](#13-comparison--tolerance-doublecompare-dan-sorting)
14. [Equality Trap pada `Double` dan `Float` Wrapper](#14-equality-trap-pada-double-dan-float-wrapper)
15. [Casting dan Conversion Floating Point](#15-casting-dan-conversion-floating-point)
16. [Floating Point dan Integer Precision Boundary](#16-floating-point-dan-integer-precision-boundary)
17. [`Math` vs `StrictMath`](#17-math-vs-strictmath)
18. [`strictfp` dan JEP 306: Always-Strict Floating Point](#18-strictfp-dan-jep-306-always-strict-floating-point)
19. [Determinism, Reproducibility, dan Cross-Platform Behavior](#19-determinism-reproducibility-dan-cross-platform-behavior)
20. [Floating Point di JSON, Database, dan API Contract](#20-floating-point-di-json-database-dan-api-contract)
21. [Floating Point untuk Scoring, Ranking, ML, dan Measurement](#21-floating-point-untuk-scoring-ranking-ml-dan-measurement)
22. [Floating Point untuk Money: Kenapa Hampir Selalu Salah](#22-floating-point-untuk-money-kenapa-hampir-selalu-salah)
23. [Numerical Stability: Order of Operations Matters](#23-numerical-stability-order-of-operations-matters)
24. [Summation Algorithms: Naive, Kahan, Pairwise](#24-summation-algorithms-naive-kahan-pairwise)
25. [Validation: Finite, Range, Domain Constraint](#25-validation-finite-range-domain-constraint)
26. [Performance Considerations](#26-performance-considerations)
27. [Production Failure Modes](#27-production-failure-modes)
28. [Best Practices](#28-best-practices)
29. [Decision Matrix](#29-decision-matrix)
30. [Latihan](#30-latihan)
31. [Ringkasan](#31-ringkasan)
32. [Referensi](#32-referensi)

---

# 1. Tujuan Bagian Ini

Floating point adalah salah satu sumber bug paling “halus” dalam software engineering.

Kode berikut terlihat wajar:

```java
double total = 0.1 + 0.2;
System.out.println(total == 0.3);
```

Tetapi hasilnya:

```text
false
```

Bukan karena Java salah. Java melakukan binary floating-point arithmetic sesuai model yang memang approximate.

Tujuan bagian ini:

- memahami mengapa floating point approximate;
- memahami representasi `float` dan `double`;
- memahami `NaN`, infinity, signed zero;
- memahami comparison yang benar;
- memahami kapan memakai `double`;
- memahami kapan harus menghindari `double`;
- memahami determinism Java modern;
- memahami hubungan floating point dengan API/database/JSON;
- memahami failure mode production;
- memahami cara membuat domain type berbasis floating point dengan aman.

---

# 2. Floating Point Itu Bukan Decimal Real Number

Kesalahan mental model paling umum:

```text
double = angka real
```

Yang benar:

```text
double = representasi finite subset dari angka real dalam binary floating-point format
```

Tidak semua angka decimal bisa direpresentasikan secara tepat.

Contoh decimal sederhana:

```text
0.1
```

Dalam basis 10, `0.1` sederhana.

Dalam basis 2, `0.1` adalah pecahan berulang tak berhingga.

Akibatnya, `double` menyimpan approximation terdekat.

## 2.1 Analogi pecahan

Dalam basis 10:

```text
1/3 = 0.333333333...
```

Tidak bisa ditulis finite decimal.

Dalam basis 2:

```text
1/10 = 0.00011001100110011...
```

Tidak bisa ditulis finite binary fraction.

Maka komputer menyimpan approximation.

## 2.2 Floating point itu trade-off

Floating point dirancang untuk:

- range sangat besar;
- efisiensi hardware;
- operasi cepat;
- approximate numeric computation;
- scientific/engineering computation;
- graphics/ML/statistics.

Bukan untuk:

- exact decimal accounting;
- money settlement;
- legal/regulatory decimal;
- identity;
- exact equality setelah operasi decimal.

---

# 3. Kapan Floating Point Tepat dan Kapan Tidak

## 3.1 Tepat untuk

`double` cocok untuk:

- measurement sensor;
- geospatial calculation;
- scientific computing;
- physics simulation;
- risk score;
- probability;
- ranking score;
- ML inference;
- statistics;
- approximation;
- normalized score `0.0..1.0`;
- latency average;
- percentiles computed by library;
- graphics.

Contoh:

```java
public record RiskScore(double value) {
    public RiskScore {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("Risk score must be finite");
        }
        if (value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Risk score must be between 0 and 1");
        }
    }
}
```

## 3.2 Tidak tepat untuk

Hindari `float`/`double` untuk:

- money;
- tax;
- invoice;
- settlement;
- bank balance;
- quantity yang harus decimal exact;
- legal threshold dengan exact decimal rule;
- database exact `NUMERIC`;
- equality-sensitive decimal value;
- audit-critical calculation tanpa rounding policy.

Gunakan:

- `BigDecimal`;
- `long minorUnits`;
- domain type;
- explicit rounding policy.

## 3.3 Approximate bukan berarti sembarangan

Walaupun `double` cocok untuk score, tetap harus validasi:

```java
if (!Double.isFinite(score)) reject;
if (score < 0.0 || score > 1.0) reject;
```

Tanpa guard, `NaN` bisa menyebar dan merusak ranking/filtering.

---

# 4. Mental Model IEEE 754: Sign, Exponent, Significand

Floating point menyimpan angka dalam bentuk konseptual:

```text
sign × significand × base^exponent
```

Untuk Java `float` dan `double`, basisnya adalah 2.

## 4.1 `float`

`float` adalah 32-bit.

Konseptual layout:

```text
1 sign bit
8 exponent bits
23 fraction/significand bits
```

## 4.2 `double`

`double` adalah 64-bit.

Konseptual layout:

```text
1 sign bit
11 exponent bits
52 fraction/significand bits
```

## 4.3 Kenapa exponent penting?

Exponent memungkinkan representasi range besar:

```text
very small numbers
very large numbers
```

Tetapi jumlah significand bits terbatas, sehingga precision terbatas.

## 4.4 Precision relatif

Floating point punya precision relatif.

Artinya, jarak antar representable numbers makin besar ketika nilai makin besar.

Contoh:

```java
double x = 1_000_000_000_000_000_000.0;
double y = x + 1.0;

System.out.println(x == y); // likely true
```

Pada magnitude besar, `+1` terlalu kecil untuk mengubah representasi `double`.

---

# 5. `float` vs `double`

## 5.1 `float`

`float`:

- 32-bit;
- lebih hemat memory;
- precision lebih rendah;
- sering dipakai di graphics, ML tensor, binary protocol;
- jarang ideal untuk business logic.

```java
float f = 1.23f;
```

## 5.2 `double`

`double`:

- 64-bit;
- default floating literal;
- precision lebih tinggi;
- default choice untuk floating point di Java;
- banyak API `Math` memakai double.

```java
double d = 1.23;
```

## 5.3 Default rule

Gunakan `double` kecuali:

- format/protocol menuntut float;
- memory bandwidth sangat penting;
- array sangat besar;
- library/accelerator memakai float;
- precision rendah acceptable.

## 5.4 Jangan memakai `float` untuk menghemat memory secara premature

Field `float` dalam object tidak selalu menghemat sebesar yang dibayangkan karena object header, alignment, dan padding.

Memory saving signifikan terutama pada:

```java
float[] values;
```

bukan pada satu field kecil di object biasa.

---

# 6. Kenapa `0.1 + 0.2` Tidak Sama dengan `0.3`

Contoh:

```java
double a = 0.1;
double b = 0.2;
double c = 0.3;

System.out.println(a + b);
System.out.println((a + b) == c);
```

Typical output:

```text
0.30000000000000004
false
```

## 6.1 Penyebab

`0.1`, `0.2`, dan `0.3` tidak disimpan sebagai decimal exact. Masing-masing adalah approximation terdekat dalam binary floating point.

Saat approximation dijumlahkan, hasilnya bisa sedikit di atas/bawah approximation `0.3`.

## 6.2 Bukan bug Java

Ini berlaku di banyak bahasa/platform yang memakai IEEE 754 binary floating point.

Java hanya mengekspos behavior itu secara konsisten.

## 6.3 Cara berpikir yang benar

Jangan berpikir:

```text
double menyimpan angka decimal yang kita tulis
```

Pikirkan:

```text
double menyimpan representable binary approximation terdekat
```

## 6.4 Solusi tergantung domain

Untuk measurement:

```java
Math.abs(actual - expected) < epsilon
```

Untuk money:

```java
BigDecimal
long minorUnits
```

Untuk display:

```java
format with required precision
```

Jangan memperbaiki business calculation dengan sekadar formatting output.

---

# 7. Rounding Error dan Error Accumulation

## 7.1 Satu operasi bisa memiliki rounding error

```java
double x = 1.0 / 10.0;
```

Hasilnya approximation.

## 7.2 Banyak operasi bisa mengakumulasi error

```java
double sum = 0.0;
for (int i = 0; i < 1_000_000; i++) {
    sum += 0.1;
}
```

Hasil tidak exactly `100000.0`.

## 7.3 Order matters

Floating point addition is not associative.

```java
(a + b) + c
```

bisa berbeda dari:

```java
a + (b + c)
```

Contoh:

```java
double a = 1e16;
double b = -1e16;
double c = 1.0;

System.out.println((a + b) + c); // 1.0
System.out.println(a + (b + c)); // 0.0
```

## 7.4 Production implication

Parallel aggregation can produce slightly different result than sequential aggregation because order changes.

This matters for:

- analytics;
- ML metrics;
- risk scoring;
- scientific computation;
- reconciliation if exactness expected.

If exact decimal result required, don't use double.

---

# 8. Machine Epsilon dan ULP

## 8.1 ULP

ULP means Unit in the Last Place.

In Java:

```java
Math.ulp(double d)
Math.ulp(float f)
```

returns size of an ulp of the argument.

Example:

```java
System.out.println(Math.ulp(1.0));
System.out.println(Math.ulp(1_000_000_000_000_000.0));
```

ULP grows with magnitude.

## 8.2 Why ULP matters

A fixed epsilon:

```java
1e-9
```

may be too small for large values and too large for tiny values.

Sometimes relative tolerance is better:

```java
static boolean nearlyEqual(double a, double b, double relTol, double absTol) {
    double diff = Math.abs(a - b);
    if (diff <= absTol) return true;
    return diff <= Math.max(Math.abs(a), Math.abs(b)) * relTol;
}
```

## 8.3 Domain tolerance

Tolerance is a business/scientific decision.

Examples:

```text
temperature sensor: ±0.01 acceptable
geo distance: ±1 meter acceptable
risk score: ±1e-6 acceptable
money: no tolerance; use exact decimal/fixed point
```

---

# 9. Special Values: `NaN`, Infinity, dan Signed Zero

Floating point includes special values:

```text
NaN
positive infinity
negative infinity
positive zero
negative zero
```

These make floating point robust for numeric computation but surprising for business logic.

## 9.1 Why special values exist

Instead of throwing exception for every invalid operation, floating point can produce a special value that propagates.

Examples:

```java
0.0 / 0.0       // NaN
1.0 / 0.0       // Infinity
-1.0 / 0.0      // -Infinity
Math.sqrt(-1.0) // NaN
```

## 9.2 Production rule

If your domain does not allow special values, validate at boundary:

```java
if (!Double.isFinite(value)) {
    throw new IllegalArgumentException("Value must be finite");
}
```

Do not let `NaN` enter domain objects.

---

# 10. `NaN`: Not-a-Number yang Menular

## 10.1 Creating NaN

```java
double a = 0.0 / 0.0;
double b = Math.sqrt(-1.0);
double c = Double.NaN;
```

## 10.2 NaN comparisons

```java
double n = Double.NaN;

System.out.println(n == n); // false
System.out.println(n != n); // true
System.out.println(n < 0);  // false
System.out.println(n > 0);  // false
System.out.println(n <= 0); // false
System.out.println(n >= 0); // false
```

This breaks naive checks.

Bad validation:

```java
if (score >= 0.0 && score <= 1.0) {
    accept(score);
}
```

For NaN, condition false, so maybe rejected. But other code might not check.

Worse:

```java
if (score < 0.0 || score > 1.0) {
    reject();
}
accept(score); // NaN passes because both comparisons false
```

Fix:

```java
if (!Double.isFinite(score) || score < 0.0 || score > 1.0) {
    reject();
}
```

## 10.3 NaN propagation

```java
double x = Double.NaN;
double y = x + 1.0;
double z = y * 2.0;
```

`z` is still NaN.

## 10.4 NaN in sorting/ranking

If risk score can be NaN, ranking can behave unexpectedly.

Always define:

```text
NaN rejected?
NaN sorted last?
NaN treated as missing?
```

Prefer reject at domain boundary.

## 10.5 Multiple NaN bit patterns

IEEE 754 allows many NaN bit patterns. Java wrapper equality/compare APIs define behavior for object contracts. Use Java APIs rather than raw assumptions.

---

# 11. Infinity: Bukan Exception

## 11.1 Creating infinity

```java
double p = 1.0 / 0.0;
double n = -1.0 / 0.0;
```

No ArithmeticException for floating point division by zero.

Contrast integer:

```java
int x = 1 / 0; // ArithmeticException
```

## 11.2 Infinity operations

```java
Double.POSITIVE_INFINITY + 1.0 // Infinity
Double.POSITIVE_INFINITY * 0.0 // NaN
```

## 11.3 Infinity validation

Use:

```java
Double.isInfinite(value)
Double.isFinite(value)
```

## 11.4 Production risk

If infinity reaches JSON/database:

- serializer may output non-standard token;
- database may reject;
- API consumer may fail;
- dashboards may break;
- sorting may put value at extreme.

Reject unless domain explicitly supports infinity.

---

# 12. Signed Zero: `0.0` dan `-0.0`

Floating point has positive zero and negative zero.

```java
double pz = 0.0;
double nz = -0.0;

System.out.println(pz == nz); // true
```

But:

```java
System.out.println(1.0 / pz); // Infinity
System.out.println(1.0 / nz); // -Infinity
```

## 12.1 Why signed zero matters

Signed zero preserves direction of underflow/limit in numeric algorithms.

For normal business apps, it usually should be normalized away if it can confuse display/comparison.

## 12.2 Wrapper equality differs from `==`

`Double.valueOf(0.0).equals(Double.valueOf(-0.0))` is false according to `Double.equals` semantics, because representation differs.

This matters in:

- HashSet;
- HashMap;
- record equality with `Double` components;
- boxed values.

## 12.3 Normalize if domain doesn't care

```java
static double normalizeZero(double x) {
    return x == 0.0 ? 0.0 : x;
}
```

This turns `-0.0` into `+0.0`.

---

# 13. Comparison: `==`, Tolerance, `Double.compare`, dan Sorting

## 13.1 Exact comparison

Use `==` only when:

- comparing values assigned from same exact source;
- checking zero in carefully defined algorithm;
- checking constants/sentinel with known behavior;
- bit-level semantics not required;
- no arithmetic approximation involved.

Avoid:

```java
if (calculated == expected) {}
```

for decimal/scientific computation unless proven.

## 13.2 Absolute tolerance

```java
static boolean closeAbs(double a, double b, double epsilon) {
    return Math.abs(a - b) <= epsilon;
}
```

Good near zero.

Bad for very large magnitude.

## 13.3 Relative tolerance

```java
static boolean closeRel(double a, double b, double relTol) {
    return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * relTol;
}
```

Good for large magnitude.

Bad near zero.

## 13.4 Combined tolerance

```java
static boolean nearlyEqual(double a, double b, double absTol, double relTol) {
    if (!Double.isFinite(a) || !Double.isFinite(b)) {
        return false;
    }
    double diff = Math.abs(a - b);
    return diff <= absTol ||
           diff <= Math.max(Math.abs(a), Math.abs(b)) * relTol;
}
```

## 13.5 `Double.compare`

For sorting:

```java
values.sort(Double::compare);
```

`Double.compare` defines total ordering including NaN and signed zero behavior according to Java API.

## 13.6 Comparator with domain policy

For ranking score, decide:

- reject NaN;
- sort descending;
- tie-breaking;
- tolerance grouping or exact ordering.

Example:

```java
Comparator<RiskScore> byScoreDesc =
    Comparator.comparingDouble(RiskScore::value).reversed();
```

But only after `RiskScore` constructor rejects non-finite values.

---

# 14. Equality Trap pada `Double` dan `Float` Wrapper

Primitive comparison:

```java
0.0 == -0.0 // true
Double.NaN == Double.NaN // false
```

Wrapper `Double.equals`:

```java
Double.valueOf(0.0).equals(Double.valueOf(-0.0)) // false
Double.valueOf(Double.NaN).equals(Double.valueOf(Double.NaN)) // true
```

Why? Wrapper equals must satisfy object equality contract like reflexivity, and it uses representation semantics via doubleToLongBits-like behavior.

## 14.1 Record with Double component

```java
record Measurement(Double value) {}
```

Record generated equals uses `Objects.equals`, so wrapper semantics apply.

If using primitive:

```java
record Measurement(double value) {}
```

Record generated equals has special handling equivalent to wrapper compare semantics for floating components.

Still, think carefully about NaN/-0.0.

## 14.2 Domain equality should be explicit

If domain says `-0.0` equals `0.0`, normalize.

If domain rejects NaN, validate.

Example:

```java
public record Temperature(double celsius) {
    public Temperature {
        if (!Double.isFinite(celsius)) {
            throw new IllegalArgumentException("Temperature must be finite");
        }
        if (celsius == 0.0) {
            celsius = 0.0; // normalize -0.0
        }
    }
}
```

---

# 15. Casting dan Conversion Floating Point

## 15.1 int to double

```java
int i = 123;
double d = i;
```

Usually exact for int values because double has enough precision for all int values.

## 15.2 long to double

Not all long values are exactly representable.

```java
long x = 9_007_199_254_740_993L; // 2^53 + 1
double d = x;
long y = (long) d;

System.out.println(x == y); // false
```

## 15.3 double to int/long

Casting truncates toward zero and handles special cases according to JLS rules.

```java
int x = (int) 1.9;  // 1
int y = (int) -1.9; // -1
```

For out-of-range, result saturates to min/max for integer type according to conversion rules, but do not rely casually.

Better validate explicitly:

```java
if (!Double.isFinite(value) || value < Integer.MIN_VALUE || value > Integer.MAX_VALUE) {
    throw new IllegalArgumentException();
}
int x = (int) value;
```

## 15.4 double to BigDecimal

Bad:

```java
new BigDecimal(0.1)
```

Better:

```java
BigDecimal.valueOf(0.1)
```

or best if value originally decimal text:

```java
new BigDecimal("0.1")
```

## 15.5 BigDecimal to double

```java
double d = bigDecimal.doubleValue();
```

May lose precision and range. Only do this when approximate conversion is acceptable.

---

# 16. Floating Point dan Integer Precision Boundary

`double` can exactly represent all integers up to 2^53.

Beyond that, not every integer is representable.

## 16.1 Safe integer boundary

```text
2^53 = 9,007,199,254,740,992
```

Above that, integer increments by 1 may disappear.

```java
double x = 9_007_199_254_740_992.0;
System.out.println(x + 1 == x); // true
```

## 16.2 Why it matters

If you put Java `long` ID into `double`, or send it to JavaScript Number, precision may be lost.

## 16.3 API rule

Large numeric IDs should be strings in JSON if JavaScript/browser clients are possible.

```json
{
  "id": "9007199254740993"
}
```

## 16.4 Database/reporting risk

Exporting large integer IDs to CSV/Excel may also lose formatting/precision if consumers treat them as numeric.

Consider string formatting for IDs.

---

# 17. `Math` vs `StrictMath`

## 17.1 `Math`

`java.lang.Math` provides common math functions:

```java
Math.sin
Math.cos
Math.sqrt
Math.pow
Math.fma
Math.ulp
Math.nextUp
Math.nextDown
```

It may use platform intrinsics for performance.

## 17.2 `StrictMath`

`StrictMath` historically provided reproducible results matching fdlibm algorithms for transcendental functions.

After Java 17's always-strict floating-point semantics, ordinary floating-point expression evaluation is consistently strict. But `Math` and `StrictMath` can still differ for some transcendental functions because `Math` may choose performance/intrinsics while `StrictMath` prioritizes reproducible algorithm definitions.

## 17.3 Practical rule

Use `Math` by default.

Use `StrictMath` if you specifically require reproducibility of certain math functions across platforms and accept possible performance trade-offs.

For most backend business systems, neither should be used for money.

## 17.4 `Math.fma`

Fused multiply-add:

```java
Math.fma(a, b, c)
```

computes `a * b + c` with a single rounding when hardware/support allows semantics. This can improve accuracy/performance in numeric code.

But if exact decimal business rule needed, use decimal/fixed-point, not FMA.

---

# 18. `strictfp` dan JEP 306: Always-Strict Floating Point

## 18.1 Historical context

Older Java had distinction between:

```text
strict floating-point
default floating-point
```

`strictfp` could force strict behavior for portability.

## 18.2 JEP 306

JEP 306 restored always-strict floating-point semantics starting in Java 17. That means Java no longer has subtle default-vs-strict floating-point modes for normal expression evaluation.

## 18.3 What about `strictfp` keyword?

In modern Java, `strictfp` is obsolete/redundant. The compiler may warn that it is unnecessary because floating-point expressions are already evaluated strictly.

## 18.4 Production impact

This improves reproducibility and simplifies reasoning.

But it does not mean:

```text
floating point becomes decimal exact
```

It only means evaluation semantics are consistently strict.

All the usual issues remain:

- rounding;
- precision;
- NaN;
- infinity;
- signed zero;
- non-associativity;
- decimal approximation.

---

# 19. Determinism, Reproducibility, dan Cross-Platform Behavior

## 19.1 Determinism dimensions

Floating point reproducibility can be affected by:

- expression evaluation semantics;
- order of operations;
- parallelism;
- math library functions;
- CPU intrinsics;
- compiler optimization;
- hardware;
- `Math` vs `StrictMath`;
- use of FMA;
- non-deterministic aggregation order.

## 19.2 Java modern improvement

Java 17+ always-strict semantics improves consistency of ordinary floating-point calculations.

## 19.3 Parallel aggregation still not deterministic if order changes

```java
double sum = values.parallelStream().mapToDouble(...).sum();
```

May not produce exactly same result as sequential due to different summation order.

If reproducibility matters:

- define deterministic order;
- use stable summation algorithm;
- use BigDecimal/fixed point if exact decimal needed;
- document tolerance.

## 19.4 Distributed systems

If multiple services compute scores independently, ensure:

- same algorithm version;
- same inputs;
- same normalization;
- same missing-value policy;
- same tolerance;
- same Java/library version if reproducibility critical.

---

# 20. Floating Point di JSON, Database, dan API Contract

## 20.1 JSON

JSON number may be parsed as double in many clients.

If API sends:

```json
{ "score": 0.30000000000000004 }
```

Is that acceptable? For score maybe yes. For money no.

## 20.2 Non-standard values

JSON standard does not support NaN/Infinity as normal numeric values.

Some libraries may serialize them as strings, null, or non-standard tokens depending configuration.

Best:

```text
Reject NaN/Infinity before serialization.
```

## 20.3 Database

SQL `DOUBLE PRECISION`/`FLOAT` types are approximate.

Use for approximate measurements.

Use `NUMERIC`/`DECIMAL` for exact decimal.

## 20.4 API docs

For floating fields, document:

- range;
- finite requirement;
- precision expectation;
- whether null/missing allowed;
- rounding/display;
- examples;
- meaning.

Example:

```yaml
riskScore:
  type: number
  format: double
  minimum: 0
  maximum: 1
  description: Finite score in range [0, 1]. NaN and Infinity are not allowed.
```

## 20.5 Kafka/events

For event schemas:

- use double for approximate score;
- avoid double for money;
- define missing value policy;
- schema evolution;
- validate before publish.

---

# 21. Floating Point untuk Scoring, Ranking, ML, dan Measurement

## 21.1 Risk score

```java
public record RiskScore(double value) implements Comparable<RiskScore> {
    public RiskScore {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("Risk score must be finite");
        }
        if (value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Risk score must be in [0, 1]");
        }
        if (value == 0.0) {
            value = 0.0; // normalize -0.0
        }
    }

    @Override
    public int compareTo(RiskScore other) {
        return Double.compare(this.value, other.value);
    }
}
```

## 21.2 Ranking

When sorting descending:

```java
Comparator<RiskScore> descending =
    Comparator.comparingDouble(RiskScore::value).reversed();
```

Define tie-breaker:

```java
.thenComparing(...)
```

## 21.3 Measurement

For measurement, include unit:

```java
record TemperatureCelsius(double value) {
    public TemperatureCelsius {
        if (!Double.isFinite(value)) throw new IllegalArgumentException();
    }
}
```

## 21.4 Probability

Probability must be in `0..1`.

```java
record Probability(double value) {
    public Probability {
        if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Probability must be finite and in [0, 1]");
        }
    }
}
```

## 21.5 Missing value

Do not use NaN as missing value unless algorithm/library explicitly expects it.

In domain/business code, prefer:

```java
Optional<RiskScore>
sealed ScoreState
```

or explicit:

```java
record ScoreUnavailable(Reason reason)
```

---

# 22. Floating Point untuk Money: Kenapa Hampir Selalu Salah

## 22.1 Decimal exactness

Money requires decimal exactness and defined rounding.

Floating point is binary approximate.

```java
double price = 19.99;
double total = price * 3;
```

May not match expected exact decimal.

## 22.2 Legal/regulatory requirement

Financial systems need explainable rounding:

```text
round tax per line item or final invoice?
HALF_UP or HALF_EVEN?
scale 2 or currency-specific?
```

`double` does not encode these rules.

## 22.3 Use Money type

```java
record Money(BigDecimal amount, Currency currency) {}
```

or:

```java
record Money(long minorUnits, Currency currency) {}
```

## 22.4 If external gives double

If external API gives `double` amount, treat as unsafe boundary.

Convert carefully:

```java
BigDecimal amount = BigDecimal.valueOf(externalDouble);
```

But prefer external contract as string/decimal.

## 22.5 Display formatting is not correctness

Formatting:

```java
System.out.printf("%.2f", total);
```

only hides representation. It does not fix calculation.

---

# 23. Numerical Stability: Order of Operations Matters

## 23.1 Catastrophic cancellation

Subtracting nearly equal large numbers can lose significant digits.

```java
double a = 1_000_000_000.000001;
double b = 1_000_000_000.000000;
double diff = a - b;
```

Result may lose precision.

## 23.2 Sum small to large

Adding tiny values to huge accumulator can lose tiny values.

```java
double sum = 1e16;
sum += 1.0;
```

`sum` may not change.

## 23.3 Reorder operations

Sometimes summing from smallest magnitude to largest reduces error.

## 23.4 Domain implication

For analytics/science:

- choose stable algorithms;
- test with known numerical cases;
- use libraries if needed;
- document tolerance.

For business exactness:

- don't rely on numerical stability; use exact decimal/fixed-point.

---

# 24. Summation Algorithms: Naive, Kahan, Pairwise

## 24.1 Naive sum

```java
static double naiveSum(double[] values) {
    double sum = 0.0;
    for (double v : values) {
        sum += v;
    }
    return sum;
}
```

Simple but can accumulate error.

## 24.2 Kahan summation

```java
static double kahanSum(double[] values) {
    double sum = 0.0;
    double c = 0.0;

    for (double value : values) {
        double y = value - c;
        double t = sum + y;
        c = (t - sum) - y;
        sum = t;
    }

    return sum;
}
```

Improves accuracy for many cases.

## 24.3 Pairwise summation

Pairwise recursively sums halves, often better than naive and parallelizable.

## 24.4 When needed?

Use better summation for:

- large numeric arrays;
- scientific/statistical computation;
- analytics where error matters;
- financial approximation? No, use exact decimal/fixed point.

## 24.5 Validate with benchmark and accuracy tests

Measure both:

- accuracy error;
- performance cost.

---

# 25. Validation: Finite, Range, Domain Constraint

## 25.1 Always validate floating domain type

Example:

```java
public record NormalizedScore(double value) {
    public NormalizedScore {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("Score must be finite");
        }
        if (value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Score must be in [0, 1]");
        }
        if (value == 0.0) {
            value = 0.0;
        }
    }
}
```

## 25.2 Avoid raw double in domain API

Bad:

```java
void updateRiskScore(String caseId, double score)
```

Better:

```java
void updateRiskScore(CaseId caseId, RiskScore score)
```

## 25.3 Boundary validation

At REST boundary:

- reject NaN/infinity;
- range check;
- parse errors;
- missing/null handling;
- schema validation.

At DB boundary:

- column type;
- check constraints if possible;
- no NaN if DB/application cannot handle.

## 25.4 Alert on impossible values

If metric score can be NaN, add validation metric/log:

```text
invalid_score_rejected_total
```

---

# 26. Performance Considerations

## 26.1 double is fast

On modern hardware/JVM, double operations are generally fast and optimized.

## 26.2 BigDecimal is heavier

`BigDecimal` is object-based arbitrary precision decimal. It has allocation and CPU cost.

Use it when correctness requires it.

## 26.3 float arrays are compact

`float[]` is half the memory of `double[]`.

Useful for:

- ML tensors;
- graphics;
- large measurement arrays.

## 26.4 Vectorization

Java Vector API can accelerate numeric operations, but it is advanced/incubator territory in Java 25. Use library/JDK features cautiously and benchmark.

## 26.5 Avoid boxing

```java
List<Double>
```

causes boxing/object overhead.

For large numeric data:

```java
double[]
DoubleStream
specialized libraries
```

## 26.6 JMH for microbenchmark

Use JMH, not naive loops, to compare numeric algorithms.

---

# 27. Production Failure Modes

## 27.1 Money mismatch

Root cause:

```java
double amount
```

Fix:

```java
Money(BigDecimal/Currency)
```

## 27.2 NaN passes validation

Bad:

```java
if (score < 0 || score > 1) reject;
```

NaN passes.

Fix:

```java
if (!Double.isFinite(score) || score < 0 || score > 1) reject;
```

## 27.3 Infinity in JSON response

Computation returns infinity; serializer emits invalid/non-standard JSON or fails.

Fix:

- validate finite;
- error handling;
- domain constraint.

## 27.4 Ranking instability

Parallel aggregation changes order and score slightly, causing borderline ranking changes.

Fix:

- deterministic algorithm;
- tolerance bands;
- stable tie-breaker;
- exact business rule if ranking has legal effect.

## 27.5 Large ID precision loss

`long` converted to `double`/JSON number/JavaScript Number.

Fix:

- string ID externally.

## 27.6 `-0.0` display bug

User sees `-0.00`.

Fix:

- normalize zero before display/domain.

## 27.7 Threshold boundary bug

```java
if (score >= 0.7) approve;
```

Calculated score intended 0.7 but actual 0.699999999999.

Fix:

- define tolerance;
- use rational/integer basis points if threshold is business exact;
- avoid double if legal threshold exact.

---

# 28. Best Practices

## 28.1 General

- Use `double` for approximate numeric computation.
- Use `float` only when memory/protocol/library requires it.
- Never use `double`/`float` for money.
- Validate finite values in domain constructors.
- Normalize `-0.0` if domain doesn't distinguish it.
- Reject or explicitly handle NaN/infinity.
- Use tolerance for approximate comparison.
- Use `Double.compare` for total ordering/sorting.
- Use `BigDecimal`/fixed-point for exact decimal.
- Document tolerance and rounding policy.
- Beware conversion from/to `long`.
- Avoid boxed `Double` in hot numeric arrays.
- Test boundary values.

## 28.2 Domain type pattern

```java
public record Probability(double value) {
    public Probability {
        if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Probability must be finite and in [0,1]");
        }
        if (value == 0.0) {
            value = 0.0;
        }
    }
}
```

## 28.3 API contract

For floating API fields:

```text
finite only
range defined
NaN/infinity not allowed
precision expectation documented
unit documented
```

## 28.4 Testing

Test:

- NaN;
- positive infinity;
- negative infinity;
- -0.0;
- min/max;
- values near threshold;
- very large/small magnitude;
- order changes;
- serialization/deserialization.

---

# 29. Decision Matrix

| Use case | Use floating point? | Better type |
|---|---:|---|
| Temperature sensor | yes | `double` + unit type |
| Risk score 0..1 | yes | `RiskScore(double)` |
| ML vector | yes | `float[]`/`double[]` |
| Scientific simulation | yes | `double`, numerical library |
| Money | no | `Money(BigDecimal)` or minor units |
| Tax | no | `BigDecimal` + rounding policy |
| Invoice total | no | `Money` |
| Large ID | no | `long` internally, string externally |
| Percentage threshold legal | usually no | basis points / BigDecimal |
| Approximate analytics | yes | `double`, documented tolerance |
| Duration | no raw double | `Duration` |
| File size | no | `long`/`ByteSize` |
| Probability | yes | constrained finite `double` |

---

# 30. Latihan

## Latihan 1 — Decimal surprise

Run:

```java
System.out.println(0.1 + 0.2);
System.out.println((0.1 + 0.2) == 0.3);
```

Explain why.

## Latihan 2 — NaN validation bug

Implement:

```java
boolean invalid(double score) {
    return score < 0.0 || score > 1.0;
}
```

Test with `Double.NaN`.

Fix with `Double.isFinite`.

## Latihan 3 — Signed zero

Run:

```java
double pz = 0.0;
double nz = -0.0;

System.out.println(pz == nz);
System.out.println(Double.valueOf(pz).equals(Double.valueOf(nz)));
System.out.println(1.0 / pz);
System.out.println(1.0 / nz);
```

Explain each output.

## Latihan 4 — Long precision boundary

Run:

```java
long x = 9_007_199_254_740_993L;
double d = x;
long y = (long) d;
System.out.println(x);
System.out.println(d);
System.out.println(y);
System.out.println(x == y);
```

Explain.

## Latihan 5 — RiskScore type

Implement:

```java
record RiskScore(double value)
```

Rules:

- finite;
- `0..1`;
- normalize `-0.0`;
- comparable;
- test NaN/infinity.

## Latihan 6 — Kahan summation

Compare naive sum and Kahan sum for many small values.

## Latihan 7 — Money bug

Calculate invoice total using double, then BigDecimal. Compare.

## Latihan 8 — API schema

Write OpenAPI-like schema for:

```text
riskScore: finite double 0..1
```

Include description rejecting NaN/infinity.

---

# 31. Ringkasan

Floating point is powerful, but it is not decimal exact arithmetic.

Key points:

```text
float  = 32-bit binary floating point
double = 64-bit binary floating point
```

Remember:

- many decimals are approximated;
- operations round;
- error can accumulate;
- addition is not associative;
- `NaN != NaN`;
- infinity is a value, not exception;
- `0.0 == -0.0`, but wrapper equality can differ;
- `double` cannot represent all `long` values;
- Java 17+ restored always-strict floating-point semantics via JEP 306;
- always-strict does not mean exact decimal;
- use `BigDecimal`/fixed-point for money;
- validate finite/range for domain scores;
- use tolerance for approximate comparison;
- document numerical semantics at API boundary.

Engineer senior does not say:

```text
double is bad.
```

Engineer senior says:

```text
double is excellent for approximate numeric computation, but wrong for exact decimal business values.
```

The key is matching numeric representation to domain semantics.

---

# 32. Referensi

1. Java Language Specification SE 25 — Chapter 4: Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

2. Java Language Specification SE 25 — Floating-Point Types and Values / Operations  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.2.3  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.2.4

3. Java Language Specification SE 25 — Conversions and Contexts  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html

4. Java Virtual Machine Specification SE 25 — Floating-Point Types and Values  
   https://docs.oracle.com/javase/specs/jvms/se25/html/index.html

5. Java SE 25 API — `Double`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Double.html

6. Java SE 25 API — `Float`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Float.html

7. Java SE 25 API — `Math`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Math.html

8. Java SE 25 API — `StrictMath`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StrictMath.html

9. JEP 306 — Restore Always-Strict Floating-Point Semantics  
   https://openjdk.org/jeps/306

10. IEEE 754 Floating-Point Arithmetic Standard  
    https://ieeexplore.ieee.org/document/8766229

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-002.md">⬅️ Java Data Types — Part 002</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-004.md">Java Data Types — Part 004 ➡️</a>
</div>

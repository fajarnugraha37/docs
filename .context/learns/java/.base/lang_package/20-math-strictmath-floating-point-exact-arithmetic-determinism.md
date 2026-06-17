# Part 20 — `Math`, `StrictMath`, Floating Point, Exact Arithmetic, and Determinism

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `20-math-strictmath-floating-point-exact-arithmetic-determinism.md`  
> Scope: Java 8–25  
> Fokus: `java.lang.Math`, `java.lang.StrictMath`, arithmetic correctness, overflow, floating point, deterministic calculation, dan numerical design untuk sistem production.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita membahas global state JVM: properties, environment, locale, timezone, charset, dan bagaimana default global bisa merusak determinisme sistem. Sekarang kita masuk ke sisi lain determinisme: **angka**.

Banyak engineer merasa operasi angka itu “pasti benar” karena `+`, `-`, `*`, `/`, `%` terlihat sederhana. Di production, justru banyak bug serius muncul dari asumsi itu:

- integer overflow tidak melempar exception;
- `%` bukan mathematical modulo untuk nilai negatif;
- `double` bukan real number, melainkan finite binary floating-point approximation;
- `0.1 + 0.2 != 0.3` bukan bug Java;
- `NaN` tidak sama dengan dirinya sendiri pada primitive comparison;
- `-0.0` ada dan bisa memengaruhi division/comparison tertentu;
- `Math.round`, `ceil`, `floor`, `rint`, dan `BigDecimal` punya semantics berbeda;
- deterministic result tidak otomatis sama dengan business-correct result;
- exact arithmetic methods bisa menjadi guardrail, tetapi tidak menggantikan domain modelling.

Tujuan part ini adalah membangun mental model agar kamu bisa menjawab pertanyaan seperti:

1. Kapan aman memakai `int`, `long`, `double`, `BigDecimal`, atau custom value object?
2. Kapan `Math.addExact`, `multiplyExact`, `floorDiv`, `floorMod`, `fma`, `ulp`, `nextUp`, `scalb` relevan?
3. Apa bedanya `Math` dan `StrictMath`?
4. Kenapa floating point bisa deterministic tetapi tetap salah secara domain?
5. Bagaimana mendesain kalkulasi regulatory/financial/workflow threshold agar defensible?
6. Bagaimana menguji numerical code agar tidak hanya pass pada happy path?

Part ini bukan mengulang seluruh seri data types atau performance JVM. Fokusnya adalah **kontrak `java.lang.Math`/`StrictMath` dan konsekuensi desainnya**.

---

## 2. Mental Model Utama

### 2.1 Java numeric operations bukan matematika abstrak

Dalam matematika ideal:

```text
2_000_000_000 + 2_000_000_000 = 4_000_000_000
```

Dalam Java `int`:

```java
int x = 2_000_000_000;
int y = 2_000_000_000;
System.out.println(x + y); // -294967296
```

Ini bukan bug. Ini adalah konsekuensi integer overflow 32-bit two's complement.

Mental model pertama:

```text
Java primitive arithmetic = operasi pada representasi terbatas.
Bukan operasi pada bilangan matematika tak terbatas.
```

Untuk integer primitive:

```text
byte/short/char -> dipromosikan ke int saat arithmetic
int             -> 32-bit signed
long            -> 64-bit signed
float           -> 32-bit IEEE 754 binary floating-point
double          -> 64-bit IEEE 754 binary floating-point
```

### 2.2 `Math` adalah toolbox numerik dasar, bukan domain correctness layer

`Math` menyediakan operasi seperti:

- absolute value;
- min/max;
- floor/ceil/round;
- trigonometric/log/exponential;
- exact integer arithmetic;
- floor division/modulo;
- floating-point adjacent value utilities;
- fused multiply-add;
- random utility legacy;
- constants `E`, `PI`, dan sejak Java 19 `TAU`.

Tetapi `Math` tidak tahu domain kamu:

- apakah amount harus currency scale 2 atau 4;
- apakah rounding harus HALF_UP, HALF_EVEN, floor, ceiling, atau regulatory-specific;
- apakah negative balance boleh;
- apakah percentage 12.345% perlu disimpan sebagai basis point;
- apakah threshold inclusive atau exclusive;
- apakah overflow harus reject, saturate, cap, atau escalate.

Jadi:

```text
Math gives computational primitives.
Domain layer defines allowed meaning.
```

### 2.3 `StrictMath` adalah determinism contract historis

`StrictMath` menyediakan operasi numerik yang dimaksudkan menghasilkan hasil yang lebih reproducible lintas platform untuk operasi matematika tertentu. `Math` modern umumnya sangat dekat atau setara untuk banyak operasi, tetapi desainnya tetap memberi ruang implementasi yang bisa memakai intrinsic/hardware optimization.

Mental model:

```text
Math       = practical performance-oriented math API with specified behavior.
StrictMath = stricter reproducibility heritage, especially for transcendental functions.
```

Untuk kebanyakan business backend, masalah utama biasanya bukan memilih `Math` vs `StrictMath`, tetapi salah memilih numeric representation dan rounding policy.

### 2.4 Deterministic tidak berarti benar

Contoh:

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004
```

Hasil ini deterministic, reproducible, dan sesuai floating-point semantics. Tetapi untuk domain invoice, mungkin salah.

Jadi bedakan:

| Dimensi | Pertanyaan |
|---|---|
| Computational correctness | Apakah operasi mengikuti kontrak Java/IEEE? |
| Determinism | Apakah hasil repeatable lintas run/platform/JDK? |
| Domain correctness | Apakah hasil memenuhi aturan bisnis/regulasi? |
| Auditability | Apakah keputusan angka dapat dijelaskan ulang? |
| Safety | Apakah overflow/NaN/infinity/rounding drift dicegah? |

Top engineer tidak berhenti di “hasilnya sama di mesin saya”. Ia bertanya: **hasil ini punya makna domain yang valid atau tidak?**

---

## 3. Konsep Fundamental

## 3.1 Integer arithmetic: finite range and overflow

Range umum:

| Type | Min | Max |
|---|---:|---:|
| `byte` | -128 | 127 |
| `short` | -32768 | 32767 |
| `char` | 0 | 65535 |
| `int` | -2147483648 | 2147483647 |
| `long` | -9223372036854775808 | 9223372036854775807 |

Integer overflow pada `int`/`long` tidak otomatis error.

```java
int max = Integer.MAX_VALUE;
System.out.println(max + 1); // Integer.MIN_VALUE
```

Untuk production logic, ini berbahaya pada:

- total amount;
- row count;
- timeout calculation;
- byte size calculation;
- pagination offset;
- retry backoff;
- quota calculation;
- SLA duration;
- memory sizing;
- hash/counter/sequence;
- multiplying price × quantity.

Contoh bug:

```java
int page = 100_000;
int size = 100_000;
int offset = page * size; // overflow
```

Lebih baik:

```java
long offset = Math.multiplyExact((long) page, (long) size);
```

Atau domain-specific guard:

```java
static long calculateOffset(int page, int size) {
    if (page < 0) throw new IllegalArgumentException("page must be >= 0");
    if (size <= 0 || size > 1_000) throw new IllegalArgumentException("invalid page size");
    return Math.multiplyExact((long) page, (long) size);
}
```

### 3.2 Binary numeric promotion

Java arithmetic sering melakukan promotion:

```java
byte a = 10;
byte b = 20;
// byte c = a + b; // compile error: result is int
int c = a + b;
```

Untuk `byte`, `short`, dan `char`, arithmetic result biasanya `int`.

Ini penting untuk:

- binary protocol parsing;
- checksum;
- bit manipulation;
- char arithmetic;
- byte buffer processing;
- performance-sensitive loops.

Contoh unsigned byte extraction:

```java
byte signed = (byte) 0xFF;
int unsigned = signed & 0xFF; // 255
```

Tanpa mask:

```java
int wrong = signed; // -1
```

### 3.3 Division by zero

Integer division by zero melempar `ArithmeticException`:

```java
int x = 10 / 0; // ArithmeticException
```

Floating-point division by zero tidak otomatis exception:

```java
System.out.println(1.0 / 0.0);  // Infinity
System.out.println(-1.0 / 0.0); // -Infinity
System.out.println(0.0 / 0.0);  // NaN
```

Ini sangat penting: kalau domain kamu tidak menerima infinity/NaN, kamu harus eksplisit guard.

```java
static double safeRatio(long numerator, long denominator) {
    if (denominator == 0) {
        throw new IllegalArgumentException("denominator must not be zero");
    }
    double result = (double) numerator / denominator;
    if (!Double.isFinite(result)) {
        throw new ArithmeticException("ratio is not finite");
    }
    return result;
}
```

### 3.4 `%` remainder bukan selalu modulo matematika

Di Java:

```java
System.out.println( 5 %  3); // 2
System.out.println(-5 %  3); // -2
System.out.println( 5 % -3); // 2
System.out.println(-5 % -3); // -2
```

Sign result mengikuti dividend.

Untuk mathematical modulo yang non-negative ketika divisor positive, gunakan `Math.floorMod`:

```java
System.out.println(Math.floorMod(-5, 3)); // 1
```

Ini penting untuk:

- ring buffer;
- sharding;
- consistent bucket assignment;
- schedule recurrence;
- cyclic state;
- partition selection.

Bug klasik:

```java
int bucket = key.hashCode() % bucketCount;
array[bucket] = value; // bucket bisa negatif
```

Lebih aman:

```java
int bucket = Math.floorMod(key.hashCode(), bucketCount);
```

Atau jika power-of-two bucket:

```java
int bucket = hash & (bucketCount - 1);
```

Tapi hanya valid jika `bucketCount` power of two dan hash handling memang didesain begitu.

---

## 4. API dan Contract yang Perlu Dipahami

## 4.1 `Math` constants

```java
Math.E
Math.PI
Math.TAU // sejak Java 19
```

`TAU` adalah 2π. Berguna untuk domain geometri/trigonometri, tetapi jarang relevan untuk enterprise backend biasa.

Catatan desain:

- jangan hardcode `3.14159`;
- jangan pakai floating-point constant untuk domain yang butuh exact decimal;
- constant matematika bukan rounding policy.

## 4.2 Basic numeric helpers

```java
Math.abs(x)
Math.min(a, b)
Math.max(a, b)
Math.signum(x)
```

### `Math.abs` trap

```java
System.out.println(Math.abs(Integer.MIN_VALUE)); // -2147483648
System.out.println(Math.abs(Long.MIN_VALUE));    // -9223372036854775808
```

Kenapa? Karena positive counterpart tidak muat dalam signed range.

Jika kamu butuh abs yang fail-fast:

```java
static int absExact(int x) {
    if (x == Integer.MIN_VALUE) {
        throw new ArithmeticException("int overflow: abs(Integer.MIN_VALUE)");
    }
    return Math.abs(x);
}
```

Untuk bucket selection, jangan pakai:

```java
int bucket = Math.abs(hash) % n; // masih bisa negatif jika hash == MIN_VALUE
```

Gunakan:

```java
int bucket = Math.floorMod(hash, n);
```

## 4.3 Exact integer arithmetic

Important methods:

```java
Math.addExact(int, int)
Math.addExact(long, long)
Math.subtractExact(...)
Math.multiplyExact(...)
Math.incrementExact(...)
Math.decrementExact(...)
Math.negateExact(...)
Math.toIntExact(long)
```

Contoh:

```java
int total = Math.addExact(a, b);
```

Jika overflow, method melempar `ArithmeticException`.

Ini berguna untuk:

- totals;
- counters;
- byte size calculation;
- pagination offset;
- retry delay;
- timestamp arithmetic;
- conversion long ke int;
- validation boundary.

### Pattern: fail-fast arithmetic at trust boundary

```java
public record Quantity(int value) {
    public Quantity {
        if (value < 0) throw new IllegalArgumentException("quantity must be >= 0");
    }

    public Quantity plus(Quantity other) {
        return new Quantity(Math.addExact(this.value, other.value));
    }

    public long multiplyUnitPriceCents(long unitPriceCents) {
        return Math.multiplyExact((long) value, unitPriceCents);
    }
}
```

Mental model:

```text
Unchecked primitive arithmetic = silent wraparound.
Exact arithmetic = overflow becomes explicit failure.
```

## 4.4 `floorDiv` and `floorMod`

Java `/` truncates toward zero:

```java
System.out.println(-5 / 3); // -1
```

Mathematical floor division:

```java
System.out.println(Math.floorDiv(-5, 3)); // -2
```

Remainder relation:

```text
floorDiv(x, y) * y + floorMod(x, y) == x
```

For positive divisor, `floorMod` result is non-negative.

Use cases:

- cyclic calendar math;
- hash bucket normalization;
- negative index normalization;
- time bucket calculation;
- partitioning.

## 4.5 Rounding-ish APIs: `floor`, `ceil`, `round`, `rint`

```java
Math.floor(2.7)  // 2.0
Math.ceil(2.1)   // 3.0
Math.round(2.5)  // 3 for float/double variant return int/long
Math.rint(2.5)   // nearest integer as double, ties to even behavior
```

Hal penting:

- `floor` dan `ceil` return `double`;
- `round(float)` return `int`;
- `round(double)` return `long`;
- `rint` mengikuti IEEE-style rounding to nearest integer dengan tie handling berbeda dari intuisi banyak orang;
- business rounding sebaiknya jangan pakai API ini secara sembarang.

Untuk financial/regulatory decimal rounding, gunakan `BigDecimal` dengan `RoundingMode` eksplisit.

```java
BigDecimal amount = new BigDecimal("10.005");
BigDecimal rounded = amount.setScale(2, RoundingMode.HALF_UP); // 10.01
```

Jangan:

```java
new BigDecimal(10.005) // membawa approximation double
```

Gunakan string atau integer minor unit:

```java
new BigDecimal("10.005")
```

atau:

```java
long cents = 1001;
```

## 4.6 Floating-point classification

Untuk `double`:

```java
Double.isNaN(x)
Double.isInfinite(x)
Double.isFinite(x)
```

Untuk `float`:

```java
Float.isNaN(x)
Float.isInfinite(x)
Float.isFinite(x)
```

Production guard:

```java
static double requireFinite(double value, String name) {
    if (!Double.isFinite(value)) {
        throw new IllegalArgumentException(name + " must be finite");
    }
    return value;
}
```

Use this at boundaries:

- request payload parsing;
- ML/scoring result ingestion;
- analytics computation;
- simulation;
- rate/ratio calculation;
- external numeric integration.

## 4.7 Neighboring floating-point values

Useful APIs:

```java
Math.nextUp(x)
Math.nextDown(x)
Math.nextAfter(start, direction)
Math.ulp(x)
```

`ulp` = unit in the last place. It tells spacing around a value.

```java
System.out.println(Math.ulp(1.0));
System.out.println(Math.ulp(1_000_000_000_000.0));
```

Floating-point spacing grows as magnitude grows. That means at high magnitudes, small increments may disappear.

```java
double x = 1e16;
System.out.println(x + 1 == x); // often true
```

Mental model:

```text
Floating point has fixed number of significant binary digits.
Precision is relative, not uniform across all magnitudes.
```

## 4.8 `fma`: fused multiply-add

```java
Math.fma(a, b, c) // computes a*b + c as one fused operation if possible
```

Benefit:

- one rounding instead of two;
- better numerical accuracy for certain algorithms;
- may map to hardware instruction.

Use cases:

- numerical algorithms;
- geometry;
- signal processing;
- scoring functions;
- finance? Usually still prefer decimal/integer modelling for money.

Do not use `fma` as magic fix for business decimal correctness.

## 4.9 Scale and exponent helpers

```java
Math.scalb(x, scaleFactor)
Math.getExponent(x)
```

These are useful for advanced numeric code, not daily enterprise CRUD.

## 4.10 Trigonometric, exponential, logarithmic methods

```java
Math.sin(x)
Math.cos(x)
Math.tan(x)
Math.asin(x)
Math.acos(x)
Math.atan(x)
Math.atan2(y, x)
Math.exp(x)
Math.log(x)
Math.log10(x)
Math.sqrt(x)
Math.cbrt(x)
Math.hypot(x, y)
```

Important notes:

- angles are in radians;
- `atan2(y, x)` is usually better than `atan(y/x)` for quadrant correctness;
- `hypot(x, y)` can be more robust than `sqrt(x*x + y*y)` against overflow/underflow;
- `log` domain excludes negative numbers;
- `sqrt` of negative number returns NaN.

---

## 5. Evolusi Java 8–25

### 5.1 Java 8 baseline

Java 8 already has most important methods:

- exact arithmetic methods;
- `floorDiv`/`floorMod`;
- many floating-point helpers;
- `StrictMath`.

For Java 8-compatible libraries, you can already build strong arithmetic guardrails.

### 5.2 Java 9+ improvements and platform shift

Java 9 module system puts `Math` and `StrictMath` in `java.base`. They are always available.

Compatibility issue usually not about accessing `Math`, but about:

- compiling with newer JDK and accidentally using newer methods/constants;
- running on older runtime;
- using `--release` incorrectly;
- assuming floating-point output string formatting behavior without tests;
- relying on exact shape of exception message.

### 5.3 Java 18 strict floating-point semantics context

Before modern Java, `strictfp` existed because some platforms could use extended precision for intermediate floating-point operations. Modern Java has evolved toward always-strict floating-point semantics. Practically, for Java 17+ and especially current Java, `strictfp` is far less relevant than it historically was.

Design implication:

```text
Do not use strictfp as your main correctness tool.
Use correct representation, explicit rounding, finite checks, and tests.
```

### 5.4 Java 19 `Math.TAU`

Java 19 added `Math.TAU` and `StrictMath.TAU` as 2π constant.

If your code must run on Java 8/11/17, do not reference `Math.TAU` directly unless using multi-release JAR or guarded compatibility layer.

```java
static final double TAU = 2.0 * Math.PI;
```

### 5.5 Java 25 scope

In Java 25, the key lessons remain:

- use `Math` for basic numeric operations;
- use exact arithmetic where overflow must be rejected;
- use `floorDiv/floorMod` for mathematical division/modulo semantics;
- use `BigDecimal`/integer minor unit/custom value objects for exact decimal domains;
- guard against NaN/infinity at boundaries;
- avoid relying on floating-point for audit-critical decimal decisions.

---

## 6. Contoh Kode Bertahap

## 6.1 Silent overflow bug

```java
public final class OverflowDemo {
    public static void main(String[] args) {
        int unitPriceCents = 2_000_000_000;
        int quantity = 3;

        int total = unitPriceCents * quantity;
        System.out.println(total); // silent overflow
    }
}
```

Masalah:

- compiler tidak protes;
- runtime tidak protes;
- hasil terlihat seperti angka valid;
- domain bisa salah fatal.

Versi aman:

```java
public final class OverflowSafeDemo {
    public static void main(String[] args) {
        int unitPriceCents = 2_000_000_000;
        int quantity = 3;

        long total = Math.multiplyExact((long) unitPriceCents, (long) quantity);
        System.out.println(total);
    }
}
```

Jika masih bisa overflow `long`, gunakan `BigInteger` atau domain cap explicit.

## 6.2 Pagination offset

Bad:

```java
int offset = page * size;
```

Better:

```java
static long offset(int page, int size) {
    if (page < 0) throw new IllegalArgumentException("page must be >= 0");
    if (size <= 0 || size > 1_000) throw new IllegalArgumentException("invalid size");
    return Math.multiplyExact((long) page, (long) size);
}
```

Even better at DB boundary:

```java
record PageRequest(int page, int size) {
    PageRequest {
        if (page < 0) throw new IllegalArgumentException("page must be >= 0");
        if (size <= 0 || size > 1_000) throw new IllegalArgumentException("size must be 1..1000");
    }

    long offset() {
        return Math.multiplyExact((long) page, (long) size);
    }
}
```

## 6.3 Hash bucket selection

Bad:

```java
int bucket = Math.abs(key.hashCode()) % bucketCount;
```

Why bad?

```java
Math.abs(Integer.MIN_VALUE) == Integer.MIN_VALUE
```

Better:

```java
int bucket = Math.floorMod(key.hashCode(), bucketCount);
```

With guard:

```java
static int bucketOf(Object key, int bucketCount) {
    if (bucketCount <= 0) throw new IllegalArgumentException("bucketCount must be > 0");
    return Math.floorMod(key.hashCode(), bucketCount);
}
```

## 6.4 Duration calculation

Bad:

```java
int millis = seconds * 1000;
```

Better:

```java
long millis = Math.multiplyExact(seconds, 1_000L);
```

Better with Java time:

```java
Duration timeout = Duration.ofSeconds(seconds);
```

But still validate domain:

```java
static Duration timeoutSeconds(long seconds) {
    if (seconds < 0 || seconds > 300) {
        throw new IllegalArgumentException("timeout must be between 0 and 300 seconds");
    }
    return Duration.ofSeconds(seconds);
}
```

## 6.5 Ratio calculation with finite guard

```java
static double ratio(long numerator, long denominator) {
    if (denominator == 0) {
        throw new IllegalArgumentException("denominator must not be zero");
    }
    double result = (double) numerator / denominator;
    if (!Double.isFinite(result)) {
        throw new ArithmeticException("ratio is not finite");
    }
    return result;
}
```

But if ratio determines legal/business decision, ask:

- should it be decimal exact?
- should it be basis point?
- what rounding policy applies?
- what threshold comparison should be used?

## 6.6 Money modelling with cents

```java
public record MoneyCents(long cents) {
    public MoneyCents {
        // allow negative only if domain permits credit/debit representation
    }

    public MoneyCents plus(MoneyCents other) {
        return new MoneyCents(Math.addExact(this.cents, other.cents));
    }

    public MoneyCents times(long multiplier) {
        return new MoneyCents(Math.multiplyExact(this.cents, multiplier));
    }
}
```

This is often better than `double` for money.

For decimal tax/percentage, use explicit rounding:

```java
public MoneyCents applyRateBasisPoints(long basisPoints) {
    // basisPoints: 10000 = 100%
    long numerator = Math.multiplyExact(this.cents, basisPoints);

    // choose domain rounding intentionally
    long rounded = Math.floorDiv(numerator + 5_000, 10_000); // simplistic HALF_UP for positive only
    return new MoneyCents(rounded);
}
```

For complete correctness with negative values and complex rounding, use `BigDecimal` with explicit `RoundingMode` or a carefully tested integer rounding function.

## 6.7 BigDecimal boundary with `Math`

Bad:

```java
BigDecimal x = new BigDecimal(0.1);
```

Better:

```java
BigDecimal x = new BigDecimal("0.1");
```

or:

```java
BigDecimal x = BigDecimal.valueOf(0.1);
```

But do not use `BigDecimal` blindly. It has scale/equality semantics:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"))     // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00"))  // 0
```

Use domain normalization.

---

## 7. Design Patterns / Usage Patterns

## 7.1 Boundary validation pattern

At external boundary:

```java
record Score(double value) {
    Score {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("score must be finite");
        }
        if (value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("score must be between 0 and 1");
        }
    }
}
```

Why?

- prevent NaN propagation;
- prevent infinity propagation;
- document domain range;
- localize numeric assumptions.

## 7.2 Exact arithmetic at aggregation point

```java
long total = 0;
for (Line line : lines) {
    total = Math.addExact(total, line.totalCents());
}
```

This is better than silent accumulation overflow.

## 7.3 Domain value object instead of primitive obsession

Bad:

```java
void approve(double threshold, long amount, int days) { ... }
```

Better:

```java
void approve(RiskThreshold threshold, MoneyCents amount, BusinessDays days) { ... }
```

Each value object owns:

- range validation;
- rounding policy;
- overflow behavior;
- unit semantics;
- formatting boundary.

## 7.4 Use integer minor units for exact countable values

Good candidates:

- cents;
- basis points;
- milliseconds/nanoseconds;
- bytes;
- quantity;
- percentage scaled by fixed factor;
- coordinate microdegrees if domain permits.

Example:

```text
12.34% = 1234 basis points
```

Avoid representing it as `0.1234` unless the domain is naturally approximate.

## 7.5 Use `BigDecimal` for human decimal rules

Good candidates:

- monetary amount with variable scale;
- tax calculation;
- interest calculation;
- regulatory decimal submission;
- human-entered decimal values;
- legally defined rounding.

Rules:

- construct from `String` or controlled source;
- define scale;
- define `RoundingMode`;
- normalize before persistence/comparison;
- avoid mixing with `double` mid-pipeline.

## 7.6 Use `double` for approximate scientific/analytic values

Good candidates:

- statistics;
- ML scoring;
- geometry;
- probability;
- telemetry aggregates;
- ranking score;
- non-audit approximate metrics.

Rules:

- guard finite values;
- test with tolerances;
- define threshold semantics;
- avoid equality comparison except for special cases;
- be careful around NaN.

## 7.7 Tolerance comparison pattern

Bad:

```java
if (a == b) { ... }
```

Better, but context-dependent:

```java
static boolean nearlyEqual(double a, double b, double epsilon) {
    if (!Double.isFinite(a) || !Double.isFinite(b)) return false;
    return Math.abs(a - b) <= epsilon;
}
```

For relative tolerance:

```java
static boolean nearlyEqualRelative(double a, double b, double relTol, double absTol) {
    if (!Double.isFinite(a) || !Double.isFinite(b)) return false;
    double diff = Math.abs(a - b);
    if (diff <= absTol) return true;
    return diff <= relTol * Math.max(Math.abs(a), Math.abs(b));
}
```

But for legal threshold:

```text
Do not hide threshold decision behind generic epsilon without business approval.
```

## 7.8 Saturating arithmetic pattern

Sometimes overflow should not fail; it should cap.

Example: retry backoff:

```java
static long saturatingMultiply(long value, long factor, long max) {
    try {
        long result = Math.multiplyExact(value, factor);
        return Math.min(result, max);
    } catch (ArithmeticException overflow) {
        return max;
    }
}
```

Use only when saturation is domain-correct.

Do not silently saturate money, quota, or compliance decisions unless explicitly required.

## 7.9 Safe exponential backoff

```java
static Duration nextBackoff(Duration current, Duration max) {
    long currentMillis = current.toMillis();
    long maxMillis = max.toMillis();

    long next;
    try {
        next = Math.multiplyExact(currentMillis, 2L);
    } catch (ArithmeticException e) {
        next = maxMillis;
    }

    return Duration.ofMillis(Math.min(next, maxMillis));
}
```

Even better: add jitter using proper RNG, but that is outside `java.lang.Math` focus.

---

## 8. Failure Modes

## 8.1 Silent overflow in totals

Symptom:

- negative total amount;
- quota resets weirdly;
- huge count becomes small;
- DB offset negative;
- timeout becomes negative.

Root cause:

```java
int total = price * quantity;
```

Mitigation:

- use `long` when range requires;
- use `Math.multiplyExact`/`addExact`;
- validate max input;
- use domain object.

## 8.2 `Math.abs(MIN_VALUE)`

Symptom:

- negative bucket index;
- rare production error;
- cannot reproduce easily;
- only fails for one hash value.

Mitigation:

```java
Math.floorMod(hash, bucketCount)
```

## 8.3 Wrong modulo for negative values

Symptom:

- schedule recurrence off by one;
- sharding index negative;
- cyclic pointer invalid;
- weekly calculation wrong before epoch.

Mitigation:

```java
Math.floorMod(x, n)
```

## 8.4 Floating point used for money

Symptom:

- invoice mismatch;
- reconciliation drift;
- one-cent errors;
- audit issue;
- inconsistent rounding.

Mitigation:

- integer minor unit;
- `BigDecimal` with explicit scale/rounding;
- domain value object.

## 8.5 NaN propagation

NaN is contagious:

```java
double x = Double.NaN;
System.out.println(x + 1); // NaN
System.out.println(x < 1); // false
System.out.println(x > 1); // false
System.out.println(x == x); // false
```

This can silently bypass logic:

```java
if (score >= threshold) approve();
else reject();
```

If `score` is NaN, both intuitive comparisons fail in surprising ways depending on code structure.

Mitigation:

```java
if (!Double.isFinite(score)) throw ...;
```

## 8.6 Infinity from division

```java
double ratio = numerator / denominator;
```

If denominator is floating zero, result may become infinity rather than exception.

Mitigation:

- explicit denominator guard;
- finite guard after calculation.

## 8.7 BigDecimal constructed from double

```java
new BigDecimal(0.1)
```

This captures the binary approximation, not exact human decimal 0.1.

Mitigation:

```java
new BigDecimal("0.1")
BigDecimal.valueOf(0.1)
```

Even with `valueOf`, be careful if the original `double` already came from approximate computation.

## 8.8 Wrong rounding function

Using:

```java
Math.round(amount * 100.0) / 100.0
```

for money is fragile.

Mitigation:

```java
amount.setScale(2, RoundingMode.HALF_UP)
```

or integer minor-unit pipeline.

## 8.9 Non-associativity

Floating point addition is not associative:

```java
a + (b + c) != (a + b) + c
```

This matters for parallel aggregation.

Mitigation:

- deterministic aggregation order;
- compensated summation for numerical algorithms;
- BigDecimal/integer for exact totals;
- define acceptable tolerance.

## 8.10 Regulatory threshold ambiguity

Example:

```java
if (ratio >= 0.8) { ... }
```

Questions:

- Is ratio rounded before comparison?
- Is 80% inclusive?
- Is value exact or approximate?
- What if source value has 3 decimal places?
- What if result is 0.7999999999999999?

Mitigation:

Represent threshold in exact units:

```java
record BasisPoints(int value) {
    BasisPoints {
        if (value < 0 || value > 10_000) throw new IllegalArgumentException();
    }
}
```

Compare with integer math where possible.

---

## 9. Performance, Memory, Security Considerations

## 9.1 Primitive arithmetic is fast but unsafe by default

Primitive arithmetic has low overhead, but:

- overflow is silent;
- no unit semantics;
- no range validation;
- easy to mix cents/dollars/percent/basis points;
- easy to mix milliseconds/seconds/nanos.

Performance without correctness is just faster corruption.

## 9.2 `Math.*Exact` has cost, but often worth it

`Math.addExact`/`multiplyExact` may compile efficiently with intrinsics or branch checks. In business systems, the overhead is usually negligible compared with DB/network latency.

Use exact methods especially at:

- input boundary;
- aggregation point;
- persistence boundary;
- external calculation boundary;
- places where overflow would corrupt state.

You do not need exact arithmetic for every loop counter in internal tight loops if range is proven by invariant.

## 9.3 `BigDecimal` is slower but domain-safe when used correctly

`BigDecimal` has allocation and computational overhead. Still, for financial/regulatory decimal rules, it is often the right tool.

Pattern:

```text
Use BigDecimal where decimal semantics matter.
Convert to normalized domain representation at boundaries.
Do not casually mix BigDecimal and double.
```

## 9.4 Floating-point aggregation can be non-deterministic in parallel

Parallel streams or distributed aggregation may produce slightly different floating-point sums due to different grouping/order.

If exact reproducibility matters:

- avoid parallel approximate aggregation;
- use deterministic order;
- use compensated algorithms;
- use exact decimal/integer representation.

## 9.5 Numeric input as attack surface

External numeric input can attack system behavior:

- enormous values causing overflow;
- `NaN`/`Infinity` in JSON libraries that allow them;
- negative values bypassing modulo/index logic;
- exponent notation causing expensive parsing or extreme scale;
- BigDecimal with huge scale/precision causing memory/CPU pressure.

Boundary validation should include:

- min/max;
- finite check;
- precision/scale limit;
- unit validation;
- semantic validation.

Example:

```java
static BigDecimal parseAmount(String raw) {
    BigDecimal value = new BigDecimal(raw);
    if (value.scale() > 2) {
        throw new IllegalArgumentException("amount scale must be <= 2");
    }
    if (value.precision() > 18) {
        throw new IllegalArgumentException("amount precision too large");
    }
    return value.setScale(2, RoundingMode.UNNECESSARY);
}
```

## 9.6 Side-channel-ish numeric concerns

In cryptographic/security-sensitive code, numeric operations may need constant-time properties. `Math` is not designed as a constant-time crypto primitive.

Do not implement cryptographic arithmetic casually with `Math`.

---

## 10. Production Checklist

### 10.1 Representation checklist

For every important numeric field, ask:

- What unit is this?
- What range is valid?
- Can it be negative?
- Can it be fractional?
- Is decimal exactness required?
- Is binary approximation acceptable?
- What is the persistence format?
- What is the external API format?
- What rounding policy applies?
- What happens on overflow?
- What happens on division by zero?
- What happens on NaN/infinity?

### 10.2 Integer checklist

Use `Math.*Exact` when:

- multiplying user-controlled values;
- aggregating money/count/size;
- converting `long` to `int`;
- computing offset/limit;
- computing delay/backoff;
- computing memory/buffer sizes;
- calculating expiry/duration in primitive units.

Avoid:

```java
(int) longValue
```

Prefer:

```java
Math.toIntExact(longValue)
```

### 10.3 Floating-point checklist

For `double`/`float`:

- validate `Double.isFinite`;
- avoid equality comparison unless intentional;
- define tolerance explicitly;
- test boundary values;
- avoid for money/legal exact decisions;
- document approximate semantics.

### 10.4 Rounding checklist

Before rounding, define:

- scale;
- rounding mode;
- when rounding happens;
- whether comparison uses raw or rounded value;
- how negative values are rounded;
- how ties are handled;
- whether persistence stores rounded or raw value.

### 10.5 Modulo checklist

For bucket/cyclic logic:

- if values can be negative, use `floorMod`;
- validate divisor > 0;
- do not use `Math.abs(hash) % n`;
- test `Integer.MIN_VALUE`.

### 10.6 Test checklist

Test with:

- zero;
- one;
- negative values;
- max/min values;
- `Integer.MIN_VALUE`/`Long.MIN_VALUE`;
- boundary threshold exactly equal;
- just below/above threshold;
- huge values;
- decimal with repeating binary representation;
- NaN/infinity if input parser permits;
- parallel aggregation ordering if relevant.

---

## 11. Latihan / Thought Exercise

### Exercise 1 — Pagination overflow

Given:

```java
int page = 50_000;
int size = 100_000;
int offset = page * size;
```

Questions:

1. What is wrong?
2. What type should offset use?
3. Where should validation live?
4. Should this request be rejected before hitting DB?

Expected direction:

- multiplication overflows `int`;
- use `long` and `Math.multiplyExact`;
- page/size value object or request validation;
- impose max `size` and possibly max offset.

### Exercise 2 — Hash bucket bug

Given:

```java
int bucket = Math.abs(userId.hashCode()) % 16;
```

Questions:

1. What rare value breaks this?
2. What is better?
3. Is `hash & 15` always equivalent?

Expected direction:

- `Integer.MIN_VALUE`;
- `Math.floorMod(hash, 16)`;
- bitmask works only with power-of-two divisor and particular hash distribution assumptions.

### Exercise 3 — Regulatory threshold

Requirement:

```text
Reject application if debt ratio is 80% or above.
```

Questions:

1. Should ratio be `double`?
2. Should it be rounded before comparison?
3. What about 79.9999%?
4. What audit data must be stored?

Expected direction:

- define exact domain rule;
- maybe use basis points or BigDecimal;
- document inclusive threshold;
- store numerator, denominator, computed ratio, rounding mode, decision version.

### Exercise 4 — Floating point aggregation

Given:

```java
double total = values.parallelStream().mapToDouble(x -> x).sum();
```

Questions:

1. Can result vary?
2. Is variation acceptable?
3. What if total affects payment?

Expected direction:

- floating addition order matters;
- for approximate analytics may be acceptable;
- for payment use exact representation.

### Exercise 5 — `Math.round` misconception

Given:

```java
long cents = Math.round(amount * 100.0);
```

Questions:

1. What can go wrong?
2. What should be used instead?
3. How should input amount be represented?

Expected direction:

- binary approximation/rounding surprise;
- `BigDecimal` or integer minor unit;
- parse decimal string with scale constraints.

---

## 12. Ringkasan

`Math` dan `StrictMath` terlihat sederhana, tetapi part ini menunjukkan bahwa numerical correctness adalah design problem, bukan hanya API problem.

Key takeaways:

1. Primitive integer arithmetic can silently overflow.
2. Use `Math.addExact`, `subtractExact`, `multiplyExact`, `toIntExact`, and related methods when overflow must be explicit.
3. `%` is remainder, not always mathematical modulo; use `Math.floorMod` for cyclic/bucket logic with negative inputs.
4. `Math.abs(Integer.MIN_VALUE)` and `Math.abs(Long.MIN_VALUE)` remain negative.
5. `double` and `float` are approximate binary floating-point types, not exact decimal types.
6. NaN and infinity must be guarded at external and domain boundaries.
7. `Math` vs `StrictMath` matters less for enterprise correctness than representation, rounding, and validation.
8. For money/regulatory decimal values, prefer integer minor units or `BigDecimal` with explicit scale and rounding.
9. Deterministic computation is not necessarily domain-correct computation.
10. Top-tier engineering means making numeric assumptions explicit, testable, and auditable.

Part berikutnya akan membahas annotations di `java.lang`: `@Deprecated`, `@Override`, `@SuppressWarnings`, `@SafeVarargs`, dan `@FunctionalInterface` sebagai compiler/source/binary contracts, bukan hanya dekorasi syntax.

---

## Status Seri

Progress saat ini:

```text
Part 20 dari 32 selesai.
```

Seri belum selesai.

Part berikutnya:

```text
21-java-lang-annotations-compiler-contracts-source-binary-behavior.md
```

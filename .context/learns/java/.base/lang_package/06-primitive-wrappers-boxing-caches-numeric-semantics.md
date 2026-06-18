# Part 6 — Primitive Wrappers, Boxing, Caches, Numeric Semantics

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `06-primitive-wrappers-boxing-caches-numeric-semantics.md`  
> Scope: Java 8–25  
> Packages/classes focus: `java.lang.Byte`, `Short`, `Integer`, `Long`, `Float`, `Double`, `Boolean`, `Character`, `Number`, `Math`, `StrictMath`, primitive boxing/unboxing, numeric conversion contracts, value modelling.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas `String`, `CharSequence`, `StringBuilder`, dan kontrak konstruksi teks. Sekarang kita masuk ke area yang terlihat sederhana tetapi sangat sering menjadi sumber bug: **primitive wrappers, boxing/unboxing, numeric representation, numeric comparison, overflow, floating-point semantics, dan value modelling**.

Part ini bukan pengulangan materi “data types” dasar. Fokus kita adalah cara engineer senior/top-tier melihat angka dan wrapper sebagai **kontrak runtime**, bukan hanya tipe data.

Setelah part ini kamu diharapkan mampu:

1. membedakan kapan memakai primitive dan kapan memakai wrapper;
2. memahami boxing/unboxing sebagai konversi compiler/runtime yang punya biaya, risiko `NullPointerException`, dan semantic trap;
3. memahami wrapper cache dan kenapa identity comparison pada wrapper adalah bug;
4. memahami numeric overflow, narrowing/widening conversion, signed/unsigned operations, dan exact arithmetic;
5. memahami floating-point edge cases seperti `NaN`, infinity, `-0.0`, equality, ordering, dan rounding;
6. memilih representasi numeric yang tepat untuk domain: counter, ID, amount, percentage, quantity, version, bit flags, status code;
7. mendesain API yang defensible dan tidak menyembunyikan ambiguitas numeric;
8. membaca dokumentasi Java 8–25 dengan benar untuk wrapper, `Math`, dan `StrictMath`.

Inti dari part ini:

> Banyak bug angka bukan karena developer tidak tahu `int` atau `Integer`, tetapi karena developer tidak sadar bahwa angka di software adalah kontrak: range, precision, nullability, identity, unit, rounding, overflow, ordering, dan compatibility.

---

## 2. Mental Model Utama

### 2.1 Primitive adalah nilai mentah; wrapper adalah objek yang membawa nilai primitive

Java punya dua dunia yang berbeda:

```java
int x = 10;          // primitive value
Integer y = 10;      // object reference to wrapper object
```

`int` bukan object. `Integer` adalah object.

Konsekuensinya besar:

| Aspek | Primitive | Wrapper |
|---|---:|---:|
| Bisa `null` | Tidak | Ya |
| Punya identity object | Tidak | Ya |
| Bisa dipakai generic | Tidak | Ya |
| Bisa disimpan di collection | Tidak langsung | Ya |
| Operasi arithmetic langsung | Ya | Perlu unboxing |
| Memory footprint | Kecil | Lebih besar |
| Risiko `NullPointerException` saat arithmetic | Tidak | Ya |
| Cocok untuk optional/missing value | Tidak | Kadang, tapi hati-hati |

Primitive adalah nilai.
Wrapper adalah object yang berisi nilai.

Masalah muncul ketika dua dunia ini bercampur secara implisit.

---

### 2.2 Boxing/unboxing adalah kemudahan sintaks, bukan penghapusan perbedaan model

Kode ini terlihat natural:

```java
Integer a = 10; // boxing
int b = a;      // unboxing
```

Tetapi secara mental kamu harus membacanya seperti:

```java
Integer a = Integer.valueOf(10);
int b = a.intValue();
```

Autoboxing/unboxing membuat kode lebih pendek, tetapi tidak menghapus:

- alokasi atau reuse object;
- nullability;
- method call;
- identity object;
- cache behavior;
- performance cost;
- ambiguity pada overload;
- failure saat unboxing `null`.

Mental model senior:

> Setiap kali primitive dan wrapper bertemu, tanyakan: “Apakah di sini ada boxing? Apakah di sini ada unboxing? Apakah nilai bisa null? Apakah comparison ini value atau identity? Apakah operasi ini hot path?”

---

### 2.3 Wrapper bukan value type sejati

`Integer`, `Long`, `Double`, dan wrapper lain **immutable**, tetapi tetap object reference.

```java
Integer a = 1000;
Integer b = 1000;

System.out.println(a == b);      // biasanya false
System.out.println(a.equals(b)); // true
```

`a == b` membandingkan reference identity.
`a.equals(b)` membandingkan nilai.

Untuk nilai kecil tertentu, Java boleh mengembalikan object cache:

```java
Integer a = 100;
Integer b = 100;

System.out.println(a == b); // true pada range cache wajib -128..127
```

Ini yang membuat bug wrapper sangat berbahaya: kadang terlihat benar di test, lalu salah di production.

Rule praktis:

> Jangan pernah menggunakan `==` untuk membandingkan wrapper numeric kecuali kamu secara eksplisit sedang membandingkan identity object, dan itu hampir tidak pernah benar untuk business logic.

---

### 2.4 Numeric type selalu punya domain semantics

`int amount` tidak cukup menjelaskan:

- amount dalam satuan apa?
- range-nya berapa?
- boleh negatif?
- precision-nya apa?
- rounding-nya bagaimana?
- overflow behavior-nya apa?
- nilai `0` berarti apa?
- apakah `null` punya arti?
- apakah missing berbeda dari zero?

Contoh buruk:

```java
class InvoiceLine {
    int price;
    int quantity;
    double tax;
}
```

Contoh lebih defensible:

```java
record MoneyInCents(long value) {
    MoneyInCents {
        if (value < 0) {
            throw new IllegalArgumentException("money cannot be negative");
        }
    }
}

record Quantity(int value) {
    Quantity {
        if (value <= 0) {
            throw new IllegalArgumentException("quantity must be positive");
        }
    }
}
```

Bahkan bila part ini fokus pada `java.lang`, mindset-nya tetap domain-driven:

> Numeric primitive menjawab “representasinya apa”; domain type menjawab “maknanya apa”.

---

## 3. Taxonomy: Primitive, Wrapper, `Number`, `Math`, `StrictMath`

### 3.1 Primitive numeric types

Java punya primitive numeric berikut:

| Primitive | Size | Signed? | Category |
|---|---:|---:|---|
| `byte` | 8-bit | signed | integer |
| `short` | 16-bit | signed | integer |
| `int` | 32-bit | signed | integer |
| `long` | 64-bit | signed | integer |
| `char` | 16-bit | unsigned code unit | integral-ish, bukan numeric domain umum |
| `float` | 32-bit | IEEE 754 | floating point |
| `double` | 64-bit | IEEE 754 | floating point |

Tambahan non-numeric primitive:

| Primitive | Meaning |
|---|---|
| `boolean` | logical true/false |

`char` sering dianggap “character”, padahal lebih tepat dianggap **UTF-16 code unit**. Detail `Character` dan Unicode akan dibahas lebih dalam di Part 7.

---

### 3.2 Wrapper classes

| Primitive | Wrapper |
|---|---|
| `byte` | `Byte` |
| `short` | `Short` |
| `int` | `Integer` |
| `long` | `Long` |
| `float` | `Float` |
| `double` | `Double` |
| `char` | `Character` |
| `boolean` | `Boolean` |

Wrapper dipakai karena beberapa area Java bekerja dengan object:

- generics: `List<Integer>`, bukan `List<int>`;
- collection framework;
- reflection;
- nullable fields;
- annotation values;
- APIs yang menerima `Object`;
- serialization frameworks;
- configuration binding;
- optional/missing value modelling.

---

### 3.3 `Number`

`Number` adalah abstract superclass untuk wrapper numeric:

```java
Byte
Short
Integer
Long
Float
Double
```

Juga banyak class lain di luar `java.lang`, seperti `BigInteger`, `BigDecimal`, `AtomicInteger`, `AtomicLong`, walaupun tidak semuanya berada dalam `java.lang`.

`Number` menyediakan konversi:

```java
int intValue();
long longValue();
float floatValue();
double doubleValue();
byte byteValue();
short shortValue();
```

Tetapi `Number` bukan domain abstraction yang kuat.

Contoh bahaya:

```java
void process(Number n) {
    long value = n.longValue();
    // Untuk Double 10.9, ini menjadi 10.
    // Untuk BigInteger sangat besar, bisa overflow/truncate.
}
```

Rule:

> `Number` berguna untuk generic numeric plumbing, tetapi buruk sebagai kontrak domain jika precision, scale, range, atau semantics penting.

---

### 3.4 `Math` dan `StrictMath`

`Math` menyediakan operasi numeric umum:

- abs;
- min/max;
- addExact/subtractExact/multiplyExact/incrementExact/decrementExact/negateExact;
- floorDiv/floorMod;
- round/floor/ceil;
- trigonometric/log/pow/sqrt;
- random;
- multiplyHigh dan operasi integer lanjutan di versi modern.

`StrictMath` menyediakan operasi yang hasilnya lebih predictable/portable untuk fungsi tertentu karena mengikuti definisi strict yang historis berbasis algoritma tertentu.

Untuk business systems, area penting bukan trigonometry, tetapi:

- exact arithmetic;
- overflow detection;
- modulo semantics;
- rounding semantics;
- deterministic comparison;
- explicit conversion.

---

## 4. Boxing dan Unboxing: Apa yang Sebenarnya Terjadi

### 4.1 Boxing conversion

Boxing adalah konversi dari primitive ke wrapper:

```java
int x = 42;
Integer y = x;
```

Secara mental:

```java
Integer y = Integer.valueOf(x);
```

Ini penting karena `valueOf` bisa mengembalikan cached object.

---

### 4.2 Unboxing conversion

Unboxing adalah konversi dari wrapper ke primitive:

```java
Integer x = 42;
int y = x;
```

Secara mental:

```java
int y = x.intValue();
```

Jika `x == null`, maka akan terjadi `NullPointerException`.

```java
Integer count = null;
int value = count; // NullPointerException
```

Yang lebih halus:

```java
Integer count = null;

if (count > 0) { // NullPointerException karena count di-unbox
    System.out.println("positive");
}
```

Atau:

```java
Integer retries = null;
int next = retries + 1; // NullPointerException
```

Mental model:

> Wrapper dalam ekspresi arithmetic hampir selalu akan di-unbox.

---

### 4.3 Boxing dalam collection

```java
List<Integer> numbers = new ArrayList<>();
numbers.add(1);     // boxing
int x = numbers.get(0); // unboxing
```

Dalam loop besar, ini bisa berdampak:

```java
long sum = 0;
List<Integer> values = loadMillionIntegers();

for (Integer value : values) {
    sum += value; // unboxing setiap iterasi
}
```

Unboxing sendiri biasanya murah, tetapi object wrapper di collection punya overhead memory besar dibanding primitive array.

```java
int[] primitiveValues = new int[1_000_000];
List<Integer> boxedValues = new ArrayList<>();
```

`int[]` menyimpan primitive langsung.
`List<Integer>` menyimpan reference ke object `Integer`.

Dampaknya:

- lebih banyak object;
- lebih banyak indirection;
- lebih banyak pressure ke GC;
- lebih buruk locality;
- lebih lambat untuk workload numeric besar.

Rule:

> Untuk hot numeric data structure, primitive array atau specialized collection sering lebih tepat daripada `List<Integer>`.

---

### 4.4 Boxing pada varargs dan generic method

```java
static void logValues(Object... values) {
    // ...
}

logValues(1, 2L, 3.0); // semua primitive diboxing
```

Varargs `Object...` sering menyembunyikan boxing.

Contoh logging:

```java
logger.debug("count={}, elapsed={}", count, elapsedMillis);
```

Jika logging framework menerima `Object...`, primitive akan diboxing. Dalam kebanyakan aplikasi ini tidak masalah, tetapi di hot path high-frequency bisa signifikan.

Rule:

> Jangan paranoid terhadap boxing di semua tempat, tetapi sadarilah boxing di loop sangat panas, telemetry high-frequency, parsing besar, dan numeric aggregation.

---

### 4.5 Boxing pada overload resolution

Overload bisa membingungkan:

```java
void handle(long x) {
    System.out.println("primitive long");
}

void handle(Integer x) {
    System.out.println("wrapper Integer");
}

handle(10);
```

Compiler memilih berdasarkan aturan overload resolution: widening primitive sering lebih disukai daripada boxing.

Contoh:

```java
void f(long x) {}
void f(Integer x) {}

f(1); // pilih f(long), bukan f(Integer)
```

Tetapi jika overload-nya:

```java
void f(Integer x) {}
void f(Long x) {}

f(1); // pilih f(Integer)
```

Karena boxing `int` ke `Integer`, bukan widening lalu boxing ke `Long`.

Widening + boxing tidak selalu terjadi seperti intuisi manusia.

Contoh:

```java
Long x = 1; // compile error
```

Kenapa? Literal `1` adalah `int`. Java tidak melakukan widening `int -> long` lalu boxing `long -> Long` dalam assignment tersebut.

Yang benar:

```java
Long x = 1L;
```

atau:

```java
Long x = Long.valueOf(1);
```

Tetapi `Long.valueOf(1)` menerima `long`, sehingga `int` bisa widening di method invocation.

Mental model:

> Boxing, widening, overload, dan assignment punya aturan spesifik. Jangan mendesain API overload yang membuat caller harus menebak compiler.

---

## 5. Wrapper Cache dan Identity Trap

### 5.1 Cache wajib dan cache implementasi

Untuk beberapa wrapper, Java menspesifikasi cache tertentu. Yang paling terkenal:

```java
Integer.valueOf(int)
```

wajib cache setidaknya range `-128` sampai `127`.

Contoh:

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b); // true

Integer c = 128;
Integer d = 128;
System.out.println(c == d); // false, umumnya
```

Kenapa “umumnya”? Karena implementasi bisa memperluas cache, tetapi kamu tidak boleh bergantung pada itu.

---

### 5.2 Bug paling klasik

```java
Integer expected = 1000;
Integer actual = 1000;

if (expected == actual) {
    approve();
}
```

Ini bug.

Benar:

```java
if (Objects.equals(expected, actual)) {
    approve();
}
```

Atau jika tidak nullable:

```java
if (expected.equals(actual)) {
    approve();
}
```

Atau primitive:

```java
if (expected.intValue() == actual.intValue()) {
    approve();
}
```

---

### 5.3 Wrapper sebagai lock object adalah bahaya

Jangan lakukan ini:

```java
Integer lock = 1;

synchronized (lock) {
    // dangerous
}
```

Karena wrapper bisa cached dan shared. Kode lain yang memakai `Integer.valueOf(1)` mungkin mendapat object yang sama.

Juga jangan lock pada:

- `Boolean.TRUE`;
- string literal;
- cached wrapper;
- class object tanpa alasan kuat.

Benar:

```java
private final Object lock = new Object();
```

Rule:

> Wrapper adalah value holder, bukan monitor lock.

---

### 5.4 Wrapper identity dalam map/set

```java
Map<Integer, String> map = new HashMap<>();
map.put(1000, "A");

System.out.println(map.get(1000)); // works because equals/hashCode
```

`HashMap` memakai `equals` dan `hashCode`, jadi value equality benar.

Masalah muncul kalau kamu memakai identity-based structure:

```java
Map<Integer, String> map = new IdentityHashMap<>();
map.put(1000, "A");

System.out.println(map.get(1000)); // bisa null
```

`IdentityHashMap` memakai `==`, bukan `equals`.

Rule:

> Identity-based collection hampir tidak pernah cocok untuk wrapper numeric.

---

## 6. Nullability: Missing, Zero, Unknown, Not Applicable

### 6.1 Primitive tidak bisa membedakan missing dari zero

```java
class RetryPolicy {
    int maxRetries;
}
```

Apakah `maxRetries = 0` berarti:

- tidak boleh retry?
- belum di-set?
- default belum di-resolve?
- unlimited?

Primitive selalu punya default:

```java
int x;       // 0 untuk field
boolean b;  // false untuk field
```

Default ini bisa berbahaya pada domain object.

---

### 6.2 Wrapper bisa null, tetapi null bukan modelling yang cukup

```java
class RetryPolicy {
    Integer maxRetries;
}
```

Sekarang bisa `null`. Tetapi `null` berarti apa?

- not configured?
- inherit from parent?
- unlimited?
- forbidden?

Lebih baik eksplisit:

```java
sealed interface RetryLimit permits NoRetry, LimitedRetry, UnlimitedRetry {}

record NoRetry() implements RetryLimit {}
record LimitedRetry(int attempts) implements RetryLimit {
    LimitedRetry {
        if (attempts <= 0) throw new IllegalArgumentException("attempts must be positive");
    }
}
record UnlimitedRetry() implements RetryLimit {}
```

Untuk kasus sederhana:

```java
OptionalInt maxRetries;
```

Tetapi `OptionalInt` sebagai field masih diperdebatkan; sering lebih baik digunakan sebagai return type atau boundary result.

---

### 6.3 Null unboxing di conditional expression

```java
Boolean enabled = null;

if (enabled) { // NullPointerException
    run();
}
```

Benar jika null dianggap false:

```java
if (Boolean.TRUE.equals(enabled)) {
    run();
}
```

Jika null tidak boleh ada:

```java
boolean enabled = Objects.requireNonNull(config.enabled(), "enabled is required");
```

Rule:

> Jangan biarkan `Boolean` nullable masuk ke `if` tanpa keputusan eksplisit.

---

### 6.4 Nullability untuk API input

Buruk:

```java
void setLimit(Integer limit) {
    this.limit = limit;
}
```

Lebih baik:

```java
void setLimit(int limit) {
    if (limit < 0) {
        throw new IllegalArgumentException("limit must not be negative");
    }
    this.limit = limit;
}
```

Jika optional:

```java
void clearLimit() {
    this.limit = null;
}

void setLimit(int limit) {
    if (limit < 0) throw new IllegalArgumentException("limit must not be negative");
    this.limit = limit;
}
```

Atau domain object:

```java
record Limit(int value) {
    Limit {
        if (value < 0) throw new IllegalArgumentException("limit must not be negative");
    }
}
```

Mental model:

> Primitive/wrapper choice adalah API design decision, bukan detail syntax.

---

## 7. Integer Semantics: Range, Overflow, Exact Arithmetic

### 7.1 Integer overflow tidak throw exception secara default

```java
int max = Integer.MAX_VALUE;
System.out.println(max + 1); // -2147483648
```

Overflow wrap-around sesuai two's complement behavior.

Untuk `long`:

```java
long max = Long.MAX_VALUE;
System.out.println(max + 1); // Long.MIN_VALUE
```

Ini bisa sangat fatal:

```java
int price = 2_000_000_000;
int quantity = 2;
int total = price * quantity; // overflow
```

---

### 7.2 Gunakan exact arithmetic saat overflow harus dianggap failure

```java
int total = Math.multiplyExact(price, quantity);
```

Jika overflow, akan throw `ArithmeticException`.

API exact penting:

```java
Math.addExact(int x, int y)
Math.subtractExact(int x, int y)
Math.multiplyExact(int x, int y)
Math.incrementExact(int a)
Math.decrementExact(int a)
Math.negateExact(int a)
Math.toIntExact(long value)
```

Contoh defensible:

```java
record Quantity(int value) {
    Quantity {
        if (value <= 0) throw new IllegalArgumentException("quantity must be positive");
    }
}

record UnitPriceInCents(long value) {
    UnitPriceInCents {
        if (value < 0) throw new IllegalArgumentException("price must not be negative");
    }
}

record AmountInCents(long value) {
    AmountInCents {
        if (value < 0) throw new IllegalArgumentException("amount must not be negative");
    }
}

static AmountInCents multiply(UnitPriceInCents price, Quantity quantity) {
    return new AmountInCents(Math.multiplyExact(price.value(), quantity.value()));
}
```

---

### 7.3 Overflow can happen before widening

```java
int a = 1_500_000_000;
int b = 2;
long result = a * b; // overflow dulu sebagai int, baru di-convert ke long
```

Benar:

```java
long result = (long) a * b;
```

Atau:

```java
long result = Math.multiplyExact((long) a, b);
```

Rule:

> Cast harus dilakukan sebelum operasi, bukan setelah hasil overflow.

---

### 7.4 `abs` edge case

```java
System.out.println(Math.abs(Integer.MIN_VALUE)); // tetap Integer.MIN_VALUE
```

Kenapa? Karena `Integer.MIN_VALUE` tidak punya positive counterpart dalam range `int`.

```java
Integer.MIN_VALUE == -2147483648
Integer.MAX_VALUE ==  2147483647
```

Untuk `long` juga sama:

```java
Math.abs(Long.MIN_VALUE) == Long.MIN_VALUE
```

Jika nilai absolut harus valid:

```java
int safeAbs(int value) {
    if (value == Integer.MIN_VALUE) {
        throw new ArithmeticException("abs overflow");
    }
    return Math.abs(value);
}
```

---

### 7.5 `%` bukan mathematical modulo untuk negatif

```java
System.out.println(-5 % 3); // -2
```

Untuk modulo yang hasilnya non-negative, gunakan `floorMod`:

```java
System.out.println(Math.floorMod(-5, 3)); // 1
```

Ini penting untuk:

- sharding;
- bucket selection;
- hash partition;
- circular buffer;
- calendar arithmetic;
- schedule recurrence.

Buruk:

```java
int bucket = hash % bucketCount; // bisa negatif
```

Lebih baik:

```java
int bucket = Math.floorMod(hash, bucketCount);
```

---

## 8. Widening, Narrowing, Casting, and Data Loss

### 8.1 Widening primitive conversion

Contoh widening:

```java
int i = 10;
long l = i;
double d = l;
```

Widening sering aman dari sisi range, tetapi tidak selalu aman dari sisi precision.

Contoh:

```java
long value = 9_007_199_254_740_993L; // 2^53 + 1
double d = value;
long back = (long) d;

System.out.println(value); // 9007199254740993
System.out.println(back);  // 9007199254740992
```

`double` tidak bisa merepresentasikan semua `long` secara exact.

Rule:

> Widening ke floating point bisa kehilangan precision.

---

### 8.2 Narrowing conversion

```java
long l = 1_000_000_000_000L;
int i = (int) l;
```

Ini compile, tetapi nilai bisa berubah drastis.

Lebih aman:

```java
int i = Math.toIntExact(l);
```

Jika tidak muat, throw `ArithmeticException`.

---

### 8.3 Parsing dan range

```java
int value = Integer.parseInt("2147483648"); // NumberFormatException
```

Karena melebihi `Integer.MAX_VALUE`.

Untuk input boundary:

```java
static int parsePort(String raw) {
    int port = Integer.parseInt(raw);
    if (port < 1 || port > 65535) {
        throw new IllegalArgumentException("port out of range: " + raw);
    }
    return port;
}
```

Parsing bukan validation lengkap.

---

## 9. Signed vs Unsigned Operations

### 9.1 Java integer primitive signed by default

`byte`, `short`, `int`, `long` adalah signed.

Tetapi Java menyediakan beberapa unsigned helper di wrapper:

```java
Integer.compareUnsigned(int x, int y)
Integer.divideUnsigned(int dividend, int divisor)
Integer.remainderUnsigned(int dividend, int divisor)
Integer.toUnsignedLong(int x)
Integer.toUnsignedString(int i)

Long.compareUnsigned(long x, long y)
Long.divideUnsigned(long dividend, long divisor)
Long.remainderUnsigned(long dividend, long divisor)
Long.toUnsignedString(long i)
```

---

### 9.2 Unsigned byte common case

Java `byte` range:

```text
-128..127
```

Tetapi binary protocol sering memakai unsigned byte `0..255`.

Benar:

```java
byte b = (byte) 0xFF;
int unsigned = Byte.toUnsignedInt(b); // 255
```

Atau:

```java
int unsigned = b & 0xFF;
```

Lebih expressive:

```java
int unsigned = Byte.toUnsignedInt(b);
```

---

### 9.3 Unsigned comparison for version/protocol values

```java
int a = 0xFFFFFFFF;
int b = 1;

System.out.println(a > b); // false, karena a == -1 signed
System.out.println(Integer.compareUnsigned(a, b) > 0); // true
```

Use case:

- checksum;
- CRC;
- IPv4;
- binary protocol;
- database raw values;
- file format;
- monotonic sequence dengan wrap-around tertentu.

Rule:

> Kalau sumber data menyatakan unsigned, jangan diam-diam pakai signed comparison.

---

## 10. Floating Point Semantics: `float`, `double`, `NaN`, Infinity, `-0.0`

### 10.1 Floating point bukan decimal arithmetic

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004
```

Ini bukan bug Java. Ini konsekuensi representasi binary floating point.

Gunakan `double` untuk:

- measurement;
- statistics;
- approximate scientific values;
- scoring;
- probabilities dengan toleransi;
- graphics;
- telemetry.

Jangan gunakan `double` untuk:

- uang;
- pajak;
- settlement;
- regulatory fee;
- exact quota;
- legal threshold yang decimal exact.

Untuk uang, gunakan:

- integer minor unit (`long cents`);
- atau `BigDecimal` dengan scale/rounding eksplisit.

---

### 10.2 `NaN`

`NaN` berarti Not a Number.

```java
double x = Double.NaN;

System.out.println(x == x); // false
System.out.println(Double.isNaN(x)); // true
```

`NaN` tidak equal bahkan dengan dirinya sendiri memakai `==`.

Tetapi wrapper equality punya behavior khusus:

```java
Double a = Double.NaN;
Double b = Double.NaN;

System.out.println(a.equals(b)); // true
```

Kenapa penting? Karena map/set behavior berbeda dari primitive comparison intuition.

```java
Set<Double> set = new HashSet<>();
set.add(Double.NaN);
set.add(Double.NaN);
System.out.println(set.size()); // 1
```

Rule:

> Untuk floating point, pahami perbedaan primitive `==`, wrapper `equals`, dan ordering methods.

---

### 10.3 Positive/negative infinity

```java
double x = 1.0 / 0.0;
System.out.println(x); // Infinity

System.out.println(Double.isInfinite(x)); // true
```

Integer division by zero berbeda:

```java
int x = 1 / 0; // ArithmeticException
```

Floating division by zero bisa menghasilkan infinity atau NaN.

```java
System.out.println(0.0 / 0.0); // NaN
```

---

### 10.4 `-0.0`

```java
double positiveZero = 0.0;
double negativeZero = -0.0;

System.out.println(positiveZero == negativeZero); // true
System.out.println(Double.compare(positiveZero, negativeZero)); // 1
```

`Double.compare` membedakan `0.0` dan `-0.0` untuk ordering total yang konsisten.

Ini jarang penting dalam business app biasa, tetapi penting pada:

- numerical library;
- sorting floating values;
- serialization compatibility;
- hashing;
- canonicalization.

---

### 10.5 Comparing double with tolerance

Buruk:

```java
if (a == b) {
    // ...
}
```

Lebih baik untuk approximate value:

```java
static boolean approximatelyEqual(double a, double b, double epsilon) {
    return Math.abs(a - b) <= epsilon;
}
```

Tetapi epsilon bukan magic. Untuk skala besar, relative tolerance lebih cocok:

```java
static boolean close(double a, double b, double relTol, double absTol) {
    double diff = Math.abs(a - b);
    if (diff <= absTol) return true;
    return diff <= Math.max(Math.abs(a), Math.abs(b)) * relTol;
}
```

Untuk domain legal/financial, jangan pakai tolerance floating point jika requirement-nya exact decimal.

---

## 11. Wrapper Equality, Comparison, and Ordering

### 11.1 `equals` requires same wrapper type

```java
Integer i = 1;
Long l = 1L;

System.out.println(i.equals(l)); // false
```

Walaupun numeric value “sama” secara manusia, object type berbeda.

Jika ingin numeric comparison lintas tipe, jangan pakai `Number` sembarangan. Tentukan canonical type.

```java
static boolean sameLongValue(Number a, Number b) {
    return a.longValue() == b.longValue();
}
```

Tetapi ini salah untuk `Double`, `BigDecimal`, nilai fractional, dan overflow cases.

Lebih baik: desain API agar tidak menerima arbitrary `Number`.

---

### 11.2 `compareTo`

Wrapper numeric implement `Comparable` terhadap tipe yang sama:

```java
Integer.valueOf(10).compareTo(20);
Long.valueOf(10L).compareTo(20L);
Double.valueOf(1.5).compareTo(2.0);
```

Tidak ada natural comparison antara `Integer` dan `Long` via `Comparable<Integer>`.

---

### 11.3 Comparator with nullable wrappers

Buruk:

```java
items.sort(Comparator.comparing(Item::score));
```

Jika `score()` return `Integer` nullable, bisa NPE.

Lebih eksplisit:

```java
items.sort(Comparator.comparing(
    Item::score,
    Comparator.nullsLast(Integer::compareTo)
));
```

Atau hindari nullable score.

---

## 12. Parsing, Formatting, and Radix

### 12.1 `parseXxx` vs `valueOf`

```java
int primitive = Integer.parseInt("42");
Integer wrapper = Integer.valueOf("42");
```

`parseInt` mengembalikan primitive.
`valueOf` mengembalikan wrapper.

Jika kamu butuh primitive, gunakan `parseInt`.
Jika kamu butuh object, gunakan `valueOf`.

---

### 12.2 Radix

```java
int binary = Integer.parseInt("1010", 2);  // 10
int hex = Integer.parseInt("FF", 16);      // 255
```

Untuk unsigned:

```java
int value = Integer.parseUnsignedInt("FFFFFFFF", 16);
System.out.println(value); // -1 sebagai signed int representation
System.out.println(Integer.toUnsignedString(value)); // 4294967295
```

---

### 12.3 `decode`

```java
Integer.decode("0xFF"); // 255
Integer.decode("077");  // octal interpretation
```

`decode` mengenali prefix seperti `0x`, `#`, dan leading `0` untuk octal.

Hati-hati dengan input user:

```java
Integer.decode("010"); // 8, bukan 10
```

Rule:

> Untuk input user/business, lebih aman menentukan radix eksplisit daripada menerima format magical.

---

### 12.4 NumberFormatException as boundary exception

```java
static int parsePositiveInt(String raw, String fieldName) {
    try {
        int value = Integer.parseInt(raw);
        if (value <= 0) {
            throw new IllegalArgumentException(fieldName + " must be positive");
        }
        return value;
    } catch (NumberFormatException ex) {
        throw new IllegalArgumentException(fieldName + " must be a valid integer", ex);
    }
}
```

Jangan biarkan `NumberFormatException` mentah bocor ke user-facing API tanpa konteks field.

---

## 13. Choosing Numeric Representation by Domain

### 13.1 Counter

Counter biasanya non-negative dan bisa besar.

```java
long processedCount;
```

Jika counter bisa melewati `Long.MAX_VALUE`, butuh strategi rollover atau `BigInteger`, tetapi itu jarang untuk business app biasa.

Untuk API:

```java
record ProcessedCount(long value) {
    ProcessedCount {
        if (value < 0) throw new IllegalArgumentException("count must not be negative");
    }
}
```

---

### 13.2 Identifier

ID bukan angka untuk arithmetic.

Buruk:

```java
long userId;
long next = userId + 1; // smells wrong unless sequence generator
```

Lebih baik:

```java
record UserId(long value) {
    UserId {
        if (value <= 0) throw new IllegalArgumentException("user id must be positive");
    }
}
```

Untuk external ID yang bisa punya leading zero, jangan pakai number:

```java
record PostalCode(String value) {}
record CaseReference(String value) {}
```

Jika ID berasal dari JSON dan client JavaScript, hati-hati dengan `long` lebih dari `2^53 - 1`, karena JavaScript number tidak aman untuk semua integer 64-bit.

---

### 13.3 Money

Pilihan umum:

```java
record MoneyInCents(long value) {}
```

Kelebihan:

- exact;
- cepat;
- simple;
- cocok untuk fixed minor unit.

Kekurangan:

- currency berbeda punya minor unit berbeda;
- percentage/tax calculation perlu rounding jelas;
- tidak cocok untuk arbitrary decimal scale.

Alternatif:

```java
BigDecimal amount;
Currency currency;
```

Tetapi `BigDecimal` ada jebakan `equals` vs `compareTo` dan scale. Tidak dibahas dalam detail di sini karena `BigDecimal` bukan `java.lang`, tetapi penting diingat.

Rule:

> Jangan pakai `double` untuk uang yang harus exact.

---

### 13.4 Percentage/rate

```java
record BasisPoints(int value) {
    BasisPoints {
        if (value < 0) throw new IllegalArgumentException("basis points must not be negative");
    }
}
```

1 basis point = 0.01%.

Contoh:

```java
BasisPoints tax = new BasisPoints(900); // 9.00%
```

Lebih defensible daripada:

```java
double tax = 0.09;
```

---

### 13.5 Size / bytes

```java
record Bytes(long value) {
    Bytes {
        if (value < 0) throw new IllegalArgumentException("bytes must not be negative");
    }
}
```

Hati-hati overflow:

```java
long mb = Math.multiplyExact(value, 1024L * 1024L);
```

---

### 13.6 Duration

Walaupun `java.lang` punya numeric types, jangan represent duration mentah tanpa unit:

Buruk:

```java
long timeout;
```

Lebih baik:

```java
Duration timeout;
```

`Duration` ada di `java.time`, bukan `java.lang`, tetapi guideline domain tetap penting.

Jika boundary harus primitive:

```java
long timeoutMillis;
```

Nama field harus menyertakan unit.

---

### 13.7 Bit flags

Untuk low-level flags:

```java
int READ = 1 << 0;
int WRITE = 1 << 1;
int EXECUTE = 1 << 2;

int permissions = READ | WRITE;
boolean canRead = (permissions & READ) != 0;
```

Untuk domain-level permission, enum set lebih readable:

```java
enum Permission { READ, WRITE, EXECUTE }
EnumSet<Permission> permissions = EnumSet.of(Permission.READ, Permission.WRITE);
```

Rule:

> Bit flags cocok untuk low-level compact representation. Untuk domain business, `EnumSet` biasanya lebih aman dan jelas.

---

## 14. `Math` Deep Practical Semantics

### 14.1 `min`/`max` with NaN

```java
System.out.println(Math.min(Double.NaN, 1.0)); // NaN
System.out.println(Math.max(Double.NaN, 1.0)); // NaN
```

Jika data bisa NaN, jangan diam-diam aggregate tanpa policy.

```java
static double safeMin(double a, double b) {
    if (Double.isNaN(a)) return b;
    if (Double.isNaN(b)) return a;
    return Math.min(a, b);
}
```

Policy harus eksplisit:

- reject NaN;
- ignore NaN;
- propagate NaN;
- treat NaN as missing.

---

### 14.2 `round`, `floor`, `ceil`

```java
Math.floor(1.9); // 1.0
Math.ceil(1.1);  // 2.0
Math.round(1.5); // 2
```

Untuk angka negatif:

```java
Math.floor(-1.1); // -2.0
Math.ceil(-1.1);  // -1.0
Math.round(-1.5); // -1
```

Rounding sering punya aturan domain. Jangan mengandalkan intuisi.

Untuk uang/pajak, gunakan rounding mode eksplisit dengan decimal arithmetic.

---

### 14.3 `random`

```java
double r = Math.random(); // 0.0 <= r < 1.0
```

`Math.random()` simple, tetapi bukan pilihan terbaik untuk:

- security token;
- deterministic tests;
- high-performance random generation;
- multi-threaded random workload.

Untuk security, gunakan `SecureRandom`.
Untuk concurrency/performance, gunakan generator yang sesuai.

Tidak dibahas panjang karena ini bukan seri RNG, tetapi jangan memakai `Math.random()` untuk token keamanan.

---

## 15. `StrictMath`: Kapan Perlu Peduli?

Untuk mayoritas business application, `Math` cukup.

`StrictMath` relevan ketika kamu membutuhkan hasil floating-point yang sangat konsisten lintas platform untuk fungsi tertentu.

Contoh area:

- scientific reproducibility;
- deterministic simulation;
- protocol/test vector yang sensitif terhadap hasil numeric;
- compatibility library.

Tetapi untuk financial/business decimal exact, `StrictMath` bukan solusi. Masalahnya bukan strict vs non-strict, tetapi binary floating-point vs decimal/exact arithmetic.

Rule:

> `StrictMath` membantu determinism floating-point tertentu; ia tidak mengubah `double` menjadi decimal exact.

---

## 16. Performance and Memory Considerations

### 16.1 Primitive array vs boxed collection

```java
int[] a = new int[1_000_000];
List<Integer> b = new ArrayList<>(1_000_000);
```

`int[]`:

- contiguous primitive values;
- low overhead;
- better CPU cache locality;
- less GC pressure.

`List<Integer>`:

- array of references;
- each distinct `Integer` can be object;
- more memory;
- more indirection;
- more GC.

Jika data besar dan numeric-heavy, primitive representation matter.

---

### 16.2 Streams and boxing

```java
List<Integer> values = List.of(1, 2, 3);
int sum = values.stream().mapToInt(Integer::intValue).sum();
```

Primitive streams ada untuk menghindari boxing berlebihan:

```java
IntStream
LongStream
DoubleStream
```

Buruk untuk hot path:

```java
int sum = values.stream()
    .map(x -> x + 1) // boxed Integer stream
    .reduce(0, Integer::sum);
```

Lebih baik:

```java
int sum = values.stream()
    .mapToInt(Integer::intValue)
    .map(x -> x + 1)
    .sum();
```

Tidak perlu anti-stream secara dogmatis. Tetapi pahami kapan stream boxed menjadi overhead.

---

### 16.3 Wrapper allocation can be optimized, but do not depend blindly

JIT bisa melakukan optimisasi seperti escape analysis dan scalar replacement. Tetapi tidak semua allocation hilang:

- object masuk collection;
- object keluar method;
- object disimpan field;
- object dipakai di polymorphic call;
- object terlihat oleh reflection/unsafe/native boundary.

Rule:

> Tulis kode benar dulu. Untuk hot path, ukur. Jika wrapper allocation muncul di profile, ubah representation.

---

## 17. API Design Guidelines

### 17.1 Use primitive when value is required and always present

```java
record PageRequest(int page, int size) {
    PageRequest {
        if (page < 1) throw new IllegalArgumentException("page must start from 1");
        if (size < 1 || size > 500) throw new IllegalArgumentException("invalid size");
    }
}
```

Primitive membuat invariant lebih kuat: tidak ada null.

---

### 17.2 Use wrapper only when null is meaningful at boundary

```java
record SearchFilter(Integer minAge, Integer maxAge) {}
```

Tetapi segera normalize:

```java
record AgeRange(OptionalInt min, OptionalInt max) {}
```

Atau domain object:

```java
sealed interface AgeConstraint {}
record NoAgeConstraint() implements AgeConstraint {}
record MinAge(int value) implements AgeConstraint {}
record AgeBetween(int min, int max) implements AgeConstraint {}
```

---

### 17.3 Avoid `Number` in domain API

Buruk:

```java
void setAmount(Number amount);
```

Pertanyaan:

- boleh decimal?
- boleh NaN?
- boleh infinity?
- boleh negative?
- precision bagaimana?
- scale bagaimana?

Lebih baik:

```java
void setAmountInCents(long amountInCents);
```

atau:

```java
void setAmount(Money amount);
```

---

### 17.4 Name units explicitly

Buruk:

```java
long timeout;
int size;
long amount;
```

Lebih baik:

```java
long timeoutMillis;
int sizeBytes;
long amountCents;
```

Lebih baik lagi untuk domain kuat:

```java
Duration timeout;
Bytes size;
Money amount;
```

---

### 17.5 Be explicit about rounding

Buruk:

```java
long tax = (long) (amount * 0.09);
```

Lebih defensible:

```java
// fixed integer basis points
static long applyBasisPoints(long amountCents, int basisPoints) {
    long numerator = Math.multiplyExact(amountCents, basisPoints);
    return numerator / 10_000; // but document rounding: truncate toward zero
}
```

Jika rounding half-up, banker rounding, ceiling, atau jurisdiction-specific rule diperlukan, buat API eksplisit.

---

## 18. Failure Modes yang Sering Muncul di Production

### 18.1 Wrapper comparison dengan `==`

```java
if (userInputId == databaseId) { }
```

Jika `Long`, ini bug.

Gunakan:

```java
Objects.equals(userInputId, databaseId)
```

---

### 18.2 Null unboxing

```java
Integer limit = config.getLimit();
if (limit > 0) { }
```

Fix:

```java
Integer limit = config.getLimit();
if (limit != null && limit > 0) { }
```

Atau normalize saat load config.

---

### 18.3 Silent overflow

```java
int total = price * quantity;
```

Fix:

```java
long total = Math.multiplyExact((long) price, quantity);
```

---

### 18.4 Incorrect modulo for negative hash

```java
int shard = hash % shardCount;
```

Fix:

```java
int shard = Math.floorMod(hash, shardCount);
```

---

### 18.5 `double` untuk money

```java
double balance = 0.1 + 0.2;
```

Fix:

```java
long balanceCents = 10 + 20;
```

atau `BigDecimal` dengan rounding/scale eksplisit.

---

### 18.6 `Number` abstraction too broad

```java
void updateQuota(Number quota) { }
```

Fix:

```java
record Quota(long value) {
    Quota {
        if (value < 0) throw new IllegalArgumentException("quota must not be negative");
    }
}
```

---

### 18.7 `Math.abs` on min value

```java
int positive = Math.abs(possiblyMinValue);
```

Fix:

```java
if (possiblyMinValue == Integer.MIN_VALUE) {
    throw new ArithmeticException("abs overflow");
}
int positive = Math.abs(possiblyMinValue);
```

---

### 18.8 Parsing with accidental octal

```java
Integer.decode("010"); // 8
```

Fix:

```java
Integer.parseInt("010", 10); // 10
```

---

### 18.9 `Double.NaN` equality surprise

```java
double x = Double.NaN;
if (x == Double.NaN) { } // false
```

Fix:

```java
if (Double.isNaN(x)) { }
```

---

### 18.10 Exposing `Long` ID to JavaScript without safe range consideration

Java `long` can exceed JavaScript safe integer range.

If API consumed by JS and ID can be large, consider serializing as string:

```json
{
  "caseId": "9223372036854775807"
}
```

---

## 19. Java 8–25 Evolution Notes

### 19.1 Stable fundamentals

Across Java 8–25, these concepts remain fundamental:

- primitive/wrapper distinction;
- boxing/unboxing;
- wrapper immutability;
- wrapper equality vs identity;
- integer overflow behavior;
- floating-point `NaN`/infinity;
- parsing methods;
- `Math`/`StrictMath` core role.

---

### 19.2 APIs available since Java 8 and around it

Java 8 already includes many important helper APIs:

- unsigned integer helpers on `Integer`/`Long`;
- `Math.addExact`, `subtractExact`, `multiplyExact`, etc.;
- `Math.floorDiv`, `floorMod`;
- primitive streams (`IntStream`, `LongStream`, `DoubleStream`) in `java.util.stream`.

---

### 19.3 Modern Java additions around numeric APIs

Later Java versions add smaller utility improvements and performance/runtime improvements, but the core mental model does not change.

Examples of modern areas to be aware of:

- better JIT optimizations over time;
- container-awareness affecting runtime CPU/memory observations, not wrapper semantics directly;
- additional `Math` methods in newer versions;
- pattern matching and switch improvements may affect numeric control flow style;
- primitive types in patterns/switch appear as preview work in Java 25, so treat as evolving language feature, not baseline production assumption for Java 8–25 compatibility.

Rule untuk seri ini:

> Tulis core library dengan baseline Java target yang jelas. Jika ingin support Java 8–25, jangan memakai API modern tanpa compatibility layer atau multi-release strategy.

---

## 20. Code Patterns: Safer Numeric Utilities

### 20.1 Safe positive int parser

```java
public final class Numbers {
    private Numbers() {}

    public static int parsePositiveInt(String raw, String fieldName) {
        if (raw == null) {
            throw new IllegalArgumentException(fieldName + " is required");
        }

        final int value;
        try {
            value = Integer.parseInt(raw.trim());
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(fieldName + " must be a valid integer: " + raw, ex);
        }

        if (value <= 0) {
            throw new IllegalArgumentException(fieldName + " must be positive: " + raw);
        }

        return value;
    }
}
```

Design notes:

- null handled explicitly;
- parse exception translated with field context;
- domain constraint checked after syntactic parse;
- no silent default.

---

### 20.2 Safe range check

```java
public static int requireRange(int value, int minInclusive, int maxInclusive, String name) {
    if (minInclusive > maxInclusive) {
        throw new IllegalArgumentException("invalid range");
    }
    if (value < minInclusive || value > maxInclusive) {
        throw new IllegalArgumentException(
            name + " must be between " + minInclusive + " and " + maxInclusive + ": " + value
        );
    }
    return value;
}
```

Use:

```java
int port = requireRange(Integer.parseInt(rawPort), 1, 65535, "port");
```

---

### 20.3 Exact cents multiplication

```java
record MoneyInCents(long value) {
    MoneyInCents {
        if (value < 0) {
            throw new IllegalArgumentException("money must not be negative");
        }
    }
}

record Quantity(int value) {
    Quantity {
        if (value <= 0) {
            throw new IllegalArgumentException("quantity must be positive");
        }
    }
}

static MoneyInCents multiply(MoneyInCents unitPrice, Quantity quantity) {
    return new MoneyInCents(Math.multiplyExact(unitPrice.value(), quantity.value()));
}
```

---

### 20.4 Null-safe wrapper comparison

```java
public static boolean sameInteger(Integer a, Integer b) {
    return Objects.equals(a, b);
}
```

But better: avoid nullable wrapper if possible.

---

### 20.5 Explicit Boolean policy

```java
public static boolean enabledOrFalse(Boolean value) {
    return Boolean.TRUE.equals(value);
}

public static boolean requireBoolean(Boolean value, String name) {
    if (value == null) {
        throw new IllegalArgumentException(name + " is required");
    }
    return value;
}
```

---

### 20.6 Safe shard calculation

```java
public static int shardFor(int hash, int shardCount) {
    if (shardCount <= 0) {
        throw new IllegalArgumentException("shardCount must be positive");
    }
    return Math.floorMod(hash, shardCount);
}
```

---

## 21. Production Checklist

Saat melihat numeric/wrapper code, tanyakan:

### Type choice

- Apakah nilai selalu ada? Jika ya, kenapa wrapper?
- Apakah `null` punya arti jelas?
- Apakah `0` berbeda dari missing?
- Apakah field punya unit jelas?
- Apakah ID dipakai sebagai angka padahal bukan arithmetic value?

### Equality/comparison

- Apakah wrapper dibandingkan dengan `==`?
- Apakah `Objects.equals` diperlukan?
- Apakah floating point dibandingkan dengan `==`?
- Apakah `NaN`/infinity mungkin muncul?
- Apakah ordering nullable eksplisit?

### Arithmetic

- Apakah overflow mungkin?
- Apakah perlu `Math.addExact`/`multiplyExact`?
- Apakah operasi terjadi sebelum widening cast?
- Apakah modulo negatif mungkin?
- Apakah `Math.abs(MIN_VALUE)` mungkin?

### Parsing/input

- Apakah radix eksplisit?
- Apakah error message menyebut field?
- Apakah range divalidasi setelah parse?
- Apakah numeric input external bisa melebihi range Java type?

### Performance

- Apakah ada boxing di loop besar?
- Apakah `List<Integer>` dipakai untuk jutaan angka?
- Apakah stream boxed bisa diganti primitive stream?
- Apakah logging/varargs di hot path memboxing banyak nilai?

### Domain defensibility

- Apakah money menggunakan `double`?
- Apakah rounding rule eksplisit?
- Apakah percentage/rate direpresentasikan jelas?
- Apakah public API menjelaskan range/unit?
- Apakah JS/client boundary aman untuk `long`?

---

## 22. Thought Exercises

### Exercise 1 — Diagnose wrapper bug

Apa output kode ini?

```java
Integer a = 127;
Integer b = 127;
Integer c = 128;
Integer d = 128;

System.out.println(a == b);
System.out.println(c == d);
System.out.println(c.equals(d));
```

Jawaban:

```text
true
false, generally
true
```

`a == b` true karena cache wajib untuk range kecil. `c == d` tidak boleh diandalkan dan umumnya false. `equals` true karena value sama.

---

### Exercise 2 — Find overflow

```java
int price = 1_500_000_000;
int quantity = 2;
long total = price * quantity;
```

Masalah: multiplication terjadi sebagai `int`, overflow sebelum assignment ke `long`.

Fix:

```java
long total = Math.multiplyExact((long) price, quantity);
```

---

### Exercise 3 — Missing vs zero

```java
record Config(int timeoutMillis) {}
```

Apa masalahnya?

`timeoutMillis = 0` ambigu:

- disabled?
- immediate timeout?
- missing default?
- invalid?

Desain lebih baik:

```java
record TimeoutConfig(Duration timeout) {
    TimeoutConfig {
        Objects.requireNonNull(timeout, "timeout");
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
    }
}
```

Atau jika optional:

```java
sealed interface TimeoutPolicy {}
record NoTimeout() implements TimeoutPolicy {}
record FixedTimeout(Duration value) implements TimeoutPolicy {}
```

---

### Exercise 4 — Floating point equality

```java
double x = 0.1 + 0.2;
System.out.println(x == 0.3);
```

Output biasanya false.

Fix tergantung domain:

- approximate: tolerance comparison;
- money/legal: use exact decimal/integer minor unit.

---

### Exercise 5 — Shard bug

```java
int shard = userId.hashCode() % shardCount;
```

Masalah: hash bisa negatif, shard bisa negatif.

Fix:

```java
int shard = Math.floorMod(userId.hashCode(), shardCount);
```

---

## 23. Key Takeaways

1. Primitive dan wrapper bukan variasi syntax; keduanya punya model runtime berbeda.
2. Boxing/unboxing menyembunyikan conversion, null risk, allocation/reuse, dan overload behavior.
3. Wrapper comparison dengan `==` adalah bug kecuali benar-benar membandingkan identity.
4. Wrapper cache membuat bug lebih berbahaya karena test kecil bisa terlihat benar.
5. Integer overflow silent secara default; gunakan exact arithmetic saat overflow adalah failure.
6. Cast setelah operasi tidak menyelamatkan overflow yang sudah terjadi.
7. Floating point cocok untuk approximate measurement, bukan exact money/regulatory decimal.
8. `NaN`, infinity, dan `-0.0` punya semantics khusus yang mempengaruhi equality/order/hash.
9. `Number` terlalu lemah untuk kebanyakan domain API.
10. Unit, range, nullability, rounding, precision, dan overflow harus menjadi bagian dari desain API.

---

## 24. Referensi Resmi

- Java SE 25 API — `java.lang` package summary.
- Java SE 25 API — `Integer`, `Long`, `Double`, `Float`, `Boolean`, `Character`, `Number`.
- Java SE 25 API — `Math`, `StrictMath`.
- Java Language Specification — Conversions and Contexts, especially boxing and unboxing conversions.
- Java SE 8 API — baseline compatibility for Java 8.
- Oracle Java Tutorials — Autoboxing and Unboxing.

---

## 25. Penutup

Part ini membangun fondasi numeric runtime yang sering menjadi pembeda antara kode yang “berjalan” dan kode yang **benar, stabil, scalable, dan defensible**.

Pada level junior, `int`, `Integer`, `long`, `Long`, `double`, dan `Double` terlihat sebagai tipe data biasa.

Pada level senior/top-tier, setiap pilihan numeric membawa kontrak:

- apakah value wajib ada;
- apakah null valid;
- apakah range cukup;
- apakah overflow boleh;
- apakah precision exact;
- apakah rounding legal;
- apakah equality benar;
- apakah representation aman lintas boundary;
- apakah memory/performance sesuai workload.

Bagian berikutnya akan membahas **`Boolean`, `Character`, Unicode Classification, and Primitive Edge Cases**. Itu penting karena banyak sistem rusak bukan hanya karena angka, tetapi karena boolean tri-state yang ambigu dan asumsi keliru bahwa `char` berarti “satu karakter manusia”.

---

# Status Seri

Progress saat ini:

- Part 0 — selesai
- Part 1 — selesai
- Part 2 — selesai
- Part 3 — selesai
- Part 4 — selesai
- Part 5 — selesai
- Part 6 — selesai

Seri belum selesai. Masih lanjut ke Part 7.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./05-charsequence-stringbuilder-stringbuffer-text-construction.md">⬅️ Part 5 — `StringBuilder`, `StringBuffer`, `CharSequence`, and Text Construction Contracts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./07-boolean-character-unicode-classification-primitive-edge-cases.md">Part 7 — `Boolean`, `Character`, Unicode Classification, and Primitive Edge Cases ➡️</a>
</div>

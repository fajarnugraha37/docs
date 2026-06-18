# learn-java-data-types-part-001.md

# Java Data Types — Part 001  
# Primitive Types: Semantics, Range, Conversion, Promotion, dan Pitfall

> Seri: **Advanced Java Data Types**  
> Bagian: **001**  
> Fokus: memahami delapan primitive types Java secara mendalam—bukan hanya hafal ukuran/range, tetapi memahami semantics, compiler rules, JVM behavior, conversion, promotion, overflow, floating-point edge cases, `char`/Unicode trap, dan production failure modes.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Primitive Types dalam Java Type System](#2-primitive-types-dalam-java-type-system)
3. [Mental Model Primitive: Value Tanpa Identity](#3-mental-model-primitive-value-tanpa-identity)
4. [Daftar Primitive Types dan Kategorinya](#4-daftar-primitive-types-dan-kategorinya)
5. [`boolean`: Truth Value, Bukan Integer](#5-boolean-truth-value-bukan-integer)
6. [`byte`: 8-bit Signed Integer](#6-byte-8-bit-signed-integer)
7. [`short`: 16-bit Signed Integer](#7-short-16-bit-signed-integer)
8. [`int`: Default Integral Workhorse](#8-int-default-integral-workhorse)
9. [`long`: 64-bit Integer untuk Range Besar](#9-long-64-bit-integer-untuk-range-besar)
10. [`char`: Unsigned 16-bit UTF-16 Code Unit, Bukan Karakter Manusia](#10-char-unsigned-16-bit-utf-16-code-unit-bukan-karakter-manusia)
11. [`float`: 32-bit Floating Point](#11-float-32-bit-floating-point)
12. [`double`: 64-bit Floating Point](#12-double-64-bit-floating-point)
13. [Default Values: Field dan Array vs Local Variable](#13-default-values-field-dan-array-vs-local-variable)
14. [Literals: Cara Menulis Primitive Value](#14-literals-cara-menulis-primitive-value)
15. [Integer Arithmetic dan Overflow](#15-integer-arithmetic-dan-overflow)
16. [Numeric Promotion: Kenapa `byte + byte` Menjadi `int`](#16-numeric-promotion-kenapa-byte--byte-menjadi-int)
17. [Widening, Narrowing, dan Cast](#17-widening-narrowing-dan-cast)
18. [Compound Assignment Trap](#18-compound-assignment-trap)
19. [Floating-Point Semantics: Precision, NaN, Infinity, dan Signed Zero](#19-floating-point-semantics-precision-nan-infinity-dan-signed-zero)
20. [Comparison dan Equality Primitive](#20-comparison-dan-equality-primitive)
21. [Primitive dan JVM: Computational Types](#21-primitive-dan-jvm-computational-types)
22. [Primitive dan Memory Footprint](#22-primitive-dan-memory-footprint)
23. [Primitive vs Wrapper: Boundary ke Object World](#23-primitive-vs-wrapper-boundary-ke-object-world)
24. [Primitive Patterns di Java 25 Preview](#24-primitive-patterns-di-java-25-preview)
25. [Kapan Primitive Tepat, Kapan Harus Domain Type](#25-kapan-primitive-tepat-kapan-harus-domain-type)
26. [Production Failure Modes](#26-production-failure-modes)
27. [Best Practices dan Design Rules](#27-best-practices-dan-design-rules)
28. [Latihan](#28-latihan)
29. [Ringkasan](#29-ringkasan)
30. [Referensi](#30-referensi)

---

# 1. Tujuan Bagian Ini

Sebagian besar programmer mengenal primitive types sebagai tabel:

| Type | Size | Example |
|---|---:|---|
| `int` | 32-bit | `42` |
| `long` | 64-bit | `42L` |
| `double` | 64-bit | `3.14` |
| `boolean` | true/false | `true` |

Tabel seperti itu berguna, tetapi tidak cukup untuk engineer senior.

Di production, primitive type bisa menyebabkan bug seperti:

```java
int total = price * quantity;       // overflow
double amount = 0.1 + 0.2;          // precision bug
char c = text.charAt(0);            // broken for emoji/surrogate pair
byte b = 127;
b++;                                // becomes -128
Integer retryCount = null;
int retry = retryCount;             // NPE due to unboxing
boolean approved = true;
boolean rejected = true;            // impossible state
```

Bagian ini akan membahas primitive dari lima sudut:

1. **Language semantics** — apa yang JLS definisikan.
2. **Compiler rules** — conversion, promotion, literals, assignment.
3. **Runtime/JVM view** — bagaimana JVM menangani primitive values.
4. **Domain modeling** — kapan primitive terlalu miskin makna.
5. **Production safety** — failure mode yang sering terjadi.

---

# 2. Primitive Types dalam Java Type System

Java membagi type menjadi:

```text
primitive types
reference types
```

Primitive types adalah type yang predefined oleh bahasa dan bukan object.

Primitive types terdiri dari:

```text
boolean
byte
short
int
long
char
float
double
```

Numeric primitive terbagi menjadi:

```text
integral types:
  byte
  short
  int
  long
  char

floating-point types:
  float
  double
```

`boolean` bukan numeric type.

Ini penting karena di Java:

```java
boolean b = true;
int x = b; // compile error
```

Berbeda dari C/C++ yang punya tradisi integer truthiness. Java sengaja tidak mengizinkan `boolean` menjadi angka.

## 2.1 Primitive value tidak berbagi state

Primitive value bukan object dan tidak punya mutable state.

```java
int a = 10;
int b = a;
b = 20;
```

`a` tetap `10`.

Tidak ada aliasing antara primitive values.

Bandingkan dengan reference:

```java
List<String> a = new ArrayList<>();
List<String> b = a;
b.add("x");
```

`a` juga melihat `"x"` karena `a` dan `b` mereferensikan object yang sama.

Primitive jauh lebih sederhana dari sisi aliasing.

## 2.2 Primitive tidak bisa `null`

```java
int x = null;      // compile error
boolean b = null;  // compile error
```

Jika kamu butuh nullable numeric/boolean:

```java
Integer x = null;
Boolean b = null;
```

Tetapi wrapper membawa risiko:

```java
Boolean active = null;
if (active) {      // NullPointerException due to unboxing
}
```

Jadi “nullable primitive” tidak gratis.

---

# 3. Mental Model Primitive: Value Tanpa Identity

Primitive adalah **value tanpa identity**.

```java
int x = 42;
int y = 42;
```

Tidak ada pertanyaan:

```text
Apakah x dan y object yang sama?
```

Mereka hanyalah nilai `42`.

Untuk primitive, `==` berarti numeric/boolean equality sesuai aturan type.

Untuk reference:

```java
Integer a = 1000;
Integer b = 1000;
```

`a == b` membandingkan reference identity, bukan numeric value. Ini akan dibahas di part wrapper/boxing.

## 3.1 Primitive sebagai raw data

Primitive cocok untuk:

- counter;
- index;
- loop;
- low-level numeric operation;
- array compact;
- flags internal sederhana;
- performance-sensitive code;
- bit manipulation;
- protocol binary;
- timestamp epoch representation jika semantics jelas.

Primitive kurang cocok untuk:

- domain ID yang mudah tertukar;
- money;
- percentage dengan range;
- status;
- decision dengan reason;
- permission;
- business date/time semantics;
- user-facing character/text.

## 3.2 Primitive tidak membawa makna domain

```java
long value;
```

Apa maksudnya?

- amount in cents?
- epoch millis?
- database ID?
- version?
- duration nanos?
- byte size?
- sequence?
- count?

Compiler tidak tahu.

Lebih baik:

```java
record AmountInMinorUnit(long value) {}
record EpochMillis(long value) {}
record Version(long value) {}
record ByteSize(long value) {}
```

Tidak semua harus dibungkus, tetapi boundary penting sebaiknya eksplisit.

---

# 4. Daftar Primitive Types dan Kategorinya

## 4.1 Summary table

| Type | Category | Size | Signed? | Min | Max | Default field value |
|---|---|---:|---:|---:|---:|---|
| `boolean` | boolean | JVM-specific representation | n/a | `false` | `true` | `false` |
| `byte` | integral | 8-bit | yes | -128 | 127 | 0 |
| `short` | integral | 16-bit | yes | -32768 | 32767 | 0 |
| `int` | integral | 32-bit | yes | -2³¹ | 2³¹-1 | 0 |
| `long` | integral | 64-bit | yes | -2⁶³ | 2⁶³-1 | 0L |
| `char` | integral | 16-bit | no | `'\u0000'` | `'\uffff'` | `'\u0000'` |
| `float` | floating | 32-bit | IEEE 754 | approx | approx | `0.0f` |
| `double` | floating | 64-bit | IEEE 754 | approx | approx | `0.0d` |

Catatan penting:

- `boolean` tidak punya size yang secara langsung diekspos oleh Java language.
- `char` adalah integral type, tetapi unsigned 16-bit.
- `float`/`double` bukan decimal floating point; mereka binary floating point.

## 4.2 Constant fields

Gunakan constants standar:

```java
Byte.MIN_VALUE
Byte.MAX_VALUE
Short.MIN_VALUE
Short.MAX_VALUE
Integer.MIN_VALUE
Integer.MAX_VALUE
Long.MIN_VALUE
Long.MAX_VALUE
Character.MIN_VALUE
Character.MAX_VALUE
Float.NaN
Float.POSITIVE_INFINITY
Double.NaN
Double.NEGATIVE_INFINITY
```

Jangan hardcode range kecuali untuk edukasi.

---

# 5. `boolean`: Truth Value, Bukan Integer

`boolean` hanya punya dua value:

```java
true
false
```

Tidak ada conversion otomatis antara `boolean` dan numeric.

```java
int x = true;     // compile error
boolean b = 1;    // compile error
```

## 5.1 Boolean operators

Operators:

```java
!
&&
||
&
|
^
==
!=
```

Perhatikan perbedaan short-circuit:

```java
a && b
a || b
```

vs non-short-circuit:

```java
a & b
a | b
```

Contoh:

```java
if (obj != null && obj.isValid()) {
    ...
}
```

Aman karena `obj.isValid()` tidak dipanggil jika `obj == null`.

Jika memakai `&`:

```java
if (obj != null & obj.isValid()) {
    ...
}
```

`obj.isValid()` tetap dipanggil, bisa NPE.

## 5.2 Boolean blindness

Boolean sering terlalu miskin makna.

```java
sendNotification(user, true);
```

Apa arti `true`?

- async?
- urgent?
- includeAttachment?
- dryRun?
- enabled?

Lebih baik:

```java
sendNotification(user, NotificationMode.URGENT);
```

atau:

```java
record SendNotificationCommand(UserId userId, DeliveryMode deliveryMode) {}
```

## 5.3 Boolean flags menciptakan impossible state

```java
boolean approved;
boolean rejected;
boolean pending;
```

Bisa terjadi:

```java
approved = true;
rejected = true;
pending = true;
```

Secara domain mustahil.

Lebih baik:

```java
enum DecisionStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

Atau sealed type jika setiap state punya data berbeda:

```java
sealed interface Decision permits Pending, Approved, Rejected {}

record Pending() implements Decision {}
record Approved(OfficerId approvedBy, Instant approvedAt) implements Decision {}
record Rejected(OfficerId rejectedBy, RejectionReason reason, Instant rejectedAt) implements Decision {}
```

## 5.4 Boolean return hides reason

Buruk:

```java
boolean canClose(Case c);
```

Jika false, mengapa?

Lebih baik:

```java
sealed interface CloseEligibility permits CanClose, CannotClose {}

record CanClose() implements CloseEligibility {}
record CannotClose(List<CloseViolation> violations) implements CloseEligibility {}
```

atau:

```java
record PolicyDecision(boolean allowed, String code, String explanation) {}
```

## 5.5 Kapan `boolean` tepat?

`boolean` tepat untuk:

- local condition sederhana;
- result internal yang benar-benar binary;
- low-level flag yang tidak butuh reason;
- simple predicate method:

```java
boolean isEmpty()
boolean isBlank()
boolean hasNext()
```

Tetapi untuk domain decision penting, `boolean` sering kurang.

---

# 6. `byte`: 8-bit Signed Integer

`byte` adalah signed 8-bit integer:

```text
range: -128 to 127
```

## 6.1 Kapan `byte` dipakai?

Cocok untuk:

- binary protocol;
- raw bytes;
- file/network buffer;
- cryptographic bytes;
- image/audio data;
- compact arrays;
- off-heap/native interop;
- serialization.

Contoh:

```java
byte[] payload = inputStream.readAllBytes();
```

## 6.2 `byte` bukan unsigned

Java `byte` signed. Ini sering membuat bingung saat berurusan dengan binary data.

```java
byte b = (byte) 0xFF;
System.out.println(b); // -1
```

Jika ingin interpret sebagai unsigned 0..255:

```java
int unsigned = Byte.toUnsignedInt(b);
System.out.println(unsigned); // 255
```

## 6.3 Byte arithmetic promotes to int

```java
byte a = 10;
byte b = 20;
byte c = a + b; // compile error
```

Karena `a + b` dipromosikan menjadi `int`.

Harus cast:

```java
byte c = (byte) (a + b);
```

Tetapi cast bisa overflow.

## 6.4 Byte overflow

```java
byte b = 127;
b++;
System.out.println(b); // -128
```

Overflow pada integer primitive wrap around sesuai representasi two's-complement untuk operasi integer.

## 6.5 Byte and binary parsing

Saat parsing binary format:

```java
int version = bytes[0];
```

Jika `bytes[0]` negatif, mungkin salah interpretasi.

Gunakan:

```java
int version = Byte.toUnsignedInt(bytes[0]);
```

## 6.6 Design warning

Jangan pakai `byte` untuk domain small number hanya karena hemat memory:

```java
byte age;
byte status;
```

Hematnya tidak selalu signifikan karena object layout/alignment. Untuk field object biasa, `int` sering lebih sederhana kecuali ada alasan memory yang terbukti.

`byte` berguna terutama di array besar:

```java
byte[] data = new byte[100_000_000];
```

---

# 7. `short`: 16-bit Signed Integer

`short` adalah signed 16-bit integer:

```text
range: -32768 to 32767
```

## 7.1 Kapan `short` dipakai?

Cocok untuk:

- binary protocol;
- compact numeric arrays;
- image/audio samples;
- native interop;
- storage-sensitive structures.

Jarang cocok untuk normal business field.

## 7.2 Arithmetic promotes to int

```java
short a = 100;
short b = 200;
short c = a + b; // compile error
```

Harus:

```java
short c = (short) (a + b);
```

## 7.3 `short` vs `int`

Untuk local variable dan business code, `int` biasanya lebih natural.

Kenapa?

- CPU/JVM operations umumnya bekerja dengan int computational type;
- arithmetic short tetap promoted ke int;
- code lebih sedikit cast;
- range lebih aman.

Gunakan `short` jika representasi compact benar-benar penting atau format eksternal menuntut 16-bit.

---

# 8. `int`: Default Integral Workhorse

`int` adalah signed 32-bit integer:

```text
range: -2,147,483,648 to 2,147,483,647
```

Ini default integral literal:

```java
var x = 10; // int
```

## 8.1 Kapan `int` tepat?

- array/list index;
- count kecil/menengah;
- loop;
- enum-like internal numeric code only if controlled;
- port number? dengan validation;
- retry count;
- page size;
- HTTP status code representation internal;
- bounded quantity.

## 8.2 Kapan `int` tidak cukup?

- database row count besar;
- file size;
- memory size;
- epoch millis;
- high-volume counter;
- ID/sequence;
- money minor unit dalam volume besar;
- aggregation over many values.

Contoh overflow:

```java
int price = 1_500_000_000;
int quantity = 2;
int total = price * quantity;
System.out.println(total); // overflow, negative/incorrect
```

Gunakan `long` atau `Math.multiplyExact`.

## 8.3 Exact arithmetic

Java menyediakan methods:

```java
Math.addExact(int x, int y)
Math.subtractExact(int x, int y)
Math.multiplyExact(int x, int y)
Math.incrementExact(int x)
Math.toIntExact(long value)
```

Contoh:

```java
int total = Math.multiplyExact(price, quantity);
```

Jika overflow:

```text
ArithmeticException
```

Ini jauh lebih baik daripada silent overflow untuk business-critical calculation.

## 8.4 Unsigned int operations

Java tidak punya `uint`, tetapi menyediakan beberapa unsigned operations:

```java
Integer.toUnsignedLong(int x)
Integer.compareUnsigned(int x, int y)
Integer.divideUnsigned(int dividend, int divisor)
Integer.remainderUnsigned(int dividend, int divisor)
Integer.toUnsignedString(int x)
```

Gunakan untuk binary protocol atau interop, bukan untuk domain biasa kecuali benar-benar perlu.

---

# 9. `long`: 64-bit Integer untuk Range Besar

`long` adalah signed 64-bit integer:

```text
range: -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807
```

Literal long memakai suffix `L`:

```java
long value = 10L;
```

Gunakan `L`, bukan `l`, karena `l` mirip angka `1`.

## 9.1 Kapan `long` tepat?

- large counter;
- epoch millis/nanos;
- file size;
- byte size;
- database generated numeric ID;
- version number;
- duration internal representation;
- money minor unit jika range cukup;
- high-volume metrics.

## 9.2 `long` overflow

`long` juga overflow.

```java
long x = Long.MAX_VALUE;
System.out.println(x + 1); // Long.MIN_VALUE
```

Gunakan:

```java
Math.addExact(long x, long y)
Math.multiplyExact(long x, long y)
```

## 9.3 JavaScript precision issue

Jika `long` dikirim sebagai JSON number ke JavaScript, precision bisa hilang untuk nilai di atas 2^53-1.

Contoh domain ID:

```java
long id = 9_223_372_036_854_775_000L;
```

Jika client JavaScript membacanya sebagai `Number`, nilai bisa berubah.

Solusi untuk external API:

```json
{
  "id": "9223372036854775000"
}
```

Internal Java boleh `long`, external contract bisa string.

## 9.4 `long` for money minor units

Untuk money, `long` minor unit sering bagus:

```java
record Money(long minorUnits, Currency currency) {}
```

Misalnya:

```text
SGD 12.34 → 1234 cents
IDR 10000 → 10000 rupiah if no minor unit
```

Tetapi harus memperhatikan:

- currency fraction digits;
- overflow saat agregasi;
- rounding saat conversion dari decimal input;
- external representation.

## 9.5 Atomicity note

Di modern Java, reads/writes of `volatile long` atomic dan punya visibility. Non-volatile long/double atomicity historically nuanced in JLS, but data race tetap masalah. Jangan mengandalkan non-volatile shared mutable `long` untuk concurrency.

Gunakan:

```java
AtomicLong
LongAdder
volatile long
synchronized
```

sesuai semantics.

---

# 10. `char`: Unsigned 16-bit UTF-16 Code Unit, Bukan Karakter Manusia

`char` adalah unsigned 16-bit integral type:

```text
range: '\u0000' to '\uffff'
numeric: 0 to 65535
```

Ini sangat penting:

```text
char bukan "character" manusia secara penuh.
char adalah UTF-16 code unit.
```

## 10.1 Char sebagai integral type

```java
char c = 'A';
int code = c;
System.out.println(code); // 65
```

`char` bisa ikut arithmetic:

```java
char c = 'A';
c++;
System.out.println(c); // B
```

## 10.2 Char unsigned

```java
char c = '\uffff';
int x = c;
System.out.println(x); // 65535
```

Berbeda dari `short` yang signed 16-bit.

## 10.3 Surrogate pair

Banyak karakter Unicode membutuhkan dua `char` di UTF-16.

Contoh emoji:

```java
String s = "😄";
System.out.println(s.length());      // 2
System.out.println(s.codePointCount(0, s.length())); // 1
```

`charAt(0)` hanya mengambil high surrogate, bukan karakter lengkap.

## 10.4 Jangan validasi user-facing character dengan `char`

Buruk:

```java
char first = name.charAt(0);
```

Untuk text manusia, gunakan code point/grapheme-aware logic jika perlu.

## 10.5 `Character` API

Gunakan:

```java
s.codePoints()
Character.isLetter(codePoint)
Character.toUpperCase(codePoint)
```

Namun bahkan code point belum tentu sama dengan grapheme cluster. Beberapa user-perceived character terdiri dari beberapa code points.

## 10.6 Char use cases yang tepat

- parsing ASCII protocol;
- simple delimiters;
- internal lexer/tokenizer;
- low-level UTF-16 processing;
- switch on simple character literal;
- performance-sensitive parser where input domain known.

Tidak tepat untuk:

- counting characters user sees;
- validating names in all languages;
- splitting emoji;
- security-sensitive Unicode normalization;
- locale-aware case conversion.

---

# 11. `float`: 32-bit Floating Point

`float` adalah 32-bit binary floating point.

Literal float:

```java
float f = 1.0f;
```

Tanpa suffix, floating literal default adalah `double`:

```java
float f = 1.0; // compile error without cast
```

## 11.1 Kapan `float` tepat?

- graphics;
- game development;
- ML inference/tensors;
- large numeric arrays where memory bandwidth matters;
- approximate measurement;
- interop with format/protocol requiring 32-bit float.

Jarang tepat untuk business calculation.

## 11.2 Precision

`float` punya precision lebih rendah dari `double`.

```java
float f = 16_777_217f;
System.out.println(f); // may print 1.6777216E7
```

Tidak semua integer besar bisa direpresentasikan tepat.

## 11.3 Float special values

```java
Float.NaN
Float.POSITIVE_INFINITY
Float.NEGATIVE_INFINITY
```

NaN muncul dari operasi invalid:

```java
float x = 0.0f / 0.0f; // NaN
```

Infinity:

```java
float y = 1.0f / 0.0f; // Infinity
```

## 11.4 Float equality

Jangan compare floating point hasil perhitungan dengan `==` kecuali kamu benar-benar memahami semantics-nya.

```java
float a = 0.1f + 0.2f;
float b = 0.3f;
System.out.println(a == b); // often false
```

Gunakan tolerance untuk measurement:

```java
boolean close = Math.abs(a - b) < 1e-6f;
```

Tetapi tolerance harus domain-specific.

---

# 12. `double`: 64-bit Floating Point

`double` adalah default floating point type.

```java
double d = 3.14;
```

## 12.1 Kapan `double` tepat?

- scientific computation;
- measurement approximate;
- statistics;
- geometry;
- machine learning;
- ranking/scoring approximate;
- simulation;
- performance-sensitive numeric code.

Tidak tepat untuk:

- money;
- exact decimal accounting;
- legal/regulatory amount;
- tax;
- settlement;
- invoice total;
- equality-critical decimal.

## 12.2 Decimal surprise

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004
```

Karena 0.1 dan 0.2 tidak representable secara exact dalam binary floating point.

## 12.3 Use BigDecimal for decimal business

Untuk money/tax:

```java
BigDecimal amount = new BigDecimal("0.10");
BigDecimal total = amount.add(new BigDecimal("0.20"));
```

Jangan:

```java
new BigDecimal(0.1)
```

karena memasukkan nilai double yang sudah approximate.

Gunakan string atau `BigDecimal.valueOf(double)` dengan pemahaman.

## 12.4 Double special values

```java
Double.NaN
Double.POSITIVE_INFINITY
Double.NEGATIVE_INFINITY
```

NaN trap:

```java
double x = Double.NaN;
System.out.println(x == x); // false
```

Cek NaN:

```java
Double.isNaN(x)
```

## 12.5 Signed zero

```java
double pz = 0.0;
double nz = -0.0;

System.out.println(pz == nz); // true
System.out.println(1.0 / pz); // Infinity
System.out.println(1.0 / nz); // -Infinity
```

Signed zero jarang penting di business apps, tetapi penting untuk math libraries/numeric algorithms.

---

# 13. Default Values: Field dan Array vs Local Variable

## 13.1 Field default values

Instance/static fields punya default value.

```java
class Example {
    int count;          // 0
    long total;         // 0L
    boolean active;     // false
    double score;       // 0.0
    char c;             // '\u0000'
    String name;        // null
}
```

## 13.2 Array default values

Array components juga default:

```java
int[] xs = new int[10];       // all 0
boolean[] bs = new boolean[3]; // all false
String[] ss = new String[2];   // all null
```

## 13.3 Local variables must be definitely assigned

```java
void f() {
    int x;
    System.out.println(x); // compile error
}
```

Local variable tidak otomatis default dari sudut language. Compiler menuntut definite assignment.

## 13.4 Default value can hide bugs

```java
class Payment {
    long amountMinor;
}
```

Default `0` mungkin valid amount, atau mungkin berarti belum di-set.

Jika “unset” harus dibedakan dari zero, primitive mungkin tidak cocok.

Options:

- constructor required;
- value object;
- wrapper nullable with explicit handling;
- sealed state;
- builder validation.

---

# 14. Literals: Cara Menulis Primitive Value

## 14.1 Integer literals

```java
int decimal = 123;
int hex = 0x7B;
int binary = 0b0111_1011;
int octal = 0173;
```

Hati-hati octal:

```java
int x = 010; // 8, not 10
```

Avoid leading zero unless intentionally octal.

## 14.2 Underscore in numeric literals

```java
int million = 1_000_000;
long mask = 0xFF_FF_FF_FFL;
```

Underscore meningkatkan readability.

## 14.3 Long literal

```java
long value = 123L;
```

Gunakan uppercase `L`.

## 14.4 Floating literals

```java
double d = 1.23;
float f = 1.23f;
double scientific = 1.0e-9;
double hexFloat = 0x1.0p-3; // 0.125
```

## 14.5 Boolean literals

```java
true
false
```

## 14.6 Character literals

```java
char a = 'A';
char newline = '\n';
char quote = '\'';
char unicode = '\u0041'; // 'A'
```

Unicode escape diproses sangat awal oleh compiler, bahkan sebelum tokenization. Ini bisa menyebabkan kejutan pada komentar/string jika tidak hati-hati.

---

# 15. Integer Arithmetic dan Overflow

## 15.1 Overflow silently wraps

Java integer arithmetic tidak otomatis throw exception pada overflow.

```java
int x = Integer.MAX_VALUE;
System.out.println(x + 1); // Integer.MIN_VALUE
```

## 15.2 Production example

```java
int fileSize = 2_000_000_000;
int doubled = fileSize * 2; // overflow
```

Jika dipakai untuk buffer allocation, pagination, billing, atau limit, bisa fatal.

## 15.3 Use exact methods

```java
int total = Math.addExact(a, b);
long product = Math.multiplyExact(x, y);
int narrowed = Math.toIntExact(longValue);
```

## 15.4 Use long early

```java
int price = 1_500_000_000;
int qty = 2;

long total = (long) price * qty;
```

Jika:

```java
long total = price * qty;
```

overflow terjadi dulu di `int`, baru dikonversi ke long.

## 15.5 Guard multiplication

```java
long total = Math.multiplyExact(unitPriceMinor, quantity);
```

For money, prefer exact failure over silent corrupt amount.

---

# 16. Numeric Promotion: Kenapa `byte + byte` Menjadi `int`

Java melakukan numeric promotion untuk operator numeric.

## 16.1 Unary numeric promotion

Untuk unary operators seperti `+`, `-`, `~`, type kecil dipromosikan.

```java
byte b = 1;
int x = -b;
```

## 16.2 Binary numeric promotion

Untuk operator seperti:

```text
+ - * / % < <= > >= == != & ^ |
```

operands dipromosikan ke common type.

Rules simplified:

- jika salah satu `double`, hasil `double`;
- else jika salah satu `float`, hasil `float`;
- else jika salah satu `long`, hasil `long`;
- else hasil `int`.

Maka:

```java
byte + byte -> int
short + short -> int
char + char -> int
int + long -> long
long + float -> float
float + double -> double
```

## 16.3 Example

```java
byte a = 10;
byte b = 20;
var c = a + b; // int
```

## 16.4 Why?

JVM integer arithmetic primarily operates with at least int computational type for small integer types. This simplifies operations and avoids too many tiny arithmetic opcodes.

## 16.5 Production implication

Code like:

```java
short checksum = a + b + c;
```

needs explicit cast and overflow awareness.

For binary protocol, be explicit:

```java
int unsignedByte = Byte.toUnsignedInt(buffer[i]);
```

---

# 17. Widening, Narrowing, dan Cast

## 17.1 Widening primitive conversion

Widening usually doesn't lose range, but can lose precision when converting integral to floating.

Examples:

```java
byte -> short -> int -> long -> float -> double
char -> int -> long -> float -> double
```

```java
int i = 1;
long l = i;
double d = l;
```

## 17.2 Precision loss example

```java
long x = 9_007_199_254_740_993L; // 2^53 + 1
double d = x;
long y = (long) d;

System.out.println(x == y); // false
```

A `double` cannot represent every `long`.

## 17.3 Narrowing primitive conversion

Narrowing can lose information:

```java
long l = 300;
byte b = (byte) l;
System.out.println(b); // 44
```

Because 300 mod 256 = 44.

## 17.4 Constant expression assignment

Java allows certain constant narrowing if value fits:

```java
byte b = 100; // ok
byte x = 128; // compile error
```

But:

```java
int i = 100;
byte b = i; // compile error
```

Because `i` is variable, not compile-time constant.

## 17.5 `byte` to `char`

`byte` to `char` is not simple widening because `byte` signed and `char` unsigned. It involves widening to int then narrowing to char in specific contexts, but direct assignment requires cast:

```java
byte b = 65;
char c = (char) b;
```

---

# 18. Compound Assignment Trap

Compound assignment:

```java
x += y;
```

is not exactly same as:

```java
x = x + y;
```

It includes implicit cast to type of `x`.

## 18.1 Example

```java
byte b = 1;
b = b + 1; // compile error
b += 1;    // ok
```

`b += 1` roughly:

```java
b = (byte) (b + 1);
```

## 18.2 Overflow hidden

```java
byte b = 127;
b += 1;
System.out.println(b); // -128
```

Compiler allows it, but data overflows.

## 18.3 String compound assignment

```java
String s = "x";
s += 1;
```

String concatenation occurs.

## 18.4 Design rule

For business-critical numeric operations, avoid compound assignment if overflow matters. Use exact methods or explicit range checks.

---

# 19. Floating-Point Semantics: Precision, NaN, Infinity, dan Signed Zero

## 19.1 Binary floating point cannot represent many decimals

```java
double x = 0.1;
```

`0.1` is approximate.

Thus:

```java
0.1 + 0.2 != 0.3
```

in typical equality comparison.

## 19.2 NaN

NaN means Not-a-Number.

```java
double x = Math.sqrt(-1.0);
System.out.println(Double.isNaN(x)); // true
```

NaN comparisons:

```java
double n = Double.NaN;

System.out.println(n == n); // false
System.out.println(n != n); // true
System.out.println(n < 0);  // false
System.out.println(n > 0);  // false
```

Use:

```java
Double.isNaN(n)
```

## 19.3 Infinity

```java
double p = 1.0 / 0.0;  // Infinity
double n = -1.0 / 0.0; // -Infinity
```

Check:

```java
Double.isInfinite(p)
Double.isFinite(p)
```

## 19.4 Signed zero

```java
double positiveZero = 0.0;
double negativeZero = -0.0;

positiveZero == negativeZero // true
```

But:

```java
1.0 / positiveZero // Infinity
1.0 / negativeZero // -Infinity
```

## 19.5 `Double.compare`

Use `Double.compare(a, b)` for ordering that handles NaN/signed zero consistently according to Java API contract.

## 19.6 Money rule

Never use `float`/`double` for money if exact decimal correctness matters.

Use:

- `BigDecimal` with explicit scale/rounding;
- `long` minor units;
- domain type `Money`.

---

# 20. Comparison dan Equality Primitive

## 20.1 Integral equality

```java
int a = 1;
long b = 1L;
System.out.println(a == b); // true after promotion
```

## 20.2 Char comparison

```java
char a = 'A';
System.out.println(a == 65); // true
```

Because `char` participates as integral type.

## 20.3 Boolean equality

```java
boolean a = true;
boolean b = false;

a == b
a != b
```

No ordering:

```java
a < b // compile error
```

## 20.4 Floating equality

Be careful:

```java
double x = 0.1 + 0.2;
double y = 0.3;

x == y // false
```

Use domain tolerance for measurements.

## 20.5 NaN equality

```java
Double.NaN == Double.NaN // false
```

But wrapper `Double.equals` canonicalizes/handles NaN differently according to API semantics. That will be discussed in wrapper part.

---

# 21. Primitive dan JVM: Computational Types

At JVM level, there are primitive types and computational types. Small integral types (`byte`, `short`, `char`, `boolean`) are often represented/operated as `int` in local variables/operand stack computations.

This explains why arithmetic on `byte`/`short`/`char` promotes to `int`.

## 21.1 Local variables and operand stack

A method frame has:

- local variables;
- operand stack.

Operations load values to operand stack, operate, store results.

Example:

```java
int add(int a, int b) {
    return a + b;
}
```

Conceptually:

```text
load a
load b
iadd
return int
```

## 21.2 Boolean representation

The Java language has `boolean`, but JVM has limited direct boolean-specific instruction support. Boolean values in arrays have specific treatment; in many computation contexts they are represented using int-like values.

Do not rely on physical boolean size for memory calculation without measuring. Use tools like JOL for object layout.

## 21.3 `long` and `double` category 2

In JVM frame slots, `long` and `double` occupy two slots in local variables/operand stack, while many other values occupy one slot.

This matters mostly for bytecode understanding, not normal Java code.

---

# 22. Primitive dan Memory Footprint

## 22.1 Primitive field sizes conceptually

Primitive values have fixed bit widths at language level except boolean representation not directly specified as a memory size.

But object layout can include:

- object header;
- field alignment;
- padding;
- compressed references;
- JVM-specific layout decisions.

Thus:

```java
class A {
    byte b;
}
```

does not mean object size is 1 byte.

## 22.2 Primitive arrays are compact

Arrays of primitives are where memory savings are obvious.

```java
int[] xs = new int[1_000_000];
```

roughly stores 1 million int values plus array header.

```java
Integer[] xs = new Integer[1_000_000];
```

stores 1 million references, plus many `Integer` objects if populated.

## 22.3 Boolean array caveat

`boolean[]` is compact but not necessarily 1 bit per boolean. If you need bit-level compactness, use:

```java
BitSet
```

or custom bit packing.

## 22.4 Object field packing

JVM may reorder fields for layout efficiency within rules. Don't design business correctness based on field physical order.

For memory-sensitive code, measure with JOL.

---

# 23. Primitive vs Wrapper: Boundary ke Object World

Primitive tidak bisa dipakai sebagai generic type:

```java
List<int> xs; // invalid
List<Integer> xs; // valid
```

Wrapper classes:

```java
Boolean
Byte
Short
Integer
Long
Character
Float
Double
```

## 23.1 Boxing

```java
Integer x = 10; // boxes int to Integer
```

## 23.2 Unboxing

```java
int y = x; // unboxes Integer to int
```

## 23.3 NPE on unboxing

```java
Integer x = null;
int y = x; // NPE
```

## 23.4 Boxing cost

Boxing can allocate objects and increase GC pressure.

```java
List<Integer> values = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    values.add(i);
}
```

This may create many wrapper objects, except cached small values.

## 23.5 Wrapper cache trap

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b); // often true due cache

Integer x = 128;
Integer y = 128;
System.out.println(x == y); // often false
```

Never use `==` for wrapper numeric equality. Use `.equals` or unbox intentionally.

This will be deep-dived later.

---

# 24. Primitive Patterns di Java 25 Preview

Java 25 includes preview support for primitive types in patterns, `instanceof`, and `switch`.

Preview means:

```text
not final language feature
requires --enable-preview
may change in future releases
```

## 24.1 Why it matters conceptually

Historically, pattern matching focused on reference types. Java 25 preview moves toward more uniform data exploration across primitive and reference types.

Example conceptual direction:

```java
// preview-style concept, requires Java 25 preview feature
switch (value) {
    case int i -> ...
    case long l -> ...
    case double d -> ...
}
```

This helps align pattern matching with safe casting and primitive conversion checks.

## 24.2 Production rule

Do not use preview features in production unless:

- organization policy allows it;
- build/run uses `--enable-preview`;
- upgrade risk accepted;
- syntax/semantics may change;
- fallback plan exists.

## 24.3 Why include here?

Because Java type system is evolving. Primitive and reference type treatment is becoming more uniform in pattern contexts, but core primitive semantics—range, overflow, promotion, floating point—remain essential.

---

# 25. Kapan Primitive Tepat, Kapan Harus Domain Type

## 25.1 Use primitive when value is implementation detail

Good:

```java
for (int i = 0; i < items.size(); i++) {}
```

Good:

```java
byte[] buffer = new byte[8192];
```

Good:

```java
long startNanos = System.nanoTime();
```

## 25.2 Use domain type when value has business meaning

Instead of:

```java
void close(String caseId, String reason, int severity)
```

Prefer:

```java
void close(CaseId caseId, ClosureReason reason, Severity severity)
```

## 25.3 Use wrapper when nullability is meaningful at boundary

Database nullable numeric column:

```java
Integer optionalScore;
```

But don't let nullable wrapper leak everywhere. Translate to domain state/result.

## 25.4 Use BigDecimal or Money for decimal business

```java
record Money(BigDecimal amount, Currency currency) {}
```

or:

```java
record Money(long minorUnits, Currency currency) {}
```

## 25.5 Use enum/sealed for state

Instead of:

```java
int status;
boolean closed;
```

Use:

```java
enum CaseStatus
```

or sealed state.

---

# 26. Production Failure Modes

## 26.1 Integer overflow in pagination

```java
int offset = page * size;
```

If page and size large, overflow can produce negative offset.

Fix:

```java
long offset = Math.multiplyExact((long) page, size);
```

and bound max page/size.

## 26.2 Money with double

```java
double tax = amount * 0.07;
```

Can produce rounding mismatch.

Fix:

```java
Money
BigDecimal
explicit rounding
```

## 26.3 Boolean state bug

```java
approved = true;
rejected = true;
```

Fix:

```java
DecisionStatus
sealed Decision
```

## 26.4 Byte signed bug in protocol

```java
int length = buffer[0]; // negative if high bit set
```

Fix:

```java
int length = Byte.toUnsignedInt(buffer[0]);
```

## 26.5 Char splits emoji/name

```java
String first = "" + name.charAt(0);
```

Breaks surrogate pair.

Fix:

```java
int cp = name.codePointAt(0);
```

and understand grapheme if user-facing.

## 26.6 Unboxing NPE

```java
if (config.getEnabled()) { ... } // Boolean may be null
```

Fix:

```java
Boolean.TRUE.equals(config.getEnabled())
```

or better explicit default/config validation.

## 26.7 Long ID precision loss in JSON

```json
{ "id": 9223372036854775807 }
```

JavaScript consumer loses precision.

Fix:

```json
{ "id": "9223372036854775807" }
```

## 26.8 NaN propagates through computation

```java
double score = calculateScore(input);
```

If NaN enters, comparisons fail unexpectedly.

Fix:

```java
if (!Double.isFinite(score)) {
    throw new InvalidScore(...);
}
```

---

# 27. Best Practices dan Design Rules

## 27.1 General primitive rules

- Use `int` for normal integral arithmetic unless range requires `long`.
- Use `long` for large counters, IDs, epoch millis, sizes, versions.
- Use `byte[]` for binary data.
- Avoid `short`/`byte` for normal business fields unless storage format requires.
- Avoid `float` unless memory/performance/interop requires it.
- Avoid `double` for money/exact decimal.
- Avoid `char` for user-perceived characters.
- Avoid `boolean` for domain decisions that need reason/state.

## 27.2 Overflow rules

- Use `Math.*Exact` for business-critical arithmetic.
- Cast before operation if widening needed.
- Validate input bounds.
- Avoid silent narrowing.
- Test boundary values.

## 27.3 Floating point rules

- Use tolerance comparison for measurements.
- Use `Double.isNaN`, `Double.isFinite`.
- Don't use `==` for calculated decimal equivalence.
- Use `BigDecimal` or fixed-point for money.
- Define rounding mode explicitly.

## 27.4 Conversion rules

- Avoid implicit semantics hidden in cast.
- Treat narrowing cast as risk.
- Review compound assignment.
- Use unsigned helper methods for binary protocols.
- Never assume `char` is full Unicode character.

## 27.5 Domain rules

- Replace primitive with domain type when it carries business meaning.
- Replace boolean decision with result object if reason matters.
- Replace status int/string with enum/sealed state.
- Replace nullable primitive wrapper with explicit absence/state if possible.

---

# 28. Latihan

## Latihan 1 — Overflow

Tulis method:

```java
int calculateOffset(int page, int size)
```

Lalu buat test untuk:

```text
page = 100_000
size = 100_000
```

Perbaiki dengan `long` dan `Math.multiplyExact`.

## Latihan 2 — Money bug

Bandingkan:

```java
double total = 0.1 + 0.2;
```

dengan:

```java
BigDecimal total = new BigDecimal("0.1").add(new BigDecimal("0.2"));
```

Jelaskan perbedaan.

## Latihan 3 — Byte unsigned

Parsing byte:

```java
byte b = (byte) 0xFF;
```

Cetak:

```java
(int) b
Byte.toUnsignedInt(b)
```

Jelaskan hasilnya.

## Latihan 4 — Char and emoji

```java
String emoji = "😄";
```

Cetak:

```java
emoji.length()
emoji.codePointCount(0, emoji.length())
Integer.toHexString(emoji.charAt(0))
Integer.toHexString(emoji.charAt(1))
```

Jelaskan surrogate pair.

## Latihan 5 — Boolean decision refactor

Dari:

```java
boolean canClose(Case c)
```

ubah menjadi:

```java
CloseEligibility checkCloseEligibility(Case c)
```

dengan reason.

## Latihan 6 — Compound assignment

Eksperimen:

```java
byte b = 127;
b += 1;
```

Lalu jelaskan kenapa compile dan kenapa hasilnya `-128`.

## Latihan 7 — Long JSON precision

Buat JSON dengan long besar. Parse di JavaScript/Node jika ada. Amati precision loss.

## Latihan 8 — Primitive vs domain type

Refactor:

```java
void assign(String caseId, String officerId, int priority, boolean urgent)
```

menjadi type-safe command object.

---

# 29. Ringkasan

Primitive types adalah fondasi Java, tetapi bukan sekadar “tipe kecil dan cepat”.

Hal penting:

```text
boolean  -> bukan integer, hati-hati boolean blindness
byte     -> signed 8-bit, hati-hati unsigned binary data
short    -> jarang untuk business code, arithmetic promotes to int
int      -> default integral, tapi overflow silently
long     -> range besar, tapi tetap overflow dan JSON precision issue
char     -> UTF-16 code unit, bukan karakter manusia
float    -> approximate 32-bit binary floating point
double   -> approximate 64-bit binary floating point, bukan money
```

Rules penting:

- arithmetic kecil (`byte`, `short`, `char`) dipromosikan ke `int`;
- integer overflow silent;
- compound assignment melakukan implicit cast;
- floating point punya NaN, infinity, signed zero, precision issue;
- primitive tidak bisa null;
- primitive tidak punya identity;
- primitive tidak membawa domain semantics.

Engineer senior memakai primitive dengan sadar:

```text
Apakah ini raw computation?
Apakah ini domain concept?
Apakah overflow mungkin?
Apakah precision penting?
Apakah nullability penting?
Apakah external boundary aman?
Apakah compiler bisa membantu lebih banyak jika dibuat type khusus?
```

Primitive itu powerful, tetapi terlalu sering dipakai untuk konsep domain yang seharusnya punya type sendiri.

---

# 30. Referensi

1. Java Language Specification SE 25 — Chapter 4: Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

2. Java Language Specification SE 25 — Chapter 5: Conversions and Contexts  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html

3. Java Language Specification SE 25 — Chapter 3.10: Literals  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-3.html#jls-3.10

4. Java Virtual Machine Specification SE 25  
   https://docs.oracle.com/javase/specs/jvms/se25/html/index.html

5. Java SE 25 API — `Byte`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Byte.html

6. Java SE 25 API — `Integer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Integer.html

7. Java SE 25 API — `Long`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Long.html

8. Java SE 25 API — `Float`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Float.html

9. Java SE 25 API — `Double`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Double.html

10. Java SE 25 API — `Character`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html

11. JEP 507 — Primitive Types in Patterns, instanceof, and switch (Third Preview)  
    https://openjdk.org/jeps/507

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Data Types — Part 000](./learn-java-data-types-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Data Types — Part 002](./learn-java-data-types-part-002.md)

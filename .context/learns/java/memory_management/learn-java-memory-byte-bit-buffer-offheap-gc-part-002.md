# learn-java-memory-byte-bit-buffer-offheap-gc-part-002

# Java Primitive Memory Semantics: Dari `boolean` sampai `double`

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Part: `002`  
> Target pembaca: Java engineer yang ingin memahami primitive bukan hanya sebagai tipe bahasa, tetapi sebagai representasi nilai, biaya memori, biaya CPU, konsekuensi object layout, efek cache locality, dan implikasi desain sistem.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membahas fondasi **bit, byte, word, alignment, endianness**, dan cara berpikir terhadap data biner. Pada bagian ini kita naik satu layer: bagaimana Java merepresentasikan **primitive values** dan bagaimana keputusan memakai `boolean`, `byte`, `short`, `char`, `int`, `long`, `float`, `double`, atau wrapper seperti `Integer` dan `Long` berdampak ke:

1. ukuran data;
2. layout object;
3. array footprint;
4. CPU cache locality;
5. boxing/autoboxing;
6. numeric conversion;
7. precision loss;
8. allocation pressure;
9. GC pressure;
10. desain API dan domain model.

Mental model utama:

```text
Primitive bukan hanya "tipe kecil".
Primitive adalah kontrak nilai di level Java language.
Ukuran aktualnya di memori tergantung konteks:
- local variable di stack frame / register / optimized away;
- field di object layout;
- element di primitive array;
- value di wrapper object;
- value yang dipromosikan dalam numeric expression;
- value yang dibaca/tulis via buffer/off-heap.
```

Bagian ini penting karena banyak memory problem produksi tidak datang dari satu object besar, tetapi dari jutaan object kecil, wrapper kecil, field yang tidak rapat, array of references, `Map<Long, Integer>`, `List<Boolean>`, `BigDecimal` berlebihan, atau conversion bug yang tidak terlihat di test kecil.

---

## 1. Peta Primitive Java

Java memiliki delapan primitive type:

| Type | Kategori | Ukuran nilai konseptual | Range / Nilai |
|---|---:|---:|---|
| `boolean` | logical | tidak ditentukan sebagai bit-level public contract | `true`, `false` |
| `byte` | integral signed | 8-bit | -128 sampai 127 |
| `short` | integral signed | 16-bit | -32768 sampai 32767 |
| `char` | integral unsigned UTF-16 code unit | 16-bit | `\u0000` sampai `\uffff` |
| `int` | integral signed | 32-bit | -2^31 sampai 2^31-1 |
| `long` | integral signed | 64-bit | -2^63 sampai 2^63-1 |
| `float` | floating point | 32-bit IEEE 754 binary32 | finite, zero, infinity, NaN |
| `double` | floating point | 64-bit IEEE 754 binary64 | finite, zero, infinity, NaN |

JLS membagi primitive menjadi `boolean` dan numeric types. Numeric types dibagi lagi menjadi integral types (`byte`, `short`, `int`, `long`, `char`) dan floating-point types (`float`, `double`).

Yang perlu ditanam sejak awal:

```text
Java primitive punya semantic contract yang stabil.
Tetapi physical layout di HotSpot adalah implementasi JVM, bukan syntax Java.
```

Contoh:

```java
boolean active;
```

Secara bahasa, `active` hanya punya dua nilai: `true` atau `false`. Tetapi bukan berarti field itu pasti disimpan sebagai 1 bit. Dalam praktik HotSpot, boolean field/array element biasanya menggunakan 1 byte, lalu object alignment/padding dapat membuat footprint total lebih besar.

---

## 2. Primitive sebagai Value, Bukan Object

Primitive berbeda dari reference type.

```java
int x = 10;
Integer y = 10;
```

Secara konseptual:

```text
int x
  -> value langsung

Integer y
  -> reference ke object Integer
     object Integer berisi field int value
```

Diagram sederhana:

```text
Local variable table / register / optimized representation

x: 10

y: ---- reference ----> Integer object
                        +----------------+
                        | object header  |
                        | int value = 10 |
                        | padding        |
                        +----------------+
```

Konsekuensi:

1. `int` tidak punya identity.
2. `int` tidak bisa `null`.
3. `int` tidak punya object header.
4. `int` tidak perlu heap allocation saat tetap primitive.
5. `Integer` punya identity object, bisa `null`, bisa masuk collection generic, tetapi membawa overhead.

Kesalahan mental model umum:

```text
Salah:
"Integer cuma int yang bisa null."

Lebih benar:
"Integer adalah object terpisah yang membungkus int, membawa header, identity, reference indirection, potensi allocation, potensi cache miss, dan potensi GC pressure."
```

---

## 3. Ukuran Bahasa vs Ukuran Runtime

Ada tiga level ukuran yang harus dibedakan.

### 3.1 Ukuran Nilai Konseptual

Ini adalah ukuran semantic type:

```text
byte   = 8-bit signed
short  = 16-bit signed
char   = 16-bit unsigned UTF-16 code unit
int    = 32-bit signed
long   = 64-bit signed
float  = 32-bit IEEE 754
ouble = 64-bit IEEE 754
```

### 3.2 Ukuran Field dalam Object

Jika primitive menjadi field object, layout dipengaruhi oleh:

1. object header;
2. field order yang dipilih JVM;
3. field size;
4. alignment;
5. padding;
6. compressed class pointer / compressed oops;
7. object alignment boundary, biasanya 8 byte di banyak konfigurasi HotSpot.

Contoh:

```java
final class A {
    boolean b;
}
```

Tidak berarti object `A` berukuran 1 byte.

Lebih realistis:

```text
A object
+-----------------------------+
| mark word                   |
| class pointer               |
| boolean b                   |
| padding                     |
+-----------------------------+
```

Object kecil sering didominasi oleh header dan padding, bukan field.

### 3.3 Ukuran Element dalam Primitive Array

Primitive array lebih compact dibanding object per element.

```java
int[] xs = new int[1_000_000];
Integer[] ys = new Integer[1_000_000];
```

`int[]`:

```text
array object header + 1,000,000 * 4 bytes
```

`Integer[]`:

```text
array object header
+ 1,000,000 references
+ up to 1,000,000 Integer objects elsewhere
```

Jika compressed references aktif, reference biasanya 4 byte, tetapi setiap `Integer` object tetap punya header dan alignment. Jadi `Integer[]` bisa berkali-kali lipat lebih besar daripada `int[]`.

---

## 4. `boolean`: Logical Value yang Sering Disalahpahami

### 4.1 Semantic Contract

`boolean` hanya punya dua nilai:

```java
true
false
```

Tidak ada numeric conversion langsung antara `boolean` dan numeric primitive.

Tidak valid:

```java
int x = true;        // compile error
boolean b = 1;      // compile error
```

Valid:

```java
boolean b = count > 0;
int x = b ? 1 : 0;
```

### 4.2 `boolean` Bukan C-style integer

Di C/C++, boolean sering dekat dengan integer semantics. Di Java, `boolean` sengaja dipisahkan. Ini mengurangi bug seperti:

```c
if (x = 1) { ... }
```

Di Java:

```java
int x = 0;
if (x = 1) {      // compile error
}
```

### 4.3 Memory Layout `boolean`

Bahasa Java tidak memaparkan apakah `boolean` disimpan sebagai 1 bit, 1 byte, atau bentuk lain. Untuk HotSpot, secara praktis:

```text
boolean field       -> umumnya 1 byte dalam layout field
boolean[] element   -> umumnya 1 byte per element
```

Tetapi object total tetap dipengaruhi header dan padding.

Contoh:

```java
boolean[] flags = new boolean[1_000_000];
```

Secara mental:

```text
~1 MB payload + array header + padding
```

Bukan:

```text
1,000,000 bits = 125 KB
```

Jika butuh bit-packed logical values, gunakan struktur seperti:

```java
BitSet
long[] bitmap
RoaringBitmap-like structure
custom packed flags
```

### 4.4 Kapan `boolean[]` Cukup?

Gunakan `boolean[]` jika:

1. jumlah element tidak terlalu besar;
2. akses sangat sederhana;
3. readability lebih penting;
4. tidak perlu bit-level compression;
5. mutation per index sering dan langsung.

Gunakan bit-packed structure jika:

1. jutaan sampai miliaran flag;
2. memory footprint kritikal;
3. flags disimpan/dikirim sebagai binary format;
4. operasi set algebra penting;
5. cache locality lebih penting daripada simplicity.

Trade-off:

```text
boolean[]
  + sederhana
  + akses mudah
  + cepat untuk operasi langsung
  - 1 byte per flag, bukan 1 bit

BitSet / long[] bitmap
  + hemat memori
  + operasi bulk bisa cepat
  - kode lebih kompleks
  - butuh masking/shifting benar
```

---

## 5. `byte`: 8-bit Signed Value

### 5.1 Range

```java
byte min = -128;
byte max = 127;
```

Java `byte` signed. Ini sering mengejutkan engineer yang banyak bekerja dengan binary protocol karena byte di file/network sering diperlakukan sebagai unsigned 0..255.

### 5.2 Unsigned Byte Pattern

```java
byte b = (byte) 0xFF;
System.out.println(b);        // -1
System.out.println(b & 0xFF); // 255
```

Mental model:

```text
byte b = 11111111b
as signed byte = -1
as unsigned int = 255
```

Untuk membaca byte sebagai unsigned, gunakan:

```java
int unsigned = Byte.toUnsignedInt(b);
```

atau:

```java
int unsigned = b & 0xFF;
```

### 5.3 Arithmetic Promotion

Operasi arithmetic pada `byte` dipromosikan ke `int`.

```java
byte a = 1;
byte b = 2;
// byte c = a + b; // compile error: result is int
byte c = (byte) (a + b);
```

Ini bukan bug. Java melakukan binary numeric promotion.

Mental model:

```text
byte/short/char arithmetic -> int arithmetic
```

Akibatnya, jangan mendesain code yang mengira operasi byte tetap byte.

### 5.4 Use Case `byte`

`byte` cocok untuk:

1. raw binary data;
2. file/network payload;
3. compact numeric range kecil;
4. serialized representation;
5. checksum/hash buffer;
6. image/audio/video low-level data;
7. protocol parser;
8. memory-sensitive primitive array.

Tetapi untuk local arithmetic biasa, `int` sering lebih natural karena CPU/JVM cenderung bekerja efisien pada word-sized operations.

---

## 6. `short`: 16-bit Signed Value

### 6.1 Range

```java
short min = -32768;
short max = 32767;
```

`short` jarang ideal untuk business domain biasa kecuali ada alasan jelas.

### 6.2 Arithmetic Promotion

Sama seperti `byte`, operasi `short` dipromosikan ke `int`.

```java
short a = 10;
short b = 20;
// short c = a + b; // compile error
short c = (short) (a + b);
```

### 6.3 Use Case `short`

`short` cocok untuk:

1. binary format 16-bit;
2. audio sample tertentu;
3. compact arrays;
4. coordinate/grid kecil;
5. protocol field;
6. memory-sensitive numeric arrays.

Kurang cocok untuk:

1. counter umum;
2. money;
3. ID domain;
4. status code jika readability lebih penting;
5. API publik yang akan berkembang.

### 6.4 Risiko Domain Modeling

Misal:

```java
short retryCount;
```

Secara memory terlihat hemat. Tetapi jika field ada di object yang tetap harus aligned, penghematan mungkin nihil. Bahkan bisa memperumit arithmetic.

Lebih baik gunakan `int` kecuali:

```text
- jumlah datanya besar;
- ada jutaan element dalam array;
- format eksternal memang 16-bit;
- profiling membuktikan memory pressure relevan.
```

---

## 7. `char`: 16-bit Unsigned UTF-16 Code Unit

### 7.1 `char` Bukan “Character Unicode Lengkap”

`char` adalah 16-bit unsigned value, range:

```java
'\u0000' sampai '\uffff'
```

Tetapi Unicode code point bisa lebih besar dari `0xFFFF`. Karakter di luar Basic Multilingual Plane direpresentasikan dalam UTF-16 sebagai surrogate pair.

Contoh:

```java
String s = "😀";
System.out.println(s.length());          // 2, jumlah UTF-16 code unit
System.out.println(s.codePointCount(0, s.length())); // 1, jumlah code point
```

Mental model:

```text
char       = UTF-16 code unit
code point = Unicode scalar value / logical code point
user-perceived character = grapheme cluster, bisa lebih kompleks lagi
```

### 7.2 `char` Sebagai Integral Type

`char` termasuk integral type, tetapi unsigned.

```java
char c = 'A';
int x = c; // 65
```

Arithmetic pada `char` juga dipromosikan ke `int`.

```java
char c = 'A';
// char d = c + 1; // compile error
char d = (char) (c + 1);
```

### 7.3 Kapan `char` Tepat?

Gunakan `char` untuk:

1. UTF-16 code unit processing;
2. parser sederhana untuk ASCII/Latin subset;
3. delimiter single code unit;
4. low-level string scanning.

Hindari menganggap `char` sebagai:

```text
"satu karakter yang dilihat manusia"
```

Untuk Unicode-aware logic, gunakan:

```java
String.codePoints()
Character.isLetter(int codePoint)
Character.toLowerCase(int codePoint)
BreakIterator untuk boundary tertentu
```

### 7.4 Memory Implication

`char[]` menggunakan 2 byte per element. Namun sejak Java 9, `String` menggunakan compact strings secara internal: data string dapat disimpan sebagai `byte[]` Latin-1 atau UTF-16 dengan coder flag. Ini akan dibahas lebih detail di bagian String, tetapi penting untuk tahu bahwa:

```text
char[] bukan lagi mental model akurat untuk semua String modern.
```

---

## 8. `int`: Default Integral Workhorse

### 8.1 Kenapa `int` Sering Jadi Default

`int` adalah tipe integral default untuk literal angka tanpa suffix.

```java
var x = 10; // int
```

`int` sering dipakai karena:

1. range cukup untuk banyak kasus;
2. arithmetic natural;
3. tidak sering butuh cast;
4. operasi CPU/JVM efisien;
5. indexing array memakai `int`;
6. banyak API Java memakai `int` untuk size, length, offset.

### 8.2 Range dan Overflow

```java
int max = Integer.MAX_VALUE;
System.out.println(max + 1); // Integer.MIN_VALUE
```

Java integer overflow tidak melempar exception secara default. Ia wrap around menggunakan two's complement semantics.

Gunakan method exact jika overflow harus terdeteksi:

```java
int r = Math.addExact(a, b);
int m = Math.multiplyExact(a, b);
```

### 8.3 `int` untuk Size dan Count

Banyak API Java menggunakan `int` untuk ukuran:

```java
array.length       // int
String.length()    // int
List.size()        // int
ByteBuffer.limit() // int
```

Implikasi:

```text
single Java array tidak bisa punya index melebihi int range.
```

Untuk data sangat besar, desain biasanya butuh chunking/segmentation:

```text
long logicalOffset -> chunkIndex + int offsetWithinChunk
```

---

## 9. `long`: 64-bit Signed Value

### 9.1 Use Case

`long` cocok untuk:

1. ID numeric besar;
2. timestamp epoch millis/nanos;
3. counters jangka panjang;
4. byte offsets file besar;
5. sequence number;
6. bitset word storage;
7. packed fields;
8. memory size calculation.

### 9.2 Literal `long`

```java
long x = 10L;
```

Gunakan `L`, bukan `l`, karena `l` mirip `1`.

```java
long clear = 10L;
long confusing = 10l; // legal but bad style
```

### 9.3 Widening ke Floating Point Bisa Kehilangan Presisi

Ini penting.

```java
long x = 9_007_199_254_740_993L; // 2^53 + 1
System.out.println((double) x);   // tidak bisa merepresentasikan semua long persis
```

`double` memiliki 53-bit significand precision. Tidak semua `long` bisa direpresentasikan tepat sebagai `double`.

Mental model:

```text
widening numeric conversion tidak selalu berarti preserving exact value.
int -> float bisa kehilangan presisi.
long -> float bisa kehilangan presisi.
long -> double bisa kehilangan presisi.
```

Ini relevan untuk:

1. ID dikirim sebagai JSON number lalu dibaca JavaScript;
2. money conversion;
3. metrics aggregation;
4. timestamp nanosecond;
5. serialization ke format floating.

---

## 10. `float` dan `double`: IEEE 754 Floating Point

### 10.1 Floating Point Bukan Decimal

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004
```

Ini bukan bug Java. Banyak decimal fractions tidak punya representasi exact dalam binary floating-point.

### 10.2 `float` vs `double`

| Type | Size | Precision Approx | Use Case |
|---|---:|---:|---|
| `float` | 32-bit | ~6-7 decimal digits | graphics, ML tensor tertentu, large numeric arrays |
| `double` | 64-bit | ~15-16 decimal digits | default scientific/general floating calculation |

Literal floating default adalah `double`.

```java
var x = 1.0;  // double
var y = 1.0f; // float
```

### 10.3 Special Values

Floating point memiliki:

```text
+0.0
-0.0
+Infinity
-Infinity
NaN
```

Contoh:

```java
System.out.println(1.0 / 0.0);      // Infinity
System.out.println(-1.0 / 0.0);     // -Infinity
System.out.println(0.0 / 0.0);      // NaN
System.out.println(Double.NaN == Double.NaN); // false
```

NaN tidak equal dengan dirinya sendiri menggunakan `==`.

Gunakan:

```java
Double.isNaN(x)
Float.isNaN(x)
```

### 10.4 `-0.0` Matters

```java
System.out.println(0.0 == -0.0);          // true
System.out.println(1.0 / 0.0);            // Infinity
System.out.println(1.0 / -0.0);           // -Infinity
```

Di banyak business system ini tidak penting. Di numerical computing, hashing, sorting, serialization, dan canonicalization, ini bisa penting.

### 10.5 Jangan Pakai Floating Point untuk Money

Salah:

```java
record Invoice(double amount) {}
```

Lebih aman:

```java
record Money(long minorUnits, Currency currency) {}
```

atau:

```java
BigDecimal amount
```

Tetapi `BigDecimal` pun harus dipakai dengan disiplin:

```java
new BigDecimal("0.1")     // baik
BigDecimal.valueOf(0.1)   // biasanya lebih aman daripada new BigDecimal(0.1)
new BigDecimal(0.1)       // membawa binary floating approximation
```

Memory trade-off:

```text
long minorUnits
  + sangat compact
  + cepat
  + cocok jika scale tetap
  - butuh disiplin currency/scale

BigDecimal
  + decimal semantics
  + scale eksplisit
  - object lebih berat
  - allocation lebih tinggi
  - operasi lebih mahal
```

---

## 11. Primitive Conversion: Widening, Narrowing, Boxing, Unboxing

### 11.1 Widening Primitive Conversion

Contoh:

```java
int i = 10;
long l = i;
double d = l;
```

Widening berarti target type punya range lebih luas secara umum, tetapi tidak selalu menjaga presisi untuk floating target.

Contoh presisi hilang:

```java
int i = 16_777_217; // 2^24 + 1
float f = i;
System.out.println(f); // 1.6777216E7, tidak persis
```

### 11.2 Narrowing Primitive Conversion

Narrowing butuh cast eksplisit.

```java
int i = 300;
byte b = (byte) i;
System.out.println(b); // 44
```

Kenapa 44?

```text
300 decimal = 0x012C
byte mengambil low 8 bits = 0x2C = 44
```

### 11.3 Compile-time Constant Narrowing

Java punya aturan khusus untuk constant expression.

```java
byte b = 100; // valid, karena 100 muat dalam byte
// byte c = 200; // invalid, 200 tidak muat dalam byte
```

Tapi:

```java
int x = 100;
// byte b = x; // invalid, walaupun nilai runtime 100
```

Karena `x` bukan compile-time constant.

### 11.4 Boxing

```java
int x = 10;
Integer y = x; // boxing
```

Compiler menerjemahkan kira-kira menjadi:

```java
Integer y = Integer.valueOf(x);
```

### 11.5 Unboxing

```java
Integer y = 10;
int x = y; // unboxing
```

Kira-kira:

```java
int x = y.intValue();
```

Jika `y == null`, terjadi `NullPointerException`.

```java
Integer maybe = null;
int value = maybe; // NPE
```

### 11.6 Boxing + Widening Trap

Perhatikan:

```java
Long x = 10L; // valid
// Long y = 10; // invalid
```

Karena Java tidak otomatis melakukan widening primitive lalu boxing dalam assignment seperti `int -> long -> Long` untuk kasus ini.

Valid:

```java
Long y = Long.valueOf(10L);
long z = 10;
Long w = z;
```

Mental model:

```text
Autoboxing membantu, tetapi bukan sistem konversi ajaib.
```

---

## 12. Wrapper Object: `Integer`, `Long`, `Boolean`, dan Teman-temannya

### 12.1 Wrapper Class Ada untuk Object Context

Wrapper diperlukan karena:

1. generic collections tidak bisa langsung menyimpan primitive;
2. reflection API sering bekerja dengan object;
3. nullable value kadang dibutuhkan;
4. API lama menerima `Object`;
5. stream object pipeline memakai boxed values.

Contoh:

```java
List<Integer> xs = List.of(1, 2, 3);
```

Tetapi secara memory:

```text
List object
+ backing array of references
+ Integer objects, kecuali sebagian berasal dari cache
```

### 12.2 Wrapper Cache

Java wrapper tertentu memiliki cache untuk nilai kecil.

Umumnya:

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b); // true, biasanya dari cache

Integer c = 128;
Integer d = 128;
System.out.println(c == d); // false, biasanya object berbeda
```

Jangan bergantung pada `==` untuk wrapper numeric.

Gunakan:

```java
Objects.equals(a, b)
a.equals(b)
```

Dengan null safety:

```java
Objects.equals(a, b)
```

### 12.3 Wrapper Footprint

Misalnya `Integer`:

```text
Integer object
+ object header
+ int value
+ padding
```

Dalam banyak konfigurasi HotSpot, `Integer` bisa sekitar 16 bytes, bukan 4 bytes. Ditambah reference dari collection/array.

Perbandingan kasar untuk 1 juta angka:

```text
int[]
  payload: ~4 MB
  plus header/padding

Integer[] with distinct Integer objects
  references: ~4 MB jika compressed oops
  Integer objects: ~16 MB
  total: ~20 MB+ plus header/padding/fragmentation
```

Untuk `ArrayList<Integer>`:

```text
ArrayList object
+ Object[] backing array
+ references
+ Integer objects
```

### 12.4 Autoboxing dalam Loop

Buruk:

```java
long sum = 0;
List<Integer> values = ...;
for (Integer value : values) {
    sum += value;
}
```

Ini melakukan unboxing per element. Unboxing sendiri bukan selalu masalah besar, tetapi pointer chasing dan object layout dapat menurunkan locality.

Lebih compact:

```java
int[] values = ...;
long sum = 0;
for (int value : values) {
    sum += value;
}
```

### 12.5 Stream Primitive vs Boxed Stream

Lebih hemat:

```java
IntStream.range(0, n).sum();
```

Lebih mahal:

```java
Stream.iterate(0, i -> i + 1)
      .limit(n)
      .reduce(0, Integer::sum);
```

Perbedaan utama:

```text
IntStream/LongStream/DoubleStream
  -> primitive-specialized stream

Stream<Integer>/Stream<Long>/Stream<Double>
  -> object stream, boxing/reference overhead
```

---

## 13. Primitive Arrays: Compact, Linear, Cache-Friendly

Primitive arrays adalah salah satu struktur paling penting untuk high-performance Java.

```java
int[] ids = new int[1_000_000];
long[] offsets = new long[1_000_000];
double[] samples = new double[1_000_000];
```

### 13.1 Layout Mental Model

```text
int[]
+ array header
+ length field
+ padding/alignment
+ contiguous int elements
```

Elemen tersimpan berurutan.

```text
ids[0] ids[1] ids[2] ids[3] ...
```

Ini memberi:

1. spatial locality;
2. prefetch-friendly access;
3. lebih sedikit pointer chasing;
4. lebih sedikit object header;
5. lebih sedikit GC work.

### 13.2 Array of Objects vs Object of Arrays

Misal domain point:

```java
record Point(int x, int y) {}
Point[] points = new Point[n];
```

Layout:

```text
Point[] references
  -> Point object {x,y}
  -> Point object {x,y}
  -> Point object {x,y}
```

Alternatif data-oriented:

```java
int[] xs = new int[n];
int[] ys = new int[n];
```

Layout:

```text
xs: x0 x1 x2 x3 ...
ys: y0 y1 y2 y3 ...
```

Trade-off:

```text
Point[]
  + object-oriented, readable
  + cocok untuk domain behavior
  - banyak object
  - pointer chasing
  - GC pressure
  - poor locality

int[] xs, int[] ys
  + compact
  + cache-friendly
  + rendah GC pressure
  - domain model lebih manual
  - invariant harus dijaga antar-array
```

Untuk sistem biasa, jangan prematur mengganti semua object ke primitive arrays. Tetapi untuk hot path, indexing, large dataset, serialization, matching engine, bitmap, graph processing, dan analytics, pola ini sangat penting.

### 13.3 Multidimensional Array Bukan Matrix Compact

```java
int[][] matrix = new int[rows][cols];
```

Ini bukan satu block 2D compact seperti C contiguous matrix. Ini array of arrays.

```text
int[][] root references
  -> int[] row0
  -> int[] row1
  -> int[] row2
```

Jika butuh matrix compact:

```java
int[] matrix = new int[rows * cols];
int value = matrix[row * cols + col];
```

Trade-off:

```text
int[][]
  + sederhana
  + row bisa beda panjang
  - banyak array object
  - locality antar-row lebih buruk

int[] flat
  + compact
  + cache-friendly
  + lebih mudah bulk operation
  - indexing manual
```

---

## 14. Field Layout: Kenapa Urutan Field Bisa Berdampak

Misal:

```java
final class BadLayout {
    boolean a;
    long b;
    boolean c;
    int d;
}
```

Secara naive, engineer mungkin berpikir:

```text
boolean 1 + long 8 + boolean 1 + int 4 = 14 bytes
```

Tetapi object layout harus memperhatikan alignment. JVM juga dapat melakukan field layout optimization, tetapi tidak semua asumsi source order akan persis menjadi memory order.

Mental model field packing:

```text
large fields dan alignment-sensitive fields mempengaruhi padding.
small fields bisa mengisi gap.
object total dibulatkan ke alignment boundary.
```

Contoh desain yang lebih sadar:

```java
final class BetterCandidate {
    long b;
    int d;
    boolean a;
    boolean c;
}
```

Namun, jangan melakukan manual reorder membabi-buta tanpa mengukur dengan JOL, karena HotSpot dapat melakukan layout sendiri tergantung opsi JVM, compressed oops, inheritance, dan versi.

### 14.1 Inheritance dan Layout

Field superclass berada dalam object yang sama dengan subclass, tetapi layout dipengaruhi hierarchy.

```java
class Parent {
    long id;
}

class Child extends Parent {
    boolean active;
    int score;
}
```

Mental model:

```text
Child object contains:
- object header
- Parent fields
- Child fields
- padding
```

Deep inheritance dapat membuat layout kurang ideal dan menambah complexity. Ini bukan alasan utama untuk menghindari inheritance, tetapi dalam memory-sensitive hot object, layout perlu dipahami.

---

## 15. Local Variables: Stack, Register, atau Hilang Sama Sekali?

Primitive local variable sering dibayangkan "ada di stack".

```java
int sum = 0;
for (int i = 0; i < n; i++) {
    sum += i;
}
```

Secara bytecode, local variable berada di local variable array dalam frame. Tetapi saat JIT optimize, nilai bisa:

1. berada di CPU register;
2. di-spill ke stack;
3. di-inline;
4. di-constant-fold;
5. dihapus karena dead code;
6. digabung dengan operasi lain.

Mental model yang lebih akurat:

```text
Local primitive adalah value dalam execution state.
Jangan terlalu literal membayangkan setiap local variable selalu punya address stabil di stack.
```

Ini penting saat benchmarking:

```java
int x = compute();
```

Jika `x` tidak digunakan secara observable, JIT bisa menghapus computation. Maka JMH memakai `Blackhole` atau return value untuk mencegah dead-code elimination.

---

## 16. Primitive Field vs Primitive Local vs Primitive Array

Tipe sama, konteks beda.

```java
int local = 1;
class C { int field; }
int[] array = new int[10];
```

| Konteks | Implikasi |
|---|---|
| local primitive | bisa register/stack/optimized away |
| field primitive | bagian dari object layout, ikut header/padding object |
| array primitive element | contiguous payload, compact |
| wrapper object field | primitive di dalam object wrapper, ada header/padding |
| generic collection | primitive harus boxed kecuali pakai specialized collection |

Kesimpulan:

```text
Pertanyaan "int itu berapa byte?" tidak cukup.
Pertanyaan yang benar:
"int dalam konteks apa? local, field, array, wrapper, buffer, off-heap, atau serialized?"
```

---

## 17. Cache Locality: Primitive Arrays Mengubah Performa Secara Drastis

Misal:

```java
long sum(int[] xs) {
    long s = 0;
    for (int x : xs) s += x;
    return s;
}
```

Access pattern:

```text
linear contiguous memory
```

CPU dapat melakukan prefetch dan membaca cache line dengan efisien.

Bandingkan:

```java
long sum(List<Integer> xs) {
    long s = 0;
    for (Integer x : xs) s += x;
    return s;
}
```

Access pattern:

```text
ArrayList backing Object[]
  read reference
  follow pointer to Integer object
  read int field
  repeat
```

Masalah:

1. extra memory load;
2. pointer chasing;
3. cache miss;
4. branch/null concern;
5. more GC-tracked objects.

### 17.1 GC Cost

`int[]` adalah satu object besar.

`List<Integer>` dengan banyak distinct `Integer` adalah banyak object kecil.

GC marking object graph:

```text
int[]
  mark one array object

Integer list
  mark list
  mark backing array
  scan references
  mark many Integer objects
```

Karena itu, primitive arrays tidak hanya cepat untuk CPU, tetapi juga mengurangi pekerjaan GC.

---

## 18. Memory Footprint Estimation

Top engineer sering bisa membuat estimasi kasar sebelum menjalankan profiler.

### 18.1 Contoh: 10 Juta `int`

```java
int[] values = new int[10_000_000];
```

Payload:

```text
10,000,000 * 4 bytes = 40,000,000 bytes ≈ 38.1 MiB
```

Tambah header/padding sedikit.

### 18.2 Contoh: 10 Juta `Integer`

```java
Integer[] values = new Integer[10_000_000];
```

Jika distinct objects:

```text
references: 10,000,000 * 4 bytes ≈ 38.1 MiB
Integer objects: 10,000,000 * ~16 bytes ≈ 152.6 MiB
Total: ~190 MiB+ plus array/header/fragmentation
```

Jika references 8 byte karena compressed oops tidak aktif:

```text
references: ~76.3 MiB
Integer objects: bisa lebih besar juga tergantung layout
```

### 18.3 Contoh: 10 Juta `boolean`

```java
boolean[] flags = new boolean[10_000_000];
```

Payload praktis HotSpot:

```text
~10 MB, bukan ~1.25 MB
```

Dengan `BitSet`:

```text
10,000,000 bits / 8 = ~1.25 MB payload
plus long[] header/object overhead
```

Trade-off akses:

```java
boolean flag = flags[i];
```

vs:

```java
boolean flag = bitSet.get(i);
```

atau custom:

```java
boolean flag = (words[i >>> 6] & (1L << i)) != 0;
```

---

## 19. Choosing the Right Primitive

### 19.1 General Rule

Gunakan `int` untuk integer biasa kecuali ada alasan jelas.

Gunakan `long` untuk:

1. ID/counter besar;
2. timestamp;
3. byte size;
4. file offset;
5. sequence yang bisa melewati 2^31-1;
6. calculation yang bisa overflow `int`.

Gunakan `byte`/`short` untuk:

1. array besar;
2. binary format;
3. memory-sensitive payload;
4. protocol field;
5. fixed-width external representation.

Gunakan `float` hanya jika:

1. precision cukup;
2. memory bandwidth lebih penting;
3. data sangat besar;
4. domain numeric memang toleran.

Gunakan `double` untuk floating default.

Gunakan `BigDecimal`/`long minorUnits` untuk money.

Gunakan `boolean` untuk logical state, tetapi gunakan bitset jika jumlah flag sangat besar.

### 19.2 Anti-pattern: Terlalu Agresif Pakai Tipe Kecil

Buruk:

```java
class OrderStats {
    short totalItems;
    byte retryCount;
    short status;
}
```

Masalah:

1. operasi arithmetic tetap promote ke `int`;
2. risk overflow tersembunyi;
3. readability turun;
4. memory saving bisa hilang karena padding;
5. future range expansion sulit.

Lebih baik:

```java
class OrderStats {
    int totalItems;
    int retryCount;
    OrderStatus status;
}
```

Kecuali object ini benar-benar ada puluhan juta dan sudah diukur.

### 19.3 Anti-pattern: Terlalu Banyak Wrapper

Buruk:

```java
record MetricPoint(Long timestamp, Double value, Boolean valid) {}
```

Jika field tidak nullable, gunakan primitive:

```java
record MetricPoint(long timestamp, double value, boolean valid) {}
```

Jika perlu nullable, pertimbangkan desain eksplisit:

```java
record MetricPoint(long timestamp, double value, boolean hasValue) {}
```

atau:

```java
OptionalDouble
OptionalLong
```

Tetapi jangan memakai `Optional<T>` sebagai field secara sembarangan untuk hot data model; itu juga object wrapper.

---

## 20. Primitive and Domain Semantics

Primitive hemat, tetapi bisa miskin makna.

```java
long userId;
long tenantId;
long orderId;
```

Semua `long`, tetapi tidak interchangeable secara domain.

Bug potensial:

```java
loadOrder(userId); // compile valid jika signature long, domain salah
```

Solusi object wrapper domain:

```java
record UserId(long value) {}
record OrderId(long value) {}
```

Trade-off:

```text
record wrapper
  + type safety
  + semantic clarity
  - object overhead jika tidak di-inline/optimized
  - allocation risk di collection/generic
```

Untuk API boundary dan domain clarity, wrapper type sering bagus. Untuk hot path jutaan values, primitive array atau specialized representation bisa lebih tepat.

Desain hybrid:

```text
Domain boundary:
  UserId, OrderId, Money

Internal hot storage:
  long[] userIds
  long[] orderIds
  long[] minorUnits
```

Top engineer tidak fanatik primitive atau object. Ia memilih representasi berdasarkan layer.

---

## 21. Primitive in Generics: Mengapa `List<int>` Tidak Ada

Java generics bekerja dengan reference types, bukan primitive.

Tidak valid:

```java
List<int> xs; // compile error
```

Valid:

```java
List<Integer> xs;
```

Konsekuensi:

1. boxing;
2. object overhead;
3. reference indirection;
4. GC pressure;
5. nullability masuk;
6. equality/identity confusion.

Alternatif:

```java
int[]
IntStream
specialized primitive collections library
ByteBuffer / MemorySegment
custom chunked primitive store
```

Project Valhalla sedang mengarah ke value objects/specialization yang dapat mengubah lanskap ini di masa depan, tetapi untuk Java 8–25 production mainstream, generic primitive masih bukan fitur umum stabil untuk `List<int>`.

---

## 22. Primitive and Serialization / Wire Format

Primitive Java semantic tidak otomatis sama dengan wire format.

Contoh:

```java
int x = 42;
```

Saat dikirim ke network/file, perlu keputusan:

1. berapa byte? 4?
2. endian apa?
3. signed atau unsigned?
4. varint atau fixed-width?
5. nullable bagaimana?
6. versioning bagaimana?
7. alignment/padding dalam format?

Contoh binary protocol:

```text
field: status
storage: unsigned 8-bit
Java representation: byte atau int?
```

Sering lebih aman:

```java
int status = Byte.toUnsignedInt(buffer.get());
```

Daripada menyimpan status sebagai signed `byte` dan lupa masking di banyak tempat.

Principle:

```text
Java internal representation boleh berbeda dari wire representation.
Yang penting conversion di boundary eksplisit, teruji, dan terdokumentasi.
```

---

## 23. Primitive and Off-Heap Memory Preview

Saat masuk off-heap/direct buffer/MemorySegment, primitive semantics harus dikaitkan dengan:

1. byte order;
2. alignment;
3. access width;
4. bounds;
5. lifetime;
6. signed/unsigned interpretation;
7. atomicity;
8. memory ordering.

Contoh:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(8);
buffer.putLong(0, 123L);
```

Pertanyaan engineering:

```text
- Byte order default apa?
- Apakah data akan dibaca proses lain?
- Apakah platform lain endian berbeda?
- Apakah access aligned?
- Siapa pemilik lifecycle buffer?
- Apakah concurrent access butuh volatile/acquire/release?
```

Bagian ini belum membahas detail ByteBuffer/MemorySegment, tetapi primitive understanding adalah fondasinya.

---

## 24. Failure Patterns di Produksi

### 24.1 `Integer` di Cache Besar

```java
Map<Long, Integer> counts = new HashMap<>();
```

Untuk jutaan entry:

1. `Long` key boxed;
2. `Integer` value boxed;
3. HashMap node/table overhead;
4. pointer chasing;
5. GC graph besar.

Alternatif:

1. primitive specialized map;
2. long-to-int custom structure;
3. sorted primitive arrays;
4. off-heap map jika benar-benar perlu;
5. database/Redis jika lifecycle harus eksternal.

### 24.2 `Boolean` Nullable Field

```java
Boolean approved;
```

Tiga state:

```text
null
false
true
```

Kadang memang perlu. Tapi sering null hanya karena malas menentukan default.

Lebih eksplisit:

```java
enum ApprovalState {
    UNKNOWN,
    REJECTED,
    APPROVED
}
```

atau:

```java
boolean approved;
boolean approvalKnown;
```

Trade-off semantic clarity vs memory.

### 24.3 `double` untuk Money

Bug financial bisa muncul karena rounding.

```java
double total = 0.1 + 0.2;
```

Gunakan money representation yang sesuai.

### 24.4 `int` Overflow di Size Calculation

```java
int bytes = rows * columns * 8;
```

Jika `rows * columns * 8` overflow, hasil bisa negatif.

Lebih aman:

```java
long bytes = Math.multiplyExact(
    Math.multiplyExact((long) rows, (long) columns),
    8L
);
```

atau minimal:

```java
long bytes = (long) rows * columns * 8L;
```

### 24.5 `byte` Signed Bug pada Protocol

```java
byte status = buffer.get();
if (status == 200) { // impossible jika status byte signed dan 200 disimpan sebagai -56
}
```

Benar:

```java
int status = Byte.toUnsignedInt(buffer.get());
if (status == 200) {
}
```

---

## 25. Practical Design Heuristics

### 25.1 Heuristic 1: Primitive untuk Hot Data, Object untuk Semantics

```text
API/domain boundary:
  clear semantic types

internal hot path:
  primitive arrays / compact representation
```

Contoh:

```java
record CustomerId(long value) {}
```

Tetapi indexing internal:

```java
long[] customerIds;
```

### 25.2 Heuristic 2: Jangan Optimasi Field Kecil Tanpa Mengukur

Mengganti `int` ke `short` dalam object kecil sering tidak signifikan karena padding.

Optimasi lebih berdampak jika:

1. field berada dalam primitive array;
2. jumlah element sangat besar;
3. data sangat hot;
4. footprint mempengaruhi cache;
5. GC pressure terbukti tinggi.

### 25.3 Heuristic 3: Hindari Wrapper di Data Volume Besar

Jika data jutaan element, curigai:

```java
List<Integer>
List<Long>
Map<Long, Integer>
Stream<Integer>
Optional<Integer>[]
```

Bukan berarti selalu salah, tetapi harus sadar biaya.

### 25.4 Heuristic 4: Boundary Conversion Harus Eksplisit

Untuk binary/wire/off-heap:

```text
signedness eksplisit
endianness eksplisit
range check eksplisit
overflow handling eksplisit
```

### 25.5 Heuristic 5: Uang, ID, Timestamp Punya Aturan Khusus

```text
Money      -> long minor units atau BigDecimal dengan scale discipline
ID         -> jangan lewat floating point
Timestamp  -> hati-hati millis/micros/nanos dan overflow
Size bytes -> long, bukan int
```

---

## 26. Mini Case Study: Memory Explosion karena `List<Integer>`

### Situasi

Service membaca 20 juta row ID ke memory untuk filtering.

Naive implementation:

```java
List<Integer> ids = new ArrayList<>();
while (rs.next()) {
    ids.add(rs.getInt("id"));
}
```

### Problem

1. `ArrayList` menyimpan `Object[]`.
2. Setiap ID diboxing menjadi `Integer`, kecuali nilai kecil cache.
3. Banyak object kecil.
4. GC harus scan reference array dan mark object.
5. Cache locality buruk.
6. Heap naik drastis.

### Representasi Lebih Compact

Jika jumlah diketahui:

```java
int[] ids = new int[count];
int i = 0;
while (rs.next()) {
    ids[i++] = rs.getInt("id");
}
```

Jika jumlah tidak diketahui:

```java
final class IntBuilder {
    private int[] array = new int[1024];
    private int size;

    void add(int value) {
        if (size == array.length) {
            array = Arrays.copyOf(array, array.length * 2);
        }
        array[size++] = value;
    }

    int[] toArray() {
        return Arrays.copyOf(array, size);
    }
}
```

### Trade-off

```text
List<Integer>
  + simple
  + collection API rich
  - memory besar
  - boxing
  - GC pressure

int[] / IntBuilder
  + compact
  + cache-friendly
  + low GC
  - API manual
  - resizing logic
```

Top engineer akan memilih berdasarkan data volume dan hotness.

---

## 27. Mini Case Study: `boolean[]` vs `BitSet`

### Situasi

Butuh menandai 100 juta user apakah sudah diproses.

Option A:

```java
boolean[] processed = new boolean[100_000_000];
```

Payload sekitar:

```text
~100 MB
```

Option B:

```java
BitSet processed = new BitSet(100_000_000);
```

Payload bit sekitar:

```text
100,000,000 / 8 = 12.5 MB
```

### Trade-off

`boolean[]`:

1. akses sangat langsung;
2. lebih mudah dimengerti;
3. memory lebih besar.

`BitSet`:

1. jauh lebih hemat;
2. operasi bulk cepat;
3. butuh bit manipulation internal;
4. semantic index harus jelas.

### Decision

Jika flags sangat besar dan memory penting, `BitSet` lebih masuk akal. Jika flags kecil atau readability dominan, `boolean[]` cukup.

---

## 28. Checklist Review Kode

Gunakan checklist ini saat melihat code Java yang memproses banyak data.

### 28.1 Primitive Choice

- Apakah `int` cukup, atau perlu `long`?
- Apakah `short`/`byte` dipakai hanya karena terlihat hemat?
- Apakah ada risiko overflow?
- Apakah ada signed/unsigned mismatch?
- Apakah `float` dipakai untuk data yang butuh precision?
- Apakah `double` dipakai untuk money?

### 28.2 Boxing

- Apakah ada `List<Integer>`/`List<Long>` volume besar?
- Apakah ada `Map<Long, Integer>` hot path?
- Apakah stream memakai boxed stream padahal bisa primitive stream?
- Apakah wrapper dipakai hanya untuk nullable yang sebenarnya bisa dimodelkan eksplisit?

### 28.3 Arrays and Locality

- Apakah data object-heavy bisa diubah ke primitive array di hot path?
- Apakah `int[][]` sebenarnya butuh flat `int[]`?
- Apakah object graph terlalu dalam?
- Apakah scanning linear bisa dibuat contiguous?

### 28.4 Boundary

- Apakah endian eksplisit?
- Apakah unsigned conversion eksplisit?
- Apakah range validated sebelum narrowing?
- Apakah serialization format documented?

---

## 29. Latihan Mental Model

### 29.1 Pertanyaan 1

Apa beda memory footprint antara:

```java
boolean[] a = new boolean[1_000_000];
BitSet b = new BitSet(1_000_000);
```

Jawaban mental:

```text
boolean[] kira-kira 1 byte per flag + header.
BitSet kira-kira 1 bit per flag di long[] + header.
BitSet jauh lebih hemat untuk flag besar.
```

### 29.2 Pertanyaan 2

Kenapa ini compile error?

```java
byte a = 1;
byte b = 2;
byte c = a + b;
```

Jawaban:

```text
byte arithmetic dipromosikan ke int, sehingga hasil a + b adalah int.
Butuh cast eksplisit jika ingin kembali ke byte.
```

### 29.3 Pertanyaan 3

Kenapa `List<Integer>` lebih mahal daripada `int[]`?

Jawaban:

```text
List<Integer> menyimpan references ke Integer objects.
Setiap Integer membawa object header/padding.
Aksesnya pointer chasing.
GC harus melacak banyak object.
int[] menyimpan primitive contiguous dalam satu array object.
```

### 29.4 Pertanyaan 4

Apakah `long -> double` selalu aman?

Jawaban:

```text
Tidak. Range double besar, tetapi precision terbatas.
Tidak semua long bisa direpresentasikan persis sebagai double.
```

### 29.5 Pertanyaan 5

Apakah `char` sama dengan satu karakter manusia?

Jawaban:

```text
Tidak. char adalah UTF-16 code unit.
Satu Unicode code point bisa membutuhkan dua char.
Satu grapheme cluster bisa terdiri dari beberapa code point.
```

---

## 30. Kesimpulan

Primitive Java tampak sederhana, tetapi di level engineering produksi mereka adalah fondasi dari:

1. memory footprint;
2. object layout;
3. array compactness;
4. CPU cache locality;
5. GC pressure;
6. binary correctness;
7. overflow safety;
8. numeric precision;
9. API design;
10. data-oriented optimization.

Ringkasan mental model:

```text
boolean bukan 1 bit public contract.
byte signed, jadi unsigned harus eksplisit.
short jarang berguna kecuali format/array besar.
char adalah UTF-16 code unit, bukan karakter manusia.
int adalah default integral workhorse.
long untuk range besar, ID, timestamp, offset, size.
float/double adalah binary floating point, bukan decimal money.
Wrapper adalah object, bukan primitive gratis.
Primitive array adalah salah satu alat paling kuat untuk compactness dan locality.
```

Prinsip desain:

```text
Gunakan primitive untuk data hot dan besar.
Gunakan object untuk semantic boundary.
Jangan optimasi ukuran field kecil tanpa pengukuran.
Hindari boxing tersembunyi di volume besar.
Eksplisitkan conversion di boundary.
```

---

## 31. Koneksi ke Bagian Berikutnya

Bagian ini membahas primitive sebagai value dan efeknya pada memory. Bagian berikutnya akan masuk ke level object:

```text
Object Layout in HotSpot:
Header, Mark Word, Klass Pointer, Padding
```

Di sana kita akan melihat kenapa object Java memiliki overhead, bagaimana field primitive ditempatkan di object, bagaimana compressed class pointer dan compressed oops bekerja, dan kenapa object kecil bisa jauh lebih mahal daripada yang terlihat dari source code.

---

## 32. Status Seri

```text
Part 002 selesai.
Seri belum selesai.
Masih lanjut ke part 003 sampai part 030.
```


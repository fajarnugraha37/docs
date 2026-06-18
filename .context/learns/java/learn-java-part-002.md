# Learn Java Part 002 — Fondasi Bahasa Java: Dari Syntax ke Semantics

> Target: Java hingga versi 25  
> Audience: software engineer yang ingin naik dari “bisa menulis Java” menjadi “paham bagaimana bahasa Java berpikir”.  
> Fokus: lexical structure, primitive/reference types, variable semantics, expression evaluation, conversion, statement semantics, dan mental model untuk membaca/menulis Java secara presisi.

---

## 0. Posisi Bagian Ini dalam Roadmap

Di **Part 000**, kita membangun gambaran besar Java sebagai bahasa, platform, runtime, ekosistem, dan operational substrate.

Di **Part 001**, kita membahas toolchain: JDK, `javac`, `java`, JAR, classpath, module path, Maven, Gradle, dan cara program Java berubah menjadi artifact yang bisa dijalankan.

Di **Part 002**, kita masuk ke fondasi bahasa Java. Ini adalah lapisan yang sering dianggap “sudah tahu” oleh engineer berpengalaman, padahal banyak bug production lahir dari detail kecil seperti:

- integer overflow;
- implicit numeric promotion;
- autoboxing dan `NullPointerException`;
- perbedaan `==` pada primitive dan reference;
- urutan evaluasi ekspresi;
- short-circuit logic;
- `switch` fall-through legacy;
- `char` bukan Unicode character utuh;
- `String` literal adalah object;
- `null` bukan object;
- casting reference bisa lolos compile tetapi gagal runtime;
- assignment context berbeda dari invocation context;
- local variable tidak punya default value;
- field punya default value;
- `final` pada reference bukan berarti object immutable.

Tujuan bagian ini bukan menghafal syntax, tetapi membangun mental model:

```text
source text
  -> Unicode input
  -> lexical translation
  -> token
  -> grammar
  -> type checking
  -> conversion context
  -> expression evaluation
  -> statement execution
  -> bytecode/runtime behavior
```

Engineer top-tier tidak hanya bertanya:

> “Syntax ini legal atau tidak?”

Tetapi juga:

> “Apa tipe compile-time-nya? Apa nilai runtime-nya? Conversion apa yang terjadi? Side effect mana yang terjadi dulu? Apakah ada overflow? Apakah ada boxing? Apakah ada runtime check? Apakah behavior ini stabil untuk refactoring?”

---

## 1. Sumber Resmi yang Menjadi Basis

Materi ini dirangkum dan dijelaskan ulang berdasarkan sumber resmi berikut:

1. **The Java Language Specification, Java SE 25 Edition**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/index.html`

2. **JLS Chapter 2 — Grammars**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/jls-2.html`

3. **JLS Chapter 3 — Lexical Structure**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/jls-3.html`

4. **JLS Chapter 4 — Types, Values, and Variables**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html`

5. **JLS Chapter 5 — Conversions and Contexts**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html`

6. **JLS Chapter 14 — Blocks, Statements, and Patterns**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html`

7. **JLS Chapter 15 — Expressions**  
   `https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html`

8. **OpenJDK JDK 25 Project Page**  
   `https://openjdk.org/projects/jdk/25/`

9. **JEP 512 — Compact Source Files and Instance Main Methods**  
   `https://openjdk.org/jeps/512`

10. **JDK 25 Documentation Home**  
    `https://docs.oracle.com/en/java/javase/25/`

Catatan penting: JDK 25 adalah reference implementation Java SE 25 dan mencapai General Availability pada 16 September 2025. Dalam bagian ini, fitur Java 25 yang relevan langsung adalah **Compact Source Files and Instance Main Methods**.

---

# 2. Mental Model: Bahasa Java Sebagai Sistem Semantik

Sebelum membahas syntax satu per satu, kita perlu membedakan beberapa level.

## 2.1 Source Text

Source text adalah isi file `.java`.

Contoh:

```java
class App {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
```

Di mata manusia, itu adalah program. Di mata compiler, itu adalah urutan karakter Unicode.

## 2.2 Lexical Translation

Compiler tidak langsung melihat “class”, “App”, “{”, “public”, dan seterusnya sebagai makna bahasa. Compiler terlebih dahulu melakukan lexical translation:

```text
characters -> input elements -> tokens
```

Token Java termasuk:

- identifiers;
- keywords;
- literals;
- separators;
- operators.

Whitespace dan comment umumnya dibuang setelah membantu memisahkan token.

## 2.3 Grammar

Setelah token terbentuk, compiler mengecek apakah urutan token tersebut sesuai grammar Java.

Contoh token:

```text
class Identifier { ... }
```

Baru setelah sesuai grammar, compiler dapat membangun struktur seperti:

```text
CompilationUnit
  -> ClassDeclaration
    -> MethodDeclaration
      -> Block
        -> Statement
```

## 2.4 Type Checking

Java adalah bahasa statically typed dan strongly typed.

Artinya:

1. Setiap variable dan expression punya tipe yang diketahui saat compile-time.
2. Operasi yang boleh dilakukan dibatasi oleh tipe tersebut.
3. Banyak error bisa ditolak sebelum program berjalan.

Contoh:

```java
int x = "hello"; // compile-time error
```

Bukan karena JVM tidak bisa menjalankan, tetapi karena compiler menolak program tersebut.

## 2.5 Conversion Context

Setelah tipe expression diketahui, Java sering melakukan conversion.

Contoh:

```java
int i = 10;
long l = i;
```

Expression `i` bertipe `int`, variable target bertipe `long`. Assignment ini legal karena ada widening primitive conversion dari `int` ke `long`.

Namun:

```java
long l = 10L;
int i = l; // compile-time error
```

Butuh narrowing conversion, dan Java tidak melakukannya secara implicit dalam assignment biasa.

Harus eksplisit:

```java
int i = (int) l;
```

## 2.6 Runtime Evaluation

Setelah program compile, expression dievaluasi pada runtime.

Contoh:

```java
int a = 1;
int b = 2;
int c = a + b;
```

Pada runtime:

1. baca nilai `a`;
2. baca nilai `b`;
3. lakukan operasi addition;
4. simpan hasil ke `c`.

Untuk program sederhana ini sepele. Tetapi untuk expression dengan method call dan side effect, urutan evaluasi sangat penting.

Contoh:

```java
int x = 1;
int y = x++ + ++x;
```

Memahami output tanpa mental model evaluation order akan rawan salah.

---

# 3. Program Java Paling Kecil

## 3.1 Bentuk Tradisional

Sebelum Java 25, bentuk pedagogis yang paling dikenal adalah:

```java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
```

Ini mengandung banyak konsep sekaligus:

- `public`;
- `class`;
- class name sama dengan file name;
- `static`;
- `void`;
- `main`;
- `String[] args`;
- `System.out.println`.

Untuk engineer berpengalaman, ini biasa. Untuk pemula, ini terlalu banyak konsep sebelum bisa mencetak teks.

Namun bagi engineer serius, bentuk ini tetap penting karena inilah bentuk canonical untuk aplikasi biasa.

## 3.2 Kenapa `public static void main(String[] args)`?

Mari pecah satu per satu.

```java
public static void main(String[] args)
```

### `public`

Method dapat diakses dari luar class.

Java launcher perlu bisa menemukan dan memanggil method entry point tersebut.

### `static`

Method milik class, bukan object instance.

Artinya launcher tidak perlu membuat object terlebih dahulu.

```java
HelloWorld.main(args);
```

bisa dipahami sebagai pemanggilan konseptual.

### `void`

Method tidak mengembalikan nilai.

Status keluar program bukan berasal dari return value `main`, melainkan dari:

```java
System.exit(code);
```

atau normal termination.

### `main`

Nama method entry point.

### `String[] args`

Array argument command-line.

Jika menjalankan:

```bash
java HelloWorld one two three
```

Maka:

```java
args[0] == "one"
args[1] == "two"
args[2] == "three"
```

## 3.3 Bentuk Alternatif Entry Point Modern

Dengan Java modern, terutama Java 25, pengalaman menulis program kecil menjadi lebih ringan.

JEP 512 memfinalisasi **Compact Source Files and Instance Main Methods** di JDK 25. Tujuannya bukan membuat “dialek Java baru”, melainkan menyediakan jalur masuk yang lebih sederhana untuk program kecil dan pembelajaran, tetap dengan toolchain Java yang sama.

Contoh instance main method:

```java
class HelloWorld {
    void main() {
        System.out.println("Hello, world!");
    }
}
```

Contoh compact source file:

```java
void main() {
    IO.println("Hello, world!");
}
```

Catatan:

- `IO` berada di `java.lang` pada Java 25.
- `java.lang` di-import secara implicit oleh semua source file.
- Compact source file ditujukan untuk program kecil, script-like, pembelajaran, dan eksperimen.
- Ini tidak menggantikan struktur class normal untuk aplikasi besar.

## 3.4 Mental Model Compact Source File

Compact source file bukan berarti Java tidak punya class.

Lebih tepat:

```text
kamu menulis program ringkas,
compiler tetap menempatkannya dalam struktur yang bisa dipahami platform Java.
```

Contoh:

```java
void main() {
    IO.println("Hello");
}
```

Untuk belajar, ini bagus karena kamu bisa fokus pada statement dan expression.

Namun untuk production backend, kamu tetap akan sering memakai:

```java
package com.example;

public class Application {
    public static void main(String[] args) {
        // bootstrap framework/app
    }
}
```

## 3.5 Kapan Memakai Bentuk Mana?

| Bentuk | Cocok Untuk | Hindari Untuk |
|---|---|---|
| Compact source file | eksperimen, belajar, snippet, CLI kecil | aplikasi besar, library publik, service production besar |
| Instance `main` dalam class | program kecil, teaching, demo | codebase enterprise yang butuh explicit bootstrap convention |
| `public static void main(String[] args)` | aplikasi production, framework bootstrapping, tool standard | program belajar yang ingin minimal ceremony |

## 3.6 Latihan Mental Model

Tulis tiga file berikut dan jalankan dengan JDK 25.

### 3.6.1 Traditional Main

```java
public class A {
    public static void main(String[] args) {
        System.out.println("A");
    }
}
```

### 3.6.2 Instance Main

```java
class B {
    void main() {
        System.out.println("B");
    }
}
```

### 3.6.3 Compact Source File

```java
void main() {
    IO.println("C");
}
```

Pertanyaan:

1. Mana yang paling eksplisit?
2. Mana yang paling ringan untuk belajar?
3. Mana yang paling aman untuk convention tim besar?
4. Apakah compact source file menghilangkan class dari Java?

Jawaban penting: tidak. Compact source file mengurangi ceremony di source, bukan mengubah fondasi platform.

---

# 4. Lexical Structure: Dari Karakter Menjadi Token

## 4.1 Kenapa Lexical Structure Penting?

Banyak engineer melewati bagian ini karena merasa terlalu dasar. Padahal lexical structure menjelaskan banyak hal yang sering menjadi sumber bug atau kebingungan:

- Unicode escape diproses sangat awal;
- `char` adalah UTF-16 code unit, bukan character manusia;
- comment tidak selalu “aman” jika mengandung Unicode escape tertentu;
- identifier Java bisa menggunakan karakter Unicode;
- literal integer punya aturan tipe;
- literal floating-point punya special values;
- string literal dan text block punya escape rules;
- operator dan separator menentukan parsing.

## 4.2 Unicode Input

Program Java ditulis sebagai karakter Unicode.

Artinya source code Java secara konsep bukan hanya ASCII.

Identifier dapat berisi banyak karakter Unicode yang valid sebagai Java identifier.

Contoh legal secara konsep:

```java
int jumlah = 10;
int Δ = 5;
```

Namun convention production biasanya tetap menyarankan identifier ASCII, kecuali domain benar-benar membutuhkan istilah lokal/matematis tertentu.

Alasannya:

- tooling lebih konsisten;
- code review lebih mudah;
- menghindari karakter mirip secara visual;
- menghindari supply-chain/security issue berbasis confusable characters.

## 4.3 Unicode Escape

Java mendukung Unicode escape:

```java
char c = '\u0041'; // 'A'
```

Namun ada detail penting: Unicode escape diproses sebelum tokenization.

Artinya source ini bisa mengejutkan:

```java
// \u000A System.out.println("surprise");
```

`\u000A` adalah line feed. Karena diproses sebelum komentar benar-benar dipahami sebagai komentar, ini bisa mengubah struktur source.

Rule praktis:

> Jangan gunakan Unicode escape dalam comment kecuali benar-benar tahu efek lexical translation-nya.

## 4.4 Input Elements dan Token

Setelah lexical translation, Java membentuk input elements:

- white space;
- comment;
- token.

Token terdiri dari:

- identifier;
- keyword;
- literal;
- separator;
- operator.

Whitespace dan comment biasanya tidak masuk grammar utama setelah tokenization, kecuali berperan sebagai pemisah token.

Contoh:

```java
intx = 1;
```

Ini bukan:

```java
int x = 1;
```

Karena `intx` adalah satu identifier, bukan keyword `int` lalu identifier `x`.

## 4.5 Identifier

Identifier adalah nama untuk:

- class;
- method;
- variable;
- package;
- module;
- label;
- type parameter;
- enum constant;
- record component;
- pattern variable.

Contoh:

```java
int count = 0;
String customerName = "Alice";
class EnforcementCase {}
```

Identifier tidak boleh sama dengan keyword.

```java
int class = 10; // illegal
```

Namun beberapa kata adalah restricted identifier atau contextual keyword tergantung konteks.

Contoh modern Java memiliki kata seperti:

- `var`;
- `yield`;
- `record`;
- `sealed`;
- `permits`;
- `non-sealed`.

Sebagian tidak selalu keyword absolut di semua posisi historis, karena Java menjaga backward compatibility.

## 4.6 Keyword

Keyword adalah token yang punya makna khusus dalam grammar.

Contoh:

```java
class, public, static, void, int, if, else, switch, while, for, return, throw, try, catch, finally
```

Rule praktis:

> Jangan memakai identifier yang tampak seperti keyword modern walaupun di beberapa konteks masih legal. Codebase jangka panjang lebih aman jika menghindari nama ambigu seperti `record`, `yield`, atau `var` untuk identifier biasa.

## 4.7 Literals

Literal adalah representasi nilai langsung di source code.

Jenis literal utama:

- integer literal;
- floating-point literal;
- boolean literal;
- character literal;
- string literal;
- text block;
- null literal.

### 4.7.1 Integer Literal

Contoh:

```java
int decimal = 42;
int hex = 0x2A;
int binary = 0b101010;
int octal = 052;
long big = 42L;
```

Hati-hati dengan octal:

```java
int x = 010; // 8, bukan 10
```

Rule praktis:

> Hindari octal literal kecuali benar-benar diperlukan. Leading zero pada angka sering menimbulkan bug baca manusia.

Underscore bisa dipakai untuk readability:

```java
int million = 1_000_000;
long mask = 0xFF_FF_FF_FFL;
```

### 4.7.2 Floating-Point Literal

Contoh:

```java
double a = 1.0;
double b = 1e3;
float c = 1.0f;
double d = 0x1.0p3; // hexadecimal floating literal
```

Default floating literal adalah `double`.

```java
float x = 1.0;  // compile-time error
float y = 1.0f; // ok
```

### 4.7.3 Boolean Literal

Hanya ada dua:

```java
true
false
```

Java tidak menganggap angka sebagai boolean.

```java
if (1) { } // illegal in Java
```

Ini berbeda dari C/C++.

Benefit-nya: bug akibat accidental integer-as-boolean lebih sedikit.

### 4.7.4 Character Literal

Contoh:

```java
char a = 'A';
char newline = '\n';
char quote = '\'';
char unicode = '\u0041';
```

Detail penting:

```java
char c = '😊'; // illegal atau tidak sesuai ekspektasi, karena emoji butuh surrogate pair
```

`char` adalah 16-bit UTF-16 code unit, bukan “karakter manusia” lengkap.

Untuk Unicode code point di luar Basic Multilingual Plane, gunakan `int` code point dan API seperti:

```java
int codePoint = "😊".codePointAt(0);
```

Ini akan dibahas lebih dalam pada bagian String/Unicode.

### 4.7.5 String Literal

```java
String s = "hello";
```

String literal adalah object `String`.

String bersifat immutable.

String literal juga dapat di-intern oleh JVM.

Implikasi:

```java
String a = "hello";
String b = "hello";
System.out.println(a == b); // biasanya true karena literal intern pool
```

Tetapi jangan gunakan `==` untuk logical equality String.

Gunakan:

```java
a.equals(b)
```

### 4.7.6 Text Block

Text block berguna untuk multi-line string:

```java
String json = """
    {
      "name": "Alice",
      "active": true
    }
    """;
```

Cocok untuk:

- SQL fixture;
- JSON fixture;
- HTML/XML snippet;
- test data;
- documentation template.

Namun untuk production SQL, tetap hati-hati terhadap parameter binding. Text block bukan perlindungan SQL injection.

### 4.7.7 Null Literal

```java
String s = null;
```

`null` adalah literal khusus. Ia bukan object.

Konsekuensi:

```java
null.toString(); // illegal secara syntax? Tidak bisa langsung seperti ini; tapi reference null dipanggil method akan NPE.
```

Contoh runtime NPE:

```java
String s = null;
System.out.println(s.length()); // NullPointerException
```

Mental model:

```text
reference variable dapat berisi reference ke object atau null reference.
null bukan object dan tidak punya method.
```

## 4.8 Separators

Separator adalah token seperti:

```text
( ) { } [ ] ; , . ... @ ::
```

Contoh:

```java
int[] numbers = {1, 2, 3};
System.out.println(numbers[0]);
```

Separator bukan sekadar tanda baca. Ia memengaruhi grammar dan parsing.

## 4.9 Operators

Operator adalah token seperti:

```text
= > < ! ~ ? : -> == >= <= != && || ++ -- + - * / & | ^ % << >> >>> += -= *= /= &= |= ^= %= <<= >>= >>>=
```

Operator punya:

- precedence;
- associativity;
- operand type rules;
- evaluation order;
- conversion rules.

Kesalahan umum: menghafal precedence tetapi lupa evaluation order dan side effect.

Rule praktis:

> Jika expression kompleks butuh ingatan precedence untuk dibaca, pecah menjadi variable sementara.

---

# 5. Primitive Types: Nilai Langsung, Bukan Object

Java memiliki 8 primitive types:

| Type | Ukuran Konseptual | Range / Nilai | Catatan |
|---|---:|---|---|
| `byte` | 8-bit | -128..127 | signed two's complement |
| `short` | 16-bit | -32768..32767 | signed two's complement |
| `int` | 32-bit | -2147483648..2147483647 | default integer arithmetic |
| `long` | 64-bit | -9223372036854775808..9223372036854775807 | suffix `L` |
| `char` | 16-bit | 0..65535 | unsigned UTF-16 code unit |
| `float` | 32-bit | IEEE 754 binary32 | suffix `f` |
| `double` | 64-bit | IEEE 754 binary64 | default floating literal |
| `boolean` | logical | `true`/`false` | tidak numerik |

## 5.1 Primitive Values Tidak Berbagi State

Primitive menyimpan nilai, bukan reference ke object.

```java
int a = 10;
int b = a;
b = 20;

System.out.println(a); // 10
System.out.println(b); // 20
```

Mental model:

```text
a contains 10
b receives copy of 10
changing b does not affect a
```

Ini berbeda dari reference type.

## 5.2 Integral Types

### 5.2.1 `byte`

```java
byte b = 127;
b++; // becomes -128 due to overflow
```

`byte` sering dipakai untuk:

- raw binary data;
- network buffer;
- file buffer;
- crypto data;
- compact storage.

Namun arithmetic pada `byte` tidak menghasilkan `byte` secara default.

```java
byte a = 1;
byte b = 2;
byte c = a + b; // compile-time error
```

Kenapa?

Karena `a + b` dipromosikan menjadi `int`.

Harus:

```java
byte c = (byte) (a + b);
```

atau gunakan `int` untuk arithmetic.

### 5.2.2 `short`

Mirip `byte`, tetapi 16-bit.

Jarang dipakai untuk business logic modern kecuali:

- binary protocol;
- memory-sensitive array;
- interop format;
- file format.

### 5.2.3 `int`

`int` adalah default integer workhorse di Java.

Contoh:

```java
int count = 100;
int total = count * 2;
```

Literal integer tanpa suffix biasanya bertipe `int` jika muat.

```java
var x = 10; // int
```

### 5.2.4 `long`

Gunakan `long` untuk range besar:

```java
long id = 9_000_000_000L;
```

Biasakan pakai `L`, bukan `l`, karena lowercase `l` mudah terbaca seperti `1`.

```java
long bad = 100l;  // legal but ugly
long good = 100L; // preferred
```

### 5.2.5 `char`

`char` adalah unsigned 16-bit integer yang merepresentasikan UTF-16 code unit.

```java
char c = 'A';
System.out.println((int) c); // 65
```

`char` bisa ikut numeric operation:

```java
char c = 'A';
int next = c + 1; // 66
```

Namun jangan menyamakan `char` dengan karakter manusia.

Contoh:

```java
String s = "😊";
System.out.println(s.length()); // 2, karena surrogate pair
System.out.println(s.codePointCount(0, s.length())); // 1
```

## 5.3 Floating-Point Types

### 5.3.1 `float`

`float` adalah 32-bit IEEE 754 binary32.

Gunakan untuk:

- memory-sensitive numeric array;
- graphics;
- ML/vector numeric workload tertentu;
- format eksternal yang memang float32.

Hindari untuk uang.

### 5.3.2 `double`

`double` adalah default floating-point.

```java
double x = 0.1;
```

Namun floating-point binary tidak bisa merepresentasikan semua decimal secara exact.

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004
```

Untuk uang, gunakan:

- `BigDecimal` dengan scale jelas;
- integer minor unit seperti cents/sen;
- domain-specific Money type.

### 5.3.3 NaN dan Infinity

Floating-point punya nilai khusus:

```java
double nan = 0.0 / 0.0;
double inf = 1.0 / 0.0;
```

Perilaku penting:

```java
System.out.println(Double.NaN == Double.NaN); // false
System.out.println(Double.isNaN(Double.NaN)); // true
```

NaN tidak sama dengan dirinya sendiri.

Dalam production, NaN bisa merusak aggregation, sorting, metrics, dan threshold logic jika tidak diperlakukan eksplisit.

## 5.4 `boolean`

`boolean` hanya `true` atau `false`.

Tidak ada conversion otomatis antara boolean dan integer.

```java
int x = 1;
if (x) { } // compile-time error
```

Ini membuat condition lebih eksplisit:

```java
if (x != 0) { }
```

## 5.5 Integer Overflow

Java integer arithmetic pada `int` dan `long` dapat overflow tanpa exception.

```java
int max = Integer.MAX_VALUE;
System.out.println(max + 1); // -2147483648
```

Mental model:

```text
int arithmetic is fixed-width two's complement arithmetic.
overflow wraps around.
```

Untuk operasi yang harus mendeteksi overflow, gunakan:

```java
Math.addExact(a, b);
Math.multiplyExact(a, b);
```

Contoh:

```java
int a = Integer.MAX_VALUE;
int b = 1;
int c = Math.addExact(a, b); // ArithmeticException
```

## 5.6 Division dan Modulo

```java
int a = 7 / 2;    // 3
int b = 7 % 2;    // 1
int c = -7 / 2;   // -3, toward zero
int d = -7 % 2;   // -1
```

Integer division by zero:

```java
int x = 1 / 0; // ArithmeticException
```

Floating division by zero:

```java
double x = 1.0 / 0.0; // Infinity
```

## 5.7 Numeric Promotion

Java melakukan numeric promotion untuk banyak operator numeric.

Contoh:

```java
byte a = 1;
byte b = 2;
var c = a + b; // int
```

Kenapa `int`?

Karena binary numeric promotion mempromosikan operand kecil (`byte`, `short`, `char`) ke `int`.

Urutan umum:

- jika ada `double`, hasil `double`;
- else jika ada `float`, hasil `float`;
- else jika ada `long`, hasil `long`;
- else hasil `int`.

Contoh:

```java
int i = 10;
long l = 20L;
var r = i + l; // long
```

```java
long l = 20L;
float f = 1.5f;
var r = l + f; // float
```

Hati-hati: `long` ke `float` bisa kehilangan presisi.

## 5.8 Primitive Best Practices

Gunakan:

- `int` untuk counter biasa;
- `long` untuk ID numeric, timestamp epoch, count besar;
- `boolean` untuk condition eksplisit;
- `double` untuk scientific/approximate computation;
- `BigDecimal` atau integer minor unit untuk uang;
- `byte[]` untuk binary data;
- `char` hanya jika benar-benar berurusan dengan UTF-16 code unit, bukan Unicode character manusia.

Hindari:

- `float` untuk uang;
- `double` equality langsung untuk business rule;
- `byte/short` arithmetic untuk business logic;
- implicit overflow pada domain kritikal;
- `char` untuk Unicode-aware text processing modern.

---

# 6. Reference Types: Reference ke Object

Reference type mencakup:

- class type;
- interface type;
- array type;
- type variable;
- parameterized type;
- special null type secara konseptual.

## 6.1 Reference Variable Menyimpan Reference

Contoh:

```java
class Box {
    int value;
}

Box a = new Box();
a.value = 10;

Box b = a;
b.value = 20;

System.out.println(a.value); // 20
```

Mental model:

```text
a -> Box object { value = 10 }
b -> same Box object
b.value = 20 mutates same object
```

Assignment reference menyalin reference, bukan object.

## 6.2 Object Identity

Setiap object punya identity.

```java
Object a = new Object();
Object b = new Object();

System.out.println(a == b); // false
```

`==` pada reference membandingkan apakah dua reference menunjuk object yang sama.

```java
Object c = a;
System.out.println(a == c); // true
```

## 6.3 Logical Equality

Logical equality biasanya didefinisikan dengan `equals`.

```java
String a = new String("hello");
String b = new String("hello");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

Rule praktis:

> Untuk value comparison pada object, gunakan `equals`, bukan `==`, kecuali memang ingin identity comparison.

## 6.4 `null`

Reference variable dapat berisi `null`.

```java
String name = null;
```

`null` berarti tidak menunjuk object apapun.

Pemanggilan method pada null reference menghasilkan `NullPointerException`.

```java
name.length(); // NPE
```

Jangan berpikir:

```text
name is an empty String
```

Yang benar:

```text
name is no String object at all
```

## 6.5 Arrays sebagai Object

Array adalah object.

```java
int[] numbers = new int[3];
System.out.println(numbers.length); // 3
```

Default value array mengikuti tipe component:

```java
int[] a = new int[3];       // [0, 0, 0]
String[] s = new String[3]; // [null, null, null]
boolean[] b = new boolean[3]; // [false, false, false]
```

Array punya fixed length.

```java
numbers.length = 10; // illegal, length final-like field
```

## 6.6 Array Covariance

Java array bersifat covariant.

```java
String[] strings = new String[1];
Object[] objects = strings;
objects[0] = 123; // ArrayStoreException at runtime
```

Compile-time legal karena `String[]` subtype dari `Object[]`.

Runtime gagal karena array sebenarnya adalah array String.

Mental model:

```text
array carries runtime component type.
storing incompatible element triggers runtime check.
```

Ini salah satu alasan generic collection Java invariant.

## 6.7 Wrapper Types dan Autoboxing

Setiap primitive punya wrapper:

| Primitive | Wrapper |
|---|---|
| `byte` | `Byte` |
| `short` | `Short` |
| `int` | `Integer` |
| `long` | `Long` |
| `char` | `Character` |
| `float` | `Float` |
| `double` | `Double` |
| `boolean` | `Boolean` |

Autoboxing:

```java
Integer x = 10; // int -> Integer
```

Unboxing:

```java
int y = x; // Integer -> int
```

Bahaya:

```java
Integer x = null;
int y = x; // NullPointerException due to unboxing
```

## 6.8 Wrapper Equality Trap

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b); // often true due to cache

Integer c = 1000;
Integer d = 1000;
System.out.println(c == d); // often false
```

Jangan mengandalkan identity wrapper.

Gunakan:

```java
Objects.equals(a, b)
```

atau unbox jika safe.

## 6.9 Reference Type Best Practices

- Pahami kapan assignment menyalin reference.
- Gunakan immutable object untuk value semantics.
- Jangan pakai `==` untuk logical equality object.
- Hindari nullable reference tanpa kontrak jelas.
- Jangan autounbox value yang mungkin null.
- Hati-hati array covariance.
- Defensive copy untuk mutable array/list di API boundary.

---

# 7. Variables: Nama, Storage, Scope, Lifetime

Variable adalah storage location bernama atau komponen bernama/terindeks yang menyimpan value.

Dalam Java, value bisa primitive value atau reference value.

## 7.1 Jenis Variable

JLS membedakan beberapa jenis variable, termasuk:

- local variable;
- method parameter;
- constructor parameter;
- lambda parameter;
- exception parameter;
- instance field;
- static field;
- array component;
- pattern variable.

Kita bahas yang paling penting untuk fondasi.

## 7.2 Local Variable

Local variable dideklarasikan di block/method.

```java
void process() {
    int count = 0;
    count++;
}
```

Local variable tidak punya default value.

```java
void process() {
    int x;
    System.out.println(x); // compile-time error
}
```

Kenapa?

Karena Java memakai definite assignment rule. Compiler harus bisa membuktikan local variable sudah diinisialisasi sebelum dibaca.

Contoh:

```java
void process(boolean flag) {
    int x;
    if (flag) {
        x = 1;
    }
    System.out.println(x); // compile-time error
}
```

Karena jika `flag == false`, `x` belum punya nilai.

Solusi:

```java
void process(boolean flag) {
    int x;
    if (flag) {
        x = 1;
    } else {
        x = 0;
    }
    System.out.println(x);
}
```

## 7.3 Field

Field adalah variable yang menjadi member class.

```java
class Counter {
    int value;
    static int globalCount;
}
```

Instance field punya default value.

```java
class User {
    int age;       // default 0
    boolean active; // default false
    String name;  // default null
}
```

Default value sering membantu, tetapi juga bisa menyembunyikan bug domain.

Contoh:

```java
class Payment {
    long amount; // default 0, tetapi apakah 0 amount valid?
}
```

Untuk domain penting, lebih baik paksa invariant lewat constructor/factory.

## 7.4 Static Field

Static field milik class, bukan instance.

```java
class Metrics {
    static long totalRequests;
}
```

Semua instance berbagi static field yang sama.

Bahaya:

- shared mutable state;
- thread-safety issue;
- test pollution;
- hidden dependency;
- lifecycle sulit;
- classloader leak.

Rule praktis:

> Static field aman untuk constant immutable; hati-hati untuk mutable global state.

## 7.5 Parameter

Parameter adalah variable yang menerima argument saat method dipanggil.

```java
void greet(String name) {
    System.out.println("Hello " + name);
}
```

Java pass-by-value. Selalu.

Namun value yang dikirim bisa primitive value atau reference value.

### 7.5.1 Primitive Parameter

```java
void increment(int x) {
    x++;
}

int a = 10;
increment(a);
System.out.println(a); // 10
```

Nilai `10` disalin ke parameter `x`.

### 7.5.2 Reference Parameter

```java
class Box {
    int value;
}

void change(Box box) {
    box.value = 99;
}

Box b = new Box();
b.value = 10;
change(b);
System.out.println(b.value); // 99
```

Reference disalin. Copy reference tetap menunjuk object yang sama.

Namun reassign parameter tidak mengubah variable caller:

```java
void replace(Box box) {
    box = new Box();
    box.value = 99;
}

Box b = new Box();
b.value = 10;
replace(b);
System.out.println(b.value); // 10
```

Mental model:

```text
Java passes value.
For objects, the value is a reference.
```

Bukan “pass by reference”.

## 7.6 `final` Variable

`final` berarti variable tidak bisa di-assign ulang setelah initialized.

```java
final int x = 10;
x = 20; // compile-time error
```

Untuk reference:

```java
final List<String> names = new ArrayList<>();
names.add("Alice"); // allowed
names = new ArrayList<>(); // compile-time error
```

`final` pada reference membuat reference tidak bisa diganti, bukan object-nya immutable.

Mental model:

```text
final reference = stable pointer
not necessarily immutable object
```

## 7.7 Effectively Final

Local variable yang tidak dideklarasikan `final`, tetapi tidak pernah diassign ulang, disebut effectively final.

```java
String prefix = "Hello";
Runnable r = () -> System.out.println(prefix);
```

Legal karena `prefix` effectively final.

Tidak legal:

```java
String prefix = "Hello";
prefix = "Hi";
Runnable r = () -> System.out.println(prefix); // compile-time error
```

Ini penting untuk lambda dan anonymous class.

## 7.8 Scope

Scope menentukan area source code tempat nama variable bisa digunakan.

```java
void method() {
    int x = 1;
    {
        int y = 2;
        System.out.println(x + y);
    }
    System.out.println(y); // compile-time error
}
```

Scope bukan lifetime runtime semata. Scope adalah aturan nama di source code.

## 7.9 Shadowing

Variable inner scope bisa menutupi nama outer tertentu.

```java
class User {
    String name;

    User(String name) {
        this.name = name;
    }
}
```

Parameter `name` men-shadow field `name`. `this.name` mengacu ke field.

Shadowing terlalu banyak membuat code sulit dibaca.

Rule praktis:

- Shadowing field dengan constructor parameter umum dan acceptable.
- Shadowing local variable di block nested sebaiknya dihindari.
- Jangan pakai nama yang sama untuk konsep berbeda.

## 7.10 Variable Best Practices

- Inisialisasi local variable sedekat mungkin dengan pemakaian.
- Pakai `final` atau effectively final untuk nilai yang tidak berubah.
- Jangan andalkan default field untuk domain invariant.
- Bedakan “unknown”, “not applicable”, “empty”, dan “zero”.
- Hindari static mutable state.
- Hindari variable reuse untuk makna berbeda.

---

# 8. Expressions: Nilai, Side Effect, dan Evaluation Order

Expression adalah konstruksi bahasa yang dievaluasi untuk menghasilkan value, side effect, atau keduanya.

Contoh expression:

```java
1 + 2
name.length()
x++
new User("Alice")
condition ? a : b
(String) value
```

## 8.1 Expression Punya Compile-Time Type

```java
int x = 1 + 2;
```

Expression `1 + 2` bertipe `int`.

```java
long y = 1 + 2L;
```

Expression `1 + 2L` bertipe `long`.

```java
String s = "count=" + 10;
```

Expression bertipe `String` karena string concatenation.

## 8.2 Statement Expression

Tidak semua expression boleh berdiri sebagai statement.

Legal:

```java
x++;
foo();
x = 10;
new User();
```

Tidak legal:

```java
1 + 2; // not a valid statement expression
```

Kenapa? Karena hasilnya dibuang dan tidak ada side effect bermakna.

## 8.3 Evaluation Order: Left-to-Right

Java menentukan evaluation order lebih jelas dibanding beberapa bahasa lain.

Operand dievaluasi dari kiri ke kanan.

Contoh:

```java
int x = 1;
int y = x++ + x++;
System.out.println(y); // 3
System.out.println(x); // 3
```

Langkah:

```text
x++ pertama menghasilkan 1, lalu x menjadi 2
x++ kedua menghasilkan 2, lalu x menjadi 3
sum = 1 + 2 = 3
```

Contoh lain:

```java
int x = 1;
int y = x++ + ++x;
```

Langkah:

```text
x++ menghasilkan 1, x menjadi 2
++x membuat x menjadi 3, menghasilkan 3
y = 1 + 3 = 4
```

Meskipun legal, jangan tulis code seperti ini di production.

Rule praktis:

> Jika correctness bergantung pada urutan side effect dalam satu expression, pecah expression tersebut.

## 8.4 Assignment Expression

Assignment adalah expression juga.

```java
int x;
int y = (x = 10);
System.out.println(y); // 10
```

Namun assignment sebagai expression sering membuat code kurang jelas.

Acceptable dalam pattern tertentu:

```java
String line;
while ((line = reader.readLine()) != null) {
    process(line);
}
```

Namun untuk business logic, hindari assignment tersembunyi di dalam condition panjang.

## 8.5 Compound Assignment

```java
int x = 1;
x += 2; // x = x + 2
```

Tapi compound assignment melakukan implicit cast ke tipe kiri.

Contoh:

```java
byte b = 1;
b = b + 1;  // compile-time error
b += 1;     // ok, equivalent to b = (byte)(b + 1)
```

Ini bisa menyebabkan overflow diam-diam:

```java
byte b = 127;
b += 1;
System.out.println(b); // -128
```

## 8.6 Pre-increment dan Post-increment

```java
int x = 1;
int a = ++x; // x becomes 2, a = 2
int b = x++; // b = 2, x becomes 3
```

Gunakan `++`/`--` sebagai statement mandiri jika memungkinkan:

```java
count++;
```

Hindari:

```java
arr[i++] = i + ++i;
```

Itu legal-ish dalam beberapa variasi, tetapi buruk untuk maintenance.

## 8.7 Arithmetic Operators

```java
+ - * / %
```

Perhatikan:

```java
int a = 5 / 2;      // 2
double b = 5 / 2;   // 2.0, because integer division first
double c = 5 / 2.0; // 2.5
```

Bug umum:

```java
double ratio = success / total;
```

Jika `success` dan `total` adalah `int`, hasil division integer.

Benar:

```java
double ratio = (double) success / total;
```

## 8.8 String Concatenation

Operator `+` juga digunakan untuk String.

```java
String s = "count=" + 10;
```

Evaluation left-to-right penting:

```java
System.out.println("sum=" + 1 + 2); // sum=12
System.out.println(1 + 2 + "=sum"); // 3=sum
```

Karena:

```text
"sum=" + 1 -> "sum=1"
"sum=1" + 2 -> "sum=12"
```

Gunakan parentheses jika perlu:

```java
System.out.println("sum=" + (1 + 2)); // sum=3
```

## 8.9 Relational dan Equality Operators

Relational:

```java
< <= > >=
```

Equality:

```java
== !=
```

Untuk primitive:

```java
int a = 1;
int b = 1;
System.out.println(a == b); // true
```

Untuk reference:

```java
String a = new String("x");
String b = new String("x");
System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

Untuk floating-point:

```java
System.out.println(Double.NaN == Double.NaN); // false
System.out.println(0.0 == -0.0);              // true
```

Namun `Double.compare` memperlakukan beberapa edge case secara spesifik untuk ordering.

## 8.10 Logical Operators

Short-circuit operators:

```java
&&
||
```

Non-short-circuit boolean operators:

```java
&
|
^
```

Contoh short-circuit:

```java
if (user != null && user.isActive()) {
    // safe
}
```

Jika `user == null`, operand kanan tidak dievaluasi.

Bahaya jika salah pakai `&`:

```java
if (user != null & user.isActive()) {
    // NPE if user is null
}
```

Karena `&` mengevaluasi kedua sisi.

## 8.11 Bitwise Operators

```java
& | ^ ~ << >> >>>
```

Digunakan untuk:

- flags;
- masks;
- binary protocol;
- compression;
- crypto internals;
- low-level performance code.

Contoh:

```java
int READ = 1 << 0;   // 0001
int WRITE = 1 << 1;  // 0010
int EXEC = 1 << 2;   // 0100

int permission = READ | WRITE;
boolean canRead = (permission & READ) != 0;
```

Hati-hati:

- gunakan parentheses;
- dokumentasikan bit position;
- pertimbangkan `EnumSet` untuk readability domain-level.

## 8.12 Shift Operators

```java
<<  // left shift
>>  // signed right shift
>>> // unsigned right shift
```

Contoh:

```java
int x = -8;
System.out.println(x >> 1);  // keeps sign
System.out.println(x >>> 1); // fills zero
```

`>>>` penting untuk bit-level operation pada signed integer.

## 8.13 Conditional Operator `?:`

```java
String label = active ? "ACTIVE" : "INACTIVE";
```

Conditional operator adalah expression.

Cocok untuk simple value selection.

Hindari untuk logic bercabang kompleks:

```java
var result = a ? b ? c : d : e ? f : g; // buruk
```

## 8.14 Method Invocation Expression

```java
user.activate(clock.now());
```

Evaluation order:

1. evaluate target `user`;
2. evaluate arguments left-to-right;
3. select method at compile-time/runtime sesuai overload/dispatch;
4. invoke.

Argument evaluation terjadi sebelum method body dijalankan.

Contoh:

```java
foo(a(), b(), c());
```

`a()` dievaluasi sebelum `b()`, `b()` sebelum `c()`.

Jika `b()` throw exception, `c()` tidak dievaluasi dan `foo` tidak dipanggil.

## 8.15 Object Creation Expression

```java
User user = new User("Alice");
```

Secara konseptual:

1. allocate object;
2. initialize fields default;
3. run superclass initialization;
4. run field initializers/initializer blocks;
5. run constructor body;
6. return reference.

Detail constructor akan dibahas di Part 003.

## 8.16 Cast Expression

```java
Object value = "hello";
String s = (String) value;
```

Reference cast bisa gagal runtime:

```java
Object value = 123;
String s = (String) value; // ClassCastException
```

Primitive cast bisa kehilangan informasi:

```java
int x = (int) 12.9; // 12
byte b = (byte) 255; // -1
```

## 8.17 `instanceof`

```java
if (value instanceof String s) {
    System.out.println(s.length());
}
```

Pattern matching untuk `instanceof` mengikat variable `s` jika test sukses.

Mental model:

```text
if value is a String, introduce pattern variable s of type String in true branch.
```

Java modern membuat type-test-and-cast lebih aman dan ringkas.

## 8.18 Switch Expression

Switch bisa menjadi statement atau expression.

Expression:

```java
String label = switch (status) {
    case 0 -> "NEW";
    case 1 -> "ACTIVE";
    case 2 -> "CLOSED";
    default -> "UNKNOWN";
};
```

Keunggulan:

- exhaustive reasoning lebih baik;
- tidak ada accidental fall-through dengan arrow form;
- cocok untuk mapping value.

Switch modern akan dibahas lebih dalam di Part 005.

## 8.19 Lambda Expression

```java
Runnable r = () -> System.out.println("run");
```

Lambda adalah expression yang membutuhkan target type berupa functional interface.

```java
Function<String, Integer> length = s -> s.length();
```

Lambda tidak bisa dipahami tanpa target type.

```java
var f = s -> s.length(); // illegal, target type unknown
```

Ini contoh poly expression: tipe expression dipengaruhi konteks.

## 8.20 Expression Best Practices

- Pecah expression jika mengandung banyak side effect.
- Jangan mengandalkan boxing/unboxing implicit dalam domain kritikal.
- Gunakan parentheses untuk intent, bukan hanya untuk compiler.
- Hindari nested ternary yang sulit dibaca.
- Jangan pakai `==` untuk logical equality object.
- Hati-hati integer division.
- Hati-hati compound assignment pada tipe kecil.
- Jadikan conversion eksplisit jika kehilangan data mungkin terjadi.

---

# 9. Conversions and Contexts: Mesin Tersembunyi di Balik “Kok Bisa Compile?”

Conversion adalah alasan kenapa kode ini legal:

```java
int i = 10;
long l = i;
```

Dan ini tidak legal:

```java
long l = 10L;
int i = l;
```

Java tidak hanya punya “cast”. Java punya banyak jenis conversion.

## 9.1 Jenis Conversion Penting

- identity conversion;
- widening primitive conversion;
- narrowing primitive conversion;
- widening reference conversion;
- narrowing reference conversion;
- boxing conversion;
- unboxing conversion;
- unchecked conversion;
- capture conversion;
- string conversion.

## 9.2 Identity Conversion

Tipe ke tipe yang sama.

```java
int x = 1;
int y = x;
```

Sepele, tapi penting secara formal.

## 9.3 Widening Primitive Conversion

Contoh:

```java
byte -> short -> int -> long -> float -> double
char -> int -> long -> float -> double
```

Namun jangan berpikir semua widening preserve precision.

```java
int big = 1_234_567_890;
float approx = big;
System.out.println(big - (int) approx); // bisa tidak 0
```

`int` ke `float` disebut widening, tetapi bisa kehilangan precision.

Widening tidak berarti “selalu exact”. Widening berarti range/magnitude representable secara umum, bukan semua bit presisi terjaga.

## 9.4 Narrowing Primitive Conversion

Contoh:

```java
long -> int
int -> byte
double -> int
```

Harus explicit cast dalam banyak konteks:

```java
long l = 100L;
int i = (int) l;
```

Bisa kehilangan data:

```java
int x = 255;
byte b = (byte) x;
System.out.println(b); // -1
```

Floating ke integer:

```java
int x = (int) 12.9; // 12, toward zero
```

NaN ke integer:

```java
int x = (int) Double.NaN; // 0
```

## 9.5 Widening Reference Conversion

Subclass ke superclass/interface.

```java
String s = "hello";
Object o = s;
CharSequence cs = s;
```

Tidak butuh runtime check khusus karena aman secara tipe.

## 9.6 Narrowing Reference Conversion

Superclass/interface ke subtype.

```java
Object o = "hello";
String s = (String) o;
```

Bisa gagal runtime:

```java
Object o = 123;
String s = (String) o; // ClassCastException
```

## 9.7 Boxing dan Unboxing

Boxing:

```java
Integer x = 10;
```

Unboxing:

```java
int y = x;
```

Bahaya null:

```java
Integer x = null;
int y = x; // NPE
```

Bahaya performance:

```java
Long sum = 0L;
for (long i = 0; i < 1_000_000; i++) {
    sum += i; // repeated boxing/unboxing
}
```

Lebih baik:

```java
long sum = 0L;
```

## 9.8 String Conversion

Dalam string concatenation, banyak value dikonversi ke String.

```java
String s = "value=" + 123;
```

Jika reference null:

```java
String s = "value=" + null; // "value=null"
```

Berbeda dari:

```java
Object o = null;
o.toString(); // NPE
```

## 9.9 Assignment Context

Assignment context terjadi saat value dimasukkan ke variable.

```java
long l = 10; // int literal to long
```

Constant narrowing tertentu bisa legal:

```java
byte b = 100; // ok, constant int fits byte
```

Tetapi:

```java
int x = 100;
byte b = x; // error, not a constant expression in assignment context
```

## 9.10 Invocation Context

Invocation context terjadi saat argument dikirim ke parameter method/constructor.

```java
void f(long x) {}
f(10); // int -> long
```

Overload resolution membuat ini semakin penting.

```java
void f(long x) { System.out.println("long"); }
void f(Integer x) { System.out.println("Integer"); }

f(10); // memilih widening ke long dibanding boxing? perlu paham overload rules
```

Detail overload akan dibahas di bagian method/class. Untuk sekarang, pahami bahwa conversion memengaruhi method mana yang dipilih.

## 9.11 Casting Context

Casting context lebih permisif, tetapi bisa menunda kegagalan ke runtime.

```java
Object o = getValue();
String s = (String) o;
```

Cast harus dianggap sebagai boundary:

> “Saya sebagai programmer menyatakan tahu lebih banyak dari compiler.”

Karena itu cast harus jarang, lokal, dan defensif.

## 9.12 Numeric Context

Numeric operators melakukan numeric promotion.

```java
short a = 1;
short b = 2;
var c = a + b; // int
```

Ini bukan detail kecil. Ini memengaruhi:

- overload resolution;
- overflow;
- memory;
- precision;
- API behavior.

## 9.13 Conversion Best Practices

- Buat narrowing explicit dan beri nama variable yang menjelaskan risiko.
- Jangan abaikan warning unchecked conversion.
- Hindari raw type.
- Jangan pakai cast untuk “memaksa design buruk”.
- Validasi range sebelum narrowing pada domain kritikal.
- Hati-hati autoboxing di hot path.
- Hati-hati unboxing dari nullable wrapper.

---

# 10. Statements: Mengontrol Eksekusi

Statement adalah unit eksekusi yang mengatur alur program.

Contoh:

```java
if (condition) { ... }
while (condition) { ... }
return value;
throw exception;
```

## 10.1 Block

Block adalah urutan statement/declaration dalam `{}`.

```java
{
    int x = 1;
    System.out.println(x);
}
```

Block membentuk scope.

```java
{
    int x = 1;
}
System.out.println(x); // error
```

## 10.2 Empty Statement

```java
;
```

Legal, tetapi sering menjadi bug.

Contoh buruk:

```java
if (isReady()); {
    execute();
}
```

Karena `;` menutup `if`. Block setelahnya selalu dieksekusi.

Rule praktis:

> Jangan letakkan semicolon setelah `if`, `while`, atau `for` kecuali benar-benar intentional dan dikomentari.

## 10.3 Expression Statement

Expression tertentu boleh menjadi statement:

- assignment;
- pre/post increment/decrement;
- method invocation;
- object creation.

Contoh:

```java
count++;
user.activate();
new Thread(task).start();
```

## 10.4 `if` Statement

```java
if (condition) {
    doA();
} else {
    doB();
}
```

Condition harus boolean.

```java
if (1) {} // illegal
```

### 10.4.1 Dangling Else

```java
if (a)
    if (b)
        doB();
    else
        doElse();
```

`else` terikat ke `if (b)`, bukan `if (a)`.

Gunakan braces selalu:

```java
if (a) {
    if (b) {
        doB();
    } else {
        doElse();
    }
}
```

Rule tim production:

> Always use braces for `if`, `else`, `for`, `while`, even for one-line body.

## 10.5 `while`

```java
while (condition) {
    work();
}
```

Condition dicek sebelum body.

Jika condition awal false, body tidak jalan.

## 10.6 `do-while`

```java
do {
    work();
} while (condition);
```

Body jalan minimal sekali.

Cocok untuk:

- retry loop yang harus mencoba sekali;
- input loop;
- protocol read loop tertentu.

Namun jarang dipakai di backend business logic.

## 10.7 `for`

```java
for (int i = 0; i < 10; i++) {
    System.out.println(i);
}
```

Struktur:

```text
initialization -> condition -> body -> update -> condition -> ...
```

Hati-hati off-by-one:

```java
for (int i = 0; i <= list.size(); i++) { // likely bug
    list.get(i);
}
```

Index terakhir valid adalah `size() - 1`.

## 10.8 Enhanced `for`

```java
for (String name : names) {
    System.out.println(name);
}
```

Cocok untuk iteration tanpa perlu index.

Namun jika perlu:

- index;
- remove aman;
- modify list structure;
- parallel control;

pakai loop lain atau iterator eksplisit.

Contoh remove aman:

```java
Iterator<String> it = names.iterator();
while (it.hasNext()) {
    if (it.next().isBlank()) {
        it.remove();
    }
}
```

## 10.9 `break` dan `continue`

```java
while (true) {
    if (done()) {
        break;
    }
    if (skip()) {
        continue;
    }
    work();
}
```

`break` keluar dari loop/switch.

`continue` lanjut ke iterasi berikutnya.

Gunakan dengan hati-hati. Terlalu banyak `break/continue` bisa membuat flow sulit dilacak.

## 10.10 Labeled Statement

Java punya label:

```java
outer:
for (int i = 0; i < 10; i++) {
    for (int j = 0; j < 10; j++) {
        if (found(i, j)) {
            break outer;
        }
    }
}
```

Ini bisa berguna untuk nested loop, tetapi jangan sering dipakai dalam business logic besar.

Alternatif:

- extract method;
- return early;
- gunakan data structure/query lebih tepat.

## 10.11 `switch` Statement Legacy

```java
switch (status) {
    case 0:
        System.out.println("NEW");
        break;
    case 1:
        System.out.println("ACTIVE");
        break;
    default:
        System.out.println("UNKNOWN");
}
```

Tanpa `break`, terjadi fall-through.

```java
switch (status) {
    case 0:
        System.out.println("NEW");
    case 1:
        System.out.println("ACTIVE");
}
```

Jika `status == 0`, dua print bisa terjadi.

Fall-through kadang intentional, tapi harus eksplisit diberi komentar.

## 10.12 Modern Switch Arrow

```java
switch (status) {
    case 0 -> System.out.println("NEW");
    case 1 -> System.out.println("ACTIVE");
    default -> System.out.println("UNKNOWN");
}
```

Lebih aman karena tidak fall-through.

Untuk mapping, gunakan switch expression:

```java
String label = switch (status) {
    case 0 -> "NEW";
    case 1 -> "ACTIVE";
    default -> "UNKNOWN";
};
```

## 10.13 `return`

```java
return value;
```

Mengakhiri method dan mengembalikan value jika method non-void.

Void method:

```java
return;
```

Early return sering membuat code lebih sederhana:

```java
if (user == null) {
    return;
}
if (!user.isActive()) {
    return;
}
process(user);
```

Dibanding nested:

```java
if (user != null) {
    if (user.isActive()) {
        process(user);
    }
}
```

## 10.14 `throw`

```java
throw new IllegalArgumentException("invalid amount");
```

`throw` mengalihkan control flow ke exception handling.

Gunakan exception untuk exceptional condition, bukan normal branching hot path.

Namun di enterprise backend, exception sering tepat untuk:

- invalid programming state;
- invariant violation;
- infrastructure failure;
- rejected operation dengan boundary mapping yang jelas.

Nanti error handling dibahas khusus.

## 10.15 `try-catch-finally`

```java
try {
    work();
} catch (IOException e) {
    handle(e);
} finally {
    cleanup();
}
```

`finally` dieksekusi baik sukses maupun exception, kecuali kondisi ekstrem seperti JVM halt.

Namun untuk resource, gunakan try-with-resources.

## 10.16 Try-With-Resources

```java
try (BufferedReader reader = Files.newBufferedReader(path)) {
    return reader.readLine();
}
```

Resource yang implement `AutoCloseable` akan ditutup otomatis.

Jika exception terjadi saat body dan saat close, close exception menjadi suppressed exception.

Ini penting untuk debugging.

## 10.17 `synchronized` Statement

```java
synchronized (lock) {
    criticalSection();
}
```

Mengambil monitor lock object.

Fondasi concurrency akan dibahas khusus di bagian berikutnya, tetapi dari sisi statement:

- expression lock dievaluasi;
- jika null, NPE;
- thread acquire monitor;
- jalankan block;
- release monitor saat keluar normal atau exception.

## 10.18 Local Class Declaration

```java
void method() {
    class LocalHelper {
        void run() {}
    }
    new LocalHelper().run();
}
```

Jarang dipakai di code modern. Lambda dan private helper method sering lebih baik.

## 10.19 Statement Best Practices

- Pakai braces selalu.
- Hindari empty statement tidak sengaja.
- Gunakan guard clause untuk mengurangi nesting.
- Gunakan modern switch arrow/expression jika cocok.
- Jangan gunakan exception sebagai loop control normal.
- Gunakan try-with-resources untuk resource.
- Extract method jika control flow sulit dibaca.
- Hindari labeled break kecuali nested loop sederhana.

---

# 11. Putting It Together: Membaca Program Secara Semantik

Sekarang kita baca program kecil dengan mental model lengkap.

```java
class Demo {
    static int counter;

    public static void main(String[] args) {
        int a = 1;
        int b = 2;
        String result = "sum=" + a + b;
        System.out.println(result);

        Integer boxed = null;
        if (boxed != null && boxed > 0) {
            counter += boxed;
        }
    }
}
```

## 11.1 Analisis Lexical

Token penting:

- `class` keyword;
- `Demo` identifier;
- `static` keyword;
- `int` keyword;
- `counter` identifier;
- string literal `"sum="`;
- operators `=`, `+`, `&&`, `>`;
- separators `{`, `}`, `(`, `)`, `;`.

## 11.2 Analisis Type

```java
static int counter;
```

Static field `counter` bertipe `int`, default value `0`.

```java
int a = 1;
int b = 2;
```

Local variable `a` dan `b` bertipe `int`.

```java
String result = "sum=" + a + b;
```

Karena evaluation left-to-right:

```text
"sum=" + a -> "sum=1"
"sum=1" + b -> "sum=12"
```

Bukan `sum=3`.

```java
Integer boxed = null;
```

Reference variable `boxed` bertipe `Integer`, value null.

```java
boxed != null && boxed > 0
```

Karena `&&` short-circuit, jika `boxed != null` false, `boxed > 0` tidak dievaluasi.

Ini mencegah NPE dari unboxing.

Jika memakai `&`:

```java
boxed != null & boxed > 0
```

Maka `boxed > 0` dievaluasi dan unboxing null menyebabkan NPE.

## 11.3 Analisis Runtime Output

Output:

```text
sum=12
```

`counter` tetap 0.

## 11.4 Refactoring yang Memperjelas Intent

Jika intent adalah menjumlahkan dulu:

```java
String result = "sum=" + (a + b);
```

Jika intent adalah string append, original sudah benar tetapi sebaiknya jelas dari nama:

```java
String concatenated = "sum=" + a + b;
```

---

# 12. Common Bug Patterns dari Bagian Ini

## 12.1 Integer Division Bug

```java
double progress = completed / total;
```

Jika `completed` dan `total` int, hasil integer division.

Solusi:

```java
double progress = (double) completed / total;
```

## 12.2 Overflow Bug

```java
int millis = seconds * 1000;
```

Jika `seconds` besar, overflow.

Solusi:

```java
long millis = Math.multiplyExact((long) seconds, 1000L);
```

## 12.3 String Equality Bug

```java
if (status == "ACTIVE") { }
```

Solusi:

```java
if ("ACTIVE".equals(status)) { }
```

atau enum:

```java
enum Status { ACTIVE, INACTIVE }
```

## 12.4 Null Unboxing Bug

```java
Boolean enabled = getEnabled();
if (enabled) { }
```

Jika `enabled == null`, NPE.

Solusi tergantung domain:

```java
if (Boolean.TRUE.equals(enabled)) { }
```

atau hilangkan nullable:

```java
boolean enabled = getEnabledOrDefault();
```

## 12.5 Compound Assignment Narrowing Bug

```java
byte b = 127;
b += 1; // -128
```

Solusi: gunakan `int` kecuali benar-benar butuh byte.

## 12.6 Accidental Fall-through

```java
switch (type) {
    case "A": processA();
    case "B": processB();
}
```

Solusi:

```java
switch (type) {
    case "A" -> processA();
    case "B" -> processB();
}
```

## 12.7 Missing Braces Bug

```java
if (authorized)
    audit();
    execute(); // always executes
```

Solusi:

```java
if (authorized) {
    audit();
    execute();
}
```

## 12.8 Mutable Reference with `final`

```java
final List<String> names = new ArrayList<>();
names.add("x"); // allowed
```

Jika butuh immutable:

```java
final List<String> names = List.of("x");
```

atau defensive copy:

```java
this.names = List.copyOf(names);
```

---

# 13. Java Semantics untuk Engineer Backend/Enterprise

Bagian ini terlihat fundamental, tetapi dampaknya sampai architecture.

## 13.1 DTO dan Default Value

```java
class Request {
    long amount;
}
```

Jika JSON tidak mengirim `amount`, field bisa tetap `0` tergantung framework binding.

Apakah 0 berarti:

- missing?
- free?
- invalid?
- actual zero amount?

Gunakan wrapper jika perlu distinguish missing:

```java
Long amount;
```

Tetapi wrapper nullable membawa risiko NPE.

Lebih baik domain validation eksplisit:

```java
record CreatePaymentRequest(Long amount) {
    CreatePaymentRequest {
        if (amount == null) {
            throw new IllegalArgumentException("amount is required");
        }
        if (amount <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
    }
}
```

## 13.2 State Modeling

Buruk:

```java
String status = "APPROVED";
```

Lebih baik:

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Kenapa?

- menghindari typo;
- switch exhaustive lebih mungkin;
- refactoring lebih aman;
- domain transition bisa dimodelkan.

## 13.3 Money

Buruk:

```java
double amount = 10.50;
```

Lebih baik:

```java
BigDecimal amount = new BigDecimal("10.50");
```

atau:

```java
long amountInCents = 1050;
```

Atau domain type:

```java
record Money(String currency, long minorUnits) {}
```

## 13.4 ID

```java
long id;
String id;
UUID id;
```

Tipe ID bukan detail kecil. Ia memengaruhi:

- serialization;
- database index;
- ordering;
- sharding;
- traceability;
- accidental mix antara entity.

Untuk domain kuat, pertimbangkan wrapper record:

```java
record CaseId(UUID value) {
    CaseId {
        Objects.requireNonNull(value);
    }
}
```

## 13.5 Boolean Trap

```java
boolean active;
```

Apakah default `false` berarti:

- explicitly inactive?
- not initialized?
- not yet reviewed?
- unknown?

Untuk state lifecycle, boolean sering terlalu miskin.

Lebih baik:

```java
enum ActivationStatus {
    PENDING,
    ACTIVE,
    SUSPENDED,
    DEACTIVATED
}
```

---

# 14. How to Think: Checklist Saat Membaca Java Code

Setiap membaca potongan Java, tanyakan:

## 14.1 Untuk Variable

- Ini primitive atau reference?
- Bisa null?
- Punya default value atau wajib initialized?
- Scope-nya sampai mana?
- Bisa berubah setelah assign?
- Kalau `final`, apakah object-nya immutable atau hanya reference-nya stabil?

## 14.2 Untuk Expression

- Compile-time type-nya apa?
- Ada numeric promotion?
- Ada boxing/unboxing?
- Ada narrowing?
- Ada side effect?
- Evaluation order penting?
- Ada kemungkinan overflow?
- Ada kemungkinan integer division tidak sengaja?
- Ada kemungkinan NPE?

## 14.3 Untuk Statement

- Control flow-nya jelas?
- Ada branch yang tidak menginisialisasi variable?
- Ada fall-through?
- Ada missing braces?
- Ada resource yang harus ditutup?
- Ada exception path yang membuat state partial?
- Ada loop yang bisa infinite?

## 14.4 Untuk API Boundary

- Tipe mewakili domain dengan tepat?
- `null` punya arti jelas?
- Default primitive menyembunyikan missing value?
- String seharusnya enum/value object?
- Numeric seharusnya `BigDecimal`, `long`, atau domain type?
- Mutable object bocor keluar?

---

# 15. Latihan Bertahap

## 15.1 Latihan 1 — Predict the Output

Tanpa menjalankan, prediksi output:

```java
class Main {
    public static void main(String[] args) {
        int x = 1;
        System.out.println(x++);
        System.out.println(++x);
        System.out.println(x);
    }
}
```

Jawaban:

```text
1
3
3
```

## 15.2 Latihan 2 — String Concatenation

```java
class Main {
    public static void main(String[] args) {
        System.out.println("a" + 1 + 2);
        System.out.println(1 + 2 + "a");
        System.out.println("a" + (1 + 2));
    }
}
```

Jawaban:

```text
a12
3a
a3
```

## 15.3 Latihan 3 — Numeric Promotion

```java
class Main {
    public static void main(String[] args) {
        byte a = 10;
        byte b = 20;
        var c = a + b;
        System.out.println(((Object) c).getClass().getName());
    }
}
```

Jawaban:

```text
java.lang.Integer
```

Kenapa? `a + b` bertipe `int`, lalu `c` inferred sebagai `int`, kemudian boxing ke `Integer` saat cast ke `Object`.

## 15.4 Latihan 4 — Unboxing NPE

```java
class Main {
    public static void main(String[] args) {
        Integer x = null;
        if (x > 0) {
            System.out.println("positive");
        }
    }
}
```

Apa yang terjadi?

Jawaban: `NullPointerException`, karena `x > 0` membutuhkan unboxing dari `Integer` ke `int`.

## 15.5 Latihan 5 — Short Circuit

```java
class Main {
    static boolean fail() {
        throw new RuntimeException("boom");
    }

    public static void main(String[] args) {
        if (false && fail()) {
            System.out.println("never");
        }
        System.out.println("done");
    }
}
```

Jawaban:

```text
done
```

`fail()` tidak dievaluasi karena `&&` short-circuit.

## 15.6 Latihan 6 — Reference Assignment

```java
class Box {
    int value;
}

class Main {
    static void change(Box b) {
        b.value = 99;
    }

    static void replace(Box b) {
        b = new Box();
        b.value = 123;
    }

    public static void main(String[] args) {
        Box box = new Box();
        box.value = 10;
        change(box);
        replace(box);
        System.out.println(box.value);
    }
}
```

Jawaban:

```text
99
```

Karena Java pass-by-value. `replace` hanya mengganti copy reference lokal.

## 15.7 Latihan 7 — Switch Fall-through

```java
class Main {
    public static void main(String[] args) {
        int status = 0;
        switch (status) {
            case 0:
                System.out.println("ZERO");
            case 1:
                System.out.println("ONE");
            default:
                System.out.println("DEFAULT");
        }
    }
}
```

Jawaban:

```text
ZERO
ONE
DEFAULT
```

Karena legacy switch statement fall-through tanpa `break`.

---

# 16. Mini Project: Semantic Playground

Buat project kecil bernama `java-semantics-playground`.

Struktur:

```text
java-semantics-playground/
  src/
    main/
      java/
        playground/
          PrimitiveDemo.java
          ReferenceDemo.java
          ConversionDemo.java
          ExpressionDemo.java
          StatementDemo.java
```

## 16.1 PrimitiveDemo

Isi dengan eksperimen:

- overflow `int`;
- `byte` promotion;
- integer division;
- floating precision;
- NaN equality;
- char code unit.

## 16.2 ReferenceDemo

Isi dengan eksperimen:

- reference assignment;
- `==` vs `equals`;
- null reference;
- array covariance;
- wrapper cache.

## 16.3 ConversionDemo

Isi dengan eksperimen:

- widening;
- narrowing;
- boxing;
- unboxing null;
- string conversion;
- cast exception.

## 16.4 ExpressionDemo

Isi dengan eksperimen:

- left-to-right evaluation;
- `x++` vs `++x`;
- string concatenation;
- short-circuit;
- ternary.

## 16.5 StatementDemo

Isi dengan eksperimen:

- if/else braces;
- loop;
- break/continue;
- switch legacy;
- switch arrow;
- try-with-resources.

Tujuan mini project bukan membuat aplikasi berguna, melainkan membangun intuisi runtime.

---

# 17. Kesimpulan Part 002

Bagian ini membangun fondasi bahwa Java bukan sekadar kumpulan syntax, tetapi sistem semantik yang presisi.

Hal yang harus tertanam:

1. Source Java diproses dari Unicode character menjadi token lalu grammar.
2. Java statically typed dan strongly typed.
3. Primitive menyimpan nilai langsung; reference menyimpan reference ke object.
4. `char` adalah UTF-16 code unit, bukan Unicode character manusia utuh.
5. Local variable wajib definitely assigned; field punya default value.
6. Java selalu pass-by-value; untuk object, value yang disalin adalah reference.
7. `final` reference tidak membuat object immutable.
8. Expression punya compile-time type dan bisa memicu conversion.
9. Numeric promotion sering menghasilkan `int` walaupun operand `byte/short/char`.
10. Integer overflow tidak otomatis exception.
11. Floating-point bukan decimal exact.
12. `==` pada reference membandingkan identity, bukan logical equality.
13. `&&` dan `||` short-circuit; `&` dan `|` pada boolean tidak.
14. Legacy switch bisa fall-through; modern switch arrow lebih aman.
15. Banyak bug production berasal dari detail “dasar” ini.

Jika kamu menguasai bagian ini, kamu tidak hanya bisa menulis Java, tetapi mulai bisa membaca Java seperti compiler dan runtime membacanya.

---

# 18. Checklist Penguasaan

Kamu siap lanjut ke Part 003 jika bisa menjawab tanpa ragu:

- Apa bedanya primitive value dan reference value?
- Kenapa `byte + byte` menghasilkan `int`?
- Kenapa `double ratio = a / b` bisa salah jika `a` dan `b` int?
- Kenapa `Integer x = null; int y = x;` menghasilkan NPE?
- Kenapa `String a = new String("x"); String b = new String("x"); a == b` false?
- Kenapa local variable harus diinisialisasi, sedangkan field tidak?
- Apa arti `final` pada reference variable?
- Apa bedanya `&&` dan `&` untuk boolean?
- Apa risiko legacy switch tanpa `break`?
- Apa bedanya assignment context, invocation context, casting context, dan numeric context?
- Kenapa compact source file Java 25 tidak berarti Java kehilangan class model?

---

# 19. Preview Part 003

Part berikutnya adalah:

# Learn Java Part 003 — Object Model: Bagian yang Sering Diremehkan

Kita akan membahas:

- class sebagai blueprint;
- object sebagai identity + state + behavior;
- constructor dan initialization order;
- flexible constructor bodies Java 25;
- inheritance;
- dynamic dispatch;
- interface;
- `Object` methods;
- equality contract;
- object lifecycle;
- aliasing;
- mutability;
- fragile base class problem;
- composition vs inheritance.

Di Part 003, kita mulai masuk ke model object Java secara serius, bukan sebatas “class adalah cetakan object”.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Part 001 — Setup, Toolchain, dan Cara Kerja Build Java Modern hingga Java 25](./learn-java-part-001.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 003 — Object Model: Class, Object, Constructor, Inheritance, Interface, `Object`, dan Equality](./learn-java-part-003.md)

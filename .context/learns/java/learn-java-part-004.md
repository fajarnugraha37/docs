# Learn Java hingga Java 25 — Part 004

# Type System, Generics, dan API Design

> Target pembaca: software engineer yang sudah nyaman dengan programming, OOP, backend, dan desain sistem, tetapi ingin memahami Java type system bukan sebagai hafalan syntax, melainkan sebagai alat berpikir untuk membuat API yang benar, aman, evolvable, dan tahan terhadap bug runtime.

---

## 0. Posisi Bagian Ini dalam Roadmap

Pada bagian sebelumnya kita sudah membahas:

- **Part 000** — Java sebagai bahasa, platform, runtime, dan ekosistem.
- **Part 001** — toolchain, build, runtime launching, dependency, dan project layout.
- **Part 002** — fondasi bahasa: token, tipe dasar, variabel, ekspresi, statement, conversion.
- **Part 003** — object model: class, object identity, constructor, inheritance, interface, equality.

Sekarang kita masuk ke salah satu area yang paling menentukan kualitas engineer Java: **type system dan generics**.

Banyak developer Java memakai generics hanya sebagai:

```java
List<String> names = new ArrayList<>();
```

Tetapi engineer yang kuat memahami bahwa generics adalah alat untuk:

1. memindahkan bug dari runtime ke compile-time;
2. mendesain kontrak API yang fleksibel tetapi tetap aman;
3. mengendalikan dependency antar layer;
4. membatasi state transition dan domain invariant;
5. membuat library reusable tanpa kehilangan type safety;
6. memahami batas JVM karena type erasure;
7. membaca error compiler yang tampak “aneh” secara rasional;
8. menghindari abstraction yang terlalu pintar tetapi rapuh.

Bagian ini membahas Java type system dari level mental model hingga pola desain API production-grade.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. membedakan **compile-time type** dan **runtime type** dengan presisi;
2. memahami hubungan antara type, class, object, interface, subtype, dan assignment compatibility;
3. memakai generics untuk mendesain API yang reusable dan type-safe;
4. memahami kenapa `List<Integer>` bukan subtype dari `List<Number>`;
5. memahami wildcard `?`, `? extends T`, `? super T`, dan capture conversion;
6. memahami type erasure dan konsekuensinya pada runtime, reflection, overload, array, dan framework;
7. memahami raw type, heap pollution, reifiable type, unchecked warning, dan kapan warning berbahaya;
8. mendesain generic repository, event envelope, command handler, validator, mapper, specification, dan state transition API;
9. membaca generic signature kompleks milik JDK dan framework;
10. memahami arah masa depan Java type system seperti primitive type patterns di Java 25 dan Project Valhalla tanpa mencampuradukkan fitur preview, early access, dan fitur stabil.

---

## 2. Mental Model Utama: Type System adalah Sistem Pembatasan yang Produktif

Banyak orang melihat type system sebagai “aturan compiler”. Cara pandang itu terlalu sempit.

Mental model yang lebih tepat:

> **Type system adalah mekanisme formal untuk menyatakan kontrak, membatasi kemungkinan salah, dan membuat beberapa kategori bug mustahil terjadi sebelum program dijalankan.**

Contoh sederhana:

```java
void sendEmail(String emailAddress) { ... }

sendEmail(123); // compile-time error
```

Compiler mencegah `int` masuk ke API yang mengharapkan `String`.

Tetapi untuk sistem besar, manfaat type system jauh lebih penting:

```java
record CaseId(String value) {}
record OfficerId(String value) {}

void assignCase(CaseId caseId, OfficerId officerId) { ... }
```

Dibanding API yang memakai `String` semuanya:

```java
void assignCase(String caseId, String officerId) { ... }
```

Versi kedua terlihat simpel, tetapi salah urutan parameter tidak ketahuan compiler:

```java
assignCase(officerId, caseId); // sama-sama String, compiler diam
```

Versi pertama membuat kesalahan itu mustahil:

```java
assignCase(new OfficerId("O-1"), new CaseId("C-1")); // compile-time error
```

Inilah inti type system: **membuat illegal state dan illegal operation sulit atau mustahil direpresentasikan.**

---

## 3. Type, Class, Object, dan Value: Jangan Disamakan

Dalam Java, istilah berikut sering tercampur:

- type;
- class;
- object;
- value;
- reference;
- interface;
- generic type;
- runtime class.

Padahal ini layer berbeda.

### 3.1 Type

**Type** adalah kategori nilai yang diketahui compiler.

Contoh:

```java
int age = 30;
String name = "Fajar";
List<String> names = List.of("A", "B");
```

Compile-time type dari masing-masing ekspresi:

| Ekspresi | Compile-time type |
|---|---|
| `30` | `int` |
| `"Fajar"` | `String` |
| `List.of("A", "B")` | kira-kira `List<String>` melalui type inference |
| `names` | `List<String>` |

Type dipakai compiler untuk menjawab:

- operasi apa yang boleh dilakukan?
- method apa yang bisa dipanggil?
- assignment apa yang valid?
- conversion apa yang legal?
- overload mana yang dipilih?
- apakah switch/pattern exhaustive?

### 3.2 Class

**Class** adalah deklarasi runtime/compile-time yang mendefinisikan struktur dan behavior object.

```java
class Customer {
    private final String name;

    Customer(String name) {
        this.name = name;
    }
}
```

`Customer` bisa menjadi type, tetapi tidak semua type adalah class.

Contoh type yang bukan class biasa:

```java
int                    // primitive type
String[]               // array type
List<String>           // parameterized type
T                      // type variable
? extends Number       // wildcard type argument
Runnable               // interface type
```

### 3.3 Object

**Object** adalah instance runtime dari class atau array.

```java
Customer c = new Customer("A");
```

`c` adalah variable yang menyimpan reference ke object. Object-nya berada di heap, sementara variable menyimpan reference.

### 3.4 Value

**Value** adalah sesuatu yang dihasilkan ekspresi.

```java
int x = 10;                 // primitive value 10
String s = "hello";         // reference value ke object String
Customer c = new Customer("A"); // reference value ke object Customer
```

Pada Java hari ini:

- primitive value bukan object;
- object diakses lewat reference;
- `null` adalah nilai khusus untuk reference type;
- generic type parameter saat ini hanya bisa memakai reference type secara langsung, misalnya `List<Integer>`, bukan `List<int>`.

Ini penting karena banyak desain generics Java dipengaruhi oleh pemisahan lama antara **primitive** dan **reference**.

---

## 4. Compile-Time Type vs Runtime Type

Ini adalah konsep paling penting untuk memahami Java type system.

```java
CharSequence text = "hello";
```

Di sini:

- compile-time type variable `text` adalah `CharSequence`;
- runtime object yang direferensikan adalah instance `String`.

Compiler hanya mengizinkan operasi berdasarkan compile-time type:

```java
text.length();     // OK, CharSequence punya length()
text.toUpperCase(); // ERROR, CharSequence tidak punya toUpperCase()
```

Walaupun runtime object-nya `String`, compiler tidak memakai informasi runtime itu untuk method lookup biasa.

Kalau kamu ingin memanggil method khusus `String`, kamu perlu mempersempit type:

```java
if (text instanceof String s) {
    System.out.println(s.toUpperCase());
}
```

### 4.1 Kenapa ini penting?

Karena banyak bug desain API muncul dari kebingungan ini:

```java
List<Number> numbers = new ArrayList<Integer>(); // ERROR
```

Orang berpikir: “Integer adalah Number, jadi List<Integer> harusnya List<Number>.”

Tetapi compiler melihat type secara struktural terhadap operasi yang diizinkan. Jika `List<Integer>` bisa dipakai sebagai `List<Number>`, maka ini akan valid:

```java
List<Integer> integers = new ArrayList<>();
List<Number> numbers = integers; // andaikan boleh
numbers.add(3.14);               // Double adalah Number
Integer first = integers.get(0); // boom: ternyata Double
```

Maka Java melarangnya.

Inilah alasan generics Java bersifat **invariant** secara default.

---

## 5. Static Typing Mental Model

Java adalah bahasa **statically typed**.

Artinya setiap expression punya type yang dapat diketahui compiler sebelum program berjalan.

```java
var x = 10;
var y = "hello";
var z = List.of(1, 2, 3);
```

Walaupun memakai `var`, Java tetap statically typed. `var` bukan dynamic typing. Compiler tetap menetapkan type:

```java
int x = 10;
String y = "hello";
List<Integer> z = List.of(1, 2, 3);
```

### 5.1 Static typing bukan berarti semua hal diketahui runtime

Java generics memakai **type erasure**. Artinya sebagian informasi generic type digunakan compiler, tetapi tidak selalu tersedia sebagai runtime type check.

```java
List<String> strings = new ArrayList<>();
System.out.println(strings.getClass()); // class java.util.ArrayList
```

Runtime class-nya `ArrayList`, bukan `ArrayList<String>`.

Jadi Java punya kombinasi menarik:

- strong static type checking di compile-time;
- runtime class identity untuk object;
- erasure untuk generic parameter;
- metadata generic tertentu masih bisa ada di class file signature, tetapi bukan runtime specialization seperti C++ template.

---

## 6. Kategori Type di Java

Secara besar Java punya:

1. primitive type;
2. reference type;
3. type variable;
4. parameterized type;
5. array type;
6. intersection type;
7. null type;
8. void type untuk method return.

### 6.1 Primitive type

Primitive:

```java
byte short int long
float double
char
boolean
```

Primitive bukan subtype dari `Object`.

```java
Object o = 1; // autoboxing: int -> Integer, lalu Integer -> Object
```

Yang terjadi bukan `int` menjadi `Object`, melainkan:

```java
Integer boxed = Integer.valueOf(1);
Object o = boxed;
```

### 6.2 Reference type

Reference type mencakup:

- class type;
- interface type;
- array type;
- type variable;
- parameterized type.

Contoh:

```java
String
Runnable
String[]
List<String>
T
```

Reference type bisa memiliki nilai `null`.

```java
String s = null;
List<String> xs = null;
```

### 6.3 Null type

`null` punya type khusus: null type. Tidak bisa ditulis langsung sebagai nama type.

```java
String s = null;
Object o = null;
List<String> xs = null;
```

`null` assignable ke reference type, tetapi bukan primitive:

```java
int x = null; // ERROR
```

### 6.4 Type variable

Type variable adalah placeholder type dalam generic declaration.

```java
class Box<T> {
    private final T value;

    Box(T value) {
        this.value = value;
    }

    T value() {
        return value;
    }
}
```

`T` bukan class. `T` adalah type variable.

### 6.5 Parameterized type

Parameterized type adalah generic type setelah diberi type argument.

```java
Box<String>
List<Integer>
Map<String, List<Order>>
```

### 6.6 Intersection type

Intersection type berarti nilai harus memenuhi beberapa type sekaligus.

```java
<T extends Runnable & AutoCloseable> void use(T resource) {
    resource.run();
    try {
        resource.close();
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

`T` harus subtype dari `Runnable` dan `AutoCloseable`.

---

## 7. Subtyping: Relasi “Bisa Dipakai Sebagai”

Subtyping menjawab pertanyaan:

> Apakah nilai dari type S bisa diperlakukan sebagai type T?

Contoh:

```java
String s = "hello";
CharSequence cs = s;
Object o = s;
```

`String` adalah subtype dari `CharSequence` dan `Object`.

### 7.1 Subtyping bukan inheritance saja

Inheritance adalah salah satu cara membentuk subtype. Interface implementation juga membentuk subtype.

```java
class MyTask implements Runnable {
    public void run() {}
}

Runnable r = new MyTask();
Object o = new MyTask();
```

Array juga punya aturan subtyping sendiri:

```java
String[] strings = new String[10];
Object[] objects = strings; // legal, array covariant
```

Tetapi ini berbahaya:

```java
objects[0] = 123; // runtime ArrayStoreException
```

Generics sengaja tidak mengikuti covariance array karena ingin menangkap error seperti ini di compile-time.

---

## 8. Assignment Compatibility dan Conversion

Assignment bukan hanya “type sama”. Java mengizinkan beberapa conversion.

```java
long x = 10;          // int literal -> long
Object o = "hello";   // String -> Object
Integer i = 10;       // boxing int -> Integer
int j = i;            // unboxing Integer -> int
```

Kategori penting:

| Conversion | Contoh | Aman? |
|---|---|---|
| Widening primitive | `int` ke `long` | umumnya aman dari range loss untuk integral tertentu |
| Narrowing primitive | `long` ke `int` | perlu cast, bisa kehilangan info |
| Widening reference | `String` ke `Object` | aman |
| Narrowing reference | `Object` ke `String` | perlu runtime check |
| Boxing | `int` ke `Integer` | allocation/cache concern |
| Unboxing | `Integer` ke `int` | bisa NPE |
| Unchecked conversion | raw/generic conversion | bisa heap pollution |

### 8.1 Narrowing reference conversion

```java
Object o = "hello";
String s = (String) o; // OK runtime

Object n = 123;
String bad = (String) n; // ClassCastException
```

Compiler mengizinkan cast karena mungkin valid. Runtime yang memutuskan berdasarkan object sesungguhnya.

### 8.2 Unchecked conversion

```java
List raw = new ArrayList();
raw.add(123);

List<String> strings = raw; // unchecked warning
String s = strings.get(0);  // ClassCastException
```

Unchecked warning bukan noise. Ia adalah tanda bahwa compiler tidak bisa membuktikan type safety.

---

## 9. Type Inference: Compiler Menyelesaikan Constraint

Type inference bukan “compiler menebak”. Lebih tepat:

> Compiler menyelesaikan sistem constraint berdasarkan declaration, argument, target type, bounds, overload, dan context.

Contoh diamond operator:

```java
List<String> names = new ArrayList<>();
```

Compiler tahu `ArrayList<>` harus menjadi `ArrayList<String>` karena target type assignment adalah `List<String>`.

### 9.1 Generic method inference

```java
static <T> T identity(T value) {
    return value;
}

String s = identity("hello");
Integer i = identity(123);
```

Compiler menyimpulkan:

```java
identity<String>("hello")
identity<Integer>(123)
```

Walaupun syntax eksplisit jarang dipakai, Java mendukung explicit type witness:

```java
String s = MyUtils.<String>identity("hello");
```

### 9.2 Target typing

Beberapa expression dipengaruhi oleh target type.

```java
Function<String, Integer> f = s -> s.length();
```

Lambda `s -> s.length()` tidak punya type mandiri. Ia butuh target functional interface.

Ini valid:

```java
Predicate<String> p = s -> s.isBlank();
```

Tetapi ini tidak valid:

```java
var lambda = s -> s.length(); // ERROR: target type tidak jelas
```

`var` butuh initializer punya type yang bisa disimpulkan sendiri. Lambda butuh target type. Dua-duanya saling membutuhkan, sehingga gagal.

### 9.3 Poly expressions

Expression seperti lambda, method reference, conditional expression tertentu, switch expression, dan generic method invocation bisa menjadi **poly expression**: type-nya dipengaruhi context.

Contoh:

```java
var list = List.of();
```

Apa type `list`?

Karena tidak ada element, compiler biasanya menyimpulkan `List<Object>`.

Lebih baik beri target type saat maksudnya penting:

```java
List<String> names = List.of();
```

### 9.4 Type inference bukan pengganti desain API

Kode seperti ini mungkin bisa compile:

```java
var result = service.process(input);
```

Tetapi jika `process` mengembalikan generic type terlalu abstrak, pembaca tidak tahu kontrak sebenarnya.

Untuk local variable, `var` bagus jika initializer jelas:

```java
var customerId = new CustomerId("C-1");
```

Kurang bagus jika type membawa informasi domain penting yang tidak terlihat:

```java
var result = handler.handle(command);
```

Apa `result`? `Result<ApprovedCase, RejectionReason>`? `Optional<Case>`? `CompletableFuture<Response>`?

Dalam codebase besar, readability adalah bagian dari correctness.

---

## 10. Generics: Masalah yang Dipecahkan

Sebelum generics, Java collection memakai `Object`.

```java
List names = new ArrayList();
names.add("Alice");
names.add(123);

String first = (String) names.get(0);
String second = (String) names.get(1); // ClassCastException
```

Masalah:

1. type error baru muncul runtime;
2. cast tersebar di mana-mana;
3. API tidak mendokumentasikan element type;
4. refactor sulit;
5. bug bisa masuk jauh sebelum meledak.

Dengan generics:

```java
List<String> names = new ArrayList<>();
names.add("Alice");
names.add(123); // compile-time error

String first = names.get(0); // tidak perlu cast manual
```

Generics memindahkan kategori bug dari runtime ke compile-time.

---

## 11. Generic Class

Generic class punya type parameter di class declaration.

```java
public final class Box<T> {
    private final T value;

    public Box(T value) {
        this.value = value;
    }

    public T value() {
        return value;
    }
}
```

Pemakaian:

```java
Box<String> a = new Box<>("hello");
Box<Integer> b = new Box<>(123);
```

`T` mewakili type yang konsisten di seluruh instance API.

```java
String s = a.value();
Integer i = b.value();
```

### 11.1 Type parameter adalah kontrak antar method

Pada `Box<T>`, `T` menghubungkan constructor dan return type:

```java
new Box<String>("hello") -> value() returns String
new Box<Integer>(123)    -> value() returns Integer
```

Tanpa generics:

```java
class Box {
    private final Object value;
    Object value() { return value; }
}
```

Pemanggil harus cast dan berharap benar.

### 11.2 Naming convention

Konvensi umum:

| Nama | Makna umum |
|---|---|
| `T` | Type |
| `E` | Element |
| `K` | Key |
| `V` | Value |
| `R` | Result/Return |
| `S`, `U` | Additional type |
| `ID` | Identifier type, jika domain-specific |

Untuk API domain, nama eksplisit sering lebih baik:

```java
interface Repository<ENTITY, ID> {
    Optional<ENTITY> findById(ID id);
    ENTITY save(ENTITY entity);
}
```

Tetapi terlalu panjang juga bisa bising. Gunakan proporsional.

---

## 12. Generic Method

Generic method punya type parameter di method declaration.

```java
public static <T> T first(List<T> values) {
    if (values.isEmpty()) {
        throw new IllegalArgumentException("empty");
    }
    return values.get(0);
}
```

Pemakaian:

```java
String name = first(List.of("A", "B"));
Integer number = first(List.of(1, 2, 3));
```

### 12.1 Kapan type parameter di method, bukan class?

Gunakan generic class ketika type parameter adalah bagian dari state/identity object.

```java
class Box<T> {
    private final T value;
}
```

Gunakan generic method ketika type parameter hanya relevan untuk satu operasi.

```java
static <T> List<T> copyOf(Collection<T> values) { ... }
```

### 12.2 Anti-pattern: type parameter tidak memberi informasi

```java
public <T> void log(T value) {
    System.out.println(value);
}
```

Ini tidak salah, tetapi generic tidak memberi value. Bisa cukup:

```java
public void log(Object value) {
    System.out.println(value);
}
```

Type parameter berguna jika ada hubungan antar parameter/return:

```java
public <T> T requireNonNull(T value) {
    if (value == null) throw new NullPointerException();
    return value;
}
```

Di sini `T` menjaga return type sama dengan input type.

---

## 13. Bounded Type Parameter

Kadang type parameter perlu constraint.

```java
public static <T extends Comparable<T>> T max(List<T> values) {
    T best = values.get(0);
    for (T value : values) {
        if (value.compareTo(best) > 0) {
            best = value;
        }
    }
    return best;
}
```

`T extends Comparable<T>` berarti `T` harus punya kemampuan dibandingkan dengan `T`.

### 13.1 `extends` untuk class dan interface

Dalam generic bound, keyword-nya selalu `extends`, bahkan untuk interface:

```java
<T extends Runnable>
<T extends Number>
<T extends AutoCloseable>
```

Tidak ada syntax `<T implements Runnable>`.

### 13.2 Multiple bounds

```java
public static <T extends Runnable & AutoCloseable> void runAndClose(T value) throws Exception {
    try (value) {
        value.run();
    }
}
```

Jika ada class bound, class harus pertama:

```java
<T extends BaseClass & InterfaceA & InterfaceB>
```

### 13.3 Bound menentukan operasi yang boleh dipanggil

Tanpa bound:

```java
static <T> void use(T value) {
    value.run(); // ERROR
}
```

Dengan bound:

```java
static <T extends Runnable> void use(T value) {
    value.run(); // OK
}
```

Compiler hanya mengizinkan method yang dijamin ada oleh bound.

---

## 14. Invariance: Kenapa `List<Integer>` Bukan `List<Number>`

Ini konsep wajib.

```java
Integer extends Number
```

Tetapi:

```java
List<Integer> does not extend List<Number>
```

Alasannya safety.

Bayangkan ini boleh:

```java
List<Integer> integers = new ArrayList<>();
List<Number> numbers = integers; // andaikan legal
numbers.add(3.14);               // legal untuk List<Number>
Integer x = integers.get(0);     // ternyata Double
```

Untuk mencegah itu, generic type Java invariant.

### 14.1 Invariance bukan kekurangan; ini perlindungan

Invariance menjaga koleksi mutable tetap aman.

Jika API hanya membaca, kita bisa memakai wildcard upper-bound:

```java
void printAll(List<? extends Number> numbers) {
    for (Number n : numbers) {
        System.out.println(n);
    }
}

printAll(List.of(1, 2, 3));       // List<Integer>
printAll(List.of(1.5, 2.5));      // List<Double>
```

Jika API menulis, kita bisa memakai wildcard lower-bound:

```java
void addIntegers(List<? super Integer> target) {
    target.add(1);
    target.add(2);
}

List<Integer> integers = new ArrayList<>();
List<Number> numbers = new ArrayList<>();
List<Object> objects = new ArrayList<>();

addIntegers(integers);
addIntegers(numbers);
addIntegers(objects);
```

---

## 15. Wildcards: `?`, `? extends T`, `? super T`

Wildcard adalah cara menyatakan “ada type tertentu, tetapi saya tidak perlu tahu persis namanya”.

### 15.1 Unbounded wildcard: `?`

```java
void printSize(List<?> values) {
    System.out.println(values.size());
}
```

`List<?>` berarti list dari type tertentu yang tidak diketahui.

Kamu bisa membaca sebagai `Object`:

```java
Object value = values.get(0);
```

Tetapi tidak bisa menambah element selain `null`:

```java
values.add("x"); // ERROR
values.add(123); // ERROR
values.add(null); // technically allowed, usually avoid
```

Kenapa?

Karena `values` mungkin sebenarnya `List<String>`, `List<Integer>`, atau `List<Customer>`. Compiler tidak tahu element type yang aman untuk ditambahkan.

### 15.2 Upper-bounded wildcard: `? extends T`

```java
void process(List<? extends Number> values) {
    Number n = values.get(0); // OK
    values.add(1);            // ERROR
}
```

`? extends Number` berarti “list dari suatu subtype Number”.

Mungkin:

```java
List<Integer>
List<Double>
List<BigDecimal> // jika BigDecimal? sebenarnya BigDecimal extends Number
```

Membaca aman sebagai `Number`.

Menulis tidak aman karena compiler tidak tahu subtype persisnya.

Jika `values` adalah `List<Double>`, menambahkan `Integer` akan salah.

### 15.3 Lower-bounded wildcard: `? super T`

```java
void addNumbers(List<? super Integer> values) {
    values.add(1);  // OK
    values.add(2);  // OK

    Object x = values.get(0); // hanya aman sebagai Object
}
```

`? super Integer` berarti “list dari suatu supertype Integer”.

Mungkin:

```java
List<Integer>
List<Number>
List<Object>
```

Menulis `Integer` aman karena semua list tersebut bisa menerima `Integer`.

Membaca hanya aman sebagai `Object`, karena compiler tidak tahu apakah list aslinya `List<Integer>`, `List<Number>`, atau `List<Object>`.

---

## 16. PECS: Producer Extends, Consumer Super

Aturan praktis:

> **Producer Extends, Consumer Super.**

Jika parameter menghasilkan data untuk kamu baca, gunakan `extends`.

```java
double sum(Collection<? extends Number> numbers) {
    double total = 0;
    for (Number number : numbers) {
        total += number.doubleValue();
    }
    return total;
}
```

Jika parameter menerima data yang kamu tulis, gunakan `super`.

```java
void addDefaults(Collection<? super Integer> target) {
    target.add(1);
    target.add(2);
    target.add(3);
}
```

Jika parameter dibaca dan ditulis dengan type yang sama, jangan pakai wildcard; pakai `T`.

```java
<T> void replaceFirst(List<T> list, T value) {
    list.set(0, value);
}
```

### 16.1 PECS pada copy

```java
public static <T> void copy(
        List<? extends T> source,
        List<? super T> target
) {
    for (T item : source) {
        target.add(item);
    }
}
```

Pemakaian:

```java
List<Integer> ints = List.of(1, 2, 3);
List<Number> nums = new ArrayList<>();

copy(ints, nums); // OK
```

Source memproduksi `T`, maka `extends`.
Target mengonsumsi `T`, maka `super`.

---

## 17. Wildcard Capture

Kadang compiler bisa “menangkap” wildcard menjadi type variable internal.

Contoh yang gagal:

```java
void reverse(List<?> list) {
    Object first = list.get(0);
    list.set(0, list.get(1)); // ERROR
}
```

Secara manusia, ini tampak aman: kita mengambil dari list yang sama dan menaruh kembali ke list yang sama. Tetapi compiler melihat `List<?>` dan tidak tahu element type-nya.

Solusi: helper generic method.

```java
void reverse(List<?> list) {
    reverseCaptured(list);
}

private <T> void reverseCaptured(List<T> list) {
    T first = list.get(0);
    list.set(0, list.get(1));
    list.set(1, first);
}
```

`reverseCaptured` memberi nama pada type yang sebelumnya tidak diketahui. Ini disebut capture.

Mental model:

- `?` = “some unknown type”;
- helper `<T>` = “beri nama unknown type itu agar bisa dipakai konsisten”.

---

## 18. Type Erasure: Generics Java Tidak Menjadi Specialization Runtime

Generics Java diimplementasikan dengan **type erasure**.

Secara praktis:

```java
List<String> strings = new ArrayList<>();
List<Integer> integers = new ArrayList<>();

System.out.println(strings.getClass() == integers.getClass()); // true
```

Keduanya runtime class `ArrayList`.

### 18.1 Apa yang dilakukan compiler?

Compiler kira-kira:

1. mengganti type parameter dengan bound atau `Object` jika unbounded;
2. menambahkan cast yang diperlukan;
3. membuat bridge method untuk menjaga polymorphism setelah erasure;
4. menyimpan sebagian generic signature sebagai metadata untuk reflection/compile-time tools.

Contoh source:

```java
class Box<T> {
    private T value;

    T get() {
        return value;
    }
}
```

Setelah erasure secara konseptual:

```java
class Box {
    private Object value;

    Object get() {
        return value;
    }
}
```

Jika bound:

```java
class NumberBox<T extends Number> {
    private T value;

    T get() {
        return value;
    }
}
```

Konseptual setelah erasure:

```java
class NumberBox {
    private Number value;

    Number get() {
        return value;
    }
}
```

### 18.2 Cast disisipkan compiler

Source:

```java
Box<String> box = new Box<>();
String value = box.get();
```

Konseptual setelah erasure:

```java
Box box = new Box();
String value = (String) box.get();
```

Bedanya: cast dibuat compiler dan dianggap aman selama tidak ada raw type/unchecked pollution.

### 18.3 Erasure menjaga backward compatibility

Generics ditambahkan di Java 5 ketika ekosistem Java sudah besar. Erasure memungkinkan library lama yang memakai raw `List` tetap bisa berjalan bersama kode baru yang memakai `List<String>`.

Trade-off-nya:

- runtime tidak punya specialization untuk `List<String>` vs `List<Integer>`;
- tidak bisa `new T()`;
- tidak bisa `T.class`;
- tidak bisa `instanceof List<String>`;
- tidak bisa `List<int>`;
- overload berdasarkan generic parameter bisa clash;
- array generic bermasalah;
- unchecked warning menjadi bagian realita Java.

---

## 19. Reifiable vs Non-Reifiable Type

**Reifiable type** adalah type yang informasi runtime-nya cukup tersedia.

Contoh reifiable:

```java
String
Integer
Object
String[]
List<?>       // wildcard unbounded reifiable-ish untuk check tertentu
int
```

Contoh non-reifiable:

```java
List<String>
Map<String, Integer>
T
List<? extends Number>
```

Kenapa penting?

Karena runtime check hanya bisa mengecek type yang tersedia.

```java
if (value instanceof List<String>) { // ERROR
}
```

Yang bisa:

```java
if (value instanceof List<?>) {
    List<?> list = (List<?>) value;
}
```

Tetapi element type tetap harus divalidasi manual jika penting:

```java
static boolean isListOfString(Object value) {
    if (!(value instanceof List<?> list)) {
        return false;
    }
    for (Object element : list) {
        if (!(element instanceof String)) {
            return false;
        }
    }
    return true;
}
```

---

## 20. Raw Type dan Heap Pollution

Raw type adalah generic type tanpa type argument.

```java
List raw = new ArrayList();
```

Raw type ada untuk compatibility dengan kode lama. Dalam kode modern, raw type hampir selalu harus dihindari.

### 20.1 Heap pollution

Heap pollution terjadi ketika variable parameterized type menunjuk ke object yang tidak sesuai dengan type parameter yang dijanjikan.

```java
List<String> strings = new ArrayList<>();
List raw = strings;
raw.add(123); // compiler warning, runtime masuk

String s = strings.get(0); // ClassCastException
```

Masalahnya muncul terlambat. Titik masuk bug adalah `raw.add(123)`, tetapi ledakannya terjadi di `strings.get(0)`.

### 20.2 Jangan abaikan unchecked warning

Unchecked warning adalah sinyal bahwa compiler tidak bisa membuktikan type safety.

Kadang unavoidable, misalnya saat interop dengan reflection atau legacy API. Tetapi harus dibungkus di boundary kecil.

Buruk:

```java
@SuppressWarnings("unchecked")
public void processEverything(Object input) {
    Map<String, List<Order>> data = (Map<String, List<Order>>) input;
    // ratusan line logic
}
```

Lebih baik:

```java
public Map<String, List<Order>> parseOrders(Object input) {
    return OrderPayloadValidator.requireOrderMap(input);
}
```

Unchecked/cast risk dipusatkan di validator boundary.

---

## 21. Bridge Method

Bridge method adalah method sintetis yang dibuat compiler untuk menjaga polymorphism setelah erasure.

Contoh:

```java
interface Provider<T> {
    T get();
}

class StringProvider implements Provider<String> {
    @Override
    public String get() {
        return "hello";
    }
}
```

Setelah erasure, interface kira-kira:

```java
interface Provider {
    Object get();
}
```

Tetapi `StringProvider` punya:

```java
String get()
```

Agar override tetap valid pada bytecode level, compiler membuat bridge method konseptual:

```java
public Object get() {
    return get(); // memanggil String get()
}
```

Ini penting saat membaca stacktrace, reflection, bytecode, instrumentation, atau framework proxy. Kadang kamu akan melihat method sintetis/bridge.

---

## 22. Generic Array Problem

Array Java reified dan covariant. Generics Java erased dan invariant. Kombinasi ini membuat generic array bermasalah.

Ini tidak boleh:

```java
List<String>[] array = new List<String>[10]; // ERROR
```

Kenapa?

Jika boleh:

```java
List<String>[] stringLists = new List<String>[1];
Object[] objects = stringLists;
objects[0] = List.of(123); // array runtime hanya tahu List[], bukan List<String>[]
String s = stringLists[0].get(0); // ClassCastException
```

Gunakan collection:

```java
List<List<String>> lists = new ArrayList<>();
```

Atau jika butuh array karena performance/interoperability, isolasi warning dan validasi invariant dengan ketat.

---

## 23. Generic Varargs dan `@SafeVarargs`

Varargs memakai array di bawahnya.

```java
static <T> List<T> of(T... values) {
    return List.of(values);
}
```

Karena array generic bermasalah, generic varargs bisa menghasilkan warning.

`@SafeVarargs` boleh digunakan jika method benar-benar tidak melakukan operasi tidak aman terhadap varargs array.

Contoh aman:

```java
@SafeVarargs
static <T> List<T> immutableListOf(T... values) {
    return List.of(values);
}
```

Contoh tidak aman:

```java
@SafeVarargs
static <T> void unsafe(List<T>... lists) {
    Object[] array = lists;
    array[0] = List.of(123);
}
```

Annotation bukan untuk “mematikan warning agar bersih”, tetapi deklarasi tanggung jawab bahwa implementasi aman.

---

## 24. Overloading dan Erasure Clash

Karena erasure, ini tidak boleh:

```java
void process(List<String> values) {}
void process(List<Integer> values) {}
```

Setelah erasure keduanya menjadi:

```java
void process(List values) {}
void process(List values) {}
```

Signature bytecode clash.

Solusi:

1. gunakan nama method berbeda;
2. tambahkan type token;
3. desain ulang API;
4. gunakan visitor/polymorphism;
5. gunakan sealed hierarchy untuk command/event.

Buruk:

```java
void handle(List<CreateCommand> commands) {}
void handle(List<UpdateCommand> commands) {}
```

Lebih eksplisit:

```java
void handleCreateCommands(List<CreateCommand> commands) {}
void handleUpdateCommands(List<UpdateCommand> commands) {}
```

Atau:

```java
sealed interface Command permits CreateCommand, UpdateCommand {}

void handle(List<? extends Command> commands) {}
```

---

## 25. `Class<T>` sebagai Type Token

Karena `T.class` tidak bisa, sering kita membawa `Class<T>` sebagai runtime token.

```java
public final class JsonMapper {
    public <T> T read(String json, Class<T> type) {
        // parse and instantiate type
        throw new UnsupportedOperationException();
    }
}
```

Pemakaian:

```java
User user = mapper.read(json, User.class);
```

`Class<T>` menghubungkan runtime class token dengan compile-time return type.

### 25.1 Batas `Class<T>`

`Class<T>` tidak cukup untuk nested generic:

```java
List<User> users = mapper.read(json, List.class); // element type hilang
```

`List.class` hanya mewakili raw `List`, bukan `List<User>`.

Untuk nested generic, framework memakai type reference/super type token.

---

## 26. Super Type Token

Pattern ini menangkap generic type dari anonymous subclass.

Contoh sederhana:

```java
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;

abstract class TypeRef<T> {
    private final Type type;

    protected TypeRef() {
        Type superType = getClass().getGenericSuperclass();
        if (!(superType instanceof ParameterizedType parameterized)) {
            throw new IllegalStateException("Missing type parameter");
        }
        this.type = parameterized.getActualTypeArguments()[0];
    }

    public Type type() {
        return type;
    }
}
```

Pemakaian:

```java
TypeRef<List<User>> ref = new TypeRef<>() {};
System.out.println(ref.type());
```

Framework seperti Jackson memakai konsep serupa (`TypeReference`) untuk membaca generic type kompleks.

### 26.1 Mental model

Walaupun erasure menghapus generic parameter dari object biasa, generic signature pada superclass anonymous subclass masih bisa dibaca melalui reflection metadata.

Ini bukan runtime specialization. Ini metadata.

---

## 27. Generic API Design: Prinsip-Prinsip

Generic API yang bagus bukan yang paling abstrak. Generic API yang bagus adalah yang:

1. menyatakan relasi type yang benar;
2. memudahkan caller;
3. mengurangi cast;
4. menjaga invariant;
5. tidak mengekspos detail internal;
6. tidak membuat error compiler mustahil dibaca;
7. bisa berevolusi tanpa merusak pengguna.

### 27.1 Jangan membuat generic jika tidak ada relasi type

Buruk:

```java
interface Logger<T> {
    void log(T value);
}
```

Jika logger memang menerima semua object, cukup:

```java
interface Logger {
    void log(Object value);
}
```

Generic berguna jika type berpengaruh terhadap kontrak:

```java
interface Parser<T> {
    T parse(String text);
}
```

Di sini `T` penting karena return type bergantung pada parser.

### 27.2 Prefer generic pada boundary library, bukan semua class domain

Tidak semua domain model perlu generic.

Terlalu abstrak:

```java
class Case<TStatus, TOfficer, TPayload, TAudit, TRule> { ... }
```

Ini sering membuat domain sulit dibaca.

Lebih baik explicit:

```java
final class EnforcementCase {
    private CaseStatus status;
    private OfficerId assignedOfficer;
    private CasePayload payload;
    private AuditTrail auditTrail;
}
```

Gunakan generics untuk mekanisme reusable, bukan untuk mengaburkan domain.

### 27.3 Return concrete enough, accept abstract enough

Untuk parameter, terima interface luas:

```java
void process(Collection<? extends Command> commands) { ... }
```

Untuk return, berikan kontrak yang cukup jelas:

```java
List<Violation> findViolations(CaseId caseId);
```

Jangan return type terlalu general jika caller butuh behavior spesifik:

```java
Collection<Violation> findViolations(...); // mungkin OK
Iterable<Violation> findViolations(...);   // terlalu lemah jika caller butuh size/order
Object findViolations(...);                // buruk
```

### 27.4 Jangan bocorkan wildcard ke return type tanpa alasan kuat

Return seperti ini sering menyulitkan caller:

```java
List<? extends Event> events();
```

Caller tidak bisa menambah, type spesifik tidak jelas.

Lebih baik:

```java
List<Event> events();
```

Atau jika immutable:

```java
SequencedCollection<Event> events();
```

Wildcard lebih sering cocok untuk parameter daripada return type.

---

## 28. Membaca Signature JDK: `Function<T, R>`

JDK sendiri adalah guru desain generics.

Konsep `Function<T, R>`:

```java
@FunctionalInterface
public interface Function<T, R> {
    R apply(T t);

    default <V> Function<V, R> compose(Function<? super V, ? extends T> before) { ... }

    default <V> Function<T, V> andThen(Function<? super R, ? extends V> after) { ... }
}
```

Mari baca `compose`:

```java
<V> Function<V, R> compose(Function<? super V, ? extends T> before)
```

Jika fungsi utama adalah:

```java
Function<T, R> current
```

Maka `before` harus menerima input awal `V` atau supertype-nya, lalu menghasilkan `T` atau subtype-nya agar bisa diberikan ke `current`.

Mental model:

```text
V -> before -> T -> current -> R
```

Kenapa `? super V` untuk input before?

Karena fungsi yang menerima `Object` juga bisa menerima `V`.

Kenapa `? extends T` untuk output before?

Karena output subtype dari `T` aman diberikan ke fungsi yang butuh `T`.

Ini bukan syntax rumit. Ini encoding variance yang tepat.

---

## 29. Generic Repository Design

Repository generic sering dipakai, tetapi sering juga over-engineered.

Versi minimal:

```java
public interface Repository<E, ID> {
    Optional<E> findById(ID id);
    E save(E entity);
    void deleteById(ID id);
}
```

Contoh:

```java
final class CaseRepository implements Repository<CaseRecord, CaseId> {
    @Override
    public Optional<CaseRecord> findById(CaseId id) { ... }

    @Override
    public CaseRecord save(CaseRecord entity) { ... }

    @Override
    public void deleteById(CaseId id) { ... }
}
```

### 29.1 Kapan generic repository buruk?

Jika semua repository dipaksa punya operasi sama, padahal domain berbeda.

```java
interface CrudRepository<E, ID> {
    E create(E entity);
    E update(E entity);
    void delete(ID id);
    List<E> findAll();
}
```

Untuk regulatory/case management, `delete` mungkin tidak legal secara domain. Case harus archived, voided, withdrawn, superseded, atau marked inactive dengan audit trail.

Generic CRUD bisa merusak invariant domain.

Lebih baik:

```java
interface CaseRepository {
    Optional<CaseRecord> findById(CaseId id);
    CaseRecord save(CaseRecord caseRecord);
}

interface CaseArchivalService {
    ArchivedCase archive(CaseId id, ArchivalReason reason, OfficerId officerId);
}
```

Generics membantu mekanisme, tetapi jangan mengalahkan bahasa domain.

---

## 30. Generic Event Envelope

Event-driven system sering membutuhkan envelope generic.

```java
public record EventEnvelope<T>(
        EventId eventId,
        AggregateId aggregateId,
        Instant occurredAt,
        String eventType,
        int schemaVersion,
        T payload
) {}
```

Pemakaian:

```java
EventEnvelope<CaseAssigned> event = new EventEnvelope<>(
        new EventId("evt-1"),
        new AggregateId("case-1"),
        Instant.now(),
        "case.assigned",
        1,
        new CaseAssigned(new CaseId("case-1"), new OfficerId("officer-1"))
);
```

Manfaat:

- metadata event konsisten;
- payload tetap typed;
- handler bisa spesifik;
- serialization boundary bisa memvalidasi schema.

### 30.1 Handler generic

```java
interface EventHandler<T> {
    void handle(EventEnvelope<T> event);
}
```

Contoh:

```java
final class CaseAssignedHandler implements EventHandler<CaseAssigned> {
    @Override
    public void handle(EventEnvelope<CaseAssigned> event) {
        CaseAssigned payload = event.payload();
        // process
    }
}
```

### 30.2 Masalah runtime dispatch

Karena erasure, runtime tidak bisa langsung tahu `EventHandler<CaseAssigned>` dari object handler tanpa metadata tambahan yang reliable.

Solusi umum:

```java
interface TypedEventHandler<T> {
    Class<T> payloadType();
    void handle(EventEnvelope<T> event);
}
```

```java
final class CaseAssignedHandler implements TypedEventHandler<CaseAssigned> {
    @Override
    public Class<CaseAssigned> payloadType() {
        return CaseAssigned.class;
    }

    @Override
    public void handle(EventEnvelope<CaseAssigned> event) {
        ...
    }
}
```

Untuk payload generic/nested, gunakan `TypeRef<T>`.

---

## 31. Generic Command Handler

Command handler generic:

```java
interface CommandHandler<C, R> {
    R handle(C command);
}
```

Contoh:

```java
record AssignCaseCommand(CaseId caseId, OfficerId officerId) {}
record AssignCaseResult(CaseId caseId, CaseStatus newStatus) {}

final class AssignCaseHandler implements CommandHandler<AssignCaseCommand, AssignCaseResult> {
    @Override
    public AssignCaseResult handle(AssignCaseCommand command) {
        ...
    }
}
```

### 31.1 Dispatcher problem

Naive dispatcher:

```java
final class CommandBus {
    private final Map<Class<?>, CommandHandler<?, ?>> handlers = new HashMap<>();

    public <C, R> void register(Class<C> commandType, CommandHandler<C, R> handler) {
        handlers.put(commandType, handler);
    }

    @SuppressWarnings("unchecked")
    public <C, R> R dispatch(C command) {
        CommandHandler<C, R> handler = (CommandHandler<C, R>) handlers.get(command.getClass());
        return handler.handle(command);
    }
}
```

Unchecked cast tidak bisa sepenuhnya dihindari karena registry runtime memakai `Class<?>`. Tetapi risiko bisa dipusatkan.

Lebih aman:

```java
final class CommandBus {
    private final Map<Class<?>, RegisteredHandler<?, ?>> handlers = new HashMap<>();

    public <C, R> void register(
            Class<C> commandType,
            Class<R> resultType,
            CommandHandler<C, R> handler
    ) {
        handlers.put(commandType, new RegisteredHandler<>(commandType, resultType, handler));
    }

    public <C, R> R dispatch(C command, Class<R> expectedResultType) {
        RegisteredHandler<?, ?> registered = handlers.get(command.getClass());
        if (registered == null) {
            throw new IllegalArgumentException("No handler for " + command.getClass().getName());
        }
        Object result = registered.dispatchRaw(command);
        return expectedResultType.cast(result);
    }

    private record RegisteredHandler<C, R>(
            Class<C> commandType,
            Class<R> resultType,
            CommandHandler<C, R> handler
    ) {
        Object dispatchRaw(Object command) {
            C typedCommand = commandType.cast(command);
            R result = handler.handle(typedCommand);
            return resultType.cast(result);
        }
    }
}
```

Prinsipnya:

- unchecked/raw risk tetap ada di dynamic registry;
- boundary dipersempit;
- runtime validation eksplisit;
- API publik tetap type-safe sebanyak mungkin.

---

## 32. Generic Specification Pattern

Specification pattern cocok dengan generics.

```java
@FunctionalInterface
interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<? super T> other) {
        return candidate -> this.isSatisfiedBy(candidate) && other.isSatisfiedBy(candidate);
    }

    default Specification<T> or(Specification<? super T> other) {
        return candidate -> this.isSatisfiedBy(candidate) || other.isSatisfiedBy(candidate);
    }

    static <T> Specification<T> alwaysTrue() {
        return candidate -> true;
    }
}
```

Kenapa `Specification<? super T>`?

Jika kamu punya `Specification<CaseRecord>`, kamu boleh menggabungkannya dengan `Specification<Object>` atau `Specification<AuditableEntity>` yang lebih umum.

Contoh:

```java
Specification<CaseRecord> isOpen = c -> c.status() == CaseStatus.OPEN;
Specification<AuditableEntity> hasAudit = e -> !e.auditTrail().isEmpty();

Specification<CaseRecord> combined = isOpen.and(hasAudit);
```

Jika `CaseRecord` implements `AuditableEntity`, ini masuk akal.

---

## 33. Generic Mapper

Mapper generic:

```java
interface Mapper<S, T> {
    T map(S source);
}
```

Variance-aware composition:

```java
interface Mapper<S, T> {
    T map(S source);

    default <U> Mapper<S, U> andThen(Mapper<? super T, ? extends U> next) {
        return source -> next.map(this.map(source));
    }
}
```

Contoh:

```java
Mapper<CaseEntity, CaseRecord> entityToDomain = ...;
Mapper<CaseRecord, CaseResponse> domainToResponse = ...;

Mapper<CaseEntity, CaseResponse> pipeline = entityToDomain.andThen(domainToResponse);
```

Generics membantu menjamin pipeline type-compatible.

---

## 34. F-Bounded Polymorphism

F-bounded polymorphism adalah pola seperti:

```java
interface Comparable<T> {
    int compareTo(T other);
}
```

Atau:

```java
abstract class SelfTyped<T extends SelfTyped<T>> {
    abstract T self();
}
```

Contoh fluent builder:

```java
abstract class BaseBuilder<SELF extends BaseBuilder<SELF>> {
    private String name;

    public SELF name(String name) {
        this.name = name;
        return self();
    }

    protected abstract SELF self();
}

final class UserBuilder extends BaseBuilder<UserBuilder> {
    private String email;

    public UserBuilder email(String email) {
        this.email = email;
        return this;
    }

    @Override
    protected UserBuilder self() {
        return this;
    }
}
```

Pemakaian:

```java
new UserBuilder()
        .name("Alice")
        .email("alice@example.com");
```

Tanpa self type, `name()` mungkin return `BaseBuilder`, sehingga method `email()` tidak terlihat setelah chaining.

### 34.1 Risiko F-bounded

F-bounded bisa membuat API sulit dibaca.

Gunakan jika:

- kamu membuat framework/library base class;
- fluent inheritance memang penting;
- ada benefit nyata.

Jangan gunakan hanya agar terlihat advanced.

---

## 35. Staged Builder dengan Generics

Generics bisa memaksa urutan construction.

Misal object butuh `caseId` dan `officerId` sebelum build.

```java
final class AssignmentRequest {
    private final CaseId caseId;
    private final OfficerId officerId;
    private final String note;

    private AssignmentRequest(CaseId caseId, OfficerId officerId, String note) {
        this.caseId = caseId;
        this.officerId = officerId;
        this.note = note;
    }

    interface NeedCaseId {
        NeedOfficerId caseId(CaseId caseId);
    }

    interface NeedOfficerId {
        OptionalStep officerId(OfficerId officerId);
    }

    interface OptionalStep {
        OptionalStep note(String note);
        AssignmentRequest build();
    }

    static NeedCaseId builder() {
        return new Builder();
    }

    private static final class Builder implements NeedCaseId, NeedOfficerId, OptionalStep {
        private CaseId caseId;
        private OfficerId officerId;
        private String note;

        @Override
        public NeedOfficerId caseId(CaseId caseId) {
            this.caseId = Objects.requireNonNull(caseId);
            return this;
        }

        @Override
        public OptionalStep officerId(OfficerId officerId) {
            this.officerId = Objects.requireNonNull(officerId);
            return this;
        }

        @Override
        public OptionalStep note(String note) {
            this.note = note;
            return this;
        }

        @Override
        public AssignmentRequest build() {
            return new AssignmentRequest(caseId, officerId, note);
        }
    }
}
```

Pemakaian:

```java
AssignmentRequest request = AssignmentRequest.builder()
        .caseId(new CaseId("C-1"))
        .officerId(new OfficerId("O-1"))
        .note("Urgent")
        .build();
```

`build()` tidak tersedia sebelum required field diisi.

Ini bukan selalu perlu, tetapi untuk object yang high-risk atau regulatory-sensitive, staged construction bisa mengurangi illegal state.

---

## 36. Type-Safe State Transition

Untuk domain state machine, generics bisa encode transition.

Misal:

```java
sealed interface CaseState permits Draft, Submitted, Assigned, Closed {}
record Draft() implements CaseState {}
record Submitted() implements CaseState {}
record Assigned() implements CaseState {}
record Closed() implements CaseState {}
```

Transition generic:

```java
interface Transition<FROM extends CaseState, TO extends CaseState> {
    TO apply(FROM from);
}
```

Implementasi:

```java
final class SubmitCase implements Transition<Draft, Submitted> {
    @Override
    public Submitted apply(Draft from) {
        return new Submitted();
    }
}

final class AssignCase implements Transition<Submitted, Assigned> {
    @Override
    public Assigned apply(Submitted from) {
        return new Assigned();
    }
}
```

Manfaat:

```java
Transition<Draft, Submitted> submit = new SubmitCase();
Submitted submitted = submit.apply(new Draft());

// submit.apply(new Assigned()); // compile-time error
```

### 36.1 Batas pendekatan ini

Di sistem nyata, state sering berasal dari database sebagai data, bukan object typed static.

```java
CaseStatus status = row.getStatus();
```

Compiler tidak selalu tahu status runtime.

Maka type-safe transition cocok untuk:

- domain modeling internal;
- command construction;
- test model;
- compile-time DSL;
- workflow engine internal.

Tetapi tetap perlu runtime validation ketika state berasal dari external storage/input.

Engineer kuat tahu batas type system: tidak semua invariant runtime bisa dipindahkan ke compile-time.

---

## 37. Generic Result Type

Java tidak punya built-in `Result<T, E>` seperti Rust. Tetapi kita bisa model dengan sealed interface.

```java
sealed interface Result<T, E> permits Result.Ok, Result.Err {
    record Ok<T, E>(T value) implements Result<T, E> {}
    record Err<T, E>(E error) implements Result<T, E> {}

    static <T, E> Result<T, E> ok(T value) {
        return new Ok<>(value);
    }

    static <T, E> Result<T, E> err(E error) {
        return new Err<>(error);
    }
}
```

Pemakaian:

```java
Result<CaseRecord, RejectionReason> result = validate(command);

switch (result) {
    case Result.Ok<CaseRecord, RejectionReason> ok -> process(ok.value());
    case Result.Err<CaseRecord, RejectionReason> err -> reject(err.error());
}
```

Catatan: pattern matching dengan generic type parameter punya batas karena erasure. Jangan mengandalkan runtime check terhadap `Result.Ok<String, X>` vs `Result.Ok<Integer, X>`.

Untuk banyak Java application, exception + domain rejection object tetap lebih idiomatis. Tetapi sealed generic result bisa sangat berguna untuk pipeline validasi murni.

---

## 38. Nullability dan Type System Java

Java type system standar belum membedakan nullable dan non-nullable reference secara native.

```java
String s = null; // legal
```

Maka `String` berarti “bisa String, bisa null”. Ini sumber banyak `NullPointerException`.

Strategi umum:

1. gunakan constructor/factory validation;
2. gunakan `Objects.requireNonNull`;
3. gunakan `Optional<T>` untuk return yang mungkin absent;
4. jangan gunakan `Optional` untuk field entity JPA atau parameter sembarangan;
5. gunakan annotation seperti `@NonNull`, `@Nullable` bila tim punya tooling;
6. gunakan domain type untuk mencegah null meaningful states.

Contoh:

```java
record EmailAddress(String value) {
    EmailAddress {
        Objects.requireNonNull(value, "value");
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
    }
}
```

Generic dengan null:

```java
List<String> names = new ArrayList<>();
names.add(null); // legal secara Java
```

Generics tidak otomatis membuat element non-null.

Jika invariant “tidak boleh null” penting, enforce saat boundary.

---

## 39. Primitive Type Patterns di Java 25

Java 25 membawa preview feature **Primitive Types in Patterns, `instanceof`, and `switch`**.

Tujuan besarnya adalah membuat pattern matching lebih uniform untuk primitive dan reference type.

Contoh arah fitur:

```java
int status = getStatus();

String message = switch (status) {
    case 0 -> "okay";
    case 1 -> "warning";
    case 2 -> "error";
    case int unknown -> "unknown: " + unknown;
};
```

Dan testing conversion:

```java
int i = 100;
if (i instanceof byte) {
    byte b = (byte) i;
}
```

Catatan penting:

- ini preview di Java 25;
- butuh `--enable-preview` untuk compile/run;
- jangan gunakan sembarangan di production policy yang melarang preview feature;
- fitur ini bukan berarti Java 25 sudah punya `List<int>`;
- ini bukan Project Valhalla specialization.

### 39.1 Compile dengan preview

```bash
javac --release 25 --enable-preview Main.java
java --enable-preview Main
```

Preview feature harus diperlakukan sebagai eksplorasi atau keputusan sadar tim, bukan default.

---

## 40. Project Valhalla dan Masa Depan Type System

Project Valhalla adalah project OpenJDK jangka panjang untuk mengatasi pemisahan lama antara primitive dan object, serta meningkatkan layout/performance data.

Arah besarnya mencakup:

1. value classes/objects;
2. null-restricted dan nullable type direction;
3. unifying primitives and classes;
4. universal/specialized generics;
5. parametric JVM;
6. heap flattening dan scalarization.

### 40.1 Apa yang perlu dipahami sekarang?

Untuk Java hingga 25:

- `List<int>` belum menjadi fitur stabil Java SE 25;
- generic Java masih berbasis erasure;
- value class Valhalla masih future/early-access direction, bukan fitur Java 25 reguler;
- primitive type patterns Java 25 adalah preview feature terkait pattern matching, bukan full generics specialization.

### 40.2 Kenapa engineer Java perlu peduli?

Karena banyak trade-off Java hari ini berasal dari:

- boxing overhead;
- object header overhead;
- pointer indirection;
- cache locality buruk;
- generic tidak bisa primitive;
- collection of value-like objects boros memory.

Contoh:

```java
List<Integer> numbers = List.of(1, 2, 3);
```

Ini bukan list of `int`; ini list of references ke `Integer` objects/value-based wrappers.

Untuk data intensif, perbedaan ini penting.

Valhalla berusaha memperbaiki model ini tanpa merusak compatibility Java secara besar-besaran.

---

## 41. Membaca Error Compiler Generics

Compiler error generics sering tampak menakutkan.

Contoh:

```java
List<Integer> ints = List.of(1, 2, 3);
List<Number> nums = ints;
```

Error inti:

```text
List<Integer> cannot be converted to List<Number>
```

Terjemahan mental:

> “Kalau ini diizinkan, kamu bisa memasukkan Double ke list Integer melalui reference List<Number>.”

Contoh wildcard:

```java
void add(List<? extends Number> list) {
    list.add(1);
}
```

Error inti:

> “Aku tahu list ini menghasilkan Number, tetapi aku tidak tahu subtype persisnya. Bisa saja List<Double>. Jadi memasukkan Integer tidak aman.”

Contoh lower bound:

```java
void read(List<? super Integer> list) {
    Integer x = list.get(0); // ERROR
}
```

Terjemahan:

> “Aku tahu list ini bisa menerima Integer, tetapi saat membaca, element-nya hanya pasti Object. Bisa List<Object>.”

---

## 42. Pattern Desain API Berdasarkan Arah Data

Saat mendesain generic API, tanya:

1. Apakah parameter ini hanya dibaca?
2. Apakah parameter ini ditulis?
3. Apakah parameter ini dibaca dan ditulis?
4. Apakah return type harus specific?
5. Apakah type parameter menghubungkan input dan output?
6. Apakah type harus tersedia runtime?
7. Apakah wildcard akan menyulitkan caller?

### 42.1 Hanya baca

```java
void audit(Collection<? extends Auditable> items) { ... }
```

### 42.2 Hanya tulis

```java
void collectViolations(Collection<? super Violation> target) { ... }
```

### 42.3 Baca dan tulis

```java
<T> void normalize(List<T> items, UnaryOperator<T> normalizer) { ... }
```

### 42.4 Input-output relation

```java
<T, R> List<R> map(Collection<T> source, Function<? super T, ? extends R> mapper) { ... }
```

### 42.5 Butuh runtime type

```java
<T> T decode(String json, Class<T> type) { ... }
```

### 42.6 Butuh nested runtime type

```java
<T> T decode(String json, TypeRef<T> type) { ... }
```

---

## 43. Generic Anti-Patterns

### 43.1 Over-generic domain model

```java
class Entity<TId, TStatus, TPayload, TContext, TResult> { ... }
```

Biasanya buruk karena domain language hilang.

### 43.2 Wildcard di mana-mana

```java
Map<? extends String, ? super List<? extends Event>> data
```

Kemungkinan besar API terlalu pintar.

### 43.3 Raw type untuk “biar gampang”

```java
List list = service.findAll();
```

Ini membuka pintu heap pollution.

### 43.4 `@SuppressWarnings("unchecked")` terlalu luas

```java
@SuppressWarnings("unchecked")
class BigService { ... }
```

Ini menyembunyikan warning valid di seluruh class.

Lebih baik suppress di statement/method kecil dengan komentar invariant.

### 43.5 Generic return yang tidak bisa dipenuhi secara aman

```java
<T> T findAnything(String key) { ... }
```

Ini sering bohong. Dari mana implementation tahu `T`?

Lebih baik:

```java
<T> Optional<T> find(String key, Class<T> type) { ... }
```

### 43.6 Menggunakan `Optional<T>` sebagai collection element/field secara membabi buta

```java
List<Optional<String>> values;
```

Kadang valid, tetapi sering menandakan model data belum jelas. Apakah absent berarti unknown, not applicable, unauthorized, belum dihitung, atau memang kosong?

Type system membantu jika semantic-nya dibuat eksplisit:

```java
sealed interface EmailStatus {
    record Present(EmailAddress email) implements EmailStatus {}
    record Missing(MissingReason reason) implements EmailStatus {}
}
```

---

## 44. Type System dan Framework Java

### 44.1 Spring

Spring banyak memakai generics untuk:

- `ApplicationListener<E>`;
- `Converter<S, T>`;
- `Repository<T, ID>`;
- `ResponseEntity<T>`;
- `ParameterizedTypeReference<T>`.

Karena runtime erasure, Spring sering memakai reflection metadata dan type token untuk mempertahankan generic info.

### 44.2 Jackson

Jackson butuh type info untuk deserialize.

```java
List<User> users = objectMapper.readValue(json, new TypeReference<List<User>>() {});
```

Kalau hanya:

```java
List users = objectMapper.readValue(json, List.class);
```

Element biasanya menjadi `LinkedHashMap`, bukan `User`.

### 44.3 JPA/Hibernate

Generic repository bisa nyaman, tetapi entity runtime memakai proxy/enhancement. Jangan terlalu mengandalkan `entity.getClass() == User.class`; proxy bisa subclass.

Gunakan API persistence/framework dengan benar.

### 44.4 Mockito

Generic method dan wildcard bisa membuat stubbing sulit dibaca.

Jika mock generic terlalu rumit, itu sering tanda API terlalu abstrak.

---

## 45. Study Case: Type-Safe Enforcement Workflow

Kita desain workflow sederhana.

### 45.1 Domain IDs

```java
record CaseId(String value) {
    CaseId {
        Objects.requireNonNull(value);
        if (value.isBlank()) throw new IllegalArgumentException("blank case id");
    }
}

record OfficerId(String value) {}
record EventId(String value) {}
```

Ini mencegah `String` tertukar.

### 45.2 Command

```java
sealed interface CaseCommand permits SubmitCase, AssignCase, CloseCase {
    CaseId caseId();
}

record SubmitCase(CaseId caseId) implements CaseCommand {}
record AssignCase(CaseId caseId, OfficerId officerId) implements CaseCommand {}
record CloseCase(CaseId caseId, String reason) implements CaseCommand {}
```

### 45.3 Result

```java
sealed interface CommandResult permits Submitted, Assigned, Closed, Rejected {}
record Submitted(CaseId caseId) implements CommandResult {}
record Assigned(CaseId caseId, OfficerId officerId) implements CommandResult {}
record Closed(CaseId caseId) implements CommandResult {}
record Rejected(CaseId caseId, String reason) implements CommandResult {}
```

### 45.4 Handler generic

```java
interface Handler<C extends CaseCommand, R extends CommandResult> {
    R handle(C command);
}
```

### 45.5 Specific handler

```java
final class AssignCaseHandler implements Handler<AssignCase, Assigned> {
    @Override
    public Assigned handle(AssignCase command) {
        return new Assigned(command.caseId(), command.officerId());
    }
}
```

### 45.6 Trade-off

Compile-time API specific:

```java
Assigned result = new AssignCaseHandler().handle(
        new AssignCase(new CaseId("C-1"), new OfficerId("O-1"))
);
```

Dynamic bus tetap butuh runtime registry:

```java
CommandResult result = commandBus.dispatch(command);
```

Di boundary dynamic, type safety menurun. Maka validasi runtime harus eksplisit.

Inilah pola umum sistem besar:

- internal module bisa type-rich;
- external boundary harus validate;
- dynamic dispatch perlu metadata;
- unchecked cast harus dipusatkan.

---

## 46. Checklist Desain Generic API

Gunakan checklist ini saat code review.

### 46.1 Apakah type parameter perlu?

Jika type parameter tidak menghubungkan input, output, atau state, mungkin tidak perlu.

### 46.2 Apakah wildcard dipakai di posisi tepat?

- hanya baca: `? extends T`;
- hanya tulis: `? super T`;
- baca dan tulis: `T`;
- return: hindari wildcard kecuali ada alasan kuat.

### 46.3 Apakah API membutuhkan runtime type?

Jika ya, sediakan:

```java
Class<T>
Type
TypeRef<T>
```

Jangan membuat method generic yang pura-pura tahu `T` tanpa token.

### 46.4 Apakah ada unchecked warning?

Jika ada:

- kenapa muncul?
- apakah bisa dihindari?
- apakah bisa dipersempit?
- apakah ada runtime validation?
- apakah ada komentar invariant?

### 46.5 Apakah generic memperjelas domain atau mengaburkan?

`Repository<CaseRecord, CaseId>` mungkin jelas.

`Processor<T, U, V, X, Y>` mungkin tidak.

### 46.6 Apakah caller experience baik?

Generic API yang benar secara teori tetapi menyiksa caller bukan API yang baik.

Jika caller harus menulis type witness panjang terus-menerus:

```java
MyApi.<A, B, C, D>doSomething(...)
```

mungkin desainnya perlu disederhanakan.

---

## 47. Latihan Bertahap

### Latihan 1 — Compile-Time vs Runtime Type

Buat contoh:

```java
CharSequence x = "hello";
```

Jawab:

1. compile-time type `x` apa?
2. runtime class object-nya apa?
3. method apa yang bisa dipanggil tanpa cast?
4. bagaimana memakai pattern matching untuk mempersempit type?

### Latihan 2 — Invariance

Buktikan dengan kode kenapa ini illegal:

```java
List<Integer> ints = new ArrayList<>();
List<Number> nums = ints;
```

Tulis skenario apa yang akan rusak jika compiler mengizinkan.

### Latihan 3 — PECS

Buat method:

```java
static <T> void copy(Collection<? extends T> source, Collection<? super T> target)
```

Test dengan:

```java
Collection<Integer> source;
Collection<Number> target1;
Collection<Object> target2;
```

### Latihan 4 — Capture Helper

Implementasikan method:

```java
void swapFirstTwo(List<?> list)
```

Gunakan helper generic agar compile.

### Latihan 5 — Type Token

Buat mini `Registry`:

```java
class Registry {
    <T> void put(Class<T> type, T value);
    <T> Optional<T> get(Class<T> type);
}
```

Pastikan runtime cast memakai `Class.cast`.

### Latihan 6 — Event Handler

Buat:

```java
EventEnvelope<T>
TypedEventHandler<T>
EventDispatcher
```

Dispatcher boleh punya unchecked cast hanya di satu method internal, dengan runtime validation.

### Latihan 7 — State Transition

Modelkan transition:

```java
Draft -> Submitted -> Assigned -> Closed
```

Gunakan generic `Transition<FROM, TO>`.

Kemudian jelaskan batasnya saat state berasal dari database.

---

## 48. Kesalahan yang Harus Mulai Kamu Hindari

1. Menggunakan `String` untuk semua ID domain.
2. Mengabaikan unchecked warning.
3. Memakai raw `List`, `Map`, `Class` tanpa alasan.
4. Membuat generic method `<T> T get()` tanpa type token.
5. Memakai wildcard di return type tanpa kebutuhan.
6. Memakai `? extends` lalu bingung kenapa tidak bisa add.
7. Memakai `? super` lalu bingung kenapa read hanya `Object`.
8. Menyembunyikan cast berbahaya di service besar.
9. Menganggap `List<Integer>` subtype dari `List<Number>`.
10. Mengira `var` berarti dynamic typing.
11. Mengira erasure berarti semua generic metadata hilang total.
12. Mengira reflection selalu bisa mengetahui `T`.
13. Memakai staged/generic builder untuk object sederhana.
14. Membuat abstraction generic sebelum ada kebutuhan nyata.

---

## 49. Mental Model Ringkas

Simpan model ini:

```text
Java type system = kontrak compile-time.
Object runtime = instance class/array di heap.
Reference = nilai yang menunjuk object atau null.
Generic type = relasi type compile-time.
Erasure = generic tidak menjadi runtime specialization.
Wildcard = unknown type dengan batas.
extends = aman membaca sebagai upper bound.
super = aman menulis subtype ke lower bound.
Raw type = jalan compatibility lama, sumber heap pollution.
Type token = cara membawa sebagian type info ke runtime.
Unchecked warning = compiler menyerahkan tanggung jawab ke kamu.
```

Jika kamu memahami ini, error generics Java tidak lagi terasa random.

---

## 50. Hubungan ke Bagian Berikutnya

Bagian berikutnya adalah **Modern Java Language Features**.

Type system yang kita bahas di sini akan menjadi dasar untuk memahami:

- `var`;
- switch expression;
- pattern matching;
- records;
- sealed classes;
- unnamed variables/patterns;
- module import declarations;
- primitive patterns di Java 25;
- bagaimana modern Java semakin bergerak ke arah data-oriented programming yang tetap type-safe.

Tanpa type system, fitur modern Java terlihat seperti syntax sugar. Dengan type system, kamu melihat bahwa fitur-fitur itu adalah alat modeling.

---

# Appendix A — Mini Reference

## A.1 Wildcard Behavior Table

| Type | Bisa read sebagai | Bisa write apa? | Use case |
|---|---|---|---|
| `List<T>` | `T` | `T` | read/write same type |
| `List<?>` | `Object` | hanya `null` | unknown list, inspect metadata |
| `List<? extends Number>` | `Number` | hanya `null` | producer of Number |
| `List<? super Integer>` | `Object` | `Integer` dan subtype Integer | consumer of Integer |

## A.2 Generic Limitation Table

| Keinginan | Bisa? | Alasan |
|---|---:|---|
| `new T()` | Tidak langsung | `T` erased, constructor tidak diketahui |
| `T.class` | Tidak | type variable bukan class literal |
| `value instanceof List<String>` | Tidak | `List<String>` non-reifiable |
| `new List<String>[10]` | Tidak | generic array unsafe |
| overload `List<String>` dan `List<Integer>` | Tidak | erasure clash |
| `List<int>` | Tidak di Java 25 stable | generics masih reference/erasure |
| `Class<T>` untuk `User` | Ya | class token reifiable |
| `TypeRef<List<User>>` | Ya via metadata | bukan specialization runtime |

## A.3 PECS Decision Tree

```text
Apakah method hanya membaca dari parameter?
  Ya -> ? extends T

Apakah method hanya menulis ke parameter?
  Ya -> ? super T

Apakah method membaca dan menulis T?
  Ya -> List<T> / Collection<T>

Apakah type parameter menghubungkan input dan output?
  Ya -> <T>, <R>, dst.

Apakah butuh runtime type?
  Ya -> Class<T> / TypeRef<T>
```

---

# Appendix B — Source Trail Resmi

Sumber utama yang dipakai untuk menyusun materi ini:

1. Java Language Specification, Java SE 25 Edition  
   https://docs.oracle.com/javase/specs/jls/se25/html/index.html

2. JLS SE 25 — Types, Values, and Variables  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

3. JLS SE 25 — Conversions and Contexts  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html

4. JLS SE 25 — Expressions  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html

5. Oracle Java Tutorial — Type Erasure  
   https://docs.oracle.com/javase/tutorial/java/generics/erasure.html

6. JDK 25 API — `java.util.function.Function`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Function.html

7. JEP 507 — Primitive Types in Patterns, `instanceof`, and `switch` Third Preview  
   https://openjdk.org/jeps/507

8. Java SE 25 Preview Spec — Primitive types in patterns, `instanceof`, and `switch`  
   https://docs.oracle.com/en/java/javase/25/docs/specs/primitive-types-in-patterns-instanceof-switch-jls.html

9. Project Valhalla  
   https://openjdk.org/projects/valhalla/

10. Project Valhalla — Value Classes and Objects  
   https://openjdk.org/projects/valhalla/value-objects

---

# Appendix C — Kompetensi yang Harus Bisa Kamu Demonstrasikan

Setelah bagian ini, kamu seharusnya bisa menjelaskan tanpa menghafal:

1. kenapa `List<Integer>` bukan `List<Number>`;
2. kenapa `List<? extends Number>` tidak bisa di-add `Integer`;
3. kenapa `List<? super Integer>` saat dibaca hanya aman sebagai `Object`;
4. kenapa `T` tidak bisa dipakai sebagai `new T()`;
5. kenapa `Class<T>` berguna tetapi tidak cukup untuk `List<User>`;
6. kenapa raw type berbahaya;
7. kenapa unchecked warning harus diperlakukan sebagai design smell;
8. kapan generic type parameter benar-benar memberi value;
9. kapan generic justru mengaburkan domain;
10. bagaimana mendesain API yang fleksibel tanpa kehilangan type safety.

Jika jawabanmu untuk semua ini sudah natural, kamu bukan sekadar “bisa memakai Java generics”; kamu mulai memahami Java sebagai language designer dan library designer.

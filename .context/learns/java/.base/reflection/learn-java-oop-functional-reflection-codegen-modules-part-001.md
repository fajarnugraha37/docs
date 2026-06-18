# learn-java-oop-functional-reflection-codegen-modules-part-001

# Java Type System Deep Dive: Identity, Value, Reference, Nominal Typing

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `001`  
> Fokus: membangun mental model type system Java sebagai fondasi untuk OOP, functional API design, reflection, code generation, dan module/package architecture.

---

## 0. Tujuan Part Ini

Di level beginner, type sering dipahami sebagai “nama sebelum variable”.

```java
String name = "Fajar";
int count = 10;
List<Order> orders = List.of();
```

Di level senior/top engineer, type adalah **kontrak kompilasi, model substitusi, batas operasi yang legal, metadata runtime sebagian, dan alat desain API**.

Part ini menjawab pertanyaan besar:

1. Apa bedanya **type**, **class**, **object**, **reference**, dan **value**?
2. Mengapa Java disebut **nominally typed**, bukan structurally typed?
3. Apa artinya compile-time type berbeda dari runtime class?
4. Mengapa `List<String>` bukan benar-benar ada sebagai class runtime yang berbeda dari `List<Integer>`?
5. Mengapa primitive bukan object?
6. Mengapa `Integer`, `Long`, `BigDecimal`, `String`, `record`, dan entity object harus dipikirkan berbeda?
7. Bagaimana type system memengaruhi desain API, domain model, package boundary, framework, reflection, dan code generation?

Materi ini bukan pengulangan basic Java. Kita akan membangun **mental model yang bisa dipakai saat mendesain sistem besar**.

---

## 1. Type System sebagai “Hukum Operasi”

Type system menjawab pertanyaan:

> Untuk sebuah ekspresi, operasi apa yang boleh dilakukan, nilai apa yang mungkin diwakili, dan assignment/substitution apa yang legal?

Contoh:

```java
String s = "hello";
s.toUpperCase();     // legal
s.deposit(100);      // illegal
```

Bukan karena object string “tidak mau”, tetapi karena compile-time type `String` tidak memiliki operasi `deposit`.

Contoh lain:

```java
Account account = new SavingsAccount();
account.close();
```

Yang menentukan method apa yang bisa dipanggil pada source code adalah **compile-time type** variable `account`, yaitu `Account`. Tetapi implementasi method yang dieksekusi bisa berasal dari **runtime class**, yaitu `SavingsAccount`.

Inilah salah satu pusat mental model Java:

```text
source expression
    ↓
compile-time type determines allowed operations
    ↓
runtime object/class determines actual behavior for virtual dispatch
```

Kalau mental model ini kabur, engineer mudah salah saat membaca polymorphism, reflection, generics, proxy, dan framework magic.

---

## 2. Lima Istilah yang Sering Dicampuradukkan

### 2.1 Type

**Type** adalah kategori nilai dan ekspresi. Type menentukan operasi legal dan aturan assignment.

Contoh type:

```java
int
boolean
String
Object
List<String>
Map<String, Order>
? extends Number
T
OrderStatus[]
```

Dalam Java, ada dua keluarga besar type:

```text
Java types
├── primitive types
│   ├── boolean
│   ├── byte
│   ├── short
│   ├── int
│   ├── long
│   ├── char
│   ├── float
│   └── double
└── reference types
    ├── class types
    ├── interface types
    ├── array types
    ├── type variables
    └── null type
```

Catatan penting: `void` sering muncul dalam pembahasan API/reflection, tetapi secara mental model bukan “type value normal” yang bisa dimiliki variable.

---

### 2.2 Class

**Class** adalah deklarasi blueprint untuk object dan juga unit metadata runtime.

```java
public class Order {
    private final String id;

    public Order(String id) {
        this.id = id;
    }
}
```

`Order` adalah class. Dari class ini, kita bisa membuat object:

```java
Order order = new Order("ORD-001");
```

Tetapi type tidak selalu sama dengan class:

```java
List<String> orders;       // parameterized type, bukan class runtime baru
T value;                   // type variable
? extends Number x;        // wildcard type, tidak bisa jadi deklarasi variable langsung dalam bentuk ini kecuali di generic context
int count;                 // primitive type, bukan class
Order[] array;             // array type, runtime class-nya generated oleh JVM
```

Jadi:

```text
class ⊂ reference type model, tetapi type jauh lebih luas dari class
```

---

### 2.3 Object

**Object** adalah instance runtime dari class atau array.

```java
Order order = new Order("ORD-001");
```

`new Order(...)` menghasilkan object. Variable `order` tidak “berisi object secara langsung”; ia menyimpan **reference** ke object.

Mental model:

```text
variable order
    contains reference ─────► object Order{id="ORD-001"}
```

Object punya:

- identity
- state
- behavior via class methods
- runtime class
- monitor/lock identity
- lifecycle di heap sampai tidak reachable dan akhirnya eligible for GC

---

### 2.4 Reference

**Reference** adalah nilai yang menunjuk ke object atau `null`.

```java
Order a = new Order("1");
Order b = a;
```

`a` dan `b` menyimpan reference ke object yang sama.

```text
a ─┐
   ├──► Order{id="1"}
b ─┘
```

Karena itu:

```java
a == b // true
```

Untuk reference type, variable bukan object. Variable adalah slot yang menyimpan reference.

---

### 2.5 Value

**Value** adalah isi konseptual yang diwakili oleh expression.

Untuk primitive:

```java
int x = 10;
```

`10` adalah primitive value. Tidak ada object identity untuk `10` sebagai `int`.

Untuk reference:

```java
String s = "abc";
```

Nilai expression `s` adalah reference ke object `String`, bukan isi karakter secara langsung.

Di Java saat ini, istilah “value” sering muncul dalam beberapa konteks:

1. **primitive value**: `int`, `long`, `boolean`, dll.
2. **value object secara desain domain**: object yang equality-nya berdasarkan value, misalnya `Money`, `EmailAddress`.
3. **record sebagai value-carrier**: data aggregate yang concise dan immutable-ish.
4. **future/value classes discussion**: bukan fokus part ini.

Jangan campuradukkan primitive value dengan value object desain domain.

---

## 3. Java Bukan “Everything Is Object”

Kalimat “di Java semuanya object” itu salah.

Yang benar:

```text
Java punya primitive types dan reference types.
Primitive values bukan object.
Reference values menunjuk ke object atau null.
```

Contoh:

```java
int x = 42;
Integer y = 42;
Object z = 42;
```

Apa yang terjadi?

```java
int x = 42;
```

`x` adalah primitive `int`.

```java
Integer y = 42;
```

`42` diboxing menjadi `Integer`.

```java
Object z = 42;
```

`42` diboxing menjadi `Integer`, lalu reference `Integer` disimpan ke variable bertype `Object`.

Mental model:

```text
int x = 42
  x contains primitive bits/value

Integer y = 42
  y contains reference ───► Integer object representing 42

Object z = 42
  z contains reference ───► Integer object representing 42
```

Konsekuensi desain:

- primitive tidak bisa `null`
- wrapper bisa `null`
- primitive tidak punya identity
- wrapper punya object identity, tetapi jangan desain logic berdasarkan identity wrapper
- boxing/unboxing bisa terjadi diam-diam
- unboxing `null` menghasilkan `NullPointerException`

Contoh bug:

```java
Integer retryCount = null;

if (retryCount > 0) { // NullPointerException due to unboxing
    // ...
}
```

Lebih aman:

```java
int retryCount = 0;
```

Atau kalau absence meaningful:

```java
OptionalInt retryCount = findRetryCount();
```

Tapi `OptionalInt` juga bukan silver bullet untuk field/domain model; ini akan dibahas di part Optional/result modeling.

---

## 4. Compile-Time Type vs Runtime Class

Ini salah satu konsep paling penting.

```java
CharSequence text = "hello";
```

Compile-time type dari variable `text` adalah `CharSequence`.
Runtime object yang ditunjuk adalah instance `String`.

```java
System.out.println(text.length()); // legal, CharSequence punya length()
System.out.println(text.toUpperCase()); // illegal, CharSequence tidak punya toUpperCase()
```

Padahal runtime object-nya `String`. Compiler tidak menggunakan “kemungkinan runtime” untuk mengizinkan method yang tidak ada di compile-time type.

Untuk memanggil method `String`:

```java
if (text instanceof String s) {
    System.out.println(s.toUpperCase());
}
```

Mental model:

```text
Variable declaration:
    CharSequence text

Compile-time view:
    only CharSequence operations are visible

Runtime reality:
    object may be String, StringBuilder, or another CharSequence implementation
```

### 4.1 Kenapa Ini Penting untuk API Design?

Saat membuat API:

```java
void write(StringBuilder content) { ... }
```

API ini terlalu spesifik jika hanya butuh kemampuan membaca karakter.

Lebih fleksibel:

```java
void write(CharSequence content) { ... }
```

Tetapi jangan selalu generalisasi. Kalau API memang butuh operasi mutasi `StringBuilder`, maka `StringBuilder` benar.

Rule:

```text
Terima type paling umum yang cukup untuk kebutuhan operasi.
Return type paling spesifik yang ingin dijanjikan secara stabil.
```

Contoh:

```java
public List<Order> findOrders() { ... }
```

Lebih baik daripada:

```java
public ArrayList<Order> findOrders() { ... }
```

Karena caller biasanya hanya butuh contract `List`, bukan implementasi `ArrayList`.

Tapi kadang return type spesifik berguna:

```java
public SortedSet<Order> findSortedOrders() { ... }
```

Karena sorting adalah bagian dari contract.

---

## 5. Nominal Typing: Java Percaya Nama dan Deklarasi, Bukan Bentuk

Java adalah **nominally typed language**.

Artinya dua type kompatibel bukan karena “punya method yang sama”, tetapi karena ada hubungan deklaratif bernama:

- extends
- implements
- subtyping built-in
- assignment conversion tertentu

Contoh:

```java
class FileLogger {
    void log(String message) {}
}

class AuditLogger {
    void log(String message) {}
}
```

Walaupun bentuk method-nya sama, `FileLogger` dan `AuditLogger` tidak otomatis substitutable.

```java
void write(FileLogger logger) { }

AuditLogger audit = new AuditLogger();
write(audit); // compile error
```

Agar substitutable, buat contract eksplisit:

```java
interface Logger {
    void log(String message);
}

class FileLogger implements Logger {
    public void log(String message) {}
}

class AuditLogger implements Logger {
    public void log(String message) {}
}

void write(Logger logger) { }
```

Sekarang:

```java
write(new AuditLogger()); // legal
```

### 5.1 Nominal vs Structural Typing

Structural typing akan berpikir:

```text
Kalau object punya method log(String), berarti bisa dipakai sebagai Logger-like thing.
```

Java berpikir:

```text
Harus ada deklarasi bahwa class ini implements Logger.
```

Konsekuensi:

- Contract harus didesain eksplisit.
- Interface adalah boundary yang serius.
- Adapter sering diperlukan untuk integrasi antar library.
- Tidak cukup “bentuknya sama”; harus ada relasi type.
- Public API evolution lebih terkendali karena kompatibilitas berbasis deklarasi.

### 5.2 Benefit Nominal Typing

Nominal typing mengurangi accidental compatibility.

Misalnya:

```java
class Money {
    BigDecimal amount();
}

class Distance {
    BigDecimal amount();
}
```

Secara structural, keduanya bisa terlihat mirip. Tapi secara domain, `Money` bukan `Distance`.

Java memaksa kita membuat relasi eksplisit. Ini sangat penting di domain regulatory, finance, enforcement, case management, dan workflow state modeling karena banyak object terlihat mirip secara data tetapi beda makna.

---

## 6. Subtyping: “Can Be Used As” Bukan “Looks Like”

Subtyping menjawab:

> Apakah nilai dari type A bisa dipakai di tempat yang mengharapkan type B?

Contoh:

```java
String s = "hello";
Object o = s;
CharSequence cs = s;
Serializable ser = s;
```

`String` adalah subtype dari beberapa type:

```text
String
├── Object
├── CharSequence
├── Comparable<String>
├── Serializable
└── Constable / ConstantDesc etc. depending Java version API
```

Subtyping membuat assignment berikut legal:

```java
CharSequence cs = "abc";
Object obj = cs;
```

Tapi arah sebaliknya butuh cast:

```java
Object obj = "abc";
String s = (String) obj; // runtime checked
```

Jika object runtime bukan `String`:

```java
Object obj = 123;
String s = (String) obj; // ClassCastException
```

Mental model:

```text
upcast   : subtype → supertype, aman, implicit
 downcast: supertype → subtype, berisiko, explicit, runtime checked
```

### 6.1 Subtyping Tidak Sama dengan Inheritance Implementation

Interface subtyping:

```java
class CsvExporter implements Exporter { }
```

`CsvExporter` subtype dari `Exporter`, tetapi tidak mewarisi implementation dari interface kecuali default methods.

Class inheritance:

```java
class PremiumCustomer extends Customer { }
```

`PremiumCustomer` subtype dari `Customer` sekaligus mewarisi state/behavior.

Ini beda. Banyak desain rusak karena engineer memakai inheritance hanya untuk reuse, padahal juga menciptakan substitutability relationship.

---

## 7. Assignment Compatibility dan Conversion

Java punya aturan konversi. Yang paling sering muncul dalam desain:

1. identity conversion
2. widening primitive conversion
3. narrowing primitive conversion
4. widening reference conversion
5. narrowing reference conversion
6. boxing conversion
7. unboxing conversion
8. unchecked conversion
9. capture conversion
10. string conversion

Tidak perlu hafal semuanya sekaligus, tapi harus tahu kapan compiler “membantu” dan kapan compiler “memaksa eksplisit”.

### 7.1 Widening Primitive

```java
int i = 10;
long l = i;
double d = l;
```

Umumnya aman dalam rentang representasi, walau bisa ada loss of precision untuk beberapa numeric conversion.

### 7.2 Narrowing Primitive

```java
long l = 10L;
int i = (int) l;
```

Butuh cast karena bisa kehilangan data.

```java
long tooBig = 3_000_000_000L;
int broken = (int) tooBig;
System.out.println(broken); // nilai berubah karena overflow/truncation
```

### 7.3 Widening Reference

```java
String s = "hello";
Object o = s;
CharSequence c = s;
```

Aman dan implicit.

### 7.4 Narrowing Reference

```java
Object o = "hello";
String s = (String) o;
```

Butuh cast dan runtime check.

### 7.5 Boxing/Unboxing

```java
Integer x = 10; // boxing
int y = x;      // unboxing
```

Bug umum:

```java
Integer x = null;
int y = x; // NullPointerException
```

### 7.6 Unchecked Conversion

Generics bisa memunculkan unchecked conversion:

```java
List raw = new ArrayList();
raw.add("hello");

List<Integer> ints = raw; // unchecked warning
Integer n = ints.get(0);  // ClassCastException later
```

Unchecked warning bukan dekorasi. Itu sinyal bahwa compiler tidak bisa membuktikan type safety.

Rule production:

```text
Unchecked warning harus dikurung di boundary kecil, diberi alasan, dan diuji.
Jangan biarkan warning menyebar ke business code.
```

---

## 8. Object Identity vs Equality

### 8.1 Identity

Object identity menjawab:

> Apakah dua reference menunjuk object yang sama?

```java
Order a = new Order("1");
Order b = a;
Order c = new Order("1");

System.out.println(a == b); // true
System.out.println(a == c); // false
```

`a` dan `c` mungkin punya data sama, tetapi object berbeda.

### 8.2 Equality

Equality menjawab:

> Apakah dua object dianggap setara menurut contract domain/class?

```java
record OrderId(String value) {}

OrderId a = new OrderId("ORD-1");
OrderId b = new OrderId("ORD-1");

System.out.println(a == b);      // false
System.out.println(a.equals(b)); // true
```

Record memberikan `equals` berdasarkan component.

### 8.3 Identity-Sensitive Classes

Beberapa object sebaiknya diperlakukan identity-sensitive:

- entity object yang lifecycle-nya penting
- lock object
- connection/session/resource handle
- mutable aggregate root
- actor/agent runtime object
- proxy object tertentu

Beberapa object sebaiknya diperlakukan value-based secara desain:

- `Money`
- `EmailAddress`
- `PostalCode`
- `DateRange`
- `CaseReferenceNo`
- `OrderId`
- `Coordinate`

### 8.4 Wrapper Identity Trap

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b); // often true due to cache

Integer x = 1000;
Integer y = 1000;
System.out.println(x == y); // often false
```

Jangan gunakan `==` untuk wrapper numeric equality. Gunakan `equals` atau unbox secara eksplisit jika aman.

```java
Objects.equals(a, b)
```

---

## 9. Value Object vs Entity: Type System Tidak Menyelamatkan Desain Buruk

Java type system bisa memastikan `Money` tidak tertukar dengan `Distance` jika kita membuat type terpisah.

Buruk:

```java
void pay(BigDecimal amount, String currency) { }
void move(BigDecimal amount, String unit) { }
```

Caller bisa salah:

```java
pay(distanceAmount, "KM");
```

Lebih baik:

```java
record Money(BigDecimal amount, Currency currency) { }
record Distance(BigDecimal value, DistanceUnit unit) { }

void pay(Money money) { }
void move(Distance distance) { }
```

Sekarang compiler membantu menjaga domain.

### 9.1 Primitive Obsession

Primitive obsession terjadi saat domain penting direpresentasikan dengan primitive/string mentah.

Contoh buruk:

```java
void submitAppeal(String caseNo, String officerId, String reasonCode) { }
```

Masalah:

- parameter bisa tertukar
- validation tersebar
- format tidak jelas
- invariant tidak punya rumah
- logging dan masking sulit konsisten

Lebih baik:

```java
record CaseNo(String value) {
    public CaseNo {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("caseNo must not be blank");
        }
    }
}

record OfficerId(String value) { }
record AppealReasonCode(String value) { }

void submitAppeal(CaseNo caseNo, OfficerId officerId, AppealReasonCode reasonCode) { }
```

Type system menjadi alat domain correctness.

---

## 10. Reference Aliasing: Sumber Bug Mutability

Aliasing terjadi saat beberapa reference menunjuk object yang sama.

```java
List<String> a = new ArrayList<>();
List<String> b = a;

b.add("x");
System.out.println(a); // [x]
```

Ini bukan bug Java. Ini konsekuensi reference semantics.

### 10.1 Representation Exposure

```java
class Order {
    private final List<String> items;

    Order(List<String> items) {
        this.items = items;
    }

    List<String> items() {
        return items;
    }
}
```

Caller bisa mengubah state internal:

```java
List<String> items = new ArrayList<>();
Order order = new Order(items);

items.add("A");             // modifies order indirectly
order.items().add("B");     // modifies order directly
```

Lebih aman:

```java
class Order {
    private final List<String> items;

    Order(List<String> items) {
        this.items = List.copyOf(items);
    }

    List<String> items() {
        return items;
    }
}
```

`List.copyOf` membuat unmodifiable copy. Untuk element mutable, ini masih shallow.

### 10.2 Shallow vs Deep Immutability

```java
record LineItem(String sku, MutablePrice price) { }
```

Record tidak otomatis deep immutable. Jika `MutablePrice` mutable, isi record bisa berubah melalui object yang direferensikan.

Mental model:

```text
final reference means reference cannot be reassigned.
It does not mean referenced object cannot mutate.
```

Contoh:

```java
final List<String> list = new ArrayList<>();
list.add("still mutable"); // legal
// list = new ArrayList<>(); // illegal
```

---

## 11. Type, State, and Invariant

Type yang baik bukan hanya membungkus data. Type yang baik menjaga invariant.

Buruk:

```java
record Percentage(BigDecimal value) { }
```

Masih bisa:

```java
new Percentage(new BigDecimal("999"));
new Percentage(null);
```

Lebih baik:

```java
record Percentage(BigDecimal value) {
    public Percentage {
        Objects.requireNonNull(value, "value");
        if (value.compareTo(BigDecimal.ZERO) < 0 ||
            value.compareTo(new BigDecimal("100")) > 0) {
            throw new IllegalArgumentException("percentage must be between 0 and 100");
        }
    }
}
```

Sekarang invariant pindah dari “ingat-ingat di service” ke “dijamin oleh type”.

Top engineer sering berpikir:

```text
Bisakah invalid state dibuat tidak representable?
```

Contoh:

```java
sealed interface SubmissionState permits Draft, Submitted, Approved, Rejected { }

record Draft(CaseNo caseNo) implements SubmissionState { }
record Submitted(CaseNo caseNo, Instant submittedAt) implements SubmissionState { }
record Approved(CaseNo caseNo, Instant approvedAt, OfficerId approvedBy) implements SubmissionState { }
record Rejected(CaseNo caseNo, Instant rejectedAt, OfficerId rejectedBy, String reason) implements SubmissionState { }
```

Ini lebih kuat daripada:

```java
class Submission {
    String status;
    Instant submittedAt;
    Instant approvedAt;
    Instant rejectedAt;
    String rejectedReason;
}
```

Karena kombinasi invalid mudah muncul:

```text
status = APPROVED but rejectedReason != null
status = DRAFT but approvedAt != null
status = REJECTED but reason blank
```

---

## 12. `Object` sebagai Root Reference Type

Hampir semua class reference pada Java memiliki `Object` sebagai ultimate superclass.

Karena itu semua object class normal punya method seperti:

```java
equals
hashCode
toString
getClass
```

Jangan artikan ini sebagai “semua type adalah Object”. Primitive bukan subtype `Object`.

```java
int x = 1;
Object o = x; // boxing to Integer first
```

Yang terjadi bukan `int` menjadi subtype Object. Yang terjadi adalah boxing conversion.

### 12.1 `Object` sebagai API Type

Kadang `Object` benar:

```java
void put(String key, Object value)
```

Misalnya untuk generic attribute map. Tapi sering `Object` adalah tanda desain kabur.

Buruk:

```java
Object process(Object input)
```

Masalah:

- caller tidak tahu contract
- callee harus cast
- error pindah ke runtime
- refactoring sulit
- documentation menggantikan type safety

Lebih baik gunakan generic, interface, sealed type, atau overload yang jelas.

---

## 13. Generics: Compile-Time Type Precision, Runtime Erasure

Generics memungkinkan type parameter:

```java
List<String> names = new ArrayList<>();
names.add("A");
String first = names.get(0);
```

Compiler tahu `names.get(0)` menghasilkan `String`.

Tapi runtime class-nya tetap `ArrayList`, bukan `ArrayList<String>`.

```java
List<String> strings = new ArrayList<>();
List<Integer> integers = new ArrayList<>();

System.out.println(strings.getClass() == integers.getClass()); // true
```

Ini karena Java generics menggunakan **type erasure**.

Mental model:

```text
Source:
    List<String>
    List<Integer>

Compile-time:
    compiler checks element type safety

Bytecode/runtime:
    mostly raw List/ArrayList + casts/metadata signatures as needed
```

### 13.1 Mengapa Erasure Ada?

Generics ditambahkan ke Java dengan tujuan kompatibilitas besar terhadap library dan bytecode lama. Erasure membuat generic type tidak menghasilkan class runtime baru untuk setiap parameterization.

Konsekuensi:

```java
if (list instanceof List<String>) { } // illegal
```

Karena runtime tidak punya informasi penuh untuk membedakan `List<String>` dari `List<Integer>`.

Yang bisa:

```java
if (list instanceof List<?>) { }
```

### 13.2 Reifiable vs Non-Reifiable

Type reifiable adalah type yang informasi runtime-nya tersedia secara penuh atau cukup representable.

Contoh reifiable:

```java
String
int
String[]
List<?> 
raw List
```

Non-reifiable:

```java
List<String>
List<Integer>
T
List<T>
Map<String, List<Order>>
```

Konsekuensi:

```java
new List<String>[10]; // illegal
```

Array tahu component type runtime, sedangkan generics erased. Kombinasi array covariance dan generic invariance bisa berbahaya.

---

## 14. Generic Invariance: `List<Integer>` Bukan Subtype dari `List<Number>`

Banyak orang terjebak di sini.

```java
List<Integer> ints = new ArrayList<>();
List<Number> nums = ints; // compile error
```

Kenapa?

Kalau legal:

```java
List<Integer> ints = new ArrayList<>();
List<Number> nums = ints;
nums.add(3.14); // Double adalah Number
Integer x = ints.get(0); // rusak
```

Maka type safety hancur.

Jadi generic Java invariant:

```text
Integer <: Number
List<Integer> is not <: List<Number>
```

### 14.1 Wildcards untuk Variance

Producer:

```java
void printAll(List<? extends Number> numbers) {
    for (Number n : numbers) {
        System.out.println(n);
    }
}
```

Bisa menerima:

```java
List<Integer>
List<Long>
List<BigDecimal>
```

Tapi tidak aman untuk add `Number` arbitrary:

```java
numbers.add(1); // compile error, except null
```

Consumer:

```java
void addIntegers(List<? super Integer> target) {
    target.add(1);
    target.add(2);
}
```

Bisa menerima:

```java
List<Integer>
List<Number>
List<Object>
```

Rule PECS:

```text
Producer Extends, Consumer Super
```

Tetapi jangan pakai PECS secara dogmatis. Tanya dulu:

```text
Apakah parameter ini memproduksi T untuk saya baca?
Apakah parameter ini mengonsumsi T yang saya tulis?
Apakah dua-duanya? Jika dua-duanya, mungkin butuh invariant T.
```

---

## 15. Raw Type: Lubang dari Masa Lalu

Raw type:

```java
List list = new ArrayList();
```

Ini menghilangkan parameter type.

```java
List<String> names = new ArrayList<>();
List raw = names;
raw.add(123);

String s = names.get(0); // ClassCastException
```

Raw type membuat compiler tidak bisa melindungi Anda.

Guideline:

```text
Raw type hanya boleh muncul di boundary legacy/reflection tertentu.
Jangan di business code baru.
```

Jika tidak tahu element type:

```java
List<?> values
```

lebih aman daripada:

```java
List values
```

Karena `List<?>` mengatakan:

```text
Saya punya list dengan element type tertentu, tapi saya tidak tahu type-nya.
Karena tidak tahu, saya tidak boleh sembarang menambahkan element.
```

---

## 16. Type Erasure and Bridge Methods

Karena generics dihapus sebagian saat compile, compiler kadang membuat bridge method untuk menjaga polymorphism.

Contoh konseptual:

```java
class Box<T> {
    void set(T value) { }
}

class StringBox extends Box<String> {
    @Override
    void set(String value) { }
}
```

Setelah erasure, `Box<T>.set(T)` menjadi kira-kira:

```java
void set(Object value)
```

Tetapi `StringBox.set(String)` tidak punya signature sama dengan `set(Object)`. Agar overriding tetap bekerja sesuai model source, compiler membuat bridge method synthetic.

Kira-kira:

```java
void set(Object value) {
    set((String) value);
}
```

Konsekuensi:

- reflection bisa melihat method synthetic/bridge
- stack trace bisa mengandung detail yang membingungkan
- library yang menganalisis method harus sadar bridge method
- framework mapper/serializer/proxy harus hati-hati memilih method

---

## 17. Arrays: Reified, Covariant, Runtime-Checked

Array berbeda dari generics.

```java
String[] strings = new String[10];
Object[] objects = strings; // legal karena arrays covariant
objects[0] = 123;           // ArrayStoreException runtime
```

Array tahu component type runtime. Karena itu assignment ke array bisa dicek runtime.

Generics invariant dan erased:

```java
List<String> strings = new ArrayList<>();
// List<Object> objects = strings; // illegal compile-time
```

Mental model:

```text
Array:
  covariant + reified + runtime store check

Generics:
  invariant by default + erased + compile-time check
```

Guideline:

- Gunakan array untuk low-level fixed-size / interop / performance-sensitive cases.
- Gunakan generic collections untuk domain/business collection API.
- Hati-hati varargs generic karena bisa heap pollution.

---

## 18. `Class<T>` dan Type Token

`Class<T>` adalah representasi runtime class.

```java
Class<String> type = String.class;
```

Berguna untuk API yang butuh runtime type:

```java
<T> T decode(String json, Class<T> type) { ... }
```

Pemakaian:

```java
User user = decode(json, User.class);
```

Tetapi `Class<T>` tidak cukup untuk generic nested type:

```java
List<User> users = decode(json, List.class); // loses User type
```

Karena `List<User>` bukan class runtime terpisah.

Untuk generic type lengkap, framework biasanya memakai type token:

```java
TypeReference<List<User>> ref = new TypeReference<>() {};
```

Atau Java reflection `ParameterizedType`.

Mental model:

```text
Class<T> good for concrete reifiable class.
Type/ParameterizedType needed for generic structure metadata.
```

---

## 19. Null Type: Nilai yang Bisa Menyusup ke Hampir Semua Reference Type

`null` adalah nilai khusus yang bisa assigned ke reference type.

```java
String s = null;
List<Order> orders = null;
Runnable r = null;
```

Tidak bisa assigned ke primitive:

```java
int x = null; // compile error
```

Null membuat type system Java tidak sepenuhnya menjamin absence-safety.

```java
String name = findName();
System.out.println(name.length()); // possible NPE
```

### 19.1 Nullability Tidak Terlihat di Type Bawaan

```java
String name
```

Tidak menjawab:

```text
Apakah name boleh null?
```

Solusi desain:

1. Jangan return null jika bisa return empty collection.
2. Gunakan `Optional<T>` untuk return absence yang eksplisit.
3. Gunakan validation di constructor/boundary.
4. Gunakan annotation nullness jika tim punya tool support.
5. Buat domain type yang tidak bisa invalid.

Contoh:

```java
record EmailAddress(String value) {
    public EmailAddress {
        Objects.requireNonNull(value, "value");
        if (!value.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
    }
}
```

---

## 20. Type Inference: Convenience, Bukan Hilangnya Type

Java punya type inference:

```java
var name = "Fajar";
var orders = List.of(new OrderId("1"));
```

`var` bukan dynamic typing. Compiler tetap menentukan static type.

```java
var text = "hello";
text = 123; // compile error
```

Type `text` adalah `String`.

### 20.1 Kapan `var` Bagus?

Bagus saat RHS jelas:

```java
var customer = customerRepository.findById(id).orElseThrow();
var total = price.multiply(quantity);
```

Buruk saat menghilangkan informasi penting:

```java
var result = service.process(input);
```

Jika `process` tidak jelas, explicit type membantu pembaca.

```java
ValidationResult result = service.process(input);
```

Guideline:

```text
Gunakan var untuk mengurangi noise, bukan menghapus domain meaning.
```

---

## 21. Static Type, Dynamic Behavior: Polymorphism yang Benar

```java
interface FeePolicy {
    Money calculate(CaseApplication application);
}

final class StandardFeePolicy implements FeePolicy {
    public Money calculate(CaseApplication application) { ... }
}

final class WaivedFeePolicy implements FeePolicy {
    public Money calculate(CaseApplication application) { ... }
}
```

Client:

```java
FeePolicy policy = selectPolicy(application);
Money fee = policy.calculate(application);
```

Compile-time type: `FeePolicy`.
Runtime class: `StandardFeePolicy` atau `WaivedFeePolicy`.

Polymorphism baik jika:

- caller hanya butuh contract
- variasi behavior tersembunyi di implementasi
- subtype benar-benar substitutable
- tidak perlu `instanceof` terus-menerus

Polymorphism buruk jika:

```java
if (policy instanceof StandardFeePolicy) { ... }
else if (policy instanceof WaivedFeePolicy) { ... }
```

Kalau caller terus memeriksa subtype, abstraction mungkin salah.

Namun ada pengecualian: sealed hierarchy + pattern matching memang sengaja membuat closed set dan explicit branching.

---

## 22. Type System dan API Surface

API adalah janji. Type adalah bagian dari janji.

```java
public ArrayList<Order> findOrders()
```

Anda menjanjikan `ArrayList`. Nanti mengganti ke `LinkedList` atau immutable list bisa merusak caller.

Lebih stabil:

```java
public List<Order> findOrders()
```

Tapi masih ada pertanyaan:

- Apakah list mutable?
- Apakah urutan penting?
- Apakah duplicate boleh?
- Apakah empty list mungkin?
- Apakah null element boleh?

Type `List<Order>` tidak menjawab semua.

Kadang type yang lebih domain-specific lebih baik:

```java
public OrderSearchResult findOrders(OrderSearchQuery query)
```

Dengan:

```java
record OrderSearchResult(
    List<OrderSummary> orders,
    PageInfo pageInfo
) {
    public OrderSearchResult {
        orders = List.copyOf(orders);
        Objects.requireNonNull(pageInfo);
    }
}
```

### 22.1 API Parameter Design

Buruk:

```java
void assign(String caseId, String officerId, boolean notify, boolean escalate)
```

Masalah:

```java
assign("C-1", "O-1", true, false);
```

Apa arti `true, false`?

Lebih baik:

```java
record AssignmentCommand(
    CaseId caseId,
    OfficerId officerId,
    NotificationPreference notification,
    EscalationPreference escalation
) { }

void assign(AssignmentCommand command)
```

Atau enum:

```java
enum NotificationPreference { NOTIFY, DO_NOT_NOTIFY }
enum EscalationPreference { ESCALATE, DO_NOT_ESCALATE }
```

Type system sekarang membawa meaning.

---

## 23. Type System dan Domain State

State sering salah didesain sebagai string/status enum + banyak nullable fields.

Contoh lemah:

```java
class CaseFile {
    String status;
    Instant assignedAt;
    Instant closedAt;
    String closureReason;
}
```

Masalah:

- `closedAt` bisa ada saat status masih `OPEN`
- `closureReason` bisa null saat closed
- status typo jika string
- transition rules tersebar

Lebih kuat:

```java
sealed interface CaseState permits OpenCase, AssignedCase, ClosedCase { }

record OpenCase(CaseId caseId) implements CaseState { }

record AssignedCase(
    CaseId caseId,
    OfficerId officerId,
    Instant assignedAt
) implements CaseState { }

record ClosedCase(
    CaseId caseId,
    Instant closedAt,
    ClosureReason reason
) implements CaseState { }
```

Sekarang data yang relevan hidup bersama state-nya.

### 23.1 Transition API

```java
final class CaseWorkflow {
    AssignedCase assign(OpenCase open, OfficerId officerId, Clock clock) {
        return new AssignedCase(open.caseId(), officerId, Instant.now(clock));
    }

    ClosedCase close(AssignedCase assigned, ClosureReason reason, Clock clock) {
        return new ClosedCase(assigned.caseId(), Instant.now(clock), reason);
    }
}
```

Tidak ada method `close(OpenCase)` jika domain tidak mengizinkan.

Ini contoh menjadikan invalid transition tidak representable di API.

---

## 24. Type System dan Framework Reality

Enterprise Java sering memakai framework yang bekerja via reflection/proxy/serialization.

Framework bisa melemahkan type discipline jika tidak hati-hati.

Contoh:

```java
class UserDto {
    public String email;
}
```

Framework mudah mengisi field, tetapi invariant tidak terjaga.

Lebih baik:

```java
record CreateUserRequest(String email) { }
```

Lalu di boundary:

```java
EmailAddress emailAddress = new EmailAddress(request.email());
```

Jangan biarkan DTO boundary dianggap domain object.

Mental model:

```text
External payload type != domain type
Persistence type != domain type
Reflection-populated type != invariant-safe type
Generated type != public domain language automatically
```

---

## 25. Type System dan Reflection

Reflection memungkinkan membaca/memanggil member runtime.

```java
Class<?> clazz = object.getClass();
```

Tetapi reflection tidak menghapus type system; ia memindahkan sebagian checking dari compile-time ke runtime.

Contoh:

```java
Method method = clazz.getMethod("calculate", CaseApplication.class);
Object result = method.invoke(policy, application);
```

Compile-time tidak tahu result type selain `Object`.

Anda harus cast:

```java
Money money = (Money) result;
```

Risiko:

- typo method name
- wrong parameter type
- illegal access
- invocation target exception
- wrong cast
- module access violation

Reflection harus diperlakukan sebagai boundary unsafe.

Guideline:

```text
Reflection boleh ada, tetapi jangan bocorkan dynamic unsafety ke seluruh codebase.
Bungkus dalam typed API kecil.
```

Contoh:

```java
final class FeePolicyInvoker {
    private final Method calculateMethod;

    FeePolicyInvoker(Class<?> policyClass) {
        try {
            this.calculateMethod = policyClass.getMethod("calculate", CaseApplication.class);
        } catch (NoSuchMethodException e) {
            throw new IllegalArgumentException("Invalid fee policy class", e);
        }
    }

    Money calculate(Object policy, CaseApplication application) {
        try {
            return (Money) calculateMethod.invoke(policy, application);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Failed to invoke fee policy", e);
        }
    }
}
```

Business code tetap typed:

```java
Money fee = invoker.calculate(policy, application);
```

---

## 26. Type System dan Code Generation

Code generation sering dipakai untuk:

- mapper
- API client
- DTO
- query DSL
- validation metadata
- serialization adapter
- dependency injection wiring

Generated code bisa memperkuat atau melemahkan type safety.

### 26.1 Weak Generated Code

```java
Map<String, Object> payload = generatedClient.call("/cases", params);
String id = (String) payload.get("caseId");
```

Ini runtime-typed, fragile, stringly typed.

### 26.2 Strong Generated Code

```java
CaseResponse response = caseClient.findCase(new CaseRequest(caseId));
CaseId id = response.caseId();
```

Generated code menjadi typed boundary.

### 26.3 Generator Design Rule

Generator harus menghasilkan API yang:

- compile-time safe
- nullability explicit jika mungkin
- tidak membocorkan raw `Object`
- tidak membocorkan raw map jika schema known
- punya stable package naming
- memisahkan generated package dari handwritten package
- punya compatibility strategy

Generated code yang buruk hanya memindahkan parsing string dari tangan manusia ke mesin, tapi tetap membuat sistem rapuh.

---

## 27. Type System dan Modules/Packages

Type tidak hidup sendirian. Type tinggal dalam package, package tinggal dalam module/artifact.

```text
com.company.case.domain.CaseId
com.company.case.domain.CaseState
com.company.case.application.AssignCaseUseCase
com.company.case.infrastructure.persistence.CaseEntity
```

Package boundary membantu menjawab:

```text
Siapa boleh membuat type ini?
Siapa boleh melihat constructor ini?
Siapa boleh mengakses implementation ini?
```

Contoh:

```java
package com.company.case.domain;

public sealed interface CaseState permits OpenCase, AssignedCase, ClosedCase { }
```

Jika implementation public, semua module bisa bergantung padanya.

Kadang kita ingin:

```java
public interface CaseState { }
final class OpenCase implements CaseState { }
```

Package-private implementation membuat construction dikendalikan package.

JPMS menambah level boundary:

```java
module com.company.case.domain {
    exports com.company.case.domain.api;
    // internal package not exported
}
```

Artinya type public di package internal pun tidak otomatis accessible dari module lain jika package tidak diekspor.

---

## 28. Type Design Decision Matrix

Saat mendesain konsep baru, tanyakan:

| Pertanyaan | Pilihan Type | Contoh |
|---|---|---|
| Apakah hanya angka tanpa domain meaning? | primitive/wrapper | `int retryCount` |
| Apakah angka punya unit/invariant? | value object/record | `Money`, `Distance` |
| Apakah finite set tetap? | enum | `CasePriority` |
| Apakah finite set dengan data/behavior berbeda? | sealed hierarchy | `CaseState` |
| Apakah behavior bervariasi dan open-ended? | interface | `FeePolicy` |
| Apakah data carrier immutable-ish? | record | `CaseSummary` |
| Apakah entity punya lifecycle identity? | class | `CaseFile` |
| Apakah butuh extension by third party? | public interface/SPI | `NotificationProvider` |
| Apakah hanya internal implementation? | package-private class | `DefaultCaseValidator` |
| Apakah type hanya untuk generated boundary? | generated DTO/package | `CaseApiResponse` |

---

## 29. Common Type System Smells

### 29.1 Stringly Typed Domain

```java
void updateStatus(String status)
```

Lebih baik:

```java
void updateStatus(CaseStatus status)
```

Atau sealed transition model.

### 29.2 Boolean Parameter Trap

```java
submit(caseId, true, false);
```

Lebih baik enum/command object.

### 29.3 Raw Collections

```java
List results = repository.find();
```

Lebih baik:

```java
List<CaseSummary> results = repository.find();
```

### 29.4 `Map<String, Object>` Everywhere

Kadang perlu untuk dynamic payload. Tapi kalau schema diketahui, buat type.

### 29.5 Over-Generalized `Object`

```java
Object handle(Object command)
```

Lebih baik generic typed interface atau sealed command hierarchy.

### 29.6 Premature Generic Abstraction

```java
interface Repository<T, ID, C, U, Q, R> { ... }
```

Jika generic parameter tidak punya semantic stabil, API menjadi sulit dibaca.

### 29.7 Leaky Implementation Type

```java
public HashMap<String, List<Order>> indexOrders()
```

Return type terlalu implementation-specific.

### 29.8 Null-Ambiguous API

```java
User findUser(UserId id)
```

Apakah return null jika tidak ditemukan? Lebih jelas:

```java
Optional<User> findUser(UserId id)
```

Atau:

```java
User getRequiredUser(UserId id)
```

Dengan exception contract jelas.

---

## 30. Case Study: Designing Types for Enforcement Case Assignment

Misal kita punya workflow assignment case.

### 30.1 Naive Design

```java
void assignCase(String caseNo, String officerId, String priority, boolean notify, Map<String, Object> metadata) {
    // ...
}
```

Masalah:

- `caseNo` dan `officerId` sama-sama string, bisa tertukar
- priority string bisa typo
- notify boolean tidak jelas
- metadata dynamic tanpa schema
- invariant tersebar
- test harus cover banyak invalid combination runtime

### 30.2 Stronger Type Design

```java
record CaseNo(String value) {
    public CaseNo {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("caseNo must not be blank");
        }
    }
}

record OfficerId(String value) {
    public OfficerId {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) {
            throw new IllegalArgumentException("officerId must not be blank");
        }
    }
}

enum CasePriority {
    LOW,
    NORMAL,
    HIGH,
    URGENT
}

enum NotificationMode {
    NOTIFY_ASSIGNEE,
    DO_NOT_NOTIFY
}

record AssignmentMetadata(
    String source,
    String reason
) {
    public AssignmentMetadata {
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(reason, "reason");
    }
}

record AssignCaseCommand(
    CaseNo caseNo,
    OfficerId officerId,
    CasePriority priority,
    NotificationMode notificationMode,
    AssignmentMetadata metadata
) {
    public AssignCaseCommand {
        Objects.requireNonNull(caseNo, "caseNo");
        Objects.requireNonNull(officerId, "officerId");
        Objects.requireNonNull(priority, "priority");
        Objects.requireNonNull(notificationMode, "notificationMode");
        Objects.requireNonNull(metadata, "metadata");
    }
}
```

Use case:

```java
AssignmentResult assign(AssignCaseCommand command) {
    // command sudah melewati invariant dasar
}
```

### 30.3 Apa yang Berubah?

Sebelumnya:

```text
Correctness bergantung pada caller discipline + runtime validation tersebar.
```

Sesudah:

```text
Sebagian correctness dipindahkan ke type construction + compiler.
```

Ini bukan berarti tidak perlu validation. Tapi validation menjadi lebih terstruktur:

```text
External input validation
    ↓
construct domain types
    ↓
application use case receives valid typed command
    ↓
domain rules validate contextual constraints
```

---

## 31. Case Study: API Type Generality

Misal kita membuat formatter:

```java
String format(StringBuilder input) { ... }
```

Jika hanya membaca char sequence, ini terlalu sempit.

Lebih baik:

```java
String format(CharSequence input) { ... }
```

Tetapi jika perlu mutasi:

```java
void normalizeInPlace(StringBuilder input) { ... }
```

`StringBuilder` tepat karena mutability adalah bagian dari contract.

### 31.1 Collection Parameter

Buruk:

```java
void process(ArrayList<Order> orders)
```

Lebih baik jika hanya iterasi:

```java
void process(Iterable<Order> orders)
```

Jika butuh size:

```java
void process(Collection<Order> orders)
```

Jika butuh index:

```java
void process(List<Order> orders)
```

Jika butuh uniqueness:

```java
void process(Set<Order> orders)
```

Jika butuh sorted contract:

```java
void process(SortedSet<Order> orders)
```

Rule:

```text
Pilih type berdasarkan operasi dan semantic contract, bukan berdasarkan class yang kebetulan dipakai sekarang.
```

---

## 32. Case Study: Generic API yang Benar-Benar Berguna

Naive:

```java
interface Validator<T> {
    List<String> validate(T value);
}
```

Lebih domain-aware:

```java
interface Validator<T> {
    ValidationResult validate(T value);
}

record ValidationResult(List<Violation> violations) {
    public ValidationResult {
        violations = List.copyOf(violations);
    }

    boolean isValid() {
        return violations.isEmpty();
    }
}

record Violation(String path, String code, String message) { }
```

Generic `T` punya makna: validator untuk type tertentu.

Pemakaian:

```java
Validator<AssignCaseCommand> validator = new AssignCaseCommandValidator();
ValidationResult result = validator.validate(command);
```

Generic yang baik memperkuat hubungan type.

Generic yang buruk hanya membuat API abstrak tapi tidak menambah correctness.

---

## 33. How Top Engineers Read Java Type Signatures

Saat melihat signature:

```java
public <T extends CaseEvent> List<T> findEvents(CaseNo caseNo, Class<T> eventType)
```

Jangan hanya baca “method find events”. Baca secara type-level:

```text
- Method generic dengan type variable T.
- T dibatasi subtype CaseEvent.
- Caller menyediakan Class<T> sebagai runtime token.
- Return list element type sama dengan eventType.
- API mencoba menghubungkan compile-time generic dengan runtime class token.
```

Saat melihat:

```java
public void publish(List<? extends DomainEvent> events)
```

Baca:

```text
- Method menerima list producer event.
- Bisa membaca events sebagai DomainEvent.
- Tidak boleh menambahkan arbitrary DomainEvent ke list.
- Cocok untuk publish-only use case.
```

Saat melihat:

```java
public void register(List<? super CaseEvent> sink)
```

Baca:

```text
- Method ingin menulis CaseEvent ke sink.
- Sink boleh List<CaseEvent>, List<DomainEvent>, atau List<Object>.
- Saat membaca dari sink, type aman hanya Object.
```

---

## 34. Type System Checklist untuk API Review

Gunakan checklist ini saat review PR/design.

### 34.1 Domain Meaning

- Apakah `String`, `Long`, `BigDecimal`, `boolean` sebenarnya menyembunyikan domain concept?
- Apakah parameter primitive bisa tertukar?
- Apakah unit/format/invariant jelas?
- Apakah type membuat invalid value sulit dibuat?

### 34.2 Nullability

- Apakah parameter boleh null?
- Apakah return value boleh null?
- Apakah empty collection lebih tepat?
- Apakah Optional tepat untuk return?
- Apakah constructor menjaga non-null invariant?

### 34.3 Mutability

- Apakah object mutable?
- Apakah list/map internal bocor?
- Apakah `final` disalahartikan sebagai immutable?
- Apakah defensive copy dibutuhkan?
- Apakah equality aman jika object mutable?

### 34.4 Subtyping

- Apakah inheritance menyatakan substitutability yang benar?
- Apakah interface terlalu besar?
- Apakah caller bergantung ke implementation class?
- Apakah abstraction membuat code lebih jelas atau hanya ceremony?

### 34.5 Generics

- Apakah generic parameter benar-benar membawa informasi type?
- Apakah wildcard diperlukan?
- Apakah raw type muncul?
- Apakah unchecked warning dikurung?
- Apakah type token diperlukan untuk runtime generic metadata?

### 34.6 API Stability

- Apakah return type terlalu spesifik?
- Apakah public type expose implementation detail?
- Apakah enum/record/sealed hierarchy akan sulit dievolusi?
- Apakah package boundary jelas?

---

## 35. Exercises

### Exercise 1 — Replace Primitive Obsession

Refactor signature ini:

```java
void scheduleInspection(String caseNo, String date, String officerId, boolean urgent)
```

Target:

- buat domain type minimal
- hindari boolean trap
- pastikan invalid basic state tidak representable

Contoh arah solusi:

```java
record CaseNo(String value) { ... }
record OfficerId(String value) { ... }
record InspectionDate(LocalDate value) { ... }
enum Urgency { NORMAL, URGENT }
record ScheduleInspectionCommand(...) { ... }
```

### Exercise 2 — Explain Compile-Time vs Runtime Type

Jelaskan output/compile error:

```java
CharSequence cs = "hello";
System.out.println(cs.length());
System.out.println(cs.toUpperCase());
```

Lalu perbaiki dengan pattern matching `instanceof`.

### Exercise 3 — Generic Variance

Kenapa ini error?

```java
List<Integer> ints = List.of(1, 2, 3);
List<Number> nums = ints;
```

Buat dua method:

```java
void readNumbers(List<? extends Number> numbers)
void addIntegers(List<? super Integer> numbers)
```

Jelaskan operasi yang legal dan illegal di masing-masing method.

### Exercise 4 — Reflection Boundary

Buat wrapper typed di sekitar reflective method invocation agar business code tidak menerima `Object` mentah.

### Exercise 5 — State Modeling

Ubah model ini menjadi sealed hierarchy:

```java
class Application {
    String status;
    Instant submittedAt;
    Instant approvedAt;
    String rejectionReason;
}
```

Pastikan state invalid tidak mudah direpresentasikan.

---

## 36. Key Takeaways

1. Type bukan sekadar deklarasi variable; type adalah contract operasi dan substitusi.
2. Java punya primitive types dan reference types; tidak semua hal adalah object.
3. Variable reference type menyimpan reference, bukan object secara langsung.
4. Compile-time type menentukan operasi yang legal; runtime class menentukan behavior polymorphic.
5. Java nominally typed: compatibility berbasis deklarasi, bukan bentuk method kebetulan sama.
6. Subtyping adalah janji substitutability, bukan sekadar reuse implementation.
7. Object identity (`==`) berbeda dari equality (`equals`).
8. Mutability dan aliasing adalah sumber bug besar dalam object design.
9. Generics memberi compile-time precision, tetapi runtime memakai erasure.
10. `List<Integer>` bukan subtype dari `List<Number>` karena generic invariance.
11. Wildcard digunakan untuk variance: producer extends, consumer super.
12. Raw type adalah lubang type safety dan harus dikurung.
13. Reflection/code generation harus dibungkus typed boundary agar unsafety tidak bocor.
14. Type design yang baik membuat invalid state lebih sulit direpresentasikan.
15. Top engineer memakai type system sebagai alat desain domain, API stability, dan architectural boundary.

---

## 37. Referensi Resmi dan Bacaan Lanjutan

- Oracle Java Language Specification, Java SE 25, Chapter 4: Types, Values, and Variables.  
  https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html

- Oracle Java Language Specification, Java SE 25, Chapter 5: Conversions and Contexts.  
  https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html

- Oracle Java Language Specification, Java SE 25, Chapter 8: Classes.  
  https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html

- Oracle Java SE 25 API, `java.lang` package summary.  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/package-summary.html

- Oracle Java Tutorials, Type Erasure.  
  https://docs.oracle.com/javase/tutorial/java/generics/erasure.html

- Oracle Java Tutorials, Effects of Type Erasure and Bridge Methods.  
  https://docs.oracle.com/javase/tutorial/java/generics/bridgeMethods.html

---

## 38. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-002.md
```

Topik berikutnya:

```text
Class Anatomy: Fields, Methods, Constructors, Initializers, Class Loading Semantics
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-000](./learn-java-oop-functional-reflection-codegen-modules-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-002](./learn-java-oop-functional-reflection-codegen-modules-part-002.md)

</div>
# Learn Java Part 003 — Object Model: Class, Object, Constructor, Inheritance, Interface, `Object`, dan Equality

> Target: Java hingga versi 25  
> Audiens: software engineer yang ingin memahami Java secara struktural, bukan sekadar menghafal syntax  
> Fokus: mental model object-oriented Java, initialization order, identity, lifecycle, dispatch, invariant, inheritance, interface, `java.lang.Object`, dan equality contract

---

## 0. Posisi Bagian Ini dalam Kurikulum

Pada bagian sebelumnya kita sudah membahas fondasi bahasa Java dari sisi syntax dan semantics: token, tipe, variabel, ekspresi, statement, conversion, dan kontrol alur. Bagian ini naik satu level: **bagaimana Java memodelkan program melalui class dan object**.

Bagian ini penting karena hampir seluruh framework Java modern dibangun di atas object model:

- Spring menggunakan class, constructor, annotation, proxy, interface, dan lifecycle object.
- Hibernate/JPA bergantung pada class, field, constructor, identity, equality, dan proxy.
- Jackson/Gson/serialization bergantung pada constructor, field, accessor, record, reflection, dan object graph.
- Testing framework seperti JUnit/Mockito bergantung pada class, method, inheritance, interface, proxy, dan dynamic dispatch.
- JVM sendiri mengeksekusi method invocation berdasarkan class metadata, constant pool, method table, interface dispatch, dan runtime type.

Jadi target bagian ini bukan sekadar “bisa membuat class”. Targetnya adalah memahami:

```text
class declaration
  -> compile-time type
  -> class file metadata
  -> class loading
  -> runtime Class object
  -> object allocation
  -> initialization order
  -> method dispatch
  -> identity/equality
  -> lifecycle/reachability
```

Top-tier Java engineer tidak melihat class sebagai “file tempat method ditaruh”, tetapi sebagai **unit kontrak, unit encapsulation, unit runtime metadata, dan unit evolusi API**.

---

## 1. Sumber Resmi yang Menjadi Basis

Materi ini merujuk pada sumber resmi berikut:

1. Java Language Specification SE 25  
   <https://docs.oracle.com/javase/specs/jls/se25/html/index.html>
2. JVM Specification SE 25  
   <https://docs.oracle.com/javase/specs/jvms/se25/html/index.html>
3. Java SE 25 API — `java.lang.Object`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html>
4. JEP 513 — Flexible Constructor Bodies  
   <https://openjdk.org/jeps/513>
5. Oracle Java 25 Language Guide — Flexible Constructor Bodies  
   <https://docs.oracle.com/en/java/javase/25/language/flexible-constructor-bodies.html>
6. JEP 421 — Deprecate Finalization for Removal  
   <https://openjdk.org/jeps/421>

Catatan: bagian ini tetap membahas Java umum, tetapi ketika ada perubahan Java 25 yang relevan, terutama constructor, kita bahas eksplisit.

---

## 2. Mental Model Besar: Class dan Object Itu Berbeda Level

Banyak engineer pemula mencampuradukkan class dan object. Secara praktis memang sering dikatakan:

> Class adalah blueprint, object adalah instance.

Kalimat itu benar tetapi terlalu dangkal. Untuk pemahaman yang lebih kuat, gunakan model berikut:

```text
Source code level:
  class User { ... }

Compile-time level:
  User adalah type.
  Compiler memakai User untuk type checking.

Class-file level:
  User.class berisi metadata, field, method, constructor, constant pool, flags.

Runtime class level:
  JVM memuat User.class menjadi metadata runtime.
  Ada object java.lang.Class<User> yang merepresentasikan type User.

Object level:
  new User(...) membuat instance di heap.
  Instance punya identity, field state, dan akses ke behavior melalui class metadata.
```

Jadi `class User` tidak hanya berarti “template object”. Ia berperan sebagai:

1. **Compile-time type** — compiler menentukan operasi apa yang legal.
2. **Runtime metadata** — JVM tahu layout, method, access rules, inheritance.
3. **Encapsulation boundary** — class mengatur apa yang terlihat keluar.
4. **Initialization unit** — static fields dan static blocks diinisialisasi per class.
5. **API evolution unit** — perubahan class bisa binary compatible atau breaking.
6. **Reflection target** — framework membaca class, field, method, annotation.
7. **Dispatch anchor** — runtime menentukan method mana yang dipanggil berdasarkan type dan hierarchy.

Object juga bukan sekadar “data”. Object di Java punya tiga aspek utama:

```text
object = identity + state + behavior access
```

- **Identity**: object tertentu berbeda dari object lain walau field-nya sama.
- **State**: nilai field instance pada waktu tertentu.
- **Behavior access**: method dipanggil lewat reference, tetapi implementasi method hidup pada class metadata.

Contoh:

```java
final class Money {
    private final String currency;
    private final long cents;

    Money(String currency, long cents) {
        this.currency = currency;
        this.cents = cents;
    }
}

var a = new Money("IDR", 10_000);
var b = new Money("IDR", 10_000);

System.out.println(a == b);      // false: identity berbeda
System.out.println(a.equals(b)); // false jika equals tidak dioverride
```

Secara domain, `a` dan `b` mungkin merepresentasikan nilai yang sama. Tetapi secara object identity, mereka dua instance berbeda.

Inilah sumber banyak bug:

- Mengira dua object dengan field sama pasti equal.
- Menggunakan mutable object sebagai key `HashMap`.
- Salah override `equals` tanpa `hashCode`.
- Membandingkan wrapper/string/entity dengan `==`.
- Mencampur identity database dengan logical equality domain.

---

## 3. Class sebagai Blueprint, Type, dan Runtime Metadata

### 3.1 Bentuk Dasar Class

Class normal memiliki struktur umum:

```java
package com.example.domain;

import java.time.Instant;

public final class CaseRecord {
    private final String id;
    private CaseStatus status;
    private final Instant createdAt;

    public CaseRecord(String id, Instant createdAt) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id must not be blank");
        }
        if (createdAt == null) {
            throw new IllegalArgumentException("createdAt must not be null");
        }
        this.id = id;
        this.status = CaseStatus.DRAFT;
        this.createdAt = createdAt;
    }

    public String id() {
        return id;
    }

    public CaseStatus status() {
        return status;
    }

    public void submit() {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        status = CaseStatus.SUBMITTED;
    }
}
```

Yang tampak sederhana ini mengandung banyak konsep:

| Bagian | Makna |
|---|---|
| `package` | namespace dan boundary akses package-private |
| `import` | kemudahan referensi nama type |
| `public` | akses class dari luar package/module |
| `final` | class tidak dapat disubclass |
| fields | state object |
| constructor | mekanisme validasi dan initialization |
| methods | behavior/API |
| `private` | encapsulation |
| `this` | reference ke current object |

### 3.2 Class Bukan Sekadar File

Di Java, satu file `.java` dapat berisi beberapa top-level class, tetapi hanya satu public top-level class yang namanya sama dengan file. Dalam praktik production, standar yang sehat adalah:

```text
1 public top-level type per file
nama file = nama public type
```

Kenapa?

- Navigasi code lebih mudah.
- Build incremental lebih jelas.
- Code review lebih mudah.
- Refactoring IDE lebih aman.
- Ownership type lebih eksplisit.

Namun nested class, static nested class, local class, dan anonymous class tetap punya tempat yang valid.

### 3.3 Member Class

Class dapat memiliki member:

1. Field
2. Method
3. Constructor
4. Initializer block
5. Static initializer block
6. Nested class/interface/enum/record

Contoh lengkap:

```java
public class Example {
    private static final int DEFAULT_LIMIT = 100;

    static {
        // static initializer: jalan saat class initialization
        System.out.println("Class initialized");
    }

    private final String name;
    private int limit;

    {
        // instance initializer: jalan sebelum constructor body
        limit = DEFAULT_LIMIT;
    }

    public Example(String name) {
        this.name = name;
    }

    public String name() {
        return name;
    }

    public static class Nested {
    }
}
```

Mental model:

```text
class loading         -> binary class ditemukan dan dimuat
class linking         -> verify, prepare, resolve symbolic refs
class initialization  -> static fields/static blocks dieksekusi
object creation       -> memory allocated, fields defaulted, initializers/constructors run
```

Jangan campuradukkan **class initialization** dengan **object initialization**.

- Static field/block milik class.
- Instance field/block/constructor milik object.

### 3.4 Compile-Time Type vs Runtime Type

Ini salah satu konsep paling penting.

```java
class Animal {
    void speak() {
        System.out.println("animal");
    }
}

class Dog extends Animal {
    @Override
    void speak() {
        System.out.println("dog");
    }

    void fetch() {
        System.out.println("fetch");
    }
}

Animal a = new Dog();
a.speak(); // dog
a.fetch(); // compile error
```

Penjelasan:

```text
Compile-time type dari a = Animal
Runtime type dari object = Dog
```

Compiler hanya mengizinkan method yang ada di compile-time type `Animal`. Tetapi saat method virtual dipanggil, implementasi yang dieksekusi dipilih berdasarkan runtime type `Dog`.

Ini dasar dari:

- polymorphism,
- dependency inversion,
- framework proxy,
- mock object,
- template method,
- strategy pattern,
- plugin architecture.

Rule praktis:

> Compile-time type menentukan apa yang boleh dipanggil. Runtime type menentukan implementasi override mana yang berjalan.

---

## 4. Object sebagai Identity, State, dan Lifecycle

### 4.1 Object Identity

Setiap object normal di Java memiliki identity. Dua object bisa memiliki state sama tetapi identity berbeda.

```java
var a = new StringBuilder("abc");
var b = new StringBuilder("abc");

System.out.println(a == b); // false
```

Operator `==` pada reference membandingkan apakah dua reference menunjuk ke object yang sama, bukan apakah isi object sama.

```text
reference a ----> object #1 { value: "abc" }
reference b ----> object #2 { value: "abc" }
```

### 4.2 Reference Bukan Object

Variabel reference bukan object itu sendiri. Ia hanya memegang referensi ke object.

```java
var x = new User("A");
var y = x;

y.rename("B");

System.out.println(x.name()); // B
```

Mental model:

```text
x ----\
       > User object { name = "B" }
y ----/
```

Inilah **aliasing**: beberapa reference menunjuk object yang sama.

Aliasing membuat mutable object berbahaya jika ownership tidak jelas:

```java
final class Team {
    private final List<String> members;

    Team(List<String> members) {
        this.members = members; // dangerous
    }

    List<String> members() {
        return members; // dangerous
    }
}
```

Bug:

```java
var input = new ArrayList<>(List.of("A", "B"));
var team = new Team(input);

input.clear();              // merusak state internal Team
team.members().add("X");    // caller bisa mutasi internal state
```

Versi lebih defensif:

```java
final class Team {
    private final List<String> members;

    Team(List<String> members) {
        this.members = List.copyOf(members);
    }

    List<String> members() {
        return members;
    }
}
```

Catatan: `List.copyOf` membuat unmodifiable list, tetapi tetap shallow. Jika elemennya mutable object, object elemennya masih bisa berubah.

### 4.3 Object State

State object adalah nilai field instance pada suatu waktu.

```java
final class Counter {
    private int value;

    void increment() {
        value++;
    }

    int value() {
        return value;
    }
}
```

State bisa:

1. Immutable setelah construction.
2. Mutable dengan aturan ketat.
3. Mutable bebas, biasanya berbahaya.
4. Derived, dihitung dari field lain.
5. Cached, bisa invalid jika tidak hati-hati.

Top-tier Java design sering memilih:

```text
immutable by default
mutable only when lifecycle demands it
state transition explicit
invariant protected inside object boundary
```

### 4.4 Object Lifecycle

Lifecycle object di Java secara konseptual:

```text
allocation
  -> default field values
  -> superclass constructor chain
  -> instance field initializers and instance initializer blocks
  -> constructor body
  -> object becomes usable
  -> object referenced by other objects/threads
  -> object becomes unreachable
  -> garbage collector may reclaim memory
```

Penting:

- Java tidak punya deterministic destructor seperti C++.
- Resource eksternal harus ditutup eksplisit dengan `try-with-resources` / `AutoCloseable`.
- GC mengelola memory object, bukan lifecycle resource bisnis.
- `finalize()` deprecated for removal dan tidak boleh dipakai.

Salah:

```java
final class FileHolder {
    private final FileInputStream in;

    FileHolder(Path path) throws IOException {
        this.in = new FileInputStream(path.toFile());
    }

    @Override
    protected void finalize() throws Throwable {
        in.close(); // jangan lakukan ini
    }
}
```

Benar:

```java
final class FileHolder implements AutoCloseable {
    private final InputStream in;

    FileHolder(Path path) throws IOException {
        this.in = Files.newInputStream(path);
    }

    @Override
    public void close() throws IOException {
        in.close();
    }
}

try (var holder = new FileHolder(path)) {
    // use holder
}
```

### 4.5 Reachability

Object dapat direclaim GC ketika tidak reachable dari root set.

GC roots dapat mencakup antara lain:

- local variable pada stack thread yang aktif,
- static fields,
- JNI references,
- internal VM references,
- live thread objects.

Contoh:

```java
void run() {
    var data = new byte[10_000_000];
    process(data);
    data = null; // kadang membantu, sering tidak perlu
    doOtherLongWork();
}
```

Dalam kebanyakan kode, manual `data = null` tidak perlu. Tetapi pada method panjang dengan buffer besar, menghilangkan reference lebih awal bisa membantu GC, walau lebih baik desain method dibuat lebih kecil.

Prinsip:

> Object lifecycle Java dikendalikan oleh reachability, bukan oleh scope source code semata.

---

## 5. Field: State, Constant, Visibility, dan Invariant

### 5.1 Instance Field

Instance field ada per object.

```java
class User {
    private String name;
}

var a = new User();
var b = new User();
```

`a.name` dan `b.name` adalah state yang berbeda.

### 5.2 Static Field

Static field ada per class, bukan per object.

```java
class IdGenerator {
    private static long next = 1;

    static long nextId() {
        return next++;
    }
}
```

Masalah:

- shared global mutable state,
- tidak thread-safe,
- sulit dites,
- lifecycle tidak jelas,
- bisa bocor antar test,
- bisa menyebabkan memory leak jika menahan object besar.

Versi lebih aman:

```java
final class IdGenerator {
    private final AtomicLong next = new AtomicLong(1);

    long nextId() {
        return next.getAndIncrement();
    }
}
```

Static field baik untuk:

- constant immutable,
- stateless utility singleton tertentu,
- cache dengan lifecycle jelas,
- logger,
- immutable metadata.

### 5.3 `final` Field

`final` field hanya bisa diassign sekali:

```java
final class User {
    private final String id;

    User(String id) {
        this.id = id;
    }
}
```

Makna `final` berbeda tergantung konteks:

| Bentuk | Makna |
|---|---|
| `final class` | tidak bisa disubclass |
| `final method` | tidak bisa dioverride |
| `final field` | reference/value tidak bisa diassign ulang setelah init |
| `final local variable` | variable tidak bisa diassign ulang |
| `final parameter` | parameter tidak bisa diassign ulang |

`final` pada reference tidak membuat object immutable:

```java
final List<String> names = new ArrayList<>();
names.add("A");      // boleh
names = List.of();    // tidak boleh
```

### 5.4 Field Visibility

Access modifier:

| Modifier | Visible dari |
|---|---|
| `private` | class yang sama |
| package-private | package yang sama |
| `protected` | package yang sama + subclass dengan aturan tertentu |
| `public` | semua tempat yang dapat membaca type/module |

Rule desain:

> Field hampir selalu `private`. Expose behavior, bukan storage.

Salah:

```java
public class Order {
    public List<OrderLine> lines = new ArrayList<>();
}
```

Benar:

```java
public final class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    public void addLine(Product product, int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("quantity must be positive");
        }
        lines.add(new OrderLine(product, quantity));
    }

    public List<OrderLine> lines() {
        return List.copyOf(lines);
    }
}
```

### 5.5 Field Hiding

Field tidak dioverride. Field bisa di-hide.

```java
class Parent {
    String name = "parent";
}

class Child extends Parent {
    String name = "child";
}

Parent p = new Child();
System.out.println(p.name); // parent
```

Ini berbeda dari method dispatch.

```java
class Parent {
    String name() { return "parent"; }
}

class Child extends Parent {
    @Override
    String name() { return "child"; }
}

Parent p = new Child();
System.out.println(p.name()); // child
```

Rule:

> Field access ditentukan oleh compile-time type. Method override dipilih berdasarkan runtime type.

Karena itu, jangan desain inheritance yang mengandalkan field hiding.

---

## 6. Method: Behavior, Dispatch, Overload, Override

### 6.1 Method sebagai API

Method bukan sekadar fungsi. Method adalah kontrak behavior.

```java
public void approve(String officerId) { ... }
```

Pertanyaan desain:

- Apa precondition-nya?
- Apa postcondition-nya?
- State apa yang berubah?
- Error apa yang bisa terjadi?
- Apakah method idempotent?
- Apakah thread-safe?
- Apakah method melakukan I/O?
- Apakah method memerlukan transaction?
- Apakah method boleh dipanggil dalam state tertentu?

Contoh lebih eksplisit:

```java
public void approve(Officer officer, Instant approvedAt) {
    requireStatus(CaseStatus.SUBMITTED);
    requirePermission(officer, Permission.APPROVE_CASE);

    this.status = CaseStatus.APPROVED;
    this.approvedBy = officer.id();
    this.approvedAt = approvedAt;
}
```

### 6.2 Instance Method vs Static Method

Instance method memiliki receiver object:

```java
user.rename("New Name");
```

Secara mental:

```text
invoke method rename with receiver = user
```

Static method tidak punya receiver object:

```java
Math.max(1, 2);
```

Gunakan static method untuk:

- pure function utility,
- factory method,
- parser,
- constant transformation,
- stateless helper.

Jangan gunakan static method untuk menyembunyikan dependency yang semestinya injected.

Salah:

```java
class PaymentService {
    void pay(Order order) {
        PaymentGatewayClient.charge(order.total()); // hard dependency global
    }
}
```

Lebih baik:

```java
class PaymentService {
    private final PaymentGateway gateway;

    PaymentService(PaymentGateway gateway) {
        this.gateway = gateway;
    }

    void pay(Order order) {
        gateway.charge(order.total());
    }
}
```

### 6.3 Overloading

Overloading = nama method sama, parameter berbeda.

```java
void send(String message) { }
void send(String message, Priority priority) { }
```

Pemilihan overload terjadi saat compile time berdasarkan static type argument.

```java
void handle(Object value) {
    System.out.println("object");
}

void handle(String value) {
    System.out.println("string");
}

Object x = "hello";
handle(x); // object
```

Walau runtime object adalah `String`, compile-time type variable `x` adalah `Object`, maka overload `handle(Object)` dipilih.

Rule:

> Overloading adalah compile-time selection. Overriding adalah runtime dispatch.

### 6.4 Overriding

Overriding = subclass menyediakan implementasi method instance yang kompatibel.

```java
class NotificationSender {
    void send(String message) {
        System.out.println("default");
    }
}

class EmailSender extends NotificationSender {
    @Override
    void send(String message) {
        System.out.println("email: " + message);
    }
}

NotificationSender sender = new EmailSender();
sender.send("hello"); // email: hello
```

Gunakan `@Override` selalu saat niat override. Ini melindungi dari typo:

```java
class EmailSender extends NotificationSender {
    @Override
    void sends(String message) { // compile error jika tidak match
    }
}
```

### 6.5 Covariant Return Type

Subclass boleh mengembalikan subtype dari return type superclass.

```java
class AnimalShelter {
    Animal adopt() {
        return new Animal();
    }
}

class DogShelter extends AnimalShelter {
    @Override
    Dog adopt() {
        return new Dog();
    }
}
```

Ini berguna untuk fluent API dan factory hierarchy, tapi jangan berlebihan.

### 6.6 Final Method

`final` method tidak bisa dioverride.

```java
class Base {
    public final void validate() {
        // invariant-critical behavior
    }
}
```

Gunakan untuk method yang menjaga invariant atau security boundary.

---

## 7. Constructor Deep Dive

Constructor adalah titik krusial object model. Constructor bukan method biasa.

### 7.1 Constructor Bukan Method

Constructor:

- tidak punya return type,
- namanya sama dengan class,
- dipanggil saat object creation,
- dikompilasi menjadi special method `<init>` di bytecode,
- selalu berpartisipasi dalam constructor chain.

```java
class User {
    User(String name) {
    }
}
```

Ini bukan method bernama `User`. Ini constructor.

### 7.2 Default Constructor

Jika class tidak mendeklarasikan constructor sama sekali, compiler menyediakan default constructor tanpa argumen.

```java
class User {
}
```

Secara efektif seperti:

```java
class User {
    User() {
        super();
    }
}
```

Tetapi jika kamu deklarasikan constructor apapun, default constructor tidak otomatis dibuat.

```java
class User {
    User(String name) {
    }
}

new User(); // compile error
```

### 7.3 Constructor Chaining

Constructor bisa memanggil constructor lain dalam class yang sama dengan `this(...)`, atau superclass constructor dengan `super(...)`.

```java
class User {
    private final String id;
    private final String name;

    User(String name) {
        this(UUID.randomUUID().toString(), name);
    }

    User(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

Rule:

- Constructor normal akhirnya harus memanggil superclass constructor secara eksplisit atau implisit.
- Jika constructor tidak menulis `this(...)` atau `super(...)`, compiler menyisipkan `super()`.
- Dalam Java sebelum flexible constructor bodies, explicit constructor invocation harus statement pertama.
- Java 25 memperlonggar aturan ini secara aman.

### 7.4 Initialization Order

Ini bagian yang wajib dipahami. Untuk object creation:

```java
class Parent {
    static String ps = print("parent static field");

    static {
        print("parent static block");
    }

    String pi = print("parent instance field");

    {
        print("parent instance block");
    }

    Parent() {
        print("parent constructor");
    }

    static String print(String message) {
        System.out.println(message);
        return message;
    }
}

class Child extends Parent {
    static String cs = print("child static field");

    static {
        print("child static block");
    }

    String ci = print("child instance field");

    {
        print("child instance block");
    }

    Child() {
        print("child constructor");
    }
}

public class Demo {
    public static void main(String[] args) {
        new Child();
    }
}
```

Urutan konseptual:

```text
Parent static field
Parent static block
Child static field
Child static block
Parent instance field
Parent instance block
Parent constructor
Child instance field
Child instance block
Child constructor
```

Penting:

- Class initialization superclass terjadi sebelum subclass.
- Object construction superclass terjadi sebelum subclass.
- Instance field initializer dan instance initializer block class berjalan sebelum body constructor class tersebut.
- Field mendapatkan default value sebelum initializer eksplisit berjalan.

### 7.5 Default Values Sebelum Initialization

Sebelum constructor body berjalan, field punya default values:

| Type | Default |
|---|---|
| integer numeric | `0` |
| floating point | `0.0` |
| `boolean` | `false` |
| `char` | `\u0000` |
| reference | `null` |

Contoh jebakan:

```java
class Base {
    Base() {
        print();
    }

    void print() {
        System.out.println("base");
    }
}

class Child extends Base {
    private final String name = "child";

    @Override
    void print() {
        System.out.println(name.length());
    }
}

new Child(); // NullPointerException
```

Kenapa?

```text
1. Memory allocated, fields defaulted: name = null
2. Base constructor runs
3. Base constructor calls overridden print()
4. Child.print() runs before Child field initializer
5. name is still null
```

Rule keras:

> Jangan panggil overridable method dari constructor.

Ini salah satu bug object model paling berbahaya.

### 7.6 Leaking `this`

`this` leakage terjadi ketika object belum selesai constructed tetapi reference-nya sudah keluar.

Salah:

```java
class EventListener {
    EventListener(EventBus bus) {
        bus.register(this); // dangerous
    }
}
```

Jika `bus` memanggil callback sebelum constructor selesai, object digunakan dalam keadaan partially initialized.

Salah juga:

```java
class Worker {
    private final Thread thread;
    private String config;

    Worker() {
        thread = new Thread(this::run);
        thread.start(); // dangerous
        config = "ready";
    }

    private void run() {
        System.out.println(config.length()); // possible NPE
    }
}
```

Lebih aman:

```java
final class Worker {
    private final String config;
    private final Thread thread;

    private Worker(String config) {
        this.config = config;
        this.thread = new Thread(this::run);
    }

    static Worker createAndStart(String config) {
        var worker = new Worker(config);
        worker.start();
        return worker;
    }

    private void start() {
        thread.start();
    }

    private void run() {
        System.out.println(config.length());
    }
}
```

Rule:

> Constructor harus membangun object, bukan mendaftarkan object ke dunia luar secara prematur.

### 7.7 Invariant Construction

Constructor bertanggung jawab membuat object valid sejak awal.

Salah:

```java
class DateRange {
    private LocalDate start;
    private LocalDate end;

    DateRange(LocalDate start, LocalDate end) {
        this.start = start;
        this.end = end;
    }
}
```

Masalah:

- `start` bisa null.
- `end` bisa null.
- `end` bisa sebelum `start`.
- object bisa constructed dalam state invalid.

Lebih baik:

```java
final class DateRange {
    private final LocalDate start;
    private final LocalDate end;

    DateRange(LocalDate start, LocalDate end) {
        this.start = Objects.requireNonNull(start, "start");
        this.end = Objects.requireNonNull(end, "end");

        if (end.isBefore(start)) {
            throw new IllegalArgumentException("end must not be before start");
        }
    }

    boolean contains(LocalDate date) {
        Objects.requireNonNull(date, "date");
        return !date.isBefore(start) && !date.isAfter(end);
    }
}
```

Prinsip domain:

> Jangan izinkan object domain lahir dalam state yang tidak valid.

### 7.8 Flexible Constructor Bodies di Java 25

Sampai sebelum fitur ini difinalkan, Java membatasi explicit constructor invocation (`super(...)` atau `this(...)`) harus menjadi statement pertama. Java 25 melalui JEP 513 memperbolehkan statement tertentu muncul sebelum `super(...)` atau `this(...)`, selama statement tersebut tidak menggunakan instance yang sedang dibangun.

Contoh sebelum Java 25:

```java
class PositiveBigInteger extends BigInteger {
    PositiveBigInteger(long value) {
        super(Long.toString(validate(value)));
    }

    private static long validate(long value) {
        if (value <= 0) {
            throw new IllegalArgumentException("value must be positive");
        }
        return value;
    }
}
```

Dengan Java 25:

```java
class PositiveBigInteger extends BigInteger {
    PositiveBigInteger(long value) {
        if (value <= 0) {
            throw new IllegalArgumentException("value must be positive");
        }
        super(Long.toString(value));
    }
}
```

Ini lebih natural: validasi argument bisa dibaca sebelum memanggil superclass constructor.

Namun ada batasan penting. Dalam prologue constructor, yaitu statement sebelum explicit constructor invocation, kamu tidak boleh memakai current instance:

```java
class X {
    int i;
    String s = "hello";

    X() {
        // System.out.println(this); // error
        // var x = this.i;           // error
        // var y = i;                // error: implicit this
        // hashCode();               // error: implicit this

        i = 42; // allowed jika field declared di class ini dan belum punya initializer

        // s = "changed";            // error karena s punya initializer
        super();
    }
}
```

Mental model Java 25:

```text
constructor body = prologue + explicit constructor invocation + epilogue

prologue:
  - boleh validasi argument
  - boleh komputasi local
  - boleh throw exception
  - boleh assign field tertentu yang belum punya initializer
  - tidak boleh memakai this/super/current instance

explicit constructor invocation:
  - super(...), atau
  - this(...)

 epilogue:
  - constructor body normal setelah super/this
```

Kenapa fitur ini penting?

- Mengurangi kebutuhan static helper hanya untuk validasi constructor.
- Membuat invariant construction lebih jelas.
- Mengizinkan fail-fast sebelum superclass constructor dipanggil.
- Memberi safety tambahan terhadap object partially initialized.

Tetapi jangan salah pakai. Feature ini bukan izin untuk melakukan banyak business logic di constructor. Constructor tetap sebaiknya:

- validasi input,
- normalisasi sederhana,
- assignment field,
- menjaga invariant,
- tidak melakukan I/O berat,
- tidak memanggil remote service,
- tidak memulai thread,
- tidak publish `this`.

### 7.9 Constructor vs Static Factory

Constructor cocok ketika:

- nama construction jelas,
- tidak perlu memilih subtype,
- tidak perlu cache,
- tidak perlu precondition kompleks,
- tidak perlu hasil optional/error type.

Static factory cocok ketika:

- ingin nama lebih ekspresif,
- ingin validasi/normalisasi lebih kompleks,
- ingin mengembalikan subtype,
- ingin reuse instance,
- ingin membuat object dari beberapa representasi,
- ingin menyembunyikan constructor.

Contoh:

```java
final class EmailAddress {
    private final String value;

    private EmailAddress(String value) {
        this.value = value;
    }

    static EmailAddress parse(String raw) {
        Objects.requireNonNull(raw, "raw");
        var normalized = raw.trim().toLowerCase(Locale.ROOT);
        if (!normalized.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
        return new EmailAddress(normalized);
    }
}
```

Rule desain:

> Constructor menjaga object valid. Static factory memberi bahasa domain untuk cara object dibuat.

---

## 8. Inheritance: Subtyping, Reuse, dan Fragility

### 8.1 Inheritance Memiliki Dua Makna

Inheritance sering diajarkan sebagai “reuse code”. Ini berbahaya. Inheritance punya dua sisi:

1. **Subtyping**: `Child` dapat dipakai di tempat `Parent` diharapkan.
2. **Implementation reuse**: `Child` mewarisi field/method `Parent`.

Masalah muncul saat engineer memakai inheritance hanya untuk reuse, padahal secara domain tidak benar-benar subtype.

Salah:

```java
class Stack extends ArrayList<String> {
    void push(String value) {
        add(value);
    }

    String pop() {
        return remove(size() - 1);
    }
}
```

Masalah: karena `Stack` mewarisi semua method `ArrayList`, caller bisa melakukan operasi yang merusak invariant stack:

```java
Stack stack = new Stack();
stack.add(0, "break invariant");
stack.remove(0);
stack.sort(String::compareTo);
```

Lebih baik composition:

```java
final class Stack {
    private final List<String> values = new ArrayList<>();

    void push(String value) {
        values.add(value);
    }

    String pop() {
        if (values.isEmpty()) {
            throw new NoSuchElementException();
        }
        return values.remove(values.size() - 1);
    }
}
```

Rule:

> Gunakan inheritance untuk hubungan “is-a” yang kuat dan substitutable, bukan sekadar reuse code.

### 8.2 Liskov Substitution Principle

Jika `S` subtype dari `T`, maka object `S` harus bisa digunakan di tempat `T` tanpa merusak correctness program.

Contoh pelanggaran klasik:

```java
class Rectangle {
    protected int width;
    protected int height;

    void setWidth(int width) {
        this.width = width;
    }

    void setHeight(int height) {
        this.height = height;
    }

    int area() {
        return width * height;
    }
}

class Square extends Rectangle {
    @Override
    void setWidth(int width) {
        this.width = width;
        this.height = width;
    }

    @Override
    void setHeight(int height) {
        this.width = height;
        this.height = height;
    }
}
```

Kode ini bisa rusak:

```java
void resize(Rectangle r) {
    r.setWidth(5);
    r.setHeight(4);
    assert r.area() == 20;
}

resize(new Square()); // assertion gagal
```

Secara matematika square memang rectangle, tetapi secara mutable API, `Square` tidak substitutable untuk `Rectangle`.

Mental model:

> Subtyping bukan cuma relasi kategori dunia nyata. Subtyping adalah relasi behavior terhadap API.

### 8.3 Dynamic Dispatch

Pada method instance overridable, Java memakai dynamic dispatch.

```java
class CaseAction {
    void execute() {
        System.out.println("base");
    }
}

class ApproveAction extends CaseAction {
    @Override
    void execute() {
        System.out.println("approve");
    }
}

CaseAction action = new ApproveAction();
action.execute(); // approve
```

Namun tidak semua method dynamically dispatched:

| Member | Dispatch |
|---|---|
| instance method non-private | virtual dispatch jika overridable |
| `static` method | resolved by compile-time type |
| field | resolved by compile-time type |
| constructor | tidak inherited, tidak virtual |
| `private` method | tidak override |
| `final` method | tidak override |

### 8.4 Method Hiding: Static Method

Static method tidak dioverride. Ia di-hide.

```java
class Parent {
    static void hello() {
        System.out.println("parent");
    }
}

class Child extends Parent {
    static void hello() {
        System.out.println("child");
    }
}

Parent p = new Child();
p.hello(); // parent, tapi sebaiknya jangan panggil static lewat instance
```

Panggil static method lewat nama class:

```java
Parent.hello();
Child.hello();
```

### 8.5 Fragile Base Class Problem

Inheritance membuat subclass bergantung pada detail superclass.

Contoh:

```java
class CountingList<E> extends ArrayList<E> {
    private int addCount;

    @Override
    public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }
}
```

Masalah: implementasi `ArrayList.addAll` mungkin memanggil `add`, mungkin tidak. Jika implementasi berubah, `addCount` bisa salah. Subclass rapuh terhadap detail superclass.

Alternatif composition/decorator:

```java
final class CountingList<E> {
    private final List<E> delegate;
    private int addCount;

    CountingList(List<E> delegate) {
        this.delegate = Objects.requireNonNull(delegate);
    }

    boolean add(E e) {
        addCount++;
        return delegate.add(e);
    }

    boolean addAll(Collection<? extends E> values) {
        addCount += values.size();
        return delegate.addAll(values);
    }
}
```

### 8.6 Abstract Class

Abstract class berguna jika:

- ada state bersama,
- ada template algorithm,
- ada protected hook yang terkendali,
- hierarchy memang closed/semi-closed.

Contoh template method:

```java
abstract class CaseWorkflow {
    public final void process(CaseRecord record) {
        validate(record);
        apply(record);
        audit(record);
    }

    protected abstract void validate(CaseRecord record);

    protected abstract void apply(CaseRecord record);

    private void audit(CaseRecord record) {
        // invariant audit
    }
}
```

`process` final agar urutan invariant tidak dirusak subclass.

### 8.7 Sealed Class Preview untuk Domain Modeling? Actually Stable Since Java 17

Sealed classes sudah final sejak Java 17 dan sangat berguna untuk hierarchy tertutup.

```java
sealed interface CaseDecision permits Approved, Rejected, Escalated {
}

record Approved(String officerId) implements CaseDecision {
}

record Rejected(String officerId, String reason) implements CaseDecision {
}

record Escalated(String officerId, String queue) implements CaseDecision {
}
```

Keuntungan:

- Exhaustiveness checking dengan switch.
- Domain state lebih eksplisit.
- API tahu semua subtype legal.
- Cocok untuk command, event, state, error, result.

Namun sealed class bukan pengganti semua inheritance. Gunakan saat domain memang punya set kemungkinan yang tertutup atau dikendalikan.

---

## 9. Interface: Contract, Capability, dan Evolution

### 9.1 Interface sebagai Contract

Interface mendefinisikan capability/contract.

```java
interface PaymentGateway {
    PaymentResult charge(Money amount);
}
```

Class implementasi:

```java
final class StripePaymentGateway implements PaymentGateway {
    @Override
    public PaymentResult charge(Money amount) {
        // call external API
    }
}
```

Consumer:

```java
final class PaymentService {
    private final PaymentGateway gateway;

    PaymentService(PaymentGateway gateway) {
        this.gateway = gateway;
    }

    PaymentResult pay(Order order) {
        return gateway.charge(order.total());
    }
}
```

Keuntungan:

- Dependency inversion.
- Testing lebih mudah.
- Runtime substitution.
- Plugin architecture.
- Boundary lebih jelas.

### 9.2 Interface Bukan Selalu “IThing”

Di Java modern, interface sebaiknya dinamai berdasarkan capability, bukan sekadar prefiks `I`.

Buruk:

```java
interface IUserService { }
class UserService implements IUserService { }
```

Lebih baik:

```java
interface UserRepository { }
interface PasswordHasher { }
interface CasePolicy { }
interface NotificationSender { }
```

Nama interface harus menjawab:

> Capability apa yang diberikan object ini?

### 9.3 Default Method

Sejak Java 8, interface bisa punya default method.

```java
interface CaseRepository {
    Optional<CaseRecord> findById(String id);

    default CaseRecord getRequired(String id) {
        return findById(id).orElseThrow(() -> new NoSuchElementException(id));
    }
}
```

Default method berguna untuk:

- API evolution tanpa memaksa semua implementor berubah,
- helper behavior berbasis abstract method,
- composable interface kecil.

Tetapi default method bisa buruk jika:

- menyimpan business logic berat,
- menyembunyikan dependency,
- membuat inheritance behavior sulit dibaca,
- menyebabkan conflict antar interface.

### 9.4 Static Method dalam Interface

Interface bisa punya static method.

```java
interface CaseId {
    static String newId() {
        return UUID.randomUUID().toString();
    }
}
```

Namun untuk domain object, sering lebih baik record/class terpisah:

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank case id");
        }
    }

    public static CaseId generate() {
        return new CaseId(UUID.randomUUID().toString());
    }
}
```

### 9.5 Private Method dalam Interface

Interface bisa memiliki private method untuk reuse antar default method.

```java
interface Validator<T> {
    default void validateAll(List<T> values) {
        for (var value : values) {
            validateNonNull(value);
            validate(value);
        }
    }

    void validate(T value);

    private void validateNonNull(T value) {
        if (value == null) {
            throw new IllegalArgumentException("value must not be null");
        }
    }
}
```

### 9.6 Multiple Interface Inheritance

Class bisa implement banyak interface:

```java
interface Auditable {
    void audit();
}

interface Notifiable {
    void notifyUser();
}

class CaseSubmission implements Auditable, Notifiable {
    @Override
    public void audit() { }

    @Override
    public void notifyUser() { }
}
```

Jika dua interface punya default method sama, class harus resolve conflict.

```java
interface A {
    default void run() {
        System.out.println("A");
    }
}

interface B {
    default void run() {
        System.out.println("B");
    }
}

class C implements A, B {
    @Override
    public void run() {
        A.super.run();
    }
}
```

### 9.7 Interface vs Abstract Class

| Pertanyaan | Interface | Abstract class |
|---|---|---|
| Banyak inheritance? | Ya | Tidak |
| Punya instance state? | Tidak, kecuali constants | Ya |
| Cocok untuk capability? | Ya | Kadang |
| Cocok untuk base implementation? | Terbatas | Ya |
| API evolution? | Default method | Tambah concrete/protected method |
| Domain closed hierarchy? | Bisa sealed interface | Bisa sealed abstract class |

Rule praktis:

- Gunakan interface untuk boundary/capability.
- Gunakan abstract class jika benar-benar butuh shared state atau template algorithm.
- Gunakan final class + composition sebagai default.

### 9.8 Interface Segregation

Interface besar membuat implementor palsu dan test buruk.

Salah:

```java
interface CaseService {
    void create();
    void approve();
    void reject();
    void archive();
    void exportPdf();
    void sendEmail();
}
```

Lebih baik pisah capability:

```java
interface CaseCreator {
    CaseId create(CreateCaseCommand command);
}

interface CaseApprover {
    void approve(ApproveCaseCommand command);
}

interface CaseExporter {
    PdfDocument export(CaseId id);
}
```

Tetapi jangan over-split sampai tiap method punya interface tanpa alasan. Boundary harus mengikuti ownership dan dependency direction.

---

## 10. Nested Class, Inner Class, Anonymous Class, Local Class

### 10.1 Static Nested Class

Static nested class tidak menangkap instance outer class.

```java
final class Order {
    private final List<Line> lines;

    static final class Line {
        private final String productId;
        private final int quantity;

        Line(String productId, int quantity) {
            this.productId = productId;
            this.quantity = quantity;
        }
    }
}
```

Gunakan saat type hanya relevan dalam konteks outer class.

### 10.2 Inner Class

Inner class non-static punya reference implisit ke outer instance.

```java
class Outer {
    private String name = "outer";

    class Inner {
        void print() {
            System.out.println(name);
        }
    }
}
```

Hati-hati:

- bisa menahan outer object dan menyebabkan memory leak,
- serialization lebih rumit,
- object graph tidak terlihat jelas.

Default rule:

> Jika nested class tidak butuh akses ke instance outer, jadikan `static`.

### 10.3 Local Class

Local class dideklarasikan di dalam method.

```java
void run() {
    class LocalValidator {
        boolean valid(String value) {
            return value != null && !value.isBlank();
        }
    }

    var validator = new LocalValidator();
}
```

Jarang dipakai dalam code modern. Lambda/record lokal kadang lebih tepat.

### 10.4 Anonymous Class

Anonymous class membuat subtype tanpa nama.

```java
Runnable task = new Runnable() {
    @Override
    public void run() {
        System.out.println("run");
    }
};
```

Dengan lambda:

```java
Runnable task = () -> System.out.println("run");
```

Anonymous class masih berguna jika:

- perlu override lebih dari satu method,
- perlu state kecil,
- butuh subclass class bukan functional interface,
- testing/prototyping tertentu.

---

## 11. `java.lang.Object`: Root dari Class Hierarchy

Semua class normal di Java secara langsung atau tidak langsung mewarisi `java.lang.Object`.

Method penting:

```text
Object()
getClass()
equals(Object)
hashCode()
toString()
clone()
wait()
notify()
notifyAll()
finalize()   // deprecated for removal
```

### 11.1 `getClass()`

`getClass()` mengembalikan runtime `Class<?>` dari object.

```java
Object x = "hello";
System.out.println(x.getClass()); // class java.lang.String
```

Gunakan untuk:

- diagnostics,
- reflection,
- exact class equality check,
- framework internals.

Hati-hati dengan proxy:

```java
service.getClass() // mungkin com.sun.proxy.$Proxy... atau subclass generated
```

Dalam framework seperti Spring/Hibernate, runtime class bisa bukan class asli yang kamu tulis.

### 11.2 `toString()`

Default `toString()` biasanya berbentuk:

```text
ClassName@hexHash
```

Override untuk diagnostics:

```java
record CaseId(String value) {
}

System.out.println(new CaseId("C-001")); // CaseId[value=C-001]
```

Untuk class manual:

```java
final class User {
    private final String id;
    private final String name;

    @Override
    public String toString() {
        return "User{id='" + id + "', name='" + name + "'}";
    }
}
```

Jangan masukkan secret ke `toString()`:

```java
final class Credential {
    private final String username;
    private final String password;

    @Override
    public String toString() {
        return "Credential{username='" + username + "'}"; // jangan password
    }
}
```

### 11.3 `equals()`

Default `equals()` dari Object adalah identity equality, mirip `==`.

```java
var a = new User("1");
var b = new User("1");

System.out.println(a.equals(b)); // false jika tidak override
```

Override jika object punya logical equality.

### 11.4 `hashCode()`

`hashCode()` wajib konsisten dengan `equals()`.

Kontrak utama:

- Jika `a.equals(b)` true, maka `a.hashCode() == b.hashCode()` harus true.
- Jika hashCode sama, equals belum tentu true.
- hashCode object sebaiknya stabil selama object dipakai sebagai key hash collection.

Salah:

```java
final class User {
    private final String id;

    @Override
    public boolean equals(Object other) {
        return other instanceof User u && id.equals(u.id);
    }

    // hashCode tidak dioverride: bug
}
```

Benar:

```java
final class User {
    private final String id;

    User(String id) {
        this.id = Objects.requireNonNull(id);
    }

    @Override
    public boolean equals(Object other) {
        return this == other
            || other instanceof User u && id.equals(u.id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }
}
```

### 11.5 `clone()`

`clone()` historis bermasalah:

- shallow copy default,
- perlu `Cloneable`,
- constructor tidak dipanggil,
- final fields dan invariant bisa membingungkan,
- inheritance sulit.

Dalam Java modern, lebih baik gunakan:

- copy constructor,
- static factory,
- record `with`-like method manual,
- mapper eksplisit,
- serialization/deserialization hanya jika cocok.

Contoh copy method:

```java
final class UserProfile {
    private final String name;
    private final List<String> roles;

    UserProfile(String name, List<String> roles) {
        this.name = name;
        this.roles = List.copyOf(roles);
    }

    UserProfile withName(String newName) {
        return new UserProfile(newName, roles);
    }
}
```

### 11.6 `wait`, `notify`, `notifyAll`

Ini bagian concurrency low-level terkait object monitor.

```java
synchronized (lock) {
    while (!condition) {
        lock.wait();
    }
}
```

Untuk code modern, lebih sering gunakan:

- `java.util.concurrent` primitives,
- `BlockingQueue`,
- `CompletableFuture`,
- `Lock`/`Condition`,
- virtual threads dan structured concurrency untuk model tertentu.

Tetap penting tahu bahwa setiap object Java punya monitor yang bisa dipakai oleh `synchronized`.

### 11.7 `finalize()` Deprecated for Removal

`Object.finalize()` deprecated for removal. Jangan gunakan.

Masalah finalization:

- tidak predictable,
- bisa terlambat atau tidak jalan sebelum process exit,
- security risk,
- performance overhead,
- object resurrection,
- resource leak.

Gunakan:

- `try-with-resources`,
- `AutoCloseable`,
- `Cleaner` untuk fallback tertentu,
- explicit lifecycle management.

---

## 12. Equality Deep Dive

Equality di Java harus diputuskan berdasarkan jenis object.

### 12.1 Identity Object

Identity object merepresentasikan entity/lifecycle tertentu.

Contoh:

```java
final class CaseRecord {
    private final CaseId id;
    private CaseStatus status;
}
```

Dua `CaseRecord` dengan `id` sama mungkin merepresentasikan entity yang sama. Tetapi hati-hati:

- Apakah equality berdasarkan database id?
- Bagaimana object transient sebelum persist?
- Apakah status ikut equality?
- Apakah proxy ORM memengaruhi `getClass()`?

### 12.2 Value Object

Value object equality berdasarkan nilai.

```java
public record Money(String currency, long cents) {
    public Money {
        Objects.requireNonNull(currency, "currency");
        if (currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO-4217-like code");
        }
    }
}
```

Record secara otomatis memberi `equals`, `hashCode`, dan `toString` berbasis komponen.

Value object idealnya:

- immutable,
- kecil,
- tidak punya identity lifecycle,
- equality by value,
- valid sejak construction.

### 12.3 Equality Contract

`equals` harus memenuhi:

1. Reflexive: `x.equals(x)` true.
2. Symmetric: jika `x.equals(y)` true, maka `y.equals(x)` true.
3. Transitive: jika `x.equals(y)` dan `y.equals(z)`, maka `x.equals(z)` true.
4. Consistent: hasil stabil selama state equality tidak berubah.
5. Non-null: `x.equals(null)` false.

### 12.4 `instanceof` vs `getClass()` dalam `equals`

Pendekatan `instanceof`:

```java
@Override
public boolean equals(Object other) {
    return this == other
        || other instanceof User u && id.equals(u.id);
}
```

Pendekatan `getClass()`:

```java
@Override
public boolean equals(Object other) {
    if (this == other) return true;
    if (other == null || getClass() != other.getClass()) return false;
    User user = (User) other;
    return id.equals(user.id);
}
```

Trade-off:

| Pendekatan | Kelebihan | Risiko |
|---|---|---|
| `instanceof` | lebih fleksibel untuk subtype | bisa symmetry issue jika subclass menambah equality field |
| `getClass()` | strict exact class equality | bisa bermasalah dengan ORM/proxy subclass |

Rule praktis:

- Untuk final class/value object: `instanceof` aman dan sederhana.
- Untuk class yang bisa disubclass: pikirkan baik-baik, atau hindari override equality di base mutable hierarchy.
- Untuk JPA entity: ikuti strategi khusus entity/proxy, jangan asal generate IDE.

### 12.5 Equality dengan Inheritance: Jebakan Symmetry

```java
class Point {
    final int x;
    final int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Point p && x == p.x && y == p.y;
    }

    @Override
    public int hashCode() {
        return Objects.hash(x, y);
    }
}

class ColoredPoint extends Point {
    final String color;

    ColoredPoint(int x, int y, String color) {
        super(x, y);
        this.color = color;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof ColoredPoint p
            && x == p.x && y == p.y && color.equals(p.color);
    }
}
```

Masalah:

```java
Point p = new Point(1, 2);
ColoredPoint cp = new ColoredPoint(1, 2, "red");

p.equals(cp);  // true
cp.equals(p);  // false
```

Symmetry contract rusak.

Solusi umum:

- Jadikan value class `final`.
- Gunakan composition daripada menambah equality field via subclass.
- Gunakan sealed hierarchy dan equality yang eksplisit jika perlu.

### 12.6 Mutable Key Bug

```java
final class UserKey {
    private String id;

    UserKey(String id) {
        this.id = id;
    }

    void changeId(String id) {
        this.id = id;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof UserKey k && Objects.equals(id, k.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}

var key = new UserKey("A");
var map = new HashMap<UserKey, String>();
map.put(key, "value");

key.changeId("B");

System.out.println(map.get(key)); // null or unexpected
```

Kenapa?

HashMap menaruh entry berdasarkan hash saat insert. Ketika hash berubah, lookup menuju bucket berbeda.

Rule keras:

> Object yang dipakai sebagai key hash collection harus immutable terhadap field yang dipakai equals/hashCode.

### 12.7 BigDecimal Equality Trap

```java
var a = new BigDecimal("1.0");
var b = new BigDecimal("1.00");

System.out.println(a.equals(b));    // false
System.out.println(a.compareTo(b)); // 0
```

`BigDecimal.equals` mempertimbangkan scale. `compareTo` membandingkan numeric value.

Dampak:

```java
Set<BigDecimal> hashSet = new HashSet<>();
hashSet.add(new BigDecimal("1.0"));
hashSet.add(new BigDecimal("1.00"));
System.out.println(hashSet.size()); // 2

Set<BigDecimal> treeSet = new TreeSet<>();
treeSet.add(new BigDecimal("1.0"));
treeSet.add(new BigDecimal("1.00"));
System.out.println(treeSet.size()); // 1
```

Lesson:

> Equality semantics adalah bagian dari domain contract. Jangan anggap semua numeric equality sama.

### 12.8 Array Equality Trap

```java
int[] a = {1, 2, 3};
int[] b = {1, 2, 3};

System.out.println(a.equals(b)); // false
System.out.println(Arrays.equals(a, b)); // true
```

Array tidak override `equals` berbasis elemen. Gunakan `Arrays.equals` atau `Arrays.deepEquals`.

### 12.9 Record Equality

Record memberi equality berbasis komponen.

```java
record UserId(String value) {
    UserId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank id");
        }
    }
}

var a = new UserId("U-1");
var b = new UserId("U-1");

System.out.println(a.equals(b)); // true
```

Record bagus untuk value object, tetapi hati-hati jika komponen record adalah mutable object:

```java
record BadRecord(List<String> values) {
}

var list = new ArrayList<>(List.of("A"));
var r = new BadRecord(list);
list.add("B"); // record state berubah secara tidak langsung
```

Versi defensif:

```java
record GoodRecord(List<String> values) {
    GoodRecord {
        values = List.copyOf(values);
    }
}
```

---

## 13. Encapsulation dan Invariant

### 13.1 Encapsulation Bukan Sekadar `private`

Encapsulation berarti object melindungi invariant-nya dari manipulasi luar.

Salah:

```java
class BankAccount {
    public long balance;
}
```

Better:

```java
final class BankAccount {
    private long balance;

    BankAccount(long openingBalance) {
        if (openingBalance < 0) {
            throw new IllegalArgumentException("negative opening balance");
        }
        this.balance = openingBalance;
    }

    void deposit(long amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        balance += amount;
    }

    void withdraw(long amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        if (amount > balance) {
            throw new IllegalStateException("insufficient balance");
        }
        balance -= amount;
    }

    long balance() {
        return balance;
    }
}
```

Invariant:

```text
balance >= 0
only positive deposit
only positive withdraw
withdraw cannot exceed balance
```

### 13.2 Getter/Setter Bukan Encapsulation Otomatis

Ini sering terjadi di Java enterprise:

```java
class CaseRecord {
    private String status;

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
```

Secara teknis field private, tetapi invariant tidak terlindungi. Caller bisa set status apapun:

```java
caseRecord.setStatus("APPROVED_BUT_NOT_REVIEWED");
```

Lebih baik:

```java
final class CaseRecord {
    private CaseStatus status = CaseStatus.DRAFT;

    public void submit() {
        requireStatus(CaseStatus.DRAFT);
        status = CaseStatus.SUBMITTED;
    }

    public void approve() {
        requireStatus(CaseStatus.SUBMITTED);
        status = CaseStatus.APPROVED;
    }

    private void requireStatus(CaseStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + status);
        }
    }
}
```

API-nya berbasis domain behavior, bukan storage mutation.

### 13.3 Tell, Don't Ask

Buruk:

```java
if (caseRecord.getStatus() == CaseStatus.SUBMITTED) {
    caseRecord.setStatus(CaseStatus.APPROVED);
}
```

Lebih baik:

```java
caseRecord.approve();
```

Karena `approve()` bisa menjaga semua aturan:

- state transition,
- permission,
- audit,
- timestamp,
- domain event,
- invariant.

---

## 14. Object Model dan Framework Java

### 14.1 Spring dan Constructor

Spring modern mendorong constructor injection.

```java
@Service
public class CaseService {
    private final CaseRepository repository;
    private final Clock clock;

    public CaseService(CaseRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }
}
```

Kenapa bagus?

- dependency eksplisit,
- object valid setelah construction,
- field bisa final,
- test mudah,
- tidak butuh partially initialized bean.

Field injection membuat object bisa lahir dalam kondisi invalid:

```java
@Service
public class CaseService {
    @Autowired
    private CaseRepository repository;
}
```

Secara object model, constructor selesai sebelum dependency field injected. Ini memperpanjang fase partially initialized object.

### 14.2 JPA/Hibernate dan Constructor

JPA entity sering butuh no-arg constructor protected/public untuk framework.

```java
@Entity
class CaseEntity {
    @Id
    private String id;

    protected CaseEntity() {
        // for JPA
    }

    CaseEntity(String id) {
        this.id = Objects.requireNonNull(id);
    }
}
```

Konflik dengan domain purity:

- Framework butuh constructor kosong.
- Domain ingin invariant sejak construction.
- Proxy bisa subclass entity.
- Lazy loading bisa memengaruhi method/equality.

Pilihan desain:

1. Pisahkan domain model dan persistence entity.
2. Gunakan entity sebagai persistence model, domain behavior di aggregate terpisah.
3. Jika entity juga domain object, disiplin ketat pada constructor, setter, equality, lifecycle.

### 14.3 Jackson dan Constructor

Jackson dapat membuat object via:

- no-arg constructor + setter/field,
- annotated constructor,
- record canonical constructor,
- builder.

Value object modern lebih cocok:

```java
public record CreateCaseRequest(String title, String description) {
    public CreateCaseRequest {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title required");
        }
    }
}
```

Tetapi API DTO validation biasanya lebih baik dilakukan dengan validation layer agar error response bisa user-friendly.

### 14.4 Mockito dan Interface/Object Model

Mockito membuat mock berdasarkan interface/class. Jika design terlalu static/final/private tanpa boundary, test sulit.

Buruk:

```java
class CaseService {
    void submit(CaseCommand command) {
        AuditLogger.log(command); // static hard dependency
    }
}
```

Lebih baik:

```java
interface AuditSink {
    void record(AuditEvent event);
}

final class CaseService {
    private final AuditSink auditSink;

    CaseService(AuditSink auditSink) {
        this.auditSink = auditSink;
    }
}
```

---

## 15. Design Heuristics untuk Java Object Model

### 15.1 Default Design untuk Domain Class

Gunakan default ini kecuali ada alasan kuat:

```java
public final class DomainThing {
    private final RequiredDependency dependency;
    private final ValueObject value;

    public DomainThing(RequiredDependency dependency, ValueObject value) {
        this.dependency = Objects.requireNonNull(dependency, "dependency");
        this.value = Objects.requireNonNull(value, "value");
    }

    public Result doSomething(Command command) {
        Objects.requireNonNull(command, "command");
        // validate state
        // apply transition
        // return explicit result
    }
}
```

Karakteristik:

- `final` class by default.
- Field private.
- Field final jika bisa.
- Constructor menjaga invariant.
- Tidak expose mutable internal state.
- Method berbasis behavior domain.
- Equality hanya jika semantics jelas.

### 15.2 Kapan Class Tidak Perlu `final`

Jangan `final` jika:

- memang disiapkan untuk inheritance,
- framework membutuhkan subclass/proxy,
- sealed hierarchy digunakan,
- class adalah abstract base dengan template method,
- library API memang expose extension point.

Jika class extensible, dokumentasikan:

- method mana yang boleh dioverride,
- invariant apa yang harus dijaga,
- constructor behavior,
- thread-safety,
- lifecycle.

### 15.3 Prefer Composition

Default:

```text
composition first, inheritance only when subtyping contract strong
```

Inheritance membuka internal behavior ke subclass. Composition menjaga boundary.

### 15.4 Avoid Public Mutable State

Public mutable field hampir selalu buruk.

Gunakan:

- private field,
- method behavior,
- immutable value object,
- defensive copy,
- domain transition method.

### 15.5 Equality Strategy Harus Diputuskan Saat Design

Sebelum override `equals/hashCode`, jawab:

1. Apakah object ini identity object atau value object?
2. Apakah class final?
3. Apakah field equality immutable?
4. Apakah object akan dipakai sebagai map key/set member?
5. Apakah ada proxy/subclass?
6. Apakah equality lintas bounded context sama?
7. Apakah database id tersedia sejak construction?

Jika tidak yakin, jangan buru-buru override.

---

## 16. Anti-Pattern Umum

### 16.1 Anemic Getter/Setter Object

```java
class CaseRecord {
    private String status;
    private String officerId;
    private String reason;

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getOfficerId() { return officerId; }
    public void setOfficerId(String officerId) { this.officerId = officerId; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
}
```

Masalah: semua aturan pindah ke service procedural, object hanya bag of data.

### 16.2 Constructor Melakukan Terlalu Banyak

```java
class ReportGenerator {
    ReportGenerator() {
        connectToDatabase();
        loadTemplates();
        callRemoteConfig();
    }
}
```

Masalah:

- construction lambat,
- error sulit dikontrol,
- test sulit,
- object lifecycle kabur,
- retry/cancellation tidak jelas.

### 16.3 Inheritance untuk Reuse Sembarangan

```java
class CsvReport extends FileWriter { }
```

Apakah CsvReport benar-benar FileWriter? Kemungkinan tidak.

### 16.4 `equals/hashCode` Berdasarkan Mutable Field

Sudah dibahas: merusak hash collection.

### 16.5 Memanggil Overridable Method dari Constructor

Sudah dibahas: object subclass belum selesai init.

### 16.6 Static Global Mutable State

```java
class CurrentUser {
    static User user;
}
```

Masalah di multi-threaded server:

- user bocor antar request,
- race condition,
- test flakiness,
- security bug.

Gunakan request context eksplisit, scoped values, atau framework context dengan disiplin.

### 16.7 Object Tidak Punya Ownership Jelas

Jika semua object bisa mengubah semua object lain, sistem menjadi graph mutation liar.

Gunakan aggregate boundary:

```text
external caller -> aggregate method -> aggregate changes its internal state -> emits domain event
```

---

## 17. Studi Kasus: Case Lifecycle Object Model

Kita modelkan case management sederhana.

### 17.1 Versi Buruk

```java
class CaseRecord {
    public String id;
    public String status;
    public String assignedOfficer;
    public String rejectionReason;
}
```

Service:

```java
void approve(CaseRecord c, String officer) {
    if (!"SUBMITTED".equals(c.status)) {
        throw new IllegalStateException();
    }
    c.status = "APPROVED";
    c.assignedOfficer = officer;
}
```

Masalah:

- status string typo,
- caller bisa ubah state sembarang,
- invariant tersebar,
- audit tidak konsisten,
- transition tidak eksplisit,
- sulit defend secara regulatory.

### 17.2 Versi Lebih Baik

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED,
    ESCALATED
}
```

```java
public record OfficerId(String value) {
    public OfficerId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("officer id is required");
        }
    }
}
```

```java
public final class CaseRecord {
    private final String id;
    private CaseStatus status;
    private OfficerId submittedBy;
    private OfficerId decidedBy;
    private String rejectionReason;

    public CaseRecord(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("case id is required");
        }
        this.id = id;
        this.status = CaseStatus.DRAFT;
    }

    public void submit(OfficerId officer) {
        Objects.requireNonNull(officer, "officer");
        requireStatus(CaseStatus.DRAFT);
        this.status = CaseStatus.SUBMITTED;
        this.submittedBy = officer;
    }

    public void approve(OfficerId officer) {
        Objects.requireNonNull(officer, "officer");
        requireStatus(CaseStatus.SUBMITTED);
        this.status = CaseStatus.APPROVED;
        this.decidedBy = officer;
    }

    public void reject(OfficerId officer, String reason) {
        Objects.requireNonNull(officer, "officer");
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("rejection reason is required");
        }
        requireStatus(CaseStatus.SUBMITTED);
        this.status = CaseStatus.REJECTED;
        this.decidedBy = officer;
        this.rejectionReason = reason;
    }

    private void requireStatus(CaseStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + status);
        }
    }
}
```

Yang membaik:

- Transition legal dikontrol object.
- Tidak ada status string liar.
- Reason wajib saat reject.
- Officer wajib.
- Object tidak lahir invalid.
- State change punya bahasa domain.

### 17.3 Versi Lebih Kuat dengan Domain Event

```java
sealed interface CaseEvent permits CaseSubmitted, CaseApproved, CaseRejected {
    String caseId();
    OfficerId actor();
}

record CaseSubmitted(String caseId, OfficerId actor) implements CaseEvent {
}

record CaseApproved(String caseId, OfficerId actor) implements CaseEvent {
}

record CaseRejected(String caseId, OfficerId actor, String reason) implements CaseEvent {
}
```

Aggregate:

```java
public final class CaseRecord {
    private final String id;
    private CaseStatus status;
    private final List<CaseEvent> pendingEvents = new ArrayList<>();

    public CaseRecord(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("case id is required");
        }
        this.id = id;
        this.status = CaseStatus.DRAFT;
    }

    public void submit(OfficerId officer) {
        requireStatus(CaseStatus.DRAFT);
        this.status = CaseStatus.SUBMITTED;
        pendingEvents.add(new CaseSubmitted(id, officer));
    }

    public void approve(OfficerId officer) {
        requireStatus(CaseStatus.SUBMITTED);
        this.status = CaseStatus.APPROVED;
        pendingEvents.add(new CaseApproved(id, officer));
    }

    public void reject(OfficerId officer, String reason) {
        requireStatus(CaseStatus.SUBMITTED);
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("rejection reason is required");
        }
        this.status = CaseStatus.REJECTED;
        pendingEvents.add(new CaseRejected(id, officer, reason));
    }

    public List<CaseEvent> pullEvents() {
        var copy = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return copy;
    }

    private void requireStatus(CaseStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + status);
        }
    }
}
```

Ini sudah mulai mendekati object model yang dapat dipertanggungjawabkan:

- command masuk,
- aggregate menjaga invariant,
- state berubah,
- event tercatat,
- caller tidak bisa mutation sembarang.

---

## 18. Checklist Object Model yang Sehat

Saat membuat class, tanyakan:

### 18.1 Identity dan Equality

- Apakah object ini entity atau value object?
- Apakah equality by identity atau by value?
- Apakah perlu override `equals/hashCode`?
- Apakah field equality immutable?
- Apakah object akan menjadi key map/set?

### 18.2 Construction

- Apakah object bisa lahir dalam state invalid?
- Apakah semua required dependency final?
- Apakah constructor terlalu banyak melakukan pekerjaan?
- Apakah ada kemungkinan `this` bocor?
- Apakah constructor memanggil overridable method?

### 18.3 Encapsulation

- Apakah field private?
- Apakah mutable collection di-copy?
- Apakah method expose storage atau behavior?
- Apakah setter membuat invariant bocor?

### 18.4 Inheritance

- Apakah subclass benar-benar substitutable?
- Apakah inheritance dipakai hanya untuk reuse?
- Apakah superclass documented untuk extension?
- Apakah method critical sebaiknya final?
- Apakah composition lebih tepat?

### 18.5 Interface

- Apakah interface terlalu besar?
- Apakah interface merepresentasikan capability jelas?
- Apakah default method menyembunyikan business logic berat?
- Apakah boundary dependency sudah benar?

### 18.6 Framework

- Apakah framework butuh no-arg constructor?
- Apakah proxy memengaruhi equality/getClass?
- Apakah serialization butuh constructor khusus?
- Apakah dependency injection membuat object valid setelah construction?

---

## 19. Latihan Bertahap

### Latihan 1 — Identity vs Equality

Buat class `UserId` sebagai record dan class `User` sebagai entity.

Requirement:

- `UserId` equality by value.
- `User` punya `UserId`, `name`, `email`.
- Putuskan apakah `User.equals` perlu dioverride.
- Jelaskan trade-off jika User transient belum punya id.

### Latihan 2 — Constructor Invariant

Buat class `DateRange`.

Requirement:

- `start` dan `end` tidak boleh null.
- `end` tidak boleh sebelum `start`.
- Method `contains(LocalDate)`.
- Method `overlaps(DateRange)`.
- Class immutable.

### Latihan 3 — Mutable Key Bug

Buat class mutable yang dioverride `equals/hashCode`, masukkan ke `HashMap`, lalu ubah field equality-nya. Amati hasil `get`.

Setelah itu refactor menjadi immutable.

### Latihan 4 — Constructor Leak

Buat contoh class yang memulai thread di constructor dan membaca field yang diassign setelah `start()`. Jelaskan race-nya. Refactor menggunakan static factory.

### Latihan 5 — Inheritance vs Composition

Implementasikan `LimitedList<E>` yang membatasi jumlah elemen maksimum.

Versi 1:

- extends `ArrayList<E>`.

Versi 2:

- composition dengan private `ArrayList<E>`.

Bandingkan operasi mana yang bisa membocorkan invariant di versi inheritance.

### Latihan 6 — Interface Segregation

Ambil service besar:

```java
interface DocumentService {
    void upload();
    void download();
    void approve();
    void reject();
    void archive();
    void sendEmail();
    void generatePdf();
}
```

Refactor menjadi beberapa interface capability yang masuk akal. Jelaskan dependency direction masing-masing.

### Latihan 7 — Case Lifecycle Aggregate

Buat aggregate `EnforcementCase` dengan states:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
                               \-> REJECTED
                               \-> ESCALATED
```

Requirement:

- transition ilegal harus gagal,
- actor wajib,
- reason wajib untuk reject/escalate,
- expose domain events,
- tidak expose mutable internal list,
- equality strategy dijelaskan.

---

## 20. Ringkasan Bagian 3

Object model Java bisa diringkas begini:

```text
Class:
  compile-time type
  runtime metadata
  encapsulation boundary
  initialization unit
  API evolution unit

Object:
  identity
  state
  behavior access
  lifecycle through reachability

Constructor:
  validates input
  establishes invariant
  participates in superclass chain
  must avoid this leak and overridable calls

Inheritance:
  subtyping + reuse
  powerful but fragile
  use only when substitutable

Interface:
  capability contract
  dependency boundary
  supports multiple inheritance of type/behavior via default methods

Object root:
  equals/hashCode/toString/getClass/monitor/finalize legacy

Equality:
  must be intentionally designed
  value object != identity object
  mutable equality field is dangerous
```

Satu kalimat kunci:

> Java object model yang kuat bukan tentang membuat banyak class, tetapi tentang membuat boundary yang menjaga invariant, lifecycle, dependency, dan behavior tetap eksplisit.

---

## 21. Apa yang Harus Sudah Dikuasai Sebelum Lanjut

Sebelum masuk Bagian 4 tentang type system dan generics, pastikan kamu bisa menjelaskan tanpa menghafal:

1. Bedanya class, object, reference, dan `Class<?>`.
2. Bedanya compile-time type dan runtime type.
3. Kenapa field hiding berbeda dari method overriding.
4. Urutan static initialization, instance initialization, dan constructor.
5. Kenapa constructor tidak boleh memanggil overridable method.
6. Apa itu `this` leakage.
7. Apa dampak Java 25 flexible constructor bodies.
8. Kapan pakai constructor dan kapan static factory.
9. Kenapa inheritance untuk reuse sering berbahaya.
10. Kapan interface lebih tepat dari abstract class.
11. Kontrak `equals` dan `hashCode`.
12. Kenapa mutable object sebagai `HashMap` key berbahaya.
13. Kenapa getter/setter bukan otomatis encapsulation.
14. Bagaimana object model memengaruhi Spring, Hibernate, Jackson, Mockito.

Jika semua ini masuk akal, kamu sudah punya fondasi object model yang jauh lebih kuat daripada mayoritas engineer yang hanya memakai Java sebagai “bahasa Spring Boot”.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-002.md">⬅️ Learn Java Part 002 — Fondasi Bahasa Java: Dari Syntax ke Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../index.md">🏠 Home</a>
<a href="./learn-java-part-004.md">Learn Java hingga Java 25 — Part 004 ➡️</a>
</div>

# learn-java-oop-functional-reflection-codegen-modules-part-005

# Part 005 — Inheritance Deep Dive: Substitutability, Fragility, and Runtime Dispatch

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Status seri: **belum selesai**  
> Part ini: **005 dari 030**  
> Fokus: inheritance sebagai mekanisme type relationship, implementation reuse, dynamic dispatch, API evolution, dan sumber fragility dalam desain Java modern.

---

## 0. Tujuan Part Ini

Inheritance sering diajarkan terlalu sederhana:

> `class Child extends Parent` berarti Child mewarisi Parent.

Itu benar, tetapi sangat tidak cukup untuk engineer yang mendesain sistem besar.

Dalam Java production system, inheritance berpengaruh ke:

- substitutability;
- runtime dispatch;
- binary compatibility;
- protected state leakage;
- framework proxying;
- testability;
- API evolution;
- module/package boundary;
- extensibility contract;
- hidden coupling antara superclass dan subclass.

Part ini akan membangun mental model bahwa inheritance bukan hanya fitur syntax. Inheritance adalah **kontrak evolusi** antara superclass, subclass, compiler, runtime, dan caller.

Setelah part ini, target pemahamanmu:

1. Bisa membedakan inheritance sebagai **type relationship** vs **implementation reuse**.
2. Bisa membaca risiko inheritance dari sisi LSP, invariant, state ownership, dan runtime dispatch.
3. Bisa menjelaskan perbedaan overriding, hiding, overloading, field hiding, dan constructor behavior.
4. Bisa mendesain class hierarchy yang aman untuk public/internal API.
5. Bisa tahu kapan inheritance tepat, kapan composition lebih aman, dan kapan sealed hierarchy lebih cocok.
6. Bisa melakukan code review inheritance secara tajam, bukan hanya “looks clean”.

---

## 1. Mental Model Besar: Inheritance Itu Dua Hal yang Sering Dicampur

Inheritance di Java punya dua makna besar:

```text
Inheritance
├── Type relationship
│   └── Subclass is a subtype of superclass
│
└── Implementation reuse
    └── Subclass inherits members/behavior from superclass
```

Masalah besar muncul ketika dua makna ini dianggap selalu selaras.

Contoh sederhana:

```java
class Bird {
    void fly() {
        System.out.println("Flying");
    }
}

class Penguin extends Bird {
    @Override
    void fly() {
        throw new UnsupportedOperationException("Penguin cannot fly");
    }
}
```

Secara syntax valid. Secara model domain buruk.

Mengapa?

Karena `Penguin` memang “bird” secara taksonomi, tetapi bukan subtype yang valid untuk behavior `fly()`.

Caller yang menerima `Bird` punya ekspektasi:

```java
void makeBirdFly(Bird bird) {
    bird.fly();
}
```

Kalau `Penguin` diterima sebagai `Bird` tetapi tidak bisa memenuhi kontrak `fly()`, maka subtype relationship rusak.

Masalahnya bukan pada Java. Masalahnya pada model.

---

## 2. `extends` Bukan Berarti “Mirip”

Kesalahan umum:

```text
A mirip B → A extends B
```

Ini berbahaya.

Dalam desain yang lebih kuat:

```text
A extends B
```

berarti:

```text
Setiap tempat yang menerima B harus tetap benar ketika diberi A.
```

Dengan kata lain:

```text
Subclass must be behaviorally substitutable for superclass.
```

`extends` bukan hubungan “punya kemiripan”. `extends` adalah janji bahwa subclass bisa berdiri di tempat superclass tanpa merusak kontrak observable.

---

## 3. Substitutability: Inti dari Inheritance yang Benar

Substitutability berarti caller yang memakai superclass tidak perlu tahu subclass konkret.

Contoh baik:

```java
abstract class PaymentMethod {
    abstract PaymentResult pay(Money amount);
}

final class CreditCardPayment extends PaymentMethod {
    @Override
    PaymentResult pay(Money amount) {
        return PaymentResult.success("card");
    }
}

final class BankTransferPayment extends PaymentMethod {
    @Override
    PaymentResult pay(Money amount) {
        return PaymentResult.success("bank-transfer");
    }
}
```

Caller:

```java
PaymentResult checkout(PaymentMethod method, Money amount) {
    return method.pay(amount);
}
```

Caller tidak peduli apakah payment memakai kartu, transfer, wallet, atau virtual account. Yang penting semua subtype memenuhi kontrak `pay`.

Substitutability menuntut:

- subclass tidak melemahkan precondition;
- subclass tidak mengurangi postcondition;
- subclass tidak merusak invariant superclass;
- subclass tidak mengubah semantic contract secara mengejutkan;
- subclass tidak membuat caller superclass harus mengenal subclass.

---

## 4. Liskov Substitution Principle dalam Bahasa Java Praktis

LSP sering dijelaskan abstrak. Dalam Java, kita bisa ubah menjadi aturan review:

> Kalau method menerima `Base`, apakah semua subclass valid bisa dipakai tanpa `instanceof`, special case, atau defensive workaround?

Contoh pelanggaran:

```java
class ReadOnlyList<E> extends ArrayList<E> {
    @Override
    public boolean add(E e) {
        throw new UnsupportedOperationException();
    }
}
```

Secara teknis bisa. Secara substitutability bermasalah.

Kenapa?

Karena `ArrayList` punya kontrak mutability. Caller yang menerima `ArrayList` wajar memanggil `add`.

Lebih tepat:

```java
List<String> names = List.of("A", "B");
```

atau expose sebagai:

```java
interface NamesView {
    List<String> values();
}
```

Bukan dengan mewarisi class mutable lalu menonaktifkan behavior tertentu.

---

## 5. Inheritance sebagai Implementation Reuse: Kapan Berbahaya?

Implementation reuse terlihat menggoda:

```java
class BaseReportGenerator {
    void validate() { }
    void prepare() { }
    void render() { }
    void audit() { }
}

class SalesReportGenerator extends BaseReportGenerator {
    @Override
    void render() { }
}
```

Awalnya tampak rapi.

Namun superclass menjadi semacam “hidden framework”. Subclass bergantung pada urutan call, protected method, protected state, dan asumsi internal superclass.

Masalahnya:

```text
Subclass depends on superclass internals,
but superclass may not know all subclass assumptions.
```

Inilah awal dari **fragile base class problem**.

---

## 6. Fragile Base Class Problem

Fragile base class problem terjadi ketika perubahan di superclass yang tampak aman justru merusak subclass.

Misal versi awal:

```java
class BaseProcessor {
    public void process(String input) {
        validate(input);
        execute(input);
    }

    protected void validate(String input) {
        if (input == null) {
            throw new IllegalArgumentException("input is null");
        }
    }

    protected void execute(String input) {
        System.out.println(input);
    }
}
```

Subclass:

```java
class AuditedProcessor extends BaseProcessor {
    @Override
    protected void execute(String input) {
        audit(input);
        super.execute(input);
    }

    private void audit(String input) {
        System.out.println("audit: " + input);
    }
}
```

Kemudian superclass diubah:

```java
class BaseProcessor {
    public void process(String input) {
        validate(input);
        audit(input);      // method baru
        execute(input);
    }

    protected void audit(String input) {
        // default no-op
    }

    protected void validate(String input) { }
    protected void execute(String input) { }
}
```

Sekilas perubahan aman: hanya menambah extension hook.

Tetapi subclass lama punya method private `audit`. Kalau signature/access berubah atau subclass lain ternyata punya method dengan nama sama sebagai protected/public, efeknya bisa mengejutkan.

Fragility muncul karena inheritance menciptakan coupling pada:

- nama method;
- urutan method call;
- visibility method;
- protected state;
- constructor behavior;
- override points;
- asumsi side effect;
- lifecycle superclass.

---

## 7. Superclass Adalah API untuk Subclass

Saat membuat class yang bisa di-extend, kamu sedang mendesain dua API sekaligus:

```text
Public API for callers
Protected/API surface for subclasses
```

Contoh:

```java
public abstract class CsvImporter {
    public final ImportResult importFile(Path path) {
        List<String> lines = read(path);
        List<Row> rows = parse(lines);
        return persist(rows);
    }

    protected abstract List<Row> parse(List<String> lines);

    protected ImportResult persist(List<Row> rows) {
        return ImportResult.success(rows.size());
    }
}
```

`importFile` adalah public API untuk caller.

`parse` dan `persist` adalah API untuk subclass.

Kalau kamu tidak mendokumentasikan kapan `parse` dipanggil, boleh throw apa, boleh mutate input atau tidak, thread-safe atau tidak, maka subclass harus menebak.

Class yang extensible tapi tidak punya protected contract adalah bom waktu.

---

## 8. Rule of Thumb: Design for Inheritance or Prohibit It

Untuk class production-grade, pilihan sehat biasanya:

```text
1. final class
2. sealed class/interface
3. abstract class designed for extension
4. non-final class but not intended for inheritance ← berbahaya
```

Class non-final publik yang tidak dirancang untuk inheritance menciptakan kontrak implisit yang sulit dikontrol.

Contoh class utility/domain yang sebaiknya final:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        this.amount = amount;
        this.currency = currency;
    }
}
```

Kenapa final?

Karena subclass bisa merusak invariant:

```java
class FakeMoney extends Money {
    // could override methods if not final,
    // could introduce surprising behavior,
    // could break equality assumptions.
}
```

Kalau class tidak didesain untuk inheritance, jadikan `final`.

---

## 9. Java Single Inheritance: Satu Superclass, Banyak Interface

Java class hanya bisa extend satu class:

```java
class Child extends Parent { }
```

Tetapi bisa implement banyak interface:

```java
class Service implements Auditable, Validatable, Exportable { }
```

Implikasinya:

- class inheritance harus dipakai hemat;
- interface cocok untuk capability/role;
- composition sering lebih fleksibel daripada superclass chain;
- deep inheritance hierarchy sulit dirawat;
- interface + delegation sering lebih aman daripada abstract base class.

Hierarki dalam Java sebaiknya dangkal.

```text
Good:
PaymentMethod
├── CreditCardPayment
├── BankTransferPayment
└── WalletPayment

Risky:
BaseService
└── AbstractTransactionalService
    └── AbstractAuditedTransactionalService
        └── AbstractValidatedAuditedTransactionalService
            └── PaymentService
```

Semakin dalam hierarki, semakin sulit mengetahui behavior final object.

---

## 10. Apa yang Diwarisi oleh Subclass?

Secara konseptual, subclass mewarisi anggota dari superclass, tetapi tidak semua hal diwarisi dengan cara yang sama.

Yang perlu dibedakan:

| Elemen | Diwarisi? | Catatan |
|---|---:|---|
| instance method | ya, jika accessible dan tidak di-override | dynamic dispatch |
| static method | bisa tampak diwarisi, tapi hiding bukan overriding | resolved statically |
| field | bisa inherited, tapi bisa hidden | access via reference type membingungkan |
| constructor | tidak diwarisi | subclass constructor harus chain ke superclass constructor |
| private member | tidak accessible langsung | tetap ada di object layout, tapi bukan API subclass |
| package-private member | tergantung package | boundary package penting |
| final method | diwarisi tapi tidak bisa override | menjaga invariant |
| abstract method | harus diimplementasi oleh concrete subclass | contract wajib |

Jangan menyederhanakan inheritance menjadi “semua milik parent turun ke child”. Itu salah secara mental model.

---

## 11. Constructor Tidak Diwarisi

Constructor bukan method biasa dan tidak diwarisi.

Contoh:

```java
class Parent {
    Parent(String name) { }
}

class Child extends Parent {
    Child() {
        super("default");
    }
}
```

Subclass harus memastikan superclass terinisialisasi.

Object construction terjadi dari atas ke bawah:

```text
1. allocate object memory
2. initialize Object part
3. run superclass constructor chain
4. initialize subclass fields
5. run subclass constructor body
```

Tetapi ada jebakan besar: superclass constructor bisa memanggil method yang di-override subclass.

---

## 12. Jangan Panggil Overridable Method dari Constructor

Contoh buruk:

```java
class BaseJob {
    BaseJob() {
        validate();
    }

    protected void validate() {
        // default
    }
}

class EmailJob extends BaseJob {
    private final String email;

    EmailJob(String email) {
        this.email = email;
    }

    @Override
    protected void validate() {
        if (!email.contains("@")) { // email masih null saat dipanggil dari BaseJob constructor
            throw new IllegalArgumentException("invalid email");
        }
    }
}
```

Saat `BaseJob()` berjalan, field `EmailJob.email` belum diinisialisasi oleh constructor body subclass.

Hasilnya bisa `NullPointerException` atau invariant rusak.

Aturan production:

```text
Constructor should establish local invariants.
Constructor should not invoke overridable methods.
```

Kalau butuh lifecycle hook, gunakan factory/static builder setelah object complete:

```java
abstract class BaseJob {
    protected void validateAfterConstruction() { }
}

final class EmailJob extends BaseJob {
    private final String email;

    private EmailJob(String email) {
        this.email = email;
    }

    static EmailJob create(String email) {
        EmailJob job = new EmailJob(email);
        job.validateAfterConstruction();
        return job;
    }

    @Override
    protected void validateAfterConstruction() {
        if (!email.contains("@")) {
            throw new IllegalArgumentException("invalid email");
        }
    }
}
```

Namun pattern ini juga harus hati-hati, karena object bisa escape saat validation.

Alternatif lebih baik: validasi di factory tanpa override.

---

## 13. Overriding: Runtime Dispatch untuk Instance Method

Overriding terjadi saat subclass menyediakan implementasi untuk instance method superclass/interface.

```java
class Animal {
    String sound() {
        return "?";
    }
}

class Dog extends Animal {
    @Override
    String sound() {
        return "woof";
    }
}
```

Caller:

```java
Animal animal = new Dog();
System.out.println(animal.sound()); // woof
```

Compile-time type variable: `Animal`  
Runtime class object: `Dog`  
Method selected at runtime: `Dog.sound()`

Ini disebut dynamic dispatch.

Mental model:

```text
reference type controls what methods are visible at compile time
runtime class controls which overridden implementation runs
```

---

## 14. Compile-Time Visibility vs Runtime Dispatch

Contoh:

```java
class Animal {
    void eat() { }
}

class Dog extends Animal {
    void bark() { }
}

Animal animal = new Dog();
animal.eat();  // OK
animal.bark(); // compile error
```

`bark` ada di runtime object, tetapi tidak ada pada compile-time type `Animal`.

Jadi Java method call punya dua tahap besar:

```text
compile time:
  is this method callable from this reference type?

runtime:
  if instance method is overridden, which implementation should run?
```

---

## 15. Static Methods Are Hidden, Not Overridden

Static method tidak polymorphic seperti instance method.

```java
class Parent {
    static String name() {
        return "parent";
    }
}

class Child extends Parent {
    static String name() {
        return "child";
    }
}

Parent p = new Child();
System.out.println(p.name()); // parent
```

Mengapa?

Karena static method resolved berdasarkan compile-time type, bukan runtime object.

Lebih baik panggil static method lewat class name:

```java
Parent.name();
Child.name();
```

Bukan lewat instance reference.

Code review rule:

```text
Do not rely on static method hiding for polymorphism.
Static method hiding is usually a readability hazard.
```

---

## 16. Fields Are Hidden, Not Overridden

Field tidak polymorphic.

```java
class Parent {
    String value = "parent";
}

class Child extends Parent {
    String value = "child";
}

Parent p = new Child();
System.out.println(p.value); // parent
```

Method berbeda:

```java
class Parent {
    String value() {
        return "parent";
    }
}

class Child extends Parent {
    @Override
    String value() {
        return "child";
    }
}

Parent p = new Child();
System.out.println(p.value()); // child
```

Field hiding sering membingungkan dan sebaiknya dihindari.

Aturan:

```text
Do not redeclare fields with the same name in subclass.
```

Kalau perlu behavior berbeda, gunakan method override atau composition.

---

## 17. Overloading Bukan Overriding

Overloading dipilih saat compile time berdasarkan parameter.

```java
class Printer {
    void print(Object value) {
        System.out.println("object");
    }

    void print(String value) {
        System.out.println("string");
    }
}

Object value = "hello";
new Printer().print(value); // object
```

Walaupun runtime object adalah `String`, overload dipilih berdasarkan compile-time type `Object`.

Overriding dipilih runtime. Overloading dipilih compile time.

```text
Overloading: same name, different parameter list, compile-time selection.
Overriding: same/compatible signature in subtype, runtime selection.
```

Ini penting dalam API design.

Contoh jebakan:

```java
void handle(Command command) { }
void handle(CreateUserCommand command) { }

Command command = new CreateUserCommand();
handle(command); // handle(Command), not handle(CreateUserCommand)
```

Kalau kamu butuh runtime behavior, jangan mengandalkan overload. Gunakan polymorphism, visitor, pattern matching, atau dispatch map.

---

## 18. Covariant Return Type

Java memperbolehkan override method dengan return type yang lebih spesifik.

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

Ini disebut covariant return type.

Manfaat:

- API subclass lebih ekspresif;
- caller subclass tidak perlu cast;
- tetap compatible dengan contract superclass.

Namun jangan berlebihan. Return type lebih spesifik boleh, tetapi semantic contract tetap harus sama.

---

## 19. Access Modifier saat Override

Subclass tidak boleh mempersempit access method yang di-override.

```java
class Parent {
    protected void run() { }
}

class Child extends Parent {
    @Override
    public void run() { } // OK: wider access
}
```

Tetapi ini tidak boleh:

```java
class Parent {
    public void run() { }
}

class Child extends Parent {
    @Override
    protected void run() { } // compile error
}
```

Alasannya substitutability.

Jika caller bisa memanggil `run()` pada `Parent`, maka caller juga harus bisa memanggil `run()` ketika object sebenarnya `Child`.

---

## 20. Checked Exception saat Override

Subclass tidak boleh menambah checked exception yang lebih luas daripada superclass.

```java
class Parent {
    void load() throws IOException { }
}

class Child extends Parent {
    @Override
    void load() throws FileNotFoundException { } // OK, narrower
}
```

Tidak boleh:

```java
class Child extends Parent {
    @Override
    void load() throws Exception { } // compile error
}
```

Alasannya sama: substitutability.

Caller yang memegang `Parent` hanya diwajibkan handle `IOException`. Kalau subclass tiba-tiba throw `Exception`, contract melebar dan caller rusak.

---

## 21. `final` sebagai Alat Menjaga Invariant

`final` bisa dipakai di class, method, dan variable.

Untuk inheritance:

```java
public final class Money { }
```

berarti class tidak bisa di-extend.

```java
public class Account {
    public final void close() {
        // invariant-sensitive algorithm
    }
}
```

berarti method tidak bisa di-override.

`final` bukan sekadar optimisasi. Dalam desain API, `final` adalah mekanisme proteksi invariant.

Contoh:

```java
class Account {
    private boolean closed;

    public final void close() {
        if (closed) {
            return;
        }
        beforeClose();
        closed = true;
        afterClose();
    }

    protected void beforeClose() { }
    protected void afterClose() { }
}
```

Di sini `close()` final agar urutan invariant tetap dikontrol superclass. Subclass hanya diberi hook terbatas.

Namun hook tetap harus didesain hati-hati.

---

## 22. Abstract Class: Partial Implementation + Shared Contract

Abstract class berguna ketika ada:

- state bersama;
- behavior bersama;
- lifecycle bersama;
- protected helper yang memang stabil;
- template algorithm yang memang harus dikontrol.

Contoh:

```java
public abstract class AbstractParser<T> {
    public final T parse(String input) {
        if (input == null || input.isBlank()) {
            throw new IllegalArgumentException("input is blank");
        }
        return doParse(input.trim());
    }

    protected abstract T doParse(String normalizedInput);
}
```

Public method `parse` final menjaga invariant:

- input tidak null;
- input tidak blank;
- input ditrim;
- subclass hanya menerima normalized input.

Subclass:

```java
public final class IntegerParser extends AbstractParser<Integer> {
    @Override
    protected Integer doParse(String normalizedInput) {
        return Integer.valueOf(normalizedInput);
    }
}
```

Ini contoh abstract class yang relatif sehat.

Kenapa?

Karena extension point sempit dan contract jelas.

---

## 23. Template Method Pattern: Berguna, Tapi Berbahaya Jika Terlalu Banyak Hook

Template method:

```java
abstract class ImportTemplate {
    public final ImportResult run(Path path) {
        beforeRead(path);
        List<String> lines = read(path);
        List<Record> records = parse(lines);
        ImportResult result = persist(records);
        afterPersist(result);
        return result;
    }

    protected void beforeRead(Path path) { }
    protected abstract List<Record> parse(List<String> lines);
    protected ImportResult persist(List<Record> records) { return ImportResult.success(); }
    protected void afterPersist(ImportResult result) { }
}
```

Masalah muncul kalau:

- terlalu banyak hook;
- hook order rumit;
- hook boleh mutate shared state;
- hook punya side effect implicit;
- hook saling bergantung;
- subclass harus override sebagian besar method;
- superclass menebak kebutuhan subclass.

Jika template makin kompleks, pertimbangkan composition:

```java
final class ImportPipeline {
    private final Reader reader;
    private final Parser parser;
    private final Persister persister;

    ImportResult run(Path path) {
        List<String> lines = reader.read(path);
        List<Record> records = parser.parse(lines);
        return persister.persist(records);
    }
}
```

Composition membuat dependency eksplisit.

---

## 24. Inheritance vs Composition

Pertanyaan kunci:

```text
Apakah object ini benar-benar subtype,
atau hanya ingin memakai sebagian behavior object lain?
```

Jika hanya ingin reuse behavior, composition biasanya lebih aman.

Inheritance:

```java
class AuditedPaymentService extends PaymentService { }
```

Composition:

```java
final class AuditedPaymentService {
    private final PaymentService delegate;
    private final AuditLogger auditLogger;

    PaymentResult pay(PaymentCommand command) {
        auditLogger.before(command);
        PaymentResult result = delegate.pay(command);
        auditLogger.after(command, result);
        return result;
    }
}
```

Composition lebih eksplisit:

- dependency terlihat;
- lifecycle lebih jelas;
- behavior bisa diganti runtime;
- tidak terikat pada protected internals;
- lebih mudah dites;
- tidak mewarisi API yang tidak diinginkan.

Inheritance lebih cocok saat:

- subtype relationship kuat;
- contract stabil;
- hierarchy finite/controlled;
- polymorphic dispatch memang dibutuhkan;
- superclass memang didesain untuk extension.

---

## 25. Protected: Lebih Berbahaya dari yang Terlihat

`protected` sering dianggap “private untuk subclass”. Itu salah.

Di Java, `protected` berarti accessible oleh:

- subclass;
- class dalam package yang sama;
- dengan aturan khusus untuk access via subclass reference di package berbeda.

Masalah desain:

```java
public abstract class BaseService {
    protected Map<String, Object> context = new HashMap<>();
}
```

Subclass bisa mutate state secara bebas.

Risiko:

- invariant superclass rusak;
- thread-safety tidak jelas;
- lifecycle tidak jelas;
- subclass bisa bergantung pada detail internal;
- perubahan internal superclass menjadi breaking change.

Lebih baik:

```java
public abstract class BaseService {
    private final Map<String, Object> context = new HashMap<>();

    protected final Optional<Object> findContext(String key) {
        return Optional.ofNullable(context.get(key));
    }

    protected final void putContext(String key, Object value) {
        validateKey(key);
        context.put(key, value);
    }

    private void validateKey(String key) {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("blank key");
        }
    }
}
```

Expose behavior, bukan raw state.

---

## 26. Deep Hierarchy Membuat Behavior Sulit Diprediksi

Contoh:

```text
BaseController
└── AuthenticatedController
    └── TenantAwareController
        └── AuditedController
            └── CaseController
```

Saat `CaseController.handle()` dipanggil, behavior bisa berasal dari lima level.

Pertanyaan code review:

- method mana yang override method mana?
- state mana yang diinisialisasi di level mana?
- hook mana yang wajib dipanggil?
- apakah `super.method()` wajib dipanggil?
- kalau lupa panggil `super`, apa rusak?
- apakah superclass call subclass method dari constructor?
- apakah subclass tahu semua invariant parent?

Deep hierarchy sering mengurangi local reasoning.

Top engineer menyukai desain yang bisa dibaca lokal:

```text
Object behavior should be understandable without climbing a 7-level inheritance ladder.
```

---

## 27. The `super` Call Contract

Override method kadang harus memanggil `super`.

```java
class BaseEntity {
    protected void validate() {
        // base invariant
    }
}

class UserEntity extends BaseEntity {
    @Override
    protected void validate() {
        super.validate();
        // user invariant
    }
}
```

Masalah:

Java tidak bisa memaksa subclass memanggil `super.validate()`.

Kalau kontrak butuh `super` call, desainnya rapuh.

Lebih aman gunakan template method:

```java
abstract class BaseEntity {
    public final void validate() {
        validateBaseInvariant();
        validateSpecificInvariant();
    }

    private void validateBaseInvariant() { }

    protected abstract void validateSpecificInvariant();
}
```

Dengan ini base invariant tidak bisa dilewati subclass.

---

## 28. Inheritance dan Equality

Inheritance membuat `equals` sulit.

Contoh:

```java
class Point {
    private final int x;
    private final int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof Point p)) {
            return false;
        }
        return x == p.x && y == p.y;
    }
}

class ColoredPoint extends Point {
    private final String color;

    ColoredPoint(int x, int y, String color) {
        super(x, y);
        this.color = color;
    }
}
```

Apakah `Point(1,2)` equal dengan `ColoredPoint(1,2,"red")`?

Jika ya, symmetry/transitivity bisa rusak ketika color diperhitungkan.

Jika tidak, subclass tidak benar-benar substitutable dalam equality domain.

Itulah kenapa value object sering lebih aman `final`.

```java
public final class Point { }
```

Atau gunakan record:

```java
public record Point(int x, int y) { }
```

Inheritance + equality adalah kombinasi rawan.

---

## 29. Inheritance dan Immutability

Class immutable yang tidak final bisa dirusak subclass.

```java
public class ImmutableRange {
    private final int start;
    private final int end;

    public ImmutableRange(int start, int end) {
        if (start > end) {
            throw new IllegalArgumentException();
        }
        this.start = start;
        this.end = end;
    }

    public int length() {
        return end - start;
    }
}
```

Jika class ini tidak final, subclass bisa menambah mutable state atau override method.

```java
class MutableRange extends ImmutableRange {
    private int offset;

    @Override
    public int length() {
        return super.length() + offset;
    }
}
```

Caller mengira `ImmutableRange` stabil, tetapi runtime object mutable.

Rule:

```text
Immutable value classes should usually be final.
```

---

## 30. Inheritance dan Framework Proxy

Framework sering membuat subclass/proxy runtime untuk:

- transaction;
- lazy loading;
- security interception;
- metrics;
- mocking;
- AOP;
- ORM entity proxy.

Konsekuensi:

- final class sulit diproxy dengan subclass-based proxy;
- final method tidak bisa diintercept dengan subclass override;
- constructor behavior penting;
- `equals` berbasis `getClass()` bisa gagal dengan proxy subclass;
- reflection/JPMS access bisa memblokir proxying;
- protected/package-private visibility memengaruhi generated subclass.

Contoh issue equality:

```java
@Override
public boolean equals(Object other) {
    if (other == null || other.getClass() != this.getClass()) {
        return false;
    }
    // compare id
}
```

Jika framework membuat subclass proxy:

```text
UserEntityProxy extends UserEntity
```

maka `getClass()` berbeda.

Namun menggunakan `instanceof` juga punya trade-off untuk equality inheritance.

Tidak ada satu rule universal. Yang penting: equality policy harus sadar apakah object bisa diproxy.

---

## 31. Inheritance dan Serialization/Deserialization

Framework serialization/deserialization bisa:

- memanggil no-arg constructor;
- set field via reflection;
- bypass constructor tertentu;
- membutuhkan non-final class;
- membutuhkan visible setter;
- memakai subclass proxy;
- memakai type discriminator.

Dalam hierarchy polymorphic:

```java
abstract class Event { }
final class UserCreated extends Event { }
final class UserDeleted extends Event { }
```

Serializer perlu tahu concrete subtype.

Jika hierarchy terbuka, input dari luar bisa mencoba instantiate tipe tak diharapkan.

Untuk API boundary, sealed hierarchy sering lebih aman:

```java
public sealed interface DomainEvent
        permits UserCreated, UserDeleted {
}

public record UserCreated(String userId) implements DomainEvent { }
public record UserDeleted(String userId) implements DomainEvent { }
```

Ini memberi daftar subtype eksplisit.

---

## 32. Inheritance dan Binary Compatibility

Mengubah superclass bisa berdampak ke subclass dan caller.

Contoh perubahan berisiko:

- menambah abstract method ke abstract class;
- mengubah method concrete menjadi abstract;
- menghapus protected method;
- mengubah return type tidak compatible;
- mengubah checked exception contract;
- mengubah visibility lebih sempit;
- membuat class final;
- membuat method final;
- menambah method yang konflik dengan subclass existing;
- mengubah constructor signature;
- mengubah initialization order;
- mengubah semantic hook.

Public superclass adalah kontrak jangka panjang.

Kalau library kamu dipakai banyak module/service, inheritance surface harus dianggap API publik walaupun method-nya `protected`.

---

## 33. Inheritance dan Package/Module Boundary

Inheritance bukan hanya class-level issue. Ia berinteraksi dengan package dan module.

Package-private superclass:

```java
abstract class InternalBaseHandler { }
```

hanya bisa diakses dalam package sama.

Public subclass bisa expose behavior tanpa expose base class.

JPMS bisa membatasi package export:

```java
module com.example.payment {
    exports com.example.payment.api;
    // internal package not exported
}
```

Dengan desain ini:

```text
com.example.payment.internal.AbstractPaymentHandler
```

tidak menjadi API untuk module lain.

Ini penting karena inheritance sering membocorkan internal architecture kalau semua class dibuat public.

Rule:

```text
Do not make abstract base classes public unless external extension is a supported use case.
```

---

## 34. Open Hierarchy vs Closed Hierarchy

Open hierarchy:

```java
public abstract class PaymentMethod {
    public abstract PaymentResult pay(Money amount);
}
```

Siapa pun bisa membuat subclass.

Closed hierarchy:

```java
public sealed interface PaymentMethod
        permits CardPayment, BankTransferPayment, WalletPayment {
}
```

Hanya subtype yang diizinkan.

Open hierarchy cocok untuk SPI/plugin system.

Closed hierarchy cocok untuk domain finite:

- workflow state;
- command result;
- validation outcome;
- payment instruction type internal;
- case lifecycle event;
- authorization decision;
- parser token;
- AST node.

Closed hierarchy memudahkan exhaustive reasoning dan pattern matching.

---

## 35. Inheritance vs Interface Polymorphism

Sering kali, caller tidak butuh superclass. Caller hanya butuh capability.

Daripada:

```java
abstract class ReportExporter {
    abstract byte[] export(Report report);
}
```

Bisa:

```java
interface ReportExporter {
    byte[] export(Report report);
}
```

Lalu reuse behavior via helper/composition:

```java
final class CsvReportExporter implements ReportExporter {
    private final CsvFormatter formatter;

    @Override
    public byte[] export(Report report) {
        return formatter.format(report).getBytes(StandardCharsets.UTF_8);
    }
}
```

Interface lebih baik saat:

- tidak ada state bersama;
- tidak ada lifecycle bersama;
- hanya butuh contract;
- implementation bisa sangat berbeda;
- dependency direction ingin tipis;
- test double mudah dibuat.

Abstract class lebih baik saat:

- ada invariant bersama;
- ada algorithm skeleton;
- ada shared protected helper yang stabil;
- kamu mengontrol subclass set;
- extension contract jelas.

---

## 36. Inheritance dan Domain Modeling

Jangan memodelkan semua taxonomy dunia nyata sebagai inheritance.

Buruk:

```java
class User { }
class AdminUser extends User { }
class ReviewerUser extends User { }
class SupervisorUser extends User { }
```

Masalah:

- role bisa berubah;
- user bisa punya banyak role;
- role bukan subtype stabil;
- permission adalah relation/capability;
- inheritance membuat role statis.

Lebih baik:

```java
final class User {
    private final UserId id;
    private final Set<Role> roles;
}
```

Inheritance cocok bila subtype adalah variasi behavioral yang stabil, bukan label dinamis.

Contoh lebih tepat:

```java
sealed interface ApprovalDecision
        permits Approved, Rejected, ReturnedForClarification {
}

record Approved(ApproverId approverId) implements ApprovalDecision { }
record Rejected(ApproverId approverId, String reason) implements ApprovalDecision { }
record ReturnedForClarification(String question) implements ApprovalDecision { }
```

Ini finite outcome, bukan role mutable.

---

## 37. Inheritance dan State Machine

Dalam state machine, inheritance bisa berguna jika state punya behavior berbeda.

```java
sealed interface CaseState
        permits Draft, Submitted, Approved, Rejected {

    CaseState submit();
    CaseState approve();
    CaseState reject();
}
```

Namun hati-hati. Jika setiap state harus mengimplementasikan semua transition, akan banyak method invalid.

```java
record Draft() implements CaseState {
    @Override
    public CaseState submit() {
        return new Submitted();
    }

    @Override
    public CaseState approve() {
        throw new IllegalStateException("cannot approve draft");
    }

    @Override
    public CaseState reject() {
        throw new IllegalStateException("cannot reject draft");
    }
}
```

Ini bisa menjadi smell karena interface memaksa behavior yang tidak valid.

Alternatif:

```java
sealed interface CaseState permits Draft, Submitted, Approved, Rejected { }
record Draft() implements CaseState { }
record Submitted() implements CaseState { }
record Approved() implements CaseState { }
record Rejected() implements CaseState { }

final class CaseTransitionPolicy {
    CaseState submit(CaseState state) { }
    CaseState approve(CaseState state) { }
    CaseState reject(CaseState state) { }
}
```

Pilihan tergantung apakah behavior lebih natural berada di state object atau di transition policy.

---

## 38. Polymorphism Decision Matrix

Gunakan matrix ini saat memilih desain.

| Kebutuhan | Pilihan Umum | Alasan |
|---|---|---|
| Banyak implementasi interchangeable | interface | contract tipis |
| Shared invariant kuat | abstract class dengan final template | invariant dijaga superclass |
| Finite subtype known at compile time | sealed interface/class | exhaustive reasoning |
| Hanya reuse logic | composition/delegation | coupling eksplisit |
| Runtime plugin eksternal | interface/SPI | open extension |
| Data variants tanpa banyak behavior | record + sealed interface | jelas dan immutable-ish |
| Behavior sangat berbeda per variant | polymorphic method | dispatch natural |
| Caller butuh memilih branch eksplisit | pattern matching | readable untuk finite variants |
| Ingin menambah operasi baru sering | visitor/pattern matching | operasi bisa ditambah tanpa ubah subtype? trade-off |
| Ingin menambah subtype baru sering | interface polymorphism | subtype baru mudah ditambah |

Tidak ada satu pattern menang semua. Pilih berdasarkan axis perubahan.

---

## 39. Axis of Change: Pertanyaan Paling Penting

Sebelum membuat hierarchy, tanya:

```text
Mana yang lebih sering berubah?

1. Jumlah subtype?
2. Jumlah operasi terhadap subtype?
```

Jika subtype sering bertambah:

```text
interface polymorphism is convenient.
```

Contoh:

```java
interface NotificationSender {
    void send(Notification notification);
}
```

Tambah `EmailSender`, `SmsSender`, `PushSender` mudah.

Jika operasi sering bertambah terhadap finite subtype:

```text
sealed variants + pattern matching may be clearer.
```

Contoh:

```java
sealed interface DocumentCommand permits Create, Update, Delete { }
```

Lalu banyak policy bisa switch terhadap command.

Namun jika setiap operasi harus di-update saat subtype baru muncul, sealed hierarchy membantu compiler memberi sinyal.

---

## 40. Smell: Subclass yang Menonaktifkan Behavior Parent

Contoh:

```java
class BaseExporter {
    void exportPdf() { }
    void exportCsv() { }
}

class CsvOnlyExporter extends BaseExporter {
    @Override
    void exportPdf() {
        throw new UnsupportedOperationException();
    }
}
```

Ini smell.

Subclass tidak boleh menjadi “parent minus some behavior”.

Lebih baik pisahkan capability:

```java
interface CsvExporter {
    void exportCsv();
}

interface PdfExporter {
    void exportPdf();
}
```

Class implement capability yang benar-benar dimiliki.

---

## 41. Smell: Type Code Disguised as Inheritance

Kadang inheritance dibuat padahal behavior tidak beda.

```java
class Application { }
class NewApplication extends Application { }
class RenewalApplication extends Application { }
class AmendmentApplication extends Application { }
```

Jika semua subclass hanya membawa type label, mungkin lebih tepat:

```java
final class Application {
    private final ApplicationType type;
}
```

atau jika variant membawa data berbeda:

```java
sealed interface ApplicationCommand permits NewApplication, RenewalApplication, AmendmentApplication { }
```

Inheritance harus punya alasan behavioral atau structural yang kuat.

---

## 42. Smell: Base Class Menjadi Utility Dump

Contoh:

```java
abstract class BaseService {
    protected String normalizeName(String name) { }
    protected LocalDate parseDate(String value) { }
    protected void audit(String message) { }
    protected boolean hasRole(String role) { }
    protected void sendEmail(String to) { }
}
```

Semua service extend `BaseService` hanya untuk reuse helper.

Masalah:

- dependency melebar;
- testing sulit;
- hidden coupling;
- subclass mendapat method yang tidak relevan;
- base class menjadi god object;
- perubahan helper bisa memengaruhi semua subclass.

Lebih baik pecah menjadi dependency eksplisit:

```java
final class UserService {
    private final NameNormalizer normalizer;
    private final AuditLogger auditLogger;
    private final MailSender mailSender;
}
```

---

## 43. Smell: Boolean Flags Menggantikan Subtype atau Sebaliknya

Kadang boolean flag lebih tepat daripada inheritance.

```java
class ActiveUser extends User { }
class InactiveUser extends User { }
```

Kalau status berubah runtime, inheritance buruk.

Lebih tepat:

```java
final class User {
    private UserStatus status;
}
```

Sebaliknya, jika behavior benar-benar berbeda dan finite, subtype bisa lebih baik.

```java
sealed interface DiscountPolicy permits FixedDiscount, PercentageDiscount { }
```

Jangan dogmatis. Tanya: apakah ini identity/state mutable, atau variant behavior stabil?

---

## 44. Smell: `instanceof` terhadap Banyak Subclass

Jika code seperti ini menyebar:

```java
if (payment instanceof CardPayment card) {
    handleCard(card);
} else if (payment instanceof BankTransferPayment bank) {
    handleBank(bank);
} else if (payment instanceof WalletPayment wallet) {
    handleWallet(wallet);
}
```

Ada beberapa kemungkinan:

1. Behavior seharusnya polymorphic method di subtype.
2. Hierarchy finite dan pattern matching switch memang cocok.
3. Operation eksternal memang lebih baik dipisah dari subtype.
4. Model abstraction salah.

Jangan otomatis anti-`instanceof`. Di Java modern dengan sealed types, pattern matching bisa menjadi desain yang valid.

Yang buruk adalah `instanceof` menyebar tanpa kontrol.

---

## 45. Designing Extensible Base Classes

Jika benar-benar perlu base class extensible, gunakan checklist:

### 45.1 Make Constructor Minimal

Constructor hanya establish invariant superclass.

Jangan:

- panggil overridable method;
- start thread;
- register listener yang membuat `this` escape;
- call external service;
- rely pada subclass state.

### 45.2 Keep Fields Private

Jangan expose mutable state sebagai protected field.

Lebih baik:

```java
private final Map<String, Object> attributes = new HashMap<>();

protected final Object attribute(String key) { }
protected final void setAttribute(String key, Object value) { }
```

### 45.3 Make Template Methods Final

Algorithm yang menjaga invariant harus final.

```java
public final Result execute(Command command) {
    validate(command);
    return doExecute(command);
}

protected abstract Result doExecute(Command command);
```

### 45.4 Minimize Hook Surface

Jangan memberi 20 protected method. Setiap protected method adalah API.

### 45.5 Document Override Contract

Untuk setiap protected method, jelaskan:

- kapan dipanggil;
- boleh return null atau tidak;
- boleh throw apa;
- boleh mutate input atau tidak;
- apakah dipanggil sekali atau berkali-kali;
- apakah thread-safe;
- apakah subclass wajib call super;
- apakah method boleh blocking;
- apakah method boleh punya side effect.

### 45.6 Prefer Composition for Optional Behavior

Optional behavior lebih baik dependency/interface daripada hook kosong.

---

## 46. Example: Bad Base Service

Buruk:

```java
abstract class BaseCaseService {
    protected CaseRepository repository;
    protected AuditService auditService;
    protected User currentUser;

    public void process(CaseId id) {
        Case c = repository.find(id);
        beforeProcess(c);
        validate(c);
        doProcess(c);
        afterProcess(c);
        repository.save(c);
        auditService.audit(c, currentUser);
    }

    protected void beforeProcess(Case c) { }
    protected void validate(Case c) { }
    protected abstract void doProcess(Case c);
    protected void afterProcess(Case c) { }
}
```

Risiko:

- protected mutable dependencies;
- protected current user state;
- hook terlalu banyak;
- subclass bisa mutate case di banyak titik;
- `repository.save` selalu terjadi meski subclass ingin transaction boundary beda;
- audit order fixed tanpa contract jelas;
- test subclass harus paham lifecycle lengkap.

---

## 47. Improved Base with Narrow Extension Point

Lebih baik:

```java
public abstract class CaseOperation {
    private final CaseRepository repository;
    private final AuditService auditService;

    protected CaseOperation(CaseRepository repository, AuditService auditService) {
        this.repository = Objects.requireNonNull(repository);
        this.auditService = Objects.requireNonNull(auditService);
    }

    public final OperationResult execute(CaseId id, Actor actor) {
        Case current = repository.findRequired(id);
        OperationContext context = new OperationContext(current, actor);

        validate(context);
        Case updated = apply(context);

        repository.save(updated);
        auditService.record(actor, current, updated);

        return OperationResult.success(updated.id());
    }

    protected void validate(OperationContext context) {
        // default no-op, but contract must be documented
    }

    protected abstract Case apply(OperationContext context);
}
```

Lebih baik, tapi tetap perlu hati-hati.

Bahkan bisa lebih eksplisit dengan composition:

```java
final class CaseOperationRunner {
    private final CaseRepository repository;
    private final AuditService auditService;

    OperationResult execute(CaseId id, Actor actor, CasePolicy policy) {
        Case current = repository.findRequired(id);
        OperationContext context = new OperationContext(current, actor);

        policy.validate(context);
        Case updated = policy.apply(context);

        repository.save(updated);
        auditService.record(actor, current, updated);
        return OperationResult.success(updated.id());
    }
}

interface CasePolicy {
    void validate(OperationContext context);
    Case apply(OperationContext context);
}
```

Sekarang variasi behavior adalah dependency, bukan subclass.

---

## 48. Inheritance dan Test Design

Inheritance bisa membuat test fragile.

Contoh:

```java
class FakeBaseService extends BaseService {
    @Override
    protected void doSomething() { }
}
```

Test subclass sering dibuat hanya untuk mengakses protected method.

Jika terlalu sering begitu, mungkin API internal terlalu sulit dites.

Opsi:

- pindahkan logic ke collaborator package-private;
- test via public final template method;
- gunakan composition;
- kurangi protected helper;
- jangan expose protected hanya demi test.

Testing harus memvalidasi contract, bukan implementation ladder.

---

## 49. Inheritance dan Performance

Dynamic dispatch biasanya bukan masalah utama. JVM/JIT sangat mampu mengoptimalkan banyak virtual call melalui profiling dan inlining ketika target stabil.

Namun desain inheritance bisa berdampak ke performance secara tidak langsung:

- polymorphic/megaphormic call site lebih sulit di-inline;
- deep virtual dispatch bisa mengaburkan hot path;
- subclass override bisa mencegah asumsi optimizer;
- proxy subclass menambah interception overhead;
- reflection/proxy di hierarchy bisa memperlambat startup;
- class loading banyak subtype bisa memengaruhi cold start.

Tetapi jangan memilih `final` hanya karena “lebih cepat”. Pilih `final` terutama untuk invariant dan API clarity. Performance biasanya efek sekunder.

---

## 50. Inheritance dan Documentation

Class extensible wajib punya documentation berbeda dari class biasa.

Minimal untuk abstract base:

```java
/**
 * Base class for importing normalized records.
 *
 * <p>Subclass responsibilities:
 * <ul>
 *   <li>Implement {@link #parseRecord(String)} as a pure transformation.</li>
 *   <li>Do not mutate shared importer state.</li>
 *   <li>Throw {@link InvalidRecordException} for record-level validation failures.</li>
 * </ul>
 *
 * <p>Thread-safety: instances are immutable and may be reused concurrently if
 * subclass implementations are also thread-safe.
 */
public abstract class AbstractRecordImporter {
    public final ImportResult importLines(List<String> lines) { }
    protected abstract Record parseRecord(String line);
}
```

Tanpa documentation, subclass author akan mengisi gap dengan asumsi.

---

## 51. Inheritance dalam Public Library vs Internal Application

Risiko inheritance berbeda tergantung audience.

### Internal application

Kamu bisa refactor bersama semua subclass jika satu repo/satu team.

Tetap berisiko, tetapi manageable.

### Public/internal shared library

Subclass mungkin ada di service lain, repo lain, team lain.

Superclass change menjadi breaking change tersembunyi.

Untuk shared library:

- jangan expose abstract base class tanpa alasan kuat;
- prefer interface untuk SPI;
- gunakan final class untuk value/helper;
- gunakan sealed untuk closed model;
- dokumentasikan protected contract;
- hindari protected mutable state;
- versioning harus serius.

---

## 52. API Design: Prefer Narrow Interfaces for Callers

Caller jarang butuh concrete superclass.

Buruk:

```java
void process(AbstractPaymentService service) { }
```

Lebih baik:

```java
void process(PaymentProcessor processor) { }
```

Interface:

```java
interface PaymentProcessor {
    PaymentResult process(PaymentCommand command);
}
```

Implementation boleh extend base internal, tetapi caller tidak perlu tahu.

```java
final class CardPaymentProcessor extends AbstractPaymentProcessor
        implements PaymentProcessor {
}
```

Pisahkan:

```text
Caller-facing abstraction: interface
Implementation reuse: internal abstract class
```

---

## 53. Anti-Corruption Boundary untuk Inheritance Framework

Kadang kamu harus memakai framework berbasis inheritance.

Contoh:

```java
class MyFrameworkHandler extends FrameworkBaseHandler { }
```

Jangan biarkan inheritance framework bocor ke domain core.

Gunakan adapter:

```java
final class FrameworkHandlerAdapter extends FrameworkBaseHandler {
    private final DomainHandler domainHandler;

    @Override
    protected FrameworkResult handle(FrameworkRequest request) {
        DomainCommand command = map(request);
        DomainResult result = domainHandler.handle(command);
        return map(result);
    }
}
```

Dengan ini, domain tetap composition/interface based.

---

## 54. Checklist: Kapan Inheritance Tepat?

Inheritance layak jika sebagian besar jawaban adalah “ya”:

- Apakah subclass benar-benar subtype secara behavioral?
- Apakah caller superclass bisa menerima subclass tanpa special case?
- Apakah kontrak superclass stabil?
- Apakah subclass tidak perlu menonaktifkan behavior parent?
- Apakah extension point sedikit dan jelas?
- Apakah invariant superclass tetap bisa dijaga?
- Apakah constructor aman dari overridable method?
- Apakah protected state tidak bocor?
- Apakah equality/immutability tidak rusak?
- Apakah API evolution bisa dikontrol?
- Apakah hierarchy tidak terlalu dalam?
- Apakah interface/composition tidak lebih sederhana?

Jika banyak “tidak”, jangan pakai inheritance.

---

## 55. Checklist: Red Flags dalam Code Review

Waspadai:

- subclass override method lalu throw `UnsupportedOperationException`;
- superclass constructor memanggil overridable method;
- protected mutable field;
- subclass wajib call `super`, tapi tidak ada enforcement;
- deep hierarchy;
- base class berisi helper unrelated;
- public non-final class tanpa documentation extension;
- equality di class non-final value object;
- field hiding;
- static method hiding;
- overload yang dipakai sebagai runtime dispatch palsu;
- banyak `instanceof` tersebar;
- subclass hanya menambah label/type code;
- abstract class dipakai padahal interface cukup;
- inheritance framework bocor ke domain core;
- public abstract class dalam shared library tanpa compatibility policy.

---

## 56. Mini Case Study: Approval Workflow Design

Misal ada approval workflow:

- Draft;
- Submitted;
- UnderReview;
- Approved;
- Rejected.

### Option A: Inheritance-heavy state behavior

```java
abstract class ApprovalState {
    abstract ApprovalState submit();
    abstract ApprovalState approve();
    abstract ApprovalState reject();
}
```

Masalah: tidak semua transition valid untuk semua state.

### Option B: Sealed state + transition policy

```java
sealed interface ApprovalState
        permits Draft, Submitted, UnderReview, Approved, Rejected {
}

record Draft() implements ApprovalState { }
record Submitted() implements ApprovalState { }
record UnderReview() implements ApprovalState { }
record Approved() implements ApprovalState { }
record Rejected(String reason) implements ApprovalState { }

final class ApprovalTransitionPolicy {
    ApprovalState submit(ApprovalState state) {
        return switch (state) {
            case Draft draft -> new Submitted();
            default -> throw new IllegalStateException("Only draft can be submitted");
        };
    }
}
```

Keunggulan:

- state finite;
- transition eksplisit;
- invalid transition tidak dipaksa menjadi method di semua subtype;
- policy bisa berbeda per product/regulation;
- easier audit.

### Option C: Polymorphic transition command

```java
interface ApprovalAction {
    ApprovalState apply(ApprovalState current);
}
```

Cocok jika action adalah plugin/extension.

Kesimpulan: inheritance bukan default. Untuk workflow/regulatory system, sering lebih baik memakai sealed variant + explicit policy karena auditability dan transition reasoning lebih jelas.

---

## 57. Mini Case Study: Shared Enterprise Base Service

Banyak enterprise code punya:

```java
abstract class BaseService { }
```

Pertanyaan kritis:

1. Apakah semua service benar-benar subtype dari base service?
2. Apakah base service punya invariant domain?
3. Atau hanya tempat menaruh logger, mapper, repository, util, user context?

Jika hanya helper dump, refactor menjadi:

```text
Service
├── dependencies injected explicitly
├── reusable policies
├── utility classes where appropriate
└── narrow interfaces
```

Buruk:

```java
class RenewalService extends BaseApplicationService { }
class AppealService extends BaseApplicationService { }
class ComplianceService extends BaseApplicationService { }
```

Lebih baik:

```java
final class RenewalService {
    private final ApplicationRepository applicationRepository;
    private final RenewalPolicy renewalPolicy;
    private final AuditRecorder auditRecorder;
}
```

Keuntungan:

- dependency nyata terlihat;
- module boundary lebih jelas;
- test lebih mudah;
- tidak ada hidden lifecycle;
- tidak semua service terikat pada base class yang sama.

---

## 58. Top 1% Mental Model

Engineer biasa melihat inheritance sebagai:

```text
cara reuse code
```

Engineer kuat melihat inheritance sebagai:

```text
substitutability contract + runtime dispatch mechanism + API evolution burden
```

Engineer biasa bertanya:

```text
Can I extend this class?
```

Engineer kuat bertanya:

```text
Should this relationship be a subtype relationship?
What invariant is inherited?
Who owns the state?
Who controls lifecycle?
Can superclass evolve safely?
Can subclass break the caller contract?
Would interface/composition/sealed type be more precise?
```

Inheritance terbaik adalah inheritance yang:

- dangkal;
- disengaja;
- terdokumentasi;
- punya extension point sempit;
- menjaga invariant;
- tidak membocorkan mutable state;
- tidak dipakai hanya untuk helper reuse;
- tidak membuat caller melakukan special case;
- memiliki compatibility story.

---

## 59. Practical Design Rules

Gunakan rules ini sebagai default:

1. Value object harus `final` kecuali ada alasan sangat kuat.
2. Public class harus `final`, `sealed`, atau jelas didesain untuk inheritance.
3. Jangan expose protected mutable field.
4. Jangan panggil overridable method dari constructor.
5. Jangan pakai inheritance hanya untuk reuse helper.
6. Jangan buat hierarchy lebih dari 2–3 level tanpa alasan kuat.
7. Prefer interface untuk caller-facing contract.
8. Prefer composition untuk optional/reusable behavior.
9. Prefer sealed hierarchy untuk finite variants.
10. Abstract class boleh dipakai untuk shared invariant dan template algorithm yang stabil.
11. Setiap protected method adalah API, dokumentasikan seperti public API.
12. Hindari field hiding dan static method hiding.
13. Jangan rely pada overloading untuk runtime dispatch.
14. Review equality secara ekstra jika class non-final.
15. Untuk library, anggap protected member sebagai compatibility contract.

---

## 60. Latihan Pemahaman

### Latihan 1

Ada class:

```java
class BaseDocument {
    void submit() { }
    void approve() { }
    void reject() { }
}

class DraftDocument extends BaseDocument {
    @Override
    void approve() {
        throw new IllegalStateException();
    }
}
```

Pertanyaan:

- Apakah ini pelanggaran substitutability?
- Apakah lebih baik state sebagai subtype atau policy terpisah?
- Bagaimana jika transition rules berbeda per agency/product?

### Latihan 2

Ada shared library:

```java
public abstract class AbstractClient {
    protected HttpClient httpClient;
    protected abstract Request buildRequest(Input input);
    public Response call(Input input) { }
}
```

Review:

- Apa risiko protected field?
- Apakah `buildRequest` contract cukup jelas?
- Apa yang terjadi jika `call` diubah urutannya?
- Apakah interface + composition lebih baik?

### Latihan 3

Ada class:

```java
public class Money {
    public BigDecimal amount() { }
    public Currency currency() { }
}
```

Pertanyaan:

- Haruskah `Money` final?
- Apa risiko subclass terhadap equality?
- Apa risiko subclass terhadap immutability?
- Apakah record cocok?

---

## 61. Ringkasan

Inheritance di Java adalah fitur kuat, tetapi mahal secara desain.

Inti part ini:

- `extends` berarti substitutability, bukan sekadar kemiripan.
- Instance method overriding memakai runtime dispatch.
- Static method hiding dan field hiding bukan polymorphism.
- Constructor tidak diwarisi dan tidak boleh memanggil overridable method.
- Abstract class cocok untuk shared invariant dan template algorithm yang stabil.
- Protected member adalah API untuk subclass, bukan implementation detail bebas.
- Fragile base class problem nyata terutama pada public/shared library.
- Composition lebih baik untuk reuse behavior.
- Interface lebih baik untuk caller-facing contract.
- Sealed hierarchy lebih baik untuk finite domain variants.
- Public non-final class tanpa extension contract adalah risiko compatibility.

Inheritance yang baik bukan inheritance yang banyak. Inheritance yang baik adalah inheritance yang membuat substitusi aman dan reasoning lebih sederhana.

---

## 62. Referensi Resmi dan Bacaan Lanjut

- Java Language Specification, Java SE 25 — Chapter 8: Classes.
- Java Language Specification, Java SE 25 — Section 8.4.8: Inheritance, Overriding, and Hiding.
- Java Language Specification, Java SE 25 — Section 8.4.9: Overloading.
- Java Language Specification, Java SE 25 — Chapter 13: Binary Compatibility.
- Java SE 25 API — `java.lang.Object`.
- Java SE 25 API — `java.lang.Override`.
- JEP 409 — Sealed Classes.
- JEP 261 — Module System, especially strong encapsulation.

---

## 63. Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-006.md
```

Topik berikutnya:

```text
Interfaces Deep Dive: Contracts, Capabilities, Traits, Default Methods
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-004](./learn-java-oop-functional-reflection-codegen-modules-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-006](./learn-java-oop-functional-reflection-codegen-modules-part-006.md)

</div>
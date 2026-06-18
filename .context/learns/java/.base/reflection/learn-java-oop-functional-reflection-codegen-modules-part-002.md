# learn-java-oop-functional-reflection-codegen-modules-part-002

# Part 002 — Class Anatomy: Fields, Methods, Constructors, Initializers, Class Loading Semantics

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Fokus: Java OOP, Functional, Reflection, Code Generation, Modules & Package Management  
> Level: Advanced / Top 1% Software Engineer Mental Model

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membangun mental model tentang **type system Java**: type, class, object, reference, value, subtyping, casting, erasure, dan bagaimana API harus didesain dengan memahami batas compile-time dan runtime.

Part ini masuk ke unit fundamental berikutnya: **class anatomy**.

Bukan sekadar:

```java
class User {
    private String name;
    public User(String name) { this.name = name; }
}
```

Tapi memahami:

- apa yang sebenarnya terjadi ketika class dikompilasi,
- kapan field diinisialisasi,
- bagaimana constructor berjalan,
- apa beda instance initializer dan static initializer,
- kapan class benar-benar “aktif” di runtime,
- mengapa static state bisa berbahaya,
- bagaimana class loading memengaruhi framework, reflection, code generation, proxy, plugin, dan modularity,
- bagaimana desain class yang buruk dapat menciptakan bug yang tidak terlihat di code review biasa.

Target akhir part ini: kamu bisa membaca class Java bukan sebagai “wadah method dan field”, tetapi sebagai **unit kontrak, unit state, unit lifecycle, unit binary metadata, dan unit runtime initialization**.

---

## 1. Big Picture: Class Bukan Sekadar Template Object

Penjelasan pemula biasanya berkata:

> Class adalah blueprint dari object.

Itu benar, tetapi terlalu dangkal.

Untuk engineer senior, class di Java adalah minimal enam hal sekaligus:

| Perspektif | Class sebagai |
|---|---|
| Source-level | deklarasi struktur dan perilaku |
| Type-system | nominal type yang bisa digunakan compiler |
| Object-model | template instance object |
| Binary-level | `.class` file berisi metadata, bytecode, constant pool |
| Runtime-level | `Class<?>` object yang dimuat oleh class loader tertentu |
| Architecture-level | boundary invariant, visibility, API surface, dan dependency direction |

Satu class Java memiliki dua keberadaan:

```text
Source code:
  User.java

Compiled binary:
  User.class

Runtime metadata:
  java.lang.Class<User>

Runtime instances:
  User object #1
  User object #2
  User object #3
```

Kesalahan mental model paling umum adalah menyamakan semuanya.

Padahal:

- `User.java` adalah source artifact.
- `User.class` adalah binary artifact.
- `User.class` di filesystem belum tentu sudah loaded.
- `Class<User>` adalah runtime representation setelah class dimuat.
- `new User(...)` membuat instance, bukan class.
- static field melekat pada class runtime, bukan pada instance.
- class yang sama secara nama tetapi dimuat oleh class loader berbeda dapat menjadi type runtime yang berbeda.

---

## 2. Layer Mental Model: Source → Class File → Runtime Class → Object

Java class berjalan melalui pipeline konseptual:

```text
.java source
   |
   | javac
   v
.class bytecode
   |
   | class loader
   v
runtime Class<?> metadata
   |
   | new / reflection / method handle / framework
   v
object instances
```

Masing-masing layer punya aturan berbeda.

### 2.1 Source Layer

Di source layer, kamu melihat:

```java
public class Account {
    private final String id;

    public Account(String id) {
        this.id = id;
    }

    public String id() {
        return id;
    }
}
```

Di sini fokusnya:

- readability,
- API design,
- invariant,
- visibility,
- semantics,
- maintainability.

### 2.2 Class File Layer

Setelah dikompilasi, class menjadi `.class` file.

Isinya bukan Java source, tetapi struktur JVM:

- class name,
- superclass,
- interfaces,
- fields,
- methods,
- descriptors,
- bytecode,
- constant pool,
- attributes,
- generic signature metadata,
- annotations,
- inner class metadata,
- record metadata,
- permitted subclass metadata untuk sealed types.

Inilah yang dibaca JVM, reflection, bytecode libraries, agents, dan sebagian framework.

### 2.3 Runtime Class Metadata Layer

Ketika JVM memuat class, JVM membuat representasi runtime dari class tersebut.

Di Java, representasi itu terlihat sebagai object:

```java
Class<Account> accountClass = Account.class;
```

`Account.class` bukan instance `Account`. Itu object metadata yang merepresentasikan class `Account`.

### 2.4 Object Instance Layer

Instance dibuat dari class:

```java
Account a = new Account("A-001");
```

Instance memiliki:

- instance fields,
- object identity,
- monitor lock,
- reference relation ke runtime class metadata,
- lifecycle sebagai heap object.

Static fields tidak disimpan “di setiap object”. Static fields adalah state class-level.

---

## 3. Anatomy of a Java Class

Sebuah class Java dapat berisi:

- package declaration,
- imports,
- class modifiers,
- type parameters,
- superclass,
- interfaces,
- fields,
- constructors,
- methods,
- static initializer,
- instance initializer,
- nested types,
- annotations,
- documentation contract.

Contoh skeleton:

```java
package com.example.account;

import java.time.Instant;
import java.util.Objects;

public final class Account {
    private static final int MAX_NAME_LENGTH = 100;

    private final String id;
    private String displayName;
    private Instant updatedAt;

    static {
        // static initialization logic
    }

    {
        // instance initialization logic
    }

    public Account(String id, String displayName) {
        this.id = requireId(id);
        rename(displayName);
        this.updatedAt = Instant.now();
    }

    public String id() {
        return id;
    }

    public void rename(String displayName) {
        Objects.requireNonNull(displayName, "displayName");
        if (displayName.isBlank()) {
            throw new IllegalArgumentException("displayName must not be blank");
        }
        if (displayName.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("displayName is too long");
        }
        this.displayName = displayName;
        this.updatedAt = Instant.now();
    }

    private static String requireId(String id) {
        Objects.requireNonNull(id, "id");
        if (id.isBlank()) {
            throw new IllegalArgumentException("id must not be blank");
        }
        return id;
    }
}
```

Engineer pemula melihat ini sebagai class biasa.

Engineer senior melihat banyak boundary:

```text
static final constant    -> class-level invariant/configuration
final id                 -> identity/value invariant setelah construction
mutable displayName      -> controlled state mutation
constructor              -> invariant establishment boundary
rename()                 -> mutation gateway
private static helper    -> pure validation/helper logic
final class              -> no subclass may weaken invariant
package name             -> architectural placement
```

---

## 4. Fields: Storage, State, and Invariants

Field adalah variable yang menjadi member class.

Secara besar:

```text
field
├── static field       -> milik class/runtime metadata
└── instance field     -> milik setiap object instance
```

---

## 5. Instance Fields

Instance field menyimpan state per object.

```java
final class User {
    private final String id;
    private String name;

    User(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

Setiap object punya copy field sendiri:

```text
User#1
  id   = "U1"
  name = "Alice"

User#2
  id   = "U2"
  name = "Bob"
```

### 5.1 Instance Field sebagai State, Bukan Sekadar Data

Field harus dipahami sebagai bagian dari invariant object.

Buruk:

```java
public class Order {
    public String status;
    public BigDecimal total;
}
```

Masalah:

- semua code bisa mengubah status,
- tidak ada transisi valid,
- total bisa negatif,
- status bisa nilai sembarang,
- invariant tidak punya pemilik.

Lebih baik:

```java
public final class Order {
    private final String id;
    private OrderStatus status;
    private BigDecimal total;

    public Order(String id, BigDecimal total) {
        this.id = requireNonBlank(id);
        this.total = requireNonNegative(total);
        this.status = OrderStatus.DRAFT;
    }

    public void submit() {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Only draft order can be submitted");
        }
        status = OrderStatus.SUBMITTED;
    }

    public void reviseTotal(BigDecimal newTotal) {
        if (status == OrderStatus.CANCELLED) {
            throw new IllegalStateException("Cancelled order cannot be revised");
        }
        total = requireNonNegative(newTotal);
    }
}
```

Field yang baik bukan hanya “private”. Field yang baik adalah field yang mutation path-nya dikendalikan.

---

## 6. Static Fields

Static field melekat pada class, bukan object.

```java
final class IdGenerator {
    private static long sequence = 0;

    static long next() {
        return ++sequence;
    }
}
```

`sequence` hanya satu per runtime class definition.

Tetapi “satu” di sini punya nuance penting:

```text
same class name + same class loader      -> same static field storage
same class name + different class loader -> different runtime class -> different static field storage
```

Ini penting untuk:

- application server,
- plugin system,
- OSGi-like architecture,
- test isolation,
- hot reload,
- devtools,
- agent instrumentation,
- JPMS layers,
- frameworks yang memuat class secara custom.

### 6.1 Static Field yang Aman

Biasanya aman:

```java
private static final int MAX_RETRY = 3;
private static final Pattern EMAIL_PATTERN = Pattern.compile("...");
private static final Logger log = LoggerFactory.getLogger(MyClass.class);
```

Dengan catatan:

- object-nya immutable atau effectively immutable,
- tidak bergantung pada runtime environment yang berubah,
- tidak melakukan I/O berat saat class initialization,
- tidak menyimpan context request/user/tenant.

### 6.2 Static Field yang Berbahaya

Berbahaya:

```java
public final class CurrentUser {
    public static User value;
}
```

Masalah:

- global mutable state,
- race condition,
- test pollution,
- request leakage,
- memory leak,
- tenant leakage,
- sulit di-observe,
- lifecycle tidak jelas.

Juga berbahaya:

```java
public final class Config {
    public static final String TOKEN = loadTokenFromRemoteService();
}
```

Masalah:

- class initialization melakukan network call,
- failure menjadi `ExceptionInInitializerError`,
- retry sulit,
- startup ordering sulit,
- testing sulit,
- observability buruk,
- secret/token mungkin stale.

---

## 7. `final` Fields

`final` field hanya bisa diassign sekali.

```java
final class Customer {
    private final String id;

    Customer(String id) {
        this.id = id;
    }
}
```

Tetapi `final` tidak selalu berarti object immutable.

```java
final class Basket {
    private final List<String> items;

    Basket(List<String> items) {
        this.items = items;
    }

    List<String> items() {
        return items;
    }
}
```

`items` reference final, tetapi list-nya mutable.

```java
List<String> source = new ArrayList<>();
Basket basket = new Basket(source);
source.add("unexpected");
```

Lebih aman:

```java
final class Basket {
    private final List<String> items;

    Basket(List<String> items) {
        this.items = List.copyOf(items);
    }

    List<String> items() {
        return items;
    }
}
```

Mental model:

```text
final reference  != immutable object
private field    != safe invariant
getter only      != immutable exposure
```

---

## 8. Constant Variables and Compile-Time Constants

Tidak semua `static final` sama.

```java
public static final int MAX = 100;
public static final String NAME = "ACEAS";
```

Jika field adalah compile-time constant, compiler dapat inline nilainya ke class lain.

Contoh library:

```java
public final class Limits {
    public static final int MAX_PAGE_SIZE = 100;
}
```

Client code:

```java
int pageSize = Limits.MAX_PAGE_SIZE;
```

Bytecode client dapat menyimpan literal `100`, bukan membaca field runtime.

Jika library mengubah:

```java
public static final int MAX_PAGE_SIZE = 200;
```

tetapi client tidak dikompilasi ulang, client bisa tetap memakai `100`.

Ini penting untuk API publik.

### 8.1 Rule of Thumb

Untuk constant publik yang bisa berubah secara semantik:

- hindari public compile-time constant,
- gunakan accessor method,
- atau treat perubahan sebagai compatibility concern.

```java
public static int maxPageSize() {
    return 200;
}
```

---

## 9. Field Initialization Order

Instance field dapat diinisialisasi di declaration:

```java
final class Example {
    private String name = "default";
}
```

Atau di constructor:

```java
final class Example {
    private final String name;

    Example(String name) {
        this.name = name;
    }
}
```

Urutan sederhana saat object dibuat:

```text
1. memory object dialokasikan, field default value
2. superclass constructor dijalankan
3. instance field initializers dan instance initializer block dijalankan sesuai urutan source
4. constructor body subclass dijalankan
5. reference object dikembalikan ke caller
```

Default values:

| Type | Default |
|---|---|
| boolean | `false` |
| byte/short/int/long | `0` |
| float/double | `0.0` |
| char | `\u0000` |
| reference | `null` |

Contoh:

```java
class Demo {
    private int x = initX();
    private int y = 10;

    Demo() {
        System.out.println("constructor: x=" + x + ", y=" + y);
    }

    private int initX() {
        System.out.println("initX: y=" + y);
        return 5;
    }
}
```

Output konseptual:

```text
initX: y=0
constructor: x=5, y=10
```

Karena field diinisialisasi sesuai urutan deklarasi source.

### 9.1 Design Rule

Jangan membuat field initializer yang bergantung pada field lain yang dideklarasikan setelahnya.

Buruk:

```java
final class Config {
    private final URI endpoint = URI.create(baseUrl + "/api");
    private final String baseUrl;

    Config(String baseUrl) {
        this.baseUrl = baseUrl;
    }
}
```

`baseUrl` masih `null` saat `endpoint` diinisialisasi.

Lebih baik:

```java
final class Config {
    private final String baseUrl;
    private final URI endpoint;

    Config(String baseUrl) {
        this.baseUrl = requireValidBaseUrl(baseUrl);
        this.endpoint = URI.create(this.baseUrl + "/api");
    }
}
```

---

## 10. Methods: Behavior, Dispatch, and API Surface

Method bukan sekadar function di dalam class. Method adalah behavioral surface.

Jenis method:

```text
method
├── instance method
├── static method
├── abstract method
├── final method
├── private method
├── native method
├── synchronized method
├── default interface method
├── bridge method
└── synthetic method
```

Part ini fokus pada class methods. Dispatch detail lebih dalam akan dibahas di part polymorphism.

---

## 11. Instance Methods

Instance method dipanggil melalui receiver object:

```java
account.rename("New Name");
```

Receiver-nya adalah `account`.

Secara konseptual:

```text
rename(account, "New Name")
```

Tapi Java menyembunyikan receiver sebagai `this`.

```java
public void rename(String name) {
    this.name = validate(name);
}
```

`this` adalah reference ke current object.

### 11.1 Instance Method sebagai Mutation Gateway

Class yang baik tidak hanya punya method “CRUD field”.

Buruk:

```java
public void setStatus(String status) {
    this.status = status;
}
```

Lebih baik:

```java
public void approve(Approver approver) {
    if (status != Status.SUBMITTED) {
        throw new IllegalStateException("Only submitted application can be approved");
    }
    this.status = Status.APPROVED;
    this.approvedBy = approver.id();
    this.approvedAt = clock.instant();
}
```

Method harus mengekspresikan business transition, bukan sekadar exposing assignment.

---

## 12. Static Methods

Static method tidak punya receiver object.

```java
Math.max(1, 2);
```

Cocok untuk:

- pure utility,
- factory method,
- validation helper,
- stateless conversion,
- domain constructor alternative.

Contoh baik:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    private Money(BigDecimal amount, Currency currency) {
        this.amount = amount;
        this.currency = currency;
    }

    public static Money of(BigDecimal amount, Currency currency) {
        return new Money(requireNonNegative(amount), Objects.requireNonNull(currency));
    }
}
```

Static factory punya kelebihan dibanding public constructor:

- bisa diberi nama semantik,
- bisa return subtype,
- bisa cache,
- bisa validate sebelum object creation detail exposed,
- bisa menyembunyikan constructor.

Contoh:

```java
public static Application draft(Applicant applicant) { ... }
public static Application imported(ExternalApplicationId id) { ... }
public static Application restored(Snapshot snapshot) { ... }
```

Lebih ekspresif daripada constructor overload panjang.

### 12.1 Static Method Anti-Pattern

Buruk:

```java
public final class OrderServiceUtils {
    public static void process(Order order) {
        // reads global config
        // writes database
        // publishes event
        // calls remote API
    }
}
```

Masalah:

- dependency tersembunyi,
- testing sulit,
- lifecycle sulit,
- transaction boundary kabur,
- observability sulit,
- sulit diganti implementasi.

Static method sebaiknya **stateless and explicit**.

Jika butuh dependency, biasanya instance service lebih benar.

---

## 13. Private Methods

Private method adalah implementation detail.

```java
private void validateTransition(Status from, Status to) { ... }
```

Private method bukan API. Tetapi terlalu banyak private method bisa menandakan class terlalu besar.

### 13.1 Private Method Smell

Jika private method:

- sangat banyak,
- punya banyak parameter,
- punya state transition sendiri,
- sulit dites kecuali lewat banyak skenario tidak langsung,
- punya domain concept yang jelas,

mungkin ia harus diekstrak menjadi object/domain service/policy.

Buruk:

```java
class ApplicationService {
    private void validateApplicant(...) { ... }
    private void validateLicense(...) { ... }
    private void validatePayment(...) { ... }
    private void validateRisk(...) { ... }
    private void validateDocument(...) { ... }
    private void validateEligibility(...) { ... }
}
```

Lebih baik:

```java
final class ApplicationSubmissionPolicy {
    ValidationResult validate(ApplicationDraft draft) { ... }
}
```

---

## 14. Final Methods

`final` method tidak bisa dioverride.

```java
public final void submit() { ... }
```

Gunakan ketika:

- method menjaga invariant penting,
- subclass tidak boleh mengubah behavior,
- public API butuh stable semantics,
- template method memiliki fixed orchestration.

Namun jika terlalu banyak final method, class menjadi sulit diperluas.

Untuk library publik, `final` dapat menjadi alat compatibility:

- mencegah subclass bergantung pada internal behavior,
- mengurangi fragile base class problem,
- menjaga invariant.

---

## 15. Abstract Methods

Abstract method mendefinisikan obligation untuk subclass.

```java
abstract class DocumentParser {
    public final Document parse(InputStream input) {
        RawDocument raw = read(input);
        return convert(raw);
    }

    protected abstract Document convert(RawDocument raw);
}
```

Risiko:

- superclass memanggil abstract method terlalu awal,
- subclass belum terinisialisasi,
- invariant superclass/subclass sulit diselaraskan,
- inheritance dipakai untuk reuse padahal composition lebih cocok.

Contoh bahaya:

```java
abstract class Base {
    Base() {
        initialize(); // dangerous
    }

    protected abstract void initialize();
}

final class Child extends Base {
    private final String value;

    Child(String value) {
        this.value = value;
    }

    @Override
    protected void initialize() {
        System.out.println(value.length()); // value masih null
    }
}
```

Rule penting:

> Jangan panggil overridable method dari constructor.

---

## 16. Bridge and Synthetic Methods

Compiler kadang membuat method yang tidak ada di source code.

Contoh generics + overriding:

```java
interface Repository<T> {
    T findById(String id);
}

final class UserRepository implements Repository<User> {
    @Override
    public User findById(String id) {
        return new User(id);
    }
}
```

Karena type erasure, JVM-level signature dapat membutuhkan bridge method agar polymorphism tetap benar.

Konseptual:

```java
public Object findById(String id) {
    return findById(id); // calls User-returning method
}
```

Ini penting untuk:

- reflection,
- method scanning framework,
- annotation processing,
- bytecode generation,
- proxy generation,
- API compatibility.

Jika framework kamu scan semua method tanpa filter `isBridge()` dan `isSynthetic()`, kamu bisa memproses method duplikat.

---

## 17. Constructors: Object Construction Boundary

Constructor bukan “method biasa”.

Constructor:

- tidak punya return type,
- namanya sama dengan class,
- dipanggil saat instance creation,
- bertanggung jawab membangun invariant awal,
- selalu melibatkan superclass constructor,
- tidak diwariskan,
- tidak bisa abstract/final/static.

Contoh:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        this.value = normalizeAndValidate(value);
    }
}
```

Constructor adalah **invariant establishment boundary**.

Jika object berhasil dibuat, object harus valid.

Buruk:

```java
public final class EmailAddress {
    private String value;

    public EmailAddress(String value) {
        this.value = value;
    }

    public boolean isValid() {
        return value != null && value.contains("@");
    }
}
```

Masalah:

- invalid object dapat beredar,
- semua caller harus ingat memanggil `isValid`,
- invariant tidak enforced.

Lebih baik:

```java
public final class EmailAddress {
    private final String value;

    public EmailAddress(String value) {
        if (value == null || !value.contains("@")) {
            throw new IllegalArgumentException("Invalid email address");
        }
        this.value = value.toLowerCase(Locale.ROOT);
    }
}
```

---

## 18. Constructor Overloading

Constructor overload bisa berguna, tetapi mudah membingungkan.

```java
public User(String id) { ... }
public User(String id, String name) { ... }
public User(String id, String name, boolean active) { ... }
```

Masalah:

- parameter order ambiguity,
- boolean trap,
- overload explosion,
- unclear semantics.

Lebih baik dengan static factory:

```java
public static User registered(String id, String name) { ... }
public static User imported(String id) { ... }
public static User suspended(String id, String reason) { ... }
```

Atau builder jika memang banyak optional fields.

Tetapi builder juga bisa menjadi anti-pattern jika dipakai untuk object yang harus punya invariant kuat.

Buruk:

```java
User user = User.builder()
    .name("Alice")
    .build(); // id missing?
```

Builder yang baik tetap enforce required state.

---

## 19. Constructor Chaining

Constructor bisa memanggil constructor lain dengan `this(...)`.

```java
public final class PageRequest {
    private final int page;
    private final int size;

    public PageRequest() {
        this(0, 20);
    }

    public PageRequest(int page, int size) {
        this.page = requireNonNegative(page);
        this.size = requirePositive(size);
    }
}
```

Aturan:

- `this(...)` harus statement pertama.
- `super(...)` juga harus statement pertama jika dipakai.
- Constructor harus memilih `this(...)` atau `super(...)`, tidak bisa keduanya langsung.
- Jika tidak ditulis, compiler menambahkan `super()` secara implisit.

---

## 20. Construction Order in Inheritance

Contoh:

```java
class Parent {
    Parent() {
        System.out.println("Parent constructor");
    }
}

class Child extends Parent {
    private String value = initValue();

    Child() {
        System.out.println("Child constructor");
    }

    private String initValue() {
        System.out.println("Child field initializer");
        return "x";
    }
}
```

Saat `new Child()`:

```text
1. allocate memory for Child object; fields default value
2. call Parent constructor
3. run Child field initializer
4. run Child constructor body
```

Output:

```text
Parent constructor
Child field initializer
Child constructor
```

### 20.1 Superclass Constructor Hazard

Jika superclass constructor memanggil overridable method:

```java
class Parent {
    Parent() {
        print();
    }

    void print() {
        System.out.println("parent");
    }
}

class Child extends Parent {
    private String message = "child";

    @Override
    void print() {
        System.out.println(message.toUpperCase());
    }
}
```

Saat `Parent()` berjalan, `message` masih default `null`. Ini bisa NPE.

Rule:

```text
Constructor must establish invariant, not dispatch into subclass behavior.
```

---

## 21. Instance Initializer Blocks

Instance initializer block:

```java
class Demo {
    {
        System.out.println("instance initializer");
    }

    Demo() {
        System.out.println("constructor");
    }
}
```

Berjalan setiap kali object dibuat, sebelum constructor body.

Kegunaan praktisnya terbatas.

Cocok kadang untuk:

- anonymous class initialization,
- shared initialization across constructors,
- generated code pattern.

Namun di production business code, instance initializer sering menurunkan readability.

Lebih jelas:

```java
Demo() {
    initialize();
}
```

atau constructor chaining.

---

## 22. Static Initializer Blocks

Static initializer berjalan saat class initialization.

```java
final class CryptoRegistry {
    private static final Map<String, Algorithm> ALGORITHMS;

    static {
        Map<String, Algorithm> map = new HashMap<>();
        map.put("A", new Algorithm("A"));
        map.put("B", new Algorithm("B"));
        ALGORITHMS = Map.copyOf(map);
    }
}
```

Static initializer cocok untuk:

- membangun immutable lookup table,
- precomputed constants,
- pure deterministic initialization.

Tidak cocok untuk:

- network call,
- database call,
- reading secret dynamically,
- starting thread,
- opening socket,
- loading huge file tanpa kontrol,
- calling framework bean/service,
- relying on initialization order between unrelated classes.

### 22.1 Static Initializer Failure

Jika static initializer gagal:

```java
final class Broken {
    static final String VALUE = fail();

    private static String fail() {
        throw new RuntimeException("boom");
    }
}
```

Pemakaian pertama bisa menghasilkan:

```text
ExceptionInInitializerError
```

Setelah class initialization gagal, class dapat masuk state error untuk class loader tersebut. Pemakaian berikutnya bisa menghasilkan `NoClassDefFoundError` yang membingungkan.

Ini salah satu alasan static initializer berat sangat berbahaya di production.

---

## 23. Initialization Order: Complete Mental Model

Untuk object creation:

```text
new Child()

0. evaluate constructor arguments
1. allocate memory; all fields default values
2. invoke Object constructor chain upward/downward via super()
3. for each class in hierarchy, before its constructor body:
   a. instance field initializers run in source order
   b. instance initializer blocks run in source order mixed with field initializers
   c. constructor body runs
4. reference returned to caller
```

Lebih detail untuk hierarchy:

```text
Object constructor
Parent field initializers
Parent instance initializer blocks
Parent constructor body
Child field initializers
Child instance initializer blocks
Child constructor body
```

Static initialization terpisah:

```text
Class initialization
  static fields + static blocks in source order
```

Static initialization terjadi sebelum class digunakan secara aktif.

---

## 24. Class Loading, Linking, and Initialization

JVM lifecycle untuk class/interface secara besar:

```text
Loading -> Linking -> Initialization
```

### 24.1 Loading

Loading adalah proses menemukan binary representation class/interface dan membuat runtime class dari binary tersebut.

Class loader bertanggung jawab mencari atau menghasilkan bytes yang mendefinisikan class.

Contoh sumber class bytes:

- `.class` file di classpath,
- JAR di module path,
- generated bytecode,
- network source,
- in-memory compiler,
- instrumentation agent,
- application server class loader.

### 24.2 Linking

Linking menggabungkan class ke runtime state JVM.

Linking mencakup:

```text
Verification -> Preparation -> Resolution
```

#### Verification

Memastikan binary representation valid dan aman untuk JVM.

Misalnya:

- bytecode structurally valid,
- operand stack usage valid,
- type constraints terpenuhi,
- control flow valid.

#### Preparation

Mengalokasikan dan menyiapkan storage untuk static fields dengan default values.

Contoh:

```java
class Demo {
    static int x = 10;
}
```

Pada preparation, `x` default dulu menjadi `0`. Nilai `10` diberikan saat initialization.

#### Resolution

Mengubah symbolic references menjadi direct references saat diperlukan.

Contoh symbolic reference:

```text
com/example/UserService.findById:(Ljava/lang/String;)Lcom/example/User;
```

Resolution bisa lazy atau eager tergantung implementasi/konteks.

### 24.3 Initialization

Initialization menjalankan class initialization logic:

- static field initializers,
- static initializer blocks,
- sesuai urutan source.

```java
class Demo {
    static int x = initX();

    static {
        System.out.println("static block");
    }
}
```

---

## 25. When Does Class Initialization Occur?

Class initialization terjadi saat active use tertentu, misalnya:

- membuat instance class,
- memanggil static method,
- membaca/menulis static field yang bukan compile-time constant,
- reflective invocation tertentu,
- initialization subclass yang membutuhkan superclass initialized lebih dulu.

Contoh:

```java
class Demo {
    static {
        System.out.println("Demo initialized");
    }

    static final int COMPILE_TIME_CONSTANT = 42;
    static final Integer RUNTIME_CONSTANT = 42;
}
```

Pemakaian:

```java
int x = Demo.COMPILE_TIME_CONSTANT;
```

Bisa tidak memicu initialization karena nilainya compile-time constant.

Tetapi:

```java
Integer y = Demo.RUNTIME_CONSTANT;
```

memicu initialization.

### 25.1 Class Literal

```java
Class<?> c = Demo.class;
```

Class literal dapat memperoleh class object tanpa menjalankan static initializer.

Tetapi reflective access tertentu dapat memicu initialization tergantung operasi.

Ini penting untuk framework scanner.

Framework yang hanya ingin membaca metadata harus hati-hati agar tidak tanpa sengaja menjalankan static initializer user code.

---

## 26. ClassLoader: Identity and Boundary

`ClassLoader` adalah object yang bertanggung jawab memuat class.

Runtime type identity di Java bukan hanya nama class.

Secara mental:

```text
runtime type identity = binary name + defining class loader
```

Dua class dengan nama sama tetapi class loader berbeda bukan type runtime yang sama.

Contoh konseptual:

```text
loaderA loads com.example.Plugin
loaderB loads com.example.Plugin

com.example.Plugin from loaderA != com.example.Plugin from loaderB
```

Efek:

```java
Object plugin = loaderA.loadClass("com.example.Plugin")
    .getConstructor()
    .newInstance();

Class<?> pluginTypeFromB = loaderB.loadClass("com.example.Plugin");

pluginTypeFromB.cast(plugin); // ClassCastException
```

Walaupun nama class sama.

### 26.1 Kenapa Ini Penting?

Untuk:

- plugin architecture,
- app server,
- test runner,
- Spring Boot devtools,
- OSGi-like systems,
- Java agents,
- hot reload,
- isolated tenants,
- shading/relocation,
- dependency conflict isolation.

Bug class loader sering terlihat seperti:

```text
ClassCastException: com.example.Foo cannot be cast to com.example.Foo
```

Itu bukan typo. Itu dua `Foo` berbeda karena class loader berbeda.

---

## 27. Class Loading and Static State

Static state scoped ke runtime class.

Jika class dimuat dua class loader, static state juga dua.

```text
PluginConfig loaded by loaderA
  static INSTANCE = A

PluginConfig loaded by loaderB
  static INSTANCE = B
```

Ini bisa menjadi feature atau bug.

Feature:

- plugin isolation,
- tenant isolation,
- test isolation.

Bug:

- duplicated singleton,
- inconsistent cache,
- memory leak,
- class unloading gagal karena static reference chain.

---

## 28. Class Unloading and Memory Leaks

Class dapat di-unload hanya jika class loader dan semua class yang didefinisikannya tidak lagi reachable.

Masalah umum:

```java
public final class GlobalRegistry {
    private static final List<Object> plugins = new ArrayList<>();

    public static void register(Object plugin) {
        plugins.add(plugin);
    }
}
```

Jika `GlobalRegistry` dimuat oleh parent class loader, lalu plugin object dari child class loader didaftarkan, parent menyimpan reference ke child object. Akibatnya child class loader tidak bisa GC/unload.

```text
Parent class loader static field
  -> plugin instance
     -> plugin class
        -> child class loader
           -> all plugin classes
```

Ini memory leak klasik pada plugin/hot reload/app server.

---

## 29. Class Initialization and Circular Dependencies

Static initialization rentan circular dependency.

```java
class A {
    static final int X = B.Y + 1;
}

class B {
    static final int Y = A.X + 1;
}
```

Hasilnya bisa mengejutkan karena salah satu class melihat default value saat class lain masih initializing.

Contoh:

```java
class A {
    static int x = B.y + 1;
}

class B {
    static int y = A.x + 1;
}
```

Jika akses pertama `A.x`:

```text
A initialization starts
A.x needs B.y
B initialization starts
B.y reads A.x while A still initializing -> default 0
B.y = 1
A.x = 2
```

Hasil:

```text
A.x = 2
B.y = 1
```

Jika akses pertama berbeda, reasoning bisa berubah.

Rule:

> Jangan desain static initialization yang bergantung pada static initialization class lain secara circular.

---

## 30. The Initialization-on-Demand Holder Idiom

Untuk lazy singleton yang aman, Java sering memakai holder idiom:

```java
public final class Registry {
    private Registry() {}

    public static Registry instance() {
        return Holder.INSTANCE;
    }

    private static final class Holder {
        private static final Registry INSTANCE = new Registry();
    }
}
```

Kenapa bekerja?

- `Holder` tidak diinisialisasi saat `Registry` diinisialisasi.
- `Holder` diinisialisasi saat `Holder.INSTANCE` pertama kali diakses.
- Class initialization JVM punya synchronization guarantee.

Namun gunakan dengan bijak.

Untuk aplikasi dependency-injection modern, sering lebih baik lifecycle singleton dikelola container.

Holder idiom cocok untuk:

- library kecil,
- pure stateless registry,
- lazy expensive immutable object,
- tanpa external lifecycle.

Tidak cocok untuk:

- database connection,
- HTTP client dengan shutdown lifecycle,
- tenant-aware service,
- request scoped object,
- secret/token refresh.

---

## 31. Class Design: Invariant-First Construction

Top engineer mendesain class dari invariant, bukan dari field.

Pertanyaan utama:

```text
1. Object ini mewakili konsep apa?
2. State apa yang wajib selalu benar?
3. Siapa yang boleh mengubah state?
4. Transisi apa yang valid?
5. Apa yang harus mustahil secara desain?
6. Apa yang boleh dilihat caller?
7. Apa yang harus disembunyikan?
8. Apakah class ini boleh diwariskan?
9. Apakah class ini thread-safe, immutable, confined, atau mutable biasa?
10. Apakah class ini API publik atau internal implementation?
```

Contoh buruk:

```java
public class CaseFile {
    public String status;
    public String assignee;
    public List<String> documents;
    public LocalDateTime submittedAt;
    public LocalDateTime approvedAt;
}
```

Contoh lebih baik:

```java
public final class CaseFile {
    private final CaseId id;
    private CaseStatus status;
    private OfficerId assignee;
    private final List<DocumentRef> documents;
    private Instant submittedAt;
    private Instant approvedAt;

    private CaseFile(CaseId id, List<DocumentRef> documents) {
        this.id = Objects.requireNonNull(id);
        this.documents = new ArrayList<>(documents);
        this.status = CaseStatus.DRAFT;
    }

    public static CaseFile draft(CaseId id, List<DocumentRef> documents) {
        if (documents.isEmpty()) {
            throw new IllegalArgumentException("Case file must contain at least one document");
        }
        return new CaseFile(id, documents);
    }

    public void assignTo(OfficerId officerId) {
        if (status == CaseStatus.APPROVED || status == CaseStatus.REJECTED) {
            throw new IllegalStateException("Closed case cannot be reassigned");
        }
        this.assignee = Objects.requireNonNull(officerId);
    }

    public void submit(Instant now) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalStateException("Only draft case can be submitted");
        }
        if (assignee == null) {
            throw new IllegalStateException("Case must be assigned before submission");
        }
        this.status = CaseStatus.SUBMITTED;
        this.submittedAt = Objects.requireNonNull(now);
    }

    public void approve(Instant now) {
        if (status != CaseStatus.SUBMITTED) {
            throw new IllegalStateException("Only submitted case can be approved");
        }
        this.status = CaseStatus.APPROVED;
        this.approvedAt = Objects.requireNonNull(now);
    }

    public List<DocumentRef> documents() {
        return List.copyOf(documents);
    }
}
```

Perhatikan:

- constructor private,
- static factory semantic,
- invariant saat draft dibuat,
- mutation melalui method domain,
- list tidak diekspos mutable,
- status transition terkendali,
- impossible states dikurangi.

---

## 32. Designing Around Object Lifecycle

Object lifecycle minimal:

```text
allocated -> constructed -> used -> unreachable -> garbage collected
```

Tetapi domain object punya lifecycle lain:

```text
draft -> submitted -> reviewed -> approved/rejected -> archived
```

Jangan mencampur keduanya.

Constructor bukan tempat untuk semua domain transition.

Constructor harus menjawab:

> Apa minimal invariant agar object ini valid untuk mulai hidup?

Domain method menjawab:

> Bagaimana object berubah secara valid dari satu state ke state lain?

---

## 33. Avoid Partially Constructed Object Escape

Masalah serius: `this` bocor sebelum constructor selesai.

Buruk:

```java
public final class EventListener {
    private final EventBus eventBus;
    private final String name;

    public EventListener(EventBus eventBus) {
        this.eventBus = eventBus;
        eventBus.register(this); // this escapes
        this.name = "listener";
    }

    public void onEvent(Event event) {
        System.out.println(name.length());
    }
}
```

Jika event bus memanggil listener sebelum constructor selesai, `name` masih `null`.

Lebih baik:

```java
public final class EventListener {
    private final EventBus eventBus;
    private final String name;

    private EventListener(EventBus eventBus, String name) {
        this.eventBus = eventBus;
        this.name = name;
    }

    public static EventListener createAndRegister(EventBus eventBus) {
        EventListener listener = new EventListener(eventBus, "listener");
        eventBus.register(listener);
        return listener;
    }
}
```

Atau lifecycle registration dikelola container setelah construction selesai.

---

## 34. Heavy Constructor Anti-Pattern

Constructor buruk:

```java
public ReportGenerator(Config config) {
    this.config = config;
    this.connection = DriverManager.getConnection(config.dbUrl());
    this.template = downloadTemplate(config.templateUrl());
    startBackgroundThread();
}
```

Masalah:

- construction bisa lambat,
- constructor bisa gagal karena network,
- object partially initialized,
- sulit testing,
- lifecycle resource tidak jelas,
- shutdown tidak jelas,
- retry tidak jelas.

Lebih baik pisahkan:

```java
public final class ReportGenerator {
    private final Template template;
    private final ReportRepository repository;

    public ReportGenerator(Template template, ReportRepository repository) {
        this.template = Objects.requireNonNull(template);
        this.repository = Objects.requireNonNull(repository);
    }
}
```

Resource creation dilakukan di composition root/container/factory terkontrol.

---

## 35. Static Initialization vs Dependency Injection

Static:

```java
final class Services {
    static final PaymentClient PAYMENT_CLIENT = new PaymentClient(loadConfig());
}
```

DI/composition:

```java
PaymentClient paymentClient = new PaymentClient(config);
PaymentService paymentService = new PaymentService(paymentClient);
```

Static initialization menyembunyikan dependency.

DI/composition membuat dependency eksplisit.

Perbandingan:

| Concern | Static Initialization | Explicit Composition |
|---|---|---|
| Dependency visibility | tersembunyi | jelas |
| Testability | sulit | mudah |
| Lifecycle | kabur | eksplisit |
| Retry | sulit | terkontrol |
| Observability | sulit | bisa diinstrument |
| Configuration reload | sulit | mungkin |
| Tenant awareness | buruk | bisa dirancang |

Static bukan musuh. Tetapi static harus dipakai untuk hal yang benar: pure, immutable, deterministic, lifecycle-free.

---

## 36. Class Anatomy and Reflection

Reflection melihat class dari metadata runtime.

```java
Class<?> type = CaseFile.class;
Field[] fields = type.getDeclaredFields();
Method[] methods = type.getDeclaredMethods();
Constructor<?>[] constructors = type.getDeclaredConstructors();
```

Reflection dapat melihat:

- fields,
- methods,
- constructors,
- annotations,
- modifiers,
- generic signatures,
- record components,
- permitted subclasses,
- enclosing/nested type information.

Tetapi reflection punya jebakan:

- bisa melihat synthetic/bridge members,
- access control bisa membatasi,
- JPMS strong encapsulation bisa membatasi deep reflection,
- metadata generic bisa hilang karena erasure,
- parameter names perlu compiler flag `-parameters` untuk reliable runtime names,
- membaca metadata tertentu tidak sama dengan menjalankan class initialization.

Framework yang baik membedakan:

```text
metadata scanning
  vs
class initialization
  vs
object instantiation
  vs
method invocation
```

---

## 37. Class Anatomy and Code Generation

Code generator harus memahami class anatomy.

Misalnya generator membuat mapper:

```java
public final class UserMapperGenerated {
    public UserDto toDto(User user) { ... }
}
```

Generator harus memutuskan:

- constructor mana yang dipakai,
- field atau accessor mana yang dibaca,
- null handling,
- visibility boundary,
- package placement,
- generic type handling,
- annotation interpretation,
- record constructor handling,
- module access,
- generated class name,
- synthetic/generated marker,
- incremental rebuild.

Jika generator asal membaca field private via reflection, ia melanggar encapsulation dan bisa rusak di JPMS.

Jika generator memakai public API, ia lebih stabil tetapi mungkin kurang powerful.

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Field access | cepat/langsung | melanggar invariant |
| Getter/setter | umum | mendorong anemic model |
| Constructor mapping | invariant-friendly | butuh parameter mapping |
| Static factory | semantic | discovery lebih sulit |
| Builder | fleksibel | bisa bypass required invariant jika buruk |

---

## 38. Class Anatomy and Modules

JPMS mengubah cara kita berpikir tentang class.

Sebelum JPMS, banyak framework mengandalkan:

```text
classpath + reflection + setAccessible(true)
```

Dengan module system, package dapat diekspor atau dibuka secara eksplisit.

Konsep:

```java
module com.example.caseapp {
    exports com.example.caseapp.api;
    opens com.example.caseapp.internal.persistence to com.fasterxml.jackson.databind;
}
```

Artinya:

- package API diekspor untuk compile-time/read access,
- package internal tidak otomatis accessible,
- package tertentu bisa dibuka hanya untuk reflective framework tertentu.

Ini membuat class anatomy dan package/module design saling terkait.

Field private bukan satu-satunya boundary. Module juga boundary.

---

## 39. Class Anatomy and Binary Compatibility

Perubahan source kecil dapat berdampak binary besar.

Contoh:

```java
public class User {
    public String name;
}
```

Jika diubah menjadi:

```java
public class User {
    private String name;
    public String name() { return name; }
}
```

Source design lebih baik, tetapi binary compatibility untuk client yang mengakses field publik rusak.

Contoh lain:

```java
public User(String id, String name) { ... }
```

Jika constructor dihapus/diganti, client binary yang sudah compile bisa gagal runtime.

API publik harus diperlakukan sebagai kontrak binary, bukan hanya source.

Hal yang harus hati-hati:

- menghapus public/protected field,
- mengubah field menjadi method,
- menghapus constructor publik,
- mengubah method return type tidak kompatibel,
- mengubah checked exception contract,
- mengubah class dari non-final ke final atau sebaliknya dalam konteks subclass client,
- mengubah static menjadi instance atau sebaliknya,
- mengubah constant value publik.

Part API evolution nanti akan membahas ini jauh lebih dalam.

---

## 40. Practical Design Matrix: Field/Method/Constructor Decision

### 40.1 Field Decision

Tanya:

```text
Apakah state ini bagian dari invariant?
Apakah boleh berubah?
Siapa yang boleh mengubah?
Apakah perlu terlihat keluar?
Apakah reference mutable?
Apakah perlu defensive copy?
Apakah nilai ini derived atau stored?
Apakah static benar-benar aman?
```

Rule:

```text
Default: private final jika memungkinkan.
Mutable: private, mutation via meaningful method.
Static mutable: hindari kecuali benar-benar controlled.
Public field: hampir selalu salah untuk domain/API publik.
```

### 40.2 Method Decision

Tanya:

```text
Apakah method ini command, query, factory, validator, converter, atau lifecycle operation?
Apakah method ini mengubah state?
Apakah nama method menunjukkan intent domain?
Apakah method boleh dioverride?
Apakah method expose internal representation?
Apakah method punya side effect tersembunyi?
```

Rule:

```text
Method publik = API contract.
Method private = implementation detail.
Method protected = inheritance contract; gunakan sangat hati-hati.
Static method = no hidden dependency.
```

### 40.3 Constructor Decision

Tanya:

```text
Apa invariant minimal object valid?
Apakah constructor overload jelas?
Apakah static factory lebih ekspresif?
Apakah object bisa partially constructed?
Apakah constructor melakukan I/O?
Apakah this escape?
Apakah subclass bisa mengganggu initialization?
```

Rule:

```text
Constructor should establish validity, not perform operational workflow.
```

---

## 41. Failure Model: Bugs yang Berasal dari Class Anatomy Buruk

### 41.1 Null During Initialization

Penyebab:

- field initializer bergantung pada field yang belum di-set,
- constructor memanggil overridable method,
- `this` escape sebelum constructor selesai.

Gejala:

- NPE saat startup,
- NPE intermittent,
- behavior beda antara test dan production.

### 41.2 Static Initialization Failure

Penyebab:

- static block melakukan I/O,
- config invalid,
- circular dependency,
- exception tidak ditangani.

Gejala:

- `ExceptionInInitializerError`,
- `NoClassDefFoundError` setelah failure pertama,
- startup failure sulit dilacak.

### 41.3 Global Mutable State

Penyebab:

- public static mutable field,
- singleton menyimpan context request,
- cache tanpa lifecycle.

Gejala:

- test flaky,
- tenant leakage,
- user leakage,
- race condition,
- memory leak.

### 41.4 Reflection Breakage

Penyebab:

- framework mengasumsikan constructor no-arg,
- private member tidak accessible di module,
- generated proxy tidak bisa subclass final class,
- synthetic/bridge method diproses salah.

Gejala:

- runtime framework error,
- mapping gagal,
- proxy creation gagal,
- works in classpath but fails in module path.

### 41.5 Binary Compatibility Breakage

Penyebab:

- public constructor dihapus,
- public field diganti method,
- constant publik berubah tanpa recompile client,
- method signature berubah.

Gejala:

- `NoSuchMethodError`,
- `NoSuchFieldError`,
- `IllegalAccessError`,
- behavior lama tetap muncul karena constant inlining.

---

## 42. Production Checklist: Class Anatomy Review

Gunakan checklist ini saat review class penting.

### 42.1 State and Fields

- [ ] Semua field punya alasan keberadaan yang jelas.
- [ ] Tidak ada public mutable field.
- [ ] Field yang bisa `final` dibuat `final`.
- [ ] Mutable collection tidak diekspos langsung.
- [ ] Derived value tidak disimpan kecuali ada alasan performa/konsistensi.
- [ ] Static field immutable atau lifecycle-nya jelas.
- [ ] Tidak ada request/user/tenant context di static field.

### 42.2 Constructors

- [ ] Constructor membangun object valid.
- [ ] Tidak ada I/O berat di constructor.
- [ ] Tidak ada `this` escape dari constructor.
- [ ] Constructor tidak memanggil overridable method.
- [ ] Overload constructor tidak ambigu.
- [ ] Static factory dipakai jika nama semantik lebih jelas.

### 42.3 Methods

- [ ] Public methods merepresentasikan contract jelas.
- [ ] Mutation method menjaga invariant.
- [ ] Method tidak mengekspos internal mutable state.
- [ ] Protected methods benar-benar bagian inheritance contract.
- [ ] Static methods tidak menyembunyikan dependency operasional.
- [ ] Private methods tidak menandakan class terlalu besar.

### 42.4 Initialization

- [ ] Field initializer tidak bergantung pada urutan rapuh.
- [ ] Static initializer pure/deterministic.
- [ ] Tidak ada circular static initialization.
- [ ] Failure saat initialization mudah didiagnosis.
- [ ] Class scanner framework tidak memicu initialization tidak perlu.

### 42.5 Runtime/Framework

- [ ] Class final/non-final dipilih sadar.
- [ ] Constructor yang dibutuhkan framework tersedia atau sengaja tidak tersedia.
- [ ] Reflection/proxy/codegen boundary jelas.
- [ ] JPMS exports/opens dirancang jika modular.
- [ ] Generated code tidak bypass invariant tanpa alasan kuat.

---

## 43. Design Example: From Naive Class to Production-Grade Class

### 43.1 Naive Version

```java
public class Application {
    public String id;
    public String status;
    public String applicantName;
    public List<String> documents;
    public LocalDateTime createdAt;
    public LocalDateTime submittedAt;
}
```

Masalah:

- semua field public,
- status stringly typed,
- documents mutable exposed,
- timestamp bisa inconsistent,
- object bisa status submitted tanpa submittedAt,
- object bisa no documents,
- tidak ada transition rule.

### 43.2 Better Class Anatomy

```java
public final class Application {
    private final ApplicationId id;
    private final ApplicantName applicantName;
    private final List<DocumentRef> documents;
    private final Instant createdAt;
    private ApplicationStatus status;
    private Instant submittedAt;

    private Application(
            ApplicationId id,
            ApplicantName applicantName,
            List<DocumentRef> documents,
            Instant createdAt
    ) {
        this.id = Objects.requireNonNull(id, "id");
        this.applicantName = Objects.requireNonNull(applicantName, "applicantName");
        this.documents = new ArrayList<>(requireNonEmpty(documents));
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.status = ApplicationStatus.DRAFT;
    }

    public static Application draft(
            ApplicationId id,
            ApplicantName applicantName,
            List<DocumentRef> documents,
            Instant now
    ) {
        return new Application(id, applicantName, documents, now);
    }

    public void submit(Instant now) {
        Objects.requireNonNull(now, "now");
        if (status != ApplicationStatus.DRAFT) {
            throw new IllegalStateException("Only draft application can be submitted");
        }
        if (documents.isEmpty()) {
            throw new IllegalStateException("Application must contain documents before submission");
        }
        this.status = ApplicationStatus.SUBMITTED;
        this.submittedAt = now;
    }

    public ApplicationId id() {
        return id;
    }

    public ApplicationStatus status() {
        return status;
    }

    public List<DocumentRef> documents() {
        return List.copyOf(documents);
    }

    private static List<DocumentRef> requireNonEmpty(List<DocumentRef> documents) {
        Objects.requireNonNull(documents, "documents");
        if (documents.isEmpty()) {
            throw new IllegalArgumentException("documents must not be empty");
        }
        return documents;
    }
}
```

### 43.3 What Improved?

| Concern | Naive | Improved |
|---|---|---|
| Identity | string public | value type `ApplicationId` |
| Status | arbitrary string | enum/status type |
| Mutability | uncontrolled | method-controlled |
| Documents | exposed list | defensive copy |
| Creation | invalid states possible | static factory + constructor invariant |
| Submit | direct assignment | domain transition method |
| API | data bag | behavior + query |
| Extension | accidental | `final` deliberate |

---

## 44. Mental Model Summary

Class anatomy harus dibaca seperti ini:

```text
class = type declaration
      + object construction rule
      + state ownership boundary
      + behavior surface
      + initialization unit
      + binary compatibility unit
      + reflection/codegen metadata unit
      + module/package architecture participant
```

Field bukan sekadar variable.

```text
field = state + invariant responsibility + visibility risk
```

Constructor bukan sekadar initializer.

```text
constructor = validity boundary + lifecycle entry point
```

Method bukan sekadar function.

```text
method = API contract + behavior gateway + dispatch participant
```

Static bukan sekadar global helper.

```text
static = class-level lifecycle + classloader-scoped state + initialization risk
```

Class loading bukan detail akademis.

```text
class loading = runtime identity + isolation + framework/proxy/plugin behavior
```

---

## 45. Key Takeaways

1. Java class adalah unit source, binary, runtime metadata, object construction, API contract, dan architectural boundary sekaligus.
2. Instance field adalah state per object; static field adalah state per runtime class definition.
3. `final` reference tidak otomatis membuat object immutable.
4. Constructor harus membangun object valid, bukan menjalankan workflow operasional berat.
5. Jangan panggil overridable method dari constructor.
6. Jangan biarkan `this` escape sebelum constructor selesai.
7. Static initializer harus pure, deterministic, cepat, dan failure-nya jelas.
8. Class lifecycle JVM terdiri dari loading, linking, dan initialization.
9. Runtime type identity adalah class name plus defining class loader.
10. Class yang sama namanya tetapi berbeda class loader adalah type runtime berbeda.
11. Reflection, proxy, annotation processing, bytecode generation, dan JPMS semuanya bergantung pada pemahaman anatomy class.
12. Public fields, constructors, and methods adalah binary/API commitment.
13. Top engineer mendesain class dari invariant dan lifecycle, bukan dari field list.

---

## 46. Latihan Berpikir

### Exercise 1 — Static Initialization Risk

Evaluasi class ini:

```java
public final class TokenProvider {
    private static final String TOKEN = fetchToken();

    public static String token() {
        return TOKEN;
    }

    private static String fetchToken() {
        // calls remote auth server
        return "token";
    }
}
```

Pertanyaan:

1. Kapan token diambil?
2. Apa yang terjadi jika auth server down saat class initialization?
3. Bagaimana token di-refresh?
4. Bagaimana testing dilakukan?
5. Apa desain alternatif yang lebih baik?

### Exercise 2 — Constructor Hazard

Apa bug di sini?

```java
abstract class BaseHandler {
    BaseHandler() {
        register();
    }

    protected abstract void register();
}

final class PaymentHandler extends BaseHandler {
    private final String paymentType;

    PaymentHandler(String paymentType) {
        this.paymentType = paymentType;
    }

    @Override
    protected void register() {
        System.out.println(paymentType.toLowerCase());
    }
}
```

### Exercise 3 — ClassLoader Identity

Mengapa error ini mungkin terjadi?

```text
ClassCastException: com.example.Plugin cannot be cast to com.example.Plugin
```

Jawab dengan mental model:

```text
binary name + class loader = runtime type identity
```

### Exercise 4 — Invariant Design

Ubah class ini menjadi invariant-first class:

```java
public class Approval {
    public String id;
    public String status;
    public String approvedBy;
    public Instant approvedAt;
    public String rejectionReason;
}
```

Pastikan impossible states dikurangi:

- approved harus punya approvedBy dan approvedAt,
- rejected harus punya rejectionReason,
- draft tidak boleh punya approvedAt,
- status transition tidak boleh sembarang.

---

## 47. Referensi Resmi dan Bacaan Lanjutan

- Java Language Specification, Java SE 25, Chapter 8 — Classes  
  https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html

- Java Language Specification, Java SE 25, Chapter 12 — Execution  
  https://docs.oracle.com/javase/specs/jls/se25/html/jls-12.html

- Java Virtual Machine Specification, Java SE 25, Chapter 5 — Loading, Linking, and Initializing  
  https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html

- Java SE 25 API, `java.lang.Class`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html

- Java SE 25 API, `java.lang.ClassLoader`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ClassLoader.html

- Oracle Java Tutorials — Understanding Class Members  
  https://docs.oracle.com/javase/tutorial/java/javaOO/classvars.html

- Oracle Java Tutorials — Initializing Fields  
  https://docs.oracle.com/javase/tutorial/java/javaOO/initial.html

---

## 48. Penutup

Part ini membangun fondasi class anatomy: field, method, constructor, initializer, class loading, linking, initialization, static state, class loader identity, dan failure model.

Bagian berikutnya akan masuk ke object contract yang sangat sering disepelekan tetapi sangat menentukan kualitas sistem Java jangka panjang:

**Part 003 — Object Identity, Equality, Hashing, Immutability, and Object Contracts**

Kita akan membahas:

- `==` vs `equals`,
- `hashCode` contract,
- mutable key bug,
- equality untuk entity/value object/DTO/record/proxy,
- inheritance equality trap,
- defensive copying,
- immutable object design,
- object contract dalam framework dan distributed systems.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

- Part 000 — selesai
- Part 001 — selesai
- Part 002 — selesai
- Part 003 — berikutnya

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-001.md">⬅️ Java Type System Deep Dive: Identity, Value, Reference, Nominal Typing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-003.md">Object Identity, Equality, Hashing, Immutability, and Object Contracts ➡️</a>
</div>

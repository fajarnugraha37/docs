# learn-java-oop-functional-reflection-codegen-modules-part-012

# Advanced Polymorphism: Overloading, Overriding, Dispatch, and Pattern Matching

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `012`  
> Topik: advanced polymorphism, overload resolution, override dispatch, hiding, bridge methods, visitor, sealed dispatch, pattern matching, dan design decision model.  
> Target: Java engineer yang ingin memahami polymorphism bukan hanya sebagai fitur OOP, tetapi sebagai mekanisme desain, runtime dispatch, API evolution, dan architecture boundary.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membahas:

- type system,
- class anatomy,
- identity/equality,
- encapsulation,
- inheritance,
- interface,
- sealed hierarchy,
- records,
- enums,
- nested classes,
- generics.

Bagian ini menyatukan semuanya melalui satu pertanyaan besar:

> Ketika sebuah program harus memilih behavior berdasarkan type, object, state, data shape, atau rule, mekanisme dispatch apa yang sebaiknya dipakai?

Di Java, pilihan itu tidak hanya satu. Kita punya:

- method overriding,
- method overloading,
- interface dispatch,
- sealed pattern matching,
- enum dispatch,
- strategy object,
- visitor pattern,
- map/table dispatch,
- reflection dispatch,
- generated dispatch.

Top engineer tidak hanya tahu syntax-nya. Top engineer tahu:

1. siapa yang memilih behavior,
2. kapan pilihan dilakukan,
3. apakah keputusan terjadi saat compile-time atau runtime,
4. apakah hierarchy terbuka atau tertutup,
5. apakah behavior mudah dievolusi,
6. apakah data mudah dievolusi,
7. apa dampaknya terhadap API, testing, performance, dan maintainability.

---

## 1. Mental Model: Polymorphism Adalah Mekanisme Pemilihan Behavior

Secara sederhana, polymorphism berarti “satu operasi dapat memiliki banyak bentuk”. Tapi definisi itu terlalu dangkal.

Dalam sistem nyata, polymorphism adalah mekanisme untuk menjawab:

> “Diberikan input tertentu, implementation mana yang harus dijalankan?”

Contoh:

```java
interface PaymentMethod {
    PaymentResult pay(Money amount);
}

final class CreditCardPayment implements PaymentMethod {
    @Override
    public PaymentResult pay(Money amount) {
        return PaymentResult.success("paid by card");
    }
}

final class BankTransferPayment implements PaymentMethod {
    @Override
    public PaymentResult pay(Money amount) {
        return PaymentResult.success("paid by bank transfer");
    }
}
```

Ketika dipanggil:

```java
PaymentMethod method = new CreditCardPayment();
method.pay(amount);
```

Java memilih implementation `CreditCardPayment.pay`, bukan karena compile-time type variable-nya `PaymentMethod`, tetapi karena runtime object-nya adalah `CreditCardPayment`.

Itu dynamic dispatch.

Namun, tidak semua polymorphism seperti ini. Perhatikan:

```java
void print(Object value) {
    System.out.println("object");
}

void print(String value) {
    System.out.println("string");
}

Object value = "hello";
print(value);
```

Output-nya:

```text
object
```

Kenapa bukan `string`?

Karena overloading dipilih berdasarkan compile-time type, bukan runtime class.

Inilah titik penting:

| Mekanisme | Dipilih berdasarkan | Waktu pemilihan |
|---|---:|---:|
| Overloading | compile-time type parameter | compile time |
| Overriding | runtime class receiver object | runtime |
| Static method hiding | compile-time type reference | compile time |
| Field hiding | compile-time type reference | compile time |
| Pattern matching | runtime shape/type dengan compile-time exhaustiveness check tertentu | runtime + compile-time analysis |
| Enum switch | finite constant value | runtime + compile-time checking terbatas |
| Map dispatch | key lookup | runtime |
| Reflection dispatch | metadata lookup | runtime |

Satu bug besar dalam Java sering berasal dari kebingungan antara **overloading** dan **overriding**.

---

## 2. Receiver, Argument, and Dispatch Axis

Untuk memahami dispatch, pisahkan dua hal:

1. **receiver**: object tempat method dipanggil,
2. **argument**: parameter yang dikirim ke method.

Contoh:

```java
receiver.method(argument);
```

Di Java:

- overriding dispatch memperhatikan runtime type dari receiver,
- overloading resolution memperhatikan compile-time type dari argument.

Contoh:

```java
class Handler {
    void handle(Object value) {
        System.out.println("object");
    }

    void handle(String value) {
        System.out.println("string");
    }
}

Handler handler = new Handler();
Object value = "abc";
handler.handle(value); // object
```

Walaupun `value` berisi `String`, compile-time type-nya `Object`, jadi overload yang dipilih adalah `handle(Object)`.

Sekarang tambahkan overriding:

```java
class BaseHandler {
    void handle(Object value) {
        System.out.println("base object");
    }
}

class StringAwareHandler extends BaseHandler {
    @Override
    void handle(Object value) {
        System.out.println("child object");
    }

    void handle(String value) {
        System.out.println("child string");
    }
}

BaseHandler handler = new StringAwareHandler();
Object value = "abc";
handler.handle(value);
```

Output:

```text
child object
```

Reasoning:

1. Compile-time method set dilihat dari type `BaseHandler`.
2. Dengan argument compile-time `Object`, method signature yang dipilih adalah `handle(Object)`.
3. Saat runtime, receiver object adalah `StringAwareHandler`.
4. Karena `StringAwareHandler` override `handle(Object)`, implementation child dipanggil.
5. `handle(String)` tidak dipertimbangkan karena tidak terlihat dari compile-time receiver type `BaseHandler` untuk call tersebut.

Mental model:

> Overload memilih signature. Override memilih implementation untuk signature itu.

---

## 3. Static Dispatch vs Dynamic Dispatch

### 3.1 Static dispatch

Static dispatch berarti target method ditentukan pada compile-time.

Contoh utama:

- static method call,
- overloaded method selection,
- private method call,
- constructor call,
- field access,
- some `super.method()` calls.

Contoh:

```java
class Printer {
    static void print(Object value) {
        System.out.println("object");
    }

    static void print(String value) {
        System.out.println("string");
    }
}

Object value = "hello";
Printer.print(value); // object
```

`Printer.print(value)` dipilih berdasarkan compile-time type `Object`.

### 3.2 Dynamic dispatch

Dynamic dispatch berarti target implementation dipilih berdasarkan runtime class dari receiver object.

```java
interface Notifier {
    void send(String message);
}

final class EmailNotifier implements Notifier {
    @Override
    public void send(String message) {
        System.out.println("email: " + message);
    }
}

final class SmsNotifier implements Notifier {
    @Override
    public void send(String message) {
        System.out.println("sms: " + message);
    }
}

Notifier notifier = new SmsNotifier();
notifier.send("hello"); // sms: hello
```

Runtime object menentukan implementation.

### 3.3 Design implication

Dynamic dispatch cocok ketika:

- behavior melekat pada object,
- caller tidak perlu tahu concrete type,
- hierarchy relatif stabil,
- extension by subtype adalah requirement,
- contract jelas di supertype/interface.

Static dispatch cocok ketika:

- selection harus deterministik dari compile-time type,
- API ingin menyediakan convenience overload,
- tidak butuh runtime extensibility,
- ingin menghindari runtime lookup complexity.

---

## 4. Overloading Deep Dive

Overloading terjadi ketika beberapa method punya nama sama tetapi parameter list berbeda.

```java
class Formatter {
    String format(int value) {
        return "int:" + value;
    }

    String format(long value) {
        return "long:" + value;
    }

    String format(Integer value) {
        return "Integer:" + value;
    }

    String format(Object value) {
        return "Object:" + value;
    }
}
```

### 4.1 Overloading bukan runtime polymorphism

Overloading sering disebut compile-time polymorphism, tapi istilah ini bisa menyesatkan jika dianggap sama dengan dynamic dispatch.

Overloading memilih method berdasarkan:

- method name,
- arity,
- compile-time argument types,
- primitive widening,
- boxing/unboxing,
- varargs,
- most-specific method rule.

### 4.2 Primitive widening vs boxing

```java
class Example {
    void f(long value) {
        System.out.println("long");
    }

    void f(Integer value) {
        System.out.println("Integer");
    }
}

new Example().f(10); // long
```

`int` lebih memilih widening ke `long` daripada boxing ke `Integer`.

### 4.3 Boxing vs varargs

```java
class Example {
    void f(Integer value) {
        System.out.println("Integer");
    }

    void f(int... values) {
        System.out.println("varargs");
    }
}

new Example().f(10); // Integer
```

Boxing dipilih sebelum varargs.

### 4.4 Null ambiguity

```java
class Example {
    void f(String value) {}
    void f(Integer value) {}
}

new Example().f(null); // compile error: ambiguous
```

`null` bisa menjadi `String` atau `Integer`. Tidak ada yang lebih spesifik di antara keduanya.

Jika ada:

```java
class Example {
    void f(Object value) {
        System.out.println("Object");
    }

    void f(String value) {
        System.out.println("String");
    }
}

new Example().f(null); // String
```

`String` lebih spesifik daripada `Object`.

### 4.5 Overloading dengan inheritance

```java
class Parent {}
class Child extends Parent {}

class Example {
    void f(Parent value) {
        System.out.println("parent");
    }

    void f(Child value) {
        System.out.println("child");
    }
}

Parent value = new Child();
new Example().f(value); // parent
```

Compile-time type argument adalah `Parent`.

### 4.6 Overloading dengan generics dapat mengejutkan

```java
class Example {
    void process(List<String> values) {}
    // void process(List<Integer> values) {} // illegal: same erasure
}
```

Karena type erasure, `List<String>` dan `List<Integer>` sama-sama erase menjadi `List`.

### 4.7 Overloading anti-pattern

Overloading menjadi berbahaya ketika:

- overload terlalu banyak,
- overload berbeda semantic, bukan hanya bentuk input,
- overload menerima tipe yang saling dekat (`String`, `CharSequence`, `Object`),
- overload digabung dengan varargs,
- overload digabung dengan null,
- overload menyebabkan API sulit dibaca dari call site.

Contoh buruk:

```java
void submit(String id) {}
void submit(UUID id) {}
void submit(Object payload) {}
void submit(Map<String, Object> payload) {}
void submit(String id, Object... options) {}
```

Caller sulit memprediksi overload mana yang dipilih.

### 4.8 Guideline overloading

Gunakan overloading jika:

- semua overload benar-benar melakukan operasi konseptual yang sama,
- overload hanya convenience conversion,
- tidak ada ambiguity signifikan,
- call site tetap jelas,
- tidak ada kombinasi raw type/generics/varargs yang berbahaya.

Hindari overloading jika:

- behavior berbeda secara domain,
- argument type sering nullable,
- overload bergantung pada inheritance hierarchy yang kompleks,
- method menjadi API publik jangka panjang.

---

## 5. Overriding Deep Dive

Overriding terjadi ketika subclass menyediakan implementation untuk instance method yang diwariskan dari superclass/interface.

```java
class Animal {
    String sound() {
        return "unknown";
    }
}

class Cat extends Animal {
    @Override
    String sound() {
        return "meow";
    }
}
```

### 5.1 Override requires compatible signature

Signature method mencakup:

- name,
- type parameters tertentu,
- parameter types.

Return type bukan bagian dari signature, tetapi overriding boleh memakai covariant return type.

```java
class Parent {
    Number value() {
        return 1;
    }
}

class Child extends Parent {
    @Override
    Integer value() {
        return 1;
    }
}
```

`Integer` subtype dari `Number`, maka valid.

### 5.2 Access cannot be reduced

```java
class Parent {
    protected void run() {}
}

class Child extends Parent {
    // private void run() {} // illegal: weaker access
}
```

Subclass tidak boleh mempersempit akses method yang di-override.

### 5.3 Checked exception cannot be broadened

```java
class Parent {
    void run() throws IOException {}
}

class Child extends Parent {
    @Override
    void run() throws FileNotFoundException {} // allowed
}
```

Subclass boleh mempersempit checked exception, tetapi tidak boleh memperluasnya.

### 5.4 `@Override` is not optional in serious code

Selalu gunakan `@Override`. Tanpa itu, typo bisa menjadi overload baru, bukan override.

```java
class Parent {
    void process(String value) {}
}

class Child extends Parent {
    // Typo: not overriding
    void processs(String value) {}
}
```

Dengan `@Override`, compiler akan menangkap kesalahan.

### 5.5 Dynamic dispatch and virtual methods

```java
class Parent {
    void print() {
        System.out.println("parent");
    }
}

class Child extends Parent {
    @Override
    void print() {
        System.out.println("child");
    }
}

Parent value = new Child();
value.print(); // child
```

Compile-time type `Parent`, runtime class `Child`.

### 5.6 Override design contract

Override bukan sekadar mengganti kode. Override berarti subclass menyatakan:

> “Saya tetap memenuhi contract method supertype.”

Jika parent berkata:

```java
/** Returns non-null active account. */
Account currentAccount()
```

Subclass tidak boleh return null hanya karena convenient.

Jika parent berkata:

```java
/** Must be idempotent. */
void close()
```

Subclass tidak boleh membuat `close()` gagal pada pemanggilan kedua.

Contract ini sering tidak tertulis, tapi tetap ada secara behavioral.

---

## 6. Method Hiding: Static Method Bukan Override

Static method tidak di-override. Static method di-hide.

```java
class Parent {
    static void print() {
        System.out.println("parent");
    }
}

class Child extends Parent {
    static void print() {
        System.out.println("child");
    }
}

Parent value = new Child();
value.print(); // parent
```

Walaupun object runtime `Child`, output `parent`, karena static method dipilih berdasarkan compile-time reference type.

### 6.1 Jangan panggil static method via instance

Ini legal tapi misleading:

```java
value.print();
```

Lebih jelas:

```java
Parent.print();
Child.print();
```

### 6.2 Static method hiding smell

Jika Anda merasa butuh polymorphic static method, Java tidak menyediakan itu secara native.

Alternatif:

- gunakan instance method,
- gunakan factory object,
- gunakan registry,
- gunakan enum strategy,
- gunakan `ServiceLoader`,
- gunakan generated dispatch.

---

## 7. Field Hiding: Field Bukan Polymorphic

Field access tidak dynamic-dispatch.

```java
class Parent {
    String name = "parent";
}

class Child extends Parent {
    String name = "child";
}

Parent value = new Child();
System.out.println(value.name); // parent
```

Method dynamic, field static by reference type.

```java
class Parent {
    String name() {
        return "parent";
    }
}

class Child extends Parent {
    @Override
    String name() {
        return "child";
    }
}

Parent value = new Child();
System.out.println(value.name()); // child
```

### 7.1 Guideline

Avoid field hiding hampir selalu.

Field hiding menyebabkan:

- confusion,
- serialization bug,
- reflection confusion,
- framework mapping issue,
- difficult debugging.

Gunakan private field + method jika behavior perlu polymorphic.

---

## 8. Private, Final, and Constructor Dispatch

### 8.1 Private method tidak di-override

```java
class Parent {
    private void validate() {
        System.out.println("parent");
    }

    void run() {
        validate();
    }
}

class Child extends Parent {
    private void validate() {
        System.out.println("child");
    }
}

new Child().run(); // parent
```

`Child.validate()` bukan override; itu method berbeda.

### 8.2 Final method tidak bisa di-override

```java
class Parent {
    final void close() {}
}

class Child extends Parent {
    // void close() {} // illegal
}
```

Gunakan `final` untuk melindungi invariant method yang tidak boleh diubah subclass.

### 8.3 Constructor tidak di-override

Constructor bukan method polymorphic. Constructor tidak diwariskan.

Namun constructor bisa memanggil overridable method. Ini berbahaya.

```java
class Parent {
    Parent() {
        init();
    }

    void init() {}
}

class Child extends Parent {
    private final String config;

    Child(String config) {
        this.config = config;
    }

    @Override
    void init() {
        System.out.println(config.length()); // NPE
    }
}
```

Saat `Parent()` berjalan, field `Child.config` belum diinisialisasi.

Rule production:

> Constructor should not call overridable methods.

---

## 9. Bridge Methods and Generics Polymorphism

Generics type erasure dapat membuat compiler menghasilkan bridge method untuk menjaga polymorphism.

Contoh konseptual:

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

Setelah erasure, interface method secara konseptual menjadi:

```java
Object findById(String id);
```

Tetapi implementation return `User`.

Compiler dapat membuat bridge method semacam:

```java
public Object findById(String id) {
    return findById(id); // calls User-returning method
}
```

Bridge method penting untuk:

- reflection,
- stack trace,
- proxy,
- bytecode tools,
- method scanning frameworks,
- annotation processing/generation assumptions.

### 9.1 Reflection implication

Saat scan method via reflection, Anda bisa melihat method synthetic/bridge.

Framework serius harus memutuskan:

- apakah bridge method diabaikan,
- apakah annotation dicari pada bridged method,
- bagaimana resolve generic return type,
- bagaimana mencegah duplicate handler registration.

### 9.2 API design implication

Generic inheritance yang terlalu clever bisa membuat method model sulit dibaca oleh framework dan manusia.

Contoh smell:

```java
interface Handler<T extends Command<R>, R> {
    R handle(T command);
}
```

Ini masih masuk akal. Tapi kalau ditambah recursive bounds, wildcard, dan inheritance bertingkat, reflection/generation akan menjadi jauh lebih rumit.

---

## 10. Double Dispatch

Java dynamic dispatch hanya berdasarkan receiver object, bukan argument runtime type.

Contoh problem:

```java
interface Shape {}
final class Circle implements Shape {}
final class Rectangle implements Shape {}

final class Renderer {
    void render(Circle circle) {
        System.out.println("circle");
    }

    void render(Rectangle rectangle) {
        System.out.println("rectangle");
    }

    void render(Shape shape) {
        System.out.println("shape");
    }
}

Shape shape = new Circle();
new Renderer().render(shape); // shape
```

Overload berdasarkan compile-time type `Shape`, bukan runtime `Circle`.

### 10.1 Double dispatch via method on object

```java
interface Shape {
    void renderWith(Renderer renderer);
}

final class Circle implements Shape {
    @Override
    public void renderWith(Renderer renderer) {
        renderer.render(this);
    }
}

final class Rectangle implements Shape {
    @Override
    public void renderWith(Renderer renderer) {
        renderer.render(this);
    }
}

final class Renderer {
    void render(Circle circle) {
        System.out.println("circle");
    }

    void render(Rectangle rectangle) {
        System.out.println("rectangle");
    }
}
```

Call:

```java
Shape shape = new Circle();
shape.renderWith(new Renderer());
```

Step:

1. Dynamic dispatch memilih `Circle.renderWith`.
2. Di dalam `Circle.renderWith`, compile-time `this` adalah `Circle`.
3. Overload `renderer.render(Circle)` dipilih.

Itu double dispatch.

---

## 11. Visitor Pattern

Visitor adalah bentuk formal dari double dispatch yang memisahkan operation dari object hierarchy.

```java
sealed interface Expression permits Literal, Add {}

record Literal(int value) implements Expression {}
record Add(Expression left, Expression right) implements Expression {}
```

Visitor klasik:

```java
interface ExpressionVisitor<R> {
    R visitLiteral(Literal literal);
    R visitAdd(Add add);
}

sealed interface Expression permits Literal, Add {
    <R> R accept(ExpressionVisitor<R> visitor);
}

record Literal(int value) implements Expression {
    @Override
    public <R> R accept(ExpressionVisitor<R> visitor) {
        return visitor.visitLiteral(this);
    }
}

record Add(Expression left, Expression right) implements Expression {
    @Override
    public <R> R accept(ExpressionVisitor<R> visitor) {
        return visitor.visitAdd(this);
    }
}
```

Usage:

```java
final class Evaluator implements ExpressionVisitor<Integer> {
    @Override
    public Integer visitLiteral(Literal literal) {
        return literal.value();
    }

    @Override
    public Integer visitAdd(Add add) {
        return add.left().accept(this) + add.right().accept(this);
    }
}
```

### 11.1 Visitor strength

Visitor cocok ketika:

- hierarchy relatif stabil,
- operasi sering bertambah,
- ingin operasi terpisah dari data model,
- ingin compile-time coverage untuk semua subtype,
- digunakan dalam compiler/interpreter/AST/model traversal.

### 11.2 Visitor weakness

Visitor lemah ketika:

- subtype sering bertambah,
- visitor interface menjadi besar,
- accept boilerplate mengganggu,
- operasi kecil-kecil terlalu banyak,
- hierarchy tidak benar-benar closed.

### 11.3 Visitor vs sealed switch

Dengan sealed types dan pattern matching switch, banyak visitor bisa disederhanakan.

```java
static int evaluate(Expression expression) {
    return switch (expression) {
        case Literal literal -> literal.value();
        case Add add -> evaluate(add.left()) + evaluate(add.right());
    };
}
```

Ini lebih ringkas, terutama untuk data-oriented modeling.

Tetapi visitor masih berguna jika:

- operation perlu object dengan state,
- operation perlu dependency injection,
- traversal perlu reusable lifecycle,
- ingin double dispatch eksplisit,
- pattern matching belum sesuai constraint project.

---

## 12. Pattern Matching as Dispatch

Pattern matching memungkinkan pemilihan branch berdasarkan type/shape data.

### 12.1 `instanceof` pattern

Sebelum pattern matching:

```java
if (value instanceof String) {
    String text = (String) value;
    System.out.println(text.length());
}
```

Dengan pattern matching:

```java
if (value instanceof String text) {
    System.out.println(text.length());
}
```

Pattern variable `text` hanya tersedia saat match valid.

### 12.2 `switch` pattern

```java
static String describe(Object value) {
    return switch (value) {
        case null -> "null";
        case String text -> "string length=" + text.length();
        case Integer number -> "integer=" + number;
        default -> "unknown";
    };
}
```

Pattern switch memperluas switch dari constant matching menjadi type/shape matching.

### 12.3 Sealed exhaustiveness

```java
sealed interface PaymentResult permits Approved, Declined, Pending {}

record Approved(String transactionId) implements PaymentResult {}
record Declined(String reason) implements PaymentResult {}
record Pending(String reference) implements PaymentResult {}

static String message(PaymentResult result) {
    return switch (result) {
        case Approved approved -> "approved: " + approved.transactionId();
        case Declined declined -> "declined: " + declined.reason();
        case Pending pending -> "pending: " + pending.reference();
    };
}
```

Karena `PaymentResult` sealed, compiler dapat mengetahui semua permitted subclasses.

### 12.4 Pattern matching is not subtype polymorphism

Pattern matching berbeda dari overriding.

Overriding:

```java
result.message();
```

Behavior ada di object.

Pattern matching:

```java
switch (result) { ... }
```

Behavior ada di external function.

Pilihan desainnya penting.

---

## 13. Object-Oriented Dispatch vs Data-Oriented Dispatch

### 13.1 Object-oriented dispatch

Behavior ditempatkan di object.

```java
sealed interface PaymentResult {
    String message();
}

record Approved(String transactionId) implements PaymentResult {
    @Override
    public String message() {
        return "approved: " + transactionId;
    }
}
```

Kelebihan:

- behavior dekat dengan data,
- polymorphic call simple,
- caller tidak perlu switch,
- extensible by subtype.

Kekurangan:

- data model tahu terlalu banyak operation,
- sulit menambah operation tanpa mengubah semua subtype,
- bisa melanggar separation of concerns.

### 13.2 Data-oriented dispatch

Data model hanya menyatakan bentuk data; operation external.

```java
static String message(PaymentResult result) {
    return switch (result) {
        case Approved approved -> "approved: " + approved.transactionId();
        case Declined declined -> "declined: " + declined.reason();
        case Pending pending -> "pending: " + pending.reference();
    };
}
```

Kelebihan:

- mudah menambah operation,
- data model tetap kecil,
- cocok untuk DTO/result/event/AST,
- exhaustiveness dengan sealed type.

Kekurangan:

- logic tersebar jika tidak dikelola,
- tiap operation perlu switch,
- saat subtype bertambah, banyak switch perlu update.

### 13.3 Decision rule

Gunakan object-oriented dispatch jika:

- behavior intrinsic terhadap object,
- subtype dapat menjaga invariant behavior,
- operation utama stabil,
- hierarchy mungkin extensible.

Gunakan data-oriented sealed switch jika:

- hierarchy closed,
- operation banyak dan bervariasi,
- data model harus kecil/transparan,
- compile-time exhaustiveness penting.

---

## 14. Enum Dispatch

Enum sering dipakai untuk finite state atau finite type.

### 14.1 Switch enum

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    REJECTED
}

static boolean terminal(CaseStatus status) {
    return switch (status) {
        case APPROVED, REJECTED -> true;
        case DRAFT, SUBMITTED -> false;
    };
}
```

Cocok jika behavior sederhana.

### 14.2 Constant-specific behavior

```java
enum DiscountType {
    NONE {
        @Override
        Money apply(Money amount) {
            return amount;
        }
    },
    TEN_PERCENT {
        @Override
        Money apply(Money amount) {
            return amount.multiply(0.9);
        }
    };

    abstract Money apply(Money amount);
}
```

Ini enum strategy.

### 14.3 Enum dispatch risk

Enum strategy menjadi buruk jika:

- enum constant terlalu banyak,
- behavior butuh banyak dependency,
- behavior berubah berdasarkan tenant/config,
- enum mulai mengandung business workflow kompleks,
- enum dipakai untuk data yang seharusnya lookup table.

### 14.4 Enum vs sealed

Gunakan enum jika setiap variant tidak butuh payload berbeda.

```java
enum PaymentStatus {
    APPROVED,
    DECLINED,
    PENDING
}
```

Gunakan sealed records jika tiap variant punya payload berbeda.

```java
sealed interface PaymentResult permits Approved, Declined, Pending {}
record Approved(String transactionId) implements PaymentResult {}
record Declined(String reason) implements PaymentResult {}
record Pending(String reference) implements PaymentResult {}
```

---

## 15. Strategy Dispatch

Strategy memindahkan behavior ke object yang bisa diinjeksi/dipilih.

```java
interface PricingStrategy {
    Money calculate(Order order);
}

final class RegularPricing implements PricingStrategy {
    @Override
    public Money calculate(Order order) {
        return order.subtotal();
    }
}

final class CampaignPricing implements PricingStrategy {
    @Override
    public Money calculate(Order order) {
        return order.subtotal().minus(order.discount());
    }
}
```

Usage:

```java
final class PricingService {
    private final PricingStrategy strategy;

    PricingService(PricingStrategy strategy) {
        this.strategy = strategy;
    }

    Money price(Order order) {
        return strategy.calculate(order);
    }
}
```

### 15.1 Strategy selection

Strategy butuh mekanisme pemilihan:

```java
final class PricingStrategyRegistry {
    private final Map<CustomerType, PricingStrategy> strategies;

    PricingStrategyRegistry(Map<CustomerType, PricingStrategy> strategies) {
        this.strategies = Map.copyOf(strategies);
    }

    PricingStrategy strategyFor(CustomerType type) {
        PricingStrategy strategy = strategies.get(type);
        if (strategy == null) {
            throw new IllegalArgumentException("Unsupported customer type: " + type);
        }
        return strategy;
    }
}
```

### 15.2 Strategy fits when

- behavior pluggable,
- dependency injection is needed,
- rules vary by config/tenant/customer,
- adding behavior should not change existing domain type,
- testing individual algorithms matters.

### 15.3 Strategy smell

Strategy overused becomes class explosion.

Bad sign:

```text
One-line strategies with no independent lifecycle, no dependencies, and no meaningful variation.
```

Sometimes a simple switch is clearer.

---

## 16. Map/Table Dispatch

Map dispatch chooses behavior using a key.

```java
final class CommandBus {
    private final Map<Class<? extends Command>, CommandHandler<? extends Command>> handlers;

    CommandBus(Map<Class<? extends Command>, CommandHandler<? extends Command>> handlers) {
        this.handlers = Map.copyOf(handlers);
    }

    @SuppressWarnings("unchecked")
    <C extends Command> void dispatch(C command) {
        CommandHandler<C> handler =
            (CommandHandler<C>) handlers.get(command.getClass());

        if (handler == null) {
            throw new IllegalArgumentException("No handler for " + command.getClass().getName());
        }

        handler.handle(command);
    }
}
```

### 16.1 Strength

Map dispatch cocok untuk:

- command bus,
- event handler registry,
- plugin registry,
- message routing,
- generated handler index,
- annotation-processed lookup.

### 16.2 Risk

Risiko:

- type safety melemah,
- unchecked cast,
- duplicate registration,
- missing handler discovered at runtime,
- subclass matching ambiguity,
- classloader identity issue,
- reflection/generic metadata complexity.

### 16.3 Safer registry key

Daripada hanya `Class<?>`, kadang lebih aman memakai explicit key.

```java
record CommandType(String value) {}

interface Command {
    CommandType type();
}
```

Ini berguna jika message datang dari luar proses dan class Java bukan stable protocol.

---

## 17. Reflection Dispatch

Reflection dispatch memilih method/constructor/field berdasarkan metadata runtime.

```java
Method method = target.getClass().getMethod("handle", Command.class);
method.invoke(target, command);
```

### 17.1 Kapan reflection dispatch dipakai

- framework DI,
- serialization/deserialization,
- validation,
- ORM,
- test framework,
- plugin system,
- annotation-driven framework,
- migration tools.

### 17.2 Kenapa reflection dispatch bukan default pilihan

Reflection lebih rentan terhadap:

- typo string,
- missing method at runtime,
- access problem,
- JPMS encapsulation,
- performance overhead jika tidak di-cache,
- fragile behavior saat refactor,
- security/access boundary,
- native image/AOT constraints.

### 17.3 Reflection dispatch guideline

Jika Anda membuat framework internal:

- scan metadata sekali,
- validate di startup,
- fail fast,
- cache method handle atau invoker,
- buat error message eksplisit,
- hindari scan classpath besar di hot path,
- hormati JPMS boundary,
- sediakan compile-time processor jika memungkinkan.

---

## 18. Generated Dispatch

Generated dispatch adalah dispatch table yang dibuat saat build-time atau compile-time.

Contoh generated registry:

```java
public final class GeneratedCommandRegistry {
    public static Map<Class<? extends Command>, CommandHandler<?>> handlers(
            CreateUserHandler createUserHandler,
            SuspendUserHandler suspendUserHandler
    ) {
        return Map.of(
            CreateUserCommand.class, createUserHandler,
            SuspendUserCommand.class, suspendUserHandler
        );
    }
}
```

### 18.1 Benefit

- startup lebih cepat daripada reflection scanning,
- missing handler bisa dideteksi saat compile/build,
- metadata eksplisit,
- runtime lebih sederhana,
- cocok untuk native/AOT,
- lebih mudah diaudit.

### 18.2 Cost

- generator harus dirawat,
- debugging melibatkan generated source,
- incremental compilation bisa rumit,
- annotation processor bisa memperlambat build,
- generated API harus compatible.

### 18.3 When generated dispatch is worth it

Gunakan generated dispatch jika:

- handler banyak,
- startup penting,
- reflection scanning mahal,
- rules bisa divalidasi saat compile-time,
- framework dipakai luas,
- build pipeline stabil.

Jangan gunakan jika:

- skala kecil,
- aturan berubah dinamis,
- generator lebih kompleks daripada masalahnya,
- tim belum siap maintain generated code.

---

## 19. Polymorphism and API Evolution

Dispatch model mempengaruhi evolusi API.

### 19.1 Open hierarchy with overriding

```java
interface PaymentMethod {
    PaymentResult pay(Money amount);
}
```

Jika API publik dan external party bisa implement, menambah abstract method breaking.

```java
interface PaymentMethod {
    PaymentResult pay(Money amount);
    PaymentFee estimateFee(Money amount); // breaking for implementors
}
```

Alternatif:

- default method,
- separate interface,
- adapter abstract class,
- versioned SPI,
- capability interface.

### 19.2 Sealed hierarchy evolution

Menambah subtype ke sealed hierarchy dapat memaksa semua exhaustive switch di-update.

```java
sealed interface Result permits Success, Failure {}
```

Tambah:

```java
record Pending() implements Result {}
```

Semua switch exhaustive tanpa default perlu update.

Ini bagus jika Anda ingin compiler memaksa update, tapi buruk jika API publik bergantung pada backward compatibility longgar.

### 19.3 Enum evolution

Menambah enum constant juga bisa merusak switch logic yang tidak punya default atau logic downstream yang tidak siap.

Tetapi default branch juga bisa menyembunyikan bug.

Untuk internal domain:

- exhaustive switch tanpa default sering lebih aman.

Untuk external protocol:

- unknown handling perlu eksplisit.

```java
sealed interface ExternalStatus permits KnownStatus, UnknownStatus {}

record KnownStatus(Status status) implements ExternalStatus {}
record UnknownStatus(String rawValue) implements ExternalStatus {}
```

---

## 20. Polymorphism and Testing

Dispatch bugs sering lolos jika test hanya cover satu subtype.

### 20.1 Overriding test

Untuk interface/hierarchy:

- buat contract test,
- jalankan untuk semua implementation,
- validasi invariant supertype.

```java
interface MoneyFormatterContract {
    MoneyFormatter formatter();

    @Test
    default void formatsZero() {
        assertEquals("0.00", formatter().format(Money.zero()));
    }
}
```

### 20.2 Sealed switch test

Untuk sealed switch:

- test semua permitted subtype,
- test null handling jika selector nullable,
- test future compatibility strategy jika public API.

### 20.3 Registry dispatch test

Untuk map dispatch:

- no missing handler,
- no duplicate handler,
- each command maps to correct handler,
- subclass behavior explicit,
- unknown command fails clearly.

### 20.4 Reflection dispatch test

Untuk reflection:

- startup validation test,
- invalid annotation test,
- private method access test,
- JPMS/module-path test,
- bridge/synthetic method handling test.

---

## 21. Performance Mental Model

Bias umum:

> “Polymorphism lambat.”

Jawaban yang lebih benar:

> “Tergantung bentuk dispatch, call site profile, JIT optimization, object allocation, branch predictability, dan apakah dispatch ada di hot path.”

### 21.1 Dynamic dispatch

JVM modern bisa mengoptimalkan banyak virtual/interface call melalui:

- inline cache,
- devirtualization,
- inlining,
- class hierarchy analysis,
- profiling.

Jangan menghindari polymorphism hanya karena takut virtual call.

### 21.2 Pattern switch

Pattern switch dapat menjadi jelas dan efisien, terutama untuk sealed finite hierarchy, tapi jangan menggunakannya untuk mengganti semua polymorphism.

### 21.3 Reflection

Reflection lebih mahal jika:

- lookup dilakukan berulang di hot path,
- access check berulang,
- boxing/unboxing banyak,
- exception wrapping sering,
- no caching.

Jika butuh dynamic invocation serius, pertimbangkan:

- cached reflection metadata,
- `MethodHandle`,
- generated invoker,
- annotation processing.

### 21.4 Map dispatch

Map lookup overhead biasanya kecil, tapi masalahnya bukan hanya CPU. Masalah utamanya type safety, missing handler, dan observability.

---

## 22. Design Matrix: Memilih Dispatch Model

| Problem | Model yang cocok | Alasan |
|---|---|---|
| Behavior intrinsic pada subtype | overriding | behavior dekat dengan object |
| Data variant closed, operation banyak | sealed switch | exhaustive dan external operation mudah |
| Variant finite tanpa payload | enum switch | sederhana dan type-safe |
| Variant finite dengan behavior kecil | enum strategy | behavior dekat constant |
| Algorithm interchangeable | strategy | pluggable dan testable |
| Command/event routing | map/registry dispatch | scalable handler lookup |
| Framework annotation-driven | reflection/generation | metadata-driven |
| AST traversal banyak operasi | visitor atau sealed switch | compile-time coverage |
| Public SPI untuk third party | interface dispatch | extensible by implementor |
| Internal closed domain result | sealed records + switch | explicit outcome modeling |
| High-performance dynamic framework | generated dispatch / MethodHandle | avoid repeated reflection |

---

## 23. Practical Decision Flow

Gunakan pertanyaan berikut.

### 23.1 Apakah set variant tertutup?

Jika ya:

- enum untuk variant tanpa payload,
- sealed interface/class untuk variant dengan payload.

Jika tidak:

- interface + overriding,
- SPI + ServiceLoader,
- registry/plugin model.

### 23.2 Apakah behavior intrinsic pada variant?

Jika ya:

- instance method / overriding,
- enum strategy.

Jika tidak:

- external service function,
- sealed switch,
- visitor.

### 23.3 Apakah operation sering bertambah?

Jika operation sering bertambah dan variant stabil:

- sealed switch,
- visitor,
- external operation classes.

Jika variant sering bertambah dan operation stabil:

- interface method overriding.

### 23.4 Apakah butuh dependency injection?

Jika behavior butuh repository/client/config:

- jangan taruh terlalu banyak di enum,
- gunakan strategy/service object,
- gunakan registry.

### 23.5 Apakah dispatch harus ditemukan dari metadata?

Jika ya:

- reflection for small/internal,
- annotation processor/generated index for large/critical,
- explicit registration for clarity.

### 23.6 Apakah API publik?

Jika ya:

- hati-hati sealed/enum evolution,
- hati-hati menambah abstract method,
- sediakan unknown/fallback strategy untuk external data,
- dokumentasikan compatibility.

---

## 24. Case Study: Enforcement Case Action Dispatch

Bayangkan sistem regulatory case management punya action:

- assign officer,
- request information,
- issue warning,
- escalate case,
- close case.

### 24.1 Naive switch by string

```java
void execute(String actionType, CaseId caseId) {
    switch (actionType) {
        case "ASSIGN_OFFICER" -> assignOfficer(caseId);
        case "REQUEST_INFO" -> requestInfo(caseId);
        case "ISSUE_WARNING" -> issueWarning(caseId);
        case "ESCALATE" -> escalate(caseId);
        case "CLOSE" -> close(caseId);
        default -> throw new IllegalArgumentException("Unknown action: " + actionType);
    }
}
```

Masalah:

- stringly typed,
- payload action tidak jelas,
- validation tersebar,
- authorization sulit dipisahkan,
- action-specific dependencies menumpuk,
- audit metadata sulit dijaga.

### 24.2 Sealed command model

```java
sealed interface CaseActionCommand
        permits AssignOfficer,
                RequestInformation,
                IssueWarning,
                EscalateCase,
                CloseCase {

    CaseId caseId();
}

record AssignOfficer(CaseId caseId, OfficerId officerId) implements CaseActionCommand {}
record RequestInformation(CaseId caseId, String reason) implements CaseActionCommand {}
record IssueWarning(CaseId caseId, String warningCode) implements CaseActionCommand {}
record EscalateCase(CaseId caseId, EscalationLevel level) implements CaseActionCommand {}
record CloseCase(CaseId caseId, ClosureReason reason) implements CaseActionCommand {}
```

### 24.3 Pattern switch dispatcher

```java
final class CaseActionDispatcher {
    void dispatch(CaseActionCommand command) {
        switch (command) {
            case AssignOfficer c -> assignOfficer(c);
            case RequestInformation c -> requestInformation(c);
            case IssueWarning c -> issueWarning(c);
            case EscalateCase c -> escalate(c);
            case CloseCase c -> close(c);
        }
    }

    private void assignOfficer(AssignOfficer command) {}
    private void requestInformation(RequestInformation command) {}
    private void issueWarning(IssueWarning command) {}
    private void escalate(EscalateCase command) {}
    private void close(CloseCase command) {}
}
```

Kelebihan:

- payload typed,
- exhaustive untuk command internal,
- refactor lebih aman,
- tidak perlu string matching,
- command bisa divalidasi sebelum dispatch.

Kekurangan:

- dispatcher berubah setiap ada command baru,
- dependency per handler bisa membuat class membesar.

### 24.4 Strategy/handler registry alternative

```java
interface CaseActionHandler<C extends CaseActionCommand> {
    Class<C> commandType();
    void handle(C command);
}

final class AssignOfficerHandler implements CaseActionHandler<AssignOfficer> {
    @Override
    public Class<AssignOfficer> commandType() {
        return AssignOfficer.class;
    }

    @Override
    public void handle(AssignOfficer command) {
        // action-specific dependencies and behavior
    }
}
```

Registry:

```java
final class CaseActionBus {
    private final Map<Class<? extends CaseActionCommand>, CaseActionHandler<?>> handlers;

    CaseActionBus(List<CaseActionHandler<?>> handlers) {
        Map<Class<? extends CaseActionCommand>, CaseActionHandler<?>> map = new HashMap<>();

        for (CaseActionHandler<?> handler : handlers) {
            CaseActionHandler<?> previous = map.put(handler.commandType(), handler);
            if (previous != null) {
                throw new IllegalStateException("Duplicate handler for " + handler.commandType());
            }
        }

        this.handlers = Map.copyOf(map);
    }

    @SuppressWarnings("unchecked")
    <C extends CaseActionCommand> void dispatch(C command) {
        CaseActionHandler<C> handler =
                (CaseActionHandler<C>) handlers.get(command.getClass());

        if (handler == null) {
            throw new IllegalArgumentException("No handler for " + command.getClass().getName());
        }

        handler.handle(command);
    }
}
```

Kelebihan:

- handler kecil,
- dependency injection natural,
- easy module ownership,
- command addition tidak membuat satu dispatcher besar.

Kekurangan:

- unchecked cast,
- missing handler runtime risk,
- butuh registry validation,
- generic metadata bisa tricky.

### 24.5 Generated registry best of both worlds

Dengan annotation processor, bisa generate registry dari annotation:

```java
@Handles(AssignOfficer.class)
final class AssignOfficerHandler implements CaseActionHandler<AssignOfficer> {
    @Override
    public void handle(AssignOfficer command) {}
}
```

Generated:

```java
final class GeneratedCaseActionRegistry {
    static Map<Class<? extends CaseActionCommand>, CaseActionHandler<?>> build(
            AssignOfficerHandler assignOfficerHandler,
            RequestInformationHandler requestInformationHandler
    ) {
        return Map.of(
            AssignOfficer.class, assignOfficerHandler,
            RequestInformation.class, requestInformationHandler
        );
    }
}
```

Ini mengurangi reflection scanning dan bisa validasi duplicate saat build.

---

## 25. Common Failure Modes

### 25.1 Mistaking overload for override

```java
class Parent {
    void handle(Object value) {}
}

class Child extends Parent {
    void handle(String value) {} // overload, not override
}
```

Solusi:

```java
@Override
void handle(Object value) {}
```

### 25.2 Overload ambiguity with null

```java
void send(String value) {}
void send(UUID value) {}

send(null); // ambiguous
```

Solusi:

- avoid ambiguous overload,
- use named factory,
- require explicit type,
- avoid nullable parameter.

### 25.3 Static method hiding mistaken as polymorphism

```java
Base x = new Child();
x.staticMethod(); // Base static method
```

Solusi:

- call static method via class,
- do not rely on static polymorphism.

### 25.4 Field hiding

```java
Parent p = new Child();
p.value; // Parent field
```

Solusi:

- private fields,
- accessors if needed,
- no field hiding.

### 25.5 Constructor calls overridable method

Solusi:

- constructor initializes only,
- use factory lifecycle method after full construction,
- make called methods private/final.

### 25.6 Exhaustive switch broken by evolution

Jika sealed hierarchy berubah setelah client compiled, runtime mismatch bisa terjadi.

Solusi:

- treat adding sealed subtype as compatibility-sensitive,
- recompile dependents,
- use default only when unknown handling intended,
- version internal model carefully.

### 25.7 Registry missing handler

Solusi:

- validate registry at startup,
- compare known commands vs registered handlers,
- generate registry,
- fail fast.

### 25.8 Reflection sees bridge/synthetic methods

Solusi:

- filter `method.isBridge()` / `method.isSynthetic()` where appropriate,
- resolve bridged method intentionally,
- test generic implementations.

---

## 26. Production Checklist

Sebelum memilih dispatch model, jawab:

1. Apakah variant terbuka atau tertutup?
2. Apakah operation stabil atau sering bertambah?
3. Apakah subtype stabil atau sering bertambah?
4. Apakah behavior intrinsic ke object?
5. Apakah behavior butuh injected dependencies?
6. Apakah caller harus bisa extend dari luar module?
7. Apakah compile-time exhaustiveness penting?
8. Apakah unknown future value harus didukung?
9. Apakah dispatch berada di hot path?
10. Apakah reflection acceptable?
11. Apakah generated code worth it?
12. Apakah API public harus binary compatible?
13. Apakah testing bisa menjamin semua variant/handler ter-cover?
14. Apakah failure mode missing handler jelas?
15. Apakah model tetap bisa dibaca engineer lain 1 tahun ke depan?

---

## 27. Heuristics Yang Sangat Berguna

### 27.1 If behavior belongs to the thing, use polymorphic method

```java
paymentMethod.pay(amount);
```

### 27.2 If operation belongs to use case, use external function/service

```java
paymentSettlementService.settle(result);
```

### 27.3 If variants are closed and data-shaped, use sealed records + switch

```java
switch (result) {
    case Success s -> ...
    case Failure f -> ...
}
```

### 27.4 If behavior is configurable, use strategy

```java
pricingStrategy.calculate(order);
```

### 27.5 If dispatch is framework-like, validate registry or generate it

```java
commandBus.dispatch(command);
```

### 27.6 Avoid clever overloads in public APIs

Prefer explicit names:

```java
UserId.fromString(value)
UserId.fromUuid(uuid)
```

instead of:

```java
UserId.of(String value)
UserId.of(UUID value)
UserId.of(Object value)
```

### 27.7 Use `@Override` always

No exception for production code.

---

## 28. Mini Exercises

### Exercise 1: Predict overload result

```java
class Example {
    void f(Object value) { System.out.println("Object"); }
    void f(CharSequence value) { System.out.println("CharSequence"); }
    void f(String value) { System.out.println("String"); }
}

Object a = "hello";
CharSequence b = "hello";
String c = "hello";

Example e = new Example();
e.f(a);
e.f(b);
e.f(c);
e.f(null);
```

Expected:

```text
Object
CharSequence
String
String
```

Why:

- `a` compile-time `Object`,
- `b` compile-time `CharSequence`,
- `c` compile-time `String`,
- `null` chooses most specific overload: `String`.

### Exercise 2: Override or overload?

```java
class Parent {
    void process(Number value) {}
}

class Child extends Parent {
    void process(Integer value) {}
}
```

`Child.process(Integer)` is overload, not override.

Add `@Override` and compiler will reject it.

### Exercise 3: Choose design

Problem:

- You model payment result: approved, declined, pending.
- Each variant has different payload.
- You need 5 different operations over the result.
- Variants rarely change.

Good choice:

- sealed interface + records + external pattern switch operations.

Problem:

- You model shipping provider plugins loaded from separate modules.
- New providers can be added without changing core.

Good choice:

- interface/SPI + ServiceLoader/registry, not sealed.

Problem:

- You route 80 command types to handlers.
- Startup performance matters.
- Missing handlers must be caught before production.

Good choice:

- handler interface + generated registry/annotation processor + startup validation.

---

## 29. Summary

Polymorphism in Java is not one feature. It is a family of dispatch mechanisms.

The most important distinctions:

- overloading chooses signature at compile time,
- overriding chooses implementation at runtime,
- static method hiding is not polymorphism,
- field access is not polymorphic,
- private methods are not overridden,
- constructors are not polymorphic,
- generics erasure may create bridge methods,
- pattern matching is data-oriented dispatch,
- sealed hierarchy enables compile-time exhaustiveness reasoning,
- visitor is double dispatch structured as an operation object,
- strategy is pluggable behavior,
- registry/map dispatch is scalable but weaker in type safety,
- reflection dispatch is flexible but fragile,
- generated dispatch can recover safety/performance at cost of build complexity.

Top-level rule:

> Do not ask “which Java feature should I use?” Ask “where should the decision live, when should it be made, and who must be allowed to extend it?”

That question leads to the correct dispatch model.

---

## 30. References

- Oracle, Java Language Specification, Java SE 25, especially sections on method declarations, overriding, hiding, overloading, method invocation, pattern matching, and binary compatibility.
- Oracle, Java SE 25 Language Guide, Pattern Matching with `switch`.
- OpenJDK JEP 441, Pattern Matching for `switch`.
- Oracle, Java SE 25 API, `java.lang.Override`.
- Oracle, Java SE 25 API, `java.lang.Class`, reflection metadata for bridge/synthetic inspection.

---

## 31. Next Part

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-013.md
```

Topik:

```text
Composition, Delegation, Mixins, and Object Collaboration Design
```

Status seri: belum selesai.
